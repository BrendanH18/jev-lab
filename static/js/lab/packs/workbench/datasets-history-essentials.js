// Starter pack for a dataset's revision history ("workbench.datasets.history"; contract in
// static/js/lab/surfaces/workbench-datasets.js): age, row and label changes against the next older revision, split and
// check flags, a change category, advisory checks before a restore, timeline metrics and exports, and commands that open
// the page's own restore preview. Counts, question ids, names and timestamps only, as the listing shows; never rows or
// label values. A restore always goes through the page's preview and confirm.
import { csvText, definePack } from "../../kit.js";

const DAY_MS = 86400000;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listOf = (ctx) => (ctx && typeof ctx.items === "function" ? ctx.items() : []);

// The next older readable revision in the whole list (items are newest first), or null.
function older(item, ctx) {
  const list = listOf(ctx);
  const index = list.findIndex((entry) => entry.revision === item?.revision);
  if (index < 0) return null;
  return list.slice(index + 1).find((entry) => entry.readable) || null;
}

const change = (field) => (item, ctx) => {
  if (!item?.readable) return null;
  const before = older(item, ctx);
  return before ? item[field] - before[field] : null;
};

const kept = (at) => (typeof at === "string" ? `${at.slice(0, 10)} ${at.slice(11, 16)}` : "—");

