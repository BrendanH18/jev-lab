// The Shield page's Lab surfaces (static/js/lab/surfaces/shield.js) and their hooks in static/js/shield.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { shieldInboxCtx, shieldResultCtx } from "../../../static/js/lab/surfaces/shield.js";
import * as surfaceModule from "../../../static/js/lab/surfaces/shield.js";
import inboxPack from "../../../static/js/lab/packs/shield/shield-inbox-triage.js";
import resultPack from "../../../static/js/lab/packs/shield/shield-signal-insights.js";
import { fakeDom, textOf } from "./harness.mjs";
import {
  CATEGORY_LABELS, COMPOSE_ID, DEFAULT_POLICY, DEFAULT_WEIGHTS, DRAFT, IDENTITY_LABELS, MESSAGES, SHIELD_BATCH, SIGNAL_NAMES,
  inboxById, sampleShieldInboxCtx, sampleShieldResultCtx, sampleShieldResults, signalsById,
} from "./fixtures/shield.mjs";

const PAGE = readFileSync(new URL("../../../static/js/shield.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../static/shield.html", import.meta.url), "utf8");
const PYTHON = readFileSync(new URL("../../../jev/shield.py", import.meta.url), "utf8");
const body = (name) => PAGE.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
const ids = (messages) => messages.map((m) => m.id || "(no id)");
const throwsMessage = (fn, pattern) => assert.throws(fn, (error) => error instanceof Error && pattern.test(error.message));
const literal = (name) => new Function(`return ${PAGE.match(new RegExp(`const ${name} = (\\{[^]*?\\});`))[1]}`)();

// ---------- shield.inbox: items ----------

test("inbox items have the documented shape and values", () => {
  const ctx = sampleShieldInboxCtx();
  const items = ctx.items();
  assert.equal(items.length, 9);
  assert.deepEqual(Object.keys(items[0]), ["id", "position", "from_name", "from_email", "subject", "body", "sender_domain", "attachments", "note", "expected",
    "attack", "selected", "pending", "status", "error", "verdict", "answers", "fact", "meta", "matched"]);
  assert.deepEqual(items.map((item) => item.id), ["maya-damaged", "bec-invoice", "northside-reschedule", "admin-phish", "stranger-refund", "newsletter", "jess-fan",
    "packright-proof", "message-9"], "a message without an id is named by its position");
  assert.deepEqual(items.map((item) => item.status), ["screened", "screened", "unscreened", "screened", "screened", "failed", "skipped", "screened", "screened"]);
  assert.deepEqual(items.map((item) => item.selected), [false, true, false, false, false, false, false, false, false]);
  const I = inboxById(ctx);
  assert.deepEqual(I["maya-damaged"].attachments, ["IMG_2041.png"]);
  assert.equal(I["packright-proof"].sender_domain, "packright.example", "trimmed and lowercased like jev/shield.py");
  assert.equal(I["message-9"].sender_domain, "", "no @, no domain");
  assert.deepEqual([I["stranger-refund"].attack, I["stranger-refund"].expected, I["stranger-refund"].matched], [true, "safe", true]);
  assert.deepEqual([I["message-9"].note, I["message-9"].expected, I["message-9"].attack, I["message-9"].matched], ["", null, null, null]);
  assert.deepEqual([I["northside-reschedule"].verdict, I["northside-reschedule"].answers, I["northside-reschedule"].fact, I["northside-reschedule"].meta], [null, null, null, null]);
  assert.equal(I.newsletter.error, "Rate limit reached. Wait a moment and try again.");
  assert.equal(I["jess-fan"].status, "skipped");

  const bec = I["bec-invoice"];
  assert.deepEqual(Object.keys(bec.verdict), ["level", "risk", "harm", "rules", "drivers", "category", "signals"]);
  assert.deepEqual(bec.verdict.rules.map((rule) => rule.id), ["prompt_injection", "impersonation"]);
  assert.deepEqual(bec.verdict.drivers, ["ai_instructions", "identity_mismatch", "payment_change"]);
  assert.deepEqual(bec.verdict.signals.map((signal) => signal.id), Object.keys(SIGNAL_NAMES), "jev/shield.py signal order");
  assert.deepEqual(bec.answers.ai_instructions, { type: "noul", value: 0.97, probabilities: {}, top: null, confidence: null, scale: null, legend: null });
  assert.equal(bec.answers.pressure.scale, 2);
  assert.equal(bec.answers.harm_if_obeyed.scale, 3);
  assert.deepEqual(bec.answers.pressure.top, { key: "2", p: 0.9 });
  assert.deepEqual([bec.answers.claimed_identity.value, bec.answers.claimed_identity.top], ["bean_brokers", { key: "bean_brokers", p: 0.88 }]);
  assert.deepEqual(bec.fact, { sender_domain: "beanbrokers-payments.example", claimed_identity: "bean_brokers", claimed_label: "Bean Brokers Ltd",
    claimed_identity_prob: 0.88, expected_domain: "beanbrokers.example", domain_matches: false, lookalike_domain: true });
  assert.equal(bec.meta.cost_usd, 0.00035);
  const odd = I["message-9"];
  assert.equal(odd.verdict.harm, null, "a harm that is not a number reads as missing");
  assert.equal(odd.verdict.category, null);
  assert.deepEqual(Object.values(odd.meta), [null, null, null, null, null, null, null]);
  assert.equal(odd.answers.harm_if_obeyed, undefined);
  assert.equal(odd.fact.domain_matches, null);
  assert.equal(ctx.itemName(bec, 1), "#2 Bean Brokers Ltd - Acco…");
  assert.equal(ctx.itemName(odd, 8), "#9", "a blank sender gives the position only");
  assert.ok(Object.isFrozen(bec) && Object.isFrozen(bec.verdict.signals[0]) && Object.isFrozen(bec.answers.pressure.probabilities));
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(items))), JSON.stringify(items), "plain JSON");
});

