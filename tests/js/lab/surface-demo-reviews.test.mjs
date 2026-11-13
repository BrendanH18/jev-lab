// The Reviews page's Lab surfaces (static/js/lab/surfaces/reviews.js) and their hooks in static/js/reviews.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { reviewsExamplesCtx, reviewsResultCtx } from "../../../static/js/lab/surfaces/reviews.js";
import exampleFacts from "../../../static/js/lab/packs/reviews/review-example-facts.js";
import resultInsights from "../../../static/js/lab/packs/reviews/review-result-insights.js";
import { fakeEnv, textOf } from "./harness.mjs";
import { REVIEWS_POLICY, sampleReviewsResult, sampleReviewsResultCtx, sampleReviewsExamplesCtx, sampleReviewsSetup } from "./fixtures/reviews.mjs";

const PAGE = readFileSync(new URL("../../../static/js/reviews.js", import.meta.url), "utf8");
const PYTHON = readFileSync(new URL("../../../jev/reviews.py", import.meta.url), "utf8");
const body = (name) => PAGE.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });
const throwsMessage = (fn, pattern) => assert.throws(fn, (error) => error instanceof Error && pattern.test(error.message));

// ---------- reviews.examples ----------

test("example items have the documented shape and values", () => {
  const ctx = sampleReviewsExamplesCtx();
  const items = ctx.items();
  assert.equal(items.length, 6);
  assert.deepEqual(Object.keys(items[0]), ["index", "position", "label", "stars", "channel", "channel_label", "about", "text", "chars", "words", "expect", "loaded", "triaged"]);
  assert.deepEqual(items.map((item) => item.label), ["Warm welcome", "Flat beans", "Scalded wrist", "Five stars, angry", "Phone repair ad", "Example 6"]);
  assert.deepEqual(items.map((item) => item.stars), [5, 2, 1, 5, 5, null], "a string star value is not a rating");
  assert.deepEqual(items.map((item) => item.channel_label), ["Map listing", "Website review", "App store review", "Website review", "Map listing", ""]);
  assert.deepEqual(items.map((item) => item.loaded), [false, true, false, false, false, false]);
  assert.deepEqual(items.map((item) => item.triaged), [1, 2, 0, 0, 0, 0], "the stars of a check do not matter, its words do");
  assert.deepEqual(items.map((item) => item.words), [16, 24, 19, 14, 14, 1]);
  assert.equal(items[5].chars, 9);
  assert.equal(items[5].text, "  Fine.  ", "the text is kept exactly");
  assert.equal(items[5].expect, null);
  assert.deepEqual(items[3].expect, { action: "reply", team: "equipment_support", flags: ["rating_mismatch"] });
  assert.equal(items[4].about, "");
  assert.equal(ctx.itemName(items[1], 1), "Flat beans");
  assert.ok(Object.isFrozen(items[0]) && Object.isFrozen(items[0].expect));
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(items))), JSON.stringify(items), "plain JSON");
});

test("example data fields, before and after the setup loads", () => {
  const ctx = sampleReviewsExamplesCtx();
  assert.equal(ctx.data.loaded, 1);
  assert.equal(ctx.data.calls, 3);
  assert.equal(ctx.data.running, false);
  assert.equal(ctx.data.channels.maps, "Map listing");
  assert.equal(ctx.data.actions.reply, "A person replies");
  assert.equal(ctx.data.teams.cafes, "Cafés");
  assert.equal(ctx.data.topic_teams.freshness, "roasting");
  assert.equal(ctx.data.draft.stars, 2);
  const before = sampleReviewsExamplesCtx({ setup: null, draft: null, history: [], calls: 0 });
  assert.deepEqual(before.items(), []);
  assert.deepEqual([before.data.channels, before.data.draft, before.data.loaded, before.data.calls], [{}, null, null, 0]);
  // calls falls back to the history length when the page gives no count.
  assert.equal(sampleReviewsExamplesCtx({ calls: undefined }).data.calls, 3);
});

