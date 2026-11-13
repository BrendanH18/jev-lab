// Starter pack for the blind second-labeling sample ("workbench.datasets.agreement"; contract in
// static/js/lab/surfaces/workbench-datasets.js): per-row progress and, after the user's own Compare, difference and
// settlement counts, advisory checks on kappa and comparison size, progress metrics, a per-question agreement summary,
// a list of rows still missing labels and a Compare command (no model call). It never suggests or fills a label: facts
// and exports carry counts, row numbers and question IDs only, never inputs or label values.
import { definePack } from "../../kit.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const diffsOf = (item) => (Array.isArray(item?.differences) ? item.differences : null);
const reportQuestions = (ctx) => (Array.isArray(ctx?.data?.report?.questions) ? ctx.data.report.questions.filter((q) => q && typeof q.id === "string") : []);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
const askedOf = (item) => (Array.isArray(item?.questions) ? item.questions : []);
const missingOf = (item) => askedOf(item).filter((qid) => item.second?.[qid] === null || item.second?.[qid] === undefined);

export default definePack({
  id: "datasets-agreement-essentials",
  surface: "workbench.datasets.agreement",
  title: "Label agreement essentials",
  about: "Per-row second-labeling progress and, after your own Compare, difference and settlement counts, checks on kappa and comparison size, progress metrics, a per-question agreement summary, the rows still missing labels and a Compare command. Counts, row numbers and question IDs only: it never shows inputs or label values and never suggests a label.",
  features: [
    { id: "asked", kind: "fact", type: "number", label: "questions asked", unit: "questions", value: (item) => askedOf(item).length },
    { id: "missing", kind: "fact", type: "number", label: "second labels still missing", unit: "labels", value: (item) => missingOf(item).length },
    { id: "differences", kind: "fact", type: "number", label: "differences from the saved labels", unit: "labels",
      help: "From your latest Compare; unknown before it and after any edit.", value: (item) => (diffsOf(item) ? diffsOf(item).length : null) },
    { id: "unsettled", kind: "fact", type: "number", label: "differences not settled", unit: "labels",
      value: (item) => (diffsOf(item) ? diffsOf(item).filter((d) => !d.settle?.set).length : null) },
    { id: "done", kind: "fact", type: "flag", label: "every asked question labeled", value: (item) => item?.done === true },
    { id: "has_picture", kind: "fact", type: "flag", label: "a picture", value: (item) => typeof item?.picture === "string" && item.picture !== "" },
    { id: "partly_labeled", kind: "fact", type: "flag", label: "a partly labeled row", value: (item) => item?.given > 0 && item?.missing > 0 },
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
        const mix = [...new Set(askedOf(item).map((qid) => types.get(qid) || "unknown"))].sort();
        return mix.length ? mix.join(" + ") : null;
      } },

    { id: "unsettled_difference", kind: "diagnostic", severity: "advice", label: "Difference not settled",
      check: (item) => (diffsOf(item) || []).filter((d) => !d.settle?.set).map((d) => `${d.question}: choose how to settle it; unsettled differences keep the saved label.`) },
    { id: "low_kappa", kind: "diagnostic", severity: "advice", scope: "list", label: "Question with kappa below 0.40",
      help: "From your latest Compare: kappa under 0.40 is at most fair agreement beyond chance between the two people (Landis and Koch).",
      check: (items, ctx) => reportQuestions(ctx).filter((q) => finite(q.kappa) !== null && q.kappa < 0.4)
        .map((q) => `${q.id}: kappa ${q.kappa.toFixed(2)} over ${plural(q.rows, "compared row")}; clarify its labeling guidelines before tuning to these labels.`) },
    { id: "kappa_unmeasurable", kind: "diagnostic", severity: "info", scope: "list", label: "Kappa cannot be measured",
      help: "From your latest Compare: kappa is undefined when both people gave every compared row one and the same label.",
      check: (items, ctx) => reportQuestions(ctx).filter((q) => q.kappa === null && q.rows > 0)
        .map((q) => `${q.id}: both people gave all ${plural(q.rows, "compared row")} the same single label, so agreement beyond chance is unknown. Sample more varied rows.`) },
    { id: "small_comparison", kind: "diagnostic", severity: "advice", scope: "list", label: "Few compared rows",
      help: "Counts every row your latest Compare matched, shown or hidden.",
      check: (items, ctx) => {
        const compared = finite(ctx?.data?.report?.counts?.compared);
        return compared !== null && compared > 0 && compared < 30
          ? `${plural(compared, "row")} compared: an agreement rate on fewer than 30 rows has a wide interval.` : null;
      } },

    { id: "label_progress", kind: "metric", format: "percent", label: "Second labels given",
      help: "Over every question every sampled row asks, shown or hidden.",
      compute: (ctx) => {
        const items = ctx.items();
        const asked = items.reduce((sum, item) => sum + askedOf(item).length, 0);
        const given = items.reduce((sum, item) => sum + (finite(item.given) ?? 0), 0);
        return asked ? { value: given / asked, detail: `${given} of ${plural(asked, "label")}` } : null;
      } },
    { id: "lowest_kappa", kind: "metric", format: "number", label: "Lowest kappa in the comparison",
      compute: (ctx) => {
        const values = reportQuestions(ctx).filter((q) => finite(q.kappa) !== null);
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
      help: "The sample's own Compare button: it reveals the saved labels of the compared rows and makes no model call. The page asks first when it would clear settlement choices.",
      when: (ctx) => !ctx.data.busy && ctx.data.given_rows > 0,
      run: (ctx) => ctx.actions.compare() },
  ],
});
