// Calibrate: one question's accuracy against its labels at a threshold, probability maps (jev/recalibrate.py)
// and answer sets (jev/answersets.py), plus the chart and label helpers the other Bulk panels share.
import { $, $$, api, copyText, h, handleError, icon, mount, num, pct, stat, statusBadge, toast } from "./common.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { bulkQuestions, tuningResults, rowText, bulkQuestionsForResult } from "./workbench-bulk.js";
import { rereview, reviewSoon } from "./workbench-labeling.js";
import { costCalibrate, updateCalCost, clearHoldout, holdoutPanel, runHoldout } from "./workbench-costs.js";
import { reslice, sliceSoon, sliceBody } from "./workbench-policy.js";

// ---------- Calibrate ----------
// Scores one question's Bulk answers against labels and sweeps a confidence threshold. The server
// does the arithmetic (jev/calibrate.py); no model calls. The slider and chart update in place.
const SVGNS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
export const SIGNALS = { confidence: "confidence", top_probability: "top probability" };
// What must reach a target accuracy: the accuracy measured on these rows, or its 95% lower bound (jev/calibrate.py).
const BOUNDS = { estimate: "targets on these rows", lower: "targets at 95% confidence" };

export function boundSelect(state, onChange) {
  const sel = h("select", { class: "input", "aria-label": "What must reach a target accuracy" },
    Object.entries(BOUNDS).map(([k, label]) => h("option", { value: k, selected: k === state.bound }, label)));
  sel.addEventListener("change", async () => { state.bound = sel.value; await onChange(); render(); });
  return sel;
}
// A 95% interval as "81–97%", or "" when there is nothing to measure.
export const interval = (lo, hi) => (lo === null || lo === undefined ? "" : `${pct(lo)}–${pct(hi)}`);
export const withCI = (value, lo, hi) => (lo === null || lo === undefined ? value : [value, h("span", { class: "ci", title: "95% interval" }, ` ${interval(lo, hi)}`)]);
// The label of a target that was not reached, saying how many rows a 95% claim needs when that is the reason.
// A plan (jev/calibrate.py plan()) says how many more labeled rows like these would show the target, if the
// gate it names keeps its accuracy and share automated; it is an estimate, so the chip's title says so.
export function unreached(t, bound, labeled) {
  const p = t.plan;
  if (bound === "lower" && p) {
    const at = p.gates ? Object.entries(p.gates).map(([q, g]) => `${q} ≥ ${g.toFixed(2)}`).join(", ") : `≥ ${p.threshold.toFixed(2)}`;
    return `${pct(t.target)} at 95% confidence: label about ${num(p.more)} more rows like these (if ${at} stays near ${pct(p.accuracy)} accurate, automating ${pct(p.coverage)})`;
  }
  if (bound === "lower" && labeled < t.needed) return `${pct(t.target)} at 95% confidence: needs ${t.needed}+ automated rows, all right (${labeled} labeled)`;
  return `${pct(t.target)} accurate${bound === "lower" ? " at 95% confidence" : ""}: not reached on these rows`;
}
export const targetName = (target, bound) => (bound === "lower" ? `${pct(target)} at 95% confidence` : `${pct(target)} accurate`);

