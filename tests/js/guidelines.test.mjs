// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGuidelines, draftPayload, editorDraft, exampleLabelText, guidelineChangeText, guidelineView, labelOptions,
  rowStrings, shownExamples, validExampleLabel,
} from "../../static/js/guidelines.js";
import { workbenchSource } from "./workbench-source.mjs";

const h = (tag, attrs, ...children) => ({ tag, attrs,
  children: children.flat(Infinity).filter((x) => x != null && x !== false) });
const nodes = (node, tag) => typeof node !== "object" || node === null ? []
  : [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => nodes(child, tag))];
const textOf = (node) => typeof node !== "object" || node === null ? String(node ?? "") : node.children.map(textOf).join("");

const Q = {
  dept: { type: "choice", instructions: "Which team?", criteria: { billing: "money", tech: "bugs", other: null } },
  refund: { type: "noul", instructions: "Money back?" },
  tone: { type: "score", instructions: "How upset?", criteria: ["calm", "annoyed", "angry"] },
  where: { type: "box", instructions: "Where is the cup?" },
};
const GUIDE = {
  note: "Billing is anything about charges.",
  examples: [
    { input: "I was charged twice", label: "billing", why: "A charge" },
    { input: "The app crashes", label: "tech" },
    { input: "Old option", label: "shipping" },
  ],
};

test("label options and example labels follow the question type", () => {
  assert.deepEqual(labelOptions(Q.dept), ["billing", "tech", "other"]);
  assert.deepEqual(labelOptions(Q.refund), ["yes", "no"]);
  assert.deepEqual(labelOptions(Q.tone), ["0", "1", "2"]);
  assert.deepEqual(labelOptions(Q.where), []);
  assert.equal(exampleLabelText(true, Q.refund), "yes");
  assert.equal(exampleLabelText(false, Q.refund), "no");
  assert.equal(exampleLabelText(2, Q.tone), "2");
  assert.equal(validExampleLabel(Q.refund, true), true);
  assert.equal(validExampleLabel(Q.refund, "yes"), false, "a saved Noul label is a boolean");
  assert.equal(validExampleLabel(Q.tone, 3), false);
  assert.equal(validExampleLabel(Q.dept, "shipping"), false);
});

test("a guideline renders collapsed, with its note and only the examples that still fit", () => {
  const view = guidelineView(h, "dept", GUIDE, Q.dept);
  assert.equal(view.tag, "details");
  assert.equal(view.attrs.open, undefined, "collapsed by default");
  assert.equal(textOf(nodes(view, "summary")[0]), "How to label dept");
  const text = textOf(view);
  assert.match(text, /Billing is anything about charges/);
  assert.match(text, /I was charged twice/);
  assert.match(text, /never sent to the model/);
  assert.equal(nodes(view, "li").length, 2, "the example whose label is no longer an option is skipped");
  assert.doesNotMatch(text, /Old option/);
});

test("nothing to show renders nothing", () => {
  assert.equal(guidelineView(h, "dept", null, Q.dept), null);
  assert.equal(guidelineView(h, "dept", { note: "  ", examples: [] }, Q.dept), null);
  assert.equal(guidelineView(h, "dept", { examples: [{ input: "x", label: "gone" }] }, Q.dept), null);
});

test("on a blind row, an example matching the row is hidden so its label cannot leak", () => {
  const row = { text: "  I was CHARGED   twice ", channel: "email", _image: "x.png" };
  const { examples, hidden } = shownExamples(GUIDE, Q.dept, { row, blind: true });
  assert.deepEqual(examples.map((e) => e.input), ["The app crashes"]);
  assert.equal(hidden, 1);
  const view = guidelineView(h, "dept", GUIDE, Q.dept, { row, blind: true });
  const text = textOf(view);
  assert.doesNotMatch(text, /charged twice/i);
  assert.doesNotMatch(text, /billing/);
  assert.match(text, /1 example matches this row and is hidden while you label blind/);
  assert.equal(shownExamples(GUIDE, Q.dept, { row, blind: false }).examples.length, 2, "not blind: all fitting examples");
  assert.equal(shownExamples(GUIDE, Q.dept, { row: "I was charged twice", blind: true }).hidden, 1, "a text row matches too");
});

test("a blind row whose only example matches still shows the note", () => {
  const view = guidelineView(h, "refund", { note: "Yes only for refunds", examples: [{ input: "refund me", label: true }] },
    Q.refund, { row: { text: "Refund me" }, blind: true });
  assert.match(textOf(view), /Yes only for refunds/);
  assert.equal(nodes(view, "li").length, 0);
});

test("row strings ignore labels, test markers, and picture names", () => {
  const strings = rowStrings({ text: "Hi", _expect: { dept: "billing" }, _test: true, _image: "a.png" });
  assert.ok(strings.has("hi"));
  assert.ok(![...strings].some((s) => s.includes("billing") || s.includes("a.png")));
  assert.equal(rowStrings(null).size, 0);
});

