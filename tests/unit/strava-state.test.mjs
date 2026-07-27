import { test } from "node:test";
import assert from "node:assert/strict";
import { signState, verifyState } from "../../lib/strava.mjs";

const ORIGINAL_SECRET = process.env.STRAVA_CLIENT_SECRET;

function restoreSecret() {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.STRAVA_CLIENT_SECRET;
  } else {
    process.env.STRAVA_CLIENT_SECRET = ORIGINAL_SECRET;
  }
}

test("signState and verifyState round-trip the payload", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const payload = { code: "test-code", rider: 42 };
  const signed = signState({ ...payload, ts: Date.now() });
  assert.ok(typeof signed === "string");
  assert.ok(signed.includes("."));
  const verified = verifyState(signed);
  assert.ok(verified);
  assert.equal(verified.code, payload.code);
  assert.equal(verified.rider, payload.rider);
  restoreSecret();
});

test("signState throws when STRAVA_CLIENT_SECRET is missing", async () => {
  delete process.env.STRAVA_CLIENT_SECRET;
  assert.throws(() => signState({ code: "test", rider: 1, ts: Date.now() }), /STRAVA_CLIENT_SECRET is required/);
  restoreSecret();
});

test("verifyState returns null when STRAVA_CLIENT_SECRET is missing", async () => {
  delete process.env.STRAVA_CLIENT_SECRET;
  const result = verifyState("a.b");
  assert.equal(result, null);
  restoreSecret();
});

test("verifyState returns null for a tampered payload segment", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const payload = { code: "test-code", rider: 42, ts: Date.now() };
  const signed = signState(payload);
  const [, sig] = signed.split(".");
  const tampered = `eyJjb2RlIjoidGFtcGVyZWQifQ.${sig}`;
  assert.equal(verifyState(tampered), null);
  restoreSecret();
});

test("verifyState returns null for a tampered signature", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const payload = { code: "test-code", rider: 42, ts: Date.now() };
  const signed = signState(payload);
  const [encoded] = signed.split(".");
  const tampered = `${encoded}.invalid_signature_bytes`;
  assert.equal(verifyState(tampered), null);
  restoreSecret();
});

test("verifyState returns null for a signature of the right length but wrong bytes", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const payload = { code: "test-code", rider: 42, ts: Date.now() };
  const signed = signState(payload);
  const [encoded, sig] = signed.split(".");
  // Create a base64url string of the same length but different content
  const wrongSig = Buffer.from("wrong-sig-bytes-of-same-length-as-original").toString("base64url").substring(0, sig.length);
  const tampered = `${encoded}.${wrongSig}`;
  assert.equal(verifyState(tampered), null);
  restoreSecret();
});

test("verifyState returns null for a timestamp older than the 15-minute window", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const oldTs = Date.now() - (20 * 60 * 1000); // 20 minutes ago
  const payload = { code: "test-code", rider: 42, ts: oldTs };
  const signed = signState(payload);
  assert.equal(verifyState(signed), null);
  restoreSecret();
});

test("verifyState returns null for malformed strings", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  assert.equal(verifyState(""), null);
  assert.equal(verifyState("abc"), null);
  assert.equal(verifyState("a.b.c"), null);
  assert.equal(verifyState(null), null);
  assert.equal(verifyState(undefined), null);
  restoreSecret();
});

test("verifyState returns null for valid JSON but not an object", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const payload = { code: "test-code", rider: 42, ts: Date.now() };
  const signed = signState(payload);
  const [, sig] = signed.split(".");
  const jsonNull = Buffer.from("null").toString("base64url");
  const tampered = `${jsonNull}.${sig}`;
  assert.equal(verifyState(tampered), null);
  restoreSecret();
});

test("verifyState returns null for a payload with missing ts", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const encoded = Buffer.from(JSON.stringify({ code: "test-code", rider: 42 })).toString("base64url");
  const sig = "fake-sig";
  const malformed = `${encoded}.${sig}`;
  assert.equal(verifyState(malformed), null);
  restoreSecret();
});

test("verifyState returns null for a multi-byte UTF-8 signature", async () => {
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  const payload = { code: "test-code", rider: 42, ts: Date.now() };
  const signed = signState(payload);
  const [encoded] = signed.split(".");
  // Create a 43-character signature with multi-byte UTF-8 (emoji)
  const multiByteSig = "A".repeat(42) + "🔐";
  const tampered = `${encoded}.${multiByteSig}`;
  assert.equal(verifyState(tampered), null);
  restoreSecret();
});
