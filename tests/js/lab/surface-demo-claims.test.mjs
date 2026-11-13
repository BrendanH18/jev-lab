// The Claims page's Lab surfaces (static/js/lab/surfaces/claims.js) and their hooks in static/js/claims.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { claimsExampleOf, claimsLabNote, claimsOrderOptions, claimsOrdersCtx, claimsPhotoOf, claimsResultCtx } from "../../../static/js/lab/surfaces/claims.js";
import orderDesk from "../../../static/js/lab/packs/claims/claims-order-desk.js";
import exampleFacts from "../../../static/js/lab/packs/claims/claims-example-facts.js";
import resultInsights from "../../../static/js/lab/packs/claims/claims-result-insights.js";
import { fakeEnv, textOf } from "./harness.mjs";
import { CLAIMS_KIND_LABELS, CLAIMS_POLICY, sampleClaimsExamplesCtx, sampleClaimsHistory, sampleClaimsOrdersCtx, sampleClaimsResult,
  sampleClaimsResultCtx, sampleClaimsSetup } from "./fixtures/claims.mjs";

const PAGE = readFileSync(new URL("../../../static/js/claims.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../static/claims.html", import.meta.url), "utf8");
const PYTHON = readFileSync(new URL("../../../jev/claims.py", import.meta.url), "utf8");
const WORLD = readFileSync(new URL("../../../jev/world.py", import.meta.url), "utf8");
const body = (name) => PAGE.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
const h = (tag, attrs = {}, ...children) => {
  const node = { tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) };
  node.addEventListener = (type, handler) => { node.attrs[`on${type}`] = handler; };
  return node;
};
const throwsMessage = (fn, pattern) => assert.throws(fn, (error) => error instanceof Error && pattern.test(error.message));
const plainJson = (value) => JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value);

// Rebuilds a page function from static/js/claims.js with stand-ins for what it reads.
function pageFunction(name, scope) {
  const names = Object.keys(scope);
  return new Function(...names, `${body(name)}\nreturn ${name};`)(...names.map((key) => scope[key]));
}

// ---------- claims.orders ----------

test("order items have the documented shape and values", () => {
  const ctx = sampleClaimsOrdersCtx();
  const items = ctx.items();
  assert.equal(items.length, 7);
  assert.deepEqual(Object.keys(items[0]), ["id", "position", "items", "customer", "total", "status", "delivered", "days_since_delivery", "within_window", "refunded",
    "selected", "checked"]);
  assert.deepEqual(items[3], { id: "A-1044", position: 4, items: "Cold brew starter kit", customer: "Tom Becker", total: 64, status: "delivered", delivered: true,
    days_since_delivery: 41, within_window: false, refunded: false, selected: true, checked: 1 });
  assert.deepEqual(items.map((item) => item.within_window), [true, true, null, false, null, true, null], "30 days is still inside the window");
  assert.deepEqual(items.map((item) => item.checked), [2, 1, 0, 1, 0, 0, 0]);
  assert.deepEqual([items[6].total, items[6].customer, items[6].days_since_delivery], [null, "", null]);
  assert.equal(ctx.itemName(items[1], 1), "A-1042");
  assert.ok(Object.isFrozen(items) && Object.isFrozen(items[0]));
  assert.ok(plainJson(items));
  assert.equal(ctx.items(), items, "the same objects until the list changes");
  ctx.state.order = "A-1041";
  assert.notEqual(ctx.items(), items);
  assert.deepEqual(ctx.items().map((item) => item.selected), [true, false, false, false, false, false, false]);
  assert.deepEqual(sampleClaimsOrdersCtx({ setup: null }).items(), []);
});

test("order data reads the page now", () => {
  const ctx = sampleClaimsOrdersCtx();
  assert.equal(ctx.data.selected, "A-1044");
  assert.equal(ctx.data.result_order, "A-1044");
  assert.equal(ctx.data.running, false);
  assert.deepEqual(ctx.data.settings, { ...CLAIMS_POLICY, matches_note: 0.6 });
  assert.deepEqual(ctx.data.defaults, CLAIMS_POLICY);
  assert.deepEqual(ctx.data.rules, { window_days: 30, box_pad: 0.05, note_chars: 2000 });
  assert.equal(ctx.data.calls, 4);
  assert.equal(ctx.data.history.length, 4);
  ctx.state.result = null;
  assert.equal(ctx.data.result_order, null);
  const before = sampleClaimsOrdersCtx({ setup: null });
  assert.deepEqual([before.data.selected, before.data.settings, before.data.defaults], [null, null, null]);
});

