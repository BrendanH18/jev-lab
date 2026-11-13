// Bulk results insights: facts, checks, metrics, exports and commands for the user's own Bulk run
// (surface workbench.bulk.results; contract in static/js/lab/surfaces/workbench-bulk.js).
// Read-only: it never edits answers or labels, never shows a held-out row's answers, and every number comes from the
// run the current user made in this page session. Projections are labeled as projections.
import { csvText, definePack } from "../../kit.js";

const answersOf = (item) => (item && item.answers && typeof item.answers === "object"
  ? Object.entries(item.answers).filter(([, answer]) => answer && typeof answer === "object") : []);
const numbers = (values) => values.filter((value) => typeof value === "number" && Number.isFinite(value));
const lowest = (values) => (numbers(values).length ? Math.min(...numbers(values)) : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const show = (value) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

export default definePack({
  id: "bulk-results-insights",
  surface: "workbench.bulk.results",
  title: "Bulk results insights",
  about: "Filters, checks, measurements and exports over the answers of your own Bulk run in this session. Held-out rows' answers stay hidden; cost projections are arithmetic on measured calls, never spend.",
  features: [
    // ---------- facts ----------
    { id: "min_p", kind: "fact", type: "number", label: "lowest answer probability",
      help: "The smallest probability of a predicted answer on the row (Choice, Score and Noul; a Noul counts max(P, 1 − P)).",
      value: (item) => lowest(answersOf(item).map(([, answer]) => answer.p)) },
    { id: "min_confidence", kind: "fact", type: "number", label: "lowest confidence",
      help: "The smallest confidence field among the row's answers; Noul answers carry none.",
      value: (item) => lowest(answersOf(item).map(([, answer]) => answer.confidence)) },
    { id: "disagreements", kind: "fact", type: "number", label: "label disagreements",
      help: "Answers whose human label says otherwise (Box: overlap under 0.5). Unanswered and held-out rows are unavailable.",
      value: (item) => (item.answers ? answersOf(item).filter(([, answer]) => answer.agrees === false).length : null) },
    { id: "latency", kind: "fact", type: "number", label: "call latency", unit: "ms", help: "Measured for the row's call; unavailable on unanswered rows.",
      value: (item) => numbers([item.meta?.latency_ms])[0] ?? null },
    { id: "cost", kind: "fact", type: "number", label: "measured call cost", unit: "USD", help: "Measured cost of the row's call, not an estimate; unavailable on unanswered rows.",
      value: (item) => numbers([item.meta?.cost_usd])[0] ?? null },
    { id: "status", kind: "fact", type: "category", label: "run status", help: "answered, failed (the call returned an error) or skipped (never sent).",
      value: (item) => (typeof item.status === "string" && item.status ? item.status : null) },
    { id: "cal_answer", kind: "fact", type: "category", label: "answer to Calibrate's question",
      help: "The predicted answer for the question Calibrate shows; unavailable for unanswered and held-out rows.",
      value: (item, ctx) => {
        const qid = ctx?.data?.calQuestion;
        return qid ? item.answers?.[qid]?.predicted ?? null : null;
      } },
    { id: "error", kind: "fact", type: "text", label: "error message", help: "The failed call's message; empty on other rows.",
      value: (item) => (typeof item.error === "string" ? item.error : "") },

    // ---------- checks ----------
    { id: "invalid_label", kind: "diagnostic", severity: "advice", label: "Label that fits no answer",
      check: (item) => answersOf(item).filter(([, answer]) => answer.labelValid === false)
        .map(([qid]) => `The label for ${qid} is not one of its options or levels, so it is never scored. Fix it in the rows box.`) },
    { id: "stopped_run", kind: "diagnostic", severity: "problem", scope: "list", label: "Rows never sent",
      check: (items, ctx) => {
        const skipped = items.filter((item) => item.status === "skipped").length;
        const reason = ctx?.data?.run?.stopped;
        return skipped && reason ? `${plural(skipped, "shown row")} never sent: the run stopped early (${reason}). Retry them from the table when the cause is fixed.` : null;
      } },
    { id: "mixed_models", kind: "diagnostic", severity: "advice", scope: "list", label: "Answers from more than one model version",
      check: (items) => {
        const models = [...new Set(items.map((item) => item.meta?.model).filter(Boolean))];
        return models.length > 1 ? `The shown answers come from ${models.length} model versions (${models.join(", ")}). Compare like with like before tuning.` : null;
      } },
    { id: "tiny_box", kind: "diagnostic", severity: "info", label: "Box under 1% of the picture",
      check: (item) => answersOf(item).filter(([, answer]) => answer.box && (answer.box.right - answer.box.left) * (answer.box.bottom - answer.box.top) < 0.01)
        .map(([qid]) => `The ${qid} box covers under 1% of the picture.`) },

    // ---------- metrics ----------
    { id: "agreement_rate", kind: "metric", format: "percent", label: "Labeled answers that agree, shown rows",
      help: "Across every question with a valid human label (Box: overlap of at least 0.5). Measured on this run.",
      compute: (ctx) => {
        const verdicts = ctx.shown().flatMap((item) => answersOf(item).map(([, answer]) => answer.agrees)).filter((value) => value === true || value === false);
        return verdicts.length ? { value: verdicts.filter(Boolean).length / verdicts.length, detail: `of ${plural(verdicts.length, "labeled answer")}` } : null;
      } },
    { id: "mean_latency", kind: "metric", format: "ms", label: "Mean call latency, shown rows",
      compute: (ctx) => {
        const values = numbers(ctx.shown().map((item) => item.meta?.latency_ms));
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
      } },
    { id: "p95_latency", kind: "metric", format: "ms", label: "95th percentile call latency, shown rows", help: "Nearest rank.",
      compute: (ctx) => {
        const values = numbers(ctx.shown().map((item) => item.meta?.latency_ms)).sort((a, b) => a - b);
        return values.length ? values[Math.ceil(0.95 * values.length) - 1] : null;
      } },
    { id: "cost_per_1000", kind: "metric", format: "usd", label: "Projected cost per 1,000 answered rows",
      help: "Arithmetic on this run's measured cost (retries included), not spend and not a budget bound.",
      compute: (ctx) => {
        const run = ctx.data.run;
        return run && run.completed > 0 && typeof run.cost_usd === "number" ? (run.cost_usd / run.completed) * 1000 : null;
      } },
    { id: "tokens_per_row", kind: "metric", label: "Input tokens per answered row", help: "Measured totals of the run, retries included.",
      compute: (ctx) => {
        const run = ctx.data.run;
        return run && run.completed > 0 && typeof run.input_tokens === "number" ? run.input_tokens / run.completed : null;
      } },

    // ---------- exports ----------
    { id: "shown_answers_csv", kind: "exporter", label: "Shown rows' answers as CSV", filename: "bulk-answers.csv", mime: "text/csv",
      help: "Contains model answers: the predicted option and its probability per question for the shown rows. Held-out rows' answers stay out; Box questions are left out.",
      build: (ctx) => {
        const isBox = (qid) => ctx.data.questions?.[qid]?.type === "box" || ctx.items().some((item) => item.answers?.[qid]?.type === "box");
        const columns = ctx.data.questionIds.filter((qid) => !isBox(qid));
        return csvText([["row", "status", ...columns.flatMap((qid) => [qid, `${qid}:p`])],
          ...ctx.shown().map((item) => [String(item.position), item.status, ...columns.flatMap((qid) => {
            const answer = item.answers?.[qid];
            return answer ? [show(answer.predicted), show(answer.p)] : ["", ""];
          })])]);
      } },
    { id: "disagreements_csv", kind: "exporter", label: "Label disagreements as CSV", filename: "bulk-disagreements.csv", mime: "text/csv",
      help: "Contains model answers and human labels: one line per shown answer that disagrees with its label.",
      build: (ctx) => csvText([["row", "question", "label", "answer", "probability"],
        ...ctx.shown().flatMap((item) => answersOf(item).filter(([, answer]) => answer.agrees === false)
          .map(([qid, answer]) => [String(item.position), qid, show(answer.label), show(answer.type === "box" ? answer.box : answer.predicted), show(answer.p)]))]) },
    { id: "run_summary_md", kind: "exporter", label: "Run summary as Markdown", filename: "bulk-run-summary.md", mime: "text/markdown",
      help: "Measured totals of this session's run. No inputs, labels or answers.",
      build: (ctx) => {
        const run = ctx.data.run;
        if (!run) throw new Error("Run Bulk first: there is no run to summarize.");
        return ["# Bulk run summary", "",
          `- Rows: ${run.rows} (${run.completed} answered, ${run.failed} failed, ${run.skipped} skipped; ${run.held_out} held out)`,
          `- Model asked: ${run.requested_model ?? "unknown"}`,
          `- Model that answered: ${run.model ?? "unknown"}`,
          `- Wall time: ${run.wall_ms === null ? "unknown" : `${Math.round(run.wall_ms)} ms`} (summed across attempts)`,
          `- Input tokens: ${run.input_tokens ?? "unknown"}`,
          `- Measured cost: ${run.cost_usd === null ? "unknown" : `$${run.cost_usd}`}`,
          ...(run.stopped ? [`- Stopped early: ${run.stopped}`] : []), ""].join("\n");
      } },

    // ---------- commands ----------
    { id: "sort_by_row", kind: "command", title: "Sort the Bulk results by row number", group: "Bulk results",
      when: (ctx) => !!ctx.data.run, run: (ctx) => ctx.actions.sortBy("__row", "asc") },
    { id: "keep_labels", kind: "command", title: "Keep table labels in the rows box", group: "Bulk results",
      when: (ctx) => !!ctx.data.run && ctx.data.labelsDirty, run: (ctx) => ctx.actions.keepLabels() },
    { id: "download_csv", kind: "command", title: "Download the Bulk results CSV", group: "Bulk results",
      when: (ctx) => !!ctx.data.run, run: (ctx) => ctx.actions.downloadCsv() },
    { id: "first_failed", kind: "command", title: "Go to the first failed Bulk row", group: "Bulk results",
      when: (ctx) => ctx.shown().some((item) => item.status === "failed"),
      run: (ctx) => ctx.actions.focusRow(ctx.shown().find((item) => item.status === "failed").index) },
  ],
});