export function answerClasses(answer) {
  if (answer.type === "noul") return ["yes", "no"];
  const keys = Object.keys(answer.probabilities || {});
  return answer.type === "score" ? keys.sort((a, c) => Number(a) - Number(c)) : keys;
}
export function labelText(value, type) {
  if (value === undefined || value === null || value === "") return "";
  if (type === "box" && typeof value === "object") return JSON.stringify(value);
  if (type === "noul") {
    if (value === true || /^(yes|true|1|y)$/i.test(String(value))) return "yes";
    if (value === false || /^(no|false|0|n)$/i.test(String(value))) return "no";
  }
  return String(value);
}
export function labelValue(text, type) {
  if (text === "") return null;
  if (type === "noul") return text === "yes" ? true : text === "no" ? false : text;
  if (type === "score" && /^\d+$/.test(text)) return Number(text);
  return text;
}
export function labeledQids(b) {
  const qids = new Set();
  for (const labels of Object.values(b.labels)) for (const q of Object.keys(labels)) qids.add(q);
  return qids;
}
export function chooseCalQuestion() {
  const b = W.bulk;
  const qids = Object.keys(bulkQuestionsForResult(b.result));
  const labeled = labeledQids(b);
  if (qids.includes(b.cal.qid) && (labeled.has(b.cal.qid) || !labeled.size)) return b.cal.qid;
  return qids.find((q) => labeled.has(q)) || qids[0] || null;
}
// Labels or Calibrate's question or signal changed: rescore it, and re-review labels, which follow both.
export async function recalibrate() {
  await Promise.all([calibrateQuestion(), rereview(), costCalibrate(), answerSets()]);
}
let calSeq = 0;
async function calibrateQuestion() {
  const b = W.bulk;
  const qid = b.cal.qid;
  const seq = ++calSeq;  // only the latest request may install its report
  clearHoldout(b.cal);
  const rows = qid ? tuningResults(b.result).filter((r) => r.answers[qid])
    .map((r) => ({ index: r.index, answer: r.answers[qid], label: b.labels[r.index]?.[qid] ?? null })) : [];
  b.cal.report = null;
  if (!rows.length) return;
  try {
    const report = await api("/api/workbench/calibrate", { rows, signal: b.cal.signal, bound: b.cal.bound });
    if (seq === calSeq) b.cal.report = report;
  } catch (e) { if (seq === calSeq) handleError(e); }
}

// Recalibrate probability values, independently of the routing thresholds above.
function probabilityMapsPanel() {
  const c = W.bulk.cal;
  const box = h("section", { id: "recalibrate", class: "grid", style: { gap: "10px" } });
  const button = h("button", { class: "btn sm", onclick: async () => {
    button.disabled = true;
    const seq = calSeq;
    const rows = tuningResults(W.bulk.result).filter((r) => r.answers[c.qid]).map((r) => ({
      index: r.index, row: r.row, key: rowText(r.row), answer: r.answers[c.qid], label: W.bulk.labels[r.index]?.[c.qid] ?? null,
    }));
    try {
      const rep = await api("/api/workbench/recalibrate", { rows, signal: c.signal });
      if (seq !== calSeq || !box.isConnected) return;
      output.replaceChildren(probabilityMapsReport(rep));
    } catch (e) { if (seq === calSeq && box.isConnected) output.replaceChildren(h("p", { class: "muted" }, e.message)); }
    finally { button.disabled = false; }
  } }, "Fit and check probability maps");
  const output = h("div", { class: "grid", style: { gap: "10px" }, "aria-live": "polite" });
  box.append(h("h3", {}, "Recalibrate probabilities"),
    h("p", { class: "muted" }, "Map the selected signal to the chance the answer is right, for code that uses that chance itself: the expected cost of acting on an answer, a product of two answers' chances of being right, or a chance shown to a person. It is not P(yes) or a class probability, so do not put it in a weighted sum of P(yes) values such as Shield's. This does not tune routing: thresholds already use measured accuracy. Confidence can be a margin rather than a probability; the selected signal is mapped to the chance the prediction is right. At least 20 labeled rows with both right and wrong answers; no extra model calls."), button, output);
  return box;
}
function probabilityMapsReport(rep) {
  const chosen = rep.recommendation;
  const names = { raw: "Raw", platt: "Platt", isotonic: "Isotonic" };
  const table = h("table", { class: "table" },
    h("thead", {}, h("tr", {}, ["Method", "Fit ECE", "Fit Brier", "Fit log loss", "CV ECE", "CV Brier", "CV log loss"].map((s) => h("th", {}, s)))),
    h("tbody", {}, Object.entries(rep.methods).map(([name, m]) => h("tr", {}, h("td", {}, names[name]),
      ...[m.fit.ece, m.fit.brier, m.fit.log_loss, m.cv.ece, m.cv.brier, m.cv.log_loss].map((v) => h("td", { class: "mono" }, v.toFixed(4)))))));
  const chart = svg("svg", { viewBox: "0 0 340 260", role: "img", "aria-label": "Cross-validated reliability: stated probability versus observed correctness", style: "width:100%;max-width:440px" },
    svg("line", { x1: 40, y1: 220, x2: 300, y2: 20, stroke: "currentColor", "stroke-dasharray": "4 4" }),
    svg("path", { d: "M40 20V220H300", fill: "none", stroke: "currentColor" }),
    svg("text", { x: 90, y: 250, fill: "currentColor", "font-size": 11 }, "Stated probability (0–1)"),
    svg("text", { x: 45, y: 12, fill: "currentColor", "font-size": 11 }, "Observed correctness (0–1)"));
  for (const [name, color] of [["raw", "#df9550"], [chosen, "#63b6cd"]]) {
    const bins = rep.methods[name].cv.reliability;
    chart.append(svg("polyline", { points: bins.map((b) => `${40 + b.stated * 260},${220 - b.observed * 200}`).join(" "), fill: "none", stroke: color, "stroke-width": 2 }));
    for (const b of bins) chart.append(svg("circle", { cx: 40 + b.stated * 260, cy: 220 - b.observed * 200, r: 3, fill: color }));
  }
  const code = rep.methods[chosen].source;
  return h("div", { class: "grid", style: { gap: "10px" } },
    h("p", {}, `${chosen === "raw" ? "Keep raw" : `Recommend ${names[chosen]}`}: lowest five-fold cross-validated log loss, requiring an improvement of at least ${rep.margin.toFixed(3)} over raw. ${rep.labeled} labeled rows. Fitting numbers never select the map.`),
    h("div", { class: "scroll" }, table), chart,
    h("p", { class: "muted" }, `Cross-validated reliability: raw (orange), ${names[chosen]} (blue), ideal (dashed). These are predictions from maps fitted without each row. The copied map is refitted on all tuning rows. A flat part can merge distinct signals; keep routing on raw signals and existing thresholds.`),
    h("details", {}, h("summary", {}, "Reliability tables (fit and cross-validated)"),
      Object.entries(rep.methods).map(([name, m]) => h("div", {}, h("h4", {}, names[name]),
        ["fit", "cv"].map((part) => h("div", {}, h("p", {}, part === "fit" ? "Fitting rows" : "Cross-validated rows"), reliabilityTable({ ...m[part], probabilityMap: true })))))),
    ["python", "javascript"].map((lang) => h("div", { class: "code" }, h("pre", {}, code[lang]),
      h("button", { class: "btn sm copy", onclick: () => copyText(code[lang]) }, icon("copy"), lang === "python" ? "Copy Python" : "Copy JavaScript"))));
}

