import {
  $, $$, answerCard, api, callStats, copyText, currentStatus, debounce, h, handleError, icon, initChrome, inspect, mount, ms, num,
  pct, photoView, prepareImage, stat, statusBadge, toast, usd,
} from "./common.js";

const W = {
  tab: "build", stateText: "", questions: [], raw: false, result: null, exported: null, exportTab: "python",
  items: [], examples: [], runResults: null, saveOpen: false, expect: {}, saveName: "", saveNotes: "", editingId: null,
  bulk: { rowsText: "", result: null, sortKey: null, sortDir: -1, source: "current", sampleQuestions: null, labels: {},
    cal: { qid: null, signal: "confidence", threshold: 0.5, report: null } },
  compare: { variants: [{ text: "", model: "" }, { text: "", model: "" }], terse: null, models: null, modelsLoading: false,
    running: false, result: null, qid: null, signal: "confidence", report: null, reportError: null, first: "A", cascadeT: 0.5 },
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
  const [ex, items, sample, pics] = await Promise.all([api("/api/workbench/examples"), api("/api/workbench/items"),
    api("/api/workbench/bulk/sample"), api("/api/images/samples")]);
  W.samples = pics.samples;
  W.maxImages = pics.limits.max_images;
  W.examples = ex.examples;
  W.items = items.items;
  W.bulk.rowsText = sample.rows.map(rowLine).join("\n");
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
  if (W.tab === "bulk") updateCal();
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
const rowLine = (row) => (typeof row === "string" ? row : JSON.stringify(row));

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
  return W.bulk.source === "sample" ? W.bulk.sampleQuestions : toQuestions(W.questions);
}

function renderBulk() {
  const b = W.bulk;
  const rows = h("textarea", { class: "input", spellcheck: "false", placeholder: "One item per line. A text line becomes the state {\"text\": line}; a JSON object line is sent as it is. Or paste a JSON array of objects." }, b.rowsText);
  rows.addEventListener("input", () => { b.rowsText = rows.value; });
  const nRows = countRows(b.rowsText);
  const current = toQuestions(W.questions);
  const src = (value, label) => {
    const r = h("input", { type: "radio", name: "src", checked: b.source === value });
    r.addEventListener("change", () => { b.source = value; render(); });
    return h("label", { class: "toggle", style: { gap: "6px" } }, r, label);
  };
  const runBtn = h("button", { class: "btn primary", id: "bulk-run", onclick: runBulk }, icon("layers"), `Run ${Math.min(nRows, 200)} rows`);
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "grid wb-grid" },
      h("div", { class: "panel bulk" },
        h("div", { class: "panel-head" }, h("h2", {}, `Rows · ${nRows}`), h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: async () => { const s = await api("/api/workbench/bulk/sample"); b.rowsText = s.rows.map(rowLine).join("\n"); render(); } }, "Load sample rows")),
        h("div", { class: "panel-body" }, rows,
          h("p", { class: "faint", style: { fontSize: "12px", marginTop: "8px" } }, "Put labels on a JSON row under ", h("code", {}, "\"_expect\""), ", keyed by question id: ",
            h("code", {}, "{\"text\": \"…\", \"_expect\": {\"department\": \"billing\", \"wants_refund\": true}}"), ". Labels never reach the model; Calibrate scores the answers against them."))),
      h("div", { class: "grid", style: { gap: "16px" } },
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Questions to run on every row")),
          h("div", { class: "panel-body grid", style: { gap: "10px" } },
            src("current", `Current Build questions (${Object.keys(current).length})`),
            src("sample", `Sample: support triage (${Object.keys(b.sampleQuestions || {}).length})`),
            h("p", { class: "faint", style: { fontSize: "12px" } }, "Each row is its own live request; they run 8 at a time and count against the session budget. Cap: 200 rows per run. The sample rows carry labels for the sample questions."),
            h("div", {}, runBtn))),
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Why this matters")),
          h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
            h("p", { class: "muted" }, "At $0.042 per million input tokens, a question set over a million short messages costs about ", h("b", {}, "$10"), ". That is why “classify everything, then sort” is finally practical."),
            h("p", { class: "muted" }, "With labeled rows, Calibrate shows how often each answer was right and where to set the confidence threshold: above it your code acts, below it a person reviews. Choose the threshold from your own data, not a default."))))),
    b.result ? renderCalibrate() : null,
    b.result ? renderBulkTable() : null);
}