test("inbox items keep their identity until their own result, selection or pending state changes", () => {
  const ctx = sampleShieldInboxCtx();
  const first = ctx.items();
  assert.deepEqual(ctx.items(), first);
  assert.ok(ctx.items().every((item, index) => item === first[index]));
  assert.equal(ctx.shown()[0], first[0], "shown() hands out the same objects");
  ctx.state.selected = "maya-damaged";
  const next = ctx.items();
  assert.notEqual(next[0], first[0]);
  assert.notEqual(next[1], first[1]);
  assert.equal(next[3], first[3], "untouched messages keep their objects");
  ctx.state.pending = ["northside-reschedule"];
  assert.equal(ctx.items()[2].pending, true);
  ctx.state.results = { ...ctx.state.results, "northside-reschedule": { id: "northside-reschedule", error: "Bad gateway", status: 502 } };
  assert.equal(ctx.items()[2].status, "failed");
  assert.equal(ctx.items()[0], next[0]);
});

test("inbox shown() honors the page's matches and arrange hooks, evaluated at call time", () => {
  let hide = "bec-invoice";
  const ctx = sampleShieldInboxCtx({ matches: (item) => item.id !== hide, arrange: (list) => [...list].reverse() });
  assert.deepEqual(ctx.shown().map((item) => item.position), [9, 8, 7, 6, 5, 4, 3, 1]);
  hide = "nothing";
  assert.equal(ctx.shown().length, 9);
  assert.equal(sampleShieldInboxCtx({ arrange: () => "not a list" }).shown().length, 9, "an arrange hook that returns no list leaves the order alone");
  assert.deepEqual(sampleShieldInboxCtx({ hide: ["maya-damaged"], order: ["packright-proof"] }).shown().map((item) => item.position), [8, 2, 3, 4, 5, 6, 7, 9]);
  assert.deepEqual(shieldInboxCtx({}).items(), [], "a page before the inbox loads");
});

// ---------- shield.inbox: data ----------