export function renderCalibrate() {
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
      rep.type === "box" ? null : holdoutPanel(c, "cal-holdout", () => [c.qid]),
      rep.type === "box" ? h("div", { class: "stat-row" }, stat("mean overlap with the label (IoU)", rep.iou_mean === null ? "—" : rep.iou_mean.toFixed(2)),
        stat("counts as right at", `IoU ≥ ${rep.iou_right}`)) : null,
      h("div", { class: "cal-tables" }, rep.type === "box" ? null : confusionTable(rep), reliabilityTable(rep)),
      rep.type === "box" ? null : probabilityMapsPanel(),
      rep.ordinal ? ordinalBlock(rep.ordinal, c.qid) : null,
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
          : rep.type === "score" ? "Right means the most likely level equals the labeled level."
            : rep.type === "box" ? `Right means the answer's box overlaps the labeled box with an IoU of at least ${rep.iou_right}. A Box has no options, so the gate reads its confidence either way.`
              : "Right means the selected option equals the label.")),
      calLabBlock()));
}

// A Score's levels are ordered, so say how far off its answers are, and which cut on the expected score
// (the weighted .score) best decides "at least level k" on these rows (jev/calibrate.py ordinal()).
function ordinalBlock(o, qid) {
  const key = JSON.stringify(qid);
  return h("div", { class: "grid", style: { gap: "10px" } },
    h("h3", { class: "cal-h" }, "How far off: Score levels are ordered"),
    h("div", { class: "stat-row" },
      stat("within one level", withCI(pct(o.within_one_accuracy, 1), o.within_one_low, o.within_one_high)),
      stat("mean error, most likely level", `${o.mean_error.toFixed(2)} levels`),
      stat("mean error, expected score", o.expected_error === null ? "—" : `${o.expected_error.toFixed(2)} levels`)),
    o.cuts.length ? h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "to flag a label of"), h("th", {}, "act when the expected score is"),
        h("th", {}, "accuracy, every row"), h("th", {}, "flagged"), h("th", {}, "labeled at that level or above"))),
      h("tbody", {}, o.cuts.map((c) => h("tr", {},
        h("td", {}, `${c.level} or above`), h("td", { class: "mono" }, `≥ ${c.cut.toFixed(2)}`),
        h("td", {}, withCI(`${pct(c.accuracy, 1)} (${c.correct}/${c.rows})`, c.low, c.high)),
        h("td", {}, String(c.flagged)), h("td", {}, String(c.actual))))))) : null,
    o.cuts.length ? h("p", { class: "faint", style: { fontSize: "12.5px" } },
      "An application often acts on the expected score rather than one level, for example ",
      h("code", {}, `result.scores[${key}].score >= ${o.cuts[o.cuts.length - 1].cut.toFixed(2)}`),
      ". Each cut is the one on a 0.05 grid that agrees best with the labels on these rows, so its accuracy is optimistic until you check it on rows it was not chosen on. The coarse grid keeps a cut from fitting the gap between two rows.") : null);
}

