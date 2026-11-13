// The Workbench pre-run labeling queue's Lab surface: the builder (static/js/lab/surfaces/workbench-labeling.js), the
// guideline store's peek(), and the hook in static/js/workbench-labeling.js (prelabelBody, nextPreparedLabel,
// labelingLab, labelingLabWrite), rebuilt from the page source the way tests/js/prelabel-ui.test.mjs does.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyTransform, definePack, previewTransform, undoTransform } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import { labelingQueueCtx } from "../../../static/js/lab/surfaces/workbench-labeling.js";
import { createGuidelines } from "../../../static/js/guidelines.js";
import { labelProgress, labelShortcut, nextLabel, visibleLabels } from "../../../static/js/prelabel.js";
import essentials from "../../../static/js/lab/packs/workbench/labeling-queue-essentials.js";
import { fakeEnv, find, findAll, textOf } from "./harness.mjs";
import { workbenchSource } from "../workbench-source.mjs";
import { LABELING_SURFACE as ID, sampleLabelingDrafts, sampleLabelingQueueCtx, sampleLabelingReport } from "./fixtures/workbench-labeling.mjs";

const rows = (list) => list.map((item) => item.row_number);
const byRow = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.row_number, item]));
const plain = (value) => JSON.parse(JSON.stringify(value));

// A small pack whose facts drive Lab's filters and sort in these tests.
const probe = definePack({ id: "labeling-probe", surface: ID, title: "Probe", features: [
  { id: "picture", kind: "fact", type: "flag", label: "picture", value: (item) => item.image !== null },
  { id: "blank", kind: "fact", type: "number", label: "blank", value: (item) => item.blank },
] });
const labWith = (filters = [], sort = null) => {
  const lab = createLab([probe]);
  Object.assign(lab.view(ID), { filters, sort });
  return lab;
};

// ---------- the builder ----------

test("items are frozen copies of the queue rows in rows-box order, with drafts and derived progress", () => {
  const ctx = sampleLabelingQueueCtx();
  assert.deepEqual(rows(ctx.items()), [1, 2, 4, 5, 6, 7, 9]);
  const R = byRow(ctx);
  // Copies hold the stored fields only; the read-only facts are readable on the item itself.
  assert.deepEqual(plain(R[4]), { index: 3, row: { text: "Charged twice for my subscription", channel: "chat", _image: "receipt-scan" },
    missing: ["topic", "tone"], draft: {} });
  const facts = ["row_number", "position", "kind", "identity", "image", "picture_loaded", "questions", "filled", "blank", "ready", "status", "current"];
  assert.deepEqual(plain(Object.fromEntries(facts.map((name) => [name, R[4][name]]))), {
    row_number: 4, position: 3, kind: "object", identity: '{"_image":"receipt-scan","channel":"chat","text":"Charged twice for my subscription"}',
    image: "receipt-scan", picture_loaded: true, questions: [{ id: "topic", type: "choice" }, { id: "tone", type: "score" }], filled: 0, blank: 2,
    ready: false, status: "incomplete", current: false });
  assert.ok(Object.isFrozen(R[4].questions));
  assert.deepEqual(plain(R[1]).draft, { urgent: true, topic: "shipping", tone: 0 });
  assert.equal(R[1].ready, true);
  assert.equal(R[1].status, "ready");
  assert.equal(R[2].kind, "text");
  assert.equal(R[2].image, null);
  assert.equal(R[2].current, true);
  assert.equal(R[5].identity, R[4].identity, "identical inputs share an identity");
  assert.equal(R[6].picture_loaded, false, "a named picture the page has not loaded");
  assert.deepEqual([R[9].filled, R[9].blank, R[9].ready], [1, 1, false]);
  for (const item of ctx.items()) assert.ok(Object.isFrozen(item) && Object.isFrozen(item.row) && Object.isFrozen(item.draft) && Object.isFrozen(item.missing));
  assert.equal(ctx.items(), ctx.items(), "the same array while nothing changed");
  assert.equal(ctx.itemName(R[4]), "Row 4");
  // A draft change gives a new list; the page's own objects are never handed out.
  ctx.state.drafts[3] = Object.assign(Object.create(null), { topic: "billing" });
  assert.notEqual(ctx.items()[2], R[4]);
  assert.deepEqual(plain(ctx.items()[2].draft), { topic: "billing" });
  assert.notEqual(ctx.items()[2].row, ctx.state.report.items[2].row);
});