test("inbox data fields, before and after the first verdict", () => {
  const ctx = sampleShieldInboxCtx();
  assert.equal(ctx.data.selected, "bec-invoice");
  assert.deepEqual(ctx.data.weights, DEFAULT_WEIGHTS);
  assert.deepEqual(ctx.data.policy, DEFAULT_POLICY);
  assert.deepEqual(ctx.data.defaults, { weights: DEFAULT_WEIGHTS, policy: DEFAULT_POLICY });
  assert.deepEqual(ctx.data.signal_names, SIGNAL_NAMES);
  assert.deepEqual(ctx.data.identity_labels, IDENTITY_LABELS);
  assert.deepEqual(ctx.data.category_labels, CATEGORY_LABELS);
  assert.deepEqual(ctx.data.rules, { hot: 0.15, max_drivers: 3, mismatch_prob: 0.6, risky_ask: 0.5, harm_quarantine: 2.5 });
  assert.equal(ctx.data.batch, null);
  assert.equal(ctx.data.scanning, false);
  const compose = ctx.data.compose;
  assert.deepEqual([compose.open, compose.live, compose.pending, compose.stale, compose.status], [false, false, false, true, "screened"]);
  assert.deepEqual(compose.draft, DRAFT);
  assert.deepEqual(compose.verdict.rules.map((rule) => rule.id), ["credential_phish", "impersonation"]);
  assert.ok(Object.isFrozen(compose) && Object.isFrozen(ctx.data.weights));

  const fresh = sampleShieldInboxCtx({ selected: COMPOSE_ID, results: {}, weights: null, policy: null, defaults: null, live: true, pending: [COMPOSE_ID], scanning: true });
  assert.equal(fresh.data.selected, null, "Write your own is not an inbox message");
  assert.deepEqual([fresh.data.weights, fresh.data.policy, fresh.data.defaults], [null, null, null]);
  assert.deepEqual([fresh.data.compose.open, fresh.data.compose.live, fresh.data.compose.pending, fresh.data.compose.stale, fresh.data.compose.status, fresh.data.compose.verdict],
    [true, true, true, false, "unscreened", null]);
  assert.equal(fresh.data.scanning, true);

  // The draft back at the text the result was made for is no longer stale.
  assert.equal(sampleShieldInboxCtx({ draft: { ...DRAFT, subject: "Bonus approved" } }).data.compose.stale, false);
});

test("inbox data.batch summarizes the latest batch as measured", () => {
  const ctx = sampleShieldInboxCtx({ batch: SHIELD_BATCH });
  const batch = ctx.data.batch;
  assert.deepEqual({ ...batch, sum_latency_ms: Math.round(batch.sum_latency_ms * 10) / 10 }, { count: 9, completed: 7, failed: 2, skipped: 1, wall_ms: 1612.4,
    sum_latency_ms: 3565.7, total_cost_usd: 0.00228, total_input_tokens: 8910, stopped: null });
  assert.equal(sampleShieldInboxCtx({ batch: { results: [{ id: "a", error: "x" }] } }).data.batch.completed, 0, "completed falls back to a count");
});

// ---------- shield.inbox: actions and guards ----------

test("open() opens messages that have a result and refuses to screen one", () => {
  const ctx = sampleShieldInboxCtx();
  assert.equal(ctx.actions.open("maya-damaged"), "maya-damaged");
  assert.equal(ctx.actions.open("newsletter"), "newsletter", "a failed message opens on its error, without a call");
  assert.deepEqual(ctx.log, [["open", "maya-damaged"], ["open", "newsletter"]]);
  throwsMessage(() => ctx.actions.open("northside-reschedule"), /has not been screened in this session\. Opening it asks Jev/);
  throwsMessage(() => ctx.actions.open("nope"), /There is no message "nope"/);
  assert.equal(ctx.log.length, 2, "a refused open reaches nothing");
  throwsMessage(() => sampleShieldInboxCtx({ missing: ["open"] }).actions.open("maya-damaged"), /cannot do that here/);
});

test("draftCompose() fills the form without screening and checks the fields", () => {
  const ctx = sampleShieldInboxCtx();
  ctx.actions.openCompose();
  assert.deepEqual(ctx.log, [["openCompose"]]);
  const merged = ctx.actions.draftCompose({ subject: "Invoice question", body: "Is INV-12 paid?" });
  assert.deepEqual(merged, { ...DRAFT, subject: "Invoice question", body: "Is INV-12 paid?" });
  assert.deepEqual(ctx.log[1], ["draftCompose", merged]);
  assert.equal(ctx.state.selected, COMPOSE_ID);
  throwsMessage(() => ctx.actions.draftCompose("hello"), /Give the draft as/);
  throwsMessage(() => ctx.actions.draftCompose({ to: "x" }), /A draft has no field "to"/);
  throwsMessage(() => ctx.actions.draftCompose({ subject: 7 }), /subject must be text/);
  throwsMessage(() => ctx.actions.draftCompose({ subject: " ", body: "\n" }), /needs a subject or a body/);
  assert.equal(ctx.log.length, 2);
});

