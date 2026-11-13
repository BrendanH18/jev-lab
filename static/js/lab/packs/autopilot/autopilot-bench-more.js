// More for "autopilot.benchmark" (contract: static/js/lab/surfaces/autopilot.js): what the user's benchmark runs of
// this page load say together. Session statistics pool only runs of the latest run's model and come with 95%
// intervals over runs; panels group by model, compare two runs, split wall time into server-measured call time and
// the rest, and chart runs over time. Every number is a measurement of the user's own runs; projections say so, and
// nothing here starts a benchmark (that is five live calls, left to the page's own button).
import { definePack } from "../../kit.js";
import { mean, median, normalQuantile, stdev, studentTQuantile } from "../../lib/math.js";
import { formatDelimited, formatMarkdownTable } from "../../lib/tables.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const runs = (ctx) => (Array.isArray(ctx.data.runs) ? ctx.data.runs : []);
const latest = (ctx) => ctx.data.latest || null;
const field = (run, mode, key) => num(run?.[mode]?.[key]);
const perCall = (run, key) => num(run?.per_call_ms?.[key]);
const modelName = (model) => (typeof model === "string" && model ? model : "unknown model");
// Runs made on the latest run's model, so statistics never pool models.
const sameModel = (ctx) => {
  const last = latest(ctx);
  return last ? runs(ctx).filter((run) => run.model === last.model) : [];
};
const MODES = [["sequential", "2 calls, in turn"], ["parallel", "2 calls, parallel"], ["merged", "1 merged call"]];
const ms = (value) => `${Math.round(value).toLocaleString("en-US")} ms`;
const signedMs = (value) => `${value > 0 ? "+" : ""}${ms(value)}`;
const pct = (value) => `${Math.round(value * 100)}%`;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const round1 = (value) => (value === null ? "" : Number(value.toFixed(1)));

// Per run: wall time merging saved against calls in turn, and merged minus parallel wall time.
const saved = (run) => { const a = field(run, "sequential", "wall_ms"), b = field(run, "merged", "wall_ms"); return a === null || b === null ? null : a - b; };
const parallelGap = (run) => { const a = field(run, "merged", "wall_ms"), b = field(run, "parallel", "wall_ms"); return a === null || b === null ? null : a - b; };
const knownOf = (list, read) => list.map(read).filter((value) => value !== null);

// Mean of a sample with its 95% Student t interval (null bounds below two values).
function interval(values) {
  if (!values.length) return null;
  const centre = mean(values);
  if (values.length < 2) return { mean: centre, low: null, high: null, n: 1 };
  const half = studentTQuantile(0.975, values.length - 1) * stdev(values) / Math.sqrt(values.length);
  return { mean: centre, low: centre - half, high: centre + half, n: values.length };
}

const intervalText = (stat) => (stat.low === null ? "an interval needs 2 runs" : `95% interval ${ms(stat.low)} to ${ms(stat.high)}`);

// Pooled share saved: (sum over runs of the two-call value - sum of the merged value) / sum of the two-call value.
function pooledShare(list, key) {
  const pairs = list.map((run) => [field(run, "sequential", key), field(run, "merged", key)]).filter(([a, b]) => a !== null && b !== null);
  const before = pairs.reduce((total, [a]) => total + a, 0), after = pairs.reduce((total, [, b]) => total + b, 0);
  return pairs.length && before > 0 ? (before - after) / before : null;
}

