import test from "node:test";
import assert from "node:assert/strict";
import { clampGroupSize, truncate, publicRider, engineRider, paramsOf, requireRiderOrOrg, readCookie } from "../../routes/helpers.js";

test("clampGroupSize clamps to the 1-8 range and falls back when null", () => {
  assert.equal(clampGroupSize(0, 2), 1);
  assert.equal(clampGroupSize(12, 2), 8);
  assert.equal(clampGroupSize(5, 2), 5);
  assert.equal(clampGroupSize(null, 2), 2);
});

test("truncate slices strings to a max length and falls back when null", () => {
  assert.equal(truncate("a".repeat(100), 80, "x").length, 80);
  assert.equal(truncate(null, 80, "fallback"), "fallback");
});

test("publicRider shapes a DB row for API responses", () => {
  const row = { id: 1, name: "Ann", weight: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05, strava_athlete_id: 42, last_refined_at: "2026-01-01" };
  assert.deepEqual(publicRider(row), { id: 1, name: "Ann", w: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05, strava: true, lastRefined: "2026-01-01" });
});

test("engineRider shapes a DB row for the physics engine", () => {
  const row = { id: 1, name: "Ann", weight: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05 };
  assert.deepEqual(engineRider(row), { id: 1, name: "Ann", w: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05 });
});

test("paramsOf merges stored params over defaults", () => {
  const merged = paramsOf({ params_json: { effort: 90 } });
  assert.equal(merged.effort, 90);
  assert.equal(merged.rho, 1.225); // a default that wasn't overridden
});

test("paramsOf falls back to all defaults when params_json is null", () => {
  const merged = paramsOf({ params_json: null });
  assert.equal(merged.effort, 100);
});

const fakeRes = () => ({
  code: null, body: null,
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
});
const fakeReq = (headers) => ({ get: (h) => headers[h.toLowerCase()] ?? undefined });

test("requireRiderOrOrg accepts the event's organiser token", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-organiser-token": "org1" }), res);
  assert.equal(ok, true);
  assert.equal(res.code, null);
});

test("requireRiderOrOrg accepts that rider's own key", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-rider-token": "rid1" }), res);
  assert.equal(ok, true);
});

test("requireRiderOrOrg rejects another rider's key with 403", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-rider-token": "rid2" }), res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
});

test("requireRiderOrOrg rejects a rider with no key stored, even if the header is the literal string 'null'", () => {
  // Defence-in-depth: strict equality (own === rider.rider_token) plus existence checks
  // (own && rider.rider_token &&). The literal string "null" passes the truthy check but
  // will not equal null, so this test pins the existence guard working independently.
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: null }, fakeReq({ "x-rider-token": "null" }), res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
});

test("requireRiderOrOrg rejects an empty stored key against an empty header", () => {
  const res = fakeRes();
  assert.equal(requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "" }, fakeReq({ "x-rider-token": "" }), res), false);
  assert.equal(res.code, 403);
});

test("requireRiderOrOrg 404s a missing event or missing rider", () => {
  const noEvent = fakeRes();
  assert.equal(requireRiderOrOrg(null, { rider_token: "r" }, fakeReq({}), noEvent), false);
  assert.equal(noEvent.code, 404);

  const noRider = fakeRes();
  assert.equal(requireRiderOrOrg({ organiser_token: "o" }, null, fakeReq({}), noRider), false);
  assert.equal(noRider.code, 404);
});

test("requireRiderOrOrg rejects a wrong organiser token with 403", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-organiser-token": "wrong" }), res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
});

test("requireRiderOrOrg rejects a missing organiser token even when event and rider exist", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({}), res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
});

test("readCookie returns null when the header is absent", () => {
  assert.equal(readCookie(undefined, "pursuit_oauth_nonce"), null);
  assert.equal(readCookie(null, "pursuit_oauth_nonce"), null);
  assert.equal(readCookie("", "pursuit_oauth_nonce"), null);
});

test("readCookie reads a single cookie", () => {
  assert.equal(readCookie("pursuit_oauth_nonce=abc123", "pursuit_oauth_nonce"), "abc123");
});

test("readCookie picks the right one out of several", () => {
  const header = "a=1; pursuit_oauth_nonce=abc123; b=2";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "abc123");
});

test("readCookie trims surrounding whitespace around name and value", () => {
  const header = "  a=1 ;  pursuit_oauth_nonce = abc123  ; b=2";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "abc123");
});

test("readCookie preserves a value that itself contains '='", () => {
  const header = "pursuit_oauth_nonce=abc=123==";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "abc=123==");
});

test("readCookie doesn't false-match a name that's a prefix of the target", () => {
  const header = "pursuit_oauth_nonce_v2=wrong; pursuit_oauth_nonce=right";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "right");
});

test("readCookie doesn't false-match a name that's a suffix of the target", () => {
  const header = "old_pursuit_oauth_nonce=wrong; pursuit_oauth_nonce=right";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "right");
});

test("readCookie returns null when the named cookie isn't present", () => {
  assert.equal(readCookie("a=1; b=2", "pursuit_oauth_nonce"), null);
});

test("readCookie returns the first value when a cookie name is duplicated", () => {
  const header = "pursuit_oauth_nonce=first; pursuit_oauth_nonce=second";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "first");
});

test("readCookie returns an empty string for a present-but-empty cookie value", () => {
  const header = "pursuit_oauth_nonce=; b=2";
  assert.equal(readCookie(header, "pursuit_oauth_nonce"), "");
});
