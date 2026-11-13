// Compare variant tools (surface "workbench.compare.variants"; contract in static/js/lab/surfaces/workbench-compare.js):
// facts that diff A's and B's questions, setup checks to read before paying for a run, previewed edits of B's
// questions, and importers that take questions from other sources. Pure: it reads the authored questions and settings
// through ctx, edits them only through previewed transforms (the surface's replaceItems), never starts a run and
// calls no model. The order and input check rules mirror jev/compare.py agreement().
import { compareText, definePack } from "../../kit.js";
import { deepEqual, duplicateKeys } from "../../lib/json.js";
import { shuffled } from "../../lib/math.js";
import { jaccard, utf8Bytes } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const both = (item) => isObject(item.a) && isObject(item.b);
const typeOf = (question) => (isObject(question) && typeof question.type === "string" ? question.type : "?");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const WHOLE = /^(?:0|[1-9]\d*)$/;
const VERSIONED = /\d+\.\d+/;

// "a, b and c", at most `max` names and then "and N more".
function names(list, max = 8) {
  const shown = list.slice(0, max).map((name) => `“${name}”`);
  const rest = list.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length < 2 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

const choiceCriteria = (question) => (isObject(question) && question.type === "choice" && isObject(question.criteria) ? question.criteria : null);

function optionCount(question) {
  if (!isObject(question)) return null;
  if (question.type === "choice" && isObject(question.criteria)) return Object.keys(question.criteria).length;
  if (question.type === "score" && Array.isArray(question.criteria)) return question.criteria.length;
  return null;
}

// Option keys of two Choice questions: [A only, B only, both], or null unless both are Choice questions with options.
function optionSplit(item) {
  const ca = choiceCriteria(item.a), cb = choiceCriteria(item.b);
  if (!ca || !cb) return null;
  const ka = Object.keys(ca), kb = Object.keys(cb);
  return [ka.filter((key) => !hasOwn(cb, key)), kb.filter((key) => !hasOwn(ca, key)), ka.filter((key) => hasOwn(cb, key))];
}

const instructionsText = (question) => (!isObject(question) || question.instructions === undefined || question.instructions === null ? ""
  : typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions));

// jev/compare.py reordered(): the same Choice instructions and options, listed in another order.
function reordered(a, b) {
  const ca = choiceCriteria(a), cb = choiceCriteria(b);
  return !!ca && !!cb && deepEqual(ca, cb) && Object.keys(ca).join("\u0000") !== Object.keys(cb).join("\u0000") && deepEqual(a.instructions, b.instructions);
}

// The model a variant asks: its field, or the current model when the field is blank (as the server resolves it).
const modelOf = (variant, ctx) => (typeof variant?.model === "string" && variant.model.trim() ? variant.model.trim() : ctx.data.current_model || "");
function setup(ctx) {
  const [a, b] = ctx.data.variants;
  return { models: [modelOf(a, ctx), modelOf(b, ctx)], perturb: typeof b?.perturb === "string" ? b.perturb : "", average: b?.average === true };
}
const modelName = (name) => (name ? `“${name}”` : "the current model");
// The whole request: a run sends every question whatever a filter hides, so the checks that classify a run (repeat,
// order check, input check, last run) read every item, not only the shown ones.
const whole = (items, ctx) => (typeof ctx?.items === "function" ? ctx.items() : items);
// Asked exactly alike: both variants ask it, in the same place, with the same JSON.
const sameRequest = (item) => both(item) && item.ia === item.ib && same(item.a, item.b);

// The list exactly as the surface rebuilds it after replaceItems: A's ids in list order, then the ids only B asks in
// B's order (ib, then list order), with dense positions and `comparable` recomputed. Undo needs this exact shape.
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

// B's questions placed in the order of `ordered` (items that B asks), then rebuilt.
function placeB(list, ordered) {
  const rank = new Map(ordered.map((item, index) => [item, index]));
  return canonical(list.map((item) => (rank.has(item) ? { ...item, ib: rank.get(item) } : item)));
}
const byB = (list) => list.filter((item) => isObject(item.b)).sort((x, y) => x.ib - y.ib);

// B's Choice options in a new order; null when the order would not change (whole-number names always list first).
function withOptions(item, entries) {
  const criteria = Object.fromEntries(entries);
  if (Object.keys(criteria).join("\u0000") === Object.keys(item.b.criteria).join("\u0000")) return null;
  return { ...item, b: { ...item.b, criteria } };
}
const optionEntries = (item) => {
  const criteria = choiceCriteria(item.b);
  return criteria && Object.keys(criteria).length > 1 ? Object.entries(criteria) : null;
};

