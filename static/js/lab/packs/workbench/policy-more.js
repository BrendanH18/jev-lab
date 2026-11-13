// More for Policy's scored rows (surface "workbench.policy"; contract in static/js/lab/surfaces/workbench-analysis.js):
// per-row cost and signal facts, gate checks, gate analytics on the shown rows and gate moves through the page's own
// threshold action. Everything is arithmetic on the user's own Bulk run and Policy's report in this page session: no
// model call, no storage, and no edit of an answer. Row costs mirror jev/cost.py row_costs: a right automated row costs
// nothing, a wrong one its most expensive priced mistake (the default mistake price otherwise), a held row one review.
import { definePack } from "../../kit.js";
import { round } from "../../lib/math.js";

const EPS = 1e-9;    // the page's tie rule: automated when signal + EPS >= threshold
const STEP = 0.05;   // one step of the gate moves and of the near-gate measure

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const activeOf = (ctx) => (isObject(ctx?.data?.active) ? ctx.data.active : {});
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const money = (value) => `$${value.toFixed(2)}`;
const reviewed = (item) => item.automated === false;
const thresholdText = (t) => t.toFixed(2);

// The gated questions of a row in gate order as [qid, signal, threshold], for the checked gates it answered.
function gated(item, ctx) {
  const answers = isObject(item?.answers) ? item.answers : {};
  return Object.entries(activeOf(ctx)).filter(([qid]) => isObject(answers[qid]))
    .map(([qid, t]) => [qid, num(answers[qid].signal), num(t)]).filter(([, s, t]) => s !== null && t !== null);
}

// Prices from Policy's cost report: { review, error, mistakes: Map("q\0label\0answer" -> price) }, or null.
function pricesOf(ctx) {
  const cost = ctx?.data?.cost;
  const review = num(cost?.review), error = num(cost?.error);
  if (review === null || error === null) return null;
  const mistakes = new Map();
  for (const m of list(cost.mistakes)) {
    if (isObject(m) && num(m.cost) !== null) mistakes.set([m.question, m.label, m.answer].map(String).join("\u0000"), m.cost);
  }
  return { review, error, mistakes };
}

// What automating the row costs (jev/cost.py row_costs): 0 when every gated answer is right, else its priciest mistake.
function automateCost(item, prices) {
  if (!prices || !Array.isArray(item?.wrong)) return null;
  let worst = 0;
  for (const qid of item.wrong) {
    const entry = item.answers?.[qid];
    const priced = entry ? prices.mistakes.get([qid, entry.label, entry.answer].map(String).join("\u0000")) : undefined;
    worst = Math.max(worst, priced === undefined ? prices.error : priced);
  }
  return worst;
}

function routingCost(item, prices) {
  if (!prices || typeof item?.automated !== "boolean") return null;
  return item.automated ? automateCost(item, prices) : prices.review;
}

