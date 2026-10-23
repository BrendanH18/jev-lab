import {
  $, $$, answerCard, api, callStats, copyText, currentStatus, h, handleError, icon, initChrome, inspect, mount, ms, num,
  pct, photoView, prepareImage, statusBadge, toast, usd,
} from "./common.js";

const W = {
  tab: "build", stateText: "", questions: [], raw: false, result: null, exported: null, exportTab: "python",
  items: [], examples: [], runResults: null, saveOpen: false, expect: {}, saveName: "", saveNotes: "", editingId: null,
  bulk: { rowsText: "", result: null, sortKey: null, sortDir: -1, source: "current", sampleQuestions: null },
  loadedExample: null, images: [], samples: [], maxImages: 4,
};
const TYPES = ["noul", "choice", "score", "box"];
const TABS = [["build", "Build"], ["tests", "Tests"], ["bulk", "Bulk"], ["examples", "Examples"]];

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

// Which picture a Box question points at: one named by reference or by a backticked state field.
function imageFor(question, state, images) {
  const text = typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
  const byRef = images.find((i) => text.includes(i.ref));
  if (byRef) return byRef;
  if (state && typeof state === "object" && !Array.isArray(state)) {
    for (const [k, v] of Object.entries(state)) {
      const img = images.find((i) => i.ref === v);
      const field = new RegExp("`" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_])");
      if (img && field.test(text)) return img;
    }
  }
  return images[0];
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
  W.bulk.rowsText = sample.rows.join("\n");
  W.bulk.sampleQuestions = sample.questions;
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
    case "examples": view = renderExamples(); break;
    default:
      W.tab = "build";
      view = renderBuild();
  }
  mount("#tabs", TABS.map(([k, label]) => h("button", { class: `tab${W.tab === k ? " active" : ""}`, onclick: () => { W.tab = k; location.hash = k; render(); } },
    label, k === "tests" && W.items.length ? ` (${W.items.length})` : "")));
  mount("#view", view);
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
  for (const [qid, a] of boxes) {
    const img = imageFor(r.trace.request.questions[qid] || {}, r.trace.request.state, r.images);
    if (!byImage.has(img)) byImage.set(img, []);
    byImage.get(img).push({ box: a.box, label: `${qid} · ${pct(a.confidence)}` });
  }
  return h("div", { class: "box-views" }, [...byImage].map(([img, list]) =>
    photoView(img.url, list, { alt: "Image with Box answers", caption: `${list.length} Box answer${list.length > 1 ? "s" : ""} on ${img.ref}. A Box always returns edges, so check a presence Noul before trusting one.` })));
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
function bulkQuestions() {
  return W.bulk.source === "sample" ? W.bulk.sampleQuestions : toQuestions(W.questions);
}

function renderBulk() {
  const b = W.bulk;
  const rows = h("textarea", { class: "input", spellcheck: "false", placeholder: "One item per line. Each line becomes the state {\"text\": line}. Or paste a JSON array of objects." }, b.rowsText);
  rows.addEventListener("input", () => { b.rowsText = rows.value; });
  const nRows = b.rowsText.split("\n").filter((l) => l.trim()).length;
  const current = toQuestions(W.questions);
  const src = (value, label) => {
    const r = h("input", { type: "radio", name: "src", checked: b.source === value });
    r.addEventListener("change", () => { b.source = value; render(); });
    return h("label", { class: "toggle", style: { gap: "6px" } }, r, label);
  };
  const runBtn = h("button", { class: "btn primary", onclick: runBulk }, icon("layers"), `Run ${Math.min(nRows, 200)} rows`);
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "grid wb-grid" },
      h("div", { class: "panel bulk" },
        h("div", { class: "panel-head" }, h("h2", {}, `Rows · ${nRows}`), h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: async () => { const s = await api("/api/workbench/bulk/sample"); b.rowsText = s.rows.join("\n"); render(); } }, "Load sample rows")),
        h("div", { class: "panel-body" }, rows)),
      h("div", { class: "grid", style: { gap: "16px" } },
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Questions to run on every row")),
          h("div", { class: "panel-body grid", style: { gap: "10px" } },
            src("current", `Current Build questions (${Object.keys(current).length})`),
            src("sample", `Sample: support triage (${Object.keys(b.sampleQuestions || {}).length})`),
            h("p", { class: "faint", style: { fontSize: "12px" } }, "Each row is its own live request; they run 8 at a time and count against the session budget. Cap: 200 rows per run."),
            h("div", {}, runBtn))),
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Why this matters")),
          h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
            h("p", { class: "muted" }, "At $0.042 per million input tokens, a question set over a million short messages costs about ", h("b", {}, "$10"), ". That is why “classify everything, then sort” is finally practical."),
            h("p", { class: "muted" }, "Sort the table by any column, then download the CSV. Those columns are features: feed them to a dashboard, a rule, or a classical ML model."))))),
    b.result ? renderBulkTable() : null);
}

