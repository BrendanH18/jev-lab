// Starter pack for "autopilot.benchmark" (contract: static/js/lab/surfaces/autopilot.js): what the user's own
// benchmark runs measured, beyond the three bar charts. Every number is a measurement of a run the user started in
// this page load; projections say so, and runs of different models are never pooled.
import { csvText, definePack, formatValue } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const latest = (ctx) => ctx.data.latest || null;
const runs = (ctx) => (Array.isArray(ctx.data.runs) ? ctx.data.runs : []);
// Runs made on the latest run's model, so averages never mix models.
const sameModel = (ctx) => {
  const last = latest(ctx);
  return last ? runs(ctx).filter((run) => run.model === last.model) : [];
};
const field = (run, mode, key) => num(run?.[mode]?.[key]);
const both = (a, b, combine) => (a === null || b === null ? null : combine(a, b));
const sum = (values) => values.reduce((total, value) => total + value, 0);
function median(values) {
  const known = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = known.length >> 1;
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}
const runCost = (run) => {
  const costs = ["sequential", "parallel", "merged"].map((mode) => field(run, mode, "cost_usd"));
  return costs.every((cost) => cost === null) ? null : sum(costs.filter((cost) => cost !== null));
};
const MODES = [["sequential", "2 calls, in turn"], ["parallel", "2 calls, parallel"], ["merged", "1 merged call"]];

