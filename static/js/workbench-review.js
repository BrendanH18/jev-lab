import { confirmAgreementDiscard } from "./workbench-datasets.js";
import { confirmDriftDiscard } from "./workbench-drift.js";
// Review queue (jev/decisions.py): label the rows an exported gate sent to review and its audit sample.
import { api, h, handleError, icon, mount, pct, stat, toast } from "./common.js";
import { labelShortcut } from "./prelabel.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { rowsText, bulkUnsaved, loadPictureUrls, rowText } from "./workbench-bulk.js";
import { agreeQuestions } from "./workbench-datasets.js";
import { withCI, labelText, labelValue } from "./workbench-calibrate.js";

// ---------- Review queue ----------
// jev/decisions.py reads the lines an exported gate prints (gate.py or gate.mjs run as a script: one decision per row,
// with the row) and lists the rows to label: every row the gate sent to review, and an audit sample of rows it
// automated, drawn at random. A review row starts from the answers its gate cleared; its held questions, and those a
// broken rule reads, start empty. An audit row starts empty and hides the gate's answers until its gated questions are
// labeled, so the audit measures the gate rather than agreement with it. Labeled rows join the dataset, rows and labels
// only. Nothing here calls the model: the answers shown are the ones the user's own gate returned.
export function newQueue() {
  return { open: false, text: "", audit: "10", busy: false, report: null, audit_report: null, csvPreview: null,
    kindFilter: "all", statusFilter: "all", nextLine: null, sliceField: "", sliceValue: "",
    edits: {}, sessionPreview: null, readText: null };
}

export function queueClasses(question) {
  if (question.type === "noul") return ["yes", "no"];
  if (question.type === "score") return question.criteria.map((_c, i) => String(i));
  return Object.keys(question.criteria);
}

// An answer or label as the gate shows it: a Noul's yes or no is a boolean.
export function shownAnswer(value) {
  if (value === null || value === undefined) return "no answer";
  return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
}

export function queueReady(item, gates) {
  return Object.keys(gates).every((q) => item.labels[q] !== null && item.labels[q] !== undefined);
}

function queueVisible(items, gates, kind = "all", status = "all", field = "", value = "") {
  return items.filter((item) => (kind === "all" || item.kind === kind)
    && (status === "all" || queueReady(item, gates) === (status === "ready"))
    && (!field || item.slice_values?.[field] === value));
}

function queueNextIncomplete(items, gates, kind = "all", afterLine = null, field = "", value = "", direction = 1) {
  const ordered = direction < 0 ? [...items].reverse() : items;
  const start = ordered.findIndex((item) => item.line === afterLine);
  return [...ordered.slice(start + 1), ...ordered.slice(0, start + 1)].find((item) =>
    (kind === "all" || item.kind === kind) && !queueReady(item, gates)
    && (!field || item.slice_values?.[field] === value));
}

function nextQueueRow(id, direction = 1) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy) return;
  // With a Lab filter active, Next skips the rows it hides (the queue never draws them), still in queue order.
  const lab = W.lab?.active?.("workbench.review.queue") ? W.checkLabs?.review?.[id] : null;
  const pool = lab ? q.report.items.filter((entry) => lab.page.matches(entry)) : q.report.items;
  const item = queueNextIncomplete(pool, q.report.gates, q.kindFilter, q.nextLine, q.sliceField, q.sliceValue, direction);
  if (!item) return;
  q.statusFilter = "incomplete";
  q.nextLine = item.line;
  render();
  const card = document.getElementById(`queue-${id}-${item.line}`);
  card?.scrollIntoView({ block: "center", behavior: "smooth" });
  (card?.querySelector(".label-sel.open") || card)?.focus({ preventScroll: true });
}

export function reviewQueuesUnsaved() {
  return Object.values(W.bulk.checkRuns).some((run) => Object.values(run.queue?.edits || {})
    .some((labels) => Object.keys(labels).length));
}

function replaceQueue(q) {
  return !Object.values(q.edits || {}).some((labels) => Object.keys(labels).length)
    || window.confirm("Replace this Review queue and discard its unsaved human labels? Download the Review session first to keep them.");
}