// ---------- importers ----------

// A question map from pasted JSON: parsed with repeated keys refused, every question typed.
function questionMap(text) {
  try { JSON.parse(text); } catch (error) { throw new Error(`That is not JSON (${error.message}).`); }
  const repeated = duplicateKeys(text) || [];
  if (repeated.length) throw new Error(`The JSON repeats ${repeated.length === 1 ? "a key" : "keys"} (${repeated.slice(0, 3).join(", ")}). Keep each question and option key unique.`);
  return JSON.parse(text);
}

function questionItems(questions, side, label) {
  if (!isObject(questions) || !Object.keys(questions).length) throw new Error(`Paste ${label} with an object of questions keyed by id.`);
  const warnings = [];
  const items = Object.entries(questions).map(([qid, question]) => {
    if (!qid.trim()) throw new Error("Every question needs a nonblank id.");
    if (!isObject(question) || !TYPES.includes(question.type)) throw new Error(`“${qid}” needs a type of noul, choice, score or box.`);
    if (question.instructions === undefined) warnings.push(`“${qid}” has no instructions.`);
    const a = side === "b" ? null : question;
    const b = side === "a" ? null : JSON.parse(JSON.stringify(question));
    return { qid, a, b, ia: null, ib: null, comparable: isObject(a) && isObject(b) };
  });
  return { items, warnings };
}