test("setWeights() and setPolicy() go through the page's slider path with the sliders' range and step", () => {
  const ctx = sampleShieldInboxCtx();
  const full = ctx.actions.setWeights({ link_lure: 0.15000000000000002, pressure: 1 });
  assert.deepEqual(ctx.log[0], ["applyPolicy", { weights: { link_lure: 0.15, pressure: 1 }, policy: null }]);
  assert.deepEqual(full, { ...DEFAULT_WEIGHTS, link_lure: 0.15, pressure: 1 });
  assert.equal(ctx.data.weights.link_lure, 0.15);
  throwsMessage(() => ctx.actions.setWeights({ link_lure: 0.33 }), /steps of 0\.05/);
  throwsMessage(() => ctx.actions.setWeights({ link_lure: 1.05 }), /from 0 to 1/);
  throwsMessage(() => ctx.actions.setWeights({ link_lure: "0.5" }), /from 0 to 1/);
  throwsMessage(() => ctx.actions.setWeights({ review_at: 0.5 }), /no signal "review_at"/);
  throwsMessage(() => ctx.actions.setWeights({}), /at least one signal/);
  ctx.actions.setPolicy({ review_at: 0.25 });
  assert.deepEqual(ctx.log[1], ["applyPolicy", { weights: null, policy: { review_at: 0.25 } }]);
  throwsMessage(() => ctx.actions.setPolicy({ link_lure: 0.5 }), /no threshold "link_lure"/);
  throwsMessage(() => ctx.actions.setPolicy({ hard_rule_at: -0.05 }), /from 0 to 1/);
  assert.equal(ctx.log.length, 2, "refused settings reach nothing");
  ctx.actions.resetPolicy();
  assert.deepEqual(ctx.log[2], ["resetPolicy"]);
  assert.deepEqual(ctx.data.weights, DEFAULT_WEIGHTS);

  const before = sampleShieldInboxCtx({ weights: null, policy: null, defaults: null });
  throwsMessage(() => before.actions.setWeights({ pressure: 0.5 }), /weights arrive with the first verdict/);
  throwsMessage(() => before.actions.setPolicy({ review_at: 0.5 }), /thresholds arrive with the first verdict/);
  throwsMessage(() => before.actions.resetPolicy(), /no defaults yet/);
  assert.deepEqual(before.log, []);
});

test("inspect(id) opens the message's own trace only", () => {
  const ctx = sampleShieldInboxCtx();
  ctx.actions.inspect("admin-phish");
  const [name, trace, title] = ctx.log[0];
  assert.equal(name, "inspect");
  assert.equal(title, "Shield · one Jev request");
  assert.equal(trace.request.state.message.subject, "Action required: store admin password expires in 2 hours");
  throwsMessage(() => ctx.actions.inspect("newsletter"), /no screened request to inspect/);
  throwsMessage(() => ctx.actions.inspect("northside-reschedule"), /no screened request to inspect/);
  throwsMessage(() => ctx.actions.inspect("missing"), /There is no message/);
});

test("the inbox surface offers no edit or import actions", () => {
  const ctx = sampleShieldInboxCtx();
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
  assert.deepEqual(Object.keys(ctx.actions).sort(), ["draftCompose", "inspect", "open", "openCompose", "resetPolicy", "setPolicy", "setWeights"]);
  ctx.refresh();
  assert.deepEqual(ctx.log, [["refresh"]]);
});

// ---------- shield.result ----------

