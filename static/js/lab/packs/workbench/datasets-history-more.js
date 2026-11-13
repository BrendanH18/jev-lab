// More for a dataset's revision history ("workbench.datasets.history"; contract in
// static/js/lab/surfaces/workbench-datasets.js): how each kept revision differs from the next older one (held-out rows,
// question IDs, check, split, name, time between saves) and from the current file, advisory checks on removed rows,
// dropped questions, save bursts and an open restore preview, timeline metrics, change exports and a restore-preview
// panel (losses first, question IDs against the current file). Counts, question IDs, names and timestamps only, as the
// listing shows; never rows or label values. Nothing here previews or restores: a restore stays the page's own preview,
// confirm and button.
import { csvCell, definePack } from "../../kit.js";

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listOf = (ctx) => (ctx && typeof ctx.items === "function" ? ctx.items() : []);
// a - b when both are finite numbers, else null.
const delta = (a, b) => (finite(a) !== null && finite(b) !== null ? a - b : null);
const signed = (n) => (n > 0 ? `+${n}` : String(n));
// CSV with numbers left bare (a signed count is not a formula) and every other cell escaped by the kit.
const csvRows = (rows) => rows.map((row) => row.map((value) => (typeof value === "number" ? String(value) : csvCell(value))).join(",")).join("\r\n") + "\r\n";
const kept = (at) => (typeof at === "string" ? `${at.slice(0, 10)} ${at.slice(11, 16)}` : "—");
const idsOf = (item) => (Array.isArray(item?.questions) ? item.questions : []);
// A Markdown table cell: pipes and line breaks would break the table.
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
// Nonzero parts only, joined with "and": [[3, "remove", "label"], [0, "change", "label"]] -> "remove 3 labels".
const parts = (list) => list.filter(([n]) => n > 0).map(([n, verb, word]) => `${verb} ${plural(n, word)}`).join(" and ");
// What the page says about undoing a restore: only an existing file is kept as a revision first.
const undoText = (p) => (p.exists ? "The current file is kept as a revision first, so the restore can be undone." : "The dataset file is deleted: restoring recreates it.");

// The next older readable revision in the whole list (items are newest first), or null.
function older(item, ctx) {
  const list = listOf(ctx);
  const index = list.findIndex((entry) => entry.revision === item?.revision);
  if (index < 0) return null;
  return list.slice(index + 1).find((entry) => entry.readable) || null;
}

// The pair (this revision, the next older readable one) when both are readable, else null.
function pair(item, ctx) {
  if (!item?.readable) return null;
  const before = older(item, ctx);
  return before ? [item, before] : null;
}

const currentOf = (ctx) => listOf(ctx).find((entry) => entry.current && entry.readable) || null;
const added = (now, before) => idsOf(now).filter((id) => !idsOf(before).includes(id));
const removed = (now, before) => idsOf(before).filter((id) => !idsOf(now).includes(id));

function questionChange(item, ctx) {
  const both = pair(item, ctx);
  if (!both) return null;
  const [now, before] = both;
  const plus = added(now, before).length, minus = removed(now, before).length;
  if (plus && minus) return "questions replaced";
  if (plus) return "questions added";
  if (minus) return "questions removed";
  return JSON.stringify(idsOf(now)) === JSON.stringify(idsOf(before)) ? "same questions" : "questions reordered";
}

