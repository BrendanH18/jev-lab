import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const body = (name) => source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

test("attached cuts belong to the run, labels and questions that fitted them", () => {
  const questions = { topic: { type: "choice", criteria: { billing: "", delivery: "" } } };
  const b = { result: { results: [] }, labels: { 0: { topic: "billing" } }, rowsText: "row", ranQuestions: questions,
    sets: { attached: {}, context: null, result: null, fitted: null } };
  const funcs = ["setFitContext", "syncAttachedSets", "attachedSetsPayload"].map(body).join("\n");
  const { syncAttachedSets, attachedSetsPayload } = new Function("W", "bulkQuestions", `${funcs}; return {syncAttachedSets, attachedSetsPayload};`)({ bulk: b }, () => questions);
  syncAttachedSets();
  const attach = () => { b.sets.attached = { topic: { cut: 0.21, coverage: 0.9 } }; b.sets.fitted = b.sets.context; };
  attach();
  const exported = attachedSetsPayload();
  assert.deepEqual(exported, { topic: { cut: 0.21, coverage: 0.9 } });
  exported.topic.cut = 0.8;
  assert.equal(b.sets.attached.topic.cut, 0.21, "payloads cannot mutate the attached fit");
  const changes = [
    () => { b.labels[0].topic = "delivery"; },
    () => { b.result = { results: [] }; },
    () => { questions.topic.instructions = "A changed judgment"; },
    () => { b.rowsText = "a different row"; },
  ];
  for (const change of changes) {
    attach();
    change();
    assert.equal(attachedSetsPayload(), undefined);
    assert.equal(b.sets.fitted, null);
  }
});

// Render the actual queue functions into a small element tree. No browser or model calls.
function h(tag, attrs, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((v) => v !== null && v !== undefined && v !== false), addEventListener() {} };
}
const allText = (node) => typeof node === "object" ? node.children.map(allText).join(" ") : String(node);
const find = (node, tag) => typeof node === "object" ? [ ...(node.tag === tag ? [node] : []), ...node.children.flatMap((v) => find(v, tag)) ] : [];

test("an old attach button cannot attach its cut after a replacement fit completes", () => {
  const s = { attached: {}, context: "old labels", fitted: "old labels", report: { cut: 0.2, coverage_target: 0.9 } };
  const notices = [];
  const control = new Function("W", "h", "syncAttachedSets", "toast", "render", "icon", "attachedSetsText",
    `${body("attachedSetsControl")}; return attachedSetsControl;`)({ bulk: { sets: s } }, h, () => {},
    (message) => notices.push(message), () => {}, () => "", () => "");
  const oldButton = find(control("topic", s.report), "button")[0];
  s.context = s.fitted = "new labels";
  s.report = { cut: 0.7, coverage_target: 0.9 };
  oldButton.attrs.onclick();
  assert.deepEqual(s.attached, {}, "the previous report's cut must not be attached");
  assert.equal(notices.length, 1);
  find(control("topic", s.report), "button")[0].attrs.onclick();
  assert.deepEqual(s.attached, { topic: { cut: 0.7, coverage: 0.9 } });
});

test("review shortlists retain every label and audit shortlists stay hidden until labeled", () => {
  const funcs = ["queueClasses", "shownAnswer", "queueReady", "queueVisible", "queueNextIncomplete", "labelText", "labelValue", "queueSelect", "queueView", "queueCsv", "agreeQuestions"].map(body).join("\n");
  const W = { bulk: { pictures: { "torn-bag": "/img/samples/torn-bag.png" } } };
  const queueView = new Function("W", "h", "rowText", "render", "icon", `${funcs}; return queueView;`)(W, h, String, () => {}, () => "");
  const question = { type: "choice", criteria: { billing: "", delivery: "", other: "" } };
  const item = { kind: "review", line: 1, held: ["topic"], rules: [], row: { _image: "torn-bag" }, labels: {}, open: ["topic"],
    answers: { topic: "billing" }, candidates: { topic: ["billing", "delivery"] } };
  const report = { items: [item], gates: { topic: 0.9 }, room: 20, questions: { topic: question },
    counts: { decisions: 1, review: 1, auto: 0, queued: 1, audit: 0 }, problems_total: 0 };
  const view = () => queueView({ id: "coffee", name: "Coffee" }, { report });
  const review = view();
  assert.match(allText(review), /Suggested shortlist: billing, delivery/);
  assert.equal(find(review, "img")[0].attrs.src, W.bulk.pictures["torn-bag"]);
  const labels = find(review, "select").find((s) => s.attrs["aria-label"] === "Label topic for line 1");
  assert.deepEqual(find(labels, "option").map((o) => o.attrs.value), ["", "billing", "delivery", "other"]);
  assert.deepEqual(item.labels, {}, "the held question stays unlabeled");
  item.kind = "audit";
  assert.doesNotMatch(allText(view()), /Suggested shortlist|gate: billing/);
  item.labels.topic = "other";
  assert.match(allText(view()), /Suggested shortlist: billing, delivery/);
});

test("saving Review labels keeps provenance for the server's second check", async () => {
  const provenance = { version: 1, fingerprint: "configuration", model: "jev-1.14.0" };
  const item = { row: { text: "A new ticket" }, kind: "audit", answers: { topic: "billing" },
    labels: { topic: "delivery" }, provenance };
  const report = { items: [item], gates: { topic: 0.9 }, room: 20 };
  const W = { bulk: { checkRuns: { coffee: { queue: { report } } }, dataset: { id: null } } };
  let payload;
  const api = async (path, data) => {
    if (path.endsWith("/add")) {
      payload = data;
      return { added: 1, already: 0, audit: null };
    }
    return { datasets: [] };
  };
  const add = new Function("W", "api", "render", "toast", "handleError", "queueReady",
    `async ${body("addQueued")}; return addQueued;`)(W, api, () => {}, () => {}, (e) => { throw e; }, () => true);
  await add("coffee");
  assert.deepEqual(payload.items[0].provenance, provenance);
  assert.deepEqual(report.items, []);
});