test("result items are the opened message's signals in the page's order", () => {
  const ctx = sampleShieldResultCtx();
  const items = ctx.items();
  assert.deepEqual(Object.keys(items[0]), ["id", "position", "rank", "label", "name", "source", "question", "value", "weight", "default_weight", "contribution",
    "hot", "driver", "rules", "answer"]);
  assert.deepEqual(items.map((item) => item.id), ["ai_instructions", "identity_mismatch", "payment_change", "secrecy_or_bypass", "pressure", "link_lure",
    "credential_request", "unexpected_reward"]);
  assert.deepEqual(items.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(items.map((item) => item.position), [1, 8, 3, 4, 7, 5, 2, 6]);
  const S = signalsById(ctx);
  assert.deepEqual(S.ai_instructions.rules, ["prompt_injection"]);
  assert.deepEqual(S.identity_mismatch.rules, ["impersonation"]);
  assert.deepEqual(S.payment_change.rules, ["impersonation"], "payment_change 0.98 is a risky ask");
  assert.deepEqual(S.link_lure.rules, [], "link_lure 0.12 is not");
  assert.deepEqual([S.identity_mismatch.source, S.identity_mismatch.question, S.identity_mismatch.answer.value], ["code", "claimed_identity", "bean_brokers"]);
  assert.deepEqual([S.pressure.source, S.pressure.value, S.pressure.answer.value], ["score", 0.95, 1.9]);
  assert.deepEqual([S.secrecy_or_bypass.hot, S.secrecy_or_bypass.driver, S.link_lure.hot], [true, false, false]);
  assert.equal(S.identity_mismatch.name, "Domain mismatch");
  assert.equal(S.identity_mismatch.label, "Sender domain mismatch (code check)");
  assert.equal(S.ai_instructions.default_weight, 0.9);
  assert.equal(ctx.itemName(S.ai_instructions, 0), "Instructs an AI / automation");
  assert.ok(Object.isFrozen(items) && Object.isFrozen(items[0].rules));
  assert.equal(ctx.items(), items, "the same list until the result changes");
  ctx.state.defaults = { weights: { ...DEFAULT_WEIGHTS, pressure: 0.5 }, policy: { ...DEFAULT_POLICY } };
  assert.equal(signalsById(ctx).pressure.default_weight, 0.5, "new defaults rebuild the rows");
});

test("result items are empty without a screened result, and follow the opened message", () => {
  for (const selected of ["northside-reschedule", "newsletter", "jess-fan", null]) assert.deepEqual(sampleShieldResultCtx({ selected }).items(), [], String(selected));
  const none = sampleShieldResultCtx({ selected: "northside-reschedule", pending: ["northside-reschedule"] });
  assert.deepEqual([none.data.status, none.data.pending, none.data.verdict, none.data.request, none.data.expected], ["unscreened", true, null, null, "safe"]);
  const failed = sampleShieldResultCtx({ selected: "newsletter" });
  assert.deepEqual([failed.data.status, failed.data.error], ["failed", "Rate limit reached. Wait a moment and try again."]);
  const compose = sampleShieldResultCtx({ selected: COMPOSE_ID });
  assert.equal(compose.items().length, 8);
  assert.deepEqual([compose.data.id, compose.data.compose, compose.data.stale, compose.data.note, compose.data.expected], [null, true, true, "", null]);
  assert.deepEqual(compose.data.message, DRAFT, "the draft as it is now");
  assert.deepEqual(sampleShieldResultCtx({ selected: COMPOSE_ID, results: {} }).items(), []);
  const ctx = sampleShieldResultCtx();
  ctx.state.selected = "admin-phish";
  assert.equal(ctx.items()[0].id, "credential_request", "the ctx reads the selection at call time");
});

test("result data holds the opened message, its result and the request without answers", () => {
  const ctx = sampleShieldResultCtx();
  assert.equal(ctx.data.id, "bec-invoice");
  assert.equal(ctx.data.compose, false);
  assert.equal(ctx.data.message.from_email, "accounts@beanbrokers-payments.example");
  assert.equal(ctx.data.note, "Quarantine: vendor impersonation + payment redirect + prompt injection");
  assert.equal(ctx.data.expected, "quarantine");
  assert.equal(ctx.data.status, "screened");
  assert.equal(ctx.data.verdict.level, "quarantine");
  assert.equal(ctx.data.answers.category.value, "vendor_business");
  assert.equal(ctx.data.fact.lookalike_domain, true);
  assert.equal(ctx.data.meta.latency_ms, 455);
  assert.deepEqual(Object.keys(ctx.data.request), ["state", "questions", "model"]);
  assert.ok(!JSON.stringify(ctx.data.request).includes("\"noul\":"), "no answers in the request");
  assert.equal(ctx.data.request, ctx.data.request, "the same frozen copy on every read");
  assert.ok(Object.isFrozen(ctx.data.request.state.message));
  assert.deepEqual(ctx.data.weights, DEFAULT_WEIGHTS);
  assert.equal(ctx.data.rules.hot, 0.15);
});

test("result shown() honors the hooks, and its actions keep their guards", () => {
  const ctx = sampleShieldResultCtx({ hide: ["pressure", "link_lure"], order: ["unexpected_reward"] });
  assert.deepEqual(ctx.shown().map((item) => item.id), ["unexpected_reward", "ai_instructions", "identity_mismatch", "payment_change", "secrecy_or_bypass", "credential_request"]);
  ctx.actions.inspect();
  assert.equal(ctx.log[0][2], "Shield · one Jev request");
  ctx.actions.setWeights({ ai_instructions: 0 });
  assert.deepEqual(ctx.log[1], ["applyPolicy", { weights: { ai_instructions: 0 }, policy: null }]);
  throwsMessage(() => sampleShieldResultCtx({ selected: "northside-reschedule" }).actions.inspect(), /no screened request to inspect/);
  assert.deepEqual(Object.keys(ctx.actions).sort(), ["inspect", "resetPolicy", "setPolicy", "setWeights"]);
  assert.equal(ctx.actions.replaceItems, undefined);
});

// ---------- in step with the page and jev/shield.py ----------

test("the module exports only the two builders (every export becomes a LAB builder)", () => {
  assert.deepEqual(Object.keys(surfaceModule).sort(), ["shieldInboxCtx", "shieldResultCtx"]);
});

test("the fixture's labels are the page's and its defaults are jev/shield.py's", () => {
  assert.deepEqual(literal("SIGNAL_NAMES"), { ...SIGNAL_NAMES });
  assert.deepEqual(literal("IDENTITY_LABELS"), { ...IDENTITY_LABELS });
  assert.deepEqual(literal("CATEGORY_LABELS"), { ...CATEGORY_LABELS });
  const pyWeights = Object.fromEntries([...PYTHON.match(/DEFAULT_WEIGHTS = \{([^}]*)\}/)[1].matchAll(/"(\w+)": ([\d.]+)/g)].map(([, key, value]) => [key, Number(value)]));
  assert.deepEqual(pyWeights, { ...DEFAULT_WEIGHTS });
  const pyPolicy = Object.fromEntries([...PYTHON.match(/DEFAULT_POLICY = \{([^}]*)\}/)[1].matchAll(/"(\w+)": ([\d.]+)/g)].map(([, key, value]) => [key, Number(value)]));
  assert.deepEqual(pyPolicy, { ...DEFAULT_POLICY });
});