export function invalidNote(rep) {
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
    h("h3", { class: "cal-h" }, rep.probabilityMap ? "When the mapped signal states…, the prediction is right…" : noul ? "When Jev says P(yes) is…, the label is yes…" : rep.type === "box" ? "When Jev's confidence is…, the box is right…" : "When Jev's top probability is…, it is right…"),
    h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, rep.probabilityMap ? "signal" : noul ? "P(yes)" : rep.type === "box" ? "confidence" : "top probability"), h("th", {}, "rows"), h("th", {}, "average stated"), h("th", {}, noul ? "label yes" : "right"))),
      h("tbody", {}, rep.reliability.map((bin) => h("tr", {},
        h("td", { class: "mono" }, `${pct(bin.lo)}–${pct(bin.hi)}`), h("td", {}, String(bin.count)), h("td", {}, pct(bin.stated)),
        h("td", {}, `${pct(bin.observed)} (${bin.hits}/${bin.count})`))))));
}

function calCode(rep, qid, signal, t) {
  // Fixed local names: a question id such as "level" must not shadow the answer.
  const key = JSON.stringify(qid);
  if (rep.type === "box") return `answer = result.boxes[${key}]\nif answer.confidence >= ${t.toFixed(2)}:\n    act_on(answer.box)  # left, top, right, bottom as fractions\nelse:\n    send_to_review()\n`;
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
export function updateCal() {
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
  if (W.lab?.active?.(CAL_LAB) && $("#cal-lab-rows")) mount("#cal-lab-rows", calLabRows());  // its route column follows t
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

// ---------- Answer sets ----------
// For Calibrate's question, the shortest list of answers that holds the right one as often as asked (jev/answersets.py):
// every option at or above a cut fitted on the labeled rows joins a row's set. One answer can be acted on; a longer
// set goes to review with only those answers. The server does the arithmetic and cross-validates it; no model calls.
const SETTABLE = new Set(["choice", "noul", "score"]);
const SET_COVERAGES = [0.8, 0.9, 0.95, 0.99];
const SETS_SHOWN = 8;
// The cut as shown; the copied rule uses the full cut and the server's tolerance, so it builds the same sets.
const cutText = (cut) => cut.toFixed(3);
// A fit belongs to one run and its labels/questions. Never carry it into a newer run or edited inputs.
export function setFitContext() {
  const b = W.bulk;
  return JSON.stringify([b.labels, b.ranQuestions, bulkQuestions(), b.rowsText]);
}
export function syncAttachedSets() {
  const b = W.bulk;
  const s = b.sets;
  const context = setFitContext();
  if (s.result !== b.result || s.context !== context) {
    s.attached = {};
    s.result = b.result;
    s.context = context;
    s.fitted = null;
  }
}
export function attachedSetsPayload() {
  syncAttachedSets();
  return Object.keys(W.bulk.sets.attached).length ? structuredClone(W.bulk.sets.attached) : undefined;
}
export function attachedSetsText(sets) {
  return Object.entries(sets).map(([qid, spec]) => `${qid} ≥ ${cutText(spec.cut)} (target ${pct(spec.coverage)} coverage)`).join(" · ");
}
function attachedSetsControl(qid, rep) {
  const s = W.bulk.sets;
  const ready = rep?.cut !== null && rep?.cut !== undefined && s.fitted === s.context;
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: !ready, onclick: () => {
        syncAttachedSets();
        if (s.fitted !== s.context || rep !== s.report) return toast("The fit changed. Use the current Answer sets report before attaching a cut.", "error");
        s.attached = { ...s.attached, [qid]: { cut: rep.cut, coverage: rep.coverage_target } };
        render();
      } }, icon("list"), `Attach ${qid}'s cut to Policy export and check`),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "Shortlists assist review. Thresholds and rules still decide automation.")),
    Object.entries(s.attached).map(([key, spec]) => h("div", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px" } },
      h("span", { class: "mono" }, attachedSetsText({ [key]: spec })),
      h("button", { class: "btn sm ghost", "aria-label": `Remove ${key}'s attached answer set`, onclick: () => {
        delete s.attached[key]; render();
      } }, "Remove"))),
    !ready ? h("span", { class: "faint", style: { fontSize: "12px" } }, "Fit a cut on the current run and labels before attaching it.") : null);
}
let setSeq = 0;
async function answerSets() {
  const b = W.bulk;
  syncAttachedSets();
  const s = b.sets;
  const qid = b.cal.qid;
  const context = s.context;
  const result = b.result;
  const seq = ++setSeq;  // only the latest request may install its report
  s.report = null;
  if (!qid || !SETTABLE.has(bulkQuestionsForResult(b.result)[qid]?.type)) return;
  const rows = tuningResults(b.result).filter((r) => r.answers[qid])
    .map((r) => ({ index: r.index, key: rowText(r.row), row: r.row, answer: r.answers[qid], label: b.labels[r.index]?.[qid] ?? null }));
  if (!rows.length) return;
  try {
    const report = await api("/api/workbench/answersets", { rows, coverage: s.coverage, field: b.slice.field });
    if (seq === setSeq && result === b.result && context === setFitContext()) {
      s.report = report;
      s.fitted = context;
    }
  } catch (e) { if (seq === setSeq) handleError(e); }
}
export async function refreshSets() {
  await answerSets();
  if ($("#answer-sets")) $("#answer-sets").replaceWith(renderAnswerSets());
}

