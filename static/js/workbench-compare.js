// Compare's variant editors, initial run, and selected retries over the Bulk rows.
import { $, api, currentStatus, h, handleError, icon, mount, toast } from "./common.js";
import { comparePendingCalls, mergeCompareRetry } from "./compare-retry.js";
import { PERTURBS, VARIANTS, parseVariantText, reverseOptions } from "./variants.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { W } from "./workbench-state.js";
import { toQuestions } from "./workbench-build.js";
import { render } from "./workbench.js";
import { loadSampleRows, countRows, rowsPayload } from "./workbench-bulk.js";
import { syncAttachedSets } from "./workbench-calibrate.js";
import { loadModels } from "./workbench-checks.js";
import { updateCascade } from "./workbench-compare-cascade.js";
import {
  chooseCmpQuestion,
  cmpQuestions,
  renderCompareReport,
  renderCompareRows,
  rescoreCompare,
  updateCmpChart,
} from "./workbench-compare-report.js";

function parseVariant(i) {
  return parseVariantText(W.compare.variants[i].text, VARIANTS[i]);
}

function variantStatus(i) {
  try {
    const n = Object.keys(parseVariant(i)).length;
    return h("span", { class: "faint" }, `${n} question${n === 1 ? "" : "s"}`);
  } catch (e) {
    return h("span", { style: { color: "var(--critical-text)" } }, e.message);
  }
}

export function updateCompareView() {
  updateCmpChart();
  updateCascade();
}

function variantPanel(i) {
  const v = W.compare.variants[i];
  const name = VARIANTS[i];
  const area = h(
    "textarea",
    { class: "input", spellcheck: "false", "aria-label": `Variant ${name} questions as JSON` },
    v.text,
  );
  const note = h("div", { style: { fontSize: "12px" } }, variantStatus(i));
  area.addEventListener("input", () => {
    v.text = area.value;
    mount(note, variantStatus(i));
    updateCompareRetry();
  });
  const model = h("input", {
    class: "input",
    list: "cmp-models",
    value: v.model,
    spellcheck: "false",
    "aria-label": `Variant ${name} model`,
    placeholder: `Current model (${currentStatus()?.model || "jev-latest"})`,
  });
  model.addEventListener("input", () => {
    v.model = model.value;
    updateCompareRetry();
  });
  const rows =
    i === 1
      ? h(
          "select",
          { class: "input", "aria-label": `Rows variant ${name} is sent` },
          Object.entries(PERTURBS).map(([k, label]) =>
            h("option", { value: k, selected: k === v.perturb }, k ? `The rows, ${label}` : "The rows as written"),
          ),
        )
      : null;
  rows?.addEventListener("change", () => {
    v.perturb = rows.value;
    render();
  });
  const asked =
    i === 1
      ? h(
          "select",
          { class: "input", "aria-label": `How variant ${name} asks` },
          h("option", { value: "", selected: !v.average }, "Once, with the options as listed"),
          h("option", { value: "both", selected: v.average }, "Twice, with the options in both orders, averaged"),
        )
      : null;
  asked?.addEventListener("change", () => {
    v.average = asked.value === "both";
    render();
  });
  return h(
    "div",
    { class: "panel raw" },
    h(
      "div",
      { class: "panel-head" },
      h("i", { class: `cmp-key ${name.toLowerCase()}` }),
      h("h2", {}, `Variant ${name}`),
      h("div", { class: "spacer" }),
      h(
        "div",
        { class: "chips" },
        h("button", { class: "btn sm ghost", onclick: () => cmpFill(i, "build") }, "Build questions"),
        h("button", { class: "btn sm ghost", onclick: () => cmpFill(i, "sample") }, "Sample"),
        h("button", { class: "btn sm ghost", onclick: () => cmpFill(i, "terse") }, "Sample, terse"),
        i === 1
          ? h("button", { class: "btn sm ghost", title: "A's questions and model", onclick: cmpCopyA }, "Copy A")
          : null,
        i === 1
          ? h(
              "button",
              {
                class: "btn sm ghost",
                title: "A's questions and model, with each Choice question's options in reverse order",
                onclick: reverseA,
              },
              "Reverse A's options",
            )
          : null,
        i === 1
          ? h(
              "button",
              {
                class: "btn sm ghost",
                title: "A's questions and model, asked in both option orders and averaged",
                onclick: averageA,
              },
              "Average A's orders",
            )
          : null,
      ),
    ),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "10px" } },
      h(
        "label",
        { class: "grid", style: { gap: "4px", fontSize: "12.5px" } },
        h("span", { class: "muted" }, "Model"),
        model,
      ),
      rows
        ? h(
            "label",
            { class: "grid", style: { gap: "4px", fontSize: "12.5px" } },
            h("span", { class: "muted" }, "Rows"),
            rows,
            v.perturb
              ? h(
                  "span",
                  { class: "faint" },
                  "An input check: with B a copy of A (",
                  h("b", {}, "Copy A"),
                  "), any answer that changes changed because of the rewrite.",
                )
              : null,
          )
        : null,
      asked
        ? h(
            "label",
            { class: "grid", style: { gap: "4px", fontSize: "12.5px" } },
            h("span", { class: "muted" }, "Ask"),
            asked,
            v.average
              ? h(
                  "span",
                  { class: "faint" },
                  "Each row is sent twice, the second time with every Choice question's options in reverse order, and the two answers are averaged in code. That costs twice as much per row.",
                )
              : null,
          )
        : null,
      area,
      note,
    ),
  );
}

