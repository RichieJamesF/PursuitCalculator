/* The Pursuit — organiser + rider-signup frontend.
   Runs the shared engine in the browser for instant feedback while persisting
   arrangements to the API, so results match the standalone app and every client. */
import { computeSheet, suggestGroups, cdaOf } from "/engine.mjs";
import { parseCourseFile } from "./course.js";

const POSITIONS = { road_hoods: "Road · hoods", road_drops: "Road · drops", aero_drops: "Aero road · drops", clipon: "Clip-on aero bars", tt: "TT / Tri bike" };
const BUILDS = { small: "Small", medium: "Medium", tall: "Tall" };
const SHADES = ["#ff2f74", "#c8134f", "#ff6f9e", "#8f0d3a", "#ff9dbe", "#e84d86", "#5c0a26", "#ffc2d6"];
const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const LS = window.localStorage;

const state = {
  code: params.get("code") || LS.getItem("pursuit:lastCode") || "",
  token: "",
  signup: params.get("signup") === "1",
  data: null,
  work: { groups: [], unassigned: [] },
  sel: null,
  saveStatus: "",
  ridePicker: null,
  mode: params.get("code") || LS.getItem("pursuit:lastCode") ? "app" : "landing",
  justCreated: null,
  banner: params.get("stravalinked") ? "Strava linked — hit Refine after the ride." : params.get("stravaerror") ? "Strava linking failed." : "",
};
if (state.code) state.token = LS.getItem("pursuit:token:" + state.code) || "";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDur = (s) => { if (!Number.isFinite(s)) return "—"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
const fmtGap = (s) => { s = Math.round(s); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const addClock = (hhmm, secs) => { const [h, m] = (hhmm || "09:30").split(":").map(Number); const t = h * 3600 + m * 60 + Math.round(secs); return `${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const gid = () => "g" + Math.random().toString(16).slice(2, 8);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

const ridersById = () => Object.fromEntries((state.data?.riders || []).map((r) => [r.id, { id: r.id, name: r.name, w: r.w, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
const paramsOf = () => state.data?.event?.params || {};
const segments = () => state.data?.event?.course?.segments;

/* ---- API ----------------------------------------------------------------- */
async function api(path, method = "GET", body, withToken) {
  const headers = { "Content-Type": "application/json" };
  if (withToken) headers["x-organiser-token"] = state.token;
  const res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}
function syncWork() {
  const groups = (state.data?.groups || []).map((g) => ({ id: g.id, members: g.members.map(Number), locked: !!g.locked }));
  const inG = new Set(groups.flatMap((g) => g.members));
  const unassigned = (state.data?.riders || []).map((r) => r.id).filter((id) => !inG.has(id));
  state.work = { groups, unassigned }; state.sel = null;
}
async function loadEvent() {
  if (!state.code) { state.mode = "landing"; render(); return; }
  if (saving) await new Promise((r) => { const t = setInterval(() => { if (!saving) { clearInterval(t); r(); } }, 20); });
  try { state.data = await api("/events/" + encodeURIComponent(state.code)); LS.setItem("pursuit:lastCode", state.code); syncWork(); state.mode = "app"; }
  catch { state.data = null; state.mode = "landing"; state.banner = "Couldn't find event “" + state.code + "”. Check the code, or create a new event."; }
  render();
}
const setSaveStatus = (t) => { state.saveStatus = t; const s = document.getElementById("savestatus"); if (s) s.textContent = t; };
let saving = false, saveAgain = false;
async function persistGroups() {
  if (!state.token) return;
  if (saving) { saveAgain = true; return; }            // coalesce rapid edits, always end on latest state
  saving = true; setSaveStatus("Saving…");
  try { await api("/events/" + state.code + "/groups", "PUT", { groups: state.work.groups }, true); setSaveStatus("Saved"); }
  catch (e) { setSaveStatus("Save failed: " + e.message); }
  saving = false;
  if (saveAgain) { saveAgain = false; persistGroups(); }
}

/* ---- event / rider actions ---------------------------------------------- */
async function createEvent(name, code) {
  try { const r = await api("/events", "POST", { name, code }); state.code = r.event.code; state.token = r.organiserToken; LS.setItem("pursuit:token:" + state.code, r.organiserToken); state.data = r; syncWork(); state.justCreated = { code: r.event.code, token: r.organiserToken, name: r.event.name }; state.mode = "landing"; state.banner = ""; render(); }
  catch (e) { alert(e.message); }
}
function openExisting(code, key) {
  code = (code || "").trim().toLowerCase();
  if (!code) { state.banner = "Enter an event code."; render(); return; }
  state.code = code;
  if (key && key.trim()) { state.token = key.trim(); LS.setItem("pursuit:token:" + code, state.token); }
  else state.token = LS.getItem("pursuit:token:" + code) || "";
  state.banner = ""; loadEvent();
}
function toLanding() { state.mode = "landing"; state.justCreated = null; state.ridePicker = null; render(); }
function savedEvents() {
  const out = [];
  for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith("pursuit:token:")) out.push(k.slice("pursuit:token:".length)); }
  return out;
}
const origin = () => location.origin;
function detailsMailto(code, token, name) {
  const body = `Your Pursuit event details — keep the organiser key safe, it's the only way to edit this event.\n\n`
    + `Event: ${name}\nCode: ${code}\nOrganiser key: ${token}\n\n`
    + `Manage the event: ${origin()}/?code=${encodeURIComponent(code)}\n`
    + `Rider sign-up link (share this): ${origin()}/?code=${encodeURIComponent(code)}&signup=1\n`;
  return `mailto:?subject=${encodeURIComponent(`Pursuit event: ${name} (${code})`)}&body=${encodeURIComponent(body)}`;
}
function copyDetails(code, token, name) {
  const text = `Pursuit event: ${name}\nCode: ${code}\nOrganiser key: ${token}\nManage: ${origin()}/?code=${code}\nSign-up: ${origin()}/?code=${code}&signup=1`;
  navigator.clipboard?.writeText(text); state.banner = "Event details copied to the clipboard."; render();
}
const patchEvent = (body) => api("/events/" + state.code, "PATCH", body, true).then(() => loadEvent()).catch((e) => alert(e.message));
const addRider = (r) => api("/events/" + state.code + "/riders", "POST", r).then(loadEvent).catch((e) => alert(e.message));
const updRider = (id, body) => api("/riders/" + id, "PATCH", body, true).then(loadEvent).catch((e) => alert(e.message));
const delRider = (id) => api("/riders/" + id, "DELETE", null, true).then(loadEvent).catch((e) => alert(e.message));
async function openRidePicker(id) {
  state.banner = "Loading recent rides…"; render();
  try { const r = await api("/riders/" + id + "/rides", "GET", null, true); state.ridePicker = { riderId: id, rides: r.rides, course: r.course, hideCommutes: true }; state.banner = ""; render(); }
  catch (e) { state.banner = e.message; render(); }
}
function bannerFromRefine(r) {
  if (!r.matched) return r.message;
  if (r.mode === "power") return `Set FTP from “${r.activity}”: ${r.ftp} W${r.hadPower ? " (power meter)" : " (Strava estimate)"}. Calibration reset.`;
  return `Refined from “${r.activity}” (${r.distanceKm} km): effective FTP ${r.effectiveFtp} W (×${r.calib}).`;
}
async function applyRefine(id, activityId, mode) {
  state.ridePicker = null; state.banner = "Applying…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { activityId, mode }, true); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}
async function autoRefine(id) {
  state.ridePicker = null; state.banner = "Finding your fastest effort on the course…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { mode: "course" }, true); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}

/* ---- local grouping ops (instant + persisted) --------------------------- */
function locate(id) {
  for (const g of state.work.groups) { if (g.locked) continue; const i = g.members.indexOf(id); if (i >= 0) return { gid: g.id, i }; }
  const ui = state.work.unassigned.indexOf(id); if (ui >= 0) return { ui }; return null;
}
function swap(x, y) {
  if (x === y) return; const lx = locate(x), ly = locate(y); if (!lx || !ly) return;
  const set = (l, id) => { if (l.ui != null) state.work.unassigned[l.ui] = id; else state.work.groups.find((g) => g.id === l.gid).members[l.i] = id; };
  set(lx, y); set(ly, x); state.sel = null; persistGroups(); render();
}
function moveTo(id, target) {
  if (!locate(id)) return; // locked source
  state.work.groups = state.work.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }));
  state.work.unassigned = state.work.unassigned.filter((m) => m !== id);
  if (target === "unassigned") state.work.unassigned.push(id);
  else { const t = state.work.groups.find((g) => g.id === target); if (!t || t.locked) return; t.members.push(id); }
  state.work.groups = state.work.groups.filter((g) => g.members.length || g.locked);
  state.sel = null; persistGroups(); render();
}
const toggleLock = (id) => { const g = state.work.groups.find((q) => q.id === id); if (g) g.locked = !g.locked; persistGroups(); render(); };
const breakGroup = (id) => { const g = state.work.groups.find((q) => q.id === id); if (!g) return; state.work.unassigned.push(...g.members); state.work.groups = state.work.groups.filter((q) => q.id !== id); persistGroups(); render(); };
const clearGroups = () => { const locked = state.work.groups.filter((g) => g.locked); const lockedIds = new Set(locked.flatMap((g) => g.members)); state.work.unassigned = (state.data.riders || []).map((r) => r.id).filter((id) => !lockedIds.has(id)); state.work.groups = locked; state.sel = null; persistGroups(); render(); };
const newGroup = () => { state.work.groups.push({ id: gid(), members: [], locked: false }); persistGroups(); render(); };
function suggestLocal(size) {
  const seg = segments(); if (!seg) { alert("Set a course first."); return; }
  const locked = state.work.groups.filter((g) => g.locked); const lockedIds = new Set(locked.flatMap((g) => g.members));
  const pool = state.data.riders.map((r) => r.id).filter((id) => !lockedIds.has(id));
  const { groups, leftover } = suggestGroups(pool, ridersById(), seg, paramsOf(), size);
  state.work.groups = [...locked, ...groups.map((m) => ({ id: gid(), members: m, locked: false }))];
  state.work.unassigned = leftover; state.sel = null;
  if (leftover.length) state.banner = "One rider left over — drop them into a group.";
  persistGroups(); render();
}
const onPick = (id, locked) => { if (locked) return; if (state.sel == null) state.sel = id; else if (state.sel === id) state.sel = null; else return swap(state.sel, id); render(); };

/* ---- local sheet (matches server engine) -------------------------------- */
const localSheet = () => segments() ? computeSheet(state.work.groups, ridersById(), segments(), paramsOf()) : { rows: [], tMax: 0, tMin: 0 };

function exportCSV(sheet) {
  if (!sheet.rows.length) return;
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const head = ["Seed", "Group", "Riders", "W/kg", "Est", "Gap", "Off gun", "Turn split"];
  const rows = sheet.rows.map((r) => [r.seed, r.members.length + "-up", r.members.map((m) => m.name).join(" · "), r.wkg.toFixed(2), fmtDur(r.dur), r.offset < 0.5 ? "scratch" : fmtGap(r.offset), addClock(state.data.event.firstStart, r.offset), r.members.map((m) => `${m.name} ${Math.round(m.front * 100)}%`).join(" / ")]);
  const csv = [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = state.code + "-start-sheet.csv"; a.click(); URL.revokeObjectURL(a.href);
}

/* ---- render -------------------------------------------------------------- */
function render() {
  if (state.signup) return renderSignup();
  if (state.mode === "landing" || !state.data) return renderLanding();
  const d = state.data, ev = d?.event, origin = location.origin;
  const km = ev?.course ? (ev.course.distanceM / 1000).toFixed(1) : "—", asc = ev?.course ? Math.round(ev.course.ascentM) : "—";
  app.innerHTML = `
    <div class="mast"><div class="rule"></div>
      <div class="mast-row">
        <div><span class="kicker">Group handicap · start sheet</span><h1>THE PURSUIT</h1></div>
        <div class="meta"><div><span>Event</span><b>${esc(state.code || "—")}</b></div><div><span>Riders</span><b>${d?.riders.length ?? "—"}</b></div><div><span>Distance</span><b>${km} km</b></div></div>
      </div><div class="rule"></div>
    </div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="grid"><div class="col" id="left"></div><div class="col" id="right"></div></div>
    <div class="foot">Theoretical times — a planning aid, not a promise. Tune the assumptions to your roads and riders.</div>`;
  const left = document.getElementById("left"), right = document.getElementById("right");

  // Event summary (create/open now happen on the landing screen)
  const canEdit = !!state.token;
  const evPanel = el(`<div class="panel"><div class="panel-hd"><h2>Event</h2><button class="ghost" id="switch">Switch / new</button></div>
    <div class="ev-name">${esc(ev.name)}<span class="ev-code">${esc(state.code)}</span></div>
    ${canEdit
      ? `<div class="keyrow"><span class="keylab">Organiser key</span><code class="keyval">${esc(state.token)}</code></div>
         <div class="row" style="margin-top:8px"><a class="add" id="email">✉ Email me the details</a><button class="ghost" id="copy">Copy details</button></div>`
      : `<div class="row" style="margin-top:8px"><input id="paste-token" placeholder="Paste organiser key to edit" style="flex:1"/><button class="add" id="settoken">Use key</button></div>
         <p class="hint">You're viewing read-only. Paste the organiser key to make changes.</p>`}
  </div>`);
  left.appendChild(evPanel);
  evPanel.querySelector("#switch").onclick = toLanding;
  if (canEdit) {
    evPanel.querySelector("#email").href = detailsMailto(state.code, state.token, ev.name);
    evPanel.querySelector("#copy").onclick = () => copyDetails(state.code, state.token, ev.name);
  } else {
    const st = evPanel.querySelector("#settoken"); if (st) st.onclick = () => { state.token = evPanel.querySelector("#paste-token").value.trim(); LS.setItem("pursuit:token:" + state.code, state.token); render(); };
  }

  // Course (manual + GPX/FIT upload + profile)
  left.appendChild(coursePanel(ev, canEdit, km, asc));

  // Riders
  const rp = el(`<div class="panel"><div class="panel-hd"><h2>Riders</h2><button class="add" id="addr" ${canEdit ? "" : "disabled"}>+ Rider</button></div>
    <div class="linkbox"><input readonly value="${origin}/?code=${encodeURIComponent(state.code)}&signup=1"/><button class="ghost" id="copylink">Copy sign-up link</button></div>
    <p class="hint">Share that link; riders add themselves and appear here.</p><div id="rlist" style="margin-top:10px"></div></div>`);
  left.appendChild(rp);
  rp.querySelector("#copylink").onclick = () => navigator.clipboard?.writeText(`${origin}/?code=${state.code}&signup=1`);
  rp.querySelector("#addr").onclick = () => addRider({ name: "New rider", w: 75, ftp: 240, pos: "road_drops", build: "medium" });
  const rlist = rp.querySelector("#rlist");
  if (!d.riders.length) rlist.innerHTML = `<p class="empty">No riders yet.</p>`;
  d.riders.forEach((r) => rlist.appendChild(riderRow(r, canEdit)));

  // Groups (editable) + start sheet
  const sheet = localSheet();
  right.appendChild(groupsPanel(ev, canEdit, sheet));
  right.appendChild(boardEl(ev, canEdit, sheet));

  if (state.ridePicker) app.appendChild(ridePickerEl());
}

function ridePickerEl() {
  const { riderId, rides, course, hideCommutes } = state.ridePicker;
  const rider = ridersById()[riderId];
  const shown = rides.filter((r) => !(hideCommutes && r.commute));
  const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const overlay = el(`<div class="modal-back"><div class="modal">
    <div class="modal-hd"><div><span class="kicker">Refine from Strava</span><h2>${esc(rider?.name || "Rider")}'s recent rides</h2></div><button class="modal-x" id="close">×</button></div>
    <p class="hint">Pick a real effort — not a commute. <b>Use time</b> calibrates from how fast this ride was over your course (${course.distanceKm ? course.distanceKm + " km" : "no course set"}). <b>FTP from power</b> reads the ride's power as an FTP estimate (best on a 30–60 min hard effort).</p>
    <div class="modal-tools"><button class="btn" id="auto" ${course.distanceKm ? "" : "disabled"}>Auto · fastest effort on course</button>
      <label class="chk"><input type="checkbox" id="hc" ${hideCommutes ? "checked" : ""}/> Hide commutes</label></div>
    <div class="ridelist" id="ridelist"></div>
  </div></div>`);
  overlay.querySelector("#close").onclick = () => { state.ridePicker = null; render(); };
  overlay.onclick = (e) => { if (e.target === overlay) { state.ridePicker = null; render(); } };
  overlay.querySelector("#auto").onclick = () => autoRefine(riderId);
  overlay.querySelector("#hc").onchange = (e) => { state.ridePicker.hideCommutes = e.target.checked; render(); };

  const list = overlay.querySelector("#ridelist");
  if (!shown.length) list.innerHTML = `<p class="empty">No rides in the last 6 weeks${hideCommutes ? " (commutes hidden)" : ""}.</p>`;
  shown.forEach((rd) => {
    const power = rd.weightedWatts != null ? `${rd.weightedWatts} W · meter` : rd.avgWatts != null ? `${rd.avgWatts} W · est` : "no power";
    const card = el(`<div class="ridecard ${rd.matches ? "match" : ""}">
      <div class="ride-main"><b>${esc(rd.name)}</b><span class="ride-sub">${shortDate(rd.date)} · ${rd.distanceKm} km · ${fmtDur(rd.movingTime)} · ${rd.avgSpeedKmh} km/h · ${power}</span></div>
      <div class="ride-tags">${rd.matches ? `<span class="tg tg-match">matches course${rd.impliedCalib ? ` · ×${rd.impliedCalib}` : ""}</span>` : ""}${rd.commute ? `<span class="tg tg-com">commute</span>` : ""}${rd.hasPower ? `<span class="tg tg-pow">power meter</span>` : ""}</div>
      <div class="ride-acts">
        <button class="add usetime" ${rd.matches ? "" : "disabled"} title="${rd.matches ? "Calibrate from this ride's time on the course" : "Only for rides that match the course distance"}">Use time</button>
        <button class="add usepow" ${rd.avgWatts != null || rd.weightedWatts != null ? "" : "disabled"} title="Set FTP from this ride's power">FTP from power</button>
      </div></div>`);
    card.querySelector(".usetime").onclick = () => applyRefine(riderId, rd.id, "course");
    card.querySelector(".usepow").onclick = () => applyRefine(riderId, rd.id, "power");
    list.appendChild(card);
  });
  return overlay;
}

function coursePanel(ev, canEdit, km, asc) {
  const cs = el(`<div class="panel"><div class="panel-hd"><h2>Course</h2></div>
    <div class="drop" id="drop" tabindex="0" role="button"><b>Drop a GPX or FIT — or tap to choose</b><span>Strava route → Export GPX, or a Wahoo/Garmin .fit off the head unit.</span></div>
    <input type="file" id="file" accept=".gpx,.fit" hidden/>
    <p class="err" id="cerr" style="display:none"></p>
    <div class="two" style="margin-top:12px"><label class="f">Distance (km)<input type="number" id="km" value="${ev.course ? (ev.course.distanceM / 1000).toFixed(1) : 45}"/></label><label class="f">Total ascent (m)<input type="number" id="asc" value="${ev.course ? Math.round(ev.course.ascentM) : 500}"/></label></div>
    <div class="row" style="margin-top:10px"><button class="add" id="savecourse" ${canEdit ? "" : "disabled"}>Save manual course</button><span class="hint">${ev.course ? `${esc(ev.course.name || "Course")} · ${km} km · ${asc} m` : "no course set"}</span></div>
    <div id="prof"></div></div>`);
  const drop = cs.querySelector("#drop"), file = cs.querySelector("#file"), cerr = cs.querySelector("#cerr");
  const doFile = async (f) => { if (!canEdit) { alert("Paste the organiser key first."); return; } cerr.style.display = "none"; try { const course = await parseCourseFile(f); await patchEvent({ course }); } catch (e) { cerr.textContent = e.message; cerr.style.display = "block"; } };
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => e.key === "Enter" && file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer.files[0]) doFile(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && doFile(file.files[0]);
  cs.querySelector("#savecourse").onclick = () => patchEvent({ courseManual: { km: cs.querySelector("#km").value, ascent: cs.querySelector("#asc").value } });
  if (ev.course?.profile) cs.querySelector("#prof").appendChild(profileSvg(ev.course.profile));
  return cs;
}

function groupsPanel(ev, canEdit, sheet) {
  const metrics = Object.fromEntries(sheet.rows.map((r) => [r.gid, r]));
  const gp = el(`<div class="panel"><div class="panel-hd"><h2>Pursuit groups</h2>
    <div class="row"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Size<span class="stepper"><button id="dec">−</button><b id="gs">${ev.groupSize}</b><button id="inc">+</button></span></label><button class="btn" id="suggest" ${canEdit ? "" : "disabled"}>Suggest</button></div>
  </div>
  <div class="row" style="margin-bottom:10px">${canEdit ? `<button class="ghost" id="clear">Clear</button><button class="ghost" id="new">+ Empty group</button>` : ""}<span class="hint">Tap a rider, then another, to swap · <span id="savestatus">${esc(state.saveStatus)}</span></span></div>
  <div id="groups" class="groups"></div><div id="bench"></div>
  ${state.sel ? `<p class="swaphint">Selected <b>${esc(ridersById()[state.sel]?.name || "rider")}</b> — tap another to swap, or “+ here” to move.</p>` : ""}
  </div>`);
  let size = ev.groupSize; const gsEl = gp.querySelector("#gs");
  gp.querySelector("#dec").onclick = () => { size = Math.max(1, size - 1); gsEl.textContent = size; };
  gp.querySelector("#inc").onclick = () => { size = Math.min(8, size + 1); gsEl.textContent = size; };
  gp.querySelector("#suggest").onclick = () => suggestLocal(size);
  const clr = gp.querySelector("#clear"); if (clr) clr.onclick = clearGroups;
  const ng = gp.querySelector("#new"); if (ng) ng.onclick = newGroup;

  const gwrap = gp.querySelector("#groups");
  if (!state.work.groups.length) gwrap.innerHTML = `<p class="empty">Set a group size and tap <b>Suggest</b> to tier riders by ability, then tweak by hand.</p>`;
  state.work.groups.forEach((g) => gwrap.appendChild(groupCard(g, metrics[g.id], canEdit)));

  if (state.work.unassigned.length) {
    const bench = el(`<div class="benchbox"><div class="bench-hd">Unassigned</div><div class="bench" id="benchrow"></div></div>`);
    const row = bench.querySelector("#benchrow");
    if (state.sel != null && canEdit) { const b = el(`<button class="movein">+ here</button>`); b.onclick = () => moveTo(state.sel, "unassigned"); row.appendChild(b); }
    state.work.unassigned.forEach((id) => { const r = ridersById()[id]; if (r) row.appendChild(chip(r, false)); });
    gp.querySelector("#bench").appendChild(bench);
  }
  return gp;
}

function groupCard(g, m, canEdit) {
  const members = g.members.map((id) => ridersById()[id]).filter(Boolean);
  const quality = m?.quality || (members.length <= 1 ? "Solo" : "—");
  const wkg = m ? m.wkg.toFixed(2) : members.length ? (members.reduce((s, r) => s + r.ftp, 0) / members.reduce((s, r) => s + r.w, 0)).toFixed(2) : "—";
  const card = el(`<div class="grpcard ${g.locked ? "locked" : ""}">
    <div class="gc-top"><span class="gc-size">${members.length}-up</span><span class="quality q-${quality.toLowerCase()}">${quality}</span><span class="gc-wkg">${wkg} W/kg</span>
      <span class="gc-actions">${canEdit && state.sel != null && !g.locked ? `<button class="movein">+ here</button>` : ""}${canEdit ? `<button class="lock">${g.locked ? "🔒" : "🔓"}</button><button class="unpair">×</button>` : ""}</span></div>
    <div class="turnbar">${m ? m.members.map((mm, i) => `<span style="width:${(mm.front * 100).toFixed(1)}%;background:${SHADES[i % SHADES.length]}"></span>`).join("") : ""}</div>
    <div class="gc-riders"></div></div>`);
  const mi = card.querySelector(".movein"); if (mi) mi.onclick = () => moveTo(state.sel, g.id);
  const lk = card.querySelector(".lock"); if (lk) lk.onclick = () => toggleLock(g.id);
  const up = card.querySelector(".unpair"); if (up) up.onclick = () => breakGroup(g.id);
  const rr = card.querySelector(".gc-riders");
  if (!members.length) rr.innerHTML = `<p class="empty" style="padding:4px">empty — move riders here</p>`;
  members.forEach((r, i) => rr.appendChild(chip(r, g.locked, m ? Math.round(m.members[i].front * 100) : null)));
  return card;
}

function chip(r, locked, lead) {
  const wkg = (r.ftp / (r.w + 8)).toFixed(2);
  const c = el(`<button class="chip ${state.sel === r.id ? "sel" : ""} ${locked ? "chip-lock" : ""}">
    <span class="chip-name">${esc(r.name)}</span><span class="chip-sub">${wkg} W/kg · ${cdaOf(r).toFixed(2)}${lead != null ? ` · ${lead}%` : ""}</span></button>`);
  c.disabled = locked && state.sel && state.sel !== r.id;
  c.onclick = () => onPick(r.id, locked);
  return c;
}

function riderRow(r, canEdit) {
  const wkg = (r.ftp / (r.w + 8)).toFixed(2);
  const row = el(`<div class="rr">
    <input class="rr-name" value="${esc(r.name)}" placeholder="Rider name" ${canEdit ? "" : "disabled"}/>
    <div class="rr-ctrl">
      <label class="rf"><span>kg</span><input type="number" class="w" value="${r.w}" ${canEdit ? "" : "disabled"}/></label>
      <label class="rf"><span>FTP·W</span><input type="number" class="ftp" value="${r.ftp}" ${canEdit ? "" : "disabled"}/></label>
      <label class="rf"><span>Bike</span><select class="pos" ${canEdit ? "" : "disabled"}>${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === r.pos ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="rf"><span>Build</span><select class="build" ${canEdit ? "" : "disabled"}>${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === r.build ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      ${canEdit ? `<button class="del" title="Remove">×</button>` : ""}</div>
    <div class="rr-tools"><span class="pill ${r.strava ? "on" : "off"}">${r.strava ? "Strava linked" : "No Strava"}</span>
      <span class="micro">${wkg} W/kg${r.calib && r.calib !== 1 ? ` · cal ×${r.calib.toFixed(2)}` : ""}</span>
      ${canEdit ? `<a class="ghost" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${r.id}">${r.strava ? "Re-link" : "Link Strava"}</a>` : ""}
      ${canEdit && r.strava ? `<button class="ghost refine">Refine</button>` : ""}</div></div>`);
  if (canEdit) {
    const save = () => updRider(r.id, { name: row.querySelector(".rr-name").value, w: +row.querySelector(".w").value, ftp: +row.querySelector(".ftp").value, pos: row.querySelector(".pos").value, build: row.querySelector(".build").value });
    row.querySelector(".rr-name").onblur = save;
    row.querySelectorAll(".w,.ftp,.pos,.build").forEach((i) => (i.onchange = save));
    row.querySelector(".del").onclick = () => confirm(`Remove ${r.name}?`) && delRider(r.id);
    const rf = row.querySelector(".refine"); if (rf) rf.onclick = () => openRidePicker(r.id);
  }
  return row;
}

function boardEl(ev, canEdit, sheet) {
  const b = el(`<div class="board">
    <div class="printhead"><b>${esc(ev.name)}</b><span>${esc(state.code)} · ${ev.course ? (ev.course.distanceM / 1000).toFixed(1) : "—"} km · first gun ${esc(ev.firstStart)}</span></div>
    <div class="board-hd"><div><span class="kicker">Start sheet</span><h2>Roll-off order</h2></div>
      <div><label class="gun">First gun<input type="time" id="gun" value="${esc(ev.firstStart)}" ${canEdit ? "" : "disabled"}/></label>${sheet.rows.length ? `<div class="exports"><button class="ghost light" id="csv">CSV</button><button class="ghost light" id="print">Print</button></div>` : ""}</div></div>
    ${sheet.rows.length ? `<div class="conv"><span>Predicted catch</span><b>${fmtDur(sheet.tMax)}</b><span>after first gun · window ${fmtDur(sheet.tMax - sheet.tMin)}</span></div>
      <table><thead><tr><th>Seed</th><th>Group</th><th class="num">W/kg</th><th class="num">Est.</th><th class="num">Gap</th><th class="num">Off gun</th></tr></thead><tbody>
      ${sheet.rows.map((r) => `<tr><td class="seed">${r.seed}</td>
        <td class="grp"><b>${r.members.map((m) => esc(m.name)).join(" · ")}<span class="quality q-${r.quality.toLowerCase()}">${r.quality}</span></b>
          <div class="turnbar">${r.members.map((m, i) => `<span style="width:${(m.front * 100).toFixed(1)}%;background:${SHADES[i % SHADES.length]}"></span>`).join("")}</div></td>
        <td class="num">${r.wkg.toFixed(2)}</td><td class="num">${fmtDur(r.dur)}</td><td class="num gap">${r.offset < 0.5 ? "scratch" : fmtGap(r.offset)}</td><td class="num">${addClock(ev.firstStart, r.offset)}</td></tr>`).join("")}
      </tbody></table>
      <p class="note">Seed 1 rolls off at the gun; each faster group leaves on its gap so all converge at the catch. The bar shows each rider's share of the front.</p>`
      : `<p class="empty">Make some groups to seed the start times.</p>`}</div>`);
  const gun = b.querySelector("#gun"); if (gun && canEdit) gun.onchange = () => patchEvent({ firstStart: gun.value });
  const csv = b.querySelector("#csv"); if (csv) csv.onclick = () => exportCSV(sheet);
  const pr = b.querySelector("#print"); if (pr) pr.onclick = () => window.print();
  return b;
}

function profileSvg(profile) {
  const W = 320, H = 60, pad = 2; const d0 = profile[0].d, maxD = (profile[profile.length - 1].d - d0) || 1;
  const eles = profile.map((p) => p.ele), lo = Math.min(...eles), hi = Math.max(...eles), span = hi - lo || 1;
  const x = (d) => pad + ((d - d0) / maxD) * (W - 2 * pad), y = (e) => H - pad - ((e - lo) / span) * (H - 2 * pad - 6);
  let dd = `M ${x(d0)} ${H} `; profile.forEach((p) => (dd += `L ${x(p.d).toFixed(1)} ${y(p.ele).toFixed(1)} `)); dd += `L ${x(profile[profile.length - 1].d)} ${H} Z`;
  const svg = el(`<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${dd}"/></svg>`);
  return svg;
}

/* ---- landing / entry gate ------------------------------------------------ */
function renderLanding() {
  if (state.justCreated) return renderCreated();
  const recents = savedEvents();
  app.innerHTML = `<div class="landing">
    <div class="rule"></div>
    <div class="land-head"><span class="kicker">Group handicap · start sheet</span><h1>THE PURSUIT</h1></div>
    <div class="rule"></div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <p class="land-intro">Slower groups roll off first, faster groups chase, everyone converges in one bunch. Create an event, share the sign-up link, and let the app seed the start times.</p>
    <div class="gate">
      <div class="gate-card">
        <span class="gate-kick">Start here</span><h2>Create a new event</h2>
        <p class="hint">You'll get an organiser key — the one thing you need to manage it later.</p>
        <label class="f">Event name<input id="c-name" placeholder="e.g. Condors Summer Pursuit"/></label>
        <label class="f">Custom code <span class="opt">optional</span><input id="c-code" placeholder="auto if left blank"/></label>
        <button class="btn block" id="create">Create event</button>
      </div>
      <div class="gate-card alt">
        <span class="gate-kick">Coming back</span><h2>Open an existing event</h2>
        <p class="hint">Enter the code. Add the organiser key to make changes, or leave it blank to just view.</p>
        <label class="f">Event code<input id="o-code" placeholder="event-code"/></label>
        <label class="f">Organiser key <span class="opt">optional — for editing</span><input id="o-key" placeholder="paste key"/></label>
        <button class="add block" id="open">Open event</button>
      </div>
    </div>
    ${recents.length ? `<div class="recents"><span class="rec-lab">Your events on this device</span><div class="rec-list">${recents.map((c) => `<button class="rec" data-code="${esc(c)}">${esc(c)} ›</button>`).join("")}</div></div>` : ""}
    <p class="land-foot">Are you a rider? Use the sign-up link your organiser sent you.</p>
  </div>`;
  document.getElementById("create").onclick = () => createEvent(document.getElementById("c-name").value || "Pursuit", document.getElementById("c-code").value);
  document.getElementById("open").onclick = () => openExisting(document.getElementById("o-code").value, document.getElementById("o-key").value);
  app.querySelectorAll(".rec").forEach((b) => (b.onclick = () => openExisting(b.dataset.code)));
}

function renderCreated() {
  const { code, token, name } = state.justCreated;
  app.innerHTML = `<div class="landing"><div class="rule"></div>
    <div class="land-head"><span class="kicker" style="color:#1f7a4d">Event created</span><h1>${esc(name)}</h1></div>
    <div class="rule"></div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="created">
      <p class="hint">Save these now. The <b>organiser key</b> is the only way to edit this event — there's no password reset.</p>
      <div class="cr-field"><span>Event code</span><code>${esc(code)}</code></div>
      <div class="cr-field key"><span>Organiser key</span><code>${esc(token)}</code></div>
      <div class="row" style="margin:6px 0 4px"><a class="btn" id="email">✉ Email me the details</a><button class="add" id="copy">Copy details</button></div>
      <div class="cr-field"><span>Rider sign-up link</span><input readonly value="${origin()}/?code=${encodeURIComponent(code)}&signup=1"/></div>
      <button class="btn block" id="go" style="margin-top:12px">Continue to event ›</button>
    </div>
    <p class="land-foot">Tip: email the details to yourself so you can get back in from any device.</p>
  </div>`;
  document.getElementById("email").href = detailsMailto(code, token, name);
  document.getElementById("copy").onclick = () => { copyDetails(code, token, name); };
  document.getElementById("go").onclick = () => { state.justCreated = null; state.mode = "app"; state.banner = ""; render(); };
}

/* ---- rider self sign-up -------------------------------------------------- */
function renderSignup() {
  app.innerHTML = `<div class="center">
    <a class="ghost" href="/?code=${encodeURIComponent(state.code)}" style="align-self:flex-start">‹ Organiser view</a>
    <span class="kicker">Rider sign-up</span><h1 class="su-title">ADD YOUR DETAILS</h1>
    <label class="f">Event code<input id="code" value="${esc(state.code)}"/></label>
    <label class="f">Name<input id="name" placeholder="Your name"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="w" value="75"/></label><label class="f">FTP (W)<input type="number" id="ftp" value="240"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label></div>
    <p class="micro">Not sure of your FTP? Your best hour-power guess is fine.</p>
    <button class="btn block" id="send">Send to organiser</button><p class="hint" id="status"></p></div>`;
  document.getElementById("send").onclick = async () => {
    const code = document.getElementById("code").value.trim().toLowerCase();
    const body = { name: document.getElementById("name").value, w: +document.getElementById("w").value, ftp: +document.getElementById("ftp").value, pos: document.getElementById("pos").value, build: document.getElementById("build").value };
    const status = document.getElementById("status");
    if (!body.name.trim()) { status.textContent = "Add your name first."; return; }
    status.textContent = "Sending…";
    try { await api("/events/" + encodeURIComponent(code) + "/riders", "POST", body); status.textContent = `Thanks ${body.name} — you're in. You can close this.`; }
    catch (e) { status.textContent = e.message; }
  };
}

if (state.signup) render();
else if (state.code) loadEvent();
else render();
