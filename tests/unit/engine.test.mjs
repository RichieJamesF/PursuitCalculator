import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet,
  calibrationFactor, soloDuration, evenness, cdaOf,
} from "../../lib/engine.mjs";

const p = DEFAULT_PARAMS;

test("cdaOf combines position drag and build multiplier", () => {
  assert.equal(cdaOf({ pos: "road_drops", build: "medium" }), 0.32);
  assert.equal(cdaOf({ pos: "tt", build: "small" }), 0.216);
});

test("buildManualCourse returns a single flat segment when ascent is negligible", () => {
  const c = buildManualCourse(45, 0);
  assert.deepEqual(c, {
    segments: [{ dist: 45000, grad: 0 }],
    distanceM: 45000, ascentM: 0, name: "Manual course",
  });
});

test("buildManualCourse builds a climb/flat/descent profile for a real ascent", () => {
  const c = buildManualCourse(45, 500);
  assert.deepEqual(c.segments, [
    { dist: 10000, grad: 0.05 },
    { dist: 25000, grad: 0 },
    { dist: 10000, grad: -0.05 },
  ]);
  assert.equal(c.distanceM, 45000);
  assert.equal(c.ascentM, 500);
});

test("buildManualCourse treats sub-1m ascent as flat", () => {
  const c = buildManualCourse(45, 0.5);
  assert.deepEqual(c.segments, [{ dist: 45000, grad: 0 }]);
  assert.equal(c.ascentM, 0);
});

test("evenness labels front-share distributions", () => {
  assert.equal(evenness([1]), "Solo");
  assert.equal(evenness([0.5, 0.5]), "Even");
  assert.equal(evenness([0.7, 0.3]), "Fair");
  assert.equal(evenness([1, 0]), "Uneven");
});

test("suggestGroups chunks riders slowest-first into groups of the given size, with a trailing leftover", () => {
  const course = buildManualCourse(20, 200);
  const riders = {
    a: { id: "a", name: "A", w: 70, ftp: 100, pos: "road_drops", build: "medium", calib: 1 },
    b: { id: "b", name: "B", w: 70, ftp: 200, pos: "road_drops", build: "medium", calib: 1 },
    c: { id: "c", name: "C", w: 70, ftp: 300, pos: "road_drops", build: "medium", calib: 1 },
    d: { id: "d", name: "D", w: 70, ftp: 400, pos: "road_drops", build: "medium", calib: 1 },
    e: { id: "e", name: "E", w: 70, ftp: 500, pos: "road_drops", build: "medium", calib: 1 },
  };
  const { groups, leftover } = suggestGroups(["a", "b", "c", "d", "e"], riders, course.segments, p, 2);
  assert.deepEqual(groups, [["a", "b"], ["c", "d"]]);
  assert.deepEqual(leftover, ["e"]);
});

test("computeSheet seeds the slower group first (offset 0) and orders by offset", () => {
  const course = buildManualCourse(20, 200);
  const riders = {
    a: { id: "a", name: "A", w: 70, ftp: 100, pos: "road_drops", build: "medium", calib: 1 },
    b: { id: "b", name: "B", w: 70, ftp: 200, pos: "road_drops", build: "medium", calib: 1 },
    c: { id: "c", name: "C", w: 70, ftp: 300, pos: "road_drops", build: "medium", calib: 1 },
    d: { id: "d", name: "D", w: 70, ftp: 400, pos: "road_drops", build: "medium", calib: 1 },
  };
  const sheet = computeSheet(
    [{ id: "g1", members: ["a", "b"], locked: false }, { id: "g2", members: ["c", "d"], locked: false }],
    riders, course.segments, p
  );
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0].gid, "g1");
  assert.equal(sheet.rows[0].seed, 1);
  assert.equal(sheet.rows[0].offset, 0);
  assert.equal(sheet.rows[1].gid, "g2");
  assert.equal(sheet.rows[1].seed, 2);
  assert.ok(sheet.rows[1].offset > 0, "the faster group should have a positive start offset");
  assert.ok(Math.abs(sheet.tMax - sheet.rows[0].dur) < 1e-6);
  assert.ok(Math.abs(sheet.tMin - sheet.rows[1].dur) < 1e-6);
});

test("calibrationFactor raises k when the rider rode faster than predicted, ~1 for an exact match", () => {
  const course = buildManualCourse(20, 200);
  const rider = { id: "x", name: "X", w: 70, ftp: 240, pos: "road_drops", build: "medium" };
  const baseline = soloDuration({ ...rider, calib: 1 }, course.segments, p);

  const kFaster = calibrationFactor(rider, course.segments, baseline * 0.9, p, 1);
  assert.ok(kFaster > 1.1 && kFaster < 1.2, `expected ~1.14, got ${kFaster}`);

  const kMatch = calibrationFactor(rider, course.segments, baseline, p, 1);
  assert.ok(Math.abs(kMatch - 1) < 1e-6, `expected ~1, got ${kMatch}`);
});
