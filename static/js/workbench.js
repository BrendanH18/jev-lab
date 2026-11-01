import {
  $, $$, answerCard, api, callStats, copyText, currentStatus, debounce, h, handleError, icon, initChrome, inspect, mount, ms, num,
  money, pct, photoView, prepareImage, stat, statusBadge, toast, usd,
} from "./common.js";

const W = {
  tab: "build", stateText: "", questions: [], raw: false, result: null, exported: null, exportTab: "python",
  items: [], examples: [], runResults: null, saveOpen: false, expect: {}, saveName: "", saveNotes: "", editingId: null,
  bulk: { rowsText: "", result: null, sortKey: null, sortDir: -1, source: "current", sampleQuestions: null, labels: {},
    // Saved datasets (data/workbench/datasets/): rows and labels only, never answers. savedText is the rows box as
    // last saved or loaded; runText is the box as last run, so typed labels merge back only into the rows they belong to.
    datasets: [], dataset: { id: null, name: "", notes: "", withQuestions: true, questions: null },
    savedText: "", runText: null, labelsDirty: false,
    // ranQuestions: the questions the last Bulk run asked, so a check is saved only for the questions it reruns.
    // checkForm: Policy's "Save as a check" targets as typed (percent strings; null takes a default from the run).
    // checkRuns: per dataset id, a check run in flight or its report (jev/checks.py), and the model typed to ask instead.
    ranQuestions: null, checkForm: { accuracy: null, coverage: null }, checkRuns: {},
    // CSV import (jev/csvimport.py): the file or pasted text, the column uses chosen so far, and the server's report.
    // pending: a newer conversion is on its way; qkey: the questions the report was checked against.
    csv: { open: false, text: "", file: "", columns: {}, report: null, error: null, seq: 0, pending: false, qkey: null },
    // Prices as typed (strings), shared by Calibrate, Policy, and Holdout. jev/cost.py does the arithmetic.
    costs: { review: "2", error: "20", mistakes: [] },
    cal: { qid: null, signal: "confidence", bound: "estimate", threshold: 0.5, report: null, cost: null, holdout: null, holdoutSeq: 0 },
    policy: { signal: "confidence", bound: "estimate", gates: {}, report: null, tunes: null, cost: null, cheapest: null, holdout: null, holdoutSeq: 0 },
    review: { report: null, kept: new Set(), all: { suspects: false, next: false } },
    // Accuracy by slice (jev/slices.py), for Calibrate at its threshold and for Policy at its gates. One field for both.
    slice: { field: null, cal: null, pol: null } },
  compare: { variants: [{ text: "", model: "" }, { text: "", model: "" }], terse: null, models: null, modelsLoading: false,
    running: false, result: null, qid: null, signal: "confidence", bound: "estimate", report: null, reportError: null, first: "A", cascadeT: 0.5 },
  loadedExample: null, images: [], samples: [], maxImages: 4,
};
const TYPES = ["noul", "choice", "score", "box"];
const TABS = [["build", "Build"], ["tests", "Tests"], ["bulk", "Bulk"], ["compare", "Compare"], ["examples", "Examples"]];