test("data.rules mirrors the cut-offs in jev/shield.py verdict()", () => {
  const { rules } = sampleShieldInboxCtx().data;
  assert.ok(PYTHON.includes(`if c >= ${rules.hot}][:${rules.max_drivers}]`));
  assert.ok(PYTHON.includes(`fact["claimed_identity_prob"] >= ${rules.mismatch_prob}`));
  assert.ok(PYTHON.includes(`values["link_lure"]) >= ${rules.risky_ask}`));
  assert.ok(PYTHON.includes(`harm >= ${rules.harm_quarantine} and`));
  assert.match(PAGE, new RegExp(`s\\.contribution >= ${rules.hot} \\? " hot"`), "the page's highlight uses the same cut");
});

// ---------- the hooks in static/js/shield.js ----------

// The page's Lab block and list helpers, rebuilt from source around a fake DOM and the fixture's page state.
function page({ lab = createLab([inboxPack, resultPack]), batch = null } = {}) {
  const dom = fakeDom();
  const nodes = { "#inbox-count": { textContent: "" }, "#inbox": { children: [] } };
  const mount = (target, ...children) => { const node = typeof target === "string" ? nodes[target] : target; node.children = children.flat(Infinity).filter(Boolean); return node; };
  const S = { inbox: [...MESSAGES], selected: "bec-invoice", results: sampleShieldResults(), compose: false, live: false, weights: { ...DEFAULT_WEIGHTS },
    policy: { ...DEFAULT_POLICY }, pending: new Set(), scanning: false };
  const calls = [];
  const names = ["S", "COMPOSE_ID", "draft", "LAB", "shieldInboxCtx", "shieldResultCtx", "SIGNAL_NAMES", "IDENTITY_LABELS", "CATEGORY_LABELS", "defaults", "lastBatch",
    "select", "draftCompose", "applyPolicy", "resetPolicy", "inspect", "renderBatch", "renderResult", "renderResultLab", "renderInboxLab", "resetInboxLab",
    "$", "h", "mount", "resultBadge"];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const values = [S, COMPOSE_ID, { ...DRAFT }, lab, shieldInboxCtx, shieldResultCtx, SIGNAL_NAMES, IDENTITY_LABELS, CATEGORY_LABELS,
    { weights: { ...DEFAULT_WEIGHTS }, policy: { ...DEFAULT_POLICY } }, batch, record("select"), record("draftCompose"), record("applyPolicy"), record("resetPolicy"),
    record("inspect"), record("renderBatch"), record("renderResult"), record("renderResultLab"), record("renderInboxLab"), record("resetInboxLab"),
    (selector) => nodes[selector], dom.h, mount, (r) => (r?.verdict ? dom.h("span", { class: "badge" }, r.verdict.level) : null)];
  const block = PAGE.slice(PAGE.indexOf("const INBOX_ID"), PAGE.indexOf("async function boot"));
  const code = `${block}\n${body("shownMessages")}\n${body("shownSignals")}\n${body("signalsNote")}\n${body("shownBatchResults")}\n${body("renderInbox")}\n`
    + "return { INBOX, RESULT, INBOX_ID, RESULT_ID, shownMessages, shownSignals, signalsNote, shownBatchResults, renderInbox };";
  return { ...new Function(...names, code)(...values), S, lab, nodes, calls };
}

