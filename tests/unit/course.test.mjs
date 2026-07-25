import test from "node:test";
import assert from "node:assert/strict";
import { buildCourse, parseFit } from "../../public/course.js";

test("buildCourse turns a flat point line into flat segments with no ascent", () => {
  const pp = [{ d: 0, ele: 100 }, { d: 500, ele: 100 }, { d: 1000, ele: 100 }];
  const c = buildCourse(pp, "flat");
  assert.deepEqual(c.segments, [{ dist: 500, grad: 0 }, { dist: 500, grad: 0 }]);
  assert.equal(c.distanceM, 1000);
  assert.equal(c.ascentM, 0);
  assert.equal(c.name, "flat");
});

test("buildCourse tracks grade and cumulative ascent on a real climb", () => {
  const pp = [];
  for (let i = 0; i < 20; i++) {
    pp.push({ d: i * 100, ele: i < 10 ? i * 20 : 200 }); // climbs 20m/100m for 10 steps, then flat
  }
  const c = buildCourse(pp, "ramp");
  assert.equal(c.distanceM, 1900);
  assert.equal(c.ascentM, 160);
  assert.equal(c.segments.length, 19);
  assert.deepEqual(c.segments.slice(0, 3), [
    { dist: 100, grad: 0.1 }, { dist: 100, grad: 0.1 }, { dist: 100, grad: 0.1 },
  ]);
  assert.deepEqual(c.segments.slice(-3), [
    { dist: 100, grad: 0 }, { dist: 100, grad: 0 }, { dist: 100, grad: 0 },
  ]);
  assert.equal(c.profile.length, 20);
});

test("buildCourse rejects fewer than 2 points", () => {
  assert.throws(() => buildCourse([{ d: 0, ele: 100 }], "x"), /Not enough points/);
});

test("parseFit throws when the buffer has no GPS records", () => {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint8(0, 12);        // header size
  dv.setUint32(4, 4, true);  // data size — too small to contain a real record
  assert.throws(() => parseFit(buf, "x"), /No GPS records/);
});
