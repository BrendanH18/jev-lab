// Toolbox: threshold what-ifs for a gate from pasted confidence,correct pairs, label,choice,confidence rows and
// several questions' confidences. A row is automated when its confidence clears the threshold (equal clears, as in the
// Workbench and exported gates). Every tool is pure: it reads only what is typed or pasted into its form, never page
// data, and never calls the model. Results are in-sample arithmetic on the pasted rows, not guarantees on new traffic.
import { compareText, definePack, toNumber } from "../../kit.js";
import { normalQuantile } from "../../lib/math.js";

const GROUP = "Thresholds and gates";
const MAX_ROWS = 200000;
const SLACK = 1e-9;          // a confidence equal to its threshold clears it (jev/gate.py adds the same 1e-9)
const TOP = "above top confidence";
const FORMAT = "Paste confidence,correct pairs, one per line or several on a line, separated by commas, tabs, spaces or semicolons. "
  + "Confidences run from 0 to 1; correct is 1/0, yes/no, true/false or correct/wrong; a first line with no number is skipped as a header. A row is automated when its confidence is at or above the threshold.";
const CHOICE_FORMAT = "Paste label,choice,confidence per line (the right answer, the answer given and its confidence), separated by commas, tabs or semicolons; "
  + "labels and choices match exactly, case included, and a first line whose confidence is not a number is a header.";

const PAIRS = { name: "pairs", label: "Confidence and correct pairs", type: "textarea", rows: 8, required: true, placeholder: "confidence,correct\n0.97,1\n0.62,0\n0.88,1" };
const CHOICE_ROWS = { name: "rows", label: "Label, choice and confidence", type: "textarea", rows: 8, required: true, placeholder: "label,choice,confidence\nrefund,refund,0.94\nexchange,refund,0.71" };
const LEVEL = { name: "level", label: "Interval confidence", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]], default: "0.95" };
const SHARE = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const THRESHOLD = SHARE("threshold", "Threshold (confidence ≥)", { default: 0.8 });
const TARGET = SHARE("target", "Target accuracy (0 to 1)", { default: 0.95 });

// ---------- parsing ----------

const OUTCOMES = new Map([["1", 1], ["0", 0], ["true", 1], ["false", 0], ["yes", 1], ["no", 0], ["y", 1], ["n", 0], ["correct", 1], ["incorrect", 0],
  ["right", 1], ["wrong", 0], ["pos", 1], ["neg", 0], ["positive", 1], ["negative", 0]]);
const shown = (cell) => (cell.length > 40 ? `${cell.slice(0, 40)}…` : cell);

function outcomeOf(cell, where) {
  const key = cell.toLowerCase();
  if (OUTCOMES.has(key)) return OUTCOMES.get(key);
  const number = toNumber(key);
  if (number === 1 || number === 0) return number;
  throw new Error(`${where}: "${shown(cell)}" is not an outcome; use 1/0, yes/no, true/false or correct/wrong.`);
}

function numberOf(cell, where) {
  const value = toNumber(cell);
  if (value === null) throw new Error(`${where}: "${shown(cell)}" is not a number.`);
  return value;
}

function confidenceOf(cell, where) {
  const value = numberOf(cell, where);
  if (value < 0 || value > 1) throw new Error(`${where}: ${shown(cell)} is not a confidence from 0 to 1.`);
  return value;
}

// Records of `width` values, one or more per line; the first nonblank line is a header when none of its cells is a number.
function records(text, width, what, read) {
  const out = [];
  let first = true;
  String(text ?? "").split(/\r\n|\n|\r/).forEach((line, index) => {
    const cells = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (!cells.length) return;
    const header = first && cells.every((cell) => toNumber(cell) === null);
    first = false;
    if (header) return;
    if (cells.length % width) throw new Error(`Line ${index + 1}: expected ${what}s of ${width} value${width === 1 ? "" : "s"}, found ${cells.length} value${cells.length === 1 ? "" : "s"}.`);
    for (let at = 0; at < cells.length; at += width) {
      if (out.length >= MAX_ROWS) throw new Error(`Paste at most ${MAX_ROWS.toLocaleString("en-US")} ${what}s.`);
      out.push(read(cells.slice(at, at + width), cells.length > width ? `Line ${index + 1}, ${what} ${at / width + 1}` : `Line ${index + 1}`));
    }
  });
  if (!out.length) throw new Error(`Paste at least one ${what}.`);
  return out;
}

