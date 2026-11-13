// Panels for a check's Review queue ("workbench.review.queue"; contract in static/js/lab/surfaces/workbench-checks.js):
// labeling progress by the reason a row is queued and by question, an audit sample tracker (counts and the worst-case
// margin the labeled audit rows give so far), the distribution of your own labels, and identical inputs side by side,
// plus a few progress metrics (the share of gated labels you set, room left, rows started, distinct inputs). Blind-safe: the audit tracker never shows answers, shortlists or disagreement, and the
// copies panel hides the gate's answers for every copy of an input while one copy is a blind audit row. Panels change
// presentation only: the one page action they use is Go to a row, pressed by the user. Nothing here measures accuracy
// or automation; the page's audit report after Add does.
import { compareText, definePack, formatValue } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";
import { truncate } from "../../lib/text.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const pct = (value) => formatValue(value, "percent");
const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const questionsOf = (ctx) => list(dataOf(ctx).questions).filter((question) => isObject(question) && typeof question.id === "string");
const gatedOf = (ctx) => (isObject(dataOf(ctx).gates) ? Object.keys(dataOf(ctx).gates) : []);
const isItem = (item) => isObject(item) && Number.isInteger(item.line);
function itemsOf(ctx) {
  try { return list(ctx?.items?.()).filter(isItem); } catch { return []; }
}
function shownOf(ctx) {
  try { return list(ctx?.shown?.()).filter(isItem); } catch { return []; }
}
const short = (text) => truncate(String(text ?? ""), 80) ?? "";
const rowText = (row) => (isObject(row) && typeof row.text === "string" ? row.text : JSON.stringify(row) ?? "");

// A label as the page writes it: the option's text ("yes", "2", "billing"), else the value as written.
function labelText(question, value) {
  if (!has(value)) return "—";
  const option = list(question?.options).find((entry) => entry && entry.value === value);
  return option ? String(option.text) : typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}
// A label you set: a question you edited in this session that holds a label now.
const ownLabel = (item, qid) => list(item.edited).includes(qid) && isObject(item.labels) && has(item.labels[qid]);
const suggestedLabel = (item, qid) => item.kind === "review" && list(item.suggested).includes(qid) && isObject(item.labels) && has(item.labels[qid]);

// Runs a page action the user just pressed and reports a refusal as an error toast.
function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function") result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) { api.toast(error?.message || String(error), "error"); }
}
// A Go button for one line; a row the filters hide cannot be scrolled to, so its button is off and says so.
function goButton(h, ctx, api, line, label = "Go") {
  const visible = shownOf(ctx).some((item) => item.line === line);
  return h("button", { class: "btn sm ghost", "data-go-line": line, disabled: dataOf(ctx).busy === true || !visible,
    title: visible ? `Go to line ${line}` : `Line ${line} is hidden by the current filters`,
    onclick: () => attempt(api, () => ctx.actions.goTo(line)) }, visible ? label : `${label} (hidden)`);
}
const toggle = (h, api, key, label, name) => h("button", { class: "btn sm ghost", "data-action": name, "aria-pressed": api.state[key] ? "true" : "false",
  onclick: () => { api.state[key] = !api.state[key]; api.redraw(); } }, label);
const notRead = (h) => h("p", { class: "faint" }, "Read the gate's decisions first: there is no Review queue yet.");

// ---------- reasons ----------

const REASONS = ["held", "broke a rule", "held and broke a rule", "other", "audit sample"];
function reasonOf(item) {
  if (item.kind === "audit") return "audit sample";
  const held = list(item.held).length > 0, broke = list(item.rules).length > 0;
  return held && broke ? "held and broke a rule" : held ? "held" : broke ? "broke a rule" : "other";
}

