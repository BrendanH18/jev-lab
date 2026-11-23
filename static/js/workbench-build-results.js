// Build Run, results, question checks, code export and saving a test.
import {
  $,
  answerCard,
  api,
  copyText,
  currentStatus,
  h,
  handleError,
  icon,
  pct,
  photoView,
  statusBadge,
  toast,
} from "./common.js";
import { buildRawText } from "./workbench-build-editor.js";
import { imageFor, imageNames, imagesPayload } from "./workbench-build-inputs.js";
import {
  BUILD_LAB_RESULT,
  buildContext,
  buildResultStale,
  parseState,
  questionEditorError,
  setBuildBaseline,
  toQuestions,
  validBuildQuestions,
} from "./workbench-build.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";

export let buildRunContext = null;
let buildRunSequence = 0;
export let buildRunning = false;

export function invalidateBuildRun() {
  buildRunSequence += 1;
  buildRunning = false;
}

export function clearBuildRunContext() {
  buildRunContext = null;
}

function defaultExpect(answer) {
  if (answer.type === "choice") return { choice: answer.choice };
  if (answer.type === "box") {
    return {
      box: Object.fromEntries(["left", "top", "right", "bottom"].map((k) => [k, +answer.box[k].toFixed(3)])),
      iou_min: 0.5,
    };
  }
  if (answer.type === "score")
    return { min: Math.max(0, +(answer.score - 0.5).toFixed(2)), max: +(answer.score + 0.5).toFixed(2) };
  return answer.noul >= 0.5 ? { min: 0.5 } : { max: 0.5 };
}

// The answer cards of the latest Run: every answer in response order, unless Lab filters hide some or a Lab sort
// reorders them.
export function renderBuildAnswerCards() {
  const r = W.result;
  if (!r) return [];
  const questions = r.trace.request.questions;
  const ctx = W.buildLabCtx?.result;
  if (!ctx) return Object.entries(r.answers).map(([qid, a]) => answerCard(qid, a, questions[qid]));
  const total = ctx.items().length;
  const shown = ctx.shown();
  const active = W.lab?.active?.(BUILD_LAB_RESULT) || 0;
  const wide = { gridColumn: "1 / -1" };
  return [
    total && !shown.length
      ? h("div", { class: "empty", style: wide }, "No answer matches the Lab filters.")
      : shown.map((item) => answerCard(item.id, r.answers[item.id], questions[item.id])),
    active
      ? h(
          "div",
          { class: "faint", style: { ...wide, fontSize: "12px" }, role: "status" },
          `${shown.length} of ${total} answers shown · ${active} Lab setting${active === 1 ? "" : "s"} active `,
          h(
            "button",
            {
              class: "btn sm ghost",
              onclick: () => {
                W.lab.reset(BUILD_LAB_RESULT);
                render();
              },
            },
            "Clear Lab filters and sort",
          ),
        )
      : null,
  ];
}

// The Save as test button's toggle, or open only (Lab's openSave). Expectations default from the answers.
export function openBuildSaveForm(open = !W.saveOpen) {
  W.saveOpen = open;
  if (W.saveOpen && !Object.keys(W.expect).length)
    W.expect = Object.fromEntries(Object.entries(W.result.answers).map(([k, a]) => [k, defaultExpect(a)]));
  render();
}

export function boxWarning() {
  const st = currentStatus();
  const hasBox = W.questions.some((q) => q.type === "box");
  if (!hasBox || !st.configured || st.supports_box) return null;
  return h(
    "div",
    { class: "panel-body", style: { paddingBottom: 0 } },
    h(
      "div",
      { class: "callout" },
      icon("alert"),
      h(
        "div",
        {},
        h("b", {}, `${st.model} cannot answer Box questions.`),
        h("div", { class: "muted" }, "Box needs Jev 1.14 or later. Change the model from the key menu in the top bar."),
      ),
    ),
  );
}

// Draw every Box answer on the picture its question points at.
export function renderBoxes() {
  const r = W.result;
  const boxes = Object.entries(r.answers).filter(([, a]) => a.type === "box");
  if (!boxes.length || !r.images?.length) return null;
  const byImage = new Map();
  const unplaced = [];
  for (const [qid, a] of boxes) {
    const img = imageFor(r.trace.request.questions[qid] || {}, r.trace.request.state, r.images);
    if (!img) {
      unplaced.push(qid);
      continue;
    }
    if (!byImage.has(img)) byImage.set(img, []);
    byImage.get(img).push({ box: a.box, label: `${qid} · ${pct(a.confidence)}` });
  }
  return h(
    "div",
    { class: "box-views" },
    [...byImage].map(([img, list]) =>
      photoView(img.url, list, {
        alt: "Image with Box answers",
        caption: `${list.length} Box answer${list.length > 1 ? "s" : ""} on ${img.ref}. A Box always returns edges, so check a presence Noul before trusting one.`,
      }),
    ),
    unplaced.length
      ? h(
          "p",
          { class: "faint", style: { fontSize: "12px" } },
          `Not drawn: ${unplaced.join(", ")}. Name the picture in the instructions by reference or by its backticked state field to see the box.`,
        )
      : null,
  );
}

