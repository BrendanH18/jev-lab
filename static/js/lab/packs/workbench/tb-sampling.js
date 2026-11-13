// Toolbox: seeded sampling and split planning for pasted lines ("workbench.toolbox", group "Sampling and splits").
// Every tool reads only what is typed or pasted into its form, runs locally and never calls the model. A pasted line
// is one item: lines are trimmed and blank lines skipped, and line numbers count every pasted line, blank ones too.
// Randomness comes from lib/math.js's mulberry32 (shuffled, sampleIndexes), so the same seed and the same lines give
// the same sample in every browser. Splits and folds can keep identical lines together, using the Workbench's input
// identity (a JSON object line with its labels and test markers ignored, field order ignored, pictures kept) or the
// exact text. The planners are exact formulas from the numbers typed; plans are not measurements.
import { definePack, toNumber } from "../../kit.js";
import { isPlainObject, omit, stableStringify, typeName } from "../../lib/json.js";
import { choose, hypergeometricPmf, logChoose, mulberry32, round, sampleIndexes, shuffled } from "../../lib/math.js";
import { lines as splitLines, truncate } from "../../lib/text.js";

const GROUP = "Sampling and splits";
const MAX_LINES = 20000;
const MAX_SPLIT_LINES = 5000;   // the held-out split searches every reachable count
const MAX_FOLDS = 20;
const MAX_DRAWS = 100000;
const MAX_SEED = 4294967295;
const LABELS = "_expect";
const TEST = "_test";
const MISSING = "(missing)";
const LISTED = 30;              // line numbers a note lists before it stops

const fail = (message) => { throw new Error(message); };
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const range = (count) => Array.from({ length: count }, (unused, index) => index);
const byPosition = (a, b) => a - b;

// ---------- inputs ----------

const LINES = { name: "lines", label: "Lines (one item per line)", type: "textarea", required: true,
  placeholder: "Where is my order?\nThe grinder arrived broken.\nCan I change my delivery day?" };
const ROWS = { name: "lines", label: "Bulk rows (one JSON object per line)", type: "textarea", required: true,
  placeholder: '{"text": "Where is my order?", "channel": "email"}\n{"text": "Refund please", "channel": "chat"}' };
const LABEL_COLUMN = { name: "labels", label: "Labels (one per line, in the same order)", type: "textarea", required: true, placeholder: "shipping\nreturns\nshipping" };
const WEIGHT_COLUMN = { name: "weights", label: "Weights (one number per line, in the same order)", type: "textarea", required: true, placeholder: "1\n3\n0.5" };
const SEED = { name: "seed", label: "Seed", type: "integer", min: 0, max: MAX_SEED, default: 1 };
const FOLDS = { name: "folds", label: "Folds", type: "integer", min: 2, max: MAX_FOLDS, default: 5 };
const FIELD = { name: "field", label: "Field", type: "text", required: true, placeholder: "channel" };
const IDENTITY_OPTIONS = [["input", "Same Bulk input (labels, test markers and field order ignored)"], ["exact", "Same text exactly"]];
const IDENTITY = { name: "identity", label: "Keep together lines with the", type: "select", options: [...IDENTITY_OPTIONS, ["none", "Nothing (every line stands alone)"]] };
const count = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, max: 1e9, ...extra });
const share = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });

// ---------- reading lines ----------

function capped(items, max = MAX_LINES) {
  if (!items.length) fail("Paste at least one line.");
  if (items.length > max) fail(`Paste at most ${max} lines; there are ${items.length}.`);
  return items;
}

// The nonblank lines as { line (1-based, blank lines counted), text (trimmed) }.
function readLines(text, max = MAX_LINES) {
  const out = [];
  splitLines(text).forEach((raw, index) => {
    const line = raw.trim();
    if (line) out.push({ line: index + 1, text: line });
  });
  return capped(out, max);
}

// Lines paired with a second column pasted beside them: { line, text, value }. A pair blank on both sides is skipped.
function readPairs(text, column, name) {
  const left = splitLines(text), right = splitLines(column);
  if (left.length !== right.length) fail(`There are ${plural(left.length, "line")} and ${plural(right.length, name)}: paste one ${name} per line, in the same order.`);
  const out = [];
  left.forEach((raw, index) => {
    const line = raw.trim(), value = right[index].trim();
    if (!line && !value) return;
    if (!line) fail(`Line ${index + 1} has a ${name} but no text.`);
    if (!value) fail(`Line ${index + 1} has no ${name}.`);
    out.push({ line: index + 1, text: line, value });
  });
  return capped(out);
}

function parseObject(text) {
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch { return null; }
}

// A pasted line as the Bulk row it stands for: a JSON object line is that object, any other line is {"text": line}
// (the Workbench treats a text row and {"text": row} as the same row).
const rowOf = (text) => parseObject(text) ?? { text };