export function confirmReviewDiscard(id) {
  if (!confirmDriftDiscard(id)) return false;
  if (!confirmAgreementDiscard(id)) return false;
  const q = W.bulk.checkRuns[id]?.queue;
  if (!q) return true;
  if (q.busy) { toast("Wait for the Review operation to finish before replacing this queue.", "error"); return false; }
  return replaceQueue(q);
}

export function queueForm(x, q) {
  const area = h("textarea", { class: "input", spellcheck: "false", rows: "5", "aria-label": `Gate decisions for ${x.id}`, disabled: q.busy,
    placeholder: '{"route": "review", "held": ["department"], "rules": [], "answers": {...}, "row": {"text": "..."}}' }, q.text);
  const session = h("div", {}, queueSession(x.id, q));
  area.addEventListener("input", () => {
    q.text = area.value;
    q.sessionPreview = null;
    mount(session, queueSession(x.id, q));  // Refresh controls without replacing the focused textarea.
  });
  const file = h("input", { type: "file", accept: ".jsonl,.json,.txt,.log", style: { display: "none" } });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    q.text = await f.text();
    render();
    readQueue(x.id);
  });
  const audit = h("input", { class: "input sm", type: "number", min: "0", max: "200", step: "1", value: q.audit, disabled: q.busy, style: { width: "70px" },
    "aria-label": "Automated rows to audit" });
  audit.addEventListener("input", () => { q.audit = audit.value; });
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("p", { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
      "Paste what the exported gate printed (", h("code", {}, "python gate.py < rows.jsonl > decisions.jsonl"),
      "), one decision per line. The queue lists every row it sent to review, and a random sample of rows it automated to audit. Label them and add them to this dataset, so the next check run, Policy, and Calibrate learn from your traffic. Reading the file makes no model call."),
    area,
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: q.busy, onclick: () => readQueue(x.id) },
        q.busy ? [h("span", { class: "spin" }), " Reading…"] : [icon("layers"), "Read decisions"]),
      h("button", { class: "btn sm ghost", disabled: q.busy, onclick: () => file.click() }, "Choose file"), file,
      h("label", { class: "faint", style: { fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" } },
        "Audit", audit, "automated rows")),
    session);
}

