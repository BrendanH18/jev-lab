// Starter pack for the Workbench dataset catalog ("workbench.datasets.catalog"; contract in
// static/js/lab/surfaces/workbench-datasets.js): per-question label coverage, split age, workflow stage and file flags
// the page's own 60-odd filters do not offer, advisory checks, catalog metrics, a Markdown table and a per-question
// label count CSV, and commands. Everything is summary metadata: counts, ids, names, dates and flags. Nothing here
// returns notes, inputs, label values, answers or check configuration.
import { csvText, definePack } from "../../kit.js";

const DAY_MS = 86400000;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const labelCounts = (item) => (Array.isArray(item?.question_labels) ? item.question_labels.map((entry) => entry?.labeled).filter((n) => Number.isInteger(n) && n > 0) : []);
const savedQuestions = (item) => (Number.isInteger(item?.questions) && item.questions > 0 ? item.questions : 0);
// Labeled rows per question: every question ID with a saved label, plus a 0 for each saved question that no label
// names (when fewer IDs carry labels than the file saves questions, that many saved questions have none). Empty when
// the dataset has neither labels nor saved questions.
const perQuestion = (item) => {
  const counts = labelCounts(item);
  return [...counts, ...Array(Math.max(0, savedQuestions(item) - counts.length)).fill(0)];
};
// The server's file name for a dataset name (jev/workbench.py slugify).
const slugOf = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export default definePack({
  id: "datasets-catalog-essentials",
  surface: "workbench.datasets.catalog",
  title: "Dataset catalog essentials",
  about: "Per-question label coverage, split age, workflow stage and file flags for saved datasets, with advisory checks, catalog metrics, a Markdown table, a per-question label count CSV and load, pin and agreement commands. Summary metadata only: never notes, inputs, label values, answers or check configuration.",
  features: [
    { id: "labeled_questions", kind: "fact", type: "number", label: "questions with saved labels", unit: "questions",
      help: "Question IDs that at least one saved label names; it can exceed the saved questions after a question was removed.",
      value: (item) => labelCounts(item).length },
    { id: "fewest_question_labels", kind: "fact", type: "number", label: "fewest rows labeled for one question", unit: "rows",
      help: "The least-labeled question's labeled rows: 0 when a saved question has no label yet; unknown with neither labels nor questions.",
      value: (item) => (perQuestion(item).length ? Math.min(...perQuestion(item)) : null) },
    { id: "question_label_spread", kind: "fact", type: "number", label: "label count spread across questions", unit: "rows",
      help: "Most minus fewest labeled rows per question (a saved question without labels counts 0): 0 means every question is labeled equally often.",
      value: (item) => (perQuestion(item).length ? Math.max(...perQuestion(item)) - Math.min(...perQuestion(item)) : null) },
    { id: "split_age_days", kind: "fact", type: "number", label: "days since the test split was drawn", unit: "days",
      help: "Whole days since the held-out split was locked; unknown without a split, a readable date, or for a date after this computer's clock.",
      value: (item, ctx) => {
        const locked = Date.parse(typeof item?.test?.locked_at === "string" ? item.test.locked_at : ""), now = finite(ctx?.data?.now);
        return Number.isFinite(locked) && now !== null && locked <= now ? Math.floor((now - locked) / DAY_MS) : null;
      } },
    { id: "held_out_labeled_share", kind: "fact", type: "number", label: "share of labeled rows held out", unit: "0 to 1",
      help: "Held-out labeled rows over all labeled rows; unknown without a split or labels.",
      value: (item) => {
        const labeled = finite(item?.labeled), held = finite(item?.held_out_labeled);
        return item?.test && labeled !== null && labeled > 0 && held !== null && held >= 0 && held <= labeled ? held / labeled : null;
      } },
    { id: "stage", kind: "fact", type: "category", label: "workflow stage",
      help: "empty, unlabeled, labeling, labeled, split (held-out rows, no check) or checked (a saved check).",
      value: (item) => {
        if (!item || !(item.rows > 0)) return "empty";
        if (item.has_check) return "checked";
        if (item.test) return "split";
        if (!(item.labeled > 0)) return "unlabeled";
        return item.labeled < item.rows ? "labeling" : "labeled";
      } },
    { id: "loaded", kind: "fact", type: "flag", label: "loaded in the rows box", value: (item) => item?.loaded === true },
    { id: "can_copy", kind: "fact", type: "flag", label: "copyable without a bundle", help: "Load as copy is offered: no held-out rows or test history.",
      value: (item) => item?.can_copy === true },
    { id: "split_ready", kind: "fact", type: "flag", label: "ready to hold out test rows", help: "No split yet and at least 4 labeled rows.",
      value: (item) => item?.split_ready === true },
    { id: "name_id_mismatch", kind: "fact", type: "flag", label: "a name that would save to another file",
      help: "Saving under this name would write a different file than this ID, for example after a hand rename.",
      value: (item) => typeof item?.name === "string" && item.name !== item.id && slugOf(item.name) !== item.id },
    { id: "stale_label_questions", kind: "fact", type: "flag", label: "labels for more questions than saved",
      help: "Saved labels name more question IDs than the dataset saves questions.",
      value: (item) => labelCounts(item).length > savedQuestions(item) },

    { id: "few_held_out", kind: "diagnostic", severity: "advice", label: "Few labeled held-out rows",
      check: (item) => {
        const labeled = item?.test ? finite(item.test.labeled) : null;
        if (labeled === null || labeled >= 10) return null;
        return labeled === 0 ? "No held-out row has a label yet, so the test rows cannot be scored."
          : `Only ${plural(labeled, "held-out row")} ${labeled === 1 ? "has" : "have"} a label, so a test score has a wide interval.`;
      } },
    { id: "many_looks", kind: "diagnostic", severity: "advice", label: "Test rows scored many times",
      check: (item) => (item?.test && finite(item.test.looks) !== null && item.test.looks >= 3
        ? `The test rows were scored ${item.test.looks} times; a gate chosen after earlier looks makes the next score optimistic.` : null) },
    { id: "check_without_split", kind: "diagnostic", severity: "info", label: "Saved check without held-out rows",
      check: (item) => (item?.has_check && !item.test ? "The check reruns rows that tuning also read; hold out test rows for an unbiased number." : null) },
    { id: "duplicate_names", kind: "diagnostic", severity: "advice", scope: "list", label: "Datasets that share a name",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          const key = String(item?.name || "").trim().replace(/\s+/g, " ").toLowerCase();
          if (key) groups.set(key, [...(groups.get(key) || []), item.id]);
        }
        return [...groups.values()].filter((ids) => ids.length > 1).map((ids) => `${ids.join(", ")} share a name.`);
      } },

    { id: "labeled_share", kind: "metric", format: "percent", label: "Rows with a label, shown datasets",
      help: "Any saved label counts; not label validity.",
      compute: (ctx) => {
        const shown = ctx.shown();
        const rows = shown.reduce((sum, item) => sum + (item.rows || 0), 0), labeled = shown.reduce((sum, item) => sum + (item.labeled || 0), 0);
        return rows ? { value: labeled / rows, detail: `${labeled} of ${plural(rows, "row")}` } : null;
      } },
    { id: "split_datasets", kind: "metric", format: "integer", label: "Shown datasets with a held-out split",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? { value: shown.filter((item) => item.test).length, detail: `of ${plural(shown.length, "dataset")}` } : null;
      } },
    { id: "median_rows", kind: "metric", format: "number", label: "Median rows per shown dataset",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? { value: median(shown.map((item) => item.rows || 0)), detail: plural(shown.length, "dataset") } : null;
      } },

    { id: "catalog_markdown", kind: "exporter", label: "Shown datasets as a Markdown table", filename: "jev-datasets-overview.md", mime: "text/markdown",
      help: "IDs, names, row, label, held-out and question counts, saved check yes/no and save date. No notes, inputs, label values or check configuration.",
      build: (ctx) => ["| Dataset | Name | Rows | Labeled | Held out | Questions | Saved check | Saved |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...ctx.shown().map((item) => `| ${cell(item.id)} | ${cell(item.name)} | ${item.rows} | ${item.labeled} | ${item.held_out} | ${item.questions} | ${item.has_check ? "yes" : "no"} | ${item.saved_at ? item.saved_at.slice(0, 10) : "—"} |`)]
        .join("\n") + "\n" },
    { id: "question_label_csv", kind: "exporter", label: "Labeled rows per question, shown datasets (CSV)", filename: "jev-dataset-question-labels.csv", mime: "text/csv",
      help: "One line per dataset and question ID with the number of rows labeled for it. Counts only, no label values.",
      build: (ctx) => csvText([["dataset", "question", "labeled_rows"],
        ...ctx.shown().flatMap((item) => (item.question_labels || []).map((entry) => [item.id, entry.id, entry.labeled]))]) },

    { id: "load_newest", kind: "command", title: "Load the most recently saved shown dataset", group: "Datasets",
      when: (ctx) => ctx.shown().some((item) => finite(item.saved_ms) !== null),
      run: (ctx) => {
        const newest = ctx.shown().filter((item) => finite(item.saved_ms) !== null).reduce((best, item) => (item.saved_ms > best.saved_ms ? item : best));
        return ctx.actions.load(newest.id);
      } },
    { id: "pin_with_split", kind: "command", title: "Pin the shown datasets that have held-out rows", group: "Datasets",
      when: (ctx) => ctx.shown().some((item) => item.test && !item.pinned),
      run: (ctx) => {
        const ids = ctx.shown().filter((item) => item.test).map((item) => item.id);
        ctx.actions.pin(ids, true);
        ctx.env?.toast?.(`Pinned ${plural(ids.length, "dataset")} with held-out rows for this page session.`);
      } },
    { id: "copy_loaded_id", kind: "command", title: "Copy the loaded dataset's ID", group: "Datasets",
      when: (ctx) => !!ctx.data.loaded_id,
      run: (ctx) => ctx.env.copy(ctx.data.loaded_id) },
    { id: "open_loaded_agreement", kind: "command", title: "Open Label agreement for the loaded dataset", group: "Datasets",
      when: (ctx) => ctx.items().some((item) => item.loaded && item.agreement_ready && !item.agreement_open),
      run: (ctx) => ctx.actions.openAgreement(ctx.data.loaded_id) },

    { id: "labels_to_target", kind: "tool", title: "Rows to label for a target share", group: "Datasets",
      help: "How many more rows need a label to reach a share of labeled rows. Plain arithmetic; any label counts.",
      inputs: [
        { name: "rows", label: "Rows in the dataset", type: "integer", min: 1, default: 40 },
        { name: "labeled", label: "Rows with a label now", type: "integer", min: 0, default: 30 },
        { name: "target", label: "Target labeled share (%)", type: "number", min: 0, max: 100, default: 90 },
      ],
      compute: ({ rows, labeled, target }) => {
        if (labeled > rows) throw new Error("Rows with a label cannot exceed the rows in the dataset.");
        const needed = Math.ceil(Math.round(target * rows * 1e6) / 1e8);
        return [["Rows to label", Math.max(0, needed - labeled)], ["Labeled share now (%)", Math.round(1000 * labeled / rows) / 10],
          ["Labeled rows at the target", needed]];
      } },
  ],
});