export async function run() {
  if (buildRunning) return;
  const questions = validBuildQuestions();
  if (!questions) return;
  const context = buildContext();
  const sequence = ++buildRunSequence;
  buildRunning = true;
  render();
  try {
    const images = W.images.map((i) => ({ ...i }));
    const result = await api("/api/workbench/run", {
      state: parseState(W.stateText),
      questions,
      images: imagesPayload(),
    });
    if (sequence !== buildRunSequence) return;
    result.images = images;
    W.result = result;
    buildRunContext = context;
    W.saveOpen = false;
  } catch (e) {
    handleError(e);
  } finally {
    if (sequence === buildRunSequence) {
      buildRunning = false;
      render();
    }
  }
}

export async function checkQuestions({ scroll = true } = {}) {
  const questions = validBuildQuestions();
  if (!questions) return;
  const context = buildContext();
  try {
    const report = await api("/api/workbench/lint", {
      state: parseState(W.stateText),
      questions,
      images: imageNames(),
    });
    if (context !== buildContext()) return;
    W.lint = report;
    render();
    if (scroll) $("#lint")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    handleError(e);
  }
}

export function renderLint() {
  const { findings, counts, guide } = W.lint;
  // The Python Lab packs' extra advisory checks (report.lab): listed after the built-in findings, never counted above.
  const extra = Array.isArray(W.lint.lab?.findings) ? W.lint.lab.findings : [];
  const head = (level, n) => (level === "problem" ? `${n} ${n === 1 ? "problem" : "problems"}` : `${n} advice`);
  const finding = (f) =>
    h(
      "li",
      { class: `lint ${f.level}` },
      f.level === "problem"
        ? statusBadge("fail", "Problem")
        : h("span", { class: "badge warning" }, icon("question"), "Advice"),
      h(
        "div",
        {},
        f.question ? h("code", { class: "mono" }, f.question) : h("span", { class: "faint" }, "State"),
        h("div", { class: "muted" }, f.message),
        f.guide
          ? h(
              "a",
              { class: "faint", href: f.guide, target: "_blank", rel: "noopener" },
              "Why: How to build with System One",
            )
          : null,
      ),
    );
  return h(
    "div",
    { class: "panel", id: "lint" },
    h(
      "div",
      { class: "panel-head" },
      h("h2", {}, "Question checks"),
      counts.problem ? h("span", { class: "badge critical" }, icon("alert"), head("problem", counts.problem)) : null,
      counts.advice ? h("span", { class: "badge warning" }, icon("question"), head("advice", counts.advice)) : null,
      h("div", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn sm ghost",
          title: "Close",
          "aria-label": "Close question checks",
          onclick: () => {
            W.lint = null;
            render();
          },
        },
        icon("x"),
      ),
    ),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "8px" } },
      findings.length
        ? h("ul", { class: "lint-list" }, findings.map(finding))
        : h(
            "div",
            { class: "callout good" },
            icon("check"),
            h(
              "div",
              {},
              h("b", {}, extra.length ? "No findings from the built-in checks." : "No findings."),
              h(
                "div",
                { class: "muted" },
                "Checks catch common mistakes, not every one. Run the questions and read the answers.",
              ),
            ),
          ),
      extra.length
        ? [
            h("div", { class: "section-label", style: { margin: "6px 0 0" } }, `Additional checks · ${extra.length}`),
            h(
              "p",
              { class: "faint", style: { fontSize: "12px", margin: 0 } },
              "Advisory checks from Lab packs, also plain code. They are not counted in the badges above.",
            ),
            h("ul", { class: "lint-list", "data-lint": "lab" }, extra.map(finding)),
          ]
        : null,
      h(
        "p",
        { class: "faint", style: { fontSize: "12px" } },
        "Plain code read these questions: no model call, no cost. A problem is almost certainly a mistake; advice is a pattern ",
        h("a", { href: guide, target: "_blank", rel: "noopener" }, "TypeSafe's guide"),
        " recommends against, and may be what you meant. After an edit, press Check questions again.",
      ),
    ),
  );
}

export async function exportCode() {
  try {
    const questions = validBuildQuestions();
    if (!questions) return;
    const context = buildContext();
    const exported = await api("/api/workbench/export", {
      state: parseState(W.stateText),
      questions,
      images: imageNames(),
    });
    if (context !== buildContext()) return;
    W.exported = exported;
    render();
    $("#export")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    handleError(e);
  }
}

