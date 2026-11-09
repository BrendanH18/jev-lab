// Review queue (jev/decisions.py): label the rows an exported gate sent to review and its audit sample.
import { api, h, handleError, icon, pct, stat, toast } from "./common.js";
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
    kindFilter: "all", statusFilter: "all", nextLine: null };
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

function queueVisible(items, gates, kind = "all", status = "all") {
  return items.filter((item) => (kind === "all" || item.kind === kind)
    && (status === "all" || queueReady(item, gates) === (status === "ready")));
}

function queueNextIncomplete(items, gates, kind = "all", afterLine = null) {
  const start = items.findIndex((item) => item.line === afterLine);
  const ordered = [...items.slice(start + 1), ...items.slice(0, start + 1)];
  return ordered.find((item) => (kind === "all" || item.kind === kind) && !queueReady(item, gates));
}

function nextQueueRow(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy) return;
  const item = queueNextIncomplete(q.report.items, q.report.gates, q.kindFilter, q.nextLine);
  if (!item) return;
  q.statusFilter = "incomplete";
  q.nextLine = item.line;
  render();
  const card = document.getElementById(`queue-${id}-${item.line}`);
  card?.scrollIntoView({ block: "center", behavior: "smooth" });
  (card?.querySelector(".label-sel.open") || card)?.focus({ preventScroll: true });
}

export function queueForm(x, q) {
  const area = h("textarea", { class: "input", spellcheck: "false", rows: "5", "aria-label": `Gate decisions for ${x.id}`,
    placeholder: '{"route": "review", "held": ["department"], "rules": [], "answers": {...}, "row": {"text": "..."}}' }, q.text);
  area.addEventListener("input", () => { q.text = area.value; });
  const file = h("input", { type: "file", accept: ".jsonl,.json,.txt,.log", style: { display: "none" } });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    q.text = await f.text();
    render();
    readQueue(x.id);
  });
  const audit = h("input", { class: "input sm", type: "number", min: "0", max: "200", step: "1", value: q.audit, style: { width: "70px" },
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
      h("button", { class: "btn sm ghost", onclick: () => file.click() }, "Choose file"), file,
      h("label", { class: "faint", style: { fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" } },
        "Audit", audit, "automated rows")));
}

async function readQueue(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy) return;
  if (!q.text.trim()) return toast("Paste the gate's decisions, one JSON line per row", "error");
  const audit = Number(q.audit || 0);
  if (!Number.isInteger(audit) || audit < 0 || audit > 200) return toast("Audit a whole number of rows, from 0 to 200", "error");
  q.busy = true;
  render();
  try {
    q.csvPreview = null;
    q.report = await api("/api/workbench/checks/decisions", { id, text: q.text, audit });
    q.nextLine = null;
    await loadPictureUrls(q.report.items);
    q.audit_report = null;
  } catch (e) { handleError(e); }
  q.busy = false;
  render();
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

export function queueView(x, q) {
  const rep = q.report;
  const c = rep.counts;
  const gates = rep.gates;
  const ready = rep.items.filter((i) => queueReady(i, gates));
  const visible = queueVisible(rep.items, gates, q.kindFilter, q.statusFilter);
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
    return h("div", { class: `queue-item${done ? " done" : ""}`, id: `queue-${x.id}-${item.line}`, tabindex: "-1" },
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
          queueSelect(item, qid, question, () => { q.csvPreview = null; q.nextLine = item.line; render(); }, q.busy),
          reveal ? h("span", { class: `faint${differs ? " differs" : ""}`, style: { fontSize: "11.5px" } },
            `gate: ${shownAnswer(answer)}`) : null,
          W.guides?.hint(x.id, qid, question, { row: item.row, blind: item.kind === "audit" }));
      })));
  };
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
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
      h("div", { class: "faint", role: "status" }, `${ready.length} of ${rep.items.length} rows ready · ${rep.items.length - ready.length} incomplete · showing ${visible.length}`),
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        filter("kindFilter", "Queue rows", [["all", "Review and audit"], ["review", "Review only"], ["audit", "Audit only"]]),
        filter("statusFilter", "Labeling status", [["all", "All statuses"], ["incomplete", "Incomplete"], ["ready", "Ready"]]),
        h("button", { class: "btn sm", disabled: q.busy || !queueNextIncomplete(rep.items, gates, q.kindFilter),
          onclick: () => nextQueueRow(x.id) }, "Next incomplete row")),
      h("p", { class: "faint", style: { margin: 0, fontSize: "12px" } },
        "Filters change only the rows shown. CSV handoff and Add use the whole queue; Next follows the selected row kind and shows incomplete rows."),
      visible.length ? h("div", { class: "queue-list" }, visible.map(card))
        : h("div", { class: "empty" }, "No rows match these filters. Choose another row kind or labeling status."))
      : h("div", { class: "empty" }, "No eligible rows to label. Check the file problems and provenance notices above; matching rows may already be in the dataset."),
    rep.items.length ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm primary", disabled: q.busy || !adding, onclick: () => addQueued(x.id) },
        icon("save"), `Add ${adding < ready.length ? `${adding} of ${ready.length}` : adding} labeled row${ready.length === 1 ? "" : "s"} to “${x.name || x.id}”`),
      h("span", { class: "faint", style: { fontSize: "12px" } },
        `A row is ready once every gated question (${Object.keys(gates).join(", ")}) has a label. Room for ${rep.room} more rows; ready rows past that stay here. Rows and labels are saved, never answers.`)) : null);
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
    q.csvPreview = await api("/api/workbench/checks/decisions/import", { id, items: q.report.items, text });
  } catch (e) { handleError(e); }
  finally { q.busy = false; render(); }
}

function applyQueueLabels(id) {
  const q = W.bulk.checkRuns[id].queue;
  if (q.busy || !q.csvPreview) return;
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
  q.busy = true;
  render();
  try {
    const items = ready.map((i) => ({ row: i.row, kind: i.kind, answers: i.answers,
      ...(i.provenance ? { provenance: i.provenance } : {}),
      labels: Object.fromEntries(Object.entries(i.labels).filter(([, v]) => v !== null && v !== undefined)) }));
    const out = await api("/api/workbench/checks/decisions/add", { id, items });
    q.csvPreview = null;
    rep.items = rep.items.filter((i) => !ready.includes(i));
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