export default definePack({
  id: "datasets-history-essentials",
  surface: "workbench.datasets.history",
  title: "Revision history essentials",
  about: "Age, row and label changes against the next older revision, split and check flags, a change category, checks before a restore, timeline metrics and exports, and commands that open the page's own restore preview. Counts, question IDs, names and timestamps only: never rows or label values.",
  features: [
    { id: "age_days", kind: "fact", type: "number", label: "days since kept", unit: "days",
      value: (item, ctx) => {
        const at = finite(item?.at_ms), now = finite(ctx?.data?.now);
        return at === null || now === null ? null : Math.max(0, Math.floor((now - at) / DAY_MS));
      } },
    { id: "rows_change", kind: "fact", type: "number", label: "row change from the older revision", unit: "rows",
      help: "Rows minus the next older readable revision's; unknown for the oldest and for unreadable revisions.", value: change("rows") },
    { id: "labeled_change", kind: "fact", type: "number", label: "labeled row change from the older revision", unit: "rows",
      help: "Rows with a label minus the next older readable revision's.", value: change("labeled") },
    { id: "labeled_share", kind: "fact", type: "number", label: "share of rows with a label", unit: "0 to 1",
      value: (item) => (item?.readable && item.rows > 0 ? item.labeled / item.rows : null) },
    { id: "question_count", kind: "fact", type: "number", label: "saved questions", unit: "questions",
      value: (item) => (item?.readable ? item.questions.length : null) },
    { id: "has_check", kind: "fact", type: "flag", label: "a saved check", value: (item) => item?.has_check === true },
    { id: "has_split", kind: "fact", type: "flag", label: "held-out rows", value: (item) => item?.readable === true && item.held_out > 0 },
    { id: "unreadable", kind: "fact", type: "flag", label: "an unreadable file", value: (item) => item?.readable === false },
    { id: "questions_differ", kind: "fact", type: "flag", label: "other questions than the newest revision",
      help: "Its question IDs or their order differ from the newest readable revision's.",
      value: (item, ctx) => {
        const newest = listOf(ctx).find((entry) => entry.readable);
        return !!newest && item?.readable === true && JSON.stringify(item.questions) !== JSON.stringify(newest.questions);
      } },
    { id: "change_kind", kind: "fact", type: "category", label: "change from the older revision",
      help: "rows added, rows removed, labels added, labels removed, no count change, oldest kept or unreadable.",
      value: (item, ctx) => {
        if (!item) return null;
        if (!item.readable) return "unreadable";
        const before = older(item, ctx);
        if (!before) return "oldest kept";
        if (item.rows !== before.rows) return item.rows > before.rows ? "rows added" : "rows removed";
        if (item.labeled !== before.labeled) return item.labeled > before.labeled ? "labels added" : "labels removed";
        return "no count change";
      } },
    { id: "saved_name", kind: "fact", type: "text", label: "saved name", value: (item) => item?.name || "" },

    { id: "label_loss", kind: "diagnostic", severity: "advice", label: "Fewer labeled rows than the revision before",
      check: (item, ctx) => {
        const delta = change("labeled")(item, ctx);
        return delta !== null && delta < 0 ? `${plural(-delta, "labeled row")} fewer than the older revision: check that labels were not lost.` : null;
      } },
    { id: "unreadable_revision", kind: "diagnostic", severity: "info", label: "Unreadable revision",
      check: (item) => (item?.readable === false ? "This kept file is not a readable dataset and cannot be restored." : null) },
    { id: "split_dropped", kind: "diagnostic", severity: "advice", label: "Restoring removes the held-out split",
      check: (item, ctx) => {
        const current = listOf(ctx).find((entry) => entry.current && entry.readable);
        return current && item?.readable && !item.current && current.held_out > 0 && item.held_out === 0
          ? `Restoring it would leave no held-out rows (now ${current.held_out}). Recorded looks are kept.` : null;
      } },
    { id: "history_full", kind: "diagnostic", severity: "advice", scope: "list", label: "History is at its limit",
      check: (items, ctx) => {
        const keep = Number.isInteger(ctx?.data?.keep) ? ctx.data.keep : 20;
        return items.length >= keep ? `${plural(items.length, "revision")} kept, the most this history holds: the next save drops the oldest. Download a bundle to keep it.` : null;
      } },

    { id: "span_days", kind: "metric", format: "number", label: "Days between the oldest and newest kept revision",
      compute: (ctx) => {
        const times = ctx.items().map((item) => finite(item.at_ms)).filter((value) => value !== null);
        return times.length ? { value: (Math.max(...times) - Math.min(...times)) / DAY_MS, detail: plural(times.length, "revision") } : null;
      } },
    { id: "most_labeled", kind: "metric", format: "integer", label: "Most labeled rows in a kept revision",
      compute: (ctx) => {
        const readable = ctx.items().filter((item) => item.readable);
        if (!readable.length) return null;
        const best = readable.reduce((top, item) => (item.labeled > top.labeled ? item : top));
        return { value: best.labeled, detail: `revision #${best.position}${best.current ? " (current)" : ""}` };
      } },

    { id: "timeline_markdown", kind: "exporter", label: "Shown revisions as a Markdown table", mime: "text/markdown",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-revisions.md`,
      help: "Position, time kept, rows, labeled rows, held-out rows, question count, check and whether it matches the current file. Counts only.",
      build: (ctx) => ["| # | Kept (UTC) | Rows | Labeled | Held out | Questions | Check | Same as current |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...ctx.shown().map((item) => (item.readable
          ? `| ${item.position} | ${kept(item.at)} | ${item.rows} | ${item.labeled} | ${item.held_out} | ${item.questions.length} | ${item.has_check ? "yes" : "no"} | ${item.current ? "yes" : "no"} |`
          : `| ${item.position} | ${kept(item.at)} | unreadable | — | — | — | — | ${item.current ? "yes" : "no"} |`))].join("\n") + "\n" },
    { id: "counts_csv", kind: "exporter", label: "Shown revision counts (CSV)", mime: "text/csv",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-revision-counts.csv`,
      help: "Revision ID, time kept and counts; blank counts for an unreadable file.",
      build: (ctx) => csvText([["revision", "kept_at", "rows", "labeled", "held_out", "questions", "check", "current"],
        ...ctx.shown().map((item) => [item.revision, item.at || "", item.rows ?? "", item.labeled ?? "", item.held_out ?? "",
          item.readable ? item.questions.length : "", item.has_check ? "yes" : "no", item.current ? "yes" : "no"])]) },

    { id: "preview_newest_other", kind: "command", title: "Preview restoring the newest revision that differs from the current file", group: "Dataset history",
      when: (ctx) => !ctx.data.busy && ctx.items().some((item) => item.readable && !item.current),
      run: (ctx) => ctx.actions.preview(ctx.items().find((item) => item.readable && !item.current).revision) },
    { id: "preview_most_labeled", kind: "command", title: "Preview restoring the older revision with the most labeled rows", group: "Dataset history",
      when: (ctx) => !ctx.data.busy && ctx.items().some((item) => item.readable && !item.current),
      run: (ctx) => {
        const best = ctx.items().filter((item) => item.readable && !item.current).reduce((top, item) => (item.labeled > top.labeled ? item : top));
        return ctx.actions.preview(best.revision);
      } },
    { id: "cancel_preview", kind: "command", title: "Close the restore preview", group: "Dataset history",
      when: (ctx) => !!ctx.data.preview,
      run: (ctx) => ctx.actions.cancelPreview() },
  ],
});
