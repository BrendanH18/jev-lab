// Checks (jev/checks.py): a Policy gate saved with a dataset, rerun live; the gate export (jev/gate.py), the
// model upgrade (jev/upgrade.py) and Policy's "Save as a check" form.
import { $, api, copyText, h, handleError, icon, mount, ms, pct, stat, toast, usd } from "./common.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { W, canon } from "./workbench-state.js";
import { render } from "./workbench.js";
import { bulkUnsaved } from "./workbench-bulk.js";
import { driftForm, pval, driftReport } from "./workbench-drift.js";
import { newQueue, queueForm, queueView, auditReport } from "./workbench-review.js";
import { withCI, attachedSetsPayload, attachedSetsText } from "./workbench-calibrate.js";
import { activeGates, policyRules } from "./workbench-policy.js";
import { loadModels } from "./workbench-compare.js";

// ---------- Checks ----------
// A check (jev/checks.py) keeps Policy's gate with a saved dataset: the gated questions and thresholds, the model, and
// the targets the gate must keep meeting. Running it sends every saved row to the model again and judges the new
// answers, so the report below a dataset always comes from a run started here. scripts/check.py runs the same checks.

function checkTargetsText(c) {
  const rules = c.rules ? c.rules.split("\n").length : 0;
  const slices = c.slice_targets?.length || 0;
  return `${pct(c.min_accuracy, 1)} accurate${c.bound === "lower" ? " at 95% confidence" : ""} · at least ${pct(c.min_coverage)} automated${rules ? ` · ${rules} rule${rules > 1 ? "s" : ""} send breaking rows to review` : ""}${slices ? ` · ${slices} required slice${slices === 1 ? "" : "s"}` : ""}`;
}

export function checkItem(x) {
  const c = x.check;
  const run = W.bulk.checkRuns[x.id] || (W.bulk.checkRuns[x.id] = { running: false, report: null, model: "",
    drift: { open: false, text: "", running: false, report: null, labelsOpen: false, busy: false, saved: null }, queue: newQueue(),
    upgrade: { open: false, model: "", running: false, report: null } });
  const model = h("input", { class: "input sm", list: "cmp-models", value: run.model, spellcheck: "false", style: { maxWidth: "190px" },
    placeholder: `model: ${c.model}`, "aria-label": `Model to ask for the ${x.id} check` });
  model.addEventListener("focus", loadModels);
  model.addEventListener("input", () => { run.model = model.value; });
  const n = Math.min(x.rows - (x.test?.rows || 0), 200);  // a check reruns the rows its gate was tuned on, not the test rows
  return h("div", { class: "check-item" },
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
      h("span", { class: "badge info" }, icon("check"), "Check"),
      h("span", { class: "mono" }, Object.entries(c.gates).map(([q, t]) => `${q} ≥ ${t.toFixed(2)}`).join(" · ")),
      h("span", { class: "muted" }, `${checkTargetsText(c)} · asks ${c.model}${c.tuned_on && c.tuned_on !== c.model ? ` · tuned on ${c.tuned_on}` : ""}`)),
    (c.slice_targets || []).map((t) => h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
      h("span", { class: "mono" }, `${t.field} = ${t.value}`), `: at least ${pct(t.min_accuracy, 1)} accurate · ${pct(t.min_coverage)} automated`)),
    Object.keys(c.answer_sets || {}).length ? h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
      "Review shortlists: ", attachedSetsText(c.answer_sets), ". Thresholds and rules still decide automation.") : null,
    (x.check_notes || []).map((note) => h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } }, icon("eye"), " ", note)),
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: run.running || run.drift.running || run.drift.busy || run.upgrade.running, onclick: () => runCheck(x.id) },
        run.running ? [h("span", { class: "spin" }), " Checking…"] : [icon("layers"), `Run check · ${n} call${n === 1 ? "" : "s"}`]),
      model, estimateLine(h, api, "check", () => ({ id: x.id, model: run.model.trim() || undefined })),
      h("button", { class: `btn sm${run.drift.open ? " active" : ""}`, "aria-expanded": String(run.drift.open),
        title: "Do new, unlabeled rows still look like the rows this gate was tuned on?",
        onclick: () => { run.drift.open = !run.drift.open; render(); } }, icon("search"), "Compare new rows"),
      h("button", { class: `btn sm${run.upgrade.open ? " active" : ""}`, "aria-expanded": String(run.upgrade.open),
        title: "Ask the version this gate was tuned on and a newer one the same rows, and see whether the check can move",
        onclick: () => { run.upgrade.open = !run.upgrade.open; render(); } }, icon("layers"), "Try a new version"),
      h("button", { class: "btn sm", onclick: () => exportGate({ dataset: x.id }, `the check saved with “${x.name || x.id}”`) }, icon("code"), "Export as code"),
      h("button", { class: `btn sm${run.queue.open ? " active" : ""}`, "aria-expanded": String(run.queue.open),
        title: "Label the rows the exported gate sent to review, and a sample it automated, then add them to this dataset",
        onclick: () => { run.queue.open = !run.queue.open; render(); } }, icon("check"), "Review queue"),
      h("button", { class: "btn sm ghost", disabled: run.running || run.drift.busy, onclick: () => removeCheck(x.id) }, "Remove check")),
    run.report ? checkReport(run.report) : null,
    run.upgrade.open ? upgradeForm(x, run) : null,
    run.upgrade.report ? upgradeReport(x, run.upgrade.report) : null,
    run.drift.open ? driftForm(x, run) : null,
    run.drift.report ? driftReport(x, run) : null,
    run.queue.open ? queueForm(x, run.queue) : null,
    run.queue.open && run.queue.report ? queueView(x, run.queue) : null,
    run.queue.audit_report ? auditReport(run.queue.audit_report) : null);
}

