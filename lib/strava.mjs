/* Strava OAuth + activity helpers. Uses global fetch (Node 18+).
   Needs STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in the environment. */

const AUTH = "https://www.strava.com/oauth/authorize";
const TOKEN = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";

const cid = () => process.env.STRAVA_CLIENT_ID;
const secret = () => process.env.STRAVA_CLIENT_SECRET;

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

// Most recent ride whose distance is within `tol` of the course distance.
export function matchByDistance(acts, targetM, tol = 0.08) {
  if (!targetM) return null;
  return acts
    .filter((a) => (a.type === "Ride" || a.sport_type === "Ride") && Math.abs(a.distance - targetM) / targetM <= tol)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0] || null;
}