test("a closed or stale queue lists nothing and its data says so", () => {
  for (const ctx of [sampleLabelingQueueCtx({ report: null }), sampleLabelingQueueCtx({ current: false })]) {
    assert.deepEqual(ctx.items(), []);
    assert.deepEqual(ctx.shown(), []);
    const data = ctx.data;
    assert.equal(data.prepared, false);
    assert.deepEqual([data.questions, data.slice, data.eligible, data.missing, data.progress, data.next_index, data.guidelines],
      [[], null, null, null, null, null, null]);
    assert.deepEqual(plain(data.drafts), { labels: 0, rows: 0, outside_slice: 0 }, "stale drafts are not counted");
    assert.throws(() => ctx.actions.setDraft(1, "urgent", true), /Label missing rows first/);
  }
});

test("data: questions with options, slice, counts across slices, current row, import preview and guidelines", () => {
  const data = sampleLabelingQueueCtx({ slice: "chat", csvPreview: { items: [{ index: 3, labels: { topic: "beans" } }], counts: { rows: 1, matched: 3, labels: 1 } } }).data;
  assert.ok(Object.isFrozen(data) && Object.isFrozen(data.questions[0].options));
  assert.deepEqual(plain(data.questions.map((question) => [question.id, question.type, question.options.map((option) => option.value)])),
    [["urgent", "noul", [true, false]], ["topic", "choice", ["billing", "shipping", "wholesale", "beans"]], ["tone", "score", [0, 1, 2]]]);
  assert.deepEqual(plain(data.questions[0].options[0]), { value: true, text: "yes", description: "Cannot use what they paid for" });
  assert.equal(data.questions[1].instructions, '{"task":"Which team handles this?"}');
  assert.deepEqual(plain(data.slice), { field: "channel", value: "chat", fields: ["channel", "order", "text"],
    values: [{ value: "chat", shown: "chat", rows: 3 }, { value: "email", shown: "email", rows: 2 }, { value: "phone", shown: "phone", rows: 1 }] });
  assert.deepEqual([data.eligible, data.missing], [7, 14]);
  // Chat rows 4, 5 and 9: row 5 and row 9 have one draft each, neither is ready.
  assert.deepEqual(plain(data.progress), { ready: 0, incomplete: 3 });
  // Seven drafts on five rows; five of them (rows 1, 2 and 6) lie outside the chat slice.
  assert.deepEqual(plain(data.drafts), { labels: 7, rows: 5, outside_slice: 5 });
  assert.equal(data.next_index, null, "row 2 is not in this slice");
  assert.deepEqual(plain(data.csv_preview), { rows: 1, matched: 3, labels: 1 }, "counts only, never the imported values");
  assert.deepEqual(plain(data.dataset), { id: "harbor-support", name: "Harbor support inbox" });
  assert.equal(data.status, "all");
  assert.equal(data.busy, false);
  // Trimmed note, labels as option text, and the example whose label is no option is dropped; tone has none.
  assert.deepEqual(plain(data.guidelines), {
    urgent: { note: "Urgent means the customer cannot use what they paid for today.",
      examples: [{ input: "My grinder arrived broken", label: "yes", why: "cannot brew" }, { input: "Do you ship to the islands?", label: "no", why: "" }] },
    topic: { note: "", examples: [{ input: "Refund my double charge", label: "billing", why: "" }] } });
  assert.equal(sampleLabelingQueueCtx({ dataset: { id: null, name: "" } }).data.guidelines, null, "an unsaved dataset has no guidelines");
  assert.equal(sampleLabelingQueueCtx({ guidelines: null }).data.guidelines, null, "not loaded yet");
  assert.deepEqual(plain(sampleLabelingQueueCtx({ guidelines: { guidelines: {} } }).data.guidelines), {}, "loaded, none saved");
  assert.equal(sampleLabelingQueueCtx().data.next_index, 1);
});