// Runs grouped by model, in order of first appearance.
function byModel(list) {
  const groups = new Map();
  for (const run of list) {
    const key = modelName(run.model);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return [...groups].map(([model, entries]) => ({ model, runs: entries, saved: interval(knownOf(entries, saved)), gap: interval(knownOf(entries, parallelGap)),
    tokens: pooledShare(entries, "input_tokens"), cost: pooledShare(entries, "cost_usd") }));
}

function gapVerdict(stat) {
  if (!stat) return "not measured";
  if (stat.low === null) return "needs 2 runs";
  if (stat.high < 0) return "merged faster than parallel";
  if (stat.low > 0) return "merged slower than parallel";
  return "no clear difference";
}

const MEASURES = [["wall_ms", "Wall time", (value) => ms(value)], ["input_tokens", "Input tokens", (value) => Math.round(value).toLocaleString("en-US")],
  ["cost_usd", "Cost", (value) => `$${Number(value.toPrecision(3))}`]];
const BAR = 20;

const runPicker = (h, list, value, attrs, onPick) => h("select", { ...attrs, value: String(value), onchange: (event) => onPick(Number(event.target.value)) },
  list.map((run) => h("option", { value: String(run.run), selected: run.run === value }, `Run ${run.run} · ${modelName(run.model)}`)));

export default definePack({
  id: "autopilot-bench-more",
  surface: "autopilot.benchmark",
  title: "Benchmark statistics across runs",
  about: "Merge savings across your benchmark runs of this page load with 95% intervals, per-model and run-to-run comparisons, where each mode's time went, a trend chart and exports of run numbers. Statistics never pool runs of different models, projections are labeled, exports hold run measurements only (no answers or email text), and nothing here starts a benchmark.",
  features: [
    // ---------- metrics across the latest model's runs ----------
    { id: "mean_time_saved", kind: "metric", format: "ms", label: "mean wall time saved by merging, latest model",
      help: "Calls in turn minus the merged call, averaged over this page load's runs on the latest run's model, with a 95% t-interval over runs.",
      compute: (ctx) => {
        const stat = interval(knownOf(sameModel(ctx), saved));
        return stat ? { value: stat.mean, detail: `${plural(stat.n, "run")} on ${modelName(latest(ctx).model)}; ${intervalText(stat)}` } : null;
      } },
    { id: "mean_parallel_gap", kind: "metric", format: "ms", label: "mean merged minus parallel wall time, latest model",
      help: "Positive when the merged call was slower than two parallel calls; averaged over runs on the latest model with a 95% t-interval.",
      compute: (ctx) => {
        const stat = interval(knownOf(sameModel(ctx), parallelGap));
        return stat ? { value: stat.mean, detail: `${plural(stat.n, "run")}; ${intervalText(stat)}; ${gapVerdict(stat)}` } : null;
      } },
    { id: "geo_speedup", kind: "metric", format: "number", label: "typical speed-up vs calls in turn, latest model",
      help: "Geometric mean over runs on the latest model of calls-in-turn wall time divided by merged wall time.",
      compute: (ctx) => {
        const ratios = sameModel(ctx).map((run) => {
          const a = field(run, "sequential", "wall_ms"), b = field(run, "merged", "wall_ms");
          return a !== null && b !== null && a > 0 && b > 0 ? a / b : null;
        }).filter((value) => value !== null);
        return ratios.length ? Math.exp(mean(ratios.map(Math.log))) : null;
      } },
    { id: "parallel_speedup", kind: "metric", format: "number", label: "speed-up of parallel calls vs calls in turn",
      help: "The latest run's calls-in-turn wall time divided by its parallel wall time: what running the two calls at once gives without merging.",
      compute: (ctx) => {
        const a = field(latest(ctx), "sequential", "wall_ms"), b = field(latest(ctx), "parallel", "wall_ms");
        return a !== null && b !== null && b > 0 ? a / b : null;
      } },
    { id: "pooled_cost_share", kind: "metric", format: "percent", label: "measured cost saved, pooled over the latest model's runs",
      compute: (ctx) => pooledShare(sameModel(ctx), "cost_usd") },
    { id: "merged_spread", kind: "metric", format: "ms", label: "spread of merged wall time, latest model",
      help: "Sample standard deviation of the merged call's wall time over runs on the latest model; needs two runs.",
      compute: (ctx) => { const values = knownOf(sameModel(ctx), (run) => field(run, "merged", "wall_ms")); return values.length >= 2 ? stdev(values) : null; } },
    { id: "latest_vs_earlier", kind: "metric", format: "ms", label: "latest merged time against earlier runs",
      help: "The latest merged wall time minus the median of earlier runs on the same model; positive means slower this time.",
      compute: (ctx) => {
        const last = latest(ctx), now = field(last, "merged", "wall_ms");
        const earlier = knownOf(sameModel(ctx).filter((run) => run.run !== last.run), (run) => field(run, "merged", "wall_ms"));
        return now === null || !earlier.length ? null : { value: now - median(earlier), detail: `against the median of ${plural(earlier.length, "earlier run")}` };
      } },
    { id: "merged_vs_slower_call", kind: "metric", format: "ms", label: "merged call minus the slower separate call",
      help: "Server-measured latency of the latest merged call minus the slower of its two separate calls: what asking all questions at once costs on the server.",
      compute: (ctx) => {
        const merged = perCall(latest(ctx), "merged"), shield = perCall(latest(ctx), "shield"), dispatch = perCall(latest(ctx), "dispatch");
        return merged === null || shield === null || dispatch === null ? null : merged - Math.max(shield, dispatch);
      } },
    { id: "beats_in_turn", kind: "metric", format: "percent", label: "runs where merged beat calls in turn",
      help: "Share of runs on the latest model where the merged call's wall time was below the two calls in turn, with a 95% Wilson interval.",
      compute: (ctx) => {
        const list = sameModel(ctx).filter((run) => field(run, "merged", "wall_ms") !== null && field(run, "sequential", "wall_ms") !== null);
        if (!list.length) return null;
        const wins = list.filter((run) => field(run, "merged", "wall_ms") < field(run, "sequential", "wall_ms")).length, n = list.length, p = wins / n;
        const z = normalQuantile(0.975), denominator = 1 + (z * z) / n;
        const centre = (p + (z * z) / (2 * n)) / denominator, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
        return { value: p, detail: `${wins} of ${plural(n, "run")}; 95% interval ${pct(Math.max(0, centre - half))} to ${pct(Math.min(1, centre + half))}` };
      } },
    { id: "latest_spend", kind: "metric", format: "usd", label: "measured spend of the latest benchmark run",
      help: "The measured cost of the latest run's five calls (all three modes).",
      compute: (ctx) => {
        const costs = MODES.map(([mode]) => field(latest(ctx), mode, "cost_usd")).filter((value) => value !== null);
        return costs.length ? costs.reduce((total, value) => total + value, 0) : null;
      } },
    { id: "hours_per_thousand", kind: "metric", format: "number", label: "projected hours of waiting saved per 1,000 emails",
      help: "Projection, not a measurement: the mean wall time merging saved on the latest model times 1,000, in hours.",
      compute: (ctx) => { const stat = interval(knownOf(sameModel(ctx), saved)); return stat ? (stat.mean * 1000) / 3_600_000 : null; } },

    // ---------- exports ----------
    { id: "stats_md", kind: "exporter", label: "Benchmark statistics by model as Markdown", filename: "autopilot-benchmark-stats.md", mime: "text/markdown",
      help: "per model: runs, mean wall time saved and merged minus parallel with 95% intervals, and pooled token and cost savings; run numbers only, no answers or email text",
      build: (ctx) => {
        const groups = byModel(runs(ctx));
        if (!groups.length) throw new Error("Run the benchmark first.");
        const cell = (stat) => (stat ? signedMs(stat.mean) : "—");
        const range = (stat) => (!stat ? "—" : stat.low === null ? "needs 2 runs" : `${ms(stat.low)} to ${ms(stat.high)}`);
        const share = (value) => (value === null ? "—" : pct(value));
        return `# Autopilot benchmark statistics\n\nMeasured by your own runs in this page load. Runs of different models are kept apart; intervals are 95% t-intervals over runs.\n\n${formatMarkdownTable(
          ["Model", "Runs", "Saved vs in turn", "95% interval", "Merged minus parallel", "95% interval", "Tokens saved", "Cost saved"],
          groups.map((group) => [group.model, group.runs.length, cell(group.saved), range(group.saved), cell(group.gap), range(group.gap), share(group.tokens), share(group.cost)]))}\n`;
      } },
    { id: "by_model_csv", kind: "exporter", label: "Benchmark statistics by model as CSV", filename: "autopilot-benchmark-by-model.csv", mime: "text/csv",
      help: "per model: runs, mean and 95% interval of wall time saved and of merged minus parallel (ms), pooled token and cost saving shares; run numbers only",
      build: (ctx) => formatDelimited([["model", "runs", "mean saved ms", "saved low ms", "saved high ms", "mean merged minus parallel ms", "gap low ms", "gap high ms", "token saving share", "cost saving share"],
        ...byModel(runs(ctx)).map((group) => [group.model, group.runs.length, round1(group.saved?.mean ?? null), round1(group.saved?.low ?? null), round1(group.saved?.high ?? null),
          round1(group.gap?.mean ?? null), round1(group.gap?.low ?? null), round1(group.gap?.high ?? null),
          group.tokens === null ? "" : Number(group.tokens.toFixed(4)), group.cost === null ? "" : Number(group.cost.toFixed(4))])], ",") },
    { id: "per_call_csv", kind: "exporter", label: "Per-call latencies as CSV", filename: "autopilot-benchmark-calls.csv", mime: "text/csv",
      help: "each run's server-measured Shield, Dispatch and merged call latencies beside its calls-in-turn and merged wall times, with its model; run numbers only",
      build: (ctx) => formatDelimited([["run", "model", "shield call ms", "dispatch call ms", "merged call ms", "sequential wall ms", "merged wall ms"],
        ...runs(ctx).map((run) => [run.run, modelName(run.model), perCall(run, "shield") ?? "", perCall(run, "dispatch") ?? "", perCall(run, "merged") ?? "",
          field(run, "sequential", "wall_ms") ?? "", field(run, "merged", "wall_ms") ?? ""])], ",") },

    // ---------- panels ----------
    { id: "savings_by_model", kind: "panel", title: "Merge savings by model",
      improvements: [{ id: "by_model", title: "Group this page load's benchmark runs by model in a savings table" },
        { id: "interval", title: "Show a 95% interval for the wall time merging saved against calls in turn" },
        { id: "parallel_interval", title: "Show a 95% interval for merged minus parallel wall time" },
        { id: "verdict", title: "Say whether the merged call was reliably faster than parallel calls" },
        { id: "more_runs", title: "Say when a model needs another run before an interval can be shown" },
        { id: "shares", title: "Show each model's pooled token and cost saving shares" }],
      render: (h, ctx) => {
        const groups = byModel(runs(ctx));
        if (!groups.length) return h("p", { class: "faint" }, "No benchmark run yet in this page load.");
        const range = (stat) => (!stat ? "—" : stat.low === null ? "needs 2 runs" : `${ms(stat.low)} to ${ms(stat.high)}`);
        const share = (value) => (value === null ? "—" : pct(value));
        const rows = groups.map((group) => [group.model, String(group.runs.length), group.saved ? ms(group.saved.mean) : "—", range(group.saved),
          group.gap ? signedMs(group.gap.mean) : "—", range(group.gap), gapVerdict(group.gap), share(group.tokens), share(group.cost)]);
        const columns = ["Model", "Runs", "Saved vs in turn", "95% interval", "Merged minus parallel", "95% interval", "Merged vs parallel", "Tokens saved", "Cost saved"];
        const KEYS = ["model", "runs", "saved", "saved_interval", "gap", "gap_interval", "verdict", "tokens", "cost"];
        const short = groups.filter((group) => group.runs.length < 2);
        return h("div", {}, h("p", { class: "faint" }, "Measured by your own runs in this page load; models are never pooled. Intervals are 95% t-intervals over runs, so latency noise widens them."),
          h("div", { class: "scroll" }, h("table", { class: "table lab-table" }, h("thead", {}, h("tr", {}, columns.map((title) => h("th", {}, title)))),
            h("tbody", {}, rows.map((row, index) => h("tr", { "data-model": groups[index].model }, row.map((value, at) => h("td", { "data-col": KEYS[at] }, value))))))),
          short.length ? h("ul", { "data-more-runs": "" }, short.map((group) => h("li", {}, `Run the benchmark once more on ${group.model} for an interval.`))) : null);
      } },
    { id: "run_compare", kind: "panel", title: "Compare two benchmark runs",
      improvements: [{ id: "pick", title: "Pick any two benchmark runs of this page load to compare" },
        { id: "diff", title: "Show each mode's wall time, token and cost change between the two runs" },
        { id: "model_warning", title: "Warn when the two compared runs used different models" },
        { id: "copy", title: "Copy the run comparison as text" }],
      render: (h, ctx, api) => {
        const list = runs(ctx);
        if (list.length < 2) return h("p", { class: "faint" }, "Run the benchmark twice in this page load to compare two runs.");
        const byRun = (value, fallback) => list.find((run) => run.run === value) || fallback;
        const a = byRun(api.state.a, list[list.length - 2]), b = byRun(api.state.b, list[list.length - 1]);
        const change = (mode, key) => { const x = field(a, mode, key), y = field(b, mode, key); return x === null || y === null ? null : y - x; };
        const rows = MODES.map(([mode, label]) => {
          const wall = change(mode, "wall_ms"), tokens = change(mode, "input_tokens"), cost = change(mode, "cost_usd");
          return { mode, cells: [label, field(a, mode, "wall_ms") === null ? "—" : ms(field(a, mode, "wall_ms")), field(b, mode, "wall_ms") === null ? "—" : ms(field(b, mode, "wall_ms")),
            wall === null ? "—" : signedMs(wall), tokens === null ? "—" : `${tokens > 0 ? "+" : ""}${tokens.toLocaleString("en-US")}`,
            cost === null ? "—" : `${cost > 0 ? "+" : cost < 0 ? "-" : ""}$${Number(Math.abs(cost).toPrecision(3))}`] };
        });
        const mixed = a.model !== b.model;
        const header = ["Mode", `Run ${a.run}`, `Run ${b.run}`, "Wall time change", "Token change", "Cost change"];
        const text = `${[`Benchmark run ${a.run} (${modelName(a.model)}) against run ${b.run} (${modelName(b.model)}), measured:`,
          ...rows.map((row) => `- ${row.cells[0]}: ${row.cells[1]} -> ${row.cells[2]} (${row.cells[3]}), tokens ${row.cells[4]}, cost ${row.cells[5]}`),
          ...(mixed ? ["The two runs used different models."] : [])].join("\n")}\n`;
        return h("div", {}, h("div", {}, "Compare ", runPicker(h, list, a.run, { "data-pick": "a" }, (value) => { api.state.a = value; api.redraw(); }),
          " with ", runPicker(h, list, b.run, { "data-pick": "b" }, (value) => { api.state.b = value; api.redraw(); })),
          mixed ? h("p", { class: "badge warning", "data-model-warning": "" }, `Run ${a.run} used ${modelName(a.model)} and run ${b.run} used ${modelName(b.model)}: compare runs of the same model.`) : null,
          h("table", { class: "table lab-table" }, h("thead", {}, h("tr", {}, header.map((title) => h("th", {}, title)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-mode": row.mode }, row.cells.map((value) => h("td", {}, value)))))),
          h("button", { class: "btn sm ghost", "data-copy": "compare", onclick: () => { api.copy(text); api.toast("Copied the comparison."); } }, "Copy comparison"));
      } },
    { id: "time_split", kind: "panel", title: "Where each mode's time went",
      improvements: [{ id: "breakdown", title: "Split calls-in-turn and merged wall time into server-measured call time and the rest" },
        { id: "pick_run", title: "Show the time split for any benchmark run of this page load" },
        { id: "missing", title: "Name the per-call latencies a run did not report" }],
      render: (h, ctx, api) => {
        const list = runs(ctx);
        if (!list.length) return h("p", { class: "faint" }, "No benchmark run yet in this page load.");
        const run = list.find((entry) => entry.run === api.state.run) || list[list.length - 1];
        const shield = perCall(run, "shield"), dispatch = perCall(run, "dispatch"), merged = perCall(run, "merged");
        const rows = [["sequential", "2 calls, in turn", shield === null || dispatch === null ? null : shield + dispatch], ["merged", "1 merged call", merged]].map(([mode, label, server]) => {
          const wall = field(run, mode, "wall_ms");
          return [mode, label, wall === null ? "—" : ms(wall), server === null ? "—" : ms(server), wall === null || server === null ? "—" : ms(wall - server)];
        });
        const missing = [["shield", "Shield call"], ["dispatch", "Dispatch call"], ["merged", "merged call"]].filter(([key]) => perCall(run, key) === null).map(([, name]) => name);
        return h("div", {}, h("p", {}, "Run ", runPicker(h, list, run.run, { "data-run-pick": "" }, (value) => { api.state.run = value; api.redraw(); })),
          h("table", { class: "table lab-table" }, h("thead", {}, h("tr", {}, ["Mode", "Wall time", "Server-measured calls", "The rest"].map((title) => h("th", {}, title)))),
            h("tbody", {}, rows.map(([mode, ...cells]) => h("tr", { "data-mode": mode }, cells.map((value) => h("td", {}, value)))))),
          missing.length ? h("p", { class: "badge warning", "data-missing": "" }, `Not reported for run ${run.run}: ${missing.join(", ")} latency.`) : null,
          h("p", { class: "faint" }, "The rest is network, queueing and client time. Parallel calls have no per-call measurement, so they are left out. Measured by your own run."));
      } },
    { id: "trend", kind: "panel", title: "Benchmark runs over time",
      improvements: [{ id: "chart", title: "Chart each mode per run as text bars scaled to the largest value shown" },
        { id: "measure", title: "Switch the run chart between wall time, input tokens and cost" },
        { id: "model", title: "Limit the run chart to one model" }],
      render: (h, ctx, api) => {
        const all = runs(ctx);
        if (!all.length) return h("p", { class: "faint" }, "No benchmark run yet in this page load.");
        const models = [...new Set(all.map((run) => modelName(run.model)))];
        const model = models.includes(api.state.model) ? api.state.model : "all";
        const [key, , show] = MEASURES.find(([id]) => id === api.state.measure) || MEASURES[0];
        const list = model === "all" ? all : all.filter((run) => modelName(run.model) === model);
        const values = list.flatMap((run) => MODES.map(([mode]) => field(run, mode, key))).filter((value) => value !== null);
        const top = values.length ? Math.max(...values) : 0;
        const bar = (value) => (value === null ? "" : "█".repeat(top > 0 ? Math.round((value / top) * BAR) : 0));
        return h("div", {}, h("div", {},
          h("select", { "data-measure": "", value: key, onchange: (event) => { api.state.measure = event.target.value; api.redraw(); } }, MEASURES.map(([id, title]) => h("option", { value: id, selected: id === key }, title))),
          h("select", { "data-model": "", value: model, onchange: (event) => { api.state.model = event.target.value; api.redraw(); } },
            [h("option", { value: "all", selected: model === "all" }, "All models"), ...models.map((name) => h("option", { value: name, selected: name === model }, name))])),
          h("table", { class: "table lab-table" }, h("tbody", {}, list.flatMap((run) => MODES.map(([mode, label]) => {
            const value = field(run, mode, key);
            return h("tr", { "data-run": String(run.run), "data-mode": mode }, h("td", {}, `Run ${run.run} · ${modelName(run.model)}`), h("td", {}, label),
              h("td", { "data-bar": "", style: { fontFamily: "monospace" } }, bar(value)), h("td", { class: "num" }, value === null ? "—" : show(value)));
          })))),
          h("p", { class: "faint" }, "Measured by your own runs in this page load; latency varies from run to run."));
      } },
  ],
});