async function readQueue(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy) return;
  if (!q.text.trim()) return toast("Paste the gate's decisions, one JSON line per row", "error");
  const audit = Number(q.audit || 0);
  if (!Number.isInteger(audit) || audit < 0 || audit > 200) return toast("Audit a whole number of rows, from 0 to 200", "error");
  if (!replaceQueue(q)) return;
  const text = q.text;
  q.busy = true;
  render();
  try {
    const report = await api("/api/workbench/checks/decisions", { id, text, audit });
    if (W.bulk.checkRuns[id]?.queue !== q || q.text !== text) return;
    q.report = report;
    q.readText = text;
    q.edits = {};
    q.sessionPreview = q.csvPreview = null;
    q.sliceField = q.sliceValue = "";
    q.nextLine = null;
    await loadPictureUrls(q.report.items);
    q.audit_report = null;
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

export function queueSelect(item, qid, question, onChange, disabled = false) {
  const current = labelText(item.labels[qid], question.type);
  const open = item.open.includes(qid) && !current;
  const sel = h("select", { class: `input label-sel${open ? " open" : ""}`, disabled, "aria-label": `Label ${qid} for line ${item.line}` },
    h("option", { value: "", selected: !current }, "—"),
    queueClasses(question).map((c) => h("option", { value: c, selected: c === current },
      question.type === "score" ? `${c} · ${String(question.criteria[Number(c)] ?? "").slice(0, 32)}` : c)));
  sel.addEventListener("change", () => { item.labels[qid] = labelValue(sel.value, question.type); onChange(); });
  return sel;
}

// lab: the "workbench.review.queue" ctx (reviewQueueLab), or null. Without it, or with no Lab filter or sort active,
// the queue shows exactly the rows its own filters leave.
export function queueView(x, q, lab = null) {
  const rep = q.report;
  const c = rep.counts;
  const gates = rep.gates;
  const ready = rep.items.filter((i) => queueReady(i, gates));
  const byFilters = queueVisible(rep.items, gates, q.kindFilter, q.statusFilter, q.sliceField, q.sliceValue);
  const labActive = lab ? W.lab?.active?.("workbench.review.queue") || 0 : 0;
  const visible = labActive ? lab.page.visible() : byFilters;
  const pool = labActive ? rep.items.filter((item) => lab.page.matches(item)) : rep.items;
  const filter = (name, label, options) => h("label", { class: "faint", style: { display: "flex", gap: "6px", alignItems: "center" } },
    label, h("select", { class: "input sm", disabled: q.busy, "aria-label": label,
      onchange: (e) => { q[name] = e.target.value; q.nextLine = null; render(); } },
    options.map(([value, text]) => h("option", { value, selected: value === (q[name] || "all") }, text))));
  const adding = Math.min(ready.length, rep.room);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const summary = [
    `${plural(c.decisions, "decision")}: ${c.review} to review, ${c.auto} automated`,
    c.in_dataset ? `${c.in_dataset} already in the dataset` : null,
    c.repeated ? `${c.repeated} repeated` : null,
    c.unverified ? `${c.unverified} without provenance` : null,
    `queued ${c.queued - c.audit} to review and ${c.audit} to audit`,
    c.dropped ? `${c.dropped} more to review than fit; add these and read the file again` : null,
  ].filter(Boolean).join(" · ");
  const card = (item) => {
    const done = queueReady(item, gates);
    const reveal = item.kind === "review" || done;  // an audit row shows the gate's answers once its gated questions are labeled
    const why = item.kind === "audit" ? h("span", { class: "badge info", title: "Label it before you read the gate's answers" }, "audit · label blind")
      : [item.held.length ? h("span", { class: "badge warning" }, `held: ${item.held.join(", ")}`) : null,
        item.rules.map((r) => h("span", { class: "badge warning", title: r }, "breaks a rule"))];
    return h("div", { class: `queue-item${done ? " done" : ""}`, id: `queue-${x.id}-${item.line}`, tabindex: "-1", onfocusin: () => { q.nextLine = item.line; } },
      h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: "faint mono", style: { fontSize: "11.5px" } }, `line ${item.line}`), why,
        h("span", { class: `badge ${item.provenance ? "info" : "warning"}` },
          item.provenance ? "gate matches check" : "unverified · no provenance"),
        done ? h("span", { class: "badge good" }, icon("check"), "ready") : null),
      h("div", { class: "row-text" }, rowText(item.row)),
      W.bulk.pictures[item.row?._image] ? h("img", { src: W.bulk.pictures[item.row._image], alt: item.row._image, class: "row-thumb" }) : null,
      h("div", { class: "queue-labels" }, Object.entries(rep.questions).map(([qid, question]) => {
        const answer = item.answers[qid];
        const label = item.labels[qid];
        const differs = reveal && label !== null && label !== undefined && labelText(label, question.type) !== labelText(answer, question.type);
        return h("label", { class: "queue-label" },
          h("span", { class: "mono" }, qid, qid in gates ? h("span", { class: "faint" }, " · gated") : null),
          reveal && item.candidates?.[qid]?.length ? h("span", { class: "faint", style: { fontSize: "11.5px" } },
            `Suggested shortlist: ${item.candidates[qid].map((v) => labelText(v, question.type)).join(", ")}. All options remain available.`) : null,
          queueSelect(item, qid, question, () => {
            ((q.edits ||= {})[item.line] ||= Object.create(null))[qid] = item.labels[qid];
            q.sessionPreview = q.csvPreview = null; q.nextLine = item.line; render();
          }, q.busy),
          reveal ? h("span", { class: `faint${differs ? " differs" : ""}`, style: { fontSize: "11.5px" } },
            `gate: ${shownAnswer(answer)}`) : null,
          W.guides?.hint(x.id, qid, question, { row: item.row, blind: item.kind === "audit" }));
      })));
  };
  return h("div", { class: "check-report grid", style: { gap: "8px" }, onkeydown: (event) => {
    const direction = labelShortcut(event);
    if (direction === null || q.busy) return;
    event.preventDefault();
    nextQueueRow(x.id, direction);
  } },
    h("div", { class: "faint", style: { fontSize: "12px" } }, summary),
    c.unverified ? h("p", { class: "muted" },
      "Older decisions have no gate provenance. Review rows start without suggested labels; automated rows are excluded from audit sampling and scores. Export this check's current gate and route rows again to verify them.") : null,
    rep.problems_total ? h("details", {},
      h("summary", { class: "muted", style: { fontSize: "12.5px" } }, `${plural(rep.problems_total, "line")} not read`),
      h("ul", { class: "faint", style: { fontSize: "12px", margin: "4px 0 0", paddingLeft: "18px" } },
        rep.problems.map((p) => h("li", {}, p.message)),
        rep.problems_total > rep.problems.length ? h("li", {}, `…and ${rep.problems_total - rep.problems.length} more`) : null)) : null,
    rep.items.length ? queueCsv(x.id, q) : null,
    rep.items.length ? h("div", { class: "grid", style: { gap: "6px" } },
      h("div", { class: "faint", role: "status", id: `queue-status-${x.id}` }, `${ready.length} of ${rep.items.length} rows ready · ${rep.items.length - ready.length} incomplete · showing ${visible.length}`),
      h("div", { class: "faint", "aria-label": "Labeling progress by question" }, Object.keys(rep.questions).map((qid) => {
        const labeled = rep.items.filter((item) => item.labels[qid] !== null && item.labels[qid] !== undefined).length;
        return h("div", {}, `${qid}: ${labeled} of ${rep.items.length} labeled · ${rep.items.length - labeled} missing`);
      })),
      rep.slice_fields?.length ? queueSliceControls(q) : null,
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        filter("kindFilter", "Queue rows", [["all", "Review and audit"], ["review", "Review only"], ["audit", "Audit only"]]),
        filter("statusFilter", "Labeling status", [["all", "All statuses"], ["incomplete", "Incomplete"], ["ready", "Ready"]]),
        h("button", { class: "btn sm", id: `queue-next-${x.id}`, disabled: q.busy || !queueNextIncomplete(pool, gates, q.kindFilter, null, q.sliceField, q.sliceValue),
          onclick: () => nextQueueRow(x.id) }, "Next incomplete row")),
      h("p", { class: "faint", style: { margin: 0, fontSize: "12px" } },
        "Filters change only the rows shown. CSV handoff and Add use the whole queue. Next follows the selected row kind and slice. Ctrl/⌘+Enter moves to the next incomplete row; Ctrl/⌘+Shift+Enter moves to the previous one. Progress counts current labels, including suggested labels on review rows."),
      lab && W.lab?.section ? W.lab.section(W.labEnv, "workbench.review.queue", lab, { title: "Lab tools for the Review queue" }) : null,
      h("div", { class: "grid", id: `queue-rows-${x.id}`, style: { gap: "6px" } },
        labActive ? h("p", { class: "faint", role: "status", style: { fontSize: "12px", margin: 0, display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          `Showing ${visible.length} of ${byFilters.length} rows the queue filters leave · ${labActive} Lab setting${labActive === 1 ? "" : "s"} active. Labels on hidden rows stay; CSV handoff and Add still use the whole queue.`,
          h("button", { class: "btn sm ghost", onclick: () => { W.lab.reset("workbench.review.queue"); render(); } }, "Clear Lab filters and sort")) : null,
        visible.length ? h("div", { class: "queue-list" }, visible.map(card))
          : h("div", { class: "empty" }, labActive && byFilters.length ? "No row matches the Lab filters. Clear them to see the queue's rows."
            : "No rows match these filters. Choose another row kind or labeling status.")))
      : h("div", { class: "empty" }, "No eligible rows to label. Check the file problems and provenance notices above; matching rows may already be in the dataset."),
    rep.items.length ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm primary", disabled: q.busy || !adding, onclick: () => addQueued(x.id) },
        icon("save"), `Add ${adding < ready.length ? `${adding} of ${ready.length}` : adding} labeled row${ready.length === 1 ? "" : "s"} to “${x.name || x.id}”`),
      h("span", { class: "faint", style: { fontSize: "12px" } },
        `A row is ready once every gated question (${Object.keys(gates).join(", ")}) has a label. Room for ${rep.room} more rows; ready rows past that stay here. Rows and labels are saved, never answers.`)) : null);
}