// ---------- Gate export ----------
// jev/gate.py writes Policy's gate, or a saved check, as a Python or JavaScript module: decide(state) asks the questions
// in one call and routes the row to "auto" or "review" by the same thresholds and signal. Exporting makes no model call.
export async function exportGate(body, title) {
  try {
    const out = await api("/api/workbench/gate/export", body);
    W.bulk.gateExport = { out, title, tab: W.bulk.gateExport?.tab || "python" };
    render();
    $("#gate-export")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { handleError(e); }
}

export function renderGateExport() {
  const g = W.bulk.gateExport;
  const tabs = [["python", "Python"], ["javascript", "JavaScript"]];
  const file = g.tab === "python" ? "gate.py" : "gate.mjs";
  const download = () => {
    const url = URL.createObjectURL(new Blob([g.out[g.tab]], { type: "text/plain" }));
    const a = h("a", { href: url, download: file });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url));
  };
  return h("div", { class: "panel", id: "gate-export" },
    h("div", { class: "panel-head" }, icon("code"), h("h2", {}, `Gate as code · ${g.title}`),
      h("div", { class: "tabs" }, tabs.map(([k, l]) => h("button", { class: `tab${g.tab === k ? " active" : ""}`, onclick: () => { g.tab = k; render(); } }, l))),
      h("div", { class: "spacer" }),
      h("button", { class: "btn sm", onclick: download }, icon("save"), `Download ${file}`),
      h("button", { class: "btn sm ghost", title: "Close", "aria-label": "Close the gate export", onclick: () => { W.bulk.gateExport = null; render(); } }, icon("x"))),
    h("div", { class: "panel-body grid", style: { gap: "8px" } },
      h("p", { class: "muted", style: { fontSize: "12.5px" } },
        h("code", {}, g.tab === "python" ? "decide(state)" : "await decide(state)"),
        " asks every question in one call and returns ", h("code", {}, "route"), " (", h("code", {}, "\"auto\""), " when every gated answer clears its threshold, else ",
        h("code", {}, "\"review\""), "), the ", h("code", {}, "held"), " questions, and the ", h("code", {}, "answers"),
        ". It reads each signal as Policy does, and a missing answer goes to review. Attached answer sets add candidates for review; thresholds and rules still decide automation. Run it as a script to route one row per line of standard input."),
      h("p", { class: "muted", style: { fontSize: "12.5px" } },
        "Picture rows keep their ", h("code", {}, "_image"), " names. Copy the named sample PNGs from ", h("code", {}, "static/img/samples/"),
        " and uploads from ", h("code", {}, "data/workbench/images/"), " into the working directory before running. Library calls can set ",
        h("code", {}, g.tab === "python" ? "image_dir" : "imageDir"),
        " instead. Files stay separate from the export. Box answers return left, top, right, and bottom; only Choice, Noul, and Score decide routing."),
      h("div", { class: "code" }, h("pre", { id: "gate-code" }, g.out[g.tab]),
        h("button", { class: "btn sm copy", onclick: () => copyText(g.out[g.tab]) }, icon("copy"), "Copy")),
      h("p", { class: "faint", style: { fontSize: "12px" } },
        g.tab === "python" ? "pip install typesafe-sdk (Python 3.10+), then set TYPESAFE_API_KEY. Run: python gate.py < rows.jsonl"
          : "npm install @typesafe-ai/sdk (Node 22+), then set TYPESAFE_API_KEY. Run: node gate.mjs < rows.jsonl",
        ". The thresholds fit the labeled rows they were tuned on; confirm them on your own traffic before you rely on them. Exporting makes no model call.")));
}