test("example items keep their identity until the form or the session changes", () => {
  const ctx = sampleReviewsExamplesCtx();
  const first = ctx.items();
  assert.equal(ctx.items(), first);
  assert.equal(ctx.shown()[0], first[0], "shown() hands out the same objects");
  ctx.state.draft = { ...ctx.state.draft, text: "Edited" };
  const edited = ctx.items();
  assert.notEqual(edited, first);
  assert.equal(edited[1].loaded, false);
  assert.equal(ctx.data.loaded, null);
  ctx.state.history = [...ctx.state.history, { call: 4, at: 1, review: { stars: 1, channel: "app", about: "Pier Street café", text: ctx.state.setup.examples[2].text }, answers: {}, meta: null }];
  assert.equal(ctx.items()[2].triaged, 1);
});

test("examples shown() honors the page's matches and arrange hooks, evaluated at call time", () => {
  let hide = "Flat beans";
  const ctx = sampleReviewsExamplesCtx({ matches: (item) => item.label !== hide, arrange: (list) => [...list].reverse() });
  assert.deepEqual(ctx.shown().map((item) => item.index), [5, 4, 3, 2, 0]);
  hide = "Spam that is not here";
  assert.equal(ctx.shown().length, 6);
  const odd = sampleReviewsExamplesCtx({ arrange: () => "not a list" });
  assert.equal(odd.shown().length, 6, "an arrange hook that returns no list leaves the order alone");
});

test("example actions go through the page's operations and refuse what the page refuses", () => {
  const ctx = sampleReviewsExamplesCtx();
  ctx.actions.use(3);
  assert.deepEqual(ctx.log, [["use", 3]]);
  assert.equal(ctx.data.loaded, 3);
  assert.equal(ctx.state.result, null, "loading an example clears the result, as the chip does");
  throwsMessage(() => ctx.actions.use(9), /no example 10/);
  throwsMessage(() => ctx.actions.use("1"), /no example 1/);
  throwsMessage(() => sampleReviewsExamplesCtx({ setup: null }).actions.use(0), /not loaded/);
  const busy = sampleReviewsExamplesCtx({ running: true });
  throwsMessage(() => busy.actions.use(0), /Wait for the triage/);
  throwsMessage(() => busy.actions.focusRun(), /already running/);
  assert.deepEqual(busy.log, []);
  ctx.actions.focusText();
  ctx.actions.focusRun();
  assert.deepEqual(ctx.log.slice(1), [["focusText"], ["focusRun"]]);
  throwsMessage(() => reviewsExamplesCtx({ setup: sampleReviewsSetup() }).actions.use(0), /cannot do that here/);
  // A stray non-object in the setup is skipped without shifting the others' indexes.
  const setup = sampleReviewsSetup();
  setup.examples.splice(1, 0, "not an example");
  const used = [];
  const gappy = reviewsExamplesCtx({ setup, use: (index) => used.push(index) });
  assert.deepEqual(gappy.items().map((item) => [item.index, item.position, item.label]).slice(0, 3), [[0, 1, "Warm welcome"], [2, 3, "Flat beans"], [3, 4, "Scalded wrist"]]);
  gappy.actions.use(2);
  assert.deepEqual(used, [2]);
  throwsMessage(() => gappy.actions.use(1), /no example 2/);
  ctx.refresh();
  assert.equal(ctx.refreshes, 1);
  assert.equal("replaceItems" in ctx.actions || "importItems" in ctx.actions, false, "the examples are read-only");
});

// ---------- reviews.result ----------

