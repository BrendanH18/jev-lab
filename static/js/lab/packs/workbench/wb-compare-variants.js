// Starter pack for the Compare variant editors (surface "workbench.compare.variants"; contract in
// static/js/lab/surfaces/workbench-compare.js): what changes between A's and B's questions before a run is paid for.
// Pure: it reads the authored questions through ctx, edits them only through previewed transforms, and calls no model.
import { compareText, definePack } from "../../kit.js";
import { deepEqual, duplicateKeys } from "../../lib/json.js";
import { formatMarkdownTable } from "../../lib/tables.js";
import { codePoints } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const both = (item) => isObject(item) && isObject(item.a) && isObject(item.b);
const onlyA = (item) => isObject(item) && isObject(item.a) && !isObject(item.b);
const onlyB = (item) => isObject(item) && isObject(item.b) && !isObject(item.a);
const typeOf = (question) => (isObject(question) && typeof question.type === "string" ? question.type : "?");
const keyOrder = (criteria) => (isObject(criteria) ? Object.keys(criteria).join("\u0000") : null);

// jev/compare.py reordered(): the same Choice instructions and options, listed in another order.
function reordered(a, b) {
  return isObject(a) && isObject(b) && a.type === "choice" && b.type === "choice" && isObject(a.criteria) && isObject(b.criteria)
    && deepEqual(a.criteria, b.criteria) && keyOrder(a.criteria) !== keyOrder(b.criteria)
    && deepEqual(a.instructions, b.instructions);
}

function status(item) {
  if (onlyA(item)) return "only A";
  if (onlyB(item)) return "only B";
  if (!both(item)) return null;
  if (item.a.type !== item.b.type) return "retyped";
  if (JSON.stringify(item.a) === JSON.stringify(item.b)) return "identical";
  if (reordered(item.a, item.b)) return "options reordered";
  if (!deepEqual(item.a.criteria, item.b.criteria)) return "options changed";
  if (!deepEqual(item.a.instructions, item.b.instructions)) return "reworded";
  if (!deepEqual(item.a, item.b)) return "other fields changed";
  return "written in another order";
}

function optionCount(question) {
  if (!isObject(question)) return null;
  if (question.type === "choice" && isObject(question.criteria)) return Object.keys(question.criteria).length;
  if (question.type === "score" && Array.isArray(question.criteria)) return question.criteria.length;
  return null;
}

// The model a variant asks: its field, or the current model when the field is blank.
const modelOf = (variant, ctx) => (typeof variant?.model === "string" && variant.model.trim() ? variant.model.trim() : ctx.data.current_model || "");
const editorsParse = (ctx) => !Array.isArray(ctx?.data?.variants) || ctx.data.variants.every((variant) => !variant?.error);

// The list exactly as the surface rebuilds it after replaceItems: A's ids in list order, then the ids only B asks in
// B's order (ib, then list order), with dense positions and `comparable` recomputed. One-step Undo compares the
// rebuilt list with the preview, so list edits must return this shape.
function canonical(list) {
  const qa = Object.create(null), qb = Object.create(null);
  for (const item of list) if (isObject(item.a)) qa[item.qid] = item.a;
  const inB = list.map((item, order) => ({ item, order })).filter(({ item }) => isObject(item.b));
  inB.sort((x, y) => {
    const px = Number.isInteger(x.item.ib) ? x.item.ib : Infinity, py = Number.isInteger(y.item.ib) ? y.item.ib : Infinity;
    return px === py ? x.order - y.order : px - py;
  });
  for (const { item } of inB) qb[item.qid] = item.b;
  const aIds = Object.keys(qa), bIds = Object.keys(qb);
  const make = (qid) => {
    const a = hasOwn(qa, qid) ? qa[qid] : null, b = hasOwn(qb, qid) ? qb[qid] : null;
    return { qid, a, b, ia: a ? aIds.indexOf(qid) : null, ib: b ? bIds.indexOf(qid) : null, comparable: isObject(a) && isObject(b) && a.type === b.type };
  };
  return [...aIds.map(make), ...bIds.filter((qid) => !hasOwn(qa, qid)).map(make)];
}

