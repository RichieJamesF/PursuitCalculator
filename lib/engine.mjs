/* ============================================================================
   Pursuit engine — shared by the standalone app and the Railway backend.
   N-up rotating-paceline physics, ability grouping, and Strava calibration.
   Pure functions, no DOM. Import in Node (ESM) or inline into the artifact.
   ========================================================================== */

export const GRAV = 9.80665;

export const POSITIONS = {
  road_hoods: { label: "Road · hoods", cda: 0.36 },
  road_drops: { label: "Road · drops", cda: 0.32 },
  aero_drops: { label: "Aero road · drops", cda: 0.29 },
  clipon:     { label: "Clip-on aero bars", cda: 0.27 },
  tt:         { label: "TT / Tri bike", cda: 0.24 },
};
export const BUILDS = {
  small:  { label: "Small", mult: 0.90 },
  medium: { label: "Medium", mult: 1.00 },
  tall:   { label: "Tall", mult: 1.10 },
};
export const cdaOf = (r) => (POSITIONS[r.pos]?.cda ?? 0.32) * (BUILDS[r.build]?.mult ?? 1);

// Effective sustainable power for a rider: FTP × effort × personal calibration.
const powerOf = (r, p) => Number(r.ftp) * (p.effort / 100) * (r.calib || 1);

/* ---- N-up steady-state speed --------------------------------------------
   Rotating paceline: at any instant one rider is exposed on the front, the
   rest draft (aero cut by draftSaving). Rider i spends fraction f_i on the
   front, Σf_i = 1. Rider i's average power:
     P_i = (v/η)[ m_i·g·slope + 0.5ρv²·CdA_i·((1-d) + f_i·d) ]
   cap_i(v) = the largest f_i rider i can sustain at speed v. A speed is
   feasible if nobody is dropped even while fully drafting (cap_i ≥ 0) and the
   pack can cover the whole front between them (Σ min(1,cap_i) ≥ 1). Max
   feasible v is the group's pace; at that pace the front shares are pinned. */
export function groupSpeed(group, grad, p) {
  const n = group.length;
  if (n === 0) return { v: 0, fronts: [] };
  const th = Math.atan(grad);
  const slope = Math.sin(th) + p.crr * Math.cos(th);
  const d = p.draftSaving, eta = p.eta;
  const rid = group.map((r) => ({ S: powerOf(r, p), Gf: (Number(r.w) + p.bikeMass) * GRAV * slope, cda: cdaOf(r) }));

  const caps = (v) => rid.map((r) => {
    const K = 0.5 * p.rho * v * v * r.cda;
    if (K * d <= 1e-9) return r.S * eta / v >= r.Gf ? 1 : -1; // aero negligible (climb / crawl)
    return (r.S * eta / v - r.Gf - K * (1 - d)) / (K * d);
  });
  const feasible = (v) => {
    const c = caps(v);
    if (c.some((x) => x < 0)) return false;
    return c.reduce((s, x) => s + Math.min(1, x), 0) >= 1;
  };
  const fronts = (v) => {
    const f = caps(v).map((x) => Math.min(1, Math.max(0, x)));
    const s = f.reduce((a, b) => a + b, 0) || 1;
    return f.map((x) => x / s);
  };

  let lo = 0.3, hi = p.descentCapKmh / 3.6;
  if (!feasible(lo)) return { v: 0.5, fronts: group.map(() => 1 / n) };
  if (feasible(hi)) return { v: hi, fronts: fronts(hi) };
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (feasible(m)) lo = m; else hi = m; }
  return { v: lo, fronts: fronts(lo) };
}

// Duration over a course + aero-weighted per-rider front share.
export function groupResult(group, segments, p) {
  const cap = p.descentCapKmh / 3.6;
  let t = 0, wsum = 0; const fw = group.map(() => 0);
  for (const s of segments) {
    const { v, fronts } = groupSpeed(group, s.grad, p);
    const vv = Math.min(cap, Math.max(0.5, v));
    const dt = s.dist / vv; t += dt;
    const w = vv * vv * dt; // weight the split by where aero (and so turns) matter
    fronts.forEach((f, i) => (fw[i] += f * w)); wsum += w;
  }
  return { dur: t, fronts: fw.map((x) => (wsum > 0 ? x / wsum : 1 / group.length)) };
}

export const soloDuration = (rider, segments, p) => groupResult([rider], segments, p).dur;

