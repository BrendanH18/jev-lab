// Starter pack for a check's Review queue ("workbench.review.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): labeling-progress, provenance and disagreement facts, advisory checks,
// explicit label edits, progress metrics, two exports and three commands. Blind audit rows stay blind: every fact that
// reads the gate's answers or shortlist is unknown on an audit row until its gated questions are labeled, and nothing
// here measures accuracy or automation (the page's audit report after Add does). Labels change only to values the user
// types into an edit's parameters.
import { csvText, definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const blank = (value) => value === null || value === undefined;
// A ready review row whose every gated label is still the gate's suggestion: no person has looked at it yet.
const suggestionsOnly = (item, ctx) => item?.kind === "review" && item.ready === true
  && Object.keys(ctx?.data?.gates || {}).every((qid) => !list(item.edited).includes(qid));

function questionOf(ctx, id) {
  const question = (ctx?.data?.questions || []).find((entry) => entry.id === String(id ?? "").trim());
  if (!question) throw new Error(`“${String(id ?? "").trim()}” is not a question of this queue (${(ctx?.data?.questions || []).map((entry) => entry.id).join(", ")}).`);
  return question;
}

const QUESTION_PARAM = { name: "question", label: "Question id", type: "text", required: true, placeholder: "urgent" };

export default definePack({
  id: "review-queue-essentials",
  surface: "workbench.review.queue",
  title: "Review queue essentials",
  about: "Labeling-progress, provenance and disagreement facts, advisory checks, explicit fill and clear edits for your own labels, progress metrics, a progress CSV and navigation for a check's Review queue. Blind audit rows stay blind, and nothing here measures accuracy or automation; exports leave out inputs, labels and answers.",
  features: [
    { id: "gated_missing", kind: "fact", type: "number", label: "gated labels missing", unit: "labels", value: (item) => (Array.isArray(item?.missing) ? item.missing.length : null) },
    { id: "human_edits", kind: "fact", type: "number", label: "human label edits", unit: "labels", help: "Questions you changed in this session (select, CSV import or restored session).",
      value: (item) => (Array.isArray(item?.edited) ? item.edited.length : null) },
    { id: "held_questions", kind: "fact", type: "number", label: "held questions", unit: "questions", value: (item) => (Array.isArray(item?.held) ? item.held.length : null) },
    { id: "broken_rules", kind: "fact", type: "number", label: "broken rules", unit: "rules", value: (item) => (Array.isArray(item?.rules) ? item.rules.length : null) },
    { id: "disagreements", kind: "fact", type: "number", label: "labels that differ from the gate", unit: "questions",
      help: "Unknown on an audit row until its gated questions are labeled: the audit stays blind.",
      value: (item) => (Array.isArray(item?.disagree) ? item.disagree.length : null) },
    { id: "verified", kind: "fact", type: "flag", label: "gate provenance", help: "The decision says it came from this check's current gate.", value: (item) => item?.verified === true },
    { id: "suggested_only", kind: "fact", type: "flag", label: "only the gate's suggested labels", help: "Ready review rows whose gated labels no person has changed yet.",
      value: (item, ctx) => suggestionsOnly(item, ctx) },
    { id: "has_shortlist", kind: "fact", type: "flag", label: "a shortlist you can see", help: "Blind audit rows never count.",
      value: (item) => item?.revealed === true && isObject(item.candidates) && Object.values(item.candidates).some((values) => list(values).length > 0) },
    { id: "has_picture", kind: "fact", type: "flag", label: "a picture", value: (item) => typeof item?.image === "string" },
    { id: "will_add", kind: "fact", type: "flag", label: "a place in the next Add", help: "Ready, and within the room the dataset has left.", value: (item) => item?.will_add === true },
    { id: "input_text", kind: "fact", type: "text", label: "input text", value: (item) => (isObject(item?.row) && typeof item.row.text === "string" ? item.row.text : null) },
    { id: "queue_reason", kind: "fact", type: "category", label: "reason queued",
      value: (item) => {
        if (item?.kind === "audit") return "audit sample";
        const held = list(item?.held).length > 0, broke = list(item?.rules).length > 0;
        return held && broke ? "held and broke a rule" : held ? "held" : broke ? "broke a rule" : item ? "other" : null;
      } },

    { id: "confirm_suggestions", kind: "diagnostic", severity: "advice", label: "Ready only from suggestions",
      check: (item, ctx) => (suggestionsOnly(item, ctx) ? `Ready only from the gate's suggested labels (${Object.keys(ctx.data.gates).join(", ")}). Confirm them before adding.` : null) },
    { id: "unverified_row", kind: "diagnostic", severity: "info", label: "No gate provenance",
      check: (item) => (item && item.verified !== true ? "This decision has no provenance for the check's current gate, so it starts without suggested labels." : null) },
    { id: "disagrees_with_gate", kind: "diagnostic", severity: "info", label: "Your label differs from the gate",
      check: (item) => (list(item?.disagree).length ? `Your label differs from the gate's answer on ${item.disagree.join(", ")}.` : null) },
    { id: "incomplete_audit", kind: "diagnostic", severity: "advice", scope: "list", label: "Audit sample not finished",
      check: (items) => {
        const audits = items.filter((item) => item.kind === "audit");
        const left = audits.filter((item) => !item.ready).length;
        return left ? `${left} of ${plural(audits.length, "shown audit row")} still need labels. Label the whole random sample before reading the audit.` : null;
      } },

    { id: "fill_review_blank", kind: "transform", label: "Set a label you choose on review rows where it is blank",
      help: "Shown review rows only, and only where the question has no label. Audit rows are left alone so they stay blind and individually labeled.",
      params: [QUESTION_PARAM, { name: "label", label: "Label (option text: yes, no, 0, 1, a choice key)", type: "text", required: true }],
      each: (item, params, ctx) => {
        const question = questionOf(ctx, params.question);
        const option = question.options.find((entry) => entry.text === params.label.trim());
        if (!option) throw new Error(`“${params.label.trim()}” is not an option of ${question.id} (${question.options.map((entry) => entry.text).join(", ")}).`);
        if (item.kind !== "review" || !blank(item.labels[question.id])) return null;
        return { ...item, labels: { ...item.labels, [question.id]: option.value } };
      } },
    { id: "clear_question", kind: "transform", label: "Clear one question's labels", help: "On the shown rows only. Clearing a gated label on an audit row makes it blind again.",
      params: [QUESTION_PARAM],
      each: (item, params, ctx) => {
        const question = questionOf(ctx, params.question);
        if (blank(item.labels[question.id])) return null;
        return { ...item, labels: { ...item.labels, [question.id]: null } };
      } },

    { id: "audit_progress", kind: "metric", format: "percent", label: "Audit sample labeled",
      help: "Share of the queue's audit rows with every gated question labeled. Progress only: the audit report after Add measures the gate.",
      compute: (ctx) => {
        const audits = ctx.items().filter((item) => item.kind === "audit");
        if (!audits.length) return null;
        const done = audits.filter((item) => item.ready).length;
        return { value: done / audits.length, detail: `${done} of ${plural(audits.length, "audit row")}` };
      } },
    { id: "human_edit_count", kind: "metric", format: "integer", label: "Human label edits this session",
      help: "What a Review session download keeps.", compute: (ctx) => (ctx.data.read ? ctx.data.edits.labels : null) },
    { id: "review_disagreements", kind: "metric", format: "integer", label: "Review rows where your label differs from the gate",
      help: "Review rows only; audit rows are scored by the audit report after Add.",
      compute: (ctx) => (ctx.data.read ? ctx.items().filter((item) => item.kind === "review" && list(item.disagree).length > 0).length : null) },

    { id: "progress_csv", kind: "exporter", label: "Shown rows' labeling progress as CSV (no inputs, labels or answers)", filename: "jev-review-progress.csv", mime: "text/csv",
      help: "Line, kind, provenance, status, whether the next Add takes it, gated questions missing, and your edit count.",
      build: (ctx) => csvText([["line", "kind", "provenance", "status", "will_add", "missing", "human_edits"],
        ...ctx.shown().map((item) => [item.line, item.kind, item.verified ? "verified" : "none", item.status, item.will_add ? "yes" : "no",
          item.missing.join(" "), item.edited.length])]) },
    { id: "lines_text", kind: "exporter", label: "Shown line numbers", filename: "jev-review-lines.txt",
      help: "The decisions-file lines of the shown rows, to find them in your own file.",
      build: (ctx) => `${ctx.shown().map((item) => item.line).join(", ")}\n` },

    { id: "go_first_disagreement", kind: "command", title: "Go to the first shown review row that differs from the gate", group: "Review queue",
      when: (ctx) => ctx.shown().some((item) => item.kind === "review" && list(item.disagree).length > 0),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => entry.kind === "review" && list(entry.disagree).length > 0);
        if (!item) throw new Error("No shown review row differs from the gate.");
        return ctx.actions.goTo(item.line);
      } },
    { id: "show_incomplete_audit", kind: "command", title: "Show only the audit rows still to label", group: "Review queue",
      when: (ctx) => ctx.data.read && !ctx.data.busy && ctx.items().some((item) => item.kind === "audit" && !item.ready),
      run: (ctx) => {
        ctx.actions.setKind("audit");
        ctx.actions.setStatus("incomplete");
      } },
    { id: "reset_filters", kind: "command", title: "Reset the Review queue's filters, including Lab's", group: "Review queue",
      when: (ctx) => ctx.data.read,
      run: (ctx) => ctx.actions.resetFilters() },
  ],
});
