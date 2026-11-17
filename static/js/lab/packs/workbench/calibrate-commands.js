// Commands for Calibrate (surface "workbench.calibrate"; contract in static/js/lab/surfaces/workbench-analysis.js):
// apply a threshold the page already computed (an accuracy target or the lowest-cost threshold), move the slider by
// 0.05, switch the signal or target basis, step through the labeled questions and the answer-set coverages. Each goes
// through Calibrate's own controls and rescoring, which are pure code: no model call, nothing saved.
import { definePack } from "../../kit.js";

const EPS = 1e-9;
const STEP = 0.05;
const COVERAGES = [0.8, 0.9, 0.95, 0.99];
const SETS_TYPES = ["choice", "noul", "score"];

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const thresholdOf = (ctx) => num(ctx?.data?.threshold) ?? 0.5;
const hasRows = (ctx) => typeof ctx?.items === "function" && ctx.items().length > 0;
const percent = (value) => `${Math.round(value * 1000) / 10}%`;

// The page's tuned threshold for an accuracy target, when it differs from the slider.
function targetThreshold(ctx, target) {
  const targets = Array.isArray(ctx?.data?.report?.targets) ? ctx.data.report.targets : [];
  const entry = targets.find((item) => item && Math.abs(num(item.target) - target) < EPS);
  const t = num(entry?.threshold);
  return t !== null && Math.abs(t - thresholdOf(ctx)) > EPS ? t : null;
}

function cheapest(ctx) {
  const t = num(ctx?.data?.cost?.best?.gates?.[ctx?.data?.qid]);
  return t !== null && Math.abs(t - thresholdOf(ctx)) > EPS ? t : null;
}

const labeled = (ctx) =>
  Array.isArray(ctx?.data?.questions) ? ctx.data.questions.filter((q) => q && q.labeled).map((q) => q.qid) : [];
function neighbour(ctx, step) {
  const qids = labeled(ctx);
  if (qids.length < 2) return null;
  const at = qids.indexOf(ctx.data.qid);
  return qids[((at < 0 ? (step > 0 ? -1 : 0) : at) + step + qids.length) % qids.length];
}

function targetCommand(target) {
  const name = percent(target);
  return {
    id: `apply_target_${Math.round(target * 100)}`,
    kind: "command",
    group: "Calibrate",
    title: `Set the threshold to the page's ${name} accuracy target`,
    help: "The threshold Calibrate's targets list for this accuracy under the current basis. Tuned on these rows: check on unseen rows before relying on it.",
    when: (ctx) => hasRows(ctx) && targetThreshold(ctx, target) !== null,
    run: (ctx) => {
      const before = thresholdOf(ctx);
      const set = ctx.actions.setThreshold(targetThreshold(ctx, target));
      ctx.env?.toast?.(
        `Threshold ${before.toFixed(2)} → ${set.toFixed(2)} for ${name} accuracy, as tuned on these rows.`,
      );
      return set;
    },
  };
}

function moveCommand(id, sign) {
  return {
    id,
    kind: "command",
    group: "Calibrate",
    title: `${sign > 0 ? "Raise" : "Lower"} the threshold by ${STEP}`,
    when: (ctx) => hasRows(ctx) && (sign > 0 ? thresholdOf(ctx) < 1 - EPS : thresholdOf(ctx) > EPS),
    run: (ctx) =>
      ctx.actions.setThreshold(Math.min(1, Math.max(0, Math.round((thresholdOf(ctx) + sign * STEP) * 100) / 100))),
  };
}

export default definePack({
  id: "calibrate-commands",
  surface: "workbench.calibrate",
  title: "Calibrate: commands",
  about:
    "Palette commands for Calibrate: apply the page's accuracy-target or lowest-cost threshold, move the slider by 0.05, switch the signal or target basis, and step through labeled questions and answer-set coverages. Everything goes through Calibrate's own controls; nothing calls the model.",
  features: [
    targetCommand(0.9),
    targetCommand(0.95),
    targetCommand(0.99),
    {
      id: "apply_cheapest",
      kind: "command",
      group: "Calibrate",
      title: "Set the threshold to the lowest-cost threshold",
      help: "The threshold Calibrate's cost line found cheapest at your prices. Tuned on these rows: check on unseen rows before relying on it.",
      when: (ctx) => hasRows(ctx) && cheapest(ctx) !== null,
      run: (ctx) => {
        const before = thresholdOf(ctx);
        const set = ctx.actions.setThreshold(cheapest(ctx));
        ctx.env?.toast?.(
          `Threshold ${before.toFixed(2)} → ${set.toFixed(2)}, the lowest-cost threshold at your prices.`,
        );
        return set;
      },
    },
    moveCommand("raise_step", 1),
    moveCommand("lower_step", -1),
    {
      id: "toggle_signal",
      kind: "command",
      group: "Calibrate",
      title: "Switch Calibrate's signal between confidence and top probability",
      when: (ctx) => hasRows(ctx),
      run: (ctx) => ctx.actions.setSignal(ctx.data.signal === "confidence" ? "top_probability" : "confidence"),
    },
    {
      id: "toggle_bound",
      kind: "command",
      group: "Calibrate",
      title: "Switch Calibrate's target basis between the estimate and the 95% lower bound",
      when: (ctx) => hasRows(ctx),
      run: (ctx) => ctx.actions.setBound(ctx.data.bound === "estimate" ? "lower" : "estimate"),
    },
    {
      id: "next_question",
      kind: "command",
      group: "Calibrate",
      title: "Show the next labeled question in Calibrate",
      help: "In answer order, wrapping around; questions without a label are skipped.",
      when: (ctx) => neighbour(ctx, 1) !== null,
      run: (ctx) => ctx.actions.selectQuestion(neighbour(ctx, 1)),
    },
    {
      id: "previous_question",
      kind: "command",
      group: "Calibrate",
      title: "Show the previous labeled question in Calibrate",
      when: (ctx) => neighbour(ctx, -1) !== null,
      run: (ctx) => ctx.actions.selectQuestion(neighbour(ctx, -1)),
    },
    {
      id: "next_coverage",
      kind: "command",
      group: "Calibrate",
      title: "Step the answer-set coverage to the next level",
      help: "80%, 90%, 95%, 99%, then back to 80%. Answer sets only assist review: thresholds and rules decide automation.",
      when: (ctx) => !!ctx?.data?.run && SETS_TYPES.includes(ctx.data.type),
      run: (ctx) => {
        const at = COVERAGES.findIndex((c) => Math.abs(c - ctx.data.sets_coverage) < EPS);
        return ctx.actions.setCoverage(COVERAGES[(at + 1) % COVERAGES.length]);
      },
    },
  ],
});
