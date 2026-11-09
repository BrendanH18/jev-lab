// Policy: consistency rules (jev/rules.py), gates over several questions, "Do the gates earn their place?"
// (jev/prune.py) and accuracy by slice (jev/slices.py).
import { $, api, copyText, debounce, h, handleError, icon, mount, pct, stat, toast } from "./common.js";
import { automatedDelta, holdsBackNothing, totalShare, withoutQuestions } from "./prune.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { tuningResults, rowText, bulkQuestionsForResult } from "./workbench-bulk.js";
import { testBody } from "./workbench-datasets.js";
import { exportGate, gateModel, pinControl, checkSaveBody } from "./workbench-checks.js";
import {
  SIGNALS, boundSelect, interval, withCI, unreached, targetName, labeledQids, invalidNote, attachedSetsPayload, refreshSets,
} from "./workbench-calibrate.js";
import { costsPayload, costVs, cheapestChip, clearHoldout, holdoutPanel, gatesText } from "./workbench-costs.js";

// ---------- Rules ----------
// What a row's answers may say together (jev/rules.py): "if wants_refund = yes then department in billing, shipping".
// A row that breaks a rule has a wrong answer, or the rule is wrong, so it is worth a look even unlabeled. The
// server checks the rules over the Bulk answers; no model calls. Policy can send rows that break one to review.
let ruleSeq = 0;
async function rerule() {
  const b = W.bulk;
  const r = b.rules;
  const seq = ++ruleSeq;
  const text = r.text.trim();
  r.checked = text;  // the text this check reads, accepted or not
  if (!text || !b.result) { r.report = null; r.error = null; r.applied = ""; return; }
  const check = (rules) => api("/api/workbench/rules", { rules, rows: policyRowsAll(), questions: b.ranQuestions || undefined });
  try {
    const report = await check(text);
    if (seq === ruleSeq) Object.assign(r, { report, error: null, applied: text });
  } catch (e) {
    if (seq !== ruleSeq) return;
    r.error = e.message || String(e);
    // A refused edit keeps the rules accepted before it, rechecked against this run; rules that no longer fit it are dropped.
    if (!r.applied || text === r.applied) { Object.assign(r, { report: null, applied: "" }); return; }
    try {
      const report = await check(r.applied);
      if (seq === ruleSeq) r.report = report;
    } catch { if (seq === ruleSeq) Object.assign(r, { report: null, applied: "" }); }
  }
}
// Every answered row with all its answers and labels, for the rules report.
function policyRowsAll() {
  const b = W.bulk;
  return tuningResults(b.result).map((r) => ({ index: r.index, answers: r.answers, labels: b.labels[r.index] || {} }));
}
async function applyRules() {
  await repolicy();
  render();
  if (W.bulk.rules.error) toast(W.bulk.rules.error, "error");
}

export function renderRules() {
  const b = W.bulk;
  const r = b.rules;
  if (!policyQids(b.result).length) return null;
  const box = h("textarea", { class: "input mono", rows: 4, spellcheck: "false", id: "rules-text", "aria-label": "Rules, one per line",
    placeholder: "if wants_refund = yes then department in billing, shipping\nif department = none then is_urgent = no\nif frustration >= 2 then is_urgent = yes" }, r.text);
  box.addEventListener("input", () => { r.text = box.value; });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applyRules(); } });
  const hold = h("input", { type: "checkbox", checked: r.hold, id: "rules-hold" });
  hold.addEventListener("change", async () => { r.hold = hold.checked; await repolicy(); render(); });
  const stale = r.text.trim() !== r.checked;
  return h("div", { class: "panel", id: "rules-panel" },
    h("div", { class: "panel-head" }, icon("check"), h("h2", {}, "Rules"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "what answers may say together, checked in code, no extra calls")),
    h("div", { class: "panel-body grid", style: { gap: "12px" } },
      h("p", { class: "muted", style: { fontSize: "13px" } }, "Each question is asked on its own, so a row can come back as a refund request for the team that handles nothing. Write what cannot be true together, one rule per line: ",
        h("code", {}, "if <question> = <answer> then <question> in <answer>, <answer>"), ". Conditions use =, !=, in, not in, and for Score levels >=, <=, >, <; join them with ", h("code", {}, "and"),
        ". A row that breaks a rule has a wrong answer, or the rule is wrong, so it is worth a look even unlabeled."),
      box,
      h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
        h("button", { class: "btn sm", onclick: applyRules }, icon("check"), stale ? "Check rules" : "Check again"),
        h("label", { for: "rules-hold", class: "pol-check" }, hold, h("span", {}, "Policy sends rows that break a rule to review")),
        stale && r.text.trim() ? h("span", { class: "faint" }, "Edited since the last check. Check rules to apply them.") : null),
      r.error ? h("p", { style: { color: "var(--critical-text)", fontSize: "12.5px" } }, r.error,
        r.applied ? " Policy keeps the rules accepted before this edit, shown below." : "") : null,
      r.report ? rulesReport(r.report) : null));
}

