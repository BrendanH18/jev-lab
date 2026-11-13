// Tests of the Examples gallery starter pack, on the fixture gallery of tests/js/lab/fixtures/workbench-shell.mjs.
// Expected values were counted by hand from the fixture's authored text (and the word and character counts checked
// with a separate script); the order of the fixture items is order-triage, wholesale-lead, bag-photo, review-batch,
// late-delivery, blank-draft, crate-locate.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/workbench-examples-starter.js";
import { createLab } from "../../../static/js/lab/host.js";
import { checkPack } from "./harness.mjs";
import { sampleExamplesCtx } from "./fixtures/workbench-shell.mjs";

const items = sampleExamplesCtx().items();
const [order, lead, bag, review, late, blank, crate] = items;
const ID = "workbench.examples.gallery";
const only = (scope, query) => sampleExamplesCtx({ view: { searchScope: scope, query } });
// An odd item (a question that is not an object, a Choice without criteria, a picture entry that is not an object, a
// type list without text): facts must read it without throwing.
const odd = { id: "odd", questions: [null, { id: "c", type: "choice" }], types: [null], pictures: [null], state: 7 };
// Picture references the way the server finds them (jev/images.py _uses): a name in a criterion counts, and "photo1"
// is not counted inside "photo12".
const inCriterion = { id: "crit", state: "see the attached picture", picture_count: 1, pictures: [{ name: "crate-photo", sample: null }],
  questions: [{ id: "which", position: 1, type: "choice", instructions: "Which crate?", criteria: [{ key: "a", text: "the one in crate-photo" }, { key: "b", text: "another" }] }] };
const overlapping = { id: "overlap", state: { photo: "photo12" }, picture_count: 2, pictures: [{ name: "photo1", sample: null }, { name: "photo12", sample: null }], questions: [] };