test("shown() honors the page's status filter, then Lab's filters, then Lab's sort, with the items' own objects", () => {
  assert.deepEqual(rows(sampleLabelingQueueCtx().shown()), [1, 2, 4, 5, 6, 7, 9]);
  assert.deepEqual(rows(sampleLabelingQueueCtx({ status: "incomplete" }).shown()), [2, 4, 5, 7, 9]);
  assert.deepEqual(rows(sampleLabelingQueueCtx({ status: "ready" }).shown()), [1, 6]);
  // No Lab filter or sort: exactly the page's rows.
  assert.deepEqual(rows(sampleLabelingQueueCtx({ lab: labWith() }).shown()), [1, 2, 4, 5, 6, 7, 9]);
  const filtered = sampleLabelingQueueCtx({ lab: labWith([{ key: "labeling-probe/picture", op: "with" }]) });
  assert.deepEqual(rows(filtered.shown()), [4, 5, 6]);
  assert.ok(filtered.shown().every((item) => filtered.items().includes(item)));
  // Status and Lab filters together.
  assert.deepEqual(rows(sampleLabelingQueueCtx({ status: "incomplete", lab: labWith([{ key: "labeling-probe/picture", op: "with" }]) }).shown()), [4, 5]);
  // Lab's sort applies last; ties keep rows-box order.
  const sorted = sampleLabelingQueueCtx({ lab: labWith([], { key: "labeling-probe/blank", dir: "desc" }) });
  assert.deepEqual(rows(sorted.shown()), [2, 4, 5, 7, 9, 1, 6]);
  // The page hook draws the raw rows in the same order.
  assert.deepEqual(sorted.page.visible().map((raw) => raw.index + 1), [2, 4, 5, 7, 9, 1, 6]);
  assert.equal(filtered.page.matches(filtered.state.report.items[0]), false);
  assert.equal(filtered.page.matches(filtered.state.report.items[2]), true);
  assert.equal(sampleLabelingQueueCtx().page.matches(sampleLabelingQueueCtx().state.report.items[0]), true, "no Lab: every row matches");
});

test("setDraft takes the label select's path and refuses anything the select could not do", () => {
  const ctx = sampleLabelingQueueCtx({ csvPreview: { items: [], counts: { rows: 0, matched: 0, labels: 0 } } });
  assert.deepEqual(ctx.actions.setDraft(3, "topic", "beans"), { changed: 1 });
  assert.deepEqual(ctx.log, [["writeDrafts", [[3, { topic: "beans", tone: null }]], "Row 4"]]);
  assert.equal(ctx.state.csvPreview, null, "a pending import preview is dropped, as the select drops it");
  assert.deepEqual(ctx.actions.setDraft(1, "urgent", "yes"), { changed: 1 }, "option text is accepted");
  assert.equal(ctx.state.drafts[1].urgent, true);
  assert.deepEqual(ctx.actions.setDraft(1, "tone", "2"), { changed: 1 });
  assert.equal(ctx.state.drafts[1].tone, 2);
  assert.deepEqual(ctx.actions.setDraft(1, "tone", 2), { changed: 0 }, "the same label changes nothing");
  assert.deepEqual(ctx.actions.setDraft(1, "topic", null), { changed: 1 });
  assert.equal(ctx.state.drafts[1].topic, undefined, "null clears");
  const before = JSON.stringify(ctx.state.drafts);
  assert.throws(() => ctx.actions.setDraft(3, "urgent", true), /does not miss a label for urgent/, "an existing label is never replaced");
  assert.throws(() => ctx.actions.setDraft(2, "urgent", true), /Row 3 is not in this labeling queue/, "a held-out row");
  assert.throws(() => ctx.actions.setDraft(3, "topic", "mugs"), /“mugs” is not a label option for topic \(options: billing, shipping, wholesale, beans\)/);
  assert.throws(() => ctx.actions.setDraft(3, "tone", 3), /3 is not a label option for tone/);
  assert.throws(() => ctx.actions.setDraft(0, "urgent", "true"), /not a label option for urgent/, "Noul takes yes/no or true/false values");
  assert.throws(() => sampleLabelingQueueCtx({ busy: true }).actions.setDraft(3, "topic", "beans"), /Wait for the labeling queue/);
  assert.equal(JSON.stringify(ctx.state.drafts), before);
});