test("order actions keep the picker's guards", () => {
  const ctx = sampleClaimsOrdersCtx();
  throwsMessage(() => ctx.actions.select("A-9999"), /no order "A-9999"/);
  assert.equal(ctx.actions.select("A-1044"), "A-1044");
  assert.deepEqual(ctx.log, [], "choosing the selected order changes nothing");
  assert.ok(ctx.state.result, "and keeps the result");
  assert.equal(ctx.actions.select("A-1043"), "A-1043");
  assert.deepEqual(ctx.log, [["select", "A-1043"]]);
  assert.equal(ctx.state.result, null, "another order clears the result, as the picker does");
  const busy = sampleClaimsOrdersCtx({ running: true });
  throwsMessage(() => busy.actions.select("A-1041"), /Wait for the check/);
  throwsMessage(() => busy.actions.focusOrder(), /disabled while a check runs/);
  throwsMessage(() => sampleClaimsOrdersCtx({ setup: null }).actions.select("A-1041"), /not loaded/);
  const ready = sampleClaimsOrdersCtx();
  ready.actions.focusOrder();
  assert.deepEqual(ready.log, [["focusOrder"]]);
  throwsMessage(() => claimsOrdersCtx({ setup: sampleClaimsSetup() }).actions.select("A-1041"), /cannot do that here/);
  ready.refresh();
  assert.equal(ready.refreshes, 1);
  assert.equal(ready.actions.replaceItems, undefined, "orders are read-only");
  assert.equal(ready.actions.importItems, undefined);
});

// ---------- claims.examples ----------

test("example items have the documented shape and values", () => {
  const ctx = sampleClaimsExamplesCtx();
  const items = ctx.items();
  assert.equal(items.length, 5);
  assert.deepEqual(Object.keys(items[0]), ["index", "position", "label", "order", "sample", "sample_about", "note", "chars", "words", "expect", "loaded", "checked"]);
  assert.deepEqual(items.map((item) => item.label), ["Torn bag", "Intact bag", "Crushed box", "Grinder", "Example 5"]);
  assert.deepEqual(items.map((item) => item.loaded), [false, false, true, false, false]);
  assert.deepEqual(items.map((item) => item.checked), [1, 1, 1, 0, 0], "the upload on A-1042 is not the Grinder example");
  assert.deepEqual([items[4].sample_about, items[4].expect, items[4].words, items[4].chars], ["", null, 0, 3]);
  assert.equal(items[2].sample_about, "A shipping box with a crushed corner");
  assert.equal(ctx.itemName(items[3], 3), "Grinder");
  assert.ok(Object.isFrozen(items[0]) && plainJson(items));
  assert.equal(ctx.data.loaded, 2);
  assert.deepEqual(ctx.data.draft, { order: "A-1044", note: "The kit's box came crushed on one corner.",
    photo: { source: "sample", name: "crushed-box", about: "A shipping box with a crushed corner" } });
  assert.deepEqual(ctx.data.samples.map((sample) => sample.name), ["torn-bag", "intact-bag", "crushed-box", "grinder-ok"]);
  assert.equal(ctx.data.orders.length, 7);
  assert.equal(ctx.data.labels.decisions.retake, "Ask for another photo");
  ctx.state.note = "Edited.";
  assert.equal(ctx.data.loaded, null, "an edited note is no longer the example");
  assert.deepEqual(sampleClaimsExamplesCtx({ setup: null }).items(), []);
  assert.equal(sampleClaimsExamplesCtx({ setup: null }).data.draft, null);
});

test("example actions keep the chips' guards", () => {
  const ctx = sampleClaimsExamplesCtx();
  throwsMessage(() => ctx.actions.use(9), /no example number 9/);
  throwsMessage(() => ctx.actions.use("1"), /no example number/);
  ctx.actions.use(0);
  assert.deepEqual(ctx.log, [["use", 0]]);
  assert.equal(ctx.state.result, null);
  assert.equal(ctx.data.loaded, 0);
  const busy = sampleClaimsExamplesCtx({ running: true });
  throwsMessage(() => busy.actions.use(0), /Wait for the check/);
  throwsMessage(() => busy.actions.focusNote(), /disabled while a check runs/);
  throwsMessage(() => busy.actions.focusRun(), /already running/);
  throwsMessage(() => sampleClaimsExamplesCtx({ setup: null }).actions.use(0), /not loaded/);
  ctx.actions.focusNote();
  ctx.actions.focusRun();
  assert.deepEqual(ctx.log.slice(1), [["focusNote"], ["focusRun"]]);
  assert.equal(ctx.actions.replaceItems, undefined);
});

