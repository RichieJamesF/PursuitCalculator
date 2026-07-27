import test from "node:test";
import assert from "node:assert/strict";
import { MIN_EFFORT_SECONDS, rideFtpWatts, normalizeRide, pickSuggested, sortRides, freshRides } from "../../routes/strava.js";

const act = (over = {}) => ({
  id: 1, name: "Ride", start_date: "2026-07-01T08:00:00Z", distance: 45000,
  moving_time: 3600, average_speed: 8, average_watts: 200,
  weighted_average_watts: 240, device_watts: true, commute: false, type: "Ride",
  ...over,
});

test("MIN_EFFORT_SECONDS is 20 minutes", () => {
  assert.equal(MIN_EFFORT_SECONDS, 1200);
});

test("rideFtpWatts prefers weighted power from a real power meter", () => {
  assert.equal(rideFtpWatts(act()), 240);
});

test("rideFtpWatts falls back to average watts when there is no power meter", () => {
  assert.equal(rideFtpWatts(act({ device_watts: false, average_watts: 187.4 })), 187);
});

test("rideFtpWatts falls back to average watts when a meter ride has no weighted value", () => {
  assert.equal(rideFtpWatts(act({ weighted_average_watts: null, average_watts: 210 })), 210);
});

test("rideFtpWatts returns null when there is no power at all", () => {
  assert.equal(rideFtpWatts(act({ device_watts: false, average_watts: null, weighted_average_watts: null })), null);
});

test("normalizeRide marks a long ride with power as eligible", () => {
  const r = normalizeRide(act());
  assert.equal(r.ftpEstimate, 240);
  assert.equal(r.hasPower, true);
  assert.equal(r.longEnough, true);
  assert.equal(r.eligible, true);
  assert.equal(r.distanceKm, 45);
  assert.equal(r.avgSpeedKmh, 28.8);
});

test("normalizeRide marks a ride under 20 minutes as too short and ineligible", () => {
  const r = normalizeRide(act({ moving_time: 1199 }));
  assert.equal(r.longEnough, false);
  assert.equal(r.eligible, false);
});

test("normalizeRide marks a powerless ride ineligible but keeps it listed", () => {
  const r = normalizeRide(act({ device_watts: false, average_watts: null, weighted_average_watts: null }));
  assert.equal(r.ftpEstimate, null);
  assert.equal(r.eligible, false);
  assert.equal(r.longEnough, true);
});

test("pickSuggested returns the highest-power eligible non-commute ride", () => {
  const rides = [
    normalizeRide(act({ id: 1, weighted_average_watts: 200 })),
    normalizeRide(act({ id: 2, weighted_average_watts: 275 })),
    normalizeRide(act({ id: 3, weighted_average_watts: 250 })),
  ];
  assert.equal(pickSuggested(rides).id, 2);
});

test("pickSuggested ignores commutes and short rides", () => {
  const rides = [
    normalizeRide(act({ id: 1, weighted_average_watts: 300, commute: true })),
    normalizeRide(act({ id: 2, weighted_average_watts: 290, moving_time: 600 })),
    normalizeRide(act({ id: 3, weighted_average_watts: 180 })),
  ];
  assert.equal(pickSuggested(rides).id, 3);
});

test("pickSuggested returns null when nothing qualifies", () => {
  const rides = [normalizeRide(act({ moving_time: 300 }))];
  assert.equal(pickSuggested(rides), null);
});

test("freshRides keeps a ride inside the six-week window", () => {
  const inside = act({ id: 1, start_date: new Date(Date.now() - 5 * 864e5).toISOString() });
  assert.deepEqual(freshRides([inside]).map((a) => a.id), [1]);
});

test("freshRides drops a ride outside the six-week window", () => {
  const outside = act({ id: 2, start_date: new Date(Date.now() - 50 * 864e5).toISOString() });
  assert.deepEqual(freshRides([outside]), []);
});

test("freshRides drops a non-ride type even inside the window", () => {
  const run = act({ id: 3, type: "Run", sport_type: "Run", start_date: new Date(Date.now() - 5 * 864e5).toISOString() });
  assert.deepEqual(freshRides([run]), []);
});

test("sortRides puts eligible non-commutes first by power, then the rest by date, without mutating the input", () => {
  const rides = [
    normalizeRide(act({ id: 1, moving_time: 300, start_date: "2026-06-01T08:00:00Z" })),
    normalizeRide(act({ id: 2, weighted_average_watts: 210 })),
    normalizeRide(act({ id: 3, moving_time: 300, start_date: "2026-07-10T08:00:00Z" })),
    normalizeRide(act({ id: 4, weighted_average_watts: 260 })),
  ];
  const before = rides.map((r) => r.id);
  assert.deepEqual(sortRides(rides).map((r) => r.id), [4, 2, 3, 1]);
  assert.deepEqual(rides.map((r) => r.id), before);
});
