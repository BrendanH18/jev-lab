// More for the saved checks in the Datasets panel ("workbench.checks.list"; contract in
// static/js/lab/surfaces/workbench-checks.js): gate, split and target facts from each check's configuration, result
// facts from your own latest run in this session, the state of its drift, upgrade and Review queues, configuration
// checks, two portfolio metrics, and exports of the configuration, the session's results and scripts/check.py
// commands. Never row inputs, labels or model answers, and measured values are always marked as this session's.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const thresholds = (item) => Object.values(item?.gates || {}).map(finite).filter((value) => value !== null);
const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const fixed2 = (value) => (finite(value) === null ? "?" : value.toFixed(2));
// A dataset id as one shell word (ids are slugs; anything else is single-quoted).
const shellWord = (text) => (/^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(text) ? text : `'${String(text).replace(/'/g, "'\\''")}'`);
const gateText = (item) => Object.entries(item.gates || {}).map(([qid, threshold]) => `${qid}>=${fixed2(threshold)}`).join(" ");
const accuracyMargin = (item) => (finite(item?.report?.measured) === null || finite(item?.min_accuracy) === null ? null : item.report.measured - item.min_accuracy);
const coverageMargin = (item) => (finite(item?.report?.coverage) === null || finite(item?.min_coverage) === null ? null : item.report.coverage - item.min_coverage);
const UPGRADE_LABELS = { keep: "keep thresholds", retune: "retune", stay: "stay", error: "error" };