test("replaceItems writes only changed drafts and rejects any list the page's rules forbid, changing nothing", () => {
  const ctx = sampleLabelingQueueCtx();
  ctx.state.drafts[1].note_for_other_question = "kept";  // a key the queue does not list stays
  const list = plain(ctx.items());
  list[2].draft = { topic: "billing", tone: "1" };
  list[0].draft = { ...list[0].draft };  // unchanged
  list[3].filled = 99;  // derived fields are ignored
  assert.deepEqual(ctx.actions.replaceItems(list, { label: "Set tone" }), { changed: 1 });
  assert.deepEqual(ctx.log, [["writeDrafts", [[3, { topic: "billing", tone: 1 }]], "Set tone"]]);
  assert.equal(ctx.state.drafts[1].note_for_other_question, "kept");
  const snapshot = JSON.stringify(ctx.state.drafts);
  const fresh = () => plain(ctx.items());
  const rejects = [
    [(l) => l.slice(1), /cannot add or remove queue rows: the queue lists 7 rows, the edit gave 6/],
    [(l) => [l[1], l[0], ...l.slice(2)], /Position 1: edits cannot reorder/],
    [(l) => { l[1].row = "Different text"; return l; }, /Row 2: edits cannot change the input/],
    [(l) => { l[2].missing = ["topic"]; return l; }, /Row 4: the questions missing a label/],
    [(l) => { l[2].draft = { urgent: true }; return l; }, /Row 4: urgent is not missing a label on this row/],
    [(l) => { l[6].draft = { topic: "espresso" }; return l; }, /Row 9: “espresso” is not a label option for topic/],
    [(l) => { l[6].draft = "billing"; return l; }, /Row 9: drafts must be an object/],
    [() => "not a list", /whole labeling queue as a list/],
  ];
  for (const [edit, message] of rejects) assert.throws(() => ctx.actions.replaceItems(edit(fresh()), { label: "Bad" }), message);
  assert.equal(JSON.stringify(ctx.state.drafts), snapshot);
  assert.equal(ctx.log.length, 1);
  assert.throws(() => sampleLabelingQueueCtx({ current: false }).actions.replaceItems([]), /Label missing rows first/);
});

