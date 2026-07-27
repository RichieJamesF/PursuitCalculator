import crypto from "node:crypto";
import express from "express";
import { q } from "../db.js";
import { eventForRider, getRider, requireRiderOrOrg, baseUrl, readCookie, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity, signState, verifyState, STATE_EXPIRY_MINUTES } from "../lib/strava.mjs";

const router = express.Router();

// Binds the OAuth round-trip to the browser that started it (see ADR-0003 amendment):
// a signed state only proves the server issued it, not that whoever finishes the flow
// is who started it. Path-scoped so it never rides along on unrelated requests.
const NONCE_COOKIE = "pursuit_oauth_nonce";
const NONCE_COOKIE_PATH = "/auth/strava";
const NONCE_MAX_AGE_MS = STATE_EXPIRY_MINUTES * 60 * 1000;

// timingSafeEqual throws on unequal-length buffers rather than returning false.
function safeEqual(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Shared by the confirmation GET and the act-on-it POST below: identical checks in
// identical order, so the POST can never be reached having skipped a check the GET
// enforced — it re-derives everything itself rather than trusting the earlier hop.
// Returns the resolved {code, rider, key, ev, r} on success, or null after writing
// the error response itself (missing -> 400, unknown rider/event mismatch -> 404,
// bad key -> 403, Strava not configured -> 500).
async function checkStravaAuth(params, res) {
  const { code, rider, key } = params || {};
  if (!code || !rider || !key) { res.status(400).send("Missing event code, rider or key."); return null; }
  const ev = await eventForRider(rider);
  const r = await getRider(rider);
  if (!ev || !r || ev.code !== String(code)) { res.status(404).send("No such rider in that event."); return null; }
  const allowed = key === ev.organiser_token || (r.rider_token && key === r.rider_token);
  if (!allowed) { res.status(403).send("That key doesn't grant access to this rider."); return null; }
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) { res.status(500).send("Strava is not configured on this server."); return null; }
  return { code, rider, key, ev, r };
}

