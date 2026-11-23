// Build draft files and request pictures.
import { parseRequestDraft, parseUniqueJson, requestDraft } from "./build-request.js";
import { $, api, copyText, h, handleError, icon, photoView, prepareImage, toast } from "./common.js";
import {
  buildContext,
  fromQuestions,
  loadInto,
  markBuildEdited,
  parseState,
  questionEditorError,
  sampleUrl,
  setBuildBaseline,
  validBuildQuestions,
} from "./workbench-build.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";

let buildDraftPreview = null;
let buildDraftBusy = false;

export function resetBuildDraft() {
  buildDraftPreview = null;
}

// ---------- images ----------
// Each picture has a reference string; the API swaps the picture in wherever the reference appears.
function newRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `photo-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function imagesFromSpecs(specs) {
  return Object.entries(specs || {}).map(([ref, spec]) =>
    spec.sample
      ? {
          ref,
          sample: spec.sample,
          url: sampleUrl(spec.sample),
          about: W.samples.find((x) => x.name === spec.sample)?.about,
        }
      : {
          ref,
          format: spec.format,
          data_base64: spec.data_base64,
          url: `data:image/${spec.format === "png" ? "png" : "jpeg"};base64,${spec.data_base64}`,
        },
  );
}
export const imagesPayload = () =>
  Object.fromEntries(
    W.images.map((i) => [i.ref, i.sample ? { sample: i.sample } : { format: i.format, data_base64: i.data_base64 }]),
  );
export const imageNames = () =>
  Object.fromEntries(W.images.map((i) => [i.ref, i.sample ? { sample: i.sample } : { format: i.format }]));

// Put a new picture somewhere a question can point at it: a `photo` field in an object state.
function placeInState(ref) {
  const state = parseState(W.stateText);
  const isObject = state && typeof state === "object" && !Array.isArray(state);
  if (Array.isArray(state)) return "Put its reference in the state or a question.";
  const obj = isObject ? state : String(state || "").trim() ? { text: state } : {};
  let key = "photo";
  for (let n = 2; key in obj; n++) key = `photo_${n}`;
  obj[key] = ref;
  W.stateText = JSON.stringify(obj, null, 2);
  return isObject || !String(state || "").trim()
    ? `Added \`${key}\` to the state.`
    : `Moved the text into \`text\` and added \`${key}\`.`;
}

function addImage(img) {
  if (W.images.length >= W.maxImages) return toast(`At most ${W.maxImages} images per request.`, "error");
  try {
    parseState(W.stateText);
  } catch (e) {
    return toast(`State: ${e.message}`, "error");
  }
  const ref = newRef();
  W.images.push({ ...img, ref });
  toast(placeInState(ref));
  W.result = null;
  markBuildEdited();
  render();
}

function removeImage(ref) {
  let state;
  try {
    state = parseState(W.stateText);
  } catch (e) {
    return toast(`State: ${e.message}`, "error");
  }
  W.images = W.images.filter((i) => i.ref !== ref);
  if (state && typeof state === "object" && !Array.isArray(state)) {
    for (const [k, v] of Object.entries(state)) if (v === ref) delete state[k];
    W.stateText = JSON.stringify(state, null, 2);
  }
  W.result = null;
  markBuildEdited();
  render();
}