// ---------- data helpers ----------
const parseMaybeJson = (s) => {
  if (typeof s !== "string") return s;
  const t = s.trim();
  if (/^[\[{]/.test(t)) { try { return JSON.parse(t); } catch { /* keep as text */ } }
  return s;
};
const stringify = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const parseState = (text) => parseMaybeJson(text);

function toQuestions(rows) {
  const out = {};
  for (const r of rows) {
    const id = (r.id || "").trim();
    if (!id) continue;
    const q = { type: r.type, instructions: parseMaybeJson(r.instructions || "") };
    if (r.type === "box") {
      // A Box takes no criteria: its answer is always four edges.
    } else if (r.type === "choice") {
      q.criteria = Object.fromEntries(r.choice.filter(([k]) => k.trim()).map(([k, d]) => [k.trim(), d.trim() ? parseMaybeJson(d) : null]));
    } else if (r.type === "score") {
      q.criteria = r.score.filter((s) => s.trim()).map(parseMaybeJson);
    } else if ((r.noulYes || "").trim() || (r.noulNo || "").trim()) {
      q.criteria = { true: (r.noulYes || "").trim() ? parseMaybeJson(r.noulYes) : null, false: (r.noulNo || "").trim() ? parseMaybeJson(r.noulNo) : null };
    }
    out[id] = q;
  }
  return out;
}

function fromQuestions(obj) {
  return Object.entries(obj || {}).map(([id, q]) => ({
    id, type: q.type, instructions: stringify(q.instructions),
    choice: q.type === "choice" ? Object.entries(q.criteria || {}).map(([k, d]) => [k, stringify(d)]) : [["", ""], ["", ""]],
    score: q.type === "score" ? (q.criteria || []).map(stringify) : ["", "", ""],
    noulYes: q.type === "noul" ? stringify(q.criteria?.true) : "", noulNo: q.type === "noul" ? stringify(q.criteria?.false) : "",
  }));
}

const blankRow = (type) => ({
  id: `${type}_${W.questions.length + 1}`, type, instructions: "",
  choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "",
});

function defaultExpect(answer) {
  if (answer.type === "choice") return { choice: answer.choice };
  if (answer.type === "box") {
    return { box: Object.fromEntries(["left", "top", "right", "bottom"].map((k) => [k, +answer.box[k].toFixed(3)])), iou_min: 0.5 };
  }
  if (answer.type === "score") return { min: Math.max(0, +(answer.score - 0.5).toFixed(2)), max: +(answer.score + 0.5).toFixed(2) };
  return answer.noul >= 0.5 ? { min: 0.5 } : { max: 0.5 };
}

// ---------- images ----------
// Each picture has a reference string; the API swaps the picture in wherever the reference appears.
function newRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `photo-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
const sampleUrl = (name) => `/img/samples/${name}.png`;

function imagesFromSpecs(specs) {
  return Object.entries(specs || {}).map(([ref, spec]) => spec.sample
    ? { ref, sample: spec.sample, url: sampleUrl(spec.sample), about: W.samples.find((x) => x.name === spec.sample)?.about }
    : { ref, format: spec.format, data_base64: spec.data_base64, url: `data:image/${spec.format === "png" ? "png" : "jpeg"};base64,${spec.data_base64}` });
}
const imagesPayload = () => Object.fromEntries(W.images.map((i) => [i.ref, i.sample ? { sample: i.sample } : { format: i.format, data_base64: i.data_base64 }]));
const imageNames = () => Object.fromEntries(W.images.map((i) => [i.ref, i.sample ? { sample: i.sample } : { format: i.format }]));

// Put a new picture somewhere a question can point at it: a `photo` field in an object state.
function placeInState(ref) {
  const state = parseState(W.stateText);
  const isObject = state && typeof state === "object" && !Array.isArray(state);
  if (Array.isArray(state)) return "Put its reference in the state or a question.";
  const obj = isObject ? state : (String(state || "").trim() ? { text: state } : {});
  let key = "photo";
  for (let n = 2; key in obj; n++) key = `photo_${n}`;
  obj[key] = ref;
  W.stateText = JSON.stringify(obj, null, 2);
  return isObject || !String(state || "").trim() ? `Added \`${key}\` to the state.` : `Moved the text into \`text\` and added \`${key}\`.`;
}

function addImage(img) {
  if (W.images.length >= W.maxImages) return toast(`At most ${W.maxImages} images per request.`, "error");
  const ref = newRef();
  W.images.push({ ...img, ref });
  toast(placeInState(ref));
  W.result = null;
  render();
}

function removeImage(ref) {
  W.images = W.images.filter((i) => i.ref !== ref);
  const state = parseState(W.stateText);
  if (state && typeof state === "object" && !Array.isArray(state)) {
    for (const [k, v] of Object.entries(state)) if (v === ref) delete state[k];
    W.stateText = JSON.stringify(state, null, 2);
  }
  W.result = null;
  render();
}

// Follow a backticked state path such as `photo`, `after.photo` or `frames[2].frame`.
function lookup(state, path) {
  if (state && typeof state === "object" && Object.hasOwn(state, path)) return state[path]; // a key with dots
  let node = state;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

// Which picture a Box question points at: one named by reference or by a backticked state path.
// With several pictures and no match, return null rather than draw the box on a guessed picture.
function imageFor(question, state, images) {
  const text = typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
  const byRef = images.find((i) => text.includes(i.ref));
  if (byRef) return byRef;
  for (const [, path] of text.matchAll(/`([^`]+)`/g)) {
    const value = lookup(state, path.trim());
    const img = images.find((i) => i.ref === value);
    if (img) return img;
  }
  return images.length === 1 ? images[0] : null;
}

function loadInto(state, questions, { expect = {}, name = "", notes = "", id = null, example = null, images = {} } = {}) {
  W.stateText = typeof state === "string" ? state : JSON.stringify(state, null, 2);
  W.questions = fromQuestions(questions);
  W.images = imagesFromSpecs(images);
  W.expect = expect || {};
  W.saveName = name;
  W.saveNotes = notes;
  W.editingId = id;
  W.loadedExample = example;
  W.result = null;
  W.exported = null;
  W.saveOpen = false;
  W.raw = false;
  W.tab = "build";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- boot ----------
async function boot() {
  await initChrome("/workbench");
  const [ex, items, sample, pics, sets] = await Promise.all([api("/api/workbench/examples"), api("/api/workbench/items"),
    api("/api/workbench/bulk/sample"), api("/api/images/samples"), api("/api/workbench/datasets")]);
  W.samples = pics.samples;
  W.maxImages = pics.limits.max_images;
  W.examples = ex.examples;
  W.items = items.items;
  W.bulk.rowsText = W.bulk.savedText = rowsText(sample.rows);
  W.bulk.datasets = sets.datasets;
  window.addEventListener("beforeunload", (e) => { if (bulkUnsaved()) { e.preventDefault(); e.returnValue = ""; } });
  W.bulk.sampleQuestions = sample.questions;
  W.compare.terse = sample.terse_questions;
  W.compare.variants[0].text = JSON.stringify(sample.questions, null, 2);
  W.compare.variants[1].text = JSON.stringify(sample.terse_questions, null, 2);
  const first = W.examples[0];
  loadInto(first.state, first.questions, { expect: first.expect, example: first.id, images: first.images });
  const hash = location.hash.replace("#", "");
  if (TABS.some(([k]) => k === hash)) { W.tab = hash; render(); }
}

// ---------- render ----------
function render() {
  let view;
  switch (W.tab) {
    case "tests": view = renderTests(); break;
    case "bulk": view = renderBulk(); break;
    case "compare": view = renderCompare(); break;
    case "examples": view = renderExamples(); break;
    default:
      W.tab = "build";
      view = renderBuild();
  }
  mount("#tabs", TABS.map(([k, label]) => h("button", { class: `tab${W.tab === k ? " active" : ""}`, onclick: () => { W.tab = k; location.hash = k; render(); } },
    label, k === "tests" && W.items.length ? ` (${W.items.length})` : "")));
  mount("#view", view);
  if (W.tab === "bulk") { updateCal(); updatePolicy(); }
  if (W.tab === "compare") { updateCmpChart(); updateCascade(); }
}

// ---------- Build ----------
function renderBuild() {
  const stateArea = h("textarea", { class: "input", spellcheck: "false", placeholder: "Plain text, or a JSON object/array. Point questions at fields with `backticks`." }, W.stateText);
  stateArea.addEventListener("input", () => { W.stateText = stateArea.value; });
  const left = h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "State"), h("div", { class: "spacer" }),
        h("span", { class: "faint", style: { fontSize: "12px" } }, W.loadedExample ? `from example: ${W.loadedExample}` : W.editingId ? `editing test: ${W.editingId}` : "")),
      h("div", { class: "panel-body state-box" }, stateArea)),
    renderImages(),
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, `Questions · ${W.questions.length}`), h("div", { class: "spacer" }),
        h("button", { class: `btn sm ${W.raw ? "" : "ghost"}`, onclick: () => { W.raw = !W.raw; render(); } }, icon("code"), W.raw ? "Editor" : "Raw JSON")),
      h("div", { class: "panel-body grid", style: { gap: "10px" } },
        W.raw ? renderRaw() : h("div", { class: "qlist" }, W.questions.map((row, i) => renderQuestionCard(row, i))),
        !W.raw ? h("div", { class: "chips" }, TYPES.map((t) =>
          h("button", { class: "chip", onclick: () => { W.questions.push(blankRow(t)); render(); } }, icon("plus"), `Add ${t}`))) : null)));

  const runBtn = h("button", { class: "btn primary", onclick: run }, icon("bolt"), "Run");
  const right = h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Answers"), h("div", { class: "spacer" }),
        h("button", { class: "btn sm", onclick: exportCode }, icon("code"), "Export code"),
        h("button", { class: "btn sm", disabled: !W.result, onclick: () => { W.saveOpen = !W.saveOpen; if (W.saveOpen && !Object.keys(W.expect).length) W.expect = Object.fromEntries(Object.entries(W.result.answers).map(([k, a]) => [k, defaultExpect(a)])); render(); } }, icon("save"), "Save as test"),
        runBtn),
      boxWarning(),
      W.result
        ? h("div", { class: "panel-body grid", style: { gap: "12px" } },
          callStats(W.result.meta, () => inspect(W.result.trace, "Workbench · one Jev request")),
          renderBoxes(),
          h("div", { class: "answers" }, Object.entries(W.result.answers).map(([qid, a]) => answerCard(qid, a, W.result.trace.request.questions[qid]))))
        : h("div", { class: "empty" }, "Press Run. Every question is evaluated in parallel against the state, in one request.")),
    W.saveOpen && W.result ? renderSaveForm() : null,
    W.exported ? renderExport() : null,
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Writing good questions")),
      h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
        h("p", { class: "muted" }, "One judgment per question. If you would need a paragraph to explain the answer, split it."),
        h("p", { class: "muted" }, "Say exactly what a yes means and what it does not mean; Jev reads instructions literally."),
        h("p", { class: "muted" }, "Keep math, dates, counting, and exact lookups in code. Ask Jev to pick from options, not to generate values."),
        h("p", { class: "muted" }, "Include a “none of these” option when nothing may fit, and read confidence before acting."),
        h("p", { class: "muted" }, "A Box always returns four edges, even when the target is missing. Ask a Noul whether it is there, and ignore the box when that is low."),
        h("p", { class: "faint" }, "Docs: ", h("a", { href: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one", target: "_blank", rel: "noopener" }, "How to build with TypeSafe"), " · ", h("a", { href: "https://docs.typesafe.ai/model-jaggedness/jev-1.13", target: "_blank", rel: "noopener" }, "Known jagged edges")))));
  return h("div", { class: "grid wb-grid" }, left, right);
}

function renderImages() {
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/*", class: "hidden" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const img = await prepareImage(f);
      addImage({ format: img.format, data_base64: img.data_base64, url: img.url, name: img.name });
    } catch (e) { toast(e.message || "Could not read that image.", "error"); }
  });
  const full = W.images.length >= W.maxImages;
  return h("div", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, `Images · ${W.images.length}`),
      h("span", { class: "dreamer", title: "TypeSafe marks images and Box as dreamer-ready: for prototypes, and subject to change" }, "Dreamer-ready"),
      h("div", { class: "spacer" }),
      h("button", { class: "btn sm", disabled: full, onclick: () => file.click() }, icon("upload"), "Upload"), file),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      W.images.length ? h("div", { class: "img-list" }, W.images.map((img) => h("div", { class: "img-row" },
        photoView(img.url, [], { alt: img.about || img.name || "Image" }),
        h("div", { class: "grid", style: { gap: "4px", minWidth: 0 } },
          h("button", { class: "ref mono", title: "Copy the reference", onclick: () => copyText(img.ref) }, img.ref, icon("copy")),
          h("span", { class: "faint", style: { fontSize: "11.5px" } }, img.sample ? `Sample drawing: ${img.about || img.sample}` : `${img.name || "Upload"} · JPEG`)),
        h("button", { class: "btn sm ghost", title: "Remove image", "aria-label": "Remove image", onclick: () => removeImage(img.ref) }, icon("trash"))))) : null,
      h("div", { class: "thumbs" }, W.samples.map((sm) => h("button", {
        class: "thumb", title: `Add sample: ${sm.about}`, "aria-label": `Add sample: ${sm.about}`, disabled: full,
        onclick: () => addImage({ sample: sm.name, url: sm.url, about: sm.about }),
      }, h("img", { src: sm.url, alt: "" })))),
      h("p", { class: "faint", style: { fontSize: "12px" } },
        "Each picture gets a reference. Wherever the reference appears in the state or a question, the model sees the picture. Point questions at it by field, such as ", h("code", {}, "`photo`"), ". Uploads are resized in your browser to 280–1568 px.")));
}

function boxWarning() {
  const st = currentStatus();
  const hasBox = W.questions.some((q) => q.type === "box");
  if (!hasBox || !st.configured || st.supports_box) return null;
  return h("div", { class: "panel-body", style: { paddingBottom: 0 } }, h("div", { class: "callout" }, icon("alert"),
    h("div", {}, h("b", {}, `${st.model} cannot answer Box questions.`), h("div", { class: "muted" }, "Box needs Jev 1.14 or later. Change the model from the key menu in the top bar."))));
}

// Draw every Box answer on the picture its question points at.
function renderBoxes() {
  const r = W.result;
  const boxes = Object.entries(r.answers).filter(([, a]) => a.type === "box");
  if (!boxes.length || !r.images?.length) return null;
  const byImage = new Map();
  const unplaced = [];
  for (const [qid, a] of boxes) {
    const img = imageFor(r.trace.request.questions[qid] || {}, r.trace.request.state, r.images);
    if (!img) { unplaced.push(qid); continue; }
    if (!byImage.has(img)) byImage.set(img, []);
    byImage.get(img).push({ box: a.box, label: `${qid} · ${pct(a.confidence)}` });
  }
  return h("div", { class: "box-views" }, [...byImage].map(([img, list]) =>
    photoView(img.url, list, { alt: "Image with Box answers", caption: `${list.length} Box answer${list.length > 1 ? "s" : ""} on ${img.ref}. A Box always returns edges, so check a presence Noul before trusting one.` })),
  unplaced.length ? h("p", { class: "faint", style: { fontSize: "12px" } },
    `Not drawn: ${unplaced.join(", ")}. Name the picture in the instructions by reference or by its backticked state field to see the box.`) : null);
}

function renderRaw() {
  const area = h("textarea", { class: "input", spellcheck: "false" }, JSON.stringify(toQuestions(W.questions), null, 2));
  return h("div", { class: "raw grid", style: { gap: "8px" } }, area,
    h("div", { style: { display: "flex", gap: "8px" } },
      h("button", { class: "btn sm primary", onclick: () => {
        try { W.questions = fromQuestions(JSON.parse(area.value)); W.raw = false; render(); }
        catch (e) { toast(`Invalid JSON: ${e.message}`, "error"); }
      } }, "Apply"),
      h("span", { class: "faint", style: { fontSize: "12px", alignSelf: "center" } }, "Same shape as the API's questions map. Structured instructions and criteria (objects, arrays) are allowed.")));
}

function renderQuestionCard(row, i) {
  const idInput = h("input", { class: "input mono", value: row.id, placeholder: "question_id" });
  idInput.addEventListener("input", () => { row.id = idInput.value; });
  const typeSel = h("select", { class: "input" }, TYPES.map((t) => h("option", { value: t, selected: row.type === t }, t)));
  typeSel.addEventListener("change", () => { row.type = typeSel.value; render(); });
  const instr = h("textarea", { class: "input", placeholder: row.type === "box"
    ? "What to find and in which picture, e.g. the coffee mug in `photo`."
    : "Instructions: the question, as a person would ask it. Refer to state fields with `backticks`." }, row.instructions);
  instr.addEventListener("input", () => { row.instructions = instr.value; });

  let crit;
  if (row.type === "box") {
    crit = h("div", { class: "faint", style: { fontSize: "12px" } },
      "A Box takes no criteria. The answer is the four edges of the target as fractions of the picture's width and height. Needs an image and Jev 1.14+.");
  } else if (row.type === "choice") {
    crit = h("div", { class: "crit" },
      h("div", { class: "section-label", style: { margin: 0 } }, "Options (key → description, description optional)"),
      row.choice.map((pair, j) => {
        const k = h("input", { class: "input mono", value: pair[0], placeholder: "option_key" });
        const d = h("input", { class: "input", value: pair[1], placeholder: "what this option means" });
        k.addEventListener("input", () => { pair[0] = k.value; });
        d.addEventListener("input", () => { pair[1] = d.value; });
        return h("div", { class: "cr" }, k, d, h("button", { class: "btn sm ghost", onclick: () => { row.choice.splice(j, 1); render(); } }, icon("x")));
      }),
      h("div", {}, h("button", { class: "chip", onclick: () => { row.choice.push(["", ""]); render(); } }, icon("plus"), "Add option")));
  } else if (row.type === "score") {
    crit = h("div", { class: "crit" },
      h("div", { class: "section-label", style: { margin: 0 } }, "Levels, in order from 0 (each should describe a concrete situation)"),
      row.score.map((lvl, j) => {
        const d = h("input", { class: "input", value: lvl, placeholder: `level ${j}` });
        d.addEventListener("input", () => { row.score[j] = d.value; });
        return h("div", { class: "cr score" }, h("span", { class: "lv" }, String(j)), d, h("button", { class: "btn sm ghost", onclick: () => { row.score.splice(j, 1); render(); } }, icon("x")));
      }),
      h("div", {}, h("button", { class: "chip", onclick: () => { row.score.push(""); render(); } }, icon("plus"), "Add level")));
  } else {
    const yes = h("input", { class: "input", value: row.noulYes, placeholder: "optional: what a yes means" });
    const no = h("input", { class: "input", value: row.noulNo, placeholder: "optional: what a no means" });
    yes.addEventListener("input", () => { row.noulYes = yes.value; });
    no.addEventListener("input", () => { row.noulNo = no.value; });
    crit = h("div", { class: "crit" }, h("div", { class: "cr noul" }, h("span", { class: "k" }, "yes"), yes), h("div", { class: "cr noul" }, h("span", { class: "k" }, "no"), no));
  }
  return h("div", { class: "qcard" },
    h("div", { class: "row" }, idInput, typeSel, h("button", { class: "btn sm ghost", title: "Remove question", onclick: () => { W.questions.splice(i, 1); render(); } }, icon("trash"))),
    instr, crit);
}

async function run() {
  const questions = toQuestions(W.questions);
  if (!Object.keys(questions).length) return toast("Add at least one question with an id.", "error");
  const btn = $(".btn.primary");
  btn.disabled = true;
  try {
    const images = W.images.map((i) => ({ ...i }));
    W.result = await api("/api/workbench/run", { state: parseState(W.stateText), questions, images: imagesPayload() });
    W.result.images = images;
    W.saveOpen = false;
    render();
  } catch (e) { handleError(e); btn.disabled = false; }
}

async function exportCode() {
  try {
    W.exported = await api("/api/workbench/export", { state: parseState(W.stateText), questions: toQuestions(W.questions), images: imageNames() });
    render();
    $("#export")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { handleError(e); }
}

function renderExport() {
  const tabs = [["python", "Python SDK"], ["javascript", "JavaScript SDK"], ["curl", "curl"]];
  return h("div", { class: "panel", id: "export" },
    h("div", { class: "panel-head" }, icon("code"), h("h2", {}, "This request as code"), h("div", { class: "spacer" }),
      h("div", { class: "tabs" }, tabs.map(([k, l]) => h("button", { class: `tab${W.exportTab === k ? " active" : ""}`, onclick: () => { W.exportTab = k; render(); } }, l))),
      h("button", { class: "btn sm ghost", onclick: () => { W.exported = null; render(); } }, icon("x"))),
    h("div", { class: "panel-body" }, h("div", { class: "code" },
      h("button", { class: "btn sm copy", onclick: () => copyText(W.exported[W.exportTab]) }, icon("copy"), "Copy"),
      h("pre", {}, W.exported[W.exportTab])),
      h("p", { class: "faint", style: { fontSize: "12px", marginTop: "8px" } },
        W.exportTab === "python" ? "pip install typesafe-sdk (Python 3.10+), then set TYPESAFE_API_KEY."
          : W.exportTab === "javascript" ? "npm install @typesafe-ai/sdk (Node 20+), then set TYPESAFE_API_KEY."
            : "Set TYPESAFE_API_KEY in your shell first.",
        W.images.length ? " The snippet loads each picture from a file named after it; save the pictures beside it first." : "")));
}

function renderSaveForm() {
  const name = h("input", { class: "input", value: W.saveName, placeholder: "Test name, e.g. “angry refund routes to billing”" });
  name.addEventListener("input", () => { W.saveName = name.value; });
  const notes = h("input", { class: "input", value: W.saveNotes, placeholder: "Notes (optional)" });
  notes.addEventListener("input", () => { W.saveNotes = notes.value; });
  const rows = Object.entries(W.result.answers).map(([qid, a]) => {
    const e = W.expect[qid] || (W.expect[qid] = defaultExpect(a));
    const numField = (key) => {
      const inp = h("input", { class: "input mono", value: e[key] ?? "", placeholder: key });
      inp.addEventListener("input", () => { if (inp.value === "") delete e[key]; else e[key] = Number(inp.value); });
      return inp;
    };
    if (a.type === "choice") {
      const sel = h("select", { class: "input" }, Object.keys(a.probabilities).map((k) => h("option", { value: k, selected: e.choice === k }, k)));
      sel.addEventListener("change", () => { e.choice = sel.value; });
      return h("div", { class: "exp" }, h("code", {}, qid), h("span", { class: "faint" }, "choice ="), sel, h("span", {}));
    }
    if (a.type === "box") {
      return h("div", { class: "exp" }, h("code", {}, qid), h("span", { class: "faint", title: "Overlap with the box saved from this run: 1 is identical, 0 is no overlap" }, "IoU with this box ≥"), numField("iou_min"), h("span", {}));
    }
    return h("div", { class: "exp" }, h("code", {}, qid), h("span", { class: "faint" }, a.type === "score" ? "score in" : "P(yes) in"), numField("min"), numField("max"));
  });
  return h("div", { class: "panel pop" },
    h("div", { class: "panel-head" }, icon("save"), h("h2", {}, W.editingId ? `Update test “${W.editingId}”` : "Save as a test"), h("div", { class: "spacer" }),
      h("button", { class: "btn sm ghost", onclick: () => { W.saveOpen = false; render(); } }, icon("x"))),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("p", { class: "muted", style: { fontSize: "12.5px" } }, "Expectations start from the answers you just got. Edit them to what you believe is correct; the Tests tab re-runs this state live and checks the answers against them."),
      name, notes, h("div", { class: "grid", style: { gap: "6px" } }, rows),
      h("div", {}, h("button", { class: "btn primary", onclick: saveTest }, icon("save"), "Save to data/workbench/"))));
}

async function saveTest() {
  try {
    const { item } = await api("/api/workbench/items", {
      id: W.editingId || undefined, name: W.saveName, notes: W.saveNotes, state: parseState(W.stateText),
      questions: toQuestions(W.questions), expect: W.expect, images: imagesPayload(),
    });
    W.items = (await api("/api/workbench/items")).items;
    W.editingId = item.id;
    W.saveOpen = false;
    toast(`Saved data/workbench/${item.id}.json`);
    render();
  } catch (e) { handleError(e); }
}

// ---------- Tests ----------
function renderTests() {
  const res = W.runResults;
  const byId = Object.fromEntries((res?.runs || []).map((r) => [r.id, r]));
  const runAll = h("button", { class: "btn primary", disabled: !W.items.length, onclick: () => runTests() }, icon("play"), `Run all ${W.items.length} tests`);
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "panel tests" },
      h("div", { class: "panel-head" }, h("h2", {}, "Saved tests · data/workbench/"), h("div", { class: "spacer" }),
        res ? h("div", { class: "stat-row" },
          h("span", { class: `badge ${res.failed ? "critical" : "good"}` }, icon(res.failed ? "x" : "check"), `${res.passed} passed · ${res.failed} failed`),
          h("span", { class: "stat" }, "wall", h("b", {}, ms(res.wall_ms))), h("span", { class: "stat" }, "cost", h("b", {}, usd(res.cost_usd)))) : null,
        runAll),
      W.items.length ? W.items.map((it) => {
        const r = byId[it.id];
        return h("div", { class: "item" },
          h("div", { class: "grid", style: { gap: "4px" } },
            h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
              r ? statusBadge(r.error ? "fail" : r.ok ? "pass" : "fail") : null, h("b", {}, it.name), h("code", { class: "faint" }, it.id),
              h("span", { class: "faint", style: { fontSize: "12px" } }, `${Object.keys(it.questions).length} questions · ${Object.keys(it.expect || {}).length} expectations`
                + (it.images ? ` · ${Object.keys(it.images).length} image${Object.keys(it.images).length > 1 ? "s" : ""}` : ""))),
            it.notes ? h("div", { class: "muted", style: { fontSize: "12.5px" } }, it.notes) : null,
            r?.error ? h("div", { class: "checks", style: { color: "var(--critical-text)" } }, r.error) : null,
            r && !r.error ? h("div", { class: "checks" }, Object.entries(r.results).map(([qid, q]) =>
              h("span", { style: { marginRight: "12px", color: q.ok === false ? "var(--critical-text)" : q.ok ? "var(--good-text)" : "var(--faint)" } },
                `${qid}: ${q.checks.join(", ")}`))) : null,
            r?.meta ? h("div", {}, callStats(r.meta, () => inspect(r.trace, `Test · ${it.name}`))) : null),
          h("div", { style: { display: "flex", gap: "6px" } },
            h("button", { class: "btn sm", onclick: () => openItem(it) }, "Open"),
            h("button", { class: "btn sm ghost", onclick: () => runTests([it.id]) }, icon("play")),
            h("button", { class: "btn sm ghost danger", onclick: () => deleteTest(it.id) }, icon("trash"))));
      }) : h("div", { class: "empty" }, "No saved tests yet. Run something in Build, then “Save as test”. Files land in data/workbench/ so they can be committed alongside your code.")),
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Why tests for a model?")),
      h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
        h("p", { class: "muted" }, "Question wording is code. When you reword an instruction, add an option, or move to a new model version (aliases like jev-latest move), run the suite and see what changed."),
        h("p", { class: "muted" }, "Expectations are ranges on probabilities, not exact numbers, because calibrated models are allowed to be a little different run to run."),
        h("p", { class: "muted" }, "Each test is one JSON file with the request and the expectations, so you can also load them in CI with the Python SDK."))));
}

async function openItem(it) {
  try {
    const images = it.images ? (await api("/api/workbench/items/images", { id: it.id })).images : {};
    loadInto(it.state, it.questions, { expect: it.expect, name: it.name, notes: it.notes, id: it.id, images });
  } catch (e) { handleError(e); }
}

async function runTests(ids = null) {
  try {
    W.runResults = await api("/api/workbench/items/run", ids ? { ids } : {});
    render();
  } catch (e) { handleError(e); }
}

async function deleteTest(id) {
  if (!confirm(`Delete test “${id}”?`)) return;
  try {
    await api("/api/workbench/items/delete", { id });
    W.items = (await api("/api/workbench/items")).items;
    render();
  } catch (e) { handleError(e); }
}

// ---------- Bulk ----------
// One row as a line of the rows box, carrying `labels` if given. A text line that would split, lose
// whitespace, or parse as JSON is written as an object so it survives the trip (the server splits rows
// on "\n" and trims each line).
function rowLineFor(row, labels = null) {
  const has = labels && Object.keys(labels).length;
  if (typeof row === "string") {
    const plain = row === row.trim() && !/^[{[]/.test(row) && !/[\n\r]/.test(row);
    if (!has && plain) return row;
    return JSON.stringify(has ? { text: row, _expect: labels } : { text: row });
  }
  return JSON.stringify(has ? { ...row, _expect: labels } : row);
}

// Rows as the rows box shows them: one per line, or a JSON array when a row is itself an array, since
// an array line would come back as text.
function rowsText(rows) {
  if (rows.some(Array.isArray)) return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
  return rows.map((r) => rowLineFor(r)).join("\n");
}

// Rows or labels that a reload would lose: the box differs from the last save or load, or labels were
// typed in the results table and not yet put in the rows.
const bulkUnsaved = () => W.bulk.rowsText !== W.bulk.savedText || W.bulk.labelsDirty;

function markUnsaved() {
  const el = $("#ds-unsaved");
  if (el) el.style.display = bulkUnsaved() ? "" : "none";
}

// Replace the rows box, after a confirm when that would lose unsaved rows or labels.
function replaceRows(text, what) {
  const b = W.bulk;
  if (bulkUnsaved() && !confirm(`Replace the rows box with ${what}? Rows and labels you have not saved will be lost.`)) return false;
  b.rowsText = b.savedText = text;
  b.labelsDirty = false;
  return true;
}

async function loadSampleRows() {
  try {
    const s = await api("/api/workbench/bulk/sample");
    if (!replaceRows(rowsText(s.rows), "the sample rows")) return;
    W.bulk.dataset.id = null;
    render();
  } catch (e) { handleError(e); }
}

// Put labels chosen in the results table into the rows box before the box is saved or run, so they are
// not lost. They fit only the rows that were run; when the box has changed since, ask before dropping them.
function settleLabels(action) {
  const b = W.bulk;
  if (!b.labelsDirty || !b.result) return true;
  if (b.rowsText === b.runText) return keepLabels(true);
  return confirm(`The rows box has changed since the run, so the labels chosen in the results table cannot be put back in it. ${action} without them?`);
}

// The server's file name for a dataset name (jev/workbench.py slugify), to warn before replacing one.
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function saveDataset() {
  const b = W.bulk;
  const d = b.dataset;
  const name = d.name.trim();
  const id = slugOf(name);
  if (!id) return toast("Give the dataset a name", "error");
  if (id !== d.id && b.datasets.some((x) => x.id === id) && !confirm(`Replace the saved dataset “${id}”?`)) return;
  if (!settleLabels("Save the rows box")) return;
  const questions = d.withQuestions ? bulkQuestions() : null;
  try {
    const { dataset, check_dropped: dropped } = await api("/api/workbench/datasets", {
      name, notes: d.notes, rows: rowsPayload(), questions: questions && Object.keys(questions).length ? questions : undefined,
    });
    b.savedText = b.rowsText;
    b.labelsDirty = false;
    d.id = dataset.id;
    d.name = dataset.name;
    // Match the file: a dataset saved without questions offers none, as when it is loaded.
    d.questions = questions && Object.keys(questions).length ? questions : null;
    if (!d.questions && b.source === "dataset") b.source = "current";
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    toast(`Saved ${dataset.rows} rows (${dataset.labeled} labeled) to data/workbench/datasets/${dataset.id}.json`);
    if (dropped) toast(`Removed the dataset's check: ${dropped}`, "error");
    render();
  } catch (e) { handleError(e); render(); }
}

async function loadDataset(id) {
  const b = W.bulk;
  try {
    const { dataset } = await api("/api/workbench/datasets/load", { id });
    if (!replaceRows(rowsText(dataset.rows), `“${dataset.name || id}”`)) return;
    b.dataset = { id, name: dataset.name || id, notes: dataset.notes || "", withQuestions: !!dataset.questions, questions: dataset.questions || null };
    if (dataset.questions) b.source = "dataset";
    else if (b.source === "dataset") b.source = "current";
    toast(`Loaded ${dataset.rows.length} rows. Run them to get answers.`);
    render();
  } catch (e) { handleError(e); }
}

async function deleteDataset(id) {
  const b = W.bulk;
  if (!confirm(`Delete the dataset “${id}”? This removes data/workbench/datasets/${id}.json.`)) return;
  try {
    await api("/api/workbench/datasets/delete", { id });
    if (b.dataset.id === id) b.dataset.id = null;
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    render();
  } catch (e) { handleError(e); }
}

function renderDatasets() {
  const b = W.bulk;
  const d = b.dataset;
  const name = h("input", { class: "input", placeholder: "Dataset name, e.g. Support tickets, March", value: d.name, "aria-label": "Dataset name" });
  name.addEventListener("input", () => { d.name = name.value; });
  const notes = h("input", { class: "input", placeholder: "Notes (optional)", value: d.notes, "aria-label": "Dataset notes" });
  notes.addEventListener("input", () => { d.notes = notes.value; });
  const withQ = h("input", { type: "checkbox", checked: d.withQuestions });
  withQ.addEventListener("change", () => { d.withQuestions = withQ.checked; });
  const labeledText = (x) => `${x.rows} row${x.rows === 1 ? "" : "s"} · ${x.labeled} labeled`
    + (x.questions ? ` · ${x.questions} question${x.questions === 1 ? "" : "s"}` : "");
  return h("div", { class: "panel datasets" },
    h("div", { class: "panel-head" }, h("h2", {}, "Datasets · data/workbench/datasets/"), h("div", { class: "spacer" }),
      h("span", { class: "badge warning", id: "ds-unsaved", style: { display: bulkUnsaved() ? "" : "none" }, title: "A reload would lose these rows or labels" }, "Unsaved rows or labels")),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("div", { class: "grid", style: { gap: "6px" } }, name, notes,
        h("label", { class: "toggle", style: { gap: "6px" } }, withQ, h("span", { class: "track" }), "Save the selected questions with the rows"),
        h("div", {}, h("button", { class: "btn sm", onclick: saveDataset }, icon("check"), "Save rows and labels"))),
      h("p", { class: "faint", style: { fontSize: "12px" } }, "Saves the rows box, with the labels you chose in the results table, as one JSON file you can commit. Only rows and labels are saved, never answers: run a loaded dataset to get answers."),
      b.datasets.some((x) => x.check) ? h("datalist", { id: "cmp-models" }, (W.compare.models || []).map((n) => h("option", { value: n }))) : null,
      b.datasets.length ? b.datasets.map((x) => h("div", { class: "item" },
        h("div", { class: "grid", style: { gap: "2px" } },
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            h("b", {}, x.name || x.id), h("code", { class: "faint" }, x.id), x.id === d.id ? h("span", { class: "badge" }, "loaded") : null),
          h("span", { class: "faint", style: { fontSize: "12px" } }, labeledText(x) + (x.saved_at ? ` · saved ${x.saved_at.slice(0, 10)}` : "")),
          x.notes ? h("span", { class: "muted", style: { fontSize: "12px" } }, x.notes) : null),
        h("div", { style: { display: "flex", gap: "6px" } },
          h("button", { class: "btn sm", onclick: () => loadDataset(x.id) }, "Load"),
          h("button", { class: "btn sm ghost danger", "aria-label": `Delete ${x.id}`, onclick: () => deleteDataset(x.id) }, icon("trash"))),
        x.check ? checkItem(x) : null))
        : h("div", { class: "empty" }, "No saved datasets yet. Label some rows, name them, and save.")));
}

// ---------- Checks ----------
// A check (jev/checks.py) keeps Policy's gate with a saved dataset: the gated questions and thresholds, the model, and
// the targets the gate must keep meeting. Running it sends every saved row to the model again and judges the new
// answers, so the report below a dataset always comes from a run started here. scripts/check.py runs the same checks.
const canon = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : JSON.stringify(v));

function checkTargetsText(c) {
  return `${pct(c.min_accuracy, 1)} accurate${c.bound === "lower" ? " at 95% confidence" : ""} · at least ${pct(c.min_coverage)} automated`;
}

function checkItem(x) {
  const c = x.check;
  const run = W.bulk.checkRuns[x.id] || (W.bulk.checkRuns[x.id] = { running: false, report: null, model: "" });
  const model = h("input", { class: "input sm", list: "cmp-models", value: run.model, spellcheck: "false", style: { maxWidth: "190px" },
    placeholder: `model: ${c.model}`, "aria-label": `Model to ask for the ${x.id} check` });
  model.addEventListener("focus", loadModels);
  model.addEventListener("input", () => { run.model = model.value; });
  const n = Math.min(x.rows, 200);
  return h("div", { class: "check-item" },
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
      h("span", { class: "badge info" }, icon("check"), "Check"),
      h("span", { class: "mono" }, Object.entries(c.gates).map(([q, t]) => `${q} ≥ ${t.toFixed(2)}`).join(" · ")),
      h("span", { class: "muted" }, `${checkTargetsText(c)} · asks ${c.model}`)),
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: run.running, onclick: () => runCheck(x.id) },
        run.running ? [h("span", { class: "spin" }), " Checking…"] : [icon("layers"), `Run check · ${n} call${n === 1 ? "" : "s"}`]),
      model,
      h("button", { class: "btn sm ghost", disabled: run.running, onclick: () => removeCheck(x.id) }, "Remove check")),
    run.report ? checkReport(run.report) : null);
}

async function runCheck(id) {
  const b = W.bulk;
  const run = b.checkRuns[id];
  run.running = true;
  run.report = null;
  render();
  try {
    run.report = await api("/api/workbench/checks/run", { id, model: run.model.trim() || undefined });
  } catch (e) { handleError(e); }
  run.running = false;
  render();
}

async function removeCheck(id) {
  if (!confirm(`Remove the check from “${id}”? The rows, labels, and questions stay.`)) return;
  try {
    await api("/api/workbench/checks/delete", { id });
    delete W.bulk.checkRuns[id];
    W.bulk.datasets = (await api("/api/workbench/datasets")).datasets;
    render();
  } catch (e) { handleError(e); }
}

const CHECK_BADGE = { pass: ["good", "check", "Passed"], fail: ["critical", "stop", "Failed"], error: ["warning", "eye", "Not judged"] };

