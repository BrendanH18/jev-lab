// Tests for the Compare setup panels (static/js/lab/packs/workbench/compare-variant-panels.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs (QUESTIONS_A, QUESTIONS_B) or from the small
// question sets below; comments give the reasoning where it is not obvious.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/compare-variant-panels.js";
import { checkPack } from "./harness.mjs";
import { QUESTIONS_A, sampleCompareVariantsCtx } from "./fixtures/workbench-compare.mjs";

const ctx = (overrides) => sampleCompareVariantsCtx(overrides);
const pair = (a, b, more = {}) => ctx({ texts: [JSON.stringify(a), JSON.stringify(b)], ...more });
const textA = JSON.stringify(QUESTIONS_A, null, 2);
const noul = (instructions, criteria) => ({ type: "noul", instructions, ...(criteria ? { criteria } : {}) });
const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const cellsOf = (t, row) => row.children.map(t.textOf);
const rowsBy = (t, tree, name) => t.findAll(tree, (node) => node.tag === "tr" && node.attrs?.[name] !== undefined).map((row) => cellsOf(t, row));
const ops = (t, node) => t.findAll(node, has("data-op")).map((span) => [span.attrs["data-op"], t.textOf(span)]);
const pick = (t, tree, value) => t.fire(t.find(tree, attr("data-pick", "question")), "change", { target: { value } });
const toggle = (t, tree, name, checked = true) => t.fire(t.find(tree, attr("data-toggle", name)), "change", { target: { checked } });
const click = (t, tree, match) => t.fire(t.find(tree, match), "click");

// Fixture: A asks department, urgent, tone, drink, spot, rush, allergy; B asks urgent, department, tone, drink, spot,
// rush (as a Score), refund. B rewords department's instructions, changes tone's level 1, lists drink's options in
// reverse and leaves A's model blank (the current model, jev-latest) against B's jev-1.14.0.
const DIFFERENCES = [
  ["department", "at another position, instructions reworded"], ["urgent", "at another position"], ["tone", "levels changed"],
  ["drink", "options reordered"], ["spot", "no change"], ["rush", "type changed"], ["allergy", "only A"], ["refund", "only B"],
];
const LINES = [
  "Models differ: A uses “jev-latest” (the current model), B uses “jev-1.14.0”",
  "Only A asks 1 question: allergy",
  "Only B asks 1 question: refund",
  "Type changed, so a run does not compare it: rush",
  "Instructions reworded: department",
  "Options or levels changed: tone",
  "Options listed in another order: drink",
  // Shared ids in B's order with A's positions: urgent 1, department 0, tone 2, drink 3, spot 4, rush 5. One longest
  // run in A's order has 5 ids; the earliest-starting one keeps urgent, so department moves.
  "B asks shared questions in another order; to match A, move: department",
];