function queueSliceControls(q) {
  const fields = q.report.slice_fields;
  const selected = fields.find((field) => field.name === q.sliceField);
  const shown = (value) => value.length <= 80 ? value : `${value.slice(0, 79)}…`;
  return h("div", { class: "row", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
    h("label", {}, "Input slice ", h("select", { class: "input sm", disabled: q.busy, "aria-label": "Review slice field",
      onchange: (event) => {
        q.sliceField = event.target.value;
        q.sliceValue = fields.find((field) => field.name === q.sliceField)?.values[0] || "";
        q.nextLine = null;
        render();
      } }, h("option", { value: "", selected: !selected }, "All inputs"),
    fields.map((field) => h("option", { value: field.name, selected: field === selected }, field.name)))),
    selected ? h("label", {}, "Value ", h("select", { class: "input sm", disabled: q.busy, "aria-label": "Review slice value",
      onchange: (event) => { q.sliceValue = event.target.value; q.nextLine = null; render(); } },
    selected.values.map((value) => h("option", { value, title: value, selected: value === q.sliceValue }, shown(value))))) : null);
}

function queueSession(id, q) {
  const file = h("input", { type: "file", accept: ".json,application/json", class: "hidden", disabled: q.busy });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try { await previewQueueSession(id, JSON.parse(await f.text())); }
    catch (e) { handleError(e); }
  });
  const preview = q.sessionPreview;
  return h("div", { class: "panel grid", style: { gap: "6px" } }, file,
    h("div", {},
      h("button", { class: "btn sm", disabled: q.busy || !q.report?.session_context || q.text !== q.readText,
        onclick: () => downloadQueueSession(id) }, "Download Review session"),
      h("button", { class: "btn sm", disabled: q.busy || !q.text.trim(), onclick: () => file.click() }, "Restore Review session")),
    h("p", { class: "faint", style: { margin: 0 } },
      "Session files keep your human label edits and the original review/audit membership, without model answers or shortlists. Keep the original decisions file and dataset unchanged to restore. Pictures travel separately. Download does not append labels; Add remains explicit."),
    q.report && !q.report.session_context ? h("p", { class: "faint" },
      "Rows were appended since this queue was read. Remaining labels stay here, but cannot be downloaded as a session. Reading decisions again enables session downloads and discards these remaining labels.") : null,
    preview ? h("div", { class: "grid", style: { gap: "6px" } },
      h("p", {}, `Restore preview: ${preview.result.report.items.length} queued rows, including ${preview.result.report.counts.audit} in the original audit sample; ${preview.result.edits.reduce((n, item) => n + Object.keys(item.labels).length, 0)} human label edits. No labels have been applied or saved.`),
      h("div", {},
        h("button", { class: "btn sm primary", disabled: q.busy, onclick: () => acceptQueueSession(id) }, "Accept restored Review session"),
        h("button", { class: "btn sm", disabled: q.busy, onclick: () => { q.sessionPreview = null; render(); } }, "Cancel restore"))) : null);
}

