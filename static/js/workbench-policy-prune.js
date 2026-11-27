import { $, api, h, handleError, icon, mount, pct, toast } from "./common.js";
import { automatedDelta, holdsBackNothing, totalShare, withoutQuestions } from "./prune.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { targetName } from "./workbench-calibrate.js";
import { withCI } from "./workbench-evaluation-ui.js";
import { gatesText } from "./workbench-costs.js";
import { activeGates, policyRows, policyRules } from "./workbench-policy.js";

// For each gated question, what Tune automates at a target with its threshold off (its answer still acted on and
// scored) and with it dropped from the gate (not acted on, not scored), and which questions of the request no gate
// or rule reads. The server searches (jev/prune.py); no model calls. It runs on request, since it tunes 2k+1 times.
const PRUNE_TARGETS = [0.9, 0.95, 0.99];
let pruneSeq = 0;
export function clearPrune(p) {
  pruneSeq += 1; // a check still running for the old inputs must not install its report
  p.prune = { ...p.prune, running: false, report: null, drop: new Set() };
}
function remountPrune() {
  const el = $("#pol-prune");
  if (el) mount(el, ...pruneView(W.bulk.policy));
}

export async function runPrune() {
  const b = W.bulk;
  const p = b.policy;
  const qids = Object.keys(activeGates());
  if (!qids.length) return;
  if (!b.ranQuestions)
    return toast("Run the rows in Bulk first: the check reads the questions that run asked.", "error");
  const seq = ++pruneSeq;
  Object.assign(p.prune, { running: true, report: null });
  remountPrune();
  try {
    const report = await api("/api/workbench/policy/prune", {
      rows: policyRows(qids),
      questions: qids,
      signal: p.signal,
      bound: p.bound,
      target: p.prune.target,
      rules: policyRules() || undefined,
      request: b.ranQuestions,
    });
    if (seq !== pruneSeq) return;
    Object.assign(p.prune, { report, drop: new Set(report.unused.map((u) => u.qid)) });
  } catch (e) {
    if (seq !== pruneSeq) return;
    handleError(e);
  }
  p.prune.running = false;
  remountPrune();
}

export function pruneView(p) {
  const s = p.prune;
  const sel = h(
    "select",
    { class: "input", style: { width: "auto" }, disabled: s.running, "aria-label": "Target the gate is tuned for" },
    PRUNE_TARGETS.map((t) => h("option", { value: t, selected: t === s.target }, targetName(t, p.bound))),
  );
  sel.addEventListener("change", () => {
    clearPrune(p);
    p.prune.target = Number(sel.value);
    remountPrune();
  });
  const btn = h(
    "button",
    { class: "btn sm", disabled: s.running, onclick: runPrune },
    s.running ? [h("span", { class: "spin" }), " Checking…"] : s.report ? "Check again" : "Check each gate",
  );
  return [
    h("h3", { class: "cal-h" }, "Do the gates earn their place?"),
    h(
      "div",
      { class: "holdout-head" },
      sel,
      btn,
      h(
        "span",
        { class: "faint" },
        "Tunes the gate again with each question's threshold off, then with each question dropped, and lists the questions nothing reads. No extra calls.",
      ),
    ),
    s.report ? pruneReport(s, s.report) : null,
  ];
}

