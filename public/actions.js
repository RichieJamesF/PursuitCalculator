import { state, LS, riderKeyLS } from "./state.js";
import { api, loadEvent, syncWork } from "./api.js";
import { render } from "./views.js";

export async function createEvent(name, code) {
  try {
    const r = await api("/events", "POST", { name, code });
    state.code = r.event.code; state.token = r.organiserToken;
    LS.setItem("pursuit:token:" + state.code, r.organiserToken);
    state.data = r; syncWork();
    state.justCreated = { code: r.event.code, token: r.organiserToken, name: r.event.name };
    state.mode = "landing"; state.banner = ""; render();
  } catch (e) { alert(e.message); }
}

export function openExisting(code, key) {
  code = (code || "").trim().toLowerCase();
  if (!code) { state.banner = "Enter an event code."; render(); return; }
  state.code = code;
  if (key && key.trim()) { state.token = key.trim(); LS.setItem("pursuit:token:" + code, state.token); }
  else state.token = LS.getItem("pursuit:token:" + code) || "";
  state.banner = ""; loadEvent();
}

export function toLanding() { state.mode = "landing"; state.justCreated = null; state.ridePicker = null; render(); }

export const origin = () => location.origin;

export function detailsMailto(code, token, name) {
  const body = `Your Pursuit event details — keep the organiser key safe, it's the only way to edit this event.\n\n`
    + `Event: ${name}\nCode: ${code}\nOrganiser key: ${token}\n\n`
    + `Manage the event: ${origin()}/?code=${encodeURIComponent(code)}\n`
    + `Rider sign-up link (share this): ${origin()}/?code=${encodeURIComponent(code)}&signup=1\n`;
  return `mailto:?subject=${encodeURIComponent(`Pursuit event: ${name} (${code})`)}&body=${encodeURIComponent(body)}`;
}

export function copyDetails(code, token, name) {
  const text = `Pursuit event: ${name}\nCode: ${code}\nOrganiser key: ${token}\nManage: ${origin()}/?code=${code}\nSign-up: ${origin()}/?code=${code}&signup=1`;
  navigator.clipboard?.writeText(text); state.banner = "Event details copied to the clipboard."; render();
}

export const patchEvent = (body) => api("/events/" + state.code, "PATCH", body, true).then(() => loadEvent()).catch((e) => alert(e.message));
export const addRider = (r) => api("/events/" + state.code + "/riders", "POST", r).then(loadEvent).catch((e) => alert(e.message));
export const updRider = (id, body) => api("/riders/" + id, "PATCH", body, true).then(loadEvent).catch((e) => alert(e.message));
export const delRider = (id) => api("/riders/" + id, "DELETE", null, true).then(loadEvent).catch((e) => alert(e.message));

export async function openRidePicker(id) {
  state.banner = "Loading recent rides…"; render();
  try { const r = await api("/riders/" + id + "/rides", "GET", null, true); state.ridePicker = { riderId: id, rides: r.rides, course: r.course, hideCommutes: true }; state.banner = ""; render(); }
  catch (e) { state.banner = e.message; render(); }
}

export function bannerFromRefine(r) {
  if (!r.matched) return r.message;
  if (r.mode === "power") return `Set FTP from “${r.activity}”: ${r.ftp} W${r.hadPower ? " (power meter)" : " (Strava estimate)"}. Calibration reset.`;
  return `Refined from “${r.activity}” (${r.distanceKm} km): effective FTP ${r.effectiveFtp} W (×${r.calib}).`;
}

export async function applyRefine(id, activityId, mode) {
  state.ridePicker = null; state.banner = "Applying…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { activityId, mode }, true); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}

export async function autoRefine(id) {
  state.ridePicker = null; state.banner = "Finding your fastest effort on the course…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { mode: "course" }, true); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}

export const riderLink = (code, id, key) =>
  `${origin()}/?code=${encodeURIComponent(code)}&rider=${id}&key=${encodeURIComponent(key)}`;

export function riderMailto(name, code, id, key) {
  const body = `Your rider link for this Pursuit event — open it any time to change your weight, FTP or bike, link Strava, or update your FTP from a ride.\n\n`
    + `Rider: ${name}\nEvent code: ${code}\nYour rider key: ${key}\n\n`
    + `Your rider page: ${riderLink(code, id, key)}\n\n`
    + `Keep this link. It's the only way back in from another device.\n`;
  return `mailto:?subject=${encodeURIComponent(`My Pursuit rider link (${code})`)}&body=${encodeURIComponent(body)}`;
}

export function copyRiderDetails(name, code, id, key) {
  const text = `Pursuit rider: ${name}\nEvent: ${code}\nRider key: ${key}\nMy rider page: ${riderLink(code, id, key)}`;
  navigator.clipboard?.writeText(text);
  state.banner = "Your rider link is copied — paste it somewhere safe.";
  render();
}

export async function signUp(code, body) {
  const r = await api("/events/" + encodeURIComponent(code) + "/riders", "POST", body);
  state.code = code;
  state.riderId = r.id;
  state.riderKey = r.riderKey;
  LS.setItem(riderKeyLS(code, r.id), r.riderKey);
  LS.setItem("pursuit:lastCode", code);
  state.justSignedUp = { name: r.name, id: r.id, code, key: r.riderKey };
  render();
}

export function openRiderPage() {
  state.signup = false;
  state.justSignedUp = null;
  state.mode = "rider";
  state.banner = "";
  loadEvent();
}