async function downloadQueueSession(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy || !q.report?.session_context || q.text !== q.readText) return;
  const report = q.report;
  q.busy = true;
  render();
  try {
    const session = await api("/api/workbench/checks/decisions/session/export", {
      id, text: q.readText, seed: report.seed, audit: report.audit_requested, context: report.session_context,
      items: Object.entries(q.edits || {}).map(([line, labels]) => ({ line: Number(line), labels })),
    });
    if (W.bulk.checkRuns[id]?.queue !== q || q.report !== report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: `${id}-review-session.json` }).click();
    URL.revokeObjectURL(url);
    toast("Downloaded Review session. Keep the original decisions file and unchanged dataset to restore it.");
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

async function previewQueueSession(id, session) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy || !q.text.trim()) return;
  const text = q.text;
  q.busy = true;
  q.sessionPreview = null;
  render();
  try {
    const result = await api("/api/workbench/checks/decisions/session/import", { id, text, session });
    if (W.bulk.checkRuns[id]?.queue === q && q.text === text) q.sessionPreview = { text, session, result };
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

async function acceptQueueSession(id) {
  const q = W.bulk.checkRuns[id].queue;
  const preview = q.sessionPreview;
  if (q.busy || !preview || preview.text !== q.text || !replaceQueue(q)) return;
  q.busy = true;
  render();
  try {
    // Revalidate at accept time as the saved dataset may have changed since preview.
    const result = await api("/api/workbench/checks/decisions/session/import", { id, text: q.text, session: preview.session });
    if (W.bulk.checkRuns[id]?.queue !== q || q.sessionPreview !== preview || q.text !== preview.text) return;
    q.report = result.report;
    q.edits = Object.fromEntries(result.edits.map((item) => [item.line, item.labels]));
    q.readText = preview.text;
    q.audit = String(result.report.audit_requested);
    q.sessionPreview = q.csvPreview = q.audit_report = null;
    q.sliceField = q.sliceValue = "";
    q.nextLine = null;
    await loadPictureUrls(q.report.items);
    toast("Restored Review session. Add labeled rows when you are ready to save them.");
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

function queueCsv(id, q) {
  const file = h("input", { type: "file", accept: ".csv,text/csv", class: "hidden", disabled: q.busy });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (f) {
      try { await previewQueueLabels(id, await f.text()); }
      catch (e) { handleError(e); }
    }
  });
  const preview = q.csvPreview;
  const changes = preview?.items.filter((item, i) => JSON.stringify(item.labels) !== JSON.stringify(q.report.items[i].labels)) || [];
  const table = h("table", { class: "table" }, h("tbody", {}, changes.map((item) => h("tr", {},
    h("td", {}, rowText(item.row)),
    h("td", {}, Object.keys(q.report.questions).map((qid) => h("div", {}, `${qid}: ${shownAnswer(item.labels[qid])}`)))))));
  return h("div", { class: "panel grid", style: { gap: "6px" } },
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, file,
      h("button", { class: "btn sm", disabled: q.busy, onclick: () => exportQueueLabels(id) }, "Download labeling CSV"),
      h("button", { class: "btn sm", disabled: q.busy, onclick: () => file.click() }, "Import labeling CSV")),
    h("p", { class: "faint", style: { margin: 0 } },
      "Edit only label:<question> columns. Keep row_id and input unchanged. All label cells start blank for independent labeling; model answers and shortlists are excluded. Keep this queue open to import the labels. Pictures remain separate; share their named files with the labeler if needed."),
    h("details", {}, h("summary", {}, "Label definitions for the spreadsheet"), agreeQuestions(q.report.questions)),
    preview ? h("div", { class: "grid", style: { gap: "6px" } },
      h("span", {}, `${preview.counts.matched} rows matched · ${preview.counts.changed} rows with changed labels. Preview only; nothing saved.`),
      h("div", { class: "scroll" }, table),
      h("div", {},
        h("button", { class: "btn sm primary", disabled: q.busy, onclick: () => applyQueueLabels(id) }, "Apply imported labels"),
        h("button", { class: "btn sm", disabled: q.busy, onclick: () => { q.csvPreview = null; render(); } }, "Cancel import"))) : null);
}

