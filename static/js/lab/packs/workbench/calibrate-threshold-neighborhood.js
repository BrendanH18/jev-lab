// The rows around Calibrate's threshold (surface "workbench.calibrate"; contract in
// static/js/lab/surfaces/workbench-analysis.js): each row's distance from the slider, what a threshold at each row's
// own signal would automate, accuracy just above and just below the cut, mistakes let through, and the best coverage
// the shown rows (a slice, once a Lab filter is on) allow at each accuracy target. Everything is arithmetic on the
// user's own Bulk run in this page session: no model call, no storage. Numbers are measured on these rows, not
// promised: tuned figures are optimistic until checked on unseen rows, and intervals treat rows as independent.
import { compareText, csvText, definePack } from "../../kit.js";
import { slugify } from "../../lib/text.js";

const EPS = 1e-9; // the page's tie rule: automated when signal + EPS >= threshold
const NEAR = 0.05; // a row this close to the threshold, either side, sits near it
const BAND = 0.1; // the band just above and just below the threshold
const Z = 1.959964;
const TARGETS = [0.8, 0.85, 0.9, 0.95, 0.99];

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value, digits = 2) => (num(value) === null ? "" : value.toFixed(digits));
const thresholdOf = (ctx) => num(ctx?.data?.threshold) ?? 0.5;
const clears = (signal, t) => signal + EPS >= t;
const fileQid = (ctx) => slugify(ctx?.data?.qid || "") || "question";
const scored = (rows) => rows.filter((item) => num(item?.signal) !== null && typeof item.correct === "boolean");
const rowsWord = (n) => `${n} shown row${n === 1 ? "" : "s"}`;

function wilson(k, n) {
  const p = k / n,
    z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [k === 0 ? 0 : Math.max(0, centre - half), k === n ? 1 : Math.min(1, centre + half)];
}
const share = (k, n, what) => {
  const [low, high] = wilson(k, n);
  return { value: k / n, detail: `${k} of ${n} ${what}; 95% interval ${percent(low)}–${percent(high)}` };
};

// Rows that would automate with the threshold at this row's own signal: every scored row with signal >= it.
function atRow(item, ctx) {
  const s = num(item?.signal);
  if (s === null || typeof ctx?.items !== "function") return null;
  const rows = scored(ctx.items());
  if (!rows.length) return null;
  const auto = rows.filter((other) => clears(other.signal, s));
  return { rows, auto, wrong: auto.filter((other) => !other.correct).length };
}

// The best coverage on the shown rows at an accuracy target, over the 0.01 grid (the slider's steps): the lowest
// threshold whose automated rows are at least `target` right. null with no shown rows; { t: null } when none reaches it.
function bestAt(rows, target) {
  if (!rows.length) return null;
  for (let k = 0; k <= 100; k++) {
    const t = k / 100;
    const auto = rows.filter((item) => clears(item.signal, t));
    if (!auto.length) break;
    const right = auto.filter((item) => item.correct).length;
    if (right / auto.length + EPS >= target) return { t, automated: auto.length, right, rows: rows.length };
  }
  return { t: null, automated: 0, right: 0, rows: rows.length };
}

function coverageMetric(target) {
  return {
    id: `best_coverage_${Math.round(target * 100)}`,
    kind: "metric",
    format: "percent",
    label: `largest share of the shown rows automated at ${percent(target)} accuracy`,
    help: "Over the slider's 0.01 steps, on the shown rows only (so a Lab filter makes it a slice's figure), using the measured accuracy of these rows rather than a lower bound. Tuned on these rows: optimistic until checked on unseen rows.",
    compute: (ctx) => {
      const found = bestAt(scored(ctx.shown()), target);
      if (!found) return null;
      if (found.t === null)
        return { value: 0, detail: `no threshold automates any shown row at ${percent(target)} accuracy` };
      return {
        value: found.automated / found.rows,
        detail: `threshold ${found.t.toFixed(2)} automates ${found.automated} of ${rowsWord(found.rows)}, ${found.right} right`,
      };
    },
  };
}