function reasonRows(items) {
  const tally = (rows) => ({ rows: rows.length, ready: rows.filter((item) => item.ready === true).length,
    adding: rows.filter((item) => item.will_add === true).length });
  const rows = REASONS.map((reason) => ({ reason, ...tally(items.filter((item) => reasonOf(item) === reason)) })).filter((row) => row.rows > 0);
  return { rows, total: { reason: "all", ...tally(items) } };
}
const reasonCells = (row) => [row.reason, row.rows, row.ready, row.rows - row.ready, row.adding, pct(row.rows ? row.ready / row.rows : null)];
const REASON_COLUMNS = ["Reason", "Rows", "Ready", "Incomplete", "In next Add", "Ready share"];

function reasonsPanel(h, ctx, api) {
  if (!dataOf(ctx).read) return notRead(h);
  const shownOnly = api.state.shownOnly === true;
  const { rows, total } = reasonRows(shownOnly ? shownOf(ctx) : itemsOf(ctx));
  const shown = shownOf(ctx);
  const firstIncomplete = (reason) => shown.find((item) => reasonOf(item) === reason && item.ready !== true) || null;
  const markdown = () => [`Review queue progress by reason (${shownOnly ? "shown rows" : "whole queue"}; counts only)`, "",
    formatMarkdownTable(REASON_COLUMNS, [...rows, total].map(reasonCells)), ""].join("\n");
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("button", { class: "btn sm ghost", "data-action": "reason-scope", "aria-pressed": shownOnly ? "true" : "false",
        onclick: () => { api.state.shownOnly = !shownOnly; api.redraw(); } }, shownOnly ? "Counting shown rows" : "Counting the whole queue"),
      h("button", { class: "btn sm ghost", "data-action": "reason-copy", onclick: () => { api.copy(markdown()); api.toast("Copied the reason table (counts only)."); } }, "Copy as Markdown")),
    rows.length ? h("table", { class: "table", "data-table": "reasons" },
      h("thead", {}, h("tr", {}, REASON_COLUMNS.map((name) => h("th", {}, name)), h("th", {}, ""))),
      h("tbody", {}, [...rows, total].map((row) => {
        const target = row.reason === "all" ? null : firstIncomplete(row.reason);
        return h("tr", { "data-reason": row.reason }, reasonCells(row).map((cell, index) => h("td", index ? { class: "num" } : {}, String(cell))),
          h("td", {}, target ? h("button", { class: "btn sm ghost", "data-go-reason": row.reason, disabled: dataOf(ctx).busy === true,
            onclick: () => attempt(api, () => ctx.actions.goTo(target.line)) }, `First incomplete: line ${target.line}`) : ""));
      }))) : h("p", { class: "faint" }, "No rows to count."));
}

// ---------- questions ----------

const KINDS = [["all", "All rows"], ["review", "Review rows"], ["audit", "Audit rows"]];

function questionRows(ctx, kind) {
  const items = itemsOf(ctx).filter((item) => kind === "all" || item.kind === kind);
  return questionsOf(ctx).map((question, order) => {
    const labeled = items.filter((item) => isObject(item.labels) && has(item.labels[question.id])).length;
    return { id: question.id, order, gated: question.gated === true, threshold: question.threshold, rows: items.length, labeled, missing: items.length - labeled,
      yours: items.filter((item) => ownLabel(item, question.id)).length, suggested: items.filter((item) => suggestedLabel(item, question.id)).length };
  });
}