async function exportQueueLabels(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy) return;
  q.busy = true;
  render();
  try {
    const out = await api("/api/workbench/checks/decisions/export", { id, items: q.report.items });
    const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: `${id}-review-labels.csv` });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

async function previewQueueLabels(id, text) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy) return;
  q.busy = true;
  q.csvPreview = null;
  render();
  try {
    const report = q.report;
    const result = await api("/api/workbench/checks/decisions/import", { id, items: report.items, text });
    if (W.bulk.checkRuns[id]?.queue === q && q.report === report) q.csvPreview = result;
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

function applyQueueLabels(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy || !q.csvPreview) return;
  for (const item of q.csvPreview.items) {
    const old = q.report.items.find((i) => i.line === item.line);
    for (const [qid, value] of Object.entries(item.labels)) {
      if (value !== old.labels[qid]) ((q.edits ||= {})[item.line] ||= Object.create(null))[qid] = value;
    }
  }
  q.sessionPreview = null;
  q.report.items = q.csvPreview.items;
  q.csvPreview = null;
  q.audit_report = null;
  render();
}

async function addQueued(id) {
  const b = W.bulk;
  const q = b.checkRuns[id].queue;
  if (q.busy) return;
  const rep = q.report;
  // Only as many ready rows as the dataset has room for, in queue order; the rest stay in the queue with their labels.
  const ready = rep.items.filter((i) => queueReady(i, rep.gates)).slice(0, rep.room);
  if (!ready.length) return toast("The dataset is full: it holds 200 rows. Save these rows as a new dataset instead.", "error");
  const remains = rep.items.some((item) => !ready.includes(item) && Object.keys(q.edits?.[item.line] || {}).length);
  if (remains && !window.confirm("Adding rows changes this dataset and prevents session downloads for the remaining human labels. Those labels stay on this page, but reading decisions again discards them. Finish labeling the queue first if you need portable recovery. Add these ready rows anyway?")) return;
  q.busy = true;
  render();
  try {
    const items = ready.map((i) => ({ row: i.row, kind: i.kind, answers: i.answers,
      ...(i.provenance ? { provenance: i.provenance } : {}),
      labels: Object.fromEntries(Object.entries(i.labels).filter(([, v]) => v !== null && v !== undefined)) }));
    const out = await api("/api/workbench/checks/decisions/add", { id, items });
    q.csvPreview = null;
    rep.items = rep.items.filter((i) => !ready.includes(i));
    for (const item of ready) delete (q.edits ||= {})[item.line];
    rep.session_context = null;
    q.sessionPreview = null;
    rep.room = Math.max(0, rep.room - out.added);
    q.audit_report = out.audit;
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    if (b.dataset.id === id) {
      // The rows box holds this dataset as it was loaded, and saving replaces the file, so a stale box would drop the
      // added rows. Refresh it when it has no unsaved edits; otherwise unlink it, so a save under this name asks first.
      if (!bulkUnsaved()) {
        b.rowsText = b.savedText = rowsText((await api("/api/workbench/datasets/load", { id })).dataset.rows);
      } else {
        b.dataset.id = null;
        toast("The rows box has unsaved edits, so it still shows this dataset without the added rows. Saving it under the same name asks before it replaces the file.", "error");
      }
    }
    toast(`Added ${out.added} row${out.added === 1 ? "" : "s"} to data/workbench/datasets/${id}.json${out.already ? ` (${out.already} already there)` : ""}. Run the check to see the gate on them.`);
  } catch (e) { handleError(e); }
  q.busy = false;
  render();
}

