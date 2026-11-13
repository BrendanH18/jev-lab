// Bulk result reports: run measurements (agreement with intervals, label coverage, calibration, answer distributions,
// measured cost, tokens and latency), exports with stated boundaries, and navigation commands for the user's own Bulk
// run (surface workbench.bulk.results; contract in static/js/lab/surfaces/workbench-bulk.js).
// Read-only: it never edits answers or labels, never shows a held-out row's answers (items already hide them), and
// every number is measured on the run the current user made in this page session. Nothing here changes Policy.
import { csvText, definePack } from "../../kit.js";
import { stdev } from "../../lib/math.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const Z95 = 1.959963984540054;
const CLOSE = 0.1;
const answersOf = (item) => (item && item.answers && typeof item.answers === "object" ? Object.entries(item.answers) : []);
const isNum = (value) => typeof value === "number" && Number.isFinite(value);
const nums = (values) => values.filter(isNum);
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const meanOf = (values) => (values.length ? total(values) / values.length : null);
const isEdges = (value) => !!value && typeof value === "object" && ["left", "top", "right", "bottom"].every((edge) => isNum(value[edge]));
// A box whose edges are in order (left < right, top < bottom); an inverted answer box has no overlap to measure.
const isBox = (value) => isEdges(value) && value.left < value.right && value.top < value.bottom;
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const show = (value) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Every answer of the shown rows, as { item, qid, answer } (held-out and unanswered rows have none).
const shownAnswers = (ctx) => ctx.shown().flatMap((item) => answersOf(item).map(([qid, answer]) => ({ item, qid, answer })));
const scored = (entries) => entries.filter((entry) => entry.answer.agrees === true || entry.answer.agrees === false);