test("with no Lab setting the page lists exactly what it listed before", () => {
  const p = page();
  assert.deepEqual(p.shownMessages(), p.S.inbox, "every message, in inbox order");
  const res = p.S.results["bec-invoice"];
  assert.deepEqual(p.shownSignals(res), [...res.verdict.signals].sort((x, y) => y.contribution - x.contribution));
  assert.equal(p.shownBatchResults(SHIELD_BATCH), SHIELD_BATCH.results, "the batch rows are the batch's own list");
  assert.equal(p.signalsNote(res, 8), null);
  p.renderInbox();
  assert.equal(p.nodes["#inbox-count"].textContent, "9 messages");
  const buttons = p.nodes["#inbox"].children;
  assert.equal(buttons.length, 10, "nine messages and Write your own, no note");
  assert.ok(buttons.every((node) => node.tag === "button"));
  assert.match(buttons[1].attrs.class, /active/, "the opened message is marked");
  assert.equal(textOf(buttons[9]), "✎ Write your ownquarantineTry to sneak something past it", "with the badge of its own result");
});

test("Lab filters and sorts reach the inbox, the batch table and the signal rows", () => {
  const p = page();
  const inboxView = p.lab.view(p.INBOX_ID);
  inboxView.filters = [{ key: "shield-inbox-triage/level", op: "is", value: "quarantine" }];
  assert.equal(p.lab.active(p.INBOX_ID), 1);
  assert.deepEqual(ids(p.shownMessages()), ["bec-invoice", "admin-phish"]);
  assert.deepEqual(p.shownBatchResults(SHIELD_BATCH).map((r) => r.id), ["bec-invoice", "admin-phish"]);
  p.renderInbox();
  assert.equal(p.nodes["#inbox-count"].textContent, "2 of 9 messages");
  const [note, ...rest] = p.nodes["#inbox"].children;
  assert.equal(textOf(note), "1 Lab setting active. Clear Lab filters and sort");
  assert.equal(rest.length, 3, "two messages and Write your own, which no filter hides");
  inboxView.filters = [];
  inboxView.sort = { key: "shield-inbox-triage/risk", dir: "desc" };
  assert.deepEqual(ids(p.shownMessages()), ["bec-invoice", "admin-phish", "packright-proof", "(no id)", "stranger-refund", "maya-damaged",
    "northside-reschedule", "newsletter", "jess-fan"], "highest risk first, messages without a risk last in inbox order");
  inboxView.filters = [{ key: "shield-inbox-triage/differs", op: "with" }];
  p.renderInbox();
  assert.equal(textOf(p.nodes["#inbox"].children[0]), "2 Lab settings active. Clear Lab filters and sort");
  inboxView.filters = [{ key: "shield-inbox-triage/domain", op: "contains", value: "no message has this" }];
  p.renderInbox();
  assert.match(textOf(p.nodes["#inbox"].children[0]), /: no message matches\./);
  p.lab.reset(p.INBOX_ID);
  assert.equal(p.lab.active(p.INBOX_ID), 0);
  assert.deepEqual(p.shownMessages(), p.S.inbox);

  const res = p.S.results["bec-invoice"];
  const resultView = p.lab.view(p.RESULT_ID);
  resultView.filters = [{ key: "shield-signal-insights/hard_rule", op: "with" }];
  assert.deepEqual(p.shownSignals(res).map((s) => s.id), ["ai_instructions", "identity_mismatch", "payment_change"]);
  assert.equal(textOf(p.signalsNote(res, 3)), "3 of 8 signals shown · 1 Lab setting active. Clear Lab filters and sort");
  const other = p.S.results["admin-phish"];
  assert.equal(p.shownSignals(other).length, 8, "a result that is not the opened one keeps the page's order");
  assert.equal(p.signalsNote(other, 8), null);
  resultView.filters = [];
  resultView.sort = { key: "shield-signal-insights/weight", dir: "asc" };
  assert.deepEqual(p.shownSignals(res).map((s) => s.id).slice(0, 3), ["pressure", "unexpected_reward", "secrecy_or_bypass"]);
});