export async function runCheck(id) {
  const b = W.bulk;
  const run = b.checkRuns[id];
  if (!run || run.running || run.drift.running || run.drift.busy || run.upgrade.running) return;
  if (!(await confirmSpend(api, "check", { id, model: run.model.trim() || undefined }))) return;
  run.running = true;
  run.report = null;
  render();
  try {
    run.report = await api("/api/workbench/checks/run", { id, model: run.model.trim() || undefined });
  } catch (e) { handleError(e); }
  run.running = false;
  render();
}

async function removeCheck(id) {
  if (!confirm(`Remove the check from “${id}”? The rows, labels, and questions stay.`)) return;
  try {
    await api("/api/workbench/checks/delete", { id });
    delete W.bulk.checkRuns[id];
    W.bulk.datasets = (await api("/api/workbench/datasets")).datasets;
    render();
  } catch (e) { handleError(e); }
}

export const CHECK_BADGE = { pass: ["good", "check", "Passed"], fail: ["critical", "stop", "Failed"], error: ["warning", "eye", "Not judged"] };

function sliceCheckReport(rep) {
  if (!rep.slice_targets?.length) return null;
  return h("div", { class: "scroll" }, h("table", { class: "table" },
    h("thead", {}, h("tr", {}, ["required slice", "result", "accuracy / target", "automated / minimum"].map((text) => h("th", {}, text)))),
    h("tbody", {}, rep.slice_targets.map((s) => {
      const [tone, , label] = CHECK_BADGE[s.status];
      return h("tr", {},
        h("td", {}, h("span", { class: "mono" }, `${s.field} = ${s.value}`),
          h("div", { class: "faint" }, `${s.rows} rows · ${s.labeled || 0} labeled`)),
        h("td", {}, h("span", { class: `badge ${tone}` }, label),
          (s.reasons || []).map((reason) => h("div", { class: "faint" }, reason))),
        h("td", {}, s.targets?.accuracy ? `${s.targets.accuracy.value === null ? "—" : pct(s.targets.accuracy.value, 1)} / ${pct(s.targets.accuracy.target, 1)}${s.targets.accuracy.bound === "lower" ? " (95% lower bound)" : ""}` : "—"),
        h("td", {}, s.targets?.coverage ? `${pct(s.coverage)} / ${pct(s.targets.coverage.target)}` : "—"));
    }))));
}

