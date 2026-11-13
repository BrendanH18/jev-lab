// Edits and importers on workbench.build.questions. Every expected list is written by hand from the input next to it.
// Items are stored editor fields as a transform receives them (no read-only facts). The editor-Markdown importer is
// fed the page's own exporter (static/js/build-editing.js editorQuestionsMarkdown), so the round trip is checked
// against independent code.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/build-question-edits.js";
import { editorQuestionsMarkdown } from "../../../static/js/build-editing.js";
import { previewTransform } from "../../../static/js/lab/kit.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleBuildQuestionsCtx } from "./fixtures/workbench-build.mjs";

const BLANK_CHOICE = [["", ""], ["", ""]];
const BLANK_SCORE = ["", "", ""];
// One stored question: noul by default, every criteria field present, as the editor keeps them.
const q = (ref, id, fields = {}) => ({ ref, id, type: "noul", instructions: "", choice: BLANK_CHOICE, score: BLANK_SCORE, noulYes: "", noulNo: "", expectation: null, ...fields });
// One imported row (no ref, no expectation).
const row = (id, type, fields = {}) => ({ id, type, instructions: "", choice: BLANK_CHOICE, score: BLANK_SCORE, noulYes: "", noulNo: "", ...fields });
const ids = (...list) => list.map((id, index) => q(`q${index + 1}`, id));
const withIds = (items, list) => items.map((item, index) => ({ ...item, id: list[index] }));
const instructionsOf = (list) => list.map((instructions, index) => q(`q${index + 1}`, `x${index + 1}`, { instructions }));

const expectCtx = (input) => fakeCtx({ items: input, data: { expect: { old_question: { min: 0.2 } } } });
const prefixInput = [q("q1", "support_intent", { expectation: { choice: "refund" } }), q("q2", "tone"), q("q3", "support_"), q("q4", "")];

const curl = [
  "curl -X POST https://api.typesafe.ai/v1/systemone \\",
  "  -H \"Authorization: Bearer $TYPESAFE_API_KEY\" \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -d @- <<'EOF'",
  JSON.stringify({ state: "Charged twice", model: "jev-1.14", questions: { angry: { type: "noul", instructions: "Angry?" } } }, null, 2),
  "EOF",
  "",
].join("\n");

const markdownRows = [
  { id: "intent", type: "choice", instructions: "What does the customer in `ticket.body` want?\n```\nfenced\n```", choice: [["refund", "Wants money back"], ["", ""]],
    score: BLANK_SCORE, noulYes: "", noulNo: "" },
  { id: "lvl", type: "score", instructions: "How urgent?", choice: BLANK_CHOICE, score: ["Low", "", "High"], noulYes: "", noulNo: "" },
  { id: "angry", type: "noul", instructions: "Angry?", choice: BLANK_CHOICE, score: BLANK_SCORE, noulYes: "Angry words", noulNo: "" },
  { id: "mug", type: "box", instructions: "Mug in `photo`.", choice: BLANK_CHOICE, score: BLANK_SCORE, noulYes: "", noulNo: "" },
];

