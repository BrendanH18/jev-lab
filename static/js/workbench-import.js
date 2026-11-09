// Bulk's CSV import (jev/csvimport.py) and dataset health (jev/health.py).
import { $, api, debounce, h, handleError, icon, mount, num, toast } from "./common.js";
import { W, canon } from "./workbench-state.js";
import { render } from "./workbench.js";
import { rowLineFor, rowsText, replaceRows, settleLabels, expectedText, rowsPayload, bulkQuestions } from "./workbench-bulk.js";

// ---------- CSV import ----------
// The server reads the CSV and checks label columns against the questions selected to run (jev/csvimport.py); no
// model calls. The import panel shows each column's use, the labels found, and the values that fit no answer.
const LABELABLE = new Set(["choice", "noul", "score"]);
const CSV_USES = { state: "Model reads it", skip: "Skip" };

const importQuestions = () => bulkQuestions() || {};

// Until the latest conversion is back, the rows on screen may not match the text, the uses, or the questions.
// It also outdates any conversion in flight, so only the newest one can clear `pending`.
function importPending() {
  W.bulk.csv.seq += 1;
  W.bulk.csv.pending = true;
  const put = $("#csv-put");
  if (put) put.disabled = true;
}

async function reimport() {
  const c = W.bulk.csv;
  importPending();
  const seq = c.seq;
  const questions = importQuestions();
  c.qkey = JSON.stringify(questions);
  if (!c.text.trim()) { c.report = null; c.error = null; }
  else {
    try {
      const report = await api("/api/workbench/import",
        { text: c.text, questions: Object.keys(questions).length ? questions : null, columns: c.columns });
      if (seq !== c.seq) return;  // a newer file, edit, or choice is on its way
      c.report = report;
      c.error = null;
    } catch (e) {
      if (seq !== c.seq) return;
      c.error = e.message || String(e);  // keep the last report's columns on screen, so the uses can be fixed
    }
  }
  c.pending = false;
  const el = $("#csv-result");
  if (el) mount(el, renderImportResult());
}
const reimportSoon = debounce(reimport, 300);

function readCsvFile(file) {
  const c = W.bulk.csv;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    c.text = String(reader.result || "");
    c.file = file.name;
    c.columns = {};
    const box = $("#csv-text");
    if (box) box.value = c.text;
    reimport();
  };
  reader.onerror = () => toast(`Could not read ${file.name}`, "error");
  reader.readAsText(file);
}

export function renderImport() {
  const c = W.bulk.csv;
  const file = h("input", { type: "file", accept: ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain", class: "hidden" });
  file.addEventListener("change", () => { readCsvFile(file.files[0]); file.value = ""; });
  const text = h("textarea", { class: "input", id: "csv-text", spellcheck: "false", rows: "6", "aria-label": "CSV text",
    placeholder: "Or paste CSV here. The first line names the columns, e.g.\ntext,department,wants_refund\n\"I was charged twice\",billing,yes" }, c.text);
  text.addEventListener("input", () => { c.text = text.value; c.file = ""; importPending(); reimportSoon(); });
  // The questions to run changed since the last check (another source, or edited Build questions): check again.
  if (c.text.trim() && c.qkey !== JSON.stringify(importQuestions())) { importPending(); setTimeout(reimport); }
  return h("div", { class: "panel csv-import", id: "csv-import" },
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, "Import CSV"), h("div", { class: "spacer" }),
      h("button", { class: "btn sm ghost", onclick: () => { c.open = false; render(); } }, "Close")),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("p", { class: "faint", style: { fontSize: "12px" } }, "Comma-, tab-, or semicolon-separated, with the column names on the first line. ",
        "Choose what each column is: a field the model reads, or the label for a question. Label columns go under ", h("code", {}, "\"_expect\""),
        ", so the model never sees them. Nothing is sent to the model until you run the rows."),
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        h("button", { class: "btn sm", onclick: () => file.click() }, "Choose a file…"), file,
        c.file ? h("span", { class: "faint", style: { fontSize: "12px" } }, c.file) : null),
      text,
      h("div", { id: "csv-result" }, renderImportResult())));
}

