// Question facts and readiness checks for the Build editor's cards (surface workbench.build.questions, contract in
// static/js/lab/surfaces/workbench-build.js). Facts and checks read authored fields, the state editor, the attached
// pictures' references and the human expectations; one fact compares a card with the answers of your own latest Run in
// this page session. Everything is advisory plain code: no model call, no wording of its own, nothing stored.
import { definePack } from "../../kit.js";
import { isPlainObject } from "../../lib/json.js";
import { codePoints, findEmails, findNumbers, findPlaceholders, findUrls, jaccard, levenshtein, utf8Bytes, words } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const hasOwn = (object, key) => !!object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
const str = (value) => (typeof value === "string" ? value : "");
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const RUN_NOTE = "From your latest Run in this page session; the Build tab says when those answers are outdated.";

// ---------- reading a card (items carry read-only facts; plain objects get the same values from stored fields) ----------

const qidOf = (item) => (typeof item.qid === "string" ? item.qid : str(item.id).trim());

function parsesAsStructure(text) {
  const trimmed = str(text).trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try { const value = JSON.parse(trimmed); return !!value && typeof value === "object"; } catch { return false; }
}
const isStructured = (item) => (typeof item.structured === "boolean" ? item.structured : parsesAsStructure(item.instructions));

// The active criteria as the request sends them: [{ key, text }] (see the surface contract).
function criteriaOf(item) {
  if (Array.isArray(item.criteria)) return item.criteria;
  const type = item.type;
  if (type === "choice") return (Array.isArray(item.choice) ? item.choice : []).filter((pair) => Array.isArray(pair) && str(pair[0]).trim())
    .map(([key, text]) => ({ key: str(key).trim(), text: str(text).trim() }));
  if (type === "score") return (Array.isArray(item.score) ? item.score : []).filter((level) => str(level).trim())
    .map((level, index) => ({ key: String(index), text: str(level).trim() }));
  if (type === "noul") return [["true", item.noulYes], ["false", item.noulNo]].filter(([, text]) => str(text).trim())
    .map(([key, text]) => ({ key, text: str(text).trim() }));
  return [];
}

// Text instructions (not structured); null for structured (JSON) instructions.
const wording = (item) => (isStructured(item) ? null : str(item.instructions));

// The parts of a text that lint ignores when it counts question marks: quoted and backticked spans (jev/lint.py _QUOTED).
const QUOTED = /“[^”]*”|‘[^’]*’|"[^"]*"|(?<!\w)'[^'\n]*'(?!\w)|`[^`]*`/g;
const unquoted = (text) => str(text).replace(QUOTED, " ");
const withoutTicks = (text) => str(text).replace(/`[^`]*`/g, " ");

// Every string the request sends for a value: the text itself, or each string inside parsed structure.
function stringsOf(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) stringsOf(entry, out);
  else if (isPlainObject(value)) for (const entry of Object.values(value)) stringsOf(entry, out);
  return out;
}
const sentValue = (text) => (parsesAsStructure(text) ? JSON.parse(str(text).trim()) : str(text));

// The texts of a card as sent: instructions and active criteria, each parsed when it is structure.
const sentStrings = (item) => [sentValue(item.instructions), ...criteriaOf(item).map((entry) => sentValue(entry.text))].flatMap((value) => stringsOf(value));

// ---------- the state (backticked paths, resolved as jev/lint.py _resolve does: a field name may contain dots) ----------

const PATH = /^[\p{L}_][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_-]+|\[\d+\])*$/u;

function resolve(value, path, parent = null, key = null) {
  if (path === "") return { parent, key, value };
  if (isPlainObject(value)) {
    for (const name of Object.keys(value)) {
      if (!path.startsWith(name)) continue;
      const rest = path.slice(name.length);
      if (rest === "" || rest[0] === "." || rest[0] === "[") {
        const hit = resolve(value[name], rest.startsWith(".") ? rest.slice(1) : rest, value, name);
        if (hit) return hit;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    const step = /^(?:\[(\d+)\]|(\d+)(?=$|[.[]))/.exec(path);
    if (!step) return null;
    const index = Number(step[1] ?? step[2]);
    const rest = path.slice(step[0].length);
    return index < value.length ? resolve(value[index], rest.startsWith(".") ? rest.slice(1) : rest, value, String(index)) : null;
  }
  return null;
}

// The state's parsed value when it is a JSON object or array, else null.
function stateValue(ctx) {
  const state = ctx?.data?.state;
  return state && (state.kind === "object" || state.kind === "array") ? state.value : null;
}
const pictureRefs = (ctx) => (Array.isArray(ctx?.data?.images) ? ctx.data.images.map((image) => str(image?.ref)).filter(Boolean) : []);

// Distinct path-like backticked tokens in the card's sent texts, in order.
function backtickedPaths(item) {
  const found = [];
  for (const text of sentStrings(item)) {
    for (const [, inner] of text.matchAll(/`([^`]+)`/g)) {
      const token = inner.trim();
      if (PATH.test(token) && !found.includes(token)) found.push(token);
    }
  }
  return found;
}

