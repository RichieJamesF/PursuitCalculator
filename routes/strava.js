import express from "express";
import { q } from "../db.js";
import { eventForRider, requireOrg, paramsOf, baseUrl, engineRider, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity } from "../lib/strava.mjs";

const router = express.Router();

// organiser (or rider) starts the link: /auth/strava?code=EVENT&rider=ID
router.get("/auth/strava", asyncRoute(async (req, res) => {
  const { code, rider } = req.query;
  if (!code || !rider) return res.status(400).send("Missing event code or rider id.");
  if (!process.env.STRAVA_CLIENT_ID) return res.status(500).send("Strava is not configured on this server.");
  const state = Buffer.from(JSON.stringify({ code, rider })).toString("base64url");
  res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
}));

router.get("/auth/strava/callback", asyncRoute(async (req, res) => {
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
}));

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
  return {
    id: a.id, name: a.name, date: a.start_date, distanceKm: +(a.distance / 1000).toFixed(1),
    movingTime: a.moving_time, avgSpeedKmh: +((a.average_speed || 0) * 3.6).toFixed(1),
    avgWatts: a.average_watts != null ? Math.round(a.average_watts) : null,
    weightedWatts: weighted != null ? Math.round(weighted) : null,
    hasPower: !!a.device_watts, commute: !!a.commute, matches,
  };
}

// list a rider's recent rides so the organiser can choose which to calibrate from
router.get("/api/riders/:id/rides", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  try {
    const access = await freshAccess(r);
    const acts = await recentActivities(access, 50);
    const courseM = ev.course_json?.distanceM, segs = ev.course_json?.segments;
    const rider = engineRider(r);
    const cutoff = Date.now() - 42 * 864e5;
    const rides = acts
      .filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff)
      .map((a) => normalizeRide(a, courseM, rider, segs, paramsOf(ev)))
      .sort((a, b) => (b.matches - a.matches) || (a.commute - b.commute) || (a.movingTime - b.movingTime));
    res.json({ rides, course: { distanceKm: courseM ? +(courseM / 1000).toFixed(1) : null } });
  } catch (e) { console.error(e); res.status(502).json({ error: "Strava request failed — try again." }); }
}));

// refine a rider. Body: { activityId?, mode? }  mode = "course" (time on course) | "power" (FTP from watts).
// No activityId → auto-pick the fastest recent non-commute ride matching the course distance.
router.post("/api/riders/:id/refine", asyncRoute(async (req, res) => {
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
    return res.json({ matched: false, message: "Calibrating from a ride's time has been retired — use FTP from power instead." });
  } catch (e) {
    console.error(e); res.status(502).json({ error: "Strava request failed — try again." });
  }
}));

export default router;