function rulesReport(rep) {
  const rowsBy = new Map(W.bulk.result.results.map((x) => [x.index, x]));
  const wrongText = (wrong, n) => (n ? `${wrong} of ${n} (${pct(wrong / n)})` : "—");
  const broken = rep.broken_rows;
  return h("div", { class: "grid", style: { gap: "10px" } },
    h("div", { class: "stat-row" },
      stat("rows that break a rule", `${rep.broken_any} of ${rep.rows}`, true)),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "rule"), h("th", { title: "Rows where every condition after if holds" }, "applies to"),
        h("th", {}, "broken on"), h("th", { title: "Rows missing an answer the rule needs; Policy holds them" }, "cannot check"),
        h("th", { title: "Labeled rows that break the rule with a wrong answer to one of its questions" }, "answers wrong, broken"),
        h("th", { title: "Labeled rows the rule applies to and keeps, with a wrong answer to one of its questions" }, "answers wrong, kept"),
        h("th", { title: "Fisher's exact test: could the difference be chance?" }, "p"),
        h("th", { title: "Rows whose labels break the rule: then the rule, not the answers, may be wrong" }, "labels break it"))),
      h("tbody", {}, rep.rules.map((x) => h("tr", {},
        h("td", { class: "mono", style: { maxWidth: "340px", whiteSpace: "normal", overflowWrap: "anywhere" } }, x.text),
        h("td", {}, String(x.applies)), h("td", {}, x.broken ? h("b", {}, String(x.broken)) : "0"), h("td", {}, String(x.unknown)),
        h("td", {}, wrongText(x.wrong_broken, x.labeled_broken)), h("td", {}, wrongText(x.wrong_kept, x.labeled_kept)),
        h("td", { class: "mono" }, x.p === null ? "—" : x.p < 0.001 ? "< 0.001" : x.p.toFixed(3)),
        h("td", {}, x.labels_break.length ? h("span", { style: { color: "var(--critical-text)" }, title: `rows ${x.labels_break.map((i) => i + 1).join(", ")}` }, `${x.labels_break.length}: check the rule`) : "0")))))),
    broken.length ? h("div", { class: "grid", style: { gap: "6px" } },
      h("h3", { class: "cal-h" }, `Rows that break a rule · ${broken.length}: at least one answer, or the rule, is wrong`),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "breaks"))),
        h("tbody", {}, broken.slice(0, 12).map((i) => h("tr", {},
          h("td", { class: "num" }, String(i + 1)),
          h("td", { class: "row", style: { maxWidth: "420px" } }, rowText(rowsBy.get(i)?.row)),
          h("td", {}, rep.rules.filter((x) => x.broken_rows.includes(i)).map((x) => h("div", { class: "mono", style: { fontSize: "12px", whiteSpace: "normal" } }, x.text)))))))),
      broken.length > 12 ? h("p", { class: "faint", style: { fontSize: "12px" } }, `…and ${broken.length - 12} more.`) : null) : null,
    h("p", { class: "faint", style: { fontSize: "12.5px" } }, "Answers are read as Calibrate reads them: a Choice's option, a Noul's yes or no, a Score's most likely level. With labels, compare how often the answers are wrong on rows that break a rule and on rows it keeps: a rule worth keeping catches wrong answers more often than chance. If labels break a rule, the rule is probably wrong."));
}

// ---------- Policy ----------
// Gates several questions at once: a row is automated only when every gated answer clears its threshold, and
// right only when every gated answer matches its label. The server scores it (jev/policy.py); no model calls.
const MAX_GATES = 10;
export const GATEABLE = new Set(["choice", "noul", "score"]);

