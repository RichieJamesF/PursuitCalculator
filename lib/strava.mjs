/* Strava OAuth + activity helpers. Uses global fetch (Node 18+).
   Needs STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in the environment. */

import crypto from "node:crypto";

const AUTH = "https://www.strava.com/oauth/authorize";
const TOKEN = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";
const STATE_EXPIRY_MINUTES = 15;

const cid = () => process.env.STRAVA_CLIENT_ID;
const secret = () => process.env.STRAVA_CLIENT_SECRET;

export function signState(payload) {
  if (!secret()) throw new Error("STRAVA_CLIENT_SECRET is required to sign state");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyState(raw) {
  if (!secret()) return null;
  if (typeof raw !== "string" || !raw.includes(".")) return null;
  const [encoded, sig] = raw.split(".");
  if (!encoded || !sig || raw.split(".").length !== 2) return null;
  try {
    const expected = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (!payload.ts || Date.now() - payload.ts > STATE_EXPIRY_MINUTES * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authUrl(state, redirectUri) {
  const p = new URLSearchParams({
    client_id: cid(), redirect_uri: redirectUri, response_type: "code",
    scope: "read,activity:read", approval_prompt: "auto", state,
  });
  return `${AUTH}?${p.toString()}`;
}

async function tokenReq(body) {
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Strava token request failed (${r.status})`);
  return r.json();
}
export const exchange = (code) => tokenReq({ client_id: cid(), client_secret: secret(), code, grant_type: "authorization_code" });
export const refresh = (refresh_token) => tokenReq({ client_id: cid(), client_secret: secret(), grant_type: "refresh_token", refresh_token });

export async function recentActivities(accessToken, perPage = 30) {
  const r = await fetch(`${API}/athlete/activities?per_page=${perPage}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Strava activities fetch failed (${r.status})`);
  return r.json();
}
export async function activity(accessToken, id) {
  const r = await fetch(`${API}/activities/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Strava activity fetch failed (${r.status})`);
  return r.json();
}