test("a Lab edit previews, applies through replaceItems and undoes exactly; drafts outside the slice survive", () => {
  const ctx = sampleLabelingQueueCtx({ slice: "chat" });
  const clear = essentials.features.find((feature) => feature.id === "clear_drafts");
  const items = ctx.items();
  const preview = previewTransform("labeling-queue-essentials/clear_drafts", clear, items, new Set([0, 1, 2]), {}, ctx);
  assert.deepEqual(preview.changed, [2, 3]);
  const applied = applyTransform(preview, items);
  ctx.actions.replaceItems(applied.items, { label: clear.label });
  assert.deepEqual(plain(ctx.items().map((item) => item.draft)), [{}, {}, {}]);
  assert.deepEqual(plain(ctx.state.drafts[0]), { urgent: true, topic: "shipping", tone: 0 }, "row 1 is in another slice");
  ctx.actions.replaceItems(undoTransform(applied.undo, ctx.items()), { label: "Undo" });
  assert.deepEqual(plain(ctx.items().map((item) => item.draft)), [{}, { topic: "billing" }, { urgent: false }]);
  // An edit that appends a key out of question order still undoes: items() keep the order the edit gave.
  const all = sampleLabelingQueueCtx();
  const set = essentials.features.find((feature) => feature.id === "set_label");
  const before = all.items();
  const shownIndexes = new Set(before.map((_, index) => index));
  const setPreview = previewTransform("labeling-queue-essentials/set_label", set, before, shownIndexes, { question: "urgent", label: "yes" }, all);
  assert.deepEqual(setPreview.changed, [2, 6], "queue positions of rows 2 and 7, which miss urgent with no draft; row 9 keeps its draft");
  const done = applyTransform(setPreview, before);
  all.actions.replaceItems(done.items, { label: set.label });
  assert.deepEqual(Object.keys(all.items()[1].draft), ["topic", "urgent"]);
  assert.equal(all.items()[1].ready, false);
  all.actions.replaceItems(undoTransform(done.undo, all.items()), { label: "Undo" });
  assert.deepEqual(plain(all.items()), plain(before));
});

test("goTo, next, setStatus, prepare and resetFilters keep their guards", () => {
  const ctx = sampleLabelingQueueCtx({ status: "incomplete" });
  ctx.actions.goTo(3);
  assert.deepEqual(ctx.log.at(-1), ["goTo", 3]);
  assert.throws(() => ctx.actions.goTo(0), /Row 1 is hidden by the current filters/);
  assert.throws(() => ctx.actions.goTo(2), /Row 3 is not in this labeling queue/);
  ctx.actions.next(1);
  assert.deepEqual([ctx.log.at(-1), ctx.state.nextIndex], [["next", 1], 4]);
  assert.throws(() => ctx.actions.next(2), /next \(1\) or previous \(-1\)/);
  // Under a Lab filter that leaves only ready rows there is nowhere to go.
  const readyOnly = sampleLabelingQueueCtx({ lab: labWith([{ key: "labeling-probe/blank", op: "max", value: "0" }]) });
  assert.throws(() => readyOnly.actions.next(1), /No incomplete row is left/);
  // next() skips rows a Lab filter hides: from row 4, the next incomplete picture row is row 5.
  const pictures = sampleLabelingQueueCtx({ nextIndex: 3, lab: labWith([{ key: "labeling-probe/picture", op: "with" }]) });
  pictures.actions.next(1);
  assert.equal(pictures.state.nextIndex, 4);
  pictures.actions.next(1);
  assert.equal(pictures.state.nextIndex, 3, "wraps within the rows Lab leaves");
  ctx.actions.setStatus("ready");
  assert.equal(ctx.state.status, "ready");
  assert.throws(() => ctx.actions.setStatus("done"), /Unknown labeling status/);
  assert.throws(() => sampleLabelingQueueCtx({ busy: true }).actions.setStatus("all"), /Wait/);
  ctx.actions.prepare("channel", "email");
  ctx.actions.prepare();
  ctx.actions.prepare(null, "ignored");
  assert.deepEqual(ctx.log.filter((entry) => entry[0] === "prepare"), [["prepare", "channel", "email"], ["prepare", null, null], ["prepare", null, null]]);
  assert.throws(() => ctx.actions.prepare("_expect"), /not a field this queue can be sliced by/);
  assert.throws(() => ctx.actions.prepare("channel", 3), /slice value is text/);
  assert.throws(() => sampleLabelingQueueCtx({ busy: true }).actions.prepare(), /Wait/);
  sampleLabelingQueueCtx({ report: null }).actions.prepare();  // opening the queue needs no queue
  const lab = labWith([{ key: "labeling-probe/picture", op: "with" }]);
  const reset = sampleLabelingQueueCtx({ status: "ready", lab });
  reset.actions.resetFilters();
  assert.equal(reset.state.status, "all");
  assert.equal(lab.active(ID), 0);
  assert.throws(() => labelingQueueCtx({ state: () => ({}), current: () => true }).actions.resetFilters(), /cannot do that here/);
});