test("result items have the documented shape, cuts from the policy in force, and none before a check", () => {
  const ctx = sampleReviewsResultCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["topic", "severity", "tone", "safety", "wants_reply", "about_us"]);
  assert.deepEqual(Object.keys(items[0]), ["id", "position", "type", "instructions", "value", "display", "label", "scale", "probabilities", "top", "confidence", "cuts", "answer"]);
  const [topic, severity, tone, safety, wantsReply, aboutUs] = items;
  assert.deepEqual([topic.value, topic.display, topic.label, topic.scale, topic.cuts], ["freshness", "freshness", "Freshness", null, []]);
  assert.equal(topic.probabilities.length, 8);
  assert.deepEqual(topic.top, { key: "freshness", p: 0.81 });
  assert.deepEqual([severity.value, severity.display, severity.scale, severity.confidence], [1.62, "1.62 / 3", 3, 0.6]);
  assert.match(severity.label, /^Real problem/);
  assert.deepEqual(severity.cuts, [{ key: "p1_at", at: 2 }, { key: "p2_at", at: 1 }]);
  assert.deepEqual([tone.display, tone.label, tone.cuts], ["1.05 / 4", "Negative: disappointed", [{ key: "thank_tone_at", at: 3 }]]);
  assert.deepEqual([safety.display, safety.label, safety.confidence, safety.top], ["2.0%", "", null, { key: "no", p: 0.98 }]);
  assert.deepEqual(wantsReply.cuts, [{ key: "wants_reply_at", at: 0.6 }], "the cut in force, not the default");
  assert.deepEqual(aboutUs.cuts, [{ key: "about_us_min", at: 0.5 }]);
  assert.equal(safety.instructions, "Does `review.text` report that someone was hurt or made ill?");
  assert.equal(ctx.itemName(severity, 1), "severity");
  assert.ok(Object.isFrozen(severity.cuts[0]) && Object.isFrozen(severity.answer));
  const empty = sampleReviewsResultCtx({ result: null });
  assert.deepEqual([empty.items(), empty.shown()], [[], []]);
  for (const key of ["review", "triage", "policy", "questions", "meta", "trace"]) assert.equal(empty.data[key], null, key);
  assert.equal(empty.data.settings.wants_reply_at, 0.6, "the sliders exist before any check");
});

test("odd answers become unavailable values instead of throwing", () => {
  const result = sampleReviewsResult();
  result.answers = { topic: { type: "choice", choice: null, probabilities: { a: "x" } }, severity: { type: "score", score: "high" }, safety: { type: "noul" },
    extra: { type: "box", box: {} }, broken: "not an answer" };
  result.policy = null;
  const items = sampleReviewsResultCtx({ result }).items();
  assert.deepEqual(items.map((item) => [item.id, item.value, item.display, item.top, item.cuts.length]),
    [["topic", null, "", null, 0], ["severity", null, "", null, 0], ["safety", null, "", null, 0], ["extra", null, "", null, 0]]);
});

test("re-deciding replaces the item objects so cuts follow the new policy; otherwise they keep their identity", () => {
  const ctx = sampleReviewsResultCtx();
  const before = ctx.items();
  assert.equal(ctx.items(), before);
  ctx.state.result.policy = { ...ctx.state.result.policy, safety_at: 0.25 };
  const after = ctx.items();
  assert.notEqual(after, before);
  assert.deepEqual(after.find((item) => item.id === "safety").cuts, [{ key: "safety_at", at: 0.25 }]);
  assert.equal(ctx.data.policy.safety_at, 0.25);
});