// The fill buttons: a variant gets Build's questions ("build"), the sample set ("sample") or its terse rewording ("terse").
function cmpFill(i, from) {
  const questions =
    from === "build" ? toQuestions(W.questions) : from === "sample" ? W.bulk.sampleQuestions : W.compare.terse;
  W.compare.variants[i].text = JSON.stringify(questions, null, 2);
  render();
}

// "Copy A": B gets A's questions and model.
function cmpCopyA() {
  const [a, b] = W.compare.variants;
  b.text = a.text;
  b.model = a.model;
  render();
}

// An order check: B becomes A, with the same model and each Choice question's options in reverse order, so
// any answer that changes changed because of the order alone.
function reverseA() {
  let questions;
  try {
    questions = parseVariant(0);
  } catch (e) {
    return toast(e.message, "error");
  }
  const reversed = reverseOptions(questions);
  if (!reversed)
    return toast(
      "Variant A has no Choice question whose options can be reordered. Score levels keep their order, and options named by whole numbers always list in ascending order.",
      "error",
    );
  const [a, b] = W.compare.variants;
  b.text = JSON.stringify(reversed, null, 2);
  b.model = a.model;
  b.perturb = ""; // the rows as written, so the order is the only change
  b.average = false;
  render();
  toast("B is A with each Choice question's options in reverse order");
}

// A fix to measure against the order check: B asks A's questions twice, once with each Choice question's options
// reversed, and averages the answers (jev/orders.py), so the first and last places trade options.
function averageA() {
  let questions;
  try {
    questions = parseVariant(0);
  } catch (e) {
    return toast(e.message, "error");
  }
  const choice = Object.values(questions).some(
    (q) =>
      q && q.type === "choice" && q.criteria && typeof q.criteria === "object" && Object.keys(q.criteria).length > 1,
  );
  if (!choice)
    return toast("Variant A has no Choice question with two or more options to average over both orders.", "error");
  const [a, b] = W.compare.variants;
  b.text = a.text;
  b.model = a.model;
  b.perturb = "";
  b.average = true;
  render();
  toast("B asks A's questions in both option orders and averages the answers");
}

const runLabel = (n) => [icon("layers"), `Run ${Math.min(n, 200)} rows × 2 variants`];

