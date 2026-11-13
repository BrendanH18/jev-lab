// The Overview page's Lab surfaces: the builders of static/js/lab/surfaces/index.js, and the hooks in
// static/js/index.js, rebuilt from the page source with stand-ins for the DOM and the network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { indexAppsCtx, indexPlaygroundCtx } from "../../../static/js/lab/surfaces/index.js";
import playPack from "../../../static/js/lab/packs/index/index-playground-insights.js";
import appsPack from "../../../static/js/lab/packs/index/index-apps-explorer.js";
import { fakeEnv, find, fire, textOf } from "./harness.mjs";
import { APP_CARDS, APPS_PAGE, HELLO_EXAMPLES, HELLO_QUESTIONS, ODD_APP_CARDS, PLAYGROUND_HISTORY, PLAYGROUND_RESULTS,
  sampleIndexAppsCtx, sampleIndexPlaygroundCtx } from "./fixtures/index.mjs";

const PAGE = readFileSync(new URL("../../../static/js/index.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../static/index.html", import.meta.url), "utf8");
const HELLO_PY = readFileSync(new URL("../../../jev/hello.py", import.meta.url), "utf8");
const body = (name) => {
  const match = PAGE.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `static/js/index.js has no function ${name}`);
  return match[0];
};
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });
// mount() as common.js has it, recording what each target holds now.
const screen = () => {
  const held = new Map();
  const mount = (target, ...nodes) => { held.set(typeof target === "string" ? target : target, nodes.flat(Infinity).filter(Boolean)); return target; };
  return { held, mount };
};

// ---------- index.playground builder ----------

test("playground items have the contract's shape, in the response's order", () => {
  const ctx = sampleIndexPlaygroundCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["intent", "urgency", "wants_money_back", "talks_to_ai"]);
  const { answer, ...intent } = items[0];
  assert.deepEqual(intent, {
    id: "intent", position: 1, type: "choice", instructions: HELLO_QUESTIONS.intent.instructions,
    criteria: Object.entries(HELLO_QUESTIONS.intent.criteria).map(([key, text]) => ({ key, text })),
    value: "making_request", display: "making request", scale: null,
    probabilities: [{ key: "making_request", p: 0.62 }, { key: "complaining", p: 0.34 }, { key: "asking_question", p: 0.02 }, { key: "sharing_info", p: 0.02 }, { key: "praising", p: 0 }],
    top: { key: "making_request", p: 0.62 }, confidence: 0.62, box: null });
  assert.deepEqual(answer, PLAYGROUND_RESULTS.refund.answers.intent);
  assert.notEqual(answer, PLAYGROUND_RESULTS.refund.answers.intent, "the raw answer is a copy");
  const urgency = items[1];
  assert.equal(urgency.display, "1.62 / 2");
  assert.equal(urgency.scale, 2);
  assert.deepEqual(urgency.criteria.map((entry) => entry.key), ["0", "1", "2"]);
  assert.deepEqual(urgency.top, { key: "2", p: 0.66 });
  const money = items[2];
  assert.equal(money.display, "97.0%");
  assert.equal(money.confidence, null);
  assert.deepEqual(money.criteria, []);
  assert.equal(money.probabilities[0].key, "yes");
  assert.ok(Math.abs(money.probabilities[1].p - 0.03) < 1e-12);
  assert.equal(items[3].top.key, "no");
  assert.deepEqual(items.map((item) => item.position), [1, 2, 3, 4]);
  assert.equal(ctx.itemName(items[2], 2), "wants_money_back");
  assert.equal(ctx.itemName({}, 4), "5");
  for (const item of items) JSON.parse(JSON.stringify(item));
});

test("the fixture's questions match jev/hello.py", () => {
  for (const [id, question] of Object.entries(HELLO_QUESTIONS)) {
    assert.ok(HELLO_PY.includes(`"${id}": ${question.type}("${question.instructions}"`), `${id} differs from jev/hello.py`);
    for (const text of Object.values(question.criteria || {})) assert.ok(HELLO_PY.includes(`"${text}"`), `${id}: ${text}`);
  }
  for (const example of HELLO_EXAMPLES) assert.ok(HELLO_PY.includes(`"label": "${example.label}"`));
});

