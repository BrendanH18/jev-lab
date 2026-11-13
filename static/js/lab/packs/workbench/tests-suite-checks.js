// Advisory checks on the saved tests of the Workbench Tests tab ("workbench.tests.items"; contract in
// static/js/lab/surfaces/workbench-tests.js). Item checks read one saved test (and, for one check, its latest result);
// list checks compare the shown tests with each other: repeated requests, shared inputs and question sets, expectations
// that contradict each other, and question IDs whose type, wording, options or levels drift between tests.
// Expectation semantics follow jev/workbench.py (check_expectation, run_item, slugify, validate_state). Findings name
// test IDs, question IDs, counts and model ids only: never inputs, instructions, expected options, bound values,
// answers or check text, so "Copy findings" carries no human labels. Checks are hints and never repair anything.
import { definePack, toNumber } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";

const LIMITS = Object.freeze({ max_state_chars: 120000, max_pictures_per_request: 4, max_id_chars: 60 });
const NEAR_LIMIT = 0.8;   // an input at 80% of the save limit or more is reported as near it
const SAVED_ID = /^[a-z0-9-]+$/;
const EDGES = ["left", "top", "right", "bottom"];
const MAX_NAMED = 8;      // test IDs named in one finding before "and N more"

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter(isObject) : []);
const criteriaOf = (question) => (Array.isArray(question.criteria) ? question.criteria.filter(isObject) : []);
const imagesOf = (item) => (Array.isArray(item?.images) ? item.images.filter(isObject) : []);
const limitsOf = (ctx) => ({ ...LIMITS, ...(isObject(ctx?.data?.limits) ? ctx.data.limits : {}) });
const listOf = (items) => (Array.isArray(items) ? items.filter((item) => isObject(item) && typeof item.id === "string") : []);
const names = (ids) => (ids.length > MAX_NAMED ? `${ids.slice(0, MAX_NAMED).join(", ")} and ${ids.length - MAX_NAMED} more` : ids.join(", "));
const words = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// The expectation keys a run uses for a question of this type (check_expectation and run_item's `elif expect:`).
function usedKeys(question) {
  const expect = question.expect;
  if (!isObject(expect)) return [];
  if (question.type === "choice") return ["choice", "min", "max"].filter((key) => has(expect, key));
  if (question.type === "noul" || question.type === "score") return ["min", "max"].filter((key) => has(expect, key));
  if (question.type === "box") return has(expect, "box") ? ["box", "iou_min"].filter((key) => has(expect, key)) : [];
  return [];
}

// A question no expectation checks: none, a falsy one, or an object none of whose keys the run uses. A truthy
// expectation that is not an object is not unchecked: the run reports it as invalid, which fails.
function unchecked(question) {
  const expect = question.expect;
  if (expect === null || expect === undefined) return true;
  if (!isObject(expect)) return !expect;
  return usedKeys(question).length === 0;
}

// ---------- identities for comparing tests ----------

const questionShape = (question) => ({ id: question.id, type: question.type, instructions: question.instructions,
  criteria: criteriaOf(question).map((criterion) => [criterion.key, criterion.text]) });