export function renderCompare() {
  const c = W.compare;
  const b = W.bulk;
  loadModels();
  const count = h("h2", {}, `Rows · ${countRows(b.rowsText)}`);
  // Disabled from state, not on the button alone: a render during a run must not offer a second paid run.
  const runBtn = h(
    "button",
    { class: "btn primary", id: "cmp-run", onclick: runCompare, disabled: c.running },
    c.running === "compare"
      ? [h("span", { class: "spin" }), " Running both variants…"]
      : runLabel(countRows(b.rowsText)),
  );
  const rows = h(
    "textarea",
    { class: "input", spellcheck: "false", "aria-label": "Rows, shared with the Bulk tab" },
    b.rowsText,
  );
  rows.addEventListener("input", () => {
    b.rowsText = rows.value;
    syncAttachedSets();
    const n = countRows(b.rowsText);
    count.textContent = `Rows · ${n}`;
    if (!c.running) mount(runBtn, runLabel(n));
    updateCompareRetry();
  });
  return h(
    "div",
    { class: "grid", style: { gap: "16px" } },
    h(
      "p",
      { class: "muted", style: { maxWidth: "820px" } },
      "Change one thing and measure it: reword a question, trim its criteria, or switch the model. Both variants answer the same labeled rows, and the report shows which one was right more often, how far to trust each one's confidence, and the rows where they disagree. ",
      h("b", {}, "Reverse A's options"),
      " makes B an order check: if an answer changes when only the order of the options changes, the model is reading the list, not the row. ",
      h("b", {}, "Rows"),
      ", on B, makes it an input check: B's rows get typos, lowercase, an unrelated sentence, or shuffled fields, changes that should not move a good answer. ",
      h("b", {}, "Average A's orders"),
      " tests a fix for an order effect: B asks A's questions twice, once with the options reversed, and averages the answers, so the report shows what a second call per row buys.",
    ),
    h("div", { class: "grid cmp-grid", id: "cmp-variants" }, variantPanel(0), variantPanel(1)),
    h(
      "datalist",
      { id: "cmp-models" },
      (c.models || []).map((n) => h("option", { value: n })),
    ),
    h(
      "div",
      { class: "grid wb-grid" },
      h(
        "div",
        { class: "panel bulk" },
        h(
          "div",
          { class: "panel-head" },
          count,
          h("span", { class: "faint", style: { fontSize: "12px" } }, "shared with Bulk"),
          h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: loadSampleRows }, "Load sample rows"),
        ),
        h("div", { class: "panel-body" }, rows),
      ),
      h(
        "div",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", {}, "Run both")),
        h(
          "div",
          { class: "panel-body grid", style: { gap: "10px", fontSize: "12.5px" } },
          h(
            "p",
            { class: "muted" },
            "Each row is sent once per variant, so 40 rows make 80 live calls, or 120 when B asks in both orders. They run 8 at a time and count against the session budget. The report scores both variants only on rows both answered, so a stopped run or a failed call cannot tilt the comparison.",
          ),
          h(
            "p",
            { class: "muted" },
            "Labels come from ",
            h("code", {}, '"_expect"'),
            " in the rows. To label in the browser, use the label column on the Bulk tab, then ",
            h("b", {}, "Keep labels in rows"),
            ". Only question ids that both variants share, with the same type, are compared.",
          ),
          h(
            "div",
            {},
            runBtn,
            " ",
            estimateLine(h, api, "compare", () => ({ rows: rowsPayload(), variants: compareVariants() })),
          ),
        ),
      ),
    ),
    c.result ? renderCompareReport(compareRetryControls) : null,
    c.result && c.report ? renderCompareRows() : null,
  );
}

const compareVariants = () =>
  VARIANTS.map((_, i) => ({
    questions: parseVariant(i),
    model: W.compare.variants[i].model.trim(),
    perturb: W.compare.variants[i].perturb || null,
    average_orders: !!W.compare.variants[i].average,
  }));

function compareEditorKey() {
  return JSON.stringify(W.compare.variants.map((v) => [v.text, v.model.trim(), v.perturb, v.average]));
}

function compareDraftMatches(request) {
  return request?.sourceText === W.bulk.rowsText && request.editorKey === compareEditorKey();
}

function compareRetryPositions() {
  const { result, retrySelection } = W.compare;
  return [...(retrySelection?.selected ?? [])]
    .filter((position) => result?.retry?.models[position] === null)
    .sort((a, b) => a - b);
}

function compareRetryBody() {
  const c = W.compare;
  if (!compareDraftMatches(c.runRequest) || !c.result?.retry) return null;
  const positions = compareRetryPositions();
  if (!positions.length) return null;
  const { rows, variants } = c.runRequest.body;
  return {
    rows,
    variants: variants.map((v, i) => ({ ...v, model: c.result.variants[i].model })),
    retry: c.result.retry,
    positions,
  };
}

const compareRetryChanged = "Rows or variant settings changed. Restore the original inputs or run both variants again.";

function updateCompareRetry(host = $("#compare-retry")) {
  if (!host) return;
  const c = W.compare;
  const changed = !compareDraftMatches(c.runRequest);
  const count = compareRetryPositions().length;
  const button = $("#compare-retry-run", host);
  button.disabled = changed || !count || !!c.running;
  button.textContent =
    c.running === "retry" ? "Retrying selected calls…" : `Retry ${count} selected call${count === 1 ? "" : "s"}`;
  const estimate = $("#compare-retry-estimate", host);
  estimate.hidden = changed || !count;
  mount(estimate, estimate.hidden ? null : estimateLine(h, api, "compare_retry", compareRetryBody));
  $("#compare-retry-reason", host).textContent = changed ? compareRetryChanged : "";
}

