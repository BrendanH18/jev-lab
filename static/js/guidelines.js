// Labeling guidelines (jev/guidelines.py): a dataset's per-question notes and generic examples for the people who
// label its rows. Human-only: the page never puts them in a request, and they are not part of a check or a gate.
//
// The pure helpers at the top take `h` (common.js's DOM builder) as an argument, so tests/js can run them without a
// DOM. createGuidelines() wires them to the API for the Workbench: hint() beside a label control, toggle() and
// panel() for the editor under a saved dataset.

export const LABEL_TYPES = ["choice", "noul", "score"];
export const MAX_NOTE_CHARS = 2000;
export const MAX_EXAMPLES = 10;
export const MAX_INPUT_CHARS = 500;
export const MAX_WHY_CHARS = 500;

const has = (v) => v !== null && v !== undefined && v !== "";
const own = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);  // a question id may be __proto__
const text = (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

// The label options a person can choose for a question, as the labeling selects show them.
export function labelOptions(question) {
  if (!question || !LABEL_TYPES.includes(question.type)) return [];
  if (question.type === "noul") return ["yes", "no"];
  if (question.type === "score") return (question.criteria || []).map((_c, i) => String(i));
  return Object.keys(question.criteria || {});
}

// A saved example label as an option's text, and back. A Noul label is saved as true or false, a Score as its level.
export function exampleLabelText(label, question) {
  if (!has(label)) return "";
  if (question?.type === "noul" && typeof label === "boolean") return label ? "yes" : "no";
  return String(label);
}

export function exampleLabelValue(value, question) {
  if (!has(value)) return null;
  if (question?.type === "noul") return value === "yes" ? true : value === "no" ? false : value;
  if (question?.type === "score" && /^\d+$/.test(value)) return Number(value);
  return value;
}

// Whether an example's label is still one of the question's options; the labeling surfaces skip any that is not,
// as when the Bulk questions differ from the ones the guideline was written for.
export function validExampleLabel(question, label) {
  if (question?.type === "noul" && typeof label !== "boolean") return false;
  if (question?.type === "score" && typeof label !== "number") return false;
  return labelOptions(question).includes(exampleLabelText(label, question));
}

const norm = (v) => String(v).trim().replace(/\s+/g, " ").toLowerCase();

// The texts that identify a row as a person reads it: the text itself, each text field of an object row, and the
// whole row as JSON. Labels, test markers, and picture names are not the row's content.
export function rowStrings(row) {
  const out = new Set();
  if (row === null || row === undefined) return out;
  if (typeof row === "string") { out.add(norm(row)); return out; }
  if (typeof row === "object" && !Array.isArray(row)) {
    const content = Object.fromEntries(Object.entries(row).filter(([k]) => !["_expect", "_test", "_image"].includes(k)));
    for (const v of Object.values(content)) if (typeof v === "string" && v.trim()) out.add(norm(v));
    out.add(norm(JSON.stringify(content)));
    return out;
  }
  out.add(norm(JSON.stringify(row)));
  return out;
}

// The examples to show beside a label control. On a blind row (an audit row, a Label agreement row) an example whose
// input is the row's own content is hidden, so its label cannot reveal the row's saved label.
export function shownExamples(guideline, question, { row = null, blind = false } = {}) {
  const valid = (Array.isArray(guideline?.examples) ? guideline.examples : [])
    .filter((e) => e && has(e.input) && validExampleLabel(question, e.label));
  if (!blind) return { examples: valid, hidden: 0 };
  const seen = rowStrings(row);
  const examples = valid.filter((e) => !seen.has(norm(e.input)));
  return { examples, hidden: valid.length - examples.length };
}

// One question's guideline, collapsed, for a labeling surface; null when there is nothing to show.
export function guidelineView(h, qid, guideline, question, opts = {}) {
  if (!guideline || typeof guideline !== "object") return null;
  const note = typeof guideline.note === "string" ? guideline.note.trim() : "";
  const { examples, hidden } = shownExamples(guideline, question, opts);
  if (!note && !examples.length && !hidden) return null;
  const small = { fontSize: "12px", margin: 0 };
  return h("details", { class: "guideline", style: { fontSize: "12px", maxWidth: "380px" } },
    h("summary", { class: "faint", style: { cursor: "pointer" } }, `How to label ${qid}`),
    h("div", { class: "grid", style: { gap: "4px", padding: "4px 0 2px 10px", borderLeft: "2px solid var(--line)" } },
      note ? h("p", { class: "muted", style: { ...small, whiteSpace: "pre-wrap" } }, note) : null,
      examples.length ? h("ul", { style: { ...small, paddingLeft: "16px" } }, examples.map((e) => h("li", {},
        h("span", {}, `“${e.input}”`), " → ", h("b", { class: "mono" }, exampleLabelText(e.label, question)),
        has(e.why) ? h("span", { class: "faint" }, ` · ${e.why}`) : null))) : null,
      hidden ? h("p", { class: "faint", style: small },
        `${hidden} example${hidden === 1 ? " matches" : "s match"} this row and ${hidden === 1 ? "is" : "are"} hidden while you label blind.`) : null,
      h("p", { class: "faint", style: { ...small, fontSize: "11px" } }, "Human-only guidance saved with the dataset; never sent to the model.")));
}

// The editor's working copy: one entry per saved question, with labels as option text.
export function editorDraft(guidelines, questions) {
  const out = Object.create(null);
  for (const [qid, question] of Object.entries(questions || {})) {
    const g = own(guidelines, qid) ? guidelines[qid] : {};
    out[qid] = { note: g.note || "", examples: (g.examples || []).map((e) => ({
      input: e.input || "", label: exampleLabelText(e.label, question), why: e.why || "" })) };
  }
  return out;
}

// What Save sends: entries with a note or an example, labels as values. Problems are found before the request; the
// server validates again (jev/guidelines.py).
export function draftPayload(draft, questions) {
  const guidelines = {};
  const problems = [];
  for (const [qid, entry] of Object.entries(draft || {})) {
    const question = questions?.[qid];
    if (!question) continue;
    const note = (entry.note || "").trim();
    const examples = [];
    (entry.examples || []).forEach((e, i) => {
      const input = (e.input || "").trim(), why = (e.why || "").trim();
      if (!input && !has(e.label) && !why) return;  // an empty example row is left out
      if (!input) problems.push(`${qid}, example ${i + 1}: write the example input`);
      if (!has(e.label)) problems.push(`${qid}, example ${i + 1}: choose its label`);
      examples.push(why ? { input, label: exampleLabelValue(e.label, question), why } : { input, label: exampleLabelValue(e.label, question) });
    });
    if (examples.length && !LABEL_TYPES.includes(question.type)) problems.push(`${qid}: Box questions take a note, not label examples`);
    if (examples.length > MAX_EXAMPLES) problems.push(`${qid}: at most ${MAX_EXAMPLES} examples`);
    if (note.length > MAX_NOTE_CHARS) problems.push(`${qid}: the note is longer than ${MAX_NOTE_CHARS} characters`);
    if (note || examples.length) {
      const out = {};
      if (note) out.note = note;
      if (examples.length) out.examples = examples;
      Object.defineProperty(guidelines, qid, { value: out, enumerable: true, writable: true, configurable: true });
    }
  }
  return { guidelines, problems };
}

// One line for the dataset replacement confirmation: question ids and counts, never a note, example, or label.
export function guidelineChangeText(report) {
  if (!report) return "";
  const parts = [["added", report.added], ["changed", report.changed], ["removed", report.removed]]
    .filter(([, ids]) => ids?.length).map(([what, ids]) => `${what}: ${ids.join(", ")}`);
  const dropped = report.dropped?.length ? ` ${report.dropped.join(". ")}.` : "";
  return `Labeling guidelines: ${report.before} → ${report.after} questions${parts.length ? `; ${parts.join("; ")}` : ", unchanged"}.${dropped}\n`;
}

// ---------- Workbench wiring ----------
// deps: { h, api, handleError, toast, rerender }. Guidelines are fetched per saved dataset on first use and kept until
// that dataset's saved_at changes or the editor saves new ones.
export function createGuidelines({ h, api, handleError = () => {}, toast = () => {}, rerender = () => {} }) {
  const cache = new Map();    // dataset id -> { status: "loading" | "ready" | "error", data }
  const editors = new Map();  // dataset id -> { open, busy, draft, data }

  function fetchGuides(id, then = null) {
    cache.set(id, { status: "loading" });
    return api("/api/workbench/datasets/guidelines", { id }).then((data) => {
      cache.set(id, { status: "ready", data });
      if (then) then(data);
      rerender();
    }, (e) => { cache.set(id, { status: "error" }); if (then) handleError(e); });
  }

  function current(id) {
    if (!id) return null;
    const entry = cache.get(id);
    if (!entry) { fetchGuides(id); return null; }
    return entry.status === "ready" ? entry.data : null;
  }

  // The guideline for one question beside a label control, collapsed; null when the dataset has none for it.
  // opts: { row, blind } — on a blind row, examples matching the row are hidden.
  function hint(id, qid, question, opts = {}) {
    const data = current(id);
    if (!data || !own(data.guidelines, qid)) return null;
    return guidelineView(h, qid, data.guidelines[qid], question || data.questions?.[qid], opts);
  }

  function invalidate(id = null) {
    if (id === null) cache.clear(); else cache.delete(id);
  }

  function editor(id) {
    return editors.get(id) || (editors.set(id, { open: false, busy: false, draft: null, data: null }), editors.get(id));
  }

  // A button for a saved dataset's row in the Datasets panel; it also drops cached guidelines when the dataset was
  // saved again since they were fetched.
  function toggle(x) {
    const cached = cache.get(x.id);
    if (cached?.status === "ready" && cached.data.saved_at !== x.saved_at) cache.delete(x.id);
    const e = editor(x.id);
    const n = x.guidelines || 0;
    return h("button", { class: `btn sm${e.open ? " active" : ""}`, "aria-expanded": String(e.open),
      title: "Write how people should label each question. Shown beside every label control; never sent to the model.",
      onclick: () => {
        e.open = !e.open;
        if (e.open) {
          e.busy = true;
          fetchGuides(x.id, (data) => { e.data = data; e.draft = editorDraft(data.guidelines, data.questions); e.busy = false; })
            .finally(() => { e.busy = false; rerender(); });
        }
        rerender();
      } }, `Guidelines${n ? ` · ${n}` : ""}`);
  }

  async function save(x) {
    const e = editor(x.id);
    const { guidelines, problems } = draftPayload(e.draft, e.data.questions);
    if (problems.length) return toast(problems[0], "error");
    e.busy = true;
    rerender();
    try {
      const out = await api("/api/workbench/datasets/guidelines/save", { id: x.id, guidelines });
      Object.assign(x, out.dataset);
      e.data = { ...e.data, guidelines: out.guidelines, warnings: [], saved_at: out.dataset.saved_at };
      cache.set(x.id, { status: "ready", data: e.data });
      e.draft = editorDraft(out.guidelines, e.data.questions);
      toast(`Saved labeling guidelines for ${Object.keys(out.guidelines).length} question${Object.keys(out.guidelines).length === 1 ? "" : "s"}`);
    } catch (err) { handleError(err); }
    e.busy = false;
    rerender();
  }

  function questionEditor(qid, question, entry) {
    const note = h("textarea", { class: "input", rows: "3", maxlength: String(MAX_NOTE_CHARS),
      placeholder: "What each answer means here, and how to decide the hard cases", "aria-label": `Labeling note for ${qid}` }, entry.note);
    note.addEventListener("input", () => { entry.note = note.value; });
    const labelable = LABEL_TYPES.includes(question.type);
    const example = (e, i) => {
      const input = h("input", { class: "input sm", value: e.input, maxlength: String(MAX_INPUT_CHARS),
        placeholder: "A short, made-up input", "aria-label": `Example ${i + 1} input for ${qid}` });
      input.addEventListener("input", () => { e.input = input.value; });
      const label = h("select", { class: "input sm", "aria-label": `Example ${i + 1} label for ${qid}` },
        h("option", { value: "", selected: !e.label }, "Label"),
        labelOptions(question).map((c) => h("option", { value: c, selected: c === e.label },
          question.type === "score" ? `${c} · ${text(question.criteria[Number(c)]).slice(0, 32)}` : c)));
      label.addEventListener("change", () => { e.label = label.value; });
      const why = h("input", { class: "input sm", value: e.why, maxlength: String(MAX_WHY_CHARS),
        placeholder: "Why (optional)", "aria-label": `Example ${i + 1} reason for ${qid}` });
      why.addEventListener("input", () => { e.why = why.value; });
      return h("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, 2fr) auto minmax(0, 2fr) auto", gap: "6px", alignItems: "center" } },
        input, label, why,
        h("button", { class: "btn sm ghost", "aria-label": `Remove example ${i + 1} for ${qid}`,
          onclick: () => { entry.examples.splice(i, 1); rerender(); } }, "Remove"));
    };
    return h("div", { class: "qcard" },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" } },
        h("b", { class: "mono" }, qid), h("span", { class: "faint" }, question.type),
        h("span", { class: "faint", style: { fontSize: "12px" } }, text(question.instructions).slice(0, 160))),
      note,
      labelable ? [
        entry.examples.map(example),
        h("div", {}, h("button", { class: "btn sm ghost", disabled: entry.examples.length >= MAX_EXAMPLES,
          onclick: () => { entry.examples.push({ input: "", label: "", why: "" }); rerender(); } }, "Add example")),
      ] : h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } }, "Box questions take a note; their labels are edges, so there are no label examples."));
  }

  // The editor under a saved dataset, when its Guidelines button is on.
  function panel(x) {
    const e = editor(x.id);
    if (!e.open) return null;
    const intro = h("p", { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
      "Write how a person should label each question, with short made-up examples. Labelers see the guideline, collapsed, beside every label control: Label before running, the Review queue, Label agreement, and Label new traffic. ",
      "Guidelines are saved with the dataset and travel in its ZIP. They are never sent to the model and are not part of a check or an exported gate. On blind rows, an example that matches the row is hidden.");
    if (!e.data || !e.draft) {
      return h("div", { class: "check-item" }, intro, h("p", { class: "faint" }, e.busy ? "Loading guidelines…" : "Could not load the guidelines."));
    }
    const questions = Object.entries(e.data.questions || {});
    return h("div", { class: "check-item" }, intro,
      (e.data.warnings || []).map((w) => h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } }, w)),
      x.saved_at !== e.data.saved_at ? h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
        "The dataset was saved again since these guidelines were loaded. Close and reopen Guidelines to load its questions.") : null,
      questions.length ? [
        h("div", { class: "qlist" }, questions.map(([qid, q]) => questionEditor(qid, q, e.draft[qid]))),
        h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
          h("button", { class: "btn sm primary", disabled: e.busy, onclick: () => save(x) }, e.busy ? "Saving…" : "Save guidelines"),
          h("button", { class: "btn sm ghost", disabled: e.busy,
            onclick: () => { e.draft = editorDraft(e.data.guidelines, e.data.questions); rerender(); } }, "Discard changes"),
          h("span", { class: "faint", style: { fontSize: "12px" } }, "Saving changes only the guidelines; rows, labels, the check, and test history stay as they are.")),
      ] : h("p", { class: "faint" }, "This dataset has no saved questions. Save it with its questions to write guidelines."));
  }

  return { hint, toggle, panel, invalidate, changeText: guidelineChangeText };
}