// Rider and event names are free text a rider typed in at sign-up, interpolated into
// server-rendered HTML below — escape both text and (quoted) attribute contexts.
// public/format.js has an esc() already, but that's browser bundle code; this page
// renders server-side, so it gets its own tiny copy rather than an import across that line.
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The whole security value of this page is naming the rider and event before anything
// happens: a victim sent an attacker's link sees a rider who isn't them, on this app's
// own origin, before Strava is ever involved. See ADR-0003 amendment.
function confirmPage({ riderName, eventName, code, rider, key, nonce }) {
  const riderT = escHtml(riderName), eventT = escHtml(eventName);
  const codeA = escHtml(code), riderA = escHtml(String(rider)), keyA = escHtml(key), nonceA = escHtml(nonce);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Strava</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:30em;margin:3em auto;padding:0 1em;color:#222}
.btn{display:inline-block;padding:.7em 1.4em;background:#fc4c02;color:#fff;border:0;border-radius:.4em;font-size:1em}
.cancel{margin-left:1em;color:#666}</style></head><body>
<h1>Link a Strava account</h1>
<p>This will link a Strava account to <strong>${riderT}</strong> in <strong>${eventT}</strong>.</p>
<p>Only continue if you tapped "Link Strava" on your own rider page just now. If you got here from a link someone sent you, stop and close this page.</p>
<form method="post" action="/auth/strava">
<input type="hidden" name="code" value="${codeA}">
<input type="hidden" name="rider" value="${riderA}">
<input type="hidden" name="key" value="${keyA}">
<input type="hidden" name="nonce" value="${nonceA}">
<button class="btn" type="submit">Continue to Strava</button>
<a class="cancel" href="/?code=${encodeURIComponent(code)}">Cancel</a>
</form></body></html>`;
}

// Confirm step. A browser link can't send headers, so the caller's key rides in the
// query string as before — but this no longer redirects to Strava. It authenticates,
// then shows the rider and event it's about to link, on this app's own origin.
router.get("/auth/strava", asyncRoute(async (req, res) => {
  const auth = await checkStravaAuth(req.query, res);
  if (!auth) return;
  const { code, rider, key, ev, r } = auth;
  const nonce = crypto.randomBytes(16).toString("hex");
  // secure must be conditional: Railway terminates TLS at a proxy, so req.secure reads false
  // without `trust proxy` set. Unconditional `secure: true` would silently drop the cookie
  // (and break the flow) under local HTTP dev.
  res.cookie(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", path: NONCE_COOKIE_PATH, maxAge: NONCE_MAX_AGE_MS, secure: baseUrl(req).startsWith("https:") });
  // The rendered form carries the rider's bearer key in a hidden field — the static
  // middleware's no-cache header doesn't reach router responses, so this one sets its own.
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(confirmPage({ riderName: r.name, eventName: ev.name, code, rider, key, nonce }));
}));

// Act step. Re-runs the identical checks — never trusts that the GET ran — then a
// double-submit compare (form nonce vs cookie nonce) before minting state and leaving
// this app's origin. SameSite=Lax already blocks a cross-site auto-POST to here; this
// check is belt-and-braces for anything that doesn't honour SameSite.
router.post("/auth/strava", asyncRoute(async (req, res) => {
  const auth = await checkStravaAuth(req.body, res);
  if (!auth) return;
  const { code, rider } = auth;
  const formNonce = req.body?.nonce;
  const cookieNonce = readCookie(req.headers.cookie, NONCE_COOKIE);
  if (!formNonce || !cookieNonce || !safeEqual(String(formNonce), cookieNonce)) return res.status(403).send("Could not verify this request — go back and try again.");
  const state = signState({ code, rider: Number(rider), ts: Date.now(), nonce: cookieNonce });
  res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
}));

router.get("/auth/strava/callback", asyncRoute(async (req, res) => {
  const refuse = (signal) => { res.clearCookie(NONCE_COOKIE, { path: NONCE_COOKIE_PATH }); return res.redirect(`/?stravaerror=${signal}`); };
  try {
    const { code: authCode, state, error } = req.query;
    if (error) return refuse("1");
    const payload = verifyState(state);
    if (!payload) return refuse("1");
    // Nonce check happens before exchange() so a refused flow never contacts Strava.
    // The cookie-absent case gets its own signal (a rider with cookies blocked needs a
    // message that names the cause); a genuine mismatch stays on the generic error so an
    // attacker can't use the response to tell which check failed.
    const cookieNonce = readCookie(req.headers.cookie, NONCE_COOKIE);
    if (!cookieNonce) return refuse("nocookie");
    if (!payload.nonce || !safeEqual(cookieNonce, payload.nonce)) return refuse("1");
    res.clearCookie(NONCE_COOKIE, { path: NONCE_COOKIE_PATH });
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

// Six weeks: recent enough that the rider still remembers the effort, distant enough
// to not force a fresh ride onto someone between hard sessions.
const FRESH_WINDOW_MS = 42 * 864e5;
// The one filter both the listing and the refine-without-an-id path apply — kept in one
// place so "the ride the rider is shown" and "the ride that gets applied" can't drift apart.
export function freshRides(acts) {
  const cutoff = Date.now() - FRESH_WINDOW_MS;
  return acts.filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff);
}

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
    const rides = sortRides(freshRides(acts).map(normalizeRide));
    const suggested = pickSuggested(rides);
    // The listing is built from summary activities, but applying a refine re-reads the
    // *detailed* activity (weighted_average_watts isn't reliably present on the summary) —
    // re-derive just the headline suggestion here so its number is the number that sticks.
    if (suggested) {
      try {
        const detailedFtp = rideFtpWatts(await activity(access, suggested.id));
        if (detailedFtp != null) suggested.ftpEstimate = detailedFtp;
      } catch (e) { console.error(e); }
    }
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
      const fresh = freshRides(acts);
      const best = pickSuggested(fresh.map(normalizeRide));
      if (!best) return res.json({ matched: false, message: `No ride in the last 6 weeks has power data and lasts ${MIN_EFFORT_SECONDS / 60} minutes or more. Pick a ride yourself, or ask your organiser to type your FTP in.` });
      // Fetch the detailed activity here too (not the summary object) — same reason as the
      // explicit-id branch above: it's the only reliable source of weighted_average_watts,
      // and it must match the number the GET listing just showed for this same ride.
      act = await activity(access, best.id);
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

// Revoke local access to a rider's Strava account. There's no way to remove a linked
// account otherwise short of deleting the rider — a phished rider needs a button, not that.
router.delete("/api/riders/:id/strava", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  await q("UPDATE riders SET strava_athlete_id=NULL, strava_access_token=NULL, strava_refresh_token=NULL, strava_expires_at=NULL WHERE id=$1", [r.id]);
  res.json({ ok: true });
}));

export default router;