// The identity that keeps lines together: Bulk's input identity, the exact text, or none (every line its own group).
function identityOf(item, index, mode) {
  if (mode === "none") return `#${index}`;
  if (mode === "input") return `o${stableStringify(omit(rowOf(item.text), [LABELS, TEST]))}`;
  return `t${item.text}`;
}

// Items grouped by a key, in order of first appearance: [{ key, name, members: [item indexes] }].
function groupBy(items, keyOf, nameOf = (item) => item.value) {
  const groups = new Map();
  items.forEach((item, index) => {
    const key = keyOf(item, index);
    if (key === null) return;
    if (!groups.has(key)) groups.set(key, { key, name: nameOf(item), members: [] });
    groups.get(key).members.push(index);
  });
  return [...groups.values()];
}

// A top-level field's value on a Bulk row: { key, name } by its full normalized value, or null when the row has no
// such field (a text line is the row {"text": line}).
function fieldValue(item, field) {
  const row = rowOf(item.text);
  if (!Object.prototype.hasOwnProperty.call(row, field)) return null;
  const value = row[field];
  return { key: stableStringify(value), name: typeof value === "string" ? value : `${stableStringify(value)} (${typeName(value)})` };
}

function fieldName(text) {
  const name = String(text).trim();
  if (!name) fail("Field is required.");
  if (name === LABELS || name === TEST) fail(`${name} is not an input field.`);
  return name;
}

// ---------- shared pieces ----------

const textOf = (items, indexes) => indexes.slice().sort(byPosition).map((index) => items[index].text).join("\n");
const lineList = (items, indexes) => {
  const numbers = indexes.slice().sort(byPosition).map((index) => items[index].line);
  return numbers.length > LISTED ? `${numbers.slice(0, LISTED).join(", ")}, …` : numbers.join(", ");
};
const seeded = (seed) => `Seed ${seed}: the same seed and lines give the same result.`;

// The first quota[g] items of each group in one seeded order of all items: a simple random sample within each group.
function takeQuotas(items, groupOfItem, quotas, seed) {
  const taken = quotas.map(() => 0), chosen = [];
  for (const index of shuffled(range(items.length), seed)) {
    const group = groupOfItem[index];
    if (taken[group] < quotas[group]) { taken[group] += 1; chosen.push(index); }
  }
  return chosen;
}

const groupIndex = (items, groups) => {
  const out = new Array(items.length);
  groups.forEach((group, g) => { for (const index of group.members) out[index] = g; });
  return out;
};

// Whole numbers in proportion to sizes that add up to total: floors, then one more to the largest remainders (earlier
// groups first on ties). Exact integer arithmetic.
function proportional(sizes, totalSize, total) {
  const quotas = sizes.map((size) => Math.floor(total * size / totalSize));
  let left = total - quotas.reduce((a, b) => a + b, 0);
  const order = sizes.map((size, index) => ({ index, rest: (total * size) % totalSize })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    quotas[index] += 1;
    left -= 1;
  }
  return quotas;
}

// Groups in a seeded order, larger groups first (the seeded order breaks ties).
const largestFirst = (groups, seed) => shuffled(groups, seed).sort((a, b) => b.members.length - a.members.length);

function sideTable(items, sideOf) {
  return { columns: ["Line", "Side"], rows: items.map((item, index) => [item.line, sideOf[index]]) };
}

// ln(C(m, k) / C(n, k)): the chance that k given items all avoid n - m chosen ones; null when m < k.
const logRatio = (m, n, k) => (m < k ? null : logChoose(m, k) - logChoose(n, k));
const ratio = (m, n, k) => { const value = logRatio(m, n, k); return value === null ? 0 : Math.exp(value); };

// H_n - H_k for k <= n: summed directly when few terms separate them (exact to rounding), else from H_n and H_k.
function harmonicGap(k, n) {
  if (n - k <= 1e6) {
    let total = 0;
    for (let i = n; i > k; i--) total += 1 / i;
    return total;
  }
  return harmonic(n) - harmonic(k);
}

function harmonic(n) {
  if (n <= 1e6) {
    let total = 0;
    for (let i = n; i >= 1; i--) total += 1 / i;
    return total;
  }
  const inverse = 1 / n;
  return Math.log(n) + 0.5772156649015329 + inverse / 2 - inverse * inverse / 12 + inverse ** 4 / 120;
}

// ---------- tools ----------

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

