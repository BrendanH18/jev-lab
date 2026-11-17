// Configuration checks, totals, configuration exports and navigation for the saved checks in the Datasets panel
// ("workbench.checks.list"; contract in static/js/lab/surfaces/workbench-checks.js). The checks read saved
// configuration and catalog counts: slice targets that cannot do their job, shortlists cut too loose or too tight,
// missing or out-of-range targets, a gate naming more questions than the dataset saves, thin labels or a thin test
// split, and a check that asks another version than it was tuned on. Exports hold configuration only (never measured
// results, row inputs, labels or answers). Commands scroll to a check, open its Review queue or show its gate as code;
// none runs, saves, moves or upgrades a check, and none calls the model.
import { csvText, definePack, formatValue } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const VERSIONED = /^jev-\d+\.\d+(\.\d+)?$/;
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const pct = (value) => formatValue(finite(value), "percent");
const fixed2 = (value) => (finite(value) === null ? "?" : value.toFixed(2));
const slices = (item) => list(item?.slice_targets).filter(isObject);
const shortlists = (item) => Object.entries(isObject(item?.answer_sets) ? item.answer_sets : {});
const sliceName = (slice) => `${slice.field} = ${slice.value}`;
const isAlias = (item) => typeof item?.model === "string" && item.model !== "" && !VERSIONED.test(item.model);
const shellWord = (text) =>
  /^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(text) ? text : `'${String(text).replace(/'/g, "'\\''")}'`;
const shownOf = (ctx) => list(ctx.shown());
const sumOf = (items, key) => items.reduce((sum, item) => sum + (Number.isInteger(item[key]) ? item[key] : 0), 0);
// A total over the shown checks, unavailable when none is shown.
const shownTotal = (ctx, measure, detail) => {
  const shown = shownOf(ctx);
  return shown.length
    ? { value: measure(shown), detail: detail ? detail(shown) : plural(shown.length, "shown check") }
    : null;
};
const goTo = (ctx, match, none) => {
  const item = shownOf(ctx).find(match);
  if (!item) throw new Error(none);
  return ctx.actions.goTo(item.id);
};
const loadedShown = (ctx) => shownOf(ctx).find((item) => item.loaded) || null;
const configOf = (item) => ({
  dataset: item.id,
  name: item.name,
  model: item.model,
  tuned_on: item.tuned_on,
  signal: item.signal,
  accuracy_basis: item.bound,
  gates: item.gates,
  min_accuracy: item.min_accuracy,
  min_automation: item.min_coverage,
  rules: item.rules,
  slice_targets: slices(item).map((slice) => ({
    field: slice.field,
    value: slice.value,
    min_accuracy: slice.min_accuracy,
    min_automation: slice.min_coverage,
  })),
  shortlists: isObject(item.answer_sets) ? item.answer_sets : {},
});