function shownTargetCommand(target) {
  const name = `${Math.round(target * 100)}%`;
  const found = (ctx) => {
    const best = bestAt(scored(ctx.shown()), target);
    return best && best.t !== null && Math.abs(best.t - thresholdOf(ctx)) > EPS ? best : null;
  };
  return {
    id: `apply_shown_${Math.round(target * 100)}`,
    kind: "command",
    group: "Calibrate",
    title: `Set the threshold where the shown rows reach ${name} accuracy`,
    help: "The lowest 0.01 step whose automated shown rows are at least this accurate, measured on these rows (with a Lab filter on, one slice's figure). Tuned on these rows: check on unseen rows before relying on it.",
    when: (ctx) => found(ctx) !== null,
    run: (ctx) => {
      const best = found(ctx),
        before = thresholdOf(ctx);
      const set = ctx.actions.setThreshold(best.t);
      ctx.env?.toast?.(
        `Threshold ${before.toFixed(2)} → ${set.toFixed(2)}: ${best.automated} of ${rowsWord(best.rows)} automate, ${best.right} right.`,
      );
      return set;
    },
  };
}

// The lowest 0.01 step that holds a signal (signal + EPS < t), or null above 1.
function holdingStep(signal) {
  const t = Math.round(Math.floor(signal * 100 + 1e-7) + 1) / 100;
  return t <= 1 + EPS ? t : null;
}
// The highest 0.01 step that a signal clears.
const clearingStep = (signal) => Math.floor(signal * 100 + 1e-7) / 100;

