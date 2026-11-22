// Inspect the effect of consistency rules on Policy’s scored rows from the current Bulk run.
import { csvText, definePack } from "../../kit.js";

const EPS = 1e-9;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const money = (value) => `$${value.toFixed(2)}`;
const rowsWord = (n) => `${n} shown row${n === 1 ? "" : "s"}`;
const lineWord = (lines) => `line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}`;
const ruleOnly = (item) => item.automated === false && !list(item.held).length && list(item.rules).length > 0;

// The rule lines in force as [{ line, text }], numbered as jev/rules.py numbers them (blank and # lines count).
function ruleLines(ctx) {
  const text = ctx?.data?.rules?.in_force || "";
  return text
    .split(/\r\n|\r|\n/)
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter((entry) => entry.text && !entry.text.startsWith("#"));
}

// Prices from Policy's cost report.
function pricesOf(ctx) {
  const cost = ctx?.data?.cost;
  const review = num(cost?.review),
    error = num(cost?.error);
  if (review === null || error === null) return null;
  const mistakes = new Map();
  for (const m of list(cost.mistakes))
    if (isObject(m) && num(m.cost) !== null)
      mistakes.set([m.question, m.label, m.answer].map(String).join("\u0000"), m.cost);
  return { review, error, mistakes };
}
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

export default definePack({
  id: "policy-rules-routing",
  surface: "workbench.policy",
  title: "Policy: effect of consistency rules",
  about: "See which rule lines hold rows, what they catch and cost, and export a per-rule summary from this run.",
  features: [
    {
      id: "rule_catches_mistake",
      kind: "diagnostic",
      severity: "info",
      label: "A rule catches a mistake the gates let through",
      check: (item) =>
        ruleOnly(item) && item.correct === false
          ? `every gate clears this row, yet ${list(item.wrong).join(", ") || "a gated answer"} is wrong; rule ${lineWord(item.rules)} sends it to review`
          : null,
    },
    {
      id: "rule_never_fires",
      kind: "diagnostic",
      severity: "info",
      scope: "list",
      label: "A rule line holds no shown row",
      check: (rows, ctx) => {
        if (!rows.length || !ctx?.data?.rules?.hold) return null;
        return ruleLines(ctx)
          .filter((rule) => !rows.some((item) => list(item.rules).includes(rule.line)))
          .map((rule) => `Rule line ${rule.line} (${rule.text}) holds none of the ${rowsWord(rows.length)}.`);
      },
    },

    // ---------- metrics ----------
    {
      id: "rule_catch_rate",
      kind: "metric",
      format: "percent",
      label: "share of rows only a rule holds that have a wrong answer",
      help: "Of the shown rows every gate clears but a rule holds, how many a review would find wrong: what the rules catch.",
      compute: (ctx) => {
        const rows = ctx.shown().filter(ruleOnly);
        if (!rows.length) return null;
        const wrong = rows.filter((item) => item.correct === false).length;
        return {
          value: wrong / rows.length,
          detail: `${wrong} of ${rows.length} row${rows.length === 1 ? "" : "s"} only a rule holds`,
        };
      },
    },
    {
      id: "coverage_without_rules",
      kind: "metric",
      format: "percent",
      label: "share of shown rows the gates alone would automate",
      help: "Shown rows every checked gate clears, whatever the rules say.",
      compute: (ctx) => {
        const rows = ctx.shown().filter((item) => Array.isArray(item.held));
        if (!rows.length) return null;
        const clear = rows.filter((item) => !item.held.length).length;
        return { value: clear / rows.length, detail: `${clear} of ${rowsWord(rows.length)}` };
      },
    },
    {
      id: "accuracy_without_rules",
      kind: "metric",
      format: "percent",
      label: "accuracy of the shown rows the gates alone would automate",
      compute: (ctx) => {
        const clear = ctx.shown().filter((item) => Array.isArray(item.held) && !item.held.length);
        if (!clear.length) return null;
        const right = clear.filter((item) => item.correct === true).length;
        return {
          value: right / clear.length,
          detail: `${right} of ${clear.length} rows right; measured on these rows`,
        };
      },
    },
    {
      id: "rules_cost_per_1000",
      kind: "metric",
      format: "usd",
      label: "cost per 1,000 shown rows the rules add",
      help: "At the prices in Costs: the shown rows' cost with the rules minus their cost with the gates alone, per 1,000 rows. Negative: the rules save money.",
      compute: (ctx) => {
        const rows = ctx.shown(),
          prices = pricesOf(ctx);
        if (!rows.length || !prices) return null;
        let added = 0;
        for (const item of rows.filter(ruleOnly)) {
          const automated = automateCost(item, prices);
          if (automated === null) return null;
          added += prices.review - automated;
        }
        return {
          value: (added / rows.length) * 1000,
          detail: `${added < -EPS ? "saves" : "adds"} ${money(Math.abs(added))} over ${rowsWord(rows.length)}`,
        };
      },
    },

    // ---------- exports ----------
    {
      id: "rule_hits_csv",
      kind: "exporter",
      label: "What each rule line holds, as CSV",
      mime: "text/csv",
      filename: "policy-rule-lines.csv",
      help: "Your rules and counts only: each rule line in force, the shown rows it holds, how many of them have a wrong gated answer, and the same for rows it holds with no gate and no other rule.",
      build: (ctx) => {
        const rules = ruleLines(ctx);
        if (!rules.length) throw new Error("No rule is in force.");
        const rows = ctx.shown();
        return csvText([
          [
            "rule line",
            "rule",
            "shown rows it holds",
            "with a wrong gated answer",
            "held by this rule alone",
            "alone, with a wrong gated answer",
          ],
          ...rules.map((rule) => {
            const holds = rows.filter((item) => list(item.rules).includes(rule.line));
            const alone = holds.filter((item) => !list(item.held).length && item.rules.length === 1);
            return [
              rule.line,
              rule.text,
              holds.length,
              holds.filter((item) => item.correct === false).length,
              alone.length,
              alone.filter((item) => item.correct === false).length,
            ];
          }),
        ]);
      },
    },
  ],
});