export function renderAnswerSets() {
  syncAttachedSets();
  const b = W.bulk;
  const s = b.sets;
  const qid = b.cal.qid;
  const type = bulkQuestionsForResult(b.result)[qid]?.type;
  if (!qid || !type) return null;
  const covSel = h("select", { class: "input", "aria-label": "How often a set must hold the right answer" },
    SET_COVERAGES.map((c) => h("option", { value: c, selected: c === s.coverage }, `hold the right answer ${pct(c)} of the time`)));
  covSel.addEventListener("change", () => { s.coverage = Number(covSel.value); refreshSets(); });
  const head = h("div", { class: "panel-head" }, icon("list"), h("h2", {}, "Answer sets"),
    h("span", { class: "faint", style: { fontSize: "12px" } }, `for “${qid}”, the question Calibrate shows; no extra calls`), h("div", { class: "spacer" }),
    SETTABLE.has(type) ? h("div", { class: "cal-controls" }, covSel) : null);
  const panel = (...body) => h("div", { class: "panel", id: "answer-sets" }, head, h("div", { class: "panel-body grid", style: { gap: "12px" } },
    ...body, attachedSetsControl(qid, s.report)));
  const note = (...text) => h("p", { class: "faint", style: { fontSize: "12.5px" } }, ...text);
  if (!SETTABLE.has(type)) return panel(h("p", { class: "muted" }, "A Box answer has no options to list, so it has no answer set. Choose a Choice, Noul, or Score question in Calibrate."));
  const rep = s.report;
  if (!rep || !rep.labeled) return panel(h("p", { class: "muted" }, `No labels for “${qid}” yet. Label rows in the table below to fit a set.`));
  const target = pct(rep.coverage_target);
  if (rep.cut === null) {
    return panel(h("p", { class: "muted" }, `A set that holds the right answer ${target} of the time needs at least ${rep.needed} labeled rows, and “${qid}” has ${rep.labeled}. Label more rows, or ask for a lower share.`));
  }
  const m = rep.summary;
  const u = rep.holdout;
  const perReview = (x) => (x.listed_per_review === null ? "—" : `${x.listed_per_review.toFixed(1)} of ${x.options} options`);
  const single = (x) => (x.single_accuracy === null ? "none" : withCI(`${pct(x.single_share)} · ${pct(x.single_accuracy, 1)} right`, x.single_low, x.single_high));
  const line = (label, x) => h("tr", {}, h("td", {}, label), h("td", {}, withCI(pct(x.coverage, 1), x.low, x.high)),
    h("td", {}, single(x)), h("td", {}, `${x.short} short · ${x.none} every option`), h("td", {}, perReview(x)));
  const sizes = Object.entries(m.sizes).sort(([a], [c]) => (a === "none") - (c === "none") || Number(a) - Number(c));
  const shown = calLabSetsRows(rep.rows.filter((r) => r.size >= 2)).slice(0, SETS_SHOWN);
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r.row]));
  const at = cutText(rep.cut);
  return panel(
    h("p", { style: { fontSize: "13px" } }, "Every option Jev gives ", h("b", { class: "mono" }, `≥ ${at}`),
      ` joins a row's set. A set of one answer can be acted on; a longer set goes to review with only those answers to choose from; a row where no option reaches ${at} goes to review with every option.`),
    h("div", { class: "stat-row" },
      stat("holds the right answer", withCI(pct(m.coverage, 1), m.low, m.high), true),
      stat("single answer", `${m.single} of ${m.rows} · ${pct(m.single_share)}`),
      stat("single answers right", m.single_accuracy === null ? "—" : withCI(pct(m.single_accuracy, 1), m.single_low, m.single_high)),
      stat("a reviewer reads", perReview(m))),
    h("div", { class: "chips" }, sizes.map(([k, n]) => h("span", { class: "chip", style: { cursor: "default" } },
      `${k === "none" ? "every option" : k === "1" ? "1 answer" : `${k} answers`}: ${n}`))),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "holds the right answer"), h("th", {}, "single answer · right"),
        h("th", {}, "sent to review"), h("th", {}, "a reviewer reads"))),
      h("tbody", {}, line("on these rows", m),
        u.rows ? line(`on unseen rows, ${u.folds} folds`, u)
          : h("tr", {}, h("td", {}, "on unseen rows"), h("td", { colspan: 4, class: "faint" }, u.problem || `Needs at least ${u.minimum} labeled rows to hold some out.`))))),
    u.rows ? note(`On unseen rows, each fold's sets come from a cut fitted on the other folds`,
      u.spread ? ` (cuts from ${cutText(u.spread[0])} to ${cutText(u.spread[1])})` : "",
      u.unreached ? `; ${u.unreached} of ${u.folds} folds had too few rows to promise ${target} and sent every row to review with every option` : "",
      ". Coverage there below the target, or cuts that swing between folds, mean the cut fits these rows more than the question.") : null,
    shown.length ? h("div", { class: "grid", style: { gap: "6px" } }, h("h3", { class: "cal-h" }, "Rows a person would choose for, from a short list",
      W.lab?.active?.(CAL_LAB) ? h("span", { class: "faint" }, " · rows Calibrate's Lab filters show") : null),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "the set"), h("th", {}, "label"))),
        h("tbody", {}, shown.map((r) => h("tr", {}, h("td", { class: "num" }, String(r.index + 1)),
          h("td", { class: "faint", style: { maxWidth: "340px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, rowText(rowsBy.get(r.index))),
          h("td", {}, r.set.map((k) => h("span", { class: "chip", style: { cursor: "default", marginRight: "4px" } }, `${k} ${pct(r.probabilities[k])}`))),
          h("td", {}, r.covered ? h("code", {}, r.label) : [h("code", {}, r.label), " ", statusBadge("fail", "Not in the set")]))))))) : null,
    setSlices(rep.slices),
    h("div", { class: "code" }, h("pre", { id: "sets-code" }, setsCode(rep, qid)),
      h("button", { class: "btn sm copy", onclick: () => copyText($("#sets-code").textContent) }, icon("copy"), "Copy")),
    note(`The cut is split conformal prediction: on new rows drawn like these labeled rows, a set holds the right answer at least ${target} of the time, on average, whether or not Jev's probabilities are calibrated. `,
      "It is a promise about rows on average, not about each kind of row, so check the slices; and the share of single answers that are right is measured here, not promised. ",
      type === "noul" ? "A Noul has two options, so its set is one answer or both, and this works like a threshold on P(yes). " : "",
      rep.unlabeled ? `${rep.unlabeled} answered rows have no label for “${qid}” and are not used. ` : "",
      rep.invalid.length ? `${rep.invalid.length} labels were ignored. ` : ""),
  );
}