export function policyQids(res) {
  return Object.entries(bulkQuestionsForResult(res)).filter(([, a]) => GATEABLE.has(a.type)).map(([q]) => q);
}
export function resetPolicy() {
  const b = W.bulk;
  const qids = policyQids(b.result);
  const labeled = labeledQids(b);
  const pick = qids.filter((q) => labeled.has(q));
  const on = new Set((pick.length ? pick : qids).slice(0, MAX_GATES));
  clearHoldout(b.policy);  // a check still running for the previous Bulk run must not install its report
  b.policy = { ...b.policy, report: null, tunes: null,
    gates: Object.fromEntries(qids.map((q) => [q, { on: on.has(q), t: b.policy.gates[q]?.t ?? 0.5 }])) };
}
export function activeGates() {
  return Object.fromEntries(Object.entries(W.bulk.policy.gates).filter(([, g]) => g.on).map(([q, g]) => [q, g.t]));
}
// The rules Policy applies: the text the last rules report accepted, while "send to review" is on; else "".
// An edit the server refuses leaves the accepted rules in force until a corrected edit replaces them.
export function policyRules() {
  const r = W.bulk.rules;
  return r.hold && r.applied && r.report?.rules.length ? r.applied : "";
}
export function policyRows(qids, results = tuningResults(W.bulk.result)) {
  const b = W.bulk;
  const rules = policyRules();
  return results.map((r) => ({
    index: r.index,
    row: r.row,  // the server groups exact inputs for folds, ignoring labels and test markers
    key: rowText(r.row),
    // With rules, every answer: a rule may read a question no gate does.
    answers: Object.fromEntries((rules ? Object.keys(r.answers) : qids).filter((q) => r.answers[q]).map((q) => [q, r.answers[q]])),
    labels: Object.fromEntries(qids.filter((q) => b.labels[r.index]?.[q] !== undefined).map((q) => [q, b.labels[r.index][q]])),
  }));
}
let polSeq = 0;
export async function rescorePolicy() {
  const p = W.bulk.policy;
  const gates = activeGates();
  const seq = ++polSeq;  // only the latest request may install its report
  if (!Object.keys(gates).length) { p.report = null; p.cost = null; return; }
  const costs = costsPayload().costs;
  try {
    const rows = policyRows(Object.keys(gates));
    const [report, cost] = await Promise.all([
      api("/api/workbench/policy", { rows, gates, signal: p.signal, rules: policyRules() || undefined }),
      costs ? api("/api/workbench/cost", { rows, questions: Object.keys(gates), gates, signal: p.signal, costs, tune: false, rules: policyRules() || undefined }) : null]);
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
    const tunes = await api("/api/workbench/policy/tune", { rows: policyRows(qids), questions: qids, signal: p.signal, bound: p.bound, rules: policyRules() || undefined });
    if (seq === tuneSeq) p.tunes = tunes;
  } catch (e) { if (seq === tuneSeq) handleError(e); }
}
// The cheapest thresholds for the checked gates. Separate from Tune: prices change without the targets changing.
let cheapSeq = 0;
export async function recheapPolicy() {
  const p = W.bulk.policy;
  const qids = Object.keys(activeGates());
  const costs = costsPayload().costs;
  const seq = ++cheapSeq;
  p.cheapest = null;
  if (!qids.length || !costs) return;
  try {
    const rep = await api("/api/workbench/cost", { rows: policyRows(qids), questions: qids, signal: p.signal, costs, rules: policyRules() || undefined });
    if (seq === cheapSeq) p.cheapest = rep;
  } catch (e) { if (seq === cheapSeq) handleError(e); }
}
// Gates, labels, or the signal changed: both the report and the tuned thresholds are stale. Tuning can take a
// moment on many rows and gates, so its chips fill in when it finishes instead of holding up the report.
export async function repolicy() {
  await rerule();  // Policy reads the rules the report accepted, so check them first
  clearHoldout(W.bulk.policy);
  clearPrune(W.bulk.policy);
  retunePolicy().then(updatePolicy);
  recheapPolicy().then(updatePolicy);
  await rescorePolicy();
}
const rescoreSoon = debounce(async () => { await rescorePolicy(); updatePolicy(); }, 120);