const pictures = (item) => imagesOf(item).map((image) => [image.ref, image.sample, image.file]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
// The input the model sees: the state and the pictures it references.
const inputKey = (item) => stableStringify({ state: item.state ?? null, pictures: pictures(item) });
// The questions asked, in any order, without their expectations.
const questionsKey = (item) => stableStringify(questionsOf(item).map(questionShape).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
const requestKey = (item) => `${inputKey(item)}\u0000${questionsKey(item)}`;
const expectKey = (item) => stableStringify(isObject(item.expect) ? item.expect : {});

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return [...groups.values()];
}

// Every question occurrence of the shown tests by question ID, in first-seen order: [[id, [{ item, question }]]].
function occurrences(items) {
  const byId = new Map();
  for (const item of items) {
    for (const question of questionsOf(item)) {
      if (!byId.has(question.id)) byId.set(question.id, []);
      byId.get(question.id).push({ item, question });
    }
  }
  return [...byId];
}

// "variant a: t1, t2 | variant b: t3": tests grouped by a variant key in first-seen order.
function variants(entries, key) {
  const groups = new Map();
  for (const { item, question } of entries) {
    const value = key(question);
    if (!groups.has(value)) groups.set(value, []);
    if (!groups.get(value).includes(item.id)) groups.get(value).push(item.id);
  }
  return [...groups];
}

// ---------- expectations ----------

// The interval a numeric expectation allows, from the keys the run uses; null when it bounds nothing readable.
function interval(question) {
  const used = usedKeys(question);
  const min = used.includes("min") ? finite(question.expect.min) : null;
  const max = used.includes("max") ? finite(question.expect.max) : null;
  return min === null && max === null ? null : [min ?? -Infinity, max ?? Infinity];
}

// Whether no single answer can meet both expectations of the same question on the same input.
function conflicting(a, b) {
  if (unchecked(a) || unchecked(b) || a.type !== b.type) return false;
  if (a.type === "choice" && has(a.expect, "choice") && has(b.expect, "choice") && a.expect.choice !== b.expect.choice) return true;
  if (!["choice", "noul", "score"].includes(a.type)) return false;
  const one = interval(a), two = interval(b);
  return !!one && !!two && (one[1] < two[0] || two[1] < one[0]);
}

// Whether Python's float() reads a JSON value, as check_expectation applies it to min, max, iou_min and box edges:
// numbers, booleans and numeric text (surrounding spaces, digit underscores, inf and nan included) read; null, objects,
// lists and other text raise, which the run reports as an invalid expectation.
function floatReadable(value) {
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return /^[-+]?(?:inf|infinity|nan)$/i.test(text) || toNumber(text.replace(/(?<=\d)_(?=\d)/g, "")) !== null;
}

// Why the run cannot read an expectation as written, one reason per problem.
function unreadable(question) {
  const expect = question.expect;
  if (expect === null || expect === undefined || (!isObject(expect) && !expect)) return [];
  if (!isObject(expect)) return ["the expectation is not an object of checks"];
  const reasons = [];
  const used = usedKeys(question);
  if (used.includes("choice") && typeof expect.choice !== "string") reasons.push("the expected option is not text, so it never equals an option key");
  for (const key of ["min", "max", "iou_min"]) {
    if (used.includes(key) && !floatReadable(expect[key])) reasons.push(`${key} is not a number`);
  }
  if (used.includes("box") && !(isObject(expect.box) && EDGES.every((edge) => floatReadable(expect.box[edge])))) {
    reasons.push("the expected box lacks numeric left, top, right and bottom edges");
  }
  return reasons;
}

// The length of the state as Python's json.dumps writes it (what validate_state measures): ", " and ": " separators
// and every character outside printable ASCII escaped as \uXXXX per UTF-16 unit. Numbers are counted as JavaScript
// writes them, which can differ by a character or two for floats.
function pythonJsonLength(value) {
  if (value === null || value === undefined) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 3;
  if (typeof value === "string") {
    let length = 2;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c || code === 0x0a || code === 0x0d || code === 0x09) length += 2;
      else if (code >= 0x20 && code <= 0x7e) length += 1;
      else length += 6;
    }
    return length;
  }
  if (Array.isArray(value)) return 2 + value.reduce((sum, entry) => sum + pythonJsonLength(entry), 0) + 2 * Math.max(0, value.length - 1);
  if (isObject(value)) {
    const entries = Object.entries(value);
    return 2 + entries.reduce((sum, [key, entry]) => sum + pythonJsonLength(key) + 2 + pythonJsonLength(entry), 0) + 2 * Math.max(0, entries.length - 1);
  }
  return 4;
}

// jev/workbench.py slugify before its [:60] cut.
const fullSlug = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// jev/client.py VERSIONED_MODEL: a versioned id such as jev-1.14.0 never moves; any other name may be an alias.
const VERSIONED = /^jev-\d+\.\d+(?:\.\d+)?$/;
// The answering version belongs to the configured id: the same id, or a patch of a two-part id (jev-1.14 -> jev-1.14.0).
const sameModel = (configured, answered) => answered === configured || answered.startsWith(`${configured}.`);