export function auditReport(a) {
  const mark = a.ok === null ? null : h("span", { class: `badge ${a.ok ? "good" : "critical"}` }, a.ok ? "meets" : "misses");
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
    h("div", { class: "stat-row" },
      stat("automated decisions right, audited", [withCI(`${a.correct} of ${a.rows} · ${pct(a.accuracy, 1)}`, a.accuracy_low, a.accuracy_high), " ", mark]),
      a.target === null ? null : stat(a.bound === "lower" ? "target, 95% lower bound" : "target", pct(a.target, 1))),
    auditSlices(a),
    a.wrong.length ? h("div", { class: "scroll" }, h("table", { class: "table" },
      h("tbody", {}, a.wrong.map((w) => h("tr", {},
        h("td", { class: "row", style: { maxWidth: "300px" } }, rowText(w.row)),
        h("td", {}, Object.entries(w.wrong).map(([qid, v]) => h("div", { style: { fontSize: "12px" } },
          h("span", { class: "mono" }, qid), `: gate ${shownAnswer(v.answer)}, label ${shownAnswer(v.label)}`)))))))) : null,
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      `A row is right when every gated answer matches its label, as Policy scores it. This report describes completed audits submitted in this batch. The queue samples automated rows randomly; label the whole sample before drawing conclusions about traffic. ${a.rows < 100 ? `${a.rows} row${a.rows === 1 ? " gives" : "s give"} a wide interval, so audit more before you rely on it.` : "Read the interval, not only the share."}`));
}

function auditSlices(a) {
  const options = a.by_slice || [];
  if (!options.length) return h("p", { class: "faint" },
    "No input field has 2–20 distinct values among completed audits in this batch. More varied audited rows are needed for slices.");
  const selected = options.find((s) => s.field === a.slice_field) || options[0];
  const field = h("select", { class: "input sm", "aria-label": "Audit slice field" },
    options.map((s) => h("option", { value: s.field, selected: s === selected }, s.field)));
  field.addEventListener("change", () => { a.slice_field = field.value; render(); });
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("label", {}, "Audit by slice ", field),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, ["Value", "Audited", "Correct", "Accuracy · 95% interval"].map((v) => h("th", {}, v)))),
      h("tbody", {}, selected.slices.map((s) => h("tr", {},
        h("td", {}, s.value), h("td", {}, s.rows), h("td", {}, s.correct),
        h("td", {}, withCI(pct(s.accuracy, 1), s.accuracy_low, s.accuracy_high))))))),
    h("p", { class: "faint", style: { margin: 0 } },
      "Small slices have wide intervals; a high accuracy alone is not enough evidence. Missing or blank values appear as (none). These are descriptive accuracy results, not slice-target checks or automation coverage. No additional model calls are made, and results are not saved."));
}