function checkReport(rep) {
  const [tone, ic, label] = CHECK_BADGE[rep.status];
  const t = rep.targets;
  const mark = (ok) => h("span", { class: `badge ${ok ? "good" : "critical"}` }, ok ? "meets" : "misses");
  const lower = rep.check.bound === "lower";
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${tone}` }, icon(ic), label),
      h("span", { class: "faint", style: { fontSize: "12px" } },
        `${rep.rows} rows · asked ${rep.model}${rep.answered_by?.length ? `, answered by ${rep.answered_by.join(", ")}` : ""}`)),
    t.accuracy ? h("div", { class: "stat-row" },
      stat("accuracy when automated", [rep.accuracy === null ? "—" : withCI(pct(rep.accuracy, 1), rep.accuracy_low, rep.accuracy_high), " ", mark(t.accuracy.ok)]),
      stat(lower ? "target, 95% lower bound" : "target", pct(t.accuracy.target, 1)),
      stat("automated", [`${rep.automated} of ${rep.labeled} · ${pct(rep.coverage)}`, " ", mark(t.coverage.ok)]),
      stat("minimum", pct(t.coverage.target)),
      stat("cost", usd(rep.cost_usd)),
      rep.latency_ms_median === null ? null : stat("median latency", ms(rep.latency_ms_median))) : null,
    sliceCheckReport(rep),
    rep.reasons.length ? h("ul", { class: "muted", style: { fontSize: "12.5px", margin: 0, paddingLeft: "18px" } },
      rep.reasons.map((r) => h("li", {}, r))) : null,
    (rep.notes || []).map((note) => h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } }, icon("eye"), " ", note)),
    rep.mistakes.length ? h("div", { class: "grid", style: { gap: "4px" } },
      h("span", { class: "faint", style: { fontSize: "12px" } }, `Automated but wrong · ${rep.mistakes_total}`),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("tbody", {}, rep.mistakes.slice(0, 5).map((m) => h("tr", {},
          h("td", { class: "num" }, String(m.index + 1)),
          h("td", { class: "row", style: { maxWidth: "260px" } }, m.row),
          h("td", {}, Object.entries(m.wrong).map(([q, a]) => h("div", { style: { fontSize: "12px" } },
            h("span", { class: "mono" }, q), `: ${a.answer}, label ${a.label} `, h("span", { class: "faint mono" }, `(${a.signal.toFixed(2)})`))))))))),
      rep.mistakes_total > 5 ? h("span", { class: "faint", style: { fontSize: "12px" } }, `…and ${rep.mistakes_total - 5} more. Load the dataset and run it in Bulk to see every row.`) : null) : null);
}

// ---------- Upgrade ----------
// jev/upgrade.py asks the version the check was tuned on and a candidate every saved row, both live, and compares them:
// the saved gate on each side, the rows each side gets right, the answers that changed, and the gate tuned again on the
// candidate's answers at the check's own targets. Moving the check saves it through the ordinary check endpoint, pinned
// to the version that answered; only thresholds and targets are saved, never answers.
const UPGRADE_BADGE = { keep: ["good", "check", "Can move as it is"], retune: ["info", "layers", "Can move with new thresholds"],
  stay: ["critical", "stop", "Stay on the tuned version"], error: ["warning", "eye", "Not judged"] };

function upgradeForm(x, run) {
  const u = run.upgrade;
  const c = x.check;
  const current = c.tuned_on || c.model;
  const model = h("input", { class: "input sm", list: "cmp-models", value: u.model, spellcheck: "false", style: { maxWidth: "190px" },
    placeholder: "jev-latest or jev-1.15.0", "aria-label": `Model to try for the ${x.id} check` });
  model.addEventListener("focus", loadModels);
  model.addEventListener("input", () => { u.model = model.value; });
  const n = 2 * Math.min(x.rows - (x.test?.rows || 0), 200);
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("p", { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
      "Every saved row is sent to ", h("code", {}, current), ", the version this gate was tuned on, and to the version you name, one call per row each. ",
      "The report judges the saved gate on both, compares them row by row, and tunes the gate again on the new version's answers at this check's targets. Nothing is saved until you move the check."),
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      model,
      h("button", { class: "btn sm", disabled: run.running || run.drift.running || run.drift.busy || u.running, onclick: () => runUpgrade(x.id) },
        u.running ? [h("span", { class: "spin" }), " Comparing…"] : [icon("layers"), `Compare · ${n} calls`]),
      estimateLine(h, api, "upgrade", () => (u.model.trim() ? { id: x.id, model: u.model.trim() } : null))));
}

async function runUpgrade(id) {
  const run = W.bulk.checkRuns[id];
  if (!run || run.running || run.drift.running || run.drift.busy || run.upgrade.running) return;
  const u = run.upgrade;
  if (!u.model.trim()) return toast("Name the version to try, such as jev-latest or jev-1.15.0", "error");
  if (!(await confirmSpend(api, "upgrade", { id, model: u.model.trim() }))) return;
  u.running = true;
  u.report = null;
  render();
  try {
    u.report = await api("/api/workbench/checks/upgrade", { id, model: u.model.trim() });
  } catch (e) { handleError(e); }
  u.running = false;
  render();
}

async function moveCheck(id, check, what) {
  if (!confirm(`Move the check saved with “${id}” to ${check.model}, ${what}? It then asks ${check.model} on every run.`)) return;
  try {
    await api("/api/workbench/checks", { id, check });
    W.bulk.datasets = (await api("/api/workbench/datasets")).datasets;
    delete W.bulk.checkRuns[id];
    toast(`Moved the check to ${check.model}`);
    render();
  } catch (e) { handleError(e); }
}

function upgradeReport(x, rep) {
  const [tone, ic, label] = UPGRADE_BADGE[rep.verdict];
  const s = rep.sides, p = rep.paired, t = rep.retuned;
  const gatesText = (g) => Object.entries(g).map(([q, v]) => `${q} ≥ ${v.toFixed(2)}`).join(" · ");
  const judged = (j) => h("div", {},
    h("span", { class: `badge ${CHECK_BADGE[j.status][0]}` }, j.status === "error" ? "not judged" : j.status === "pass" ? "meets" : "misses"),
    j.targets?.accuracy ? [" ", j.accuracy === null ? "none automated" : `${pct(j.accuracy, 1)} accurate · ${pct(j.coverage)} automated`] : null,
    sliceCheckReport(j));
  const side = (k) => `${s[k].model}${s[k].answered_by.length && s[k].answered_by.join(", ") !== s[k].model ? `, answered by ${s[k].answered_by.join(", ")}` : ""}`;
  const unseen = t.unseen;
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${tone}` }, icon(ic), label),
      h("span", { class: "faint", style: { fontSize: "12px" } }, `${s.current.rows} rows · ${side("current")} → ${side("candidate")}`)),
    h("span", { class: "faint", style: { fontSize: "12px" } }, `Targets: ${checkTargetsText(rep.check)}`),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "gate"), h("th", {}, "answers from"), h("th", {}, "targets"))),
      h("tbody", {},
        h("tr", {}, h("td", { class: "mono" }, gatesText(rep.check.gates)), h("td", {}, s.current.model), h("td", {}, judged(rep.current))),
        h("tr", {}, h("td", { class: "mono" }, gatesText(rep.check.gates)), h("td", {}, s.candidate.model), h("td", {}, judged(rep.candidate))),
        h("tr", {}, h("td", { class: "mono" }, t.gates ? gatesText(t.gates) : "—"), h("td", {}, `${s.candidate.model}, tuned again`),
          h("td", {}, t.report ? judged(t.report) : (t.problem || `No thresholds reach ${pct(rep.check.min_accuracy, 1)} on these answers`)))))),
    unseen && t.gates ? h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
      `The new thresholds were tuned on these rows, so their accuracy here is optimistic. Tuned on the other folds and routing each held-out group (${unseen.folds}-fold), the same tuning automates ${pct(unseen.coverage)} at `,
      unseen.accuracy === null ? "no measurable accuracy" : withCI(pct(unseen.accuracy, 1), unseen.low, unseen.high), unseen.below ? ", below the target." : ".") : (t.holdout_problem ? h("p", { class: "faint" }, t.holdout_problem) : null),
    p.rows ? h("div", { class: "stat-row" },
      stat(`every gated answer right, ${s.current.model}`, withCI(pct(p.current.accuracy, 1), p.current.low, p.current.high)),
      stat(`every gated answer right, ${s.candidate.model}`, withCI(pct(p.candidate.accuracy, 1), p.candidate.low, p.candidate.high)),
      stat("right only on one", `${p.current_only} · ${p.candidate_only}`),
      stat("McNemar p", pval(p.p)),
      stat("cost", `${usd(rep.cost_usd)} · ${rep.calls} calls`)) : null,
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "gated question"), h("th", {}, "answer changed"))),
      h("tbody", {}, rep.changed.questions.map((q) => h("tr", {},
        h("td", { class: "mono" }, q.qid),
        h("td", {}, q.rows ? withCI(`${q.changed} of ${q.rows} · ${pct(q.share)}`, q.low, q.high) : "—")))))),
    rep.changed.rows.length ? h("div", { class: "grid", style: { gap: "4px" } },
      h("span", { class: "faint", style: { fontSize: "12px" } }, `Rows whose answers changed · ${rep.changed.rows_total}`),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("tbody", {}, rep.changed.rows.slice(0, 5).map((r) => h("tr", {},
          h("td", { class: "num" }, String(r.index + 1)),
          h("td", { class: "row", style: { maxWidth: "260px" } }, r.row),
          h("td", {}, Object.entries(r.changed).map(([q, a]) => h("div", { style: { fontSize: "12px" } },
            h("span", { class: "mono" }, q), `: ${a.current} → ${a.candidate}`,
            r.label[q] === null || r.label[q] === undefined ? null : h("span", { class: "faint" }, `, label ${r.label[q]}`)))))))))) : null,
    rep.reasons.length ? h("ul", { class: "muted", style: { fontSize: "12.5px", margin: 0, paddingLeft: "18px" } },
      rep.reasons.map((r) => h("li", {}, r))) : null,
    (rep.notes || []).map((note) => h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } }, icon("eye"), " ", note)),
    rep.proposals.saved || rep.proposals.retuned ? h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      rep.proposals.saved ? h("button", { class: `btn sm${rep.verdict === "keep" ? " primary" : ""}`,
        onclick: () => moveCheck(x.id, rep.proposals.saved, "keeping its thresholds") }, icon("check"), `Move to ${rep.proposals.saved.model}, same thresholds`) : null,
      rep.proposals.retuned ? h("button", { class: `btn sm${rep.verdict === "retune" ? " primary" : ""}`,
        onclick: () => moveCheck(x.id, rep.proposals.retuned, `with thresholds ${gatesText(rep.proposals.retuned.gates)}`) },
        icon("check"), `Move to ${rep.proposals.retuned.model}, new thresholds`) : null,
      h("span", { class: "faint", style: { fontSize: "12px" } }, "Saves the thresholds and the version, with the same targets. No answers are saved.")) : null);
}

