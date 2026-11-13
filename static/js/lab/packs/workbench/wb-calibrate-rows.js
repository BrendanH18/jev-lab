// Starter pack for Calibrate's scored rows (surface "workbench.calibrate"; contract in
// static/js/lab/surfaces/workbench-analysis.js). Everything reads the user's own Bulk run through ctx and runs locally:
// no model call, no storage, nothing kept after the page session.
import { csvText, definePack } from "../../kit.js";
import { slugify } from "../../lib/text.js";

const SURE = 0.8;        // a stated probability this high on a wrong row is a confident mistake
const CLOSE = 0.05;      // a signal this near the threshold is a close call
const UNLIKELY = 0.05;   // the answer gave the label less than this: the label may be wrong
const EPS = 1e-9;        // the page's tie rule: signal + 1e-9 >= threshold clears

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const thresholdOf = (ctx) => num(ctx?.data?.threshold) ?? 0.5;
const automated = (item, ctx) => num(item.signal) !== null && item.signal + EPS >= thresholdOf(ctx);
const fixed = (value, digits = 2) => (num(value) === null ? "" : value.toFixed(digits));
const fileQid = (ctx) => slugify(ctx.data.qid || "") || "question";

// The answer's options as [key, p], most likely first, for Choice, Score and Noul; null for a Box or an odd answer.
function options(item) {
  const answer = item?.answer;
  if (!answer || typeof answer !== "object") return null;
  if (answer.type === "noul") {
    const p = num(answer.noul);
    return p === null ? null : [["yes", p], ["no", 1 - p]].sort((a, b) => b[1] - a[1]);
  }
  if (answer.type !== "choice" && answer.type !== "score") return null;
  const probs = answer.probabilities && typeof answer.probabilities === "object" ? Object.entries(answer.probabilities) : [];
  const list = probs.filter(([, p]) => num(p) !== null);
  return list.length ? list.sort((a, b) => b[1] - a[1]) : null;
}

function margin(item) {
  const list = options(item);
  if (!list) return null;
  return list.length < 2 ? list[0][1] : list[0][1] - list[1][1];
}

function labelProbability(item) {
  const list = options(item);
  if (!list) return null;
  const found = list.find(([key]) => key === String(item.label));
  return found ? found[1] : null;
}

// The lowest threshold on the 0.01 grid at which no shown wrong row is automated; 0 when no shown row is wrong; null
// when even 1.00 would automate one, or nothing is shown.
function safeThreshold(rows) {
  if (!rows.length) return null;
  const wrong = rows.filter((item) => item.correct === false).map((item) => num(item.signal)).filter((value) => value !== null);
  if (!wrong.length) return 0;
  const k = Math.floor((Math.max(...wrong) + EPS) * 100) + 1;
  return k > 100 ? null : k / 100;
}