checkPack(pack, {
  question_diff: { improvements: {
    table: (t) => {
      const rows = rowsBy(t, t.render(ctx()), "data-differences").map((row) => row.slice(0, 3));
      assert.deepEqual(rows, [["department", "1 · choice", "2 · choice"], ["urgent", "2 · noul", "1 · noul"], ["tone", "3 · score", "3 · score"],
        ["drink", "4 · choice", "4 · choice"], ["spot", "5 · box", "5 · box"], ["rush", "6 · noul", "6 · score"], ["allergy", "7 · noul", "—"], ["refund", "—", "7 · noul"]]);
      assert.match(t.textOf(t.render(ctx({ texts: ["{}", "{}"] }))), /Neither variant has questions/);
    },
    differences: (t) => {
      const rows = rowsBy(t, t.render(ctx()), "data-differences").map((row) => [row[0], row[3]]);
      assert.deepEqual(rows, DIFFERENCES);
      // An extra field ("examples") counts as another field changed.
      const extra = pair({ q: { ...noul("Q?"), examples: ["one"] } }, { q: { ...noul("Q?"), examples: ["two"] } });
      assert.deepEqual(rowsBy(t, t.render(extra), "data-differences").map((row) => row[3]), ["other fields changed"]);
    },
    shown_only: (t) => {
      const c = ctx({ hide: ["spot", "allergy"] });
      assert.equal(rowsBy(t, t.render(c), "data-differences").length, 8);
      toggle(t, t.render(c), "shown");
      const tree = t.render(c);
      assert.deepEqual(rowsBy(t, tree, "data-differences").map((row) => row[0]), ["department", "urgent", "tone", "drink", "rush", "refund"]);
      assert.match(t.textOf(tree), /6 of 8 questions shown\. A run still sends every question\./);
    },
    copy: (t) => {
      click(t, t.render(ctx()), attr("data-copy", "questions"));
      assert.deepEqual(t.env.copied, ["Question\tA position\tA type\tB position\tB type\tDifferences\n"
        + "department\t1\tchoice\t2\tchoice\tat another position, instructions reworded\nurgent\t2\tnoul\t1\tnoul\tat another position\n"
        + "tone\t3\tscore\t3\tscore\tlevels changed\ndrink\t4\tchoice\t4\tchoice\toptions reordered\nspot\t5\tbox\t5\tbox\tno change\n"
        + "rush\t6\tnoul\t6\tscore\ttype changed\nallergy\t7\tnoul\t\t\tonly A\nrefund\t\t\t7\tnoul\tonly B"]);
    },
  } },

  wording_diff: { improvements: {
    word_diff: (t) => {
      let tree = t.render(ctx());
      // Asked by both: department, urgent, tone, drink, spot, rush; only department is reworded, so it opens first.
      assert.deepEqual(t.findAll(tree, (node) => node.tag === "option").map(t.textOf), ["department · reworded", "urgent", "tone", "drink", "spot", "rush"]);
      assert.equal(t.textOf(t.find(tree, attr("data-side", "A"))), "A: Which Harbor Coffee Co. team should handle this message?");
      assert.equal(t.textOf(t.find(tree, attr("data-side", "B"))), "B: Team for this message?");
      pick(t, tree, "urgent");
      tree = t.render(ctx());
      assert.equal(t.find(tree, has("data-qid")).attrs["data-qid"], "urgent");
      assert.ok(t.find(tree, attr("data-same", "true")));
      assert.match(t.textOf(t.render(ctx({ texts: [JSON.stringify({ p: noul("P?") }), JSON.stringify({ q: noul("Q?") })] }))), /No question is asked by both/);
      // department again. A's 9 words against B's 4: the longest common run is "this message?" (2 words); at a tie a
      // deletion comes first, so A's 7 leading words go before B's 2.
      tree = t.render(ctx({}));
      pick(t, tree, "department");
      assert.deepEqual(ops(t, t.find(t.render(ctx()), attr("data-diff", "words"))),
        [["del", "Which Harbor Coffee Co. team should handle"], ["add", "Team for"], ["same", "this message?"]]);
      // A word moved to the end: "late order now" -> "order now late": LCS "order now", so "late" is removed then added.
      const moved = pair({ q: noul("late order now") }, { q: noul("order now late") });
      assert.deepEqual(ops(t, t.find(t.render(moved), attr("data-diff", "words"))), [["del", "late"], ["same", "order now"], ["add", "late"]]);
    },
    ignore_case: (t) => {
      toggle(t, t.render(ctx()), "ignore");
      // Matching lower-cased words without end punctuation, "team" now matches "Team": common run team, this, message.
      const tree = t.render(ctx());
      assert.deepEqual(ops(t, t.find(tree, attr("data-diff", "words"))),
        [["del", "Which Harbor Coffee Co."], ["same", "Team"], ["del", "should handle"], ["add", "for"], ["same", "this message?"]]);
      assert.match(t.textOf(t.find(tree, has("data-stats"))), /6 removed, 1 added \(ignoring case and punctuation\)/);
      // Punctuation at a word's end is ignored, punctuation inside a word is not: "late?" = "late", "e-mail" ≠ "email".
      const c = pair({ q: noul("Is the e-mail late?") }, { q: noul("is the email late") });
      t.state.qid = "q";
      assert.deepEqual(ops(t, t.find(t.render(c), attr("data-diff", "words"))), [["same", "is the"], ["del", "e-mail"], ["add", "email"], ["same", "late"]]);
    },
    stats: (t) => {
      const items = (tree) => t.findAll(t.find(tree, has("data-stats")), (node) => node.tag === "li").map(t.textOf);
      assert.deepEqual(items(t.render(ctx())).slice(0, 2), ["Words: 9 in A, 4 in B", "7 removed, 2 added"]);
      // "the" -> "this": substitute e by i and insert s, 2 character edits.
      assert.deepEqual(items(t.render(pair({ late: noul("Is the order late?") }, { late: noul("Is this order late?") }))),
        ["Words: 4 in A, 4 in B", "1 removed, 1 added", "2 character edits"]);
    },
    minor_only: (t) => {
      const minor = pair({ late: noul("Is the order late?") }, { late: noul("is the order  late") });
      assert.ok(t.find(t.render(minor), attr("data-minor", "true")));
      assert.equal(t.find(t.render(ctx()), has("data-minor")), null);
    },
    step: (t) => {
      const c = pair({ p: noul("P?"), q: noul("Q?"), r: noul("R?") }, { p: noul("P now?"), q: noul("Q?"), r: noul("R now?") });
      let tree = t.render(c);
      assert.equal(t.find(tree, has("data-qid")).attrs["data-qid"], "p");
      assert.equal(t.find(tree, attr("data-step", "previous")).attrs.disabled, true);
      click(t, tree, attr("data-step", "next"));
      tree = t.render(c);
      assert.equal(t.find(tree, has("data-qid")).attrs["data-qid"], "r");  // q is not reworded, so it is skipped
      assert.equal(t.find(tree, attr("data-step", "next")).attrs.disabled, true);
      click(t, tree, attr("data-step", "previous"));
      assert.equal(t.find(t.render(c), has("data-qid")).attrs["data-qid"], "p");
    },
    copy: (t) => {
      click(t, t.render(ctx()), attr("data-copy", "wording"));
      assert.deepEqual(t.env.copied, ["department: [-Which Harbor Coffee Co. team should handle-] {+Team for+} this message?"]);
    },
  } },

  criteria_table: { improvements: {
    choice_table: (t) => {
      let tree = t.render(ctx());
      assert.deepEqual(t.findAll(tree, (node) => node.tag === "option").map(t.textOf),
        ["department · choice", "urgent · noul", "tone · score · changed", "drink · choice · changed"]);
      assert.match(t.textOf(tree), /Left out because the type changes: rush\./);
      pick(t, tree, "drink");
      tree = t.render(ctx());
      assert.deepEqual(rowsBy(t, tree, "data-key"), [["espresso", "1", "Espresso drinks", "3", "Espresso drinks", "moved down 2"],
        ["filter", "2", "Filter coffee", "2", "Filter coffee", "same"], ["tea", "3", "Tea", "1", "Tea", "moved up 2"]]);
      const dropped = pair({ team: { type: "choice", instructions: "Team?", criteria: { billing: "Money", other: "Else" } } },
        { team: { type: "choice", instructions: "Team?", criteria: { billing: "Money", gifts: "Gift cards" } } });
      assert.deepEqual(rowsBy(t, t.render(dropped), "data-key").map((row) => [row[0], row[5]]), [["billing", "same"], ["other", "only A"], ["gifts", "only B"]]);
    },
    description_diff: (t) => {
      const c = pair({ team: { type: "choice", instructions: "Team?", criteria: { billing: "Charges and refunds", other: "Else" } } },
        { team: { type: "choice", instructions: "Team?", criteria: { billing: "Charges, invoices and refunds", other: "Else" } } });
      const tree = t.render(c);
      // "Charges" and "Charges," are different words; the common run is "and refunds".
      assert.deepEqual(ops(t, t.find(tree, attr("data-description-diff", "billing"))),
        [["del", "Charges"], ["add", "Charges, invoices"], ["same", "and refunds"]]);
      assert.match(t.textOf(t.find(tree, attr("data-key", "billing"))), /reworded/);
      assert.equal(t.find(tree, attr("data-description-diff", "other")), null);
    },
    score_table: (t) => {
      const tree = t.render(ctx());  // tone opens first: the first question whose levels change
      assert.equal(t.find(tree, has("data-type")).attrs["data-type"], "score");
      assert.deepEqual(rowsBy(t, tree, "data-key"), [["0", "Calm", "Calm", "same"], ["1", "Annoyed", "A little annoyed", "changed"], ["2", "Angry", "Angry", "same"]]);
      assert.equal(t.find(tree, attr("data-note", "true")), null);
    },
    score_shift: (t) => {
      const none = t.render(pair({ tone: { type: "score", instructions: "How upset?", criteria: [] } }, { tone: { type: "score", instructions: "How upset?", criteria: ["Calm"] } }));
      assert.equal(t.textOf(t.find(none, attr("data-note", "true"))), "B adds 1 level at the end.");
      const score = (criteria) => ({ tone: { type: "score", instructions: "How upset?", criteria } });
      const removed = t.render(pair(score(["Calm", "Annoyed", "Angry"]), score(["Calm", "Angry"])));
      assert.equal(t.textOf(t.find(removed, attr("data-note", "true"))),
        "A has 3 levels and B has 2: from level 1 on, the same number names a different level, so compare Score answers by meaning, not by number.");
      const appended = t.render(pair(score(["Calm", "Annoyed", "Angry"]), score(["Calm", "Annoyed", "Angry", "Furious"])));
      assert.equal(t.textOf(t.find(appended, attr("data-note", "true"))), "B adds 1 level at the end; levels 0 to 2 keep their numbers.");
      assert.deepEqual(rowsBy(t, appended, "data-key").at(-1), ["3", "", "Furious", "only B"]);
    },
    noul_table: (t) => {
      const c = pair({ gift: noul("Gift?", { true: "A present", false: "Not a present" }) }, { gift: noul("Gift?", { true: "A gift", false: "Not a present" }) });
      assert.deepEqual(rowsBy(t, t.render(c), "data-key"), [["yes (true)", "A present", "A gift", "changed"], ["no (false)", "Not a present", "Not a present", "same"]]);
      const tree = t.render(ctx());
      pick(t, tree, "urgent");
      assert.match(t.textOf(t.render(ctx())), /Neither variant describes yes and no for this question\./);
    },
    copy: (t) => {
      t.state.qid = "drink";
      click(t, t.render(ctx()), attr("data-copy", "criteria"));
      assert.deepEqual(t.env.copied, ["Option\tA #\tA description\tB #\tB description\tStatus\nespresso\t1\tEspresso drinks\t3\tEspresso drinks\tmoved down 2\n"
        + "filter\t2\tFilter coffee\t2\tFilter coffee\tsame\ntea\t3\tTea\t1\tTea\tmoved up 2"]);
    },
  } },

  json_diff: { improvements: {
    lines: (t) => {
      let tree = t.render(ctx());
      // department differs only in its instructions line, so that line is removed and added; the other 9 lines stay.
      const steps = ops(t, t.find(tree, attr("data-diff", "json")));
      assert.deepEqual(steps.map(([op]) => op), ["same", "same", "del", "add", "same", "same", "same", "same", "same", "same", "same"]);
      assert.equal(steps[2][1], '-  "instructions": "Which Harbor Coffee Co. team should handle this message?",\n');
      assert.equal(steps[3][1], '+  "instructions": "Team for this message?",\n');
      pick(t, tree, "allergy");
      tree = t.render(ctx());
      assert.deepEqual(ops(t, t.find(tree, attr("data-diff", "json"))).map(([op]) => op), ["del", "del", "del", "del"]);
    },
    copy: (t) => {
      click(t, t.render(ctx()), attr("data-copy", "json"));
      assert.deepEqual(t.env.copied, [["--- A department", "+++ B department", " {", '   "type": "choice",',
        '-  "instructions": "Which Harbor Coffee Co. team should handle this message?",', '+  "instructions": "Team for this message?",',
        '   "criteria": {', '     "billing": "Charges, invoices and refunds",', '     "shipping": "Deliveries and tracking",',
        '     "wholesale": "Cafe and bulk orders",', '     "other": "Anything else"', "   }", " }"].join("\n")]);
    },
  } },

  order: { improvements: {
    fewest_moves: (t) => {
      assert.deepEqual(rowsBy(t, t.render(ctx()), "data-position"), [["1", "department", "urgent"], ["2", "urgent", "department (move)"],
        ["3", "tone", "tone"], ["4", "drink", "drink"], ["5", "spot", "spot"], ["6", "rush", "rush"], ["7", "allergy", "refund"]]);
      const verdict = (c) => t.find(t.render(c), has("data-moves"));
      assert.equal(t.textOf(verdict(ctx())), "B asks 6 shared questions; moving 1 question (department) puts them in A's order.");
      // B lists r, q, p: A's positions 2, 1, 0 decrease, so only one can stay; the earliest (r) stays.
      const reversed = pair({ p: noul("P?"), q: noul("Q?"), r: noul("R?") }, { r: noul("R?"), q: noul("Q?"), p: noul("P?") });
      assert.equal(t.textOf(verdict(reversed)), "B asks 3 shared questions; moving 2 questions (q, p) puts them in A's order.");
      const kept = pair({ p: noul("P?"), q: noul("Q?"), r: noul("R?") }, { p: noul("P?"), x: noul("X?"), r: noul("R?") });
      assert.equal(verdict(kept).attrs["data-moves"], "0");
      assert.equal(t.textOf(verdict(kept)), "B asks the 2 shared questions in A's order.");
      // A: a b c d e; B: d a b c e. Positions in A by B's order 3 0 1 2 4: the longest increasing run 0 1 2 4 keeps 4,
      // so d alone moves (not a, b and c, which a greedy "move everything out of place" would name).
      const one = pair({ a: noul("A?"), b: noul("B?"), c: noul("C?"), d: noul("D?"), e: noul("E?") },
        { d: noul("D?"), a: noul("A?"), b: noul("B?"), c: noul("C?"), e: noul("E?") });
      assert.equal(t.textOf(verdict(one)), "B asks 5 shared questions; moving 1 question (d) puts them in A's order.");
    },
  } },

  size: { improvements: {
    totals: (t) => {
      const c = pair({ late: noul("Is the order late?") },
        { late: { type: "choice", instructions: "Which delay?", criteria: { yes: "Late", no: "On time" } }, tone: { type: "score", instructions: "How upset?", criteria: ["Calm", "Angry"] } });
      // Compact JSON sizes from Python's json.dumps(separators=(",", ":")): 60 and 177 bytes. Options: 2 + 2 levels.
      // Instruction words: 4 against 2 + 2.
      assert.deepEqual(rowsBy(t, t.render(c), "data-total").map((row) => row.slice(1)), [["1", "2", "+1"], ["0", "4", "+4"], ["4", "4", "0"], ["60", "177", "+117"]]);
      const broken = t.render(ctx({ texts: [textA, "{"] }));
      assert.deepEqual(rowsBy(t, broken, "data-total")[0].slice(1), ["7", "editor error", ""]);
    },
    per_type: (t) => {
      // A: noul urgent, rush, allergy; choice department, drink; score tone; box spot. B: noul urgent, refund; score tone, rush.
      assert.deepEqual(rowsBy(t, t.render(ctx()), "data-type"), [["noul", "3", "2"], ["choice", "2", "2"], ["score", "1", "2"], ["box", "1", "1"]]);
    },
  } },

  checklist: { improvements: {
    items: (t) => {
      const lines = (tree) => t.findAll(tree, (node) => node.tag === "li" && node.attrs?.["data-key"]).map(t.textOf).map((text) => text.trim());
      assert.deepEqual(lines(t.render(ctx())), LINES);
      const settings = ctx({ models: ["jev-1.14.0", "jev-1.14.0"], perturb: "typos", average: true, texts: [textA, textA] });
      assert.deepEqual(lines(t.render(settings)), ["B's rows are rewritten: sent with typos", "B asks each Choice question in both option orders and averages them"]);
      assert.ok(t.find(t.render(ctx({ models: ["", ""], texts: [textA, textA] })), attr("data-nothing", "true")));
    },
    parse_errors: (t) => {
      const tree = t.render(ctx({ texts: [textA, "{"] }));
      assert.equal(t.find(tree, has("data-errors")).attrs["data-errors"], "1");
      assert.match(t.textOf(tree), /^Variant B: invalid JSON \(.+\)\. Fix variant B's editor before a run\.$/);
      // An editor that parses but holds no questions is named as it is, not as a parse error.
      assert.equal(t.textOf(t.render(ctx({ texts: ["", textA] }))), "Variant A has no questions. Fix variant A's editor before a run.");
      assert.equal(t.find(tree, has("data-tick")), null);
    },
    tick: (t) => {
      const c = ctx();
      const progress = () => t.find(t.render(c), has("data-progress"));
      t.fire(t.find(t.render(c), attr("data-tick", "model")), "change", { target: { checked: true } });
      assert.equal(progress().attrs["data-progress"], "1/8");
      assert.equal(t.textOf(progress()), "1 of 8 differences reviewed.");
      for (const key of ["only_a", "only_b", "retyped", "reworded", "criteria", "reordered", "order"]) {
        t.fire(t.find(t.render(c), attr("data-tick", key)), "change", { target: { checked: true } });
      }
      assert.equal(t.textOf(progress()), "All 8 differences reviewed.");
    },
    reset: (t) => {
      const c = ctx();
      t.fire(t.find(t.render(c), attr("data-tick", "reworded")), "change", { target: { checked: true } });
      assert.equal(t.find(t.render(c), has("data-progress")).attrs["data-progress"], "1/8");
      c.state.variants[1].model = "";  // both now use the current model: the model line goes and the ticks clear
      const tree = t.render(c);
      assert.equal(t.find(tree, has("data-progress")).attrs["data-progress"], "0/7");
      assert.equal(t.find(tree, attr("data-tick", "reworded")).attrs.checked, false);
      // Rewording department again changes no checklist line, but the setup is not the one reviewed: ticks clear.
      t.fire(t.find(t.render(c), attr("data-tick", "reworded")), "change", { target: { checked: true } });
      assert.equal(t.find(t.render(c), has("data-progress")).attrs["data-progress"], "1/7");
      c.state.variants[1].text = c.state.variants[1].text.replace("Team for this message?", "Team for this note?");
      assert.equal(t.find(t.render(c), has("data-progress")).attrs["data-progress"], "0/7");
      // Renders with nothing changed keep them.
      t.fire(t.find(t.render(c), attr("data-tick", "order")), "change", { target: { checked: true } });
      t.render(c);
      assert.equal(t.find(t.render(c), has("data-progress")).attrs["data-progress"], "1/7");
    },
    copy: (t) => {
      const c = ctx();
      t.fire(t.find(t.render(c), attr("data-tick", "model")), "change", { target: { checked: true } });
      click(t, t.render(c), attr("data-copy", "checklist"));
      assert.deepEqual(t.env.copied, [["# Compare setup checklist", "", `- [x] ${LINES[0]}`, ...LINES.slice(1).map((line) => `- [ ] ${line}`)].join("\n") + "\n"]);
    },
  } },
}, { ctx: () => ctx() });