test("odd answers: Box, unknown types, missing values and legend-only Scores read without throwing", () => {
  const items = Object.fromEntries(sampleIndexPlaygroundCtx({ result: PLAYGROUND_RESULTS.odd }).items().map((item) => [item.id, item]));
  assert.deepEqual(items.spot.box, { left: 0.2, top: 0.3, right: 0.6, bottom: 0.5 });
  assert.equal(items.spot.display, "40% × 20%");
  assert.equal(items.spot.value, null);
  assert.equal(items.mystery.type, "rank");
  assert.equal(items.mystery.instructions, '{"text":"Rank the tins"}');
  assert.deepEqual([items.mystery.value, items.mystery.display, items.mystery.top], [null, "", null]);
  assert.deepEqual(items.pending_choice.probabilities, [{ key: "roast", p: 0.5 }], "a probability that is not a number is left out");
  assert.deepEqual(items.pending_choice.criteria, [{ key: "roast", text: "A bag of roasted beans" }, { key: "grind", text: "" }]);
  assert.equal(items.legacy_score.instructions, "");
  assert.deepEqual(items.legacy_score.criteria.map((entry) => entry.text), ["None", "Little", "Some", "Most", "All"]);
  assert.equal(items.legacy_score.display, "3.40 / 4");
  assert.deepEqual([items.silent_noul.value, items.silent_noul.probabilities], [null, []]);
  assert.deepEqual(items.yes_no.criteria, [{ key: "true", text: "Deeper than a fingertip" }, { key: "false", text: "Only a scuff" }]);
  assert.equal(items.yes_no.top.key, "yes", "a tie keeps the first entry");
  const ctx = sampleIndexPlaygroundCtx({ result: PLAYGROUND_RESULTS.odd });
  assert.equal(ctx.data.meta, null);
  assert.equal(ctx.data.text, "Photo of a dented tin from Harbor Coffee Co.");
  // Not an object at all, or answers that are not objects.
  assert.deepEqual(sampleIndexPlaygroundCtx({ result: "oops" }).items(), []);
  assert.deepEqual(sampleIndexPlaygroundCtx({ result: { answers: { a: null, b: 3, c: { type: "noul", noul: 0.2 } } } }).items().map((item) => item.id), ["c"]);
});

test("playground items and data are frozen and keep their identity until a new answer arrives", () => {
  let result = PLAYGROUND_RESULTS.refund;
  const ctx = sampleIndexPlaygroundCtx({ result: () => result });
  const first = ctx.items();
  assert.equal(ctx.items(), first);
  assert.equal(ctx.shown()[0], first[0]);
  assert.throws(() => { first[0].value = "praising"; }, TypeError);
  assert.throws(() => { first[0].probabilities[0].p = 1; }, TypeError);
  assert.throws(() => { ctx.data.request.state.text = "changed"; }, TypeError);
  assert.throws(() => { ctx.data.examples.push({}); }, TypeError);
  result = PLAYGROUND_RESULTS.praise;
  assert.notEqual(ctx.items()[0], first[0]);
  assert.equal(ctx.items()[0].value, "praising");
  assert.equal(PLAYGROUND_RESULTS.refund.answers.intent.choice, "making_request", "the raw result is untouched");
});

test("shown() applies the page's Lab filter, then the Lab sort, at call time", () => {
  const hidden = new Set();
  let reverse = false;
  const ctx = sampleIndexPlaygroundCtx({ matches: (item) => !hidden.has(item.id), arrange: (list) => (reverse ? list.slice().reverse() : list) });
  assert.deepEqual(ctx.shown(), ctx.items());
  hidden.add("urgency");
  assert.deepEqual(ctx.shown().map((item) => item.id), ["intent", "wants_money_back", "talks_to_ai"]);
  reverse = true;
  assert.deepEqual(ctx.shown().map((item) => item.id), ["talks_to_ai", "wants_money_back", "intent"]);
  assert.deepEqual(ctx.items().map((item) => item.id), ["intent", "urgency", "wants_money_back", "talks_to_ai"], "items() is never filtered");
  // With no hooks at all, shown() is items().
  const bare = indexPlaygroundCtx({ result: PLAYGROUND_RESULTS.refund });
  assert.deepEqual(bare.shown(), bare.items());
});