function questionsPanel(h, ctx, api) {
  if (!dataOf(ctx).read) return notRead(h);
  const kind = KINDS.some(([key]) => key === api.state.kind) ? api.state.kind : "all";
  let rows = questionRows(ctx, kind);
  if (api.state.gatedOnly) rows = rows.filter((row) => row.gated);
  if (api.state.missingFirst) rows = rows.slice().sort((a, b) => b.missing - a.missing || a.order - b.order);
  const shown = shownOf(ctx);
  const firstMissing = (qid) => shown.find((item) => isObject(item.labels) && !has(item.labels[qid])) || null;
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Rows ", h("select", { "data-action": "question-kind", onchange: (event) => { api.state.kind = event.target.value; api.redraw(); } },
        KINDS.map(([key, label]) => h("option", { value: key, selected: key === kind }, label)))),
      toggle(h, api, "gatedOnly", "Gated questions only", "gated-only"),
      toggle(h, api, "missingFirst", "Most missing first", "missing-first")),
    rows.length ? h("table", { class: "table", "data-table": "questions" },
      h("thead", {}, h("tr", {}, ["Question", "Gate", "Labeled", "Missing", "By you", "Gate suggestion", "Labeled share", ""].map((name) => h("th", {}, name)))),
      h("tbody", {}, rows.map((row) => {
        const target = firstMissing(row.id);
        return h("tr", { "data-question": row.id },
          h("td", { class: "mono" }, row.id), h("td", {}, !row.gated ? "not gated" : typeof row.threshold === "number" ? `≥ ${row.threshold}` : "gated"),
          [row.labeled, row.missing, row.yours, row.suggested].map((value) => h("td", { class: "num" }, String(value))),
          h("td", { class: "num" }, pct(row.rows ? row.labeled / row.rows : null)),
          h("td", {}, target ? h("button", { class: "btn sm ghost", "data-go-question": row.id, disabled: dataOf(ctx).busy === true,
            onclick: () => attempt(api, () => ctx.actions.goTo(target.line)) }, `First shown without it: line ${target.line}`) : ""));
      }))) : h("p", { class: "faint" }, "No questions to count."),
    h("p", { class: "faint" }, "“By you” counts labels you set in this session; “Gate suggestion” counts review rows still on the gate's starting answer."));
}

// ---------- audit tracker ----------

// The worst-case (50%) half-width of a 95% normal-approximation interval over n rows: 1.96 · √(0.25 / n) = 0.98 / √n.
const HALF_Z = 0.98;
const worstMargin = (n) => (Number.isInteger(n) && n > 0 ? HALF_Z / Math.sqrt(n) : null);
const rowsForMargin = (margin) => Math.ceil((HALF_Z / margin) ** 2 - 1e-9);
const points = (margin) => (margin === null ? "—" : `±${(margin * 100).toFixed(1)} points`);
const TARGETS = [5, 10, 15, 20];
const anyLabel = (item) => isObject(item.labels) && Object.values(item.labels).some(has);
const auditStatus = (item) => (item.ready === true ? "labeled" : anyLabel(item) ? "partly labeled" : "not started");
const sliceFieldOf = (ctx, state) => {
  const fields = list(dataOf(ctx).slice_fields).map((field) => field?.name).filter((name) => typeof name === "string" && name);
  return fields.includes(state.slice) ? state.slice : fields.includes(dataOf(ctx).filters?.slice_field) ? dataOf(ctx).filters.slice_field : fields[0] || "";
};

