import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleCounts, exampleRequestJson, exampleOutline, exampleTypeSummary, exampleMetadataCsv } from "../../static/js/examples-refinements.js";
import { visibleExamples, exampleMetadata, renderExamplesBrowser } from "../../static/js/examples-browser.js";

const examples = [
  { id: "alpha", title: "Coffee routing", pattern: "Team dispatch", state: "☕", questions: {
    route: { type: "choice", instructions: "Choose a team", criteria: { billing: "Money", sales: "Orders" } },
    urgent: { type: "noul", instructions: "Is this urgent?" },
  }, expect: { route: { choice: "never-label" } }, answers: { route: "never-answer" } },
  { id: "beta", title: "Quality review", state: {}, questions: {
    grade: { type: "score", instructions: { text: "Rate quality" }, criteria: ["Poor", "Good", "Great"] },
  }, images: { photo: { sample: "cup" } } },
  { id: "gamma", title: "Quality simple", state: "x", questions: { okay: { type: "noul", instructions: "Accept?" } } },
];
const ids = (view) => visibleExamples(examples, view).map((ex) => ex.id);

test("scoped phrase, every-word, any-word and exclusion searches compose", () => {
  assert.deepEqual(ids({ query: "COFFEE", searchScope: "title" }), ["alpha"]);
  assert.deepEqual(ids({ query: "alpha", searchScope: "title" }), []);
  assert.deepEqual(ids({ query: "alpha", searchScope: "id" }), ["alpha"]);
  assert.deepEqual(ids({ query: "dispatch", searchScope: "pattern" }), ["alpha"]);
  assert.deepEqual(ids({ query: "route", searchScope: "questions" }), ["alpha"]);
  assert.deepEqual(ids({ query: "rate quality", searchScope: "instructions" }), ["beta"]);
  assert.deepEqual(ids({ query: "routing team", searchMode: "all" }), ["alpha"]);
  assert.deepEqual(ids({ query: "coffee quality", searchMode: "any", exclude: "review" }), ["alpha", "gamma"]);
  assert.deepEqual(ids({ query: "never-label", searchMode: "any" }), []);
  assert.deepEqual(ids({ query: "☕" }), []); // Search does not inspect input payloads.
});

test("authored criteria, question and UTF-8 bounds accept zero and reject invalid values", () => {
  assert.deepEqual(exampleCounts(examples[0]), { criteria: 2, stateBytes: 3, types: 2 });
  assert.equal(exampleCounts(examples[1]).criteria, 3);
  assert.deepEqual(ids({ minQuestions: "2", maxQuestions: "2", minCriteria: "2", maxCriteria: "2", minStateBytes: "3", maxStateBytes: "3" }), ["alpha"]);
  assert.deepEqual(ids({ maxCriteria: "0" }), ["gamma"]);
  for (const field of ["minQuestions", "maxQuestions", "minCriteria", "maxCriteria", "minStateBytes", "maxStateBytes"]) {
    for (const invalid of ["-1", "0.5", "bad", "Infinity"]) assert.deepEqual(ids({ [field]: invalid }), []);
  }
  assert.deepEqual(ids({ typeMix: "mixed" }), ["alpha"]);
  assert.deepEqual(ids({ typeMix: "single", images: "with", type: "score" }), ["beta"]);
  assert.deepEqual(ids({ pinned: "with", pins: new Set(["beta"]) }), ["beta"]);
  assert.deepEqual(ids({ pinned: "without", pins: new Set(["beta"]) }), ["alpha", "gamma"]);
});

test("new sorts are stable, preserve gallery order and describe authored counts only", () => {
  const original = JSON.stringify(examples);
  assert.deepEqual(ids({ sort: "state-smallest" }), ["gamma", "beta", "alpha"]);
  assert.deepEqual(ids({ sort: "state-largest" }), ["alpha", "beta", "gamma"]);
  assert.deepEqual(ids({ sort: "criteria-fewest" }), ["gamma", "alpha", "beta"]);
  assert.deepEqual(ids({ sort: "criteria-most" }), ["beta", "alpha", "gamma"]);
  const tied = [{ ...examples[0], state: "x" }, examples[2]];
  assert.deepEqual(visibleExamples(tied, { sort: "state-largest" }).map((ex) => ex.id), ["alpha", "gamma"]);
  assert.equal(JSON.stringify(examples), original);
  assert.equal(exampleTypeSummary(examples), "choice: 1 · noul: 2 · score: 1 · box: 0");
  assert.deepEqual(exampleOutline(examples[0]), [{ position: 1, id: "route", type: "choice", criteria: 2 }, { position: 2, id: "urgent", type: "noul", criteria: 0 }]);
});

