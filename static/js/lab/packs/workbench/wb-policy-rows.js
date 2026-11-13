// Starter pack for Policy's scored rows (surface "workbench.policy"; contract in
// static/js/lab/surfaces/workbench-analysis.js). Everything reads the user's own Bulk run and Policy's report through
// ctx and runs locally: no model call, no storage, nothing kept after the page session.
import { csvText, definePack } from "../../kit.js";

const NEAR = 0.05;   // a held gate whose signal is this close below its threshold is a near miss
const SURE = 0.8;    // every gated signal this high on a wrong row is a confident mistake
const EPS = 1e-9;    // the page's tie rule

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const activeOf = (ctx) => (ctx?.data?.active && typeof ctx.data.active === "object" ? ctx.data.active : {});
const signalOf = (item, qid) => num(item?.answers?.[qid]?.signal);
const fixed = (value, digits = 2) => (num(value) === null ? "" : value.toFixed(digits));
const OUTCOMES = { right: "automated, right", wrong: "automated, wrong", review: "sent to review" };

// The gated signals of a row as [qid, signal, threshold] for the checked gates it answered.
function gated(item, ctx) {
  return Object.entries(activeOf(ctx)).map(([qid, t]) => [qid, signalOf(item, qid), num(t)]).filter(([, s, t]) => s !== null && t !== null);
}

// A held gate whose signal is within NEAR below its threshold.
const nearMiss = (signal, t) => signal + EPS < t && signal + NEAR + EPS >= t;

function wilson(correct, n) {
  const z = 1.959964, p = correct / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [correct === 0 ? 0 : Math.max(0, centre - half), correct === n ? 1 : Math.min(1, centre + half)];
}
const percent = (value) => `${(value * 100).toFixed(1)}%`;