function checkReport(rep) {
  const [tone, ic, label] = CHECK_BADGE[rep.status];
  const t = rep.targets;
  const mark = (ok) => h("span", { class: `badge ${ok ? "good" : "critical"}` }, ok ? "meets" : "misses");
  const lower = rep.check.bound === "lower";
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${tone}` }, icon(ic), label),
      h("span", { class: "faint", style: { fontSize: "12px" } },
        `${rep.rows} rows · asked ${rep.model}${rep.answered_by?.length ? `, answered by ${rep.answered_by.join(", ")}` : ""}`)),
    t.accuracy ? h("div", { class: "stat-row" },
      stat("accuracy when automated", [rep.accuracy === null ? "—" : withCI(pct(rep.accuracy, 1), rep.accuracy_low, rep.accuracy_high), " ", mark(t.accuracy.ok)]),
      stat(lower ? "target, 95% lower bound" : "target", pct(t.accuracy.target, 1)),
      stat("automated", [`${rep.automated} of ${rep.labeled} · ${pct(rep.coverage)}`, " ", mark(t.coverage.ok)]),
      stat("minimum", pct(t.coverage.target)),
      stat("cost", usd(rep.cost_usd)),
      rep.latency_ms_median === null ? null : stat("median latency", ms(rep.latency_ms_median))) : null,
    rep.reasons.length ? h("ul", { class: "muted", style: { fontSize: "12.5px", margin: 0, paddingLeft: "18px" } },
      rep.reasons.map((r) => h("li", {}, r))) : null,
    rep.mistakes.length ? h("div", { class: "grid", style: { gap: "4px" } },
      h("span", { class: "faint", style: { fontSize: "12px" } }, `Automated but wrong · ${rep.mistakes_total}`),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("tbody", {}, rep.mistakes.slice(0, 5).map((m) => h("tr", {},
          h("td", { class: "num" }, String(m.index + 1)),
          h("td", { class: "row", style: { maxWidth: "260px" } }, m.row),
          h("td", {}, Object.entries(m.wrong).map(([q, a]) => h("div", { style: { fontSize: "12px" } },
            h("span", { class: "mono" }, q), `: ${a.answer}, label ${a.label} `, h("span", { class: "faint mono" }, `(${a.signal.toFixed(2)})`))))))))),
      rep.mistakes_total > 5 ? h("span", { class: "faint", style: { fontSize: "12px" } }, `…and ${rep.mistakes_total - 5} more. Load the dataset and run it in Bulk to see every row.`) : null) : null);
}

// Policy's "Save as a check": why it cannot be saved yet, or the targets to save and whether this run meets them.
function checkBlocker() {
  const b = W.bulk;
  const d = b.dataset;
  if (!d.id) return "Save these rows as a dataset, with their questions, to keep this gate as a check.";
  if (bulkUnsaved() || b.runText !== b.savedText) return `Save the dataset first: a check reruns the rows saved in data/workbench/datasets/${d.id}.json, and these differ.`;
  if (!d.questions || canon(b.ranQuestions) !== canon(d.questions)) {
    return `This run asked other questions than the ones saved with “${d.name}”. Run its saved questions, or save the dataset with these.`;
  }
  return null;
}

function checkDefaults(rep, bound) {
  const met = [0.99, 0.95, 0.90].find((target) => rep.automated && (bound === "lower" ? rep.accuracy_low : rep.accuracy) + 1e-9 >= target);
  return { accuracy: String(Math.round(100 * (met || 0.9))), coverage: String(Math.max(0, Math.floor(rep.coverage * 20) * 5 - 5)) };
}

function checkVerdict(rep, bound, form) {
  const acc = Number(form.accuracy) / 100;
  const cov = Number(form.coverage) / 100;
  if (!(acc >= 0.5 && acc <= 1) || !(cov >= 0 && cov <= 1)) return [h("span", { style: { color: "var(--critical-text)" } }, "Accuracy takes 50–100%, automated 0–100%.")];
  const measured = bound === "lower" ? rep.accuracy_low : rep.accuracy;
  const accOk = rep.automated > 0 && measured + 1e-9 >= acc;
  const covOk = rep.coverage + 1e-9 >= cov;
  return [`On this run: ${measured === null ? "nothing automated" : `${pct(measured, 1)} ${bound === "lower" ? "at 95% confidence" : "accurate"}`} `,
    h("span", { class: `badge ${accOk ? "good" : "critical"}` }, accOk ? "meets" : "misses"),
    ` · ${pct(rep.coverage)} automated `, h("span", { class: `badge ${covOk ? "good" : "critical"}` }, covOk ? "meets" : "misses"),
    accOk && covOk ? "" : ". A check that fails on the run it comes from will fail when you rerun it."];
}

function checkSaveBody(rep) {
  const b = W.bulk;
  const p = b.policy;
  const title = h("h3", { class: "cal-h" }, "Save as a check");
  const blocker = checkBlocker();
  if (blocker) return [title, h("p", { class: "faint", style: { fontSize: "12.5px" } }, blocker)];
  // Until a target is typed, it follows the gates: the highest target this run meets, and its automation less a margin.
  const typed = b.checkForm;
  const form = { ...checkDefaults(rep, p.bound), ...Object.fromEntries(Object.entries(typed).filter(([, v]) => v !== null)) };
  const verdict = h("div", { id: "check-verdict", style: { fontSize: "12.5px" } }, checkVerdict(rep, p.bound, form));
  const field = (key, label, min) => {
    const input = h("input", { class: "input sm", type: "number", min, max: 100, step: 1, value: form[key], style: { width: "84px" },
      id: `check-${key}`, "aria-label": label });
    input.addEventListener("input", () => { typed[key] = form[key] = input.value; mount(verdict, ...checkVerdict(rep, p.bound, form)); });
    return h("label", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h("span", { class: "muted" }, label), input, "%");
  };
  const existing = b.datasets.find((x) => x.id === b.dataset.id)?.check;
  const model = currentStatus()?.model || "jev-latest";
  return [title,
    h("p", { class: "faint", style: { fontSize: "12.5px" } },
      `Keeps these thresholds with “${b.dataset.name}”, asking ${model}, and the targets they must keep meeting. Run the check from the Datasets panel or with `,
      h("code", {}, "uv run scripts/check.py"), " after you change wording or model: it reruns every saved row and fails when a target is missed. Only targets are saved, never answers."),
    h("div", { style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
      field("accuracy", p.bound === "lower" ? "accurate at 95% confidence, at least" : "accurate when automated, at least", 50),
      field("coverage", "automated, at least", 0),
      h("button", { class: "btn sm", onclick: saveCheck }, icon("check"), existing ? "Replace the saved check" : `Save check to ${b.dataset.id}`)),
    verdict];
}

async function saveCheck() {
  const b = W.bulk;
  const p = b.policy;
  const id = b.dataset.id;
  const blocker = checkBlocker();  // the rows box or labels may have changed since the panel was drawn
  if (blocker) return toast(blocker, "error");
  if (b.datasets.find((x) => x.id === id)?.check && !confirm(`Replace the check saved with “${id}”?`)) return;
  try {
    const check = { gates: activeGates(), signal: p.signal, bound: p.bound, model: currentStatus()?.model || "",
      min_accuracy: Number($("#check-accuracy").value) / 100, min_coverage: Number($("#check-coverage").value) / 100 };
    await api("/api/workbench/checks", { id, check });
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    delete b.checkRuns[id];
    toast(`Saved the check to data/workbench/datasets/${id}.json`);
    render();
  } catch (e) { handleError(e); }
}

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

function renderImport() {
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

// What a label for a question has to be, for the import's warnings.
function expectedText(q) {
  if (!q) return "a label";
  if (q.type === "noul") return "yes or no";
  if (q.type === "score") return `a level from 0 to ${(q.criteria || []).length - 1}`;
  return `one of its options (${Object.keys(q.criteria || {}).join(", ")})`;
}

function countRows(text) {
  const t = text.trim();
  if (t.startsWith("[")) { try { const v = JSON.parse(t); if (Array.isArray(v)) return v.length; } catch { /* count lines */ } }
  return text.split("\n").filter((l) => l.trim()).length;
}

// The rows box as the server takes it: a JSON array, or the text itself (one row per line).
function rowsPayload() {
  const rows = W.bulk.rowsText;
  if (/^\[/.test(rows.trim())) { try { return JSON.parse(rows); } catch { /* keep text */ } }
  return rows;
}

function bulkQuestions() {
  const b = W.bulk;
  if (b.source === "dataset" && b.dataset.questions) return b.dataset.questions;
  return b.source === "sample" ? b.sampleQuestions : toQuestions(W.questions);
}

function renderBulk() {
  const b = W.bulk;
  const rows = h("textarea", { class: "input", spellcheck: "false", placeholder: "One item per line. A text line becomes the state {\"text\": line}; a JSON object line is sent as it is. Or paste a JSON array of objects." }, b.rowsText);
  rows.addEventListener("input", () => { b.rowsText = rows.value; markUnsaved(); });
  const nRows = countRows(b.rowsText);
  const current = toQuestions(W.questions);
  const src = (value, label) => {
    const r = h("input", { type: "radio", name: "src", checked: b.source === value });
    r.addEventListener("change", () => { b.source = value; b.csv.columns = {}; render(); });
    return h("label", { class: "toggle", style: { gap: "6px" } }, r, h("span", { class: "track" }), label);
  };
  const runBtn = h("button", { class: "btn primary", id: "bulk-run", onclick: runBulk }, icon("layers"), `Run ${Math.min(nRows, 200)} rows`);
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "grid wb-grid" },
      h("div", { class: "panel bulk" },
        h("div", { class: "panel-head" }, h("h2", {}, `Rows · ${nRows}`), h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: () => { b.csv.open = !b.csv.open; render(); if (b.csv.open) $("#csv-import")?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, "Import CSV"),
          h("button", { class: "btn sm ghost", onclick: loadSampleRows }, "Load sample rows")),
        h("div", { class: "panel-body" }, rows,
          h("p", { class: "faint", style: { fontSize: "12px", marginTop: "8px" } }, "Put labels on a JSON row under ", h("code", {}, "\"_expect\""), ", keyed by question id: ",
            h("code", {}, "{\"text\": \"…\", \"_expect\": {\"department\": \"billing\", \"wants_refund\": true}}"), ". Labels never reach the model; Calibrate scores the answers against them."))),
      h("div", { class: "grid", style: { gap: "16px" } },
        renderDatasets(),
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Questions to run on every row")),
          h("div", { class: "panel-body grid", style: { gap: "10px" } },
            src("current", `Current Build questions (${Object.keys(current).length})`),
            src("sample", `Sample: support triage (${Object.keys(b.sampleQuestions || {}).length})`),
            b.dataset.questions ? src("dataset", `Saved with “${b.dataset.name}” (${Object.keys(b.dataset.questions).length})`) : null,
            h("p", { class: "faint", style: { fontSize: "12px" } }, "Each row is its own live request; they run 8 at a time and count against the session budget. Cap: 200 rows per run. The sample rows carry labels for the sample questions."),
            h("div", {}, runBtn))),
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Why this matters")),
          h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
            h("p", { class: "muted" }, "At $0.042 per million input tokens, a question set over a million short messages costs about ", h("b", {}, "$10"), ". That is why “classify everything, then sort” is finally practical."),
            h("p", { class: "muted" }, "With labeled rows, Calibrate shows how often each answer was right and where to set the confidence threshold: above it your code acts, below it a person reviews. Choose the threshold from your own data, not a default."))))),
    b.csv.open ? renderImport() : null,
    b.result ? renderCosts() : null,
    b.result ? renderCalibrate() : null,
    b.result ? renderReview() : null,
    b.result ? renderPolicy() : null,
    b.result ? renderBulkTable() : null);
}

async function runBulk() {
  const questions = bulkQuestions();
  if (!Object.keys(questions).length) return toast("No questions. Build some first or pick the sample.", "error");
  if (!settleLabels("Run the rows box")) return;
  const btn = $("#bulk-run");
  btn.disabled = true;
  mount(btn, h("span", { class: "spin" }), " Running…");
  try {
    const b = W.bulk;
    const ranText = b.rowsText;
    b.result = await api("/api/workbench/bulk", { rows: rowsPayload(), questions });
    b.runText = ranText;
    b.ranQuestions = questions;
    b.checkForm = { accuracy: null, coverage: null };
    b.labelsDirty = false;
    b.sortKey = null;
    b.labels = {};
    for (const r of b.result.results) if (r.expect) b.labels[r.index] = { ...r.expect };
    b.review = { report: null, kept: new Set(), all: { suspects: false, next: false } };
    // Keep priced mistakes that still name a question and two of its answers; the new run may ask other questions.
    const asked = bulkQuestionsForResult(b.result);
    b.costs.mistakes = b.costs.mistakes.filter((m) => GATEABLE.has(asked[m.question]?.type)
      && answerClasses(asked[m.question]).includes(m.label) && answerClasses(asked[m.question]).includes(m.answer));
    b.cal.qid = chooseCalQuestion();
    resetPolicy();
    await Promise.all([recalibrate(), repolicy()]);
    if (b.result.stopped) toast(b.result.stopped, "error");
    render();
    $("#calibrate")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { handleError(e); render(); }
}

function cellValue(answers, qid) {
  const a = answers?.[qid];
  if (!a) return { sort: -1, text: "" };
  if (a.type === "choice") return { sort: a.choice, text: a.choice, sub: pct(a.probabilities[a.choice]) };
  if (a.type === "score") return { sort: a.score, text: a.score.toFixed(2), heat: a.score / Math.max(1, Object.keys(a.legend).length - 1) };
  return { sort: a.noul, text: pct(a.noul), heat: a.noul };
}

function labelCell(r, qid) {
  return h("td", {}, labelSelect(r, qid));
}

// A label picker for one row and question. Changing it rescores everything that reads labels.
function labelSelect(r, qid) {
  const b = W.bulk;
  const answer = r.answers?.[qid];
  if (!answer) return null;
  const current = labelText(b.labels[r.index]?.[qid], answer.type);
  const classes = answerClasses(answer);
  const extra = current && !classes.includes(current) ? [h("option", { value: current, selected: true }, `${current} (invalid)`)] : [];
  const sel = h("select", { class: "input label-sel", "aria-label": `Label for row ${r.index + 1}` },
    h("option", { value: "", selected: !current }, "—"),
    classes.map((c) => h("option", { value: c, selected: c === current }, answer.type === "score" ? `${c} · ${String(answer.legend?.[c] ?? "").slice(0, 32)}` : c)), extra);
  sel.addEventListener("change", async () => {
    const value = labelValue(sel.value, answer.type);
    const labels = { ...(b.labels[r.index] || {}) };
    if (value === null) delete labels[qid]; else labels[qid] = value;
    b.labels[r.index] = labels;
    b.review.kept.delete(`${r.index}:${qid}`);  // a changed label is checked afresh
    b.labelsDirty = true;
    await Promise.all([recalibrate(), repolicy()]);
    render();
  });
  return sel;
}

function renderBulkTable() {
  const b = W.bulk;
  const res = b.result;
  const qids = Object.keys(bulkQuestionsForResult(res));
  const calQ = b.cal.qid;
  const scored = new Map((b.cal.report?.rows || []).map((r) => [r.index, r]));
  let rows = res.results.slice();
  if (b.sortKey) {
    rows.sort((x, y) => {
      const vx = b.sortKey === "__row" ? x.index : cellValue(x.answers, b.sortKey).sort;
      const vy = b.sortKey === "__row" ? y.index : cellValue(y.answers, b.sortKey).sort;
      return (vx > vy ? 1 : vx < vy ? -1 : 0) * b.sortDir;
    });
  }
  const th = (key, label) => h("th", { class: b.sortKey === key ? "sorted" : "", onclick: () => { b.sortDir = b.sortKey === key ? -b.sortDir : -1; b.sortKey = key; render(); } },
    label, b.sortKey === key ? (b.sortDir < 0 ? " ↓" : " ↑") : "");
  const csv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const labeled = qids.filter((q) => labeledQids(b).has(q));
    const lines = [["row", ...qids, ...labeled.map((q) => `label:${q}`)].map(esc).join(",")];
    for (const r of res.results) {
      lines.push([typeof r.row === "string" ? r.row : JSON.stringify(r.row), ...qids.map((q) => cellValue(r.answers, q).text),
        ...labeled.map((q) => labelText(b.labels[r.index]?.[q], r.answers?.[q]?.type))].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "jev-bulk.csv" });
    document.body.append(a); a.click(); a.remove();
  };
  return h("div", { class: "panel", id: "bulk-table" },
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, `${res.completed} of ${res.rows} rows`), h("div", { class: "spacer" }),
      h("div", { class: "stat-row" },
        h("span", { class: "stat accent" }, "wall", h("b", {}, ms(res.wall_ms))),
        h("span", { class: "stat" }, "tokens", h("b", {}, num(res.input_tokens))),
        h("span", { class: "stat" }, "cost", h("b", {}, usd(res.cost_usd))),
        h("button", { class: "btn sm", onclick: () => keepLabels(), title: "Rewrite the rows box as JSON lines that carry these labels, so the next run keeps them" }, "Keep labels in rows"),
        h("button", { class: "btn sm", onclick: csv }, "Download CSV"))),
    h("div", { class: "scroll" }, h("table", { class: "table bulk-table" },
      h("thead", {}, h("tr", {}, th("__row", "#"), h("th", {}, "row"), qids.map((q) => th(q, q)),
        calQ ? [h("th", {}, `label · ${calQ}`), h("th", {}, "result"), h("th", {}, "route")] : null)),
      h("tbody", {}, rows.map((r) => h("tr", { "data-index": String(r.index) },
        h("td", { class: "num" }, String(r.index + 1)),
        h("td", { class: "row" }, rowText(r.row), r.error ? h("div", { style: { color: "var(--critical-text)", fontSize: "12px" } }, r.error) : null),
        qids.map((q) => {
          const v = cellValue(r.answers, q);
          return h("td", { class: q === calQ ? "cal-col" : "" }, v.heat !== undefined
            ? h("span", {}, h("span", { class: "pill-num" }, v.text), h("span", { class: "heat" }, h("i", { style: { width: pct(v.heat, 1) } })))
            : h("span", {}, h("span", { class: "cell-choice" }, v.text), v.sub ? h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, v.sub) : null));
        }),
        calQ ? [labelCell(r, calQ),
          h("td", {}, scored.has(r.index) ? (scored.get(r.index).correct ? statusBadge("pass", "Right") : statusBadge("fail", "Wrong")) : null),
          h("td", { class: "route" })] : null))))));
}

// A row that is only {"text": ...} reads as its text; anything else shows as JSON.
function rowText(row) {
  if (typeof row === "string") return row;
  if (row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).length === 1 && typeof row.text === "string") return row.text;
  return JSON.stringify(row);
}

function bulkQuestionsForResult(res) {
  const first = res.results.find((r) => r.answers);
  return first ? first.answers : {};
}

function keepLabels(quiet = false) {
  const b = W.bulk;
  // One JSON line per row. Array states cannot hold "_expect" and would come back as text, so refuse.
  if (b.result.results.some((r) => Array.isArray(r.row))) {
    toast("Rows that are JSON arrays cannot carry labels. Wrap each one in an object first.", "error");
    return false;
  }
  if (!quiet && b.rowsText !== b.runText
    && !confirm("The rows box has changed since the run. Replace it with the rows that were run, carrying these labels?")) return false;
  b.rowsText = b.runText = b.result.results.map((r) => rowLineFor(r.row, b.labels[r.index])).join("\n");
  b.labelsDirty = false;
  if (!quiet) {
    render();
    toast("Rows now carry their labels as JSON lines");
  }
  return true;
}

// ---------- Calibrate ----------
// Scores one question's Bulk answers against labels and sweeps a confidence threshold. The server
// does the arithmetic (jev/calibrate.py); no model calls. The slider and chart update in place.
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
const SIGNALS = { confidence: "confidence", top_probability: "top probability" };
// What must reach a target accuracy: the accuracy measured on these rows, or its 95% lower bound (jev/calibrate.py).
const BOUNDS = { estimate: "targets on these rows", lower: "targets at 95% confidence" };

function boundSelect(state, onChange) {
  const sel = h("select", { class: "input", "aria-label": "What must reach a target accuracy" },
    Object.entries(BOUNDS).map(([k, label]) => h("option", { value: k, selected: k === state.bound }, label)));
  sel.addEventListener("change", async () => { state.bound = sel.value; await onChange(); render(); });
  return sel;
}
// A 95% interval as "81–97%", or "" when there is nothing to measure.
const interval = (lo, hi) => (lo === null || lo === undefined ? "" : `${pct(lo)}–${pct(hi)}`);
const withCI = (value, lo, hi) => (lo === null || lo === undefined ? value : [value, h("span", { class: "ci", title: "95% interval" }, ` ${interval(lo, hi)}`)]);
// The label of a target that was not reached, saying how many rows a 95% claim needs when that is the reason.
function unreached(t, bound, labeled) {
  if (bound === "lower" && labeled < t.needed) return `${pct(t.target)} at 95% confidence: needs ${t.needed}+ automated rows, all right (${labeled} labeled)`;
  return `${pct(t.target)} accurate${bound === "lower" ? " at 95% confidence" : ""}: not reached on these rows`;
}
const targetName = (target, bound) => (bound === "lower" ? `${pct(target)} at 95% confidence` : `${pct(target)} accurate`);

function answerClasses(answer) {
  if (answer.type === "noul") return ["yes", "no"];
  const keys = Object.keys(answer.probabilities || {});
  return answer.type === "score" ? keys.sort((a, c) => Number(a) - Number(c)) : keys;
}
function labelText(value, type) {
  if (value === undefined || value === null || value === "") return "";
  if (type === "noul") {
    if (value === true || /^(yes|true|1|y)$/i.test(String(value))) return "yes";
    if (value === false || /^(no|false|0|n)$/i.test(String(value))) return "no";
  }
  return String(value);
}
function labelValue(text, type) {
  if (text === "") return null;
  if (type === "noul") return text === "yes" ? true : text === "no" ? false : text;
  if (type === "score" && /^\d+$/.test(text)) return Number(text);
  return text;
}
function labeledQids(b) {
  const qids = new Set();
  for (const labels of Object.values(b.labels)) for (const q of Object.keys(labels)) qids.add(q);
  return qids;
}
function chooseCalQuestion() {
  const b = W.bulk;
  const qids = Object.keys(bulkQuestionsForResult(b.result));
  const labeled = labeledQids(b);
  if (qids.includes(b.cal.qid) && (labeled.has(b.cal.qid) || !labeled.size)) return b.cal.qid;
  return qids.find((q) => labeled.has(q)) || qids[0] || null;
}
// Labels or Calibrate's question or signal changed: rescore it, and re-review labels, which follow both.
async function recalibrate() {
  await Promise.all([calibrateQuestion(), rereview(), costCalibrate()]);
}
let calSeq = 0;
async function calibrateQuestion() {
  const b = W.bulk;
  const qid = b.cal.qid;
  const seq = ++calSeq;  // only the latest request may install its report
  clearHoldout(b.cal);
  const rows = qid ? b.result.results.filter((r) => r.answers?.[qid])
    .map((r) => ({ index: r.index, answer: r.answers[qid], label: b.labels[r.index]?.[qid] ?? null })) : [];
  b.cal.report = null;
  if (!rows.length) return;
  try {
    const report = await api("/api/workbench/calibrate", { rows, signal: b.cal.signal, bound: b.cal.bound });
    if (seq === calSeq) b.cal.report = report;
  } catch (e) { if (seq === calSeq) handleError(e); }
}

function renderCalibrate() {
  const b = W.bulk;
  const c = b.cal;
  const rep = c.report;
  const qids = Object.keys(bulkQuestionsForResult(b.result));
  if (!qids.length) return null;
  const labeled = labeledQids(b);
  const qSel = h("select", { class: "input", "aria-label": "Question to calibrate" },
    qids.map((q) => h("option", { value: q, selected: q === c.qid }, labeled.has(q) ? q : `${q} (no labels)`)));
  qSel.addEventListener("change", async () => { c.qid = qSel.value; await recalibrate(); render(); });
  const sigSel = h("select", { class: "input", "aria-label": "Signal to gate on" },
    Object.entries(SIGNALS).map(([k, label]) => h("option", { value: k, selected: k === c.signal }, `gate on ${label}`)));
  sigSel.addEventListener("change", async () => { c.signal = sigSel.value; await recalibrate(); render(); });
  const head = h("div", { class: "panel-head" }, icon("check"), h("h2", {}, "Calibrate"),
    h("span", { class: "faint", style: { fontSize: "12px" } }, "computed from these answers, no extra calls"), h("div", { class: "spacer" }),
    h("div", { class: "cal-controls" }, qSel, sigSel, boundSelect(c, recalibrate)));
  if (!rep || !rep.labeled) {
    return h("div", { class: "panel", id: "calibrate" }, head,
      h("div", { class: "panel-body grid", style: { gap: "8px", fontSize: "13px" } },
        h("p", { class: "muted" }, `No labels for “${c.qid}” yet. Pick the correct answer in the label column of the table below, or include `, h("code", {}, "\"_expect\""), " in JSON rows and run again."),
        rep?.invalid?.length ? invalidNote(rep) : null));
  }
  const slider = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: c.threshold, id: "cal-slider", class: "cal-slider", "aria-label": `Minimum ${SIGNALS[c.signal]} to act automatically` });
  slider.addEventListener("input", () => { c.threshold = Number(slider.value); updateCal(); });
  const setThreshold = (t) => { c.threshold = t; updateCal(); };
  const n = rep.labeled;
  return h("div", { class: "panel", id: "calibrate" }, head,
    h("div", { class: "panel-body grid", style: { gap: "14px" } },
      h("div", { class: "stat-row" },
        stat("labeled", `${n} rows`),
        stat("accuracy, every row", withCI(pct(rep.accuracy), rep.accuracy_low, rep.accuracy_high), true),
        stat("calibration gap (ECE)", rep.ece === null ? "—" : `${(rep.ece * 100).toFixed(1)} pts`)),
      h("div", { class: "cal-gate" },
        h("label", { for: "cal-slider" }, `Act automatically when ${SIGNALS[c.signal]} ≥ `, h("b", { id: "cal-value", class: "mono" })),
        slider),
      h("div", { id: "cal-stats", class: "stat-row" }),
      h("div", { class: "chips" }, rep.targets.map((t) => t.threshold === null
        ? h("button", { class: "chip", disabled: true }, unreached(t, rep.bound, n))
        : h("button", { class: "chip", onclick: () => setThreshold(t.threshold), title: `${pct(t.accuracy, 1)} accurate on ${t.automated} rows; 95% interval ${interval(t.low, t.high)}` },
          `${targetName(t.target, rep.bound)} → ≥ ${t.threshold.toFixed(2)}, automates ${pct(t.coverage)}`))),
      h("div", { class: "cal-chart-wrap" },
        h("div", { class: "cal-legend" },
          h("span", {}, h("i", { class: "cal-key cov" }), "Automated: share of labeled rows that clear the threshold"),
          h("span", {}, h("i", { class: "cal-key acc" }), "Accuracy of those automated rows"),
          h("span", {}, h("i", { class: "cal-key band" }), "95% interval for that accuracy")),
        h("div", { id: "cal-chart" }),
        h("div", { class: "cal-tip", id: "cal-tip", hidden: true })),
      h("details", {}, h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } }, "Sweep as a table"),
        h("div", { class: "scroll" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "threshold"), h("th", {}, "automated"), h("th", {}, "share"), h("th", {}, "accuracy"), h("th", {}, "95% interval"))),
          h("tbody", {}, rep.sweep.filter((p) => Math.round(p.threshold * 100) % 5 === 0).map((p) => h("tr", {},
            h("td", { class: "mono" }, p.threshold.toFixed(2)), h("td", {}, `${p.automated} of ${n}`), h("td", {}, pct(p.coverage)),
            h("td", {}, p.accuracy === null ? "—" : pct(p.accuracy)), h("td", {}, interval(p.low, p.high) || "—"))))))),
      h("div", { id: "cal-cost", class: "grid", style: { gap: "10px" } }),
      h("div", { id: "cal-slices", class: "grid", style: { gap: "8px" } }, sliceBody("cal")),
      holdoutPanel(c, "cal-holdout", () => [c.qid]),
      h("div", { class: "cal-tables" }, confusionTable(rep), reliabilityTable(rep)),
      h("div", { class: "code" }, h("pre", { id: "cal-code" }),
        h("button", { class: "btn sm copy", onclick: () => copyText($("#cal-code").textContent) }, icon("copy"), "Copy")),
      h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } },
        n < 100 ? h("p", { class: "faint" }, `With ${n} labeled rows, one row moves accuracy by ${(100 / n).toFixed(1)} points. Treat these thresholds as a first look, and label more rows before you rely on one.`) : null,
        h("p", { class: "faint" }, rep.bound === "lower"
          ? "Targets at 95% confidence pick the lowest threshold whose interval starts at or above the target, so a few lucky rows cannot claim it. Showing 90%, 95%, or 99% this way takes at least 35, 73, or 381 automated rows."
          : "The shaded band is a 95% interval (Wilson): the accuracies these rows are consistent with. Choose targets at 95% confidence to require the band's lower edge to reach the target."),
        rep.unlabeled ? h("p", { class: "faint" }, `${rep.unlabeled} answered rows have no label for “${c.qid}” and are not scored.`) : null,
        rep.invalid.length ? invalidNote(rep) : null,
        h("p", { class: "faint" }, rep.type === "noul"
          ? "A Noul has no confidence field; Calibrate uses |2p − 1|, so 0.40 is the docs' starting band of P(yes) ≥ 0.7 or ≤ 0.3. Right means P(yes) ≥ 0.5 agrees with the label."
          : rep.type === "score" ? "Right means the most likely level equals the labeled level." : "Right means the selected option equals the label."))));
}

function invalidNote(rep) {
  return h("p", { style: { color: "var(--critical-text)", fontSize: "12.5px" } },
    `${rep.invalid.length} labels ignored: `, rep.invalid.slice(0, 4).map((x) => `row ${x.index + 1}: ${x.reason}`).join("; "),
    rep.invalid.length > 4 ? "…" : "");
}

function confusionTable(rep) {
  const max = Math.max(1, ...rep.confusion.flat());
  return h("div", { class: "scroll" },
    h("h3", { class: "cal-h" }, "Confusion: label ↓, Jev's answer →"),
    h("table", { class: "table confusion" },
      h("thead", {}, h("tr", {}, h("th", {}), rep.classes.map((k) => h("th", {}, k)))),
      h("tbody", {}, rep.classes.map((k, i) => h("tr", {}, h("th", {}, k), rep.confusion[i].map((count, j) => h("td", {
        class: i === j ? "diag" : "",
        title: `label ${k}, answered ${rep.classes[j]}: ${count}`,
        style: count ? { background: `color-mix(in srgb, var(--series) ${Math.round(12 + (count / max) * 40)}%, transparent)` } : {},
      }, count ? String(count) : "·")))))));
}

function reliabilityTable(rep) {
  const noul = rep.type === "noul";
  return h("div", { class: "scroll" },
    h("h3", { class: "cal-h" }, noul ? "When Jev says P(yes) is…, the label is yes…" : "When Jev's top probability is…, it is right…"),
    h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, noul ? "P(yes)" : "top probability"), h("th", {}, "rows"), h("th", {}, "average stated"), h("th", {}, noul ? "label yes" : "right"))),
      h("tbody", {}, rep.reliability.map((bin) => h("tr", {},
        h("td", { class: "mono" }, `${pct(bin.lo)}–${pct(bin.hi)}`), h("td", {}, String(bin.count)), h("td", {}, pct(bin.stated)),
        h("td", {}, `${pct(bin.observed)} (${bin.hits}/${bin.count})`))))));
}

function calCode(rep, qid, signal, t) {
  // Fixed local names: a question id such as "level" must not shadow the answer.
  const key = JSON.stringify(qid);
  if (rep.type === "noul") {
    const hi = Math.max(0.5, signal === "confidence" ? (1 + t) / 2 : t);
    return `p = result.nouls[${key}].noul\nif p >= ${hi.toFixed(3)}:\n    act_on_yes()\nelif p <= ${(1 - hi).toFixed(3)}:\n    act_on_no()\nelse:\n    send_to_review()\n`;
  }
  const field = rep.type === "choice" ? "choices" : "scores";
  const gate = signal === "confidence" ? "answer.confidence"
    : rep.type === "choice" ? "answer.probabilities[answer.choice]" : "max(answer.probabilities.values())";
  if (rep.type === "choice") return `answer = result.${field}[${key}]\nif ${gate} >= ${t.toFixed(2)}:\n    act_on(answer.choice)\nelse:\n    send_to_review()\n`;
  // Calibrate scored the most likely level, so the gate acts on that level, not the weighted .score.
  return `answer = result.${field}[${key}]\nlevel = int(max(answer.probabilities, key=answer.probabilities.get))\nif ${gate} >= ${t.toFixed(2)}:\n    act_on(level)\nelse:\n    send_to_review()\n`;
}

// Refresh the parts that follow the threshold without rebuilding the slider under the pointer.
function updateCal() {
  const b = W.bulk;
  const c = b.cal;
  const rep = c.report;
  if (!rep || !rep.labeled || !$("#cal-stats")) return;
  const t = c.threshold;
  const p = rep.sweep[Math.round(t * 100)];
  const slider = $("#cal-slider");
  if (slider && Number(slider.value) !== t) slider.value = t;
  mount("#cal-value", t.toFixed(2));
  const all = Object.values(rep.signals);
  const autoAll = all.filter((v) => v + 1e-9 >= t).length;
  mount("#cal-stats",
    stat("automated", `${p.automated} of ${rep.labeled} · ${pct(p.coverage)}`, true),
    stat("accuracy when automated", p.accuracy === null ? "—" : withCI(pct(p.accuracy, 1), p.low, p.high)),
    stat("wrong but automated", String(p.automated - p.correct)),
    stat("sent to review", String(rep.labeled - p.automated)),
    stat("this run, all rows", `${autoAll} of ${all.length} automated`));
  mount("#cal-chart", calChart(rep, t));
  updateCalCost();
  sliceSoon.cal();
  $("#cal-code").textContent = calCode(rep, c.qid, c.signal, t);
  if (b.review.report && b.review.asked !== t) reviewSoon();  // Label next ranks rows by their distance to t
  for (const tr of $$("#bulk-table tbody tr")) {
    const signal = rep.signals[tr.dataset.index];
    const cell = $("td.route", tr);
    if (!cell) continue;
    if (signal === undefined) { mount(cell); tr.classList.remove("below"); continue; }
    const auto = signal + 1e-9 >= t;
    tr.classList.toggle("below", !auto);
    mount(cell, auto ? statusBadge("execute", "Auto") : statusBadge("review"), h("span", { class: "faint mono", style: { marginLeft: "6px", fontSize: "11px" } }, signal.toFixed(2)));
  }
}

function calChart(rep, t) {
  // Drawn at the container's pixel width so text and strokes stay their real size.
  const W_ = Math.max(320, Math.round($("#cal-chart")?.clientWidth || 640)), H_ = 250, m = { l: 42, r: 14, t: 12, b: 40 };
  const iw = W_ - m.l - m.r, ih = H_ - m.t - m.b;
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - v) * ih;
  const line = (key) => {
    let d = "", pen = false;
    for (const p of rep.sweep) {
      if (p[key] === null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(p.threshold).toFixed(1)},${y(p[key]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  // The interval as one closed shape per run of thresholds that automate at least one row.
  const band = () => {
    let d = "";
    let run = [];
    const flush = () => {
      if (run.length) {
        d += run.map((q, i) => `${i ? "L" : "M"}${x(q.threshold).toFixed(1)},${y(q.high).toFixed(1)}`).join("");
        d += run.slice().reverse().map((q) => `L${x(q.threshold).toFixed(1)},${y(q.low).toFixed(1)}`).join("") + "Z";
      }
      run = [];
    };
    for (const q of rep.sweep) { if (q.low === null) flush(); else run.push(q); }
    flush();
    return d;
  };
  const p = rep.sweep[Math.round(t * 100)];
  const grid = [0, 0.5, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v))]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, v.toFixed(2)));
  const marks = [];
  const labels = [];
  const right = t > 0.62;
  const anchor = right ? "end" : "start";
  const lx = x(t) + (right ? -10 : 10);
  const yc = y(p.coverage);
  const ya = p.accuracy === null ? null : y(p.accuracy);
  let lyc = yc, lya = ya;
  if (ya !== null && Math.abs(ya - yc) < 15) { const mid = (ya + yc) / 2; const up = ya <= yc; lya = mid + (up ? -8 : 8); lyc = mid + (up ? 8 : -8); }
  marks.push(svg("circle", { cx: x(t), cy: yc, r: 4, class: "cal-dot cov" }));
  labels.push(svg("text", { x: lx, y: lyc + 4, "text-anchor": anchor, class: "cal-label" }, `${pct(p.coverage)} automated`));
  if (ya !== null) {
    marks.push(svg("circle", { cx: x(t), cy: ya, r: 4, class: "cal-dot acc" }));
    labels.push(svg("text", { x: lx, y: lya + 4, "text-anchor": anchor, class: "cal-label" }, `${pct(p.accuracy)} accurate`));
  }
  const hair = svg("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: "cal-hair", visibility: "hidden" });
  const hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "cal-hit" });
  const root = svg("svg", { viewBox: `0 0 ${W_} ${H_}`, width: W_, height: H_, class: "cal-chart", role: "img",
    "aria-label": `Automated share and accuracy by threshold. At ${t.toFixed(2)}: ${pct(p.coverage)} automated, ${p.accuracy === null ? "none" : `${pct(p.accuracy)} accurate, 95% interval ${interval(p.low, p.high)}`}.` },
  grid, ticks,
  svg("text", { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" }, `${SIGNALS[W.bulk.cal.signal]} threshold`),
  svg("path", { d: band(), class: "cal-band" }),
  svg("line", { x1: x(t), x2: x(t), y1: m.t, y2: m.t + ih, class: "cal-marker" }),
  svg("path", { d: line("coverage"), class: "cal-line cov" }),
  svg("path", { d: line("accuracy"), class: "cal-line acc" }),
  hair, marks, labels, hit);
  const at = (e) => {
    const box = root.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W_;
    return Math.min(1, Math.max(0, Math.round(((px - m.l) / iw) * 100) / 100));
  };
  hit.addEventListener("pointermove", (e) => {
    const v = at(e);
    const q = rep.sweep[Math.round(v * 100)];
    hair.setAttribute("x1", x(v)); hair.setAttribute("x2", x(v)); hair.setAttribute("visibility", "visible");
    const tip = $("#cal-tip");
    const wrap = tip.parentElement.getBoundingClientRect();
    mount(tip,
      h("div", { class: "faint mono" }, `threshold ${v.toFixed(2)}`),
      h("div", {}, h("i", { class: "cal-key cov" }), h("b", {}, pct(q.coverage)), ` automated (${q.automated})`),
      h("div", {}, h("i", { class: "cal-key acc" }), h("b", {}, q.accuracy === null ? "—" : pct(q.accuracy)), " accurate"),
      q.low === null ? null : h("div", {}, h("i", { class: "cal-key band" }), `95% interval ${interval(q.low, q.high)}`),
      h("div", { class: "faint" }, "click to set"));
    tip.hidden = false;
    const left = e.clientX - wrap.left + 14;
    tip.style.left = `${Math.min(left, wrap.width - 190)}px`;
    tip.style.top = `${e.clientY - wrap.top + 10}px`;
  });
  hit.addEventListener("pointerleave", () => { hair.setAttribute("visibility", "hidden"); $("#cal-tip").hidden = true; });
  hit.addEventListener("click", (e) => { W.bulk.cal.threshold = at(e); updateCal(); });
  return root;
}

// ---------- Costs ----------
// Accuracy targets ask "how often is it right?"; an application pays for reviews and for mistakes. The prices here
// are shared by Calibrate, Policy, and Holdout, which ask jev/cost.py for the cheapest thresholds. No model calls.
const MAX_PRICE = 1e6;
const MAX_MISTAKES = 100;
const perK = (v) => money(v);

// The prices as the server takes them, or the reason they cannot be used yet.
function costsPayload() {
  const c = W.bulk.costs;
  const price = (text) => {
    const t = String(text).trim();
    const v = Number(t);
    return t !== "" && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE ? v : null;
  };
  const review = price(c.review), error = price(c.error);
  if (review === null || error === null) return { costs: null, problem: "Enter each price as a number from 0 to 1,000,000." };
  const seen = new Set();
  const mistakes = [];
  for (const m of c.mistakes) {
    const v = price(m.cost);
    if (v === null) return { costs: null, problem: "Enter each mistake's price as a number from 0 to 1,000,000." };
    if (m.label === m.answer) return { costs: null, problem: `${m.question}: a mistake's answer must differ from its label.` };
    const key = JSON.stringify([m.question, m.label, m.answer]);
    if (seen.has(key)) return { costs: null, problem: `${m.question}: label ${m.label} answered ${m.answer} is priced twice.` };
    seen.add(key);
    mistakes.push({ question: m.question, label: m.label, answer: m.answer, cost: v });
  }
  return { costs: { review, error, mistakes }, problem: null };
}

