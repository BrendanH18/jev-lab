// Drift (jev/drift.py): compare unlabeled new rows with a check's dataset, and label the new traffic it found.
import { api, h, handleError, icon, mount, pct, photoView, stat, toast, usd } from "./common.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { W } from "./workbench-state.js";
import { stringify } from "./workbench-build.js";
import { render } from "./workbench.js";
import { rowsText, bulkUnsaved, loadPictureUrls, rowsPayload, rowText } from "./workbench-bulk.js";
import { agreeQuestions } from "./workbench-datasets.js";
import { runCheck, CHECK_BADGE } from "./workbench-checks.js";
import { queueReady, queueSelect } from "./workbench-review.js";
import { withCI } from "./workbench-calibrate.js";

// ---------- Drift ----------
// jev/drift.py runs the dataset's rows and the new rows, both live, and compares them through the check's gate: the share
// automated, each question's answers and confidence, and an estimated accuracy on the new rows, which need no labels.
// The rows box's formats: one row per line, or a JSON array of rows (rowsPayload parses it as Bulk does).
const lineCount = (text) => { const rows = rowsPayload(text); return Array.isArray(rows) ? rows.length : rows.split("\n").filter((l) => l.trim()).length; };

export function driftForm(x, run) {
  const d = run.drift;
  const calls = () => {
    const extra = lineCount(d.text);
    return `Compare · ${Math.min(x.rows - (x.test?.rows || 0), 200) + Math.min(extra, 200)} calls`;
  };
  const label = h("span", {}, calls());
  const area = h("textarea", { class: "input", spellcheck: "false", rows: "5", "aria-label": `New rows to compare with ${x.id}`,
    placeholder: "New rows, one per line, as in the rows box: text, or a JSON object. They need no labels; any _expect labels are ignored." }, d.text);
  area.addEventListener("input", () => { d.text = area.value; mount(label, calls()); });
  const fromBox = () => { d.text = W.bulk.rowsText || ""; render(); };
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("p", { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
      "Paste rows the gate will see now, such as this week's traffic. Both the dataset's rows and these are sent to ",
      h("code", {}, run.model.trim() || x.check.model), ", one call per row, and compared through the gate: what share it automates, how each question answers and how sure it is, and, from the labeled dataset rows like them, how accurate it is likely to be on them."),
    area,
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: run.running || d.running || d.busy || run.upgrade.running, onclick: () => runDrift(x.id) },
        d.running ? [h("span", { class: "spin" }), " Comparing…"] : [icon("layers"), label]),
      estimateLine(h, api, "drift", () => (lineCount(d.text) ? { id: x.id, rows: rowsPayload(d.text), model: run.model.trim() || undefined } : null)),
      h("button", { class: "btn sm ghost", onclick: fromBox, title: "Copy the Bulk rows box into this box" }, "Use the rows box"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "Up to 200 new rows. Comparing saves nothing.")));
}

async function runDrift(id) {
  const run = W.bulk.checkRuns[id];
  if (!run || run.running || run.drift.running || run.drift.busy || run.upgrade.running) return;
  const d = run.drift;
  if (!lineCount(d.text)) return toast("Paste the new rows to compare, one per line", "error");
  if (d.report?.labeling?.items.some((i) => Object.values(i.labels).some((v) => v !== null && v !== undefined))
      && !confirm("Compare again and discard the unsaved labels in this traffic queue?")) return;
  if (!(await confirmSpend(api, "drift", { id, rows: rowsPayload(d.text), model: run.model.trim() || undefined }))) return;
  d.running = true;
  d.report = null;
  d.labelsOpen = false;
  d.saved = null;
  render();
  try {
    const report = await api("/api/workbench/checks/drift", { id, rows: rowsPayload(d.text), model: run.model.trim() || undefined });
    if (W.bulk.checkRuns[id] !== run) return;
    d.report = report;
    await loadPictureUrls(report.labeling?.items || []);
  } catch (e) { handleError(e); }
  d.running = false;
  render();
}

const DRIFT_BADGE = { steady: ["good", "check", "Looks like the dataset"], shift: ["warning", "alert", "Shifted"], error: ["warning", "eye", "Not compared"] };
export const pval = (p) => (p === null || p === undefined ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));
const pctOr = (p, digits = 0) => (p === null || p === undefined ? "—" : pct(p, digits));