// Coverage for each value of a row field (jev/slices.py over the sets): a set can hold the right answer less often
// on one kind of row even when it meets the target on average.
function setSlices(rep) {
  if (!rep?.field) return null;
  const sel = h("select", { class: "input", "aria-label": "Field to slice by", style: { width: "auto" } },
    rep.fields.map((f) => h("option", { value: f.name, selected: f.name === rep.field }, `${f.name} (${f.values} values)`)));
  sel.addEventListener("change", () => { W.bulk.slice.field = sel.value; reslice("cal"); reslice("pol"); refreshSets(); });
  const cov = (v, lo, hi) => (v === null ? "—" : withCI(pct(v, 1), lo, hi));
  const row = (label, x, mark) => h("tr", { class: mark ? "slice-below" : "" }, h("td", {}, label), h("td", { class: "num" }, String(x.rows)),
    h("td", {}, cov(x.accuracy, x.accuracy_low, x.accuracy_high)), h("td", {}, `${x.automated} · ${pct(x.coverage)}`),
    h("td", {}, cov(x.automated_accuracy, x.automated_low, x.automated_high)),
    h("td", {}, mark ? h("span", { class: "badge warning", title: `One-sided Fisher exact test against every other slice together: p = ${x.p_all.toFixed(3)}` }, "Holds it less often") : null));
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, h("h3", { class: "cal-h" }, "By slice"), sel),
    h("div", { class: "scroll" }, h("table", { class: "table slices" },
      h("thead", {}, h("tr", {}, h("th", {}, rep.field), h("th", {}, "rows"), h("th", {}, "holds the right answer"), h("th", {}, "single answer"),
        h("th", {}, "single answers right"), h("th", {}))),
      h("tbody", {}, rep.slices.map((x) => row(h("code", {}, x.value), x, x.below_all)), row(h("b", {}, "all"), rep.overall, false)))));
}