// The changes of one revision against the next older readable one, as short phrases.
function changePhrases(item, ctx) {
  if (!item.readable) return ["unreadable"];
  const before = older(item, ctx);
  if (!before) return ["oldest kept"];
  const parts = [];
  if (item.rows !== before.rows) parts.push(`rows ${signed(item.rows - before.rows)}`);
  if (item.labeled !== before.labeled) parts.push(`labeled ${signed(item.labeled - before.labeled)}`);
  if (item.held_out !== before.held_out) parts.push(`held out ${signed(item.held_out - before.held_out)}`);
  const plus = added(item, before), minus = removed(item, before);
  if (plus.length) parts.push(`questions added ${plus.join(", ")}`);
  if (minus.length) parts.push(`questions removed ${minus.join(", ")}`);
  if (!plus.length && !minus.length && JSON.stringify(idsOf(item)) !== JSON.stringify(idsOf(before))) parts.push("questions reordered");
  if (item.has_check !== before.has_check) parts.push(item.has_check ? "check added" : "check removed");
  if ((item.name || "") !== (before.name || "")) parts.push(`renamed from “${before.name || ""}”`);
  return parts.length ? parts : ["no count change"];
}

const previewOf = (ctx) => ctx?.data?.preview || null;
// The saved check after a restore, in the page's words (static/js/history.js checkChange).
const checkText = (p) => (p.check === "removed" ? "removed" : p.check === "preserved" ? (p.check_changed ? "restored from the revision" : "unchanged")
  : p.check_changed ? "removed (the revision has none)" : "none");