test("playground data: text, draft, stale, pending, error, configured and examples", () => {
  const ctx = sampleIndexPlaygroundCtx();
  assert.equal(ctx.data.text, HELLO_EXAMPLES[0].text);
  assert.equal(ctx.data.stale, false);
  assert.equal(sampleIndexPlaygroundCtx({ draft: `  ${HELLO_EXAMPLES[0].text}\n` }).data.stale, false, "the server trims the text");
  assert.equal(sampleIndexPlaygroundCtx({ draft: "Is the Harbor House Blend back?" }).data.stale, true);
  const long = "x".repeat(4000);
  assert.equal(sampleIndexPlaygroundCtx({ draft: `${long}yyy`, result: { ...PLAYGROUND_RESULTS.praise, trace: { request: { state: { text: long } } } } }).data.stale, false,
    "the server cuts the text to 4,000 characters");
  const empty = sampleIndexPlaygroundCtx({ result: null, draft: "anything" });
  assert.deepEqual([empty.data.text, empty.data.stale, empty.data.questions, empty.data.request, empty.data.meta, empty.data.trace], [null, false, null, null, null, null]);
  assert.deepEqual([ctx.data.pending, ctx.data.error, ctx.data.configured], [false, null, true]);
  assert.deepEqual([sampleIndexPlaygroundCtx({ pending: true }).data.pending, sampleIndexPlaygroundCtx({ error: "Budget reached" }).data.error,
    sampleIndexPlaygroundCtx({ error: "" }).data.error, sampleIndexPlaygroundCtx({ configured: "yes" }).data.configured], [true, "Budget reached", null, false]);
  assert.deepEqual(ctx.data.examples, HELLO_EXAMPLES.map(({ label, text }) => ({ label, text })));
  assert.deepEqual(sampleIndexPlaygroundCtx({ examples: [null, { label: "Only label" }] }).data.examples, [{ label: "Only label", text: "" }]);
  assert.deepEqual(sampleIndexPlaygroundCtx({ examples: "nope" }).data.examples, []);
  assert.deepEqual(ctx.data.request, { state: { text: HELLO_EXAMPLES[0].text }, model: "jev-latest", questions: HELLO_QUESTIONS });
  assert.deepEqual(ctx.data.questions, HELLO_QUESTIONS);
  assert.equal(ctx.data.meta.cost_usd, 0.000017304);
  assert.deepEqual(Object.keys(ctx.data.trace), ["request", "response", "meta"]);
  // Live: a getter reads the source again.
  let draft = "a";
  const live = sampleIndexPlaygroundCtx({ draft: () => draft });
  assert.equal(live.data.draft, "a");
  draft = "b";
  assert.equal(live.data.draft, "b");
});

test("playground history: this session's calls, oldest first, the newest 50, as items", () => {
  const ctx = sampleIndexPlaygroundCtx();
  const history = ctx.data.history;
  assert.deepEqual(history.map((entry) => [entry.call, entry.text]), PLAYGROUND_HISTORY.map((entry) => [entry.call, entry.result.trace.request.state.text]));
  assert.equal(history[2].rows, ctx.items(), "the last entry's rows are the shown call's items");
  assert.equal(history[0].meta.latency_ms, 96.2);
  assert.equal(history[1].at, PLAYGROUND_HISTORY[1].at);
  assert.equal(ctx.data.calls, 3);
  const many = Array.from({ length: 60 }, (_, index) => ({ call: index + 1, at: index, result: PLAYGROUND_RESULTS.praise }));
  const long = sampleIndexPlaygroundCtx({ history: [...many, null, { call: 61 }], calls: null });
  assert.equal(long.data.history.length, 50);
  assert.equal(long.data.history[0].call, 11);
  assert.equal(long.data.calls, 50, "without a count, calls falls back to the history length");
  assert.deepEqual(sampleIndexPlaygroundCtx({ history: "nope" }).data.history, []);
  assert.throws(() => { history.push({}); }, TypeError);
});