checkPack(pack, {
  // ---------- ids ----------
  remove_id_prefix: { params: { prefix: "support_" }, input: prefixInput, ctx: expectCtx(prefixInput),
    output: withIds(prefixInput, ["intent", "tone", "support_", ""]), unchanged: ids("tone"),
    rejects: [{ input: ids("support_a", "a"), params: { prefix: "support_" }, message: /Two questions would have the id “a”/ },
      { input: ids("support_old_question"), params: { prefix: "support_" }, message: /Expectations already exist for “old_question”/ }] },
  add_id_suffix: { params: { suffix: "_v2" }, input: ids("intent", "tone_v2", ""), output: ids("intent_v2", "tone_v2", ""),
    rejects: [{ params: { suffix: "a b" }, message: /cannot contain spaces/ }, { input: ids("a", "a_v2"), params: { suffix: "_v2" }, message: /Two questions would have the id “a_v2”/ }] },
  remove_id_suffix: { params: { suffix: "_v2" }, input: ids("intent_v2", "_v2", "tone_v2"), shown: [0, 1], output: ids("intent", "_v2", "tone_v2") },
  replace_in_ids: { params: { find: "order", replace: "parcel" }, input: ids("order_late", "late_order_order", "tone"),
    output: ids("parcel_late", "late_parcel_parcel", "tone"),
    rejects: [{ input: ids("tone"), params: { find: "tone", replace: " " }, message: /without an id/ }] },
  pattern_rename_ids: { params: { pattern: "^(\\w+)_check$", replacement: "check_$1" }, input: ids("refund_check", "tone", "late_check"),
    output: ids("check_refund", "tone", "check_late"),
    rejects: [{ params: { pattern: "(", replacement: "" }, message: /not a valid regular expression/ }] },
  id_naming_style: { params: { style: "camel" }, input: ids("order_status", "tone", " Mixed Case "), output: ids("orderStatus", "tone", "mixedCase"),
    rejects: [{ params: { style: "snake" }, message: /choose one of the listed options/ },
      { input: ids("order-status", "order_status"), params: { style: "kebab" }, message: /Two questions would have the id “order-status”/ }] },
  fill_blank_ids: {
    input: [q("q1", "", { instructions: "Is the order late today please?" }), q("q2", "", { instructions: "{\"ask\": \"Late?\"}" }),
      q("q3", "is_the_order_late", { instructions: "x" }), q("q4", "", { instructions: "Is the order late now?" })],
    output: [q("q1", "is_the_order_late_2", { instructions: "Is the order late today please?" }), q("q2", "", { instructions: "{\"ask\": \"Late?\"}" }),
      q("q3", "is_the_order_late", { instructions: "x" }), q("q4", "is_the_order_late_3", { instructions: "Is the order late now?" })] },

  // ---------- wording ----------
  replace_in_instructions: { params: { find: "Order", replace: "parcel", matchCase: false },
    input: instructionsOf(["Is the order late? ORDER now", "{\"ask\": \"order late\"}", "No match"]),
    output: instructionsOf(["Is the parcel late? parcel now", "{\"ask\": \"parcel late\"}", "No match"]),
    rejects: [{ input: instructionsOf(["{\"ask\": \"x\"}"]), params: { find: "\"", replace: "", matchCase: true }, message: /would break its JSON/ }] },
  pattern_replace_instructions: { params: { pattern: "`(\\w+)\\.body`", replacement: "`$1.text`" },
    input: instructionsOf(["Is `ticket.body` angry?", "Read `email.body` and `ticket.body`.", "none"]),
    output: instructionsOf(["Is `ticket.text` angry?", "Read `email.text` and `ticket.text`.", "none"]),
    rejects: [{ params: { pattern: "[" }, message: /not a valid regular expression/ }] },
  replace_in_criteria: { params: { find: "money", replace: "cash" },
    input: [q("q1", "a", { type: "choice", instructions: "money?", choice: [["refund", "Wants money back"], ["money", "Money talk"]] }),
      q("q2", "b", { type: "score", score: ["No money", "Some money"] }), q("q3", "c", { noulYes: "money" }), q("q4", "d", { type: "box", instructions: "money" })],
    output: [q("q1", "a", { type: "choice", instructions: "money?", choice: [["refund", "Wants cash back"], ["money", "Money talk"]] }),
      q("q2", "b", { type: "score", score: ["No cash", "Some cash"] }), q("q3", "c", { noulYes: "cash" }), q("q4", "d", { type: "box", instructions: "money" })] },
  replace_in_keys: { params: { find: "_", replace: "-" },
    input: [q("q1", "a", { type: "choice", choice: [["where_is_order", "x"], ["refund", ""]] }),
      q("q2", "b", { type: "choice", choice: [["refund", "a"], ["no_refund", "b"]], expectation: { choice: "refund" } })],
    output: [q("q1", "a", { type: "choice", choice: [["where-is-order", "x"], ["refund", ""]] }),
      q("q2", "b", { type: "choice", choice: [["refund", "a"], ["no-refund", "b"]], expectation: { choice: "refund" } })],
    rejects: [{ input: [q("q1", "a", { type: "choice", choice: [["no_refund", "b"]], expectation: { choice: "no_refund" } })], params: { find: "_", replace: "-" },
      message: /expects “no_refund”/ },
      { input: [q("q1", "a", { type: "choice", choice: [["a_b", ""], ["a-b", ""]] })], params: { find: "_", replace: "-" }, message: /option “a-b” twice/ }] },
  rename_path: { params: { from: "ticket.body", to: "email.text" },
    input: [q("q1", "a", { instructions: "Is `ticket.body` angry? Check ticket.body and ` ticket.body ` and `ticket.body2`.", noulYes: "Says `ticket.body` is angry" }),
      q("q2", "b", { instructions: "{\"ask\": \"Is `ticket.body` angry?\"}" })],
    output: [q("q1", "a", { instructions: "Is `email.text` angry? Check ticket.body and `email.text` and `ticket.body2`.", noulYes: "Says `email.text` is angry" }),
      q("q2", "b", { instructions: "{\"ask\": \"Is `email.text` angry?\"}" })],
    rejects: [{ params: { from: "a", to: "b c" }, message: /cannot be blank/ }] },
  add_instruction_text: { params: { text: " Answer for the latest message only. ", where: "after" },
    input: instructionsOf(["Is it late?  ", "{\"ask\": \"x\"}", "", "Is it paid?"]),
    output: instructionsOf(["Is it late? Answer for the latest message only.", "{\"ask\": \"x\"}", "", "Is it paid? Answer for the latest message only."]),
    rejects: [{ params: { text: "  " }, message: /Text to add is required/ }] },

  // ---------- normalization ----------
  straighten_punctuation: {
    input: [q("q1", "a", { type: "choice", instructions: "Is it “late” — or ‘early’?", choice: [["a", "It’s fine"]] }),
      q("q2", "b", { instructions: "{\"ask\": \"Is it “late” – ‘now’?\"}" })],
    output: [q("q1", "a", { type: "choice", instructions: "Is it \"late\" - or 'early'?", choice: [["a", "It's fine"]] }),
      q("q2", "b", { instructions: "{\"ask\": \"Is it “late” - 'now'?\"}" })],
    unchanged: instructionsOf(["Plain \"text\" - here"]) },
  strip_control_characters: {
    input: [q("q1", "in\u0007tent", { type: "choice", instructions: "Is\u0000 it\tlate?\n", choice: [["a\u0001", "b\u0002"]] })],
    output: [q("q1", "intent", { type: "choice", instructions: "Is it\tlate?\n", choice: [["a", "b"]] })] },
  unicode_nfc: {
    input: [q("q1", "café", { instructions: "Café?", noulYes: "crème" })],
    output: [q("q1", "café", { instructions: "Café?", noulYes: "crème" })],
    rejects: [{ input: ids("cafe\u0301", "caf\u00e9"), message: /Two questions would have the id “café”/ }] },  // only position 1 is shown
  trim_line_ends: { input: instructionsOf(["Line one  \n  Line two\t\r\nend ", "clean"]), output: instructionsOf(["Line one\n  Line two\r\nend", "clean"]) },
  squeeze_blank_lines: { input: instructionsOf(["A\n\n\n\nB\n\nC", "X\r\n\r\n \r\n\r\nY"]), output: instructionsOf(["A\n\nB\n\nC", "X\r\n\r\nY"]) },
  collapse_criteria_spaces: {
    input: [q("q1", "a", { type: "choice", choice: [["a", "Wants   money  back"], ["b", "  indented"]] }), q("q2", "b", { type: "score", score: ["Not   urgent", "{\"x\":  1}"] })],
    output: [q("q1", "a", { type: "choice", choice: [["a", "Wants money back"], ["b", "  indented"]] }), q("q2", "b", { type: "score", score: ["Not urgent", "{\"x\":  1}"] })] },

  // ---------- Choice options ----------
  add_catch_all: { params: { key: "none_of_these" },
    input: [q("q1", "a", { type: "choice", choice: [["refund", "x"], ["other", ""], ["", ""]] }), q("q2", "b", { type: "choice", choice: [["none_of_these", ""], ["a", ""]] }),
      q("q3", "c"), q("q4", "d", { type: "choice" })],
    output: [q("q1", "a", { type: "choice", choice: [["refund", "x"], ["other", ""], ["none_of_these", ""], ["", ""]] }),
      q("q2", "b", { type: "choice", choice: [["none_of_these", ""], ["a", ""]] }), q("q3", "c"), q("q4", "d", { type: "choice" })],
    rejects: [{ params: { key: "  " }, message: /Option key is required/ }] },
  snake_case_keys: {
    input: [q("q1", "a", { type: "choice", choice: [["Where Is Order", "x"], ["refund", ""]] })],
    output: [q("q1", "a", { type: "choice", choice: [["where_is_order", "x"], ["refund", ""]] })],
    rejects: [{ input: [q("q1", "a", { type: "choice", choice: [["Refund", "a"]], expectation: { choice: "Refund" } })], message: /expects “Refund”/ },
      { input: [q("q1", "a", { type: "choice", choice: [["Order Status", ""], ["order_status", ""]] })], message: /option “order_status” twice/ }] },
  name_unnamed_options: {
    input: [q("q1", "a", { type: "choice", choice: [["", "Wants money back today"], ["wants_money_back", ""], ["", "Wants money back now"], ["", ""]] })],
    output: [q("q1", "a", { type: "choice", choice: [["wants_money_back_2", "Wants money back today"], ["wants_money_back", ""], ["wants_money_back_3", "Wants money back now"], ["", ""]] })] },
  sort_options_by_key: {
    input: [q("q1", "a", { type: "choice", choice: [["where", "b"], ["", "unnamed"], ["refund", "a"], ["Other", "c"]] })],
    output: [q("q1", "a", { type: "choice", choice: [["Other", "c"], ["", "unnamed"], ["refund", "a"], ["where", "b"]] })] },
  copy_options: { params: { source: "intent" },
    input: [q("q1", "intent", { type: "choice", choice: [["refund", "Money back"], ["other", ""]] }), q("q2", "tone", { type: "choice", choice: [["calm", "x"]] }),
      q("q3", "angry"), q("q4", "sentiment", { type: "choice", choice: [["x", ""]], expectation: { choice: "other" } })],
    output: [q("q1", "intent", { type: "choice", choice: [["refund", "Money back"], ["other", ""]] }), q("q2", "tone", { type: "choice", choice: [["refund", "Money back"], ["other", ""]] }),
      q("q3", "angry"), q("q4", "sentiment", { type: "choice", choice: [["refund", "Money back"], ["other", ""]], expectation: { choice: "other" } })],
    rejects: [{ params: { source: "angry" }, message: /No Choice question with options has the id “angry”/ },
      { input: [q("q1", "intent", { type: "choice", choice: [["refund", ""]] }), q("q2", "t", { type: "choice", choice: [["calm", ""]], expectation: { choice: "calm" } })],
        params: { source: "intent" }, message: /expects “calm”/ }] },
  remove_blank_criteria: {
    input: [q("q1", "a", { type: "choice", choice: [["a", "x"], ["", ""], ["", "desc"], ["", ""]] }), q("q2", "b", { type: "score", score: ["Low", "", "High", ""] }), q("q3", "c")],
    output: [q("q1", "a", { type: "choice", choice: [["a", "x"], ["", "desc"]] }), q("q2", "b", { type: "score", score: ["Low", "High"] }), q("q3", "c")] },

  // ---------- conversions ----------
  noul_to_choice: { params: { yesKey: "yes", noKey: "no" },
    input: [q("q1", "angry", { instructions: "Angry?", noulYes: "Angry words", noulNo: "Calm words" }), q("q2", "tone", { type: "choice", choice: [["calm", ""]] })],
    output: [q("q1", "angry", { type: "choice", instructions: "Angry?", choice: [["yes", "Angry words"], ["no", "Calm words"]] }), q("q2", "tone", { type: "choice", choice: [["calm", ""]] })],
    rejects: [{ params: { yesKey: "a", noKey: "a" }, message: /two different keys/ },
      { input: [q("q1", "angry", { expectation: { max: 0.5 } })], params: { yesKey: "yes", noKey: "no" }, message: /has a human expectation/ }] },
  choice_to_noul: { params: { yesKey: "yes" },
    input: [q("q1", "a", { type: "choice", choice: [["yes", "Angry"], ["no", "Calm"], ["", ""]] }), q("q2", "b", { type: "choice", choice: [["yes", ""], ["no", ""], ["maybe", ""]] }),
      q("q3", "c", { type: "choice", choice: [["a", ""], ["b", ""]] })],
    output: [q("q1", "a", { noulYes: "Angry", noulNo: "Calm" }), q("q2", "b", { type: "choice", choice: [["yes", ""], ["no", ""], ["maybe", ""]] }),
      q("q3", "c", { type: "choice", choice: [["a", ""], ["b", ""]] })],
    rejects: [{ input: [q("q1", "a", { type: "choice", choice: [["no", "Calm"], ["yes", "Angry"]], expectation: { choice: "yes" } })], params: { yesKey: "yes" },
      message: /has a human expectation/ }] },

  // ---------- order ----------
  sort_by_id: { params: { direction: "asc" }, input: ids("tone", "", "angry", "intent"), shown: [0, 1, 3],
    output: [q("q4", "intent"), q("q1", "tone"), q("q3", "angry"), q("q2", "")] },
  group_by_type: {
    input: [q("q1", "a"), q("q2", "b", { type: "choice" }), q("q3", "c"), q("q4", "d", { type: "score" }), q("q5", "e", { type: "choice" })],
    output: [q("q1", "a"), q("q3", "c"), q("q2", "b", { type: "choice" }), q("q5", "e", { type: "choice" }), q("q4", "d", { type: "score" })] },
  reverse_shown: { input: ids("a", "b", "c", "d"), shown: [0, 2, 3], output: [q("q4", "d"), q("q2", "b"), q("q3", "c"), q("q1", "a")] },
  order_by_list: { params: { ids: "c, a" }, input: ids("a", "b", "c", "d"), output: [q("q3", "c"), q("q1", "a"), q("q2", "b"), q("q4", "d")],
    rejects: [{ params: { ids: "zzz" }, message: /No shown question has the id “zzz”/ }, { params: { ids: "a\na" }, message: /listed twice/ },
      { input: ids("a", "a", "b"), params: { ids: "a" }, message: /Two shown questions have the id “a”/ }] },

  // ---------- split and merge ----------
  split_questions: {
    input: [q("q1", "check", { type: "choice", instructions: "Is it late? Is it paid? Thanks.", choice: [["a", "x"]], expectation: { choice: "a" } }),
      q("q2", "solo", { instructions: "Is it \"late?\" now?" })],
    output: [q("q1", "check", { type: "choice", instructions: "Is it late?", choice: [["a", "x"]], expectation: { choice: "a" } }),
      { id: "check_2", type: "choice", instructions: "Is it paid? Thanks.", choice: [["a", "x"]], score: BLANK_SCORE, noulYes: "", noulNo: "", expectation: null },
      q("q2", "solo", { instructions: "Is it \"late?\" now?" })],
    unchanged: [q("q1", "one", { instructions: "Is it late? `a?b`" })] },
  remove_duplicates: {
    input: [q("q1", "a", { instructions: "Is it late?" }), q("q2", "b", { instructions: " Is it late? " }), q("q3", "c", { type: "choice", instructions: "Is it late?" }),
      q("q4", "", { instructions: "Is it late?" })],
    output: [q("q1", "a", { instructions: "Is it late?" }), q("q3", "c", { type: "choice", instructions: "Is it late?" }), q("q4", "", { instructions: "Is it late?" })],
    rejects: [{ input: [q("q1", "a", { instructions: "x" }), q("q2", "b", { instructions: "x", expectation: { min: 0.5 } })], message: /has a human expectation/ }] },

  // ---------- importers ----------
  csv_questions: { ctx: fakeCtx({ items: [{ id: "angry" }] }),
    text: [
      "id,type,instructions,criteria,notes",
      "intent,choice,\"What does the customer want?\",\"refund: Wants money back\nother\",x",
      "urgency,score,How urgent?,0: Not urgent | 1. Soon | Right now,",
      "angry,noul,Is the customer angry?,yes: Uses angry words | no: Polite,",
      "mug,box,The mug in `photo`.,,",
    ].join("\r\n"),
    items: [row("intent", "choice", { instructions: "What does the customer want?", choice: [["refund", "Wants money back"], ["other", ""]] }),
      row("urgency", "score", { instructions: "How urgent?", score: ["Not urgent", "Soon", "Right now"] }),
      row("angry", "noul", { instructions: "Is the customer angry?", noulYes: "Uses angry words", noulNo: "Polite" }),
      row("mug", "box", { instructions: "The mug in `photo`." })],
    warnings: 2,  // the notes column, and "angry" already in the editor
    rejects: ["id,type\nx,noul", "id,type,instructions\nx,ranking,hi", "id,type,instructions\nx,box,hi\nx,noul,there",
      "id,type,instructions,criteria\nb,box,hi,something", "id,type,instructions\n,noul,hi", "just one line"] },
  markdown_list: {
    text: ["# My questions", "- intent (choice): What does the customer want?", "  - refund: Wants money back", "  - `other`",
      "- urgency (score): How urgent?", "  - 0: Not urgent", "  - Soon", "- angry (noul): Is the customer angry?", "    * yes: Angry words",
      "  - no: Polite words", "", "1. mug_box (box): The mug in `photo`."].join("\n"),
    items: [row("intent", "choice", { instructions: "What does the customer want?", choice: [["refund", "Wants money back"], ["other", ""]] }),
      row("urgency", "score", { instructions: "How urgent?", score: ["Not urgent", "Soon"] }),
      row("angry", "noul", { instructions: "Is the customer angry?", noulYes: "Angry words", noulNo: "Polite words" }),
      row("mug_box", "box", { instructions: "The mug in `photo`." })],
    warnings: 1,  // the heading line
    rejects: ["  - refund: x", "- x (noul): hi\n  - maybe: y", "nothing here", "- x (box): hi\n  - a: b"] },
  json_lines: {
    text: [
      "{\"id\":\"intent\",\"type\":\"choice\",\"instructions\":\"What?\",\"criteria\":{\"refund\":\"Money back\",\"other\":null}}",
      "",
      "{\"id\":\"shape\",\"type\":\"noul\",\"instructions\":{\"ask\":\"Late?\"},\"criteria\":{\"true\":\"Yes late\",\"false\":null}}",
      "{\"id\":\"lvl\",\"type\":\"score\",\"instructions\":\"How?\",\"criteria\":[\"Low\",\"High\"]}",
    ].join("\n"),
    items: [row("intent", "choice", { instructions: "What?", choice: [["refund", "Money back"], ["other", ""]] }),
      row("shape", "noul", { instructions: "{\"ask\":\"Late?\"}", noulYes: "Yes late" }), row("lvl", "score", { instructions: "How?", score: ["Low", "High"] })],
    warnings: 0,
    rejects: ["{\"id\":\"a\",\"type\":\"noul\"}\nnot json", "[{\"id\":\"a\",\"type\":\"noul\"},{\"id\":\"a\",\"type\":\"box\"}]", "{\"type\":\"noul\"}",
      "{\"id\":\"a\",\"id\":\"b\",\"type\":\"noul\"}", "[1]", "{\"id\":\"a\",\"type\":\"score\",\"criteria\":{\"0\":\"x\"}}"] },
  request_questions: {
    text: JSON.stringify({ request: { state: { ticket: "Charged twice" }, model: "jev-1.14", assets: {},
      questions: { tone: { type: "choice", instructions: "Tone?", criteria: { calm: "Calm", upset: null } }, box1: { type: "box", instructions: "Mug" } } } }),
    items: [row("tone", "choice", { instructions: "Tone?", choice: [["calm", "Calm"], ["upset", ""]] }), row("box1", "box", { instructions: "Mug" })],
    warnings: 1,
    rejects: ["{\"state\": \"x\"}", "[1]", "{\"questions\": {\"a\": {\"type\": \"ranking\"}}}", "not json"] },
  curl_questions: { text: curl, items: [row("angry", "noul", { instructions: "Angry?" })], warnings: 1,
    rejects: ["curl https://api.typesafe.ai/v1/systemone", "-d @- <<'EOF'\n{\"state\": 1}\nEOF\n"] },
  editor_markdown: { text: editorQuestionsMarkdown(markdownRows),
    items: [row("intent", "choice", { instructions: "What does the customer in `ticket.body` want?\n```\nfenced\n```", choice: [["refund", "Wants money back"]] }),
      row("lvl", "score", { instructions: "How urgent?", score: ["Low", "High"] }), row("angry", "noul", { instructions: "Angry?", noulYes: "Angry words" }),
      row("mug", "box", { instructions: "Mug in `photo`." })],
    warnings: 0,
    rejects: ["## Question 1\n\nType: noul\n", "no sections", "## Question 1\n\nID\n```\nx\n", "## Question 1\n\nID\n```\nx\n```\n\nType: score\n\nCriteria\n```\n{\"a\": 1}\n```\n"] },
}, { ctx: () => sampleBuildQuestionsCtx() });