export default definePack({
  id: "autopilot-bench-insights",
  surface: "autopilot.benchmark",
  title: "Benchmark insights",
  about: "Savings, speed-ups, medians across your runs on the same model, a projection tool, exports and a history table for the merged-call benchmark. Every number is measured by your own runs in this page load; projections are labeled, and exports hold run numbers only.",
  features: [
    // ---------- the latest run ----------
    { id: "token_saving_share", kind: "metric", format: "percent", label: "share of input tokens saved",
      compute: (ctx) => both(field(latest(ctx), "sequential", "input_tokens"), field(latest(ctx), "merged", "input_tokens"), (a, b) => (a > 0 ? (a - b) / a : null)) },
    { id: "time_saved", kind: "metric", format: "ms", label: "wall time saved vs calls in turn",
      compute: (ctx) => both(field(latest(ctx), "sequential", "wall_ms"), field(latest(ctx), "merged", "wall_ms"), (a, b) => a - b) },
    { id: "merged_minus_parallel", kind: "metric", format: "ms", label: "merged minus parallel wall time", help: "Positive when the merged call was slower than two parallel calls.",
      compute: (ctx) => both(field(latest(ctx), "merged", "wall_ms"), field(latest(ctx), "parallel", "wall_ms"), (a, b) => a - b) },
    { id: "speedup", kind: "metric", format: "number", label: "speed-up vs calls in turn",
      compute: (ctx) => both(field(latest(ctx), "sequential", "wall_ms"), field(latest(ctx), "merged", "wall_ms"), (a, b) => (b > 0 ? a / b : null)) },
    { id: "cost_saved", kind: "metric", format: "usd", label: "measured cost saved per email",
      compute: (ctx) => both(field(latest(ctx), "sequential", "cost_usd"), field(latest(ctx), "merged", "cost_usd"), (a, b) => a - b) },
    { id: "merged_cost_thousand", kind: "metric", format: "usd", label: "projected merged cost per 1,000 emails", help: "Projection: the latest measured merged cost times 1,000, not spend.",
      compute: (ctx) => { const cost = field(latest(ctx), "merged", "cost_usd"); return cost === null ? null : cost * 1000; } },
    { id: "merged_call_latency", kind: "metric", format: "ms", label: "merged call latency (server-measured)", compute: (ctx) => num(latest(ctx)?.per_call_ms?.merged) },
    { id: "separate_latency", kind: "metric", format: "ms", label: "shield plus dispatch call latency",
      compute: (ctx) => both(num(latest(ctx)?.per_call_ms?.shield), num(latest(ctx)?.per_call_ms?.dispatch), (a, b) => a + b) },
    { id: "tokens_per_question", kind: "metric", format: "number", label: "merged input tokens per question",
      compute: (ctx) => both(field(latest(ctx), "merged", "input_tokens"), field(latest(ctx), "merged", "questions"), (a, b) => (b > 0 ? a / b : null)) },

    // ---------- across the runs of this page load ----------
    { id: "run_count", kind: "metric", format: "integer", label: "benchmark runs this page load", compute: (ctx) => (runs(ctx).length ? runs(ctx).length : null) },
    { id: "session_spend", kind: "metric", format: "usd", label: "benchmark spend this page load", help: "Measured cost of every mode of every run.",
      compute: (ctx) => { const costs = runs(ctx).map(runCost).filter((cost) => cost !== null); return costs.length ? sum(costs) : null; } },
    { id: "model_count", kind: "metric", format: "integer", label: "models benchmarked this page load",
      compute: (ctx) => { const models = new Set(runs(ctx).map((run) => run.model || "unknown")); return models.size || null; } },
    { id: "median_merged", kind: "metric", format: "ms", label: "median merged wall time, latest model",
      compute: (ctx) => { const list = sameModel(ctx); return list.length ? { value: median(list.map((run) => field(run, "merged", "wall_ms"))), detail: `${list.length} run${list.length === 1 ? "" : "s"} on ${latest(ctx).model || "an unknown model"}` } : null; } },
    { id: "median_sequential", kind: "metric", format: "ms", label: "median wall time of calls in turn, latest model",
      compute: (ctx) => { const list = sameModel(ctx); return list.length ? median(list.map((run) => field(run, "sequential", "wall_ms"))) : null; } },
    { id: "merged_beats_parallel", kind: "metric", format: "percent", label: "runs where merged beat parallel calls",
      compute: (ctx) => {
        const list = sameModel(ctx).filter((run) => field(run, "merged", "wall_ms") !== null && field(run, "parallel", "wall_ms") !== null);
        return list.length ? { value: list.filter((run) => field(run, "merged", "wall_ms") < field(run, "parallel", "wall_ms")).length / list.length, detail: `${list.length} run${list.length === 1 ? "" : "s"} on the latest model` } : null;
      } },

    // ---------- exports and a tool ----------
    { id: "runs_csv", kind: "exporter", label: "Benchmark runs as CSV", filename: "autopilot-benchmark.csv", mime: "text/csv",
      help: "the measured time, tokens, cost and requests of each mode of each run this page load, with its model; no answers or email text",
      build: (ctx) => {
        const header = ["run", "model", "email", ...MODES.flatMap(([mode]) => [`${mode} ms`, `${mode} input tokens`, `${mode} cost usd`, `${mode} requests`])];
        const rows = runs(ctx).map((run) => [run.run, run.model ?? "", run.id, ...MODES.flatMap(([mode]) => ["wall_ms", "input_tokens", "cost_usd", "requests"].map((key) => field(run, mode, key) ?? ""))]);
        return csvText([header, ...rows]);
      } },
    { id: "latest_json", kind: "exporter", label: "Latest run as JSON", filename: "autopilot-benchmark-latest.json", mime: "application/json",
      help: "the latest run's measurements and model; no answers or email text",
      build: (ctx) => {
        const run = latest(ctx);
        if (!run) throw new Error("Run the benchmark first.");
        return `${JSON.stringify(run, null, 2)}\n`;
      } },
    { id: "summary_md", kind: "exporter", label: "Latest run as a Markdown table", filename: "autopilot-benchmark.md", mime: "text/markdown",
      help: "the latest run's time, tokens, cost and requests per mode; no answers or email text",
      build: (ctx) => {
        const run = latest(ctx);
        if (!run) throw new Error("Run the benchmark first.");
        return `## Autopilot benchmark, run ${run.run} (${run.model || "unknown model"})\n\n${formatMarkdownTable(["Mode", "Wall time", "Input tokens", "Cost", "Requests"],
          MODES.map(([mode, label]) => [label, formatValue(field(run, mode, "wall_ms"), "ms"), formatValue(field(run, mode, "input_tokens"), "integer"),
            formatValue(field(run, mode, "cost_usd"), "usd"), formatValue(field(run, mode, "requests"), "integer")]))}\n\nMeasured by your own run; latency varies from run to run.\n`;
      } },
    { id: "merge_savings", kind: "tool", group: "Projections", title: "Project merge savings",
      help: "What merging saves per day and per 30 days for a volume you type, from token counts and a price you type. A projection, not spend.",
      inputs: [{ name: "emails", label: "Emails per day", type: "integer", min: 0, default: 100 },
        { name: "separate", label: "Input tokens, two separate calls", type: "integer", min: 0 },
        { name: "merged", label: "Input tokens, one merged call", type: "integer", min: 0 },
        { name: "price", label: "Price per million input tokens (USD)", type: "number", min: 0 }],
      compute: ({ emails, separate, merged, price }) => {
        const perEmail = separate - merged;
        const perDay = perEmail * emails;
        const dollars = (perDay * price) / 1_000_000;
        return { rows: [["Tokens saved per email", perEmail], ["Tokens saved per day", perDay], ["Dollars saved per day (projection)", Number(dollars.toFixed(6))],
          ["Dollars saved per 30 days (projection)", Number((dollars * 30).toFixed(6))]], note: perEmail < 0 ? "The merged call used more tokens than the two calls." : null };
      } },

    // ---------- panel ----------
    { id: "history", kind: "panel", title: "Benchmark history",
      improvements: [{ id: "table", title: "Table of every benchmark run this page load" }, { id: "other_model", title: "Mark runs made on a different model than the latest" },
        { id: "fastest", title: "Highlight the run with the fastest merged call" }],
      render: (h, ctx) => {
        const list = runs(ctx);
        if (!list.length) return h("p", { class: "faint" }, "No benchmark run yet in this page load.");
        const last = latest(ctx);
        let fastest = null;
        for (const run of list) {
          const wall = field(run, "merged", "wall_ms");
          if (wall !== null && (fastest === null || wall < field(fastest, "merged", "wall_ms"))) fastest = run;
        }
        return [h("div", { class: "scroll" }, h("table", { class: "table lab-table" },
          h("thead", {}, h("tr", {}, ["Run", "Model", "In turn", "Parallel", "Merged", "Tokens saved"].map((title) => h("th", {}, title)))),
          h("tbody", {}, list.map((run) => h("tr", { "data-run": String(run.run), "data-fastest": run === fastest ? "true" : null, style: run === fastest ? { fontWeight: "600" } : null },
            h("td", {}, String(run.run), run === fastest ? h("span", { class: "badge good", style: { marginLeft: "6px" } }, "fastest merged") : null),
            h("td", {}, run.model || "unknown", run.model !== last.model ? h("span", { class: "badge warning", style: { marginLeft: "6px" } }, "other model") : null),
            ...MODES.map(([mode]) => h("td", { class: "num" }, formatValue(field(run, mode, "wall_ms"), "ms"))),
            h("td", { class: "num" }, formatValue(both(field(run, "sequential", "input_tokens"), field(run, "merged", "input_tokens"), (a, b) => a - b), "integer"))))))),
        h("p", { class: "faint" }, "Measured by your own runs in this page load. Compare runs of the same model; latency varies from run to run.")];
      } },
  ],
});
