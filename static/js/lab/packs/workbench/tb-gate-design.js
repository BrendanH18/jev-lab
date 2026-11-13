// Toolbox: calculators for designing gates over several questions — what an AND gate covers and gets right, how a
// target splits across its questions, what it sends to people, how many mistakes it automates, and what an audit
// sample can rule out. Every tool is pure: it reads only what is typed into its form, never page data, and never
// calls the model. Results are projections from the typed rates, not measurements.
import { definePack, toNumber } from "../../kit.js";
import { betaQuantile, binomialCdf, poissonCdf, poissonSf } from "../../lib/math.js";

const GROUP = "Gate design";
const MAX_ROWS = 1e9;
const MAX_LINES = 200;
const INDEPENDENT = "Assumes the questions clear their thresholds and answer correctly independently of each other.";

// ---------- inputs ----------

const share = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const count = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, max: MAX_ROWS, ...extra });
const amount = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: MAX_ROWS, ...extra });
const usd = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, ...extra });
const optional = (input) => ({ ...input, optional: true });
const paste = (name, label, placeholder) => ({ name, label, type: "textarea", rows: 6, required: true, placeholder });
const QUESTIONS = paste("questions", "Questions: name, coverage, accuracy", "intent, 0.9, 0.97\nrefund_amount, 0.8, 0.95");
const HOURS = { name: "hours", label: "Review hours per reviewer per day", type: "number", min: 0.1, max: 24, default: 6 };
const ONE_SIDED = { name: "level", label: "Confidence (one-sided)", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]] };

// ---------- helpers ----------

const fail = (message) => { throw new Error(message); };
const ceilCount = (x) => Math.ceil(x - 1e-9);
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);
const product = (values) => values.reduce((total, value) => total * value, 1);
const productWithout = (values, skip) => values.reduce((total, value, index) => (index === skip ? total : total * value), 1);
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const orNull = (value, ok) => (ok ? value : null);

// Pasted lines split on commas, semicolons or tabs. A first line whose last cell is not a number is a header.
function lines(text, what, max = MAX_LINES) {
  let list = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => ({ line, cells: line.split(/[,;\t]/).map((cell) => cell.trim()) }));
  if (list.length && toNumber(list[0].cells[list[0].cells.length - 1]) === null) list = list.slice(1);
  if (!list.length) fail(`Paste at least one ${what}, one per line.`);
  if (list.length > max) fail(`Paste at most ${max} lines.`);
  return list;
}

function rateCell(cell, where, label) {
  const value = toNumber(cell);
  if (value === null || value < 0 || value > 1) fail(`${where}: ${label} must be a number from 0 to 1.`);
  return value;
}

function positiveCell(cell, where, label) {
  const value = toNumber(cell);
  if (value === null || value < 0) fail(`${where}: ${label} must be a number of at least 0.`);
  return value;
}

// "name, coverage, accuracy" per line; the name may be left out.
function questionList(text) {
  return lines(text, "question", 50).map(({ line, cells }, index) => {
    const where = `Line ${index + 1}`;
    const parts = cells.length === 2 ? ["", ...cells] : cells;
    if (parts.length !== 3) fail(`${where} ("${short(line)}") needs a name, a coverage and an accuracy.`);
    return { name: parts[0] || `Question ${index + 1}`, coverage: rateCell(parts[1], where, "the coverage"), accuracy: rateCell(parts[2], where, "the accuracy") };
  });
}