function auditPanel(h, ctx, api) {
  if (!dataOf(ctx).read) return notRead(h);
  const audits = itemsOf(ctx).filter((item) => item.kind === "audit");
  const asked = dataOf(ctx).audit_requested;
  if (!audits.length) return h("p", { class: "faint" }, `The queue holds no audit rows${Number.isInteger(asked) ? ` (asked for ${asked})` : ""}.`);
  const labeled = audits.filter((item) => item.ready === true).length;
  const partly = audits.filter((item) => auditStatus(item) === "partly labeled").length;
  const target = TARGETS.includes(Number(api.state.target)) ? Number(api.state.target) : 10;
  const needed = rowsForMargin(target / 100);
  const field = sliceFieldOf(ctx, api.state);
  const fields = list(dataOf(ctx).slice_fields).map((entry) => entry?.name).filter((name) => typeof name === "string" && name);
  const slices = new Map();
  if (field) {
    for (const item of audits) {
      const value = item.slice_values?.[field];
      if (typeof value !== "string") continue;
      const entry = slices.get(value) || { rows: 0, labeled: 0 };
      entry.rows++;
      if (item.ready === true) entry.labeled++;
      slices.set(value, entry);
    }
  }
  const count = (name, label, value) => h("li", { "data-count": name }, `${label}: `, h("strong", {}, String(value)));
  return h("div", {},
    h("ul", { "data-list": "audit-counts" },
      count("asked", "Asked for", Number.isInteger(asked) ? asked : "—"), count("queued", "Queued", audits.length),
      count("labeled", "Labeled", labeled), count("partly", "Partly labeled", partly), count("not-started", "Not started", audits.length - labeled - partly)),
    h("p", { "data-margin": "so-far" }, `Worst-case 95% margin of the ${plural(labeled, "labeled audit row")} so far: ${points(worstMargin(labeled))}`),
    h("p", { "data-margin": "sample" }, `Once all ${plural(audits.length, "audit row")} are labeled: ${points(worstMargin(audits.length))}`),
    h("div", { class: "chips lab-row" },
      h("label", {}, "Margin you want ", h("select", { "data-action": "audit-target", onchange: (event) => { api.state.target = Number(event.target.value); api.redraw(); } },
        TARGETS.map((value) => h("option", { value, selected: value === target }, `±${value} points`))))),
    h("p", { "data-target": String(target) }, `±${target} points needs ${plural(needed, "labeled audit row")}; ${Math.max(0, needed - labeled)} still to label.`,
      needed > audits.length ? ` The sample holds only ${audits.length}: read the decisions again with a larger audit sample.` : ""),
    h("ul", { "data-list": "audit-rows" }, audits.map((item) => h("li", { "data-row": item.line },
      `Line ${item.line}: ${auditStatus(item)}`, item.ready === true ? "" : ` (blind; to label: ${list(item.missing).join(", ") || "—"})`, " ",
      goButton(h, ctx, api, item.line, "Go")))),
    field ? h("div", {},
      h("div", { class: "chips lab-row" },
        h("label", {}, "By input slice ", h("select", { "data-action": "audit-slice", onchange: (event) => { api.state.slice = event.target.value; api.redraw(); } },
          fields.map((name) => h("option", { value: name, selected: name === field }, name))))),
      h("table", { class: "table", "data-table": "audit-slices" },
        h("thead", {}, h("tr", {}, ["Value", "Audit rows", "Labeled", "Worst-case margin so far"].map((name) => h("th", {}, name)))),
        h("tbody", {}, [...slices].sort((a, b) => compareText(a[0], b[0])).map(([value, entry]) => h("tr", { "data-slice": value },
          h("td", {}, short(value)), h("td", { class: "num" }, String(entry.rows)), h("td", { class: "num" }, String(entry.labeled)),
          h("td", { class: "num" }, points(worstMargin(entry.labeled)))))))) : "",
    h("p", { class: "faint" }, "Counts and planning margins only (worst case at 50%, normal approximation): no answers, shortlists or agreement. The audit report after Add measures the gate."));
}

// ---------- your labels ----------

const DOMINANT_SHARE = 0.8, DOMINANT_MIN = 5;

function labelCounts(ctx, question) {
  const items = itemsOf(ctx);
  const options = list(question.options).map((option) => ({ value: option.value, text: String(option.text), review: 0, audit: 0, suggested: 0 }));
  const find = (value) => options.find((option) => option.value === value);
  let other = 0, none = 0;
  for (const item of items) {
    if (ownLabel(item, question.id)) {
      const option = find(item.labels[question.id]);
      if (option) option[item.kind === "audit" ? "audit" : "review"]++;
      else other++;
    } else {
      none++;
      if (suggestedLabel(item, question.id)) {
        const option = find(item.labels[question.id]);
        if (option) option.suggested++;
      }
    }
  }
  const total = options.reduce((sum, option) => sum + option.review + option.audit, 0);
  return { options, total, other, none };
}