export default definePack({
  id: "tests-suite-checks",
  surface: "workbench.tests.items",
  title: "Saved test suite checks",
  about: "Advisory checks on the saved tests and on the shown suite: tests that check nothing, expectations the run cannot read or that chance alone decides, repeated requests, shared inputs and question sets, contradicting expectations, and question IDs whose type, wording, options or levels drift between tests. Findings name test IDs, question IDs, counts and model ids only, never inputs, instructions, expected values or answers.",
  features: [
    // ---------- one saved test ----------
    { id: "checks_nothing", kind: "diagnostic", severity: "advice", label: "Test that checks nothing",
      help: "No question has an expectation the run uses (none, {}, or only keys the run ignores for its type), so the test passes whatever the model answers; it fails only on a missing answer, an orphan expectation or a call error.",
      check: (item) => {
        const questions = questionsOf(item);
        return questions.length && questions.every(unchecked)
          ? `None of its ${plural(questions.length, "question")} has an expectation the run checks, so it passes whatever the model answers.` : null;
      } },
    { id: "partly_unchecked", kind: "diagnostic", severity: "info", label: "Questions no expectation checks",
      help: "Some questions of the test have an expectation and others none (or an empty or ignored one).",
      check: (item) => {
        const questions = questionsOf(item), open = questions.filter(unchecked);
        return open.length && open.length < questions.length
          ? `${open.length} of ${plural(questions.length, "question")} unchecked: ${open.map((question) => question.id).join(", ")}.` : null;
      } },
    { id: "choice_ceiling_below_chance", kind: "diagnostic", severity: "problem", label: "Choice ceiling below chance",
      help: "The chosen option is the most probable one, so its probability is at least 1/options. A max below that can never be met. Advisory: it assumes the probabilities sum to 1.",
      check: (item) => questionsOf(item).filter((question) => question.type === "choice").flatMap((question) => {
        const options = criteriaOf(question).length, max = usedKeys(question).includes("max") ? finite(question.expect.max) : null;
        return options >= 2 && max !== null && max >= 0 && max < 1 / options
          ? [`${question.id}: max is below 1/${options}, the least probability the chosen option can have, so this check always fails.`] : [];
      }) },
    { id: "choice_floor_at_chance", kind: "diagnostic", severity: "advice", label: "Choice floor at or below chance",
      help: "A min between 0 and 1/options is always met, because the chosen option's probability is at least 1/options. Advisory: it assumes the probabilities sum to 1.",
      check: (item) => questionsOf(item).filter((question) => question.type === "choice").flatMap((question) => {
        const options = criteriaOf(question).length, min = usedKeys(question).includes("min") ? finite(question.expect.min) : null;
        return options >= 2 && min !== null && min > 0 && min <= 1 / options
          ? [`${question.id}: min is at or below 1/${options}, which the chosen option always reaches, so this bound checks nothing.`] : [];
      }) },
    { id: "choice_bound_without_option", kind: "diagnostic", severity: "advice", label: "Choice bound without an expected option",
      help: "Without \"choice\", min and max bound the probability of whichever option the answer picks, not of a particular option.",
      check: (item) => questionsOf(item).filter((question) => question.type === "choice").flatMap((question) => {
        const used = usedKeys(question);
        return !used.includes("choice") && (used.includes("min") || used.includes("max"))
          ? [`${question.id}: the bound applies to whichever option is chosen, because no option is expected.`] : [];
      }) },
    { id: "unreadable_expectation", kind: "diagnostic", severity: "problem", label: "Expectation the run cannot read",
      help: "An expectation that is not an object, a bound or iou_min Python's float() cannot read (null, a list, an object or non-numeric text; numeric text such as \"0.5\" reads), an expected option that is not text, or a box without four readable edges: the run reports it as invalid, ignores it, or compares it as written and never matches.",
      check: (item) => questionsOf(item).flatMap((question) => unreadable(question).map((reason) => `${question.id}: ${reason}.`)) },
    { id: "box_outside_picture", kind: "diagnostic", severity: "advice", label: "Expected box outside the picture",
      help: "Box edges are fractions of the picture from 0 to 1; an expected box that reaches past them caps the overlap any answer can reach.",
      check: (item) => questionsOf(item).filter((question) => question.type === "box" && usedKeys(question).includes("box")).flatMap((question) => {
        const box = question.expect.box;
        if (!isObject(box) || !EDGES.every((edge) => finite(box[edge]) !== null)) return [];
        if (box.right <= box.left || box.bottom <= box.top) return [];
        return EDGES.some((edge) => box[edge] < 0 || box[edge] > 1) ? [`${question.id}: the expected box reaches outside the picture.`] : [];
      }) },
    { id: "too_many_pictures", kind: "diagnostic", severity: "problem", label: "More pictures than one request carries",
      help: "Build and Save accept at most 4 pictures per request (jev/images.py MAX_IMAGES), so a saved test with more was edited by hand and its request may be refused.",
      check: (item, ctx) => {
        const count = imagesOf(item).length, most = limitsOf(ctx).max_pictures_per_request;
        return count > most ? `${plural(count, "picture")}; one request carries at most ${most}.` : null;
      } },
    { id: "unusable_id", kind: "diagnostic", severity: "problem", label: "Test ID the server cannot load",
      help: "Saved IDs are lowercase letters, digits and hyphens, at most 60 characters. Loading its pictures and Delete refuse any other ID.",
      check: (item, ctx) => {
        const id = typeof item?.id === "string" ? item.id : "", most = limitsOf(ctx).max_id_chars;
        return id.length && (!SAVED_ID.test(id) || id.length > most) ? `Its ID is not ${most} or fewer lowercase letters, digits and hyphens.` : null;
      } },
    { id: "truncated_id", kind: "diagnostic", severity: "advice", label: "ID cut at the length limit",
      help: "The ID is its name's slug cut at 60 characters. Saving another test whose name starts the same way would overwrite this file.",
      check: (item, ctx) => {
        const most = limitsOf(ctx).max_id_chars, slug = fullSlug(item?.name);
        return typeof item?.id === "string" && item.id.length === most && slug.length > most && slug.slice(0, most) === item.id
          ? `Its name's slug is ${slug.length} characters, cut to ${most} for the ID.` : null;
      } },
    { id: "input_size", kind: "diagnostic", severity: "advice", label: "Input near or over the size limit",
      help: "Counted as the server's json.dumps writes it, which escapes every non-ASCII character as six characters. Build's Save refuses an input over the limit.",
      check: (item, ctx) => {
        const most = limitsOf(ctx).max_state_chars, length = pythonJsonLength(item?.state ?? null);
        if (length > most) return `Its input is about ${length.toLocaleString("en-US")} characters as JSON, over the ${most.toLocaleString("en-US")}-character limit.`;
        return length >= NEAR_LIMIT * most ? `Its input is about ${length.toLocaleString("en-US")} characters as JSON, ${Math.floor((100 * length) / most)}% of the ${most.toLocaleString("en-US")}-character limit.` : null;
      } },
    { id: "empty_input", kind: "diagnostic", severity: "problem", label: "Empty input",
      help: "A missing, empty or blank text, or an empty object or list, gives the model nothing to judge. Build's Save refuses only a missing or empty text.",
      check: (item) => {
        const state = item?.state;
        const empty = state === null || state === undefined || (typeof state === "string" && state.trim() === "")
          || (Array.isArray(state) && !state.length) || (isObject(state) && !Object.keys(state).length);
        return empty ? "Its input is empty." : null;
      } },
    { id: "future_saved_at", kind: "diagnostic", severity: "advice", label: "Saved time after the current clock",
      help: "saved_at is later than now, so the file was edited by hand or saved on a machine with a different clock; age facts read it as it is.",
      check: (item, ctx) => {
        const saved = finite(item?.saved_ms), now = finite(ctx?.data?.now);
        return saved !== null && now !== null && saved > now ? `Saved at ${item.saved_at}, after the current time.` : null;
      } },
    { id: "other_model_result", kind: "diagnostic", severity: "info", label: "Result from a model other than the configured one",
      help: "Your latest run of this test was answered by a different version than the configured model. Only compared when the configured model is a versioned id such as jev-1.14.0, never an alias such as jev-latest or jev-preview; a patch of a two-part id (jev-1.14.0 for jev-1.14) counts as the same.",
      check: (item, ctx) => {
        const configured = typeof ctx?.data?.model === "string" ? ctx.data.model : "";
        const answered = item?.result && !item.result.error && typeof item.result.meta?.model === "string" ? item.result.meta.model : "";
        return configured && answered && VERSIONED.test(configured) && !sameModel(configured, answered)
          ? `Answered by ${answered}; the Workbench asks ${configured} now. Rerun it to check the current model.` : null;
      } },

    // ---------- the shown suite ----------
    { id: "repeated_requests", kind: "diagnostic", severity: "advice", scope: "list", label: "Tests that send the same request",
      help: "The same input, pictures and questions (in any order). Each run pays for the same call again.",
      check: (items) => groupBy(listOf(items), requestKey).filter((group) => group.length > 1).map((group) => {
        const same = new Set(group.map(expectKey)).size === 1;
        return `${names(group.map((item) => item.id))} send the same request${same ? " with the same expectations" : " with different expectations"}.`;
      }) },
    { id: "shared_input", kind: "diagnostic", severity: "info", scope: "list", label: "Same input, different questions",
      help: "Tests that send one input and picture set with different questions could ask them all in one call.",
      check: (items) => groupBy(listOf(items), inputKey).filter((group) => new Set(group.map(questionsKey)).size > 1)
        .map((group) => `${names(group.map((item) => item.id))} send the same input with ${new Set(group.map(questionsKey)).size} different question sets; one call could ask them all.`) },
    { id: "shared_questions", kind: "diagnostic", severity: "info", scope: "list", label: "Same questions, different inputs",
      help: "Tests that ask the same questions of different inputs fit a Bulk dataset: one row per input, with the expectations as labels.",
      check: (items) => groupBy(listOf(items).filter((item) => questionsOf(item).length), questionsKey)
        .filter((group) => new Set(group.map(inputKey)).size > 1)
        .map((group) => `${names(group.map((item) => item.id))} ask the same questions of ${new Set(group.map(inputKey)).size} different inputs; a Bulk dataset could hold them as labeled rows.`) },
    { id: "conflicting_expectations", kind: "diagnostic", severity: "problem", scope: "list", label: "Contradicting expectations on the same input",
      help: "Two tests send the same input and the same question but expect different options or ranges that do not overlap, so at least one of them always fails.",
      check: (items) => {
        const out = [];
        for (const group of groupBy(listOf(items), inputKey)) {
          for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
              for (const question of questionsOf(group[i])) {
                const other = questionsOf(group[j]).find((entry) => entry.id === question.id);
                if (other && stableStringify(questionShape(other)) === stableStringify(questionShape(question)) && conflicting(question, other)) {
                  out.push(`${group[i].id} and ${group[j].id} expect incompatible results for ${question.id} on the same input; one of them always fails.`);
                }
              }
            }
          }
        }
        return out;
      } },
    { id: "different_verdicts", kind: "diagnostic", severity: "advice", scope: "list", label: "Same request and expectations, different verdicts",
      help: "From your latest runs: tests with the same request and the same expectations where one passed and another failed. The answers vary between calls, or a bound sits close to the answer.",
      check: (items) => groupBy(listOf(items), (item) => `${requestKey(item)}\u0000${expectKey(item)}`).flatMap((group) => {
        const passed = group.filter((item) => item.status === "pass").map((item) => item.id);
        const failed = group.filter((item) => item.status === "fail").map((item) => item.id);
        return passed.length && failed.length ? [`${names(passed)} passed and ${names(failed)} failed on the same request and expectations.`] : [];
      }) },
    { id: "id_with_several_types", kind: "diagnostic", severity: "advice", scope: "list", label: "Question ID used with several types",
      check: (items) => occurrences(listOf(items)).flatMap(([id, entries]) => {
        const types = variants(entries, (question) => question.type || "no type");
        return types.length > 1 ? [`${id}: ${types.map(([type, ids]) => `${type} in ${names(ids)}`).join("; ")}.`] : [];
      }) },
    { id: "wording_drift", kind: "diagnostic", severity: "advice", scope: "list", label: "Question ID asked with different wording",
      help: "The same question ID and type with different instructions (spacing ignored), so results for the ID are not comparable across tests.",
      check: (items) => occurrences(listOf(items)).flatMap(([id, entries]) => {
        const byType = groupBy(entries, (entry) => entry.question.type);
        return byType.flatMap((group) => {
          const wordings = variants(group, (question) => words(question.instructions));
          return wordings.length > 1 ? [`${id}: ${wordings.length} wordings (${wordings.map(([, ids]) => names(ids)).join(" | ")}).`] : [];
        });
      }) },
    { id: "option_drift", kind: "diagnostic", severity: "advice", scope: "list", label: "Choice ID with different option lists",
      help: "The same Choice question ID with different option keys, or the same keys in a different order.",
      check: (items) => occurrences(listOf(items)).flatMap(([id, entries]) => {
        const choice = entries.filter((entry) => entry.question.type === "choice");
        const lists = variants(choice, (question) => JSON.stringify(criteriaOf(question).map((criterion) => criterion.key)));
        if (lists.length < 2) return [];
        const sets = new Set(lists.map(([keys]) => JSON.stringify(JSON.parse(keys).sort())));
        return [`${id}: ${lists.length} option lists${sets.size === 1 ? " (the same options in a different order)" : ""} (${lists.map(([, ids]) => names(ids)).join(" | ")}).`];
      }) },
    { id: "level_drift", kind: "diagnostic", severity: "advice", scope: "list", label: "Score ID with different level counts",
      help: "The same Score question ID with a different number of levels, so its scores mean different things across tests.",
      check: (items) => occurrences(listOf(items)).flatMap(([id, entries]) => {
        const score = entries.filter((entry) => entry.question.type === "score");
        const counts = variants(score, (question) => criteriaOf(question).length);
        return counts.length > 1 ? [`${id}: ${counts.map(([count, ids]) => `${plural(count, "level")} in ${names(ids)}`).join("; ")}.`] : [];
      }) },
    { id: "similar_question_ids", kind: "diagnostic", severity: "advice", scope: "list", label: "Question IDs that differ only in case or separators",
      help: "IDs such as intent, Intent and in_tent are probably meant to be one question; coverage and failures count them apart.",
      check: (items) => {
        const groups = new Map();
        for (const [id] of occurrences(listOf(items))) {
          const key = id.toLowerCase().replace(/[\s_.-]+/g, "");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(id);
        }
        return [...groups.values()].filter((ids) => ids.length > 1).map((ids) => `${ids.join(", ")} differ only in case or separators.`);
      } },
    { id: "never_checked_ids", kind: "diagnostic", severity: "info", scope: "list", label: "Question IDs no shown test checks",
      check: (items) => {
        const all = occurrences(listOf(items));
        const open = all.filter(([, entries]) => entries.every((entry) => unchecked(entry.question))).map(([id]) => id);
        return open.length ? `${open.length} of ${plural(all.length, "question ID")} never checked: ${names(open)}.` : null;
      } },
    { id: "never_expected_options", kind: "diagnostic", severity: "info", scope: "list", label: "Choice options no shown test expects",
      help: "For a Choice question ID that some test expects an option of: how many of its options no test expects. Counts only, never which options.",
      check: (items) => occurrences(listOf(items)).flatMap(([id, entries]) => {
        const choice = entries.filter((entry) => entry.question.type === "choice").map((entry) => entry.question);
        const expected = new Set(choice.filter((question) => usedKeys(question).includes("choice")).map((question) => question.expect.choice));
        if (!expected.size) return [];
        const options = [...new Set(choice.flatMap((question) => criteriaOf(question).map((criterion) => criterion.key)))];
        const never = options.filter((key) => !expected.has(key)).length;
        return never ? [`${id}: ${never} of ${plural(options.length, "option")} never the expected option.`] : [];
      }) },
    { id: "hidden_selection", kind: "diagnostic", severity: "info", scope: "list", label: "Selected tests the filters hide",
      help: "Run selected runs every selected test, shown or not.",
      check: (items, ctx) => {
        const shown = new Set(listOf(items).map((item) => item.id));
        const hidden = (Array.isArray(ctx?.data?.selected) ? ctx.data.selected : []).filter((id) => !shown.has(id));
        return hidden.length ? `${plural(hidden.length, "selected test")} hidden by filters (${names(hidden)}); Run selected includes ${hidden.length === 1 ? "it" : "them"}.` : null;
      } },
  ],
});
