// Starter pack for the blind second-labeling sample ("workbench.datasets.agreement"; contract in
// static/js/lab/surfaces/workbench-datasets.js): per-row progress and, after the user's own Compare, difference and
// settlement counts, advisory checks on kappa and sample size, progress metrics, a per-question agreement summary, a
// list of rows still missing labels, a Compare command and two agreement calculators. It never suggests or fills a
// label: facts and exports carry counts, row numbers and question IDs only, never inputs or label values.
import { definePack } from "../../kit.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const diffsOf = (item) => (Array.isArray(item?.differences) ? item.differences : null);
const askedKappas = (item, ctx) => (ctx?.data?.report ? (item?.questions || []).map((qid) => [qid, ctx.data.report.questions.find((q) => q.id === qid)]).filter(([, q]) => q) : []);
const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
const missingOf = (item) => (item?.questions || []).filter((qid) => item.second?.[qid] === null || item.second?.[qid] === undefined);

export default definePack({
  id: "datasets-agreement-essentials",
  surface: "workbench.datasets.agreement",
  title: "Label agreement essentials",
  about: "Per-row second-labeling progress and, after your own Compare, difference and settlement counts, checks on kappa and sample size, progress metrics, a per-question agreement summary, the rows still missing labels, a Compare command and agreement calculators. Counts, row numbers and question IDs only: it never shows inputs or label values and never suggests a label.",
  features: [
    { id: "asked", kind: "fact", type: "number", label: "questions asked", unit: "questions", value: (item) => (item?.questions || []).length },
    { id: "missing", kind: "fact", type: "number", label: "second labels still missing", unit: "labels", value: (item) => missingOf(item).length },
    { id: "differences", kind: "fact", type: "number", label: "differences from the saved labels", unit: "labels",
      help: "From your latest Compare; unknown before it and after any edit.", value: (item) => (diffsOf(item) ? diffsOf(item).length : null) },
    { id: "unsettled", kind: "fact", type: "number", label: "differences not settled", unit: "labels",
      value: (item) => (diffsOf(item) ? diffsOf(item).filter((d) => !d.settle?.set).length : null) },
    { id: "done", kind: "fact", type: "flag", label: "every asked question labeled", value: (item) => item?.done === true },
    { id: "has_picture", kind: "fact", type: "flag", label: "a picture", value: (item) => typeof item?.picture === "string" && item.picture !== "" },
    { id: "partly_labeled", kind: "fact", type: "flag", label: "a partly labeled row", value: (item) => item?.given > 0 && item?.missing > 0 },
    { id: "disagrees", kind: "fact", type: "flag", label: "a difference from the saved labels", value: (item) => (diffsOf(item) || []).length > 0 },
    { id: "outcome", kind: "fact", type: "category", label: "comparison outcome",
      help: "not labeled, agrees or differs, after your latest Compare; unknown before it (and for agreeing rows when only part of the differences is shown).",
      value: (item, ctx) => {
        const diffs = diffsOf(item);
        if (!diffs) return null;
        if (!(item.given > 0)) return "not labeled";
        if (diffs.length) return "differs";
        return ctx?.data?.report?.truncated ? null : "agrees";
      } },
    { id: "type_mix", kind: "fact", type: "category", label: "asked question types",
      value: (item, ctx) => {
        const types = new Map((ctx?.data?.questions || []).map((q) => [q.id, q.type]));
        const mix = [...new Set((item?.questions || []).map((qid) => types.get(qid) || "unknown"))].sort();
        return mix.length ? mix.join(" + ") : null;
      } },

    { id: "unsettled_difference", kind: "diagnostic", severity: "advice", label: "Difference not settled",
      check: (item) => (diffsOf(item) || []).filter((d) => !d.settle?.set).map((d) => `${d.question}: choose how to settle it; unsettled differences keep the saved label.`) },
    { id: "low_kappa", kind: "diagnostic", severity: "advice", label: "Question with low agreement beyond chance",
      check: (item, ctx) => askedKappas(item, ctx).filter(([, q]) => q.kappa !== null && q.kappa < 0.4)
        .map(([qid, q]) => `${qid}: kappa ${q.kappa.toFixed(2)}; sharpen its instructions or options before tuning to these labels.`) },
    { id: "kappa_unmeasurable", kind: "diagnostic", severity: "info", label: "Kappa cannot be measured",
      check: (item, ctx) => askedKappas(item, ctx).filter(([, q]) => q.kappa === null && q.rows > 0)
        .map(([qid]) => `${qid}: both people used one label throughout, so agreement beyond chance is unknown. Sample more varied rows.`) },
    { id: "small_comparison", kind: "diagnostic", severity: "advice", scope: "list", label: "Few compared rows",
      check: (items, ctx) => {
        const compared = ctx?.data?.report ? items.filter((item) => item.given > 0).length : 0;
        return compared > 0 && compared < 30 ? `${plural(compared, "shown row")} compared: an agreement rate on fewer than 30 rows has a wide interval.` : null;
      } },

    { id: "label_progress", kind: "metric", format: "percent", label: "Second labels given",
      help: "Over every question every sampled row asks, shown or hidden.",
      compute: (ctx) => {
        const items = ctx.items();
        const asked = items.reduce((sum, item) => sum + item.questions.length, 0);
        const given = items.reduce((sum, item) => sum + item.given, 0);
        return asked ? { value: given / asked, detail: `${given} of ${plural(asked, "label")}` } : null;
      } },
    { id: "rows_ready", kind: "metric", format: "integer", label: "Rows Compare would send",
      compute: (ctx) => (ctx.data.sample ? { value: ctx.data.given_rows, detail: `of ${plural(ctx.data.sample.drawn, "sampled row")}` } : null) },
    { id: "lowest_kappa", kind: "metric", format: "number", label: "Lowest kappa in the comparison",
      compute: (ctx) => {
        const values = (ctx.data.report?.questions || []).filter((q) => q.kappa !== null);
        if (!values.length) return null;
        const low = values.reduce((min, q) => (q.kappa < min.kappa ? q : min));
        return { value: low.kappa, detail: low.id };
      } },
    { id: "settled_share", kind: "metric", format: "percent", label: "Shown differences settled",
      compute: (ctx) => {
        const report = ctx.data.report;
        if (!report || !report.disagreements_shown) return null;
        const settled = ctx.items().reduce((sum, item) => sum + (diffsOf(item) || []).filter((d) => d.settle?.set).length, 0);
        return { value: settled / report.disagreements_shown, detail: `${settled} of ${report.disagreements_shown}` };
      } },

    { id: "agreement_summary", kind: "exporter", label: "Per-question agreement (Markdown)", mime: "text/markdown",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-agreement.md`,
      help: "Question IDs, compared rows, agreeing labels, rates with 95% intervals and Cohen's kappa from your latest Compare. No inputs and no label values.",
      build: (ctx) => {
        const report = ctx.data.report;
        if (!report) throw new Error("Compare first: the summary describes the latest comparison.");
        const o = report.overall;
        return [`Label agreement · ${ctx.data.dataset_name} · ${o.agree} of ${plural(o.labels, "label")} agree (${pct(o.agreement)}) · `
          + `${o.rows_agree} of ${plural(o.rows, "row")} agree on every question (${pct(o.rows_agreement)})`, "",
        "| Question | Rows | Agree | Agreement | 95% interval | Kappa |", "| --- | --- | --- | --- | --- | --- |",
        ...report.questions.map((q) => `| ${q.id} | ${q.rows} | ${q.agree} | ${pct(q.agreement)} | ${pct(q.low)}–${pct(q.high)} | ${q.kappa === null ? "—" : q.kappa.toFixed(2)} |`)]
          .join("\n") + "\n";
      } },
    { id: "missing_rows", kind: "exporter", label: "Shown rows still missing second labels", mime: "text/plain",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-missing-second-labels.txt`,
      help: "Row numbers and the question IDs still to label. No inputs and no labels.",
      build: (ctx) => ctx.shown().filter((item) => item.missing > 0).map((item) => `row ${item.number}: ${missingOf(item).join(", ")}`).join("\n") + "\n" },

    { id: "compare", kind: "command", title: "Compare the second labels given so far", group: "Label agreement",
      when: (ctx) => !ctx.data.busy && ctx.data.given_rows > 0,
      run: (ctx) => ctx.actions.compare() },
    { id: "copy_missing_rows", kind: "command", title: "Copy the row numbers still missing second labels", group: "Label agreement",
      when: (ctx) => ctx.shown().some((item) => item.missing > 0),
      run: (ctx) => ctx.env.copy(ctx.shown().filter((item) => item.missing > 0).map((item) => item.number).join(", ")) },

    { id: "kappa_two_by_two", kind: "tool", title: "Cohen's kappa for two labelers, yes/no", group: "Agreement",
      help: "From the four counts of a yes/no question labeled by two people: observed agreement, agreement expected by chance, and kappa.",
      inputs: [
        { name: "yes_yes", label: "Both said yes", type: "integer", min: 0, default: 20 },
        { name: "yes_no", label: "First yes, second no", type: "integer", min: 0, default: 5 },
        { name: "no_yes", label: "First no, second yes", type: "integer", min: 0, default: 10 },
        { name: "no_no", label: "Both said no", type: "integer", min: 0, default: 15 },
      ],
      compute: ({ yes_yes, yes_no, no_yes, no_no }) => {
        const n = yes_yes + yes_no + no_yes + no_no;
        if (!n) throw new Error("Enter at least one labeled row.");
        const observed = (yes_yes + no_no) / n;
        const first = (yes_yes + yes_no) / n, second = (yes_yes + no_yes) / n;
        const expected = first * second + (1 - first) * (1 - second);
        if (expected === 1) throw new Error("Both used a single label throughout, so kappa cannot be measured.");
        return [["Rows", n], ["Observed agreement", observed], ["Expected by chance", expected], ["Kappa", (observed - expected) / (1 - expected)]];
      } },
    { id: "sample_for_interval", kind: "tool", title: "Rows to compare for an agreement interval", group: "Agreement",
      help: "Rows two people should both label so a 95% interval on the agreement rate is about ± the margin (normal approximation). The page samples at most 200 rows at a time.",
      inputs: [
        { name: "agreement", label: "Expected agreement (%)", type: "number", min: 0, max: 100, default: 80 },
        { name: "margin", label: "Margin (± percentage points)", type: "number", min: 0.1, max: 50, default: 5 },
      ],
      compute: ({ agreement, margin }) => {
        const p = agreement / 100, m = margin / 100;
        const rows = Math.max(1, Math.ceil(1.96 * 1.96 * p * (1 - p) / (m * m) - 1e-9));
        return { rows: [["Rows to compare", rows], ["Samples of 200 or fewer", Math.ceil(rows / 200)]] };
      } },
  ],
});
