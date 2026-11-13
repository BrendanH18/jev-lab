// More for the blind second-labeling sample ("workbench.datasets.agreement"; contract in
// static/js/lab/surfaces/workbench-datasets.js): row facts (row number, input size, question types asked, questions
// still to label and, after your own Compare, the questions that differ and the weakest agreement), checks on the
// sample and the comparison, agreement metrics, progress and settlement exports, and an overview panel. It never
// suggests, fills or reveals a label: facts carry counts, flags and question IDs, never inputs or label values. The one
// export that holds label values exists only after Compare, is named for it and is not an importable format.
import { definePack } from "../../kit.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const asked = (item) => (Array.isArray(item?.questions) ? item.questions.filter((qid) => typeof qid === "string") : []);
const diffsOf = (item) => (Array.isArray(item?.differences) ? item.differences : null);
const typesOf = (ctx) => new Map((ctx?.data?.questions || []).map((q) => [q.id, q.type]));
const asksType = (type) => (item, ctx) => { const types = typesOf(ctx); return asked(item).some((qid) => types.get(qid) === type); };
const missingOf = (item) => asked(item).filter((qid) => item.second?.[qid] === null || item.second?.[qid] === undefined);
const nameOf = (ctx) => ctx.data.dataset_name || ctx.data.dataset_id || "dataset";
// A Markdown table cell: pipes and line breaks would break the table.
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const fileOf = (ctx, suffix) => `${ctx.data.dataset_id || "dataset"}-${suffix}`;

// Characters (code points) in an input's text values; the "_image" picture name is not input text.
function textLength(value, top = true) {
  if (typeof value === "string") return [...value].length;
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + textLength(entry, false), 0);
  if (isObject(value)) return Object.entries(value).reduce((sum, [key, entry]) => sum + (top && key === "_image" ? 0 : textLength(entry, false)), 0);
  return 0;
}

// A label value as the page's selects show it: yes/no, a Score level, a Choice key, or "no label".
const shownLabel = (value) => (value === null || value === undefined ? "no label" : value === true ? "yes" : value === false ? "no" : String(value));

// Landis and Koch's descriptive bands for kappa.
function kappaBand(kappa) {
  if (kappa === null || kappa === undefined) return "not measurable";
  if (kappa < 0) return "poor (below chance)";
  if (kappa <= 0.2) return "slight";
  if (kappa <= 0.4) return "fair";
  if (kappa <= 0.6) return "moderate";
  if (kappa <= 0.8) return "substantial";
  return "almost perfect";
}

function reportOrThrow(ctx) {
  const report = ctx.data.report;
  if (!report) throw new Error("Compare first: this describes the latest comparison.");
  return report;
}