// ---------- claims.result ----------

test("answer items have the documented shape, cuts and checks", () => {
  const ctx = sampleClaimsResultCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["shows_item", "damage_visible", "severity", "damage_kind", "matches_note", "damage_box"]);
  assert.deepEqual(Object.keys(items[0]), ["id", "position", "type", "instructions", "value", "display", "label", "scale", "probabilities", "top", "confidence",
    "box", "cuts", "check", "answer"]);
  assert.deepEqual(items.map((item) => item.display), ["94.0%", "81.0%", "1.20 / 3", "crushed or dented", "62.0%", "40% × 35%"]);
  assert.deepEqual(items.map((item) => item.label), ["", "", "Cosmetic: packaging is scuffed or dented but the product looks usable", "Crushed or dented", "", ""]);
  assert.deepEqual(items.map((item) => item.cuts), [[{ key: "shows_order", at: 0.5 }], [{ key: "damage_no", at: 0.3 }, { key: "damage_yes", at: 0.7 }],
    [{ key: "full_refund_at", at: 1.5 }], [], [{ key: "matches_note", at: 0.6 }], [{ key: "box_confidence", at: 0.6 }]]);
  assert.deepEqual(items.map((item) => item.check?.id ?? null), ["shows_item", "damage", null, null, "matches_note", null]);
  assert.deepEqual(items[5].box, { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45 }, "the raw edges, not the padded ones");
  assert.deepEqual([items[5].value, items[5].confidence, items[0].confidence, items[2].scale], [null, 0.52, null, 3]);
  assert.deepEqual(items[3].top, { key: "crushed_or_dented", p: 0.66 });
  assert.equal(items[0].probabilities[1].key, "no");
  assert.ok(Math.abs(items[0].probabilities[1].p - 0.06) < 1e-12);
  assert.equal(ctx.itemName(items[2], 2), "severity");
  assert.ok(Object.isFrozen(items[0].answer) && plainJson(items));
  assert.equal(ctx.items(), items);
  // A re-decide replaces the policy and verdict objects: the cuts and checks follow.
  const result = ctx.state.result;
  Object.assign(result, { policy: { ...result.policy, matches_note: 0.7 }, verdict: { ...result.verdict,
    checks: result.verdict.checks.map((check) => (check.id === "matches_note" ? { ...check, ok: false, level: "review" } : check)) } });
  assert.notEqual(ctx.items(), items);
  assert.deepEqual(ctx.items()[4].cuts, [{ key: "matches_note", at: 0.7 }]);
  assert.equal(ctx.items()[4].check.ok, false);
});

test("result data before and after a check, and on a model without Box", () => {
  const ctx = sampleClaimsResultCtx();
  assert.deepEqual(ctx.data.input, { order: "A-1044", note: "The kit's box came crushed on one corner.",
    photo: { source: "sample", name: "crushed-box", about: "A shipping box with a crushed corner" }, example: "Crushed box" });
  assert.equal(ctx.data.verdict.decision, "review");
  assert.equal(ctx.data.location.padded, true);
  assert.deepEqual(ctx.data.policy, { ...CLAIMS_POLICY, matches_note: 0.6 });
  assert.deepEqual(Object.keys(ctx.data.policy), Object.keys(ctx.data.limits), "policies list keys in slider order");
  assert.deepEqual(ctx.data.changed, ["matches_note"]);
  assert.equal(ctx.data.meta.cost_usd, 0.000412);
  assert.deepEqual(ctx.data.image, { format: "png", width: 640, height: 480, bytes: 18432 });
  assert.equal(ctx.data.box_supported, true);
  assert.equal(ctx.data.note, "Re-decided in 2 ms · no Jev call");
  assert.equal(ctx.data.labels.kinds.crushed_or_dented, "Crushed or dented");
  assert.equal(ctx.data.labels.remedies.replacement_or_credit, "50% credit or a replacement");
  assert.equal(ctx.data.questions.damage_box.type, "box");
  assert.ok(Object.isFrozen(ctx.data.verdict.checks[0]));
  assert.notEqual(ctx.data.verdict, ctx.state.result.verdict, "a copy, so a pack cannot change the page's result");
  const none = sampleClaimsResultCtx({ result: null, input: null });
  assert.deepEqual(none.items(), []);
  for (const field of ["input", "facts", "evidence", "location", "verdict", "policy", "questions", "meta", "trace", "image", "box_supported"]) {
    assert.equal(none.data[field], null, field);
  }
  assert.deepEqual(none.data.changed, ["matches_note"], "the sliders exist before a check");
  const early = sampleClaimsResultCtx({ setup: null });
  assert.deepEqual([early.data.settings, early.data.defaults, early.data.changed], [null, null, []]);
  const old = sampleClaimsResult();
  delete old.answers.damage_box;
  old.box_supported = false;
  const noBox = sampleClaimsResultCtx({ result: old });
  assert.deepEqual(noBox.items().map((item) => item.id), ["shows_item", "damage_visible", "severity", "damage_kind", "matches_note"]);
  assert.equal(noBox.data.box_supported, false);
});

