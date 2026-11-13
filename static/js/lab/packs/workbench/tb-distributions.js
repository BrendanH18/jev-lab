// Toolbox: measures of one answer's probability distribution (a Choice answer's options, a Score legend's levels) and
// comparisons between two or more distributions. Every tool is pure: it reads only what is typed or pasted into its
// form, never page data, and never calls the model.
import { compareText, definePack, toNumber } from "../../kit.js";

const GROUP = "Answer distributions";
const MAX_OPTIONS = 10000;
const SUM_TOLERANCE = 0.02;
const FORMAT = "Paste option=probability pairs (refund=0.7, exchange=0.2, other=0.1, or one per line; option: probability works too), "
  + "a two-column option,probability table, a JSON object, or a plain list of probabilities (options are then named 1, 2, 3, …). "
  + `Probabilities that add up to within ${SUM_TOLERANCE} of 1 are rescaled to 1.`;
const SCORE_FORMAT = "Paste level=probability pairs (1=0.1, 2=0.3, 3=0.6), a two-column level,probability table, a JSON object, or a plain list for levels 1, 2, 3, …; "
  + `levels must be numbers. Probabilities that add up to within ${SUM_TOLERANCE} of 1 are rescaled to 1.`;

const ANSWER = { name: "answer", label: "Answer distribution", type: "textarea", rows: 5, required: true, placeholder: "refund=0.7, exchange=0.2, other=0.1" };
const LEGEND = { name: "answer", label: "Score probabilities by level", type: "textarea", rows: 5, required: true, placeholder: "1=0.05, 2=0.1, 3=0.25, 4=0.4, 5=0.2" };
const FIRST = { name: "first", label: "First distribution", type: "textarea", rows: 4, required: true, placeholder: "refund=0.7, exchange=0.2, other=0.1" };
const SECOND = { name: "second", label: "Second distribution", type: "textarea", rows: 4, required: true, placeholder: "refund=0.5, exchange=0.3, other=0.2" };
const UNIT = { name: "unit", label: "Unit", type: "select", options: [["bits", "bits (log base 2)"], ["nats", "nats (natural log)"]], default: "bits" };

// ---------- parsing ----------

const shown = (text) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);
const brief = (x) => String(Number(x.toPrecision(6)));

function valueOf(cell, where) {
  const value = toNumber(cell);
  if (value === null) throw new Error(`${where}: "${shown(cell)}" is not a number.`);
  if (value < 0) throw new Error(`${where}: ${shown(cell)} is negative; probabilities and weights cannot be.`);
  return value;
}

// One line's cells: split on its first delimiter found among tab, semicolon and comma, else on spaces.
function splitCells(line) {
  for (const delimiter of ["\t", ";", ","]) if (line.includes(delimiter)) return line.split(delimiter).map((cell) => cell.trim());
  return line.trim().split(/\s+/);
}