function wilson(correct, n) {
  const z = 1.959964, p = correct / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [correct === 0 ? 0 : Math.max(0, centre - half), correct === n ? 1 : Math.min(1, centre + half)];
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;

export default definePack({
  id: "wb-calibrate-rows",
  surface: "workbench.calibrate",
  title: "Calibrate rows",
  about: "Filters, sorts, checks, metrics and exports for the labeled rows Calibrate scores, plus threshold commands. Row exports hold your own run's answers and labels, numbered as Bulk's #, never input text or held-out rows.",
  features: [
    { id: "signal", kind: "fact", type: "number", label: "gating signal", help: "The value the threshold is compared with (0 to 1).", value: (item) => num(item.signal) },
    { id: "margin", kind: "fact", type: "number", label: "margin between the top two options",
      help: "The most likely option's probability minus the runner-up's; for a Noul |2p − 1|. Not available for a Box.", value: margin },
    { id: "threshold_distance", kind: "fact", type: "number", label: "distance above the threshold",
      help: "Signal minus the slider's threshold: negative rows go to review.", value: (item, ctx) => (num(item.signal) === null ? null : item.signal - thresholdOf(ctx)) },
    { id: "label_probability", kind: "fact", type: "number", label: "probability given to the label",
      help: "What the answer gave the human label (a Noul label of no gets 1 − P(yes)). Not available for a Box.", value: labelProbability },
    { id: "automated", kind: "fact", type: "flag", label: "automated at the threshold", value: (item, ctx) => automated(item, ctx) },
    { id: "wrong_automated", kind: "fact", type: "flag", label: "wrong but automated", value: (item, ctx) => item.correct === false && automated(item, ctx) },
    { id: "confident_mistake", kind: "fact", type: "flag", label: "a confident mistake", help: `Wrong while stating ${SURE} or more for its answer.`,
      value: (item) => item.correct === false && num(item.top) !== null && item.top >= SURE },
    { id: "close_call", kind: "fact", type: "flag", label: "a close call at the threshold", help: `The signal is within ${CLOSE} of the threshold.`,
      value: (item, ctx) => num(item.signal) !== null && Math.abs(item.signal - thresholdOf(ctx)) <= CLOSE + EPS },
    { id: "short_list", kind: "fact", type: "flag", label: "a short list of two or more answers", help: "From the Answer sets fit for this question.",
      value: (item) => !!item.set && item.set.size >= 2 },
    { id: "label_outside_set", kind: "fact", type: "flag", label: "a label the reviewer's list misses",
      help: "The list a reviewer would see does not hold the label.", value: (item) => !!item.set && item.set.covered === false },
    { id: "result", kind: "fact", type: "category", label: "result", value: (item) => (item.correct === true ? "right" : item.correct === false ? "wrong" : null) },
    { id: "route", kind: "fact", type: "category", label: "route at the threshold", value: (item, ctx) => (num(item.signal) === null ? null : automated(item, ctx) ? "auto" : "review") },
    { id: "confusion", kind: "fact", type: "category", label: "label and answer", help: "Label → answer, such as shipping → billing.",
      value: (item) => (item.label && item.predicted ? `${item.label} → ${item.predicted}` : null) },
    { id: "row_text", kind: "fact", type: "text", label: "row text", value: (item) => item.text },

    { id: "possible_label_error", kind: "diagnostic", severity: "advice", label: "Label the answer found unlikely",
      check: (item) => {
        const p = labelProbability(item);
        return p !== null && p < UNLIKELY ? `the answer gave the label “${item.label}” ${percent(p)}; check the label before tuning on it` : null;
      } },
    { id: "few_mistakes", kind: "diagnostic", severity: "info", scope: "list", label: "Few wrong rows to tune on",
      check: (rows) => {
        if (!rows.length) return null;
        const wrong = rows.filter((item) => item.correct === false).length;
        return wrong < 3 ? `Only ${wrong} wrong row${wrong === 1 ? "" : "s"} among the shown rows: a threshold that avoids them rests on very few mistakes.` : null;
      } },

    { id: "auroc", kind: "metric", format: "number", label: "how well the signal ranks right rows above wrong ones (AUROC)",
      help: "The chance a shown right row has a higher signal than a shown wrong row (ties count half). 0.5 is no better than chance; measured on these rows only.",
      compute: (ctx) => {
        const rows = ctx.shown().filter((item) => num(item.signal) !== null);
        const right = rows.filter((item) => item.correct === true).map((item) => item.signal);
        const wrong = rows.filter((item) => item.correct === false).map((item) => item.signal);
        if (!right.length || !wrong.length) return null;
        let wins = 0;
        for (const a of right) for (const b of wrong) wins += a > b ? 1 : a === b ? 0.5 : 0;
        return { value: wins / (right.length * wrong.length), detail: `${right.length} right × ${wrong.length} wrong` };
      } },
    { id: "brier", kind: "metric", format: "number", label: "Brier score of the stated probability",
      help: "Mean of (stated probability − 1 if right, else 0)² over the shown rows; lower is better. Not the page's ECE.",
      compute: (ctx) => {
        const rows = ctx.shown().filter((item) => num(item.top) !== null && typeof item.correct === "boolean");
        if (!rows.length) return null;
        return { value: rows.reduce((total, item) => total + (item.top - (item.correct ? 1 : 0)) ** 2, 0) / rows.length, detail: `${rows.length} rows` };
      } },
    { id: "shown_accuracy", kind: "metric", format: "percent", label: "accuracy of the shown rows",
      help: "Right shown rows over shown rows, whatever the threshold, with a 95% Wilson interval.",
      compute: (ctx) => {
        const rows = ctx.shown().filter((item) => typeof item.correct === "boolean");
        if (!rows.length) return null;
        const right = rows.filter((item) => item.correct).length;
        const [low, high] = wilson(right, rows.length);
        return { value: right / rows.length, detail: `${right} of ${rows.length}; 95% interval ${percent(low)}–${percent(high)}` };
      } },
    { id: "safe_threshold", kind: "metric", format: "number", label: "lowest threshold that automates no shown mistake",
      help: "On the 0.01 grid. Tuned on these rows, so optimistic until checked on unseen rows.",
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const t = safeThreshold(rows);
        return t === null ? { value: null, detail: "a wrong row clears every threshold" }
          : { value: t, detail: `automates ${rows.filter((item) => num(item.signal) !== null && item.signal + EPS >= t).length} of ${rows.length} shown rows` };
      } },

    { id: "rows_csv", kind: "exporter", label: "Shown rows as CSV", mime: "text/csv",
      help: "Your run's answers and labels for the shown rows, numbered as Bulk's #, with the route at the slider's threshold. No input text.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-rows.csv`,
      build: (ctx) => csvText([["#", "label", "answer", "right", "signal", "stated probability", "route"],
        ...ctx.shown().map((item) => [item.number, item.label, item.predicted, item.correct ? "yes" : "no", fixed(item.signal), fixed(item.top),
          automated(item, ctx) ? "auto" : "review"])]) },
    { id: "sweep_csv", kind: "exporter", label: "Threshold sweep at every 0.01 step as CSV", mime: "text/csv",
      help: "Aggregates only: rows automated, their share and accuracy with the 95% interval, on every scored row (not just the shown ones).",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-sweep.csv`,
      build: (ctx) => {
        const sweep = ctx.data.report?.sweep;
        if (!Array.isArray(sweep) || !sweep.length) throw new Error("There is no Calibrate sweep yet: label some rows first.");
        return csvText([["threshold", "automated", "share", "accuracy", "low", "high"],
          ...sweep.map((p) => [fixed(p.threshold), p.automated, fixed(p.coverage, 4), fixed(p.accuracy, 4), fixed(p.low, 4), fixed(p.high, 4)])]);
      } },
    { id: "confusion_csv", kind: "exporter", label: "Confusion matrix as CSV", mime: "text/csv",
      help: "Counts of labeled rows: label down, answer across, on every scored row.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-confusion.csv`,
      build: (ctx) => {
        const rep = ctx.data.report;
        if (!rep || !Array.isArray(rep.classes) || !rep.classes.length) throw new Error("This question has no confusion matrix (a Box, or no labels yet).");
        return csvText([["label \\ answer", ...rep.classes], ...rep.classes.map((key, i) => [key, ...rep.confusion[i]])]);
      } },

    { id: "set_safe_threshold", kind: "command", title: "Set the threshold above every shown mistake", group: "Calibrate",
      when: (ctx) => ctx.shown().some((item) => item.correct === false),
      run: (ctx) => {
        const t = safeThreshold(ctx.shown());
        if (t === null) return ctx.env?.toast?.("A wrong row clears every threshold, so no threshold avoids it.", "error");
        const set = ctx.actions.setThreshold(t);
        ctx.env?.toast?.(`Threshold set to ${set.toFixed(2)}: no shown wrong row clears it. Check on unseen rows before relying on it.`);
        return set;
      } },
    { id: "nudge_up", kind: "command", title: "Raise the threshold by 0.01", group: "Calibrate", keys: "Alt+Shift+ArrowUp",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => ctx.actions.setThreshold(Math.min(1, Math.round(thresholdOf(ctx) * 100 + 1) / 100)) },
    { id: "nudge_down", kind: "command", title: "Lower the threshold by 0.01", group: "Calibrate", keys: "Alt+Shift+ArrowDown",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => ctx.actions.setThreshold(Math.max(0, Math.round(thresholdOf(ctx) * 100 - 1) / 100)) },
    { id: "check_unseen", kind: "command", title: "Check Calibrate's targets on unseen rows", group: "Calibrate",
      when: (ctx) => ctx.items().length > 0 && ctx.data.type !== "box" && !ctx.data.holdout?.running,
      run: (ctx) => ctx.actions.checkUnseen() },
  ],
});