test("setPolicy moves sliders only on their grid, through the page's own path", () => {
  const ctx = sampleClaimsResultCtx();
  throwsMessage(() => ctx.actions.setPolicy({}), /at least one/);
  throwsMessage(() => ctx.actions.setPolicy({ shows_item: 0.5 }), /no policy setting "shows_item"/);
  throwsMessage(() => ctx.actions.setPolicy({ damage_yes: 0.72 }), /steps of 0\.05/);
  throwsMessage(() => ctx.actions.setPolicy({ auto_limit_usd: 405 }), /from 0 to 400/);
  throwsMessage(() => ctx.actions.setPolicy({ full_refund_at: "lots" }), /must be a number/);
  throwsMessage(() => ctx.actions.setPolicy({ damage_no: Number.NaN }), /must be a number/);
  assert.deepEqual(ctx.log, [], "a refused change reaches nothing");
  const same = ctx.actions.setPolicy({ matches_note: 0.6 });
  assert.deepEqual([same, ctx.log], [{ ...CLAIMS_POLICY, matches_note: 0.6 }, []], "a change that moves nothing does not re-decide");
  const next = ctx.actions.setPolicy({ damage_yes: "0.85", auto_limit_usd: 250, full_refund_at: 0.3 });
  assert.deepEqual(next, { ...CLAIMS_POLICY, matches_note: 0.6, damage_yes: 0.85, auto_limit_usd: 250, full_refund_at: 0.3 });
  assert.deepEqual(ctx.log, [["setPolicy", { ...CLAIMS_POLICY, matches_note: 0.6, damage_yes: 0.85, auto_limit_usd: 250, full_refund_at: 0.3 }]]);
  ctx.actions.resetPolicy();
  assert.deepEqual(ctx.state.settings, CLAIMS_POLICY);
  ctx.actions.focusPolicy("box_confidence");
  throwsMessage(() => ctx.actions.focusPolicy("severity"), /no policy setting/);
  ctx.actions.inspect();
  assert.deepEqual(ctx.log.slice(1), [["resetPolicy"], ["focusPolicy", "box_confidence"], ["inspect"]]);
  throwsMessage(() => sampleClaimsResultCtx({ result: null }).actions.inspect(), /Check a claim first/);
  throwsMessage(() => sampleClaimsResultCtx({ setup: null }).actions.setPolicy({ damage_yes: 0.5 }), /not loaded/);
  throwsMessage(() => sampleClaimsResultCtx({ setup: null }).actions.resetPolicy(), /not loaded/);
  const noResult = sampleClaimsResultCtx({ result: null });
  noResult.actions.setPolicy({ damage_no: 0.25 });
  assert.equal(noResult.state.settings.damage_no, 0.25, "the sliders move without a result too");
  assert.equal(ctx.actions.replaceItems, undefined, "answers are read-only");
  assert.equal(ctx.actions.importItems, undefined);
});