// The versioned id that answered every row of the last Bulk run (from each response's "model" field), or null.
// TypeSafe recommends sending it instead of an alias once thresholds are tuned: an alias such as jev-latest moves to
// a new version when one ships, and thresholds tuned on one version may not hold on the next.
const VERSIONED = /^jev-\d+\.\d+(\.\d+)?$/;
function tunedOn() {
  const versions = [...new Set((W.bulk.result?.results || []).map((r) => r.meta?.model).filter(Boolean))];
  return versions.length === 1 && VERSIONED.test(versions[0]) ? versions[0] : null;
}

// The model a check saved from this run asks, and an exported gate sends: the answering version when pinned.
export function gateModel() {
  const b = W.bulk;
  const v = tunedOn();
  return v && b.pin ? v : b.runModel || "";
}

// Shown when the run asked an alias: whether to pin the check and the exported gate to the version that answered.
export function pinControl() {
  const b = W.bulk;
  const v = tunedOn();
  const versions = [...new Set((b.result?.results || []).map((r) => r.meta?.model).filter(Boolean))];
  if (!v) {
    return versions.length > 1 ? h("p", { class: "faint", style: { fontSize: "12.5px" } },
      `This run was answered by ${versions.join(" and ")}: ${b.runModel || "the model"} moved to a new version during it. Run it again before you keep these thresholds.`) : null;
  }
  if (v === b.runModel) return null;
  const box = h("input", { type: "checkbox", id: "pol-pin", checked: b.pin });
  box.addEventListener("change", () => { b.pin = box.checked; render(); });
  return h("div", { style: { fontSize: "12.5px" } },
    h("label", { for: "pol-pin", style: { display: "flex", gap: "6px", alignItems: "center" } }, box,
      h("span", {}, "Pin the check and the exported gate to ", h("code", {}, v))),
    h("p", { class: "faint", style: { margin: "4px 0 0 22px" } },
      `This run asked ${b.runModel || "the current model"}, an alias, and ${v} answered it. An alias moves to a new version when TypeSafe ships one, and thresholds tuned on one version may not hold on the next. `,
      h("a", { href: "https://docs.typesafe.ai/models#aliases", target: "_blank", rel: "noopener" }, "TypeSafe's advice"), "."));
}