function labelsPanel(h, ctx, api) {
  if (!dataOf(ctx).read) return notRead(h);
  const questions = questionsOf(ctx).filter((question) => list(question.options).length > 0);
  if (!questions.length) return h("p", { class: "faint" }, "No question with options to count.");
  const question = questions.find((entry) => entry.id === api.state.question) || questions[0];
  const { options, total, other, none } = labelCounts(ctx, question);
  const withSuggestions = api.state.suggestions === true;
  const columns = ["Option", "Your labels", "Share", "On review rows", "On audit rows", ...(withSuggestions ? ["Gate suggestion (untouched)"] : [])];
  const cells = (option) => [option.text, option.review + option.audit, pct(total ? (option.review + option.audit) / total : null), option.review, option.audit,
    ...(withSuggestions ? [option.suggested] : [])];
  const top = options.reduce((best, option) => (option.review + option.audit > (best ? best.review + best.audit : -1) ? option : best), null);
  const dominant = total >= DOMINANT_MIN && top && (top.review + top.audit) / total >= DOMINANT_SHARE;
  const markdown = () => [`Your labels for ${question.id} in the Review queue (counts only; no inputs${withSuggestions
    ? "; the last column counts the gate's untouched suggestions on review rows" : " or answers"})`, "",
    formatMarkdownTable(columns, options.map(cells)), "", `Rows without a label of yours: ${none}`, ""].join("\n");
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Question ", h("select", { "data-action": "label-question", onchange: (event) => { api.state.question = event.target.value; api.redraw(); } },
        questions.map((entry) => h("option", { value: entry.id, selected: entry.id === question.id }, entry.id)))),
      toggle(h, api, "suggestions", "Show untouched gate suggestions", "label-suggestions"),
      h("button", { class: "btn sm ghost", "data-action": "label-copy", onclick: () => { api.copy(markdown()); api.toast(`Copied your label counts for ${question.id}.`); } }, "Copy as Markdown")),
    h("table", { class: "table", "data-table": "labels" },
      h("thead", {}, h("tr", {}, columns.map((name) => h("th", {}, name)))),
      h("tbody", {}, options.map((option) => h("tr", { "data-option": option.text },
        cells(option).map((cell, index) => h("td", index ? { class: "num" } : { class: "mono" }, String(cell))))))),
    h("p", { "data-note": "totals" }, `${plural(total, "label")} of yours; ${plural(none, "row")} without one${other ? `; ${other} outside the options` : ""}.`),
    dominant ? h("p", { "data-note": "dominant", role: "status" }, `“${top.text}” is ${pct((top.review + top.audit) / total)} of your ${total} labels for ${question.id}. Make sure the other options get a fair look.`) : "",
    h("p", { class: "faint" }, "Only labels you set in this session count; the gate's suggestions are a separate column when you ask for them."));
}

// ---------- identical inputs ----------

const textKey = (item) => (isObject(item.row) && typeof item.row.text === "string" ? `text:${item.row.text}` : null);

function copyGroups(ctx, textOnly) {
  const groups = new Map();
  for (const item of itemsOf(ctx)) {
    const key = textOnly ? textKey(item) : typeof item.identity === "string" ? item.identity : null;
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].filter((rows) => rows.length > 1);
}
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A group holding a blind audit copy: the gate's answers on the other copies, and the suggestions copied from them, would
// hint at the blind row's answer, so both stay hidden and only labels people set are compared.
const blindGroup = (rows) => rows.some((item) => item.revealed !== true);
const visibleLabel = (item, qid, blind) => isObject(item.labels) && has(item.labels[qid]) && !(blind && suggestedLabel(item, qid));
function differing(rows, qid) {
  const blind = blindGroup(rows);
  const values = rows.filter((item) => visibleLabel(item, qid, blind)).map((item) => item.labels[qid]);
  return values.some((value) => !sameValue(value, values[0]));
}
function copyCell(question, item, blind) {
  if (blind && suggestedLabel(item, question.id)) return "gate suggestion hidden";
  return `${labelText(question, item.labels?.[question.id])}${suggestedLabel(item, question.id) ? " (gate)" : ownLabel(item, question.id) ? " (you)" : ""}`;
}