test("build-question-edits: renames on the real surface keep expectations with their question", () => {
  const ctx = sampleBuildQuestionsCtx({ hide: [] });
  const items = ctx.items().map((item) => JSON.parse(JSON.stringify(item)));
  const feature = pack.features.find((entry) => entry.id === "add_id_suffix");
  const preview = previewTransform("k", feature, items, new Set([0]), { suffix: "_v2" }, ctx);
  ctx.actions.replaceItems(preview.next, { label: "Add a suffix" });
  assert.equal(ctx.page.rows[0].id, "intent_v2");
  assert.deepEqual(ctx.page.expect.intent_v2, { choice: "refund" });
  assert.equal(ctx.page.expect.intent, undefined);
});

test("build-question-edits: imported rows pass the surface's import guard", () => {
  const ctx = sampleBuildQuestionsCtx();
  const feature = pack.features.find((entry) => entry.id === "markdown_list");
  const { items } = feature.parse("- late (noul): Is the order late?\n  - yes: Past the promised date", ctx);
  ctx.actions.importItems(items, { label: "Import" });
  assert.equal(ctx.page.rows.length, 8);
  assert.deepEqual(ctx.page.rows[7], { id: "late", type: "noul", instructions: "Is the order late?", choice: BLANK_CHOICE, score: BLANK_SCORE, noulYes: "Past the promised date", noulNo: "" });
});