function pruneReport(s, rep) {
  const base = rep.baseline;
  const name = targetName(rep.target, rep.bound);
  const n = rep.gated.length;
  const outcome = (o, dropped = false) => {
    if (!o.gates) return h("span", { class: "faint" }, `${name}: not reached`);
    const delta = automatedDelta(o, base);
    return [
      h("div", {}, `${o.automated} rows`, delta ? h("span", { class: "faint" }, ` · ${delta}`) : null),
      h(
        "div",
        { class: "faint" },
        o.accuracy === null ? "automates none" : withCI(`${pct(o.accuracy, 1)} accurate`, o.low, o.high),
      ),
      dropped && o.labeled !== base.labeled
        ? h("div", { class: "faint" }, `of ${o.labeled} labeled rows, not ${base.labeled}`)
        : null,
    ];
  };
  const pick = (qid) => {
    const box = h("input", {
      type: "checkbox",
      checked: s.drop.has(qid),
      "aria-label": `Leave ${qid} out of variant B`,
    });
    box.addEventListener("change", () => {
      if (box.checked) s.drop.add(qid);
      else s.drop.delete(qid);
    });
    return box;
  };
  const idle = rep.gated.filter((g) => holdsBackNothing(g, base));
  return [
    base.gates
      ? h(
          "p",
          { style: { fontSize: "13px" }, title: gatesText(base.gates) },
          `${n === 1 ? "The gate" : `All ${n} gates`}, tuned for ${name}: automates `,
          h("b", {}, `${base.automated} of ${base.labeled}`),
          ` · ${pct(base.coverage)}, `,
          base.accuracy === null ? "none automated" : withCI(`${pct(base.accuracy, 1)} accurate`, base.low, base.high),
          ".",
        )
      : h(
          "p",
          { class: "muted", style: { fontSize: "13px" } },
          `${n === 1 ? "The gate" : `All ${n} gates`} together do not reach ${name} on these ${base.labeled} labeled rows. One with a question off or dropped may still reach it.`,
        ),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        { class: "table holdout-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { title: "Check to leave it out of variant B" }, "question"),
            h("th", { title: "Its share of the request's question text" }, "share of text"),
            h(
              "th",
              { title: "Its threshold at 0: its answer is still acted on and must match its label" },
              "threshold off",
            ),
            h(
              "th",
              { title: "Not acted on and not scored, so rows without its label count too" },
              "dropped from the gate",
            ),
            h("th", {}),
          ),
        ),
        h(
          "tbody",
          {},
          rep.gated.map((g) =>
            h(
              "tr",
              {},
              h(
                "td",
                {},
                h("label", { class: "pol-check" }, pick(g.qid), h("span", { class: "mono" }, g.qid)),
                h("div", { class: "faint" }, g.type),
              ),
              h("td", { class: "num" }, g.share === null ? "—" : pct(g.share)),
              h(
                "td",
                {},
                outcome(g.off),
                holdsBackNothing(g, base)
                  ? h("span", { class: "badge info" }, "holds back nothing at this target")
                  : null,
              ),
              h(
                "td",
                {},
                g.dropped ? outcome(g.dropped, true) : h("span", { class: "faint" }, "the only gated question"),
              ),
              h(
                "td",
                {},
                g.rules.length
                  ? h(
                      "span",
                      { class: "faint", title: g.rules.join("\n") },
                      `read by ${g.rules.length === 1 ? "a rule" : `${g.rules.length} rules`}`,
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
    ),
    idle.length
      ? h(
          "p",
          { class: "faint", style: { fontSize: "12.5px" } },
          `With ${idle.map((g) => g.qid).join(", ")} ungated, tuning automates as many rows at ${name}: ${idle.length === 1 ? "its threshold holds" : "their thresholds hold"} back nothing here, so ${idle.length === 1 ? "it is a candidate" : "they are candidates"} to stop gating.`,
        )
      : null,
    rep.unused.length
      ? h(
          "div",
          { class: "grid", style: { gap: "6px" } },
          h(
            "p",
            { style: { fontSize: "13px" } },
            `No gate or rule reads ${rep.unused.length === 1 ? "this question" : `these ${rep.unused.length} questions`}: ${pct(totalShare(rep.unused))} of the question text. If your code does not read ${rep.unused.length === 1 ? "its answer" : "their answers"} either, a request without ${rep.unused.length === 1 ? "it" : "them"} is shorter.`,
          ),
          h(
            "div",
            { style: { display: "flex", gap: "6px 16px", flexWrap: "wrap", fontSize: "12.5px" } },
            rep.unused.map((u) =>
              h(
                "label",
                { class: "pol-check" },
                pick(u.qid),
                h("span", { class: "mono" }, u.qid),
                h("span", { class: "faint" }, u.share === null ? u.type : `${u.type} · ${pct(u.share)}`),
              ),
            ),
          ),
        )
      : h(
          "p",
          { class: "faint", style: { fontSize: "12.5px" } },
          "Every question in the request is gated or read by a rule.",
        ),
    h(
      "div",
      { class: "holdout-head" },
      h("button", { class: "btn sm", onclick: () => compareWithout(s.drop) }, icon("layers"), "Compare without these"),
      h("span", { class: "faint" }, "Variant A asks the request Bulk ran; B leaves out the checked questions."),
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12.5px" } },
      `These numbers come from the ${base.labeled} labeled rows the gate is tuned on; Check on unseen rows below shows how tuning holds on rows it never saw. Removing a question can shift the other answers, so a live Compare is the confirmation.`,
    ),
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
  a.perturb = v.perturb = ""; // the rows as written, so the left-out questions are the only change
  a.average = v.average = false;
  Object.assign(W.compare, { result: null, report: null, reportError: null }); // an earlier run asked other variants
  W.tab = "compare";
  location.hash = "compare";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast(
    `A asks the request Bulk ran; B leaves out ${gone.join(", ")}. Run both to see whether the other answers move.`,
  );
}
