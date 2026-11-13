// Starter pack for the Compare variant editors (surface "workbench.compare.variants"; contract in
// static/js/lab/surfaces/workbench-compare.js): what changes between A's and B's questions before a run is paid for.
// Pure: it reads the authored questions through ctx, edits them only through previewed transforms, and calls no model.
import { compareText, definePack, toNumber } from "../../kit.js";
import { deepEqual } from "../../lib/json.js";
import { formatMarkdownTable } from "../../lib/tables.js";
import { codePoints } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const both = (item) => isObject(item.a) && isObject(item.b);
const typeOf = (question) => (isObject(question) && typeof question.type === "string" ? question.type : "?");

// jev/compare.py reordered(): the same Choice instructions and options, listed in another order.
function reordered(a, b) {
  return isObject(a) && isObject(b) && a.type === "choice" && b.type === "choice" && isObject(a.criteria) && isObject(b.criteria)
    && deepEqual(a.criteria, b.criteria) && Object.keys(a.criteria).join("\u0000") !== Object.keys(b.criteria).join("\u0000")
    && deepEqual(a.instructions, b.instructions);
}

function status(item) {
  if (isObject(item.a) && !isObject(item.b)) return "only A";
  if (isObject(item.b) && !isObject(item.a)) return "only B";
  if (!both(item)) return null;
  if (item.a.type !== item.b.type) return "retyped";
  if (JSON.stringify(item.a) === JSON.stringify(item.b)) return "identical";
  if (reordered(item.a, item.b)) return "options reordered";
  if (!deepEqual(item.a.criteria, item.b.criteria)) return "options changed";
  if (!deepEqual(item.a.instructions, item.b.instructions)) return "reworded";
  return "other fields changed";
}

function optionCount(question) {
  if (!isObject(question)) return null;
  if (question.type === "choice" && isObject(question.criteria)) return Object.keys(question.criteria).length;
  if (question.type === "score" && Array.isArray(question.criteria)) return question.criteria.length;
  return null;
}

// The model a variant asks: its field, or the current model when the field is blank.
const modelOf = (variant, ctx) => (variant?.model ? variant.model.trim() : ctx.data.current_model || "");