// The Wilson score interval for k successes in n trials at 95%.
function wilson(k, n) {
  const p = k / n, z2 = Z95 * Z95, d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function iou(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = width * height;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : null;
}

// Labeled Noul answers as { p: P(yes), y: 1 | 0 }.
const labeledNouls = (ctx) => shownAnswers(ctx).filter(({ answer }) => answer.type === "noul" && isNum(answer.value) && (answer.label === "yes" || answer.label === "no"))
  .map(({ answer }) => ({ p: answer.value, y: answer.label === "yes" ? 1 : 0 }));
// Scored answers that carry a probability (Box answers carry none) as { p, ok }.
const scoredWithP = (ctx) => scored(shownAnswers(ctx)).filter(({ answer }) => isNum(answer.p)).map(({ answer }) => ({ p: answer.p, ok: answer.agrees }));
const latencies = (ctx) => nums(ctx.shown().map((item) => item.meta?.latency_ms));
const calEntries = (ctx) => {
  const qid = ctx.data.calQuestion;
  return qid ? shownAnswers(ctx).filter((entry) => entry.qid === qid) : [];
};

const firstShown = (ctx, test) => ctx.shown().find(test);
const focus = (ctx, test) => ctx.actions.focusRow(firstShown(ctx, test).index);
const lowestP = (item) => {
  const ps = nums(answersOf(item).map(([, answer]) => answer.p));
  return ps.length ? Math.min(...ps) : null;
};

// What the model reads as text: a text row, or an object's string "text" field; any other input as JSON.
const inputText = (item) => (typeof item.input === "string" ? item.input
  : item.input && typeof item.input === "object" && !Array.isArray(item.input) && typeof item.input.text === "string" ? item.input.text
    : JSON.stringify(item.input ?? null));

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// One shown row as the rows box reads it: input and human labels (with its picture), never answers. A text or object
// row becomes an object; an array, number or boolean row stays as it is (it carries no labels or picture).
function rowValue(item) {
  if (typeof item.input !== "string" && !isPlainObject(item.input)) return item.input;
  const base = typeof item.input === "string" ? { text: item.input } : { ...item.input };
  if (item.image) base._image = item.image;
  if (isPlainObject(item.labels) && Object.keys(item.labels).length) base._expect = item.labels;
  return base;
}

// The shown tuning rows the box would keep (it drops null and blank rows).
const handoffRows = (ctx) => ctx.shown().filter((item) => !item.test && item.input !== null && item.input !== undefined && item.input !== "").map(rowValue);
// JSON lines while every row is an object; a JSON array as soon as one is not, since the box reads a line that is not
// a JSON object as plain text.
const asArray = (rows) => rows.some((row) => !isPlainObject(row));

const requireRun = (ctx) => {
  if (!ctx.data.run) throw new Error("Run Bulk first: there is nothing to export.");
};

export default definePack({
  id: "bulk-result-reports",
  surface: "workbench.bulk.results",
  title: "Bulk result reports",
  about: "Measurements of your own Bulk run in this session (agreement with 95% intervals, label coverage, calibration, answer distributions, measured cost, tokens and latency), exports that say what they hold, and navigation commands. Held-out rows' answers stay out; the rows handoff holds inputs and human labels only.",
  features: [
    // ---------- agreement and labels ----------
    { id: "cal_agreement", kind: "metric", format: "percent", label: "Agreement on Calibrate's question, shown rows",
      help: "Share of the shown answers to Calibrate's question that agree with a valid human label, with a 95% Wilson interval. Measured on this run.",
      compute: (ctx) => {
        const marks = scored(calEntries(ctx));
        if (!marks.length) return null;
        const agree = marks.filter((entry) => entry.answer.agrees).length;
        const [low, high] = wilson(agree, marks.length);
        return { value: agree / marks.length, detail: `${ctx.data.calQuestion}: ${agree} of ${marks.length} labeled; 95% interval ${pct(low)}–${pct(high)}` };
      } },
    { id: "agreement_low", kind: "metric", format: "percent", label: "Label agreement, 95% lower bound",
      help: "The lower end of the 95% Wilson interval on the share of labeled answers that agree, across every question on the shown rows.",
      compute: (ctx) => {
        const marks = scored(shownAnswers(ctx));
        if (!marks.length) return null;
        const agree = marks.filter((entry) => entry.answer.agrees).length;
        const [low, high] = wilson(agree, marks.length);
        return { value: low, detail: `${agree} of ${plural(marks.length, "labeled answer")} agree; 95% interval ${pct(low)}–${pct(high)}` };
      } },
    { id: "label_coverage", kind: "metric", format: "percent", label: "Answers with a valid label, shown rows",
      help: "Of every answer on the shown rows, the share with a human label that fits its options, levels or edges.",
      compute: (ctx) => {
        const entries = shownAnswers(ctx);
        if (!entries.length) return null;
        const valid = entries.filter((entry) => entry.answer.labelValid === true).length;
        return { value: valid / entries.length, detail: `${valid} of ${plural(entries.length, "answer")}` };
      } },
    { id: "rows_all_agree", kind: "metric", format: "percent", label: "Rows where every label agrees",
      help: "Of the shown rows with at least one scored label, the share where every scored label agrees with its answer.",
      compute: (ctx) => {
        const rows = ctx.shown().map((item) => scored(answersOf(item).map(([qid, answer]) => ({ qid, answer })))).filter((marks) => marks.length);
        if (!rows.length) return null;
        const all = rows.filter((marks) => marks.every((entry) => entry.answer.agrees)).length;
        return { value: all / rows.length, detail: `${all} of ${plural(rows.length, "labeled row")}` };
      } },

    // ---------- calibration ----------
    { id: "brier_noul", kind: "metric", label: "Brier score, labeled Noul answers",
      help: "Mean of (P(yes) − label)² over yes/no answers with a valid label; 0 is perfect, 0.25 is a coin flip. Measured on the shown rows.",
      compute: (ctx) => {
        const pairs = labeledNouls(ctx);
        return pairs.length ? { value: meanOf(pairs.map(({ p, y }) => (p - y) ** 2)), detail: `over ${plural(pairs.length, "answer")}` } : null;
      } },
    { id: "log_loss_noul", kind: "metric", label: "Log loss, labeled Noul answers",
      help: "Mean of −ln(probability given to the labeled answer) over yes/no answers with a valid label; lower is better. Unavailable when an answer gave its label probability 0.",
      compute: (ctx) => {
        const losses = labeledNouls(ctx).map(({ p, y }) => -Math.log(y ? p : 1 - p));
        return losses.length && losses.every(isNum) ? meanOf(losses) : null;
      } },
    { id: "overconfidence", kind: "metric", label: "Mean probability minus agreement",
      help: "Over labeled answers that carry a probability: the mean probability of the predicted answer minus the share that agree. Above 0 the model is more sure than right on this run.",
      compute: (ctx) => {
        const marks = scoredWithP(ctx);
        return marks.length ? meanOf(marks.map((mark) => mark.p)) - marks.filter((mark) => mark.ok).length / marks.length : null;
      } },
    { id: "ece", kind: "metric", label: "Expected calibration error, 10 bins",
      help: "Labeled answers grouped into ten probability bins of width 0.1; the weighted mean gap between each bin's mean probability and its agreement share.",
      compute: (ctx) => {
        const marks = scoredWithP(ctx);
        if (!marks.length) return null;
        const bins = new Map();
        for (const mark of marks) {
          const bin = Math.min(9, Math.max(0, Math.floor(mark.p * 10 + 1e-9)));
          bins.set(bin, [...(bins.get(bin) || []), mark]);
        }
        let gap = 0;
        for (const group of bins.values()) gap += Math.abs(total(group.map((mark) => mark.p)) - group.filter((mark) => mark.ok).length);
        return { value: gap / marks.length, detail: `over ${plural(marks.length, "labeled answer")} in ${plural(bins.size, "bin")}` };
      } },
    { id: "coverage_at_90", kind: "metric", format: "percent", label: "Answers at 90% probability or more",
      help: "Share of the shown answers (Box excluded) whose predicted answer has probability 0.9 or more. Advisory, local arithmetic: it does not change Policy.",
      compute: (ctx) => {
        const ps = nums(shownAnswers(ctx).map(({ answer }) => answer.p));
        if (!ps.length) return null;
        const sure = ps.filter((p) => p >= 0.9).length;
        return { value: sure / ps.length, detail: `${sure} of ${plural(ps.length, "answer")}` };
      } },
    { id: "accuracy_at_90", kind: "metric", format: "percent", label: "Agreement of answers at 90% or more",
      help: "Of the labeled answers with probability 0.9 or more, the share that agree with the label. Advisory, local arithmetic: it does not change Policy.",
      compute: (ctx) => {
        const marks = scoredWithP(ctx).filter((mark) => mark.p >= 0.9);
        return marks.length ? { value: marks.filter((mark) => mark.ok).length / marks.length, detail: `of ${plural(marks.length, "labeled answer")}` } : null;
      } },
    { id: "score_mae", kind: "metric", label: "Score mean absolute error against labels",
      help: "Mean distance between each Score answer's value and its labeled level, in levels.",
      compute: (ctx) => meanOf(shownAnswers(ctx).filter(({ answer }) => answer.type === "score" && answer.labelValid === true && isNum(answer.value))
        .map(({ answer }) => Math.abs(answer.value - Number(answer.label)))) },
    { id: "mean_box_iou", kind: "metric", label: "Mean Box overlap with labels",
      help: "Mean intersection over union of Box answers and their labeled boxes.",
      compute: (ctx) => meanOf(nums(shownAnswers(ctx).filter(({ answer }) => answer.type === "box" && isBox(answer.box) && isBox(answer.label))
        .map(({ answer }) => iou(answer.box, answer.label)))) },

    // ---------- answer distributions ----------
    { id: "noul_yes_share", kind: "metric", format: "percent", label: "Noul answers predicted yes",
      help: "Share of the shown yes/no answers with P(yes) of 0.5 or more.",
      compute: (ctx) => {
        const picks = shownAnswers(ctx).filter(({ answer }) => answer.type === "noul" && answer.predicted !== null);
        if (!picks.length) return null;
        const yes = picks.filter(({ answer }) => answer.predicted === "yes").length;
        return { value: yes / picks.length, detail: `${yes} of ${plural(picks.length, "answer")}` };
      } },

    // ---------- measured calls ----------
    { id: "latency_stdev", kind: "metric", format: "ms", label: "Call latency standard deviation, shown rows",
      help: "Sample standard deviation of the measured latencies; needs two measured calls.",
      compute: (ctx) => (latencies(ctx).length >= 2 ? stdev(latencies(ctx)) : null) },
    { id: "shown_input_tokens", kind: "metric", format: "integer", label: "Input tokens of shown rows",
      help: "The sum of the measured input tokens of the shown rows' calls.",
      compute: (ctx) => {
        const tokens = nums(ctx.shown().map((item) => item.meta?.input_tokens));
        return tokens.length ? total(tokens) : null;
      } },
    { id: "output_tokens_per_second", kind: "metric", label: "Output tokens per second of call time",
      help: "Measured output tokens divided by measured latency, over the shown rows' calls that reported both.",
      compute: (ctx) => {
        const calls = ctx.shown().filter((item) => isNum(item.meta?.output_tokens) && isNum(item.meta?.latency_ms));
        const ms = total(calls.map((item) => item.meta.latency_ms));
        return calls.length && ms > 0 ? total(calls.map((item) => item.meta.output_tokens)) / (ms / 1000) : null;
      } },
    { id: "wall_per_answered", kind: "metric", format: "ms", label: "Wall time per answered row",
      help: "The run's wall time (summed across retry attempts, so not one wall-clock span) divided by its answered rows.",
      compute: (ctx) => {
        const run = ctx.data.run;
        return run && run.completed > 0 && isNum(run.wall_ms) ? run.wall_ms / run.completed : null;
      } },

    // ---------- exports ----------
    { id: "agreement_by_question_md", kind: "exporter", label: "Agreement by question as Markdown", filename: "bulk-agreement-by-question.md", mime: "text/markdown",
      help: "Counts and agreement rates with 95% Wilson intervals per question, measured on the shown rows. No inputs, labels or answers.",
      build: (ctx) => {
        requireRun(ctx);
        const entries = shownAnswers(ctx);
        const rows = ctx.data.questionIds.map((qid) => {
          const mine = entries.filter((entry) => entry.qid === qid);
          const marks = scored(mine);
          const agree = marks.filter((entry) => entry.answer.agrees).length;
          const [low, high] = marks.length ? wilson(agree, marks.length) : [null, null];
          return [qid, ctx.data.questions?.[qid]?.type || mine[0]?.answer.type || "", mine.length, marks.length, agree,
            marks.length ? pct(agree / marks.length) : "—", marks.length ? `${pct(low)}–${pct(high)}` : "—"];
        });
        return `# Bulk agreement by question\n\n${formatMarkdownTable(["question", "type", "answered", "labeled", "agree", "agreement", "95% interval"], rows)}\n`;
      } },
    { id: "confusion_csv", kind: "exporter", label: "Confusion matrix of Calibrate's question as CSV", filename: "bulk-confusion.csv", mime: "text/csv",
      help: "Counts of shown rows by human label (rows) and predicted answer (columns) for Calibrate's question. Counts only: no inputs.",
      build: (ctx) => {
        requireRun(ctx);
        const qid = ctx.data.calQuestion;
        if (!qid) throw new Error("Choose a question in Calibrate first.");
        const entries = calEntries(ctx).filter(({ answer }) => answer.labelValid === true && typeof answer.label === "string" && typeof answer.predicted === "string");
        const classes = [];
        const add = (key) => { if (!classes.includes(key)) classes.push(key); };
        for (const { answer } of calEntries(ctx)) for (const entry of answer.probabilities || []) add(entry.key);
        for (const { answer } of entries) { add(answer.label); add(answer.predicted); }
        const count = (label, predicted) => entries.filter(({ answer }) => answer.label === label && answer.predicted === predicted).length;
        return csvText([[`${qid}: label \\ answer`, ...classes], ...classes.map((label) => [label, ...classes.map((predicted) => String(count(label, predicted)))])]);
      } },
    { id: "answers_jsonl", kind: "exporter", label: "Shown answers with probabilities as JSON Lines", filename: "bulk-answers.jsonl", mime: "application/x-ndjson",
      help: "Contains model answers: per shown answered row, each question's predicted answer, value, probability, confidence, option probabilities and box. No inputs or labels; held-out rows stay out.",
      build: (ctx) => ctx.shown().filter((item) => item.answers).map((item) => JSON.stringify({ row: item.position,
        answers: Object.fromEntries(answersOf(item).map(([qid, answer]) => [qid, { type: answer.type, predicted: answer.predicted, value: answer.value, p: answer.p,
          confidence: answer.confidence, probabilities: Object.fromEntries((answer.probabilities || []).map((entry) => [entry.key, entry.p])), box: answer.box }])) }))
        .map((line) => `${line}\n`).join("") },
    { id: "calls_csv", kind: "exporter", label: "Call measurements as CSV", filename: "bulk-calls.csv", mime: "text/csv",
      help: "Measured model, latency, tokens and cost of each shown row's call. No inputs, labels or answers.",
      build: (ctx) => csvText([["row", "status", "model", "latency_ms", "input_tokens", "output_tokens", "cost_usd"],
        ...ctx.shown().map((item) => [String(item.position), item.status, show(item.meta?.model), show(item.meta?.latency_ms), show(item.meta?.input_tokens),
          show(item.meta?.output_tokens), show(item.meta?.cost_usd)])]) },
    { id: "unanswered_csv", kind: "exporter", label: "Unanswered rows and their errors as CSV", filename: "bulk-unanswered.csv", mime: "text/csv",
      help: "Row number, status and error message of each shown failed or skipped row. No inputs or labels.",
      build: (ctx) => csvText([["row", "status", "error"], ...ctx.shown().filter((item) => item.status !== "answered")
        .map((item) => [String(item.position), item.status, show(item.error)])]) },
    { id: "boxes_csv", kind: "exporter", label: "Box answers as CSV", filename: "bulk-boxes.csv", mime: "text/csv",
      help: "Contains model answers: the edges and confidence of every Box answer on the shown rows. No inputs or labels.",
      build: (ctx) => csvText([["row", "question", "left", "top", "right", "bottom", "confidence"],
        ...shownAnswers(ctx).filter(({ answer }) => isEdges(answer.box)).map(({ item, qid, answer }) => [String(item.position), qid,
          String(answer.box.left), String(answer.box.top), String(answer.box.right), String(answer.box.bottom), show(answer.confidence)])]) },
    { id: "probabilities_csv", kind: "exporter", label: "Every option's probability as CSV", filename: "bulk-probabilities.csv", mime: "text/csv",
      help: "Contains model probabilities: one line per shown row, question and option (Noul: yes and no). No inputs or labels.",
      build: (ctx) => csvText([["row", "question", "option", "probability"],
        ...shownAnswers(ctx).flatMap(({ item, qid, answer }) => (answer.probabilities || []).map((entry) => [String(item.position), qid, entry.key, String(entry.p)]))]) },
    { id: "answer_counts_csv", kind: "exporter", label: "Answer counts per question as CSV", filename: "bulk-answer-counts.csv", mime: "text/csv",
      help: "How many shown rows got each predicted answer, per question (Box excluded): counts only, no inputs.",
      build: (ctx) => {
        const lines = [["question", "answer", "rows"]];
        for (const qid of ctx.data.questionIds) {
          const counts = new Map();
          for (const { answer } of shownAnswers(ctx).filter((entry) => entry.qid === qid && typeof entry.answer.predicted === "string")) {
            counts.set(answer.predicted, (counts.get(answer.predicted) || 0) + 1);
          }
          for (const [answer, count] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) lines.push([qid, answer, String(count)]);
        }
        return csvText(lines);
      } },
    { id: "close_calls_csv", kind: "exporter", label: "Close calls as CSV", filename: "bulk-close-calls.csv", mime: "text/csv",
      help: `Contains model probabilities: each shown Choice or Score answer whose two most likely options are within ${CLOSE} of each other, with both options. Advisory rule, local arithmetic. No inputs or labels.`,
      build: (ctx) => csvText([["row", "question", "first", "first_p", "second", "second_p"],
        ...shownAnswers(ctx).flatMap(({ item, qid, answer }) => {
          if (answer.type !== "choice" && answer.type !== "score") return [];
          const top = (answer.probabilities || []).filter((entry) => isNum(entry.p)).slice().sort((a, b) => b.p - a.p);
          return top.length >= 2 && top[0].p - top[1].p < CLOSE ? [[String(item.position), qid, top[0].key, String(top[0].p), top[1].key, String(top[1].p)]] : [];
        })]) },
    { id: "rows_handoff", kind: "exporter", label: "Shown rows' inputs and labels as rows-box lines",
      filename: (ctx) => (asArray(handoffRows(ctx)) ? "bulk-rows.json" : "bulk-rows.jsonl"),
      help: "Inputs, picture names and the human labels now in force (including table labels), one JSON line per shown row, as the rows box reads them (a JSON array when a row is an array, number or boolean). No answers, probabilities or call data; held-out rows stay out.",
      build: (ctx) => {
        const rows = handoffRows(ctx);
        if (asArray(rows)) return `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
        return rows.map((row) => `${JSON.stringify(row)}\n`).join("");
      } },

    // ---------- commands ----------
    { id: "sort_by_cal", kind: "command", title: "Sort the Bulk results by Calibrate's question", group: "Bulk results",
      when: (ctx) => !!ctx.data.calQuestion && ctx.data.questionIds.includes(ctx.data.calQuestion),
      run: (ctx) => ctx.actions.sortBy(ctx.data.calQuestion, "desc") },
    { id: "first_disagreement", kind: "command", title: "Go to the first label disagreement", group: "Bulk results",
      when: (ctx) => !!firstShown(ctx, (item) => answersOf(item).some(([, answer]) => answer.agrees === false)),
      run: (ctx) => focus(ctx, (item) => answersOf(item).some(([, answer]) => answer.agrees === false)) },
    { id: "first_invalid_label", kind: "command", title: "Go to the first row with a label that fits no answer", group: "Bulk results",
      when: (ctx) => !!firstShown(ctx, (item) => answersOf(item).some(([, answer]) => answer.labelValid === false)),
      run: (ctx) => focus(ctx, (item) => answersOf(item).some(([, answer]) => answer.labelValid === false)) },
    { id: "least_certain_row", kind: "command", title: "Go to the least certain Bulk row", group: "Bulk results",
      help: "The shown row whose least likely predicted answer has the lowest probability (the first one on a tie).",
      when: (ctx) => ctx.shown().some((item) => lowestP(item) !== null),
      run: (ctx) => {
        let best = null;
        for (const item of ctx.shown()) if (lowestP(item) !== null && (!best || lowestP(item) < lowestP(best))) best = item;
        return ctx.actions.focusRow(best.index);
      } },
    { id: "slowest_row", kind: "command", title: "Go to the slowest Bulk row", group: "Bulk results",
      when: (ctx) => ctx.shown().some((item) => isNum(item.meta?.latency_ms)),
      run: (ctx) => {
        let best = null;
        for (const item of ctx.shown()) if (isNum(item.meta?.latency_ms) && (!best || item.meta.latency_ms > best.meta.latency_ms)) best = item;
        return ctx.actions.focusRow(best.index);
      } },
    { id: "first_held_out", kind: "command", title: "Go to the first held-out Bulk row", group: "Bulk results",
      when: (ctx) => !!firstShown(ctx, (item) => item.test), run: (ctx) => focus(ctx, (item) => item.test) },
    { id: "first_skipped", kind: "command", title: "Go to the first skipped Bulk row", group: "Bulk results",
      when: (ctx) => !!firstShown(ctx, (item) => item.status === "skipped"), run: (ctx) => focus(ctx, (item) => item.status === "skipped") },
    { id: "copy_positions", kind: "command", title: "Copy the shown Bulk row numbers", group: "Bulk results",
      when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => {
        const shown = ctx.shown();
        ctx.env.copy(shown.map((item) => item.position).join(", "));
        ctx.env.toast(`Copied ${plural(shown.length, "row number")}.`, "ok");
      } },
    { id: "copy_texts", kind: "command", title: "Copy the shown Bulk row texts", group: "Bulk results",
      help: "The shown rows' input text, one per line: a text row or an object's text field as written, any other input as JSON. No picture names, labels or answers.",
      when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => {
        const shown = ctx.shown();
        ctx.env.copy(shown.map((item) => inputText(item).replace(/\r?\n/g, " ")).join("\n"));
        ctx.env.toast(`Copied ${plural(shown.length, "row text")}.`, "ok");
      } },
  ],
});