export function renderPolicy() {
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
      h("div", { class: "cal-controls" }, sigSel, boundSelect(p, () => { clearHoldout(p); clearPrune(p); return retunePolicy().then(updatePolicy); }))),
    h("div", { class: "panel-body grid", style: { gap: "14px" } },
      h("p", { class: "muted", style: { fontSize: "13px" } }, "An application usually acts on an item only when every answer it uses is confident. Check the questions your code acts on and set a threshold for each. A row is automated when all of them clear, and it counts as right only when all of them match their labels."),
      h("div", { class: "pol-gates" }, qids.map(gateRow)),
      nOn ? null : h("p", { class: "muted" }, "Check at least one question to gate."),
      h("div", { id: "pol-tunes", class: "chips" }),
      h("div", { id: "pol-out", class: "grid", style: { gap: "14px" } }),
      nOn ? h("div", { id: "pol-prune", class: "holdout" }, pruneView(p)) : null,
      nOn ? holdoutPanel(p, "pol-holdout", () => Object.keys(activeGates())) : null,
      h("div", { id: "pol-check", class: "holdout" }),
      h("div", { id: "pol-test", class: "holdout" })));
}

function policyCode(rep) {
  const signal = rep.signal;
  const rules = rep.rules.length ? ["# Policy also sends rows whose answers break one of these rules to review. This snippet checks only",
    "# the thresholds; Export as a module writes a gate that checks the rules too.", ...rep.rules.map((x) => `#   ${x}`), ""] : [];
  const lines = [...rules, "def held_by(result):", '    """The gated questions that are unsure about this result. An empty list means act on it."""',
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
export function updatePolicy() {
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
  if (!rep) { mount("#pol-check"); mount("#pol-test"); return mount("#pol-out"); }
  const n = rep.labeled;
  mount("#pol-check", ...(n ? checkSaveBody(rep) : []));
  mount("#pol-test", ...testBody(rep));
  if (n) sliceSoon.pol();
  const notes = [
    n && n < 100 ? h("p", { class: "faint" }, `With ${n} labeled rows, one row moves accuracy by ${(100 / n).toFixed(1)} points. Tuned thresholds fit these rows; confirm them on more labeled rows before you rely on them.`) : null,
    rep.rules.length ? h("p", { class: "faint" }, `${rep.rules.length === 1 ? "A rule" : `${rep.rules.length} rules`} from Rules above send${rep.rules.length === 1 ? "s" : ""} ${rep.routed_held_by_rules} of this run's ${rep.routed} rows to review whatever their confidence, and Tune, the cost, the check on unseen rows, a saved check, and the exported gate do the same.`) : null,
    rep.unlabeled ? h("p", { class: "faint" }, `${rep.unlabeled} answered rows lack a label for at least one gated question and are not scored.`) : null,
    rep.skipped ? h("p", { class: "faint" }, `${rep.skipped} rows have no readable answer to a gated question and are left out.`) : null,
    rep.invalid.length ? invalidNote(rep) : null,
    h("p", { class: "faint" }, `Tuning raises whichever threshold drops the most wrong rows per row it drops, until the target holds${p.bound === "lower" ? " at 95% confidence" : ""}, then re-chooses thresholds two at a time while that automates more rows. With one or two gated questions it finds the best thresholds on 0.01 steps; with more it is a search, not a guarantee.`),
  ];
  const code = h("div", { class: "grid", style: { gap: "8px" } },
    pinControl(),
    h("div", { class: "code" }, h("pre", { id: "pol-code" }, policyCode(rep)),
      h("button", { class: "btn sm copy", onclick: () => copyText($("#pol-code").textContent) }, icon("copy"), "Copy")),
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", onclick: () => exportGate({ questions: W.bulk.ranQuestions, gates: activeGates(), signal: p.signal, model: gateModel() || undefined, rules: policyRules() || undefined, answer_sets: attachedSetsPayload() }, "Policy's gate") },
        icon("code"), "Export as a module"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "A Python or JavaScript file with these questions, the model, and these thresholds built in: decide(state) routes one row.")));
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
      rep.rules.length ? stat("held by a rule", `${rep.held_by_rules} of ${n}`) : null,
      p.cost?.current ? stat("cost per 1,000 rows", costVs(p.cost.current, p.cost)) : null,
      stat("this run, all rows", `${rep.routed_automated} of ${rep.routed} automated`)),
    policyBar(rep),
    policyTable(rep),
    policyMistakes(rep),
    h("div", { id: "pol-slices", class: "grid", style: { gap: "8px" } }, sliceBody("pol")),
    code,
    h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, notes));
}