function renderImportResult() {
  const b = W.bulk;
  const c = b.csv;
  const failed = c.error ? h("div", { class: "callout", role: "alert" }, icon("alert"), h("div", {}, h("b", {}, "Could not import"), h("div", { class: "muted" }, c.error))) : null;
  const r = c.report;
  if (!r) return failed;
  const questions = importQuestions();
  const labelable = Object.entries(questions).filter(([, q]) => LABELABLE.has(q.type)).map(([id]) => id);
  const useSelect = (col) => {
    const sel = h("select", { class: "input", "aria-label": `Use for column ${col.name}` },
      Object.entries(CSV_USES).map(([v, label]) => h("option", { value: v, selected: col.use === v }, label)),
      labelable.map((q) => h("option", { value: `label:${q}`, selected: col.use === `label:${q}` }, `Label for ${q}`)));
    sel.addEventListener("change", () => {
      importPending();
      // One column per question's label: choosing it here takes it from a column that had it.
      const columns = Object.fromEntries(r.columns.map((x) => [x.name, x.use === sel.value && sel.value.startsWith("label:") ? "skip" : (c.columns[x.name] ?? x.use)]));
      c.columns = { ...columns, [col.name]: sel.value };
      reimport();
    });
    return sel;
  };
  const n = r.rows.length;
  const labelCounts = Object.entries(r.labels).map(([q, k]) => `${q} ${k}`).join(", ");
  const notes = [
    r.dropped ? `${r.dropped} more row${r.dropped === 1 ? "" : "s"} left out: a run takes ${n} at most. Split the file to use the rest.` : null,
    r.empty ? `${r.empty} row${r.empty === 1 ? "" : "s"} with nothing for the model to read left out.` : null,
  ].filter(Boolean);
  const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const put = () => {
    if (c.pending || c.error || c.qkey !== JSON.stringify(importQuestions())) return toast("The import is still being checked. Try again in a moment.", "error");
    if (!n) return toast("No rows to put in the rows box.", "error");
    if (!replaceRows(rowsText(r.rows), `${plural(n, "row")} from ${c.file || "the CSV"}`)) return;
    b.dataset.id = null;
    c.open = false;
    toast(`${plural(n, "row")} in the rows box${r.labeled ? `, ${r.labeled} labeled` : ""}. Run them to get answers.`);
    render();
  };
  return h("div", { class: "grid", style: { gap: "10px" } }, failed,
    h("div", { class: "stat-row" },
      h("span", { class: "stat" }, r.delimiter, h("b", {}, "separated")),
      h("span", { class: "stat accent" }, "rows", h("b", {}, num(n))),
      h("span", { class: "stat" }, "labeled", h("b", {}, num(r.labeled))),
      labelCounts ? h("span", { class: "faint", style: { fontSize: "12px" } }, `Labels: ${labelCounts}`) : null),
    labelable.length ? null : h("p", { class: "faint", style: { fontSize: "12px" } },
      "The selected questions have no Choice, Noul, or Score question, so no column can be a label. Pick the questions to run first."),
    notes.map((t) => h("p", { class: "faint", style: { fontSize: "12px" } }, t)),
    r.problems.length ? h("div", { class: "callout" }, icon("alert"), h("div", {},
      h("b", {}, `${plural(r.problems.reduce((a, p) => a + p.rows, 0), "label")} fit no answer and ${r.problems.reduce((a, p) => a + p.rows, 0) === 1 ? "was" : "were"} left out`),
      h("ul", { class: "muted", style: { margin: "6px 0 0", paddingLeft: "18px" } }, r.problems.slice(0, 8).map((p) => h("li", {}, h("code", {}, p.value), ` in ${p.column}`,
        p.rows > 1 ? ` (${p.rows} rows)` : "", ` is not ${expectedText(questions[p.question])}.`))),
      r.problems.length > 8 ? h("div", { class: "muted" }, `And ${r.problems.length - 8} more values.`) : null)) : null,
    h("div", { class: "scroll" }, h("table", { class: "table csv-columns" },
      h("thead", {}, h("tr", {}, h("th", {}, "column"), h("th", {}, "first values"), h("th", {}, "use"))),
      h("tbody", {}, r.columns.map((col) => h("tr", {},
        h("td", {}, h("code", {}, col.name)),
        h("td", { class: "faint" }, col.samples.map((v) => (v.length > 40 ? `${v.slice(0, 40)}…` : v)).join(" · ")),
        h("td", {}, useSelect(col))))))),
    n ? h("details", {}, h("summary", { class: "faint", style: { fontSize: "12px" } }, `Preview the first ${Math.min(3, n)} rows`),
      h("div", { class: "code" }, h("pre", {}, r.rows.slice(0, 3).map((row) => rowLineFor(row)).join("\n")))) : null,
    h("div", { style: { display: "flex", gap: "8px" } },
      h("button", { class: "btn primary sm", id: "csv-put", disabled: !n || c.pending || !!c.error, onclick: put }, `Put ${plural(n, "row")} in the rows box`)));
}

// A health report describes the current rows and selected questions, never a prior Bulk run's answers.
export const healthContext = () => canon([W.bulk.rowsText, bulkQuestions(), W.bulk.labelsDirty, W.bulk.health.field]);

async function checkHealth() {
  if (W.bulk.health.busy) return;
  if (!settleLabels("Check the rows box")) return;
  const state = W.bulk.health;
  const context = healthContext();
  state.busy = true;
  state.report = null;
  render();
  try {
    const report = await api("/api/workbench/health", { rows: rowsPayload(), questions: bulkQuestions(), field: state.field });
    if (context === healthContext()) {
      state.report = report;
      state.field = report.by_slice?.field ?? null;
      state.context = healthContext();
    }
  } catch (e) { handleError(e); }
  state.busy = false;
  render();
}