test("playground actions: guards, no model call, and no way to edit answers", () => {
  const ctx = sampleIndexPlaygroundCtx();
  assert.deepEqual(Object.keys(ctx.actions).sort(), ["draftText", "focusText", "inspect", "openSettings"]);
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
  assert.throws(() => ctx.actions.draftText("   "), /no text/);
  assert.throws(() => ctx.actions.draftText(42), /no text/);
  assert.equal(ctx.actions.draftText("Do you roast on Mondays?"), "Do you roast on Mondays?");
  ctx.actions.inspect();
  ctx.actions.focusText();
  ctx.actions.openSettings();
  assert.deepEqual(ctx.log, [["draftText", "Do you roast on Mondays?"], ["inspect"], ["focusText"], ["openSettings"]]);
  const empty = sampleIndexPlaygroundCtx({ result: null });
  assert.throws(() => empty.actions.inspect(), /Run the playground first/);
  assert.deepEqual(empty.log, []);
  const bare = indexPlaygroundCtx({ result: PLAYGROUND_RESULTS.refund });
  for (const run of [() => bare.actions.draftText("hi"), () => bare.actions.inspect(), () => bare.actions.focusText(), () => bare.actions.openSettings()]) {
    assert.throws(run, /cannot do that here/);
  }
  bare.refresh();  // no refresh callback: nothing happens
  ctx.refresh();
  assert.deepEqual(ctx.log.at(-1), ["refresh"]);
});

// ---------- index.apps builder ----------

test("app items have the contract's shape and keep the page's order", () => {
  const ctx = sampleIndexAppsCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["shield", "dispatch", "autopilot", "claims", "counter", "reviews", "find", "play", "workbench"]);
  assert.deepEqual(items[2], { id: "autopilot", href: "/autopilot", position: 3, label: "APP 3 · INTEGRATED", number: 3, tag: "INTEGRATED",
    title: "🧭 Autopilot", emoji: "🧭", name: "Autopilot", summary: APP_CARDS[2].summary, points: APP_CARDS[2].points, featured: true, cta: "Open Autopilot →" });
  assert.deepEqual([items[4].label, items[4].number, items[4].tag, items[4].emoji, items[4].name, items[4].points], ["App 8", 8, "", "", "Counter", []]);
  assert.deepEqual([items[8].number, items[8].tag], [8, "BUILD YOUR OWN"]);
  assert.equal(ctx.itemName(items[0], 0), "shield");
  assert.throws(() => { items[0].name = "Other"; }, TypeError);
  assert.equal(ctx.items(), items, "the same array while the cards are the same");
  const odd = sampleIndexAppsCtx({ cards: ODD_APP_CARDS }).items();
  assert.deepEqual(odd.map((item) => item.id), ["app-1", "shield", "shield-2"]);
  assert.deepEqual([odd[0].title, odd[0].points, odd[0].number, odd[0].label], ["Untitled card", ["one point"], null, ""]);
  assert.deepEqual([odd[2].emoji, odd[2].name, odd[2].number, odd[2].tag], ["🛡️", "", 9, "copy"]);
  assert.deepEqual(sampleIndexAppsCtx({ cards: "nope" }).items(), []);
});

test("app cards are read again only when the page gives a new array", () => {
  let cards = APP_CARDS;
  const ctx = sampleIndexAppsCtx({ cards: () => cards });
  const first = ctx.items();
  assert.equal(ctx.items(), first);
  cards = APP_CARDS.slice(0, 2);
  assert.deepEqual(ctx.items().map((item) => item.id), ["shield", "dispatch"]);
});