// Policy's "Save as a check": why it cannot be saved yet, or the targets to save and whether this run meets them.
function checkBlocker() {
  const b = W.bulk;
  const d = b.dataset;
  if (!d.id) return "Save these rows as a dataset, with their questions, to keep this gate as a check.";
  if (bulkUnsaved() || b.runText !== b.savedText) return `Save the dataset first: a check reruns the rows saved in data/workbench/datasets/${d.id}.json, and these differ.`;
  if (!d.questions || canon(b.ranQuestions) !== canon(d.questions)) {
    return `This run asked other questions than the ones saved with “${d.name}”. Run its saved questions, or save the dataset with these.`;
  }
  return null;
}

function checkDefaults(rep, bound) {
  const met = [0.99, 0.95, 0.90].find((target) => rep.automated && (bound === "lower" ? rep.accuracy_low : rep.accuracy) + 1e-9 >= target);
  return { accuracy: String(Math.round(100 * (met || 0.9))), coverage: String(Math.max(0, Math.floor(rep.coverage * 20) * 5 - 5)) };
}

function checkVerdict(rep, bound, form) {
  const acc = Number(form.accuracy) / 100;
  const cov = Number(form.coverage) / 100;
  if (!(acc >= 0.5 && acc <= 1) || !(cov >= 0 && cov <= 1)) return [h("span", { style: { color: "var(--critical-text)" } }, "Accuracy takes 50–100%, automated 0–100%.")];
  const measured = bound === "lower" ? rep.accuracy_low : rep.accuracy;
  const accOk = rep.automated > 0 && measured + 1e-9 >= acc;
  const covOk = rep.coverage + 1e-9 >= cov;
  return [`On this run: ${measured === null ? "nothing automated" : `${pct(measured, 1)} ${bound === "lower" ? "at 95% confidence" : "accurate"}`} `,
    h("span", { class: `badge ${accOk ? "good" : "critical"}` }, accOk ? "meets" : "misses"),
    ` · ${pct(rep.coverage)} automated `, h("span", { class: `badge ${covOk ? "good" : "critical"}` }, covOk ? "meets" : "misses"),
    accOk && covOk ? "" : ". A check that fails on the run it comes from will fail when you rerun it."];
}

