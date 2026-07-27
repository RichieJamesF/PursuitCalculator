import { state, LS } from "./state.js";
import { render } from "./views.js";

export async function api(path, method = "GET", body, auth) {
  const headers = { "Content-Type": "application/json" };
  if (auth === "rider") headers["x-rider-token"] = state.riderKey;
  else if (auth) headers["x-organiser-token"] = state.token;
  const res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

export function syncWork() {
  const groups = (state.data?.groups || []).map((g) => ({ id: g.id, members: g.members.map(Number), locked: !!g.locked }));
  const inG = new Set(groups.flatMap((g) => g.members));
  const unassigned = (state.data?.riders || []).map((r) => r.id).filter((id) => !inG.has(id));
  state.work = { groups, unassigned }; state.sel = null;
}

export async function loadEvent() {
  if (!state.code) { state.mode = "landing"; render(); return; }
  if (saving) await new Promise((r) => { const t = setInterval(() => { if (!saving) { clearInterval(t); r(); } }, 20); });
  try { state.data = await api("/events/" + encodeURIComponent(state.code)); LS.setItem("pursuit:lastCode", state.code); syncWork(); state.mode = "app"; }
  catch { state.data = null; state.mode = "landing"; state.banner = "Couldn't find event “" + state.code + "”. Check the code, or create a new event."; }
  render();
}

export const setSaveStatus = (t) => { state.saveStatus = t; const s = document.getElementById("savestatus"); if (s) s.textContent = t; };
let saving = false, saveAgain = false;
export async function persistGroups() {
  if (!state.token) return;
  if (saving) { saveAgain = true; return; }            // coalesce rapid edits, always end on latest state
  saving = true; setSaveStatus("Saving…");
  try { await api("/events/" + state.code + "/groups", "PUT", { groups: state.work.groups }, true); setSaveStatus("Saved"); }
  catch (e) { setSaveStatus("Save failed: " + e.message); }
  saving = false;
  if (saveAgain) { saveAgain = false; persistGroups(); }
}

export function savedEvents() {
  const out = [];
  for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith("pursuit:token:")) out.push(k.slice("pursuit:token:".length)); }
  return out;
}