// { c: confidences, y: 1/0 correct, n, correct } in paste order.
function parsePairs(text, { anyScore = false } = {}) {
  const rows = records(text, 2, "pair", ([a, b], where) => [anyScore ? numberOf(a, where) : confidenceOf(a, where), outcomeOf(b, where)]);
  const c = rows.map((row) => row[0]), y = rows.map((row) => row[1]);
  return { c, y, n: rows.length, correct: y.reduce((a, b) => a + b, 0) };
}

const parseConfidences = (text) => records(text, 1, "confidence", ([cell], where) => confidenceOf(cell, where));

// One line's cells: split on its first delimiter found among tab, semicolon and comma, else on spaces.
function splitCells(line) {
  for (const delimiter of ["\t", ";", ","]) if (line.includes(delimiter)) return line.split(delimiter).map((cell) => cell.trim());
  return line.trim().split(/\s+/);
}

// label,choice,confidence rows: [{ label, choice, c, right }].
function parseChoiceRows(text) {
  const lines = String(text ?? "").split(/\r\n|\n|\r/);
  const rows = [];
  let first = true;
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const where = `Line ${index + 1}`, cells = splitCells(line);
    const header = first && cells.length === 3 && toNumber(cells[2]) === null;
    first = false;
    if (header) return;
    if (cells.length !== 3) throw new Error(`${where}: expected a label, a choice and a confidence, found ${cells.length} value${cells.length === 1 ? "" : "s"}.`);
    if (!cells[0] || !cells[1]) throw new Error(`${where}: the ${cells[0] ? "choice" : "label"} is blank.`);
    if (rows.length >= MAX_ROWS) throw new Error(`Paste at most ${MAX_ROWS.toLocaleString("en-US")} rows.`);
    rows.push({ label: cells[0], choice: cells[1], c: confidenceOf(cells[2], where), right: cells[0] === cells[1] ? 1 : 0 });
  });
  if (!rows.length) throw new Error(`Paste at least one row. ${CHOICE_FORMAT}`);
  return rows;
}

function thresholdsList(text) {
  const cells = String(text ?? "").trim().split(/[\s,;]+/).filter(Boolean);
  if (!cells.length) throw new Error("Type one threshold per question, such as 0.8, 0.7.");
  return cells.map((cell, i) => confidenceOf(cell, `Threshold ${i + 1}`));
}

// ---------- numerics ----------

const clears = (confidence, threshold) => confidence + SLACK >= threshold;
const ratio = (top, bottom) => (bottom > 0 ? top / bottom : null);
const zFor = (level) => normalQuantile(1 - (1 - Number(level)) / 2);

function wilsonLow(successes, n, z) {
  if (!(n > 0)) return null;
  const p = successes / n, z2 = z * z, scale = 1 + z2 / n;
  return Math.max(0, (p + z2 / (2 * n)) / scale - (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)));
}

// One entry per distinct confidence, highest first, with the counts when every row at or above it is automated.
function sweep(c, y) {
  const order = c.map((_, i) => i).sort((a, b) => c[b] - c[a]);
  const points = [];
  let automated = 0, correct = 0;
  for (let i = 0; i < order.length;) {
    const threshold = c[order[i]];
    let size = 0, right = 0;
    while (i < order.length && c[order[i]] === threshold) { size++; right += y ? y[order[i]] : 0; i++; }
    automated += size; correct += right;
    points.push({ threshold, size, right, automated, correct });
  }
  return points;
}

function gateAt(data, threshold) {
  let automated = 0, correct = 0;
  data.c.forEach((c, i) => { if (clears(c, threshold)) { automated++; correct += data.y[i]; } });
  return { automated, correct, errors: automated - correct, coverage: automated / data.n, accuracy: ratio(correct, automated) };
}

