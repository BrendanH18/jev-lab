import pack from "../../../static/js/lab/packs/workbench/tests-question-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsItemsCtx } from "./fixtures/workbench-tests.mjs";

const ctx = (overrides) => sampleTestsItemsCtx(overrides);
const T = Object.fromEntries(ctx({ filters: {} }).items().map((item) => [item.id, item]));
const R = T["refund-routing"], B = T["bean-quality"], D = T["damaged-bag-photo"], W = T["wholesale-inquiry"], L = T["latte-art-feedback"], U = T["unnamed-draft"];
// Items made by the real builder from hand-written raw saved tests (nothing run).
const made = (...raws) => ctx({ items: raws, results: null, filters: {} }).items();
const saved = (id, questions, expect = {}, extra = {}) => ({ id, name: id, state: "Order HC-1042 from the Portside cafe", questions, expect, ...extra });
const noul = (instructions = "Is it late?", criteria) => ({ type: "noul", instructions, ...(criteria ? { criteria } : {}) });
const choice = (criteria, instructions = "Which team?") => ({ type: "choice", instructions, criteria });
const score = (criteria, instructions = "How happy?") => ({ type: "score", instructions, criteria });
const box = (extra = {}) => ({ type: "box", instructions: "Where is the tear?", ...extra });
const EDGES = { left: 0.1, top: 0.1, right: 0.5, bottom: 0.5 };
const LEVELS = ["Unhappy", "Mixed", "Happy"];