export function driftReport(x, run) {
  const d = run.drift;
  const rep = d.report;
  const [tone, ic, label] = DRIFT_BADGE[rep.status];
  const [ctone, , clabel] = CHECK_BADGE[rep.check_status];
  const ref = rep.reference, nu = rep.new, e = rep.estimate, t = rep.targets;
  const mark = (ok) => h("span", { class: `badge ${ok ? "good" : "critical"}` }, ok ? "meets" : "misses");
  const shift = (on) => (on ? h("span", { class: "badge warning", style: { marginLeft: "4px" } }, "shift") : null);
  const moves = (q) => [...q.mix].sort((a, b) => Math.abs((b.new_share ?? 0) - (b.reference_share ?? 0)) - Math.abs((a.new_share ?? 0) - (a.reference_share ?? 0)))
    .slice(0, 3).filter((m) => m.reference || m.new);
  const median = (s) => (s.median === null ? "—" : s.median.toFixed(2));
  const pline = (p, on) => h("div", { class: "faint", style: { whiteSpace: "nowrap" } }, p === null ? "no test" : `adjusted p ${pval(p)}`, shift(on));
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
    d.saved ? h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
      "This comparison used the dataset before the labeled rows below were added.") : null,
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${tone}` }, icon(ic), label),
      h("span", { class: `badge ${ctone}`, title: "The check, judged on the dataset run" }, `check on the dataset: ${clabel}`),
      h("span", { class: "faint", style: { fontSize: "12px" } },
        `${ref.rows} dataset rows · ${nu.rows} new rows · asked ${rep.model}${rep.answered_by?.length ? `, answered by ${rep.answered_by.join(", ")}` : ""}`)),
    h("div", { class: "stat-row" },
      stat("automated, dataset", ref.share === null ? "—" : withCI(`${ref.automated} of ${ref.routed} · ${pct(ref.share)}`, ref.share_low, ref.share_high)),
      stat("automated, new rows", nu.share === null ? "—" : [withCI(`${nu.automated} of ${nu.routed} · ${pct(nu.share)}`, nu.share_low, nu.share_high),
        t.coverage ? [" ", mark(t.coverage.ok)] : null]),
      stat("adjusted p", rep.automation.p_adjusted === null ? "—" : [pval(rep.automation.p_adjusted), shift(rep.automation.shifted)]),
      stat("accuracy when automated, dataset", ref.accuracy === null ? "—" : withCI(pct(ref.accuracy, 1), ref.accuracy_low, ref.accuracy_high)),
      stat("estimated, new rows", e.accuracy === null ? "—" : [withCI(pct(e.accuracy, 1), e.low, e.high), t.accuracy ? [" ", mark(t.accuracy.ok)] : null]),
      stat("cost", `${usd(rep.cost_usd)} · ${rep.calls} calls`)),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "question"), h("th", {}, "answers, dataset → new"),
        h("th", {}, `median ${rep.signal === "confidence" ? "confidence" : "top probability"}`))),
      h("tbody", {}, rep.questions.map((q) => h("tr", {},
        h("td", {}, h("div", { class: "mono" }, q.qid), q.gated ? h("div", { class: "faint mono", style: { fontSize: "12px" } }, `gate ≥ ${q.threshold.toFixed(2)}`) : null),
        h("td", { style: { fontSize: "12px" } }, moves(q).map((m) => h("div", { style: { whiteSpace: "nowrap" } },
          h("span", { class: "mono" }, m.answer), ` ${pctOr(m.reference_share)} → ${pctOr(m.new_share)}`)), pline(q.mix_p_adjusted, q.mix_shifted)),
        h("td", { style: { fontSize: "12px" } }, h("div", { class: "mono", style: { whiteSpace: "nowrap" } }, `${median(q.signal.reference)} → ${median(q.signal.new)}`),
          pline(q.signal.p_adjusted, q.signal.shifted))))))),
    rep.reasons.length || rep.check_reasons.length ? h("ul", { class: "muted", style: { fontSize: "12.5px", margin: 0, paddingLeft: "18px" } },
      rep.check_reasons.map((r) => h("li", {}, `The check: ${r}`)), rep.reasons.map((r) => h("li", {}, r))) : null,
    (rep.notes || []).map((note) => h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } }, icon("eye"), " ", note)),
    rep.thin.length ? h("div", { class: "grid", style: { gap: "4px" } },
      h("span", { class: "faint", style: { fontSize: "12px" } }, `Worth labeling: new automated rows few labeled rows are like · ${rep.thin_total}`),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("tbody", {}, rep.thin.slice(0, 5).map((r) => h("tr", {},
          h("td", { class: "num" }, String(r.index + 1)),
          h("td", { class: "row", style: { maxWidth: "300px" } }, r.row),
          h("td", { class: "mono", style: { fontSize: "12px" } }, r.answers))))))) : null,
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      `Each p-value is adjusted for the ${rep.tests} tests in this report (Holm); a shift is an adjusted p below ${rep.alpha}. `,
      "The estimate gives each new automated row the accuracy of the labeled, automated dataset rows with the same gated answers, and the same confidence band when enough share it. ",
      "It assumes rows with the same answers are as often right in both sets, so label a sample of the new rows before relying on it."),
    rep.labeling ? driftLabels(x, run) : null);
}

// Label actual inputs selected by the comparison. These targeted rows never produce an audit score.
function driftLabels(x, run) {
  const d = run.drift;
  const rep = d.report.labeling;
  const ready = rep.items.filter((i) => queueReady(i, rep.gates));
  const adding = Math.min(ready.length, rep.room);
  const busy = d.busy || d.running || run.running || run.upgrade.running;
  const counts = rep.counts;
  const card = (item) => h("div", { class: `queue-item${queueReady(item, rep.gates) ? " done" : ""}` },
    h("span", { class: "faint mono", style: { fontSize: "11.5px" } }, `new row ${item.line}`),
    h("div", { class: "row-text", style: { whiteSpace: "pre-wrap" } }, rowText(item.row)),
    W.bulk.pictures[item.row._image] ? h("div", { style: { maxWidth: "560px" } },
      photoView(W.bulk.pictures[item.row._image], [], { alt: `Picture for new row ${item.line}` })) : null,
    h("div", { class: "queue-labels" }, Object.entries(rep.questions).map(([qid, question]) => {
      const select = queueSelect(item, qid, question, render);
      select.disabled = busy;
      return h("label", { class: "queue-label" },
        h("span", { class: "mono" }, qid, qid in rep.gates ? h("span", { class: "faint" }, " · required") : null),
        h("span", { class: "faint", style: { fontSize: "12px", maxWidth: "360px" } }, stringify(question.instructions)), select,
        W.guides?.hint(x.id, qid, question));
    })));
  const n = Math.min(x.rows - (x.test?.rows || 0), 200);
  return h("div", { class: "grid", style: { gap: "8px", paddingTop: "8px", borderTop: "1px solid var(--line)" } },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: busy || (!rep.items.length && !d.saved), "aria-expanded": String(d.labelsOpen),
        onclick: () => { d.labelsOpen = !d.labelsOpen; render(); } }, icon("check"), `Label new traffic · ${rep.items.length} rows`),
      counts.in_dataset || counts.repeated ? h("span", { class: "faint", style: { fontSize: "12px" } },
        `${counts.in_dataset} already in the dataset · ${counts.repeated} repeated`) : null),
    counts.unsupported ? h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      `${counts.unsupported} array row${counts.unsupported === 1 ? " cannot" : "s cannot"} carry labels without changing the model's input. They are left out of this queue.`) : null,
    d.labelsOpen ? [
      h("p", { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
        "These automated rows have little support in the labeled dataset. Choose labels from their text and pictures. This is a targeted sample, not a random audit; it does not measure accuracy on all new traffic. Labeling and saving make no model calls."),
      agreeQuestions(rep.questions),
      rep.items.length ? h("div", { class: "queue-list" }, rep.items.map(card))
        : h("div", { class: "empty" }, "All queued rows have been added."),
      rep.items.length ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        h("button", { class: "btn sm primary", disabled: busy || !adding, onclick: () => addDriftLabels(x.id) },
          d.busy ? h("span", { class: "spin" }) : icon("save"), `Add ${adding} labeled row${adding === 1 ? "" : "s"} to “${x.name || x.id}”`),
        h("span", { class: "faint", style: { fontSize: "12px" } },
          `Label every required question to add a row. Room for ${rep.room} more; other labels stay here. Only inputs and your labels are saved.`)) : null,
    ] : null,
    d.saved ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: "muted", style: { fontSize: "12.5px" } }, `${d.saved.added} rows added${d.saved.already ? ` · ${d.saved.already} already present` : ""}.`),
      h("button", { class: "btn sm", disabled: busy, onclick: () => runCheck(x.id) }, icon("layers"), `Rerun check · ${n} call${n === 1 ? "" : "s"}`)) : null);
}

