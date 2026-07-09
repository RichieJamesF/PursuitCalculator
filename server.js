import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q, initDb } from "./db.js";
import { DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet, calibrationFactor } from "./lib/engine.mjs";
import { authUrl, exchange, refresh, recentActivities, matchByDistance } from "./lib/strava.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const token = () => crypto.randomBytes(16).toString("hex");
const genCode = () => "ride-" + crypto.randomBytes(3).toString("hex");
const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

/* ---- helpers ------------------------------------------------------------- */
async function getEvent(code) {
  const { rows } = await q("SELECT * FROM events WHERE code=$1", [code]);
  return rows[0] || null;
}
async function getRiders(eventId) {
  const { rows } = await q("SELECT * FROM riders WHERE event_id=$1 ORDER BY id", [eventId]);
  return rows;
}
const publicRider = (r) => ({ id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib, strava: !!r.strava_athlete_id, lastRefined: r.last_refined_at });
const paramsOf = (ev) => ({ ...DEFAULT_PARAMS, ...(ev.params_json || {}) });

function requireOrg(ev, req, res) {
  const t = req.get("x-organiser-token");
  if (!ev) { res.status(404).json({ error: "No event with that code." }); return false; }
  if (!t || t !== ev.organiser_token) { res.status(403).json({ error: "Organiser token required." }); return false; }
  return true;
}

async function eventPayload(ev) {
  const riders = await getRiders(ev.id);
  const byId = Object.fromEntries(riders.map((r) => [r.id, { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
  const groups = ev.groups_json || [];
  const sheet = ev.course_json ? computeSheet(groups, byId, ev.course_json.segments, paramsOf(ev)) : { rows: [], tMax: 0, tMin: 0 };
  return {
    event: { code: ev.code, name: ev.name, groupSize: ev.group_size, firstStart: ev.first_start, course: ev.course_json, params: paramsOf(ev) },
    riders: riders.map(publicRider), groups, sheet,
  };
}

/* ---- events -------------------------------------------------------------- */
app.post("/api/events", async (req, res) => {
  try {
    const name = (req.body?.name || "Pursuit").slice(0, 80);
    let code = (req.body?.code || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "") || genCode();
    const orgToken = token();
    const course = buildManualCourse(45, 500);
    const { rows } = await q(
      "INSERT INTO events(code,name,organiser_token,course_json,params_json,group_size,first_start,groups_json) VALUES($1,$2,$3,$4,$5,$6,$7,'[]') RETURNING *",
      [code, name, orgToken, course, {}, 2, "09:30"]
    );
    res.json({ ...(await eventPayload(rows[0])), organiserToken: orgToken });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "That event code is taken — pick another." });
    console.error(e); res.status(500).json({ error: "Could not create event." });
  }
});

app.get("/api/events/:code", async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  res.json(await eventPayload(ev));
});

app.patch("/api/events/:code", async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  const b = req.body || {};
  const name = b.name != null ? String(b.name).slice(0, 80) : ev.name;
  const groupSize = b.groupSize != null ? Math.max(1, Math.min(8, b.groupSize | 0)) : ev.group_size;
  const firstStart = b.firstStart != null ? String(b.firstStart).slice(0, 5) : ev.first_start;
  let course = ev.course_json;
  if (b.courseManual) course = buildManualCourse(Number(b.courseManual.km) || 45, Number(b.courseManual.ascent) || 0, (b.params || ev.params_json || {}).climbGrad || 0.05);
  else if (b.course != null) course = b.course;   // or a pre-parsed { segments, distanceM, ascentM, name } (e.g. from a GPX/FIT parsed in the browser)
  const params = b.params != null ? b.params : ev.params_json;
  const { rows } = await q(
    "UPDATE events SET name=$1,group_size=$2,first_start=$3,course_json=$4,params_json=$5 WHERE id=$6 RETURNING *",
    [name, groupSize, firstStart, course, params, ev.id]
  );
  res.json(await eventPayload(rows[0]));
});

/* ---- riders -------------------------------------------------------------- */
// public self sign-up
app.post("/api/events/:code/riders", async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Name is required." });
  const { rows } = await q(
    "INSERT INTO riders(event_id,name,weight,ftp,pos,build) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [ev.id, b.name.trim().slice(0, 60), Number(b.w) || 75, Number(b.ftp) || 240, b.pos || "road_drops", b.build || "medium"]
  );
  res.json(publicRider(rows[0]));
});

async function eventForRider(riderId) {
  const { rows } = await q("SELECT e.* FROM events e JOIN riders r ON r.event_id=e.id WHERE r.id=$1", [riderId]);
  return rows[0] || null;
}

app.patch("/api/riders/:id", async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const b = req.body || {};
  const { rows: cur } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  if (!cur[0]) return res.status(404).json({ error: "No such rider." });
  const r = cur[0];
  const { rows } = await q(
    "UPDATE riders SET name=$1,weight=$2,ftp=$3,pos=$4,build=$5 WHERE id=$6 RETURNING *",
    [b.name != null ? String(b.name).slice(0, 60) : r.name, b.w != null ? Number(b.w) : r.weight,
     b.ftp != null ? Number(b.ftp) : r.ftp, b.pos || r.pos, b.build || r.build, r.id]
  );
  res.json(publicRider(rows[0]));
});