function copiesPanel(h, ctx, api) {
  if (!dataOf(ctx).read) return notRead(h);
  const questions = questionsOf(ctx);
  const textOnly = api.state.textOnly === true;
  let groups = copyGroups(ctx, textOnly);
  const total = groups.length;
  if (api.state.differOnly) groups = groups.filter((rows) => questions.some((question) => differing(rows, question.id)));
  const showAnswers = api.state.answers === true;
  const controls = h("div", { class: "chips lab-row" },
    toggle(h, api, "textOnly", "Match by text alone", "copies-text-only"),
    toggle(h, api, "differOnly", "Only copies whose labels differ", "copies-differ-only"),
    toggle(h, api, "answers", "Show the gate's answers", "copies-answers"));
  if (!groups.length) {
    return h("div", {}, controls, h("p", { class: "faint" }, total ? "No group of copies has labels that differ."
      : textOnly ? "No input text is queued more than once." : "No input is queued more than once."));
  }
  return h("div", {}, controls,
    h("p", { "data-note": "groups" }, `${plural(groups.length, "input")} queued more than once${groups.length === total ? "" : ` (of ${total})`}.`),
    groups.map((rows, index) => {
      const blind = blindGroup(rows);
      return h("div", { "data-group": index + 1 },
        h("p", {}, h("strong", {}, `${rows.length} copies: `), short(rowText(rows[0].row)), ` (lines ${rows.map((item) => item.line).join(", ")})`),
        h("table", { class: "table", "data-table": "copies" },
          h("thead", {}, h("tr", {}, h("th", {}, "Line"), h("th", {}, "Kind"),
            questions.map((question) => h("th", { "data-question": question.id, "data-differs": differing(rows, question.id) ? "yes" : "no" },
              question.id, differing(rows, question.id) ? " (differs)" : "")),
            showAnswers ? h("th", {}, "Gate's answers") : "", h("th", {}, ""))),
          h("tbody", {}, rows.map((item) => h("tr", { "data-line": item.line },
            h("td", { class: "num" }, String(item.line)), h("td", {}, item.kind),
            questions.map((question) => h("td", { "data-cell": question.id }, copyCell(question, item, blind))),
            showAnswers ? h("td", { "data-answers": item.line }, blind ? "hidden while a copy is a blind audit row"
              : questions.filter((question) => isObject(item.answers) && Object.hasOwn(item.answers, question.id))
                .map((question) => `${question.id} ${labelText(question, item.answers[question.id])}`).join(", ") || "—") : "",
            h("td", {}, goButton(h, ctx, api, item.line, "Go")))))));
    }),
    h("p", { class: "faint" }, "“(you)” marks your labels and “(gate)” the gate's untouched suggestions. While one copy is a blind audit row, the gate's answers and suggestions stay hidden on every copy."));
}

// ---------- metrics ----------

const readItems = (ctx) => (dataOf(ctx).read ? itemsOf(ctx) : null);