// What the page's "Reverse A's options" needs (static/js/variants.js reverseOptions): a Choice question in A whose
// options list in another order when reversed (whole-number option names always list in ascending order).
const reversible = (question) => isObject(question) && question.type === "choice" && isObject(question.criteria)
  && keyOrder(Object.fromEntries(Object.entries(question.criteria).reverse())) !== keyOrder(question.criteria);

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
      value: (item) => optionCount(item?.a) },
    { id: "position_shift", kind: "fact", type: "number", label: "position change from A to B", help: "B's place in its list minus A's; 0 when both list it at the same place.",
      value: (item) => (Number.isInteger(item?.ia) && Number.isInteger(item?.ib) ? item.ib - item.ia : null) },
    { id: "only_in_a", kind: "fact", type: "flag", label: "asked only by A", value: onlyA },
    { id: "only_in_b", kind: "fact", type: "flag", label: "asked only by B", value: onlyB },
    { id: "type_mismatch", kind: "fact", type: "flag", label: "a type change", help: "Same id, different type: a run does not compare it.",
      value: (item) => both(item) && item.a.type !== item.b.type },
    { id: "instructions_changed", kind: "fact", type: "flag", label: "reworded instructions",
      value: (item) => both(item) && !deepEqual(item.a.instructions, item.b.instructions) },
    { id: "criteria_changed", kind: "fact", type: "flag", label: "changed options or levels", help: "Options, descriptions or levels differ. A change of order alone does not count.",
      value: (item) => both(item) && !deepEqual(item.a.criteria, item.b.criteria) },
    { id: "order_only", kind: "fact", type: "flag", label: "options reordered", help: "The same Choice instructions and options in another order, as the order check means it.",
      value: (item) => isObject(item) && reordered(item.a, item.b) },
    { id: "status", kind: "fact", type: "category", label: "change from A to B",
      help: "The first difference found: only one variant asks it, retyped, options reordered, options changed, reworded, other fields changed, the same fields written in another order, or identical.",
      value: status },
    { id: "qid", kind: "fact", type: "text", label: "question id", value: (item) => (typeof item?.qid === "string" ? item.qid : "") },

    { id: "no_comparable", kind: "diagnostic", severity: "problem", scope: "list", label: "Nothing to compare",
      help: "Reads every question, whatever is shown. Quiet while an editor's JSON does not parse: the editor shows its own error.",
      check: (shown, ctx) => {
        const items = typeof ctx?.items === "function" ? ctx.items() : shown;
        return items.length && editorsParse(ctx) && !items.some((item) => item?.comparable)
          ? "A and B share no question id with the same type, so a run would pay for answers and compare none. Use the same ids in both." : null;
      } },
    { id: "two_changes", kind: "diagnostic", severity: "advice", scope: "list", label: "Two changes at once",
      help: "The models differ and so does at least one compared question. Reads every question, whatever is shown.",
      check: (shown, ctx) => {
        const items = typeof ctx?.items === "function" ? ctx.items() : shown;
        const [a, b] = ctx.data.variants;
        const models = [modelOf(a, ctx), modelOf(b, ctx)];
        const reworded = items.filter((item) => item?.comparable && JSON.stringify(item.a) !== JSON.stringify(item.b)).map((item) => item.qid);
        return models[0] !== models[1] && reworded.length
          ? `The model (${models[0] || "current"} against ${models[1] || "current"}) and ${reworded.length} question${reworded.length === 1 ? "" : "s"} (${reworded.join(", ")}) differ, so a changed result cannot be traced to either. Change one thing per run.`
          : null;
      } },
    { id: "blank_instructions", kind: "diagnostic", severity: "advice", label: "Blank instructions",
      check: (item) => [["A", item?.a], ["B", item?.b]].flatMap(([name, question]) => (isObject(question)
        && (question.instructions === undefined || question.instructions === null || (typeof question.instructions === "string" && !question.instructions.trim()))
        ? [`${name}'s “${item.qid}” has no instructions, so the model sees only its id.`] : [])) },

    { id: "copy_wording_to_b", kind: "transform", label: "Use A's instructions in B",
      help: "For the shown questions both variants ask with the same type, B gets A's instructions; its options stay as they are.",
      each: (item) => (both(item) && item.a.type === item.b.type && !deepEqual(item.a.instructions, item.b.instructions)
        ? { ...item, b: { ...item.b, instructions: item.a.instructions } } : null) },
    { id: "drop_only_b", kind: "transform", label: "Drop the shown questions only B asks",
      all: (items, _params, _ctx, shown) => canonical(items.filter((item, index) => !(shown.has(index) && onlyB(item)))) },
    { id: "sort_a_by_id", kind: "transform", label: "Sort A's questions by id", help: "B keeps its own order. Whole-number ids always list first.",
      all: (items) => canonical([...items].sort((x, y) => compareText(String(x.qid), String(y.qid)))) },

    { id: "questions_to_b", kind: "importer", label: "Questions JSON to add to B",
      help: "An object keyed by question id, as in the editor. Ids already in A or B, and ids written twice, are refused.",
      parse: (text) => {
        let parsed;
        try { parsed = JSON.parse(text); } catch (error) { throw new Error(`That is not JSON (${error.message}).`); }
        if (!isObject(parsed) || !Object.keys(parsed).length) throw new Error("Paste an object keyed by question id.");
        const repeated = duplicateKeys(text) || [];
        if (repeated.length) throw new Error(`These keys are written twice, so one would be lost: ${repeated.join(", ")}.`);
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
      help: "B's authored questions for the shown ids, in the shown order, ready to paste into an editor. No rows or answers.",
      build: (ctx) => {
        const out = Object.create(null);
        for (const item of ctx.shown()) if (isObject(item.b)) out[item.qid] = item.b;
        return `${JSON.stringify(out, null, 2)}\n`;
      } },

    { id: "comparable_count", kind: "metric", format: "integer", label: "questions a run would compare",
      help: "Ids both variants ask with the same type. Unavailable while an editor's JSON does not parse.",
      compute: (ctx) => (ctx.items().length && editorsParse(ctx) ? ctx.items().filter((item) => item.comparable).length : null) },
    { id: "one_sided_count", kind: "metric", format: "integer", label: "questions only one variant asks",
      help: "They are answered and paid for, but never compared. Unavailable while an editor's JSON does not parse.",
      compute: (ctx) => (ctx.items().length && editorsParse(ctx) ? ctx.items().filter((item) => onlyA(item) || onlyB(item)).length : null) },

    { id: "order_check", kind: "command", title: "Make B an order check of A (replaces B)", group: "Compare",
      help: "The page's Reverse A's options: B becomes A's questions and model with each Choice question's options reversed, rows as written, asked once.",
      when: (ctx) => !ctx.data.running && !ctx.data.variants[0]?.error && ctx.items().some((item) => reversible(item.a)),
      run: (ctx) => ctx.actions.reverseA() },
  ],
});
