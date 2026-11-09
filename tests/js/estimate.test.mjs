// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  confirmMessage, confirmSpend, estimateDetail, estimateLine, estimateText, needsConfirm, usdDown, usdUp,
} from "../../static/js/estimate.js";

const est = (over = {}) => ({ kind: "bulk", calls: 120, usd: 0.0039123, upper_bound: true, models: ["jev-1.14.0"],
  parts: [{ label: "rows", model: "jev-1.14.0", calls: 120, usd: 0.0039123 }], budget_usd: 2, remaining_usd: 1.98765,
  fits: true, notes: [], held_out: 0, capped: 0, ...over });

test("rounds an upper bound up and the budget left down", () => {
  assert.equal(usdUp(0.0039123), "$0.0040");
  assert.equal(usdUp(0.00019), "$0.00019");
  assert.equal(usdUp(0.000186522), "$0.00019");
  assert.equal(usdUp(0.0123), "$0.013");
  assert.equal(usdUp(1.231), "$1.24");
  assert.equal(usdUp(0), "$0");
  assert.equal(usdDown(1.98765), "$1.98");
  assert.equal(usdDown(0.0039123), "$0.0039");
  assert.equal(usdDown(0), "$0");
});

test("states calls, an upper bound, and how it compares with the budget left", () => {
  assert.equal(estimateText(est()), "120 calls · ≤ $0.0040 · fits the $1.98 left in this session's budget");
  assert.equal(estimateText(est({ calls: 1, fits: false, remaining_usd: 0.001 })),
    "1 call · ≤ $0.0040 · more than the $0.0010 left in this session's budget");
  assert.equal(estimateText(est({ remaining_usd: null, budget_usd: null })), "120 calls · ≤ $0.0040 · no session budget set");
  assert.equal(estimateText(null), "");
  assert.match(estimateText(est()), /≤/, "always an upper bound, never a measured cost");
});

test("the detail names each part and says it is not a measured cost", () => {
  const text = estimateDetail(est({ parts: [{ label: "tuned-on version", model: "jev-1.14.0", calls: 9, usd: 0.0001 },
    { label: "candidate", model: "jev-1.15.0", calls: 9, usd: 0.0001 }], held_out: 3, capped: 5, notes: ["a note"] }));
  assert.match(text, /^Upper bound, not a measured cost/);
  assert.match(text, /candidate: 9 calls to jev-1\.15\.0, ≤ \$0\.00010/);
  assert.match(text, /3 test rows left out/);
  assert.match(text, /5 rows past the 200-row cap/);
  assert.match(text, /a note$/);
});

test("only a run over the budget left needs a confirm", () => {
  assert.equal(needsConfirm(est()), false);
  assert.equal(needsConfirm(est({ fits: false })), true);
  assert.equal(needsConfirm(null), false);
  const message = confirmMessage(est({ fits: false, remaining_usd: 0.001 }));
  assert.match(message, /up to 120 live calls/);
  assert.match(message, /up to \$0\.0040 \(an upper bound, not a measured cost\)/);
  assert.match(message, /more than the \$0\.0010 left/);
});

test("confirmSpend goes ahead when the run fits, asks when it does not, and passes the run's body", async () => {
  const sent = [];
  const api = (over) => async (path, body) => { sent.push([path, body]); return est(over); };
  const asked = [];
  const ask = (answer) => (message) => { asked.push(message); return answer; };
  assert.equal(await confirmSpend(api(), "check", { id: "tickets" }, ask(false)), true);
  assert.deepEqual(sent.at(-1), ["/api/workbench/estimate", { id: "tickets", kind: "check" }]);
  assert.equal(asked.length, 0, "a run that fits starts without a dialog");
  assert.equal(await confirmSpend(api({ fits: false }), "bulk", { rows: "a" }, ask(false)), false);
  assert.equal(asked.length, 1);
  assert.equal(await confirmSpend(api({ fits: false }), "bulk", { rows: "a" }, ask(true)), true);
  const failing = async () => { throw new Error("No questions"); };
  assert.equal(await confirmSpend(failing, "bulk", {}, ask(false)), true, "the run reports its own error");
});

test("a second paid click while a preview is on its way does not start a second run", async () => {
  let release;
  const slow = () => new Promise((resolve) => { release = () => resolve(est()); });
  const first = confirmSpend(slow, "bulk", {}, () => true);
  assert.equal(await confirmSpend(slow, "bulk", {}, () => true), false);
  release();
  assert.equal(await first, true);
  assert.equal(await confirmSpend(async () => est(), "bulk", {}, () => true), true, "the lock is released");
});

test("estimateLine builds a quiet line and tolerates inputs that are not ready", () => {
  const h = (tag, attrs, ...children) => ({ tag, attrs, children, style: {}, textContent: "", title: "" });
  const el = estimateLine(h, async () => est(), "compare", () => { throw new Error("Variant B does not parse"); });
  assert.equal(el.tag, "span");
  assert.equal(el.attrs["aria-live"], "polite");
});

test("every paid Workbench run asks confirmSpend before its paid request", () => {
  const source = readFileSync(new URL("../../static/js/workbench.js", import.meta.url), "utf8");
  const body = (name) => source.match(new RegExp(`async function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
  for (const [fn, kind, path] of [["runBulk", "bulk", "/api/workbench/bulk"], ["runCompare", "compare", "/api/workbench/compare"],
    ["runCheck", "check", "/api/workbench/checks/run"], ["runDrift", "drift", "/api/workbench/checks/drift"],
    ["runUpgrade", "upgrade", "/api/workbench/checks/upgrade"], ["runTests", "items", "/api/workbench/items/run"]]) {
    const text = body(fn);
    const confirmAt = text.indexOf(`confirmSpend(api, "${kind}"`);
    assert.ok(confirmAt >= 0, `${fn} asks for a spend preview`);
    assert.ok(confirmAt < text.indexOf(`api("${path}"`), `${fn} confirms before it spends`);
    assert.ok(source.includes(`estimateLine(h, api, "${kind}"`), `a preview line sits next to the ${kind} button`);
  }
});
