export const POSITIONS = { road_hoods: "Road · hoods", road_drops: "Road · drops", aero_drops: "Aero road · drops", clipon: "Clip-on aero bars", tt: "TT / Tri bike" };
export const BUILDS = { small: "Small", medium: "Medium", tall: "Tall" };
export const SHADES = ["#ff2f74", "#c8134f", "#ff6f9e", "#8f0d3a", "#ff9dbe", "#e84d86", "#5c0a26", "#ffc2d6"];
export const app = document.getElementById("app");
export const params = new URLSearchParams(location.search);
export const LS = window.localStorage;

export const riderKeyLS = (code, id) => `pursuit:riderkey:${code}:${id}`;
export const riderIdLS = (code) => `pursuit:riderid:${code}`;

const startCode = params.get("code") || LS.getItem("pursuit:lastCode") || "";
const qRider = params.get("rider"), qKey = params.get("key");
const storedRider = startCode ? LS.getItem(riderIdLS(startCode)) : null;
// The rider id can arrive in the URL (sign-up link, own rider link) or, absent that,
// from what we remembered last time on this device.
const riderId = qRider && /^\d+$/.test(qRider) ? Number(qRider)
  : storedRider && /^\d+$/.test(storedRider) ? Number(storedRider) : null;

// A rider arriving on their own link carries their key in the URL; remember both the
// key and the id so the same device recognises them next time without either.
let riderKey = "";
if (startCode && riderId !== null) {
  riderKey = qKey || LS.getItem(riderKeyLS(startCode, riderId)) || "";
  if (qKey) { LS.setItem(riderKeyLS(startCode, riderId), qKey); LS.setItem(riderIdLS(startCode), String(riderId)); }
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
  mode: riderId !== null && riderKey ? "rider" : (startCode ? "app" : "landing"),
  justCreated: null,
  justSignedUp: null,
  banner: "",
};
if (state.code) state.token = LS.getItem("pursuit:token:" + state.code) || "";

export const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

export const ridersById = () => Object.fromEntries((state.data?.riders || []).map((r) => [r.id, { id: r.id, name: r.name, w: r.w, ftp: r.ftp, pos: r.pos, build: r.build }]));
export const paramsOf = () => state.data?.event?.params || {};
export const segments = () => state.data?.event?.course?.segments;