test("guideline peek() never starts a request and returns loaded guidelines only", async () => {
  const calls = [];
  const h = (tag, attrs, ...children) => ({ tag, attrs, children });
  const store = createGuidelines({ h, api: async (path, body) => { calls.push(path); return { id: body.id, saved_at: "t", questions: {}, guidelines: { urgent: { note: "n" } } }; } });
  assert.equal(store.peek("harbor-support"), null);
  assert.equal(store.peek(null), null);
  assert.deepEqual(calls, []);
  store.hint("harbor-support", "urgent", { type: "noul" });
  assert.equal(store.peek("harbor-support"), null, "still loading");
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(store.peek("harbor-support").guidelines, { urgent: { note: "n" } });
  assert.deepEqual(calls, ["/api/workbench/datasets/guidelines"]);
});

// ---------- the hook in static/js/workbench-labeling.js ----------

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const hDom = (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((x) => x != null && x !== false) });

function page({ lab = null, status = "all", drafts = sampleLabelingDrafts(), nextIndex = null } = {}) {
  const W = { bulk: { rowsText: "rows", labelsDirty: false, pictures: {}, dataset: { id: null, name: "" },
    prelabel: { busy: false, report: sampleLabelingReport(), context: "now", drafts, status, nextIndex, csvPreview: { counts: {} } } } };
  if (lab) { W.lab = lab; W.labEnv = fakeEnv(); }
  const calls = [];
  const names = ["W", "prelabelContext", "labelProgress", "visibleLabels", "h", "agreeQuestions", "preparedLabelCsv", "labelShortcut", "applyPreparedLabels",
    "prepareLabels", "render", "stringify", "photoView", "$", "nextLabel", "toast", "labelingLabGoTo", "labelingLabRefresh"];
  const functions = ["prelabelBody", "nextPreparedLabel", "labelingLab", "labelingLabWrite", "labelText", "labelValue"].map(body).join("\n");
  const fns = new Function(...names, `${functions}; return { prelabelBody, nextPreparedLabel, labelingLab, labelingLabWrite };`)(
    W, () => "now", labelProgress, visibleLabels, hDom, () => null, () => null, labelShortcut, () => assert.fail("must not apply"),
    () => assert.fail("must not prepare"), () => calls.push("render"), JSON.stringify, () => null, () => null, nextLabel,
    (message) => calls.push(["toast", message]), (index) => calls.push(["goTo", index]), () => calls.push("refresh"));
  return { W, calls, ...fns };
}
const drawn = (tree) => findAll(tree, (node) => typeof node.attrs?.id === "string" && /^prelabel-row-\d+$/.test(node.attrs.id)).map((node) => Number(node.attrs.id.slice(13)) + 1);

test("without Lab, or with Lab and nothing active, the queue draws exactly the rows the status filter leaves", () => {
  const without = page({ status: "incomplete" });
  const tree = without.prelabelBody();
  assert.deepEqual(drawn(tree), [2, 4, 5, 7, 9]);
  assert.equal(without.W.labelingLab, undefined, "no ctx without Lab");
  assert.equal(find(tree, (node) => node.attrs?.["data-lab-surface"]), null);
  const lab = createLab([probe], { labelingQueueCtx });
  const withLab = page({ lab, status: "incomplete" });
  const labTree = withLab.prelabelBody();
  assert.deepEqual(drawn(labTree), [2, 4, 5, 7, 9]);
  assert.match(textOf(find(labTree, (node) => node.attrs?.id === "prelabel-status")), /2 rows ready · 5 incomplete in this slice · showing 5/);
  assert.ok(find(labTree, (node) => node.attrs?.["data-lab-surface"] === ID), "the Lab section renders beside the queue's controls");
  assert.doesNotMatch(textOf(labTree), /Lab setting/);
  assert.equal(withLab.W.labelingLab, withLab.labelingLab(), "one ctx per page session, kept on W");
});

