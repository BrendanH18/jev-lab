// Tests of the Autopilot page's Lab surfaces (static/js/lab/surfaces/autopilot.js) and of the hook in
// static/js/autopilot.js, whose list function is rebuilt from source because the page module needs a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { autopilotBenchmarkCtx, autopilotInboxCtx, autopilotRecordsCtx } from "../../../static/js/lab/surfaces/autopilot.js";
import outcomes from "../../../static/js/lab/packs/autopilot/autopilot-outcomes.js";
import waiting from "../../../static/js/lab/packs/autopilot/autopilot-waiting.js";
import { emptyBenchmarkCtx, sampleBenchRuns, sampleBenchmarkCtx, sampleInbox, sampleInboxCtx, sampleRecords, sampleRecordsCtx, sampleWorlds } from "./fixtures/autopilot.mjs";

const page = readFileSync(new URL("../../../static/js/autopilot.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../../static/autopilot.html", import.meta.url), "utf8");
const fn = (name) => page.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];

const RECORD_KEYS = ["id", "position", "from_name", "from_email", "sender_domain", "subject", "body", "attachments", "label", "order", "meta", "shield", "photo",
  "integrated", "naive", "outcome", "awaiting", "can_approve", "harmful", "naive_harmful", "answers"].sort();
const QUEUED_KEYS = ["id", "position", "from_name", "from_email", "sender_domain", "subject", "body", "attachments", "label", "active", "next"].sort();
const isDeepFrozen = (value) => !value || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

// A live page state the builders read through callbacks, as static/js/autopilot.js passes it.
function pageState(extra = {}) {
  return { inbox: sampleInbox(), records: sampleRecords(), worlds: sampleWorlds(), running: false, activeId: null, status: { configured: true, model: "jev-1.2" }, ...extra };
}
function sourceOf(S, more = {}) {
  const calls = [];
  const op = (name) => (...args) => { calls.push([name, ...args]); return "page promise"; };
  return { calls, source: { inbox: () => S.inbox, records: () => S.records, worlds: () => S.worlds, running: () => S.running, activeId: () => S.activeId,
    status: () => S.status, reset: op("reset"), resolve: op("resolve"), inspect: op("inspect"), refresh: op("refresh"), ...more } };
}

test("records: one frozen item per processed inbox email, in page order, with the documented fields", () => {
  const ctx = sampleRecordsCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["dana-damaged", "vendor-redirect", "supplier-invoice", "tasting-move", "sampler-refund", "fan-repair", "weekly-digest"]);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), RECORD_KEYS);
    assert.ok(isDeepFrozen(item));
    assert.ok(!("trace" in item), "traces stay out of the items");
  }
  assert.deepEqual(items.map((item) => item.position), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(items.map((item) => item.order), [1, 2, 3, 5, 4, 6, 7], "order is the processing order");
  assert.deepEqual(items.map((item) => item.outcome), ["handled", "quarantine", "handled", "approved", "needs_you", "dismissed", "ignored"]);
  const sampler = items[4];
  assert.equal(sampler.awaiting, true);
  assert.equal(sampler.can_approve, true);
  assert.equal(sampler.naive_harmful, true);
  assert.equal(sampler.harmful, false);
  assert.equal(items[5].awaiting, false, "a dismissed email no longer waits");
  assert.equal(items[1].sender_domain, "roastwell-payments.example");
  assert.deepEqual(items[0].attachments, [{ sample: "torn-bag", name: "IMG_3310.png" }]);
  assert.deepEqual(items[0].label, { attack: false, shield: "safe", expect: "Refund Dana's damaged order" });
  assert.equal(items[0].answers["dispatch.tool"].choice, "refund_order");
  assert.deepEqual(items[6].answers, {});
  assert.deepEqual(items[6].meta, { model: "jev-1.2", latency_ms: null, question_count: 21, input_tokens: 2300, output_tokens: 0, cost_usd: null, backend: null });
  assert.equal(items[6].shield.fact, null);
  assert.equal(items[3].integrated.approved, true);
  assert.equal(items[0].integrated.approved, false, "approved and dismissed default to false");
  assert.equal(ctx.itemName(items[1], 1), "#2 Roastwell Imports - Billing");
  assert.equal(ctx.itemName({ position: 9, from_name: "A very long sender name that goes on and on" }, 0), "#9 A very long sender name that goes on…");
  assert.equal(ctx.itemName({}, 2), "#3");
});