// Follow a backticked state path such as `photo`, `after.photo` or `frames[2].frame`.
function lookup(state, path) {
  if (state && typeof state === "object" && Object.hasOwn(state, path)) return state[path]; // a key with dots
  let node = state;
  for (const part of path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

// Which picture a Box question points at: one named by reference or by a backticked state path.
// With several pictures and no match, return null rather than draw the box on a guessed picture.
export function imageFor(question, state, images) {
  const text =
    typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
  const byRef = images.find((i) => text.includes(i.ref));
  if (byRef) return byRef;
  for (const [, path] of text.matchAll(/`([^`]+)`/g)) {
    const value = lookup(state, path.trim());
    const img = images.find((i) => i.ref === value);
    if (img) return img;
  }
  return images.length === 1 ? images[0] : null;
}

export function renderImages() {
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/*", class: "hidden" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const img = await prepareImage(f);
      addImage({ format: img.format, data_base64: img.data_base64, url: img.url, name: img.name });
    } catch (e) {
      toast(e.message || "Could not read that image.", "error");
    }
  });
  const full = W.images.length >= W.maxImages;
  return h(
    "div",
    { class: "panel" },
    h(
      "div",
      { class: "panel-head" },
      h("h2", {}, `Images · ${W.images.length}`),
      h(
        "span",
        {
          class: "dreamer",
          title: "TypeSafe marks images and Box as dreamer-ready: for prototypes, and subject to change",
        },
        "Dreamer-ready",
      ),
      h("div", { class: "spacer" }),
      h("button", { class: "btn sm", disabled: full, onclick: () => file.click() }, icon("upload"), "Upload"),
      file,
    ),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "10px" } },
      W.images.length
        ? h(
            "div",
            { class: "img-list" },
            W.images.map((img) =>
              h(
                "div",
                { class: "img-row" },
                photoView(img.url, [], { alt: img.about || img.name || "Image" }),
                h(
                  "div",
                  { class: "grid", style: { gap: "4px", minWidth: 0 } },
                  h(
                    "button",
                    { class: "ref mono", title: "Copy the reference", onclick: () => copyText(img.ref) },
                    img.ref,
                    icon("copy"),
                  ),
                  h(
                    "span",
                    { class: "faint", style: { fontSize: "11.5px" } },
                    img.sample ? `Sample drawing: ${img.about || img.sample}` : `${img.name || "Upload"} · JPEG`,
                  ),
                ),
                h(
                  "button",
                  {
                    class: "btn sm ghost",
                    title: "Remove image",
                    "aria-label": "Remove image",
                    onclick: () => removeImage(img.ref),
                  },
                  icon("trash"),
                ),
              ),
            ),
          )
        : null,
      h(
        "div",
        { class: "thumbs" },
        W.samples.map((sm) =>
          h(
            "button",
            {
              class: "thumb",
              title: `Add sample: ${sm.about}`,
              "aria-label": `Add sample: ${sm.about}`,
              disabled: full,
              onclick: () => addImage({ sample: sm.name, url: sm.url, about: sm.about }),
            },
            h("img", { src: sm.url, alt: "" }),
          ),
        ),
      ),
      h(
        "p",
        { class: "faint", style: { fontSize: "12px" } },
        "Each picture gets a reference. Wherever the reference appears in the state or a question, the model sees the picture. Point questions at it by field, such as ",
        h("code", {}, "`photo`"),
        ". Uploads are resized in your browser to 280–1568 px.",
      ),
    ),
  );
}

export function renderBuildDraft() {
  const file = h("input", {
    type: "file",
    accept: ".json,application/json",
    hidden: true,
    onchange: () => previewBuildDraft(file.files[0]),
  });
  const preview = buildDraftPreview;
  return h(
    "div",
    { class: "grid", style: { gap: "8px", marginTop: "10px" } },
    h(
      "div",
      { class: "chips" },
      h("button", { class: "btn sm", disabled: buildDraftBusy, onclick: downloadBuildDraft }, "Download Build draft"),
      h("button", { class: "btn sm", disabled: buildDraftBusy, onclick: () => file.click() }, "Restore Build draft"),
      file,
    ),
    h(
      "p",
      { class: "faint" },
      "Keep an unrun request with its questions and pictures. Drafts contain no model answers or API settings. Review your input data before sharing.",
    ),
    preview
      ? h(
          "div",
          { class: "callout" },
          h(
            "div",
            {},
            h("b", {}, "Build draft preview"),
            h(
              "p",
              {},
              `${Object.keys(preview.draft.questions).length} questions · ${Object.keys(preview.draft.images).length} pictures. Accepting replaces the Build request; it makes no model call or saved change.`,
            ),
            h(
              "button",
              { class: "btn sm primary", disabled: buildDraftBusy, onclick: acceptBuildDraft },
              "Accept Build draft",
            ),
            h(
              "button",
              {
                class: "btn sm ghost",
                onclick: () => {
                  buildDraftPreview = null;
                  render();
                },
              },
              "Cancel restore",
            ),
          ),
        )
      : null,
  );
}

async function downloadBuildDraft() {
  if (buildDraftBusy) return;
  const questions = validBuildQuestions();
  if (!questions) return;
  const context = buildContext();
  const draft = requestDraft(parseState(W.stateText), questions, imagesPayload());
  buildDraftBusy = true;
  render();
  try {
    await api("/api/workbench/draft/validate", draft);
    if (context !== buildContext())
      return toast("The Build request changed. Download its current draft again.", "error");
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: "jev-build-draft.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBuildBaseline(context);
    toast("Downloaded the Build draft, including its pictures.");
  } catch (e) {
    handleError(e);
  } finally {
    buildDraftBusy = false;
    render();
  }
}

async function previewBuildDraft(file) {
  if (!file || buildDraftBusy) return;
  buildDraftBusy = true;
  buildDraftPreview = null;
  const context = buildContext();
  render();
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error("Build drafts must be at most 12 MiB.");
    const draft = parseRequestDraft(parseUniqueJson(await file.text()));
    const error = questionEditorError(fromQuestions(draft.questions));
    if (error) throw new Error(error);
    await api("/api/workbench/draft/validate", draft);
    if (context !== buildContext())
      return toast("The Build request changed. Preview the draft again before replacing it.", "error");
    buildDraftPreview = { draft, context };
  } catch (e) {
    handleError(e);
  } finally {
    buildDraftBusy = false;
    render();
  }
}

function acceptBuildDraft() {
  const preview = buildDraftPreview;
  if (!preview) return;
  if (preview.context !== buildContext())
    return toast("The Build request changed. Preview the draft again before replacing it.", "error");
  const { state, questions, images } = preview.draft;
  if (loadInto(state, questions, { images })) toast("Restored the Build draft. Run it when ready to get answers.");
}