test("result data fields: decision, policy, settings, changes, labels and session history", () => {
  const ctx = sampleReviewsResultCtx();
  assert.equal(ctx.data.triage.action, "reply");
  assert.ok(Object.isFrozen(ctx.data.triage.checks[0]));
  assert.equal(ctx.data.triage, ctx.data.triage, "the same frozen copy until the page replaces the triage");
  assert.deepEqual(Object.keys(ctx.data.policy), ["safety_at", "about_us_min", "wants_reply_at", "p1_at", "p2_at", "mismatch_gap", "thank_tone_at"]);
  assert.deepEqual(ctx.data.defaults, REVIEWS_POLICY);
  assert.deepEqual(ctx.data.changed, ["wants_reply_at"]);
  assert.deepEqual(ctx.data.review, { stars: 2, channel: "website", channel_label: "Website review", about: "Harbor House Blend, 340 g bag", text: ctx.state.result.review.text });
  assert.equal(ctx.data.labels.topics.cafe_service, "Café service");
  assert.equal(ctx.data.labels.flags.rating_mismatch, "Stars disagree with words");
  assert.equal(ctx.data.labels.channels.app, "App store review");
  assert.equal(ctx.data.topic_teams.equipment, "equipment_support");
  assert.equal(ctx.data.questions.topic.type, "choice");
  assert.equal(ctx.data.meta.cost_usd, 0.00042);
  assert.equal(ctx.data.trace.request.state.review.channel, "Website review");
  assert.equal(ctx.data.note, "Re-decided in 3 ms · no Jev call");
  assert.deepEqual([ctx.data.running, ctx.data.calls], [false, 3]);
  const history = ctx.data.history;
  assert.deepEqual(history.map((entry) => [entry.call, entry.review.stars]), [[1, 5], [2, 2], [3, 3]]);
  assert.deepEqual(Object.keys(history[0]), ["call", "at", "review", "answers", "meta"], "no triage in the history");
  assert.ok(Object.isFrozen(history[2].answers.topic));
  const long = Array.from({ length: 60 }, (_, index) => ({ call: index + 1, at: index, review: { stars: 3, channel: "app", about: "", text: "x" }, answers: {}, meta: null }));
  assert.deepEqual(sampleReviewsResultCtx({ history: long }).data.history.map((entry) => entry.call).slice(0, 2), [11, 12], "the newest 50");
  const unloaded = sampleReviewsResultCtx({ setup: null });
  assert.deepEqual([unloaded.data.settings, unloaded.data.defaults, unloaded.data.changed], [null, null, []]);
  assert.deepEqual(unloaded.data.labels.teams, {});
  assert.equal(Object.keys(unloaded.data.limits).length, 7);
});

test("setPolicy moves the sliders like dragging them does, and refuses what they cannot do", () => {
  const ctx = sampleReviewsResultCtx();
  assert.deepEqual(ctx.actions.setPolicy({ safety_at: 0.35 }), { ...REVIEWS_POLICY, wants_reply_at: 0.6, safety_at: 0.35 });
  assert.equal(ctx.state.settings.safety_at, 0.35);
  // Moving P1 below P2 drags P2 down, and moving P2 above P1 drags P1 up, exactly as the sliders do.
  ctx.actions.setPolicy({ p1_at: 0.5 });
  assert.deepEqual([ctx.state.settings.p1_at, ctx.state.settings.p2_at], [0.5, 0.5]);
  ctx.actions.setPolicy({ p2_at: 2.7 });
  assert.deepEqual([ctx.state.settings.p1_at, ctx.state.settings.p2_at], [2.7, 2.7]);
  ctx.actions.setPolicy({ mismatch_gap: "1.75", thank_tone_at: 3.3 });
  assert.deepEqual([ctx.state.settings.mismatch_gap, ctx.state.settings.thank_tone_at], [1.75, 3.3]);
  const calls = ctx.log.length;
  assert.equal(ctx.actions.setPolicy({ safety_at: 0.35 }).safety_at, 0.35);
  assert.equal(ctx.log.length, calls, "a change that moves nothing does not re-decide");
  for (const [changes, pattern] of [[{}, /at least one/], [null, /at least one/], [{ budget: 1 }, /no policy setting "budget"/], [{ safety_at: "high" }, /must be a number/],
    [{ safety_at: Infinity }, /must be a number/], [{ safety_at: 1.05 }, /from 0 to 1/], [{ mismatch_gap: 0.25 }, /from 0.5 to 4/], [{ safety_at: 0.33 }, /steps of 0.05/],
    [{ p1_at: 1.25 }, /steps of 0.1/], [{ p1_at: 1, p2_at: 2 }, /cannot sit below/]]) {
    throwsMessage(() => ctx.actions.setPolicy(changes), pattern);
  }
  assert.equal(ctx.log.length, calls, "a refused change reaches nothing");
  throwsMessage(() => sampleReviewsResultCtx({ setup: null }).actions.setPolicy({ safety_at: 0.5 }), /not loaded/);
  throwsMessage(() => sampleReviewsResultCtx({ settings: null }).actions.resetPolicy(), /not loaded/);
  ctx.actions.resetPolicy();
  assert.deepEqual(ctx.state.settings, REVIEWS_POLICY);
});