test("records: items keep their identity until the record changes, and skip records of emails not in the inbox", () => {
  const S = pageState();
  const ctx = autopilotRecordsCtx(sourceOf(S).source);
  const first = ctx.items();
  assert.deepEqual(ctx.items(), first);
  first.forEach((item, index) => assert.equal(ctx.items()[index], item));
  S.records = { ...S.records, "sampler-refund": { ...S.records["sampler-refund"], integrated: { ...S.records["sampler-refund"].integrated, resolved: true, dismissed: true, lane: "handled" } } };
  const second = ctx.items();
  assert.equal(second[0], first[0], "an unchanged record keeps its item");
  assert.notEqual(second[4], first[4]);
  assert.equal(second[4].outcome, "dismissed");
  S.records = { ...S.records, custom: { id: "custom", meta: { cost_usd: 1, latency_ms: 10 }, integrated: { lane: "handled" }, naive: {} } };
  assert.equal(ctx.items().length, 7, "a record of an email outside the inbox is not listed");
  assert.equal(ctx.data.tally.processed, 8, "but the scoreboard still counts it");
  assert.equal(ctx.data.tally.auto, 3);
});

test("data: the page's scoreboard tally, inbox counts, worlds and traces", () => {
  const ctx = sampleRecordsCtx();
  const t = ctx.data.tally;
  assert.ok(Math.abs(t.cost - 0.00259) < 1e-12);
  assert.deepEqual({ ...t, cost: 0 }, { processed: 7, calls: 7, cost: 0, latency: 5430, auto: 2, needs: 3, quarantined: 1, ignored: 1, harmI: 0, lostI: 0,
    naiveRuns: 4, harmN: 2, lostN: 2034, legitBlockedN: 1 });
  assert.equal(ctx.data.total, 10);
  assert.equal(ctx.data.processed, 7);
  assert.equal(ctx.data.waiting, 3);
  assert.equal(ctx.data.next, "grinder-crack");
  assert.equal(ctx.data.running, false);
  assert.equal(ctx.data.activeId, null);
  assert.equal(ctx.data.configured, true);
  assert.equal(ctx.data.model, "jev-1.2");
  assert.equal(ctx.data.inbox.length, 10);
  assert.ok(ctx.data.inbox.every((message) => !("record" in message) && !("meta" in message)), "data.inbox is authored copy only");
  assert.equal(ctx.data.inbox[9].label, null);
  assert.ok(isDeepFrozen(ctx.data.worlds));
  assert.equal(ctx.data.worlds.naive.balance, 16324);
  assert.equal(ctx.data.worlds, ctx.data.worlds, "worlds are cached per server response");
  assert.deepEqual(Object.keys(ctx.data.traces), ctx.items().map((item) => item.id));
  assert.ok(isDeepFrozen(ctx.data.traces));
  assert.ok("request" in ctx.data.traces["dana-damaged"]);
  const empty = sampleRecordsCtx({ inbox: [], records: {}, worlds: null, status: null });
  assert.deepEqual(empty.items(), []);
  assert.deepEqual(empty.data.inbox, []);
  assert.equal(empty.data.worlds, null);
  assert.equal(empty.data.next, null);
  assert.equal(empty.data.configured, false);
  assert.equal(empty.data.model, null);
  assert.deepEqual(empty.data.traces, {});
  assert.equal(empty.data.tally.processed, 0);
  assert.equal(empty.data.tally.cost, 0);
});

