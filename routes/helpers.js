import crypto from "node:crypto";
import { q } from "../db.js";
import { DEFAULT_PARAMS, computeSheet } from "../lib/engine.mjs";

export const token = () => crypto.randomBytes(16).toString("hex");
export const genCode = () => "ride-" + crypto.randomBytes(3).toString("hex");
export const groupId = () => "g" + crypto.randomBytes(3).toString("hex");
export const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

export function clampGroupSize(value, fallback) {
  if (value == null) return fallback;
  return Math.max(1, Math.min(8, value | 0));
}

export function truncate(value, maxLen, fallback) {
  if (value == null) return fallback;
  return String(value).slice(0, maxLen);
}

export async function getEvent(code) {
  const { rows } = await q("SELECT * FROM events WHERE code=$1", [code]);
  return rows[0] || null;
}

export async function getRiders(eventId) {
  const { rows } = await q("SELECT * FROM riders WHERE event_id=$1 ORDER BY id", [eventId]);
  return rows;
}

const isNumericId = (v) => {
  const s = String(v);
  if (!/^\d+$/.test(s)) return false;
  // Reject values outside int4 range to avoid Postgres "value out of range" errors
  const n = BigInt(s);
  return n <= 2147483647n;
};

export async function eventForRider(riderId) {
  if (!isNumericId(riderId)) return null;
  const { rows } = await q("SELECT e.* FROM events e JOIN riders r ON r.event_id=e.id WHERE r.id=$1", [riderId]);
  return rows[0] || null;
}

export async function getRider(riderId) {
  if (!isNumericId(riderId)) return null;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [riderId]);
  return rows[0] || null;
}

export const publicRider = (r) => ({ id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib, strava: !!r.strava_athlete_id, lastRefined: r.last_refined_at });

export const engineRider = (r) => ({ id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib });

export const engineRidersById = (riders) => Object.fromEntries(riders.map((r) => [r.id, engineRider(r)]));

export const paramsOf = (ev) => ({ ...DEFAULT_PARAMS, ...(ev.params_json || {}) });

export function requireOrg(ev, req, res) {
  const t = req.get("x-organiser-token");
  if (!ev) { res.status(404).json({ error: "No event with that code." }); return false; }
  if (!t || t !== ev.organiser_token) { res.status(403).json({ error: "Organiser token required." }); return false; }
  return true;
}

// Either the event's organiser or the rider themselves. Same self-reporting
// contract as requireOrg: writes the error response and returns false.
export function requireRiderOrOrg(ev, rider, req, res) {
  if (!rider) { res.status(404).json({ error: "No such rider." }); return false; }
  if (!ev) { res.status(404).json({ error: "No event with that code." }); return false; }
  const org = req.get("x-organiser-token");
  if (org && org === ev.organiser_token) return true;
  const own = req.get("x-rider-token");
  if (own && rider.rider_token && own === rider.rider_token) return true;
  res.status(403).json({ error: "Organiser key, or your own rider key, required." });
  return false;
}

export async function eventPayload(ev) {
  const riders = await getRiders(ev.id);
  const byId = engineRidersById(riders);
  const groups = ev.groups_json || [];
  const sheet = ev.course_json ? computeSheet(groups, byId, ev.course_json.segments, paramsOf(ev)) : { rows: [], tMax: 0, tMin: 0 };
  return {
    event: { code: ev.code, name: ev.name, groupSize: ev.group_size, firstStart: ev.first_start, course: ev.course_json, params: paramsOf(ev) },
    riders: riders.map(publicRider), groups, sheet,
  };
}

export const asyncRoute = (fn) => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

// Pull one named cookie out of a raw `Cookie` header without pulling in cookie-parser.
// Split on ";" first so a name that's a prefix/suffix of another (e.g. "pursuit_oauth_nonce"
// vs "pursuit_oauth_nonce_v2") can't false-match the way an unanchored split or .includes would.
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