export default definePack({
  id: "datasets-agreement-more",
  surface: "workbench.datasets.agreement",
  title: "Label agreement: more",
  about: "Row facts (row number, input size, question types asked, questions still to label and, after your own Compare, the questions that differ), checks on the sample and the comparison, agreement metrics, progress and settlement exports, and an overview panel. It never suggests or fills a label; only the separately named mix-ups export holds label values, and only after Compare.",
  features: [
    { id: "row_number", kind: "fact", type: "number", label: "dataset row number", unit: "row",
      value: (item) => (Number.isInteger(item?.number) && item.number > 0 ? item.number : null) },
    { id: "input_fields", kind: "fact", type: "number", label: "input fields", unit: "fields",
      help: "Top-level fields of an object input, the picture name not counted; unknown for a plain-text input.",
      value: (item) => (isObject(item?.input) ? Object.keys(item.input).filter((key) => key !== "_image").length : null) },
    { id: "input_chars", kind: "fact", type: "number", label: "input characters", unit: "characters",
      help: "Characters in the input's text values (the picture name not counted). A length only, never the text.",
      value: (item) => (typeof item?.input === "string" || isObject(item?.input) ? textLength(item.input) : null) },
    { id: "agreement_floor", kind: "fact", type: "number", label: "lowest question agreement", unit: "0 to 1",
      help: "The lowest per-question agreement rate, over the questions this row asks, in your latest Compare; unknown before it.",
      value: (item, ctx) => {
        const report = ctx?.data?.report;
        if (!report) return null;
        const rates = asked(item).map((qid) => report.questions.find((q) => q.id === qid)?.agreement).filter((rate) => typeof rate === "number");
        return rates.length ? Math.min(...rates) : null;
      } },
    { id: "string_input", kind: "fact", type: "flag", label: "a plain-text input", value: (item) => typeof item?.input === "string" },
    { id: "asks_choice", kind: "fact", type: "flag", label: "a choice question asked", value: asksType("choice") },
    { id: "asks_noul", kind: "fact", type: "flag", label: "a yes/no question asked", value: asksType("noul") },
    { id: "asks_score", kind: "fact", type: "flag", label: "a score question asked", value: asksType("score") },
    { id: "asks_every", kind: "fact", type: "flag", label: "every sampled question asked",
      value: (item, ctx) => {
        const all = (ctx?.data?.questions || []).map((q) => q.id);
        return all.length > 0 && all.every((qid) => asked(item).includes(qid));
      } },
    { id: "has_second", kind: "fact", type: "flag", label: "a second label given", help: "Rows with one or more second labels are the ones Compare sends.",
      value: (item) => Number.isInteger(item?.given) && item.given > 0 },
    { id: "missing_questions", kind: "fact", type: "text", label: "questions still to label", value: (item) => missingOf(item).join(", ") },
    { id: "differing_questions", kind: "fact", type: "text", label: "questions that differ", help: "Question IDs only, from your latest Compare.",
      value: (item) => (diffsOf(item) || []).map((d) => d.question).join(", ") },

    { id: "rare_question", kind: "diagnostic", severity: "advice", scope: "list", label: "Question asked on few sampled rows",
      check: (items, ctx) => {
        const list = ctx.items();
        return (ctx.data.questions || []).map((q) => [q.id, list.filter((item) => asked(item).includes(q.id)).length]).filter(([, n]) => n < 5)
          .map(([qid, n]) => `${qid}: asked on ${plural(n, "sampled row")}; its agreement rests on very few rows. Draw a larger sample.`);
      } },
    { id: "short_draw", kind: "diagnostic", severity: "info", scope: "list", label: "Fewer rows drawn than requested",
      check: (items, ctx) => {
        const s = ctx.data.sample;
        return s && s.drawn < s.requested ? `Only ${s.drawn} of ${s.requested} requested rows were drawn: the dataset has ${plural(s.eligible, "eligible labeled row")}.` : null;
      } },
    { id: "low_agreement", kind: "diagnostic", severity: "advice", scope: "list", label: "Question agreement below 80%",
      check: (items, ctx) => (ctx.data.report?.questions || []).filter((q) => q.rows > 0 && q.agreement !== null && q.agreement < 0.8)
        .map((q) => `${q.id}: ${pct(q.agreement)} of ${plural(q.rows, "compared row")} agree; settle the differences or sharpen its instructions before tuning to these labels.`) },
    { id: "dominant_mixup", kind: "diagnostic", severity: "advice", scope: "list", label: "One mix-up dominates a question",
      help: "A single pair of labels holds more than half of a question's mixed-up rows (three or more). Names no label values.",
      check: (items, ctx) => (ctx.data.report?.questions || []).flatMap((q) => {
        const total = q.mixups.reduce((sum, m) => sum + m.rows, 0);
        const top = q.mixups.reduce((max, m) => Math.max(max, m.rows), 0);
        return total >= 3 && top * 2 > total ? [`${q.id}: one pair of labels accounts for ${top} of ${total} mixed-up rows; check whether their instructions overlap.`] : [];
      }) },
    { id: "truncated_comparison", kind: "diagnostic", severity: "info", scope: "list", label: "Only part of the differences is shown",
      check: (items, ctx) => {
        const r = ctx.data.report;
        return r?.truncated ? `Showing ${r.disagreements_shown} of ${r.disagreements_total} differences: settle and save these, then Compare again to see the rest.` : null;
      } },
    { id: "skipped_labels", kind: "diagnostic", severity: "advice", scope: "list", label: "Second labels skipped as invalid",
      check: (items, ctx) => {
        const n = ctx.data.report?.problems_total || 0;
        return n > 0 ? `${plural(n, "second label")} ${n === 1 ? "was" : "were"} skipped as not valid answers to ${n === 1 ? "its question" : "their questions"}.` : null;
      } },
    { id: "unsaved_settlements", kind: "diagnostic", severity: "advice", scope: "list", label: "Settled labels not saved yet",
      check: (items, ctx) => {
        const n = ctx.data.settled_rows;
        return n > 0 ? `${plural(n, "settled row")} ${n === 1 ? "is" : "are"} not saved yet: press Save settled labels to write ${n === 1 ? "it" : "them"}.` : null;
      } },
    { id: "pending_settlements", kind: "diagnostic", severity: "info", scope: "list", label: "Restored settlements wait for Compare",
      check: (items, ctx) => {
        const n = ctx.data.pending_settlements;
        return n > 0 ? `${plural(n, "restored settlement choice")} ${n === 1 ? "waits" : "wait"} for the next Compare.` : null;
      } },
    { id: "rows_not_found", kind: "diagnostic", severity: "problem", scope: "list", label: "Compared rows no longer in the dataset",
      check: (items, ctx) => {
        const n = ctx.data.report?.counts.not_found || 0;
        return n > 0 ? `${plural(n, "compared row")} ${n === 1 ? "is" : "are"} no longer in the dataset: it changed since the sample was drawn. Draw a new sample.` : null;
      } },

    { id: "mean_kappa", kind: "metric", format: "number", label: "Mean kappa over compared questions",
      help: "Cohen's kappa averaged over the questions where it can be measured. It describes two people's labels, not the model.",
      compute: (ctx) => {
        const questions = ctx.data.report?.questions || [];
        const kappas = questions.map((q) => q.kappa).filter((k) => typeof k === "number");
        if (!kappas.length) return null;
        return { value: kappas.reduce((sum, k) => sum + k, 0) / kappas.length, detail: `over ${kappas.length} of ${plural(questions.length, "compared question")}` };
      } },
    { id: "rows_done_share", kind: "metric", format: "percent", label: "Sampled rows fully second-labeled",
      compute: (ctx) => {
        const rows = ctx.items().filter((item) => asked(item).length > 0);
        if (!rows.length) return null;
        const done = rows.filter((item) => item.done).length;
        return { value: done / rows.length, detail: `${done} of ${plural(rows.length, "row")}` };
      } },
    { id: "differences_per_row", kind: "metric", format: "number", label: "Differences per compared row",
      compute: (ctx) => {
        const r = ctx.data.report;
        if (!r || !r.counts.compared) return null;
        return { value: r.disagreements_total / r.counts.compared, detail: `${plural(r.disagreements_total, "difference")} over ${plural(r.counts.compared, "compared row")}` };
      } },
    { id: "draw_coverage", kind: "metric", format: "percent", label: "Labeled rows in the sample",
      help: "Rows drawn over the dataset's labeled rows that could be drawn.",
      compute: (ctx) => {
        const s = ctx.data.sample;
        return s && s.eligible > 0 ? { value: s.drawn / s.eligible, detail: `${s.drawn} of ${plural(s.eligible, "labeled row")}` } : null;
      } },
    { id: "min_rows_per_question", kind: "metric", format: "integer", label: "Fewest compared rows for a question",
      help: "Among the questions your latest Compare could compare; a sampled question nobody labeled on both sides is not counted.",
      compute: (ctx) => {
        const questions = ctx.data.report?.questions || [];
        if (!questions.length) return null;
        const low = questions.reduce((min, q) => (q.rows < min.rows ? q : min));
        return { value: low.rows, detail: low.id };
      } },

    { id: "settlement_worksheet", kind: "exporter", label: "Settlement worksheet for shown differences", mime: "text/markdown",
      filename: (ctx) => fileOf(ctx, "settlement-worksheet.md"),
      help: "A checklist of the shown rows' differences from your latest Compare, ticked when settled. Row numbers and question IDs only, no label values.",
      build: (ctx) => {
        reportOrThrow(ctx);
        const lines = ctx.shown().flatMap((item) => (diffsOf(item) || []).map((d) => `- [${d.settle?.set ? "x" : " "}] row ${item.number} · ${d.question}${d.settle?.set ? " (settled)" : ""}`));
        const report = ctx.data.report;
        const rest = report.truncated ? [`${plural(report.disagreements_total - report.disagreements_shown, "more difference")} ${report.disagreements_total - report.disagreements_shown === 1 ? "is" : "are"} not in this comparison: save these settlements, then Compare again.`, ""] : [];
        return [`# Settlement worksheet · ${nameOf(ctx)}`, "", ...(lines.length ? lines : ["No differences on the shown rows."]), "", ...rest,
          "Row numbers and question IDs only: settle each difference in the page's comparison."].join("\n") + "\n";
      } },
    { id: "progress_markdown", kind: "exporter", label: "Second-labeling progress by question (Markdown)", mime: "text/markdown",
      filename: (ctx) => fileOf(ctx, "second-labeling-progress.md"),
      help: "For every sampled question: its type, the rows that ask it, second labels given and still missing, over the whole sample. Counts only.",
      build: (ctx) => {
        if (!ctx.data.sample) throw new Error("Draw a sample first.");
        const items = ctx.items();
        const rows = ctx.data.questions.map((q) => {
          const asking = items.filter((item) => asked(item).includes(q.id));
          const given = asking.filter((item) => item.second?.[q.id] !== null && item.second?.[q.id] !== undefined).length;
          return `| ${q.id} | ${q.type} | ${asking.length} | ${given} | ${asking.length - given} |`;
        });
        const total = items.reduce((sum, item) => sum + asked(item).length, 0), given = items.reduce((sum, item) => sum + (item.given || 0), 0);
        return [`# Second-labeling progress · ${nameOf(ctx)} · ${given} of ${plural(total, "label")} given`, "",
          "| Question | Type | Rows asking | Given | Missing |", "| --- | --- | --- | --- | --- |", ...rows].join("\n") + "\n";
      } },
    { id: "mixups_with_labels", kind: "exporter", label: "Label mix-ups, with label values (Markdown)", mime: "text/markdown",
      filename: (ctx) => fileOf(ctx, "agreement-mixups-with-labels.md"),
      help: "CONTAINS LABEL VALUES: each question's saved-versus-second label pairs from your latest Compare, with row counts. Only after Compare; not a format the page imports.",
      build: (ctx) => {
        const report = reportOrThrow(ctx);
        return [`# Label mix-ups with label values · ${nameOf(ctx)}`, "", "This file contains saved and second label values from your latest Compare.", "",
          "| Question | Saved label | Second label | Rows |", "| --- | --- | --- | --- |",
          ...report.questions.flatMap((q) => q.mixups.map((m) => `| ${cell(q.id)} | ${cell(shownLabel(m.saved))} | ${cell(shownLabel(m.second))} | ${m.rows} |`))].join("\n") + "\n";
      } },
    { id: "agreeing_rows", kind: "exporter", label: "Shown rows that agree on every compared question", mime: "text/plain",
      filename: (ctx) => fileOf(ctx, "agreeing-rows.txt"),
      help: "Row numbers of shown rows with second labels and no difference in your latest Compare. Row numbers only.",
      build: (ctx) => {
        const report = reportOrThrow(ctx);
        if (report.truncated) throw new Error("The comparison shows only part of the differences, so agreeing rows are not known. Settle, save and Compare again.");
        if (report.counts.not_found || report.counts.unlabeled) {
          throw new Error("Some labeled rows were not compared (no longer in the dataset, or nothing to compare), so agreeing rows are not known. Draw a new sample.");
        }
        const rows = ctx.shown().filter((item) => item.given > 0 && (diffsOf(item) || []).length === 0).map((item) => `row ${item.number}`);
        return (rows.length ? rows.join("\n") : "No shown row agrees on every compared question.") + "\n";
      } },
    { id: "option_inventory", kind: "exporter", label: "Sampled questions and their label options (Markdown)", mime: "text/markdown",
      filename: (ctx) => fileOf(ctx, "agreement-label-options.md"),
      help: "Each sampled question's ID, type and the label options the page offers (yes/no, Score levels, Choice keys). The options of the schema, never a row's label.",
      build: (ctx) => {
        if (!ctx.data.questions.length) throw new Error("Draw a sample first.");
        return ["| Question | Type | Options |", "| --- | --- | --- |",
          ...ctx.data.questions.map((q) => `| ${q.id} | ${q.type} | ${q.options.length ? q.options.join(", ") : "—"} |`)].join("\n") + "\n";
      } },

    { id: "agreement_overview", kind: "panel", title: "Agreement overview",
      improvements: [
        { id: "draw_summary", title: "The sample's requested, drawn and eligible rows, seed and whether the session can be downloaded" },
        { id: "completion_grid", title: "A grid of every sampled row with its second labels given out of asked" },
        { id: "kappa_bands", title: "Each compared question's kappa with its Landis–Koch band" },
        { id: "settlement_by_question", title: "Shown differences, settled and unsettled, per question" },
      ],
      render: (h, ctx) => {
        const s = ctx.data.sample;
        if (!s) return h("p", { class: "faint" }, "Draw a sample to see its overview.");
        const report = ctx.data.report;
        const items = ctx.items();
        const pairRow = (label, value) => h("tr", { "data-field": label }, h("th", {}, label), h("td", {}, String(value)));
        const settle = new Map();
        for (const item of items) {
          for (const d of diffsOf(item) || []) {
            const entry = settle.get(d.question) || { shown: 0, settled: 0 };
            entry.shown++;
            if (d.settle?.set) entry.settled++;
            settle.set(d.question, entry);
          }
        }
        return h("div", {},
          h("table", { class: "table draw" }, h("tbody", {}, pairRow("requested", s.requested), pairRow("drawn", s.drawn), pairRow("eligible", s.eligible),
            pairRow("seed", s.seed ?? "—"), pairRow("session download", s.recoverable ? "available" : "not available"))),
          h("div", { class: "grid" }, items.map((item) => h("span", { class: `cell ${item.done ? "done" : item.given > 0 ? "partial" : "empty"}`, "data-row": String(item.number) },
            `row ${item.number}: ${item.given}/${asked(item).length}`))),
          report
            ? h("table", { class: "table kappa" },
              h("thead", {}, h("tr", {}, ["question", "rows", "kappa", "band"].map((name) => h("th", {}, name)))),
              h("tbody", {}, report.questions.map((q) => h("tr", { "data-question": q.id }, h("td", { class: "mono" }, q.id), h("td", { class: "num" }, String(q.rows)),
                h("td", { class: "num" }, q.kappa === null ? "—" : q.kappa.toFixed(2)), h("td", {}, kappaBand(q.kappa))))))
            : h("p", { class: "faint kappa" }, "Compare to see kappa bands and settlements."),
          report && settle.size
            ? h("table", { class: "table settle" },
              h("thead", {}, h("tr", {}, ["question", "differences", "settled", "unsettled"].map((name) => h("th", {}, name)))),
              h("tbody", {}, [...settle].map(([qid, entry]) => h("tr", { "data-settle": qid }, h("td", { class: "mono" }, qid), h("td", { class: "num" }, String(entry.shown)),
                h("td", { class: "num" }, String(entry.settled)), h("td", { class: "num" }, String(entry.shown - entry.settled))))))
            : null);
      } },
  ],
});