app.delete("/api/riders/:id", async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  await q("DELETE FROM riders WHERE id=$1", [req.params.id]);
  // drop the rider from any stored groups
  const groups = (ev.groups_json || []).map((g) => ({ ...g, members: g.members.filter((m) => String(m) !== String(req.params.id)) })).filter((g) => g.members.length || g.locked);
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json({ ok: true });
});

/* ---- grouping ------------------------------------------------------------ */
app.post("/api/events/:code/suggest", async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  if (!ev.course_json) return res.status(400).json({ error: "Set a course first." });
  const riders = await getRiders(ev.id);
  const byId = Object.fromEntries(riders.map((r) => [r.id, { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
  const locked = (ev.groups_json || []).filter((g) => g.locked);
  const lockedIds = new Set(locked.flatMap((g) => g.members.map(String)));
  const pool = riders.map((r) => r.id).filter((id) => !lockedIds.has(String(id)));
  const size = req.body?.size != null ? Math.max(1, Math.min(8, req.body.size | 0)) : ev.group_size;
  const { groups, leftover } = suggestGroups(pool, byId, ev.course_json.segments, paramsOf(ev), size);
  const newGroups = [...locked, ...groups.map((m) => ({ id: "g" + crypto.randomBytes(3).toString("hex"), members: m, locked: false }))];
  await q("UPDATE events SET groups_json=$1, group_size=$2 WHERE id=$3", [JSON.stringify(newGroups), size, ev.id]);
  const updated = await getEvent(ev.code);
  res.json({ ...(await eventPayload(updated)), leftover });
});

// save a manual arrangement
app.put("/api/events/:code/groups", async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json(await eventPayload(await getEvent(ev.code)));
});

/* ---- Strava OAuth -------------------------------------------------------- */
// organiser (or rider) starts the link: /auth/strava?code=EVENT&rider=ID
app.get("/auth/strava", async (req, res) => {
  const { code, rider } = req.query;
  if (!code || !rider) return res.status(400).send("Missing event code or rider id.");
  if (!process.env.STRAVA_CLIENT_ID) return res.status(500).send("Strava is not configured on this server.");
  const state = Buffer.from(JSON.stringify({ code, rider })).toString("base64url");
  res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
});

app.get("/auth/strava/callback", async (req, res) => {
  try {
    const { code: authCode, state, error } = req.query;
    if (error) return res.redirect(`/?stravaerror=1`);
    const { code, rider } = JSON.parse(Buffer.from(String(state), "base64url").toString());
    const tok = await exchange(authCode);
    await q(
      "UPDATE riders SET strava_athlete_id=$1, strava_access_token=$2, strava_refresh_token=$3, strava_expires_at=$4 WHERE id=$5",
      [tok.athlete?.id || null, tok.access_token, tok.refresh_token, tok.expires_at, rider]
    );
    res.redirect(`/?code=${encodeURIComponent(code)}&stravalinked=1`);
  } catch (e) {
    console.error(e); res.redirect(`/?stravaerror=1`);
  }
});

// refine a rider from their most recent matching Strava ride
app.post("/api/riders/:id/refine", async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  if (!ev.course_json) return res.status(400).json({ error: "Set a course first." });
  try {
    let access = r.strava_access_token;
    if (r.strava_expires_at && Date.now() / 1000 > r.strava_expires_at - 60) {
      const t = await refresh(r.strava_refresh_token);
      access = t.access_token;
      await q("UPDATE riders SET strava_access_token=$1, strava_refresh_token=$2, strava_expires_at=$3 WHERE id=$4", [t.access_token, t.refresh_token, t.expires_at, r.id]);
    }
    const acts = await recentActivities(access);
    const match = matchByDistance(acts, ev.course_json.distanceM);
    if (!match) return res.json({ matched: false, message: "No recent ride close to the course distance." });
    const rider = { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build };
    const k = calibrationFactor(rider, ev.course_json.segments, match.moving_time, paramsOf(ev), r.calib);
    await q("UPDATE riders SET calib=$1, last_refined_at=now() WHERE id=$2", [k, r.id]);
    res.json({ matched: true, activity: match.name, distanceKm: (match.distance / 1000).toFixed(1), movingTime: match.moving_time, calib: Number(k.toFixed(3)), effectiveFtp: Math.round(r.ftp * k) });
  } catch (e) {
    console.error(e); res.status(502).json({ error: "Strava request failed — try again." });
  }
});

// serve the shared engine to the browser (single source of truth, no duplication)
app.get("/engine.mjs", (_req, res) => res.type("application/javascript").sendFile(path.join(__dirname, "lib", "engine.mjs")));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Pursuit server on :${PORT}`)))
  .catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