test("the editor draft round-trips to the payload the server validates", () => {
  const saved = { dept: { note: "N", examples: [{ input: "x", label: "tech" }] }, refund: { examples: [{ input: "y", label: false, why: "w" }] } };
  const draft = editorDraft(saved, Q);
  assert.deepEqual(Object.keys(draft), ["dept", "refund", "tone", "where"]);
  assert.equal(draft.refund.examples[0].label, "no");
  draft.tone.examples.push({ input: "z", label: "2", why: "" });
  draft.where.note = "Box the whole cup";
  draft.dept.examples.push({ input: "", label: "", why: "" });  // an empty row is left out
  const { guidelines, problems } = draftPayload(draft, Q);
  assert.deepEqual(problems, []);
  assert.deepEqual(guidelines, {
    dept: { note: "N", examples: [{ input: "x", label: "tech" }] },
    refund: { examples: [{ input: "y", label: false, why: "w" }] },
    tone: { examples: [{ input: "z", label: 2 }] },
    where: { note: "Box the whole cup" },
  });
});

test("the payload reports incomplete examples before a request", () => {
  const draft = editorDraft({}, Q);
  draft.dept.examples.push({ input: "x", label: "", why: "" }, { input: "", label: "tech", why: "" });
  draft.where.examples.push({ input: "x", label: "0", why: "" });
  const { problems } = draftPayload(draft, Q);
  assert.deepEqual(problems, ["dept, example 1: choose its label", "dept, example 2: write the example input",
    "where: Box questions take a note, not label examples"]);
});

test("a question id such as __proto__ stays an ordinary guideline", () => {
  const questions = JSON.parse('{"__proto__": {"type": "noul", "instructions": "?"}}');
  const draft = editorDraft(JSON.parse('{"__proto__": {"note": "N"}}'), questions);
  assert.equal(draft.__proto__.note, "N");
  const { guidelines } = draftPayload(draft, questions);
  assert.deepEqual(JSON.parse(JSON.stringify(guidelines)), JSON.parse('{"__proto__": {"note": "N"}}'));
});

test("the replacement message names question ids and counts only", () => {
  assert.equal(guidelineChangeText({ before: 3, after: 2, added: [], removed: ["refund"], changed: ["dept"], dropped: [] }),
    "Labeling guidelines: 3 → 2 questions; changed: dept; removed: refund.\n");
  assert.equal(guidelineChangeText({ before: 1, after: 1, added: [], removed: [], changed: [], dropped: [] }),
    "Labeling guidelines: 1 → 1 questions, unchanged.\n");
  assert.match(guidelineChangeText({ before: 1, after: 0, added: [], removed: ["tone"], changed: [],
    dropped: ["Dropped the labeling guideline for tone: the question is no longer in the dataset"] }), /no longer in the dataset\.\n$/);
  assert.equal(guidelineChangeText(undefined), "");
});

test("hints fetch a dataset's guidelines once and render them beside a label control", async () => {
  const calls = [];
  let renders = 0;
  const api = async (path, body) => {
    calls.push([path, body]);
    return { id: body.id, saved_at: "t1", questions: Q, guidelines: { dept: GUIDE }, warnings: [] };
  };
  const G = createGuidelines({ h, api, rerender: () => { renders += 1; } });
  assert.equal(G.hint("tickets", "dept", Q.dept), null, "nothing until fetched");
  assert.equal(G.hint(null, "dept", Q.dept), null, "no dataset, no fetch");
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(renders, 1);
  assert.equal(G.hint("tickets", "dept", Q.dept).tag, "details");
  assert.equal(G.hint("tickets", "refund", Q.refund), null, "no guideline for this question");
  assert.deepEqual(calls, [["/api/workbench/datasets/guidelines", { id: "tickets" }]], "fetched once");
  // A dataset saved again since the fetch is fetched again.
  G.toggle({ id: "tickets", saved_at: "t2", guidelines: 1 });
  assert.equal(G.hint("tickets", "dept", Q.dept), null);
  assert.equal(calls.length, 2);
});

test("the toggle shows the saved count and the panel stays closed until opened", () => {
  const G = createGuidelines({ h, api: async () => ({}) });
  const button = G.toggle({ id: "a", saved_at: "t", guidelines: 2 });
  assert.equal(textOf(button), "Guidelines · 2");
  assert.equal(button.attrs["aria-expanded"], "false");
  assert.equal(G.panel({ id: "a" }), null);
});

// The real labeling views from static/js/workbench.js, rendered with a guideline store on W. No browser or model calls.
const source = workbenchSource;
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const hl = (tag, attrs, ...children) => ({ ...h(tag, attrs, ...children), addEventListener() {} });

async function storeWith(guidelines) {
  const calls = [];
  const store = createGuidelines({ h: hl, api: async (path, body) => { calls.push([path, body]); return { id: body.id, saved_at: "t", questions: Q, guidelines, warnings: [] }; } });
  store.hint("tickets", "dept", Q.dept);
  await new Promise((resolve) => setTimeout(resolve));
  return { store, calls };
}