test("inbox: the waiting emails with active and next flags; the email in flight is shown through any filter", () => {
  const ctx = sampleInboxCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["grinder-crack", "admin-reset", "blank-note"]);
  for (const item of items) { assert.deepEqual(Object.keys(item).sort(), QUEUED_KEYS); assert.ok(isDeepFrozen(item)); }
  assert.deepEqual(items.map((item) => item.next), [true, false, false]);
  assert.deepEqual(items.map((item) => item.active), [false, false, false]);
  assert.equal(items[2].label, null);
  assert.deepEqual(items[2].attachments, []);
  assert.equal(ctx.itemName(items[2], 2), "#10");
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
  const hiding = sampleInboxCtx({ activeId: "admin-reset", matches: () => false });
  assert.deepEqual(hiding.shown().map((item) => item.id), ["admin-reset"]);
  assert.equal(hiding.shown()[0].active, true);
  assert.equal(sampleInboxCtx({ records: {} }).items().length, 10);
});

test("shown() honors Lab filters and Lab's sort through the real host", () => {
  const LAB = createLab([outcomes, waiting]);
  const S = pageState();
  const records = autopilotRecordsCtx({ ...sourceOf(S).source, matches: (item, ctx) => LAB.matches("autopilot.records", item, ctx), arrange: (items, ctx) => LAB.arrange("autopilot.records", items, ctx) });
  const inbox = autopilotInboxCtx({ ...sourceOf(S).source, matches: (item, ctx) => LAB.matches("autopilot.inbox", item, ctx), arrange: (items, ctx) => LAB.arrange("autopilot.inbox", items, ctx) });
  assert.deepEqual(records.shown(), records.items(), "no Lab setting: shown is items");
  assert.deepEqual(inbox.shown(), inbox.items());
  LAB.view("autopilot.records").filters.push({ key: "autopilot-outcomes/scenario_attack", op: "with" });
  assert.deepEqual(records.shown().map((item) => item.id), ["vendor-redirect", "sampler-refund"]);
  LAB.view("autopilot.records").filters.length = 0;
  LAB.view("autopilot.records").sort = { key: "autopilot-outcomes/risk", dir: "desc" };
  assert.deepEqual(records.shown().map((item) => item.id), ["vendor-redirect", "tasting-move", "supplier-invoice", "weekly-digest", "sampler-refund", "dana-damaged", "fan-repair"]);
  assert.equal(LAB.active("autopilot.records"), 1);
  LAB.view("autopilot.inbox").filters.push({ key: "autopilot-waiting/attachment", op: "without" });
  assert.deepEqual(inbox.shown().map((item) => item.id), ["admin-reset", "blank-note"]);
  S.activeId = "grinder-crack";
  assert.deepEqual(inbox.shown().map((item) => item.id), ["grinder-crack", "admin-reset", "blank-note"], "the email in flight stays shown");
  LAB.reset("autopilot.records");
  LAB.reset("autopilot.inbox");
  assert.deepEqual(records.shown(), records.items());
  assert.equal(LAB.active("autopilot.records") + LAB.active("autopilot.inbox"), 0);
});