// The lowest distinct confidence whose automated rows reach the target accuracy (by the point estimate).
function lowestForTarget(points, target) {
  let hit = null;
  for (const point of points) if (point.correct / point.automated >= target - 1e-12) hit = point;
  return hit;
}

function tool(id, title, help, inputs, compute) {
  return { id, kind: "tool", group: GROUP, title, help, inputs, compute };
}

// ---------- the pack ----------

export default definePack({
  id: "tb-thresholds",
  surface: "workbench.toolbox",
  title: "Threshold what-ifs",
  about: "Toolbox calculators for choosing and checking gate thresholds from pasted confidence,correct pairs, label,choice,confidence rows or several questions' confidences: threshold moves, lower bounds, costs, error budgets, risk-coverage, edge rows, per-choice thresholds, review bands and multi-question gates. They read only what you paste into them and never call the model; results describe the pasted rows, not new traffic.",
  features: [
    tool("threshold_change", "What moving a threshold changes",
      `Compares a gate at its current and a new threshold: coverage, accuracy and errors at each, and the rows that move between automation and review (listed by their position in the paste) with their accuracy. ${FORMAT}`,
      [PAIRS, SHARE("current", "Current threshold", { default: 0.8 }), SHARE("next", "New threshold", { default: 0.7 })], (params) => {
        const data = parsePairs(params.pairs);
        const now = gateAt(data, params.current), after = gateAt(data, params.next);
        const low = Math.min(params.current, params.next), high = Math.max(params.current, params.next);
        const moved = data.c.flatMap((c, i) => (clears(c, low) && !clears(c, high) ? [i] : []));
        const right = moved.reduce((total, i) => total + data.y[i], 0);
        return { rows: [["Automated at the current threshold", now.automated], ["Automated at the new threshold", after.automated], ["Coverage now", now.coverage], ["Coverage after", after.coverage],
          ["Accuracy now", now.accuracy], ["Accuracy after", after.accuracy], ["Errors automated now", now.errors], ["Errors automated after", after.errors], ["Rows that move", moved.length],
          ["They move", !moved.length ? "nowhere" : params.next < params.current ? "into automation" : "to review"], ["Accuracy of the rows that move", ratio(right, moved.length)]],
        table: { columns: ["Row", "Confidence", "Correct"], rows: moved.map((i) => [i + 1, data.c[i], data.y[i] ? "yes" : "no"]) } };
      }),
    tool("threshold_lower_bound", "Lowest threshold whose accuracy lower bound meets a target",
      `The lowest distinct confidence whose automated rows have a Wilson interval (two-sided, at the chosen confidence) whose lower end reaches the target accuracy, so the target holds with that confidence and not only on the point estimate. The point-estimate threshold is shown for comparison. ${FORMAT}`,
      [PAIRS, SHARE("target", "Target accuracy (0 to 1)", { default: 0.9 }), LEVEL], (params) => {
        const data = parsePairs(params.pairs), z = zFor(params.level), points = sweep(data.c, data.y);
        let hit = null;
        for (const point of points) if (wilsonLow(point.correct, point.automated, z) >= params.target - 1e-12) hit = point;
        const plain = lowestForTarget(points, params.target);
        return { rows: [["Threshold (confidence ≥)", hit ? hit.threshold : null], ["Rows automated", hit ? hit.automated : 0], ["Coverage", hit ? hit.automated / data.n : 0],
          ["Accuracy there", hit ? hit.correct / hit.automated : null], ["Lower bound there", hit ? wilsonLow(hit.correct, hit.automated, z) : null],
          ["Lowest threshold by point accuracy", plain ? plain.threshold : null], ["Coverage by point accuracy", plain ? plain.automated / data.n : 0]],
        note: hit ? null : "No threshold's lower bound reaches the target; label more rows or lower the target." };
      }),
    tool("lowest_cost_review", "Threshold with the lowest review and error cost",
      `Prices every reviewed row and every automated mistake and finds the distinct confidence (or automating nothing) whose threshold costs least; ties go to automating fewer rows. Give the current threshold to see the saving. ${FORMAT}`,
      [PAIRS, { name: "review", label: "Cost of reviewing one row", type: "number", min: 0, default: 1 }, { name: "error", label: "Cost of one automated mistake", type: "number", min: 0, default: 10 },
        SHARE("current", "Current threshold (optional)", { optional: true })], (params) => {
        const data = parsePairs(params.pairs);
        const cost = (automated, correct) => (data.n - automated) * params.review + (automated - correct) * params.error;
        let best = { threshold: TOP, automated: 0, correct: 0 }, lowest = cost(0, 0);
        for (const point of sweep(data.c, data.y)) {
          const value = cost(point.automated, point.correct);
          if (value < lowest - 1e-12 * Math.max(1, Math.abs(lowest))) { lowest = value; best = point; }
        }
        const current = params.current === null ? null : gateAt(data, params.current);
        const currentCost = current ? cost(current.automated, current.correct) : null;
        return [["Best threshold (confidence ≥)", best.threshold], ["Rows automated", best.automated], ["Rows reviewed", data.n - best.automated], ["Errors automated", best.automated - best.correct],
          ["Total cost", lowest], ["Cost per row", lowest / data.n], ["Cost of reviewing every row", cost(0, 0)], ["Cost of automating every row", cost(data.n, data.correct)],
          ["Cost at the current threshold", currentCost], ["Saving against the current threshold", currentCost === null ? null : currentCost - lowest]];
      }),
    tool("risk_coverage_table", "Accuracy and coverage at every confidence",
      `For every distinct confidence used as a threshold, highest first: rows automated, coverage, accuracy, errors and the lower end of the Wilson interval for the accuracy. ${FORMAT}`,
      [PAIRS, LEVEL], (params) => {
        const data = parsePairs(params.pairs), z = zFor(params.level);
        return { table: { columns: ["Threshold (confidence ≥)", "Automated", "Coverage", "Accuracy", "Errors", "Accuracy lower bound"],
          rows: sweep(data.c, data.y).map((point) => [point.threshold, point.automated, point.automated / data.n, point.correct / point.automated, point.automated - point.correct,
            wilsonLow(point.correct, point.automated, z)]) } };
      }),
    tool("risk_coverage_area", "Area under the risk-coverage curve",
      `Ranks rows by confidence and averages the error rate of the top k rows over k = 1 … n (AURC, lower is better), with rows of equal confidence counted in every order on average. The optimal AURC puts every right row first; their difference (excess AURC) measures the ranking alone, apart from the error rate. ${FORMAT}`,
      [PAIRS], (params) => {
        const data = parsePairs(params.pairs);
        let area = 0, errorsBefore = 0, taken = 0;
        for (const point of sweep(data.c, data.y)) {
          const groupErrors = point.size - point.right;
          for (let j = 1; j <= point.size; j++) area += (errorsBefore + j * groupErrors / point.size) / (taken + j);
          errorsBefore += groupErrors; taken += point.size;
        }
        area /= data.n;
        let optimal = 0;
        for (let k = data.correct + 1; k <= data.n; k++) optimal += (k - data.correct) / k;
        optimal /= data.n;
        return [["AURC", area], ["Optimal AURC at this error rate", optimal], ["Excess AURC", area - optimal], ["Error rate at full coverage", 1 - data.correct / data.n], ["Rows", data.n]];
      }),
    tool("threshold_for_coverage", "Threshold for a target coverage",
      `The highest distinct confidence that still automates at least the target share of rows, such as the share your reviewers cannot handle (coverage = 1 − review capacity ÷ volume). Works on confidences alone, or on confidence,correct pairs to also show the accuracy there. ${FORMAT}`,
      [{ name: "pairs", label: "Confidences, or confidence and correct pairs", type: "textarea", rows: 8, required: true, placeholder: "0.97, 0.62, 0.88" },
        { name: "shape", label: "The paste holds", type: "select", options: [["pairs", "confidence,correct pairs"], ["confidences", "confidences only"]], default: "pairs" },
        SHARE("coverage", "Target coverage (0 to 1)", { default: 0.8 })], (params) => {
        const labeled = params.shape === "pairs";
        const data = labeled ? parsePairs(params.pairs) : { c: parseConfidences(params.pairs), y: null };
        const n = data.c.length;
        const hit = sweep(data.c, data.y).find((point) => point.automated / n >= params.coverage - 1e-12);
        return [["Threshold (confidence ≥)", hit.threshold], ["Coverage there", hit.automated / n], ["Rows automated", hit.automated], ["Rows reviewed", n - hit.automated],
          ["Accuracy there", labeled ? hit.correct / hit.automated : null], ["Errors automated", labeled ? hit.automated - hit.correct : null]];
      }),
    tool("error_budget", "Threshold for a daily error budget",
      `Scales the pasted rows to a daily volume and finds the lowest distinct confidence whose automated mistakes stay within the errors you can accept per day, with the projected automated rows, mistakes and reviews per day. Assumes new traffic looks like the paste. ${FORMAT}`,
      [PAIRS, { name: "volume", label: "Rows per day", type: "number", min: 0, default: 1000 }, { name: "budget", label: "Automated mistakes allowed per day", type: "number", min: 0, default: 10 }], (params) => {
        const data = parsePairs(params.pairs);
        let hit = null;
        for (const point of sweep(data.c, data.y)) if ((point.automated - point.correct) / data.n * params.volume <= params.budget + 1e-9) hit = point;
        const automated = hit ? hit.automated : 0, errors = hit ? hit.automated - hit.correct : 0;
        return [["Threshold (confidence ≥)", hit ? hit.threshold : TOP], ["Coverage", automated / data.n], ["Accuracy there", hit ? hit.correct / hit.automated : null],
          ["Automated rows per day", automated / data.n * params.volume], ["Automated mistakes per day", errors / data.n * params.volume], ["Reviews per day", (data.n - automated) / data.n * params.volume]];
      }),
    tool("confident_mistakes", "Confident mistakes above a threshold",
      `Lists the wrong rows a threshold would automate, most confident first, by their position in the paste, so you can read them before trusting the gate. ${FORMAT}`,
      [PAIRS, THRESHOLD], (params) => {
        const data = parsePairs(params.pairs), gate = gateAt(data, params.threshold);
        const wrong = data.c.flatMap((c, i) => (!data.y[i] && clears(c, params.threshold) ? [i] : [])).sort((a, b) => data.c[b] - data.c[a] || a - b);
        return { rows: [["Automated mistakes", wrong.length], ["Rows automated", gate.automated], ["Share of automated rows", ratio(wrong.length, gate.automated)]],
          table: { columns: ["Row", "Confidence"], rows: wrong.map((i) => [i + 1, data.c[i]]) } };
      }),
    tool("edge_accuracy", "Accuracy at the edge of a threshold",
      `The accuracy of the k automated rows with the lowest confidence and of the k reviewed rows with the highest, the rows a small move of the threshold would change. Overall accuracy can hide weak rows just above the line. Rows tied at the cut count in proportion. ${FORMAT}`,
      [PAIRS, THRESHOLD, { name: "k", label: "Rows on each side (k)", type: "integer", min: 1, default: 20 }], (params) => {
        const data = parsePairs(params.pairs);
        // The expected right rows among the first k of rows in the given order, ties at the cut averaged.
        const edge = (indexes, ascending) => {
          const order = indexes.slice().sort((a, b) => (ascending ? data.c[a] - data.c[b] : data.c[b] - data.c[a]));
          const take = Math.min(params.k, order.length);
          if (!take) return { take, accuracy: null, from: null, to: null };
          const cut = data.c[order[take - 1]];
          let right = 0, before = 0;
          for (const i of order) if (ascending ? data.c[i] < cut : data.c[i] > cut) { right += data.y[i]; before++; }
          const tied = order.filter((i) => data.c[i] === cut), tiedRight = tied.reduce((total, i) => total + data.y[i], 0);
          right += (take - before) * tiedRight / tied.length;
          const values = [data.c[order[0]], cut];
          return { take, accuracy: right / take, from: Math.min(...values), to: Math.max(...values) };
        };
        const all = data.c.map((_, i) => i);
        const above = edge(all.filter((i) => clears(data.c[i], params.threshold)), true), below = edge(all.filter((i) => !clears(data.c[i], params.threshold)), false);
        return [["Automated edge rows", above.take], ["Automated edge accuracy", above.accuracy], ["Automated edge confidence from", above.from], ["Automated edge confidence to", above.to],
          ["Reviewed edge rows", below.take], ["Reviewed edge accuracy", below.accuracy], ["Reviewed edge confidence from", below.from], ["Reviewed edge confidence to", below.to],
          ["Accuracy of all automated rows", gateAt(data, params.threshold).accuracy]];
      }),
    tool("per_choice_thresholds", "Per-choice thresholds for a target accuracy",
      `For a Choice question, the lowest confidence for each answer given that keeps the accuracy of that answer's automated rows at the target, with the coverage and accuracy all of them give together and, for comparison, one shared threshold. ${CHOICE_FORMAT}`,
      [CHOICE_ROWS, TARGET], (params) => {
        const rows = parseChoiceRows(params.rows);
        const choices = [...new Set(rows.map((row) => row.choice))].sort(compareText);
        let automated = 0, correct = 0;
        const table = choices.map((choice) => {
          const mine = rows.filter((row) => row.choice === choice);
          const hit = lowestForTarget(sweep(mine.map((row) => row.c), mine.map((row) => row.right)), params.target);
          if (hit) { automated += hit.automated; correct += hit.correct; }
          return [choice, mine.length, hit ? hit.threshold : "none reaches the target", hit ? hit.automated : 0, hit ? hit.correct / hit.automated : null];
        });
        const shared = lowestForTarget(sweep(rows.map((row) => row.c), rows.map((row) => row.right)), params.target);
        return { rows: [["Coverage with these thresholds", automated / rows.length], ["Accuracy with these thresholds", ratio(correct, automated)], ["One shared threshold for the target", shared ? shared.threshold : null],
          ["Coverage with the shared threshold", shared ? shared.automated / rows.length : 0], ["Accuracy with the shared threshold", shared ? shared.correct / shared.automated : null]],
        table: { columns: ["Choice", "Rows given", "Threshold (confidence ≥)", "Automated", "Accuracy there"], rows: table } };
      }),
    tool("per_class_at_threshold", "Per-class coverage and accuracy at a threshold",
      `For a Choice question at one threshold, per class (every label and answer given): rows labeled with it, automated rows that answered it and the share of those that were right, and the share of its labeled rows the gate automates correctly. ${CHOICE_FORMAT}`,
      [CHOICE_ROWS, THRESHOLD], (params) => {
        const rows = parseChoiceRows(params.rows);
        const classes = [...new Set(rows.flatMap((row) => [row.label, row.choice]))].sort(compareText);
        const auto = rows.filter((row) => clears(row.c, params.threshold));
        const right = auto.reduce((total, row) => total + row.right, 0);
        return { rows: [["Coverage", auto.length / rows.length], ["Accuracy of automated rows", ratio(right, auto.length)]],
          table: { columns: ["Class", "Rows labeled", "Automated as this answer", "Accuracy of those", "Share of labeled rows automated correctly"], rows: classes.map((name) => {
            const labeled = rows.filter((row) => row.label === name).length;
            const given = auto.filter((row) => row.choice === name), good = given.filter((row) => row.right).length;
            return [name, labeled, given.length, ratio(good, given.length), ratio(good, labeled)];
          }) } };
      }),
    tool("automated_mistakes", "Automated mistakes by label and answer",
      `At a threshold, groups the automated wrong rows of a Choice question by right label and answer given, most frequent first, with each pair's share of the mistakes and its highest confidence: the confusions a gate lets through. ${CHOICE_FORMAT}`,
      [CHOICE_ROWS, THRESHOLD], (params) => {
        const rows = parseChoiceRows(params.rows);
        const auto = rows.filter((row) => clears(row.c, params.threshold));
        const pairs = new Map();
        for (const row of auto) {
          if (row.right) continue;
          const key = JSON.stringify([row.label, row.choice]);
          const entry = pairs.get(key) || { label: row.label, choice: row.choice, count: 0, top: 0 };
          entry.count++; entry.top = Math.max(entry.top, row.c); pairs.set(key, entry);
        }
        const mistakes = auto.length - auto.reduce((total, row) => total + row.right, 0);
        const list = [...pairs.values()].sort((a, b) => b.count - a.count || compareText(a.label, b.label) || compareText(a.choice, b.choice));
        return { rows: [["Rows automated", auto.length], ["Automated mistakes", mistakes], ["Accuracy of automated rows", ratio(auto.length - mistakes, auto.length)]],
          table: { columns: ["Right label", "Answer given", "Mistakes", "Share of mistakes", "Highest confidence"], rows: list.map((entry) => [entry.label, entry.choice, entry.count, entry.count / mistakes, entry.top]) } };
      }),
    tool("best_review_band", "Review band that automates the most at a target accuracy",
      "For a yes/no question scored by its probability of yes: searches every pair of thresholds (at or above the upper: decided yes; below the lower: decided no; between: reviewed) for the pair that automates the most rows while the automated decisions keep the target accuracy. Ties go to the more accurate pair, then the higher upper threshold. Paste score,outcome pairs (outcome 1/yes when the answer is yes) separated by commas, tabs, spaces or semicolons; up to 5,000 distinct scores.",
      [{ name: "pairs", label: "Score and outcome pairs", type: "textarea", rows: 8, required: true, placeholder: "score,outcome\n0.93,1\n0.12,0\n0.55,1" }, TARGET], (params) => {
        const data = parsePairs(params.pairs, { anyScore: true });
        const values = [...new Set(data.c)].sort((a, b) => a - b), d = values.length;
        if (d > 5000) throw new Error(`The paste has ${d.toLocaleString("en-US")} distinct scores; round them to at most 5,000.`);
        const at = new Map(values.map((value, k) => [value, k]));
        const count = values.map(() => 0), yes = values.map(() => 0);
        data.c.forEach((c, i) => { count[at.get(c)]++; yes[at.get(c)] += data.y[i]; });
        const belowN = [0], belowNo = [0];
        for (let k = 0; k < d; k++) { belowN.push(belowN[k] + count[k]); belowNo.push(belowNo[k] + count[k] - yes[k]); }
        let best = null;
        for (let j = d; j >= 0; j--) {
          const upN = data.n - belowN[j], upYes = data.correct - (belowN[j] - belowNo[j]);
          for (let i = 0; i <= j; i++) {
            const automated = belowN[i] + upN, correct = belowNo[i] + upYes;
            if (!automated || correct / automated < params.target - 1e-12) continue;
            if (!best || automated > best.automated || (automated === best.automated && correct > best.correct)) best = { i, j, automated, correct, upN, upYes };
          }
        }
        if (!best) return { rows: [["Lower threshold (below it: no)", null], ["Upper threshold (at or above it: yes)", null], ["Decided yes", 0], ["Accuracy of yes", null], ["Decided no", 0],
          ["Accuracy of no", null], ["Sent to review", data.n], ["Automated share", 0], ["Accuracy of automated decisions", null]], note: "No pair of thresholds reaches the target accuracy." };
        const edge = (k) => (k >= d ? "above top score" : values[k]);
        return [["Lower threshold (below it: no)", edge(best.i)], ["Upper threshold (at or above it: yes)", edge(best.j)], ["Decided yes", best.upN], ["Accuracy of yes", ratio(best.upYes, best.upN)],
          ["Decided no", belowN[best.i]], ["Accuracy of no", ratio(belowNo[best.i], belowN[best.i])], ["Sent to review", data.n - best.automated], ["Automated share", best.automated / data.n],
          ["Accuracy of automated decisions", best.correct / best.automated]];
      }),
    tool("multi_question_gate", "Gate on several questions at once",
      "A row is automated only when every question's confidence clears its own threshold, as in a Policy gate. Shows the gate's coverage and accuracy and, per question, the rows its threshold blocks, the rows only it blocks, and the coverage and accuracy without its threshold. Type one threshold per question; paste each row's confidences in the same order followed by whether the decision was right (1/0, yes/no, true/false or correct/wrong), separated by commas, tabs, spaces or semicolons.",
      [{ name: "thresholds", label: "Thresholds, one per question", type: "text", required: true, default: "0.8, 0.7", placeholder: "0.8, 0.7" },
        { name: "rows", label: "Confidences and correct", type: "textarea", rows: 8, required: true, placeholder: "q1,q2,correct\n0.91,0.84,1\n0.77,0.95,0" }], (params) => {
        const thresholds = thresholdsList(params.thresholds), k = thresholds.length;
        const rows = records(params.rows, k + 1, "row", (cells, where) => ({ c: cells.slice(0, k).map((cell) => confidenceOf(cell, where)), y: outcomeOf(cells[k], where) }));
        const passes = rows.map((row) => row.c.map((c, q) => clears(c, thresholds[q])));
        const summary = (skip) => {
          let automated = 0, correct = 0;
          rows.forEach((row, i) => { if (passes[i].every((pass, q) => pass || q === skip)) { automated++; correct += row.y; } });
          return { automated, correct };
        };
        const all = summary(-1);
        return { rows: [["Rows automated", all.automated], ["Coverage", all.automated / rows.length], ["Accuracy", ratio(all.correct, all.automated)], ["Errors automated", all.automated - all.correct]],
          table: { columns: ["Question", "Threshold", "Rows it blocks", "Rows only it blocks", "Coverage without it", "Accuracy without it"], rows: thresholds.map((threshold, q) => {
            const without = summary(q);
            return [q + 1, threshold, passes.filter((pass) => !pass[q]).length, passes.filter((pass) => !pass[q] && pass.every((ok, other) => ok || other === q)).length,
              without.automated / rows.length, ratio(without.correct, without.automated)];
          }) } };
      }),
    tool("two_question_search", "Two-question thresholds for a target accuracy",
      "Searches every pair of distinct confidences as thresholds for a gate on two questions (a row is automated when both clear their thresholds) for the pair that automates the most rows at the target accuracy, against the best single-question gate. Ties go to the more accurate pair, then the higher thresholds. Paste confidence 1, confidence 2 and whether the decision was right per row, separated by commas, tabs, spaces or semicolons; up to 20,000 rows.",
      [{ name: "rows", label: "Confidence 1, confidence 2 and correct", type: "textarea", rows: 8, required: true, placeholder: "q1,q2,correct\n0.91,0.84,1\n0.77,0.95,0" }, TARGET], (params) => {
        const rows = records(params.rows, 3, "row", ([a, b, y], where) => ({ a: confidenceOf(a, where), b: confidenceOf(b, where), y: outcomeOf(y, where) }));
        if (rows.length > 20000) throw new Error("Paste at most 20,000 rows for this search.");
        const byB = rows.slice().sort((p, q) => q.b - p.b);
        const firstValues = [...new Set(rows.map((row) => row.a))].sort((p, q) => q - p);
        let best = null;
        const consider = (t1, t2, automated, correct) => {
          if (!automated || correct / automated < params.target - 1e-12) return;
          if (!best || automated > best.automated || (automated === best.automated && correct > best.correct)) best = { t1, t2, automated, correct };
        };
        for (const t1 of firstValues) {
          let automated = 0, correct = 0;
          for (let i = 0; i < byB.length;) {
            const t2 = byB[i].b;
            while (i < byB.length && byB[i].b === t2) { if (byB[i].a >= t1) { automated++; correct += byB[i].y; } i++; }
            consider(t1, t2, automated, correct);
          }
        }
        const single = (key) => lowestForTarget(sweep(rows.map((row) => row[key]), rows.map((row) => row.y)), params.target);
        const one = single("a"), two = single("b");
        const n = rows.length;
        return { rows: [["Threshold for question 1", best ? best.t1 : null], ["Threshold for question 2", best ? best.t2 : null], ["Rows automated", best ? best.automated : 0],
          ["Coverage", best ? best.automated / n : 0], ["Accuracy", best ? best.correct / best.automated : null],
          ["Best coverage gating question 1 alone", one ? one.automated / n : 0], ["Best coverage gating question 2 alone", two ? two.automated / n : 0]],
        note: best ? null : "No pair of thresholds reaches the target accuracy." };
      }),
  ],
});