// ---------- Do the gates earn their place? ----------
// For each gated question, what Tune automates at a target with its threshold off (its answer still acted on and
// scored) and with it dropped from the gate (not acted on, not scored), and which questions of the request no gate
// or rule reads. The server searches (jev/prune.py); no model calls. It runs on request, since it tunes 2k+1 times.
const PRUNE_TARGETS = [0.9, 0.95, 0.99];
let pruneSeq = 0;
function clearPrune(p) {
  pruneSeq += 1;  // a check still running for the old inputs must not install its report
  p.prune = { ...p.prune, running: false, report: null, drop: new Set() };
}
function remountPrune() {
  const el = $("#pol-prune");
  if (el) mount(el, ...pruneView(W.bulk.policy));
}

async function runPrune() {
  const b = W.bulk;
  const p = b.policy;
  const qids = Object.keys(activeGates());
  if (!qids.length) return;
  if (!b.ranQuestions) return toast("Run the rows in Bulk first: the check reads the questions that run asked.", "error");
  const seq = ++pruneSeq;
  Object.assign(p.prune, { running: true, report: null });
  remountPrune();
  try {
    const report = await api("/api/workbench/policy/prune", { rows: policyRows(qids), questions: qids, signal: p.signal, bound: p.bound,
      target: p.prune.target, rules: policyRules() || undefined, request: b.ranQuestions });
    if (seq !== pruneSeq) return;
    Object.assign(p.prune, { report, drop: new Set(report.unused.map((u) => u.qid)) });
  } catch (e) {
    if (seq !== pruneSeq) return;
    handleError(e);
  }
  p.prune.running = false;
  remountPrune();
}

function pruneView(p) {
  const s = p.prune;
  const sel = h("select", { class: "input", style: { width: "auto" }, disabled: s.running, "aria-label": "Target the gate is tuned for" },
    PRUNE_TARGETS.map((t) => h("option", { value: t, selected: t === s.target }, targetName(t, p.bound))));
  sel.addEventListener("change", () => { clearPrune(p); p.prune.target = Number(sel.value); remountPrune(); });
  const btn = h("button", { class: "btn sm", disabled: s.running, onclick: runPrune },
    s.running ? [h("span", { class: "spin" }), " Checking…"] : s.report ? "Check again" : "Check each gate");
  return [h("h3", { class: "cal-h" }, "Do the gates earn their place?"),
    h("div", { class: "holdout-head" }, sel, btn,
      h("span", { class: "faint" }, "Tunes the gate again with each question's threshold off, then with each question dropped, and lists the questions nothing reads. No extra calls.")),
    s.report ? pruneReport(s, s.report) : null];
}

