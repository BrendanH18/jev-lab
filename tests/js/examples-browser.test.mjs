import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleBrowserDefaults, exampleMetadata, exampleMetadataJson, visibleExamples, renderExamplesBrowser } from "../../static/js/examples-browser.js";

const examples = [
  { id: "router", title: "Router", pattern: "Routing", blurb: "Departments", code: "dispatch", state: "private-input", questions: { route: { type: "choice", instructions: "private-wording" }, urgent: { type: "noul" } }, expect: { route: { choice: "private-label" } }, answers: { secret: "never-export" } },
  { id: "locate", title: "Locate", pattern: "Vision", blurb: "Find parcels", state: { photo: "parcel" }, images: { "parcel.png": { sample: "parcel" } }, questions: { bounds: { type: "box" } } },
  { id: "grade", title: "Grade", pattern: "Scoring", state: [], questions: { grade: { type: "score" } }, expect: { grade: { min: 2 } } },
];
const ids = (rows) => rows.map((row) => row.id);

test("example search combines with primitive, picture, expectation and input-shape filters", () => {
  const before = JSON.stringify(examples);
  assert.deepEqual(ids(visibleExamples(examples, { query: " DISPATCH ", type: "noul", expectations: "with", stateType: "text", images: "without" })), ["router"]);
  assert.deepEqual(ids(visibleExamples(examples, { query: "BOUNDS", type: "box", images: "with", expectations: "without", stateType: "object" })), ["locate"]);
  assert.deepEqual(ids(visibleExamples(examples, { stateType: "array" })), ["grade"]);
  assert.deepEqual(visibleExamples(examples, { type: "score", images: "with" }), []);
  assert.equal(JSON.stringify(examples), before);
});

test("example sorts are stable and never reorder the source gallery", () => {
  assert.deepEqual(ids(visibleExamples(examples, { sort: "title" })), ["grade", "locate", "router"]);
  assert.deepEqual(ids(visibleExamples(examples, { sort: "fewest" })), ["locate", "grade", "router"]);
  assert.deepEqual(ids(visibleExamples(examples, { sort: "most" })), ["router", "locate", "grade"]);
  assert.deepEqual(ids(visibleExamples(examples, exampleBrowserDefaults())), ["router", "locate", "grade"]);
});

test("example metadata downloads have an explicit allowlist and omit authored payloads and answers", () => {
  assert.deepEqual(exampleMetadata(examples[0]), { id: "router", title: "Router", question_count: 2, types: ["choice", "noul"], image_count: 0, expectation_count: 1, state_type: "text" });
  const metadata = exampleMetadataJson(examples);
  for (const secret of ["private-input", "private-wording", "private-label", "never-export", "parcel.png"]) assert.ok(!metadata.includes(secret));
  assert.equal(exampleMetadataJson([]), "[]");
});

// A DOM stand-in exercises wiring and view replacement; actual layout is checked in the browser.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attrs = {}; this.style = {}; this.isConnected = true; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  replaceWith(replacement) { this.replacement = replacement; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(event, handler) { this.events[event] = handler; }
  get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(""); }
  set textContent(text) { this.text = text; }
}
const elements = (root, predicate) => [root, ...root.children.flatMap((child) => elements(child, predicate))].filter(predicate);
const button = (root, text) => elements(root, (el) => el.tag === "button" && el.textContent === text)[0];

test("example browsing preserves editing until explicit Open, resets one root, and previews only requests", async () => {
  const previous = { document: globalThis.document, Node: globalThis.Node };
  globalThis.Node = Element;
  globalThis.document = { createElement: (tag) => new Element(tag), querySelector: () => null, createTextNode: (text) => { const node = new Element("text"); node.textContent = String(text); return node; } };
  try {
    const { h } = await import("../../static/js/common.js");
    const opened = [];
    const root = renderExamplesBrowser(h, examples, (example) => opened.push(example.id));
    assert.equal(opened.length, 0);
    assert.equal(elements(root, (el) => el.attrs["data-example-id"] !== undefined).length, 3);
    const preview = elements(root, (el) => el.tag === "pre")[0].textContent;
    assert.ok(preview.includes("private-input"));
    assert.ok(!preview.includes("private-label"));
    assert.ok(!preview.includes("never-export"));
    assert.ok(elements(root, (el) => el.tag === "pre")[1].textContent.includes("parcel.png"));
    const search = elements(root, (el) => el.attrs["aria-label"] === "Search examples")[0];
    search.events.input({ target: { value: "absent" } });
    assert.equal(elements(root, (el) => el.attrs["data-example-id"] !== undefined).length, 0);
    assert.equal(root.replacement, undefined);
    button(root, "Reset example view").events.click();
    const replacement = root.replacement;
    assert.equal(replacement.attrs.id, "examples-browser");
    assert.equal(elements(replacement, (el) => el.attrs["data-example-id"] !== undefined).length, 3);
    button(replacement, "Expand shown previews").events.click();
    assert.equal(elements(replacement, (el) => el.tag === "details" && "open" in el.attrs).length, 3);
    button(replacement, "Collapse shown previews").events.click();
    assert.equal(elements(replacement, (el) => el.tag === "details" && "open" in el.attrs).length, 0);
    button(replacement, "Open in Build").events.click();
    assert.deepEqual(opened, ["router"]);
  } finally { Object.assign(globalThis, previous); }
});