test("apps shown() honors Lab filters and sort, and data is the page's copy", () => {
  const ctx = sampleIndexAppsCtx({ hide: ["counter", "find"], order: ["workbench"] });
  assert.deepEqual(ctx.shown().map((item) => item.id), ["workbench", "shield", "dispatch", "autopilot", "claims", "reviews", "play"]);
  assert.equal(ctx.items().length, 9);
  assert.equal(ctx.data.heading, APPS_PAGE.heading);
  assert.equal(ctx.data.lede, APPS_PAGE.lede);
  assert.deepEqual(ctx.data.features.map((card) => card.title), ["Typed by construction", "Many questions, one call", "Calibrated confidence", "Fast and cheap"]);
  assert.equal(ctx.data.principles.length, 3);
  const bare = sampleIndexAppsCtx({ page: null });
  assert.deepEqual([bare.data.heading, bare.data.lede, bare.data.features, bare.data.principles], ["", "", [], []]);
  assert.deepEqual(sampleIndexAppsCtx({ page: { heading: "  Two\n words ", features: [{ title: " A ", text: null }, 3] } }).data,
    { heading: "Two words", lede: "", features: [{ title: "A", text: "" }], principles: [] });
});

test("apps actions: open and focus guard unknown and hidden cards", () => {
  const ctx = sampleIndexAppsCtx({ hide: ["play"] });
  assert.deepEqual(Object.keys(ctx.actions).sort(), ["focus", "open"]);
  assert.throws(() => ctx.actions.open("nowhere"), /no app card "nowhere"/);
  assert.throws(() => ctx.actions.focus("nowhere"), /no app card/);
  assert.throws(() => ctx.actions.focus("play"), /Play is hidden by the current filters/);
  ctx.actions.open("play");  // opening does not need the card to be shown
  ctx.actions.focus("find");
  assert.deepEqual(ctx.log.map(([name, item]) => [name, item.id]), [["open", "play"], ["focus", "find"]]);
  assert.throws(() => indexAppsCtx({ cards: APP_CARDS }).actions.open("shield"), /cannot do that here/);
});

// ---------- the page hooks (static/js/index.js) ----------

function pageWithPacks() {
  const LAB = createLab([playPack, appsPack]);
  const play = { result: PLAYGROUND_RESULTS.refund, pending: false, error: null, calls: 3, history: PLAYGROUND_HISTORY.slice() };
  const playCtx = indexPlaygroundCtx({ result: () => play.result, history: () => play.history, matches: (item, ctx) => LAB.matches("index.playground", item, ctx),
    arrange: (list, ctx) => LAB.arrange("index.playground", list, ctx) });
  const appCards = APP_CARDS.map((raw) => ({ node: { card: raw.href }, raw }));
  const appsCtx = indexAppsCtx({ cards: () => APP_CARDS, matches: (item, ctx) => LAB.matches("index.apps", item, ctx), arrange: (list, ctx) => LAB.arrange("index.apps", list, ctx) });
  return { LAB, play, playCtx, appCards, appsCtx };
}

function renderAnswersFrom(page, dom, calls = []) {
  const answerCard = (qid, answer, question) => ({ card: qid, answer, question });
  const make = new Function("play", "playCtx", "LAB", "PLAY", "mount", "h", "answerCard", "renderPlayLab", `${body("renderAnswers")}\nreturn renderAnswers;`);
  return make(page.play, page.playCtx, page.LAB, "index.playground", dom.mount, h, answerCard, () => calls.push("renderPlayLab"));
}

function renderAppsFrom(page, dom, calls = []) {
  const make = new Function("appsCtx", "LAB", "APPS", "mount", "h", "appCards", "renderAppsLab", `${body("renderApps")}\nreturn renderApps;`);
  return make(page.appsCtx, page.LAB, "index.apps", dom.mount, h, page.appCards, () => calls.push("renderAppsLab"));
}

test("renderAnswers: with no Lab setting active it shows every answer card in order, exactly as before", () => {
  const page = pageWithPacks();
  const dom = screen();
  renderAnswersFrom(page, dom)();
  const shown = dom.held.get("#play-answers");
  const res = PLAYGROUND_RESULTS.refund;
  // What the page did before Lab: one answerCard per answer, in the response's order, and nothing else.
  assert.deepEqual(shown, Object.entries(res.answers).map(([qid, answer]) => ({ card: qid, answer, question: res.trace.request.questions[qid] })));
});