let calCostSeq = 0;
async function costCalibrate() {
  const b = W.bulk;
  const qid = b.cal.qid;
  const seq = ++calCostSeq;
  b.cal.cost = null;
  const { costs } = costsPayload();
  if (!qid || !costs || !GATEABLE.has(bulkQuestionsForResult(b.result)[qid]?.type)) return;
  try {
    const rep = await api("/api/workbench/cost", { rows: policyRows([qid]), questions: [qid], signal: b.cal.signal, costs });
    if (seq === calCostSeq) b.cal.cost = rep;
  } catch (e) { if (seq === calCostSeq) handleError(e); }
}

// Prices changed: every cost and both unseen-row checks are stale. Update in place so the field being typed in keeps focus.
const recost = debounce(async () => {
  const b = W.bulk;
  clearHoldout(b.cal);
  clearHoldout(b.policy);
  for (const [state, id, qids] of [[b.cal, "cal-holdout", () => [b.cal.qid]], [b.policy, "pol-holdout", () => Object.keys(activeGates())]]) {
    if ($(`#${id}`)) mount(`#${id}`, ...holdoutView(state, id, qids));
  }
  await Promise.all([costCalibrate(), recheapPolicy(), rescorePolicy()]);
  updateCal();
  updatePolicy();
}, 250);

