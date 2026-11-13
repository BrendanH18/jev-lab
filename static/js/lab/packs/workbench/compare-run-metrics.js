// Run-level measures of the user's own Compare run for the scored question (surface "workbench.compare.rows"; contract
// in static/js/lab/surfaces/workbench-compare.js): paired statistics, calibration and confidence, and measured cost
// and latency per variant. Every metric reads every row of the run (not only the shown disagreements), makes no call
// and stores nothing. Measures that need each labeled row's right/wrong recompute it the way jev/calibrate.py scores a
// label and are shown only when that reading reproduces the report's own labeled and correct counts exactly.
import { definePack } from "../../kit.js";
import { binomialSf, normalQuantile, quantile } from "../../lib/math.js";

const NAMES = ["A", "B"];
const EDGES = ["left", "top", "right", "bottom"];
const Z95 = normalQuantile(0.975);
const EPS = 1e-9;          // jev/calibrate.py _EPS
const IOU_RIGHT = 0.5;     // jev/calibrate.py IOU_RIGHT
const CLIP = 1e-15;        // keeps a log loss finite when a stated probability is exactly 0 or 1

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const unit = (value) => (num(value) !== null && value >= 0 && value <= 1 ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const meanOf = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);
const rowsOf = (ctx) => (Array.isArray(ctx?.items?.()) ? ctx.items() : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (value) => (num(value) === null ? "—" : `${(value * 100).toFixed(1)}%`);
const pickOf = (item, v) => (Array.isArray(item?.picks) && typeof item.picks[v] === "string" ? item.picks[v] : null);
const answerOf = (item, v) => (Array.isArray(item?.answers) && isObject(item.answers[v]) ? item.answers[v] : null);
const signalOf = (item, v) => (Array.isArray(item?.signals) ? unit(item.signals[v]) : null);
const topOf = (item, v) => (Array.isArray(item?.tops) ? unit(item.tops[v]) : null);
const metaOf = (item, v) => (Array.isArray(item?.meta) && isObject(item.meta[v]) ? item.meta[v] : null);
const bothAnswered = (item) => answerOf(item, 0) !== null && answerOf(item, 1) !== null;

// The report's paired right/wrong counts, or null.
function pairedOf(ctx) {
  const paired = ctx?.data?.paired;
  if (!isObject(paired)) return null;
  const a = count(paired.a_only), b = count(paired.b_only), r = count(paired.both_right), w = count(paired.both_wrong);
  return a === null || b === null || r === null || w === null ? null : { a, b, r, w, n: a + b + r + w };
}

// A probability list keyed as picks are written (Choice option, Score level as text, Noul yes/no); null for Box.
function probsOf(answer) {
  if (!answer) return null;
  if (answer.type === "noul") {
    const p = unit(answer.noul);
    return p === null ? null : new Map([["yes", p], ["no", 1 - p]]);
  }
  if ((answer.type !== "choice" && answer.type !== "score") || !isObject(answer.probabilities)) return null;
  const out = new Map();
  for (const [key, p] of Object.entries(answer.probabilities)) {
    if (unit(p) === null) return null;
    if (answer.type === "score" && !/^\s*[+-]?\d+\s*$/.test(key)) return null;
    const name = answer.type === "score" ? String(Number.parseInt(key, 10)) : key;
    if (out.has(name)) return null;
    out.set(name, p);
  }
  return out.size ? out : null;
}

function edgesOf(box) {
  if (!isObject(box)) return null;
  const edges = EDGES.map((edge) => unit(box[edge]));
  return edges.some((edge) => edge === null) || !(edges[0] < edges[2] && edges[1] < edges[3]) ? null : edges;
}

function iou(a, b) {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

// The label in the answer's own terms (mirrors jev/calibrate.py _label), or undefined when that variant cannot score it.
function labelFor(type, label, answer) {
  if (type === "box") return edgesOf(label) ?? undefined;
  if (type === "choice") return typeof label === "string" && isObject(answer.probabilities) && Object.hasOwn(answer.probabilities, label) ? label : undefined;
  if (type === "noul") {
    if (typeof label === "boolean") return label;
    const text = String(label).trim().toLowerCase();
    return ["yes", "true", "1", "y"].includes(text) ? true : ["no", "false", "0", "n"].includes(text) ? false : undefined;
  }
  if (type !== "score" || typeof label === "boolean" || (typeof label === "string" && label.trim() === "")) return undefined;
  const level = typeof label === "number" || typeof label === "string" ? Number(label) : NaN;
  const levels = probsOf(answer);
  return Number.isInteger(level) && levels && levels.has(String(level)) ? level : undefined;
}

function isRight(type, truth, item, v) {
  const pick = pickOf(item, v);
  if (type === "box") {
    const box = edgesOf(answerOf(item, v).box);
    return box ? iou(truth, box) + EPS >= IOU_RIGHT : null;
  }
  if (type === "noul") return pick === "yes" || pick === "no" ? (pick === "yes") === truth : null;
  if (type === "score") return pick !== null && /^[+-]?\d+$/.test(pick) ? Number(pick) === truth : null;
  return pick === null ? null : pick === truth;
}

// The labeled rows both variants answered, each with whether A and B were right, or null when this local reading does
// not reproduce the report's labeled and correct counts (and its paired counts) exactly.
function scoredRows(ctx) {
  const type = ctx?.data?.type, scores = ctx?.data?.scores, paired = pairedOf(ctx);
  if (!["choice", "noul", "score", "box"].includes(type) || !Array.isArray(scores) || scores.length !== 2 || !paired) return null;
  const out = [];
  for (const item of rowsOf(ctx)) {
    if (!bothAnswered(item) || item.label === null || item.label === undefined) continue;
    const truths = [0, 1].map((v) => labelFor(type, item.label, answerOf(item, v)));
    if (truths.some((truth) => truth === undefined)) continue;
    const right = [0, 1].map((v) => (Array.isArray(item.correct) && typeof item.correct[v] === "boolean" ? item.correct[v] : isRight(type, truths[v], item, v)));
    if (right.some((value) => value === null)) return null;
    out.push({ item, right });
  }
  for (let v = 0; v < 2; v++) {
    if (count(scores[v]?.labeled) !== out.length || count(scores[v]?.correct) !== out.filter((row) => row.right[v]).length) return null;
  }
  const tally = (a, b) => out.filter((row) => row.right[0] === a && row.right[1] === b).length;
  if (tally(true, true) !== paired.r || tally(true, false) !== paired.a || tally(false, true) !== paired.b || tally(false, false) !== paired.w) return null;
  return out.length ? out : null;
}

// ---------- paired statistics ----------

// B minus A accuracy with the Agresti–Min interval: the paired Wald interval after adding 0.5 to each of the four cells.
function gain(ctx) {
  const paired = pairedOf(ctx);
  if (!paired || !paired.n) return null;
  const a = paired.a + 0.5, b = paired.b + 0.5, n = paired.n + 2;
  const centre = (b - a) / n;
  const spread = Z95 * Math.sqrt(Math.max(0, (a + b) - (b - a) ** 2 / n)) / n;
  return { value: (paired.b - paired.a) / paired.n, low: Math.max(-1, centre - spread), high: Math.min(1, centre + spread), n: paired.n };
}

function wilson(successes, trials) {
  const p = successes / trials, z2 = Z95 * Z95;
  const centre = (p + z2 / (2 * trials)) / (1 + z2 / trials);
  const half = Z95 * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / (1 + z2 / trials);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Exact two-sided McNemar p for k wins out of m discordant rows (k >= m / 2).
const mcnemarP = (k, m) => Math.min(1, 2 * binomialSf(k, m, 0.5));

// The probability-averaged pick of a row, or undefined when the two answers do not list the same options.
function averagedPick(item) {
  const a = probsOf(answerOf(item, 0)), b = probsOf(answerOf(item, 1));
  if (!a || !b || a.size !== b.size || [...a.keys()].some((key) => !b.has(key))) return undefined;
  let best = null, top = -Infinity;
  for (const [key, p] of a) {
    const mean = (p + b.get(key)) / 2;
    if (mean > top) { top = mean; best = key; }
  }
  if (answerOf(item, 0).type === "noul") return (a.get("yes") + b.get("yes")) / 2 >= 0.5 ? "yes" : "no";
  return best;
}

// ---------- per-variant helpers ----------

// The calls of variant v that returned without an error or a stop, with their measurements.
const returned = (ctx, v) => rowsOf(ctx).filter((item) => metaOf(item, v) && !(Array.isArray(item.errors) && item.errors[v]) && !(Array.isArray(item.skipped) && item.skipped[v]));

function auroc(rows, v) {
  const right = [], wrong = [];
  for (const row of rows) {
    const signal = signalOf(row.item, v);
    if (signal === null) return null;
    (row.right[v] ? right : wrong).push(signal);
  }
  if (!right.length || !wrong.length) return null;
  let wins = 0;
  for (const r of right) for (const w of wrong) wins += r > w ? 1 : r === w ? 0.5 : 0;
  return { value: wins / (right.length * wrong.length), detail: `${right.length} right, ${wrong.length} wrong` };
}

function perScored(rows, v, each) {
  if (!rows) return null;
  const values = rows.map((row) => each(row, v));
  return values.some((value) => value === null) ? null : values;
}

const perVariant = (id, label, help, format, compute) => NAMES.map((name, v) => ({ id: `${id}_${name.toLowerCase()}`, kind: "metric", format,
  label: label(name), help: help(name), compute: (ctx) => compute(ctx, v) }));

const NOTE = "Exploratory: small samples are rarely conclusive.";

export default definePack({
  id: "compare-run-metrics",
  surface: "workbench.compare.rows",
  title: "Compare run metrics",
  about: "Paired statistics, calibration and confidence, and measured cost and latency of both variants for the scored question, computed from every row of your own Compare run without any call. Right/wrong measures appear only when they reproduce the report's labeled and correct counts; the averaged and surer-variant accuracies are advisory rules computed in code.",
  features: [
    // ----- paired statistics -----
    { id: "accuracy_gain", kind: "metric", format: "percent", label: "B's accuracy gain over A",
      help: `B's accuracy minus A's on the labeled rows both answered, with a 95% Agresti–Min paired interval. ${NOTE}`,
      compute: (ctx) => {
        const result = gain(ctx);
        return result && { value: result.value, detail: `95% interval ${pct(result.low)} to ${pct(result.high)} over ${plural(result.n, "labeled pair")}` };
      } },
    { id: "b_win_share", kind: "metric", format: "percent", label: "B's share of the split rows",
      help: `Of the rows exactly one variant got right, the share B got right, with a 95% Wilson interval. 50% is no difference. ${NOTE}`,
      compute: (ctx) => {
        const paired = pairedOf(ctx);
        if (!paired || !(paired.a + paired.b)) return null;
        const [low, high] = wilson(paired.b, paired.a + paired.b);
        return { value: paired.b / (paired.a + paired.b), detail: `95% interval ${pct(low)} to ${pct(high)}` };
      } },
    { id: "error_reduction", kind: "metric", format: "percent", label: "Errors B removes relative to A",
      help: "(A's wrong answers - B's wrong answers) / A's wrong answers on the labeled rows both answered. Negative when B makes more mistakes.",
      compute: (ctx) => {
        const paired = pairedOf(ctx);
        if (!paired) return null;
        const errorsA = paired.b + paired.w, errorsB = paired.a + paired.w;
        return errorsA ? { value: (errorsA - errorsB) / errorsA, detail: `A wrong ${errorsA}, B wrong ${errorsB}` } : null;
      } },
    { id: "either_right", kind: "metric", format: "percent", label: "Rows at least one variant got right",
      help: "The accuracy ceiling for any rule that chooses between A's and B's answer row by row, such as a cascade.",
      compute: (ctx) => {
        const paired = pairedOf(ctx);
        return paired && paired.n ? { value: (paired.n - paired.w) / paired.n, detail: `${paired.n - paired.w} of ${paired.n}` } : null;
      } },
    { id: "a_covers_b", kind: "metric", format: "percent", label: "B's mistakes that A got right",
      help: "Of the labeled rows B got wrong, the share A answered correctly.",
      compute: (ctx) => {
        const paired = pairedOf(ctx);
        return paired && paired.a + paired.w ? { value: paired.a / (paired.a + paired.w), detail: `${paired.a} of ${paired.a + paired.w}` } : null;
      } },
    { id: "b_covers_a", kind: "metric", format: "percent", label: "A's mistakes that B got right",
      help: "Of the labeled rows A got wrong, the share B answered correctly.",
      compute: (ctx) => {
        const paired = pairedOf(ctx);
        return paired && paired.b + paired.w ? { value: paired.b / (paired.b + paired.w), detail: `${paired.b} of ${paired.b + paired.w}` } : null;
      } },
    { id: "wins_needed", kind: "metric", format: "integer", label: "Wins one variant needs for p < 0.05",
      help: "With this many split rows, the fewest that one variant must win for the exact two-sided McNemar test to reach p < 0.05. Unavailable when no split of this many rows can.",
      compute: (ctx) => {
        const paired = pairedOf(ctx);
        if (!paired) return null;
        const m = paired.a + paired.b;
        for (let k = Math.ceil(m / 2); k <= m && m > 0; k++) {
          if (mcnemarP(k, m) < 0.05) return { value: k, detail: `out of ${plural(m, "split row")}; the leader has ${Math.max(paired.a, paired.b)}` };
        }
        return { value: null, detail: `No split of ${plural(m, "row")} reaches p < 0.05.` };
      } },
    { id: "pick_kappa", kind: "metric", format: "number", label: "Agreement beyond chance (Cohen's kappa)",
      help: "How often A and B pick the same answer on the rows both answered, corrected for the agreement their pick mixes give by chance. 1 is full agreement, 0 chance level. Not for Box.",
      compute: (ctx) => {
        if (ctx?.data?.type === "box") return null;
        const pairs = rowsOf(ctx).filter(bothAnswered).map((item) => [pickOf(item, 0), pickOf(item, 1)]).filter(([a, b]) => a !== null && b !== null);
        if (!pairs.length) return null;
        const n = pairs.length, mix = [new Map(), new Map()];
        for (const pair of pairs) pair.forEach((pick, v) => mix[v].set(pick, (mix[v].get(pick) || 0) + 1));
        const observed = pairs.filter(([a, b]) => a === b).length / n;
        let chance = 0;
        for (const [pick, times] of mix[0]) chance += (times / n) * ((mix[1].get(pick) || 0) / n);
        if (chance >= 1) return null;
        return { value: (observed - chance) / (1 - chance), detail: `observed ${pct(observed)}, chance ${pct(chance)} over ${plural(n, "row")}` };
      } },
    { id: "same_wrong_answer", kind: "metric", format: "integer", label: "Rows both got wrong with the same answer",
      help: "Of the labeled rows both variants got wrong, how many they got wrong the same way: a shared blind spot, or a label worth a second look.",
      compute: (ctx) => {
        const rows = scoredRows(ctx);
        if (!rows) return null;
        const both = rows.filter((row) => !row.right[0] && !row.right[1]);
        return { value: both.filter((row) => pickOf(row.item, 0) === pickOf(row.item, 1)).length, detail: `of ${plural(both.length, "row")} both got wrong` };
      } },
    { id: "surer_pick_accuracy", kind: "metric", format: "percent", label: "Accuracy taking the surer variant's answer",
      help: "Advisory, computed in code: each labeled row takes the answer of the variant with the higher gate signal (A on a tie). Not an answer either variant gave as a pair.",
      compute: (ctx) => {
        const rows = scoredRows(ctx);
        if (!rows) return null;
        let right = 0;
        for (const row of rows) {
          const a = signalOf(row.item, 0), b = signalOf(row.item, 1);
          if (a === null || b === null) return null;
          if (row.right[b > a ? 1 : 0]) right++;
        }
        return { value: right / rows.length, detail: `${right} of ${rows.length}` };
      } },
    { id: "averaged_accuracy", kind: "metric", format: "percent", label: "Accuracy of A and B's averaged probabilities",
      help: "Advisory, computed in code: each labeled row takes the answer with the highest mean of A's and B's probabilities (first listed on a tie). Needs both to list the same options; not for Box.",
      compute: (ctx) => {
        const rows = scoredRows(ctx);
        const type = ctx?.data?.type;
        if (!rows || type === "box") return null;
        let right = 0;
        for (const row of rows) {
          const pick = averagedPick(row.item);
          if (pick === undefined) return null;
          const truth = labelFor(type, row.item.label, answerOf(row.item, 0));
          if (type === "noul" ? (pick === "yes") === truth : type === "score" ? Number(pick) === truth : pick === truth) right++;
        }
        return { value: right / rows.length, detail: `${right} of ${rows.length}` };
      } },

    // ----- calibration and confidence -----
    ...perVariant("brier", (name) => `Brier score of ${name}`,
      (name) => `Mean squared gap between the probability ${name} gave its pick and whether it was right, on the labeled rows both answered. Lower is better.`, "number",
      (ctx, v) => {
        const values = perScored(scoredRows(ctx), v, (row) => {
          const top = topOf(row.item, v);
          return top === null ? null : (top - (row.right[v] ? 1 : 0)) ** 2;
        });
        return values && { value: meanOf(values), detail: plural(values.length, "labeled row") };
      }),
    ...perVariant("log_loss", (name) => `Log loss of ${name}`,
      (name) => `Mean of -ln(the probability ${name} gave the labeled answer) on the labeled rows both answered, with probabilities clipped to 1e-15 so a certain mistake stays finite. Lower is better. Not for Box, which has no probability list.`, "number",
      (ctx, v) => {
        const type = ctx?.data?.type;
        if (type === "box") return null;
        const values = perScored(scoredRows(ctx), v, (row) => {
          const answer = answerOf(row.item, v), probs = probsOf(answer), truth = labelFor(type, row.item.label, answer);
          if (!probs || truth === undefined) return null;
          const key = type === "noul" ? (truth ? "yes" : "no") : String(truth);
          if (!probs.has(key)) return null;
          return -Math.log(Math.min(1 - CLIP, Math.max(CLIP, probs.get(key))));
        });
        return values && { value: meanOf(values), detail: plural(values.length, "labeled row") };
      }),
    ...perVariant("auroc", (name) => `How well ${name}'s signal ranks right above wrong`,
      (name) => `The chance that a right answer of ${name} has a higher gate signal than a wrong one (AUROC; ties count half). 0.5 is no better than chance. Needs both right and wrong answers.`, "number",
      (ctx, v) => {
        const rows = scoredRows(ctx);
        return rows && auroc(rows, v);
      }),
    ...perVariant("overconfidence", (name) => `Overconfidence of ${name}`,
      (name) => `${name}'s mean probability for its picks minus its accuracy on the labeled rows both answered. Positive: it claims more than it delivers; negative: underconfident.`, "percent",
      (ctx, v) => {
        const rows = scoredRows(ctx);
        const tops = perScored(rows, v, (row) => topOf(row.item, v));
        if (!tops) return null;
        const accuracy = rows.filter((row) => row.right[v]).length / rows.length;
        return { value: meanOf(tops) - accuracy, detail: `mean probability ${pct(meanOf(tops))}, accuracy ${pct(accuracy)}` };
      }),
    ...perVariant("mean_signal", (name) => `Mean signal of ${name}`,
      (name) => `${name}'s average gate signal on every row both variants answered, labeled or not.`, "number",
      (ctx, v) => {
        const values = rowsOf(ctx).filter(bothAnswered).map((item) => signalOf(item, v)).filter((value) => value !== null);
        return values.length ? { value: meanOf(values), detail: plural(values.length, "row") } : null;
      }),
    { id: "signal_shift_agreeing", kind: "metric", format: "number", label: "Signal change from A to B where they agree",
      help: "Mean of B's signal minus A's on the rows both answered with the same pick: whether B is surer or less sure of the same answers.",
      compute: (ctx) => {
        const shifts = rowsOf(ctx).filter((item) => bothAnswered(item) && pickOf(item, 0) !== null && pickOf(item, 0) === pickOf(item, 1))
          .map((item) => (signalOf(item, 0) === null || signalOf(item, 1) === null ? null : signalOf(item, 1) - signalOf(item, 0)))
          .filter((value) => value !== null);
        return shifts.length ? { value: meanOf(shifts), detail: plural(shifts.length, "agreeing row") } : null;
      } },

    // ----- cost, latency and usage (measured) -----
    ...perVariant("latency_p90", (name) => `90th percentile latency of ${name}`,
      (name) => `Measured milliseconds of ${name}'s calls that returned (an averaged variant's slower call), at the 90th percentile.`, "ms",
      (ctx, v) => {
        const values = returned(ctx, v).map((item) => num(metaOf(item, v).latency_ms)).filter((value) => value !== null);
        return values.length ? { value: quantile(values, 0.9), detail: plural(values.length, "call") } : null;
      }),
    ...perVariant("latency_max", (name) => `Slowest call of ${name}`,
      (name) => `The longest measured latency among ${name}'s calls that returned.`, "ms",
      (ctx, v) => {
        let slowest = null;
        for (const item of returned(ctx, v)) {
          const value = num(metaOf(item, v).latency_ms);
          if (value !== null && (slowest === null || value > slowest.value)) slowest = { value, detail: `row #${item.number} (the table's numbering)` };
        }
        return slowest;
      }),
    { id: "latency_paired_diff", kind: "metric", format: "ms", label: "Mean latency of B minus A per row",
      help: "The average of B's measured latency minus A's on the rows both answered: a paired view of which variant is slower.",
      compute: (ctx) => {
        const diffs = rowsOf(ctx).filter(bothAnswered).map((item) => {
          const a = num(metaOf(item, 0)?.latency_ms), b = num(metaOf(item, 1)?.latency_ms);
          return a === null || b === null ? null : b - a;
        }).filter((value) => value !== null);
        return diffs.length ? { value: meanOf(diffs), detail: plural(diffs.length, "row") } : null;
      } },
    ...perVariant("cost_per_correct", (name) => `Cost of ${name} per right answer`,
      (name) => `${name}'s measured cost on the labeled rows both answered, divided by how many of them ${name} got right.`, "usd",
      (ctx, v) => {
        const costs = perScored(scoredRows(ctx), v, (row) => num(metaOf(row.item, v)?.cost_usd));
        if (!costs) return null;
        const right = scoredRows(ctx).filter((row) => row.right[v]).length;
        return right ? { value: costs.reduce((total, value) => total + value, 0) / right, detail: `${right} right of ${costs.length}` } : null;
      }),
    { id: "cost_ratio", kind: "metric", format: "number", label: "Cost of B relative to A",
      help: "B's measured cost divided by A's on the rows both answered. 2 means B cost twice as much for the same rows.",
      compute: (ctx) => {
        let a = 0, b = 0, rows = 0;
        for (const item of rowsOf(ctx).filter(bothAnswered)) {
          const ca = num(metaOf(item, 0)?.cost_usd), cb = num(metaOf(item, 1)?.cost_usd);
          if (ca === null || cb === null) continue;
          a += ca; b += cb; rows++;
        }
        return rows && a > 0 ? { value: b / a, detail: plural(rows, "row") } : null;
      } },
    ...perVariant("output_tokens", (name) => `Output tokens of ${name}`,
      (name) => `Measured output tokens of ${name}'s calls that returned, summed over the rows answered for this question.`, "integer",
      (ctx, v) => {
        const values = returned(ctx, v).map((item) => num(metaOf(item, v).output_tokens)).filter((value) => value !== null);
        return values.length ? { value: values.reduce((total, value) => total + value, 0), detail: plural(values.length, "call") } : null;
      }),
    { id: "cost_per_scored_row", kind: "metric", format: "usd", label: "Run cost per scored row",
      help: "The whole run's measured cost (both variants, every question) divided by the labeled rows both variants answered for this question: what each scored comparison row cost.",
      compute: (ctx) => {
        const cost = num(ctx?.data?.run?.cost_usd), labeled = count(ctx?.data?.scores?.[0]?.labeled);
        return cost === null || !labeled ? null : { value: cost / labeled, detail: plural(labeled, "scored row") };
      } },
  ],
});