test("renderAnswers: Lab filters hide cards, a Lab sort reorders them, and the note's reset restores everything", () => {
  const page = pageWithPacks();
  const dom = screen();
  const calls = [];
  const renderAnswers = renderAnswersFrom(page, dom, calls);
  const view = page.LAB.view("index.playground");
  view.filters = [{ key: "index-playground-insights/type", op: "is", value: "noul" }];
  renderAnswers();
  let shown = dom.held.get("#play-answers");
  assert.deepEqual(shown.filter((node) => node.card).map((node) => node.card), ["wants_money_back", "talks_to_ai"]);
  const note = shown.at(-1);
  assert.equal(note.attrs.role, "status");
  assert.match(textOf(note), /2 of 4 answers shown · 1 Lab setting active/);
  view.filters = [];
  view.sort = { key: "index-playground-insights/top_p", dir: "asc" };
  renderAnswers();
  shown = dom.held.get("#play-answers");
  assert.equal(page.LAB.active("index.playground"), 1);
  // Descending top probability: .97 and .97 (a tie keeps page order), then .66 and .62.
  view.sort = { key: "index-playground-insights/top_p", dir: "desc" };
  renderAnswers();
  shown = dom.held.get("#play-answers");
  assert.deepEqual(shown.filter((node) => node.card).map((node) => node.card), ["wants_money_back", "talks_to_ai", "urgency", "intent"]);
  view.filters = [{ key: "index-playground-insights/type", op: "is", value: "box" }];
  renderAnswers();
  shown = dom.held.get("#play-answers");
  assert.equal(textOf(shown[0]), "No answer matches the Lab filters.");
  fire(find(shown.at(-1), (node) => node.tag === "button"), "click");
  assert.equal(page.LAB.active("index.playground"), 0);
  assert.deepEqual(dom.held.get("#play-answers").map((node) => node.card), ["intent", "urgency", "wants_money_back", "talks_to_ai"]);
  assert.deepEqual(calls, ["renderPlayLab"]);
});

test("renderAnswers does nothing before the first answer", () => {
  const page = pageWithPacks();
  page.play.result = null;
  const dom = screen();
  renderAnswersFrom(page, dom)();
  assert.equal(dom.held.size, 0);
});

test("renderApps: page order with no Lab setting, Lab filters and sort otherwise, with a count note and reset", () => {
  const page = pageWithPacks();
  const dom = screen();
  const calls = [];
  const renderApps = renderAppsFrom(page, dom, calls);
  renderApps();
  assert.deepEqual(dom.held.get(".grid.apps"), page.appCards.map((card) => card.node), "the page's own card nodes, in page order");
  assert.deepEqual(dom.held.get("#apps-note"), []);
  const view = page.LAB.view("index.apps");
  view.filters = [{ key: "index-apps-explorer/tag", op: "is", value: "untagged" }];
  view.sort = { key: "index-apps-explorer/app_number", dir: "desc" };
  renderApps();
  // Untagged cards by app number, highest first; Counter (8) before Play (7).
  assert.deepEqual(dom.held.get(".grid.apps").map((node) => node.card), ["/counter", "/play", "/find", "/reviews", "/dispatch", "/shield"]);
  const note = dom.held.get("#apps-note")[0];
  assert.match(textOf(note), /6 of 9 apps shown · 2 Lab settings active/);
  view.filters = [{ key: "index-apps-explorer/bullets", op: "min", value: "9" }];
  renderApps();
  assert.equal(textOf(dom.held.get(".grid.apps")[0]), "No app matches the Lab filters.");
  fire(find(dom.held.get("#apps-note")[0], (node) => node.tag === "button"), "click");
  assert.equal(page.LAB.active("index.apps"), 0);
  assert.deepEqual(dom.held.get(".grid.apps"), page.appCards.map((card) => card.node));
  assert.deepEqual(calls, ["renderAppsLab"]);
});