function costChanged() {
  const { problem } = costsPayload();
  if ($("#costs-note")) mount("#costs-note", ...costsNote(problem));
  recost();
}

function costsNote(problem) {
  if (problem) return [h("span", { style: { color: "var(--critical-text)" } }, problem)];
  const { costs } = costsPayload();
  if (!costs.error) return ["Mistakes cost nothing at these prices, so automating every row is cheapest."];
  const even = Math.max(0, 1 - costs.review / costs.error);
  return [`Automating a row pays when it is right more than `, h("b", {}, pct(even, 1)), ` of the time: 1 − ${money(costs.review)} ÷ ${money(costs.error)}. `,
    "Calibrate and Policy find the threshold where the reviews saved outweigh the mistakes made."];
}

function priceInput(value, label, onInput) {
  const inp = h("input", { class: "input mono cost-input", type: "number", min: 0, max: MAX_PRICE, step: "any", value, "aria-label": label });
  inp.addEventListener("input", () => { onInput(inp.value); costChanged(); });
  return h("span", { class: "cost-field" }, "$", inp);
}

function renderCosts() {
  if (!policyQids(W.bulk.result).length) return null;
  return h("div", { class: "panel", id: "costs" }, ...costsBody());
}

function costsBody() {
  const b = W.bulk;
  const c = b.costs;
  const qids = policyQids(b.result);
  const types = bulkQuestionsForResult(b.result);
  const remount = () => { mount("#costs", ...costsBody()); costChanged(); };
  const mistakeRow = (m, i) => {
    const classes = answerClasses(types[m.question]);
    const qSel = h("select", { class: "input", "aria-label": `Question for priced mistake ${i + 1}` }, qids.map((q) => h("option", { value: q, selected: q === m.question }, q)));
    qSel.addEventListener("change", () => {
      const next = answerClasses(types[qSel.value]);
      Object.assign(m, { question: qSel.value, label: next[0], answer: next[1] ?? next[0] });
      remount();
    });
    const pick = (key, label) => {
      const sel = h("select", { class: "input", "aria-label": `${label} for priced mistake ${i + 1}` }, classes.map((k) => h("option", { value: k, selected: k === m[key] }, k)));
      sel.addEventListener("change", () => { m[key] = sel.value; remount(); });
      return sel;
    };
    return h("div", { class: "cost-mistake" },
      qSel, h("span", { class: "faint" }, "labeled"), pick("label", "Label"), h("span", { class: "faint" }, "answered"), pick("answer", "Answer"),
      priceInput(m.cost, `Price of mistake ${i + 1}`, (v) => { m.cost = v; }),
      m.label === m.answer ? h("span", { style: { color: "var(--critical-text)", fontSize: "12px" } }, "label and answer match: not a mistake") : null,
      h("button", { class: "btn sm ghost", title: "Remove this price", onclick: () => { c.mistakes.splice(i, 1); remount(); } }, "Remove"));
  };
  const add = () => {
    const q = qids.includes(b.cal.qid) ? b.cal.qid : qids[0];
    const classes = answerClasses(types[q]);
    const { costs } = costsPayload();
    c.mistakes.push({ question: q, label: classes[0], answer: classes[1] ?? classes[0], cost: String((costs?.error ?? 20) * 2) });
    remount();
  };
  const usable = c.mistakes.filter((m) => m.label !== m.answer);
  return [
    h("div", { class: "panel-head" }, icon("check"), h("h2", {}, "Costs"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "what a review and a mistake cost you, no extra calls")),
    h("div", { class: "panel-body grid", style: { gap: "10px", fontSize: "13px" } },
      h("div", { class: "cost-prices" },
        h("label", {}, "A person reviewing a row costs ", priceInput(c.review, "Cost of one review", (v) => { c.review = v; })),
        h("label", {}, "Acting on a wrong answer costs ", priceInput(c.error, "Cost of one wrong automated answer", (v) => { c.error = v; }))),
      h("p", { class: "muted", id: "costs-note" }, ...costsNote(costsPayload().problem)),
      h("details", { open: c.mistakes.length > 0 },
        h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } },
          `Price specific mistakes${usable.length ? ` · ${usable.length}` : ""}: some wrong answers cost more than others`),
        h("div", { class: "grid", style: { gap: "8px", marginTop: "8px" } },
          c.mistakes.map(mistakeRow),
          h("div", {}, h("button", { class: "btn sm", disabled: c.mistakes.length >= MAX_MISTAKES, onclick: add }, "Add a priced mistake")),
          h("p", { class: "faint", style: { fontSize: "12px" } }, "A wrong answer without its own price costs the default above. A Policy row with several wrong answers costs its most expensive one. The prices here are examples: replace them with yours."))))];
}

// "$1,240.00 · saves $760.00 against review" for a measured cost, given the report's baselines.
function costVs(m, rep) {
  const saved = rep.review_all.per_1000 - m.per_1000;
  return [perK(m.per_1000), h("span", { class: "ci" }, saved >= 0 ? ` saves ${perK(saved)} vs reviewing all` : ` ${perK(-saved)} more than reviewing all`)];
}

function cheapestChip(rep, apply) {
  if (!rep || !rep.labeled || !rep.best) return null;
  const best = rep.best;
  if (!best.gates) {
    return h("button", { class: "chip", disabled: true, title: "Every threshold costs more on these rows than sending every row to a person" },
      `Lowest cost: review every row, ${perK(best.per_1000)} per 1,000`);
  }
  return h("button", { class: "chip", onclick: () => apply(best.gates),
    title: `${best.wrong} wrong of ${best.automated} automated; ${perK(rep.review_all.per_1000)} per 1,000 rows if every row is reviewed` },
  `Lowest cost → ${gatesText(best.gates)}, ${perK(best.per_1000)} per 1,000 rows, automates ${pct(best.coverage)}`);
}

// Calibrate's cost view: the cost at the slider's threshold, the cheapest threshold, and the cost at every threshold.
function updateCalCost() {
  const c = W.bulk.cal;
  const rep = c.cost;
  if (!$("#cal-cost")) return;
  const { problem } = costsPayload();
  if (problem) return mount("#cal-cost", h("p", { class: "faint", style: { fontSize: "12.5px" } }, "Costs: ", problem));
  if (!rep || !rep.labeled || !rep.sweep) return mount("#cal-cost");
  const t = c.threshold;
  const p = rep.sweep[Math.round(t * 100)];
  mount("#cal-cost",
    h("h3", { class: "cal-h" }, `Cost at ${money(rep.review)} a review and ${money(rep.error)} a mistake${rep.mistakes.length ? `, ${rep.mistakes.length} priced separately` : ""}`),
    h("div", { class: "stat-row" },
      stat(`cost per 1,000 rows at ≥ ${t.toFixed(2)}`, costVs(p, rep), true),
      stat("review every row", perK(rep.review_all.per_1000)),
      stat("automate every row", perK(rep.automate_all.per_1000))),
    h("div", { class: "chips" }, cheapestChip(rep, (gates) => { c.threshold = Object.values(gates)[0]; updateCal(); })),
    h("div", { class: "cal-chart-wrap" },
      h("div", { class: "cal-legend" },
        h("span", {}, h("i", { class: "cal-key cost" }), "Cost per 1,000 rows at each threshold"),
        h("span", {}, h("i", { class: "cal-key ref" }), "Review every row")),
      costChart(rep, t)),
    h("details", {}, h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } }, "Cost as a table"),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "threshold"), h("th", {}, "automated"), h("th", {}, "wrong, automated"), h("th", {}, "sent to review"), h("th", {}, "cost per 1,000 rows"))),
        h("tbody", {}, rep.sweep.filter((q) => Math.round(q.threshold * 100) % 5 === 0).map((q) => h("tr", {},
          h("td", { class: "mono" }, q.threshold.toFixed(2)), h("td", {}, `${q.automated} of ${rep.labeled}`), h("td", {}, String(q.wrong)),
          h("td", {}, String(rep.labeled - q.automated)), h("td", { class: "mono" }, perK(q.per_1000)))))))),
    h("p", { class: "faint", style: { fontSize: "12.5px" } },
      "Each labeled row costs a review when the gate sends it to a person, nothing when it is automated and right, and its mistake's price when it is automated and wrong. ",
      "Ties go to the lower threshold. A cost measured on a few dozen rows moves a lot with one mistake; check it on unseen rows below."));
}

function costChart(rep, t) {
  const W_ = Math.max(320, Math.round($("#cal-cost")?.clientWidth || 640)), H_ = 200, m = { l: 64, r: 14, t: 12, b: 34 };
  const iw = W_ - m.l - m.r, ih = H_ - m.t - m.b;
  // A round top (1, 2, 2.5, or 5 times a power of ten) so the axis reads $0, $2,500, $5,000 rather than odd cents.
  const peak = Math.max(0.01, ...rep.sweep.map((q) => q.per_1000), rep.review_all.per_1000);
  const unit = 10 ** Math.floor(Math.log10(peak));
  const top = [1, 2, 2.5, 5, 10].map((f) => f * unit).find((v) => v >= peak);
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - v / top) * ih;
  const d = rep.sweep.map((q, i) => `${i ? "L" : "M"}${x(q.threshold).toFixed(1)},${y(q.per_1000).toFixed(1)}`).join("");
  const p = rep.sweep[Math.round(t * 100)];
  const best = rep.best;
  const bestT = best?.gates ? Object.values(best.gates)[0] : null;
  const grid = [0, 0.5, 1].map((f) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(top * f), y2: y(top * f), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(top * f) + 3.5, "text-anchor": "end", class: "cal-axis" },
      `$${(top * f).toLocaleString("en-US", { maximumFractionDigits: top < 10 ? 2 : 0 })}`)]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, v.toFixed(2)));
  const right = t > 0.62;
  const hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "cal-hit" });
  const root = svg("svg", { viewBox: `0 0 ${W_} ${H_}`, width: W_, height: H_, class: "cal-chart", role: "img", id: "cal-cost-chart",
    "aria-label": `Cost per 1,000 rows by threshold. At ${t.toFixed(2)}: ${perK(p.per_1000)}. Reviewing every row: ${perK(rep.review_all.per_1000)}.${bestT === null ? " Reviewing every row is cheapest." : ` Lowest at ${bestT.toFixed(2)}: ${perK(best.per_1000)}.`}` },
  grid, ticks,
  svg("line", { x1: m.l, x2: W_ - m.r, y1: y(rep.review_all.per_1000), y2: y(rep.review_all.per_1000), class: "cost-ref" }),
  svg("line", { x1: x(t), x2: x(t), y1: m.t, y2: m.t + ih, class: "cal-marker" }),
  svg("path", { d, class: "cal-line cost" }),
  bestT === null ? null : svg("circle", { cx: x(bestT), cy: y(best.per_1000), r: 3.5, class: "cost-best" }),
  svg("circle", { cx: x(t), cy: y(p.per_1000), r: 4, class: "cal-dot cost" }),
  svg("text", { x: x(t) + (right ? -10 : 10), y: y(p.per_1000) - 8, "text-anchor": right ? "end" : "start", class: "cal-label" }, `${perK(p.per_1000)} per 1,000`),
  hit);
  hit.addEventListener("click", (e) => {
    const box = root.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W_;
    W.bulk.cal.threshold = Math.min(1, Math.max(0, Math.round(((px - m.l) / iw) * 100) / 100));
    updateCal();
  });
  return root;
}

// ---------- Review labels ----------
// Every accuracy above rests on the labels. This panel lists the labels worth a second look, across every
// question, and the unlabeled rows worth labeling next for Calibrate's question at its threshold. The server
// ranks them (jev/review.py); no model calls. "Label is right" hides a disagreement until its label changes.
const REVIEW_SHOWN = 8;
let reviewSeq = 0;
async function rereview() {
  const b = W.bulk;
  const qids = policyQids(b.result);
  const seq = ++reviewSeq;  // only the latest request may install its report
  if (!qids.length) { b.review.report = null; return; }
  const question = qids.includes(b.cal.qid) ? b.cal.qid : null;
  b.review.asked = b.cal.threshold;  // the latest request's threshold, so a slider move back to an older one still re-ranks
  try {
    const report = await api("/api/workbench/review", { rows: policyRows(qids), question, threshold: b.cal.threshold, signal: b.cal.signal });
    if (seq === reviewSeq) b.review.report = report;
  } catch (e) { if (seq === reviewSeq) { b.review.report = null; handleError(e); } }
}
// The threshold moved: re-rank Label next in place, without rebuilding the slider under the pointer.
const reviewSoon = debounce(async () => { await rereview(); if ($("#review")) mount("#review", ...reviewBody()); }, 250);

function renderReview() {
  if (!policyQids(W.bulk.result).length) return null;
  return h("div", { class: "panel", id: "review-panel" },
    h("div", { class: "panel-head" }, icon("eye"), h("h2", {}, "Review labels"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "computed from these answers, no extra calls")),
    h("div", { class: "panel-body grid", id: "review", style: { gap: "16px" } }, ...reviewBody()));
}

function reviewBody() {
  const b = W.bulk;
  const rep = b.review.report;
  if (!rep) return [h("p", { class: "faint", style: { fontSize: "13px" } }, "Review appears once the answers can be read.")];
  return [checkLabels(rep), labelNext(rep)];
}

// Show the first few rows of a ranked list, with a toggle for the rest.
function moreToggle(key, total) {
  const all = W.bulk.review.all;
  if (total <= REVIEW_SHOWN) return null;
  return h("button", { class: "btn sm ghost", onclick: () => { all[key] = !all[key]; mount("#review", ...reviewBody()); } },
    all[key] ? `Show the first ${REVIEW_SHOWN}` : `Show all ${total}`);
}

function checkLabels(rep) {
  const b = W.bulk;
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r]));
  const counts = Object.values(rep.questions);
  const labeled = counts.reduce((n, q) => n + q.labeled, 0);
  const invalid = counts.reduce((n, q) => n + q.invalid, 0);
  const kept = rep.suspects.filter((s) => b.review.kept.has(`${s.index}:${s.question}`)).length;
  const open = rep.suspects.filter((s) => !b.review.kept.has(`${s.index}:${s.question}`));
  const strong = open.filter((s) => s.strong).length;
  const head = h("h3", { class: "cal-h" }, `Check labels · ${open.length} ${open.length === 1 ? "disagreement" : "disagreements"}`,
    strong ? h("span", { class: "badge warning", style: { marginLeft: "8px" } }, `${strong} likely label ${strong === 1 ? "error" : "errors"}`) : null);
  const note = (text) => h("p", { class: "muted", style: { fontSize: "13px" } }, text);
  if (!labeled) return h("div", { class: "grid", style: { gap: "6px" } }, head, note(invalid
    ? `${invalid === 1 ? "The one label is not" : `None of the ${invalid} labels is`} a valid answer for its question, so nothing can be checked. Calibrate lists the reasons; fix the labels in the table below.`
    : "No labels yet. Label rows in the table below, or include \"_expect\" in JSON rows, and the answers that disagree with their labels appear here."));
  const summary = h("p", { class: "faint", style: { fontSize: "12.5px" } },
    `Checked ${labeled} ${labeled === 1 ? "label" : "labels"} across ${counts.filter((q) => q.labeled).length} of ${counts.length} questions`,
    kept ? `; you kept ${kept} as right` : "", invalid ? `; ${invalid} ${invalid === 1 ? "label is" : "labels are"} not valid answers and ${invalid === 1 ? "was" : "were"} skipped` : "", ".");
  if (!open.length) return h("div", { class: "grid", style: { gap: "6px" } }, head, note(rep.suspects.length ? "Every remaining labeled answer agrees with its label." : "Every labeled answer agrees with its label."), summary);
  const shown = b.review.all.suspects ? open : open.slice(0, REVIEW_SHOWN);
  return h("div", { class: "grid", style: { gap: "6px" } }, head,
    note(`Answers that disagree with their label, lowest probability on the label first. When Jev gave the label ${pct(rep.strong_at)} or less, the label is often the mistake, or the question reads differently to Jev than to you. One wrong label on a confident answer counts against accuracy at every threshold. Fix the label, or keep it if it is right.`),
    h("div", { class: "scroll" }, h("table", { class: "table review-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "question"), h("th", {}, "Jev's answer"),
        h("th", { title: "The probability Jev gave the label" }, "P(label)"), h("th", { title: `Jev's ${SIGNALS[rep.signal]} in its own answer` }, SIGNALS[rep.signal]),
        h("th", {}, "label"), h("th", {}))),
      h("tbody", {}, shown.map((s) => {
        const r = rowsBy.get(s.index);
        return h("tr", {},
          h("td", { class: "num" }, String(s.index + 1)),
          h("td", { class: "row" }, rowText(r.row)),
          h("td", { class: "mono" }, s.question),
          h("td", {}, h("span", { class: "cell-choice" }, s.answer)),
          h("td", { class: "mono" }, pct(s.label_probability, 1), s.strong ? h("span", { class: "badge warning", style: { marginLeft: "6px" }, title: `Jev gave this label ${pct(rep.strong_at)} or less` }, "check first") : null),
          h("td", { class: "mono" }, s.signal.toFixed(2)),
          h("td", {}, labelSelect(r, s.question)),
          h("td", {}, h("button", { class: "btn sm ghost", title: "Hide this disagreement until its label changes",
            onclick: () => { b.review.kept.add(`${s.index}:${s.question}`); mount("#review", ...reviewBody()); } }, "Label is right")));
      })))),
    h("div", {}, moreToggle("suspects", open.length)), summary);
}

function labelNext(rep) {
  const b = W.bulk;
  const qid = rep.question;
  const head = h("h3", { class: "cal-h" }, qid ? `Label next · ${qid}` : "Label next");
  const note = (text) => h("p", { class: "muted", style: { fontSize: "13px" } }, text);
  if (!qid) return h("div", { class: "grid", style: { gap: "6px" } }, head, note("Choose a Choice, Noul, or Score question in Calibrate to rank its unlabeled rows."));
  if (!rep.next.length) return h("div", { class: "grid", style: { gap: "6px" } }, head, note(`Every answered row has a label for “${qid}”.`));
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r]));
  const shown = b.review.all.next ? rep.next : rep.next.slice(0, REVIEW_SHOWN);
  const t = rep.threshold.toFixed(2);
  return h("div", { class: "grid", style: { gap: "6px" } }, head,
    note(`${rep.next.length} answered ${rep.next.length === 1 ? "row has" : "rows have"} no label for “${qid}”. Those nearest Calibrate's threshold, ${SIGNALS[rep.signal]} ≥ ${t}, come first: just above it they are automated now, and just below it they would be if the threshold dropped, so their labels decide whether it can move. Moving the slider re-ranks them.`),
    h("div", { class: "scroll" }, h("table", { class: "table review-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "Jev's answer"), h("th", {}, SIGNALS[rep.signal]), h("th", {}, `at ≥ ${t}`), h("th", {}, "label"))),
      h("tbody", {}, shown.map((x) => {
        const r = rowsBy.get(x.index);
        return h("tr", {},
          h("td", { class: "num" }, String(x.index + 1)),
          h("td", { class: "row" }, rowText(r.row)),
          h("td", {}, h("span", { class: "cell-choice" }, x.answer), h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, pct(x.top))),
          h("td", { class: "mono" }, x.signal.toFixed(2)),
          h("td", {}, x.above ? statusBadge("execute", "Auto") : statusBadge("review")),
          h("td", {}, labelSelect(r, qid)));
      })))),
    h("div", {}, moreToggle("next", rep.next.length)));
}

// ---------- Policy ----------
// Gates several questions at once: a row is automated only when every gated answer clears its threshold, and
// right only when every gated answer matches its label. The server scores it (jev/policy.py); no model calls.
const MAX_GATES = 10;
const GATEABLE = new Set(["choice", "noul", "score"]);