export function renderExport() {
  const tabs = [
    ["python", "Python SDK"],
    ["javascript", "JavaScript SDK"],
    ["curl", "curl"],
  ];
  return h(
    "div",
    { class: "panel", id: "export" },
    h(
      "div",
      { class: "panel-head" },
      icon("code"),
      h("h2", {}, "This request as code"),
      h("div", { class: "spacer" }),
      h(
        "div",
        { class: "tabs" },
        tabs.map(([k, l]) =>
          h(
            "button",
            {
              class: `tab${W.exportTab === k ? " active" : ""}`,
              onclick: () => {
                W.exportTab = k;
                render();
              },
            },
            l,
          ),
        ),
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          onclick: () => {
            W.exported = null;
            render();
          },
        },
        icon("x"),
      ),
    ),
    h(
      "div",
      { class: "panel-body" },
      h(
        "div",
        { class: "code" },
        h("button", { class: "btn sm copy", onclick: () => copyText(W.exported[W.exportTab]) }, icon("copy"), "Copy"),
        h("pre", {}, W.exported[W.exportTab]),
      ),
      h(
        "p",
        { class: "faint", style: { fontSize: "12px", marginTop: "8px" } },
        W.exportTab === "python"
          ? "pip install typesafe-sdk (Python 3.10+), then set TYPESAFE_API_KEY."
          : W.exportTab === "javascript"
            ? "npm install @typesafe-ai/sdk (Node 20+), then set TYPESAFE_API_KEY."
            : "Set TYPESAFE_API_KEY in your shell first.",
        W.images.length
          ? " The snippet loads each picture from a file named after it; save the pictures beside it first."
          : "",
      ),
    ),
  );
}

export function renderSaveForm() {
  const name = h("input", {
    class: "input",
    value: W.saveName,
    placeholder: "Test name, e.g. “angry refund routes to billing”",
  });
  name.addEventListener("input", () => {
    W.saveName = name.value;
  });
  const notes = h("input", { class: "input", value: W.saveNotes, placeholder: "Notes (optional)" });
  notes.addEventListener("input", () => {
    W.saveNotes = notes.value;
  });
  const rows = Object.entries(W.result.answers).map(([qid, a]) => {
    const e = W.expect[qid] || (W.expect[qid] = defaultExpect(a));
    const numField = (key) => {
      const inp = h("input", { class: "input mono", value: e[key] ?? "", placeholder: key });
      inp.addEventListener("input", () => {
        if (inp.value === "") delete e[key];
        else e[key] = Number(inp.value);
      });
      return inp;
    };
    if (a.type === "choice") {
      const sel = h(
        "select",
        { class: "input" },
        Object.keys(a.probabilities).map((k) => h("option", { value: k, selected: e.choice === k }, k)),
      );
      sel.addEventListener("change", () => {
        e.choice = sel.value;
      });
      return h(
        "div",
        { class: "exp" },
        h("code", {}, qid),
        h("span", { class: "faint" }, "choice ="),
        sel,
        h("span", {}),
      );
    }
    if (a.type === "box") {
      return h(
        "div",
        { class: "exp" },
        h("code", {}, qid),
        h(
          "span",
          { class: "faint", title: "Overlap with the box saved from this run: 1 is identical, 0 is no overlap" },
          "IoU with this box ≥",
        ),
        numField("iou_min"),
        h("span", {}),
      );
    }
    return h(
      "div",
      { class: "exp" },
      h("code", {}, qid),
      h("span", { class: "faint" }, a.type === "score" ? "score in" : "P(yes) in"),
      numField("min"),
      numField("max"),
    );
  });
  return h(
    "div",
    { class: "panel pop" },
    h(
      "div",
      { class: "panel-head" },
      icon("save"),
      h("h2", {}, W.editingId ? `Update test “${W.editingId}”` : "Save as a test"),
      h("div", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn sm ghost",
          onclick: () => {
            W.saveOpen = false;
            render();
          },
        },
        icon("x"),
      ),
    ),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "10px" } },
      h(
        "p",
        { class: "muted", style: { fontSize: "12.5px" } },
        "Expectations start from the answers you just got. Edit them to what you believe is correct; the Tests tab re-runs this state live and checks the answers against them.",
      ),
      name,
      notes,
      h("div", { class: "grid", style: { gap: "6px" } }, rows),
      h("div", {}, h("button", { class: "btn primary", onclick: saveTest }, icon("save"), "Save to data/workbench/")),
    ),
  );
}

async function saveTest() {
  try {
    if (W.result && buildResultStale())
      return toast("Run the edited request before saving its expectations as a test.", "error");
    if (buildRawText !== null) return toast("Apply the Raw JSON edits before saving this request.", "error");
    const questions = toQuestions(W.questions);
    const error = questionEditorError();
    if (error) return toast(error, "error");
    const submittedContext = buildContext();
    const expect = Object.fromEntries(Object.entries(W.expect).filter(([qid]) => Object.hasOwn(questions, qid)));
    const { item } = await api("/api/workbench/items", {
      id: W.editingId || undefined,
      name: W.saveName,
      notes: W.saveNotes,
      state: parseState(W.stateText),
      questions,
      expect,
      images: imagesPayload(),
    });
    W.items = (await api("/api/workbench/items")).items;
    W.editingId = item.id;
    W.saveOpen = false;
    setBuildBaseline(submittedContext);
    toast(`Saved data/workbench/${item.id}.json`);
    render();
  } catch (e) {
    handleError(e);
  }
}
