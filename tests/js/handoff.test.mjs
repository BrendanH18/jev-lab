// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { HANDOFF_KEY, HANDOFF_TTL_MS, handoffFromTrace, readHandoff, writeHandoff } from "../../static/js/handoff.js";

class Storage {
  constructor(limit = Infinity) { this.map = new Map(); this.limit = limit; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { if (v.length > this.limit) throw new Error("QuotaExceededError"); this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

const QUESTIONS = { damage: { type: "noul", instructions: "Does `photo` show damage?" } };
const UPLOAD = Buffer.from("not really a jpeg, but bytes all the same").toString("base64");
// The server's reference for an upload (jev/images.py new_ref): label plus the first 12 hex digits of its SHA-256.
const UPLOAD_REF = `photo-${createHash("sha256").update(Buffer.from(UPLOAD, "base64")).digest("hex").slice(0, 12)}`;

test("a request with a sample picture and an uploaded one keeps both, by reference", async () => {
  const trace = { request: {
    model: "jev-1.14.0", questions: QUESTIONS, state: { photo: UPLOAD_REF, other: "photo-aaaaaaaaaaaa" },
    assets: {
      [UPLOAD_REF]: { type: "image", format: "jpg", data_base64: "<JPEG 640×480, 40 KB, omitted from this view>" },
      "photo-aaaaaaaaaaaa": { type: "image", format: "png", data_base64: "<omitted>", sample: "torn-bag" },
    } }, response: { answers: { damage: { type: "noul", noul: 0.9 } } } };
  const h = await handoffFromTrace(trace, "Claims", ["c29tZXRoaW5nIGVsc2U=", UPLOAD], 1000);
  assert.deepEqual(h.images, { [UPLOAD_REF]: { format: "jpg", data_base64: UPLOAD }, "photo-aaaaaaaaaaaa": { sample: "torn-bag" } });
  assert.equal(h.source, "Claims");
  assert.equal(h.model, "jev-1.14.0");
  assert.deepEqual(h.state, trace.request.state);
  assert.deepEqual(h.questions, QUESTIONS);
  assert.equal("answers" in h || "response" in h, false, "answers never travel");
});

test("an uploaded picture the page no longer holds is refused, not dropped", async () => {
  const trace = { request: { questions: QUESTIONS, state: { photo: UPLOAD_REF },
    assets: { [UPLOAD_REF]: { type: "image", format: "jpg", data_base64: "<omitted>" } } } };
  await assert.rejects(handoffFromTrace(trace, "Claims", []), /uploaded picture/);
  await assert.rejects(handoffFromTrace(trace, "Claims", ["c29tZXRoaW5nIGVsc2U="]), /uploaded picture/);
});

test("a trace without questions cannot be opened", async () => {
  await assert.rejects(handoffFromTrace({ request: { state: "hi", questions: {} } }, "Shield"), /no questions/);
  await assert.rejects(handoffFromTrace({}, "Shield"), /no questions/);
});

test("a handoff is read once, then gone", async () => {
  const storage = new Storage();
  const h = await handoffFromTrace({ request: { questions: QUESTIONS, state: "text state" } }, "Shield", [], 5000);
  writeHandoff(storage, h);
  assert.deepEqual(readHandoff(storage, 6000), { source: "Shield", model: null, state: "text state", questions: QUESTIONS, images: {} });
  assert.equal(storage.getItem(HANDOFF_KEY), null);
  assert.equal(readHandoff(storage, 6000), null);
});

test("a stale, future, malformed, or foreign handoff is ignored and removed", async () => {
  const h = await handoffFromTrace({ request: { questions: QUESTIONS, state: "x" } }, "Find", [], 10_000);
  const cases = [
    [JSON.stringify(h), 10_000 + HANDOFF_TTL_MS + 1],
    [JSON.stringify(h), 10_000 - HANDOFF_TTL_MS - 1],
    ["{not json", 10_000],
    [JSON.stringify({ ...h, v: 99 }), 10_000],
    [JSON.stringify({ ...h, questions: [] }), 10_000],
    [JSON.stringify({ ...h, state: undefined }), 10_000],
  ];
  for (const [text, now] of cases) {
    const storage = new Storage();
    storage.setItem(HANDOFF_KEY, text);
    assert.equal(readHandoff(storage, now), null, text);
    assert.equal(storage.getItem(HANDOFF_KEY), null);
  }
  assert.notEqual(readHandoff(Object.assign(new Storage(), { map: new Map([[HANDOFF_KEY, JSON.stringify(h)]]) }), 10_000 + HANDOFF_TTL_MS), null);
});

test("a request too large for the browser's storage says so", async () => {
  const h = await handoffFromTrace({ request: { questions: QUESTIONS, state: "x".repeat(100) } }, "Find");
  assert.throws(() => writeHandoff(new Storage(50), h), /would not hold this request/);
});

test("storage the browser refuses to read means no handoff", () => {
  const broken = { getItem() { throw new Error("SecurityError"); }, removeItem() {} };
  assert.equal(readHandoff(broken), null);
});