function setsCode(rep, qid) {
  const key = JSON.stringify(qid);
  const at = String(rep.cut);  // the shortest text that reads back as the same number, as Python's repr
  const read = rep.type === "noul"
    ? `p = result.nouls[${key}].noul\noptions = {"yes": p, "no": 1 - p}`
    : rep.type === "choice" ? `options = result.choices[${key}].probabilities` : `options = result.scores[${key}].probabilities`;
  return `# Answer set for ${key}: every option at or above the cut (fitted to hold the right answer ${pct(rep.coverage_target)} of the time)\n`
    + `CUT = ${at}\n${read}\n`
    + `answer_set = sorted((k for k, p in options.items() if p + 1e-9 >= CUT), key=lambda k: -options[k])\n`
    + `if len(answer_set) == 1:\n    act_on(answer_set[0])\nelif answer_set:\n    send_to_review(choices=answer_set)  # a person picks from these\nelse:\n    send_to_review(choices=list(options))  # no option reached the cut\n`;
}

// ---------- Lab surface "workbench.calibrate" (contract: static/js/lab/surfaces/workbench-analysis.js) ----------
// Calibrate's scored rows as a Lab list. The page reaches Lab only through W (W.lab, W.labEnv, W.lab.builders): without
// them there is no ctx, no section and no list, and Calibrate works exactly as it does without Lab. The ctx is built
// once per page session and reads W when called.
const CAL_LAB = "workbench.calibrate";
const calLabCtxs = {};