export default definePack({
  id: "compare-variant-tools",
  surface: "workbench.compare.variants",
  title: "Compare variant diff and setup",
  about: "Facts that diff variant A's and B's questions, setup checks to read before paying for a run, previewed edits of B's questions with Undo, and importers that take questions from pasted JSON, a request or a Build draft. It reads authored questions and settings only, never rows, labels or answers, and never starts a run.",
  features: [
    // ---------- facts ----------
    { id: "option_count_b", kind: "fact", type: "number", label: "options or levels in B", help: "Choice options or Score levels B lists.",
      value: (item) => optionCount(item.b) },
    { id: "instruction_overlap", kind: "fact", type: "number", label: "instruction word overlap between A and B",
      help: "Shared words over all distinct words of the two instructions (0 to 1, case and end punctuation ignored); unavailable unless both ask it with text instructions.",
      value: (item) => (both(item) && typeof item.a.instructions === "string" && typeof item.b.instructions === "string" ? jaccard(item.a.instructions, item.b.instructions) : null) },
    { id: "options_dropped", kind: "fact", type: "number", label: "options A lists that B drops", help: "Choice option keys in A but not in B; a label naming one is left out of both sides.",
      value: (item) => optionSplit(item)?.[0].length ?? null },
    { id: "options_added", kind: "fact", type: "number", label: "options B adds", help: "Choice option keys in B but not in A; a label naming one is left out of both sides.",
      value: (item) => optionSplit(item)?.[1].length ?? null },
    { id: "descriptions_reworded", kind: "fact", type: "number", label: "option descriptions B rewords", help: "Options both list whose descriptions differ.",
      value: (item) => {
        const split = optionSplit(item);
        return split ? split[2].filter((key) => !deepEqual(item.a.criteria[key], item.b.criteria[key])).length : null;
      } },
    { id: "size_change", kind: "fact", type: "number", label: "question size change from A to B", unit: "bytes",
      help: "UTF-8 bytes of B's question JSON minus A's. A count of authored text, not a spend estimate.",
      value: (item) => (both(item) ? utf8Bytes(JSON.stringify(item.b)) - utf8Bytes(JSON.stringify(item.a)) : null) },
    { id: "whole_number_options", kind: "fact", type: "flag", label: "whole-number option names",
      help: "A Choice whose options are all named by whole numbers. The browser always lists them in ascending order, so option-order edits cannot move them.",
      value: (item) => [item.a, item.b].some((question) => {
        const keys = Object.keys(choiceCriteria(question) || {});
        return keys.length > 1 && keys.every((key) => WHOLE.test(key));
      }) },
    { id: "noul_criteria_one_side", kind: "fact", type: "flag", label: "yes/no criteria on one side only",
      help: "Both ask it as a Noul question, but only one spells out what yes and no mean.",
      value: (item) => both(item) && item.a.type === "noul" && item.b.type === "noul" && isObject(item.a.criteria) !== isObject(item.b.criteria) },
    { id: "renamed_option", kind: "fact", type: "flag", label: "a renamed option",
      help: "An option A lists keeps its description in B under a key A does not use, so labels with the old key no longer match.",
      value: (item) => {
        const split = optionSplit(item);
        if (!split) return false;
        const added = new Set(split[1].map((key) => item.b.criteria[key]).filter((text) => typeof text === "string" && text.trim()));
        return split[0].some((key) => added.has(item.a.criteria[key]));
      } },
    { id: "question_type", kind: "fact", type: "category", label: "question type", help: "Its type, or “A type → B type” when the two variants ask it as different types.",
      value: (item) => (both(item) && item.a.type !== item.b.type ? `${typeOf(item.a)} → ${typeOf(item.b)}` : isObject(item.a) ? typeOf(item.a) : isObject(item.b) ? typeOf(item.b) : null) },
    { id: "instructions", kind: "fact", type: "text", label: "instructions", help: "A's instructions, then B's when they differ, joined by “ | ”.",
      value: (item) => [...new Set([instructionsText(item.a), instructionsText(item.b)].filter((text) => text.trim()))].join(" | ") },

    // ---------- setup checks ----------
    { id: "identical_variants", kind: "diagnostic", severity: "advice", scope: "list", label: "B repeats A",
      help: "Same questions in the same order, same model, rows as written, asked once. Reads every question, whatever is shown.",
      check: (shown, ctx) => {
        const items = whole(shown, ctx), config = setup(ctx);
        if (!items.length || config.models[0] !== config.models[1] || config.perturb || config.average || !items.every(sameRequest)) return null;
        return `B asks all ${plural(items.length, "question")} exactly as A does, of the same model, with rows as written and asked once, so a run would only measure how often repeating a request changes its answers. Change B's questions, model, rows or ask mode to compare something.`;
      } },
    { id: "input_check_not_clean", kind: "diagnostic", severity: "advice", scope: "list", label: "Not a clean input check",
      help: "B's rows are rewritten, but something else differs too (jev/compare.py: an input check needs an otherwise identical request). Reads every question, whatever is shown.",
      check: (shown, ctx) => {
        const items = whole(shown, ctx), config = setup(ctx);
        if (!config.perturb || !items.length) return null;
        const reasons = [];
        const changed = items.filter((item) => !sameRequest(item)).map((item) => item.qid);
        if (changed.length) reasons.push(`${names(changed)} ${changed.length === 1 ? "is" : "are"} not asked exactly alike`);
        if (config.models[0] !== config.models[1]) reasons.push(`the models differ (${modelName(config.models[0])} against ${modelName(config.models[1])})`);
        if (config.average) reasons.push("B asks in both option orders");
        const how = ctx.data.perturbs?.[config.perturb] || config.perturb;
        return reasons.length ? `B's rows are sent ${how}, but ${reasons.join("; ")}, so the run is not an input check: a changed answer cannot be traced to the rewrite. Copy A into B and keep only the rows setting.` : null;
      } },
    { id: "order_check_not_clean", kind: "diagnostic", severity: "advice", scope: "list", label: "Not a clean order check",
      help: "B lists some Choice options in another order, but something else differs too, so nothing is marked “options reordered” (jev/compare.py). Reads every question, whatever is shown.",
      check: (shown, ctx) => {
        const items = whole(shown, ctx);
        const moved = items.filter((item) => reordered(item.a, item.b));
        if (!moved.length) return null;
        const config = setup(ctx);
        const reasons = [];
        // jev/compare.py needs qa == qb as dicts (key order ignored), so any other difference, even in a moved question, counts.
        const others = items.filter((item) => !(both(item) && deepEqual(item.a, item.b))).map((item) => item.qid);
        if (others.length) reasons.push(`${names(others)} also ${others.length === 1 ? "differs" : "differ"}`);
        if (items.some((item) => both(item) && item.ia !== item.ib)) reasons.push("the questions are listed in another order");
        if (config.models[0] !== config.models[1]) reasons.push(`the models differ (${modelName(config.models[0])} against ${modelName(config.models[1])})`);
        if (config.perturb) reasons.push("B's rows are rewritten");
        if (config.average) reasons.push("B asks in both option orders");
        return reasons.length ? `B lists the options of ${names(moved.map((item) => item.qid))} in another order, but ${reasons.join("; ")}, so the run is not an order check and the agreement table cannot credit a change to the order alone.` : null;
      } },
    { id: "question_order_differs", kind: "diagnostic", severity: "info", scope: "list", label: "Questions in another order",
      check: (items) => {
        const shared = items.filter(both);
        const inA = [...shared].sort((x, y) => x.ia - y.ia).map((item) => item.qid);
        const inB = [...shared].sort((x, y) => x.ib - y.ib).map((item) => item.qid);
        if (shared.length < 2 || inA.join("\u0000") === inB.join("\u0000")) return null;
        return `B asks the ${shared.length} questions both variants share in another order (A: ${inA.join(", ")}; B: ${inB.join(", ")}). Every question goes out in one call, so the order is a change of its own, and it keeps a run from counting as an order or input check.`;
      } },
    { id: "several_reworded", kind: "diagnostic", severity: "info", scope: "list", label: "Several compared questions changed",
      help: "Same model, but more than one compared question differs. (When the model differs too, “Two changes at once” says so.)",
      check: (items, ctx) => {
        const config = setup(ctx);
        const changed = items.filter((item) => item.comparable && !same(item.a, item.b)).map((item) => item.qid);
        if (config.models[0] !== config.models[1] || changed.length < 2) return null;
        return `${changed.length} compared questions differ between A and B (${names(changed)}). All of a variant's questions go out in one call, so one change can move another question's answers; read the agreement table per question, or change one question per run to know which change did it.`;
      } },
    { id: "model_case", kind: "diagnostic", severity: "advice", scope: "list", label: "Model names differ only in case",
      help: "Quiet when no shown question would be compared.",
      check: (items, ctx) => {
        const typed = ctx.data.variants.map((variant) => (typeof variant?.model === "string" ? variant.model.trim() : ""));
        if (!items.some((item) => item.comparable) || !typed[0] || !typed[1] || typed[0] === typed[1] || typed[0].toLowerCase() !== typed[1].toLowerCase()) return null;
        return `A's model “${typed[0]}” and B's “${typed[1]}” differ only in letter case. Model names are matched exactly, so this compares two names, not two models; type the same name in both if you meant the same model.`;
      } },
    { id: "unpinned_model", kind: "diagnostic", severity: "advice", scope: "list", label: "Model without a version",
      help: "A wording comparison with a model name that has no version number, such as an alias. Quiet unless a shown compared question differs.",
      check: (items, ctx) => {
        if (!items.some((item) => item.comparable && !same(item.a, item.b))) return null;
        const pinned = (ctx.data.models || []).find((name) => VERSIONED.test(name));
        return ctx.data.variants.flatMap((variant, v) => {
          const name = modelOf(variant, ctx);
          if (!name || VERSIONED.test(name)) return [];
          const blank = !(typeof variant?.model === "string" && variant.model.trim());
          return [`${v ? "B" : "A"} asks “${name}”${blank ? " (the current model, since its field is blank)" : ""}, a name without a version number. If it moves to a newer version, a later rerun of this comparison asks a different model. Type a versioned id${pinned ? ` such as ${pinned}` : ""}.`];
        });
      } },
    { id: "unknown_model", kind: "diagnostic", severity: "advice", scope: "list", label: "Model not listed for your key",
      help: "A typed model name that is not among the names your key lists. Quiet until the list has loaded and when no shown question would be compared.",
      check: (items, ctx) => {
        const known = ctx.data.models;
        if (!Array.isArray(known) || !items.some((item) => item.comparable)) return null;
        return ctx.data.variants.flatMap((variant, v) => {
          const typed = typeof variant?.model === "string" ? variant.model.trim() : "";
          return typed && !known.includes(typed)
            ? [`${v ? "B" : "A"}'s model “${typed}” is not among the ${plural(known.length, "model")} your key lists. Model names are checked before any call, so the run would be refused; pick one from the list or leave the field blank for the current model.`] : [];
        });
      } },
    { id: "same_as_last_run", kind: "diagnostic", severity: "info", scope: "list", label: "Same setup as your last run",
      help: "Every question, both models, B's rows setting and ask mode all match this session's latest finished run.",
      check: (shown, ctx) => {
        const items = whole(shown, ctx), last = ctx.data.last_run, config = setup(ctx);
        if (!Array.isArray(last) || last.length < 2 || !items.length) return null;
        const counts = ctx.data.variants.map((variant) => variant?.count);
        for (let v = 0; v < 2; v++) {
          const questions = isObject(last[v].questions) ? last[v].questions : {};
          if (last[v].model !== config.models[v] || Object.keys(questions).length !== counts[v]) return null;
        }
        if ((last[1].perturb || "") !== config.perturb || (last[1].average_orders === true) !== config.average) return null;
        // Each question is asked, at the same place and with the same JSON, as in that run (or not at all).
        const fits = (item, v) => {
          const question = v ? item.b : item.a, position = v ? item.ib : item.ia, questions = last[v].questions;
          if (question === null) return !hasOwn(questions, item.qid);
          return Object.keys(questions)[position] === item.qid && same(questions[item.qid], question);
        };
        return items.every((item) => fits(item, 0) && fits(item, 1))
          ? "A and B are set up exactly as in your last run (questions, models, B's rows setting and ask mode), so running again pays for the same comparison. Its report is still on this tab." : null;
      } },
    { id: "unscorable_labels", kind: "diagnostic", severity: "advice", label: "Labels one side cannot score",
      help: "Option keys only one variant lists, or Score scales of different lengths: a label the other side cannot score is left out of both.",
      check: (item) => {
        const split = optionSplit(item);
        if (split) {
          return [[split[0], "B drops", "that A lists"], [split[1], "B adds", "that A does not list"]].flatMap(([keys, verb, tail]) => (keys.length
            ? [`For “${item.qid}”, ${verb} ${keys.length === 1 ? "option" : "options"} ${names(keys)} ${tail}: a label naming ${keys.length === 1 ? "it" : "one"} is left out of both sides.`] : []));
        }
        const [la, lb] = [item.a, item.b].map((question) => (isObject(question) && question.type === "score" && Array.isArray(question.criteria) ? question.criteria.length : null));
        if (la === null || lb === null || la === lb) return null;
        const low = Math.min(la, lb), high = Math.max(la, lb);
        return `“${item.qid}” has ${la} levels in A and ${lb} in B: a label of level ${low}${high - low > 1 ? ` to ${high - 1}` : ""} is left out of both sides.`;
      } },

    // ---------- previewed edits of B ----------
    { id: "rotate_options_b", kind: "transform", label: "Rotate B's options",
      help: "For the shown Choice questions B asks, each option moves this many places toward the front and the first ones go to the end: an order check for the middle options that reversing leaves in place.",
      params: [{ name: "by", label: "Places", type: "integer", min: 1, default: 1 }],
      each: (item, { by }) => {
        const entries = optionEntries(item);
        if (!entries) return null;
        const k = by % entries.length;
        return withOptions(item, [...entries.slice(k), ...entries.slice(0, k)]);
      } },
    { id: "shuffle_options_b", kind: "transform", label: "Shuffle B's options",
      help: "A seeded shuffle of the shown Choice questions' options in B: the same seed always gives the same order.",
      params: [{ name: "seed", label: "Seed", type: "integer", min: 0, default: 1 }],
      each: (item, { seed }) => {
        const entries = optionEntries(item);
        return entries ? withOptions(item, shuffled(entries, seed)) : null;
      } },
    { id: "sort_options_b", kind: "transform", label: "Sort B's options by key", help: "The shown Choice questions' options in B, A to Z by key.",
      each: (item) => {
        const entries = optionEntries(item);
        return entries ? withOptions(item, [...entries].sort((x, y) => compareText(x[0], y[0]))) : null;
      } },
    { id: "option_last_b", kind: "transform", label: "Move one of B's options to the end",
      help: "Moves the named option (such as “other”) to the end of every shown Choice question in B that lists it.",
      params: [{ name: "option", label: "Option key", type: "text", required: true }],
      all: (items, { option }, _ctx, shown) => {
        let found = false;
        const next = items.map((item, index) => {
          const entries = shown.has(index) ? optionEntries(item) : null;
          if (!entries || !entries.some(([key]) => key === option)) return item;
          found = true;
          return withOptions(item, [...entries.filter(([key]) => key !== option), ...entries.filter(([key]) => key === option)]) || item;
        });
        if (!found) throw new Error(`No shown Choice question in B lists an option “${option}”.`);
        return next;
      } },
    { id: "strip_descriptions_b", kind: "transform", label: "Drop B's option descriptions",
      help: "The shown Choice questions in B keep their option keys, in order, with no descriptions: does the model need them?",
      each: (item) => {
        const criteria = choiceCriteria(item.b);
        if (!criteria || Object.values(criteria).every((text) => text === null)) return null;
        return { ...item, b: { ...item.b, criteria: Object.fromEntries(Object.keys(criteria).map((key) => [key, null])) } };
      } },
    { id: "revert_to_a", kind: "transform", label: "Make B ask the shown questions as A does",
      help: "For the shown questions both ask, B gets A's whole question (type, instructions and options); B keeps its question order.",
      each: (item) => (both(item) && !same(item.a, item.b) ? { ...item, b: item.a, comparable: true } : null) },
    { id: "add_missing_to_b", kind: "transform", label: "Add A's shown questions to B",
      help: "The shown questions only A asks are added to the end of B, exactly as A asks them, so a run compares them.",
      all: (items, _params, _ctx, shown) => canonical(items.map((item, index) => (shown.has(index) && isObject(item.a) && !isObject(item.b) ? { ...item, b: item.a, ib: null } : item))) },
    { id: "isolate_in_b", kind: "transform", label: "Keep only the shown questions in B",
      help: "B drops every question that is not shown; A stays as it is. Shows whether an answer depends on the other questions in the call.",
      all: (items, _params, _ctx, shown) => {
        if (!items.some((item, index) => shown.has(index) && isObject(item.b))) throw new Error("None of the shown questions is in B, so B would have no questions left.");
        return canonical(items.map((item, index) => (shown.has(index) ? item : { ...item, b: null, ib: null })));
      } },
    { id: "reverse_questions_b", kind: "transform", label: "Reverse B's question order",
      help: "B asks all its questions in reverse order: a question-order check. Whole-number ids always list first in the browser.",
      all: (items) => placeB(items, byB(items).reverse()) },
    { id: "sort_questions_b", kind: "transform", label: "Sort B's questions by id", help: "B's questions A to Z by id; A keeps its order.",
      all: (items) => placeB(items, byB(items).sort((x, y) => compareText(x.qid, y.qid))) },
    { id: "rename_id", kind: "transform", label: "Rename a question id in both variants",
      help: "The question keeps its place in A and in B. Refuses an id already in use. Labels in the rows box still use the old id.",
      params: [{ name: "from", label: "Current id", type: "text", required: true }, { name: "to", label: "New id", type: "text", required: true }],
      all: (items, { from, to }) => {
        const next = to.trim();
        if (!items.some((item) => item.qid === from)) throw new Error(`No question has the id “${from}”.`);
        if (!next) throw new Error("The new id must not be blank.");
        if (next !== from && items.some((item) => item.qid === next)) throw new Error(`The id “${next}” is already in use.`);
        return canonical(items.map((item) => (item.qid === from ? { ...item, qid: next } : item)));
      } },

    // ---------- importers ----------
    { id: "questions_to_a", kind: "importer", label: "Questions JSON to add to A",
      help: "An object keyed by question id, as in the editor. Repeated keys and ids already in A or B are refused.",
      parse: (text) => questionItems(questionMap(text), "a", "JSON") },
    { id: "questions_to_both", kind: "importer", label: "Questions JSON to add to both A and B",
      help: "The same questions added to the end of both variants, so a run compares them. Repeated keys and ids already in use are refused.",
      parse: (text) => questionItems(questionMap(text), "both", "JSON") },
    { id: "request_to_b", kind: "importer", label: "A request's questions to add to B",
      help: "A request as Inspect JSON shows it ({ state, questions }, or the whole { request, response } trace). Only its questions are taken; state, pictures, model and any response are left out.",
      parse: (text) => {
        const value = questionMap(text);
        const request = isObject(value) && isObject(value.request) ? value.request : value;
        if (!isObject(request) || !isObject(request.questions)) throw new Error("Paste a request with a “questions” object.");
        const out = questionItems(request.questions, "b", "a request");
        const left = ["state", "assets", "model"].filter((key) => request[key] !== undefined);
        if (request !== value && value.response !== undefined) left.push("response");
        if (left.length) out.warnings.unshift(`Left out: ${left.join(", ")}. Only the questions are added.`);
        return out;
      } },
    { id: "build_draft_to_b", kind: "importer", label: "A Build draft's questions to add to B",
      help: "A file saved with Build's “Download draft” (jev-build-draft, version 1). Only its questions are taken; its state and pictures are left out.",
      parse: (text) => {
        const value = questionMap(text);
        if (!isObject(value) || value.format !== "jev-build-draft" || value.version !== 1) throw new Error("Paste a Jev Build draft (version 1).");
        const out = questionItems(value.questions, "b", "a draft");
        out.warnings.unshift("The draft's state and pictures are left out. Only the questions are added.");
        return out;
      } },
  ],
});