export default definePack({
  id: "review-panels",
  surface: "workbench.review.queue",
  title: "Review queue panels",
  about: "Panels for a check's Review queue: progress by reason and by question, an audit sample tracker with the worst-case margin the labeled audit rows give so far, the distribution of your own labels, and identical inputs side by side, plus progress metrics. Blind audit rows stay blind (no answers, shortlists or agreement), panels change presentation only, and copies hold counts only.",
  features: [
    { id: "reasons", kind: "panel", title: "Progress by reason", render: reasonsPanel, improvements: [
      { id: "table", title: "Count ready, incomplete and next-Add rows for each reason a row is queued" },
      { id: "scope", title: "Switch the reason table between the whole queue and the shown rows" },
      { id: "go_incomplete", title: "Go to the first shown incomplete row of a reason" },
      { id: "copy", title: "Copy the reason table as Markdown (counts only)" },
    ] },
    { id: "questions", kind: "panel", title: "Progress by question", render: questionsPanel, improvements: [
      { id: "table", title: "Count labeled and missing rows per question, split into your labels and the gate's suggestions" },
      { id: "kind", title: "Count the question table over all, review or audit rows" },
      { id: "gated_only", title: "Show only the gated questions in the question table" },
      { id: "missing_first", title: "Order the question table by most labels missing" },
      { id: "go_missing", title: "Go to the first shown row missing a question's label" },
    ] },
    { id: "audit", kind: "panel", title: "Audit sample tracker", render: auditPanel, improvements: [
      { id: "counts", title: "Count the audit sample: asked, queued, labeled, partly labeled and not started" },
      { id: "margin", title: "Show the worst-case 95% margin of the audit rows labeled so far beside the whole sample's" },
      { id: "target", title: "Count the labeled audit rows a margin you choose needs, and how many are left" },
      { id: "rows", title: "List the audit rows by labeling status, never with their answers" },
      { id: "go", title: "Go to an audit row from the tracker" },
      { id: "slices", title: "Count labeled audit rows and their worst-case margin per input-slice value" },
    ] },
    { id: "labels", kind: "panel", title: "Your label distribution", render: labelsPanel, improvements: [
      { id: "table", title: "Count your own labels for each option of a question" },
      { id: "shares", title: "Show each option's share of your labels" },
      { id: "kinds", title: "Split your label counts into review and audit rows" },
      { id: "suggestions", title: "Show the gate's untouched suggestions beside your label counts" },
      { id: "dominant", title: "Point out one option holding 80% or more of your labels" },
      { id: "copy", title: "Copy your label counts as Markdown (counts only)" },
    ] },
    { id: "copies", kind: "panel", title: "Identical inputs side by side", render: copiesPanel, improvements: [
      { id: "groups", title: "List the inputs queued more than once with their lines" },
      { id: "labels", title: "Compare the copies' labels question by question, marking yours and the gate's" },
      { id: "differs", title: "Mark the questions where copies carry different labels" },
      { id: "differ_only", title: "Show only copies whose labels differ" },
      { id: "answers", title: "Show the gate's answers on copies, hidden with its suggestions while any copy is a blind audit row" },
      { id: "text_only", title: "Match copies by input text alone" },
      { id: "go", title: "Go to a copy from the comparison" },
    ] },

    { id: "gated_by_you", kind: "metric", format: "percent", label: "Gated labels set by you",
      help: "Share of the queue's gated labels that you set in this session rather than the gate's untouched suggestions.",
      compute: (ctx) => {
        const items = readItems(ctx);
        if (!items) return null;
        const gated = gatedOf(ctx);
        let set = 0, yours = 0;
        for (const item of items) {
          for (const qid of gated) {
            if (!isObject(item.labels) || !has(item.labels[qid])) continue;
            set++;
            if (ownLabel(item, qid)) yours++;
          }
        }
        return set ? { value: yours / set, detail: `${yours} of ${plural(set, "gated label")}` } : null;
      } },
    { id: "room_unfilled", kind: "metric", format: "integer", label: "Ready rows still needed to fill the room",
      help: "Room the dataset has left minus the rows ready now.",
      compute: (ctx) => {
        const data = dataOf(ctx);
        if (!data.read || !Number.isInteger(data.room) || !Number.isInteger(data.ready)) return null;
        return { value: Math.max(0, data.room - data.ready), detail: `room ${data.room}, ${data.ready} ready` };
      } },
    { id: "started_unfinished", kind: "metric", format: "integer", label: "Rows you started but have not finished",
      help: "Rows where you set or changed a label in this session but a gated question is still blank.",
      compute: (ctx) => {
        const items = readItems(ctx);
        if (!items) return null;
        const rows = items.filter((item) => list(item.edited).length > 0 && item.ready !== true);
        return { value: rows.length, detail: rows.length ? `lines ${rows.map((item) => item.line).join(", ")}` : "" };
      } },
    { id: "distinct_inputs", kind: "metric", format: "integer", label: "Distinct inputs in the queue",
      help: "Rows counted once per identical input (the identity Review and dataset health use).",
      compute: (ctx) => {
        const items = readItems(ctx);
        if (!items || !items.length) return null;
        const distinct = new Set(items.map((item) => item.identity)).size;
        return { value: distinct, detail: `${plural(items.length, "row")}` };
      } },
  ],
});