function policyQids(res) {
  return Object.entries(bulkQuestionsForResult(res)).filter(([, a]) => GATEABLE.has(a.type)).map(([q]) => q);
}
function resetPolicy() {
  const b = W.bulk;
  const qids = policyQids(b.result);
  const labeled = labeledQids(b);
  const pick = qids.filter((q) => labeled.has(q));
  const on = new Set((pick.length ? pick : qids).slice(0, MAX_GATES));
  clearHoldout(b.policy);  // a check still running for the previous Bulk run must not install its report
  b.policy = { ...b.policy, report: null, tunes: null,
    gates: Object.fromEntries(qids.map((q) => [q, { on: on.has(q), t: b.policy.gates[q]?.t ?? 0.5 }])) };
}
function activeGates() {
  return Object.fromEntries(Object.entries(W.bulk.policy.gates).filter(([, g]) => g.on).map(([q, g]) => [q, g.t]));
}
function policyRows(qids) {
  const b = W.bulk;
  return b.result.results.filter((r) => r.answers).map((r) => ({
    index: r.index,
    key: rowText(r.row),  // the row's input names it for Holdout's folds, so a rerun or reorder keeps the split
    answers: Object.fromEntries(qids.filter((q) => r.answers[q]).map((q) => [q, r.answers[q]])),
    labels: Object.fromEntries(qids.filter((q) => b.labels[r.index]?.[q] !== undefined).map((q) => [q, b.labels[r.index][q]])),
  }));
}
let polSeq = 0;
async function rescorePolicy() {
  const p = W.bulk.policy;
  const gates = activeGates();
  const seq = ++polSeq;  // only the latest request may install its report
  if (!Object.keys(gates).length) { p.report = null; p.cost = null; return; }
  const costs = costsPayload().costs;
  try {
    const rows = policyRows(Object.keys(gates));
    const [report, cost] = await Promise.all([
      api("/api/workbench/policy", { rows, gates, signal: p.signal }),
      costs ? api("/api/workbench/cost", { rows, questions: Object.keys(gates), gates, signal: p.signal, costs, tune: false }) : null]);
    if (seq === polSeq) { p.report = report; p.cost = cost; }
  } catch (e) { if (seq === polSeq) { p.report = null; p.cost = null; handleError(e); } }
}
let tuneSeq = 0;
async function retunePolicy() {
  const p = W.bulk.policy;
  const qids = Object.keys(activeGates());
  const seq = ++tuneSeq;
  p.tunes = null;
  if (!qids.length) return;
  try {
    const tunes = await api("/api/workbench/policy/tune", { rows: policyRows(qids), questions: qids, signal: p.signal, bound: p.bound });
    if (seq === tuneSeq) p.tunes = tunes;
  } catch (e) { if (seq === tuneSeq) handleError(e); }
}
// The cheapest thresholds for the checked gates. Separate from Tune: prices change without the targets changing.
let cheapSeq = 0;
async function recheapPolicy() {
  const p = W.bulk.policy;
  const qids = Object.keys(activeGates());
  const costs = costsPayload().costs;
  const seq = ++cheapSeq;
  p.cheapest = null;
  if (!qids.length || !costs) return;
  try {
    const rep = await api("/api/workbench/cost", { rows: policyRows(qids), questions: qids, signal: p.signal, costs });
    if (seq === cheapSeq) p.cheapest = rep;
  } catch (e) { if (seq === cheapSeq) handleError(e); }
}
// Gates, labels, or the signal changed: both the report and the tuned thresholds are stale. Tuning can take a
// moment on many rows and gates, so its chips fill in when it finishes instead of holding up the report.
async function repolicy() {
  clearHoldout(W.bulk.policy);
  retunePolicy().then(updatePolicy);
  recheapPolicy().then(updatePolicy);
  await rescorePolicy();
}
const rescoreSoon = debounce(async () => { await rescorePolicy(); updatePolicy(); }, 120);

function renderPolicy() {
  const b = W.bulk;
  const p = b.policy;
  const qids = policyQids(b.result);
  if (!qids.length) return null;
  const labeled = labeledQids(b);
  const types = bulkQuestionsForResult(b.result);
  const nOn = Object.keys(activeGates()).length;
  const sigSel = h("select", { class: "input", "aria-label": "Signal every gate reads" },
    Object.entries(SIGNALS).map(([k, label]) => h("option", { value: k, selected: k === p.signal }, `gate on ${label}`)));
  sigSel.addEventListener("change", async () => { p.signal = sigSel.value; await repolicy(); render(); });
  const gateRow = (q, i) => {
    const g = p.gates[q];
    const box = h("input", { type: "checkbox", checked: g.on, disabled: !g.on && nOn >= MAX_GATES, id: `pol-on-${i}` });
    box.addEventListener("change", async () => { g.on = box.checked; await repolicy(); render(); });
    const slider = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: g.t, class: "cal-slider", disabled: !g.on,
      id: `pol-t-${i}`, "aria-label": `Minimum ${SIGNALS[p.signal]} for ${q}` });
    slider.addEventListener("input", () => { g.t = Number(slider.value); mount(`#pol-v-${i}`, g.t.toFixed(2)); rescoreSoon(); });
    return h("div", { class: `pol-gate${g.on ? "" : " off"}` },
      h("label", { for: `pol-on-${i}`, class: "pol-check" }, box, h("span", { class: "mono" }, q),
        h("span", { class: "faint" }, ` ${types[q].type}${labeled.has(q) ? "" : ", no labels"}`)),
      slider, h("b", { class: "mono", id: `pol-v-${i}` }, g.t.toFixed(2)));
  };
  return h("div", { class: "panel", id: "policy" },
    h("div", { class: "panel-head" }, icon("arrow"), h("h2", {}, "Policy"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "every gated answer must clear its threshold, no extra calls"), h("div", { class: "spacer" }),
      h("div", { class: "cal-controls" }, sigSel, boundSelect(p, () => { clearHoldout(p); return retunePolicy().then(updatePolicy); }))),
    h("div", { class: "panel-body grid", style: { gap: "14px" } },
      h("p", { class: "muted", style: { fontSize: "13px" } }, "An application usually acts on an item only when every answer it uses is confident. Check the questions your code acts on and set a threshold for each. A row is automated when all of them clear, and it counts as right only when all of them match their labels."),
      h("div", { class: "pol-gates" }, qids.map(gateRow)),
      nOn ? null : h("p", { class: "muted" }, "Check at least one question to gate."),
      h("div", { id: "pol-tunes", class: "chips" }),
      h("div", { id: "pol-out", class: "grid", style: { gap: "14px" } }),
      nOn ? holdoutPanel(p, "pol-holdout", () => Object.keys(activeGates())) : null,
      h("div", { id: "pol-check", class: "holdout" })));
}

function policyCode(rep) {
  const signal = rep.signal;
  const lines = ["def held_by(result):", '    """The gated questions that are unsure about this result. An empty list means act on it."""',
    "    # 1e-9 absorbs float rounding, so a signal equal to its threshold clears it, as in the Workbench.", "    held = []"];
  for (const q of rep.questions) {
    const key = JSON.stringify(q.qid);
    let gate;
    if (q.type === "noul") {
      const p = `result.nouls[${key}].noul`;
      gate = signal === "confidence" ? `abs(2 * ${p} - 1)` : `max(${p}, 1 - ${p})`;
    } else if (q.type === "choice") {
      gate = signal === "confidence" ? `result.choices[${key}].confidence` : `result.choices[${key}].probabilities[result.choices[${key}].choice]`;
    } else {
      gate = signal === "confidence" ? `result.scores[${key}].confidence` : `max(result.scores[${key}].probabilities.values())`;
    }
    lines.push(`    if ${gate} + 1e-9 < ${q.threshold.toFixed(2)}:`, `        held.append(${key})`);
  }
  lines.push("    return held", "", "", "held = held_by(result)", "if not held:", "    act_on(result)", "else:", "    send_to_review(result, held)");
  return `${lines.join("\n")}\n`;
}

function policyBar(rep) {
  const n = rep.labeled;
  const seg = (count, cls, label) => (count ? h("i", { class: `pol-seg ${cls}`, style: { width: pct(count / n, 2) }, title: `${label}: ${count}` }) : null);
  const wrong = rep.automated - rep.correct;
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("div", { class: "pol-bar", role: "img", "aria-label": `${rep.correct} automated and right, ${wrong} automated and wrong, ${rep.review} sent to review, of ${n} labeled rows` },
      seg(rep.correct, "right", "automated, right"), seg(wrong, "wrong", "automated, wrong"), seg(rep.review, "review", "sent to review")),
    h("div", { class: "cal-legend" },
      h("span", {}, h("i", { class: "pol-key right" }), `Automated, right · ${rep.correct}`),
      h("span", {}, h("i", { class: "pol-key wrong" }), `Automated, wrong · ${wrong}`),
      h("span", {}, h("i", { class: "pol-key review" }), `Sent to review · ${rep.review}`)));
}

function policyTable(rep) {
  return h("div", { class: "scroll" }, h("table", { class: "table" },
    h("thead", {}, h("tr", {}, h("th", {}, "question"), h("th", {}, "threshold"), h("th", {}, "right, every row"),
      h("th", { title: "Labeled rows this gate sends to review" }, "holds for review"), h("th", { title: "Rows that only this gate holds: lowering it automates them" }, "holds alone"),
      h("th", { title: "Automated rows where this answer is wrong" }, "wrong while automated"))),
    h("tbody", {}, rep.questions.map((q) => h("tr", {},
      h("td", { class: "mono" }, q.qid), h("td", { class: "mono" }, q.threshold.toFixed(2)),
      h("td", {}, q.accuracy === null ? "—" : withCI(pct(q.accuracy), q.accuracy_low, q.accuracy_high)), h("td", {}, String(q.holds)), h("td", {}, String(q.only)),
      h("td", {}, String(q.wrong_automated)))))));
}

function policyMistakes(rep) {
  const wrong = rep.rows.filter((r) => r.automated && !r.correct);
  if (!wrong.length) return null;
  const rowsBy = new Map(W.bulk.result.results.map((r) => [r.index, r.row]));
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("h3", { class: "cal-h" }, `Automated but wrong · ${wrong.length}: your code would act on these with a wrong answer`),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "wrong answers"))),
      h("tbody", {}, wrong.slice(0, 12).map((r) => h("tr", {},
        h("td", { class: "num" }, String(r.index + 1)),
        h("td", { class: "row", style: { maxWidth: "380px" } }, rowText(rowsBy.get(r.index))),
        h("td", {}, r.wrong.map((q) => {
          const a = r.answers[q];
          return h("div", { style: { fontSize: "12.5px" } }, h("span", { class: "mono" }, q), `: answered ${a.answer}, label ${a.label} `,
            h("span", { class: "faint mono" }, `(${a.signal.toFixed(2)})`));
        }))))))),
    wrong.length > 12 ? h("p", { class: "faint", style: { fontSize: "12px" } }, `…and ${wrong.length - 12} more.`) : null);
}

// Refresh everything that follows the thresholds without rebuilding the sliders under the pointer.
function updatePolicy() {
  const p = W.bulk.policy;
  if (!$("#pol-out")) return;
  const rep = p.report;
  const tunes = p.tunes;
  // Targets that tune to the same thresholds share one chip. Unreached targets keep their own, since each needs different rows.
  const groups = [];
  for (const t of tunes && tunes.labeled ? tunes.targets : []) {
    const key = t.gates === null ? `none-${t.target}` : JSON.stringify(t.gates);
    const same = groups.find((g) => g.key === key);
    if (same) same.targets.push(t.target); else groups.push({ key, targets: [t.target], tune: t });
  }
  const lower = tunes?.bound === "lower";
  mount("#pol-tunes", groups.map(({ targets, tune: t }) => {
    const label = targets.map((x) => pct(x)).join(", ");
    return t.gates === null
      ? h("button", { class: "chip", disabled: true }, unreached(t, tunes.bound, tunes.labeled))
      : h("button", { class: "chip", title: `${pct(t.accuracy, 1)} accurate on ${t.automated} rows; 95% interval ${interval(t.low, t.high)}`, onclick: async () => {
        for (const [q, v] of Object.entries(t.gates)) p.gates[q].t = v;
        await rescorePolicy();
        render();
      } }, `Tune for ${label}${lower ? " at 95% confidence" : ""} → automates ${pct(t.coverage)}`);
  }), cheapestChip(p.cheapest, async (gates) => {
    for (const [q, v] of Object.entries(gates)) p.gates[q].t = v;
    await rescorePolicy();
    render();
  }));
  if (!rep) { mount("#pol-check"); return mount("#pol-out"); }
  const n = rep.labeled;
  mount("#pol-check", ...(n ? checkSaveBody(rep) : []));
  if (n) sliceSoon.pol();
  const notes = [
    n && n < 100 ? h("p", { class: "faint" }, `With ${n} labeled rows, one row moves accuracy by ${(100 / n).toFixed(1)} points. Tuned thresholds fit these rows; confirm them on more labeled rows before you rely on them.`) : null,
    rep.unlabeled ? h("p", { class: "faint" }, `${rep.unlabeled} answered rows lack a label for at least one gated question and are not scored.`) : null,
    rep.skipped ? h("p", { class: "faint" }, `${rep.skipped} rows have no readable answer to a gated question and are left out.`) : null,
    rep.invalid.length ? invalidNote(rep) : null,
    h("p", { class: "faint" }, `Tuning raises whichever threshold drops the most wrong rows per row it drops, until the target holds${p.bound === "lower" ? " at 95% confidence" : ""}, then re-chooses thresholds two at a time while that automates more rows. With one or two gated questions it finds the best thresholds on 0.01 steps; with more it is a search, not a guarantee.`),
  ];
  const code = h("div", { class: "code" }, h("pre", { id: "pol-code" }, policyCode(rep)),
    h("button", { class: "btn sm copy", onclick: () => copyText($("#pol-code").textContent) }, icon("copy"), "Copy"));
  if (!n) {
    return mount("#pol-out",
      h("div", { class: "stat-row" }, stat("this run, all rows", `${rep.routed_automated} of ${rep.routed} automated`, true)),
      h("p", { class: "muted", style: { fontSize: "13px" } }, "No row is labeled for every gated question yet, so accuracy is unknown. Label rows in the table below or uncheck questions without labels."),
      code,
      h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, notes));
  }
  mount("#pol-out",
    h("div", { class: "stat-row" },
      stat("automated", `${rep.automated} of ${n} · ${pct(rep.coverage)}`, true),
      stat("accuracy when automated", rep.accuracy === null ? "—" : withCI(pct(rep.accuracy, 1), rep.accuracy_low, rep.accuracy_high)),
      stat("all gated answers right, every row", withCI(pct(rep.accuracy_all), rep.accuracy_all_low, rep.accuracy_all_high)),
      stat("wrong but automated", String(rep.automated - rep.correct)),
      p.cost?.current ? stat("cost per 1,000 rows", costVs(p.cost.current, p.cost)) : null,
      stat("this run, all rows", `${rep.routed_automated} of ${rep.routed} automated`)),
    policyBar(rep),
    policyTable(rep),
    policyMistakes(rep),
    h("div", { id: "pol-slices", class: "grid", style: { gap: "8px" } }, sliceBody("pol")),
    code,
    h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, notes));
}

// ---------- Slices ----------
// Accuracy for each value of one row field (jev/slices.py), so a part of the data where answers are worse stands out.
// Calibrate slices its scored rows at the slider's threshold; Policy slices its scored rows at the current gates.
// No model calls. The section keeps its last table while a newer one is on its way.
const sliceSeq = { cal: 0, pol: 0 };
function sliceRows(kind) {
  const b = W.bulk;
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r.row]));
  if (kind === "cal") {
    const rep = b.cal.report;
    if (!rep?.labeled) return null;
    return rep.rows.map((r) => ({ row: rowsBy.get(r.index), correct: r.correct, automated: r.signal + 1e-9 >= b.cal.threshold }));
  }
  const rep = b.policy.report;
  if (!rep?.labeled) return null;
  return rep.rows.map((r) => ({ row: rowsBy.get(r.index), correct: r.correct, automated: r.automated }));
}
async function reslice(kind) {
  const b = W.bulk;
  const seq = ++sliceSeq[kind];
  const rows = sliceRows(kind);
  let report = null;
  if (rows) {
    try { report = await api("/api/workbench/slices", { rows, field: b.slice.field }); }
    catch (e) { if (seq === sliceSeq[kind]) handleError(e); }
  }
  if (seq !== sliceSeq[kind]) return;
  b.slice[kind] = report;
  const el = $(`#${kind}-slices`);
  if (el) mount(el, sliceBody(kind));
}
const sliceSoon = { cal: debounce(() => reslice("cal"), 150), pol: debounce(() => reslice("pol"), 150) };

function sliceBody(kind) {
  const b = W.bulk;
  const rep = b.slice[kind];
  if (!rep) return null;
  const title = h("h3", { class: "cal-h" }, kind === "cal" ? "By slice, at this threshold" : "By slice, at these gates");
  if (!rep.field) {
    return [title, h("p", { class: "faint", style: { fontSize: "12.5px" } }, "No field of these rows has 2 to 20 values to compare. Give JSON rows a field such as ",
      h("code", {}, "\"channel\""), " or ", h("code", {}, "\"language\""), ", for example a column kept by Import CSV, to see accuracy for each value.")];
  }
  const sel = h("select", { class: "input", "aria-label": "Field to slice by", style: { width: "auto" } },
    rep.fields.map((f) => h("option", { value: f.name, selected: f.name === rep.field }, `${f.name} (${f.values} values)`)));
  sel.addEventListener("change", () => { b.slice.field = sel.value; reslice("cal"); reslice("pol"); });
  const o = rep.overall;
  const acc = (v, lo, hi) => (v === null ? "—" : withCI(pct(v, 1), lo, hi));
  const mark = (s) => {
    const both = s.below && s.below_all;
    if (!s.below && !s.below_all) return null;
    const what = both ? "Worse than the rest" : s.below ? "Worse when automated" : "Worse over every row";
    const ps = [s.below ? `automated rows p = ${s.p.toFixed(3)}` : null, s.below_all ? `every row p = ${s.p_all.toFixed(3)}` : null].filter(Boolean).join(", ");
    return h("span", { class: "badge warning", title: `One-sided Fisher exact test against every other slice together: ${ps}` }, what);
  };
  const marked = rep.slices.filter((s) => s.below || s.below_all).length;
  return [
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, title, sel),
    h("div", { class: "scroll" }, h("table", { class: "table slices" },
      h("thead", {}, h("tr", {}, h("th", {}, rep.field), h("th", {}, "rows"), h("th", {}, "accuracy, every row"), h("th", {}, "automated"),
        h("th", {}, "accuracy when automated"), h("th", {}, "wrong but automated"), h("th", {}))),
      h("tbody", {}, rep.slices.map((s) => h("tr", { class: s.below || s.below_all ? "slice-below" : "" },
        h("td", {}, h("code", {}, s.value)), h("td", { class: "num" }, String(s.rows)),
        h("td", {}, acc(s.accuracy, s.accuracy_low, s.accuracy_high)),
        h("td", {}, `${s.automated} · ${pct(s.coverage)}`),
        h("td", {}, acc(s.automated_accuracy, s.automated_low, s.automated_high)),
        h("td", { class: "num" }, String(s.wrong_automated)), h("td", {}, mark(s)))),
        h("tr", { class: "slice-all" }, h("td", {}, h("b", {}, "all")), h("td", { class: "num" }, String(o.rows)),
          h("td", {}, acc(o.accuracy, o.accuracy_low, o.accuracy_high)), h("td", {}, `${o.automated} · ${pct(o.coverage)}`),
          h("td", {}, acc(o.automated_accuracy, o.automated_low, o.automated_high)), h("td", { class: "num" }, String(o.wrong_automated)), h("td", {}))))),
    h("p", { class: "faint", style: { fontSize: "12px" } }, marked
      ? "A marked slice is right less often than every other slice together, by more than chance explains (one-sided Fisher exact test, p < 0.05). Even a slice that is no worse is marked about one time in twenty, so with several slices, label more rows of a marked one before acting on it."
      : "No slice is worse than the rest by more than chance explains (one-sided Fisher exact test, p < 0.05). Small slices rarely show a difference, so this does not show every slice is as accurate."),
  ];
}

// ---------- Holdout ----------
// Calibrate's shortcuts and Policy's Tune choose thresholds from the rows they then report on. Holdout
// (jev/holdout.py) cross-validates that choice: each fifth of the labeled rows is routed by thresholds tuned on
// the other four fifths. No model calls. It runs on request, because many gates over many rows take seconds,
// and clears whenever the question, gates, labels, signal, or target basis change.
function clearHoldout(state) {
  state.holdout = null;
  state.holdoutSeq += 1;  // a check still running for the old inputs must not install its report
}

function holdoutPanel(state, id, qids) {
  const box = h("div", { id, class: "holdout" });
  box.append(...holdoutView(state, id, qids));
  return box;
}

// Reads the question, signal, and target basis when the check starts: a control can change before the panel re-renders.
async function runHoldout(state, id, qids) {
  const seq = ++state.holdoutSeq;
  const questions = qids();
  state.holdout = { running: true };
  mount(`#${id}`, ...holdoutView(state, id, qids));
  try {
    const { costs } = costsPayload();
    const report = await api("/api/workbench/holdout", { rows: policyRows(questions), questions, signal: state.signal, bound: state.bound, ...(costs ? { costs } : {}) });
    if (seq !== state.holdoutSeq) return;
    state.holdout = report;
  } catch (e) {
    if (seq !== state.holdoutSeq) return;
    state.holdout = null;
    handleError(e);
  }
  mount(`#${id}`, ...holdoutView(state, id, qids));
}