// Only text-valued fields are offered here: their exact strings match By slice without translating JSON
// numbers or objects between Python and JavaScript. Imported targets for other values remain intact.
function availableCheckSlices(results) {
  const rows = results.filter((r) => !(r.row && typeof r.row === "object" && r.row._test === true)).map((r) => r.row);
  const fields = [...new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : []))];
  return fields.filter((field) => field && field.length <= 100 && !["_expect", "_test"].includes(field)).flatMap((field) => {
    const values = rows.map((row) => row && typeof row === "object" && !Array.isArray(row) ? row[field] : null);
    if (values.some((v) => v != null && typeof v !== "string")) return [];
    const text = [...new Set(values.map((v) => v?.trim() || "(none)"))];
    if (text.some((v) => v.length > 500)) return [];
    return [{ field, values: text }];
  });
}

function checkSliceTargets() {
  const b = W.bulk;
  if (b.checkSlices.datasetId !== b.dataset.id || b.checkSlices.targets === null) {
    const saved = b.datasets.find((d) => d.id === b.dataset.id)?.check?.slice_targets || [];
    b.checkSlices = { datasetId: b.dataset.id, targets: saved.map((t) => ({ ...t })) };
  }
  return b.checkSlices.targets;
}

function checkSliceForm() {
  const targets = checkSliceTargets();
  const redraw = () => mount("#check-slice-form", checkSliceForm());
  const options = availableCheckSlices(W.bulk.result.results).map((option) => ({ ...option,
    values: option.values.filter((value) => !targets.some((t) => t.field === option.field && t.value === value)) })).filter((option) => option.values.length);
  const number = (target, key, label, min) => {
    const input = h("input", { class: "input sm", type: "number", min, max: 100, step: "any", value: target[key] * 100,
      style: { width: "80px" }, "aria-label": `${target.field} = ${target.value}: ${label}` });
    input.addEventListener("input", () => { target[key] = input.value === "" ? NaN : Number(input.value) / 100; });
    return h("label", {}, label, " ", input, "%");
  };
  let add = null;
  if (options.length && targets.length < 20) {
    const field = h("select", { class: "input sm", "aria-label": "Required slice field" },
      options.map((option) => h("option", { value: option.field }, option.field)));
    const value = h("select", { class: "input sm", "aria-label": "Required slice value" });
    const values = () => mount(value, options.find((option) => option.field === field.value).values.map((text) => h("option", { value: text }, text)));
    field.addEventListener("change", values);
    values();
    add = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } }, field, value,
      h("button", { class: "btn sm", onclick: () => {
        targets.push({ field: field.value, value: value.value, min_accuracy: 0.9, min_coverage: 0 });
        redraw();
      } }, "Add slice target"));
  }
  return h("div", { class: "grid", style: { gap: "8px", fontSize: "12.5px" } },
    h("h4", { style: { margin: 0 } }, "Required slices"),
    h("p", { class: "faint", style: { margin: 0 } },
      "Add targets for text-valued fields in the current tuning rows, up to 20. Each uses the same gates, rules, and accuracy basis as the overall check. A missing or unevaluable slice prevents a pass. Held-out rows are excluded. Saved targets stay until you remove them."),
    targets.map((target, i) => h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } },
      h("span", { class: "mono" }, `${target.field} = ${target.value}`),
      number(target, "min_accuracy", "accurate, at least", 50), number(target, "min_coverage", "automated, at least", 0),
      h("button", { class: "btn sm ghost", "aria-label": `Remove slice ${target.field} = ${target.value}`,
        onclick: () => { targets.splice(i, 1); redraw(); } }, "Remove"))),
    add || h("p", { class: "faint", style: { margin: 0 } }, targets.length >= 20 ? "20 slice targets selected." : "No unused text-valued slices in these tuning rows."));
}