const [BLANKY, MULTI, PATHS, TEXTPATH, PICREF] = made(
  // Choice descriptions "", "Fine" and null (read as ""), a Noul false criterion [] (read as "[]"): three blank.
  saved("blanky", { team: choice({ a: "", b: "Fine", c: null }), late: noul("Is it late?", { true: "Yes", false: [] }) }),
  saved("multi", { a: choice({ w: "W", x: "X", y: "Y", z: "Z" }), b: choice({ p: "P", q: "Q" }, "Which shelf?") }),
  // Five distinct paths (the repeat in the criterion and the spaced `5 kg` do not count): order.id, order.items[1] and
  // the dotted field ship.to resolve; customer.email and order.items[5] (past the end of a two-item list) do not.
  saved("paths", { check: noul("Is `order.id` valid, is `order.items[1]` a filter, does `ship.to` match `customer.email` and `order.items[5]`?",
    { true: "Yes, see `order.id`", false: "No `5 kg` bag" }) }, {},
  { state: { order: { id: "HC-1042", items: ["beans", "filters"] }, "ship.to": "Portside" } }),
  saved("text-path", { present: noul("Is `order.id` present?") }),
  // The token names a picture reference, which counts as resolved although the text state has no fields.
  saved("picture-ref", { tear: box({ instructions: "Where is the tear in `bag-photo-1`?" }) }, {}, { images: { "bag-photo-1": { sample: "torn-bag" } } }),
);
const [IGNORED, RANGES, EMPTY_RANGE, BOX_POINT, IOU_ONLY, SCORE_BOX, ORPHAN_ODD] = made(
  // choice on a Noul and min on a Box are ignored; "mim" is not a key: all three questions are unchecked.
  saved("ignored", { a: noul(), b: box(), c: score(LEVELS) }, { a: { choice: "yes" }, b: { min: 0.5 }, c: { mim: 1 } }),
  saved("ranges", { a: noul(), b: choice({ x: "Ex", y: "Why" }), c: score(LEVELS) }, { a: { min: 0.2, max: 0.8 }, b: { choice: "x", min: 0.5, max: 0.55 }, c: { min: 1, max: 1 } }),
  saved("empty-range", { a: noul() }, { a: { min: 0.8, max: 0.2 } }),
  saved("box-point", { a: box() }, { a: { box: EDGES, min: 0.3, max: 0.3 } }),
  saved("iou-only", { a: box() }, { a: { iou_min: 0.7 } }),
  saved("score-box", { a: score(LEVELS) }, { a: { box: EDGES } }),
  saved("orphan-odd", { a: noul() }, { ghost: { mim: 1 } }),
);
const [HIGH, SCORE_HIGH, NEGATIVE, IOU_HIGH, FLAT_BOX, TRIV_NOUL, TRIV_BOX, TRIV_CHOICE] = made(
  saved("high", { a: noul() }, { a: { min: 1.5 } }),
  saved("score-high", { a: score(LEVELS) }, { a: { min: 2.5 } }),
  saved("negative", { a: choice({ x: "Ex", y: "Why" }) }, { a: { max: -0.1 } }),
  saved("iou-high", { a: box() }, { a: { box: EDGES, iou_min: 1.2 } }),
  // Zero width (left = right), with the default iou_min of 0.5.
  saved("flat-box", { a: box() }, { a: { box: { left: 0.3, top: 0.1, right: 0.3, bottom: 0.5 } } }),
  saved("triv-noul", { a: noul() }, { a: { min: 0 } }),
  saved("triv-box", { a: box() }, { a: { box: EDGES, iou_min: 0 } }),
  saved("triv-choice", { a: choice({ x: "Ex", y: "Why" }) }, { a: { choice: "x", max: 1 } }),
);
// Boundaries: each bound sits exactly at an end of the answer's range, so it can be met (not impossible) and, for a
// min at the top or a max at the bottom, it still excludes answers (not trivial). iou_min 1 needs an exact match.
const [IOU_ONE, MAX_ZERO, SCORE_TOP, NEAR_EDGES] = made(
  saved("iou-one", { a: box() }, { a: { box: EDGES, iou_min: 1 } }),
  saved("max-zero", { a: noul() }, { a: { max: 0 } }),
  saved("score-top", { a: score(LEVELS) }, { a: { min: 2 } }),
  saved("near-edges", { a: noul(), b: score(LEVELS) }, { a: { min: 0.01, max: 0.99 }, b: { min: 0.5, max: 1.5 } }),
);
const [DUP_OPTIONS, DUP_LEVELS, NOUL_DUP, TWIN_QUESTIONS, ARRAY_INSTRUCTIONS, BRACE] = made(
  saved("dup-options", { a: choice({ a: "Late delivery.", b: "late  delivery", c: "Other" }) }),
  saved("dup-levels", { a: score(["Bad", "OK", "ok!"]) }),
  // Noul criteria are not compared; only Choice options and Score levels are.
  saved("noul-dup", { a: noul("Is it late?", { true: "Yes", false: "yes" }) }),
  saved("twin-questions", { a: noul("Is it late?"), b: noul("is  it LATE") }),
  saved("array-instructions", { a: score(LEVELS, ["Rate", "the tone"]) }),
  saved("brace", { a: noul("{not json} is the question?") }),
);
const [BAD_TYPE, NO_INSTRUCTIONS, ONE_LEVEL, BOX_CRITERIA, NOUL_KEYS, CHOICE_EMPTY, SCORE_OBJECT, DUP_ID] = made(
  saved("bad-type", { a: { type: "yesno", instructions: "Late?" } }),
  saved("no-instructions", { a: { type: "noul" } }),
  saved("one-level", { a: score(["Only"]) }),
  saved("box-criteria", { a: box({ criteria: ["x"] }) }),
  saved("noul-keys", { a: noul("Late?", { yes: "Y" }) }),
  saved("choice-empty", { a: choice({}) }),
  saved("score-object", { a: score({ low: "L", high: "H" }) }),
  saved("dup-id", { a: noul(), " a": noul("Is it early?") }),
);
// Lint's _norm reads {} as no description and ignores the order of structured fields (checked in Python:
// _norm({}) == "" and _norm({"a": "X", "b": "y"}) == _norm({"b": "Y", "a": "x."}) == "{a: x, b: y}").
const [EMPTY_STRUCT, FIELD_ORDER] = made(
  saved("empty-struct", { a: choice({ p: {}, q: {}, r: "Other" }) }),
  saved("field-order", { a: choice({ p: { a: "X", b: "y" }, q: { b: "Y", a: "x." } }) }),
);
const [REORDER, MIXED_IDS, KEBAB] = made(
  saved("reorder", { urgent: noul("Reply today?"), intent: choice({ refund: "Money back" }) }),
  saved("mixed-ids", { order_status: noul(), orderStatus: noul("Is it early?") }),
  saved("kebab", { "is-late": noul(), today: noul("Is it today?") }),
);