function pruneReport(s, rep) {
  const base = rep.baseline;
  const name = targetName(rep.target, rep.bound);
  const n = rep.gated.length;
  const outcome = (o, dropped = false) => {
    if (!o.gates) return h("span", { class: "faint" }, `${name}: not reached`);
    const delta = automatedDelta(o, base);
    return [h("div", {}, `${o.automated} rows`, delta ? h("span", { class: "faint" }, ` · ${delta}`) : null),
      h("div", { class: "faint" }, o.accuracy === null ? "automates none" : withCI(`${pct(o.accuracy, 1)} accurate`, o.low, o.high)),
      dropped && o.labeled !== base.labeled ? h("div", { class: "faint" }, `of ${o.labeled} labeled rows, not ${base.labeled}`) : null];
  };
  const pick = (qid) => {
    const box = h("input", { type: "checkbox", checked: s.drop.has(qid), "aria-label": `Leave ${qid} out of variant B` });
    box.addEventListener("change", () => { if (box.checked) s.drop.add(qid); else s.drop.delete(qid); });
    return box;
  };
  const idle = rep.gated.filter((g) => holdsBackNothing(g, base));
  return [
    base.gates
      ? h("p", { style: { fontSize: "13px" }, title: gatesText(base.gates) }, `${n === 1 ? "The gate" : `All ${n} gates`}, tuned for ${name}: automates `,
        h("b", {}, `${base.automated} of ${base.labeled}`), ` · ${pct(base.coverage)}, `,
        base.accuracy === null ? "none automated" : withCI(`${pct(base.accuracy, 1)} accurate`, base.low, base.high), ".")
      : h("p", { class: "muted", style: { fontSize: "13px" } }, `${n === 1 ? "The gate" : `All ${n} gates`} together do not reach ${name} on these ${base.labeled} labeled rows. One with a question off or dropped may still reach it.`),
    h("div", { class: "scroll" }, h("table", { class: "table holdout-table" },
      h("thead", {}, h("tr", {}, h("th", { title: "Check to leave it out of variant B" }, "question"),
        h("th", { title: "Its share of the request's question text" }, "share of text"),
        h("th", { title: "Its threshold at 0: its answer is still acted on and must match its label" }, "threshold off"),
        h("th", { title: "Not acted on and not scored, so rows without its label count too" }, "dropped from the gate"),
        h("th", {}))),
      h("tbody", {}, rep.gated.map((g) => h("tr", {},
        h("td", {}, h("label", { class: "pol-check" }, pick(g.qid), h("span", { class: "mono" }, g.qid)), h("div", { class: "faint" }, g.type)),
        h("td", { class: "num" }, g.share === null ? "—" : pct(g.share)),
        h("td", {}, outcome(g.off), holdsBackNothing(g, base) ? h("span", { class: "badge info" }, "holds back nothing at this target") : null),
        h("td", {}, g.dropped ? outcome(g.dropped, true) : h("span", { class: "faint" }, "the only gated question")),
        h("td", {}, g.rules.length ? h("span", { class: "faint", title: g.rules.join("\n") }, `read by ${g.rules.length === 1 ? "a rule" : `${g.rules.length} rules`}`) : null)))))),
    idle.length ? h("p", { class: "faint", style: { fontSize: "12.5px" } },
      `With ${idle.map((g) => g.qid).join(", ")} ungated, tuning automates as many rows at ${name}: ${idle.length === 1 ? "its threshold holds" : "their thresholds hold"} back nothing here, so ${idle.length === 1 ? "it is a candidate" : "they are candidates"} to stop gating.`) : null,
    rep.unused.length
      ? h("div", { class: "grid", style: { gap: "6px" } },
        h("p", { style: { fontSize: "13px" } }, `No gate or rule reads ${rep.unused.length === 1 ? "this question" : `these ${rep.unused.length} questions`}: ${pct(totalShare(rep.unused))} of the question text. If your code does not read ${rep.unused.length === 1 ? "its answer" : "their answers"} either, a request without ${rep.unused.length === 1 ? "it" : "them"} is shorter.`),
        h("div", { style: { display: "flex", gap: "6px 16px", flexWrap: "wrap", fontSize: "12.5px" } }, rep.unused.map((u) => h("label", { class: "pol-check" }, pick(u.qid),
          h("span", { class: "mono" }, u.qid), h("span", { class: "faint" }, u.share === null ? u.type : `${u.type} · ${pct(u.share)}`)))))
      : h("p", { class: "faint", style: { fontSize: "12.5px" } }, "Every question in the request is gated or read by a rule."),
    h("div", { class: "holdout-head" },
      h("button", { class: "btn sm", onclick: () => compareWithout(s.drop) }, icon("layers"), "Compare without these"),
      h("span", { class: "faint" }, "Variant A asks the request Bulk ran; B leaves out the checked questions.")),
    h("p", { class: "faint", style: { fontSize: "12.5px" } }, `These numbers come from the ${base.labeled} labeled rows the gate is tuned on; Check on unseen rows below shows how tuning holds on rows it never saw. Removing a question can shift the other answers, so a live Compare is the confirmation.`),
  ];
}

// Compare the request the Bulk run asked (A) with the same questions minus the checked ones (B), same model and rows.
function compareWithout(drop) {
  const b = W.bulk;
  const full = b.ranQuestions;
  if (!full) return toast("Run the rows in Bulk first.", "error");
  const gone = Object.keys(full).filter((q) => drop.has(q));
  if (!gone.length) return toast("Check at least one question to leave out.", "error");
  const rest = withoutQuestions(full, gone);
  if (!Object.keys(rest).length) return toast("Leave at least one question in variant B.", "error");
  const [a, v] = W.compare.variants;
  a.text = JSON.stringify(full, null, 2);
  v.text = JSON.stringify(rest, null, 2);
  a.model = v.model = b.runModel || "";
  a.perturb = v.perturb = "";  // the rows as written, so the left-out questions are the only change
  a.average = v.average = false;
  Object.assign(W.compare, { result: null, report: null, reportError: null });  // an earlier run asked other variants
  W.tab = "compare";
  location.hash = "compare";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast(`A asks the request Bulk ran; B leaves out ${gone.join(", ")}. Run both to see whether the other answers move.`);
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
export async function reslice(kind) {
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
export const sliceSoon = { cal: debounce(() => reslice("cal"), 150), pol: debounce(() => reslice("pol"), 150) };

export function sliceBody(kind) {
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
  sel.addEventListener("change", () => { b.slice.field = sel.value; reslice("cal"); reslice("pol"); refreshSets(); });
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
