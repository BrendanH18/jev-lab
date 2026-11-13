// Toolbox: cost planning for Workbench runs and the people around a gate ("workbench.toolbox", group "Costs and
// budgets"). Every tool is a pure function of what is typed into its form: prices are inputs (never a live price),
// results are estimates or upper bounds (never measured spend), and nothing reads page data or calls the model.
import { definePack, toNumber } from "../../kit.js";

const GROUP = "Costs and budgets";
const M = 1e6;
const EPS = 1e-9;

const PRICE = { name: "price", label: "Price per million input tokens (USD)", type: "number", min: 0, placeholder: "the price you pay" };
const TOKENS = (name = "tokens", label = "Input tokens per call") => ({ name, label, type: "number", min: 0, placeholder: "e.g. 500" });
const USD = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, ...extra });
const SHARE = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const COUNT = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, ...extra });
const MINUTES = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, ...extra });
const ESTIMATE = "An estimate from the tokens and prices you typed, not measured spend.";

const need = (condition, message) => { if (!condition) throw new Error(message); };
const floorSafe = (x) => Math.floor(x + EPS);
const ceilSafe = (x) => Math.ceil(x - EPS);
const usd = (tokens, price) => tokens * price / M;
const ratio = (a, b) => (b > 0 ? a / b : null);

// Lines of "a, b, c" (tab, semicolon or comma separated); blank lines and lines starting with # are skipped.
function records(text, fields, what) {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(/\s*[\t;,]\s*/);
    need(cells.length === fields.length, `Line ${index + 1}: expected ${fields.length} values (${fields.join(", ")}), found ${cells.length}.`);
    out.push({ line: index + 1, cells });
  });
  need(out.length > 0, `Type at least one ${what}.`);
  return out;
}

function numberCell(cell, line, label, { min = 0, integer = false } = {}) {
  const value = toNumber(cell);
  need(value !== null, `Line ${line}: ${label} must be a number.`);
  need(!integer || Number.isInteger(value), `Line ${line}: ${label} must be a whole number.`);
  need(value >= min, `Line ${line}: ${label} must be at least ${min}.`);
  return value;
}

// Probabilities separated by commas, semicolons, spaces or new lines.
function probabilities(text) {
  const parts = String(text ?? "").split(/[\s,;]+/).filter(Boolean);
  need(parts.length > 0, "Type at least one probability.");
  return parts.map((part, index) => {
    const value = toNumber(part);
    need(value !== null && value >= 0 && value <= 1, `Value ${index + 1} (${part}) is not a probability between 0 and 1.`);
    return value;
  });
}