test("history keeps the decision made when each check was sent, at most 50, in memory", () => {
  const ctx = sampleClaimsResultCtx();
  const history = ctx.data.history;
  assert.deepEqual(history.map((entry) => [entry.call, entry.order, entry.example, entry.photo.source, entry.decided.decision, entry.decided.amount]), [
    [1, "A-1041", "Torn bag", "sample", "approve", 38], [2, "A-1041", "Intact bag", "sample", "retake", 19],
    [3, "A-1042", null, "upload", "review", 249], [4, "A-1044", "Crushed box", "sample", "review", 32]]);
  assert.deepEqual(history[3].decided.policy, CLAIMS_POLICY, "the policy when sent, not the one moved since");
  assert.equal(history[2].box_supported, false);
  assert.equal(history[2].meta.question_count, 5);
  assert.equal(Object.keys(history[2].answers).length, 5);
  assert.ok(Object.isFrozen(history[0]) && Object.isFrozen(history[0].answers) && plainJson(history));
  assert.equal(ctx.data.history[0], history[0], "entries keep their identity across reads");
  const many = Array.from({ length: 53 }, (_, index) => ({ ...sampleClaimsHistory()[0], call: index + 1 }));
  const capped = sampleClaimsResultCtx({ history: many, calls: 53 });
  assert.deepEqual([capped.data.history.length, capped.data.history[0].call, capped.data.calls], [50, 4, 53]);
  assert.deepEqual(sampleClaimsResultCtx({ history: [], calls: 0 }).data.history, []);
});

test("photo and example helpers never carry picture bytes", () => {
  assert.deepEqual(claimsPhotoOf({ sample: "torn-bag", url: "/img/samples/torn-bag.png", about: "A torn bag" }), { source: "sample", name: "torn-bag", about: "A torn bag" });
  const upload = claimsPhotoOf({ format: "jpg", data_base64: "AAAA", width: 800, height: 600, url: "data:image/jpeg;base64,AAAA", name: "box.jpg" });
  assert.deepEqual(upload, { source: "upload", name: "box.jpg", about: "" });
  assert.equal(claimsPhotoOf(null), null);
  const examples = sampleClaimsSetup().examples;
  assert.equal(claimsExampleOf({ order: "A-1041", note: ` ${examples[0].note} `, photo: { source: "sample", name: "torn-bag" } }, examples), "Torn bag");
  assert.equal(claimsExampleOf({ order: "A-1041", note: examples[0].note, photo: { source: "upload", name: "torn-bag" } }, examples), null);
  assert.equal(claimsExampleOf({ order: "A-1047", note: "", photo: { source: "sample", name: "mystery" } }, examples), "Example 5");
});

// ---------- mirrors of the page and the Python ----------

test("slider limits, defaults and rules match the page and jev/", () => {
  const ctx = sampleClaimsResultCtx();
  const sliders = [...body("renderPolicy").matchAll(/slider\("(\w+)", "([^"]+)", ([\d.]+), ([\d.]+), ([\d.]+)/g)]
    .map(([, key, label, min, max, step]) => [key, { min: Number(min), max: Number(max), step: Number(step), label }]);
  assert.deepEqual(Object.entries(ctx.data.limits).map(([key, limit]) => [key, { min: limit.min, max: limit.max, step: limit.step, label: limit.label }]), sliders);
  const defaults = Object.fromEntries([...PYTHON.match(/DEFAULT_POLICY = \{([^}]*)\}/)[1].matchAll(/"(\w+)": ([\d.]+)/g)].map(([, key, value]) => [key, Number(value)]));
  assert.deepEqual(defaults, { ...CLAIMS_POLICY });
  assert.deepEqual(Object.keys(defaults).sort(), Object.keys(ctx.data.limits).sort());
  assert.equal(Number(WORLD.match(/^REFUND_WINDOW_DAYS = (\d+)$/m)[1]), ctx.data.rules.window_days);
  assert.equal(Number(PYTHON.match(/^BOX_PAD = ([\d.]+)$/m)[1]), ctx.data.rules.box_pad);
  assert.match(PYTHON, new RegExp(`note\\.strip\\(\\)\\[:${ctx.data.rules.note_chars}\\]`));
  assert.deepEqual(Object.keys(CLAIMS_KIND_LABELS), [...PYTHON.match(/DAMAGE_KINDS = \{([^}]*)\}/)[1].matchAll(/"(\w+)":/g)].map(([, key]) => key));
});

// ---------- Lab filters and sorts reach every surface ----------