checkPack(pack, {
  instruction_words: { items: [...items, odd], values: [21, 27, 15, 7, 18, null, 10, 0] },
  longest_instruction: { items, values: [48, 56, 52, 52, 37, null, 27] },
  yes_no_count: { items, values: [1, 1, 1, 0, 2, 0, 0] },
  largest_choice: { items: [...items, odd], values: [3, 3, null, null, 1, null, null, 0] },
  score_levels: { items, values: [3, 4, null, 3, null, null, 1] },
  state_fields: { items, values: [null, 3, 2, null, 1, null, 1] },
  state_words: { items: [...items, odd], values: [15, 19, 8, 8, 10, 0, 1, 0] },
  noul_wording: { items, values: [false, true, false, false, true, false, false] },
  field_references: { items, values: [false, true, true, false, true, false, true] },
  type_combination: { items: [...items, odd], values: ["choice + noul + score", "choice + noul + score", "box + noul", "score", "choice + noul", null, "box + score", null] },
  picture_source: {
    items: [order, bag, { id: "x", pictures: [{ name: "photo-a", sample: "torn-bag" }] }, { id: "y", pictures: [{ name: "upload-b", sample: null }] }, { id: "z" }, odd],
    values: ["no pictures", "samples and embedded", "built-in samples", "embedded", "no pictures", "no pictures"],
  },

  missing_state_field: { hit: lead, miss: [late, bag, order, crate], message: /`notes` is named in an instruction/ },
  thin_choice: { hit: late, miss: [order, lead, blank], message: /^team has 1 option\.$/ },
  thin_score: { hit: crate, miss: [order, review, blank], message: /^fill has 1 level\.$/ },
  box_without_picture: { hit: crate, miss: [bag, order], message: /crate_box asks where something is/ },
  one_sided_noul: { hit: late, miss: [lead, order], message: /^is_late describes only one answer\.$/ },
  repeated_instructions: { hit: late, miss: [order, lead, blank], message: /^repeat_check repeats the instructions of is_late\.$/ },
  unused_picture: { hit: [bag, overlapping], miss: [order, inCriterion, odd, { ...bag, pictures: [{ name: "photo-torn-bag", sample: "torn-bag" }] }],
    message: /^(?:photo-spare-angle|photo1) is attached, but neither the state nor a question mentions it\.$/ },

  picture_share: [
    { ctx: sampleExamplesCtx(), expect: 1 / 7 },
    { ctx: sampleExamplesCtx({ view: { images: "with" } }), expect: 1, empty: sampleExamplesCtx({ examples: [] }) },
  ],
  mean_questions: [
    { ctx: sampleExamplesCtx(), expect: 2 },
    { ctx: sampleExamplesCtx({ view: { type: "score" } }), expect: 2.25, empty: sampleExamplesCtx({ examples: [] }) },
  ],
  hidden_pins: [
    { ctx: sampleExamplesCtx({ pins: ["bag-photo", "late-delivery"], view: { type: "box" } }), expect: 1 },
    { ctx: sampleExamplesCtx({ pins: ["bag-photo"] }), expect: 0, empty: sampleExamplesCtx({ examples: [], pins: ["bag-photo"] }) },
  ],
  lab_hidden: [
    { ctx: (() => {
      const lab = createLab([pack]);
      lab.view(ID).filters = [{ key: "workbench-examples-starter/yes_no_count", op: "min", value: "1" }];
      return sampleExamplesCtx({ lab });
    })(), expect: 3 },
    { ctx: sampleExamplesCtx({ view: { type: "box" } }), expect: 0, empty: sampleExamplesCtx({ examples: [] }) },
  ],

  outlines_markdown: {
    ctx: only("title", "Late delivery"),
    // Criteria as the card's own outline counts them: Noul wording adds nothing, the one-option Choice is 1 criterion.
    text: "## Late delivery check · late-delivery\n\n1. is_late · noul · 0 criteria\n2. team · choice · 1 criterion\n3. repeat_check · noul · 0 criteria\n",
    filename: "example-outlines.md",
    check: () => {
      const feature = pack.features.find((entry) => entry.id === "outlines_markdown");
      assert.equal(feature.build(only("id", "blank-draft")), "## Blank starting point · blank-draft\n\nNo questions.\n");
    },
  },
  requests_jsonl: {
    ctx: only("id", "bag-photo"),
    excludes: ["iVBORw0KGgo=", "data_base64", "expect", "0.6"],
    check: (out) => {
      const lines = out.text.trim().split("\n");
      assert.equal(lines.length, 1);
      assert.deepEqual(JSON.parse(lines[0]), { id: "bag-photo", state: { photo: "photo-torn-bag", context: "A customer photo of a delivered bag" },
        questions: { beans_spilled: { type: "noul", instructions: "Are coffee beans spilled outside the bag in `photo`?" },
          spill_box: { type: "box", instructions: "the spilled coffee beans in `photo`" } },
        pictures: ["photo-torn-bag", "photo-spare-angle"] });
      const late = runLate();
      assert.deepEqual(late.questions.is_late.criteria, { true: "Mentions a delay", false: null });
      assert.deepEqual(late.questions.team.criteria, { shipping: "Delivery problems" });
      assert.ok(!JSON.stringify(late).includes("0.5"), "no expectation leaks into a request");
    },
  },
  questions_csv: {
    ctx: only("id", "review-batch"),
    text: "\"example\",\"position\",\"question\",\"type\",\"criteria\"\r\n\"review-batch\",\"1\",\"sentiment\",\"score\",\"3\"\r\n",
    filename: "example-questions.csv",
    check: () => {
      const feature = pack.features.find((entry) => entry.id === "questions_csv");
      assert.equal(feature.build(only("id", "late-delivery")), "\"example\",\"position\",\"question\",\"type\",\"criteria\"\r\n"
        + "\"late-delivery\",\"1\",\"is_late\",\"noul\",\"0\"\r\n\"late-delivery\",\"2\",\"team\",\"choice\",\"1\"\r\n\"late-delivery\",\"3\",\"repeat_check\",\"noul\",\"0\"\r\n");
    },
  },
  instructions_markdown: {
    ctx: only("id", "review-batch"),
    text: "## Review batch grading\n\n- **sentiment** (score): {\"text\":\"Rate the overall sentiment of the reviews\"}\n  - 0: Negative\n  - 1: Mixed\n  - 2: Positive\n",
    excludes: ["Great roast"],
  },

  open_first_shown: {
    ctx: () => sampleExamplesCtx({ view: { sort: "title" } }),
    check: (ctx) => assert.deepEqual(ctx.calls, [["open", "blank-draft"]]),
    hidden: () => sampleExamplesCtx({ view: { query: "no example says this" } }),
  },
  close_previews: {
    ctx: () => sampleExamplesCtx({ expanded: ["bag-photo", "order-triage"] }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["collapse", "order-triage"], ["collapse", "bag-photo"]]);
      assert.deepEqual(ctx.data.expanded, []);
    },
    hidden: () => sampleExamplesCtx(),
  },
  pin_loaded: {
    ctx: () => sampleExamplesCtx({ loaded: "wholesale-lead" }),
    check: (ctx) => { assert.deepEqual(ctx.calls, [["pin", "wholesale-lead"]]); assert.deepEqual(ctx.data.pins, ["wholesale-lead"]); },
    hidden: () => sampleExamplesCtx({ loaded: null }),
  },
}, { ctx: () => sampleExamplesCtx({ pins: ["bag-photo"], expanded: ["order-triage"] }) });

function runLate() {
  const feature = pack.features.find((entry) => entry.id === "requests_jsonl");
  return JSON.parse(feature.build(only("id", "late-delivery")).trim());
}
