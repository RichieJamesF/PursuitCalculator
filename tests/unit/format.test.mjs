import test from "node:test";
import assert from "node:assert/strict";
import { esc, fmtDur, fmtGap, addClock, gid } from "../../public/format.js";

test("esc escapes HTML-significant characters but leaves single quotes alone", () => {
  assert.equal(esc(`<b>"quote" & 'ok'</b>`), `&lt;b&gt;&quot;quote&quot; &amp; 'ok'&lt;/b&gt;`);
});

test("esc treats null/undefined as an empty string", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("fmtDur formats seconds under an hour as m:ss", () => {
  assert.equal(fmtDur(125), "2:05");
});

test("fmtDur formats seconds over an hour as h:mm:ss", () => {
  assert.equal(fmtDur(3725), "1:02:05");
});

test("fmtDur returns an em dash for non-finite input", () => {
  assert.equal(fmtDur(Infinity), "—");
  assert.equal(fmtDur(NaN), "—");
});

test("fmtGap formats a gap as +m:ss", () => {
  assert.equal(fmtGap(95), "+1:35");
});

test("addClock adds seconds to a HH:MM start time", () => {
  assert.equal(addClock("09:30", 125), "09:32:05");
});

test("addClock wraps past midnight", () => {
  assert.equal(addClock("23:50", 900), "00:05:00");
});

test("gid returns a string starting with g followed by hex characters", () => {
  assert.match(gid(), /^g[0-9a-f]+$/);
});