// The state nodes the card's backticked paths name: [{ path, parent, key, value }]; null when the state is not JSON.
function namedNodes(item, ctx) {
  const state = stateValue(ctx);
  if (state === null) return null;
  return backtickedPaths(item).flatMap((path) => {
    const hit = resolve(state, path);
    return hit ? [{ path, ...hit }] : [];
  });
}

// ---------- expectations ----------

// The top of the scale min/max apply to: P(yes) or the chosen option's probability (1), or the highest Score level.
function scaleTop(item) {
  if (item.type === "noul" || item.type === "choice") return 1;
  if (item.type === "score") { const levels = criteriaOf(item).length; return levels >= 2 ? levels - 1 : null; }
  return null;
}
const expectationOf = (item) => (isPlainObject(item.expectation) ? item.expectation : null);
const boundOf = (item, name) => { const expectation = expectationOf(item); return expectation && item.type !== "box" ? finite(expectation[name]) : null; };
const EDGES = ["left", "top", "right", "bottom"];
const boxOf = (expectation) => (isPlainObject(expectation?.box) && EDGES.every((edge) => finite(expectation.box[edge]) !== null) ? expectation.box : null);

function expectationText(expectation) {
  if (!expectation) return null;
  const parts = [];
  const choice = typeof expectation.choice === "string" ? expectation.choice : null;
  if (choice !== null) parts.push(`= ${choice}`);
  const p = choice !== null ? "p " : "";
  const min = finite(expectation.min), max = finite(expectation.max);
  if (min !== null && max !== null) parts.push(`${p}${min} to ${max}`);
  else if (min !== null) parts.push(`${p}≥ ${min}`);
  else if (max !== null) parts.push(`${p}≤ ${max}`);
  const box = boxOf(expectation);
  if (box) parts.push(`box ${EDGES.map((edge) => box[edge]).join(", ")}`);
  if (box || finite(expectation.iou_min) !== null) parts.push(`IoU ≥ ${finite(expectation.iou_min) ?? 0.5}`);
  return parts.length ? parts.join(", ") : null;
}

// ---------- shapes of the latest Run ----------

const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value));
const sentText = (text) => (parsesAsStructure(text) ? JSON.stringify(JSON.parse(str(text).trim())) : str(text).trim());

function runShape(item, ctx) {
  const answers = ctx?.data?.answers;
  if (!answers || typeof answers !== "object") return null;
  const qid = qidOf(item);
  const answer = qid && hasOwn(answers, qid) ? answers[qid] : null;
  if (!isPlainObject(answer)) return "not in your latest run";
  if (answer.type !== item.type) return "type changed";
  if (item.type === "choice" && isPlainObject(answer.probabilities)) {
    const sent = Object.keys(answer.probabilities).sort().join("\u0000");
    const now = criteriaOf(item).map((entry) => entry.key).sort().join("\u0000");
    if (sent !== now) return "options changed";
  }
  if (item.type === "score") {
    const now = criteriaOf(item).map((entry) => sentText(entry.text));
    const legend = isPlainObject(answer.legend) && Object.keys(answer.legend).length ? answer.legend : null;
    const then = legend ? Object.keys(legend).sort((a, b) => Number(a) - Number(b)).map((key) => (typeof legend[key] === "string" ? legend[key].trim() : asText(legend[key])))
      : isPlainObject(answer.probabilities) ? Object.keys(answer.probabilities).map(() => null) : null;
    if (then && (then.length !== now.length || then.some((text, index) => text !== null && text !== now[index]))) return "levels changed";
  }
  return "unchanged shape";
}