checkPack(pack, {
  // Code points: "What does the customer want?" 28, "Does this need a reply today?" 29 -> 29; "How happy is the reviewer
  // with the beans?" 41; "Where is the tear in `photo`?" 29 and "Is the bag in `photo` torn?" 27; "Which team should
  // answer?" 25; latte's structured instructions as JSON text {"text":"Rate the tone","scale":"0-3"} 38.
  longest_instruction: { items: [R, B, D, W, L, U], values: [29, 41, 29, 25, 38, null] },
  // "Just asking" 11; "Unhappy" 7; no criteria; "Customer support" 16; "Milk is mentioned" 17.
  longest_criterion: { items: [R, B, D, W, L, U], values: [11, 7, null, 16, 17, null] },
  blank_criteria: { items: [BLANKY, R, U], values: [3, 0, 0] },
  most_options: { items: [R, W, MULTI, B], values: [3, 2, 4, null] },
  fewest_options: { items: [R, W, MULTI, B], values: [3, 2, 2, null] },
  most_score_levels: { items: [B, L, R, U], values: [3, 4, null, null] },
  backtick_references: { items: [D, R, PATHS, TEXTPATH, U], values: [1, 0, 5, 1, 0] },
  // Damaged: `photo` is a picture reference (and a state field).
  unresolved_references: { items: [D, PATHS, TEXTPATH, PICREF, R], values: [0, 2, 1, 0, 0] },
  range_expectations: { items: [R, B, RANGES, BOX_POINT], values: [0, 1, 3, 0] },
  // Ranges: 0.8 - 0.2 = 0.6 and 0.55 - 0.5 = 0.05 (the Score range is not a probability); empty range 0.2 - 0.8.
  narrowest_probability_range: { items: [RANGES, B, R, EMPTY_RANGE], values: [0.05, null, null, -0.6], tolerance: 1e-9 },

  impossible_bound: { items: [EMPTY_RANGE, HIGH, SCORE_HIGH, NEGATIVE, IOU_HIGH, FLAT_BOX, R, B, D, W, RANGES, IGNORED, IOU_ONE, MAX_ZERO, SCORE_TOP],
    values: [true, true, true, true, true, true, false, false, false, false, false, false, false, false, false] },
  // Bean quality: a max of 2 on a three-level Score (0 to 2) is always met.
  trivial_bound: { items: [TRIV_NOUL, TRIV_BOX, TRIV_CHOICE, B, R, D, L, W, EMPTY_RANGE, MAX_ZERO, SCORE_TOP, NEAR_EDGES, IOU_ONE],
    values: [true, true, true, true, false, false, false, false, false, false, false, false, false] },
  exact_point: { items: [RANGES, R, B, BOX_POINT], values: [true, false, false, false] },
  choice_floor: { items: [R, RANGES, W, B, IGNORED], values: [true, true, false, false, false] },
  ignored_expectation_key: { items: [IGNORED, BOX_POINT, IOU_ONLY, SCORE_BOX, R, B, D, W, L], values: [true, true, true, true, false, false, false, false, false] },
  unrecognized_expectation_key: { items: [IGNORED, R, D, W, ORPHAN_ODD], values: [true, false, false, false, false] },
  repeated_descriptions: { items: [DUP_OPTIONS, DUP_LEVELS, FIELD_ORDER, NOUL_DUP, BLANKY, EMPTY_STRUCT, R, B],
    values: [true, true, true, false, false, false, false, false] },
  repeated_instructions: { items: [TWIN_QUESTIONS, R, D, L, U], values: [true, false, false, false, false] },
  noul_without_both_sides: { items: [R, D, W, BLANKY, L, B, NOUL_DUP], values: [true, true, true, true, false, false, false] },
  structured_instructions: { items: [L, ARRAY_INSTRUCTIONS, R, BRACE, U], values: [true, true, false, false, false] },
  save_rules_rejected: { items: [U, BAD_TYPE, NO_INSTRUCTIONS, ONE_LEVEL, BOX_CRITERIA, NOUL_KEYS, CHOICE_EMPTY, SCORE_OBJECT, DUP_ID, R, B, D, W, L, PATHS],
    values: [true, true, true, true, true, true, true, true, true, false, false, false, false, false, false] },

  expectation_kinds: { items: [R, B, D, W, L, U, IGNORED], values: ["bound + option", "bound", "box", "option", "bound", null, "none"] },
  // FNV-1a 32-bit of the UTF-8 text, computed separately in Python: "intent\tchoice\nurgent\tnoul" -> 94c46f21,
  // "quality\tscore" -> e7aca94d. Reorder asks the same IDs and types in another order.
  question_set: { items: [R, REORDER, B, U], values: ["qs-94c46f21", "qs-94c46f21", "qs-e7aca94d", null] },
  question_id_style: { items: [R, L, MIXED_IDS, KEBAB, U], values: ["single words", "snake_case", "mixed", "kebab-case", null] },
}, { ctx: () => ctx() });