// ---------- Lab surface "workbench.review.queue" (contract: static/js/lab/surfaces/workbench-checks.js) ----------
// One ctx per check, built from W.lab.builders on first use and kept on W.checkLabs, so queueView (through its lab
// argument) and nextQueueRow reach it only through W. Every field reads W at call time: reading decisions or restoring a
// session replaces the queue's report as a whole.
export function reviewQueueLab(x) {
  const build = W.lab?.builders?.reviewQueueCtx;
  if (typeof build !== "function") return null;
  const labs = W.checkLabs ||= { list: null, review: {}, drift: {} };
  const id = x.id;
  const queue = () => W.bulk.checkRuns[id]?.queue;
  return labs.review[id] ||= build({
    dataset: () => W.bulk.datasets.find((d) => d.id === id) || { id, name: id },
    queue,
    pictures: () => W.bulk.pictures,
    pageVisible: () => {
      const q = queue();
      return q?.report ? queueVisible(q.report.items, q.report.gates, q.kindFilter, q.statusFilter, q.sliceField, q.sliceValue) : [];
    },
    matches: (item, ctx) => W.lab.matches("workbench.review.queue", item, ctx),
    arrange: (items, ctx) => W.lab.arrange("workbench.review.queue", items, ctx),
    writeLabels: (changes, label) => reviewLabWrite(id, changes, label),
    goTo: (line) => reviewLabGoTo(id, line),
    next: (direction) => nextQueueRow(id, direction),
    setFilter: (name, value) => { const q = queue(); q[name] = value; q.nextLine = null; render(); },
    setSlice: (field, value) => { const q = queue(); q.sliceField = field; q.sliceValue = value; q.nextLine = null; render(); },
    resetFilters: () => {
      const q = queue();
      if (q) Object.assign(q, { kindFilter: "all", statusFilter: "all", sliceField: "", sliceValue: "", nextLine: null });
      W.lab?.reset("workbench.review.queue");
      render();
    },
    refresh: () => reviewLabRefresh(id),
  });
}

// A Lab edit of the labels takes the path a row's select takes: the label changes, it is recorded as a human edit, and a
// pending CSV or session preview is dropped. Nothing is saved until Add.
function reviewLabWrite(id, changes, label) {
  const q = W.bulk.checkRuns[id]?.queue;
  if (!q?.report || q.busy) throw new Error("Wait for the Review operation to finish.");
  for (const [line, labels] of changes) {
    const item = q.report.items.find((entry) => entry.line === line);
    if (!item) continue;
    for (const [qid, value] of Object.entries(labels)) {
      item.labels[qid] = value;
      ((q.edits ||= {})[item.line] ||= Object.create(null))[qid] = value;
    }
  }
  if (changes.length === 1) q.nextLine = changes[0][0];
  q.sessionPreview = q.csvPreview = null;
  render();
  toast(`${label}: labels changed on ${changes.length} row${changes.length === 1 ? "" : "s"}. Add labeled rows to save them to the dataset.`);
}

function reviewLabGoTo(id, line) {
  W.bulk.checkRuns[id].queue.nextLine = line;
  render();
  const card = document.getElementById(`queue-${id}-${line}`);
  if (!card) throw new Error("Open this check's Review queue to go to a row.");
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  (card.querySelector(".label-sel.open") || card.querySelector("select:not(:disabled)") || card).focus({ preventScroll: true });
}

// Lab filters and sorts redraw the queue rows, the "showing N" line and Next only, so the Lab section keeps its controls.
function reviewLabRefresh(id) {
  const q = W.bulk.checkRuns[id]?.queue;
  const x = W.bulk.datasets.find((d) => d.id === id);
  if (!q?.report || !x) return render();
  const fresh = h("div", {}, queueView(x, q, W.checkLabs?.review?.[id] || null));
  for (const part of ["queue-status", "queue-next", "queue-rows"]) {
    const live = document.getElementById(`${part}-${id}`), next = fresh.querySelector(`#${part}-${id}`);
    if (!live || !next) return render();
    live.replaceWith(next);
  }
}