test("canceling the shared discard guard keeps guideline drafts and makes no save request", async () => {
  const calls = [], guarded = [];
  const interactiveH = (tag, attrs, ...children) => ({ ...h(tag, attrs, ...children), listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; } });
  const store = createGuidelines({ h: interactiveH,
    api: async (path, data) => { calls.push(path); return { id: data.id, saved_at: "now", questions: Q, guidelines: {}, warnings: [] }; },
    beforeSave: (id) => { guarded.push(id); return false; } });
  const dataset = { id: "tickets", saved_at: "now" };
  store.toggle(dataset).attrs.onclick();
  await new Promise((resolve) => setImmediate(resolve));
  const panel = store.panel(dataset);
  const note = nodes(panel, "textarea")[0];
  note.value = "Keep this guideline draft";
  note.listeners.input();
  await nodes(panel, "button").find((node) => textOf(node) === "Save guidelines").attrs.onclick();
  assert.deepEqual(guarded, ["tickets"]);
  assert.deepEqual(calls, ["/api/workbench/datasets/guidelines"]);
  assert.ok(textOf(store.panel(dataset)).includes("Keep this guideline draft"));
  assert.match(workbenchSource, /beforeSave: \(id\) => confirmReviewDiscard\(id\)/);
});

test("the Review queue shows guidelines beside its labels and hides matching examples on blind audit rows", async () => {
  const { store, calls } = await storeWith({ dept: GUIDE });
  const W = { bulk: { pictures: {} }, guides: store };
  const item = (line, kind, text) => ({ kind, line, held: [], rules: [], row: { text }, labels: {}, open: [], answers: { dept: "billing" }, provenance: {} });
  const report = { items: [item(1, "review", "I was charged twice"), item(2, "audit", "I was charged twice")],
    gates: { dept: 0.9 }, room: 10, questions: { dept: Q.dept }, counts: { decisions: 2, review: 1, auto: 1, queued: 2, audit: 1 } };
  const functions = ["queueView", "queueReady", "queueVisible", "queueNextIncomplete", "queueSelect", "queueClasses", "shownAnswer", "labelText", "labelValue"].map(body).join("\n");
  const view = new Function("W", "h", "icon", "rowText", "queueCsv", "render", "nextQueueRow", "addQueued",
    `${functions}; return queueView;`)(W, hl, () => "", (r) => r.text, () => null, () => {}, () => {}, () => {});
  const tree = view({ id: "tickets" }, { report });
  const guides = nodes(tree, "details").filter((d) => d.attrs.class === "guideline");
  assert.equal(guides.length, 2, "one guideline per label control");
  assert.match(textOf(guides[0]), /I was charged twice/, "a review row is not blind");
  assert.doesNotMatch(textOf(guides[1]), /charged twice/, "the audit row hides the example that is its own input");
  assert.match(textOf(guides[1]), /hidden while you label blind/);
  assert.equal(calls.length, 1, "no request beyond the one guideline fetch");
});

test("Label agreement rows are blind: guidelines show, examples matching the row do not", async () => {
  const { store } = await storeWith({ dept: GUIDE });
  const W = { bulk: { pictures: {} }, guides: store };
  const a = { labels: {}, busy: false, sample: { eligible: 1, questions: { dept: Q.dept }, csv: "",
    items: [{ row_id: "aaa", number: 1, row: { text: "The app crashes" }, questions: ["dept"] }] } };
  const functions = ["agreeSampleView", "agreeQuestions", "queueClasses", "labelText", "labelValue"].map(body).join("\n");
  const view = new Function("W", "h", "icon", "rowText", "render", "secondItems", "compareAgreement", "stringify",
    `${functions}; return agreeSampleView;`)(W, hl, () => "", (r) => r.text, () => {}, () => [], () => {}, String);
  const guide = nodes(view({ id: "tickets" }, a), "details").find((d) => d.attrs.class === "guideline");
  assert.match(textOf(guide), /Billing is anything about charges/);
  assert.match(textOf(guide), /I was charged twice/);
  assert.doesNotMatch(textOf(guide), /The app crashes/, "the row's own input never appears as a labeled example");
});

test("labeling views render unchanged when no guideline store is attached", () => {
  const W = { bulk: { pictures: {} } };
  const report = { items: [{ kind: "review", line: 1, held: [], rules: [], row: { text: "x" }, labels: {}, open: [], answers: {}, provenance: {} }],
    gates: { dept: 0.9 }, room: 10, questions: { dept: Q.dept }, counts: { decisions: 1, review: 1, auto: 0, queued: 1, audit: 0 } };
  const functions = ["queueView", "queueReady", "queueVisible", "queueNextIncomplete", "queueSelect", "queueClasses", "shownAnswer", "labelText", "labelValue"].map(body).join("\n");
  const view = new Function("W", "h", "icon", "rowText", "queueCsv", "render", "nextQueueRow", "addQueued",
    `${functions}; return queueView;`)(W, hl, () => "", (r) => r.text, () => null, () => {}, () => {}, () => {});
  assert.equal(nodes(view({ id: "tickets" }, { report }), "details").filter((d) => d.attrs.class === "guideline").length, 0);
});