test("Lab filters and sort reach the drawn rows, the showing count and Next; Clear resets them", () => {
  const lab = createLab([probe], { labelingQueueCtx });
  Object.assign(lab.view(ID), { filters: [{ key: "labeling-probe/picture", op: "with" }], sort: { key: "labeling-probe/blank", dir: "asc" } });
  const x = page({ lab, nextIndex: 3 });
  const tree = x.prelabelBody();
  // Picture rows 4 (2 blank), 5 (1 blank), 6 (0 blank), sorted by blank labels ascending.
  assert.deepEqual(drawn(tree), [6, 5, 4]);
  assert.match(textOf(find(tree, (node) => node.attrs?.id === "prelabel-status")), /showing 3$/);
  assert.match(textOf(tree), /Showing 3 of 7 rows this status leaves · 2 Lab settings active/);
  // Next follows rows-box order over the rows Lab leaves: from row 4, row 5; then it wraps to row 4.
  x.nextPreparedLabel(1);
  assert.equal(x.W.bulk.prelabel.nextIndex, 4);
  x.nextPreparedLabel(1);
  assert.equal(x.W.bulk.prelabel.nextIndex, 3);
  // A filter that hides every row says so, apart from the status message.
  lab.view(ID).filters = [{ key: "labeling-probe/blank", op: "min", value: "5" }];
  assert.match(textOf(x.prelabelBody()), /No row matches the Lab filters\./);
  const clear = find(x.prelabelBody(), (node) => node.tag === "button" && textOf(node) === "Clear Lab filters and sort");
  clear.attrs.onclick();
  assert.equal(lab.active(ID), 0);
  // Next set the status filter to Incomplete, as the button does; Clear leaves the page's own filter alone.
  assert.equal(x.W.bulk.prelabel.status, "incomplete");
  assert.deepEqual(drawn(x.prelabelBody()), [2, 4, 5, 7, 9]);
});

test("the page's draft writer merges into the drafts, clears a pending import and tells the user to Apply", () => {
  const lab = createLab([probe], { labelingQueueCtx });
  const x = page({ lab });
  x.prelabelBody();
  const ctx = x.W.labelingLab;
  ctx.actions.setDraft(6, "urgent", "no");
  assert.equal(x.W.bulk.prelabel.drafts[6].urgent, false);
  assert.equal(x.W.bulk.prelabel.csvPreview, null);
  ctx.actions.setDraft(0, "tone", null);
  assert.deepEqual({ ...x.W.bulk.prelabel.drafts[0] }, { urgent: true, topic: "shipping" });
  assert.deepEqual(x.calls.filter((call) => call !== "render"), [
    ["toast", "Row 7: draft labels changed on 1 row. Apply labels to rows, then Save dataset, to keep them."],
    ["toast", "Row 1: draft labels changed on 1 row. Apply labels to rows, then Save dataset, to keep them."]]);
  ctx.actions.goTo(0);
  assert.deepEqual(x.calls.at(-1), ["goTo", 0]);
  // The page replaces its labeling state as a whole (Compare's handoff); the ctx reads the new one.
  x.W.bulk.prelabel = { ...x.W.bulk.prelabel, report: { ...sampleLabelingReport(), items: sampleLabelingReport().items.slice(0, 1) }, drafts: {} };
  assert.deepEqual(rows(ctx.items()), [1]);
  x.W.bulk.prelabel.context = "older";
  assert.deepEqual(ctx.items(), [], "a stale queue lists nothing");
});