test("setStars, focusPolicy and inspect keep the page's guards", () => {
  const ctx = sampleReviewsResultCtx();
  ctx.actions.setStars(5);
  assert.deepEqual(ctx.log, [["setStars", 5]]);
  assert.equal(ctx.data.review.stars, 5);
  for (const bad of [0, 6, 2.5, "3", null]) throwsMessage(() => ctx.actions.setStars(bad), /whole number from 1 to 5/);
  throwsMessage(() => sampleReviewsResultCtx({ running: true }).actions.setStars(3), /Wait for the triage/);
  throwsMessage(() => sampleReviewsResultCtx({ setup: null }).actions.setStars(3), /not loaded/);
  ctx.actions.focusPolicy("p2_at");
  throwsMessage(() => ctx.actions.focusPolicy("budget"), /no policy setting/);
  ctx.actions.inspect();
  assert.deepEqual(ctx.log.slice(1), [["focusPolicy", "p2_at"], ["inspect"]]);
  throwsMessage(() => sampleReviewsResultCtx({ result: null }).actions.inspect(), /Triage a review first/);
  assert.equal("replaceItems" in ctx.actions || "importItems" in ctx.actions, false, "answers are read-only");
});

test("the slider limits match the page's sliders and the Python defaults", () => {
  const limits = sampleReviewsResultCtx().data.limits;
  const sliders = [...PAGE.matchAll(/slider\("(\w+)", "([^"]+)", ([\d.]+), ([\d.]+), ([\d.]+)/g)].map(([, key, label, min, max, step]) => [key, { min: Number(min), max: Number(max), step: Number(step), label }]);
  assert.deepEqual(Object.fromEntries(sliders), limits);
  const defaults = Object.fromEntries([...PYTHON.match(/DEFAULT_POLICY = \{([^}]*)\}/)[1].matchAll(/"(\w+)":\s*([\d.]+)/g)].map(([, key, value]) => [key, Number(value)]));
  assert.deepEqual(Object.keys(defaults), Object.keys(limits));
  assert.deepEqual(defaults, REVIEWS_POLICY, "the fixture's defaults are the real ones");
  for (const [key, value] of Object.entries(defaults)) {
    const steps = (value - limits[key].min) / limits[key].step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${key}'s default sits on its slider's grid`);
  }
});

// ---------- the hooks, with a real Lab ----------

test("a Lab filter and sort reach shown(); active() counts them and reset() clears them", () => {
  const lab = createLab([exampleFacts, resultInsights]);
  const setup = sampleReviewsSetup();
  const state = { review: { ...setup.examples[0], about: setup.examples[0].about } };
  const examples = reviewsExamplesCtx({ setup, draft: () => state.review, matches: (item, ctx) => lab.matches("reviews.examples", item, ctx),
    arrange: (list, ctx) => lab.arrange("reviews.examples", list, ctx) });
  assert.equal(examples.shown().length, 6, "no Lab setting: everything, in page order");
  assert.equal(lab.active("reviews.examples"), 0);
  const view = lab.view("reviews.examples");
  view.filters = [{ key: "review-example-facts/stars", op: "min", value: "5" }];
  view.sort = { key: "review-example-facts/words", dir: "desc" };
  assert.deepEqual(examples.shown().map((item) => item.label), ["Warm welcome", "Five stars, angry", "Phone repair ad"]);
  assert.equal(lab.active("reviews.examples"), 2);
  lab.reset("reviews.examples");
  assert.deepEqual(examples.shown().map((item) => item.label), setup.examples.map((example, index) => example.label || `Example ${index + 1}`));

  const result = sampleReviewsResultCtx({ matches: (item, ctx) => lab.matches("reviews.result", item, ctx), arrange: (list, ctx) => lab.arrange("reviews.result", list, ctx) });
  lab.view("reviews.result").filters = [{ key: "review-result-insights/has_cut", op: "with" }];
  lab.view("reviews.result").sort = { key: "review-result-insights/cut_distance", dir: "asc" };
  // Distances: severity 0.38, tone 1.95, safety 0.48, wants_reply 0.33, about_us 0.48 (ties keep page order).
  assert.deepEqual(result.shown().map((item) => item.id), ["wants_reply", "severity", "safety", "about_us", "tone"]);
  const section = lab.section(fakeEnv(), "reviews.result", result);
  assert.match(textOf(section), /Lab tools · 42/);
});

// Rebuilds a page function from static/js/reviews.js with stand-ins for what it reads.
function pageFunction(name, scope) {
  const names = Object.keys(scope);
  return new Function(...names, `${body(name)}\nreturn ${name};`)(...names.map((key) => scope[key]));
}

test("the page's example chips render shown(), and add Lab's note only while a Lab setting is active", () => {
  const lab = createLab([exampleFacts]);
  const setup = sampleReviewsSetup();
  const S = { setup, running: false };
  const EXAMPLES = reviewsExamplesCtx({ setup, matches: (item, ctx) => lab.matches("reviews.examples", item, ctx), arrange: (list, ctx) => lab.arrange("reviews.examples", list, ctx) });
  const loaded = [];
  const exampleNodes = pageFunction("exampleNodes", { S, h, LAB: lab, EXAMPLES, EXAMPLES_ID: "reviews.examples", useExample: (ex) => loaded.push(ex), resetExamplesLab: () => {} });
  let nodes = exampleNodes().filter(Boolean);
  assert.equal(nodes.length, 1, "no note without a Lab setting");
  assert.equal(nodes[0].attrs.class, "chips");
  assert.deepEqual(nodes[0].children.map(textOf), ["Warm welcome", "Flat beans", "Scalded wrist", "Five stars, angry", "Phone repair ad", "Example 6"]);
  nodes[0].children[2].attrs.onclick();
  assert.equal(loaded[0], setup.examples[2], "a chip loads its own example");
  lab.view("reviews.examples").filters = [{ key: "review-example-facts/channel", op: "is", value: "Map listing" }];
  nodes = exampleNodes().filter(Boolean);
  assert.deepEqual(nodes[0].children.map(textOf), ["Warm welcome", "Phone repair ad"]);
  assert.match(textOf(nodes[1]), /^2 of 6 examples shown · 1 Lab setting active/);
  nodes[0].children[1].attrs.onclick();
  assert.equal(loaded[1], setup.examples[4], "a filtered chip still loads its own example");
  lab.view("reviews.examples").filters = [{ key: "review-example-facts/stars", op: "min", value: "9" }];
  assert.match(textOf(exampleNodes()[1]), /^No example matches the Lab filters\./);
  S.running = true;
  lab.reset("reviews.examples");
  assert.ok(exampleNodes()[0].children.every((chip) => chip.attrs.disabled === true), "chips stay disabled while a check runs");
});

test("the page's answer cards render shown(), with Lab's note only while a Lab setting is active", () => {
  const lab = createLab([resultInsights]);
  const result = sampleReviewsResult();
  const S = { result };
  const RESULT = reviewsResultCtx({ result: () => S.result, setup: sampleReviewsSetup(), matches: (item, ctx) => lab.matches("reviews.result", item, ctx),
    arrange: (list, ctx) => lab.arrange("reviews.result", list, ctx) });
  const answerCard = (qid, answer, question) => ({ tag: "card", attrs: { qid, answer, question }, children: [] });
  const answerNodes = pageFunction("answerNodes", { S, h, LAB: lab, RESULT, RESULT_ID: "reviews.result", answerCard, resetResultLab: () => {} });
  let nodes = answerNodes().flat().filter(Boolean);
  assert.deepEqual(nodes.map((node) => node.attrs.qid), ["topic", "severity", "tone", "safety", "wants_reply", "about_us"]);
  assert.equal(nodes[0].attrs.answer, result.answers.topic, "the card gets the page's own answer object");
  assert.equal(nodes[0].attrs.question, result.trace.request.questions.topic);
  lab.view("reviews.result").filters = [{ key: "review-result-insights/type", op: "is", value: "noul" }];
  nodes = answerNodes().flat().filter(Boolean);
  assert.deepEqual(nodes.slice(0, 3).map((node) => node.attrs.qid), ["safety", "wants_reply", "about_us"]);
  assert.match(textOf(nodes[3]), /^3 of 6 answers shown · 1 Lab setting active/);
  lab.view("reviews.result").filters = [{ key: "review-result-insights/type", op: "is", value: "box" }];
  assert.equal(textOf(answerNodes()[0]), "No answer matches the Lab filters.");
});

test("the page wires Lab once, mounts both sections, and moves the policy only through its own path", () => {
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/reviews\.js";/);
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  assert.match(body("boot"), /await initChrome\("\/reviews"\);\n {2}installLab\(LAB\);/);
  assert.match(body("renderForm"), /h\("div", \{ id: "review-examples" \}, exampleNodes\(\)\),\n\s+LAB\.section\(labEnv, EXAMPLES_ID, EXAMPLES\),/);
  const render = body("renderResult");
  assert.equal(render.match(/LAB\.section\(labEnv, RESULT_ID, RESULT\)/g).length, 2, "before and after a check");
  assert.match(render, /id: "review-answers"[^\n]*answerNodes\(\)/);
  assert.match(body("renderPolicy"), /"data-policy": key/);
  assert.match(body("renderPolicy"), /onclick: \(\) => applyPolicy\(S\.setup\.policy\)/);
  // applyPolicy is exactly what the Reset button used to do: copy, bump the revision, redraw, re-decide.
  const calls = [];
  const S = { policy: {}, policyRev: 4 };
  const next = { safety_at: 0.4 };
  pageFunction("applyPolicy", { S, renderPolicy: () => calls.push("renderPolicy"), redecide: () => calls.push("redecide") })(next);
  assert.deepEqual([S.policy, S.policy !== next, S.policyRev, calls], [{ safety_at: 0.4 }, true, 5, ["renderPolicy", "redecide"]]);
  // setStars keeps the old star picker's behavior: update the form, and re-decide only when there is a result.
  const T = { review: { stars: 2 }, result: null, policyRev: 0 };
  const decided = [];
  const setStars = pageFunction("setStars", { S: T, decideAgain: () => decided.push(T.result.review.stars) });
  setStars(4);
  assert.deepEqual([T.review.stars, T.policyRev, decided], [4, 0, []]);
  T.result = { review: { stars: 4 } };
  setStars(1);
  assert.deepEqual([T.result.review.stars, T.policyRev, decided], [1, 1, [1]]);
  // A check records the session history the surfaces read, capped at the page's limit.
  assert.match(body("check"), /S\.calls \+= 1;\n\s+S\.history\.push\(\{ call: S\.calls, at: Date\.now\(\), review: \{ \.\.\.S\.result\.review \}, answers: S\.result\.answers, meta: S\.result\.meta \}\);/);
});
