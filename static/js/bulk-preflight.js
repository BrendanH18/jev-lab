// Advisory row checks use the same request-state helpers as Bulk, without model calls.
import { api, h, handleError } from "./common.js";
import { W } from "./workbench-state.js";
import { bulkQuestions, rowsPayload, settleLabels } from "./workbench-bulk.js";
import { questionEditorError } from "./workbench-build.js";
import { render } from "./workbench.js";

let report = null, key = null, busy = false;
const context = () => JSON.stringify([W.bulk.rowsText, bulkQuestions(), W.bulk.labelsDirty]);

export async function checkBulkPreflight(show = true) {
  const error = W.bulk.source === "current" ? questionEditorError() : null;
  if (error) throw new Error(error);
  const requested = context();
  const checked = await api("/api/workbench/preflight", { rows: rowsPayload(), questions: bulkQuestions() });
  if (requested !== context()) throw new Error("Rows or questions changed during preflight. Check again.");
  report = checked; key = requested;
  if (show) render();
  return checked;
}

async function inspect() {
  if (busy || !settleLabels("Check Bulk inputs")) return;
  busy = true; render();
  try { await checkBulkPreflight(false); } catch (e) { handleError(e); }
  busy = false; render();
}

export function bulkPreflightBody() {
  const current = key === context() ? report : null;
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("div", {}, h("button", { class: "btn sm", disabled: busy, onclick: inspect }, busy ? "Checking inputs…" : "Check Bulk inputs")),
    h("p", { class: "faint" }, "Check referenced state paths and pictures on each input before spending. Advisory only; no model calls or writes. Label values stay hidden."),
    current ? h("div", { role: "status" },
      h("p", {}, `${current.rows} inputs checked · ${current.findings.length} findings`),
      h("ul", {}, ...current.findings.map((finding) => h("li", {}, `Row ${finding.row}${finding.question ? ` · ${finding.question}` : ""}: ${finding.message}`)))) : null);
}