// "≥ 0.72" for one question; "dept ≥ 0.60 · refund ≥ 0.40" for several.
function gatesText(gates) {
  const entries = Object.entries(gates);
  return entries.length === 1 ? `≥ ${entries[0][1].toFixed(2)}` : entries.map(([q, t]) => `${q} ≥ ${t.toFixed(2)}`).join(" · ");
}
function spreadText(spread) {
  const entries = Object.entries(spread);
  const one = ([lo, hi]) => (lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`);
  return entries.length === 1 ? one(entries[0][1]) : entries.map(([q, r]) => `${q} ${one(r)}`).join(" · ");
}

function holdoutView(state, id, qids) {
  const rep = state.holdout;
  const title = h("h3", { class: "cal-h" }, "Check on unseen rows");
  if (!rep || rep.running) {
    const btn = h("button", { class: "btn sm", disabled: Boolean(rep?.running), onclick: () => runHoldout(state, id, qids) },
      rep?.running ? [h("span", { class: "spin" }), " Checking…"] : "Check on unseen rows");
    return [h("div", { class: "holdout-head" }, btn,
      h("span", { class: "faint" }, "Tunes on four fifths of the labeled rows and routes the fifth it never saw, five times. Shows what these targets deliver on new rows. No extra calls."))];
  }
  if (!rep.targets.length) {
    return [title, h("p", { class: "muted", style: { fontSize: "13px" } },
      `Needs at least ${rep.minimum} labeled rows to hold some out (${rep.labeled} labeled).`)];
  }
  const lower = rep.bound === "lower";
  const row = (t) => {
    const u = t.unseen;
    return h("tr", {},
      h("td", {}, targetName(t.target, rep.bound)),
      h("td", {}, t.tuned
        ? [h("span", { class: "mono" }, gatesText(t.tuned.gates)), h("div", { class: "faint" }, `automates ${pct(t.tuned.coverage)} · ${pct(t.tuned.accuracy, 1)} accurate`)]
        : h("span", { class: "faint" }, "not reached")),
      h("td", {}, u.accuracy === null
        ? h("span", { class: "faint" }, "automates none")
        : [withCI(`${pct(u.accuracy, 1)} accurate`, u.low, u.high), h("div", { class: "faint" }, `automates ${pct(u.coverage)} (${u.automated} of ${rep.labeled})`)],
        t.below ? h("div", {}, statusBadge("review", "Below target")) : null),
      h("td", { class: "mono" }, t.gap === null ? "—" : `${t.gap > 0 ? "−" : t.gap < 0 ? "+" : ""}${Math.abs(t.gap * 100).toFixed(1)} pts`),
      h("td", {}, t.spread ? h("span", { class: "mono" }, spreadText(t.spread)) : "—",
        t.unreached ? h("div", { class: "faint" }, `${t.unreached} of ${rep.folds} folds could not reach it`) : null));
  };
  return [title,
    h("div", { class: "scroll" }, h("table", { class: "table holdout-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "target"),
        h("th", { title: "Thresholds tuned on every labeled row, measured on those same rows" }, "tuned on these rows"),
        h("th", { title: "Each row routed by thresholds tuned without it, pooled over the folds" }, "on unseen rows"),
        h("th", { title: "From accuracy on these rows to accuracy on unseen rows; a drop is negative" }, "change"),
        h("th", { title: "The thresholds each fold's tuning chose" }, "thresholds across folds"))),
      h("tbody", {}, rep.targets.map(row), rep.cost ? costRow(rep) : null))),
    h("p", { class: "faint", style: { fontSize: "12.5px" } },
      `Each of ${rep.folds} folds was tuned${lower ? " at 95% confidence" : ""} on the other labeled rows, then routed its own rows, which its thresholds never saw. `,
      "Accuracy that drops on unseen rows, or thresholds that swing between folds, mean the tuned thresholds fit these rows more than the question: label more rows before you rely on them. ",
      "The interval treats the held-out rows as independent, which cross-validation only approximates.",
      rep.cost ? ` The lowest-cost row searches each fold for its cheapest thresholds at ${money(rep.cost.review_cost)} a review and ${money(rep.cost.error)} a mistake; its change is in cost per 1,000 rows, and a rise is worse.` : "")];
}

// Holdout's lowest-cost row: the cheapest thresholds on every row, then what each fold's cheapest thresholds cost on rows they never saw.
function costRow(rep) {
  const c = rep.cost;
  const u = c.unseen;
  const t = c.tuned;
  return h("tr", {},
    h("td", {}, "lowest cost"),
    h("td", {}, t.gates
      ? [h("span", { class: "mono" }, gatesText(t.gates)), h("div", { class: "faint" }, `${money(t.per_1000)} per 1,000 rows · automates ${pct(t.coverage)}`)]
      : [h("span", { class: "faint" }, "review every row"), h("div", { class: "faint" }, `${money(t.per_1000)} per 1,000 rows`)]),
    h("td", {}, `${money(u.per_1000)} per 1,000 rows`,
      h("div", { class: "faint" }, u.automated ? `automates ${pct(u.coverage)} (${u.automated} of ${rep.labeled}) · ${pct(u.accuracy, 1)} accurate` : "automates none"),
      c.worse ? h("div", {}, statusBadge("review", "Costs more than reviewing every row")) : null),
    h("td", { class: "mono" }, `${c.gap > 0 ? "+" : c.gap < 0 ? "−" : ""}${money(Math.abs(c.gap))}`),
    h("td", {}, c.spread ? h("span", { class: "mono" }, spreadText(c.spread)) : "—",
      c.review_folds ? h("div", { class: "faint" }, `${c.review_folds} of ${rep.folds} folds chose to review every row`) : null));
}

// ---------- Compare ----------
// Two variants, each a question set and a model, over the Bulk rows. The server makes one call per
// row and variant; scoring a question (jev/compare.py) reuses those answers and makes no calls.
const VARIANTS = ["A", "B"];

function parseVariant(i) {
  const name = VARIANTS[i];
  const text = W.compare.variants[i].text.trim();
  if (!text) throw new Error(`Variant ${name} has no questions`);
  let questions;
  try { questions = JSON.parse(text); } catch (e) { throw new Error(`Variant ${name}: invalid JSON (${e.message})`); }
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) throw new Error(`Variant ${name}: questions must be an object keyed by question id`);
  return questions;
}

function variantStatus(i) {
  try {
    const n = Object.keys(parseVariant(i)).length;
    return h("span", { class: "faint" }, `${n} question${n === 1 ? "" : "s"}`);
  } catch (e) { return h("span", { style: { color: "var(--critical-text)" } }, e.message); }
}

// Model suggestions come from GET /v1/models for the connected key; any name can still be typed.
function loadModels() {
  const c = W.compare;
  if (c.models || c.modelsLoading || !currentStatus()?.configured) return;
  c.modelsLoading = true;
  api("/api/models").then((res) => {
    c.models = (res.models || []).map((m) => m.name);
    const list = $("#cmp-models");
    if (list) mount(list, c.models.map((n) => h("option", { value: n })));
  }).catch(() => { c.models = []; /* typing a name still works */ }).finally(() => { c.modelsLoading = false; });
}

function variantPanel(i) {
  const v = W.compare.variants[i];
  const name = VARIANTS[i];
  const area = h("textarea", { class: "input", spellcheck: "false", "aria-label": `Variant ${name} questions as JSON` }, v.text);
  const note = h("div", { style: { fontSize: "12px" } }, variantStatus(i));
  area.addEventListener("input", () => { v.text = area.value; mount(note, variantStatus(i)); });
  const model = h("input", { class: "input", list: "cmp-models", value: v.model, spellcheck: "false", "aria-label": `Variant ${name} model`,
    placeholder: `Current model (${currentStatus()?.model || "jev-latest"})` });
  model.addEventListener("input", () => { v.model = model.value; });
  const set = (questions) => { v.text = JSON.stringify(questions, null, 2); render(); };
  return h("div", { class: "panel raw" },
    h("div", { class: "panel-head" }, h("i", { class: `cmp-key ${name.toLowerCase()}` }), h("h2", {}, `Variant ${name}`), h("div", { class: "spacer" }),
      h("div", { class: "chips" },
        h("button", { class: "btn sm ghost", onclick: () => set(toQuestions(W.questions)) }, "Build questions"),
        h("button", { class: "btn sm ghost", onclick: () => set(W.bulk.sampleQuestions) }, "Sample"),
        h("button", { class: "btn sm ghost", onclick: () => set(W.compare.terse) }, "Sample, terse"),
        i === 1 ? h("button", { class: "btn sm ghost", onclick: () => { v.text = W.compare.variants[0].text; render(); } }, "Copy A") : null)),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("label", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, h("span", { class: "muted" }, "Model"), model),
      area, note));
}

const runLabel = (n) => [icon("layers"), `Run ${Math.min(n, 200)} rows × 2 variants`];

function renderCompare() {
  const c = W.compare;
  const b = W.bulk;
  loadModels();
  const count = h("h2", {}, `Rows · ${countRows(b.rowsText)}`);
  // Disabled from state, not on the button alone: a render during a run must not offer a second paid run.
  const runBtn = h("button", { class: "btn primary", id: "cmp-run", onclick: runCompare, disabled: c.running },
    c.running ? [h("span", { class: "spin" }), " Running both variants…"] : runLabel(countRows(b.rowsText)));
  const rows = h("textarea", { class: "input", spellcheck: "false", "aria-label": "Rows, shared with the Bulk tab" }, b.rowsText);
  rows.addEventListener("input", () => {
    b.rowsText = rows.value;
    const n = countRows(b.rowsText);
    count.textContent = `Rows · ${n}`;
    if (!c.running) mount(runBtn, runLabel(n));
  });
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("p", { class: "muted", style: { maxWidth: "820px" } }, "Change one thing and measure it: reword a question, trim its criteria, or switch the model. Both variants answer the same labeled rows, and the report shows which one was right more often, how far to trust each one's confidence, and the rows where they disagree."),
    h("div", { class: "grid cmp-grid" }, variantPanel(0), variantPanel(1)),
    h("datalist", { id: "cmp-models" }, (c.models || []).map((n) => h("option", { value: n }))),
    h("div", { class: "grid wb-grid" },
      h("div", { class: "panel bulk" },
        h("div", { class: "panel-head" }, count, h("span", { class: "faint", style: { fontSize: "12px" } }, "shared with Bulk"), h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: loadSampleRows }, "Load sample rows")),
        h("div", { class: "panel-body" }, rows)),
      h("div", { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", {}, "Run both")),
        h("div", { class: "panel-body grid", style: { gap: "10px", fontSize: "12.5px" } },
          h("p", { class: "muted" }, "Each row is sent once per variant, so 40 rows make 80 live calls. They run 8 at a time and count against the session budget. The report scores both variants only on rows both answered, so a stopped run or a failed call cannot tilt the comparison."),
          h("p", { class: "muted" }, "Labels come from ", h("code", {}, "\"_expect\""), " in the rows. To label in the browser, use the label column on the Bulk tab, then ", h("b", {}, "Keep labels in rows"), ". Only question ids that both variants share, with the same type, are compared."),
          h("div", {}, runBtn)))),
    c.result ? renderCompareReport() : null,
    c.result && c.report ? renderCompareRows() : null);
}

async function runCompare() {
  const c = W.compare;
  let variants;
  try { variants = VARIANTS.map((_, i) => ({ questions: parseVariant(i), model: c.variants[i].model.trim() })); }
  catch (e) { return toast(e.message, "error"); }
  if (c.running) return;
  c.running = true;
  render();
  let done = false;
  try {
    c.result = await api("/api/workbench/compare", { rows: rowsPayload(), variants });
    c.qid = chooseCmpQuestion();
    await rescoreCompare();
    if (c.result.stopped) toast(c.result.stopped, "error");
    done = true;
  } catch (e) { handleError(e); } finally {
    c.running = false;
    render();
  }
  if (done && W.tab === "compare") $("#compare-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Question ids both variants asked with the same type, in A's order.
function cmpQuestions(res) {
  const [qa, qb] = res.variants.map((v) => v.questions);
  return Object.keys(qa).filter((q) => qb[q] && qb[q].type === qa[q].type);
}
function cmpLabeled(res) {
  const qids = new Set();
  for (const r of res.results) for (const q of Object.keys(r.expect || {})) qids.add(q);
  return qids;
}
function chooseCmpQuestion() {
  const c = W.compare;
  const qids = cmpQuestions(c.result);
  const labeled = cmpLabeled(c.result);
  if (qids.includes(c.qid) && (labeled.has(c.qid) || !labeled.size)) return c.qid;
  return qids.find((q) => labeled.has(q)) || qids[0] || null;
}

let cmpSeq = 0;
async function rescoreCompare() {
  const c = W.compare;
  const qid = c.qid;
  const seq = ++cmpSeq;  // only the latest request may install its report
  c.report = null;
  c.reportError = null;
  if (!qid) return;
  const rows = c.result.results.filter((r) => r.runs.some((run) => run.answers?.[qid]))
    .map((r) => ({ index: r.index, label: r.expect?.[qid] ?? null, answers: r.runs.map((run) => run.answers?.[qid] ?? null),
      meta: r.runs.map((run) => (run.meta ? { cost_usd: run.meta.cost_usd, latency_ms: run.meta.latency_ms } : null)) }));
  if (!rows.length) return;
  try {
    const report = await api("/api/workbench/compare/score", { rows, signal: c.signal, first: c.first, bound: c.bound });
    if (seq === cmpSeq) {
      c.report = report;
      // Start where the cascade first matches the second variant. When the first variant matches it
      // alone, or nothing does, start at the most accurate point instead.
      const cas = report.cascade;
      if (cas) c.cascadeT = (cas.match?.escalated ? cas.match : cas.best).threshold;
    }
  } catch (e) { if (seq === cmpSeq) c.reportError = e.message; }
}

// Index of the better of two numbers, or -1 for a tie or a missing value.
function better(values, higher = true) {
  const [a, b] = values;
  if (a === null || a === undefined || b === null || b === undefined || Math.abs(a - b) < 1e-9) return -1;
  return (a > b) === higher ? 0 : 1;
}

function summaryRow(label, cells, values = null, higher = true) {
  const win = values ? better(values, higher) : -1;
  return h("tr", {}, h("th", {}, label), cells.map((cell, i) => h("td", {}, i === win ? [h("b", {}, cell), h("span", { class: "faint" }, " · better")] : cell)));
}

function summaryTable(res, rep) {
  const vs = res.variants;
  const rows = [
    summaryRow("model", vs.map((v) => h("span", { class: "mono" }, v.model))),
    summaryRow("questions", vs.map((v) => String(Object.keys(v.questions).length))),
    summaryRow("rows answered", vs.map((v) => `${v.completed} of ${res.rows}${v.errors ? ` · ${v.errors} failed` : ""}`)),
    summaryRow("median latency", vs.map((v) => (v.latency_ms_median === null ? "—" : ms(v.latency_ms_median))), vs.map((v) => v.latency_ms_median), false),
    summaryRow("input tokens", vs.map((v) => num(v.input_tokens)), vs.map((v) => (v.completed ? v.input_tokens / v.completed : null)), false),
    summaryRow("cost", vs.map((v) => usd(v.cost_usd)), vs.map((v) => (v.completed ? v.cost_usd / v.completed : null)), false),
  ];
  const sv = rep?.variants;
  if (sv && sv.some((v) => v.labeled)) {
    rows.push(
      summaryRow(`accuracy · ${W.compare.qid}`, sv.map((v) => (v.accuracy === null ? "—" : withCI(`${pct(v.accuracy, 1)} (${v.correct}/${v.labeled})`, v.accuracy_low, v.accuracy_high))), sv.map((v) => v.accuracy)),
      summaryRow("calibration gap (ECE)", sv.map((v) => (v.ece === null ? "—" : `${(v.ece * 100).toFixed(1)} pts`)), sv.map((v) => v.ece), false));
    (sv[0].targets.length ? sv[0] : sv[1]).targets.forEach((t, k) => {
      const hits = sv.map((v) => v.targets[k]);
      const lower = rep.bound === "lower";
      rows.push(summaryRow(`automates at ${pct(t.target)} accuracy${lower ? ", 95% confidence" : ""}`,
        hits.map((x, i) => (x?.threshold === null || !x ? (lower && sv[i].labeled < t.needed ? `not shown: needs ${t.needed}+ rows` : "not reached") : `${pct(x.coverage)} (≥ ${x.threshold.toFixed(2)})`)),
        hits.map((x) => (x ? x.coverage : null))));
    });
  }
  return h("div", { class: "scroll" }, h("table", { class: "table cmp-table" },
    h("thead", {}, h("tr", {}, h("th", {}), VARIANTS.map((name) => h("th", {}, h("i", { class: `cmp-key ${name.toLowerCase()}` }), `Variant ${name}`)))),
    h("tbody", {}, rows)));
}

function pairedBlock(rep) {
  const p = rep.paired;
  const split = p.a_only + p.b_only;
  let verdict;
  if (!split) {
    verdict = `A and B were right on exactly the same rows, so these labels cannot tell them apart.`;
  } else {
    const lead = p.a_only > p.b_only ? "A" : p.b_only > p.a_only ? "B" : null;
    const chance = p.p_value < 0.001 ? "less than 0.1%" : pct(p.p_value, 1);
    verdict = `On ${split} row${split === 1 ? "" : "s"} exactly one variant was right: A on ${p.a_only}, B on ${p.b_only}. ` +
      `If neither were better, a split at least this uneven would happen ${chance} of the time (exact McNemar test). ` +
      (!lead ? "Neither is ahead on these rows."
        : p.p_value < 0.05 ? `${lead} is ahead, and chance is an unlikely explanation.`
          : `${lead} is ahead, but that could be chance. Label more rows before you switch.`);
  }
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, `Row by row: ${p.rows} labeled rows that both variants answered`),
    h("div", { class: "stat-row" },
      stat("both right", String(p.both_right)), stat("only A right", String(p.a_only), true),
      stat("only B right", String(p.b_only), true), stat("both wrong", String(p.both_wrong))),
    h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px" } }, verdict));
}

function renderCompareReport() {
  const c = W.compare;
  const res = c.result;
  const qids = cmpQuestions(res);
  const labeled = cmpLabeled(res);
  const qSel = h("select", { class: "input", "aria-label": "Question to compare" },
    qids.map((q) => h("option", { value: q, selected: q === c.qid }, labeled.has(q) ? q : `${q} (no labels)`)));
  qSel.addEventListener("change", async () => { c.qid = qSel.value; await rescoreCompare(); render(); });
  const sigSel = h("select", { class: "input", "aria-label": "Signal to gate on" },
    Object.entries(SIGNALS).map(([k, label]) => h("option", { value: k, selected: k === c.signal }, `gate on ${label}`)));
  sigSel.addEventListener("change", async () => { c.signal = sigSel.value; await rescoreCompare(); render(); });
  const rep = c.report;
  const hasLabels = rep && rep.variants.some((v) => v.labeled);
  const use = (i) => h("button", { class: "btn sm", onclick: () => {
    W.questions = fromQuestions(res.variants[i].questions);
    W.result = null;
    W.raw = false;
    W.tab = "build";
    location.hash = "build";
    render();
    toast(`Build now has variant ${VARIANTS[i]}'s questions`);
  } }, `Use ${VARIANTS[i]} in Build`);
  const failures = res.results.flatMap((r) => r.runs.map((run, v) => (run.error ? `row ${r.index + 1} (${VARIANTS[v]}): ${run.error}` : null)).filter(Boolean));
  const notes = [
    failures.length ? h("p", { style: { color: "var(--critical-text)" } }, `${failures.length} calls failed: `, failures.slice(0, 3).join("; "), failures.length > 3 ? "…" : "") : null,
    rep ? rep.variants.map((v, i) => (v.invalid.length ? h("p", { style: { color: "var(--critical-text)" } },
      `${v.invalid.length} labels ignored for ${VARIANTS[i]}: `, v.invalid.slice(0, 3).map((x) => `row ${x.index + 1}: ${x.reason}`).join("; ")) : null)) : null,
    rep && (rep.only_a || rep.only_b) ? h("p", { class: "faint" }, `${rep.only_a + rep.only_b} rows answered by only one variant (A ${rep.only_a}, B ${rep.only_b}) are left out, so both sides are scored on the same rows.`) : null,
    rep?.excluded ? h("p", { class: "faint" }, `${rep.excluded} labels that one variant cannot score are left out of both.`) : null,
    hasLabels && rep.paired.rows < 100 && rep.paired.rows ? h("p", { class: "faint" }, `With ${rep.paired.rows} paired rows, one row moves accuracy by ${(100 / rep.paired.rows).toFixed(1)} points. Pin model versions (for example jev-1.14.0) when you compare wording, so a model update does not change the result.`) : null,
  ];
  let body;
  if (!qids.length) {
    body = h("p", { class: "muted" }, "The variants share no question id with the same type, so there is nothing to compare. Use the same ids in both.");
  } else if (c.reportError) {
    body = h("p", { style: { color: "var(--critical-text)" } }, c.reportError);
  } else {
    body = [
      summaryTable(res, rep),
      !hasLabels ? h("p", { class: "muted" }, `No labels for “${c.qid}”. Add `, h("code", {}, "\"_expect\""), " to the rows to score accuracy; the disagreements below still show where the variants differ.") : null,
      hasLabels ? pairedBlock(rep) : null,
      hasLabels ? h("div", { class: "cal-chart-wrap" },
        h("h3", { class: "cal-h" }, "Accuracy against the share automated, as the threshold moves"),
        h("div", { class: "cal-legend" }, res.variants.map((v, i) => h("span", {}, h("i", { class: `cmp-key ${VARIANTS[i].toLowerCase()}` }), `Variant ${VARIANTS[i]} · ${v.model}`))),
        h("div", { id: "cmp-chart" }),
        h("div", { class: "cal-tip", id: "cmp-tip", hidden: true }),
        h("p", { class: "faint", style: { fontSize: "12px" } }, "Each line starts at the strictest threshold (few rows automated, usually the most accurate) and ends with every row automated. A line that stays higher automates the same share more accurately."),
        cmpSweepTable(rep)) : null,
      hasLabels && rep.cascade ? cascadeBlock(res, rep) : null,
    ];
  }
  return h("div", { class: "panel", id: "compare-report" },
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, "Compare"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "scored from these answers, no extra calls"), h("div", { class: "spacer" }),
      qids.length ? h("div", { class: "cal-controls" }, qSel, sigSel, boundSelect(c, async () => {
        const keep = c.cascadeT;  // the basis changes only the targets, so the cascade keeps its threshold
        await rescoreCompare();
        c.cascadeT = keep;
      })) : null),
    h("div", { class: "panel-body grid", style: { gap: "14px" } },
      h("div", { class: "stat-row" },
        stat("rows", String(res.rows)), stat("labeled", String(res.labeled)),
        stat("wall", ms(res.wall_ms), true), stat("cost, both variants", usd(res.cost_usd))),
      body,
      h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, notes),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, use(0), use(1))));
}

