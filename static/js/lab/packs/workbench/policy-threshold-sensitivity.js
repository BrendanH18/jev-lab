// Threshold sensitivity for Policy's scored rows (surface "workbench.policy"; contract in
// static/js/lab/surfaces/workbench-analysis.js): how far each row sits from the checked gates' thresholds, which rows a
// small gate move would re-route, what-ifs for moving every gate by 0.05, and commands that apply thresholds the page
// already computed (Tune and the lowest-cost gates) through Policy's own controls. Everything is arithmetic on the
// user's own Bulk run and Policy's report in this page session: no model call, no storage, no edit of an answer.
// What-ifs keep the page's rules: a row a rule holds stays held whatever the thresholds.
import { csvText, definePack } from "../../kit.js";
import { median, round } from "../../lib/math.js";

const EPS = 1e-9;    // the page's tie rule: automated when signal + EPS >= threshold
const BAND = 0.05;   // a signal this close to a threshold, either side, sits near the cut
const DEEP = 0.10;   // margin bands
const OFFSETS = [[-0.1, "0.10 lower"], [-0.05, "0.05 lower"], [0, "current"], [0.05, "0.05 higher"], [0.1, "0.10 higher"]];

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const activeOf = (ctx) => (isObject(ctx?.data?.active) ? ctx.data.active : {});
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value, digits = 2) => (num(value) === null ? "" : value.toFixed(digits));
// A threshold as Policy applies it: two decimals when that is exact, otherwise every digit it has (a typed 0.875).
const exact = (value) => (num(value) === null ? "" : Math.abs(value - round(value, 2)) < 1e-12 ? value.toFixed(2) : String(round(value, 9)));
const rowsWord = (n) => `${n} shown row${n === 1 ? "" : "s"}`;
const clears = (signal, t) => signal + EPS >= t;
// A threshold moved by offset, clamped to 0..1. Rounded only to clear float noise (0.7 + 0.05), never to the slider's
// two decimals: Policy applies a typed 0.875 as 0.875, so the "now" baseline must too.
const moveTo = (t, offset) => (offset === 0 ? t : Math.min(1, Math.max(0, round(t + offset, 9))));

// The gated questions of a row in gate order as [qid, signal, threshold], for the checked gates it answered.
function gated(item, ctx) {
  const answers = isObject(item?.answers) ? item.answers : {};
  return Object.entries(activeOf(ctx)).filter(([qid]) => isObject(answers[qid]))
    .map(([qid, t]) => [qid, num(answers[qid].signal), num(t)]).filter(([, s, t]) => s !== null && t !== null);
}

const minMargin = (item, ctx) => {
  const margins = gated(item, ctx).map(([, s, t]) => s - t);
  return margins.length ? Math.min(...margins) : null;
};

// Whether a row would be automated with the thresholds map(qid, t) -> t' (rules still hold).
function automatedAt(item, ctx, thresholdOf) {
  const gates = gated(item, ctx);
  if (!gates.length || list(item.rules).length) return false;
  return gates.every(([qid, s, t]) => clears(s, thresholdOf(qid, t)));
}

// Automated rows and their mistakes on the shown rows with every checked gate moved by offset (clamped to 0..1).
function whatIf(ctx, offset) {
  const rows = ctx.shown();
  if (!rows.length || !Object.keys(activeOf(ctx)).length) return null;
  const auto = rows.filter((item) => automatedAt(item, ctx, (_qid, t) => moveTo(t, offset)));
  return { rows, auto, wrong: auto.filter((item) => item.correct === false).length };
}

function coverageAt(ctx, offset) {
  const at = whatIf(ctx, offset);
  if (!at) return null;
  return { value: at.auto.length / at.rows.length, detail: `${at.auto.length} of ${rowsWord(at.rows.length)} with every checked gate ${offset > 0 ? "raised" : "lowered"} by ${BAND}; a rule still holds what it holds` };
}