// ---------- picture references (jev/images.py unreferenced: longest references first, no overlaps) ----------

function usedRefs(refs, texts) {
  const used = new Set();
  if (!refs.length) return used;
  const ordered = [...refs].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(ordered.map((ref) => ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  for (const text of texts) for (const [match] of text.matchAll(pattern)) used.add(match);
  return used;
}

function closestPair(texts) {
  let best = null;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const value = jaccard(texts[i], texts[j]);
    if (best === null || value > best) best = value;
  }
  return best;
}

const NEGATION = /\b(?:not|never|none|neither|nor|without|cannot)\b|n['’]t\b/i;

export default definePack({
  id: "build-question-facts",
  surface: "workbench.build.questions",
  title: "More question facts",
  about: "Wording, criteria-balance, state-path, expectation and since-your-run facts for the Build editor's questions, plus readiness checks. They read authored fields, the state, picture references and human expectations (one fact compares with your own latest Run in this page session) and are advisory plain code.",
  features: [
    // ---------- size and wording ----------
    { id: "position", kind: "fact", type: "number", label: "request position", help: "The card's 1-based place in request order, so a minimum and maximum pick a range such as questions 10 to 20.",
      value: (item) => finite(item.position) },
    { id: "authored_bytes", kind: "fact", type: "number", label: "authored UTF-8 bytes", unit: "bytes",
      help: "UTF-8 bytes of the trimmed id, the instructions as typed and the active criteria (Choice keys and descriptions, Score levels, Noul yes/no). A size, not a spend estimate.",
      value: (item) => utf8Bytes(qidOf(item)) + utf8Bytes(item.instructions)
        + criteriaOf(item).reduce((sum, entry) => sum + (item.type === "choice" ? utf8Bytes(entry.key) : 0) + utf8Bytes(entry.text), 0) },
    { id: "closest_wording", kind: "fact", type: "number", label: "closest wording to another question",
      help: "The highest word overlap (Jaccard, 0 to 1, case and edge punctuation ignored) between these text instructions and any other card's; unavailable for structured or empty instructions or when no other card has text instructions.",
      value: (item, ctx) => {
        const own = wording(item);
        if (own === null || !own.trim()) return null;
        const others = (ctx?.items?.() || []).filter((other) => other !== item && other.position !== item.position)
          .map(wording).filter((text) => text !== null && text.trim());
        return others.length ? Math.max(...others.map((text) => jaccard(own, text))) : null;
      } },
    { id: "numbers_in_wording", kind: "fact", type: "number", label: "numbers in the instructions",
      help: "Numbers written in text instructions outside backticked names, such as a threshold that may belong in code; unavailable for structured instructions.",
      value: (item) => { const text = wording(item); return text === null ? null : findNumbers(withoutTicks(text)).length; } },
    { id: "opening_word", kind: "fact", type: "category", label: "opening word",
      help: "The first word of text instructions in lower case (is, what, how, does …), without edge punctuation; unavailable for structured or empty instructions.",
      value: (item) => {
        const first = words(wording(item) ?? "")[0];
        const word = first ? first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase() : "";
        return word || null;
      } },
    { id: "negative_wording", kind: "fact", type: "flag", label: "negative wording",
      help: "Text instructions use not, never, none, neither, nor, without, cannot or a n't contraction outside quoted and backticked spans. A bare no is not counted, since yes-or-no questions say it.",
      value: (item) => { const text = wording(item); return text !== null && NEGATION.test(unquoted(text)); } },

    // ---------- criteria balance ----------
    { id: "shortest_criterion", kind: "fact", type: "number", label: "shortest criterion characters",
      help: "Characters in the shortest active criterion description that is not empty; unavailable without one.",
      value: (item) => { const lengths = criteriaOf(item).map((entry) => codePoints(entry.text)).filter((length) => length > 0); return lengths.length ? Math.min(...lengths) : null; } },
    { id: "criterion_length_ratio", kind: "fact", type: "number", label: "criterion length ratio",
      help: "The longest active criterion description divided by the shortest (characters, empty ones left out): 1 is even, large means one option is described far more than another. Unavailable with fewer than two descriptions.",
      value: (item) => {
        const lengths = criteriaOf(item).map((entry) => codePoints(entry.text)).filter((length) => length > 0);
        return lengths.length >= 2 ? Math.max(...lengths) / Math.min(...lengths) : null;
      } },
    { id: "closest_criteria", kind: "fact", type: "number", label: "closest pair of criteria",
      help: "The highest word overlap (Jaccard, 0 to 1) between two active criterion descriptions of this card; near 1 means two options or levels read almost alike. Unavailable with fewer than two descriptions.",
      value: (item) => closestPair(criteriaOf(item).map((entry) => entry.text).filter((text) => text.trim())) },

    // ---------- the state it names ----------
    { id: "named_fields", kind: "fact", type: "number", label: "state fields named",
      help: "Distinct backticked paths in the instructions and active criteria that exist in the state (a field name may contain dots, as Check questions reads them); unavailable when the state is not a JSON object or array.",
      value: (item, ctx) => { const nodes = namedNodes(item, ctx); return nodes === null ? null : nodes.length; } },
    { id: "named_text_chars", kind: "fact", type: "number", label: "state text characters named", unit: "characters",
      help: "Characters of the state's text values under the backticked paths this card names, each value counted once even when two paths overlap; picture references are left out. Unavailable when the state is not a JSON object or array.",
      value: (item, ctx) => {
        const nodes = namedNodes(item, ctx);
        if (nodes === null) return null;
        const refs = new Set(pictureRefs(ctx));
        const seen = new Map();
        let total = 0;
        const visit = (parent, key, value) => {
          if (typeof value === "string") {
            if (refs.has(value)) return;
            const holder = parent === null ? seen : parent;
            if (!seen.has(holder)) seen.set(holder, new Set());
            if (seen.get(holder).has(key)) return;
            seen.get(holder).add(key);
            total += codePoints(value);
          } else if (Array.isArray(value)) value.forEach((entry, index) => visit(value, String(index), entry));
          else if (isPlainObject(value)) for (const name of Object.keys(value)) visit(value, name, value[name]);
        };
        for (const node of nodes) visit(node.parent, node.key, node.value);
        return total;
      } },
    { id: "named_value_kind", kind: "fact", type: "category", label: "kind of state value named",
      help: "What the named state paths hold: text, number, true/false, null, list, object or picture (a picture reference), or mixed; unavailable when no backticked path resolves.",
      value: (item, ctx) => {
        const nodes = namedNodes(item, ctx);
        if (!nodes || !nodes.length) return null;
        const refs = new Set(pictureRefs(ctx));
        const kinds = new Set(nodes.map(({ value }) => (typeof value === "string" ? (refs.has(value) ? "picture" : "text") : typeof value === "number" ? "number"
          : typeof value === "boolean" ? "true/false" : value === null ? "null" : Array.isArray(value) ? "list" : "object")));
        return kinds.size === 1 ? [...kinds][0] : "mixed";
      } },

    // ---------- human expectations ----------
    { id: "expected_min", kind: "fact", type: "number", label: "expected minimum",
      help: "The human expectation's minimum (P(yes), the chosen option's probability, or the score); unavailable without one and for a Box.", value: (item) => boundOf(item, "min") },
    { id: "expected_max", kind: "fact", type: "number", label: "expected maximum",
      help: "The human expectation's maximum (P(yes), the chosen option's probability, or the score); unavailable without one and for a Box.", value: (item) => boundOf(item, "max") },
    { id: "expected_share", kind: "fact", type: "number", label: "share of the scale expected",
      help: "How much of the scale passes the expectation's bounds: (upper - lower) / scale, where a missing bound is the scale's end (0 to 1 for Noul and Choice, 0 to the top level for Score). 0 means it can never pass. Unavailable without a minimum or maximum.",
      value: (item) => {
        const min = boundOf(item, "min"), max = boundOf(item, "max"), top = scaleTop(item);
        if ((min === null && max === null) || top === null) return null;
        const lower = Math.max(min ?? 0, 0), upper = Math.min(max ?? top, top);
        return Math.max(0, upper - lower) / top;
      } },
    { id: "expectation_text", kind: "fact", type: "text", label: "expectation summary",
      help: "The human expectation in short: “= refund”, “p ≥ 0.7”, “0.5 to 1.5”, “box …, IoU ≥ 0.5”. Human-authored, never an answer.",
      value: (item) => expectationText(expectationOf(item)) },

    // ---------- since your latest Run ----------
    { id: "run_shape", kind: "fact", type: "category", label: "shape since your latest run",
      help: `${RUN_NOTE} Compares the card's type, Choice option keys and Score level texts with that Run's answer: unchanged shape, type changed, options changed, levels changed, or not in your latest run. Wording edits are not visible here. Unavailable before a Run.`,
      value: runShape },

    // ---------- checks ----------
    { id: "expected_option_missing", kind: "diagnostic", severity: "problem", label: "Expected option is not offered",
      check: (item) => {
        const expectation = expectationOf(item);
        if (item.type !== "choice" || typeof expectation?.choice !== "string") return null;
        return criteriaOf(item).some((entry) => entry.key === expectation.choice) ? null
          : `The expectation wants “${expectation.choice}”, which is not one of this question's options, so it can never pass.`;
      } },
    { id: "expectation_never_passes", kind: "diagnostic", severity: "problem", label: "Expectation that can never pass",
      check: (item) => {
        const expectation = expectationOf(item);
        if (!expectation) return null;
        const out = [];
        if (item.type === "box") {
          const box = boxOf(expectation);
          const floor = finite(expectation.iou_min) ?? 0.5;
          if (floor > 1) out.push(`IoU ≥ ${floor} can never pass: overlap is at most 1.`);
          if (box && floor > 0 && (box.right <= box.left || box.bottom <= box.top)) out.push("The expected box has no area (right is not past left, or bottom is not below top), so its overlap is always 0.");
          return out;
        }
        const min = boundOf(item, "min"), max = boundOf(item, "max"), top = scaleTop(item);
        if (min !== null && max !== null && min > max) out.push(`The minimum ${min} is above the maximum ${max}.`);
        else if (top !== null) {
          const scale = item.type === "score" ? `the levels run from 0 to ${top}` : "it runs from 0 to 1";
          if (min !== null && min > top) out.push(`The minimum ${min} is above the scale: ${scale}.`);
          if (max !== null && max < 0) out.push(`The maximum ${max} is below the scale: ${scale}.`);
        }
        return out;
      } },
    { id: "expectation_ignored_parts", kind: "diagnostic", severity: "advice", label: "Expectation parts this type ignores",
      check: (item) => {
        const expectation = expectationOf(item);
        if (!expectation || !TYPES.includes(item.type)) return null;
        const ignored = item.type === "box" ? ["choice", "min", "max"] : item.type === "choice" ? ["box", "iou_min"] : ["choice", "box", "iou_min"];
        const present = ignored.filter((name) => hasOwn(expectation, name));
        return present.length ? `A ${item.type} expectation does not check ${present.join(", ")}; those parts are ignored when the test runs.` : null;
      } },
    { id: "blank_level_gap", kind: "diagnostic", severity: "advice", label: "Blank Score level before a defined level",
      check: (item) => {
        if (item.type !== "score" || !Array.isArray(item.score)) return null;
        const defined = item.score.map((level) => !!str(level).trim());
        const gap = defined.findIndex((on, index) => !on && defined.slice(index + 1).includes(true));
        if (gap < 0) return null;
        const after = defined.indexOf(true, gap);
        const sent = defined.slice(0, after).filter(Boolean).length;
        return `Level ${gap} is blank, so blank levels are dropped and “${str(item.score[after]).trim()}”, typed as level ${after}, is sent as level ${sent}. Remove the blank level or fill it in.`;
      } },
    { id: "leftover_placeholder", kind: "diagnostic", severity: "advice", label: "Template placeholder left in the wording",
      check: (item) => {
        const texts = [wording(item) ?? "", ...criteriaOf(item).filter((entry) => !parsesAsStructure(entry.text)).map((entry) => entry.text)];
        const found = [...new Set(texts.flatMap((text) => findPlaceholders(withoutTicks(text))))];
        return found.length ? `${found.join(", ")} look${found.length === 1 ? "s" : ""} like a template placeholder that was never filled in; the model reads it literally.` : null;
      } },
    { id: "contact_in_wording", kind: "diagnostic", severity: "advice", label: "Address or link in the wording",
      check: (item) => {
        const texts = [str(item.instructions), ...criteriaOf(item).map((entry) => entry.text)];
        const found = [...new Set(texts.flatMap((text) => [...findEmails(text), ...findUrls(text)]))];
        return found.length ? `The wording names ${found.join(", ")}. A specific address or link usually belongs in the state, so the question fits every input.` : null;
      } },
    { id: "box_picture_ambiguous", kind: "diagnostic", severity: "advice", label: "Box that names no picture among several",
      check: (item, ctx) => {
        const refs = pictureRefs(ctx);
        if (item.type !== "box" || !qidOf(item) || refs.length < 2) return null;
        const text = str(item.instructions);
        if (refs.some((ref) => text.includes(ref))) return null;
        const state = stateValue(ctx);
        for (const [, inner] of text.matchAll(/`([^`]+)`/g)) {
          const hit = state === null ? null : resolve(state, inner.trim());
          if (hit && refs.includes(hit.value)) return null;
        }
        return `${refs.length} pictures are attached and this Box names none of them, so it is unclear which one it points at and the Build tab draws it on none. Name one by its reference or by a backticked state field that holds it.`;
      } },
    { id: "unreferenced_picture", kind: "diagnostic", scope: "list", severity: "problem", label: "Picture named nowhere",
      check: (items, ctx) => {
        const images = Array.isArray(ctx?.data?.images) ? ctx.data.images : [];
        const state = ctx?.data?.state;
        if (!images.length || !state || state.kind === "invalid") return null;
        const texts = [...(state.kind === "text" ? [str(state.text)] : stringsOf(state.value)), ...items.filter((item) => qidOf(item)).flatMap(sentStrings)];
        const used = usedRefs(images.map((image) => str(image.ref)).filter(Boolean), texts);
        return images.filter((image) => image.ref && !used.has(image.ref)).map((image) => `Picture ${image.ref}${image.name ? ` (${image.name})` : image.sample ? ` (sample ${image.sample})` : ""} is not named in the state or any question with an id, so Run will be refused. Put its reference in the state or a question, or remove it.`);
      } },
    { id: "json_like_instructions", kind: "diagnostic", severity: "advice", label: "Instructions that look like JSON but do not parse",
      check: (item) => {
        const trimmed = str(item.instructions).trim();
        if (!/^[[{]/.test(trimmed) || isStructured(item)) return null;
        let reason = "invalid JSON";
        try { JSON.parse(trimmed); } catch (error) { reason = String(error?.message || reason); }
        return `The instructions start like JSON but do not parse (${reason}), so they are sent as plain text, not as structure.`;
      } },
    { id: "single_option", kind: "diagnostic", severity: "advice", label: "Choice with only one option",
      check: (item) => {
        const criteria = criteriaOf(item);
        return item.type === "choice" && qidOf(item) && criteria.length === 1 ? `Only “${criteria[0].key}” is named, so every answer is that option. Add the alternatives, or ask a Noul question instead.` : null;
      } },
    { id: "key_inner_space", kind: "diagnostic", severity: "advice", label: "Option key with a space inside",
      check: (item) => {
        if (item.type !== "choice") return null;
        const spaced = criteriaOf(item).map((entry) => entry.key).filter((key) => /\s/.test(key));
        return spaced.length ? `${spaced.map((key) => `“${key}”`).join(", ")} ha${spaced.length === 1 ? "s" : "ve"} a space inside; code that reads the answer is easier with letters, digits and underscores.` : null;
      } },
    { id: "near_ids", kind: "diagnostic", scope: "list", severity: "advice", label: "Ids one edit apart",
      check: (items) => {
        const ids = [...new Set(items.map(qidOf).filter(Boolean))];
        const out = [];
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          if (ids[i].toLowerCase() !== ids[j].toLowerCase() && levenshtein(ids[i], ids[j]) === 1) {
            out.push(`${ids[i]} and ${ids[j]} are one character apart; check that they are meant to be different questions.`);
          }
        }
        return out;
      } },
  ],
});