// A row field's value as jev/slices.py _value reads it: Python's json.dumps(sort_keys=True) text for non-strings.
function pyJson(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (Array.isArray(value)) return `[${value.map(pyJson).join(", ")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${pyJson(key)}: ${pyJson(value[key])}`).join(", ")}}`;
  return JSON.stringify(value);
}
function sliceValue(row, field) {
  if (!isObject(row) || !Object.prototype.hasOwnProperty.call(row, field) || row[field] === null || row[field] === "") return "(none)";
  const value = row[field];
  return (typeof value === "string" ? value : pyJson(value)).trim() || "(none)";
}

function wilson(correct, n) {
  const z = 1.959964, p = correct / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [correct === 0 ? 0 : Math.max(0, centre - half), correct === n ? 1 : Math.min(1, centre + half)];
}

const pairs = (item, field) => Object.entries(isObject(item?.answers) ? item.answers : {})
  .filter(([, entry]) => isObject(entry)).map(([qid, entry]) => `${qid}: ${entry[field]}`).join(" · ");

// Thresholds of the checked gates moved by fn(t), rounded to 0.01 and clamped to 0..1; only the ones that change.
function moved(ctx, fn) {
  const out = {};
  for (const [qid, t] of Object.entries(activeOf(ctx))) {
    const next = Math.min(1, Math.max(0, round(fn(t), 2)));
    if (num(t) !== null && Math.abs(next - t) > EPS) out[qid] = next;
  }
  return out;
}
const describe = (map, ctx) => Object.entries(map).map(([qid, t]) => `${qid} ${thresholdText(activeOf(ctx)[qid])} → ${thresholdText(t)}`).join(", ");

// The lowest threshold on the 0.01 grid that holds a signal (signal + EPS < t), or null above 1.
function holdingThreshold(signal) {
  const t = round(Math.floor(signal * 100 + 1e-7) / 100 + 0.01, 2);
  return t <= 1 ? t : null;
}

// Per gate for the shown rows: rows it holds and rows it holds alone (no other gate and no rule).
function holdCounts(rows, ctx) {
  return Object.keys(activeOf(ctx)).map((qid) => {
    const holding = rows.filter((item) => list(item.held).includes(qid));
    return { qid, holding, alone: holding.filter((item) => list(item.held).length === 1 && !list(item.rules).length).length };
  });
}

export default definePack({
  id: "policy-more",
  surface: "workbench.policy",
  title: "Policy rows: costs, signals and gate moves",
  about: "Per-row costs and signals, gate checks, gate analytics and gate moves for the rows Policy scores, all arithmetic on your own run's answers and labels in this page session. Gate moves go through Policy's own threshold controls; nothing calls the model or changes an answer.",
  features: [
    // ---------- row facts ----------
    { id: "weakest_signal", kind: "fact", type: "number", label: "weakest gated signal", help: "The lowest signal among the row's checked gates.",
      value: (item, ctx) => {
        const signals = gated(item, ctx).map(([, s]) => s);
        return signals.length ? Math.min(...signals) : null;
      } },
    { id: "rules_broken", kind: "fact", type: "number", label: "rules the row breaks", help: "Rule lines the row's answers break or cannot be checked against; 0 when rules are off.",
      value: (item) => (Array.isArray(item.rules) ? item.rules.length : null) },
    { id: "automate_cost", kind: "fact", type: "number", label: "cost if automated", unit: "$",
      help: "Nothing when every gated answer is right, else the most expensive priced mistake among its wrong answers (the default mistake price for an unpriced one), at the prices in Costs.",
      value: (item, ctx) => automateCost(item, pricesOf(ctx)) },
    { id: "routing_cost", kind: "fact", type: "number", label: "cost under the current gates", unit: "$",
      help: "A held row costs one review; an automated row costs what automating it costs.",
      value: (item, ctx) => routingCost(item, pricesOf(ctx)) },
    { id: "hindsight_regret", kind: "fact", type: "number", label: "cost above the cheaper route in hindsight", unit: "$",
      help: "This row's cost under the current gates minus the cheaper of reviewing it and automating it, knowing its labels.",
      value: (item, ctx) => {
        const prices = pricesOf(ctx);
        const routed = routingCost(item, prices), automated = automateCost(item, prices);
        return routed === null || automated === null ? null : routed - Math.min(prices.review, automated);
      } },
    { id: "strongest_wrong_signal", kind: "fact", type: "number", label: "highest signal on a wrong gated answer",
      help: "Unavailable when every gated answer is right.",
      value: (item) => {
        const signals = list(item.wrong).map((qid) => num(item.answers?.[qid]?.signal)).filter((s) => s !== null);
        return signals.length ? Math.max(...signals) : null;
      } },
    { id: "row_number", kind: "fact", type: "number", label: "row number", help: "The row's # in Bulk's results table.",
      value: (item) => (Number.isInteger(item.number) ? item.number : null) },
    { id: "needless_review", kind: "fact", type: "flag", label: "a review that finds no mistake", help: "Held for review although every gated answer is right.",
      value: (item) => reviewed(item) && item.correct === true },
    { id: "caught_mistake", kind: "fact", type: "flag", label: "a mistake caught by review", help: "Held for review, and a gated answer is wrong.",
      value: (item) => reviewed(item) && item.correct === false },
    { id: "weakest_gate", kind: "fact", type: "category", label: "gate closest to holding the row",
      help: "The checked gate with the smallest signal minus threshold (ties go to the earlier gate): the one that holds it, or would hold it first.",
      value: (item, ctx) => {
        let best = null;
        for (const [qid, s, t] of gated(item, ctx)) if (!best || s - t < best[1] - EPS) best = [qid, s - t];
        return best ? best[0] : null;
      } },
    { id: "slice_value", kind: "fact", type: "category", label: "value of the By slice field",
      help: "The row's value of the field chosen under By slice, read as By slice reads it ((none) when missing). Unavailable until a field is chosen.",
      value: (item, ctx) => {
        const field = ctx?.data?.slices?.field;
        return typeof field === "string" && field ? sliceValue(item.row, field) : null;
      } },
    { id: "gated_answers", kind: "fact", type: "text", label: "gated answers", help: "question: answer for each checked gate, as Calibrate shows them.",
      value: (item) => pairs(item, "answer") },
    { id: "gated_labels", kind: "fact", type: "text", label: "gated labels", help: "question: label for each checked gate.",
      value: (item) => pairs(item, "label") },

    // ---------- checks ----------
    { id: "rule_false_alarm", kind: "diagnostic", severity: "advice", label: "Only a rule holds a right row",
      check: (item) => (list(item.rules).length && !list(item.held).length && item.correct === true
        ? `only rule line${item.rules.length === 1 ? "" : "s"} ${item.rules.join(", ")} hold${item.rules.length === 1 ? "s" : ""} this row, yet every gated answer is right` : null) },
    { id: "redundant_gate", kind: "diagnostic", severity: "advice", scope: "list", label: "A gate never holds a shown row alone",
      check: (rows, ctx) => holdCounts(rows, ctx).filter((gate) => gate.holding.length && !gate.alone)
        .map((gate) => `${gate.qid} holds ${gate.holding.length} shown row${gate.holding.length === 1 ? "" : "s"}, but another gate or a rule holds each of them too; unchecking it would automate none of them by itself.`) },
    { id: "holds_no_mistake", kind: "diagnostic", severity: "advice", scope: "list", label: "A gate holds only rows its own answer gets right",
      check: (rows, ctx) => holdCounts(rows, ctx).filter((gate) => gate.holding.length && !gate.holding.some((item) => list(item.wrong).includes(gate.qid)))
        .map((gate) => `${gate.qid} holds ${gate.holding.length} shown row${gate.holding.length === 1 ? "" : "s"}, and its own answer is right on each; its holds catch no mistake of its own.`) },
    { id: "below_break_even", kind: "diagnostic", severity: "problem", scope: "list", label: "Automated rows less accurate than automating pays for",
      help: "Compares the shown automated rows' accuracy with 1 − review ÷ default mistake price from Costs.",
      check: (rows, ctx) => {
        const cost = ctx?.data?.cost;
        const breakEven = num(cost?.break_even) ?? (num(cost?.review) !== null && num(cost?.error) > 0 ? Math.max(0, 1 - cost.review / cost.error) : null);
        const auto = rows.filter((item) => item.automated === true);
        if (breakEven === null || !auto.length) return null;
        const right = auto.filter((item) => item.correct === true).length;
        return right / auto.length < breakEven - EPS
          ? `the ${auto.length} shown automated rows are right ${percent(right / auto.length)} of the time, below the ${percent(breakEven)} at which automating pays at the default mistake price` : null;
      } },

    // ---------- gate analytics on the shown rows ----------
    { id: "review_yield", kind: "metric", format: "percent", label: "share of shown reviews that find a mistake",
      help: "Held shown rows with a wrong gated answer, over every held shown row.",
      compute: (ctx) => {
        const held = ctx.shown().filter(reviewed);
        if (!held.length) return null;
        const caught = held.filter((item) => item.correct === false).length;
        return { value: caught / held.length, detail: `${caught} of ${held.length} reviews` };
      } },
    { id: "error_recall", kind: "metric", format: "percent", label: "share of shown mistakes sent to review",
      help: "Shown rows with a wrong gated answer that the gates or rules hold, over every shown row with a wrong gated answer.",
      compute: (ctx) => {
        const wrong = ctx.shown().filter((item) => item.correct === false);
        if (!wrong.length) return null;
        const caught = wrong.filter(reviewed).length;
        return { value: caught / wrong.length, detail: `${caught} of ${wrong.length} rows with a wrong answer` };
      } },
    { id: "needless_review_cost", kind: "metric", format: "usd", label: "cost of shown reviews that find no mistake",
      help: "Held shown rows whose gated answers are all right, times the review price in Costs.",
      compute: (ctx) => {
        const rows = ctx.shown(), prices = pricesOf(ctx);
        if (!rows.length || !prices) return null;
        const needless = rows.filter((item) => reviewed(item) && item.correct === true).length;
        return { value: needless * prices.review, detail: `${needless} review${needless === 1 ? "" : "s"} at ${money(prices.review)}` };
      } },
    { id: "independence_gap", kind: "metric", format: "percent", label: "joint accuracy minus the product of per-question accuracies",
      help: "On the shown rows: share with every gated answer right, minus what independent errors would give. Negative: the questions fail on different rows; positive: they fail together. Exploratory.",
      compute: (ctx) => {
        const rows = ctx.shown(), qids = Object.keys(activeOf(ctx));
        if (!rows.length || qids.length < 2) return null;
        const product = qids.reduce((p, qid) => p * rows.filter((item) => !list(item.wrong).includes(qid)).length / rows.length, 1);
        const joint = rows.filter((item) => item.correct === true).length / rows.length;
        return { value: joint - product, detail: `measured ${percent(joint)}, independent errors would give ${percent(product)}` };
      } },
    { id: "weakest_signal_auroc", kind: "metric", format: "number", label: "how well the weakest signal ranks right rows above wrong ones",
      help: "AUROC of each shown row's weakest gated signal for rows with every gated answer right against rows with a wrong one (ties count half). 0.5 is chance, 1 perfect.",
      compute: (ctx) => {
        const weakest = (item) => {
          const signals = gated(item, ctx).map(([, s]) => s);
          return signals.length ? Math.min(...signals) : null;
        };
        const right = [], wrong = [];
        for (const item of ctx.shown()) {
          const s = weakest(item);
          if (s !== null) (item.correct === true ? right : wrong).push(s);
        }
        if (!right.length || !wrong.length) return null;
        let wins = 0;
        for (const a of right) for (const b of wrong) wins += a > b ? 1 : a === b ? 0.5 : 0;
        return { value: wins / (right.length * wrong.length), detail: `${right.length} right and ${wrong.length} wrong rows` };
      } },
    { id: "shown_cost_per_1000", kind: "metric", format: "usd", label: "cost per 1,000 of the shown rows under the current gates",
      help: "At the prices in Costs, as Policy's cost line computes it, for the rows Lab shows.",
      compute: (ctx) => {
        const rows = ctx.shown(), prices = pricesOf(ctx);
        const costs = rows.map((item) => routingCost(item, prices));
        if (!rows.length || costs.includes(null)) return null;
        const total = costs.reduce((a, b) => a + b, 0);
        return { value: (total / rows.length) * 1000, detail: `${money(total)} over ${rows.length} rows` };
      } },
    { id: "hindsight_cost_per_1000", kind: "metric", format: "usd", label: "cost per 1,000 of the shown rows if each took its cheaper route",
      help: "A floor for any gates: each shown row reviewed or automated, whichever costs less knowing its labels, even a row a rule holds.",
      compute: (ctx) => {
        const rows = ctx.shown(), prices = pricesOf(ctx);
        const costs = rows.map((item) => automateCost(item, prices));
        if (!rows.length || costs.includes(null)) return null;
        const total = costs.reduce((a, cost) => a + Math.min(prices.review, cost), 0);
        return { value: (total / rows.length) * 1000, detail: `${money(total)} over ${rows.length} rows` };
      } },
    { id: "mistakes_near_gate", kind: "metric", format: "integer", label: `shown automated mistakes a ${STEP} higher threshold would hold`,
      help: `Automated shown rows with a wrong gated answer whose signal is less than ${STEP} above that gate's threshold.`,
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const active = activeOf(ctx);
        return rows.filter((item) => item.automated === true && list(item.wrong).some((qid) => {
          const s = num(item.answers?.[qid]?.signal), t = num(active[qid]);
          return s !== null && t !== null && s + EPS < t + STEP;
        })).length;
      } },
    { id: "mistakes_per_1000", kind: "metric", format: "number", label: "automated mistakes per 1,000 shown rows",
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const wrong = rows.filter((item) => item.automated === true && item.correct === false).length;
        return { value: (wrong / rows.length) * 1000, detail: `${wrong} of ${rows.length} rows` };
      } },
    { id: "shown_coverage", kind: "metric", format: "percent", label: "share of shown rows automated",
      help: "With a 95% Wilson interval that treats rows as independent.",
      compute: (ctx) => {
        const rows = ctx.shown();
        if (!rows.length) return null;
        const auto = rows.filter((item) => item.automated === true).length;
        const [low, high] = wilson(auto, rows.length);
        return { value: auto / rows.length, detail: `${auto} of ${rows.length}; 95% interval ${percent(low)}–${percent(high)}` };
      } },

    // ---------- gate moves (through Policy's own threshold action) ----------
    { id: "round_gates", kind: "command", title: "Round the checked gates to 0.05 steps", group: "Policy",
      when: (ctx) => Object.keys(moved(ctx, (t) => Math.round(t * 20) / 20)).length > 0,
      run: async (ctx) => {
        const map = moved(ctx, (t) => Math.round(t * 20) / 20);
        const text = describe(map, ctx);
        await ctx.actions.setThresholds(map);
        ctx.env?.toast?.(`Rounded ${text}.`);
      } },
    { id: "raise_gates", kind: "command", title: `Raise every checked gate by ${STEP}`, group: "Policy",
      when: (ctx) => Object.keys(moved(ctx, (t) => t + STEP)).length > 0,
      run: async (ctx) => {
        const map = moved(ctx, (t) => t + STEP);
        const text = describe(map, ctx);
        await ctx.actions.setThresholds(map);
        ctx.env?.toast?.(`Raised ${text}.`);
      } },
    { id: "lower_gates", kind: "command", title: `Lower every checked gate by ${STEP}`, group: "Policy",
      when: (ctx) => Object.keys(moved(ctx, (t) => t - STEP)).length > 0,
      run: async (ctx) => {
        const map = moved(ctx, (t) => t - STEP);
        const text = describe(map, ctx);
        await ctx.actions.setThresholds(map);
        ctx.env?.toast?.(`Lowered ${text}.`);
      } },
    { id: "hold_mistakes", kind: "command", title: "Raise gates just enough to hold the shown automated mistakes", group: "Policy",
      help: "For each shown automated row with a wrong gated answer, in shown order: unless a gate this command already raised holds it, raises the one wrong question's gate that needs the smallest raise to the lowest 0.01 step above its signal. It may hold right rows too; Policy's stats show the effect.",
      when: (ctx) => ctx.shown().some((item) => item.automated === true && item.correct === false),
      run: async (ctx) => {
        const active = activeOf(ctx);
        const map = {};
        const current = (qid) => map[qid] ?? active[qid];
        let unreachable = 0;
        for (const item of ctx.shown()) {
          if (item.automated !== true || item.correct !== false) continue;
          if (gated(item, ctx).some(([qid, s]) => s + EPS < current(qid))) continue;   // an earlier raise holds it already
          let pick = null;
          for (const qid of list(item.wrong)) {
            const s = num(item.answers?.[qid]?.signal);
            if (s === null || num(active[qid]) === null) continue;
            const t = holdingThreshold(s);
            if (t !== null && (!pick || t - current(qid) < pick[2] - EPS)) pick = [qid, t, t - current(qid)];
          }
          if (pick) map[pick[0]] = pick[1];
          else unreachable++;
        }
        if (!Object.keys(map).length) {
          ctx.env?.toast?.("No gate can hold these mistakes: their wrong answers' signals are at the top of the scale.", "error");
          return;
        }
        const text = describe(map, ctx);
        await ctx.actions.setThresholds(map);
        ctx.env?.toast?.(`Raised ${text}.${unreachable ? ` ${unreachable} row${unreachable === 1 ? "'s" : "s'"} wrong answers have signals no threshold can hold.` : ""}`);
      } },
  ],
});