function accuracyAt(ctx, offset) {
  const at = whatIf(ctx, offset);
  if (!at) return null;
  if (!at.auto.length) return { value: null, detail: `no shown row would be automated with every checked gate ${offset > 0 ? "raised" : "lowered"} by ${BAND}` };
  const right = at.auto.length - at.wrong;
  return { value: right / at.auto.length, detail: `${right} of ${at.auto.length} automated rows right; measured on these rows, not promised` };
}

// The checked gates whose signal sits within BAND of their threshold, either side, as [qid, signal, threshold].
const nearCuts = (item, ctx) => gated(item, ctx).filter(([, s, t]) => Math.abs(s - t) <= BAND + EPS);

function bestTune(ctx) {
  const targets = list(ctx?.data?.tunes?.targets).filter((entry) => isObject(entry) && isObject(entry.gates) && num(entry.target) !== null);
  if (!targets.length) return null;
  return targets.reduce((best, entry) => (entry.target > best.target ? entry : best));
}

// The part of a { qid: t } map that names checked gates and differs from their current thresholds.
function changes(map, ctx) {
  const active = activeOf(ctx), out = {};
  for (const [qid, t] of Object.entries(isObject(map) ? map : {})) {
    if (Object.prototype.hasOwnProperty.call(active, qid) && num(t) !== null && Math.abs(t - active[qid]) > EPS) out[qid] = t;
  }
  return out;
}
function tuneCommand(target) {
  const name = `${Math.round(target * 100)}%`;
  const gatesFor = (ctx) => list(ctx?.data?.tunes?.targets).find((entry) => isObject(entry) && Math.abs(num(entry.target) - target) < EPS)?.gates;
  return {
    id: `apply_tune_${Math.round(target * 100)}`, kind: "command", group: "Policy", title: `Apply Tune's thresholds for ${name} accuracy`,
    help: "The thresholds of that Tune chip. Tuned on these rows: check on unseen rows before relying on them.",
    when: (ctx) => Object.keys(changes(gatesFor(ctx), ctx)).length > 0,
    run: async (ctx) => {
      const map = changes(gatesFor(ctx), ctx);
      const text = describe(map, ctx);
      await ctx.actions.setThresholds(map);
      ctx.env?.toast?.(`Applied Tune's thresholds for ${name}: ${text}.`);
    },
  };
}
const describe = (map, ctx) => Object.entries(map).map(([qid, t]) => `${qid} ${fixed(activeOf(ctx)[qid])} → ${fixed(t)}`).join(", ");