/* ---- ability grouping ----------------------------------------------------
   Group riders so each group takes even turns. Riders of similar solo pace on
   THIS course split the work evenly, so we rank by solo time and chunk into
   groups of `size` (contiguous 1-D partition is near-optimal for evenness).
   Slower riders land in the earlier groups, giving the handicap spread too. */
export function suggestGroups(poolIds, ridersById, segments, p, size) {
  const sz = Math.max(1, Math.min(8, size | 0));
  const ranked = [...poolIds].sort((a, b) =>
    soloDuration(ridersById[b], segments, p) - soloDuration(ridersById[a], segments, p)); // slowest first
  const groups = [];
  for (let i = 0; i < ranked.length; i += sz) groups.push(ranked.slice(i, i + sz));
  // a trailing group of 1 (when size>1) is left as "leftover" for the organiser to place
  let leftover = [];
  if (sz > 1 && groups.length && groups[groups.length - 1].length === 1) leftover = groups.pop();
  return { groups, leftover };
}

/* ---- Strava calibration --------------------------------------------------
   After a ride we know the actual moving time over (approximately) the course.
   Find the power multiplier k that makes the model reproduce that time, and
   store it on the rider so future predictions match their real form/aero. */
export function calibrationFactor(rider, segments, actualSeconds, p, prevK = 1) {
  const dur = (k) => groupResult([{ ...rider, calib: k }], segments, p).dur;
  // model time decreases as k rises → bisection on k
  let lo = 0.4, hi = 2.5;
  if (dur(hi) > actualSeconds) return hi; // even at max, model slower than actual
  if (dur(lo) < actualSeconds) return lo;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (dur(m) > actualSeconds) lo = m; else hi = m; }
  const k = (lo + hi) / 2;
  // light smoothing against the previous calibration to avoid one-ride swings
  return prevK ? 0.6 * k + 0.4 * prevK : k;
}

/* ---- shared defaults + course + start-sheet (used by server & clients) --- */
export const DEFAULT_PARAMS = { rho: 1.225, crr: 0.005, eta: 0.975, bikeMass: 8, draftSaving: 0.33, effort: 100, descentCapKmh: 70, climbGrad: 0.05 };

export function buildManualCourse(km, ascentM, climbGrad = 0.05) {
  const distanceM = Math.max(1, km * 1000), asc = Math.max(0, Number(ascentM));
  if (asc < 1) return { segments: [{ dist: distanceM, grad: 0 }], distanceM, ascentM: 0, name: "Manual course" };
  const dUp = Math.min(distanceM * 0.45, asc / climbGrad), gUp = asc / dUp, flat = Math.max(0, distanceM - 2 * dUp);
  const segments = [{ dist: dUp, grad: gUp }]; if (flat > 0) segments.push({ dist: flat, grad: 0 }); segments.push({ dist: dUp, grad: -gUp });
  return { segments, distanceM, ascentM: asc, name: "Manual course" };
}

export function evenness(fronts) {
  const n = fronts.length; if (n <= 1) return "Solo";
  const uni = 1 / n, tv = fronts.reduce((s, f) => s + Math.abs(f - uni), 0) / (2 * (1 - uni));
  return tv < 0.2 ? "Even" : tv < 0.5 ? "Fair" : "Uneven";
}

// groups: [{id, members:[riderId], locked}] ; ridersById: {id: rider}
export function computeSheet(groups, ridersById, segments, p) {
  const list = groups.map((g) => {
    const members = (g.members || []).map((id) => ridersById[id]).filter(Boolean);
    if (!members.length) return null;
    const { dur, fronts } = groupResult(members, segments, p);
    const wkg = members.reduce((s, r) => s + Number(r.ftp), 0) / members.reduce((s, r) => s + Number(r.w), 0);
    return { gid: g.id, locked: !!g.locked, wkg, dur,
      members: members.map((r, i) => ({ id: r.id, name: r.name, front: fronts[i], calib: r.calib || 1 })),
      quality: evenness(fronts) };
  }).filter(Boolean);
  if (!list.length) return { rows: [], tMax: 0, tMin: 0 };
  const tMax = Math.max(...list.map((x) => x.dur)), tMin = Math.min(...list.map((x) => x.dur));
  list.forEach((x) => (x.offset = tMax - x.dur));
  const rows = [...list].sort((a, b) => a.offset - b.offset).map((x, i) => ({ ...x, seed: i + 1 }));
  return { rows, tMax, tMin };
}