async function runBulk() {
  const questions = bulkQuestions();
  if (!Object.keys(questions).length) return toast("No questions. Build some first or pick the sample.", "error");
  const btn = $(".btn.primary");
  btn.disabled = true;
  mount(btn, h("span", { class: "spin" }), " Running…");
  try {
    let rows = W.bulk.rowsText;
    const t = rows.trim();
    if (/^\[/.test(t)) { try { rows = JSON.parse(t); } catch { /* keep text */ } }
    W.bulk.result = await api("/api/workbench/bulk", { rows, questions });
    W.bulk.sortKey = null;
    if (W.bulk.result.stopped) toast(W.bulk.result.stopped, "error");
    render();
    $("#bulk-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { handleError(e); render(); }
}

function cellValue(answers, qid) {
  const a = answers?.[qid];
  if (!a) return { sort: -1, text: "" };
  if (a.type === "choice") return { sort: a.choice, text: a.choice, sub: pct(a.probabilities[a.choice]) };
  if (a.type === "score") return { sort: a.score, text: a.score.toFixed(2), heat: a.score / Math.max(1, Object.keys(a.legend).length - 1) };
  return { sort: a.noul, text: pct(a.noul), heat: a.noul };
}

function renderBulkTable() {
  const b = W.bulk;
  const res = b.result;
  const qids = Object.keys(bulkQuestionsForResult(res));
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
    const lines = [["row", ...qids].map(esc).join(",")];
    for (const r of res.results) lines.push([typeof r.row === "string" ? r.row : JSON.stringify(r.row), ...qids.map((q) => cellValue(r.answers, q).text)].map(esc).join(","));
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
        h("button", { class: "btn sm", onclick: csv }, "Download CSV"))),
    h("div", { class: "scroll" }, h("table", { class: "table bulk-table" },
      h("thead", {}, h("tr", {}, th("__row", "#"), h("th", {}, "row"), qids.map((q) => th(q, q)))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        h("td", { class: "num" }, String(r.index + 1)),
        h("td", { class: "row" }, typeof r.row === "string" ? r.row : JSON.stringify(r.row), r.error ? h("div", { style: { color: "var(--critical-text)", fontSize: "12px" } }, r.error) : null),
        qids.map((q) => {
          const v = cellValue(r.answers, q);
          return h("td", {}, v.heat !== undefined
            ? h("span", {}, h("span", { class: "pill-num" }, v.text), h("span", { class: "heat" }, h("i", { style: { width: pct(v.heat, 1) } })))
            : h("span", {}, h("span", { class: "cell-choice" }, v.text), v.sub ? h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, v.sub) : null));
        })))))));
}

function bulkQuestionsForResult(res) {
  const first = res.results.find((r) => r.answers);
  return first ? first.answers : {};
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

boot().catch(handleError);