export default definePack({
  id: "checks-list-config-checks",
  surface: "workbench.checks.list",
  title: "Saved check configuration checks",
  about:
    "Advisory checks on saved check configuration (slice targets, shortlist coverage, missing or out-of-range targets and thresholds, no gates or signal, few labels, a small test split, more gates than questions, another version than tuned on, shared names, mixed models, checks the catalog hides), totals over the shown checks, configuration-only exports (JSON, gates, slices, Markdown, drift commands, ids) and navigation. Never results, inputs, labels or answers.",
  features: [
    {
      id: "slice_no_automation",
      kind: "diagnostic",
      severity: "advice",
      label: "Required slice with a 0% automation target",
      check: (item) =>
        slices(item)
          .filter((slice) => finite(slice.min_coverage) === 0)
          .map(
            (slice) =>
              `${sliceName(slice)} has an automation target of 0%, so it adds no automation minimum for that slice; its accuracy target still needs automated rows there, so a slice the gate automates nothing in still fails.`,
          ),
    },
    {
      id: "slice_perfect_accuracy",
      kind: "diagnostic",
      severity: "advice",
      label: "Required slice with a 100% accuracy target",
      check: (item) =>
        slices(item)
          .filter((slice) => finite(slice.min_accuracy) !== null && slice.min_accuracy >= 1)
          .map(
            (slice) =>
              `${sliceName(slice)} asks 100% accuracy, so one automated mistake in that slice fails the check.`,
          ),
    },
    {
      id: "perfect_accuracy_estimate",
      kind: "diagnostic",
      severity: "advice",
      label: "100% accuracy target on the estimate",
      check: (item) =>
        item?.bound === "estimate" && finite(item.min_accuracy) !== null && item.min_accuracy >= 1
          ? "The accuracy target is 100% on the estimate, so one automated mistake fails a run."
          : null,
    },
    {
      id: "slice_looser_than_overall",
      kind: "diagnostic",
      severity: "info",
      label: "Required slice asks less accuracy than the check",
      check: (item) =>
        slices(item)
          .filter(
            (slice) =>
              finite(slice.min_accuracy) !== null &&
              finite(item.min_accuracy) !== null &&
              slice.min_accuracy < item.min_accuracy,
          )
          .map(
            (slice) =>
              `${sliceName(slice)} asks ${pct(slice.min_accuracy)} accuracy, below the check's ${pct(item.min_accuracy)}; the check's own target still applies to the whole run.`,
          ),
    },
    {
      id: "duplicate_slices",
      kind: "diagnostic",
      severity: "problem",
      label: "Same required slice twice",
      check: (item) => {
        const seen = new Map();
        for (const slice of slices(item)) seen.set(sliceName(slice), (seen.get(sliceName(slice)) || 0) + 1);
        return [...seen]
          .filter(([, count]) => count > 1)
          .map(([name, count]) => `${name} is required ${count} times; keep one target for it.`);
      },
    },
    {
      id: "blank_slice",
      kind: "diagnostic",
      severity: "problem",
      label: "Required slice without a field or value",
      check: (item) =>
        slices(item).some((slice) => !String(slice.field ?? "").trim() || !String(slice.value ?? "").trim())
          ? "A required slice has a blank field or value, so it matches no row and can never pass."
          : null,
    },
    {
      id: "shortlist_low_coverage",
      kind: "diagnostic",
      severity: "advice",
      label: "Shortlist cut below 80% coverage",
      check: (item) =>
        shortlists(item)
          .filter(([, coverage]) => finite(coverage) !== null && coverage < 0.8)
          .map(
            ([qid, coverage]) =>
              `${qid}'s shortlist is cut to hold the right answer for ${pct(coverage)} of rows, so review will often need an option outside it.`,
          ),
    },
    {
      id: "shortlist_full_coverage",
      kind: "diagnostic",
      severity: "advice",
      label: "Shortlist cut for 100% coverage",
      check: (item) =>
        shortlists(item)
          .filter(([, coverage]) => finite(coverage) !== null && coverage >= 1)
          .map(
            ([qid]) => `${qid}'s shortlist is cut for 100% coverage, so it may list every option and narrow nothing.`,
          ),
    },
    {
      id: "missing_targets",
      kind: "diagnostic",
      severity: "problem",
      label: "Missing target",
      check: (item) => {
        const missing = [
          finite(item?.min_accuracy) === null && "accuracy",
          finite(item?.min_coverage) === null && "automation",
        ].filter(Boolean);
        return item && missing.length
          ? `No ${missing.join(" or ")} target is saved; save the check again from Policy.`
          : null;
      },
    },
    {
      id: "out_of_range",
      kind: "diagnostic",
      severity: "problem",
      label: "Target or threshold outside 0 to 1",
      check: (item) => {
        const bad = [
          ...Object.entries(isObject(item?.gates) ? item.gates : {}).map(([qid, value]) => [`${qid} threshold`, value]),
          ["accuracy target", item?.min_accuracy],
          ["automation target", item?.min_coverage],
          ...slices(item).flatMap((slice) => [
            [`${sliceName(slice)} accuracy target`, slice.min_accuracy],
            [`${sliceName(slice)} automation target`, slice.min_coverage],
          ]),
        ].filter(
          ([, value]) => value !== null && value !== undefined && !(finite(value) !== null && value >= 0 && value <= 1),
        );
        const blank = Object.entries(isObject(item?.gates) ? item.gates : {})
          .filter(([, value]) => finite(value) === null)
          .map(([qid]) => `${qid} threshold`);
        const names = [...new Set([...bad.map(([name]) => name), ...blank])];
        return names.length
          ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} not a number from 0 to 1.`
          : null;
      },
    },
    {
      id: "no_gates",
      kind: "diagnostic",
      severity: "problem",
      label: "No gated question",
      check: (item) =>
        Array.isArray(item?.gated) && item.gated.length === 0
          ? "No question is gated, so this check automates nothing and cannot meet an automation target."
          : null,
    },
    {
      id: "no_signal",
      kind: "diagnostic",
      severity: "advice",
      label: "No gate signal saved",
      check: (item) =>
        item && item.signal === ""
          ? "The check saves no gate signal (confidence or probability); save it again from Policy."
          : null,
    },
    {
      id: "few_labeled",
      kind: "diagnostic",
      severity: "advice",
      label: "Fewer than 30 labeled rows",
      check: (item) =>
        Number.isInteger(item?.labeled) && item.labeled > 0 && item.labeled < 30
          ? `Only ${plural(item.labeled, "row")} ${item.labeled === 1 ? "carries" : "carry"} a label, so a run's accuracy interval will be wide. Label more rows.`
          : null,
    },
    {
      id: "small_held_out",
      kind: "diagnostic",
      severity: "advice",
      label: "Fewer than 10 held-out rows",
      check: (item) =>
        Number.isInteger(item?.held_out_rows) && item.held_out_rows > 0 && item.held_out_rows < 10
          ? `Only ${plural(item.held_out_rows, "row")} ${item.held_out_rows === 1 ? "is" : "are"} held out, so a test look says little. A larger split gives a firmer test.`
          : null,
    },
    {
      id: "gates_exceed_questions",
      kind: "diagnostic",
      severity: "problem",
      label: "More gates than saved questions",
      check: (item) =>
        Array.isArray(item?.gated) &&
        Number.isInteger(item.question_count) &&
        item.question_count > 0 &&
        item.gated.length > item.question_count
          ? `The gate names ${plural(item.gated.length, "question")} but the dataset saves ${item.question_count}; a gated question may have been removed. Retune in Policy and save the check again.`
          : null,
    },
    {
      id: "tuned_on_other_version",
      kind: "diagnostic",
      severity: "advice",
      label: "Asks another version than it was tuned on",
      check: (item) =>
        item?.tuned_on && VERSIONED.test(item.model || "") && item.model !== item.tuned_on
          ? `The check asks ${item.model}, but its thresholds were tuned on ${item.tuned_on}. Try a new version to retune them for ${item.model}.`
          : null,
    },

    {
      id: "same_name",
      kind: "diagnostic",
      scope: "list",
      severity: "advice",
      label: "Checks with the same name",
      check: (items) => {
        const byName = new Map();
        for (const item of items) {
          const key = String(item.name || item.id)
            .trim()
            .toLowerCase();
          byName.set(key, [...(byName.get(key) || []), item.id]);
        }
        return [...byName.values()]
          .filter((ids) => ids.length > 1)
          .map((ids) => `${ids.join(", ")} share a name; rename one so runs and exports are easy to tell apart.`);
      },
    },
    {
      id: "mixed_models",
      kind: "diagnostic",
      scope: "list",
      severity: "info",
      label: "Shown checks ask different models",
      check: (items) => {
        const models = [...new Set(items.map((item) => item.model).filter(Boolean))];
        return models.length > 1
          ? `The shown checks ask ${models.length} models (${models.join(", ")}); their results are not comparable one to one.`
          : null;
      },
    },
    {
      id: "hidden_by_catalog",
      kind: "diagnostic",
      scope: "list",
      severity: "info",
      label: "Checks the catalog hides",
      check: (items, ctx) => {
        const hidden = ctx?.data?.hidden_by_catalog;
        return Number.isInteger(hidden) && hidden > 0
          ? `${plural(hidden, "check")} ${hidden === 1 ? "is" : "are"} hidden by the Datasets catalog's filters; Lab sees only the checks the catalog shows.`
          : null;
      },
    },

    {
      id: "checks_shown",
      kind: "metric",
      format: "integer",
      label: "Checks shown",
      compute: (ctx) => {
        const all = list(ctx.items());
        return all.length ? { value: shownOf(ctx).length, detail: `of ${plural(all.length, "saved check")}` } : null;
      },
    },
    {
      id: "not_run",
      kind: "metric",
      format: "integer",
      label: "Shown checks not run this session",
      compute: (ctx) => shownTotal(ctx, (shown) => shown.filter((item) => !item.report).length),
    },
    {
      id: "alias_checks",
      kind: "metric",
      format: "integer",
      label: "Shown checks asking an alias model",
      help: "A name such as jev-latest moves when a new version ships.",
      compute: (ctx) => shownTotal(ctx, (shown) => shown.filter(isAlias).length),
    },
    {
      id: "mean_accuracy_target",
      kind: "metric",
      format: "percent",
      label: "Mean accuracy target of the shown checks",
      compute: (ctx) => {
        const targets = shownOf(ctx)
          .map((item) => finite(item.min_accuracy))
          .filter((value) => value !== null);
        return targets.length
          ? {
              value: targets.reduce((sum, value) => sum + value, 0) / targets.length,
              detail: plural(targets.length, "check"),
            }
          : null;
      },
    },
    {
      id: "total_tuning_rows",
      kind: "metric",
      format: "integer",
      label: "Tuning rows across the shown checks",
      compute: (ctx) => shownTotal(ctx, (shown) => sumOf(shown, "tuning_rows")),
    },
    {
      id: "total_labeled",
      kind: "metric",
      format: "integer",
      label: "Rows with a label across the shown checks",
      help: "Catalog metadata: rows carrying any human label, not label validity.",
      compute: (ctx) => shownTotal(ctx, (shown) => sumOf(shown, "labeled")),
    },
    {
      id: "total_held_out",
      kind: "metric",
      format: "integer",
      label: "Held-out rows across the shown checks",
      compute: (ctx) => shownTotal(ctx, (shown) => sumOf(shown, "held_out_rows")),
    },
    {
      id: "total_rules",
      kind: "metric",
      format: "integer",
      label: "Consistency rules across the shown checks",
      compute: (ctx) => shownTotal(ctx, (shown) => sumOf(shown, "rules")),
    },
    {
      id: "total_slice_targets",
      kind: "metric",
      format: "integer",
      label: "Required slices across the shown checks",
      compute: (ctx) => shownTotal(ctx, (shown) => shown.reduce((sum, item) => sum + slices(item).length, 0)),
    },
    {
      id: "distinct_models",
      kind: "metric",
      format: "integer",
      label: "Different models the shown checks ask",
      compute: (ctx) =>
        shownTotal(
          ctx,
          (shown) => new Set(shown.map((item) => item.model).filter(Boolean)).size,
          (shown) => [...new Set(shown.map((item) => item.model).filter(Boolean))].join(", "),
        ),
    },
    {
      id: "datasets_without_check",
      kind: "metric",
      format: "integer",
      label: "Saved datasets without a check",
      compute: (ctx) => {
        const datasets = ctx.data?.datasets;
        return Number.isInteger(datasets) && datasets > 0
          ? { value: Math.max(0, datasets - list(ctx.items()).length), detail: `of ${plural(datasets, "dataset")}` }
          : null;
      },
    },
    {
      id: "busy_checks",
      kind: "metric",
      format: "integer",
      label: "Checks with an operation running, shown or not",
      compute: (ctx) => {
        const all = list(ctx.items());
        return all.length ? all.filter((item) => item.busy).length : null;
      },
    },

    {
      id: "config_json",
      kind: "exporter",
      label: "Shown checks' configuration as JSON (configuration only: no results, inputs or labels)",
      filename: "jev-check-config.json",
      mime: "application/json",
      help: "Model, tuned-on version, signal, accuracy basis, gates, targets, rule count, required slices and shortlist coverages per check. It cannot be imported: checks are saved only from Policy.",
      build: (ctx) => `${JSON.stringify(shownOf(ctx).map(configOf), null, 2)}\n`,
    },
    {
      id: "gates_csv",
      kind: "exporter",
      label: "Shown checks' gates as CSV, one row per gated question (configuration only)",
      filename: "jev-check-gates.csv",
      mime: "text/csv",
      build: (ctx) =>
        csvText([
          ["dataset", "question", "threshold", "signal", "shortlist_coverage"],
          ...shownOf(ctx).flatMap((item) =>
            Object.entries(item.gates || {}).map(([qid, threshold]) => [
              item.id,
              qid,
              threshold ?? "",
              item.signal,
              isObject(item.answer_sets) && finite(item.answer_sets[qid]) !== null ? item.answer_sets[qid] : "",
            ]),
          ),
        ]),
    },
    {
      id: "slice_targets_csv",
      kind: "exporter",
      label: "Shown checks' required slices as CSV (configuration only, no slice results)",
      filename: "jev-check-slices.csv",
      mime: "text/csv",
      build: (ctx) =>
        csvText([
          ["dataset", "field", "value", "min_accuracy", "min_automation"],
          ...shownOf(ctx).flatMap((item) =>
            slices(item).map((slice) => [
              item.id,
              slice.field,
              slice.value,
              slice.min_accuracy ?? "",
              slice.min_coverage ?? "",
            ]),
          ),
        ]),
    },
    {
      id: "config_markdown",
      kind: "exporter",
      label: "Shown checks' configuration as a Markdown table (no results)",
      filename: "jev-check-config.md",
      mime: "text/markdown",
      build: (ctx) => {
        const shown = shownOf(ctx);
        if (!shown.length) return "No saved check is shown.\n";
        return (
          formatMarkdownTable(
            [
              "Dataset",
              "Model",
              "Tuned on",
              "Gates",
              "Targets (accuracy / automated)",
              "Basis",
              "Rules",
              "Required slices",
              "Shortlists",
            ],
            shown.map((item) => [
              item.id,
              item.model || "—",
              item.tuned_on || "—",
              Object.entries(item.gates || {})
                .map(([qid, threshold]) => `${qid} ≥ ${fixed2(threshold)}`)
                .join(", ") || "—",
              `${pct(item.min_accuracy)} / ${pct(item.min_coverage)}`,
              item.bound === "lower" ? "95% lower bound" : "estimate",
              item.rules,
              slices(item).map(sliceName).join(", ") || "—",
              shortlists(item)
                .map(([qid, coverage]) => `${qid} ${fixed2(coverage)}`)
                .join(", ") || "—",
            ]),
          ) + "\n"
        );
      },
    },
    {
      id: "drift_commands",
      kind: "exporter",
      label: "scripts/check.py --drift commands for the shown checks",
      filename: "jev-check-drift.sh",
      mime: "text/x-shellscript",
      help: "For each shown check: the spend estimate (no model calls) and the live comparison of new-rows.jsonl with its dataset. The live run needs TYPESAFE_API_KEY and spends budget.",
      build: (ctx) => {
        const shown = shownOf(ctx);
        if (!shown.length) return "# No saved check is shown.\n";
        return (
          [
            "# Put the new rows in new-rows.jsonl, one per line as in Bulk. Run from the repository.",
            ...shown.flatMap((item) => [
              `# ${item.id}: upper bound on calls and cost, no model calls`,
              `uv run scripts/check.py ${shellWord(item.id)} --drift new-rows.jsonl --estimate`,
              `# ${item.id}: live comparison (spends budget; exits 1 on a shift)`,
              `uv run scripts/check.py ${shellWord(item.id)} --drift new-rows.jsonl`,
            ]),
          ].join("\n") + "\n"
        );
      },
    },
    {
      id: "dataset_ids",
      kind: "exporter",
      label: "Shown checks' dataset ids, one per line",
      filename: "jev-check-ids.txt",
      build: (ctx) =>
        shownOf(ctx)
          .map((item) => `${item.id}\n`)
          .join(""),
    },

    {
      id: "go_first_not_run",
      kind: "command",
      title: "Go to the first shown check not run this session",
      group: "Saved checks",
      when: (ctx) => shownOf(ctx).some((item) => !item.report),
      run: (ctx) => goTo(ctx, (item) => !item.report, "Every shown check ran this session."),
    },
    {
      id: "go_loaded",
      kind: "command",
      title: "Go to the check of the dataset loaded in Bulk",
      group: "Saved checks",
      when: (ctx) => !!loadedShown(ctx),
      run: (ctx) => goTo(ctx, (item) => item.loaded, "The dataset loaded in Bulk has no shown check."),
    },
    {
      id: "go_first_shifted",
      kind: "command",
      title: "Go to the first shown check whose new traffic shifted",
      group: "Saved checks",
      when: (ctx) => shownOf(ctx).some((item) => item.drift?.status === "shift"),
      run: (ctx) =>
        goTo(ctx, (item) => item.drift?.status === "shift", "No shown check's new traffic shifted this session."),
    },
    {
      id: "go_first_alias",
      kind: "command",
      title: "Go to the first shown check that asks an alias model",
      group: "Saved checks",
      when: (ctx) => shownOf(ctx).some(isAlias),
      run: (ctx) => goTo(ctx, isAlias, "Every shown check asks a pinned version."),
    },
    {
      id: "export_loaded_gate",
      kind: "command",
      title: "Show the gate of the check loaded in Bulk as code",
      group: "Saved checks",
      help: "The check's own Export as code button: Python or JavaScript, no model call.",
      when: (ctx) => !!loadedShown(ctx),
      run: (ctx) => {
        const item = loadedShown(ctx);
        if (!item) throw new Error("The dataset loaded in Bulk has no shown check.");
        return ctx.actions.exportGate(item.id);
      },
    },
    {
      id: "open_review_with_edits",
      kind: "command",
      title: "Open the Review queue of the first shown check with edits not added",
      group: "Saved checks",
      help: "Opens the queue, or scrolls to the check when its queue is open already. Adding stays the queue's own button.",
      when: (ctx) => shownOf(ctx).some((item) => item.queue?.edited_labels > 0),
      run: (ctx) => {
        const item = shownOf(ctx).find((entry) => entry.queue?.edited_labels > 0);
        if (!item) throw new Error("No shown check has Review edits waiting.");
        return item.queue.open ? ctx.actions.goTo(item.id) : ctx.actions.open(item.id, "queue", true);
      },
    },
  ],
});