test("request handoffs and CSV use distinct explicit content boundaries", () => {
  const request = JSON.parse(exampleRequestJson(examples[0]));
  assert.deepEqual(Object.keys(request), ["state", "questions"]);
  assert.deepEqual(request.questions, examples[0].questions);
  assert.deepEqual(JSON.parse(exampleRequestJson(examples[1])).images, examples[1].images);
  const csv = exampleMetadataCsv([{ ...exampleMetadata(examples[0]), title: '=FORMULA("x")', secret: "never-export" }]);
  assert.ok(csv.includes('"\'=FORMULA(""x"")"'));
  assert.ok(csv.includes("choice; noul"));
  for (const content of ["never-label", "never-answer", "never-export", "☕", "Choose a team"]) assert.ok(!csv.includes(content));
  for (const title of ["+SUM(A1)", "-2+3", "@formula", "  =formula", "\tformula", "\nformula"]) assert.ok(exampleMetadataCsv([{ title }]).includes('"\''));
});

// A minimal tree exercises real event handlers without adding a DOM dependency.
function h(tag, attrs = {}, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
    replaceChildren(...next) { this.children = next; }, replaceWith(next) { this.replacement = next; },
    get textContent() { return this.text ?? this.children.map((c) => typeof c === "object" ? c.textContent : String(c)).join(""); },
    set textContent(value) { this.text = value; }, click() {} };
}
const all = (root) => [root, ...root.children.filter((c) => typeof c === "object").flatMap(all)];
const button = (root, label) => all(root).find((n) => n.tag === "button" && n.textContent === label);
const field = (root, label) => all(root).find((n) => n.attrs["aria-label"] === label);
const cards = (root) => all(root).filter((n) => n.attrs["data-example-id"]);

test("gallery actions keep hidden pins, use current views and never open Build implicitly", async () => {
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copied = [], downloads = [], opened = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text) => copied.push(text) } } });
  const createBefore = URL.createObjectURL, revokeBefore = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:test"; };
  URL.revokeObjectURL = () => {};
  try {
    const root = renderExamplesBrowser(h, examples, (ex) => opened.push(ex.id));
    const search = field(root, "Search examples");
    button(root, "Pin shown examples").attrs.onclick();
    search.attrs.oninput({ target: { value: "Coffee" } });
    assert.equal(cards(root).length, 1);
    button(root, "Unpin shown examples").attrs.onclick();
    await button(root, "Copy pinned example IDs").attrs.onclick();
    assert.equal(copied.at(-1), "beta\ngamma");
    button(root, "Download pinned example metadata").attrs.onclick();
    assert.deepEqual(JSON.parse(await downloads.at(-1).text()).map((ex) => ex.id), ["beta", "gamma"]);
    await button(root, "Copy shown example IDs").attrs.onclick();
    assert.equal(copied.at(-1), "alpha");
    await button(root, "Copy authored request").attrs.onclick();
    assert.deepEqual(JSON.parse(copied.at(-1)), JSON.parse(exampleRequestJson(examples[0])));
    button(root, "Download authored request").attrs.onclick();
    assert.deepEqual(JSON.parse(await downloads.at(-1).text()), JSON.parse(exampleRequestJson(examples[0])));
    button(root, "Download shown example CSV").attrs.onclick();
    const csv = await downloads.at(-1).text();
    assert.ok(csv.includes("Coffee routing"));
    assert.ok(!csv.includes("Quality review"));
    assert.ok(!csv.includes("never-label"));
    assert.deepEqual(opened, []);
    assert.equal(root.replacement, undefined); // typing kept the control tree mounted
    button(root, "Reset example view").attrs.onclick();
    const reset = root.replacement;
    field(reset, "Example pins").attrs.onchange({ target: { value: "with" } });
    assert.deepEqual(cards(reset).map((c) => c.attrs["data-example-id"]), ["beta", "gamma"]);
    button(reset, "Unpin shown examples").attrs.onclick();
    assert.equal(cards(reset).length, 0);
    assert.equal(button(reset, "Copy shown example IDs").attrs.disabled, true);
    button(reset, "Reset example view").attrs.onclick();
  } finally {
    if (navigatorBefore) Object.defineProperty(globalThis, "navigator", navigatorBefore); else delete globalThis.navigator;
    URL.createObjectURL = createBefore; URL.revokeObjectURL = revokeBefore;
  }
});