test("shown() applies Lab filters and sorts after the page's order", () => {
  const lab = createLab([orderDesk, exampleFacts, resultInsights]);
  const hook = (id) => ({ matches: (item, ctx) => lab.matches(id, item, ctx), arrange: (list, ctx) => lab.arrange(id, list, ctx) });
  const orders = sampleClaimsOrdersCtx(hook("claims.orders"));
  assert.deepEqual(orders.shown(), orders.items(), "with no Lab setting, shown() is the page's list");
  lab.view("claims.orders").filters = [{ key: "claims-order-desk/delivered", op: "with" }];
  lab.view("claims.orders").sort = { key: "claims-order-desk/total", dir: "desc" };
  assert.deepEqual(orders.shown().map((item) => item.id), ["A-1042", "A-1046", "A-1044", "A-1041"]);
  assert.equal(lab.active("claims.orders"), 2);
  lab.reset("claims.orders");
  assert.deepEqual(orders.shown().map((item) => item.id), ["A-1041", "A-1042", "A-1043", "A-1044", "A-1045", "A-1046", "A-1047"]);

  const examples = sampleClaimsExamplesCtx(hook("claims.examples"));
  lab.view("claims.examples").filters = [{ key: "claims-example-facts/order", op: "is", value: "A-1041" }];
  assert.deepEqual(examples.shown().map((item) => item.label), ["Torn bag", "Intact bag"]);

  const result = sampleClaimsResultCtx(hook("claims.result"));
  lab.view("claims.result").filters = [{ key: "claims-result-insights/close_call", op: "with" }];
  assert.deepEqual(result.shown().map((item) => item.id), ["matches_note", "damage_box"]);
  lab.view("claims.result").filters = [];
  lab.view("claims.result").sort = { key: "claims-result-insights/top_probability", dir: "asc" };
  assert.deepEqual(result.shown().map((item) => item.id), ["matches_note", "damage_kind", "severity", "damage_visible", "shows_item", "damage_box"],
    "the box has no top probability and sorts last");
  for (const [id, ctx, count] of [["claims.orders", orders, 40], ["claims.examples", examples, 33], ["claims.result", result, 43]]) {
    const section = lab.section(fakeEnv(), id, ctx);
    assert.match(textOf(section), new RegExp(`Lab tools · ${count}`));
    assert.equal(textOf(section).includes("Edits"), false, "read-only surfaces show no Edits block");
  }
});

// ---------- the page's hooks ----------

test("order picker helpers keep the selected order and the page's order", () => {
  const orders = sampleClaimsSetup().orders;
  const all = sampleClaimsOrdersCtx().items();
  const plain = claimsOrderOptions(orders, all, "A-1044");
  assert.deepEqual(plain.map((option) => [option.order.id, option.selected, option.hidden]), orders.map((order) => [order.id, order.id === "A-1044", false]));
  assert.equal(plain[0].order, orders[0], "options carry the page's own order objects");
  const filtered = claimsOrderOptions(orders, [all[1], all[0]], "A-1044");
  assert.deepEqual(filtered.map((option) => [option.order.id, option.selected, option.hidden]), [["A-1044", true, true], ["A-1042", false, false], ["A-1041", false, false]]);
  assert.deepEqual(claimsOrderOptions(orders, [], "A-1047").map((option) => option.order.id), ["A-1047"]);
  assert.deepEqual(claimsOrderOptions(orders, all, "").filter((option) => option.selected).map((option) => option.order.id), ["A-1041"], "falls back to the first order");
  assert.equal(claimsLabNote(3, 7, 0, "order"), null);
  assert.equal(claimsLabNote(3, 7, 2, "order"), "3 of 7 orders shown · 2 Lab settings active");
  assert.equal(claimsLabNote(1, 1, 1, "answer"), "1 of 1 answer shown · 1 Lab setting active");
  assert.equal(claimsLabNote(0, 6, 1, "answer"), "No answer matches the Lab filters.");
});

test("the page's order picker renders shown(), keeps the selection, and notes Lab only while active", () => {
  const lab = createLab([orderDesk]);
  const setup = sampleClaimsSetup();
  const S = { setup, order: "A-1044", running: false };
  const ORDERS = claimsOrdersCtx({ setup, selected: () => S.order, matches: (item, ctx) => lab.matches("claims.orders", item, ctx),
    arrange: (list, ctx) => lab.arrange("claims.orders", list, ctx) });
  const labNote = pageFunction("labNote", { claimsLabNote, LAB: lab, h });
  const chosen = [];
  const money = (value) => `$${Number(value).toFixed(2)}`;
  const orderPicker = pageFunction("orderPicker", { S, h, LAB: lab, ORDERS, ORDERS_ID: "claims.orders", money, claimsOrderOptions, labNote,
    selectOrder: (id) => chosen.push(id), resetLab: () => {}, renderOrderPick: () => {} });
  let [field, note] = orderPicker();
  const select = field.children[1];
  assert.equal(note, null, "no note without a Lab setting");
  assert.deepEqual(select.children.map((option) => [option.attrs.value, option.attrs.selected, textOf(option)]), setup.orders.map((o) => [o.id, o.id === "A-1044",
    `${o.id} · ${o.customer} · ${money(o.total)}`]), "exactly the options the page rendered before Lab");
  select.value = "A-1042";
  select.attrs.onchange();
  assert.deepEqual(chosen, ["A-1042"]);
  lab.view("claims.orders").filters = [{ key: "claims-order-desk/status", op: "is", value: "in transit" }];
  [field, note] = orderPicker();
  assert.deepEqual(field.children[1].children.map((option) => [option.attrs.value, option.attrs.selected, textOf(option)]), [
    ["A-1044", true, "A-1044 · Tom Becker · $64.00 · hidden by Lab filters"], ["A-1043", false, "A-1043 · Priya Nair · $54.00"]]);
  assert.match(textOf(note), /^1 of 7 orders shown · 1 Lab setting active/);
  S.running = true;
  assert.equal(orderPicker()[0].children[1].attrs.disabled, true, "the picker stays disabled while a check runs");
});