export default definePack({
  id: "datasets-history-more",
  surface: "workbench.datasets.history",
  title: "Revision history: more",
  about: "How each kept revision differs from the next older one and from the current file (held-out rows, question IDs, check, split, name, time between saves), checks on removed rows, dropped questions, save bursts and an open restore preview, timeline metrics, change exports and a restore-preview panel. Counts, question IDs, names and timestamps only: never rows or label values, and it never previews or restores by itself.",
  features: [
    { id: "held_out_change", kind: "fact", type: "number", label: "held-out row change from the older revision", unit: "rows",
      help: "Held-out rows minus the next older readable revision's.",
      value: (item, ctx) => { const both = pair(item, ctx); return both ? delta(both[0].held_out, both[1].held_out) : null; } },
    { id: "questions_added", kind: "fact", type: "number", label: "question IDs added since the older revision", unit: "questions",
      value: (item, ctx) => { const both = pair(item, ctx); return both ? added(...both).length : null; } },
    { id: "questions_removed", kind: "fact", type: "number", label: "question IDs removed since the older revision", unit: "questions",
      value: (item, ctx) => { const both = pair(item, ctx); return both ? removed(...both).length : null; } },
    { id: "hours_since_previous", kind: "fact", type: "number", label: "hours after the previous kept revision", unit: "hours",
      help: "Time between this revision and the next older one (readable or not) being kept.",
      value: (item, ctx) => {
        const list = listOf(ctx);
        const index = list.findIndex((entry) => entry.revision === item?.revision);
        const at = finite(item?.at_ms);
        if (index < 0 || at === null) return null;
        const prior = list.slice(index + 1).find((entry) => finite(entry.at_ms) !== null);
        return prior ? (at - prior.at_ms) / HOUR_MS : null;
      } },
    { id: "hours_save_to_kept", kind: "fact", type: "number", label: "hours from its save to being kept", unit: "hours",
      help: "How long this version was the saved file: its saved_at to the time it was kept.",
      value: (item) => {
        const saved = finite(item?.saved_ms), at = finite(item?.at_ms);
        return saved === null || at === null ? null : (at - saved) / HOUR_MS;
      } },
    { id: "labeled_vs_current", kind: "fact", type: "number", label: "labeled row difference from the current file", unit: "rows",
      help: "Its labeled rows minus the current file's, when a kept revision matches the current file. The restore preview has the exact change.",
      value: (item, ctx) => {
        const current = currentOf(ctx);
        return current && item?.readable ? delta(item.labeled, current.labeled) : null;
      } },
    { id: "name_changed", kind: "fact", type: "flag", label: "a different name than the older revision",
      value: (item, ctx) => { const both = pair(item, ctx); return !!both && (both[0].name || "") !== (both[1].name || ""); } },
    { id: "check_change", kind: "fact", type: "category", label: "check change from the older revision",
      help: "check added, check removed or no check change; unknown for the oldest and unreadable revisions.",
      value: (item, ctx) => {
        const both = pair(item, ctx);
        if (!both) return null;
        return both[0].has_check === both[1].has_check ? "no check change" : both[0].has_check ? "check added" : "check removed";
      } },
    { id: "split_change", kind: "fact", type: "category", label: "split change from the older revision",
      help: "From held-out row counts: split added, split removed, held-out rows changed or no split change (the same count can hold other rows).",
      value: (item, ctx) => {
        const both = pair(item, ctx);
        if (!both) return null;
        const [now, before] = both;
        if (now.held_out === before.held_out) return "no split change";
        if (!before.held_out) return "split added";
        if (!now.held_out) return "split removed";
        return "held-out rows changed";
      } },
    { id: "question_change", kind: "fact", type: "category", label: "question change from the older revision",
      help: "By question ID: questions added, removed or replaced (some of each), questions reordered, or same questions.", value: questionChange },

    { id: "rows_removed", kind: "diagnostic", severity: "advice", label: "Fewer rows than the revision before",
      check: (item, ctx) => {
        const both = pair(item, ctx);
        return both && both[0].rows < both[1].rows ? `${plural(both[1].rows - both[0].rows, "row")} fewer than the older revision: check that rows were not dropped by mistake.` : null;
      } },
    { id: "questions_dropped", kind: "diagnostic", severity: "advice", label: "Questions dropped since the revision before",
      check: (item, ctx) => {
        const both = pair(item, ctx);
        const gone = both ? removed(...both) : [];
        return gone.length ? `Drops ${gone.join(", ")}, which the older revision asked: labels for ${gone.length === 1 ? "it" : "them"} may be orphaned.` : null;
      } },
    { id: "save_burst", kind: "diagnostic", severity: "info", scope: "list", label: "Revisions kept within an hour of each other",
      check: (items, ctx) => {
        const keep = Number.isInteger(ctx?.data?.keep) ? ctx.data.keep : 20;
        const times = items.map((item) => finite(item?.at_ms)).filter((value) => value !== null).sort((a, b) => b - a);
        const close = times.slice(1).filter((at, index) => times[index] - at < HOUR_MS).length;
        return close ? `${plural(close, "revision")} kept within an hour of the next newer one: bursts of saves use up the ${keep}-revision limit faster.` : null;
      } },
    { id: "saved_after_kept", kind: "diagnostic", severity: "info", label: "Saved time later than the time it was kept",
      check: (item) => {
        const saved = finite(item?.saved_ms), at = finite(item?.at_ms);
        return saved !== null && at !== null && saved - at >= 1000 ? "Its saved_at is later than the moment it was kept: a clock was off, so do not order revisions by saved_at." : null;
      } },
    { id: "preview_label_loss", kind: "diagnostic", severity: "advice", scope: "list", label: "Restore preview removes or changes labels",
      check: (items, ctx) => {
        const p = previewOf(ctx);
        const what = p?.labels ? parts([[p.labels.removed, "remove", "label"], [p.labels.changed, "change", "label"]]) : "";
        return what ? `Restoring would ${what} of the current file. ${undoText(p)}` : null;
      } },
    { id: "preview_guideline_change", kind: "diagnostic", severity: "advice", scope: "list", label: "Restore preview changes labeling guidelines",
      check: (items, ctx) => {
        const guides = previewOf(ctx)?.guidelines;
        const what = guides ? parts([[guides.removed, "remove", "question guideline"], [guides.changed, "change", "question guideline"]]) : "";
        return what ? `Restoring would ${what}.` : null;
      } },
    { id: "preview_split_change", kind: "diagnostic", severity: "advice", scope: "list", label: "Restore preview changes held-out membership",
      check: (items, ctx) => {
        const test = previewOf(ctx)?.test;
        if (!test || !(test.changed_membership > 0)) return null;
        return `Restoring would change held-out membership for ${plural(test.changed_membership, "row")} (${test.before} → ${test.after} held out). Recorded test looks: ${test.history}.`;
      } },

    { id: "readable_share", kind: "metric", format: "percent", label: "Kept revisions that can be restored",
      help: "Readable revisions over all kept revisions of this dataset.",
      compute: (ctx) => {
        const list = ctx.items();
        if (!list.length) return null;
        const readable = list.filter((item) => item.readable).length;
        return { value: readable / list.length, detail: `${readable} of ${plural(list.length, "revision")}` };
      } },
    { id: "days_since_newest", kind: "metric", format: "number", label: "Days since the newest revision was kept",
      compute: (ctx) => {
        const times = ctx.items().map((item) => finite(item.at_ms)).filter((value) => value !== null);
        const now = finite(ctx.data.now);
        return times.length && now !== null ? (now - Math.max(...times)) / DAY_MS : null;
      } },
    { id: "largest_label_drop", kind: "metric", format: "integer", label: "Largest drop in labeled rows between revisions",
      help: "Across readable neighbours: the older revision's labeled rows minus the newer one's, at most. 0 when labels only grew.",
      compute: (ctx) => {
        const list = ctx.items();
        let best = null;
        for (const item of list) {
          const both = pair(item, ctx);
          if (!both) continue;
          const drop = both[1].labeled - both[0].labeled;
          if (!best || drop > best.drop) best = { drop, item };
        }
        if (!best) return null;
        return best.drop > 0 ? { value: best.drop, detail: `into revision #${best.item.position}` } : { value: 0, detail: "labeled rows never dropped" };
      } },

    { id: "change_log", kind: "exporter", label: "Shown revision changes (Markdown)", mime: "text/markdown",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-revision-changes.md`,
      help: "One line per shown revision: what changed against the next older readable one (row, labeled and held-out counts, question IDs, check, name). Counts, question IDs and names only.",
      build: (ctx) => [`# Revision changes · ${ctx.data.dataset_id || "dataset"}`, "",
        ...ctx.shown().map((item) => `- #${item.position} (${kept(item.at)}): ${changePhrases(item, ctx).join(", ")}${item.current ? " · current" : ""}`)].join("\n") + "\n" },
    { id: "deltas_csv", kind: "exporter", label: "Shown revision changes (CSV)", mime: "text/csv",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-revision-deltas.csv`,
      help: "Revision ID, position, time kept and the changes against the next older readable revision; blank where unknown.",
      build: (ctx) => csvRows([["revision", "position", "kept_at", "rows_change", "labeled_change", "held_out_change", "questions_added", "questions_removed", "check_change"],
        ...ctx.shown().map((item) => {
          const both = pair(item, ctx);
          if (!both) return [item.revision, item.position, item.at || "", "", "", "", "", "", ""];
          const [now, before] = both;
          return [item.revision, item.position, item.at || "", now.rows - before.rows, now.labeled - before.labeled, now.held_out - before.held_out,
            added(now, before).join(" "), removed(now, before).join(" "),
            now.has_check === before.has_check ? "none" : now.has_check ? "added" : "removed"];
        })]) },
    { id: "preview_summary", kind: "exporter", label: "Restore preview summary (Markdown)", mime: "text/markdown",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-restore-preview.md`,
      help: "The open restore preview's change counts: rows, labels, questions, rules, metadata, check, held-out split and guidelines. Counts only, never label values.",
      build: (ctx) => {
        const p = previewOf(ctx);
        if (!p) throw new Error("Open a restore preview first.");
        const yes = (flag) => (flag ? "yes" : "no");
        const lines = [`# Restore preview · ${ctx.data.dataset_id || "dataset"} · revision ${p.revision || "?"}`, "",
          "| | Current file | After restore |", "| --- | --- | --- |",
          `| Rows | ${p.rows.before} | ${p.rows.after} |`, `| Held-out rows | ${p.test.before} | ${p.test.after} |`];
        if (p.guidelines) lines.push(`| Guideline questions | ${p.guidelines.before} | ${p.guidelines.after} |`);
        lines.push("", `- Rows: ${p.rows.added} added, ${p.rows.removed} removed, order ${p.rows.order_changed ? "changed" : "unchanged"}`,
          `- Labels: ${p.labels.added} added, ${p.labels.removed} removed, ${p.labels.changed} changed`,
          `- Questions changed: ${yes(p.questions_changed)} · rules changed: ${yes(p.rules_changed)} · metadata changed: ${yes(p.metadata_changed)}`,
          `- Saved check: ${checkText(p)}`,
          `- Held-out membership changes: ${p.test.changed_membership}; recorded test looks: ${p.test.history}`);
        if (p.guidelines) lines.push(`- Guidelines: ${p.guidelines.added} added, ${p.guidelines.changed} changed, ${p.guidelines.removed} removed`);
        lines.push(`- ${undoText(p)}`);
        return lines.join("\n") + "\n";
      } },
    { id: "deleted_list", kind: "exporter", label: "Deleted datasets with kept history (Markdown)", mime: "text/markdown",
      filename: "deleted-datasets-history.md",
      help: "Each deleted dataset's ID, name, kept revisions and newest kept time, once the deleted list has loaded.",
      build: (ctx) => {
        const deleted = ctx.data.deleted;
        if (!Array.isArray(deleted)) throw new Error("Load the deleted datasets list first.");
        return ["| Dataset | Name | Kept revisions | Newest kept (UTC) |", "| --- | --- | --- | --- |",
          ...deleted.map((entry) => `| ${cell(entry.id)} | ${cell(entry.name || "—")} | ${entry.revisions} | ${kept(entry.latest)} |`)].join("\n") + "\n";
      } },

    { id: "restore_preview", kind: "panel", title: "Restore preview at a glance",
      improvements: [
        { id: "losses", title: "What a restore would remove or change, listed first" },
        { id: "question_ids", title: "Question IDs the previewed revision adds or drops against the current file" },
      ],
      render: (h, ctx) => {
        const p = previewOf(ctx);
        if (!p) return h("p", { class: "faint" }, "Preview restoring a revision to see its changes here.");
        const losses = [];
        if (p.rows.removed) losses.push(`${plural(p.rows.removed, "row")} removed`);
        if (p.labels.removed) losses.push(`${plural(p.labels.removed, "label")} removed`);
        if (p.labels.changed) losses.push(`${plural(p.labels.changed, "label")} changed`);
        if (p.test.changed_membership) losses.push(`held-out membership changes for ${plural(p.test.changed_membership, "row")}`);
        if (p.guidelines?.removed) losses.push(`${plural(p.guidelines.removed, "question guideline")} removed`);
        if (p.guidelines?.changed) losses.push(`${plural(p.guidelines.changed, "question guideline")} changed`);
        if (p.check === "removed" || p.check_changed) losses.push(`saved check ${checkText(p)}`);
        const target = ctx.items().find((item) => item.revision === p.revision);
        const current = currentOf(ctx);
        let questions;
        if (!p.exists) questions = "The dataset file is deleted, so there are no current question IDs to compare.";
        else if (!target || !current) questions = "The current file is not among the kept revisions, so question IDs cannot be compared here.";
        else {
          const plus = added(target, current), minus = removed(target, current);
          questions = plus.length || minus.length
            ? `Adds ${plus.length ? plus.join(", ") : "none"}; drops ${minus.length ? minus.join(", ") : "none"}.`
            : JSON.stringify(idsOf(target)) === JSON.stringify(idsOf(current)) ? "Same question IDs in the same order." : "Same question IDs in another order.";
        }
        return h("div", {},
          h("p", { class: "losses" }, losses.length ? `Would remove or change: ${losses.join("; ")}.` : "Nothing would be removed or changed."),
          h("p", { class: "questions" }, questions));
      } },
  ],
});
