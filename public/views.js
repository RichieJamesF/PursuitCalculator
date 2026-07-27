import { cdaOf } from "/engine.mjs";
import { state, app, POSITIONS, BUILDS, SHADES, el, ridersById, LS } from "./state.js";
import { esc, fmtDur, fmtGap, addClock } from "./format.js";
import { toLanding, detailsMailto, copyDetails, createEvent, openExisting, patchEvent, addRider, updRider, delRider, openRidePicker, autoRefine, applyRefine, origin, signUp, riderLink, riderMailto, copyRiderDetails, openRiderPage, updRiderSelf } from "./actions.js";
import { api, savedEvents } from "./api.js";
import { suggestLocal, clearGroups, newGroup, moveTo, toggleLock, breakGroup, goSolo, joinBest, onPick, localSheet, exportCSV } from "./grouping.js";
import { parseCourseFile } from "./course.js";

/* ---- render -------------------------------------------------------------- */
export function render() {
  if (state.signup) return renderSignup();
  if (state.mode === "rider" && state.data) return renderRiderPage();
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
    <div class="foot">Theoretical times — a planning aid, not a promise.</div>`;
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
    const bench = el(`<div class="benchbox"><div class="bench-hd">Unassigned riders</div>
      <p class="hint">Left over from the groups? Start them solo, or drop them into the best-matched group.</p>
      ${state.sel != null && canEdit ? `<div style="margin:8px 0"><button class="movein" id="benchhere">＋ move selected here</button></div>` : ""}
      <div class="bench" id="benchrow"></div></div>`);
    const row = bench.querySelector("#benchrow");
    const bh = bench.querySelector("#benchhere"); if (bh) bh.onclick = () => moveTo(state.sel, "unassigned");
    state.work.unassigned.forEach((id) => {
      const r = ridersById()[id]; if (!r) return;
      const item = el(`<div class="benchrider"></div>`);
      item.appendChild(chip(r, false));
      if (canEdit) {
        const solo = el(`<button class="ghost mini" title="Start as a one-rider pursuit">Go solo</button>`); solo.onclick = () => goSolo(id);
        const join = el(`<button class="ghost mini" title="Add to the group closest in ability">Join best group</button>`); join.onclick = () => joinBest(id);
        item.appendChild(solo); item.appendChild(join);
      }
      row.appendChild(item);
    });
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
        <p class="hint gate-lead">You'll get an organiser key — the one thing you need to manage it later.</p>
        <label class="f">Event name<input id="c-name" placeholder="e.g. Condors Summer Pursuit"/></label>
        <label class="f">Custom code <span class="opt">optional</span><input id="c-code" placeholder="auto if left blank"/></label>
        <button class="btn block" id="create">Create event</button>
      </div>
      <div class="gate-card alt">
        <span class="gate-kick">Coming back</span><h2>Open an existing event</h2>
        <p class="hint gate-lead">Enter the code. Add the organiser key to make changes, or leave it blank to just view.</p>
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

/* ---- rider self-service -------------------------------------------------- */
function renderRiderPage() {
  const me = (state.data.riders || []).find((r) => r.id === state.riderId);
  if (!me) {
    app.innerHTML = `<div class="center"><span class="kicker">Rider</span><h1 class="su-title">NOT FOUND</h1>
      <p class="hint">You're not on the rider list for “${esc(state.code)}” any more — the organiser may have removed you. Sign up again with the link they sent you.</p>
      <a class="btn" href="/?code=${encodeURIComponent(state.code)}&signup=1">Sign up again</a></div>`;
    return;
  }
  const ev = state.data.event;
  const km = ev?.course ? (ev.course.distanceM / 1000).toFixed(1) : "—";
  const mine = state.data.sheet?.rows?.find((row) => row.members.some((m) => m.id === me.id));
  const wkg = (me.ftp / (me.w + 8)).toFixed(2);

  app.innerHTML = `
    <div class="mast"><div class="rule"></div>
      <div class="mast-row">
        <div><span class="kicker">Your details</span><h1>THE PURSUIT</h1></div>
        <div class="meta"><div><span>Event</span><b>${esc(ev.name)}</b></div><div><span>Distance</span><b>${km} km</b></div><div><span>W/kg</span><b>${wkg}</b></div></div>
      </div><div class="rule"></div>
    </div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="grid"><div class="col" id="left"></div><div class="col" id="right"></div></div>
    <div class="foot">Theoretical times — a planning aid, not a promise.</div>`;
  const left = document.getElementById("left"), right = document.getElementById("right");

  const card = el(`<div class="panel"><div class="panel-hd"><h2>${esc(me.name)}</h2></div>
    <p class="hint">Change anything here and it updates the start sheet straight away. Only you and your organiser can edit this.</p>
    <p class="err" id="rerr" style="display:none"></p>
    <label class="f">Name<input id="r-name" value="${esc(me.name)}"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="r-w" value="${me.w}"/></label>
      <label class="f">FTP (W)<input type="number" id="r-ftp" value="${me.ftp}"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="r-pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === me.pos ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="r-build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === me.build ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
    <p class="micro">Weight is you plus kit; the model adds 8 kg for the bike.</p>
  </div>`);
  const nameI = card.querySelector("#r-name"), wI = card.querySelector("#r-w"), ftpI = card.querySelector("#r-ftp"), rerr = card.querySelector("#rerr");
  const showErr = (msg) => { rerr.textContent = msg; rerr.style.display = "block"; };
  // Guard against blanks/typos before they ever reach the server: a rider self-editing has no
  // one watching over their shoulder the way an organiser editing riderRow does.
  const save = () => {
    const name = nameI.value.trim(), w = +wI.value, ftp = +ftpI.value;
    if (!name) { showErr("Add your name — it can't be blank."); nameI.value = me.name; return; }
    if (!Number.isFinite(w) || w <= 30) { showErr("That weight doesn't look right — enter your weight in kg."); wI.value = me.w; return; }
    if (!Number.isFinite(ftp) || ftp <= 50) { showErr("That FTP doesn't look right — enter your FTP in watts."); ftpI.value = me.ftp; return; }
    rerr.style.display = "none";
    updRiderSelf(me.id, { name, w, ftp, pos: card.querySelector("#r-pos").value, build: card.querySelector("#r-build").value });
  };
  nameI.onblur = save;
  card.querySelectorAll("#r-w,#r-ftp,#r-pos,#r-build").forEach((i) => (i.onchange = save));
  left.appendChild(card);

  const sv = el(`<div class="panel"><div class="panel-hd"><h2>FTP from Strava</h2></div>
    <p class="hint">${me.strava
      ? "Linked. Pick a recent hard ride and we'll read your FTP off its power data — no typing, no guessing."
      : "Link Strava once, then your FTP can come straight off a recent hard ride instead of a guess."}</p>
    <div class="row">
      <a class="add" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${me.id}&key=${encodeURIComponent(state.riderKey)}">${me.strava ? "Re-link Strava" : "Link Strava"}</a>
      ${me.strava ? `<button class="btn" id="r-refine">Update my FTP from a ride</button>` : ""}
    </div>
    ${me.lastRefined ? `<p class="micro">Last updated from Strava on ${esc(new Date(me.lastRefined).toLocaleDateString())}.</p>` : ""}
  </div>`);
  const rb = sv.querySelector("#r-refine"); if (rb) rb.onclick = () => openRidePicker(me.id, "rider");
  left.appendChild(sv);

  const start = el(`<div class="panel"><div class="panel-hd"><h2>Your start</h2></div>
    ${mine
      ? `<div class="cr-field"><span>Your group</span><code>${mine.members.map((m) => esc(m.name)).join(" · ")}</code></div>
         <div class="cr-field"><span>Rolls off at</span><code>${addClock(ev.firstStart, mine.offset)}</code></div>
         <div class="cr-field"><span>Predicted time</span><code>${fmtDur(mine.dur)}</code></div>
         <p class="micro">Seed ${mine.seed} of ${state.data.sheet.rows.length} · your share of the front is about ${Math.round((mine.members.find((m) => m.id === me.id)?.front || 0) * 100)}%.</p>`
      : `<p class="empty">Your organiser hasn't put you in a group yet. Check back once they've set the groups.</p>`}
    <p class="hint" style="margin-top:10px">Keep your rider link safe — it's how you get back in from another device.</p>
    <div class="cr-field"><span>Your rider page</span><input readonly value="${riderLink(state.code, me.id, state.riderKey)}"/></div>
  </div>`);
  right.appendChild(start);

  if (state.ridePicker) app.appendChild(ridePickerEl());
}

/* ---- rider self sign-up -------------------------------------------------- */
function renderSignup() {
  if (state.justSignedUp) return renderSignedUp();
  app.innerHTML = `<div class="center">
    <a class="ghost" href="/?code=${encodeURIComponent(state.code)}" style="align-self:flex-start">‹ Organiser view</a>
    <span class="kicker">Rider sign-up</span><h1 class="su-title">ADD YOUR DETAILS</h1>
    <label class="f">Event code<input id="code" value="${esc(state.code)}"/></label>
    <label class="f">Name<input id="name" placeholder="Your name"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="w" value="75"/></label><label class="f">FTP (W)<input type="number" id="ftp" value="240"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === "road_drops" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === "medium" ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
    <p class="micro">Not sure of your FTP? Your best hour-power guess is fine — you can fix it later, or read it off a Strava ride.</p>
    <button class="btn block" id="send">Send to organiser</button><p class="hint" id="status"></p></div>`;
  document.getElementById("send").onclick = async () => {
    const code = document.getElementById("code").value.trim().toLowerCase();
    const body = { name: document.getElementById("name").value, w: +document.getElementById("w").value, ftp: +document.getElementById("ftp").value, pos: document.getElementById("pos").value, build: document.getElementById("build").value };
    const status = document.getElementById("status");
    if (!body.name.trim()) { status.textContent = "Add your name first."; return; }
    status.textContent = "Sending…";
    try { await signUp(code, body); }
    catch (e) { status.textContent = e.message; }
  };
}

function renderSignedUp() {
  const { name, id, code, key } = state.justSignedUp;
  app.innerHTML = `<div class="landing"><div class="rule"></div>
    <div class="land-head"><span class="kicker" style="color:#1f7a4d">You're in</span><h1>${esc(name)}</h1></div>
    <div class="rule"></div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="created">
      <p class="hint">This link is yours. Open it any time to change your details, link Strava, or set your FTP from a ride — no need to bother the organiser.</p>
      <div class="cr-field"><span>Your rider page</span><input readonly value="${riderLink(code, id, key)}"/></div>
      <div class="row" style="margin:6px 0 4px"><a class="btn" id="email">✉ Email me my link</a><button class="add" id="copy">Copy my link</button></div>
      <p class="micro">This device will remember you automatically. Save the link if you might use a different phone or computer — there's no way to look it up later.</p>
      <button class="btn block" id="go" style="margin-top:12px">Open my rider page ›</button>
    </div>
    <p class="land-foot">Your organiser can see you in the rider list now.</p>
  </div>`;
  document.getElementById("email").href = riderMailto(name, code, id, key);
  document.getElementById("copy").onclick = () => copyRiderDetails(name, code, id, key);
  document.getElementById("go").onclick = openRiderPage;
}
