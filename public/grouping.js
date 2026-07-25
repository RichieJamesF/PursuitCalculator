import { computeSheet, suggestGroups, soloDuration } from "/engine.mjs";
import { state, ridersById, paramsOf, segments } from "./state.js";
import { gid, fmtDur, fmtGap, addClock } from "./format.js";
import { persistGroups } from "./api.js";
import { render } from "./views.js";

export function locate(id) {
  for (const g of state.work.groups) { if (g.locked) continue; const i = g.members.indexOf(id); if (i >= 0) return { gid: g.id, i }; }
  const ui = state.work.unassigned.indexOf(id); if (ui >= 0) return { ui }; return null;
}

export function swap(x, y) {
  if (x === y) return; const lx = locate(x), ly = locate(y); if (!lx || !ly) return;
  const set = (l, id) => { if (l.ui != null) state.work.unassigned[l.ui] = id; else state.work.groups.find((g) => g.id === l.gid).members[l.i] = id; };
  set(lx, y); set(ly, x); state.sel = null; persistGroups(); render();
}

export function moveTo(id, target) {
  if (!locate(id)) return; // locked source
  state.work.groups = state.work.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }));
  state.work.unassigned = state.work.unassigned.filter((m) => m !== id);
  if (target === "unassigned") state.work.unassigned.push(id);
  else { const t = state.work.groups.find((g) => g.id === target); if (!t || t.locked) return; t.members.push(id); }
  state.work.groups = state.work.groups.filter((g) => g.members.length || g.locked);
  state.sel = null; persistGroups(); render();
}

export const toggleLock = (id) => { const g = state.work.groups.find((q) => q.id === id); if (g) g.locked = !g.locked; persistGroups(); render(); };
export const breakGroup = (id) => { const g = state.work.groups.find((q) => q.id === id); if (!g) return; state.work.unassigned.push(...g.members); state.work.groups = state.work.groups.filter((q) => q.id !== id); persistGroups(); render(); };
export const clearGroups = () => { const locked = state.work.groups.filter((g) => g.locked); const lockedIds = new Set(locked.flatMap((g) => g.members)); state.work.unassigned = (state.data.riders || []).map((r) => r.id).filter((id) => !lockedIds.has(id)); state.work.groups = locked; state.sel = null; persistGroups(); render(); };
export const newGroup = () => { state.work.groups.push({ id: gid(), members: [], locked: false }); persistGroups(); render(); };

export function goSolo(id) {
  state.work.groups = state.work.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== id) })).filter((g) => g.members.length || g.locked);
  state.work.unassigned = state.work.unassigned.filter((m) => m !== id);
  state.work.groups.push({ id: gid(), members: [id], locked: false });
  state.sel = null; state.banner = ""; persistGroups(); render();
}

export function joinBest(id) {
  const seg = segments(), byId = ridersById(), p = paramsOf();
  const cands = state.work.groups.filter((g) => !g.locked && g.members.length);
  if (!cands.length || !seg) return goSolo(id);
  const solo = soloDuration(byId[id], seg, p);
  let best = cands[0], diff = Infinity;
  for (const g of cands) {
    const avg = g.members.reduce((s, m) => s + soloDuration(byId[m], seg, p), 0) / g.members.length;
    const d = Math.abs(avg - solo); if (d < diff) { diff = d; best = g; }
  }
  moveTo(id, best.id);
}

export function suggestLocal(size) {
  const seg = segments(); if (!seg) { alert("Set a course first."); return; }
  const locked = state.work.groups.filter((g) => g.locked); const lockedIds = new Set(locked.flatMap((g) => g.members));
  const pool = state.data.riders.map((r) => r.id).filter((id) => !lockedIds.has(id));
  const { groups, leftover } = suggestGroups(pool, ridersById(), seg, paramsOf(), size);
  state.work.groups = [...locked, ...groups.map((m) => ({ id: gid(), members: m, locked: false }))];
  state.work.unassigned = leftover; state.sel = null;
  if (leftover.length) state.banner = "One rider didn't fill a group — start them solo or add them to the best-matched group below.";
  persistGroups(); render();
}

export const onPick = (id, locked) => { if (locked) return; if (state.sel == null) state.sel = id; else if (state.sel === id) state.sel = null; else return swap(state.sel, id); render(); };

export const localSheet = () => segments() ? computeSheet(state.work.groups, ridersById(), segments(), paramsOf()) : { rows: [], tMax: 0, tMin: 0 };

export function exportCSV(sheet) {
  if (!sheet.rows.length) return;
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const head = ["Seed", "Group", "Riders", "W/kg", "Est", "Gap", "Off gun", "Turn split"];
  const rows = sheet.rows.map((r) => [r.seed, r.members.length + "-up", r.members.map((m) => m.name).join(" · "), r.wkg.toFixed(2), fmtDur(r.dur), r.offset < 0.5 ? "scratch" : fmtGap(r.offset), addClock(state.data.event.firstStart, r.offset), r.members.map((m) => `${m.name} ${Math.round(m.front * 100)}%`).join(" / ")]);
  const csv = [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = state.code + "-start-sheet.csv"; a.click(); URL.revokeObjectURL(a.href);
}
