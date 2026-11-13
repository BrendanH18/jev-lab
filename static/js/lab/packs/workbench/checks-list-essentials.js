// Starter pack for the saved checks in the Datasets panel ("workbench.checks.list"; contract in
// static/js/lab/surfaces/workbench-checks.js): gate and target facts, margins from the user's own latest run, target
// sanity checks, session metrics, a Markdown summary and a command that finds a failing check. Everything here is check
// configuration or the latest session run's measured values: never row inputs, labels or model answers.
import { definePack } from "../../kit.js";

const VERSIONED = /^jev-\d+\.\d+(\.\d+)?$/;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const thresholds = (item) => Object.values(item?.gates || {}).map(finite).filter((value) => value !== null);
const margin = (measured, target) => (finite(measured) === null || finite(target) === null ? null : measured - target);
const percent = (value) => (finite(value) === null ? "—" : `${(value * 100).toFixed(1)}%`);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
// The server's two-sided 95% normal quantile (jev/calibrate.py Z) and its tolerance for a value equal to its target.
const Z = 1.959964;
const EPS = 1e-9;
// The highest 95% Wilson lower bound n automated rows can reach: every one right gives n / (n + z²).
const bestLowerBound = (n) => n / (n + Z * Z);

export default definePack({
  id: "checks-list-essentials",
  surface: "workbench.checks.list",
  title: "Saved check essentials",
  about: "Gate, target and margin facts for the saved checks, from their configuration and your own latest run in this session, with target sanity checks (including a lower-bound target no run can reach), session metrics, a Markdown summary and a command to find a failing check. Never holds row inputs, labels or model answers, and measured values are this session's runs, never saved.",
  features: [
    { id: "gate_count", kind: "fact", type: "number", label: "gated questions", unit: "questions", value: (item) => (Array.isArray(item?.gated) ? item.gated.length : null) },
    { id: "lowest_threshold", kind: "fact", type: "number", label: "lowest gate threshold", unit: "0 to 1",
      value: (item) => { const values = thresholds(item); return values.length ? Math.min(...values) : null; } },
    { id: "accuracy_target", kind: "fact", type: "number", label: "accuracy target", unit: "0 to 1", value: (item) => finite(item?.min_accuracy) },
    { id: "automation_target", kind: "fact", type: "number", label: "automation target", unit: "0 to 1", value: (item) => finite(item?.min_coverage) },
    { id: "measured_accuracy", kind: "fact", type: "number", label: "accuracy when automated, last run", unit: "0 to 1",
      help: "From your latest run of the check in this session; unknown before a run and when nothing was automated.",
      value: (item) => finite(item?.report?.accuracy) },
    { id: "accuracy_margin", kind: "fact", type: "number", label: "accuracy margin over target", unit: "points of 1",
      help: "The accuracy the target is judged on (the 95% lower bound when the check uses it) minus the target. Negative misses.",
      value: (item) => margin(item?.report?.measured, item?.min_accuracy) },
    { id: "automation_margin", kind: "fact", type: "number", label: "automation margin over target", unit: "points of 1",
      help: "The share automated in your latest run minus the automation target. Negative misses.",
      value: (item) => margin(item?.report?.coverage, item?.min_coverage) },
    { id: "run_cost", kind: "fact", type: "number", label: "last run spend", unit: "USD", value: (item) => finite(item?.report?.cost_usd) },
    { id: "alias_model", kind: "fact", type: "flag", label: "an alias model", help: "The check asks a name such as jev-latest, which moves when a new version ships.",
      value: (item) => typeof item?.model === "string" && item.model !== "" && !VERSIONED.test(item.model) },
    { id: "version_moved", kind: "fact", type: "flag", label: "answers from another version than it was tuned on",
      value: (item) => !!item?.tuned_on && Array.isArray(item?.report?.answered_by) && item.report.answered_by.some((version) => version !== item.tuned_on) },
    { id: "has_rules", kind: "fact", type: "flag", label: "consistency rules", value: (item) => (item?.rules || 0) > 0 },
    { id: "has_slice_targets", kind: "fact", type: "flag", label: "required slices", value: (item) => Array.isArray(item?.slice_targets) && item.slice_targets.length > 0 },
    { id: "last_status", kind: "fact", type: "category", label: "last run status",
      value: (item) => ({ pass: "passed", fail: "failed", error: "not judged" }[item?.report?.status] || "not run") },
    { id: "accuracy_basis", kind: "fact", type: "category", label: "accuracy basis",
      value: (item) => (item?.bound === "lower" ? "95% lower bound" : item?.bound === "estimate" ? "estimate" : null) },

    { id: "unreachable_accuracy", kind: "diagnostic", severity: "problem", label: "Accuracy target it can never meet",
      help: "For checks judged on the 95% lower bound: even if every row a run sends were labeled, automated and right, the Wilson lower bound n / (n + 1.96²) stays below the target.",
      check: (item) => {
        const target = finite(item?.min_accuracy), calls = item?.calls;
        if (item?.bound !== "lower" || target === null || !Number.isInteger(calls) || calls < 0) return null;
        if (calls === 0) return "A run sends no tuning rows, so accuracy cannot be measured and this check can never pass.";
        const best = bestLowerBound(calls);
        if (best + EPS >= target) return null;
        return `Even if all ${plural(calls, "row")} a run sends were labeled, automated and right, the 95% lower bound would be ${percent(best)}, below the ${percent(target)} target, so this check can never pass. Lower the target${calls < 200 ? ", add tuning rows" : ""} or judge the estimate.`;
      } },
    { id: "zero_automation_target", kind: "diagnostic", severity: "advice", label: "No automation target",
      check: (item) => (finite(item?.min_coverage) === 0
        ? "The automation target is 0%, so the check still passes when the gate automates almost nothing." : null) },
    { id: "capped_rows", kind: "diagnostic", severity: "info", label: "More tuning rows than one run sends",
      check: (item) => (Number.isInteger(item?.tuning_rows) && item.tuning_rows > item.calls
        ? `A run sends ${item.calls} of its ${item.tuning_rows} tuning rows.` : null) },

    { id: "passing_share", kind: "metric", format: "percent", label: "Shown checks whose latest run this session passed",
      help: "Among the shown checks you ran in this session; not-judged runs count as not passing.",
      compute: (ctx) => {
        const ran = ctx.shown().filter((item) => item.report);
        if (!ran.length) return null;
        const passed = ran.filter((item) => item.report.status === "pass").length;
        return { value: passed / ran.length, detail: `${passed} of ${plural(ran.length, "run check")}` };
      } },
    { id: "session_spend", kind: "metric", format: "usd", label: "Spend of the shown checks' latest runs this session",
      help: "The latest run of each shown check in this session. Drift comparisons and upgrades are not included.",
      compute: (ctx) => {
        const costs = ctx.shown().map((item) => finite(item.report?.cost_usd)).filter((value) => value !== null);
        return costs.length ? { value: costs.reduce((sum, value) => sum + value, 0), detail: plural(costs.length, "run") } : null;
      } },
    { id: "rerun_calls", kind: "metric", format: "integer", label: "Calls to run every shown check once",
      help: "Each run sends at most 200 tuning rows. Each run shows its own spend preview before it starts.",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? { value: shown.reduce((sum, item) => sum + (item.calls || 0), 0), detail: plural(shown.length, "check") } : null;
      } },

    { id: "summary_markdown", kind: "exporter", label: "Shown checks and this session's runs as a Markdown table", filename: "jev-checks.md", mime: "text/markdown",
      help: "Dataset ids, gates, targets, model and your latest run's status, accuracy and automation. No row inputs, labels or answers.",
      build: (ctx) => {
        const cell = (value) => String(value).replace(/[\\|]/g, "\\$&").replace(/\s+/g, " ").trim();
        const rows = ctx.shown().map((item) => {
          const gates = Object.entries(item.gates || {}).map(([qid, threshold]) => `${qid} ≥ ${finite(threshold) === null ? "?" : threshold.toFixed(2)}`).join(", ");
          const rep = item.report;
          return `| ${cell(item.id)} | ${cell(gates || "—")} | ${percent(item.min_accuracy)} / ${percent(item.min_coverage)} | ${cell(item.model || "—")} | ${rep ? rep.status : "not run"} | ${rep ? percent(rep.accuracy) : "—"} | ${rep ? percent(rep.coverage) : "—"} |`;
        });
        return ["| Dataset | Gates | Targets (accuracy / automated) | Model | Run this session | Accuracy | Automated |",
          "| --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n") + "\n";
      } },

    { id: "go_first_failing", kind: "command", title: "Go to the first shown check whose last run failed", group: "Saved checks",
      when: (ctx) => ctx.shown().some((item) => item.report?.status === "fail"),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => entry.report?.status === "fail");
        if (!item) throw new Error("No shown check failed its last run.");
        return ctx.actions.goTo(item.id);
      } },
  ],
});
