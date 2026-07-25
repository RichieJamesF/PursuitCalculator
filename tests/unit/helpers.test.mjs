import test from "node:test";
import assert from "node:assert/strict";
import { clampGroupSize, truncate, publicRider, engineRider, paramsOf } from "../../routes/helpers.js";

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
