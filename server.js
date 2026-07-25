import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool, q, initDb } from "./db.js";
import { DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet, calibrationFactor } from "./lib/engine.mjs";
import { authUrl, exchange, refresh, recentActivities, activity, matchByDistance } from "./lib/strava.mjs";
import eventsRouter from "./routes/events.js";
import ridersRouter from "./routes/riders.js";
import groupsRouter from "./routes/groups.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
  }));

  app.use(eventsRouter);
  app.use(ridersRouter);
  app.use(groupsRouter);

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

async function eventForRider(riderId) {
  const { rows } = await q("SELECT e.* FROM events e JOIN riders r ON r.event_id=e.id WHERE r.id=$1", [riderId]);
  return rows[0] || null;
}

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

// ensure a usable access token, refreshing if near expiry
async function freshAccess(r) {
  let access = r.strava_access_token;
  if (r.strava_expires_at && Date.now() / 1000 > r.strava_expires_at - 60) {
    const t = await refresh(r.strava_refresh_token);
    access = t.access_token;
    await q("UPDATE riders SET strava_access_token=$1, strava_refresh_token=$2, strava_expires_at=$3 WHERE id=$4", [t.access_token, t.refresh_token, t.expires_at, r.id]);
  }
  return access;
}
const RIDE_TYPES = new Set(["Ride", "GravelRide", "VirtualRide", "MountainBikeRide", "EBikeRide"]);
const isRide = (a) => RIDE_TYPES.has(a.sport_type) || a.type === "Ride";

function normalizeRide(a, courseM, rider, segments, params) {
  const matches = courseM ? Math.abs(a.distance - courseM) / courseM <= 0.08 : false;
  const weighted = a.device_watts ? a.weighted_average_watts : null;
  const impliedCalib = matches && segments ? Number(calibrationFactor(rider, segments, a.moving_time, params, rider.calib).toFixed(3)) : null;
  return {
    id: a.id, name: a.name, date: a.start_date, distanceKm: +(a.distance / 1000).toFixed(1),
    movingTime: a.moving_time, avgSpeedKmh: +((a.average_speed || 0) * 3.6).toFixed(1),
    avgWatts: a.average_watts != null ? Math.round(a.average_watts) : null,
    weightedWatts: weighted != null ? Math.round(weighted) : null,
    hasPower: !!a.device_watts, commute: !!a.commute, matches, impliedCalib,
  };
}

  // list a rider's recent rides so the organiser can choose which to calibrate from
  app.get("/api/riders/:id/rides", async (req, res) => {
    const ev = await eventForRider(req.params.id);
    if (!requireOrg(ev, req, res)) return;
    const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
    const r = rows[0];
    if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
    try {
      const access = await freshAccess(r);
      const acts = await recentActivities(access, 50);
      const courseM = ev.course_json?.distanceM, segs = ev.course_json?.segments;
      const rider = { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib };
      const cutoff = Date.now() - 42 * 864e5;
      const rides = acts
        .filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff)
        .map((a) => normalizeRide(a, courseM, rider, segs, paramsOf(ev)))
        .sort((a, b) => (b.matches - a.matches) || (a.commute - b.commute) || (a.movingTime - b.movingTime));
      res.json({ rides, course: { distanceKm: courseM ? +(courseM / 1000).toFixed(1) : null } });
    } catch (e) { console.error(e); res.status(502).json({ error: "Strava request failed — try again." }); }
  });

  // refine a rider. Body: { activityId?, mode? }  mode = "course" (time on course) | "power" (FTP from watts).
  // No activityId → auto-pick the fastest recent non-commute ride matching the course distance.
  app.post("/api/riders/:id/refine", async (req, res) => {
    const ev = await eventForRider(req.params.id);
    if (!requireOrg(ev, req, res)) return;
    const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
    const r = rows[0];
    if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
    const mode = req.body?.mode === "power" ? "power" : "course";
    const activityId = req.body?.activityId || null;
    if (mode === "course" && !ev.course_json) return res.status(400).json({ error: "Set a course first." });
    try {
      const access = await freshAccess(r);
      let act;
      if (activityId) {
        act = await activity(access, activityId);
      } else {
        const acts = await recentActivities(access, 50);
        const courseM = ev.course_json?.distanceM;
        const cutoff = Date.now() - 42 * 864e5;
        act = acts.filter((a) => isRide(a) && !a.commute && new Date(a.start_date).getTime() >= cutoff && courseM && Math.abs(a.distance - courseM) / courseM <= 0.08)
          .sort((a, b) => a.moving_time - b.moving_time)[0];
        if (!act) return res.json({ matched: false, message: "No recent non-commute ride close to the course distance — pick one manually." });
      }
      if (mode === "power") {
        const watts = (act.device_watts ? act.weighted_average_watts : act.average_watts) || act.average_watts;
        if (!watts) return res.status(400).json({ error: "That ride has no power data to read an FTP from." });
        const ftp = Math.round(watts);
        await q("UPDATE riders SET ftp=$1, calib=1, last_refined_at=now() WHERE id=$2", [ftp, r.id]);
        return res.json({ matched: true, mode: "power", activity: act.name, ftp, hadPower: !!act.device_watts });
      }
      const rider = { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build };
      const k = calibrationFactor(rider, ev.course_json.segments, act.moving_time, paramsOf(ev), r.calib);
      await q("UPDATE riders SET calib=$1, last_refined_at=now() WHERE id=$2", [k, r.id]);
      res.json({ matched: true, mode: "course", activity: act.name, distanceKm: (act.distance / 1000).toFixed(1), movingTime: act.moving_time, calib: Number(k.toFixed(3)), effectiveFtp: Math.round(r.ftp * k) });
    } catch (e) {
      console.error(e); res.status(502).json({ error: "Strava request failed — try again." });

    }
  });

  // serve the shared engine to the browser (single source of truth, no duplication)
  app.get("/engine.mjs", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("application/javascript").sendFile(path.join(__dirname, "lib", "engine.mjs")); });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  // eslint-disable-next-line no-unused-vars -- 4-arg signature is what makes Express treat this as an error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}

const PORT = process.env.PORT || 3000;
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  initDb()
    .then(() => createApp().listen(PORT, () => console.log(`Pursuit server on :${PORT}`)))
    .catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
}
