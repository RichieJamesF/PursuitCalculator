import express from "express";
import { q } from "../db.js";
import { eventForRider, getRider, requireRiderOrOrg, baseUrl, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity, signState, verifyState } from "../lib/strava.mjs";

const router = express.Router();

// Start the Strava link. A browser link can't send headers, so the caller's key
// rides in the query string: either the event's organiser key or the rider's own.
router.get("/auth/strava", asyncRoute(async (req, res) => {
  const { code, rider, key } = req.query;
  if (!code || !rider || !key) return res.status(400).send("Missing event code, rider or key.");
  const ev = await eventForRider(rider);
  const r = await getRider(rider);
  if (!ev || !r || ev.code !== String(code)) return res.status(404).send("No such rider in that event.");
  const allowed = key === ev.organiser_token || (r.rider_token && key === r.rider_token);
  if (!allowed) return res.status(403).send("That key doesn't grant access to this rider.");
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) return res.status(500).send("Strava is not configured on this server.");
  const state = signState({ code, rider: Number(rider), ts: Date.now() });
  res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
}));

router.get("/auth/strava/callback", asyncRoute(async (req, res) => {
  try {
    const { code: authCode, state, error } = req.query;
    if (error) return res.redirect(`/?stravaerror=1`);
    const payload = verifyState(state);
    if (!payload) return res.redirect(`/?stravaerror=1`);
    const { code, rider } = payload;
    const tok = await exchange(authCode);
    const athleteId = tok.athlete?.id || null;
    if (athleteId) {
      // Refuse a Strava athlete already attached to a different rider in this event —
      // silently overwriting would make repeated harvesting against one event invisible.
      const { rows: dupe } = await q(
        "SELECT r.id FROM riders r JOIN events e ON e.id=r.event_id WHERE e.code=$1 AND r.strava_athlete_id=$2 AND r.id<>$3",
        [code, athleteId, rider]
      );
      if (dupe.length) return res.redirect(`/?code=${encodeURIComponent(code)}&stravaerror=1`);
    }
    await q(
      "UPDATE riders SET strava_athlete_id=$1, strava_access_token=$2, strava_refresh_token=$3, strava_expires_at=$4 WHERE id=$5",
      [athleteId, tok.access_token, tok.refresh_token, tok.expires_at, rider]
    );
    // Carry the rider id (never the key) back so the localStorage fallback in state.js can
    // resolve rider mode again — this redirect has no browser-supplied key to pass through.
    res.redirect(`/?code=${encodeURIComponent(code)}&rider=${rider}&stravalinked=1`);
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
// A ride must last at least this long for its power to stand in for an FTP —
// below it a short hard surge reads as a far higher FTP than the rider holds.
export const MIN_EFFORT_SECONDS = 1200;

const RIDE_TYPES = new Set(["Ride", "GravelRide", "VirtualRide", "MountainBikeRide", "EBikeRide"]);
export const isRide = (a) => RIDE_TYPES.has(a.sport_type) || a.type === "Ride";

// Weighted (normalised) power off a real meter is the best FTP stand-in; a bare
// average — including Strava's estimate for riders with no meter — is the fallback.
export function rideFtpWatts(a) {
  const w = a.device_watts ? (a.weighted_average_watts ?? a.average_watts) : a.average_watts;
  return w == null ? null : Math.round(w);
}

export function normalizeRide(a) {
  const ftpEstimate = rideFtpWatts(a);
  const movingTime = a.moving_time || 0;
  const longEnough = movingTime >= MIN_EFFORT_SECONDS;
  return {
    id: a.id, name: a.name, date: a.start_date,
    distanceKm: +((a.distance || 0) / 1000).toFixed(1),
    movingTime,
    avgSpeedKmh: +((a.average_speed || 0) * 3.6).toFixed(1),
    ftpEstimate, hasPower: !!a.device_watts, commute: !!a.commute,
    longEnough, eligible: ftpEstimate != null && longEnough,
  };
}

// The one ride offered up as "your hardest recent effort". The auto-refine uses the
// same function, so the ride the rider is shown is always the ride that gets applied.
export function pickSuggested(rides) {
  return rides.filter((r) => r.eligible && !r.commute)
    .sort((a, b) => b.ftpEstimate - a.ftpEstimate)[0] || null;
}

export function sortRides(rides) {
  const rank = (r) => (r.eligible && !r.commute ? 0 : 1);
  return [...rides].sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) === 0 ? b.ftpEstimate - a.ftpEstimate : new Date(b.date) - new Date(a.date)));
}

// list a rider's recent rides, hardest usable effort first
router.get("/api/riders/:id/rides", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  if (!r.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  try {
    const access = await freshAccess(r);
    const acts = await recentActivities(access, 50);
    const cutoff = Date.now() - 42 * 864e5;
    const rides = sortRides(acts
      .filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff)
      .map(normalizeRide));
    const suggested = pickSuggested(rides);
    res.json({ rides, suggestedId: suggested?.id ?? null, minMinutes: MIN_EFFORT_SECONDS / 60 });
  } catch (e) { console.error(e); res.status(502).json({ error: "Strava request failed — try again." }); }
}));

// Set a rider's FTP from a Strava ride's power. Body: { activityId? } — omit it to
// use the suggested ride (the hardest recent qualifying effort).
router.post("/api/riders/:id/refine", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  if (!r.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  try {
    const access = await freshAccess(r);
    let act;
    if (req.body?.activityId) {
      act = await activity(access, req.body.activityId);
    } else {
      const acts = await recentActivities(access, 50);
      const cutoff = Date.now() - 42 * 864e5;
      const fresh = acts.filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff);
      const best = pickSuggested(fresh.map(normalizeRide));
      if (!best) return res.json({ matched: false, message: `No ride in the last 6 weeks has power data and lasts ${MIN_EFFORT_SECONDS / 60} minutes or more. Pick a ride yourself, or ask your organiser to type your FTP in.` });
      act = fresh.find((a) => String(a.id) === String(best.id));
    }
    const ftp = rideFtpWatts(act);
    if (ftp == null) return res.status(400).json({ error: "That ride has no power data to read an FTP from." });
    if ((act.moving_time || 0) < MIN_EFFORT_SECONDS) return res.status(400).json({ error: `That ride is under ${MIN_EFFORT_SECONDS / 60} minutes — too short to read an FTP from. Pick a longer, harder effort.` });
    await q("UPDATE riders SET ftp=$1, calib=1, last_refined_at=now() WHERE id=$2", [ftp, r.id]);
    res.json({ matched: true, activity: act.name, ftp, hadPower: !!act.device_watts, movingTime: act.moving_time });
  } catch (e) {
    console.error(e); res.status(502).json({ error: "Strava request failed — try again." });
  }
}));

export default router;