async function runBulk() {
  const questions = bulkQuestions();
  if (!Object.keys(questions).length) return toast("No questions. Build some first or pick the sample.", "error");
  const btn = $("#bulk-run");
  btn.disabled = true;
  mount(btn, h("span", { class: "spin" }), " Running…");
  try {
    const b = W.bulk;
    b.result = await api("/api/workbench/bulk", { rows: rowsPayload(), questions });
    b.sortKey = null;
    b.labels = {};
    for (const r of b.result.results) if (r.expect) b.labels[r.index] = { ...r.expect };
    b.cal.qid = chooseCalQuestion();
    await recalibrate();
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
  const b = W.bulk;
  const answer = r.answers?.[qid];
  if (!answer) return h("td", {});
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
    await recalibrate();
    render();
  });
  return h("td", {}, sel);
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
        h("button", { class: "btn sm", onclick: keepLabels, title: "Rewrite the rows box as JSON lines that carry these labels, so the next run keeps them" }, "Keep labels in rows"),
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

function keepLabels() {
  const b = W.bulk;
  // One JSON line per row. Array states cannot hold "_expect" and would come back as text, so refuse.
  if (b.result.results.some((r) => Array.isArray(r.row))) {
    return toast("Rows that are JSON arrays cannot carry labels. Wrap each one in an object first.", "error");
  }
  b.rowsText = b.result.results.map((r) => {
    const labels = b.labels[r.index];
    const has = labels && Object.keys(labels).length;
    if (typeof r.row === "string") {
      // A text line that would split, lose whitespace, or parse as JSON is written as an object so it
      // survives the trip (the server splits rows on "\n" and trims each line).
      const plain = r.row === r.row.trim() && !/^[{[]/.test(r.row) && !/[\n\r]/.test(r.row);
      if (!has && plain) return r.row;
      return JSON.stringify(has ? { text: r.row, _expect: labels } : { text: r.row });
    }
    return JSON.stringify(has ? { ...r.row, _expect: labels } : r.row);
  }).join("\n");
  render();
  toast("Rows now carry their labels as JSON lines");
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
let calSeq = 0;
async function recalibrate() {
  const b = W.bulk;
  const qid = b.cal.qid;
  const seq = ++calSeq;  // only the latest request may install its report
  const rows = qid ? b.result.results.filter((r) => r.answers?.[qid])
    .map((r) => ({ index: r.index, answer: r.answers[qid], label: b.labels[r.index]?.[qid] ?? null })) : [];
  b.cal.report = null;
  if (!rows.length) return;
  try {
    const report = await api("/api/workbench/calibrate", { rows, signal: b.cal.signal });
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
    h("div", { class: "cal-controls" }, qSel, sigSel));
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
        stat("accuracy, every row", pct(rep.accuracy), true),
        stat("calibration gap (ECE)", rep.ece === null ? "—" : `${(rep.ece * 100).toFixed(1)} pts`)),
      h("div", { class: "cal-gate" },
        h("label", { for: "cal-slider" }, `Act automatically when ${SIGNALS[c.signal]} ≥ `, h("b", { id: "cal-value", class: "mono" })),
        slider),
      h("div", { id: "cal-stats", class: "stat-row" }),
      h("div", { class: "chips" }, rep.targets.map((t) => t.threshold === null
        ? h("button", { class: "chip", disabled: true }, `${pct(t.target)} accurate: not reached on these rows`)
        : h("button", { class: "chip", onclick: () => setThreshold(t.threshold) },
          `${pct(t.target)} accurate → ≥ ${t.threshold.toFixed(2)}, automates ${pct(t.coverage)}`))),
      h("div", { class: "cal-chart-wrap" },
        h("div", { class: "cal-legend" },
          h("span", {}, h("i", { class: "cal-key cov" }), "Automated: share of labeled rows that clear the threshold"),
          h("span", {}, h("i", { class: "cal-key acc" }), "Accuracy of those automated rows")),
        h("div", { id: "cal-chart" }),
        h("div", { class: "cal-tip", id: "cal-tip", hidden: true })),
      h("details", {}, h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } }, "Sweep as a table"),
        h("div", { class: "scroll" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "threshold"), h("th", {}, "automated"), h("th", {}, "share"), h("th", {}, "accuracy"))),
          h("tbody", {}, rep.sweep.filter((p) => Math.round(p.threshold * 100) % 5 === 0).map((p) => h("tr", {},
            h("td", { class: "mono" }, p.threshold.toFixed(2)), h("td", {}, `${p.automated} of ${n}`), h("td", {}, pct(p.coverage)),
            h("td", {}, p.accuracy === null ? "—" : pct(p.accuracy)))))))),
      h("div", { class: "cal-tables" }, confusionTable(rep), reliabilityTable(rep)),
      h("div", { class: "code" }, h("pre", { id: "cal-code" }),
        h("button", { class: "btn sm copy", onclick: () => copyText($("#cal-code").textContent) }, icon("copy"), "Copy")),
      h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } },
        n < 100 ? h("p", { class: "faint" }, `With ${n} labeled rows, one row moves accuracy by ${(100 / n).toFixed(1)} points. Treat these thresholds as a first look, and label more rows before you rely on one.`) : null,
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
    stat("accuracy when automated", p.accuracy === null ? "—" : pct(p.accuracy, 1)),
    stat("wrong but automated", String(p.automated - p.correct)),
    stat("sent to review", String(rep.labeled - p.automated)),
    stat("this run, all rows", `${autoAll} of ${all.length} automated`));
  mount("#cal-chart", calChart(rep, t));
  $("#cal-code").textContent = calCode(rep, c.qid, c.signal, t);
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
    "aria-label": `Automated share and accuracy by threshold. At ${t.toFixed(2)}: ${pct(p.coverage)} automated, ${p.accuracy === null ? "none" : pct(p.accuracy)} accurate.` },
  grid, ticks,
  svg("text", { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" }, `${SIGNALS[W.bulk.cal.signal]} threshold`),
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
          h("button", { class: "btn sm ghost", onclick: async () => { const s = await api("/api/workbench/bulk/sample"); b.rowsText = s.rows.map(rowLine).join("\n"); render(); } }, "Load sample rows")),
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
    const report = await api("/api/workbench/compare/score", { rows, signal: c.signal, first: c.first });
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
      summaryRow(`accuracy · ${W.compare.qid}`, sv.map((v) => (v.accuracy === null ? "—" : `${pct(v.accuracy, 1)} (${v.correct}/${v.labeled})`)), sv.map((v) => v.accuracy)),
      summaryRow("calibration gap (ECE)", sv.map((v) => (v.ece === null ? "—" : `${(v.ece * 100).toFixed(1)} pts`)), sv.map((v) => v.ece), false));
    (sv[0].targets.length ? sv[0] : sv[1]).targets.forEach((t, k) => {
      const hits = sv.map((v) => v.targets[k]);
      rows.push(summaryRow(`automates at ${pct(t.target)} accuracy`,
        hits.map((x) => (x?.threshold === null || !x ? "not reached" : `${pct(x.coverage)} (≥ ${x.threshold.toFixed(2)})`)),
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
      qids.length ? h("div", { class: "cal-controls" }, qSel, sigSel) : null),
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
  const cell = (p) => [h("td", {}, `${p.automated} · ${pct(p.coverage)}`), h("td", {}, p.accuracy === null ? "—" : pct(p.accuracy, 1))];
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
        ` ${pct(p.accuracy, 1)} accurate · ${pct(p.coverage)} automated at ≥ ${p.threshold.toFixed(2)}`) : null)));
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
