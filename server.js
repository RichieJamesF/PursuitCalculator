import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool, q, initDb } from "./db.js";
import { DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet } from "./lib/engine.mjs";
import eventsRouter from "./routes/events.js";
import ridersRouter from "./routes/riders.js";
import groupsRouter from "./routes/groups.js";
import stravaRouter from "./routes/strava.js";

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
  app.use(stravaRouter);

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