test("ask(): the Lab section re-renders after pending is cleared, on success and on failure", async () => {
  const run = async ({ fail = false, configured = true } = {}) => {
    const play = { result: PLAYGROUND_RESULTS.praise, pending: false, error: null };
    const seen = [];
    const input = { value: "  Do you sell gift cards?  " };
    const deps = {
      $: () => input, play, h, mount: () => {}, currentStatus: () => ({ configured }), handleError: (error) => seen.push(["handleError", error.message]),
      api: async (path, payload) => { seen.push(["api", path, payload.text, play.pending]); if (fail) throw new Error("No key"); return PLAYGROUND_RESULTS.refund; },
      render: (res) => { play.result = res; seen.push(["render"]); },
      renderPlayLab: () => seen.push(["renderPlayLab", play.pending, play.error]),
    };
    const ask = new Function("deps", `let seq = 0; const { $, play, h, mount, currentStatus, handleError, api, render, renderPlayLab } = deps;\n${body("ask")}\nreturn ask;`)(deps);
    await ask();
    return { play, seen };
  };
  const ok = await run();
  assert.deepEqual(ok.seen, [["api", "/api/hello", "Do you sell gift cards?", true], ["render"], ["renderPlayLab", false, null]]);
  const offline = await run({ fail: true, configured: false });
  assert.equal(offline.play.result, null, "with no key the answers leave the page and the surface");
  assert.deepEqual(offline.seen.slice(1), [["renderPlayLab", false, "No key"]]);
  const failed = await run({ fail: true, configured: true });
  assert.equal(failed.play.result, PLAYGROUND_RESULTS.praise, "a failure with a key keeps the shown answers");
  assert.deepEqual(failed.seen.slice(1), [["handleError", "No key"], ["renderPlayLab", false, "No key"]]);
});

test("draftText puts text in the box and focuses it without asking", () => {
  const input = { value: "", focused: 0, focus() { this.focused++; } };
  const draftText = new Function("$", `${body("draftText")}\nreturn draftText;`)(() => input);
  draftText("Can I swap my subscription to decaf?");
  assert.deepEqual([input.value, input.focused], ["Can I swap my subscription to decaf?", 1]);
  assert.doesNotMatch(body("draftText"), /ask\(|dispatchEvent|api\(/);
});

test("the page installs Lab once after the top bar, hooks both surfaces, and has their containers", () => {
  const boot = body("boot");
  assert.ok(boot.indexOf("await initChrome(") < boot.indexOf("installLab(LAB)"), "installLab runs after initChrome");
  assert.match(boot, /await initChrome\("\/"\);\n\s*installLab\(LAB\);/);
  assert.equal(PAGE.match(/installLab\(/g).length, 1);
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/index\.js";/);
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  const lab = body("bootLab");
  for (const hook of ['LAB.matches(PLAY, item, ctx)', 'LAB.arrange(PLAY, list, ctx)', 'LAB.matches(APPS, item, ctx)', 'LAB.arrange(APPS, list, ctx)']) assert.ok(lab.includes(hook), hook);
  assert.doesNotMatch(lab, /\bask\b|setText/, "no Lab action can ask the model");
  assert.match(body("renderPlayLab"), /LAB\.section\(labEnv, PLAY, playCtx\)/);
  assert.match(body("renderAppsLab"), /LAB\.section\(labEnv, APPS, appsCtx\)/);
  assert.match(HTML, /<div id="play-stats"><\/div>\s*<div id="play-lab" class="hidden"><\/div>/);
  assert.match(HTML, /<div id="apps-lab" class="hidden"[^>]*><\/div>\s*<div id="apps-note"><\/div>\s*<div class="grid apps">/);
});

test("both sections render with the starter packs and every block open", () => {
  const page = pageWithPacks();
  for (const [id, ctx] of [["index.playground", page.playCtx], ["index.apps", page.appsCtx]]) {
    const view = page.LAB.view(id);
    for (const name of ["section", "refine", "checks", "metrics", "exports", "commands"]) view.open[name] = true;
    const tree = page.LAB.section(fakeEnv(), id, ctx);
    assert.ok(tree, id);
    assert.ok(!find(tree, (node) => node.attrs?.["data-lab-block"] === "transforms"), "no edits on a read-only surface");
    assert.ok(!find(tree, (node) => node.attrs?.["data-lab-block"] === "imports"), "no imports on a read-only surface");
    assert.match(textOf(tree), /Lab tools · \d+/);
  }
  assert.deepEqual(page.LAB.mountedIds().sort(), ["index.apps", "index.playground"]);
});