test("the page's example chips and answer cards render shown(), with Lab's note only while active", () => {
  const lab = createLab([exampleFacts, resultInsights]);
  const setup = sampleClaimsSetup();
  const result = sampleClaimsResult();
  const S = { setup, result, running: false };
  const labNote = pageFunction("labNote", { claimsLabNote, LAB: lab, h });
  const EXAMPLES = sampleClaimsExamplesCtx({ setup, matches: (item, ctx) => lab.matches("claims.examples", item, ctx), arrange: (list, ctx) => lab.arrange("claims.examples", list, ctx) });
  const loaded = [];
  const exampleNodes = pageFunction("exampleNodes", { S, h, LAB: lab, EXAMPLES, EXAMPLES_ID: "claims.examples", labNote, useExample: (ex) => loaded.push(ex),
    resetLab: () => {}, renderExamples: () => {} });
  let [chips, note] = exampleNodes();
  assert.equal(note, null);
  assert.equal(chips.attrs.class, "chips");
  assert.deepEqual(chips.children.map(textOf), ["Torn bag", "Intact bag", "Crushed box", "Grinder", "Example 5"]);
  chips.children[3].attrs.onclick();
  assert.equal(loaded[0], setup.examples[3], "a chip loads its own example");
  lab.view("claims.examples").filters = [{ key: "claims-example-facts/expectation", op: "is", value: "retake" }];
  [chips, note] = exampleNodes();
  assert.deepEqual(chips.children.map(textOf), ["Intact bag", "Grinder"]);
  chips.children[0].attrs.onclick();
  assert.equal(loaded[1], setup.examples[1]);
  assert.match(textOf(note), /^2 of 5 examples shown · 1 Lab setting active/);
  lab.view("claims.examples").filters = [{ key: "claims-example-facts/chars", op: "min", value: "999" }];
  assert.match(textOf(exampleNodes()[1]), /^No example matches the Lab filters\./);

  const RESULT = claimsResultCtx({ setup, result: () => S.result, kindLabels: CLAIMS_KIND_LABELS, matches: (item, ctx) => lab.matches("claims.result", item, ctx),
    arrange: (list, ctx) => lab.arrange("claims.result", list, ctx) });
  const answerCard = (qid, answer, question) => ({ tag: "card", attrs: { qid, answer, question }, children: [] });
  const answerNodes = pageFunction("answerNodes", { S, h, LAB: lab, RESULT, RESULT_ID: "claims.result", answerCard, labNote, resetLab: () => {}, renderAnswerCards: () => {} });
  let [cards, cardNote] = answerNodes();
  assert.deepEqual(cards.map((card) => card.attrs.qid), Object.keys(result.answers), "every answer in the response's order, as before");
  assert.equal(cards[0].attrs.answer, result.answers.shows_item, "the card gets the page's own answer object");
  assert.equal(cards[5].attrs.question, result.trace.request.questions.damage_box);
  assert.equal(cardNote, null);
  lab.view("claims.result").filters = [{ key: "claims-result-insights/type", op: "is", value: "noul" }];
  [cards, cardNote] = answerNodes();
  assert.deepEqual(cards.map((card) => card.attrs.qid), ["shows_item", "damage_visible", "matches_note"]);
  assert.match(textOf(cardNote), /^3 of 6 answers shown · 1 Lab setting active/);
  lab.view("claims.result").filters = [{ key: "claims-result-insights/yes_probability", op: "min", value: "2" }];
  [cards, cardNote] = answerNodes();
  assert.equal(cards, null);
  assert.match(textOf(cardNote), /^No answer matches the Lab filters\./);
});