test("actions: every guard refuses before reaching the page", () => {
  const S = pageState();
  const { calls, source } = sourceOf(S);
  const ctx = autopilotRecordsCtx(source);
  const inbox = autopilotInboxCtx(source);
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
  assert.throws(() => ctx.actions.inspect("nope"), /No processed email "nope"/);
  assert.throws(() => ctx.actions.inspect("grinder-crack"), /Process it first/);
  assert.equal(ctx.actions.inspect("vendor-redirect"), "page promise");
  assert.throws(() => ctx.actions.resolve("dana-damaged", true), /not waiting for your decision/);
  assert.throws(() => ctx.actions.resolve("fan-repair", false), /not waiting/, "an email already dismissed cannot be resolved again");
  assert.equal(ctx.actions.resolve("sampler-refund", true), "page promise");
  assert.equal(ctx.actions.resolve("sampler-refund", "yes"), "page promise", "anything but true dismisses");
  S.records["sampler-refund"] = { ...S.records["sampler-refund"], integrated: { ...S.records["sampler-refund"].integrated,
    plan: { ...S.records["sampler-refund"].integrated.plan, missing: ["order"] } } };
  assert.throws(() => ctx.actions.resolve("sampler-refund", true), /cannot be approved/);
  assert.equal(ctx.actions.resolve("sampler-refund", false), "page promise", "Dismiss stays possible");
  for (const name of ["step", "run"]) {
    assert.equal(name in ctx.actions, false, `records has no ${name} action: it would process emails with live calls`);
    assert.equal(name in inbox.actions, false, `inbox has no ${name} action`);
  }
  S.running = true;
  for (const action of [() => ctx.actions.reset(), () => inbox.actions.reset()]) assert.throws(action, /Wait for the current email/);
  S.running = false;
  assert.equal(inbox.actions.reset(), "page promise");
  assert.deepEqual(calls, [["inspect", "vendor-redirect"], ["resolve", "sampler-refund", true], ["resolve", "sampler-refund", false], ["resolve", "sampler-refund", false],
    ["reset"]]);
  const bare = autopilotInboxCtx({ inbox: sampleInbox(), records: {} });
  assert.throws(() => bare.actions.reset(), /This page cannot do that here/);
  let refreshed = 0;
  autopilotInboxCtx({ refresh: () => { refreshed++; } }).refresh();
  autopilotInboxCtx({}).refresh();
  assert.equal(refreshed, 1);
});

test("benchmark: runs of this page load, capped and normalized, with no action that starts a run", () => {
  const ctx = sampleBenchmarkCtx();
  assert.deepEqual(ctx.items(), []);
  assert.deepEqual(ctx.shown(), []);
  assert.equal(ctx.data.runs.length, 3);
  assert.ok(isDeepFrozen(ctx.data.runs));
  assert.equal(ctx.data.latest.run, 3);
  assert.equal(ctx.data.runs[0].per_call_ms.dispatch, null);
  assert.deepEqual(ctx.data.email, { id: "bec-invoice", from_name: "Roastwell Imports - Billing", from_email: "billing@roastwell-payments.example", subject: "New bank details" });
  assert.equal(ctx.data.busy, false);
  assert.deepEqual(Object.keys(ctx.actions), [], "the benchmark (five live calls) stays the panel's own button");
  assert.deepEqual(ctx.calls, []);
  const empty = emptyBenchmarkCtx({ inbox: [] });
  assert.equal(empty.data.latest, null);
  assert.equal(empty.data.email, null);
  const many = Array.from({ length: 25 }, (_, index) => ({ ...sampleBenchRuns()[1], run: index + 1 }));
  const capped = autopilotBenchmarkCtx({ runs: () => many });
  assert.equal(capped.data.runs.length, 20);
  assert.equal(capped.data.runs[0].run, 6);
  assert.equal(capped.data.runs[0], capped.data.runs[0], "a run keeps its object");
  const odd = autopilotBenchmarkCtx({ runs: [{ sequential: { wall_ms: "fast" } }, null, 7] }).data.runs;
  assert.equal(odd.length, 1);
  assert.deepEqual(odd[0], { run: 1, at: null, model: null, id: "", sequential: { requests: null, wall_ms: null, input_tokens: null, cost_usd: null, questions: null },
    parallel: { requests: null, wall_ms: null, input_tokens: null, cost_usd: null, questions: null }, merged: { requests: null, wall_ms: null, input_tokens: null, cost_usd: null, questions: null },
    per_call_ms: { shield: null, dispatch: null, merged: null } });
});

// ---------- the hook in static/js/autopilot.js ----------

function shownMessagesFor(S, recordsShown, inboxShown) {
  const make = new Function("S", "RECORDS", "INBOX", `${fn("shownMessages")}\nreturn shownMessages;`);
  return make(S, { shown: () => recordsShown }, { shown: () => inboxShown })().map((message) => message.id);
}