export default definePack({
  id: "policy-threshold-sensitivity",
  surface: "workbench.policy",
  title: "Policy: threshold sensitivity",
  about: "How far Policy's scored rows sit from the checked gates' thresholds, which rows a 0.05 move would re-route, what-ifs for moving every gate, and commands that apply the Tune or lowest-cost thresholds through Policy's own controls. Arithmetic on your own run in this page session; nothing calls the model.",
  features: [
    // ---------- row facts ----------
    { id: "drop_to_automate", kind: "fact", type: "number", label: "threshold drop that clears every gate",
      help: "The largest amount a checked gate's threshold sits above the row's signal: lowering each holding gate this far clears the gates (0 when they clear already). A rule may still hold the row.",
      value: (item, ctx) => {
        const gates = gated(item, ctx);
        return gates.length ? Math.max(0, ...gates.map(([, s, t]) => (clears(s, t) ? 0 : t - s))) : null;
      } },
    { id: "gates_near_cut", kind: "fact", type: "number", label: `checked gates within ${BAND} of their threshold`,
      help: `Gates whose signal is ${BAND} or less above or below the threshold: a small move of that gate can re-route the row.`,
      value: (item, ctx) => (gated(item, ctx).length ? nearCuts(item, ctx).length : null) },
    { id: "fragile_automation", kind: "fact", type: "flag", label: `automated, but a ${BAND} higher gate would hold it`,
      help: `An automated row with a gated signal less than ${BAND} above its threshold.`,
      value: (item, ctx) => item.automated === true && gated(item, ctx).some(([, s, t]) => !clears(s, t + BAND)) },
    { id: "automate_if_lowered", kind: "fact", type: "flag", label: `held, but ${BAND} lower gates would automate it`,
      help: `Held by gates only (no rule), and every holding gate's signal is within ${BAND} below its threshold.`,
      value: (item, ctx) => {
        if (item.automated !== false || list(item.rules).length) return false;
        const holding = gated(item, ctx).filter(([, s, t]) => !clears(s, t));
        return holding.length > 0 && holding.every(([, s, t]) => clears(s + BAND, t));
      } },
    { id: "margin_band", kind: "fact", type: "category", label: "weakest gate's distance from its threshold",
      help: `The smallest signal − threshold over the checked gates, in bands of ${DEEP.toFixed(2)}: how firmly the gates hold or clear the row.`,
      value: (item, ctx) => {
        const m = minMargin(item, ctx);
        if (m === null) return null;
        if (m + EPS < 0) return -m > DEEP + EPS ? "more than 0.10 below" : "0.10 or less below";
        return m > DEEP + EPS ? "more than 0.10 above" : "0.10 or less above";
      } },
    { id: "hold_source", kind: "fact", type: "category", label: "what kind of hold",
      help: "automated, held by gates only, by a rule only, or by gates and a rule.",
      value: (item) => {
        if (typeof item.automated !== "boolean") return null;
        if (item.automated) return "automated";
        const gates = list(item.held).length > 0, rules = list(item.rules).length > 0;
        return gates && rules ? "gates and a rule" : gates ? "gates only" : rules ? "a rule only" : null;
      } },

    // ---------- checks ----------
    { id: "crowded_cut", kind: "diagnostic", severity: "info", scope: "list", label: "Many rows sit close to a gate's threshold",
      help: `Reports a checked gate when at least 3 shown rows, and a quarter of them, have its signal within ${BAND} of its threshold.`,
      check: (rows, ctx) => {
        if (!rows.length) return null;
        return Object.entries(activeOf(ctx)).map(([qid, t]) => {
          const near = rows.filter((item) => nearCuts(item, ctx).some(([q]) => q === qid)).length;
          return near >= 3 && near / rows.length >= 0.25
            ? `${near} of ${rowsWord(rows.length)} have ${qid}'s signal within ${BAND} of its threshold ${fixed(t)}: a small move of this gate re-routes many of them.`
            : null;
        }).filter(Boolean);
      } },
    { id: "gate_at_edge", kind: "diagnostic", severity: "advice", scope: "list", label: "A checked gate sits at 0 or 1",
      check: (rows, ctx) => {
        if (!rows.length) return null;
        return Object.entries(activeOf(ctx)).map(([qid, t]) => {
          if (num(t) === null) return null;
          if (t <= EPS) return `${qid}'s threshold is 0.00: every row clears it, so it holds nothing; uncheck it or raise it.`;
          if (t >= 1 - EPS) return `${qid}'s threshold is 1.00: only a signal of exactly 1 clears it, so it holds nearly every row.`;
          return null;
        }).filter(Boolean);
      } },
    { id: "bottleneck_gate", kind: "diagnostic", severity: "info", scope: "list", label: "One gate alone holds most reviews",
      help: "Reports a checked gate that, with no other gate and no rule, holds at least 2 shown rows and at least half of the shown rows held for review.",
      check: (rows, ctx) => {
        const held = rows.filter((item) => item.automated === false);
        if (!held.length) return null;
        return Object.keys(activeOf(ctx)).map((qid) => {
          const alone = held.filter((item) => list(item.held).length === 1 && item.held[0] === qid && !list(item.rules).length).length;
          return alone >= 2 && alone * 2 >= held.length
            ? `${qid} alone holds ${alone} of the ${held.length} shown rows held for review: its threshold decides most of the review load.`
            : null;
        }).filter(Boolean);
      } },

    // ---------- what-ifs on the shown rows ----------
    { id: "rows_near_cut", kind: "metric", format: "integer", label: `shown rows within ${BAND} of a gate's threshold`,
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const near = rows.filter((item) => nearCuts(item, ctx).length > 0).length;
        return { value: near, detail: `${near} of ${rowsWord(rows.length)}` };
      } },
    { id: "coverage_raised", kind: "metric", format: "percent", label: `share of shown rows automated with every gate ${BAND} higher`,
      compute: (ctx) => coverageAt(ctx, BAND) },
    { id: "accuracy_raised", kind: "metric", format: "percent", label: `accuracy of the shown automated rows with every gate ${BAND} higher`,
      compute: (ctx) => accuracyAt(ctx, BAND) },
    { id: "coverage_lowered", kind: "metric", format: "percent", label: `share of shown rows automated with every gate ${BAND} lower`,
      compute: (ctx) => coverageAt(ctx, -BAND) },
    { id: "accuracy_lowered", kind: "metric", format: "percent", label: `accuracy of the shown automated rows with every gate ${BAND} lower`,
      compute: (ctx) => accuracyAt(ctx, -BAND) },
    { id: "mistakes_added_lowered", kind: "metric", format: "integer", label: `automated mistakes ${BAND} lower gates would add`,
      help: "Shown rows with a wrong gated answer that lowering every checked gate would newly automate.",
      compute: (ctx) => {
        const now = whatIf(ctx, 0), lower = whatIf(ctx, -BAND);
        if (!now || !lower) return null;
        return { value: lower.wrong - now.wrong, detail: `${now.wrong} automated mistakes now, ${lower.wrong} with every gate ${BAND} lower` };
      } },
    { id: "median_automated_margin", kind: "metric", format: "number", label: "median weakest margin of the shown automated rows",
      help: "For each automated shown row, the smallest signal − threshold over the checked gates; the median. Small: many automated rows sit just above a cut.",
      compute: (ctx) => {
        const margins = ctx.shown().filter((item) => item.automated === true).map((item) => minMargin(item, ctx)).filter((m) => m !== null);
        return margins.length ? { value: median(margins), detail: `over ${margins.length} automated row${margins.length === 1 ? "" : "s"}` } : null;
      } },

    // ---------- exports ----------
    { id: "sensitivity_csv", kind: "exporter", label: "Each gate moved alone, as CSV", mime: "text/csv", filename: "policy-gate-sensitivity.csv",
      help: "Aggregates only: for each checked gate moved alone from 0.10 lower to 0.10 higher (the others fixed, rules still holding), the shown rows automated, their share, their accuracy and their mistakes.",
      build: (ctx) => {
        const rows = ctx.shown(), active = activeOf(ctx);
        if (!rows.length || !Object.keys(active).length) throw new Error("There are no scored rows to move gates over: check a gate and label some rows.");
        const out = [["question", "threshold", "move", "tried threshold", "automated", "share", "accuracy", "automated mistakes"]];
        for (const [qid, t] of Object.entries(active)) {
          for (const [offset, name] of OFFSETS) {
            const tried = offset === 0 ? t : round(t + offset, 9);
            if (tried < -EPS || tried > 1 + EPS) continue;
            const auto = rows.filter((item) => automatedAt(item, ctx, (q, current) => (q === qid ? tried : current)));
            const wrong = auto.filter((item) => item.correct === false).length;
            out.push([qid, exact(t), name, exact(tried), auto.length, fixed(auto.length / rows.length, 4), auto.length ? fixed((auto.length - wrong) / auto.length, 4) : "", wrong]);
          }
        }
        return csvText(out);
      } },
    { id: "near_cut_csv", kind: "exporter", label: `Shown rows within ${BAND} of a gate's threshold as CSV`, mime: "text/csv", filename: "policy-near-cut.csv",
      help: `Your run's gated signals for the shown rows within ${BAND} of a checked gate's threshold, numbered as Bulk's #, one line per gate, with the side and the distance. No input text, answers or labels.`,
      build: (ctx) => csvText([["Bulk #", "outcome", "question", "signal", "threshold", "side", "distance"],
        ...ctx.shown().flatMap((item) => nearCuts(item, ctx).map(([qid, s, t]) => [item.number, item.outcome, qid, fixed(s), fixed(t),
          clears(s, t) ? "clears" : "held", fixed(Math.abs(s - t))]))]) },
    { id: "config_markdown", kind: "exporter", label: "Policy configuration as Markdown", mime: "text/markdown", filename: "policy-configuration.md",
      help: "Configuration only: the signal, the target basis, each checked gate's threshold and the rules in force. No answers, labels or measured results.",
      build: (ctx) => {
        const types = new Map(list(ctx.data.questions).map((q) => [q.qid, q.type]));
        const gates = Object.entries(activeOf(ctx));
        if (!gates.length) throw new Error("Check a gate first.");
        const rules = ctx.data.rules?.in_force || "";
        return [
          "# Policy configuration", "",
          `- Signal: ${ctx.data.signal}`,
          `- Target basis: ${ctx.data.bound === "lower" ? "95% lower bound" : "estimate"}`,
          `- Rules send rows that break them to review: ${ctx.data.rules?.hold ? "yes" : "no"}`, "",
          "| Question | Type | Threshold |", "| --- | --- | ---: |",
          ...gates.map(([qid, t]) => `| ${qid} | ${types.get(qid) || ""} | ${fixed(t)} |`), "",
          ...(rules.trim() ? ["Rules in force:", "", "```text", rules.trim(), "```"] : ["Rules in force: none"]), "",
        ].join("\n");
      } },

    // ---------- commands ----------
    { id: "apply_cheapest", kind: "command", title: "Apply the lowest-cost thresholds to Policy's gates", group: "Policy",
      help: "Sets the checked gates to the thresholds Policy's cost line found cheapest at your prices. Tuned on these rows: check on unseen rows before relying on them.",
      when: (ctx) => Object.keys(changes(ctx.data.cheapest?.best?.gates, ctx)).length > 0,
      run: async (ctx) => {
        const map = changes(ctx.data.cheapest?.best?.gates, ctx);
        const text = describe(map, ctx);
        await ctx.actions.setThresholds(map);
        ctx.env?.toast?.(`Applied the lowest-cost thresholds: ${text}.`);
      } },
    { id: "apply_tune_best", kind: "command", title: "Apply Tune's thresholds for the highest target they reach", group: "Policy",
      help: "Of the Tune chips with thresholds, the one with the highest accuracy target. Tuned on these rows: check on unseen rows before relying on them.",
      when: (ctx) => Object.keys(changes(bestTune(ctx)?.gates, ctx)).length > 0,
      run: async (ctx) => {
        const tune = bestTune(ctx);
        const map = changes(tune.gates, ctx);
        const text = describe(map, ctx);
        await ctx.actions.setThresholds(map);
        ctx.env?.toast?.(`Applied Tune's thresholds for ${percent(tune.target)}: ${text}.`);
      } },
    tuneCommand(0.9),
    tuneCommand(0.95),
    tuneCommand(0.99),
    { id: "toggle_signal", kind: "command", title: "Switch Policy's signal between confidence and top probability", group: "Policy",
      when: (ctx) => !!ctx.data.run && Object.keys(activeOf(ctx)).length > 0,
      run: (ctx) => ctx.actions.setSignal(ctx.data.signal === "confidence" ? "top_probability" : "confidence") },
    { id: "toggle_bound", kind: "command", title: "Switch Policy's target basis between the estimate and the 95% lower bound", group: "Policy",
      when: (ctx) => !!ctx.data.run && Object.keys(activeOf(ctx)).length > 0,
      run: (ctx) => ctx.actions.setBound(ctx.data.bound === "estimate" ? "lower" : "estimate") },
  ],
});
