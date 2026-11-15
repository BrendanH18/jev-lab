// Rules and routing breakdowns for Policy's scored rows (surface "workbench.policy"; contract in
// static/js/lab/surfaces/workbench-analysis.js): which rule lines hold a row, what the rules catch and cost, row
// inputs and label or answer combinations to break routing down by, and aggregate exports of what each rule line and
// each labeled class does. Everything is arithmetic on the user's own Bulk run and Policy's report in this page
// session: no model call, no storage, no edit of an answer. Row costs mirror jev/cost.py row_costs: a right automated
// row costs nothing, a wrong one its most expensive priced mistake (the default price otherwise), a held row one review.
import { compareText, csvText, definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";

const EPS = 1e-9;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const activeOf = (ctx) => (isObject(ctx?.data?.active) ? ctx.data.active : {});
const money = (value) => `$${value.toFixed(2)}`;
const rowsWord = (n) => `${n} shown row${n === 1 ? "" : "s"}`;
const lineWord = (lines) => `line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}`;
const ruleOnly = (item) => item.automated === false && !list(item.held).length && list(item.rules).length > 0;

function gatedSignals(item, ctx) {
  const answers = isObject(item?.answers) ? item.answers : {};
  return Object.keys(activeOf(ctx)).map((qid) => num(answers[qid]?.signal)).filter((s) => s !== null);
}

// question → field of each checked gate's entry, in gate order, joined; null when the row lacks one.
function combo(item, ctx, field) {
  const answers = isObject(item?.answers) ? item.answers : {};
  const qids = Object.keys(activeOf(ctx));
  if (!qids.length || !qids.every((qid) => isObject(answers[qid]))) return null;
  return qids.map((qid) => String(answers[qid][field])).join(" · ");
}

// The kind of input: a picture, plain text, fields of an object, or a list.
function inputKind(item) {
  if (typeof item?.image === "string" && item.image) return "picture";
  if (typeof item?.row === "string") return "plain text";
  if (Array.isArray(item?.row)) return "list";
  if (isObject(item?.row)) return "fields";
  return null;
}

// The rule lines in force as [{ line, text }], numbered as jev/rules.py numbers them (blank and # lines count).
function ruleLines(ctx) {
  const text = ctx?.data?.rules?.in_force || "";
  return text.split(/\r\n|\r|\n/).map((line, i) => ({ line: i + 1, text: line.trim() })).filter((entry) => entry.text && !entry.text.startsWith("#"));
}

// Prices from Policy's cost report, as policy-more reads them.
function pricesOf(ctx) {
  const cost = ctx?.data?.cost;
  const review = num(cost?.review), error = num(cost?.error);
  if (review === null || error === null) return null;
  const mistakes = new Map();
  for (const m of list(cost.mistakes)) if (isObject(m) && num(m.cost) !== null) mistakes.set([m.question, m.label, m.answer].map(String).join("\u0000"), m.cost);
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

const identity = (item) => (item && item.row !== undefined && item.row !== null ? stableStringify(item.row) : null);

export default definePack({
  id: "policy-rules-routing",
  surface: "workbench.policy",
  title: "Policy: rules and routing breakdowns",
  about: "Which rule lines hold Policy's rows, what the rules catch and cost, and row inputs and label or answer combinations to break routing down by, with aggregate exports per rule line and per labeled class. Arithmetic on your own run in this page session; nothing calls the model.",
  features: [
    // ---------- row facts ----------
    { id: "input_length", kind: "fact", type: "number", label: "length of the row's text", help: "Characters in the row as the Bulk table prints it.",
      value: (item) => (typeof item.text === "string" && item.text ? [...item.text].length : null) },
    { id: "signal_spread", kind: "fact", type: "number", label: "spread of the gated signals",
      help: "Highest minus lowest signal over the checked gates: large when the questions disagree about how sure they are.",
      value: (item, ctx) => {
        const signals = gatedSignals(item, ctx);
        return signals.length ? Math.max(...signals) - Math.min(...signals) : null;
      } },
    { id: "wrong_margin", kind: "fact", type: "number", label: "margin of a wrong answer over its gate",
      help: "The smallest signal − threshold among the row's wrong gated answers: below 0 its gate holds it; above 0 that is how far the gate would have to rise to hold it. Unavailable when every gated answer is right.",
      value: (item, ctx) => {
        const active = activeOf(ctx);
        const margins = list(item.wrong).map((qid) => {
          const s = num(item.answers?.[qid]?.signal), t = num(active[qid]);
          return s === null || t === null ? null : s - t;
        }).filter((m) => m !== null);
        return margins.length ? Math.min(...margins) : null;
      } },
    { id: "rule_lines", kind: "fact", type: "category", label: "rule lines that hold the row",
      value: (item) => {
        if (!Array.isArray(item.rules)) return null;
        return item.rules.length ? lineWord(item.rules) : "none";
      } },
    { id: "input_kind", kind: "fact", type: "category", label: "kind of input", help: "A picture, plain text, fields of an object, or a list.",
      value: inputKind },
    { id: "label_combo", kind: "fact", type: "category", label: "gated labels together",
      help: "The labels of the checked gates in gate order, such as billing · yes: break the routing down by labeled class.",
      value: (item, ctx) => combo(item, ctx, "label") },
    { id: "answer_combo", kind: "fact", type: "category", label: "gated answers together",
      help: "The answers of the checked gates in gate order, such as billing · yes.",
      value: (item, ctx) => combo(item, ctx, "answer") },
    { id: "outcome_detail", kind: "fact", type: "category", label: "route and what review finds",
      value: (item) => {
        if (typeof item.automated !== "boolean" || typeof item.correct !== "boolean") return null;
        if (item.automated) return item.correct ? "automated, right" : "automated, wrong";
        return item.correct ? "reviewed, nothing wrong" : "reviewed, a mistake caught";
      } },
    { id: "cheaper_route", kind: "fact", type: "category", label: "cheaper route in hindsight",
      help: "Knowing the labels, at the prices in Costs: automate when automating costs less than a review, review when it costs more, either when they tie.",
      value: (item, ctx) => {
        const prices = pricesOf(ctx), automated = automateCost(item, prices);
        if (automated === null) return null;
        return automated < prices.review - EPS ? "automate" : automated > prices.review + EPS ? "review" : "either";
      } },

    // ---------- checks ----------
    { id: "split_routes", kind: "diagnostic", severity: "advice", scope: "list", label: "Identical inputs routed differently",
      help: "Rows with the same input (picture names included) where one is automated and another held: the answers differ between identical calls.",
      check: (rows) => {
        const groups = new Map();
        for (const item of rows) {
          const key = identity(item);
          if (key === null || typeof item.automated !== "boolean") continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        return [...groups.values()].filter((group) => group.some((item) => item.automated) && group.some((item) => !item.automated))
          .map((group) => `Rows ${group.map((item) => `#${item.number}`).join(", ")} share one input, yet ${group.filter((item) => item.automated).length} automate and ${group.filter((item) => !item.automated).length} go to review: the same question got different answers.`);
      } },
    { id: "rule_catches_mistake", kind: "diagnostic", severity: "info", label: "A rule catches a mistake the gates let through",
      check: (item) => (ruleOnly(item) && item.correct === false
        ? `every gate clears this row, yet ${list(item.wrong).join(", ") || "a gated answer"} is wrong; rule ${lineWord(item.rules)} sends it to review`
        : null) },
    { id: "rule_never_fires", kind: "diagnostic", severity: "info", scope: "list", label: "A rule line holds no shown row",
      check: (rows, ctx) => {
        if (!rows.length || !ctx?.data?.rules?.hold) return null;
        return ruleLines(ctx).filter((rule) => !rows.some((item) => list(item.rules).includes(rule.line)))
          .map((rule) => `Rule line ${rule.line} (${rule.text}) holds none of the ${rowsWord(rows.length)}.`);
      } },

    // ---------- metrics ----------
    { id: "rule_catch_rate", kind: "metric", format: "percent", label: "share of rows only a rule holds that have a wrong answer",
      help: "Of the shown rows every gate clears but a rule holds, how many a review would find wrong: what the rules catch.",
      compute: (ctx) => {
        const rows = ctx.shown().filter(ruleOnly);
        if (!rows.length) return null;
        const wrong = rows.filter((item) => item.correct === false).length;
        return { value: wrong / rows.length, detail: `${wrong} of ${rows.length} row${rows.length === 1 ? "" : "s"} only a rule holds` };
      } },
    { id: "coverage_without_rules", kind: "metric", format: "percent", label: "share of shown rows the gates alone would automate",
      help: "Shown rows every checked gate clears, whatever the rules say.",
      compute: (ctx) => {
        const rows = ctx.shown().filter((item) => Array.isArray(item.held));
        if (!rows.length) return null;
        const clear = rows.filter((item) => !item.held.length).length;
        return { value: clear / rows.length, detail: `${clear} of ${rowsWord(rows.length)}` };
      } },
    { id: "accuracy_without_rules", kind: "metric", format: "percent", label: "accuracy of the shown rows the gates alone would automate",
      compute: (ctx) => {
        const clear = ctx.shown().filter((item) => Array.isArray(item.held) && !item.held.length);
        if (!clear.length) return null;
        const right = clear.filter((item) => item.correct === true).length;
        return { value: right / clear.length, detail: `${right} of ${clear.length} rows right; measured on these rows` };
      } },
    { id: "rules_cost_per_1000", kind: "metric", format: "usd", label: "cost per 1,000 shown rows the rules add",
      help: "At the prices in Costs: the shown rows' cost with the rules minus their cost with the gates alone, per 1,000 rows. Negative: the rules save money.",
      compute: (ctx) => {
        const rows = ctx.shown(), prices = pricesOf(ctx);
        if (!rows.length || !prices) return null;
        let added = 0;
        for (const item of rows.filter(ruleOnly)) {
          const automated = automateCost(item, prices);
          if (automated === null) return null;
          added += prices.review - automated;
        }
        return { value: (added / rows.length) * 1000, detail: `${added < -EPS ? "saves" : "adds"} ${money(Math.abs(added))} over ${rowsWord(rows.length)}` };
      } },

    // ---------- exports ----------
    { id: "rule_hits_csv", kind: "exporter", label: "What each rule line holds, as CSV", mime: "text/csv", filename: "policy-rule-lines.csv",
      help: "Your rules and counts only: each rule line in force, the shown rows it holds, how many of them have a wrong gated answer, and the same for rows it holds with no gate and no other rule.",
      build: (ctx) => {
        const rules = ruleLines(ctx);
        if (!rules.length) throw new Error("No rule is in force.");
        const rows = ctx.shown();
        return csvText([["rule line", "rule", "shown rows it holds", "with a wrong gated answer", "held by this rule alone", "alone, with a wrong gated answer"],
          ...rules.map((rule) => {
            const holds = rows.filter((item) => list(item.rules).includes(rule.line));
            const alone = holds.filter((item) => !list(item.held).length && item.rules.length === 1);
            return [rule.line, rule.text, holds.length, holds.filter((item) => item.correct === false).length, alone.length,
              alone.filter((item) => item.correct === false).length];
          })]);
      } },
    { id: "routing_by_label_csv", kind: "exporter", label: "Routing by labeled class, as CSV", mime: "text/csv", filename: "policy-routing-by-label.csv",
      help: "Aggregates only: for each checked gate and each label it carries on the shown rows, the rows, how many are automated or reviewed, and how many of each that question answers wrongly.",
      build: (ctx) => {
        const rows = ctx.shown(), qids = Object.keys(activeOf(ctx));
        if (!rows.length || !qids.length) throw new Error("There are no scored rows: check a gate and label some rows.");
        const out = [["question", "label", "shown rows", "automated", "automated, this answer wrong", "reviewed", "reviewed, this answer wrong"]];
        for (const qid of qids) {
          const labels = [...new Set(rows.map((item) => item.answers?.[qid]?.label).filter((label) => label !== undefined && label !== null).map(String))].sort(compareText);
          for (const label of labels) {
            const group = rows.filter((item) => String(item.answers?.[qid]?.label) === label);
            const auto = group.filter((item) => item.automated === true), held = group.filter((item) => item.automated === false);
            const wrong = (items) => items.filter((item) => list(item.wrong).includes(qid)).length;
            out.push([qid, label, group.length, auto.length, wrong(auto), held.length, wrong(held)]);
          }
        }
        return csvText(out);
      } },
  ],
});