function calLab() {
  if (calLabCtxs.ctx) return calLabCtxs.ctx;
  const build = W.lab?.builders?.calibrateCtx;
  if (typeof build !== "function") return null;
  calLabCtxs.ctx = build({
    result: () => W.bulk.result,
    report: () => W.bulk.cal.report,
    qid: () => W.bulk.cal.qid,
    signal: () => W.bulk.cal.signal,
    bound: () => W.bulk.cal.bound,
    threshold: () => W.bulk.cal.threshold,
    labeledQids: () => labeledQids(W.bulk),
    cost: () => W.bulk.cal.cost,
    holdout: () => W.bulk.cal.holdout,
    sets: () => W.bulk.sets.report,
    setsCoverage: () => W.bulk.sets.coverage,
    attached: () => attachedSetsPayload() || {},
    slices: () => W.bulk.slice.cal,
    holdoutReady: () => !!$("#cal-holdout"),
    matches: (item, ctx) => W.lab.matches(CAL_LAB, item, ctx),
    arrange: (items, ctx) => W.lab.arrange(CAL_LAB, items, ctx),
    refresh: () => refreshCalLab(),
    // The page's own controls: the slider, the three selects, the coverage select and the unseen-row button.
    setThreshold: (t) => { W.bulk.cal.threshold = t; updateCal(); },
    selectQuestion: async (qid) => { W.bulk.cal.qid = qid; await recalibrate(); render(); },
    setSignal: async (signal) => { W.bulk.cal.signal = signal; await recalibrate(); render(); },
    setBound: async (bound) => { W.bulk.cal.bound = bound; await recalibrate(); render(); },
    setCoverage: (coverage) => { W.bulk.sets.coverage = coverage; return refreshSets(); },
    checkUnseen: () => runHoldout(W.bulk.cal, "cal-holdout", () => [W.bulk.cal.qid]),
  });
  return calLabCtxs.ctx;
}

// The Lab tools block of Calibrate and, while a Lab setting is active, the rows it shows. null without a pack.
function calLabBlock() {
  const ctx = calLab();
  const section = ctx ? W.lab?.section(W.labEnv, CAL_LAB, ctx, { title: "Lab tools for Calibrate's rows" }) || null : null;
  if (!section) return null;
  return h("div", { class: "grid", style: { gap: "8px" } }, h("div", { id: "cal-lab-rows" }, calLabRows()), section);
}

// "Rows Lab shows": exactly the ctx's shown() rows, at the slider's threshold. Nothing while no Lab setting is active.
function calLabRows() {
  const ctx = calLab();
  const active = ctx ? W.lab.active(CAL_LAB) : 0;
  if (!active) return null;
  const shown = ctx.shown();
  const t = W.bulk.cal.threshold;
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("p", { class: "faint", role: "status", style: { fontSize: "12.5px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
      `Rows Lab shows · ${shown.length} of ${ctx.items().length} scored rows · ${active} Lab setting${active === 1 ? "" : "s"} active. Calibrate's numbers above still cover every scored row.`,
      h("button", { class: "btn sm ghost", onclick: resetCalLab }, "Clear Lab filters and sort")),
    shown.length ? h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "label"), h("th", {}, "answer"), h("th", {}, SIGNALS[W.bulk.cal.signal] || "signal"), h("th", {}, "route"), h("th", {}, "result"))),
      h("tbody", {}, shown.map((item) => h("tr", {},
        h("td", { class: "num" }, String(item.number)),
        h("td", { class: "row", style: { maxWidth: "340px" } }, item.text),
        h("td", {}, h("code", {}, item.label)), h("td", {}, h("code", {}, item.predicted)),
        h("td", { class: "mono" }, item.signal.toFixed(2)),
        h("td", {}, item.signal + 1e-9 >= t ? statusBadge("execute", "Auto") : statusBadge("review")),
        h("td", {}, item.correct ? statusBadge("pass", "Right") : statusBadge("fail", "Wrong")))))))
      : h("p", { class: "faint", style: { fontSize: "12.5px" } }, "No scored row matches the Lab filters."));
}

function refreshCalLab() {
  if ($("#cal-lab-rows")) mount("#cal-lab-rows", calLabRows());
  if ($("#answer-sets")) $("#answer-sets").replaceWith(renderAnswerSets());
}

function resetCalLab() {
  W.lab?.reset?.(CAL_LAB);
  render();
}

// Answer sets' short-list rows, kept to the rows Calibrate's Lab filters show, in Lab's order, while a Lab setting is
// active; unchanged otherwise.
function calLabSetsRows(rows) {
  const ctx = W.lab?.active?.(CAL_LAB) ? calLab() : null;
  if (!ctx) return rows;
  const order = new Map(ctx.shown().map((item, i) => [item.index, i]));
  return rows.filter((r) => order.has(r.index)).sort((a, c) => order.get(a.index) - order.get(c.index));
}