export function checkSaveBody(rep) {
  const b = W.bulk;
  const p = b.policy;
  const title = h("h3", { class: "cal-h" }, "Save as a check");
  const blocker = checkBlocker();
  if (blocker) return [title, h("p", { class: "faint", style: { fontSize: "12.5px" } }, blocker)];
  // Until a target is typed, it follows the gates: the highest target this run meets, and its automation less a margin.
  const typed = b.checkForm;
  const form = { ...checkDefaults(rep, p.bound), ...Object.fromEntries(Object.entries(typed).filter(([, v]) => v !== null)) };
  const verdict = h("div", { id: "check-verdict", style: { fontSize: "12.5px" } }, checkVerdict(rep, p.bound, form));
  const field = (key, label, min) => {
    const input = h("input", { class: "input sm", type: "number", min, max: 100, step: 1, value: form[key], style: { width: "84px" },
      id: `check-${key}`, "aria-label": label });
    input.addEventListener("input", () => { typed[key] = form[key] = input.value; mount(verdict, ...checkVerdict(rep, p.bound, form)); });
    return h("label", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h("span", { class: "muted" }, label), input, "%");
  };
  const existing = b.datasets.find((x) => x.id === b.dataset.id)?.check;
  const model = gateModel() || "the current model";
  return [title,
    h("p", { class: "faint", style: { fontSize: "12.5px" } },
      `Keeps these thresholds with “${b.dataset.name}”, asking ${model}, and the targets they must keep meeting. Run the check from the Datasets panel or with `,
      h("code", {}, "uv run scripts/check.py"), " after you change wording or model: it reruns every saved row and fails when a target is missed. Only targets are saved, never answers."),
    h("div", { style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
      field("accuracy", p.bound === "lower" ? "accurate at 95% confidence, at least" : "accurate when automated, at least", 50),
      field("coverage", "automated, at least", 0),
      h("button", { class: "btn sm", onclick: saveCheck }, icon("check"), existing ? "Replace the saved check" : `Save check to ${b.dataset.id}`)),
    verdict,
    h("div", { id: "check-slice-form" }, checkSliceForm())];
}

async function saveCheck() {
  const b = W.bulk;
  const p = b.policy;
  const id = b.dataset.id;
  const blocker = checkBlocker();  // the rows box or labels may have changed since the panel was drawn
  if (blocker) return toast(blocker, "error");
  if (b.datasets.find((x) => x.id === id)?.check && !confirm(`Replace the check saved with “${id}”?`)) return;
  try {
    const check = { gates: activeGates(), signal: p.signal, bound: p.bound, model: gateModel(), tuned_on: tunedOn() || undefined,
      rules: policyRules() || undefined,
      answer_sets: attachedSetsPayload(),
      slice_targets: checkSliceTargets(),
      min_accuracy: Number($("#check-accuracy").value) / 100, min_coverage: Number($("#check-coverage").value) / 100 };
    await api("/api/workbench/checks", { id, check });
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    delete b.checkRuns[id];
    toast(`Saved the check to data/workbench/datasets/${id}.json`);
    render();
  } catch (e) { handleError(e); }
}