function compareRetryControls() {
  const c = W.compare;
  const pending = comparePendingCalls(c.result);
  if (!pending.length) return null;
  const selection = c.retrySelection;
  const list = h(
    "div",
    { class: "grid", style: { gap: "6px", maxHeight: "260px", overflow: "auto" } },
    pending.map(({ position, rowNumber, variant, order, error }) => {
      const orderLabel =
        order === "reversed" ? " · Choice options reversed" : order ? " · Choice options as listed" : "";
      return h(
        "label",
        { style: { display: "flex", gap: "8px", alignItems: "start", overflowWrap: "anywhere" } },
        h("input", {
          type: "checkbox",
          checked: selection.selected.has(position),
          disabled: c.running,
          onchange: (event) => {
            if (event.target.checked) selection.selected.add(position);
            else selection.selected.delete(position);
            updateCompareRetry();
          },
        }),
        h(
          "span",
          {},
          `Row ${rowNumber} · Variant ${VARIANTS[variant]}${orderLabel} · `,
          error === undefined ? "Skipped" : `Failed · ${error}`,
        ),
      );
    }),
  );
  const selectAll = (checked) => {
    selection.selected = new Set(checked ? pending.map(({ position }) => position) : []);
    for (const input of list.querySelectorAll("input")) input.checked = checked;
    updateCompareRetry();
  };
  const host = h(
    "div",
    { id: "compare-retry", class: "grid", style: { gap: "4px", fontSize: "12.5px" } },
    h(
      "div",
      {},
      h("button", { class: "btn sm", id: "compare-retry-run", onclick: retryCompare }),
      " ",
      h("span", { id: "compare-retry-estimate" }),
    ),
    h("span", { id: "compare-retry-reason", class: "muted", "aria-live": "polite" }),
    h(
      "details",
      {
        open: selection.open,
        ontoggle: (event) => {
          if (event.target.isConnected) selection.open = event.target.open;
        },
      },
      h("summary", {}, `Choose from ${pending.length} unanswered call${pending.length === 1 ? "" : "s"}`),
      h(
        "div",
        { class: "grid", style: { gap: "8px", paddingTop: "8px" } },
        h(
          "div",
          { class: "chips" },
          h("button", { class: "btn sm ghost", disabled: c.running, onclick: () => selectAll(true) }, "Select all"),
          h(
            "button",
            { class: "btn sm ghost", disabled: c.running, onclick: () => selectAll(false) },
            "Clear selection",
          ),
        ),
        list,
      ),
    ),
  );
  updateCompareRetry(host);
  return host;
}

async function runCompare() {
  const c = W.compare;
  if (c.running) return;
  const sourceText = W.bulk.rowsText;
  let request;
  try {
    request = {
      sourceText,
      editorKey: compareEditorKey(),
      body: { rows: rowsPayload(sourceText), variants: compareVariants() },
    };
  } catch (e) {
    return toast(e.message, "error");
  }
  const previous = c.result;
  c.running = "compare";
  render();
  let done = false;
  try {
    if (request.body.variants.some((variant) => !variant.model)) {
      const { model } = await api("/api/status");
      request.body.variants = request.body.variants.map((variant) => ({ ...variant, model: variant.model || model }));
    }
    if (!(await confirmSpend(api, "compare", request.body))) return;
    if (c.result !== previous || !compareDraftMatches(request))
      return toast("The comparison changed. Run both variants again.", "error");
    const result = await api("/api/workbench/compare", request.body);
    if (c.result !== previous) return toast("The earlier comparison finished. Its calls counted toward the budget.");
    c.result = result;
    c.runRequest = request;
    c.retrySelection = { selected: new Set(comparePendingCalls(result).map(({ position }) => position)), open: false };
    c.sourceText = sourceText;
    c.sliceField = null;
    c.qid = chooseCmpQuestion();
    await rescoreCompare();
    if (result.stopped) toast(result.stopped, "error");
    done = c.result === result;
  } catch (e) {
    handleError(e);
  } finally {
    c.running = false;
    render();
  }
  if (done && W.tab === "compare") $("#compare-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function retryCompare() {
  const c = W.compare;
  if (c.running) return;
  const body = compareRetryBody();
  if (!body) return;
  const previous = c.result;
  const request = c.runRequest;
  c.running = "retry";
  render();
  try {
    if (!(await confirmSpend(api, "compare_retry", body))) return;
    const ready = compareRetryBody();
    if (
      c.result !== previous ||
      c.runRequest !== request ||
      !ready ||
      JSON.stringify(ready.positions) !== JSON.stringify(body.positions)
    )
      return toast("The comparison changed. Check the report before retrying.", "error");
    const attempt = await api("/api/workbench/compare/retry", body);
    if (c.result !== previous || c.runRequest !== request)
      return toast("The earlier comparison finished retrying. Its calls counted toward the budget.");
    // The report and retry both belong to the same frozen request, even if the editor changed after dispatch.
    const result = mergeCompareRetry(previous, attempt);
    c.result = result;
    if (!cmpQuestions(result).includes(c.qid)) c.qid = chooseCmpQuestion();
    await rescoreCompare();
    if (result.stopped) toast(result.stopped, "error");
    if (result.retry_error) toast(result.retry_error, "error");
  } catch (e) {
    handleError(e);
  } finally {
    c.running = false;
    render();
  }
}
