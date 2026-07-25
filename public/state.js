export const POSITIONS = { road_hoods: "Road · hoods", road_drops: "Road · drops", aero_drops: "Aero road · drops", clipon: "Clip-on aero bars", tt: "TT / Tri bike" };
export const BUILDS = { small: "Small", medium: "Medium", tall: "Tall" };
export const SHADES = ["#ff2f74", "#c8134f", "#ff6f9e", "#8f0d3a", "#ff9dbe", "#e84d86", "#5c0a26", "#ffc2d6"];
export const app = document.getElementById("app");
export const params = new URLSearchParams(location.search);
export const LS = window.localStorage;

export const state = {
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

export const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

export const ridersById = () => Object.fromEntries((state.data?.riders || []).map((r) => [r.id, { id: r.id, name: r.name, w: r.w, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
export const paramsOf = () => state.data?.event?.params || {};
export const segments = () => state.data?.event?.course?.segments;