test("the Lab refresh re-renders only the lists, and the actions reach the page's own functions", () => {
  const p = page({ batch: SHIELD_BATCH });
  p.INBOX.refresh();
  assert.deepEqual(p.calls, [["renderBatch", SHIELD_BATCH]]);
  assert.equal(p.nodes["#inbox-count"].textContent, "9 messages");
  p.RESULT.refresh();
  assert.deepEqual(p.calls[1], ["renderResult", p.S.results["bec-invoice"]]);
  p.S.selected = "northside-reschedule";
  p.RESULT.refresh();
  assert.equal(p.calls.length, 2, "nothing to re-render while the opened message has no result (the spinner stays)");
  p.INBOX.actions.open("maya-damaged");
  p.INBOX.actions.draftCompose({ subject: "Hi" });
  p.INBOX.actions.setWeights({ pressure: 0.5 });
  p.INBOX.actions.inspect("maya-damaged");
  assert.deepEqual(p.calls.slice(2).map(([name]) => name), ["select", "draftCompose", "applyPolicy", "inspect"]);
  assert.deepEqual(p.calls[4], ["applyPolicy", { weights: { pressure: 0.5 }, policy: null }]);
  assert.equal(p.INBOX.data.batch.count, 9);
});

test("the page's Lab wiring is in place", () => {
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/shield\.js";/);
  assert.match(PAGE, /import \{ shieldInboxCtx, shieldResultCtx \} from "\.\/lab\/surfaces\/shield\.js";/);
  assert.match(body("boot"), /await initChrome\("\/shield"\);\n {2}installLab\(LAB\);/);
  assert.equal(PAGE.match(/installLab\(/g).length, 1);
  assert.match(PAGE, /matches: \(item, ctx\) => LAB\.matches\(INBOX_ID, item, ctx\), arrange: \(items, ctx\) => LAB\.arrange\(INBOX_ID, items, ctx\)/);
  assert.match(PAGE, /matches: \(item, ctx\) => LAB\.matches\(RESULT_ID, item, ctx\), arrange: \(items, ctx\) => LAB\.arrange\(RESULT_ID, items, ctx\)/);
  assert.match(body("renderInboxLab"), /LAB\.section\(labEnv, INBOX_ID, INBOX\)/);
  assert.match(body("renderResultLab"), /LAB\.section\(labEnv, RESULT_ID, RESULT\)/);
  assert.match(body("renderResult"), /const signals = shownSignals\(res\)\.map/);
  assert.match(body("renderBatch"), /const visible = shownBatchResults\(res\);/);
  assert.match(HTML, /<div id="inbox"><\/div>\n\s+<div id="inbox-lab" class="hidden"/);
  assert.match(HTML, /id="result-panel">[^\n]*<\/div>\n\s+<div id="result-lab" class="hidden"><\/div>/);
  // The paid paths are unchanged: the batch screens the whole inbox, and opening an unscreened message screens it.
  assert.match(body("scanAll"), /api\("\/api\/shield\/batch", \{ messages: S\.inbox, weights: S\.weights \}\)/);
  assert.match(body("select"), /else if \(id !== COMPOSE_ID\) screen\(currentMessage\(\)\);/);
  assert.ok(!body("draftCompose").includes("screen("), "a Lab draft never screens");
  assert.ok(!body("applyPolicy").includes("api("), "moving sliders re-scores through rescore() only");
});

test("the page's applyPolicy merges like the sliders, then re-scores without a Jev call", () => {
  const S = { weights: { ...DEFAULT_WEIGHTS }, policy: { ...DEFAULT_POLICY } };
  const calls = [];
  const applyPolicy = new Function("S", "renderPolicy", "rescore", `${body("applyPolicy")}\nreturn applyPolicy;`)(S, () => calls.push("renderPolicy"), () => calls.push("rescore"));
  applyPolicy({ weights: { pressure: 0.5 }, policy: null });
  applyPolicy({ weights: null, policy: { review_at: 0.2 } });
  assert.deepEqual(S.weights, { ...DEFAULT_WEIGHTS, pressure: 0.5 });
  assert.deepEqual(S.policy, { ...DEFAULT_POLICY, review_at: 0.2 });
  assert.deepEqual(calls, ["renderPolicy", "rescore", "renderPolicy", "rescore"]);
});

test("the page's draftCompose fills only the draft fields, then opens the form", () => {
  const draft = { ...DRAFT };
  const opened = [];
  const draftCompose = new Function("draft", "select", "COMPOSE_ID", `${body("draftCompose")}\nreturn draftCompose;`)(draft, (id) => opened.push(id), COMPOSE_ID);
  draftCompose({ subject: "New", body: "Text", extra: "ignored" });
  assert.deepEqual(draft, { ...DRAFT, subject: "New", body: "Text" });
  assert.deepEqual(opened, [COMPOSE_ID]);
});