export default definePack({
  id: "wb-compare-variants",
  surface: "workbench.compare.variants",
  title: "Compare variant setup",
  about: "Facts, checks and previewed edits on the questions typed into Compare's variants A and B, before a run is paid for. Its exports hold authored questions and settings only, never rows or answers.",
  features: [
    { id: "instruction_char_delta", kind: "fact", type: "number", label: "instruction length change from A to B", unit: "characters",
      help: "B's instruction characters minus A's; unavailable unless both ask the question with text instructions.",
      value: (item) => (both(item) && typeof item.a.instructions === "string" && typeof item.b.instructions === "string"
        ? codePoints(item.b.instructions) - codePoints(item.a.instructions) : null) },
    { id: "option_count_a", kind: "fact", type: "number", label: "options or levels in A", help: "Choice options or Score levels A lists.",
      value: (item) => optionCount(item.a) },
    { id: "position_shift", kind: "fact", type: "number", label: "position change from A to B", help: "B's place in its list minus A's; 0 when both list it at the same place.",
      value: (item) => (Number.isInteger(item.ia) && Number.isInteger(item.ib) ? item.ib - item.ia : null) },
    { id: "only_in_a", kind: "fact", type: "flag", label: "asked only by A", value: (item) => isObject(item.a) && !isObject(item.b) },
    { id: "only_in_b", kind: "fact", type: "flag", label: "asked only by B", value: (item) => isObject(item.b) && !isObject(item.a) },
    { id: "type_mismatch", kind: "fact", type: "flag", label: "a type change", help: "Same id, different type: a run does not compare it.",
      value: (item) => both(item) && item.a.type !== item.b.type },
    { id: "instructions_changed", kind: "fact", type: "flag", label: "reworded instructions",
      value: (item) => both(item) && !deepEqual(item.a.instructions, item.b.instructions) },
    { id: "criteria_changed", kind: "fact", type: "flag", label: "changed options or levels", help: "Options, descriptions or levels differ. A change of order alone does not count.",
      value: (item) => both(item) && !deepEqual(item.a.criteria, item.b.criteria) },
    { id: "order_only", kind: "fact", type: "flag", label: "options reordered", help: "The same Choice instructions and options in another order, as the order check means it.",
      value: (item) => reordered(item.a, item.b) },
    { id: "status", kind: "fact", type: "category", label: "change from A to B", value: status },
    { id: "qid", kind: "fact", type: "text", label: "question id", value: (item) => item.qid },

    { id: "no_comparable", kind: "diagnostic", severity: "problem", scope: "list", label: "Nothing to compare",
      check: (items) => (items.length && !items.some((item) => item.comparable)
        ? "A and B share no question id with the same type, so a run would pay for answers and compare none. Use the same ids in both." : null) },
    { id: "two_changes", kind: "diagnostic", severity: "advice", scope: "list", label: "Two changes at once",
      check: (items, ctx) => {
        const [a, b] = ctx.data.variants;
        const models = [modelOf(a, ctx), modelOf(b, ctx)];
        const reworded = items.filter((item) => item.comparable && JSON.stringify(item.a) !== JSON.stringify(item.b)).map((item) => item.qid);
        return models[0] !== models[1] && reworded.length
          ? `The model (${models[0] || "current"} against ${models[1] || "current"}) and ${reworded.length} question${reworded.length === 1 ? "" : "s"} (${reworded.join(", ")}) differ, so a changed result cannot be traced to either. Change one thing per run.`
          : null;
      } },
    { id: "blank_instructions", kind: "diagnostic", severity: "advice", label: "Blank instructions",
      check: (item) => [["A", item.a], ["B", item.b]].flatMap(([name, question]) => (isObject(question)
        && (question.instructions === undefined || (typeof question.instructions === "string" && !question.instructions.trim()))
        ? [`${name}'s “${item.qid}” has no instructions, so the model sees only its id.`] : [])) },

    { id: "copy_wording_to_b", kind: "transform", label: "Use A's instructions in B",
      help: "For the shown questions both variants ask with the same type, B gets A's instructions; its options stay as they are.",
      each: (item) => (both(item) && item.a.type === item.b.type && !deepEqual(item.a.instructions, item.b.instructions)
        ? { ...item, b: { ...item.b, instructions: item.a.instructions } } : null) },
    { id: "drop_only_b", kind: "transform", label: "Drop the shown questions only B asks",
      all: (items, _params, _ctx, shown) => items.filter((item, index) => !(shown.has(index) && isObject(item.b) && !isObject(item.a))) },
    { id: "sort_a_by_id", kind: "transform", label: "Sort A's questions by id", help: "B keeps its own order. Whole-number ids always list first.",
      all: (items) => [...items].sort((x, y) => compareText(x.qid, y.qid)) },

    { id: "questions_to_b", kind: "importer", label: "Questions JSON to add to B",
      help: "An object keyed by question id, as in the editor. Ids already in A or B are refused.",
      parse: (text) => {
        let parsed;
        try { parsed = JSON.parse(text); } catch (error) { throw new Error(`That is not JSON (${error.message}).`); }
        if (!isObject(parsed) || !Object.keys(parsed).length) throw new Error("Paste an object keyed by question id.");
        const warnings = [];
        const items = Object.entries(parsed).map(([qid, question]) => {
          if (!qid.trim()) throw new Error("Every question needs a nonblank id.");
          if (!isObject(question) || !TYPES.includes(question.type)) throw new Error(`“${qid}” needs a type of noul, choice, score or box.`);
          if (question.instructions === undefined) warnings.push(`“${qid}” has no instructions.`);
          return { qid, a: null, b: question, ia: null, ib: null, comparable: false };
        });
        return { items, warnings };
      } },

    { id: "diff_markdown", kind: "exporter", label: "Question differences as Markdown", filename: "compare-question-differences.md", mime: "text/markdown",
      help: "Ids, types and what changed for the shown questions; no instructions, rows or answers.",
      build: (ctx) => `${formatMarkdownTable(["question", "A", "B", "change"],
        ctx.shown().map((item) => [item.qid, isObject(item.a) ? typeOf(item.a) : "—", isObject(item.b) ? typeOf(item.b) : "—", status(item) || "—"]))}\n` },
    { id: "b_shown_json", kind: "exporter", label: "B's shown questions as JSON", filename: "variant-b-questions.json", mime: "application/json",
      help: "B's authored questions for the shown ids, in the shown order, ready to paste into an editor.",
      build: (ctx) => {
        const out = Object.create(null);
        for (const item of ctx.shown()) if (isObject(item.b)) out[item.qid] = item.b;
        return `${JSON.stringify(out, null, 2)}\n`;
      } },

    { id: "comparable_count", kind: "metric", format: "integer", label: "questions a run would compare",
      help: "Ids both variants ask with the same type.", compute: (ctx) => (ctx.items().length ? ctx.items().filter((item) => item.comparable).length : null) },
    { id: "one_sided_count", kind: "metric", format: "integer", label: "questions only one variant asks",
      help: "They are answered and paid for, but never compared.",
      compute: (ctx) => (ctx.items().length ? ctx.items().filter((item) => isObject(item.a) !== isObject(item.b)).length : null) },

    { id: "order_check", kind: "command", title: "Make B an order check of A", group: "Compare",
      when: (ctx) => !ctx.data.running && toNumber(ctx.data.variants[0]?.count) > 0,
      run: (ctx) => ctx.actions.reverseA() },
  ],
});
