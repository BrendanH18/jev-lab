// More for a check's Review queue ("workbench.review.queue"; contract in static/js/lab/surfaces/workbench-checks.js):
// progress and reason facts, advisory checks about the audit sample and the queue's state, progress metrics including
// the worst-case margin an audit sample of this size gives, exports without inputs, labels or answers, and navigation
// commands. Blind audit rows stay blind: the one fact that reads a shortlist is unknown, and the one flag false, until a
// row is revealed. Nothing here measures accuracy or automation; the page's audit report after Add does.
import { csvText, definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
// The worst case (50%) half-width of a 95% normal-approximation interval for a proportion over n rows: 1.96 * sqrt(0.25 / n).
const HALF_Z = 0.98;
const worstMargin = (n) => (Number.isInteger(n) && n > 0 ? HALF_Z / Math.sqrt(n) : null);
const rowsForMargin = (margin) => Math.ceil((HALF_Z / margin) ** 2);
const points = (share) => (share * 100).toFixed(1);
// A label or a shortlist entry as one comparable text: Noul yes/no, everything else as written.
const labelText = (value) => (value === true || /^(yes|true)$/i.test(String(value)) ? "yes" : value === false || /^(no|false)$/i.test(String(value)) ? "no" : String(value));
const currentItem = (ctx) => (Number.isInteger(ctx?.data?.next_line) ? ctx.items().find((item) => item.line === ctx.data.next_line) || null : null);
const sliceField = (ctx) => ctx.data.filters.slice_field || ctx.data.slice_fields[0]?.name || "";

export default definePack({
  id: "review-queue-more",
  surface: "workbench.review.queue",
  title: "Review queue progress and audit sample",
  about: "Progress and reason facts, checks on the audit sample (its size and the worst-case margin it gives) and the queue's state, progress metrics, exports and navigation for a check's Review queue. Blind audit rows stay blind, nothing here measures accuracy or automation, and the exports hold no inputs, labels or answers.",
  features: [
    { id: "open_questions", kind: "fact", type: "number", label: "questions to decide", unit: "questions",
      help: "Held and rule-read questions on review rows; every question on audit rows.", value: (item) => (Array.isArray(item?.open) ? item.open.length : null) },
    { id: "labels_set", kind: "fact", type: "number", label: "labels set", unit: "labels",
      help: "Questions with a label now: yours, and on review rows the gate's starting suggestions.",
      value: (item) => (isObject(item?.labels) ? Object.values(item.labels).filter(has).length : null) },
    { id: "suggested_labels", kind: "fact", type: "number", label: "gate suggestions not yet edited", unit: "labels",
      help: "Review rows only; audit rows start blank.", value: (item) => (Array.isArray(item?.suggested) ? item.suggested.length : null) },
    { id: "optional_missing", kind: "fact", type: "number", label: "optional labels missing", unit: "labels",
      help: "Questions outside the gate still without a label. Add does not need them.",
      value: (item, ctx) => {
        if (!isObject(item?.labels) || !Array.isArray(ctx?.data?.questions)) return null;
        return ctx.data.questions.filter((question) => !question.gated && !has(item.labels[question.id])).length;
      } },
    { id: "shortlist_options", kind: "fact", type: "number", label: "shortlist options shown", unit: "options",
      help: "Options in the attached shortlists of a revealed row. Unknown on blind audit rows.",
      value: (item) => (item?.revealed === true && isObject(item.candidates) ? Object.values(item.candidates).reduce((sum, values) => sum + list(values).length, 0) : null) },
    { id: "input_fields", kind: "fact", type: "number", label: "input fields", unit: "fields", help: "Top-level fields of the row, not counting the picture name.",
      value: (item) => (isObject(item?.row) ? Object.keys(item.row).filter((key) => key !== "_image").length : null) },
    { id: "label_outside_shortlist", kind: "fact", type: "flag", label: "a label outside its shortlist",
      help: "A revealed row where your label is not among the options its shortlist offered. Blind audit rows never count.",
      value: (item) => item?.revealed === true && isObject(item.candidates) && Object.entries(item.candidates).some(([qid, values]) =>
        list(values).length > 0 && isObject(item.labels) && has(item.labels[qid]) && !list(values).map(labelText).includes(labelText(item.labels[qid]))) },
    { id: "current_row", kind: "fact", type: "flag", label: "the current row", help: "The row Next or your last label edit went to.", value: (item) => item?.current === true },
    { id: "mixed_edits", kind: "fact", type: "flag", label: "your edits beside untouched suggestions",
      help: "Review rows where you changed some labels but left other gate suggestions as they were.",
      value: (item) => item?.kind === "review" && list(item.edited).length > 0 && list(item.suggested).length > 0 },
    { id: "picture_not_loaded", kind: "fact", type: "flag", label: "a picture this page has not loaded",
      value: (item) => typeof item?.image === "string" && item.picture_loaded !== true },
    { id: "held_set", kind: "fact", type: "category", label: "held questions", help: "Review rows only; \"none\" when only a rule sent the row to review.",
      value: (item) => (item?.kind === "review" ? (list(item.held).join(", ") || "none") : null) },
    { id: "missing_set", kind: "fact", type: "category", label: "missing gated questions",
      value: (item) => (Array.isArray(item?.missing) ? (item.missing.join(", ") || "none") : null) },
    { id: "kind_status", kind: "fact", type: "category", label: "row kind and status",
      value: (item) => (item?.kind && item.status ? `${item.kind}, ${item.status}` : null) },
    { id: "rule_text", kind: "fact", type: "text", label: "broken rule text", help: "The rules the row broke, as the gate printed them.",
      value: (item) => list(item?.rules).join("; ") },

    { id: "ready_open_blank", kind: "diagnostic", severity: "advice", label: "Ready with an open question blank",
      check: (item) => {
        if (item?.ready !== true || !isObject(item.labels)) return null;
        const blank = list(item.open).filter((qid) => !has(item.labels[qid]));
        return blank.length ? `${blank.join(", ")} ${blank.length === 1 ? "is" : "are"} open on this row but ${blank.length === 1 ? "has" : "have"} no label; Add saves the row without ${blank.length === 1 ? "it" : "them"}.` : null;
      } },
    { id: "audit_partly_labeled", kind: "diagnostic", severity: "advice", label: "Audit row partly labeled",
      check: (item) => (item?.kind === "audit" && item.ready !== true && isObject(item.labels) && Object.values(item.labels).some(has)
        ? `${list(item.missing).join(", ")} still ${list(item.missing).length === 1 ? "needs" : "need"} a label. Add skips this audit row, and it stays blind until then.` : null) },
    { id: "no_audit_sample", kind: "diagnostic", severity: "advice", scope: "list", label: "No audit sample",
      check: (_items, ctx) => (ctx.data.read && ctx.data.counts.auto > 0 && ctx.data.counts.audit === 0
        ? `The queue holds no audit rows from the ${plural(ctx.data.counts.auto, "automated decision")}, so Add cannot check the rows the gate automated. Read the file again with an audit sample size above 0.` : null) },
    { id: "wide_audit_margin", kind: "diagnostic", severity: "info", scope: "list", label: "Small audit sample",
      help: "Worst-case (50%) half-width of a 95% normal-approximation interval: 0.98 / √n.",
      check: (_items, ctx) => {
        const n = ctx.data.read ? ctx.data.counts.audit : 0;
        const margin = worstMargin(n);
        return margin !== null && margin > 0.1
          ? `${plural(n, "audit row")} give${n === 1 ? "s" : ""} a worst-case 95% margin of ±${points(margin)} points; about ${rowsForMargin(0.1)} give ±10 points and ${rowsForMargin(0.05)} give ±5.` : null;
      } },
    { id: "audit_short", kind: "diagnostic", severity: "info", scope: "list", label: "Fewer audit rows than asked",
      check: (_items, ctx) => {
        const asked = ctx.data.audit_requested, got = ctx.data.counts.audit;
        return ctx.data.read && Number.isInteger(asked) && got < asked
          ? `You asked for ${plural(asked, "audit row")}; the queue holds ${got}. The file had fewer automated decisions that could be sampled.` : null;
      } },
    { id: "current_hidden", kind: "diagnostic", severity: "info", scope: "list", label: "Current row hidden",
      check: (items, ctx) => (Number.isInteger(ctx.data.next_line) && !items.some((item) => item.line === ctx.data.next_line)
        ? `Line ${ctx.data.next_line}, the current row, is hidden by the current filters.` : null) },
    { id: "text_changed", kind: "diagnostic", severity: "advice", scope: "list", label: "Decisions box changed since read",
      check: (_items, ctx) => (ctx.data.read && ctx.data.text_changed
        ? "The decisions box no longer matches the text this queue was read from, so Download Review session is off until it does." : null) },

    { id: "audit_margin", kind: "metric", format: "percent", label: "Worst-case 95% margin of the audit sample",
      help: "The half-width a 95% interval can reach for this many audit rows (at 50%, normal approximation). Planning only: it does not measure the gate.",
      compute: (ctx) => {
        const n = ctx.data.read ? ctx.data.counts.audit : 0;
        const margin = worstMargin(n);
        return margin === null ? null : { value: margin, detail: `±${points(margin)} points at most for ${plural(n, "audit row")}` };
      } },
    { id: "audit_sampling_share", kind: "metric", format: "percent", label: "Automated decisions drawn for audit",
      help: "Audit rows queued over the decisions the gate automated in the file. A sampling fraction, not an automation rate.",
      compute: (ctx) => (ctx.data.read && ctx.data.counts.auto > 0
        ? { value: ctx.data.counts.audit / ctx.data.counts.auto, detail: `${ctx.data.counts.audit} of ${plural(ctx.data.counts.auto, "automated decision")}` } : null) },
    { id: "review_progress", kind: "metric", format: "percent", label: "Review rows ready",
      help: "Share of the queue's review rows with every gated question labeled (suggestions count). Progress only.",
      compute: (ctx) => {
        const rows = ctx.items().filter((item) => item.kind === "review");
        if (!rows.length) return null;
        const ready = rows.filter((item) => item.ready).length;
        return { value: ready / rows.length, detail: `${ready} of ${plural(rows.length, "review row")}` };
      } },
    { id: "slice_values", kind: "metric", format: "integer", label: "Input-slice values in the queue",
      help: "Distinct values of the selected input slice (else the first one the page offers), with the rows of each.",
      compute: (ctx) => {
        const field = ctx.data.read ? sliceField(ctx) : "";
        if (!field) return null;
        const counts = new Map();
        for (const item of ctx.items()) {
          const value = item.slice_values?.[field];
          if (typeof value === "string") counts.set(value, (counts.get(value) || 0) + 1);
        }
        if (!counts.size) return null;
        const parts = [...counts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([value, n]) => `${value} ${n}`);
        return { value: counts.size, detail: `${field}: ${parts.join(", ")}` };
      } },
    { id: "ready_waiting", kind: "metric", format: "integer", label: "Ready rows waiting for room",
      help: "Ready rows past the room the dataset has left; they stay in the queue with their labels after Add.",
      compute: (ctx) => (ctx.data.read ? { value: Math.max(0, ctx.data.ready - ctx.data.room), detail: `${ctx.data.ready} ready, room for ${ctx.data.room}` } : null) },

    { id: "todo_markdown", kind: "exporter", label: "Shown rows as a Markdown checklist (no inputs, labels or answers)", filename: "jev-review-checklist.md", mime: "text/markdown",
      help: "Each shown row's line and kind, ticked when ready, with the gated questions it still needs.",
      build: (ctx) => {
        const rows = ctx.shown().map((item) => `- [${item.ready ? "x" : " "}] line ${item.line} (${item.kind})${item.missing.length ? `: needs ${item.missing.join(", ")}` : ""}`);
        return [`# Review queue: ${ctx.data.dataset.name || ctx.data.dataset.id || "check"}`, "", ...(rows.length ? rows : ["No rows shown."])].join("\n") + "\n";
      } },
    { id: "question_progress_csv", kind: "exporter", label: "Per-question progress as CSV (counts only)", filename: "jev-review-questions.csv", mime: "text/csv",
      help: "For each queue question over the whole queue: whether it is gated, its threshold, and how many rows are labeled, missing, edited by you, or still on the gate's suggestion. No label values.",
      build: (ctx) => {
        const items = ctx.items();
        return csvText([["question", "type", "gated", "threshold", "labeled", "missing", "edited", "suggested"],
          ...ctx.data.questions.map((question) => {
            const labeled = items.filter((item) => has(item.labels[question.id])).length;
            return [question.id, question.type, question.gated ? "yes" : "no", question.threshold ?? "", labeled, items.length - labeled,
              items.filter((item) => item.edited.includes(question.id)).length, items.filter((item) => item.suggested.includes(question.id)).length];
          })]);
      } },
    { id: "reasons_csv", kind: "exporter", label: "Why each shown row is queued, as CSV (no inputs, labels or answers)", filename: "jev-review-reasons.csv", mime: "text/csv",
      help: "Line, kind, provenance, held questions, the rules it broke (as the gate printed them) and the questions to decide.",
      build: (ctx) => csvText([["line", "kind", "provenance", "held", "rules_broken", "open"],
        ...ctx.shown().map((item) => [item.line, item.kind, item.verified ? "verified" : "none", item.held.join(" "), item.rules.join("; "), item.open.join(" ")])]) },
    { id: "summary_text", kind: "exporter", label: "Queue summary as text (counts only)", filename: "jev-review-summary.txt",
      help: "Decisions read, rows queued, the audit sample and its worst-case margin, labeling progress, room and edits. No inputs, labels or answers.",
      build: (ctx) => {
        const d = ctx.data;
        if (!d.read) return "No Review queue has been read.\n";
        const c = d.counts;
        const margin = worstMargin(c.audit);
        return [
          `Review queue for ${d.dataset.name || d.dataset.id}${d.dataset.name && d.dataset.id && d.dataset.name !== d.dataset.id ? ` (${d.dataset.id})` : ""}`,
          `Decisions read: ${c.decisions} (${c.review} to review, ${c.auto} automated)`,
          `Queued: ${c.queued} (${c.queued - c.audit} to review, ${c.audit} to audit${Number.isInteger(d.audit_requested) ? `; audit asked: ${d.audit_requested}` : ""})`,
          `Audit sample: ${c.audit} of ${c.auto} automated decisions${margin === null ? "" : `; worst-case 95% margin ±${points(margin)} points`}`,
          `Ready: ${d.ready} · incomplete: ${d.incomplete} · room: ${d.room} · next Add takes ${d.adding}`,
          `Human edits this session: ${plural(d.edits.labels, "label")} on ${plural(d.edits.rows, "row")}`,
        ].join("\n") + "\n";
      } },

    { id: "go_current", kind: "command", title: "Go to the current Review row", group: "Review queue",
      when: (ctx) => !ctx.data.busy && ctx.shown().some((item) => item.current),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => entry.current);
        if (!item) throw new Error("The current row is not shown.");
        return ctx.actions.goTo(item.line);
      } },
    { id: "go_first_unverified", kind: "command", title: "Go to the first shown row without gate provenance", group: "Review queue",
      when: (ctx) => !ctx.data.busy && ctx.shown().some((item) => !item.verified),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => !entry.verified);
        if (!item) throw new Error("Every shown row carries gate provenance.");
        return ctx.actions.goTo(item.line);
      } },
    { id: "go_first_will_add", kind: "command", title: "Go to the first shown row the next Add takes", group: "Review queue",
      when: (ctx) => !ctx.data.busy && ctx.shown().some((item) => item.will_add),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => entry.will_add);
        if (!item) throw new Error("No shown row is in the next Add.");
        return ctx.actions.goTo(item.line);
      } },
    { id: "go_first_past_room", kind: "command", title: "Go to the first shown ready row past the room", group: "Review queue",
      when: (ctx) => !ctx.data.busy && ctx.shown().some((item) => item.ready && !item.will_add),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => entry.ready && !entry.will_add);
        if (!item) throw new Error("Every shown ready row fits the room left.");
        return ctx.actions.goTo(item.line);
      } },
    { id: "show_current_slice", kind: "command", title: "Show only the current row's input slice", group: "Review queue",
      when: (ctx) => {
        if (!ctx.data.read || ctx.data.busy) return false;
        const field = sliceField(ctx), value = currentItem(ctx)?.slice_values?.[field];
        return !!field && typeof value === "string" && !(ctx.data.filters.slice_field === field && ctx.data.filters.slice_value === value);
      },
      run: (ctx) => {
        const field = sliceField(ctx), value = currentItem(ctx)?.slice_values?.[field];
        if (!field || typeof value !== "string") throw new Error("There is no current row with an input slice value.");
        return ctx.actions.setSlice(field, value);
      } },
    { id: "clear_slice", kind: "command", title: "Show every input slice again", group: "Review queue",
      when: (ctx) => ctx.data.read && !ctx.data.busy && ctx.data.filters.slice_field !== "",
      run: (ctx) => ctx.actions.setSlice("") },
  ],
});
