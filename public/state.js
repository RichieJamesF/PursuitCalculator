export const POSITIONS = { road_hoods: "Road · hoods", road_drops: "Road · drops", aero_drops: "Aero road · drops", clipon: "Clip-on aero bars", tt: "TT / Tri bike" };
export const BUILDS = { small: "Small", medium: "Medium", tall: "Tall" };
export const SHADES = ["#ff2f74", "#c8134f", "#ff6f9e", "#8f0d3a", "#ff9dbe", "#e84d86", "#5c0a26", "#ffc2d6"];
export const app = document.getElementById("app");
export const params = new URLSearchParams(location.search);
export const LS = window.localStorage;

export const riderKeyLS = (code, id) => `pursuit:riderkey:${code}:${id}`;

const startCode = params.get("code") || LS.getItem("pursuit:lastCode") || "";
const qRider = params.get("rider"), qKey = params.get("key");
const riderId = qRider && /^\d+$/.test(qRider) ? Number(qRider) : null;

// A rider arriving on their own link carries their key in the URL; remember it so
// the same device recognises them next time without the link.
let riderKey = "";
if (startCode && riderId) {
  riderKey = qKey || LS.getItem(riderKeyLS(startCode, riderId)) || "";
  if (qKey) LS.setItem(riderKeyLS(startCode, riderId), qKey);
}

export const state = {
  code: startCode,
  token: "",
  riderId,
  riderKey,
  signup: params.get("signup") === "1",
  data: null,
  work: { groups: [], unassigned: [] },
  sel: null,
  saveStatus: "",
  ridePicker: null,
  mode: riderId && riderKey ? "rider" : (startCode ? "app" : "landing"),
  justCreated: null,
  justSignedUp: null,
  banner: params.get("stravalinked") ? "Strava linked — you can refine your FTP now." : params.get("stravaerror") ? "Strava linking failed." : "",
};
if (state.code) state.token = LS.getItem("pursuit:token:" + state.code) || "";

export const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

export const ridersById = () => Object.fromEntries((state.data?.riders || []).map((r) => [r.id, { id: r.id, name: r.name, w: r.w, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
export const paramsOf = () => state.data?.event?.params || {};
export const segments = () => state.data?.event?.course?.segments;