// [[name, value, where], ...] from any of the accepted shapes, before any sum check.
function entriesOf(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  if (source.startsWith("{")) {
    let object;
    try { object = JSON.parse(source); } catch { throw new Error("The text starts with { but is not valid JSON."); }
    if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("The JSON must be an object of option: probability.");
    return Object.entries(object).map(([name, value]) => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Option "${shown(name)}": the probability must be a number.`);
      return [name, valueOf(String(value), `Option "${shown(name)}"`), `Option "${shown(name)}"`];
    });
  }
  const lines = source.split(/\r\n|\n|\r/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim());
  if (/[=:]/.test(source)) {
    return lines.flatMap(({ line, number }) => {
      const parts = line.split(/[,;\t]+/).map((part) => part.trim()).filter(Boolean);
      return parts.map((part, at) => {
        const where = parts.length > 1 ? `Line ${number}, entry ${at + 1}` : `Line ${number}`;
        const cut = part.includes("=") ? part.lastIndexOf("=") : part.lastIndexOf(":");
        if (cut < 0) throw new Error(`${where}: "${shown(part)}" has no option name; write option=probability for every option.`);
        const name = part.slice(0, cut).trim();
        if (!name) throw new Error(`${where}: "${shown(part)}" has no option name.`);
        return [name, valueOf(part.slice(cut + 1).trim(), where), where];
      });
    });
  }
  let rows = lines.map(({ line, number }) => ({ cells: splitCells(line), number }));
  if (rows.length > 1 && rows[0].cells.length === 2 && rows[0].cells.every((cell) => toNumber(cell) === null)) rows = rows.slice(1);   // header
  const table = rows.every(({ cells }) => cells.length === 2) && (rows.length > 1 || toNumber(rows[0].cells[0]) === null);
  if (table) return rows.map(({ cells, number }) => [cells[0], valueOf(cells[1], `Line ${number}`), `Line ${number}`]);
  let index = 0;
  return rows.flatMap(({ cells, number }) => cells.map((cell, at) => [String(++index), valueOf(cell, cells.length > 1 ? `Line ${number}, value ${at + 1}` : `Line ${number}`), `Line ${number}`]));
}

// { names, p, total, rescaled } with names unique and, unless weights, p adding up to 1.
function parseDistribution(text, { weights = false, what = "the distribution" } = {}) {
  const entries = entriesOf(text);
  if (!entries.length) throw new Error(`Paste ${what}: option=probability pairs or a list of probabilities.`);
  if (entries.length > MAX_OPTIONS) throw new Error(`Paste at most ${MAX_OPTIONS.toLocaleString("en-US")} options.`);
  const seen = new Set();
  for (const [name, , where] of entries) {
    if (seen.has(name)) throw new Error(`${where}: the option "${shown(name)}" is listed twice.`);
    seen.add(name);
  }
  const names = entries.map(([name]) => name);
  let p = entries.map(([, value]) => value);
  const total = p.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error(`The values of ${what} add up to 0.`);
  if (weights) return { names, given: p, p: p.map((value) => value / total), total, rescaled: total !== 1 };
  if (Math.abs(total - 1) > SUM_TOLERANCE) throw new Error(`The probabilities of ${what} add up to ${brief(total)}, not 1. Rescale weights or scores with "Renormalize probabilities".`);
  const rescaled = Math.abs(total - 1) > 1e-12;
  if (rescaled) p = p.map((value) => value / total);
  return { names, p, total, rescaled };
}

// A Score legend: levels ascending with their probabilities.
function parseLegend(text) {
  const data = parseDistribution(text);
  const levels = data.names.map((name) => {
    const level = toNumber(name);
    if (level === null) throw new Error(`The level "${shown(name)}" is not a number; a Score legend needs numeric levels such as 1=0.2.`);
    return level;
  });
  const order = levels.map((_, i) => i).sort((a, b) => levels[a] - levels[b]);
  for (let i = 1; i < order.length; i++) if (levels[order[i]] === levels[order[i - 1]]) throw new Error(`The level ${levels[order[i]]} is listed twice.`);
  return { levels: order.map((i) => levels[i]), p: order.map((i) => data.p[i]), rescaled: data.rescaled };
}

// Two distributions over the union of their options (first's order, then the second's new ones); a missing option is 0.
function parsePair(params) {
  const first = parseDistribution(params.first, { what: "the first distribution" }), second = parseDistribution(params.second, { what: "the second distribution" });
  const names = [...first.names, ...second.names.filter((name) => !first.names.includes(name))];
  const pick = (data) => names.map((name) => { const at = data.names.indexOf(name); return at < 0 ? 0 : data.p[at]; });
  const only = names.filter((name) => !first.names.includes(name) || !second.names.includes(name)).length;
  return { names, p: pick(first), q: pick(second), only, rescaled: first.rescaled || second.rescaled };
}

const rescaledNote = (rescaled) => (rescaled ? "The probabilities did not add up to exactly 1 and were rescaled." : null);

// ---------- measures ----------

const LOG = { bits: Math.log2, nats: Math.log };
const entropyOf = (p, log = Math.log2) => p.reduce((total, value) => (value > 0 ? total - value * log(value) : total), 0);
// KL(p ‖ q); Infinity when q is 0 where p is not.
const klOf = (p, q, log = Math.log2) => p.reduce((total, value, i) => (value > 0 ? total + (q[i] > 0 ? value * (log(value) - log(q[i])) : Infinity) : total), 0);
// Options by probability, highest first; ties keep the order given.
const ranked = (data) => data.p.map((value, i) => i).sort((a, b) => data.p[b] - data.p[a] || a - b);
const finiteOr = (value) => (Number.isFinite(value) ? value : null);

function tool(id, title, help, inputs, compute) {
  return { id, kind: "tool", group: GROUP, title, help, inputs, compute };
}

// ---------- the pack ----------

export default definePack({
  id: "tb-distributions",
  surface: "workbench.toolbox",
  title: "Answer distribution measures",
  about: "Toolbox calculators for one answer's probabilities (entropy, margin, Gini impurity, top-k mass, effective options, a Score legend's expected value, median and cumulative probabilities) and for comparing answers (KL, Jensen-Shannon, total variation, Hellinger, disagreement). They read only the distributions you paste and never call the model.",
  features: [
    tool("entropy", "Entropy of an answer",
      `Shannon entropy −Σ p log p in bits and nats, and normalized by its maximum log₂(options): 0 when one option holds everything, 1 when all are equally likely. ${FORMAT}`,
      [ANSWER], (params) => {
        const data = parseDistribution(params.answer), k = data.p.length, bits = entropyOf(data.p);
        return { rows: [["Entropy (bits)", bits], ["Entropy (nats)", entropyOf(data.p, Math.log)], ["Normalized entropy (0 to 1)", k > 1 ? bits / Math.log2(k) : null],
          ["Largest possible (bits)", Math.log2(k)], ["Options", k]], note: rescaledNote(data.rescaled) };
      }),
    tool("top_two_margin", "Margin between the top two options",
      `The most likely option, the runner-up (the first listed among equal probabilities), the gap between them and their ratio. A small margin means the answer is torn between two options even when the top probability looks high. ${FORMAT}`,
      [ANSWER], (params) => {
        const data = parseDistribution(params.answer);
        if (data.p.length < 2) throw new Error("Paste at least two options.");
        const [top, next] = ranked(data);
        return { rows: [["Top option", data.names[top]], ["Top probability", data.p[top]], ["Runner-up", data.names[next]], ["Runner-up probability", data.p[next]],
          ["Margin", data.p[top] - data.p[next]], ["Ratio (top ÷ runner-up)", data.p[next] > 0 ? data.p[top] / data.p[next] : null]], note: rescaledNote(data.rescaled) };
      }),
    tool("gini_impurity", "Gini impurity",
      `1 − Σ p²: the chance that two independent draws from the answer disagree. Normalized by its maximum 1 − 1 ÷ options, it runs from 0 (certain) to 1 (uniform). ${FORMAT}`,
      [ANSWER], (params) => {
        const data = parseDistribution(params.answer), k = data.p.length;
        const agree = data.p.reduce((total, value) => total + value * value, 0);
        return { rows: [["Gini impurity", 1 - agree], ["Normalized (0 to 1)", k > 1 ? (1 - agree) / (1 - 1 / k) : null], ["Chance two draws agree", agree], ["Options", k]], note: rescaledNote(data.rescaled) };
      }),
    tool("top_k_mass", "Probability of the top k options",
      `The probability the k most likely options hold together (ties keep the order given) and what is left for the rest, such as how often a shortlist of k would contain the answer if the probabilities are calibrated. ${FORMAT}`,
      [ANSWER, { name: "k", label: "k (options)", type: "integer", min: 1, default: 2 }], (params) => {
        const data = parseDistribution(params.answer), order = ranked(data).slice(0, params.k);
        const mass = order.reduce((total, i) => total + data.p[i], 0);
        return { rows: [["Top options", order.map((i) => data.names[i]).join(", ")], ["Their probability", mass], ["Probability of the rest", Math.max(0, 1 - mass)], ["Options counted", order.length]],
          note: rescaledNote(data.rescaled) };
      }),
    tool("fewest_options_for_mass", "Fewest options holding a target probability",
      `The smallest set of most likely options whose probabilities add up to at least the target (ties keep the order given): a shortlist that holds the answer at that rate if the probabilities are calibrated. ${FORMAT}`,
      [ANSWER, { name: "target", label: "Target probability (0 to 1)", type: "number", min: 0, max: 1, default: 0.9 }], (params) => {
        const data = parseDistribution(params.answer), order = ranked(data);
        let mass = 0, taken = 0;
        while (taken < order.length && mass < params.target - 1e-12) mass += data.p[order[taken++]];
        return { rows: [["Options needed", taken], ["Options", order.slice(0, taken).map((i) => data.names[i]).join(", ")], ["Probability they hold", mass], ["Share of all options", taken / order.length]],
          note: rescaledNote(data.rescaled) };
      }),
    tool("expected_score", "Expected score and its spread",
      `For a Score answer: the expected level Σ level × p, the variance and standard deviation around it, and the lowest and highest levels with any probability. ${SCORE_FORMAT}`,
      [LEGEND], (params) => {
        const data = parseLegend(params.answer);
        const mean = data.levels.reduce((total, level, i) => total + level * data.p[i], 0);
        const variance = data.levels.reduce((total, level, i) => total + data.p[i] * (level - mean) ** 2, 0);
        const used = data.levels.filter((_, i) => data.p[i] > 0);
        return { rows: [["Expected score", mean], ["Variance", variance], ["Standard deviation", Math.sqrt(variance)], ["Lowest level with probability", used[0]], ["Highest level with probability", used[used.length - 1]]],
          note: rescaledNote(data.rescaled) };
      }),
    tool("score_mode_median", "Most likely and median level",
      `For a Score answer: the most likely level (the lowest of equally likely ones) and the median level, the lowest level whose cumulative probability reaches one half, with the probabilities at each. The median resists a long tail that drags the expected score. ${SCORE_FORMAT}`,
      [LEGEND], (params) => {
        const data = parseLegend(params.answer);
        let mode = 0;
        data.p.forEach((value, i) => { if (value > data.p[mode]) mode = i; });
        let cumulative = 0, median = data.levels.length - 1;
        for (let i = 0; i < data.levels.length; i++) { cumulative += data.p[i]; if (cumulative >= 0.5 - 1e-12) { median = i; break; } }
        const upTo = data.p.slice(0, median + 1).reduce((a, b) => a + b, 0);
        return { rows: [["Most likely level", data.levels[mode]], ["Its probability", data.p[mode]], ["Median level", data.levels[median]], ["Probability at or below the median", upTo]],
          note: rescaledNote(data.rescaled) };
      }),
    tool("score_cumulative", "Cumulative probabilities of a Score",
      `For each level of a Score answer, lowest first: its probability, the probability of a score at most that level, and of a score at least that level, the numbers a gate on "score ≥ level" reads. ${SCORE_FORMAT}`,
      [LEGEND], (params) => {
        const data = parseLegend(params.answer);
        let below = 0;
        return { table: { columns: ["Level", "Probability", "At most this level", "At least this level"], rows: data.levels.map((level, i) => {
          const atLeast = Math.max(0, 1 - below);
          below += data.p[i];
          return [level, data.p[i], Math.min(1, below), atLeast];
        }) }, note: rescaledNote(data.rescaled) };
      }),
    tool("kl_divergence", "KL divergence between two answers",
      `Kullback-Leibler divergence in both directions, Σ p log(p ÷ q), such as between one row's answers from two variants or before and after a wording change. It is not symmetric, and it is infinite (—) when one distribution gives 0 to an option the other does not. Options are matched by name; one missing from a distribution counts as 0. ${FORMAT}`,
      [FIRST, SECOND, UNIT], (params) => {
        const pair = parsePair(params), log = LOG[params.unit];
        return { rows: [["KL(first ‖ second)", finiteOr(klOf(pair.p, pair.q, log))], ["KL(second ‖ first)", finiteOr(klOf(pair.q, pair.p, log))], ["Options in only one distribution", pair.only]],
          note: rescaledNote(pair.rescaled) };
      }),
    tool("js_divergence", "Jensen-Shannon divergence and distance",
      `The symmetric, always finite comparison: the mean KL divergence of each distribution from their average. In bits it runs from 0 (same) to 1 (no option in common); its square root is the Jensen-Shannon distance, a true metric (scipy's jensenshannon with base 2). Options are matched by name; a missing one counts as 0. ${FORMAT}`,
      [FIRST, SECOND], (params) => {
        const pair = parsePair(params), middle = pair.p.map((value, i) => (value + pair.q[i]) / 2);
        const divergence = Math.max(0, (klOf(pair.p, middle) + klOf(pair.q, middle)) / 2);
        return { rows: [["Jensen-Shannon divergence (bits)", divergence], ["Jensen-Shannon distance", Math.sqrt(divergence)], ["Options in only one distribution", pair.only]], note: rescaledNote(pair.rescaled) };
      }),
    tool("total_variation", "Total variation distance",
      `Half the sum of absolute differences, ½ Σ |p − q|: the most probability any set of options gains or loses between the two answers, from 0 to 1. Also the option that changes most (the first listed among equal changes). Options are matched by name; a missing one counts as 0. ${FORMAT}`,
      [FIRST, SECOND], (params) => {
        const pair = parsePair(params);
        let distance = 0, most = 0;
        pair.p.forEach((value, i) => { distance += Math.abs(value - pair.q[i]); if (Math.abs(value - pair.q[i]) > Math.abs(pair.p[most] - pair.q[most]) + 1e-15) most = i; });
        return { rows: [["Total variation distance", distance / 2], ["Option that changes most", pair.names[most]], ["Its change (second − first)", pair.q[most] - pair.p[most]],
          ["Options in only one distribution", pair.only]], note: rescaledNote(pair.rescaled) };
      }),
    tool("hellinger_distance", "Hellinger distance",
      `√(1 − Σ √(p·q)), from 0 (same) to 1 (no option in common), with the Bhattacharyya coefficient Σ √(p·q) it is built on and the Bhattacharyya distance −ln of it (— when they share nothing). Options are matched by name; a missing one counts as 0. ${FORMAT}`,
      [FIRST, SECOND], (params) => {
        const pair = parsePair(params);
        const overlap = Math.min(1, pair.p.reduce((total, value, i) => total + Math.sqrt(value * pair.q[i]), 0));
        return { rows: [["Hellinger distance", Math.sqrt(Math.max(0, 1 - overlap))], ["Bhattacharyya coefficient", overlap], ["Bhattacharyya distance", overlap > 0 ? -Math.log(overlap) : null],
          ["Options in only one distribution", pair.only]], note: rescaledNote(pair.rescaled) };
      }),
    tool("renormalize", "Renormalize probabilities",
      "Rescales nonnegative values (probabilities that do not quite add up to 1, weights or counts) so they add up to exactly 1, keeping their proportions. Paste option=value pairs, a two-column option,value table, a JSON object or a plain list.",
      [{ ...ANSWER, label: "Values to rescale", placeholder: "refund=7, exchange=2, other=1" }], (params) => {
        const data = parseDistribution(params.answer, { weights: true, what: "the values" });
        return { rows: [["Sum of the values given", data.total], ["Options", data.p.length]],
          table: { columns: ["Option", "Given", "Probability"], rows: data.names.map((name, i) => [name, data.given[i], data.p[i]]) } };
      }),
    tool("effective_options", "Effective number of options",
      `How many equally likely options the answer behaves like: 2 to the entropy in bits (perplexity) and the inverse Simpson index 1 ÷ Σ p², both from 1 (certain) to the option count (uniform). ${FORMAT}`,
      [ANSWER], (params) => {
        const data = parseDistribution(params.answer);
        return { rows: [["Perplexity (2^entropy)", 2 ** entropyOf(data.p)], ["Inverse Simpson (1 ÷ Σ p²)", 1 / data.p.reduce((total, value) => total + value * value, 0)], ["Options", data.p.length]],
          note: rescaledNote(data.rescaled) };
      }),
    tool("answer_surprisal", "Score one answer against the right option",
      `For one answer and the option that was right: its probability, the surprisal −log₂ p in bits (the log loss of this row; — when p is 0), its rank (1 + options strictly more likely), the probability given to more likely options, and this row's multi-class Brier score Σ (p − right)². ${FORMAT}`,
      [ANSWER, { name: "right", label: "The right option", type: "text", required: true, placeholder: "refund" }], (params) => {
        const data = parseDistribution(params.answer), name = params.right.trim();
        const at = data.names.indexOf(name);
        if (at < 0) throw new Error(`"${shown(name)}" is not one of the options: ${data.names.slice(0, 20).join(", ")}${data.names.length > 20 ? ", …" : ""}.`);
        const p = data.p[at], above = data.p.filter((value) => value > p);
        return { rows: [["Probability of the right option", p], ["Surprisal (bits)", p > 0 ? -Math.log2(p) : null], ["Rank", 1 + above.length], ["Probability of more likely options", above.reduce((a, b) => a + b, 0)],
          ["Brier score of this answer", data.p.reduce((total, value, i) => total + (value - (i === at ? 1 : 0)) ** 2, 0)]], note: rescaledNote(data.rescaled) };
      }),
    tool("ensemble_disagreement", "Disagreement between several answers",
      "For several answers to the same question (reruns, variants or perturbed inputs), one per line: the entropy of their average, the mean of their own entropies, and the difference, the mutual information (BALD): how much the answers disagree with each other rather than each being unsure. In bits. Write each line as option=probability pairs separated by commas or semicolons, or as a plain list of probabilities in the same option order; every line needs the same options.",
      [{ name: "answers", label: "Answers, one per line", type: "textarea", rows: 6, required: true, placeholder: "refund=0.8, exchange=0.2\nrefund=0.3, exchange=0.7" }], (params) => {
        const lines = String(params.answers ?? "").split(/\r\n|\n|\r/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim());
        if (lines.length < 2) throw new Error("Paste at least two answers, one per line.");
        let names = null;
        const answers = lines.map(({ line, number }) => {
          let data;
          try { data = parseDistribution(line); } catch (error) {
            const rest = error.message.replace(/^Line 1(?:, |: )?/, "");
            throw new Error(`Line ${number}${rest.startsWith("entry") ? ", " : ": "}${rest}`);
          }
          const key = data.names.slice().sort(compareText).join("\u0000");
          if (names === null) names = { list: data.names, key };
          else if (key !== names.key) throw new Error(`Line ${number}: the options (${data.names.join(", ")}) differ from line ${lines[0].number}'s (${names.list.join(", ")}).`);
          return names.list.map((name) => data.p[data.names.indexOf(name)]);
        });
        const mean = names.list.map((_, k) => answers.reduce((total, p) => total + p[k], 0) / answers.length);
        const total = entropyOf(mean), expected = answers.reduce((sum, p) => sum + entropyOf(p), 0) / answers.length;
        const top = mean.reduce((best, value, k) => (value > mean[best] ? k : best), 0);
        return { rows: [["Answers", answers.length], ["Entropy of the average answer (bits)", total], ["Mean entropy of the answers (bits)", expected], ["Mutual information (bits)", Math.max(0, total - expected)],
          ["Top option of the average", names.list[top]], ["Its average probability", mean[top]]],
        table: { columns: ["Option", "Average probability"], rows: names.list.map((name, k) => [name, mean[k]]) } };
      }),
  ],
});