async function addDriftLabels(id) {
  const b = W.bulk;
  const run = b.checkRuns[id];
  if (!run || run.running || run.upgrade.running || run.drift.running || run.drift.busy) return;
  const d = run.drift;
  const report = d.report;
  const rep = report?.labeling;
  if (!rep) return;
  const ready = rep.items.filter((i) => queueReady(i, rep.gates)).slice(0, rep.room);
  if (!ready.length) return;
  d.busy = true;
  render();
  try {
    const items = ready.map((i) => ({ row: i.row,
      labels: Object.fromEntries(Object.entries(i.labels).filter(([, v]) => v !== null && v !== undefined)) }));
    const out = await api("/api/workbench/checks/drift/add", { id, items, questions: rep.questions });
    if (b.checkRuns[id] !== run || d.report !== report) return;
    rep.items = rep.items.filter((i) => !ready.includes(i));
    rep.room = out.room;
    d.saved = { added: (d.saved?.added || 0) + out.added, already: (d.saved?.already || 0) + out.already };
    b.datasets = b.datasets.map((x) => x.id === id ? out.dataset : x);
    run.report = run.upgrade.report = null;
    if (b.dataset.id === id) {
      b.testScore = null;
      const source = b.dataset;
      const clean = !bulkUnsaved();
      // Until refreshed, saving this old editor snapshot must ask before it can replace the appended rows.
      source.id = null;
      if (clean) {
        const loaded = (await api("/api/workbench/datasets/load", { id })).dataset;
        if (b.dataset === source && source.id === null && !bulkUnsaved()) {
          b.rowsText = b.savedText = rowsText(loaded.rows);
          source.id = id;
        }
      }
      if (b.dataset === source && source.id === null && bulkUnsaved()) {
        toast("The rows box has unsaved edits. They are kept; saving under this dataset's name will ask before replacing the added rows.", "error");
      }
    }
    toast(`Added ${out.added} labeled row${out.added === 1 ? "" : "s"}. Rerun the check when you want fresh answers.`);
  } catch (e) { handleError(e); }
  finally { d.busy = false; render(); }
}