test("hook: with no Lab setting the list is S.inbox exactly; filters drop rows and a sort reorders within each group", () => {
  const S = pageState();
  const records = autopilotRecordsCtx(sourceOf(S).source);
  const inbox = autopilotInboxCtx(sourceOf(S).source);
  const ids = S.inbox.map((message) => message.id);
  assert.deepEqual(shownMessagesFor(S, records.shown(), inbox.shown()), ids);
  const [dana, vendor, , tasting] = records.items();
  const [grinder, phish, blank] = inbox.items();
  assert.deepEqual(shownMessagesFor(S, [tasting, vendor, dana], [blank, grinder]), ["tasting-move", "vendor-redirect", "dana-damaged", "blank-note", "grinder-crack"]);
  assert.deepEqual(shownMessagesFor(S, [], [phish]), ["admin-reset"]);
  assert.deepEqual(shownMessagesFor(S, [], []), []);
  // Interleaved places (a record restored for a later email) keep their places: processed rows fill processed places.
  const T = pageState({ records: { "admin-reset": { id: "admin-reset", integrated: { lane: "quarantine" }, naive: {} }, "dana-damaged": sampleRecords()["dana-damaged"] } });
  const r2 = autopilotRecordsCtx(sourceOf(T).source).items();
  assert.deepEqual(r2.map((item) => item.id), ["dana-damaged", "admin-reset"]);
  const order = shownMessagesFor(T, [r2[1], r2[0]], autopilotInboxCtx(sourceOf(T).source).items());
  assert.equal(order[0], "admin-reset");
  assert.equal(order[8], "dana-damaged");
  assert.equal(order.length, 10);
});

test("hook: Run and Next keep their scope, the scoreboard reads the shared tally, and Lab is installed and mounted", () => {
  assert.match(page, /const nextMessage = \(\) => S\.inbox\.find\(\(m\) => !S\.records\[m\.id\]\);/, "Run and Next still read the full inbox");
  assert.match(fn("renderScores"), /const t = RECORDS\.data\.tally;/);
  assert.doesNotMatch(page, /function tally\(/);
  assert.match(fn("boot"), /await initChrome\("\/autopilot"\);\n {2}installLab\(LAB\);/);
  assert.match(page, /import \{ LAB \} from "\.\/lab\/pages\/autopilot\.js";/);
  assert.match(page, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  const rows = fn("renderRows");
  assert.match(rows, /LAB\.active\(RECORDS_ID\) \+ LAB\.active\(INBOX_ID\)/);
  assert.match(rows, /shownMessages\(\)\.map|shown\.map\(renderRow\)/);
  assert.match(fn("clearLab"), /LAB\.reset\(RECORDS_ID\);\n {2}LAB\.reset\(INBOX_ID\);/);
  const lab = fn("renderLab");
  for (const id of ["RECORDS_ID", "INBOX_ID", "BENCH_ID"]) assert.ok(lab.includes(id), `renderLab mounts ${id}`);
  assert.match(lab, /LAB\.section\(labEnv, id, ctx, \{ title \}\)/);
  for (const slot of ["records-lab", "inbox-lab", "bench-lab", "rows-note"]) assert.match(html, new RegExp(`id="${slot}"`), `${slot} is a sibling slot in the page`);
  assert.ok(html.indexOf('id="bench-lab"') > html.indexOf('id="bench"'), "the benchmark tools sit outside #bench, which renderBench empties");
  assert.ok(!/id="rows"[^>]*>\s*<div id="/.test(html), "nothing Lab lives inside #rows");
  assert.match(fn("benchmark"), /S\.benchRuns\.push\(\{ run: .*model, id: "bec-invoice", \.\.\.S\.bench \}\);/);
  assert.match(fn("benchmark"), /if \(S\.benchBusy\) return;/);
});

test("the starter packs attach to the surface ids the page mounts", () => {
  const LAB = createLab([outcomes, waiting]);
  assert.ok(LAB.count("autopilot.records") >= 25 && LAB.count("autopilot.inbox") >= 25);
  assert.deepEqual(LAB.surfaceIds().sort(), ["autopilot.inbox", "autopilot.records"]);
  for (const id of LAB.surfaceIds()) assert.ok(page.includes(`"${id}"`), `${id} is a surface id of the page`);
  assert.ok(page.includes('"autopilot.benchmark"'));
});