// The smallest k >= start with ok(k); ok must turn from false to true as k grows. null when none up to MAX_ROWS.
function firstTrue(ok, start) {
  let lo = start, hi = Math.max(start, 1);
  while (!ok(hi)) {
    if (hi >= MAX_ROWS) return null;
    lo = hi + 1;
    hi = Math.min(MAX_ROWS, hi * 2);
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// The smallest k in 0..(a count far above the mean) with ok(k), by halving; ok must turn from false to true as k grows.
// Poisson counts lie within mean ± 50 standard deviations to double precision, so the search stays short at any mean.
function lowestCount(ok, mean) {
  let lo = 0, hi = Math.ceil(mean + 50 * Math.sqrt(mean) + 50);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}
const cdfOf = (k, mean) => poissonCdf(k, mean) ?? 0;

// The smallest k with P[X <= k] >= q for X ~ Poisson(mean).
const poissonQuantile = (q, mean) => lowestCount((k) => cdfOf(k, mean) >= q, mean);

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

// ---------- tools ----------

export default definePack({
  id: "tb-gate-design",
  surface: "workbench.toolbox",
  title: "Gate design tools",
  about: "Twenty-five calculators for gates over several questions: AND-gate coverage and accuracy, per-question targets and error budgets, guard questions, review load and staffing, automated mistakes per month, alarms, staged rollouts and what an audit sample rules out. They compute only from what you type; results are projections, not measurements.",
  features: [
    tool("and_gate_rates", "Coverage and accuracy of an AND gate",
      `A row is automated only when every question clears its threshold, and its decision is right only when every answer is right, so the gate's coverage is the product of the coverages and its accuracy the product of the accuracies. Lists, per question, the gate without it and the share of rows only it blocks. ${INDEPENDENT} Paste one question per line: name, coverage, accuracy (the name may be left out).`,
      [QUESTIONS, optional(amount("volume", "Rows per day (optional)"))], ({ questions, volume }) => {
        const list = questionList(questions), cov = list.map((q) => q.coverage), acc = list.map((q) => q.accuracy);
        const coverage = product(cov), accuracy = product(acc), daily = volume !== null;
        return {
          rows: [["Questions", list.length], ["Gate coverage", coverage], ["Gate accuracy", accuracy], ["Gate error rate", 1 - accuracy], ["Share sent to review", 1 - coverage],
            ["Automated rows per day", orNull(daily && volume * coverage, daily)], ["Automated mistakes per day", orNull(daily && volume * coverage * (1 - accuracy), daily)]],
          table: { columns: ["Question", "Coverage", "Accuracy", "Gate coverage without it", "Gate accuracy without it", "Share of rows only it blocks"],
            rows: list.map((q, i) => [q.name, q.coverage, q.accuracy, productWithout(cov, i), productWithout(acc, i), productWithout(cov, i) * (1 - q.coverage)]) },
          note: "Correlated questions usually clear together, so real coverage is often above this product.",
        };
      }),
    tool("and_gate_bounds", "Limits of an AND gate without independence",
      "The range an AND gate's coverage and error rate can take whatever the dependence between questions: coverage lies between max(0, Σ coverage − (k − 1)) and the smallest coverage, and the error rate between the largest single error rate and their sum (the union bound). The independent value is shown for reference. For the error limits, measure each question's accuracy on the rows the whole gate automates. Paste one question per line: name, coverage, accuracy.",
      [QUESTIONS], ({ questions }) => {
        const list = questionList(questions), cov = list.map((q) => q.coverage), errors = list.map((q) => 1 - q.accuracy);
        const highest = Math.min(1, total(errors));
        return [["Lowest coverage", Math.max(0, total(cov) - (list.length - 1))], ["Coverage if independent", product(cov)], ["Highest coverage", Math.min(...cov)],
          ["Lowest error rate", Math.max(...errors)], ["Error rate if independent", 1 - product(list.map((q) => q.accuracy))], ["Highest error rate", highest], ["Lowest accuracy", 1 - highest]];
      }),
    tool("per_question_targets", "Per-question targets for a gate",
      "What each of k questions must reach for the gate to meet an overall coverage and accuracy. With independent questions each needs the k-th root of the target. Split evenly by the union bound, a review share of (1 − target coverage) ÷ k and an error budget of (1 − target accuracy) ÷ k per question hold whatever the dependence and ask a little more (measure each question's accuracy on the rows the whole gate automates).",
      [count("k", "Questions in the gate", { min: 1, max: 50, default: 3 }), share("coverage", "Target gate coverage", { default: 0.7 }), share("accuracy", "Target gate accuracy", { default: 0.95 })],
      ({ k, coverage, accuracy }) => [["Coverage each question needs (independent)", coverage ** (1 / k)], ["Accuracy each question needs (independent)", accuracy ** (1 / k)],
        ["Coverage each question needs (any dependence)", 1 - (1 - coverage) / k], ["Error budget per question (any dependence)", (1 - accuracy) / k], ["Accuracy each question needs (any dependence)", 1 - (1 - accuracy) / k]]),
    tool("last_question_needs", "What one more question must reach",
      `Given the questions a gate already has and the coverage and accuracy it must keep, the coverage and accuracy one more question needs: the target divided by what the others already give. A need above 1 cannot be met. ${INDEPENDENT} Paste the existing questions one per line: name, coverage, accuracy.`,
      [{ ...QUESTIONS, label: "Existing questions: name, coverage, accuracy" }, share("coverage", "Target gate coverage", { default: 0.6 }), share("accuracy", "Target gate accuracy", { default: 0.9 })],
      ({ questions, coverage, accuracy }) => {
        const list = questionList(questions), cov = product(list.map((q) => q.coverage)), acc = product(list.map((q) => q.accuracy));
        const needCov = cov > 0 ? coverage / cov : (coverage === 0 ? 0 : Infinity), needAcc = acc > 0 ? accuracy / acc : (accuracy === 0 ? 0 : Infinity);
        const missing = [needCov > 1 + 1e-12 ? "coverage" : null, needAcc > 1 + 1e-12 ? "accuracy" : null].filter(Boolean);
        return [["Coverage of the questions so far", cov], ["Accuracy of the questions so far", acc], ["Coverage the new question needs", orNull(Math.min(needCov, 1), needCov <= 1 + 1e-12)],
          ["Accuracy the new question needs", orNull(Math.min(needAcc, 1), needAcc <= 1 + 1e-12)], ["Within reach", missing.length ? `no: ${missing.join(" and ")}` : "yes"]];
      }),
    tool("guard_question_value", "Value of adding a guard question",
      "A guard question only blocks rows: it clears a share of the rows the gate automates now, and the gate's accuracy on the rows it clears is typed below. Shows the accuracy of the rows it blocks, the mistakes it avoids and the reviews it adds each month, and whether it pays at the typed costs (a negative cost change is a saving).",
      [share("coverage", "Gate coverage now", { default: 0.8 }), share("accuracy", "Gate accuracy now", { default: 0.94 }), share("keep", "Share of automated rows the guard clears", { default: 0.9 }),
        share("after", "Gate accuracy on the rows it clears", { default: 0.97 }), amount("volume", "Rows per month", { default: 10000 }), usd("review", "Cost of reviewing one row (USD)", { default: 1 }),
        usd("mistake", "Cost of one automated mistake (USD)", { default: 20 })], ({ coverage, accuracy, keep, after, volume, review, mistake }) => {
        const blocked = keep < 1 ? (accuracy - keep * after) / (1 - keep) : null;
        if (blocked !== null && (blocked < -1e-12 || blocked > 1 + 1e-12)) fail(`These rates do not fit together: the rows the guard blocks would need an accuracy of ${blocked.toFixed(3)}.`);
        if (blocked === null && Math.abs(after - accuracy) > 1e-12) fail("A guard that clears every row cannot change the accuracy.");
        const automated = volume * coverage, before = automated * (1 - accuracy), later = automated * keep * (1 - after);
        const avoided = before - later, extra = automated * (1 - keep), change = extra * review - avoided * mistake;
        return [["Coverage after", coverage * keep], ["Accuracy after", after], ["Accuracy of the rows it blocks", blocked === null ? null : Math.min(1, Math.max(0, blocked))],
          ["Automated mistakes per month now", before], ["Automated mistakes per month after", later], ["Mistakes avoided per month", avoided], ["Extra reviews per month", extra],
          ["Reviews per mistake avoided", avoided > 0 ? extra / avoided : null], ["Change in monthly cost (USD)", change], ["Worth adding", change < 0 ? "yes" : "no"]];
      }),
    tool("looser_gate_added_rows", "Accuracy of the rows a looser gate adds",
      "When a looser gate automates more rows than a stricter one, the rows it adds have their own accuracy, usually well below the gate's average: (covB·accB − covA·accA) ÷ (covB − covA). Assumes the looser gate automates every row the stricter one does.",
      [share("covA", "Coverage of the stricter gate", { default: 0.6 }), share("accA", "Accuracy of the stricter gate", { default: 0.97 }), share("covB", "Coverage of the looser gate", { default: 0.75 }),
        share("accB", "Accuracy of the looser gate", { default: 0.95 }), optional(amount("volume", "Rows per month (optional)"))], ({ covA, accA, covB, accB, volume }) => {
        if (covB <= covA) fail("The looser gate must cover more rows than the stricter one.");
        const added = covB - covA, accuracy = (covB * accB - covA * accA) / added;
        if (accuracy < -1e-12 || accuracy > 1 + 1e-12) fail("These rates cannot come from nested gates: the added rows would need an accuracy outside 0 to 1.");
        const clamped = Math.min(1, Math.max(0, accuracy)), monthly = volume !== null;
        return [["Extra coverage", added], ["Accuracy of the rows it adds", clamped], ["Error rate of the rows it adds", 1 - clamped],
          ["Extra automated rows per month", orNull(monthly && volume * added, monthly)], ["Extra automated mistakes per month", orNull(monthly && volume * added * (1 - clamped), monthly)]];
      }),
    tool("overall_with_review", "Overall accuracy of automation plus review",
      "Every row ends with a decision, automated or made by a reviewer, so overall accuracy is coverage × automated accuracy + (1 − coverage) × reviewer accuracy. With a target, the range of coverage that meets it.",
      [share("coverage", "Coverage", { default: 0.7 }), share("automated", "Accuracy of automated rows", { default: 0.95 }), share("reviewer", "Accuracy of reviewed rows", { default: 0.98 }),
        optional(share("target", "Target overall accuracy (optional)"))], ({ coverage, automated, reviewer, target }) => {
        let lowest = null, highest = null;
        if (target !== null) {
          if (automated === reviewer) [lowest, highest] = reviewer >= target ? [0, 1] : [null, null];
          else if (automated > reviewer) [lowest, highest] = automated >= target ? [Math.max(0, (target - reviewer) / (automated - reviewer)), 1] : [null, null];
          else [lowest, highest] = reviewer >= target ? [0, Math.min(1, (reviewer - target) / (reviewer - automated))] : [null, null];
        }
        return [["Overall accuracy", coverage * automated + (1 - coverage) * reviewer], ["Mistakes per 1,000 rows from automation", 1000 * coverage * (1 - automated)],
          ["Mistakes per 1,000 rows from review", 1000 * (1 - coverage) * (1 - reviewer)], ["Lowest coverage meeting the target", lowest], ["Highest coverage meeting the target", highest]];
      }),
    tool("review_load", "Review load of a gate at a volume",
      "The rows a gate sends to people per day, per week, per review day (when rows arrive every day but people review on fewer) and per month (52 weeks ÷ 12).",
      [amount("volume", "Rows per day", { default: 1000 }), share("coverage", "Coverage", { default: 0.8 }), count("arrive", "Days a week rows arrive", { min: 1, max: 7, default: 7 }),
        count("days", "Days a week people review", { min: 1, max: 7, default: 5 })], ({ volume, coverage, arrive, days }) => {
        const daily = volume * (1 - coverage), weekly = daily * arrive;
        return [["Automated rows per day", volume * coverage], ["Rows sent to review per day", daily], ["Rows sent to review per week", weekly], ["Rows per review day", weekly / days],
          ["Rows sent to review per month", weekly * 52 / 12]];
      }),
    tool("review_audit_staffing", "Review and audit staffing for a gate",
      "Reviewer time for both jobs a gate creates: reviewing the rows it does not automate and auditing a random share of the rows it does. A peak factor above 1 staffs for a busier day than average.",
      [amount("volume", "Rows per day", { default: 2000 }), share("coverage", "Coverage", { default: 0.8 }), amount("reviewMinutes", "Minutes per review", { default: 2 }),
        share("audit", "Share of automated rows audited", { default: 0.05 }), amount("auditMinutes", "Minutes per audit", { default: 1 }), HOURS,
        { name: "peak", label: "Peak factor", type: "number", min: 1, max: 100, default: 1 }], ({ volume, coverage, reviewMinutes, audit, auditMinutes, hours, peak }) => {
        const reviewed = volume * (1 - coverage), audited = volume * coverage * audit;
        const minutes = reviewed * reviewMinutes + audited * auditMinutes, work = minutes / 60 * peak, people = work > 0 ? ceilCount(work / hours) : 0;
        return [["Rows reviewed per day", reviewed], ["Rows audited per day", audited], ["Reviewer hours per day", work], ["Reviewers needed", people],
          ["Share of hours spent on audits", minutes > 0 ? audited * auditMinutes / minutes : null], ["Reviewer utilization", people > 0 ? work / (people * hours) : null]];
      }),
    tool("team_capacity", "Volume and coverage a review team supports",
      "Turns a review team into the reviews it clears per day, the highest daily volume it supports at a coverage, and (with an expected volume) the coverage the gate needs so review keeps up.",
      [count("reviewers", "Reviewers", { min: 1, default: 3 }), HOURS, amount("minutes", "Minutes per review", { min: 0.01, default: 2 }), share("coverage", "Coverage", { default: 0.8 }),
        optional(amount("volume", "Expected rows per day (optional)"))], ({ reviewers, hours, minutes, coverage, volume }) => {
        const capacity = reviewers * hours * 60 / minutes;
        return { rows: [["Reviews the team clears per day", capacity], ["Highest daily volume at this coverage", coverage < 1 ? capacity / (1 - coverage) : null],
          ["Coverage needed for the expected volume", volume === null ? null : volume > 0 ? Math.max(0, 1 - capacity / volume) : 0],
          ["Spare reviews per day at the expected volume", volume === null ? null : capacity - volume * (1 - coverage)]],
        note: coverage >= 1 ? "At full coverage nothing goes to review, so review sets no volume limit." : null };
      }),
    tool("monthly_errors", "Expected automated mistakes per month",
      "Automated rows × error rate, with the range a month's count will usually fall in (Poisson 2.5th and 97.5th percentiles), the chance of a month with none and, with a cap, the chance of going over it. The range covers chance alone, not a drift in accuracy.",
      [amount("volume", "Rows per month", { default: 30000 }), share("coverage", "Coverage", { default: 0.8 }), share("accuracy", "Accuracy of automated rows", { default: 0.995 }),
        optional(count("cap", "Mistakes you can accept per month (optional)"))], ({ volume, coverage, accuracy, cap }) => {
        const mean = volume * coverage * (1 - accuracy);
        return [["Automated rows per month", volume * coverage], ["Expected automated mistakes", mean], ["Likely low (2.5th percentile)", poissonQuantile(0.025, mean)],
          ["Likely high (97.5th percentile)", poissonQuantile(0.975, mean)], ["Chance of a month with none", Math.exp(-mean)], ["Chance of more than the cap", cap === null ? null : poissonSf(cap + 1, mean)]];
      }),
    tool("error_alarm", "Alarm level for weekly automated mistakes",
      "The weekly count of automated mistakes (found by audits or complaints) at which to raise an alarm so that a normal week trips it at most at the chosen false alarm rate, and how quickly it fires once the mistake rate rises. Poisson counts.",
      [amount("mean", "Usual mistakes per week", { min: 0.001, default: 4 }), { name: "alpha", label: "False alarm chance per week", type: "select", options: [["0.05", "5%"], ["0.01", "1%"], ["0.001", "0.1%"]] },
        { name: "factor", label: "Rise to catch (times the usual rate)", type: "number", min: 1, max: 1000, default: 2 }], ({ mean, alpha, factor }) => {
        const level = Number(alpha);
        const c = Math.max(1, lowestCount((k) => k >= 1 && (poissonSf(k, mean) ?? 1) <= level, mean));
        const fires = poissonSf(c, mean * factor), chance = poissonSf(c, mean);
        return [["Alarm when a week's mistakes reach", c], ["False alarm chance per week", chance], ["False alarms per year", 52 * chance],
          ["Chance of an alarm in a week after the rise", fires], ["Expected weeks to the first alarm after the rise", fires > 0 ? 1 / fires : null]];
      }),
    tool("staged_rollout", "Automated mistakes during a staged rollout",
      "Expected automated rows and mistakes per stage when a gate is switched on for a growing share of traffic, against switching it on for all traffic from day one. Paste one stage per line: share of traffic, days (a name may come first).",
      [amount("volume", "Rows per day", { default: 1000 }), share("coverage", "Coverage", { default: 0.8 }), share("accuracy", "Accuracy of automated rows", { default: 0.99 }),
        paste("stages", "Stages: share of traffic, days", "0.1, 7\n0.5, 7\n1, 14")], ({ volume, coverage, accuracy, stages }) => {
        let running = 0;
        const list = lines(stages, "stage").map(({ line, cells }, index) => {
          const where = `Line ${index + 1}`, parts = cells.length === 2 ? [`Stage ${index + 1}`, ...cells] : cells;
          if (parts.length !== 3) fail(`${where} ("${short(line)}") needs a share of traffic and a number of days.`);
          const part = rateCell(parts[1], where, "the share of traffic"), days = positiveCell(parts[2], where, "the days");
          const automated = volume * part * days * coverage, mistakes = automated * (1 - accuracy);
          running += mistakes;
          return [parts[0] || `Stage ${index + 1}`, part, days, automated, mistakes, running];
        });
        const days = total(list.map((row) => row[2])), full = volume * days * coverage * (1 - accuracy);
        return { rows: [["Days in all", days], ["Automated rows in all", total(list.map((row) => row[3]))], ["Expected mistakes in all", running],
          ["Mistakes with all traffic from day one", full], ["Mistakes avoided by staging", full - running]],
        table: { columns: ["Stage", "Share of traffic", "Days", "Automated rows", "Expected mistakes", "Mistakes so far"], rows: list } };
      }),
    tool("audit_slip", "Mistakes that slip past an audit before one is caught",
      "When a random share of automated rows is audited and mistakes occur at a rate, how long until an audit finds one, and how many mistakes go out unaudited meanwhile: on average (1 − share) ÷ share before the first is caught, whatever the rate.",
      [amount("volume", "Automated rows per day", { min: 0.001, default: 1000 }), share("audit", "Share audited", { default: 0.02 }), share("rate", "Mistake rate to catch", { default: 0.01 }),
        { name: "chance", label: "Chance wanted", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"], ["0.5", "50%"]] }], ({ volume, audit, rate, chance }) => {
        if (audit <= 0) fail("The share audited must be above 0.");
        if (rate <= 0) fail("The mistake rate must be above 0.");
        const perDay = volume * audit, rows = rate >= 1 ? 1 : ceilCount(Math.log(1 - Number(chance)) / Math.log1p(-rate));
        return [["Audited rows per day", perDay], ["Expected audited rows until a mistake is found", 1 / rate], ["Expected days until a mistake is found", 1 / (rate * perDay)],
          ["Expected mistakes that slip past first", (1 - audit) / audit], ["Audited rows to find one with the chance wanted", rows], ["Days to find one with the chance wanted", rows / perDay],
          ["Unaudited mistakes in those days", rows * (1 - audit) * rate / audit]];
      }),
    tool("audit_share_bound", "Audit share for a mistake-rate bound",
      "The rows to audit, and the share of a month's automated rows that is, so that finding no more than the allowed mistakes shows the automated mistake rate is below the bound at the chosen one-sided confidence (exact binomial: the smallest n with P(X ≤ allowed) at or below 1 − confidence at the bound).",
      [count("volume", "Automated rows per month", { min: 1, default: 20000 }), share("bound", "Mistake-rate bound to show", { default: 0.01 }), ONE_SIDED,
        count("allowed", "Mistakes the audit may find", { default: 0 })], ({ volume, bound, level, allowed }) => {
        if (bound <= 0 || bound >= 1) fail("The bound must be strictly between 0 and 1.");
        const alpha = 1 - Number(level), rows = firstTrue((n) => binomialCdf(allowed, n, bound) <= alpha, allowed + 1);
        return { rows: [["Rows to audit", rows], ["Audit share of a month's automated rows", rows === null ? null : rows / volume],
          ["Unaudited mistakes per month at the bound", rows === null ? null : bound * Math.max(0, volume - rows)]],
        note: rows !== null && rows > volume ? "That is more than a month of automated rows: audit over several months." : null };
      }),
    tool("audit_budget_bound", "Mistake rate an audit budget can rule out",
      "How many automated rows a monthly budget of audit hours covers, and the highest mistake rate still consistent with the mistakes it finds (exact Clopper–Pearson one-sided upper bound), with the unaudited mistakes per month that bound allows.",
      [amount("hours", "Audit hours per month", { default: 10 }), amount("minutes", "Minutes per audited row", { min: 0.01, default: 2 }), count("volume", "Automated rows per month", { min: 1, default: 20000 }),
        count("found", "Mistakes the audit finds", { default: 0 }), ONE_SIDED], ({ hours, minutes, volume, found, level }) => {
        const rows = Math.min(volume, Math.floor(hours * 60 / minutes + 1e-9));
        if (rows < 1) fail("The hours do not cover one audited row.");
        if (found > rows) fail("The mistakes found cannot be more than the rows audited.");
        const bound = found >= rows ? 1 : betaQuantile(Number(level), found + 1, rows - found);
        return [["Rows audited per month", rows], ["Audit share", rows / volume], ["Upper bound on the mistake rate", bound], ["Upper bound on unaudited mistakes per month", bound * (volume - rows)]];
      }),
    tool("review_hours_by_threshold", "Review hours at each threshold",
      "From a pasted list of confidences (no labels needed), the coverage, reviews, reviewer hours and reviewers per day at every distinct threshold, highest first, assuming new traffic looks like the paste. A confidence equal to the threshold clears it. Separate confidences with commas, spaces, semicolons or new lines.",
      [paste("confidences", "Confidences", "0.97, 0.62, 0.88, 0.91"), amount("volume", "Rows per day", { default: 1000 }), amount("minutes", "Minutes per review", { default: 2 }), HOURS],
      ({ confidences, volume, minutes, hours }) => {
        const values = String(confidences).split(/[\s,;]+/).filter(Boolean).map((cell, index) => {
          const value = toNumber(cell);
          if (value === null || value < 0 || value > 1) fail(`Confidence ${index + 1} ("${short(cell)}") must be a number from 0 to 1.`);
          return value;
        });
        if (!values.length) fail("Paste at least one confidence.");
        if (values.length > 100000) fail("Paste at most 100,000 confidences.");
        const sorted = [...values].sort((a, b) => b - a), out = [];
        sorted.forEach((value, index) => {
          if (index + 1 < sorted.length && sorted[index + 1] === value) return;
          const coverage = (index + 1) / sorted.length, reviews = volume * (1 - coverage), work = reviews * minutes / 60;
          out.push([value, coverage, reviews, work, work > 0 ? ceilCount(work / hours) : 0]);
        });
        return { table: { columns: ["Threshold (confidence ≥)", "Coverage", "Reviews per day", "Reviewer hours per day", "Reviewers"], rows: out } };
      }),
    tool("segment_mix", "Gate coverage and accuracy across traffic segments",
      "A gate's overall coverage and accuracy are a mix of its segments' (by channel, language or customer type), weighted by each segment's share of traffic. Shows each segment's share of automated rows and of automated mistakes and, with a fifth column of new shares, the gate after the traffic mix shifts. Paste one segment per line: name, share of traffic, coverage, accuracy[, new share]; each share column must add up to 1.",
      [paste("segments", "Segments: name, share, coverage, accuracy[, new share]", "web, 0.6, 0.85, 0.97, 0.4\nphone, 0.4, 0.6, 0.92, 0.6")], ({ segments }) => {
        const list = lines(segments, "segment").map(({ line, cells }, index) => {
          const where = `Line ${index + 1}`;
          if (cells.length !== 4 && cells.length !== 5) fail(`${where} ("${short(line)}") needs a name, a share of traffic, a coverage, an accuracy and optionally a new share.`);
          return { name: cells[0] || `Segment ${index + 1}`, share: rateCell(cells[1], where, "the share"), coverage: rateCell(cells[2], where, "the coverage"),
            accuracy: rateCell(cells[3], where, "the accuracy"), next: cells.length === 5 ? rateCell(cells[4], where, "the new share") : null };
        });
        const shifted = list.filter((s) => s.next !== null).length;
        if (shifted && shifted !== list.length) fail("Give a new share on every line or on none.");
        const mix = (weight) => {
          if (Math.abs(total(list.map(weight)) - 1) > 1e-6) fail("The shares of traffic must add up to 1.");
          const coverage = total(list.map((s) => weight(s) * s.coverage)), mistakes = total(list.map((s) => weight(s) * s.coverage * (1 - s.accuracy)));
          return { coverage, mistakes, accuracy: coverage > 0 ? 1 - mistakes / coverage : null };
        };
        const now = mix((s) => s.share), later = shifted ? mix((s) => s.next) : null;
        return { rows: [["Overall coverage", now.coverage], ["Overall accuracy", now.accuracy], ["Coverage after the shift", later && later.coverage], ["Accuracy after the shift", later && later.accuracy]],
          table: { columns: ["Segment", "Share", "Coverage", "Accuracy", "Share of automated rows", "Share of automated mistakes"],
            rows: list.map((s) => [s.name, s.share, s.coverage, s.accuracy, now.coverage > 0 ? s.share * s.coverage / now.coverage : null,
              now.mistakes > 0 ? s.share * s.coverage * (1 - s.accuracy) / now.mistakes : null]) } };
      }),
    tool("review_bands_capacity", "Bands to review with limited capacity",
      "With more borderline rows than people can review, review the bands whose automated accuracy is lowest first (the most mistakes avoided per review) until the capacity runs out, the last band in part. Lists the bands in that order. Paste one band per line: name, rows per day, accuracy if automated.",
      [paste("bands", "Bands: name, rows per day, accuracy if automated", "0.5-0.6, 120, 0.7\n0.6-0.7, 200, 0.82\n0.7-0.8, 300, 0.9"), amount("capacity", "Rows people can review per day", { default: 250 })],
      ({ bands, capacity }) => {
        const list = lines(bands, "band").map(({ line, cells }, index) => {
          const where = `Line ${index + 1}`;
          if (cells.length !== 3) fail(`${where} ("${short(line)}") needs a name, rows per day and an accuracy.`);
          return { index, name: cells[0] || `Band ${index + 1}`, rows: positiveCell(cells[1], where, "the rows per day"), accuracy: rateCell(cells[2], where, "the accuracy") };
        }).sort((a, b) => a.accuracy - b.accuracy || a.index - b.index);
        let left = capacity;
        const out = list.map((band) => {
          const reviewed = Math.min(band.rows, left);
          left -= reviewed;
          return [band.name, band.rows, band.accuracy, reviewed, band.rows - reviewed, (band.rows - reviewed) * (1 - band.accuracy)];
        });
        const reviewed = total(out.map((row) => row[3])), automated = total(out.map((row) => row[4])), mistakes = total(out.map((row) => row[5]));
        return { rows: [["Rows reviewed per day", reviewed], ["Rows automated per day", automated], ["Mistakes automated per day", mistakes],
          ["Mistakes avoided per day", total(list.map((band) => band.rows * (1 - band.accuracy))) - mistakes], ["Accuracy of automated rows", automated > 0 ? 1 - mistakes / automated : null]],
        table: { columns: ["Band", "Rows per day", "Accuracy if automated", "Rows reviewed", "Rows automated", "Mistakes automated per day"], rows: out } };
      }),
    tool("approve_reject", "Gate with automatic approve and reject sides",
      "Some gates act on both sides: confident approvals and confident rejections are automated and the rest go to review. Wrong approvals and wrong rejections usually cost differently, so each is counted and priced on its own.",
      [count("volume", "Rows per month", { min: 1, default: 10000 }), share("approved", "Share auto-approved", { default: 0.5 }), share("approveAccuracy", "Accuracy of approvals", { default: 0.98 }),
        share("rejected", "Share auto-rejected", { default: 0.2 }), share("rejectAccuracy", "Accuracy of rejections", { default: 0.95 }), usd("wrongApprove", "Cost of a wrong approval (USD)", { default: 50 }),
        usd("wrongReject", "Cost of a wrong rejection (USD)", { default: 10 }), usd("review", "Cost of reviewing one row (USD)", { default: 1 })],
      ({ volume, approved, approveAccuracy, rejected, rejectAccuracy, wrongApprove, wrongReject, review }) => {
        if (approved + rejected > 1 + 1e-12) fail("The approved and rejected shares cannot add up to more than 1.");
        const coverage = approved + rejected, badApprovals = volume * approved * (1 - approveAccuracy), badRejections = volume * rejected * (1 - rejectAccuracy);
        const reviews = volume * Math.max(0, 1 - coverage), cost = badApprovals * wrongApprove + badRejections * wrongReject + reviews * review;
        return [["Coverage", coverage], ["Accuracy of automated rows", coverage > 0 ? (approved * approveAccuracy + rejected * rejectAccuracy) / coverage : null],
          ["Wrong approvals per month", badApprovals], ["Wrong rejections per month", badRejections], ["Reviews per month", reviews], ["Monthly cost (USD)", cost], ["Cost per row (USD)", cost / volume]];
      }),
    tool("worst_error_day", "Worst day of automated mistakes in a period",
      "Daily mistake counts vary by chance alone, so the worst day of a month is well above the average day. Gives the typical and the bad (95th percentile) worst day over the period and, with a daily cap, the chance some day goes over it and the days over it to expect. Independent Poisson days.",
      [amount("mean", "Expected automated mistakes per day", { default: 3 }), count("days", "Days", { min: 1, max: 3660, default: 30 }), optional(count("cap", "Mistakes you can accept in a day (optional)"))],
      ({ mean, days, cap }) => {
        const worst = (q) => lowestCount((k) => Math.exp(days * Math.log(cdfOf(k, mean))) >= q, mean);
        const over = cap === null ? null : poissonSf(cap + 1, mean);
        return [["Typical worst day (median)", worst(0.5)], ["Bad worst day (95th percentile)", worst(0.95)], ["Chance some day goes over the cap", over === null ? null : 0 - Math.expm1(days * Math.log1p(-over))],
          ["Days over the cap to expect", over === null ? null : days * over]];
      }),
    tool("most_questions", "Most questions a gate can hold",
      `Each question added to an AND gate multiplies in its coverage and accuracy, so a gate can hold only so many before it falls below the coverage and accuracy you accept. ${INDEPENDENT} Lists the gate at each size up to one past the limit (at most 20).`,
      [share("coverage", "Typical coverage of one question", { default: 0.9 }), share("accuracy", "Typical accuracy of one question", { default: 0.98 }), share("minCoverage", "Lowest gate coverage you accept", { default: 0.5 }),
        share("minAccuracy", "Lowest gate accuracy you accept", { default: 0.9 })], ({ coverage, accuracy, minCoverage, minAccuracy }) => {
        const okCoverage = (k) => coverage ** k >= minCoverage - 1e-12, okAccuracy = (k) => accuracy ** k >= minAccuracy - 1e-12;
        let k = 0;
        while (k < 1000 && okCoverage(k + 1) && okAccuracy(k + 1)) k++;
        const limited = k >= 1000 ? null : [okCoverage(k + 1) ? null : "coverage", okAccuracy(k + 1) ? null : "accuracy"].filter(Boolean).join(" and ");
        const shown = Math.min(20, Math.max(k + 1, 1));
        return { rows: [["Most questions", k >= 1000 ? null : k], ["Limited by", limited], ["Gate coverage at that many", k >= 1000 ? null : coverage ** k], ["Gate accuracy at that many", k >= 1000 ? null : accuracy ** k]],
          table: { columns: ["Questions", "Gate coverage", "Gate accuracy", "Meets both"], rows: Array.from({ length: shown }, (_, i) => [i + 1, coverage ** (i + 1), accuracy ** (i + 1), okCoverage(i + 1) && okAccuracy(i + 1) ? "yes" : "no"]) },
          note: k >= 1000 ? "No limit within 1,000 questions." : null };
      }),
    tool("agreement_gate", "Gate on two answers agreeing",
      "Automate only when two independent answers to the same question agree (two wordings or two models) and review the rest. Assumes the answers err independently and a wrong answer picks any of the other options equally often, so they agree on a wrong option with chance (1 − a₁)(1 − a₂) ÷ (options − 1).",
      [share("first", "Accuracy of the first answer", { default: 0.9 }), share("second", "Accuracy of the second answer", { default: 0.88 }), count("options", "Options the question has", { min: 2, max: 10000, default: 4 })],
      ({ first, second, options }) => {
        const right = first * second, wrong = (1 - first) * (1 - second) / (options - 1), coverage = right + wrong, better = Math.max(first, second);
        return [["Coverage (they agree)", coverage], ["Accuracy when they agree", coverage > 0 ? right / coverage : null], ["Mistakes per 1,000 rows (agreement gate)", 1000 * wrong],
          ["Mistakes per 1,000 rows (better answer alone)", 1000 * (1 - better)], ["Better answer's accuracy alone", better]];
      }),
    tool("review_growth_months", "Months until review outgrows the team",
      "With traffic growing by a steady share each month and coverage unchanged, how long until the rows sent to review pass what the team clears per day, and the coverage that would keep up a year from now.",
      [amount("volume", "Rows per day now", { default: 1000 }), { name: "growth", label: "Growth per month (share, e.g. 0.05)", type: "number", min: 0, max: 10, default: 0.05 },
        share("coverage", "Coverage", { default: 0.8 }), amount("capacity", "Rows the team reviews per day", { default: 300 })], ({ volume, growth, coverage, capacity }) => {
        const now = volume * (1 - coverage), later = volume * (1 + growth) ** 12;
        const months = now > capacity ? 0 : now === 0 || growth === 0 ? null : Math.log(capacity / now) / Math.log1p(growth);
        return { rows: [["Rows sent to review per day now", now], ["Months until it passes capacity", months], ["Rows per day in 12 months", later],
          ["Coverage needed in 12 months", later > 0 ? Math.max(0, 1 - capacity / later) : 0]],
        note: months === 0 ? "Review is already at or over capacity." : months === null ? "Review never passes capacity at this growth." : null };
      }),
    tool("improve_first", "Which question to improve first",
      `For an AND gate, the gate's coverage and accuracy if one question's coverage, or its accuracy, rises by the step (capped at 1), question by question, and which question gives the most. Raising the weakest question helps most. ${INDEPENDENT} Paste one question per line: name, coverage, accuracy.`,
      [QUESTIONS, { name: "step", label: "Improvement to try (e.g. 0.02)", type: "number", min: 0.0001, max: 1, default: 0.02 }], ({ questions, step }) => {
        const list = questionList(questions), cov = list.map((q) => q.coverage), acc = list.map((q) => q.accuracy);
        const coverage = product(cov), accuracy = product(acc);
        const out = list.map((q, i) => [q.name, q.coverage, q.accuracy, productWithout(cov, i) * Math.min(1, q.coverage + step), productWithout(acc, i) * Math.min(1, q.accuracy + step)]);
        const best = (column, now) => {
          let pick = null;
          out.forEach((row) => { if (row[column] > now + 1e-15 && (pick === null || row[column] > pick[column] + 1e-15)) pick = row; });
          return pick && pick[0];
        };
        return { rows: [["Gate coverage now", coverage], ["Gate accuracy now", accuracy], ["Best coverage gain from", best(3, coverage)], ["Best accuracy gain from", best(4, accuracy)]],
          table: { columns: ["Question", "Coverage", "Accuracy", "Gate coverage if its coverage improves", "Gate accuracy if its accuracy improves"], rows: out } };
      }),
  ],
});