export default definePack({
  id: "tb-costs",
  surface: "workbench.toolbox",
  title: "Cost planning tools",
  about: "Calculators for what Workbench runs, reviews, audits and labeling cost and how a budget stretches across them. Prices are what you type, and every result is an estimate or upper bound from your inputs, never measured spend.",
  features: [
    { id: "compare_cost", kind: "tool", group: GROUP, title: "Cost of a Compare run",
      help: "Compare asks both variants every row, so it makes two calls per row. Each variant has its own tokens per call and price (blank B price = A's), which also fits trying a newer model version on the same rows.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), TOKENS("tokensA", "Variant A input tokens per call"), TOKENS("tokensB", "Variant B input tokens per call"),
        USD("priceA", "Variant A price per million input tokens (USD)"), USD("priceB", "Variant B price per million input tokens (USD, blank = A's)", { optional: true })],
      compute: ({ rows, tokensA, tokensB, priceA, priceB }) => {
        const a = usd(rows * tokensA, priceA), b = usd(rows * tokensB, priceB === null ? priceA : priceB);
        return { rows: [["Calls", 2 * rows], ["Variant A cost (USD)", a], ["Variant B cost (USD)", b], ["Total cost (USD)", a + b], ["Extra cost of B over A (USD)", b - a]], note: ESTIMATE };
      } },
    { id: "check_rerun_cost", kind: "tool", group: GROUP, title: "Cost of rerunning a check",
      help: "A check reruns one call per labeled row, leaving held-out test rows out. Gives the cost of one rerun and, with a budget, how many reruns it covers.",
      inputs: [COUNT("labeled", "Labeled rows in the dataset", { min: 1 }), COUNT("heldOut", "Held-out test rows among them", { default: 0 }), TOKENS(), PRICE,
        USD("budget", "Budget for reruns (USD, optional)", { optional: true })],
      compute: ({ labeled, heldOut, tokens, price, budget }) => {
        need(heldOut < labeled, "Held-out rows must be fewer than the labeled rows.");
        const calls = labeled - heldOut, cost = usd(calls * tokens, price);
        return { rows: [["Calls per rerun", calls], ["Cost per rerun (USD)", cost], ["Reruns the budget covers", budget === null || cost <= 0 ? null : floorSafe(budget / cost)]], note: ESTIMATE };
      } },
    { id: "cascade_cost", kind: "tool", group: GROUP, title: "Cost of a cascade",
      help: "Ask a cheaper variant A every row and escalate to variant B only for the share whose signal is too low. Compares the expected cost with asking B every row.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), TOKENS("tokensA", "Variant A input tokens per call"), TOKENS("tokensB", "Variant B input tokens per call"),
        USD("priceA", "Variant A price per million input tokens (USD)"), USD("priceB", "Variant B price per million input tokens (USD, blank = A's)", { optional: true }),
        SHARE("escalated", "Share of rows escalated to B")],
      compute: ({ rows, tokensA, tokensB, priceA, priceB, escalated }) => {
        const perB = usd(tokensB, priceB === null ? priceA : priceB);
        const first = rows * usd(tokensA, priceA), second = rows * escalated * perB, always = rows * perB;
        return { rows: [["Expected calls", rows * (1 + escalated)], ["Variant A cost (USD)", first], ["Escalation cost (USD)", second], ["Cascade cost (USD)", first + second],
          ["Cost of asking B every row (USD)", always], ["Saving against B every row (USD)", always - first - second]], note: ESTIMATE };
      } },
    { id: "tokens_from_chars", kind: "tool", group: GROUP, title: "Input tokens from characters",
      help: "A rough token count from the characters a call sends (state, questions and instructions), at an assumed number of characters per token. Real tokenization varies; the spend preview's bound assumes 2.",
      inputs: [COUNT("chars", "Characters per call"), { name: "perToken", label: "Characters per token (assumption)", type: "number", min: 0.5, default: 4 },
        COUNT("calls", "Calls", { min: 1, default: 1 }), USD("price", "Price per million input tokens (USD, optional)", { optional: true })],
      compute: ({ chars, perToken, calls, price }) => {
        const each = ceilSafe(chars / perToken);
        return { rows: [["Tokens per call", each], ["Tokens for all calls", each * calls], ["Estimated cost (USD)", price === null ? null : usd(each * calls, price)]],
          note: `Assumes ${perToken} characters per token, rounded up per call. A rough estimate.` };
      } },
    { id: "reserve_bound", kind: "tool", group: GROUP, title: "Upper bound a spend preview holds",
      help: "The server's rule for what a call holds against the budget before it settles: two characters of the request JSON per token, at least 64 tokens, plus a fixed allowance for each picture use. An upper bound, not measured spend.",
      inputs: [COUNT("chars", "Request JSON characters per call"), COUNT("pictures", "Picture uses per call", { default: 0 }),
        COUNT("allowance", "Tokens held per picture use", { default: 16000 }), COUNT("calls", "Calls", { min: 1, default: 1 }), PRICE],
      compute: ({ chars, pictures, allowance, calls, price }) => {
        const tokens = Math.max(64, Math.floor((chars + 1) / 2)) + pictures * allowance;
        return { rows: [["Tokens held per call", tokens], ["Upper bound per call (USD)", usd(tokens, price)], ["Upper bound for all calls (USD)", usd(tokens * calls, price)]],
          note: "An upper bound: billing uses the tokens actually counted." };
      } },
    { id: "merge_vs_separate", kind: "tool", group: GROUP, title: "Merged questions versus separate calls",
      help: "Asking k questions in one call sends the row and the fixed request overhead once; asking them in k calls sends both k times. Compares calls, tokens and cost.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), COUNT("questions", "Questions", { min: 1 }), TOKENS("state", "Input tokens of the row (state)"),
        TOKENS("question", "Input tokens per question"), TOKENS("overhead", "Fixed overhead tokens per call"), PRICE],
      compute: ({ rows, questions, state, question, overhead, price }) => {
        const separate = rows * questions * (state + overhead + question), merged = rows * (state + overhead + questions * question);
        return { rows: [["Calls separately", rows * questions], ["Calls merged", rows], ["Input tokens separately", separate], ["Input tokens merged", merged],
          ["Tokens saved by merging", separate - merged], ["Share of tokens saved", ratio(separate - merged, separate)], ["Cost separately (USD)", usd(separate, price)],
          ["Cost merged (USD)", usd(merged, price)], ["Saving (USD)", usd(separate - merged, price)]], note: ESTIMATE };
      } },
    { id: "shorter_request_saving", kind: "tool", group: GROUP, title: "Saving from a shorter request",
      help: "What dropping tokens from every call saves, such as a question no gate or rule reads or a trimmed instruction.",
      inputs: [TOKENS("removed", "Input tokens removed per call"), COUNT("perMonth", "Calls per month", { min: 1 }), PRICE,
        COUNT("months", "Months", { min: 1, default: 12 }), { ...TOKENS("current", "Current input tokens per call (optional)"), optional: true }],
      compute: ({ removed, perMonth, price, months, current }) => {
        need(current === null || current >= removed, "The current tokens per call cannot be fewer than the tokens removed.");
        const monthly = usd(removed * perMonth, price);
        return { rows: [["Tokens saved per month", removed * perMonth], ["Saving per month (USD)", monthly], [`Saving over ${months} months (USD)`, monthly * months],
          ["Share of each call removed", current === null ? null : ratio(removed, current)]], note: ESTIMATE };
      } },
    { id: "automation_savings", kind: "tool", group: GROUP, title: "Savings from automating a share of rows",
      help: "Compares reviewing every row by hand with a gate that automates a share and sends the rest to people, paying the model for every row.",
      inputs: [COUNT("rows", "Rows per month", { min: 1 }), SHARE("automated", "Share of rows automated"), MINUTES("minutes", "Minutes to review one row"),
        USD("rate", "Hourly cost of a reviewer (USD)"), USD("model", "Model cost per row (USD)", { default: 0 })],
      compute: ({ rows, automated, minutes, rate, model }) => {
        const before = rows * minutes / 60, after = before * (1 - automated);
        const costBefore = before * rate, costAfter = after * rate + rows * model;
        return [["Review hours without a gate", before], ["Review hours with the gate", after], ["Review hours saved", before - after],
          ["Cost without a gate (USD)", costBefore], ["Cost with the gate, review and model (USD)", costAfter], ["Saving (USD)", costBefore - costAfter]];
      } },
    { id: "cost_per_correct", kind: "tool", group: GROUP, title: "Cost per correct automated decision",
      help: "Spreads a run's model cost over the decisions it automated and over the automated decisions that were right.",
      inputs: [USD("cost", "Model cost of the run (USD)"), COUNT("rows", "Rows in the run", { min: 1 }), SHARE("coverage", "Share of rows automated (coverage)"),
        SHARE("accuracy", "Accuracy of the automated rows")],
      compute: ({ cost, rows, coverage, accuracy }) => {
        const automated = rows * coverage, correct = automated * accuracy;
        return [["Automated rows", automated], ["Correct automated rows", correct], ["Model cost per row (USD)", cost / rows],
          ["Cost per automated decision (USD)", ratio(cost, automated)], ["Cost per correct automated decision (USD)", ratio(cost, correct)]];
      } },
    { id: "budget_plan", kind: "tool", group: GROUP, title: "Several runs against one budget",
      help: "Lists planned runs in order, one per line as name, calls, input tokens per call, and shows each run's cost, the running total and whether it still fits the budget.",
      inputs: [USD("budget", "Budget (USD)", { default: 2 }), PRICE,
        { name: "runs", label: "Runs (name, calls, tokens per call)", type: "textarea", rows: 6, required: true, placeholder: "bulk, 200, 500\ncompare, 400, 450\ncheck, 100, 500" }],
      compute: ({ budget, price, runs }) => {
        let total = 0, fitting = 0, broken = false;
        const rows = records(runs, ["name", "calls", "tokens"], "run").map(({ line, cells }) => {
          need(cells[0] !== "", `Line ${line}: the run needs a name.`);
          const calls = numberCell(cells[1], line, "calls", { integer: true }), tokens = numberCell(cells[2], line, "tokens per call");
          const cost = usd(calls * tokens, price);
          total += cost;
          const fits = total <= budget + EPS;
          if (fits && !broken) fitting++; else broken = true;
          return [cells[0], calls, calls * tokens, cost, total, fits ? "yes" : "no"];
        });
        return { rows: [["Total cost (USD)", total], ["Budget left after the plan (USD)", budget - total], ["Runs that fit, in order", fitting]],
          table: { columns: ["Run", "Calls", "Input tokens", "Cost (USD)", "Running total (USD)", "Within budget"], rows }, note: ESTIMATE };
      } },
    { id: "budget_split", kind: "tool", group: GROUP, title: "Split a budget across runs by weight",
      help: "Keeps a share of the budget back, splits the rest across runs in proportion to their weights (one per line as name, weight, cost per row in USD) and shows the rows each share allows.",
      inputs: [USD("budget", "Budget (USD)", { default: 2 }), SHARE("reserve", "Share kept back", { default: 0 }),
        { name: "runs", label: "Runs (name, weight, cost per row in USD)", type: "textarea", rows: 6, required: true, placeholder: "bulk, 2, 0.00003\ncheck, 1, 0.00002" }],
      compute: ({ budget, reserve, runs }) => {
        const parsed = records(runs, ["name", "weight", "cost per row"], "run").map(({ line, cells }) => {
          need(cells[0] !== "", `Line ${line}: the run needs a name.`);
          return { name: cells[0], weight: numberCell(cells[1], line, "weight"), cost: numberCell(cells[2], line, "cost per row") };
        });
        const weights = parsed.reduce((sum, run) => sum + run.weight, 0);
        need(weights > 0, "At least one weight must be above 0.");
        const split = budget * (1 - reserve);
        const rows = parsed.map((run) => {
          const share = run.weight / weights, amount = split * share;
          return [run.name, share, amount, run.cost > 0 ? floorSafe(amount / run.cost) : null];
        });
        return { rows: [["Kept back (USD)", budget * reserve], ["Split across runs (USD)", split]],
          table: { columns: ["Run", "Share", "Budget (USD)", "Rows it allows"], rows }, note: "A run with no cost per row shows — rows: the budget does not limit it." };
      } },
    { id: "guard_headroom", kind: "tool", group: GROUP, title: "Room left under the spend guard",
      help: "The server's spend guard refuses a call when recorded spend, plus what running calls hold, plus the new call's hold would pass the budget. Shows whether a run's upper bound fits what is left. A budget of 0 means no limit.",
      inputs: [USD("budget", "Budget (USD, 0 = no limit)", { default: 2 }), USD("spent", "Recorded spend (USD)"), USD("held", "Held by running calls (USD)", { default: 0 }),
        USD("next", "Upper bound of the next run (USD)")],
      compute: ({ budget, spent, held, next }) => {
        const committed = spent + held;
        if (budget === 0) return { rows: [["Committed (USD)", committed], ["Budget left (USD)", null], ["Next run fits", "yes"], ["Shortfall (USD)", 0], ["Runs of this size that fit", null]], note: "No budget limit is set." };
        const left = budget - committed;
        return { rows: [["Committed (USD)", committed], ["Budget left (USD)", left], ["Next run fits", committed + next <= budget + EPS ? "yes" : "no"],
          ["Shortfall (USD)", Math.max(0, next - left)], ["Runs of this size that fit", next > 0 ? Math.max(0, floorSafe(left / next)) : null]],
        note: "The guard checks each call as it starts, so a run that does not fit stops partway." };
      } },
    { id: "bound_vs_billed", kind: "tool", group: GROUP, title: "Spend preview against billed cost",
      help: "Compares a run's spend-preview upper bound with what it was billed, and turns the billed amount into cost and input tokens per row.",
      inputs: [USD("bound", "Spend preview upper bound (USD)"), USD("billed", "Billed cost (USD)"), COUNT("rows", "Rows (optional)", { min: 1, optional: true }),
        USD("price", "Price per million input tokens (USD, optional)", { optional: true })],
      compute: ({ bound, billed, rows, price }) => {
        need(bound > 0, "The upper bound must be above 0.");
        const tokens = price ? billed / price * M : null;
        return [["Billed as a share of the bound", billed / bound], ["Bound ÷ billed", ratio(bound, billed)], ["Unused hold (USD)", bound - billed],
          ["Billed per row (USD)", rows === null ? null : billed / rows], ["Billed input tokens", tokens], ["Billed input tokens per row", rows === null || tokens === null ? null : tokens / rows]];
      } },
    { id: "bulk_batches_cost", kind: "tool", group: GROUP, title: "Cost of a large dataset in Bulk batches",
      help: "Bulk runs at most 200 rows at a time. Splits a larger set into batches and prices a full batch and the whole set.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), COUNT("perBatch", "Rows per Bulk run", { min: 1, max: 200, default: 200 }), TOKENS(),
        COUNT("calls", "Calls per row", { min: 1, default: 1 }), PRICE],
      compute: ({ rows, perBatch, tokens, calls, price }) => {
        const batches = Math.ceil(rows / perBatch);
        return { rows: [["Bulk runs", batches], ["Rows in the last run", rows - (batches - 1) * perBatch], ["Cost of the largest run (USD)", usd(Math.min(rows, perBatch) * calls * tokens, price)],
          ["Cost of every run (USD)", usd(rows * calls * tokens, price)]], note: ESTIMATE };
      } },
    { id: "audit_sample_cost", kind: "tool", group: GROUP, title: "Cost of an audit sample",
      help: "People label a random share of the automated rows to measure accuracy. Labeling decisions already made needs no model call, so the cost is reviewer time.",
      inputs: [COUNT("automated", "Automated rows", { min: 1 }), SHARE("share", "Share audited"), MINUTES("minutes", "Minutes per audited row"),
        USD("rate", "Hourly cost of a reviewer (USD)")],
      compute: ({ automated, share, minutes, rate }) => {
        const audited = ceilSafe(automated * share), hours = audited * minutes / 60;
        return [["Rows audited", audited], ["Labeling hours", hours], ["Audit cost (USD)", hours * rate], ["Audit cost per automated row (USD)", hours * rate / automated]];
      } },
    { id: "labeling_cost", kind: "tool", group: GROUP, title: "Cost of labeling a dataset",
      help: "Reviewer time to label a dataset, with an optional share labeled a second time, blind, to measure agreement.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), MINUTES("minutes", "Minutes per label"), USD("rate", "Hourly cost of a labeler (USD)"),
        SHARE("second", "Share labeled twice", { default: 0 })],
      compute: ({ rows, minutes, rate, second }) => {
        const labels = rows + ceilSafe(rows * second), hours = labels * minutes / 60;
        return [["Labels", labels], ["Labeling hours", hours], ["Labeling cost (USD)", hours * rate], ["Cost per row (USD)", hours * rate / rows]];
      } },
    { id: "break_even_volume", kind: "tool", group: GROUP, title: "Break-even volume for building a gate",
      help: "How many rows a gate must handle before what it saves per row pays back what it cost to build (labeling, tuning, model runs).",
      inputs: [USD("build", "Cost to build the gate (USD)"), USD("before", "Cost per row without the gate (USD)"), USD("after", "Cost per row with the gate (USD)"),
        COUNT("perMonth", "Rows per month (optional)", { min: 1, optional: true })],
      compute: ({ build, before, after, perMonth }) => {
        const saving = before - after;
        if (saving <= 0) return { rows: [["Saving per row (USD)", saving], ["Rows to break even", null], ["Months to break even", null]], note: "The gate costs as much per row as before or more, so it never pays back." };
        return [["Saving per row (USD)", saving], ["Rows to break even", ceilSafe(build / saving)], ["Months to break even", perMonth === null ? null : build / saving / perMonth]];
      } },
    { id: "growth_cost", kind: "tool", group: GROUP, title: "Cost over months with steady growth",
      help: "Adds up a monthly cost that grows (or shrinks) by the same share every month, such as a year of traffic growing 5% a month.",
      inputs: [USD("first", "Cost of the first month (USD)"), { name: "growth", label: "Growth per month (0.05 = 5%)", type: "number", min: -0.99, max: 10, default: 0 },
        COUNT("months", "Months", { min: 1, max: 600, default: 12 })],
      compute: ({ first, growth, months }) => {
        const total = growth === 0 ? first * months : first * (Math.pow(1 + growth, months) - 1) / growth;
        return [["Total cost (USD)", total], ["Cost of the last month (USD)", first * Math.pow(1 + growth, months - 1)], ["Average per month (USD)", total / months]];
      } },
    { id: "threshold_cost", kind: "tool", group: GROUP, title: "Cost of a threshold from calibrated probabilities",
      help: "Paste the probabilities a run gave. Rows at or above the threshold are automated and the rest go to review. With calibrated probabilities, an automated row is wrong 1 − p of the time, so this prices reviews and expected mistakes against reviewing or automating everything.",
      inputs: [{ name: "probs", label: "Probabilities, one per row", type: "textarea", rows: 6, required: true, placeholder: "0.99\n0.95\n0.7" },
        SHARE("threshold", "Threshold"), USD("review", "Cost of reviewing one row (USD)"), USD("mistake", "Cost of one automated mistake (USD)")],
      compute: ({ probs, threshold, review, mistake }) => {
        const values = probabilities(probs);
        const automated = values.filter((p) => p >= threshold);
        const expected = automated.reduce((sum, p) => sum + (1 - p), 0), everything = values.reduce((sum, p) => sum + (1 - p), 0);
        const reviewed = values.length - automated.length;
        return { rows: [["Rows", values.length], ["Rows automated", automated.length], ["Rows sent to review", reviewed], ["Share sent to review", reviewed / values.length],
          ["Review cost (USD)", reviewed * review], ["Expected mistakes among automated rows", expected], ["Expected mistake cost (USD)", expected * mistake],
          ["Expected total cost (USD)", reviewed * review + expected * mistake], ["Cost of reviewing every row (USD)", values.length * review],
          ["Expected cost of automating every row (USD)", everything * mistake]], note: "Holds only when the probabilities are calibrated." };
      } },
    { id: "review_staffing", kind: "tool", group: GROUP, title: "Reviewers needed for a daily review volume",
      help: "Turns the rows sent to review each day into reviewer hours, the number of reviewers needed and the daily cost.",
      inputs: [COUNT("rows", "Rows sent to review per day", { min: 1 }), MINUTES("minutes", "Minutes per review"),
        { name: "hours", label: "Review hours per reviewer per day", type: "number", min: 0.1, max: 24, default: 6 }, USD("rate", "Hourly cost of a reviewer (USD, optional)", { optional: true })],
      compute: ({ rows, minutes, hours, rate }) => {
        const work = rows * minutes / 60, people = Math.max(1, ceilSafe(work / hours));
        return [["Review hours per day", work], ["Reviewers needed", people], ["Reviewer utilization", work / (people * hours)], ["Review cost per day (USD)", rate === null ? null : work * rate]];
      } },
    { id: "variant_worth", kind: "tool", group: GROUP, title: "Is a more accurate variant worth its tokens",
      help: "Weighs the mistakes a more accurate variant avoids against the extra input tokens it sends, at the same volume. Also gives the mistake cost at which the two break even.",
      inputs: [COUNT("rows", "Rows per month", { min: 1 }), SHARE("accA", "Accuracy of variant A"), SHARE("accB", "Accuracy of variant B"),
        TOKENS("tokensA", "Variant A input tokens per call"), TOKENS("tokensB", "Variant B input tokens per call"), PRICE, USD("mistake", "Cost of one mistake (USD)")],
      compute: ({ rows, accA, accB, tokensA, tokensB, price, mistake }) => {
        const avoided = rows * (accB - accA), extra = usd(rows * (tokensB - tokensA), price);
        return [["Mistakes avoided per month", avoided], ["Value of avoided mistakes (USD)", avoided * mistake], ["Extra model cost per month (USD)", extra],
          ["Net gain of B per month (USD)", avoided * mistake - extra], ["Mistake cost where they break even (USD)", avoided > 0 && extra > 0 ? extra / avoided : null]];
      } },
    { id: "price_converter", kind: "tool", group: GROUP, title: "Convert a token price",
      help: "A price per million, per thousand or per input token in the other units, as tokens per dollar, and as the cost of 1,000 calls of a given size.",
      inputs: [USD("value", "Price (USD)"), { name: "unit", label: "Per", type: "select", options: [["million", "million tokens"], ["thousand", "thousand tokens"], ["token", "token"]], default: "million" },
        { ...TOKENS("tokens", "Input tokens per call (optional)"), optional: true }],
      compute: ({ value, unit, tokens }) => {
        const perMillion = value * { million: 1, thousand: 1e3, token: M }[unit];
        return [["Per million tokens (USD)", perMillion], ["Per thousand tokens (USD)", perMillion / 1e3], ["Per token (USD)", perMillion / M],
          ["Tokens per dollar", perMillion > 0 ? M / perMillion : null], ["Cost of 1,000 calls (USD)", tokens === null ? null : usd(1000 * tokens, perMillion)]];
      } },
    { id: "budget_runway", kind: "tool", group: GROUP, title: "How long a budget lasts",
      help: "Days a budget covers at a daily row volume and a cost per row. The server's own budget applies per run of the server; this is for any budget you plan against.",
      inputs: [USD("budget", "Budget (USD)", { default: 2 }), COUNT("perDay", "Rows per day", { min: 1 }), USD("perRow", "Cost per row (USD)")],
      compute: ({ budget, perDay, perRow }) => {
        const daily = perDay * perRow;
        return [["Cost per day (USD)", daily], ["Days the budget lasts", ratio(budget, daily)], ["Whole days", daily > 0 ? floorSafe(budget / daily) : null], ["Rows the budget covers", perRow > 0 ? floorSafe(budget / perRow) : null]];
      } },
    { id: "mistake_budget_rate", kind: "tool", group: GROUP, title: "Error rate a mistake budget allows",
      help: "Given what one automated mistake costs and how much mistake cost a month can absorb, the highest error rate (and lowest accuracy) the automated rows can have.",
      inputs: [COUNT("rows", "Automated rows per month", { min: 1 }), USD("mistake", "Cost of one mistake (USD)"), USD("budget", "Mistake cost allowed per month (USD)")],
      compute: ({ rows, mistake, budget }) => {
        need(mistake > 0, "The cost of a mistake must be above 0.");
        const rate = Math.min(1, budget / (mistake * rows));
        return [["Mistakes allowed per month", Math.min(rows, floorSafe(budget / mistake))], ["Highest error rate", rate], ["Lowest accuracy", 1 - rate]];
      } },
  ],
});