export default definePack({
  id: "tb-sampling",
  surface: "workbench.toolbox",
  title: "Sampling and splits",
  about: "Seeded samples, shuffles, stratified and weighted samples, held-out and three-way splits and fold assignments of pasted lines that keep identical inputs together, plus exact planners for inclusion chances, missing classes, fold sizes, bootstraps and reservoirs. They read only what is pasted, and the same seed gives the same result in every browser.",
  features: [
    tool("sample_lines", "Seeded sample of n lines", "Draws n different lines at random (Floyd's method driven by the seed), listed in their pasted order. The same seed and lines always give the same sample.",
      [LINES, count("n", "Lines to draw", { min: 1 }), SEED], ({ lines, n, seed }) => {
        const items = readLines(lines);
        if (n > items.length) fail(`Cannot draw ${n} of ${plural(items.length, "line")}.`);
        const chosen = sampleIndexes(items.length, n, seed);
        return { text: textOf(items, chosen), note: `${n} of ${plural(items.length, "line")}: lines ${lineList(items, chosen)}. ${seeded(seed)}` };
      }),
    tool("shuffle_lines", "Seeded shuffle of lines", "Puts the lines in a random order (a Fisher-Yates shuffle driven by the seed), for example to label rows in an order that does not follow their source. The same seed always gives the same order.",
      [LINES, SEED], ({ lines, seed }) => {
        const items = readLines(lines);
        return { text: shuffled(items, seed).map((item) => item.text).join("\n"), note: `${plural(items.length, "line")} reordered. ${seeded(seed)}` };
      }),
    tool("stratified_proportional", "Stratified sample in proportion to each class", "Draws n lines so each class (from the label column pasted beside them) keeps its share: each class gets its share of n rounded down, and the lines left over go to the largest remainders (earlier classes first on ties). Within a class the lines are a seeded random sample.",
      [LINES, LABEL_COLUMN, count("n", "Lines to draw in all", { min: 1 }), SEED], ({ lines, labels, n, seed }) => {
        const items = readPairs(lines, labels, "label");
        if (n > items.length) fail(`Cannot draw ${n} of ${plural(items.length, "line")}.`);
        const classes = groupBy(items, (item) => item.value);
        const quotas = proportional(classes.map((group) => group.members.length), items.length, n);
        const chosen = takeQuotas(items, groupIndex(items, classes), quotas, seed);
        const missing = classes.filter((group, g) => quotas[g] === 0).map((group) => group.name);
        return { table: { columns: ["Class", "Lines", "Drawn"], rows: classes.map((group, g) => [group.name, group.members.length, quotas[g]]) },
          text: textOf(items, chosen),
          note: `${n} of ${plural(items.length, "line")} across ${plural(classes.length, "class", "classes")}.${missing.length ? ` Too small for a line at this size: ${missing.join(", ")}.` : ""} ${seeded(seed)}` };
      }),
    tool("stratified_equal", "Stratified sample with equal lines per class", "Draws the same number of lines from every class in the label column pasted beside the lines (all of a class's lines when it has fewer), so rare classes are as well represented as common ones. Within a class the lines are a seeded random sample.",
      [LINES, LABEL_COLUMN, count("perClass", "Lines per class", { min: 1 }), SEED], ({ lines, labels, perClass, seed }) => {
        const items = readPairs(lines, labels, "label");
        const classes = groupBy(items, (item) => item.value);
        const quotas = classes.map((group) => Math.min(perClass, group.members.length));
        const chosen = takeQuotas(items, groupIndex(items, classes), quotas, seed);
        const short = classes.filter((group) => group.members.length < perClass).map((group) => group.name);
        return { table: { columns: ["Class", "Lines", "Drawn"], rows: classes.map((group, g) => [group.name, group.members.length, quotas[g]]) },
          text: textOf(items, chosen),
          note: `${plural(chosen.length, "line")} from ${plural(classes.length, "class", "classes")}.${short.length ? ` Fewer than ${perClass} lines, all taken: ${short.join(", ")}.` : ""} ${seeded(seed)}` };
      }),
    tool("holdout_split", "Held-out split that keeps identical lines together", "Holds out whole groups of identical lines nearest the share you ask for, leaving at least two lines on each side, by the Workbench test split's method: groups in a seeded order, the first combination reaching each count, then the count closest to the target (the larger on a tie). The shuffle is this page's, so it will not reproduce a split the Workbench drew.",
      [LINES, share("share", "Share to hold out", { default: 0.25 }), SEED, IDENTITY], ({ lines, share: wanted, seed, identity }) => {
        const items = readLines(lines, MAX_SPLIT_LINES), total = items.length;
        if (!(wanted > 0 && wanted < 1)) fail("The share to hold out must be strictly between 0 and 1.");
        if (total < 4) fail("A split needs at least 4 lines: two on each side.");
        const groups = groupBy(items, (item, index) => identityOf(item, index, identity));
        const reached = new Map([[0, null]]);   // count -> { group, from } (the last group added and the count before it)
        const counts = [0];                     // the reached counts in the order they were first reached
        for (const group of shuffled(groups, seed)) {
          if (counts.length === total - 1) break;   // every count from 0 to total - 2 is already reached
          for (let i = 0, before = counts.length; i < before; i++) {
            const next = counts[i] + group.members.length;
            if (next <= total - 2 && !reached.has(next)) { reached.set(next, { group, from: counts[i] }); counts.push(next); }
          }
        }
        const feasible = [...reached.keys()].filter((counted) => counted >= 2);
        if (!feasible.length) fail("Identical lines must stay together: no split leaves at least two lines on each side. Add lines with distinct inputs.");
        const target = wanted * total;
        const held = feasible.reduce((best, counted) => {
          const gap = Math.abs(counted - target), bestGap = Math.abs(best - target);
          return gap < bestGap || (gap === bestGap && counted > best) ? counted : best;
        });
        const side = new Array(total).fill("tuning");
        for (let at = held; at > 0;) {
          const step = reached.get(at);
          for (const index of step.group.members) side[index] = "held out";
          at = step.from;
        }
        const out = range(total).filter((index) => side[index] === "held out");
        return { rows: [["Held-out lines", held], ["Tuning lines", total - held], ["Held-out share", held / total]],
          table: sideTable(items, side), text: textOf(items, out),
          note: `Target ${round(target, 2)} of ${plural(total, "line")} in ${plural(groups.length, "group")}; identical lines stay on one side. ${seeded(seed)}` };
      }),
    tool("three_way_split", "Tuning, validation and test split that keeps identical lines together", "Splits lines three ways by share: groups of identical lines in a seeded order, larger groups first, each going whole to the side furthest below its target (tuning, then validation, then test on ties).",
      [LINES, share("validation", "Validation share", { default: 0.15 }), share("test", "Test share", { default: 0.15 }), SEED, IDENTITY], ({ lines, validation, test, seed, identity }) => {
        const items = readLines(lines), total = items.length;
        if (!(validation > 0 && test > 0 && validation + test < 1)) fail("The validation and test shares must be above 0 and add up to less than 1.");
        if (total < 3) fail("Paste at least 3 lines.");
        const names = ["tuning", "validation", "test"], targets = [(1 - validation - test) * total, validation * total, test * total], counts = [0, 0, 0];
        const side = new Array(total);
        for (const group of largestFirst(groupBy(items, (item, index) => identityOf(item, index, identity)), seed)) {
          let pick = 0;
          for (let s = 1; s < 3; s++) if (targets[s] - counts[s] > targets[pick] - counts[pick]) pick = s;
          counts[pick] += group.members.length;
          for (const index of group.members) side[index] = names[pick];
        }
        const empty = names.filter((name, s) => counts[s] === 0);
        return { rows: names.flatMap((name, s) => [[`${name[0].toUpperCase()}${name.slice(1)} lines`, counts[s]], [`${name[0].toUpperCase()}${name.slice(1)} share`, counts[s] / total]]),
          table: sideTable(items, side),
          note: `${plural(total, "line")}; identical lines stay on one side.${empty.length ? ` No lines went to ${empty.join(" or ")}: paste more lines or raise its share.` : ""} ${seeded(seed)}` };
      }),
    tool("kfold_groups", "Fold for each line, keeping identical lines together", "Assigns every line to one of k cross-validation folds as the Workbench's cross-validation does: groups of identical lines, larger groups first, each to the fold with the fewest lines (the lower fold on ties). Groups of the same size go in a seeded order here (the Workbench orders them by an input hash), so folds can differ from the Workbench's. Lists each fold's size.",
      [LINES, FOLDS, SEED, IDENTITY], ({ lines, folds, seed, identity }) => {
        const items = readLines(lines);
        const groups = groupBy(items, (item, index) => identityOf(item, index, identity));
        if (groups.length < folds) fail(`${folds} folds need at least ${folds} distinct lines; there ${groups.length === 1 ? "is" : "are"} ${groups.length}.`);
        const sizes = new Array(folds).fill(0), foldOf = new Array(items.length);
        for (const group of largestFirst(groups, seed)) {
          let fold = 0;
          for (let f = 1; f < folds; f++) if (sizes[f] < sizes[fold]) fold = f;
          sizes[fold] += group.members.length;
          for (const index of group.members) foldOf[index] = fold + 1;
        }
        return { rows: sizes.map((size, f) => [`Fold ${f + 1} lines`, size]),
          table: { columns: ["Line", "Fold"], rows: items.map((item, index) => [item.line, foldOf[index]]) }, note: seeded(seed) };
      }),
    tool("stratified_kfold", "Stratified folds by label", "Assigns lines to k folds so every class in the pasted label column spreads evenly across them: a seeded order, grouped by class (in order of first appearance), dealt to folds 1, 2, … k in turn. Identical lines are not kept together here; the note counts any that were split.",
      [LINES, LABEL_COLUMN, FOLDS, SEED], ({ lines, labels, folds, seed }) => {
        const items = readPairs(lines, labels, "label");
        if (items.length < folds) fail(`${folds} folds need at least ${folds} lines.`);
        const classes = groupBy(items, (item) => item.value), classOf = groupIndex(items, classes);
        const order = shuffled(range(items.length), seed).sort((a, b) => classOf[a] - classOf[b]);
        const foldOf = new Array(items.length), sizes = new Array(folds).fill(0);
        order.forEach((index, position) => { foldOf[index] = (position % folds) + 1; sizes[position % folds] += 1; });
        const split = groupBy(items, (item) => item.text).filter((group) => new Set(group.members.map((index) => foldOf[index])).size > 1).length;
        return { rows: sizes.map((size, f) => [`Fold ${f + 1} lines`, size]),
          table: { columns: ["Line", "Class", "Fold"], rows: items.map((item, index) => [item.line, item.value, foldOf[index]]) },
          note: `${split ? `${plural(split, "group")} of identical lines landed in more than one fold. ` : ""}${seeded(seed)}` };
      }),
    tool("systematic_sample", "Systematic sample of every k-th line", "Takes every k-th line (counting only nonblank lines) from a start between 1 and k. Leave the start blank to draw it with the seed; a systematic sample follows any pattern in the line order, so shuffle first if the order has one.",
      [LINES, count("step", "Every k-th line (k)", { min: 1 }), count("start", "Start at line (blank to draw)", { min: 1, optional: true }), SEED], ({ lines, step, start, seed }) => {
        const items = readLines(lines);
        if (start !== null && start > step) fail("The start must be at most k.");
        const first = start ?? 1 + Math.floor(mulberry32(seed)() * step);
        const chosen = range(items.length).filter((index) => index + 1 >= first && (index + 1 - first) % step === 0);
        if (!chosen.length) fail(`There is no line ${first}: paste more lines or choose an earlier start.`);
        return { rows: [["Start", first], ["Lines drawn", chosen.length]], text: textOf(items, chosen),
          note: `${step === 1 ? "Every line" : `One line in every ${step}`}, from line ${first}, of ${plural(items.length, "nonblank line")}${start === null ? `, start drawn with seed ${seed}` : ""}.` };
      }),
    tool("weighted_sample", "Weighted seeded sample", "Draws n different lines with chances in proportion to the weights pasted beside them (Efraimidis and Spirakis' method: each line's key is u^(1/weight) for a seeded random u, and the n largest keys win). A weight of 0 is never drawn.",
      [LINES, WEIGHT_COLUMN, count("n", "Lines to draw", { min: 1 }), SEED], ({ lines, weights, n, seed }) => {
        const items = readPairs(lines, weights, "weight");
        const values = items.map((item) => {
          const weight = toNumber(item.value);
          if (weight === null || weight < 0) fail(`Line ${item.line}: the weight must be a number of 0 or more.`);
          return weight;
        });
        const positive = values.filter((weight) => weight > 0).length;
        if (n > positive) fail(`Cannot draw ${n} lines: only ${plural(positive, "line has", "lines have")} a weight above 0.`);
        const random = mulberry32(seed);
        const keys = values.map((weight) => { const u = random(); return weight > 0 ? Math.log(u) / weight : null; });
        const chosen = range(items.length).filter((index) => keys[index] !== null).sort((a, b) => keys[b] - keys[a] || a - b).slice(0, n);
        const total = values.reduce((a, b) => a + b, 0);
        return { text: textOf(items, chosen), note: `${n} of ${plural(positive, "weighted line")} (total weight ${round(total, 6)}): lines ${lineList(items, chosen)}. ${seeded(seed)}` };
      }),
    tool("balanced_slices", "Balanced sample across slices", "Draws n Bulk rows (a text line is the row {\"text\": line}) spread as evenly as possible across the values of one input field (its full value, so the number 1 and the text \"1\" differ; rows without the field form their own slice): every slice gets an equal share, a slice with fewer rows gives all of them and passes the rest on, and leftover rows go to the larger slices first.",
      [ROWS, FIELD, count("n", "Rows to draw in all", { min: 1 }), SEED], ({ lines, field, n, seed }) => {
        const name = fieldName(field), items = readLines(lines);
        if (n > items.length) fail(`Cannot draw ${n} of ${plural(items.length, "row")}.`);
        const slices = groupBy(items, (item) => fieldValue(item, name)?.key ?? "\u0000missing", (item) => fieldValue(item, name)?.name ?? MISSING);
        const sizes = slices.map((slice) => slice.members.length), quotas = sizes.map(() => 0);
        let open = range(slices.length), left = n;
        for (;;) {
          const each = Math.floor(left / open.length), full = open.filter((s) => sizes[s] <= each);
          if (!full.length) {
            for (const s of open) quotas[s] = each;
            const extra = open.slice().sort((a, b) => sizes[b] - sizes[a] || a - b).slice(0, left - each * open.length);
            for (const s of extra) quotas[s] += 1;
            break;
          }
          for (const s of full) { quotas[s] = sizes[s]; left -= sizes[s]; }
          open = open.filter((s) => !full.includes(s));
          if (!open.length) break;
        }
        const chosen = takeQuotas(items, groupIndex(items, slices), quotas, seed);
        return { table: { columns: ["Slice", "Rows", "Drawn"], rows: slices.map((slice, s) => [truncate(slice.name, 60), sizes[s], quotas[s]]) },
          text: textOf(items, chosen), note: `${n} of ${plural(items.length, "row")} across ${plural(slices.length, "slice")} of ${name}. ${seeded(seed)}` };
      }),
    tool("cluster_sample", "Seeded sample of whole groups by a field", "Draws g values of one input field (for example a customer or thread) at random and keeps every Bulk row with those values, so rows that belong together are sampled together. Rows without the field are left out.",
      [ROWS, FIELD, count("groups", "Values to draw", { min: 1 }), SEED], ({ lines, field, groups: wanted, seed }) => {
        const name = fieldName(field), items = readLines(lines);
        const groups = groupBy(items, (item) => fieldValue(item, name)?.key ?? null, (item) => fieldValue(item, name).name);
        if (!groups.length) fail(`No row has the field ${name}.`);
        if (wanted > groups.length) fail(`Cannot draw ${wanted} of ${plural(groups.length, "value")}.`);
        const picked = sampleIndexes(groups.length, wanted, seed).map((g) => groups[g]);
        const chosen = picked.flatMap((group) => group.members);
        const without = items.length - groups.reduce((sum, group) => sum + group.members.length, 0);
        return { table: { columns: ["Value", "Rows"], rows: picked.map((group) => [truncate(group.name, 60), group.members.length]) }, text: textOf(items, chosen),
          note: `${wanted} of ${plural(groups.length, "value")}: ${plural(chosen.length, "row")}.${without ? ` ${plural(without, "row")} without ${name} left out.` : ""} ${seeded(seed)}` };
      }),
    tool("sample_new_lines", "Seeded sample of new inputs not yet saved", "Draws n new inputs from candidate lines: lines whose input is already among the saved rows are left out, and repeated candidates count once (their first line). Useful for picking the next rows to label without relabeling saved ones.",
      [{ ...LINES, label: "Candidate lines" }, { name: "saved", label: "Saved rows (optional)", type: "textarea", placeholder: '{"text": "Where is my order?", "_expect": {"department": "shipping"}}' },
        count("n", "Inputs to draw", { min: 1 }), SEED, { ...IDENTITY, label: "Lines match when they have the", options: IDENTITY_OPTIONS }], ({ lines, saved, n, seed, identity }) => {
        const items = readLines(lines);
        const savedKeys = new Set(splitLines(saved).map((raw) => raw.trim()).filter(Boolean).map((text, index) => identityOf({ text }, index, identity)));
        const groups = groupBy(items, (item, index) => identityOf(item, index, identity));
        const fresh = groups.filter((group) => !savedKeys.has(group.key));
        const known = items.length - fresh.reduce((sum, group) => sum + group.members.length, 0);
        if (n > fresh.length) fail(`Cannot draw ${n}: there ${fresh.length === 1 ? "is" : "are"} ${plural(fresh.length, "new input")}.`);
        const chosen = sampleIndexes(fresh.length, n, seed).map((g) => fresh[g].members[0]);
        return { rows: [["Candidate lines", items.length], ["Lines already saved", known], ["Repeated candidate lines", items.length - known - fresh.length], ["New inputs", fresh.length], ["Inputs drawn", n]],
          text: textOf(items, chosen), note: seeded(seed) };
      }),
    tool("nested_samples", "Nested samples for a learning curve", "Seeded samples of growing sizes where each smaller sample sits inside every larger one (the first lines of one seeded order), so results at 25, 50 and 100 rows differ only by the rows added. Lists the smallest sample each line joins.",
      [LINES, { name: "sizes", label: "Sample sizes (comma-separated)", type: "text", required: true, placeholder: "10, 20, 40" }, SEED], ({ lines, sizes: text, seed }) => {
        const items = readLines(lines);
        const sizes = [...new Set(String(text).split(/[\s,;]+/).filter(Boolean).map((part) => {
          const size = /^\d+$/.test(part) ? Number(part) : NaN;
          if (!(size >= 1 && size <= items.length)) fail(`Each size must be a whole number from 1 to ${items.length}; "${truncate(part, 12)}" is not.`);
          return size;
        }))].sort(byPosition);
        if (!sizes.length) fail("Enter at least one sample size.");
        const rank = new Array(items.length);
        shuffled(range(items.length), seed).forEach((index, position) => { rank[index] = position; });
        return { rows: sizes.map((size, s) => [`Lines added at ${size}`, size - (s ? sizes[s - 1] : 0)]),
          table: { columns: ["Line", "First in sample of"], rows: items.map((item, index) => [item.line, sizes.find((size) => rank[index] < size) ?? "—"]) },
          note: seeded(seed) };
      }),
    tool("alternate_classes", "Labeling order that alternates classes", "Orders lines so the classes in the pasted label column take turns (in order of first appearance), each class's lines in a seeded order; when a class runs out the others carry on. Avoids long runs of one class in a labeling session.",
      [LINES, LABEL_COLUMN, SEED], ({ lines, labels, seed }) => {
        const items = readPairs(lines, labels, "label");
        const classes = groupBy(items, (item) => item.value), classOf = groupIndex(items, classes);
        const queues = classes.map(() => []);
        for (const index of shuffled(range(items.length), seed)) queues[classOf[index]].push(index);
        const order = [];
        for (let turn = 0; order.length < items.length; turn++) for (const queue of queues) if (turn < queue.length) order.push(queue[turn]);
        return { text: order.map((index) => items[index].text).join("\n"), note: `${plural(classes.length, "class", "classes")} taking turns. ${seeded(seed)}` };
      }),
    tool("bootstrap_resample", "Bootstrap resample with its seed", "Draws lines with replacement (each draw picks any line with equal chance, from the seed), as many as there are lines unless you give a size, in draw order. Reports how many lines were drawn at least once and how many never (out of bag).",
      [LINES, count("draws", "Draws (blank for one per line)", { min: 1, max: MAX_DRAWS, optional: true }), SEED], ({ lines, draws, seed }) => {
        const items = readLines(lines), size = draws ?? items.length, random = mulberry32(seed);
        const picks = range(size).map(() => Math.floor(random() * items.length));
        const distinct = new Set(picks).size;
        return { rows: [["Draws", size], ["Distinct lines drawn", distinct], ["Lines never drawn (out of bag)", items.length - distinct]],
          text: picks.map((index) => items[index].text).join("\n"), note: seeded(seed) };
      }),
    tool("bootstrap_coverage", "Expected coverage of a bootstrap", "For m draws with replacement from N lines: the expected distinct lines drawn N(1 − (1 − 1/N)^m), the expected share never drawn (about 36.8% when m = N), and the chance a given line is drawn twice or more.",
      [count("total", "Lines (N)", { min: 1 }), count("draws", "Draws (m, blank for N)", { min: 1, optional: true })], ({ total, draws }) => {
        const m = draws ?? total;
        const never = total === 1 ? 0 : Math.exp(m * Math.log1p(-1 / total));
        const once = total === 1 ? (m === 1 ? 1 : 0) : m / total * Math.exp((m - 1) * Math.log1p(-1 / total));
        return [["Expected distinct lines drawn", total * (1 - never)], ["Expected share never drawn", never], ["Chance a given line is drawn twice or more", Math.max(0, 1 - never - once)]];
      }),
    tool("inclusion_chances", "Inclusion chances without replacement", "For a simple random sample of n from N lines: the chance a given line is drawn (n/N), the chance two given lines both are, the weight each drawn line stands for (N/n), the finite population correction to a variance ((N − n)/(N − 1)) and how many different samples are possible.",
      [count("total", "Lines (N)", { min: 1 }), count("n", "Sample size (n)", { min: 1 })], ({ total, n }) => {
        if (n > total) fail("The sample cannot be larger than the lines.");
        const possible = choose(total, n);
        return [["Chance a given line is drawn", n / total], ["Chance two given lines are both drawn", total < 2 ? null : n * (n - 1) / (total * (total - 1))],
          ["Lines each drawn line stands for", total / n], ["Finite population correction (variance)", total < 2 ? null : (total - n) / (total - 1)],
          ["Possible samples", possible], ["Possible samples (log10)", logChoose(total, n) / Math.LN10]];
      }),
    tool("class_missing", "Chance a class is missing from a sample", "With N lines of which a share belong to a class, drawn without replacement: the chance a sample (or held-out side) of n lines has none of the class, the chance the rest has none, and the chance one side of the split lacks it. Exact hypergeometric; the class count is the share of N rounded.",
      [count("total", "Lines (N)", { min: 2 }), share("classShare", "Class share"), count("n", "Sample size (n)", { min: 1 })], ({ total, classShare, n }) => {
        if (n > total) fail("The sample cannot be larger than the lines.");
        const k = round(classShare * total);
        if (k < 1) fail("At that share the class has no lines.");
        const none = hypergeometricPmf(0, total, k, n), rest = hypergeometricPmf(k, total, k, n);
        return [["Class lines", k], ["Expected class lines in the sample", n * k / total], ["Chance the sample has none", none], ["Chance the rest has none", rest],
          ["Chance one side lacks the class", none + rest]];
      }),
    tool("fold_class_coverage", "Chance a class is missing from some fold", "With K lines of a class among N split at random into k folds as evenly as possible: the chance the smallest fold has none, the expected folds without the class, and the chance at least one fold has none (inclusion-exclusion; exact up to rounding).",
      [count("total", "Lines (N)", { min: 2 }), count("k", "Class lines (K)", { min: 1 }), FOLDS], ({ total, k, folds }) => {
        if (k > total) fail("The class cannot have more lines than there are.");
        if (folds > total) fail("There cannot be more folds than lines.");
        const small = Math.floor(total / folds), big = Math.ceil(total / folds), bigFolds = total % folds, smallFolds = folds - bigFolds;
        let some = 0;
        for (let a = 0; a <= bigFolds; a++) {
          for (let b = 0; b <= smallFolds; b++) {
            if (!a && !b) continue;
            const left = total - a * big - b * small;
            if (left < k) continue;
            some += ((a + b) % 2 ? 1 : -1) * choose(bigFolds, a) * choose(smallFolds, b) * ratio(left, total, k);
          }
        }
        some = Math.min(1, Math.max(0, some));
        return [["Lines per fold", small === big ? String(small) : `${small} to ${big}`], ["Chance the smallest fold lacks the class", ratio(total - small, total, k)],
          ["Expected folds without the class", bigFolds * ratio(total - big, total, k) + smallFolds * ratio(total - small, total, k)],
          ["Chance at least one fold lacks the class", some], ["Chance every fold has the class", 1 - some]];
      }),
    tool("folds_plan", "Folds and lines per fold for a dataset size", "How N lines divide into k folds as evenly as possible: the fold sizes, how many folds take the larger size, the lines each round tunes on, and how many folds the data allows when each fold needs at least m lines (the Workbench needs 2 labeled rows per fold).",
      [count("total", "Lines (N)", { min: 1 }), { ...FOLDS, max: 1000 }, count("minimum", "Lines needed per fold (m)", { min: 1, default: 2 })], ({ total, folds, minimum }) => {
        if (folds > total) fail("There cannot be more folds than lines.");
        const small = Math.floor(total / folds), big = Math.ceil(total / folds);
        return [["Largest fold", big], ["Smallest fold", small], ["Folds of the largest size", total % folds || folds], ["Tuning lines per round, fewest", total - big],
          ["Tuning lines per round, most", total - small], [`Most folds with at least ${minimum} lines each`, Math.floor(total / minimum)], [`Lines needed for ${folds} folds of ${minimum}`, folds * minimum]];
      }),
    tool("sample_overlap", "Overlap between two independent samples", "When two samples are drawn independently from the same N lines (say a second-labeler sample and an audit sample): the expected lines in both, its standard deviation, the chance they share none and the smallest overlap possible. Exact hypergeometric.",
      [count("total", "Lines (N)", { min: 1 }), count("first", "First sample size", { min: 0 }), count("second", "Second sample size", { min: 0 })], ({ total, first, second }) => {
        if (first > total || second > total) fail("A sample cannot be larger than the lines.");
        const p = first / total;
        const sd = total < 2 ? 0 : Math.sqrt(second * p * (1 - p) * (total - second) / (total - 1));
        const none = hypergeometricPmf(0, total, first, second);
        return [["Expected lines in both", first * second / total], ["Standard deviation", sd], ["Chance they share none", none], ["Chance they share at least one", 1 - none],
          ["Smallest possible overlap", Math.max(0, first + second - total)]];
      }),
    tool("reservoir_check", "Reservoir sample of a stream", "A reservoir of k lines kept while reading a stream of N (each line i > k replaces a random kept line with chance k/i) ends as a simple random sample: each line is kept with chance k/N. Also the expected replacements, k(H_N − H_k), which is the writes beyond the first k.",
      [count("total", "Lines in the stream (N)", { min: 1 }), count("k", "Reservoir size (k)", { min: 1 })], ({ total, k }) => {
        const replacements = total <= k ? 0 : k * harmonicGap(k, total);
        return [["Chance each line ends in the reservoir", Math.min(1, k / total)], ["Lines kept", Math.min(k, total)], ["Expected replacements", replacements],
          ["Expected writes in all", Math.min(k, total) + replacements]];
      }),
    tool("seeded_integers", "Seeded random whole numbers", "Whole numbers between a low and a high value (both included) from the seed, for example row numbers to audit; with Different numbers the draws do not repeat and are listed in ascending order. The same seed always gives the same numbers.",
      [count("n", "How many", { min: 1, max: MAX_DRAWS }), { name: "low", label: "Lowest", type: "integer", default: 1 }, { name: "high", label: "Highest", type: "integer" },
        { name: "distinct", label: "Different numbers", type: "checkbox" }, SEED], ({ n, low, high, distinct, seed }) => {
        if (high < low) fail("The highest number must be at least the lowest.");
        const width = high - low + 1;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(low) || !Number.isSafeInteger(high)) fail("The range is too large.");
        if (width > 4294967296) fail("The range can hold at most 4294967296 numbers (the seeded generator's 2^32 values).");
        let numbers;
        if (distinct) {
          if (n > width) fail(`There are only ${width} different numbers from ${low} to ${high}.`);
          numbers = sampleIndexes(width, n, seed).map((offset) => low + offset);
        } else {
          const random = mulberry32(seed);
          numbers = range(n).map(() => low + Math.floor(random() * width));
        }
        return { text: numbers.join("\n"), note: seeded(seed) };
      }),
  ],
});