export default definePack({
  id: "checks-drift-more",
  surface: "workbench.checks.list",
  title: "Saved check details and drift",
  about: "Gate, split and target facts, your latest session run's results, drift, upgrade and Review state per check, configuration checks, portfolio metrics, and configuration, results and scripts/check.py exports. Never row inputs, labels or model answers; measured values are this session's runs, never saved.",
  features: [
    { id: "highest_threshold", kind: "fact", type: "number", label: "highest gate threshold", unit: "0 to 1",
      value: (item) => { const values = thresholds(item); return values.length ? Math.max(...values) : null; } },
    { id: "held_out_share", kind: "fact", type: "number", label: "held-out share of rows", unit: "0 to 1", help: "Held-out test rows over saved rows; a check run never sends them.",
      value: (item) => (Number.isInteger(item?.rows) && item.rows > 0 && Number.isInteger(item.held_out_rows) ? item.held_out_rows / item.rows : null) },
    { id: "wrong_automated", kind: "fact", type: "number", label: "wrong automated rows, last run", unit: "rows",
      help: "Automated rows minus correct ones in your latest run this session.",
      value: (item) => (item?.report && Number.isInteger(item.report.automated) && Number.isInteger(item.report.correct) ? item.report.automated - item.report.correct : null) },
    { id: "interval_width", kind: "fact", type: "number", label: "accuracy interval width, last run", unit: "0 to 1",
      help: "The 95% interval's upper minus lower bound in your latest run. Narrower needs more automated, labeled rows.",
      value: (item) => (finite(item?.report?.accuracy_high) === null || finite(item?.report?.accuracy_low) === null ? null : item.report.accuracy_high - item.report.accuracy_low) },
    { id: "queued_traffic", kind: "fact", type: "number", label: "new traffic rows to label", unit: "rows",
      help: "Rows waiting in this check's Label new traffic queue.", value: (item) => (Number.isInteger(item?.drift?.queued) ? item.drift.queued : null) },
    { id: "no_tuned_on", kind: "fact", type: "flag", label: "no tuned-on version saved", help: "Checks saved without the versioned id that answered the tuning run.",
      value: (item) => !!item && !item.tuned_on },
    { id: "has_answer_sets", kind: "fact", type: "flag", label: "attached shortlists",
      value: (item) => !!item?.answer_sets && typeof item.answer_sets === "object" && Object.keys(item.answer_sets).length > 0 },
    { id: "slice_failed", kind: "fact", type: "flag", label: "a required slice that failed, last run",
      value: (item) => list(item?.report?.slices).some((slice) => slice?.status === "fail") },
    { id: "run_notes", kind: "fact", type: "flag", label: "notes from the last run", value: (item) => list(item?.report?.notes).length > 0 },
    { id: "missed_target", kind: "fact", type: "category", label: "target missed, last run",
      value: (item) => {
        const report = item?.report;
        if (!report) return null;
        const accuracy = report.accuracy_ok, coverage = report.coverage_ok;
        if (typeof accuracy !== "boolean" || typeof coverage !== "boolean") return "not judged";
        return !accuracy && !coverage ? "both" : !accuracy ? "accuracy" : !coverage ? "automation" : "neither";
      } },
    { id: "drift_verdict", kind: "fact", type: "category", label: "drift verdict",
      value: (item) => {
        const drift = item?.drift;
        if (!drift) return null;
        if (drift.recovered) return "restored draft";
        return { steady: "steady", shift: "shifted", error: "comparison error" }[drift.status] || "not compared";
      } },
    { id: "upgrade_verdict", kind: "fact", type: "category", label: "upgrade verdict",
      value: (item) => (item?.upgrade ? UPGRADE_LABELS[item.upgrade.verdict] || "not tried" : null) },
    { id: "signal", kind: "fact", type: "category", label: "gate signal", value: (item) => (typeof item?.signal === "string" && item.signal ? item.signal : null) },

    { id: "low_threshold", kind: "diagnostic", severity: "info", label: "Gate threshold under 0.5",
      check: (item) => {
        const low = Object.entries(item?.gates || {}).filter(([, threshold]) => finite(threshold) !== null && threshold < 0.5);
        return low.length ? `${low.map(([qid, threshold]) => `${qid} ≥ ${fixed2(threshold)}`).join(", ")} can automate answers given with under even odds; check that this is intended.` : null;
      } },
    { id: "high_threshold", kind: "diagnostic", severity: "advice", label: "Gate threshold at 0.99 or above",
      check: (item) => {
        const high = Object.entries(item?.gates || {}).filter(([, threshold]) => finite(threshold) !== null && threshold >= 0.99);
        return high.length ? `${high.map(([qid, threshold]) => `${qid} ≥ ${fixed2(threshold)}`).join(", ")} sends almost every row to review, so the gate automates little.` : null;
      } },
    { id: "override_differs", kind: "diagnostic", severity: "advice", label: "Next run asks another model",
      check: (item) => (item?.model_override && item.model_override !== item.model
        ? `The model box says ${item.model_override}, so the next run measures that model; the saved check keeps asking ${item.model || "its own model"}${item.tuned_on ? ` and was tuned on ${item.tuned_on}` : ""}.` : null) },
    { id: "several_versions", kind: "diagnostic", severity: "problem", label: "Answered by several versions",
      check: (item) => (list(item?.report?.answered_by).length > 1
        ? `Your latest run was answered by ${item.report.answered_by.join(" and ")}: the alias moved during the run, so its result mixes versions. Run it again, or pin a version.` : null) },
    { id: "narrow_pass", kind: "diagnostic", severity: "advice", label: "Passed by under 1 point",
      check: (item) => {
        if (item?.report?.status !== "pass") return null;
        const near = [["accuracy", accuracyMargin(item)], ["automation", coverageMargin(item)]].filter(([, margin]) => margin !== null && margin < 0.01);
        return near.length ? `The latest run passed within 1 point of its ${near.map(([name]) => name).join(" and ")} target; a rerun could fail.` : null;
      } },
    { id: "no_labeled", kind: "diagnostic", severity: "problem", label: "No labeled rows",
      check: (item) => (item && item.labeled === 0
        ? `No row is labeled, so a run would spend ${plural(item.calls || 0, "call")} and still could not judge accuracy. Label rows first.` : null) },
    { id: "drift_queue_waiting", kind: "diagnostic", severity: "advice", label: "Shifted traffic waiting for labels",
      check: (item) => (item?.drift?.status === "shift" && item.drift.queued > 0
        ? `New traffic shifted and ${plural(item.drift.queued, "row")} wait${item.drift.queued === 1 ? "s" : ""} in Label new traffic; label and add them, then rerun the check.` : null) },
    { id: "unsaved_review_edits", kind: "diagnostic", severity: "advice", label: "Review edits not added",
      check: (item) => (item?.queue?.edited_labels > 0
        ? `${plural(item.queue.edited_labels, "Review label")} you edited in this session ${item.queue.edited_labels === 1 ? "is" : "are"} not in the dataset until Add.` : null) },

    { id: "worst_accuracy_margin", kind: "metric", format: "percent", label: "Worst accuracy margin among shown runs",
      help: "The judged accuracy minus the target, lowest among the shown checks you ran in this session.",
      compute: (ctx) => {
        let worst = null;
        for (const item of ctx.shown()) {
          const margin = accuracyMargin(item);
          if (margin !== null && (worst === null || margin < worst.margin)) worst = { margin, id: item.id };
        }
        return worst ? { value: worst.margin, detail: worst.id } : null;
      } },
    { id: "rows_to_label", kind: "metric", format: "integer", label: "Queued rows waiting for labels",
      help: "New traffic rows plus Review rows not yet ready, across the shown checks.",
      compute: (ctx) => {
        const shown = ctx.shown().filter((item) => item.drift?.queued > 0 || item.queue?.read);
        if (!shown.length) return null;
        const traffic = shown.reduce((sum, item) => sum + (item.drift?.queued || 0), 0);
        const review = shown.reduce((sum, item) => sum + Math.max(0, (item.queue?.rows || 0) - (item.queue?.ready || 0)), 0);
        return { value: traffic + review, detail: `${plural(traffic, "new traffic row")}, ${plural(review, "Review row")} not ready` };
      } },

    { id: "config_csv", kind: "exporter", label: "Shown checks' configuration as CSV (no results, inputs or labels)", filename: "jev-check-config.csv", mime: "text/csv",
      help: "Dataset id and name, model, tuned-on version, signal, accuracy basis, gates, targets, rule and slice-target counts, shortlists, tuning rows and calls per run.",
      build: (ctx) => csvText([["dataset", "name", "model", "tuned_on", "signal", "basis", "gates", "min_accuracy", "min_automation", "rules", "slice_targets", "shortlists", "tuning_rows", "calls"],
        ...ctx.shown().map((item) => [item.id, item.name, item.model, item.tuned_on || "", item.signal, item.bound, gateText(item), item.min_accuracy ?? "", item.min_coverage ?? "",
          item.rules, item.slice_targets.length, Object.entries(item.answer_sets).map(([qid, coverage]) => `${qid}:${coverage}`).join(" "), item.tuning_rows, item.calls])]) },
    { id: "results_csv", kind: "exporter", label: "Shown checks' latest runs this session as CSV (measured now, not saved)", filename: "jev-check-session-runs.csv", mime: "text/csv",
      help: "Status and counts, accuracy with its 95% bounds, the value judged, automation, spend and the answering versions of each shown check's latest run in this page session. Checks save configuration only.",
      build: (ctx) => csvText([["dataset", "status", "rows", "labeled", "automated", "correct", "accuracy", "accuracy_low", "accuracy_high", "judged_accuracy", "automation", "cost_usd", "answered_by"],
        ...ctx.shown().map((item) => {
          const r = item.report;
          if (!r) return [item.id, "not run", "", "", "", "", "", "", "", "", "", "", ""];
          return [item.id, r.status, r.rows, r.labeled, r.automated, r.correct, r.accuracy ?? "", r.accuracy_low ?? "", r.accuracy_high ?? "", r.measured ?? "",
            r.coverage ?? "", r.cost_usd ?? "", r.answered_by.join(" ")];
        })]) },
    { id: "check_commands", kind: "exporter", label: "scripts/check.py commands for the shown checks", filename: "jev-check-commands.sh", mime: "text/x-shellscript",
      help: "A spend estimate (no model calls) and the live run for the shown dataset ids, to run from the repository. The live run needs TYPESAFE_API_KEY and spends budget.",
      build: (ctx) => {
        const ids = ctx.shown().map((item) => shellWord(item.id));
        if (!ids.length) return "# No saved check is shown.\n";
        return ["# Upper bound on calls and cost, no model calls:", `uv run scripts/check.py ${ids.join(" ")} --estimate`,
          "# Live run (spends budget; exits 1 when a check misses its targets):", `uv run scripts/check.py ${ids.join(" ")}`].join("\n") + "\n";
      } },
    { id: "upgrade_commands", kind: "exporter", label: "scripts/check.py --upgrade-to commands for shown upgrade candidates", filename: "jev-check-upgrades.sh", mime: "text/x-shellscript",
      help: "For each shown check whose upgrade this session said keep or retune: the estimate and the comparison of its tuned-on version with that candidate. Moving the check stays in the page.",
      build: (ctx) => {
        const ready = ctx.shown().filter((item) => ["keep", "retune"].includes(item.upgrade?.verdict) && item.upgrade.candidate);
        if (!ready.length) return "# No shown check has a keep or retune upgrade verdict from this session.\n";
        return ready.flatMap((item) => [`# ${item.id}: ${item.upgrade.verdict} on ${item.upgrade.candidate} (this session)`,
          `uv run scripts/check.py ${shellWord(item.id)} --upgrade-to ${shellWord(item.upgrade.candidate)} --estimate`,
          `uv run scripts/check.py ${shellWord(item.id)} --upgrade-to ${shellWord(item.upgrade.candidate)}`]).join("\n") + "\n";
      } },
  ],
});
