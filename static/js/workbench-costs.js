// Costs (jev/cost.py) for Calibrate and Policy, and Holdout: thresholds tuned on some rows, judged on the rest.
import { $, api, debounce, h, handleError, icon, mount, money, pct, stat, statusBadge } from "./common.js";
import { W } from "./workbench-state.js";
import { bulkQuestionsForResult } from "./workbench-bulk.js";
import { svg, withCI, targetName, answerClasses, updateCal } from "./workbench-calibrate.js";
import {
  GATEABLE, policyQids, activeGates, policyRules, policyRows, rescorePolicy, recheapPolicy, updatePolicy,
} from "./workbench-policy.js";

// ---------- Costs ----------
// Accuracy targets ask "how often is it right?"; an application pays for reviews and for mistakes. The prices here
// are shared by Calibrate, Policy, and Holdout, which ask jev/cost.py for the cheapest thresholds. No model calls.
const MAX_PRICE = 1e6;
const MAX_MISTAKES = 100;
const perK = (v) => money(v);

// The prices as the server takes them, or the reason they cannot be used yet.
export function costsPayload() {
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
export async function costCalibrate() {
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

export function renderCosts() {
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
export function costVs(m, rep) {
  const saved = rep.review_all.per_1000 - m.per_1000;
  return [perK(m.per_1000), h("span", { class: "ci" }, saved >= 0 ? ` saves ${perK(saved)} vs reviewing all` : ` ${perK(-saved)} more than reviewing all`)];
}

export function cheapestChip(rep, apply) {
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
export function updateCalCost() {
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

// ---------- Holdout ----------
// Calibrate's shortcuts and Policy's Tune choose thresholds from the rows they then report on. Holdout
// (jev/holdout.py) cross-validates that choice: each fifth of the labeled rows is routed by thresholds tuned on
// the other four folds. No model calls. It runs on request, because many gates over many rows take seconds,
// and clears whenever the question, gates, labels, signal, or target basis change.
export function clearHoldout(state) {
  state.holdout = null;
  state.holdoutSeq += 1;  // a check still running for the old inputs must not install its report
}

export function holdoutPanel(state, id, qids) {
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
    const rules = state === W.bulk.policy ? policyRules() : "";  // Calibrate's single question ignores Policy's rules
    const report = await api("/api/workbench/holdout", { rows: policyRows(questions), questions, signal: state.signal, bound: state.bound, ...(costs ? { costs } : {}), ...(rules ? { rules } : {}) });
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
export function gatesText(gates) {
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
      h("span", { class: "faint" }, "Keeps identical inputs together, tunes on four folds and routes the fifth it never saw, five times. Shows what these targets deliver on new rows. No extra calls."))];
  }
  if (!rep.targets.length) {
    return [title, h("p", { class: "muted", style: { fontSize: "13px" } },
      rep.problem || `Needs at least ${rep.minimum} labeled rows to hold some out (${rep.labeled} labeled).`)];
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