function cmpSweepTable(rep) {
  const [a, b] = rep.variants;
  const cell = (p) => [h("td", {}, `${p.automated} · ${pct(p.coverage)}`), h("td", {}, p.accuracy === null ? "—" : withCI(pct(p.accuracy, 1), p.low, p.high))];
  return h("details", {}, h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } }, "Curves as a table"),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "threshold"), h("th", {}, "A automated"), h("th", {}, "A accuracy"), h("th", {}, "B automated"), h("th", {}, "B accuracy"))),
      h("tbody", {}, a.sweep.filter((p) => Math.round(p.threshold * 100) % 5 === 0).map((p) => h("tr", {},
        h("td", { class: "mono" }, p.threshold.toFixed(2)), cell(p), cell(b.sweep[Math.round(p.threshold * 100)])))))));
}

function renderCompareRows() {
  const c = W.compare;
  const rep = c.report;
  const res = c.result;
  const verdicts = { a_only: ["pass", "A right"], b_only: ["pass", "B right"], both_wrong: ["fail", "Both wrong"] };
  const answer = (x) => h("td", {}, h("span", { class: "cell-choice" }, x.predicted),
    h("span", { class: "faint mono", style: { marginLeft: "6px", fontSize: "11px" } }, x.signal.toFixed(2)),
    x.correct === null ? null : h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, x.correct ? "right" : "wrong"));
  return h("div", { class: "panel", id: "compare-rows" },
    h("div", { class: "panel-head" }, icon("list"), h("h2", {}, `Rows where A and B answer “${c.qid}” differently · ${rep.disagreements.length}`), h("div", { class: "spacer" }),
      h("span", { class: "faint", style: { fontSize: "12px" } }, `${rep.agree} of ${rep.answered_both} rows agree`)),
    rep.disagreements.length
      ? h("div", { class: "scroll" }, h("table", { class: "table bulk-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "label"), h("th", {}, "A"), h("th", {}, "B"), h("th", {}, "result"))),
        h("tbody", {}, rep.disagreements.map((d) => h("tr", {},
          h("td", { class: "num" }, String(d.index + 1)),
          h("td", { class: "row" }, rowText(res.results[d.index]?.row)),
          h("td", {}, d.label ?? h("span", { class: "faint" }, "—")),
          d.answers.map(answer),
          h("td", {}, d.verdict && verdicts[d.verdict] ? statusBadge(...verdicts[d.verdict]) : h("span", { class: "faint" }, "no label")))))))
      : h("div", { class: "panel-body muted" }, "A and B gave the same answer on every row they both answered."));
}

// Accuracy of the automated rows against the share automated: one line per variant, one point per
// distinct automated set (thresholds that automate the same rows give the same point).
function cmpCurve(sweep) {
  const seen = new Map();
  for (const p of sweep) if (p.accuracy !== null && !seen.has(p.automated)) seen.set(p.automated, p);  // lowest threshold first
  return [...seen.values()].sort((x, y) => x.coverage - y.coverage);
}

function updateCmpChart() {
  const rep = W.compare.report;
  if (!rep || !$("#cmp-chart")) return;
  mount("#cmp-chart", cmpChart(rep));
}

function cmpChart(rep) {
  const curves = rep.variants.map((v) => cmpCurve(v.sweep));
  const W_ = Math.max(320, Math.round($("#cmp-chart")?.clientWidth || 640)), H_ = 260, m = { l: 46, r: 30, t: 14, b: 40 };
  const iw = W_ - m.l - m.r, ih = H_ - m.t - m.b;
  const lowest = Math.min(1, ...curves.flat().map((p) => p.accuracy));
  const y0 = Math.max(0, Math.min(0.5, Math.floor(lowest * 10) / 10));  // accuracy lives near the top; zoom to where it is
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - (v - y0) / (1 - y0)) * ih;
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.coverage).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join("");
  const grid = [y0, (y0 + 1) / 2, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v))]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, pct(v)));
  // Direct labels just past each line's end (every row automated), nudged apart when they would touch.
  const ends = curves.map((pts) => pts[pts.length - 1]);
  const ly = ends.map((p) => (p ? y(p.accuracy) : null));
  if (ly[0] !== null && ly[1] !== null && Math.abs(ly[0] - ly[1]) < 14) {
    const mid = (ly[0] + ly[1]) / 2, up = ly[0] <= ly[1];
    ly[0] = mid + (up ? -7 : 7); ly[1] = mid + (up ? 7 : -7);
  }
  const labels = ends.map((p, i) => (p ? svg("text", { x: x(p.coverage) + 7, y: ly[i] + 4, class: "cal-label" }, VARIANTS[i]) : null));
  const lines = curves.map((pts, i) => svg("path", { d: path(pts), class: `cal-line ${VARIANTS[i].toLowerCase()}` }));
  const hair = svg("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: "cal-hair", visibility: "hidden" });
  const dots = curves.map((_, i) => svg("circle", { r: 4, class: `cal-dot ${VARIANTS[i].toLowerCase()}`, visibility: "hidden" }));
  const hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "cal-hit" });
  const summary = rep.variants.map((v, i) => `${VARIANTS[i]}: ${v.accuracy === null ? "no labeled rows" : `${pct(v.accuracy)} accurate with every row automated`}`).join("; ");
  const root = svg("svg", { viewBox: `0 0 ${W_} ${H_}`, width: W_, height: H_, class: "cal-chart", role: "img",
    "aria-label": `Accuracy of automated rows against the share automated, for each variant. ${summary}.` },
  grid, ticks,
  svg("text", { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" }, "share of labeled rows automated"),
  lines, hair, dots, labels, hit);
  const nearest = (pts, v) => pts.reduce((best, p) => (!best || Math.abs(p.coverage - v) < Math.abs(best.coverage - v) ? p : best), null);
  hit.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, ((((e.clientX - box.left) / box.width) * W_) - m.l) / iw));
    hair.setAttribute("x1", x(v)); hair.setAttribute("x2", x(v)); hair.setAttribute("visibility", "visible");
    const near = curves.map((pts) => nearest(pts, v));
    near.forEach((p, i) => {
      if (!p) return dots[i].setAttribute("visibility", "hidden");
      dots[i].setAttribute("cx", x(p.coverage)); dots[i].setAttribute("cy", y(p.accuracy)); dots[i].setAttribute("visibility", "visible");
    });
    const tip = $("#cmp-tip");
    const wrap = tip.parentElement.getBoundingClientRect();
    mount(tip, h("div", { class: "faint mono" }, `about ${pct(v)} automated`),
      near.map((p, i) => (p ? h("div", {}, h("i", { class: `cmp-key ${VARIANTS[i].toLowerCase()}` }), h("b", {}, VARIANTS[i]),
        ` ${pct(p.accuracy, 1)} accurate (${interval(p.low, p.high)}) · ${pct(p.coverage)} automated at ≥ ${p.threshold.toFixed(2)}`) : null)));
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX - wrap.left + 14, wrap.width - 250)}px`;
    tip.style.top = `${e.clientY - wrap.top + 10}px`;
  });
  hit.addEventListener("pointerleave", () => {
    hair.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    $("#cmp-tip").hidden = true;
  });
  return root;
}

// ---------- Cascade ----------
// Ask one variant first and the other only when the first is unsure. Both variants already answered every
// scored row, so jev/compare.py reads each threshold's accuracy, cost, and latency from those answers.
function cascadeSummary(cas, signal) {
  const [f, s] = [cas.first, cas.second];
  const fa = cas.first_alone, sa = cas.second_alone, m = cas.match, b = cas.best;
  const asks = (p) => `${p.escalated} of ${cas.rows} rows (${pct(p.share)})`;
  const parts = [];
  if (m && !m.escalated) {
    parts.push(`${f} alone is already at least as accurate as ${s} on these rows (${pct(fa.accuracy, 1)} against ${pct(sa.accuracy, 1)}).`);
  } else if (m) {
    const cost = m.cost_usd !== null && sa.cost_usd > 0 ? `, for ${pct(m.cost_usd / sa.cost_usd)} of what ${s} alone costs` : "";
    parts.push(`Asking ${s} on the ${asks(m)} where ${f} is least sure matches ${s}'s accuracy, ${pct(sa.accuracy, 1)}${cost}.`);
  } else {
    parts.push(`No threshold reaches ${s}'s accuracy (${pct(sa.accuracy, 1)}): ${f} answers some rows with a ${SIGNALS[signal]} of 1.00, and a cascade always keeps those.`);
  }
  if (b.accuracy > Math.max(fa.accuracy, sa.accuracy) + 1e-9) {
    parts.push(`At ≥ ${b.threshold.toFixed(2)} the cascade is right more often than either variant alone: ${pct(b.accuracy, 1)}, asking ${s} on ${asks(b)}.`);
  }
  return parts.join(" ");
}

function cascadeBlock(res, rep) {
  const c = W.compare;
  const cas = rep.cascade;
  const [f, s] = [cas.first, cas.second];
  const order = h("select", { class: "input", "aria-label": "Variant the cascade asks first" },
    VARIANTS.map((name, i) => h("option", { value: name, selected: name === cas.first }, `${name} first, then ${VARIANTS[1 - i]}`)));
  order.addEventListener("change", async () => { c.first = order.value; await rescoreCompare(); render(); });
  const slider = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: c.cascadeT, id: "cas-slider", class: "cal-slider",
    "aria-label": `Minimum ${SIGNALS[c.signal]} for ${f} to answer alone` });
  slider.addEventListener("input", () => { c.cascadeT = Number(slider.value); updateCascade(); });
  const set = (t) => { c.cascadeT = t; updateCascade(); };
  const m = cas.match, b = cas.best;
  const chips = [
    m?.escalated ? h("button", { class: "chip", onclick: () => set(m.threshold) }, `Match ${s} → ≥ ${m.threshold.toFixed(2)}, asks ${s} on ${pct(m.share)}`)
      : h("button", { class: "chip", disabled: true }, m ? `${f} alone already matches ${s}` : `${s}'s accuracy: not reached on these rows`),
    !m || b.threshold !== m.threshold
      ? h("button", { class: "chip", onclick: () => set(b.threshold) }, `Most accurate, ${pct(b.accuracy, 1)} → ≥ ${b.threshold.toFixed(2)}, asks ${s} on ${pct(b.share)}`) : null,
  ];
  const known = cas.second_alone.cost_usd !== null;
  return h("div", { class: "grid", id: "cascade", style: { gap: "10px" } },
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
      h("h3", { class: "cal-h", style: { margin: 0 } }, `Cascade: ask one variant first, and the other only when it is unsure · ${cas.rows} labeled rows`),
      h("div", { class: "spacer" }), h("div", { class: "cal-controls" }, order)),
    h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px" } }, cascadeSummary(cas, c.signal)),
    h("div", { class: "cal-gate" },
      h("label", { for: "cas-slider" }, `Keep ${f}'s answer when its ${SIGNALS[c.signal]} ≥ `, h("b", { id: "cas-value", class: "mono" })),
      slider),
    h("div", { class: "chips" }, chips),
    h("div", { id: "cas-table", class: "scroll" }),
    h("div", { class: "cal-chart-wrap" },
      h("div", { class: "cal-legend" },
        h("span", {}, h("i", { class: "cal-key cas" }), `Cascade accuracy as more rows go to ${s}`),
        h("span", {}, h("i", { class: `cmp-key ${f.toLowerCase()}` }), `${f} alone`),
        h("span", {}, h("i", { class: `cmp-key ${s.toLowerCase()}` }), `${s} alone`)),
      h("div", { id: "cas-chart" })),
    h("div", { class: "code" }, h("pre", { id: "cas-code" }),
      h("button", { class: "btn sm copy", onclick: () => copyText($("#cas-code").textContent) }, icon("copy"), "Copy")),
    h("p", { class: "faint", style: { fontSize: "12px", maxWidth: "820px" } },
      `Moving the threshold makes no calls. ${known
        ? `Cost counts ${f}'s call on every row and ${s}'s call on each escalated row, and each call asks all of its variant's questions. Latency adds both calls, because the second waits for the first.`
        : "Cost and latency are not shown, because some rows have no usage."}`));
}

function cascadeTable(cas, p) {
  const [f, s] = [cas.first, cas.second];
  const n = cas.rows;
  const row = (label, x, escalated) => h("tr", {}, h("th", {}, label),
    h("td", {}, `${pct(x.accuracy, 1)} (${x.correct}/${n})`), h("td", {}, escalated),
    h("td", {}, x.cost_usd === null ? "—" : usd((x.cost_usd / n) * 1000)), h("td", {}, x.latency_ms === null ? "—" : ms(x.latency_ms)));
  return h("table", { class: "table cmp-table" },
    h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "accuracy"), h("th", {}, `rows sent to ${s}`), h("th", {}, "cost per 1,000 rows"), h("th", {}, "mean latency"))),
    h("tbody", {},
      row(`${f} alone`, cas.first_alone, "none"),
      row(h("b", {}, `Cascade at ≥ ${p.threshold.toFixed(2)}`), p, `${p.escalated} · ${pct(p.share)}`),
      row(`${s} alone`, cas.second_alone, "all")));
}

function cascadeCode(rep, res, t) {
  const cas = rep.cascade;
  const [fi, si] = [VARIANTS.indexOf(cas.first), VARIANTS.indexOf(cas.second)];
  const key = JSON.stringify(W.compare.qid);
  const qs = (i) => `questions_${VARIANTS[i].toLowerCase()}`;
  const call = (i) => `client.system_one(state, ${qs(i)}, model=${JSON.stringify(res.variants[i].model)})`;
  let read, gate;
  if (rep.type === "noul") {
    read = `p = first.nouls[${key}].noul`;
    gate = rep.signal === "confidence" ? "abs(2 * p - 1)" : "max(p, 1 - p)";
  } else {
    read = `answer = first.${rep.type === "choice" ? "choices" : "scores"}[${key}]`;
    gate = rep.signal === "confidence" ? "answer.confidence"
      : rep.type === "choice" ? "answer.probabilities[answer.choice]" : "max(answer.probabilities.values())";
  }
  return `# ${qs(fi)} and ${qs(si)} are variant ${cas.first}'s and ${cas.second}'s questions; Build's Export writes them as Python.\n` +
    `first = ${call(fi)}\n${read}\nif ${gate} + 1e-9 >= ${t.toFixed(2)}:  # the report's tolerance for float rounding\n    result = first\nelse:\n    result = ${call(si)}\n`;
}

// Refresh the parts that follow the cascade threshold without rebuilding the slider under the pointer.
function updateCascade() {
  const c = W.compare;
  const rep = c.report;
  if (!rep?.cascade || !$("#cas-table")) return;
  const t = c.cascadeT;
  const p = rep.cascade.sweep[Math.round(t * 100)];
  const slider = $("#cas-slider");
  if (slider && Number(slider.value) !== t) slider.value = t;
  mount("#cas-value", t.toFixed(2));
  mount("#cas-table", cascadeTable(rep.cascade, p));
  mount("#cas-chart", cascadeChart(rep.cascade, p));
  $("#cas-code").textContent = cascadeCode(rep, c.result, t);
}

// Accuracy against the share of rows sent to the second variant. The line runs from the first variant
// alone (nothing escalated) to the second alone (everything escalated); the dot is the chosen threshold.
function cascadeChart(cas, p) {
  const seen = new Map();
  for (const q of cas.sweep) if (!seen.has(q.escalated)) seen.set(q.escalated, q);  // lowest threshold first
  const pts = [...seen.values()].sort((x, y) => x.share - y.share);
  const W_ = Math.max(320, Math.round($("#cas-chart")?.clientWidth || 640)), H_ = 240, m = { l: 46, r: 18, t: 22, b: 40 };
  const iw = W_ - m.l - m.r, ih = H_ - m.t - m.b;
  const ends = [cas.first_alone.accuracy, cas.second_alone.accuracy];
  const lowest = Math.min(1, ...pts.map((q) => q.accuracy), ...ends);
  const y0 = Math.max(0, Math.min(0.5, Math.floor(lowest * 10) / 10));
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - (v - y0) / (1 - y0)) * ih;
  const grid = [y0, (y0 + 1) / 2, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v))]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, pct(v)));
  const d = pts.map((q, i) => `${i ? "L" : "M"}${x(q.share).toFixed(1)},${y(q.accuracy).toFixed(1)}`).join("");
  const [f, s] = [cas.first.toLowerCase(), cas.second.toLowerCase()];
  const right = p.share > 0.6;
  const root = svg("svg", { viewBox: `0 0 ${W_} ${H_}`, width: W_, height: H_, class: "cal-chart", role: "img",
    "aria-label": `Cascade accuracy against the share of rows sent to ${cas.second}. ${cas.first} alone ${pct(ends[0])}, ${cas.second} alone ${pct(ends[1])}. At ≥ ${p.threshold.toFixed(2)}: ${pct(p.share)} sent, ${pct(p.accuracy)} accurate.` },
  grid, ticks,
  svg("text", { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" }, `share of labeled rows sent to ${cas.second}`),
  svg("line", { x1: x(p.share), x2: x(p.share), y1: m.t, y2: m.t + ih, class: "cal-marker" }),
  svg("path", { d, class: "cal-line cas" }),
  svg("circle", { cx: x(0), cy: y(ends[0]), r: 4, class: `cal-dot ${f}` }),
  svg("circle", { cx: x(1), cy: y(ends[1]), r: 4, class: `cal-dot ${s}` }),
  svg("circle", { cx: x(p.share), cy: y(p.accuracy), r: 5, class: "cal-dot cas" }),
  // Accuracy usually sits near the top, where the line runs flat: label below the dot there, above it lower down.
  svg("text", { x: x(p.share) + (right ? -10 : 10), y: y(p.accuracy) + (y(p.accuracy) < m.t + ih / 2 ? 20 : -9), "text-anchor": right ? "end" : "start", class: "cal-label" },
    `${pct(p.accuracy, 1)} accurate · ${pct(p.share)} sent`));
  return root;
}

// ---------- Examples ----------
function renderExamples() {
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("p", { class: "muted", style: { maxWidth: "760px" } }, `${W.examples.length} starting points, one per pattern. Open any of them in Build to see the exact state and questions, run it, then change the wording and watch the probabilities move.`),
    h("div", { class: "gallery" }, W.examples.map((ex) => h("div", { class: "panel ex" },
      h("div", { class: "pat" }, ex.pattern), h("h3", {}, ex.title), h("p", {}, ex.blurb),
      h("div", { class: "codenote" }, h("b", { style: { color: "var(--muted)" } }, "In code: "), ex.code),
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" } },
        h("button", { class: "btn sm primary", onclick: () => loadInto(ex.state, ex.questions, { expect: ex.expect, example: ex.id, images: ex.images }) }, "Open in Build"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, `${ex.question_count} questions${ex.images ? " · 1 image" : ""}`))))));
}

window.addEventListener("resize", debounce(() => { if (W.tab === "bulk") updateCal(); if (W.tab === "compare") { updateCmpChart(); updateCascade(); } }, 150));
boot().catch(handleError);