export function healthBody() {
  const state = W.bulk.health;
  const report = state.context === healthContext() ? state.report : null;
  const numbers = (rows) => rows.join(", ");
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("div", {}, h("button", { class: "btn sm", disabled: state.busy, onclick: checkHealth },
      state.busy ? "Checking dataset…" : "Check dataset health")),
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Inspect the rows box and selected questions before a paid run. No model calls or saved changes. Load a saved dataset to inspect it here. Row numbers count nonempty rows from 1."),
    report ? h("div", { class: "grid", style: { gap: "6px" } },
      h("p", { class: "muted" }, `${report.rows} rows · ${report.unique_inputs} unique inputs. Exact inputs and picture names are compared; similar wording or identical pictures with different names are not detected.`),
      report.duplicate_groups.length ? h("div", {}, h("b", {}, "Duplicate inputs"),
        h("p", { class: "muted" }, "Repeated inputs can inflate evaluation results. Keep repeats only when they represent intentional traffic weighting."),
        h("ul", {}, report.duplicate_groups.map((g) => h("li", {}, `Rows ${numbers(g.rows)}`)))) : null,
      report.conflicts.length ? h("div", {}, h("b", {}, "Conflicting labels"),
        h("p", { class: "muted" }, "Settle these human labels before tuning. Label values stay hidden here, including test labels."),
        h("ul", {}, report.conflicts.map((g) => h("li", {}, `${g.question}: rows ${numbers(g.rows)}`)))) : null,
      report.overlap.length ? h("div", {}, h("b", {}, "Tuning / test overlap"),
        h("p", { class: "muted" }, "The same input is on both sides of the split. Remove duplicate inputs and draw a fresh split before relying on its score."),
        h("ul", {}, report.overlap.map((g) => h("li", {}, `Tuning rows ${numbers(g.training)}; test rows ${numbers(g.test)}`)))) : null,
      report.questions.length ? h("div", { class: "scroll" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ["Question", "Valid labels", "Missing", "Invalid"].map((x) => h("th", {}, x)))),
        h("tbody", {}, report.questions.map((q) => h("tr", {}, h("td", {}, q.qid), h("td", {}, String(q.labeled)),
          h("td", {}, String(q.missing), q.missing ? h("details", {}, h("summary", {}, "Row numbers"), numbers(q.missing_rows)) : null),
          h("td", {}, String(q.invalid.length), q.invalid.length ? ` · rows ${numbers(q.invalid)}` : "")))))) :
        h("p", { class: "muted" }, "Select questions to check label coverage and validity."),
      healthSlices(report.by_slice, state),
      report.invalid_labels.length ? h("div", {}, h("b", {}, "Labels for unknown questions"),
        h("p", { class: "muted" }, "Choose the matching question set or correct these label keys."),
        h("ul", {}, report.invalid_labels.map((x) => h("li", {}, `Row ${x.row}: ${x.question}`)))) : null,
      !report.duplicate_groups.length && !report.conflicts.length && !report.overlap.length && !report.invalid_labels.length
        && report.questions.every((q) => !q.missing && !q.invalid.length)
        ? h("p", { class: "muted" }, "No issues found by these checks. This does not establish model accuracy or representative data.") : null) : null);
}

// Counts describe label availability, never model quality or the hidden label values.
function healthSlices(report, state) {
  if (!report) return null;
  const select = h("select", { class: "input", "aria-label": "Dataset health slice field", disabled: state.busy,
    onchange: (e) => { state.field = e.target.value || null; checkHealth(); } },
    h("option", { value: "", selected: report.field === null }, "Choose a field"),
    report.fields.map((f) => h("option", { value: f.name, selected: report.field === f.name }, f.name)));
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("label", {}, "Label coverage by slice ", select),
    h("p", { class: "faint", style: { fontSize: "12px" } },
      "Fields with 2–20 distinct values are available. Missing values form a (none) slice. Counts separate tuning and held-out rows; label values stay hidden. Counts do not establish accuracy or representative data."),
    report.fields.length ? null : h("p", { class: "muted" }, "No input field has 2–20 distinct values."),
    report.field === null ? null : h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, ["Value", "All rows", "Distinct inputs", "Split", "Rows in split", "Distinct in split", "Question", "Valid labels", "Missing", "Invalid"].map((x) => h("th", {}, x)))),
      h("tbody", {}, report.slices.flatMap((slice) => ["tuning", "test"].flatMap((split) => {
        const group = slice[split];
        const questions = group.questions.length ? group.questions : [{ qid: "—", labeled: "—", missing: "—", invalid: "—" }];
        return questions.map((q) => h("tr", {},
          [slice.value, slice.rows, slice.unique_inputs, split === "test" ? "Held-out" : "Tuning",
            group.rows, group.unique_inputs, q.qid, q.labeled, q.missing, q.invalid].map((v) => h("td", {}, String(v)))));
      }))))));
}