test("the page wires Lab once and moves the policy, the order and the history only through its own paths", async () => {
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/claims\.js";/);
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  assert.match(PAGE, /from "\.\/lab\/surfaces\/claims\.js";/);
  assert.match(body("boot"), /await initChrome\("\/claims"\);\n {2}installLab\(LAB\);/);
  const form = body("renderForm");
  assert.match(form, /h\("div", \{ id: "claim-examples"[^\n]*exampleNodes\(\)\),\n\s+LAB\.section\(labEnv, EXAMPLES_ID, EXAMPLES/);
  assert.match(form, /h\("div", \{ id: "order-pick"[^\n]*orderPicker\(\)\),/);
  assert.match(form, /LAB\.section\(labEnv, ORDERS_ID, ORDERS/);
  assert.match(body("renderResult"), /^function renderResult\(\) \{\n {2}renderResultLab\(\);/, "the result's Lab tools render with and without a result");
  assert.match(body("renderResult"), /id: "claim-answers"[^\n]*answerNodes\(\)/);
  assert.match(body("renderResult"), /h\("details", \{ open: LAB\.active\(RESULT_ID\) > 0 \}/, "closed as before unless a Lab setting is active");
  assert.match(body("renderResultLab"), /LAB\.section\(labEnv, RESULT_ID, RESULT/);
  assert.match(HTML, /<div class="panel" id="result">[^\n]*<\/div>\n\s+<div id="result-lab" class="hidden"><\/div>/, "outside #result, which every slider move rebuilds");
  assert.match(HTML, /<\/head>/);
  assert.match(body("renderPolicy"), /"data-policy": key/);
  assert.match(body("renderPolicy"), /onclick: \(\) => applyPolicy\(S\.setup\.policy\)/);

  // applyPolicy is exactly what the Reset button used to do: copy, bump the revision, redraw, re-decide.
  const calls = [];
  const P = { policy: {}, policyRev: 4 };
  const next = { damage_yes: 0.8 };
  pageFunction("applyPolicy", { S: P, renderPolicy: () => calls.push("renderPolicy"), redecide: () => calls.push("redecide") })(next);
  assert.deepEqual([P.policy, P.policy !== next, P.policyRev, calls], [{ damage_yes: 0.8 }, true, 5, ["renderPolicy", "redecide"]]);

  // selectOrder is what the picker's change handler used to do.
  const O = { order: "A-1044", result: {} };
  const drawn = [];
  pageFunction("selectOrder", { S: O, renderForm: () => drawn.push("form"), renderResult: () => drawn.push("result") })("A-1042");
  assert.deepEqual([O.order, O.result, drawn], ["A-1042", null, ["form", "result"]]);

  // A check records the inputs and the decision as sent, before a slider moved during the call re-decides.
  let sent = null;
  const T = { image: { sample: "crushed-box", url: "/img/samples/crushed-box.png", about: "A shipping box with a crushed corner" }, order: "A-1044",
    note: "The kit's box came crushed on one corner.", policy: { ...CLAIMS_POLICY }, policyRev: 0, running: false, calls: 0, history: [] };
  const check = pageFunction("check", {
    S: T, toast: () => {}, claimsPhotoOf, renderForm: () => {}, renderResult: () => {}, handleError: (error) => { throw error; }, HISTORY_LIMIT: 2,
    api: async () => { T.policyRev++; sent = sampleClaimsResult(); return sent; },
    decideAgain: async () => { Object.assign(T.result, { verdict: { ...T.result.verdict, decision: "approve" } }); },
  });
  await check();
  await check();
  await check();
  assert.equal(T.calls, 3);
  assert.deepEqual(T.history.map((entry) => entry.call), [2, 3], "capped at the page's limit");
  assert.equal(T.result.verdict.decision, "approve", "the shown result was re-decided");
  assert.equal(T.history[1].verdict.decision, "review", "the entry keeps the verdict as sent, not the re-decided one");
  assert.equal(T.history[1].answers, sent.answers);
  assert.deepEqual(T.history[1].input, { order: "A-1044", note: "The kit's box came crushed on one corner.",
    photo: { source: "sample", name: "crushed-box", about: "A shipping box with a crushed corner" } });
  assert.equal(T.resultInput, T.history[1].input);
  assert.equal(JSON.stringify(T.history).includes("data:image"), false);
  assert.equal(T.running, false);
});
