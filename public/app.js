/* The Pursuit — organiser + rider-signup frontend. Talks to the API; the
   server runs the shared engine, so results match the standalone app. */
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
  banner: params.get("stravalinked") ? "Strava linked — hit Refine after the ride." : params.get("stravaerror") ? "Strava linking failed." : "",
};
if (state.code) state.token = LS.getItem("pursuit:token:" + state.code) || "";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDur = (s) => { if (!Number.isFinite(s)) return "—"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
const fmtGap = (s) => { s = Math.round(s); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const addClock = (hhmm, secs) => { const [h, m] = (hhmm || "09:30").split(":").map(Number); const t = h * 3600 + m * 60 + Math.round(secs); return `${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

async function api(path, method = "GET", body, withToken) {
  const headers = { "Content-Type": "application/json" };
  if (withToken) headers["x-organiser-token"] = state.token;
  const res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function loadEvent() {
  if (!state.code) { render(); return; }
  try { state.data = await api("/events/" + encodeURIComponent(state.code)); LS.setItem("pursuit:lastCode", state.code); }
  catch { state.data = null; state.banner = "No event with that code yet — create it below."; }
  render();
}

/* ---- actions ------------------------------------------------------------- */
async function createEvent(name, code) {
  try { const r = await api("/events", "POST", { name, code }); state.code = r.event.code; state.token = r.organiserToken; LS.setItem("pursuit:token:" + state.code, r.organiserToken); state.data = r; state.banner = "Event created — save your organiser key below."; render(); }
  catch (e) { alert(e.message); }
}
const patchEvent = (body) => api("/events/" + state.code, "PATCH", body, true).then((d) => { state.data = d; render(); }).catch((e) => alert(e.message));
const addRider = (r) => api("/events/" + state.code + "/riders", "POST", r).then(loadEvent).catch((e) => alert(e.message));
const updRider = (id, body) => api("/riders/" + id, "PATCH", body, true).then(loadEvent).catch((e) => alert(e.message));
const delRider = (id) => api("/riders/" + id, "DELETE", null, true).then(loadEvent).catch((e) => alert(e.message));
const suggest = (size) => api("/events/" + state.code + "/suggest", "POST", { size }, true).then((d) => { state.data = d; if (d.leftover?.length) state.banner = "One rider left over — assign them by editing groups."; render(); }).catch((e) => alert(e.message));
async function refine(id) {
  state.banner = "Checking Strava…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", null, true); state.banner = r.matched ? `Refined from “${r.activity}” (${r.distanceKm} km): effective FTP ${r.effectiveFtp} W (×${r.calib}).` : r.message; await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}

function exportCSV() {
  const s = state.data.sheet; if (!s.rows.length) return;
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const head = ["Seed", "Group", "Riders", "W/kg", "Est", "Gap", "Off gun", "Turn split"];
  const rows = s.rows.map((r) => [r.seed, r.members.length + "-up", r.members.map((m) => m.name).join(" · "), r.wkg.toFixed(2), fmtDur(r.dur), r.offset < 0.5 ? "scratch" : fmtGap(r.offset), addClock(state.data.event.firstStart, r.offset), r.members.map((m) => `${m.name} ${Math.round(m.front * 100)}%`).join(" / ")]);
  const csv = [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = state.code + "-start-sheet.csv"; a.click(); URL.revokeObjectURL(a.href);
}

/* ---- render -------------------------------------------------------------- */
function render() {
  if (state.signup) return renderSignup();
  const d = state.data, ev = d?.event;
  const origin = location.origin;
  const km = ev?.course ? (ev.course.distanceM / 1000).toFixed(1) : "—", asc = ev?.course ? Math.round(ev.course.ascentM) : "—";
  app.innerHTML = `
    <div class="mast"><div class="rule"></div>
      <div class="mast-row">
        <div><span class="kicker">Group handicap · start sheet</span><h1>THE PURSUIT</h1></div>
        <div class="meta"><div><span>Event</span><b>${esc(state.code || "—")}</b></div><div><span>Riders</span><b>${d?.riders.length ?? "—"}</b></div><div><span>Distance</span><b>${km} km</b></div></div>
      </div><div class="rule"></div>
    </div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="grid">
      <div class="col" id="left"></div>
      <div class="col" id="right"></div>
    </div>
    <div class="foot">Theoretical times — a planning aid, not a promise. Tune the assumptions to your roads and riders.</div>`;

  const left = document.getElementById("left"), right = document.getElementById("right");

  // Event panel
  const evPanel = el(`<div class="panel"><div class="panel-hd"><h2>Event</h2></div>
    <div class="row"><input id="code" placeholder="event-code" value="${esc(state.code)}" style="flex:1"/><button class="add" id="open">Open</button></div>
    <div class="two" style="margin-top:10px"><input id="newname" placeholder="Event name"/><button class="btn" id="create">Create new</button></div>
    ${state.token ? `<div class="tokenbox">Organiser key (keep it — it's how you edit this event):<br><code>${esc(state.token)}</code></div>` : d && !state.token ? `<div class="row" style="margin-top:10px"><input id="paste-token" placeholder="Paste organiser key to edit" style="flex:1"/><button class="add" id="settoken">Use key</button></div>` : ""}
  </div>`);
  left.appendChild(evPanel);
  evPanel.querySelector("#open").onclick = () => { state.code = evPanel.querySelector("#code").value.trim().toLowerCase(); state.token = LS.getItem("pursuit:token:" + state.code) || ""; loadEvent(); };
  evPanel.querySelector("#create").onclick = () => createEvent(evPanel.querySelector("#newname").value || "Pursuit", evPanel.querySelector("#code").value);
  const st = evPanel.querySelector("#settoken"); if (st) st.onclick = () => { state.token = evPanel.querySelector("#paste-token").value.trim(); LS.setItem("pursuit:token:" + state.code, state.token); render(); };

  if (!d) return;
  const canEdit = !!state.token;

  // Course panel
  const cs = el(`<div class="panel"><div class="panel-hd"><h2>Course</h2></div>
    <div class="two"><label class="f">Distance (km)<input type="number" id="km" value="${ev.course ? (ev.course.distanceM / 1000).toFixed(1) : 45}"/></label><label class="f">Total ascent (m)<input type="number" id="asc" value="${ev.course ? Math.round(ev.course.ascentM) : 500}"/></label></div>
    <div class="row" style="margin-top:10px"><button class="add" id="savecourse" ${canEdit ? "" : "disabled"}>Save course</button><span class="hint">${km} km · ${asc} m ascent (assumes a loop)</span></div>
    <p class="micro">GPX/FIT upload can be added by parsing in the browser and posting the profile — manual works for most club courses.</p></div>`);
  left.appendChild(cs);
  cs.querySelector("#savecourse").onclick = () => patchEvent({ courseManual: { km: cs.querySelector("#km").value, ascent: cs.querySelector("#asc").value } });

  // Riders panel
  const rp = el(`<div class="panel"><div class="panel-hd"><h2>Riders</h2><button class="add" id="addr" ${canEdit ? "" : "disabled"}>+ Rider</button></div>
    <div class="linkbox"><input readonly value="${origin}/?code=${encodeURIComponent(state.code)}&signup=1"/><button class="ghost" id="copylink">Copy sign-up link</button></div>
    <p class="hint">Share that link; riders add themselves and appear here.</p>
    <div id="rlist" style="margin-top:10px"></div></div>`);
  left.appendChild(rp);
  rp.querySelector("#copylink").onclick = () => navigator.clipboard?.writeText(`${origin}/?code=${state.code}&signup=1`);
  rp.querySelector("#addr").onclick = () => addRider({ name: "New rider", w: 75, ftp: 240, pos: "road_drops", build: "medium" });
  const rlist = rp.querySelector("#rlist");
  if (!d.riders.length) rlist.innerHTML = `<p class="empty">No riders yet.</p>`;
  d.riders.forEach((r) => rlist.appendChild(riderRow(r, canEdit)));

  // Groups + sheet
  const gp = el(`<div class="panel"><div class="panel-hd"><h2>Pursuit groups</h2>
      <div class="row"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Size<span class="stepper"><button id="dec">−</button><b id="gs">${ev.groupSize}</b><button id="inc">+</button></span></label><button class="btn" id="suggest" ${canEdit ? "" : "disabled"}>Suggest</button></div>
    </div><p class="hint">Tiers riders by ability so each group shares the work, then seeds the start gaps.</p></div>`);
  right.appendChild(gp);
  let size = ev.groupSize;
  const gsEl = gp.querySelector("#gs");
  gp.querySelector("#dec").onclick = () => { size = Math.max(1, size - 1); gsEl.textContent = size; };
  gp.querySelector("#inc").onclick = () => { size = Math.min(8, size + 1); gsEl.textContent = size; };
  gp.querySelector("#suggest").onclick = () => suggest(size);

  right.appendChild(boardEl(d, canEdit));
}

function riderRow(r, canEdit) {
  const wkg = (r.ftp / (r.w + 8)).toFixed(2);
  const row = el(`<div class="rr">
    <input class="rr-name" value="${esc(r.name)}" ${canEdit ? "" : "disabled"}/>
    <div class="rr-ctrl">
      <input type="number" class="w" value="${r.w}" ${canEdit ? "" : "disabled"}/><input type="number" class="ftp" value="${r.ftp}" ${canEdit ? "" : "disabled"}/>
      <select class="pos" ${canEdit ? "" : "disabled"}>${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === r.pos ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select class="build" ${canEdit ? "" : "disabled"}>${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === r.build ? "selected" : ""}>${v}</option>`).join("")}</select>
      ${canEdit ? `<button class="del" title="Remove">×</button>` : ""}
    </div>
    <div class="rr-tools"><span class="pill ${r.strava ? "on" : "off"}">${r.strava ? "Strava linked" : "No Strava"}</span>
      <span class="micro">${wkg} W/kg${r.calib && r.calib !== 1 ? ` · cal ×${r.calib.toFixed(2)}` : ""}</span>
      ${canEdit ? `<a class="ghost" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${r.id}">${r.strava ? "Re-link" : "Link Strava"}</a>` : ""}
      ${canEdit && r.strava ? `<button class="ghost refine">Refine</button>` : ""}
    </div></div>`);
  if (canEdit) {
    const save = () => updRider(r.id, { name: row.querySelector(".rr-name").value, w: +row.querySelector(".w").value, ftp: +row.querySelector(".ftp").value, pos: row.querySelector(".pos").value, build: row.querySelector(".build").value });
    row.querySelector(".rr-name").onblur = save;
    row.querySelectorAll(".w,.ftp,.pos,.build").forEach((i) => (i.onchange = save));
    row.querySelector(".del").onclick = () => confirm(`Remove ${r.name}?`) && delRider(r.id);
    const rf = row.querySelector(".refine"); if (rf) rf.onclick = () => refine(r.id);
  }
  return row;
}

function boardEl(d, canEdit) {
  const s = d.sheet, ev = d.event;
  const b = el(`<div class="board">
    <div class="printhead"><b>${esc(ev.name)}</b><span>${esc(state.code)} · ${ev.course ? (ev.course.distanceM / 1000).toFixed(1) : "—"} km · first gun ${esc(ev.firstStart)}</span></div>
    <div class="board-hd"><div><span class="kicker">Start sheet</span><h2>Roll-off order</h2></div>
      <div><label class="gun">First gun<input type="time" id="gun" value="${esc(ev.firstStart)}" ${canEdit ? "" : "disabled"}/></label>${s.rows.length ? `<div class="exports"><button class="ghost light" id="csv">CSV</button><button class="ghost light" id="print">Print</button></div>` : ""}</div>
    </div>
    ${s.rows.length ? `<div class="conv"><span>Predicted catch</span><b>${fmtDur(s.tMax)}</b><span>after first gun · window ${fmtDur(s.tMax - s.tMin)}</span></div>
      <table><thead><tr><th>Seed</th><th>Group</th><th class="num">W/kg</th><th class="num">Est.</th><th class="num">Gap</th><th class="num">Off gun</th></tr></thead><tbody>
      ${s.rows.map((r) => `<tr><td class="seed">${r.seed}</td>
        <td class="grp"><b>${r.members.map((m) => esc(m.name)).join(" · ")}<span class="quality q-${r.quality.toLowerCase()}">${r.quality}</span></b>
          <div class="turnbar">${r.members.map((m, i) => `<span style="width:${(m.front * 100).toFixed(1)}%;background:${SHADES[i % SHADES.length]}"></span>`).join("")}</div></td>
        <td class="num">${r.wkg.toFixed(2)}</td><td class="num">${fmtDur(r.dur)}</td><td class="num gap">${r.offset < 0.5 ? "scratch" : fmtGap(r.offset)}</td><td class="num">${addClock(ev.firstStart, r.offset)}</td></tr>`).join("")}
      </tbody></table>
      <p class="note">Seed 1 rolls off at the gun; each faster group leaves on its gap so all converge at the catch. The bar shows each rider's share of the front.</p>`
      : `<p class="empty">Add riders and hit Suggest to seed the start times.</p>`}
  </div>`);
  const gun = b.querySelector("#gun"); if (gun && canEdit) gun.onchange = () => patchEvent({ firstStart: gun.value });
  const csv = b.querySelector("#csv"); if (csv) csv.onclick = exportCSV;
  const pr = b.querySelector("#print"); if (pr) pr.onclick = () => window.print();
  return b;
}

/* ---- rider self sign-up -------------------------------------------------- */
function renderSignup() {
  const f = { name: "", w: 75, ftp: 240, pos: "road_drops", build: "medium" };
  app.innerHTML = `<div class="center">
    <a class="ghost" href="/?code=${encodeURIComponent(state.code)}" style="align-self:flex-start">‹ Organiser view</a>
    <span class="kicker">Rider sign-up</span><h1 class="su-title">ADD YOUR DETAILS</h1>
    <label class="f">Event code<input id="code" value="${esc(state.code)}"/></label>
    <label class="f">Name<input id="name" placeholder="Your name"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="w" value="75"/></label><label class="f">FTP (W)<input type="number" id="ftp" value="240"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label></div>
    <p class="micro">Not sure of your FTP? Your best hour-power guess is fine.</p>
    <button class="btn block" id="send">Send to organiser</button><p class="hint" id="status"></p>
  </div>`;
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

function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }

loadEvent();