export default definePack({
  id: "wb-policy-rows",
  surface: "workbench.policy",
  title: "Policy rows",
  about: "Filters, sorts, checks, metrics and exports for the rows Policy scores at the current gates, plus Policy's checks as commands. The row export holds your own run's answers and labels, numbered as Bulk's #, never input text; gate exports hold configuration and counts only.",
  features: [
    { id: "min_margin", kind: "fact", type: "number", label: "smallest margin above a gate's threshold",
      help: "For each checked gate, signal minus threshold; the smallest. Negative: a gate holds the row.",
      value: (item, ctx) => {
        const margins = gated(item, ctx).map(([, s, t]) => s - t);
        return margins.length ? Math.min(...margins) : null;
      } },
    { id: "held_count", kind: "fact", type: "number", label: "gates holding the row", value: (item) => (Array.isArray(item.held) ? item.held.length : null) },
    { id: "wrong_count", kind: "fact", type: "number", label: "wrong gated answers", value: (item) => (Array.isArray(item.wrong) ? item.wrong.length : null) },
    { id: "mean_signal", kind: "fact", type: "number", label: "average gated signal",
      value: (item, ctx) => {
        const signals = gated(item, ctx).map(([, s]) => s);
        return signals.length ? signals.reduce((total, s) => total + s, 0) / signals.length : null;
      } },
    { id: "held_alone", kind: "fact", type: "flag", label: "held by one gate alone", help: "Lowering that one gate's threshold would automate it.",
      value: (item) => list(item.held).length === 1 && list(item.rules).length === 0 },
    { id: "near_miss", kind: "fact", type: "flag", label: "a gate just below its threshold", help: `A held gate's signal is within ${NEAR} of its threshold.`,
      value: (item, ctx) => gated(item, ctx).some(([, s, t]) => nearMiss(s, t)) },
    { id: "picture", kind: "fact", type: "flag", label: "a picture", value: (item) => typeof item.image === "string" && item.image !== "" },
    { id: "outcome", kind: "fact", type: "category", label: "outcome", value: (item) => OUTCOMES[item.outcome] || null },
    { id: "held_by", kind: "fact", type: "category", label: "what holds the row", help: "The gates below their thresholds, and a rule.",
      value: (item) => {
        if (!Array.isArray(item.held)) return null;
        const parts = [...item.held, ...(list(item.rules).length ? ["a rule"] : [])];
        return parts.length ? parts.join(" + ") : "nothing";
      } },
    { id: "wrong_questions", kind: "fact", type: "category", label: "wrongly answered questions",
      value: (item) => (Array.isArray(item.wrong) ? (item.wrong.length ? item.wrong.join(" + ") : "none") : null) },
    { id: "row_text", kind: "fact", type: "text", label: "row text", value: (item) => item.text },

    { id: "idle_gate", kind: "diagnostic", severity: "advice", scope: "list", label: "A checked gate holds no shown row",
      check: (rows, ctx) => {
        if (!rows.length) return null;
        return Object.keys(activeOf(ctx)).filter((qid) => !rows.some((item) => list(item.held).includes(qid)))
          .map((qid) => `${qid} holds none of the ${rows.length} shown rows at its threshold; "Do the gates earn their place?" says whether it is needed.`);
      } },
    { id: "confident_mistake", kind: "diagnostic", severity: "problem", label: "Automated with a confident wrong answer",
      check: (item) => {
        const signals = Object.values(item?.answers || {}).map((entry) => num(entry?.signal));
        return item.outcome === "wrong" && signals.length && signals.every((s) => s !== null && s >= SURE)
          ? `every gated signal is ${SURE} or more, yet ${list(item.wrong).join(", ") || "an answer"} is wrong: no threshold below ${SURE} would hold it` : null;
      } },

    { id: "rule_share", kind: "metric", format: "percent", label: "Share of shown rows a rule holds",
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const held = rows.filter((item) => list(item.rules).length > 0).length;
        return { value: held / rows.length, detail: `${held} of ${rows.length}` };
      } },
    { id: "near_misses", kind: "metric", format: "integer", label: "Reviews a 0.05 lower threshold on each holding gate would automate",
      help: "Rows held only by gates (no rule) whose every held signal is within 0.05 of its threshold. A what-if on these rows, not a recommendation.",
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const active = activeOf(ctx);
        return rows.filter((item) => item.outcome === "review" && !list(item.rules).length && list(item.held).length
          && list(item.held).every((qid) => signalOf(item, qid) !== null && num(active[qid]) !== null && nearMiss(signalOf(item, qid), active[qid]))).length;
      } },
    { id: "automated_accuracy", kind: "metric", format: "percent", label: "Accuracy of the shown automated rows",
      help: "Automated shown rows whose gated answers are all right, with a 95% Wilson interval.",
      compute: (ctx) => {
        const auto = ctx.shown().filter((item) => item.outcome === "right" || item.outcome === "wrong");
        if (!auto.length) return null;
        const right = auto.filter((item) => item.outcome === "right").length;
        const [low, high] = wilson(right, auto.length);
        return { value: right / auto.length, detail: `${right} of ${auto.length}; 95% interval ${percent(low)}–${percent(high)}` };
      } },

    { id: "rows_csv", kind: "exporter", label: "Shown rows' routes, answers and labels as CSV", mime: "text/csv", filename: "policy-rows.csv",
      help: "Your run's gated answers, labels and signals for the shown rows, numbered as Bulk's #, with the outcome, the gates and rule lines that hold each one and its wrong questions. No input text.",
      build: (ctx) => {
        const qids = Object.keys(activeOf(ctx));
        return csvText([["Bulk #", "outcome", "held by", "rules", "wrong", ...qids.flatMap((q) => [`${q} answer`, `${q} label`, `${q} signal`])],
          ...ctx.shown().map((item) => [item.number, item.outcome, list(item.held).join(" "), list(item.rules).join(" "), list(item.wrong).join(" "),
            ...qids.flatMap((q) => {
              const entry = item.answers?.[q];
              return entry ? [entry.answer, entry.label, fixed(entry.signal)] : ["", "", ""];
            })])]);
      } },
    { id: "gates_csv", kind: "exporter", label: "Per-question gate table as CSV", mime: "text/csv", filename: "policy-gates.csv",
      help: "Aggregates only: each checked gate's threshold, how often its answer is right on every scored row (95% interval) and what it holds.",
      build: (ctx) => {
        const questions = ctx.data.report?.questions;
        if (!Array.isArray(questions) || !questions.length) throw new Error("There is no Policy report yet: check a gate and label some rows.");
        return csvText([["question", "type", "threshold", "right on every scored row", "accuracy", "low", "high", "holds for review", "holds alone", "wrong while automated"],
          ...questions.map((q) => [q.qid, q.type, fixed(q.threshold), q.correct, fixed(q.accuracy, 4), fixed(q.accuracy_low, 4), fixed(q.accuracy_high, 4),
            q.holds, q.only, q.wrong_automated])]);
      } },
    { id: "gates_json", kind: "exporter", label: "Checked gates as JSON", mime: "application/json", filename: "policy-gates.json",
      help: "Configuration only: the signal and each checked gate's threshold.",
      build: (ctx) => `${JSON.stringify({ signal: ctx.data.signal, gates: activeOf(ctx) }, null, 2)}\n` },

    { id: "check_unseen", kind: "command", title: "Check Policy's targets on unseen rows", group: "Policy",
      when: (ctx) => Object.keys(activeOf(ctx)).length > 0 && !ctx.data.holdout?.running,
      run: (ctx) => ctx.actions.checkUnseen() },
    { id: "check_gates", kind: "command", title: "Check whether each gate earns its place", group: "Policy",
      when: (ctx) => Object.keys(activeOf(ctx)).length > 0 && !ctx.data.prune?.running && ctx.data.request_ready,
      run: (ctx) => ctx.actions.checkGates() },
    { id: "export_gate", kind: "command", title: "Export Policy's gate as a module", group: "Policy",
      when: (ctx) => Object.keys(activeOf(ctx)).length > 0,
      run: (ctx) => ctx.actions.exportGate() },
  ],
});