export default definePack({
  id: "calibrate-threshold-neighborhood",
  surface: "workbench.calibrate",
  title: "Calibrate: around the threshold",
  about:
    "Each scored row's distance from the slider and what a threshold at its own signal would automate, accuracy just above and below the cut, mistakes let through, the best coverage the shown rows allow at each accuracy target, and exports of the rows near the cut and of routing by label. Arithmetic on your own run in this page session; nothing calls the model.",
  features: [
    // ---------- row facts ----------
    {
      id: "distance_to_threshold",
      kind: "fact",
      type: "number",
      label: "signal minus the threshold",
      help: "Above 0 the slider automates the row; below 0 it goes to review.",
      value: (item, ctx) => (num(item.signal) === null ? null : item.signal - thresholdOf(ctx)),
    },
    {
      id: "right_held_to_hold",
      kind: "fact",
      type: "number",
      label: "right rows a threshold above this mistake would also hold",
      help: "For a wrong row: the right scored rows whose signal is below the lowest 0.01 step that holds this one, so holding this mistake costs that many reviews of right rows. Unavailable for right rows.",
      value: (item, ctx) => {
        if (item.correct !== false || num(item.signal) === null) return null;
        const t = holdingStep(item.signal);
        if (t === null) return null;
        return scored(ctx.items()).filter((other) => other.correct && !clears(other.signal, t)).length;
      },
    },
    {
      id: "coverage_at_row",
      kind: "fact",
      type: "number",
      label: "share automated with the threshold at this row's signal",
      help: "Every scored row with a signal at least this row's, over all scored rows: sort to read the rows as candidate thresholds.",
      value: (item, ctx) => {
        const at = atRow(item, ctx);
        return at && at.auto.length / at.rows.length;
      },
    },
    {
      id: "accuracy_at_row",
      kind: "fact",
      type: "number",
      label: "accuracy with the threshold at this row's signal",
      help: "The share right among every scored row with a signal at least this row's.",
      value: (item, ctx) => {
        const at = atRow(item, ctx);
        return at && at.auto.length ? (at.auto.length - at.wrong) / at.auto.length : null;
      },
    },
    {
      id: "mistakes_at_row",
      kind: "fact",
      type: "number",
      label: "mistakes automated with the threshold at this row's signal",
      value: (item, ctx) => atRow(item, ctx)?.wrong ?? null,
    },
    {
      id: "rows_sharing_signal",
      kind: "fact",
      type: "number",
      label: "scored rows with exactly this signal",
      help: "Rows that share a signal always route together: no threshold can split them.",
      value: (item, ctx) => {
        if (num(item.signal) === null) return null;
        return scored(ctx.items()).filter((other) => Math.abs(other.signal - item.signal) < EPS).length;
      },
    },

    // ---------- metrics ----------
    {
      id: "rows_near_threshold",
      kind: "metric",
      format: "integer",
      label: `shown rows within ${NEAR} of the threshold`,
      compute: (ctx) => {
        const rows = scored(ctx.shown());
        if (!rows.length) return null;
        const t = thresholdOf(ctx);
        const near = rows.filter((item) => Math.abs(item.signal - t) <= NEAR + EPS).length;
        return { value: near, detail: `${near} of ${rowsWord(rows.length)} within ${NEAR} of ${t.toFixed(2)}` };
      },
    },
    {
      id: "accuracy_just_above",
      kind: "metric",
      format: "percent",
      label: `accuracy of the shown rows the threshold automates last (within ${BAND.toFixed(2)} above)`,
      help: "The automated rows closest to the cut: how right the rows you would give up first are.",
      compute: (ctx) => {
        const rows = scored(ctx.shown());
        if (!rows.length) return null;
        const t = thresholdOf(ctx);
        const band = rows.filter((item) => clears(item.signal, t) && item.signal <= t + BAND + EPS);
        if (!band.length)
          return { value: null, detail: `no shown row's signal is from ${t.toFixed(2)} to ${(t + BAND).toFixed(2)}` };
        return share(band.filter((item) => item.correct).length, band.length, "rows just above the threshold right");
      },
    },
    {
      id: "accuracy_just_below",
      kind: "metric",
      format: "percent",
      label: `accuracy of the shown rows the threshold holds first (within ${BAND.toFixed(2)} below)`,
      help: "The reviewed rows closest to the cut: how right the rows you would automate next are.",
      compute: (ctx) => {
        const rows = scored(ctx.shown());
        if (!rows.length) return null;
        const t = thresholdOf(ctx);
        const band = rows.filter((item) => !clears(item.signal, t) && clears(item.signal + BAND, t));
        if (!band.length)
          return { value: null, detail: `no shown row's signal is within ${BAND.toFixed(2)} below ${t.toFixed(2)}` };
        return share(band.filter((item) => item.correct).length, band.length, "rows just below the threshold right");
      },
    },
    {
      id: "mistakes_let_through",
      kind: "metric",
      format: "percent",
      label: "share of shown wrong rows the threshold automates",
      compute: (ctx) => {
        const wrong = scored(ctx.shown()).filter((item) => !item.correct);
        if (!wrong.length) return null;
        return share(
          wrong.filter((item) => clears(item.signal, thresholdOf(ctx))).length,
          wrong.length,
          "wrong rows automated",
        );
      },
    },
    {
      id: "right_held_share",
      kind: "metric",
      format: "percent",
      label: "share of shown right rows the threshold sends to review",
      compute: (ctx) => {
        const right = scored(ctx.shown()).filter((item) => item.correct);
        if (!right.length) return null;
        return share(
          right.filter((item) => !clears(item.signal, thresholdOf(ctx))).length,
          right.length,
          "right rows reviewed",
        );
      },
    },
    {
      id: "expected_mistakes_automated",
      kind: "metric",
      format: "number",
      label: "mistakes the stated probabilities expect among the automated rows",
      help: "The sum of 1 − stated probability over the shown rows the threshold automates; the detail gives the mistakes measured on them.",
      compute: (ctx) => {
        const t = thresholdOf(ctx);
        const auto = scored(ctx.shown()).filter((item) => num(item.top) !== null && clears(item.signal, t));
        if (!auto.length)
          return ctx.shown().length ? { value: null, detail: "the threshold automates no shown row" } : null;
        const expected = auto.reduce((total, item) => total + (1 - item.top), 0);
        return {
          value: expected,
          detail: `${auto.filter((item) => !item.correct).length} measured among ${auto.length} automated rows`,
        };
      },
    },
    {
      id: "automated_overconfidence",
      kind: "metric",
      format: "percent",
      label: "stated probability minus share right, among the automated rows",
      help: "Positive: the rows the threshold automates are right less often than their answers state.",
      compute: (ctx) => {
        const t = thresholdOf(ctx);
        const auto = scored(ctx.shown()).filter((item) => num(item.top) !== null && clears(item.signal, t));
        if (!auto.length)
          return ctx.shown().length ? { value: null, detail: "the threshold automates no shown row" } : null;
        const stated = auto.reduce((total, item) => total + item.top, 0) / auto.length;
        const right = auto.filter((item) => item.correct).length / auto.length;
        return {
          value: stated - right,
          detail: `stated ${percent(stated)}, right ${percent(right)} on ${auto.length} automated rows`,
        };
      },
    },
    {
      id: "tied_rows_share",
      kind: "metric",
      format: "percent",
      label: "share of shown rows that share their signal with another scored row",
      help: "Rows with the same signal always route together, so no threshold separates them.",
      compute: (ctx) => {
        const rows = scored(ctx.shown());
        if (!rows.length) return null;
        const all = scored(ctx.items());
        const tied = rows.filter((item) =>
          all.some((other) => other !== item && Math.abs(other.signal - item.signal) < EPS),
        ).length;
        return { value: tied / rows.length, detail: `${tied} of ${rowsWord(rows.length)}` };
      },
    },
    coverageMetric(0.9),
    coverageMetric(0.95),
    coverageMetric(0.99),

    // ---------- exports ----------
    {
      id: "near_threshold_csv",
      kind: "exporter",
      label: `Shown rows within ${NEAR} of the threshold as CSV`,
      mime: "text/csv",
      help: `Your run's answers and labels for the shown rows whose signal is within ${NEAR} of the slider, numbered as Bulk's #, with the side and the distance. No input text.`,
      filename: (ctx) => `calibrate-${fileQid(ctx)}-near-threshold.csv`,
      build: (ctx) => {
        const t = thresholdOf(ctx);
        return csvText([
          ["Bulk #", "label", "answer", "right", "signal", "side", "distance"],
          ...scored(ctx.shown())
            .filter((item) => Math.abs(item.signal - t) <= NEAR + EPS)
            .map((item) => [
              item.number,
              item.label,
              item.predicted,
              item.correct ? "yes" : "no",
              fixed(item.signal),
              clears(item.signal, t) ? "automated" : "review",
              fixed(Math.abs(item.signal - t)),
            ]),
        ]);
      },
    },
    {
      id: "row_thresholds_csv",
      kind: "exporter",
      label: "Each shown row as a candidate threshold, as CSV",
      mime: "text/csv",
      help: "Your run's signals and results for the shown rows, numbered as Bulk's #, highest signal first, with what a threshold at each row's signal would automate among every scored row: rows, share, accuracy and mistakes. No input text, answers or labels.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-row-thresholds.csv`,
      build: (ctx) =>
        csvText([
          ["Bulk #", "signal", "right", "automated at this signal", "share", "accuracy", "mistakes"],
          ...scored(ctx.shown())
            .slice()
            .sort((a, b) => b.signal - a.signal || a.number - b.number)
            .map((item) => {
              const at = atRow(item, ctx);
              return [
                item.number,
                fixed(item.signal),
                item.correct ? "yes" : "no",
                at.auto.length,
                fixed(at.auto.length / at.rows.length, 4),
                fixed((at.auto.length - at.wrong) / at.auto.length, 4),
                at.wrong,
              ];
            }),
        ]),
    },
    {
      id: "setting_json",
      kind: "exporter",
      label: "Calibrate's setting as JSON",
      mime: "application/json",
      help: "Configuration only: the question, its type, the signal, the target basis and the slider's threshold.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-setting.json`,
      build: (ctx) => {
        if (!ctx.data.qid) throw new Error("Run the rows in Bulk first.");
        return `${JSON.stringify({ question: ctx.data.qid, type: ctx.data.type, signal: ctx.data.signal, bound: ctx.data.bound, threshold: thresholdOf(ctx) }, null, 2)}\n`;
      },
    },
    {
      id: "label_routing_csv",
      kind: "exporter",
      label: "Routing at the threshold by label, as CSV",
      mime: "text/csv",
      help: "Aggregates of the shown rows: for each label, the rows, how many the slider automates and how many of those are right or wrong, and how many go to review and how many of those are wrong.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-routing-by-label.csv`,
      build: (ctx) => {
        if (ctx.data.type === "box") throw new Error("Box labels are coordinates, so there is no class to group by.");
        const rows = scored(ctx.shown()),
          t = thresholdOf(ctx);
        if (!rows.length) throw new Error("There are no shown rows to group.");
        const labels = [...new Set(rows.map((item) => String(item.label)))].sort(compareText);
        return csvText([
          ["label", "shown rows", "automated", "automated, right", "automated, wrong", "reviewed", "reviewed, wrong"],
          ...labels.map((label) => {
            const group = rows.filter((item) => String(item.label) === label);
            const auto = group.filter((item) => clears(item.signal, t)),
              held = group.filter((item) => !clears(item.signal, t));
            return [
              label,
              group.length,
              auto.length,
              auto.filter((item) => item.correct).length,
              auto.filter((item) => !item.correct).length,
              held.length,
              held.filter((item) => !item.correct).length,
            ];
          }),
        ]);
      },
    },
    {
      id: "targets_on_shown_csv",
      kind: "exporter",
      label: "Best coverage of the shown rows at each accuracy target, as CSV",
      mime: "text/csv",
      help: "Aggregates of the shown rows: for targets from 80% to 99%, the lowest 0.01 threshold whose automated rows reach it (measured accuracy, not the lower bound), with the rows and share it automates. Tuned on these rows.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-shown-targets.csv`,
      build: (ctx) => {
        const rows = scored(ctx.shown());
        if (!rows.length) throw new Error("There are no shown rows to tune on.");
        return csvText([
          ["target", "threshold", "automated", "share", "accuracy"],
          ...TARGETS.map((target) => {
            const found = bestAt(rows, target);
            return found.t === null
              ? [fixed(target), "none", 0, fixed(0, 4), ""]
              : [
                  fixed(target),
                  fixed(found.t),
                  found.automated,
                  fixed(found.automated / found.rows, 4),
                  fixed(found.right / found.automated, 4),
                ];
          }),
        ]);
      },
    },

    // ---------- commands ----------
    {
      id: "hold_next_mistake",
      kind: "command",
      title: "Raise the threshold to hold the next automated mistake",
      group: "Calibrate",
      help: "Moves the slider to the lowest 0.01 step above the lowest-signal wrong row it automates now, among the shown rows.",
      when: (ctx) =>
        scored(ctx.shown()).some(
          (item) => !item.correct && clears(item.signal, thresholdOf(ctx)) && holdingStep(item.signal) !== null,
        ),
      run: (ctx) => {
        const t = thresholdOf(ctx);
        const next = scored(ctx.shown())
          .filter((item) => !item.correct && clears(item.signal, t) && holdingStep(item.signal) !== null)
          .sort((a, b) => a.signal - b.signal)[0];
        const set = ctx.actions.setThreshold(holdingStep(next.signal));
        ctx.env?.toast?.(`Threshold ${t.toFixed(2)} → ${set.toFixed(2)}: row #${next.number} now goes to review.`);
        return set;
      },
    },
    {
      id: "automate_next_row",
      kind: "command",
      title: "Lower the threshold to automate the next held row",
      group: "Calibrate",
      help: "Moves the slider down to the highest-signal shown row it sends to review now, so that row and any sharing its step automate.",
      when: (ctx) => scored(ctx.shown()).some((item) => !clears(item.signal, thresholdOf(ctx))),
      run: (ctx) => {
        const t = thresholdOf(ctx);
        const next = scored(ctx.shown())
          .filter((item) => !clears(item.signal, t))
          .sort((a, b) => b.signal - a.signal)[0];
        const set = ctx.actions.setThreshold(clearingStep(next.signal));
        ctx.env?.toast?.(
          `Threshold ${t.toFixed(2)} → ${set.toFixed(2)}: row #${next.number} (${next.correct ? "right" : "wrong"}) now automates.`,
        );
        return set;
      },
    },
    shownTargetCommand(0.9),
    shownTargetCommand(0.95),
    shownTargetCommand(0.99),
  ],
});
