/* Browser-side GPX/FIT course parsing → { segments, distanceM, ascentM, name, profile }.
   Same tested code as the standalone app; POST the result to PATCH /api/events/:code. */

function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r, la1 = a.lat * r, la2 = b.lat * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildCourse(pp, name) {
  if (pp.length < 2) throw new Error("Not enough points to build a course.");
  const eles = pp.map((q) => q.ele), win = 4;
  const eleS = eles.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - win); j <= Math.min(eles.length - 1, i + win); j++) { s += eles[j]; c++; } return s / c; });
  const segments = [], profile = [{ d: pp[0].d, ele: eleS[0] }]; let ascent = 0;
  for (let i = 1; i < pp.length; i++) {
    const dist = pp[i].d - pp[i - 1].d; if (dist < 0.4) continue;
    const rise = eleS[i] - eleS[i - 1]; const grad = Math.max(-0.28, Math.min(0.28, rise / dist));
    if (rise > 0) ascent += rise;
    segments.push({ dist, grad }); profile.push({ d: pp[i].d, ele: eleS[i] });
  }
  const distanceM = pp[pp.length - 1].d - pp[0].d;
  const step = Math.max(1, Math.floor(profile.length / 240));
  return { segments, profile: profile.filter((_, i) => i % step === 0 || i === profile.length - 1), distanceM, ascentM: ascent, name };
}

export function parseGpx(text, name) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("That file isn't valid GPX.");
  let nodes = [...doc.getElementsByTagName("trkpt")]; if (!nodes.length) nodes = [...doc.getElementsByTagName("rtept")];
  if (!nodes.length) throw new Error("No track or route points in that GPX.");
  let pts = nodes.map((n) => { const e = n.getElementsByTagName("ele")[0]; return { lat: parseFloat(n.getAttribute("lat")), lon: parseFloat(n.getAttribute("lon")), ele: e ? parseFloat(e.textContent) : 0 }; }).filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon));
  if (pts.length > 2500) { const s = Math.ceil(pts.length / 2500); pts = pts.filter((_, i) => i % s === 0 || i === pts.length - 1); }
  const pp = [{ d: 0, ele: pts[0].ele }]; let cum = 0;
  for (let i = 1; i < pts.length; i++) { cum += haversine(pts[i - 1], pts[i]); pp.push({ d: cum, ele: pts[i].ele }); }
  return buildCourse(pp, name);
}

export function parseFit(buffer, name) {
  const dv = new DataView(buffer); const headerSize = dv.getUint8(0), dataSize = dv.getUint32(4, true), end = Math.min(headerSize + dataSize, dv.byteLength);
  let pos = headerSize; const defs = {}, recs = [], SEMI = 180 / 2 ** 31;
  const readData = (p, def) => { const rec = {}; let ok = false; for (const f of def.fields) { if (def.global === 20) { const L = def.little; if (f.num === 0) { const r = dv.getInt32(p, L); if (r !== 0x7fffffff) { rec.lat = r * SEMI; ok = true; } } else if (f.num === 1) { const r = dv.getInt32(p, L); if (r !== 0x7fffffff) rec.lon = r * SEMI; } else if (f.num === 2) { const r = dv.getUint16(p, L); if (r !== 0xffff) rec.alt = r / 5 - 500; } else if (f.num === 78) { const r = dv.getUint32(p, L); if (r !== 0xffffffff) rec.ealt = r / 5 - 500; } else if (f.num === 5) { const r = dv.getUint32(p, L); if (r !== 0xffffffff) rec.dist = r / 100; } } p += f.size; } for (const df of def.devFields) p += df.size; if (def.global === 20 && ok) recs.push(rec); return p; };
  while (pos < end) { const rh = dv.getUint8(pos); pos += 1; if (rh & 0x80) { const lt = (rh >> 5) & 0x3; if (defs[lt]) pos = readData(pos, defs[lt]); continue; } const isDef = rh & 0x40, hasDev = rh & 0x20, lt = rh & 0x0f; if (isDef) { pos += 1; const arch = dv.getUint8(pos); pos += 1; const little = arch === 0; const global = dv.getUint16(pos, little); pos += 2; const n = dv.getUint8(pos); pos += 1; const fields = []; for (let i = 0; i < n; i++) { fields.push({ num: dv.getUint8(pos), size: dv.getUint8(pos + 1), base: dv.getUint8(pos + 2) }); pos += 3; } const devFields = []; if (hasDev) { const dn = dv.getUint8(pos); pos += 1; for (let i = 0; i < dn; i++) { devFields.push({ size: dv.getUint8(pos + 1) }); pos += 3; } } defs[lt] = { little, global, fields, devFields }; } else if (defs[lt]) pos = readData(pos, defs[lt]); }
  if (recs.length < 2) throw new Error("No GPS records in that FIT file.");
  const haveDist = recs.every((r) => r.dist != null); const pp = []; let cum = 0;
  for (let i = 0; i < recs.length; i++) { const ele = recs[i].ealt ?? recs[i].alt ?? 0; if (haveDist) pp.push({ d: recs[i].dist, ele }); else { if (i > 0 && recs[i].lat != null && recs[i - 1].lat != null) cum += haversine(recs[i - 1], recs[i]); pp.push({ d: cum, ele }); } }
  return buildCourse(pp, name);
}

export function parseCourseFile(file) {
  const isFit = /\.fit$/i.test(file.name);
  const name = file.name.replace(/\.(gpx|fit)$/i, "");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => { try { resolve(isFit ? parseFit(e.target.result, name) : parseGpx(e.target.result, name)); } catch (err) { reject(err); } };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    if (isFit) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });
}
