// Toolbox: time, rate limits, review queues and probabilities ("workbench.toolbox", groups "Time and rate limits" and
// "Probabilities and odds"). Every tool is a pure function of what is typed into its form; nothing reads page data,
// and nothing calls the model.
import { definePack, toNumber } from "../../kit.js";
import { poissonSf } from "../../lib/math.js";

const TIME = "Time and rate limits";
const ODDS = "Probabilities and odds";
const EPS = 1e-9;

const NUM = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, ...extra });
const COUNT = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, ...extra });
const SHARE = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const CAP = { name: "cap", label: "Live calls allowed per minute", type: "integer", min: 1, default: 120 };
const LATENCY = { name: "latency", label: "Latency per call (ms)", type: "number", min: 1, default: 600 };
const PROBS = (label, placeholder) => ({ name: "probs", label, type: "textarea", rows: 5, required: true, placeholder });

const need = (condition, message) => { if (!condition) throw new Error(message); };
const ceilSafe = (x) => Math.ceil(x - EPS);
const odds = (p) => p / (1 - p);
const fromOdds = (o) => o / (1 + o);
const open = (p, label) => need(p > 0 && p < 1, `${label} must be between 0 and 1, not equal to either.`);

// A duration in seconds as "1 h 30 min", "8 min 20 s", "45 s" or "250 ms".
function readable(seconds) {
  if (seconds > 0 && seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  let rest = Math.round(seconds);
  const hours = Math.floor(rest / 3600); rest -= hours * 3600;
  const minutes = Math.floor(rest / 60); rest -= minutes * 60;
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : "", rest ? `${rest} s` : ""].filter(Boolean).join(" ") || "0 s";
}

// Numbers separated by commas, semicolons, spaces or new lines, each checked by ok.
function numbers(text, what, ok = () => true, rule = "") {
  const parts = String(text ?? "").split(/[\s,;]+/).filter(Boolean);
  need(parts.length > 0, `Type at least one ${what}.`);
  need(parts.length <= 10000, `Type at most 10,000 values.`);
  return parts.map((part, index) => {
    const value = toNumber(part);
    need(value !== null && ok(value), `Value ${index + 1} (${part}) is not ${rule || `a ${what}`}.`);
    return value;
  });
}
const probabilityList = (text) => numbers(text, "probability", (p) => p >= 0 && p <= 1, "a probability between 0 and 1");

// Lines of "a, b, c" (tab, semicolon or comma separated); blank lines and lines starting with # are skipped.
function records(text, fields, what) {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(/\s*[\t;,]\s*/);
    need(cells.length === fields.length, `Line ${index + 1}: expected ${fields.length} values (${fields.join(", ")}), found ${cells.length}.`);
    need(cells[0] !== "", `Line ${index + 1}: the ${fields[0]} is missing.`);
    out.push({ line: index + 1, cells });
  });
  need(out.length > 0, `Type at least one ${what}.`);
  return out;
}
function cellNumber(cell, line, label, ok = (x) => x >= 0, rule = "at least 0") {
  const value = toNumber(cell);
  need(value !== null && ok(value), `Line ${line}: ${label} must be a number ${rule}.`);
  return value;
}

// M/M/c with arrivals lam and service mu per server, from the stable Erlang B recursion b(k) = a·b(k−1) / (k + a·b(k−1)):
// the Erlang C chance of waiting, the average wait wq and the average time in the system w (hours). null when unstable.
const erlangB = (a, k, previous) => a * previous / (k + a * previous);
function queueAt(lam, mu, c, b) {
  const a = lam / mu;
  if (a >= c) return null;
  const wait = c * b / (c - a * (1 - b));
  const wq = wait / (c * mu - lam);
  return { rho: a / c, wait, wq, w: wq + 1 / mu };
}
function erlang(lam, mu, c) {
  let b = 1;
  for (let k = 1; k <= c; k++) b = erlangB(lam / mu, k, b);
  return queueAt(lam, mu, c, b);
}

// ---------- exact fractions for probability formats ----------

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
function decimal(text) {
  const match = /^(\d*)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[1] === "" && match[2] === undefined) || (match[2] || "").length > 15 || match[1].length > 15) return null;
  const places = (match[2] || "").length;
  return { n: BigInt((match[1] || "0") + (match[2] || "")), d: 10n ** BigInt(places) };
}
const quotient = (a, b) => ({ n: a.n * b.d, d: a.d * b.n });

function parseProbability(raw) {
  const text = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  let fraction = null, match;
  if ((match = /^(\S+) ?%$/.exec(text))) {
    const value = decimal(match[1]);
    if (value) fraction = { n: value.n, d: value.d * 100n };
  } else if ((match = /^(\S+) ?(?::|to) ?(\S+)$/.exec(text))) {
    const a = decimal(match[1]), b = decimal(match[2]);
    if (a && b) fraction = quotient(a, { n: a.n * b.d + b.n * a.d, d: a.d * b.d });
  } else if ((match = /^(\S+) ?(?:\/|in) ?(\S+)$/.exec(text))) {
    const a = decimal(match[1]), b = decimal(match[2]);
    if (a && b) fraction = quotient(a, b);
  } else fraction = decimal(text);
  need(fraction !== null, "Type a probability as 0.25, 25%, 1/4, 1 in 4 or odds such as 1:3 or 1 to 3.");
  need(fraction.d !== 0n, "The second number must be above 0.");
  need(fraction.n <= fraction.d, "A probability cannot be above 1 (100%).");
  const divisor = gcd(fraction.n, fraction.d) || 1n;
  return { n: fraction.n / divisor, d: fraction.d / divisor };
}

export default definePack({
  id: "tb-rates-odds",
  surface: "workbench.toolbox",
  title: "Rate, queue and probability tools",
  about: "Calculators for throughput under the rate cap, retries, backoff, latency percentiles and review queues, and for updating, combining and converting probabilities and odds. They compute from what you type only and never call the model.",
  features: [
    // ---------- Time and rate limits ----------
    { id: "throughput_cap", kind: "tool", group: TIME, title: "Throughput with concurrency and a rate cap",
      help: "Calls finish at the smaller of calls in flight ÷ latency and the per-minute cap. Shows which one binds, how much of the cap is used and how many calls in flight reach the cap.",
      inputs: [COUNT("parallel", "Calls in flight at once", { min: 1, default: 8 }), LATENCY, CAP],
      compute: ({ parallel, latency, cap }) => {
        const byLatency = parallel * 60000 / latency, rate = Math.min(byLatency, cap);
        return [["Limited by", cap <= byLatency ? "the rate cap" : "latency and calls in flight"], ["Calls per minute", rate], ["Calls per hour", rate * 60],
          ["Share of the rate cap used", rate / cap], ["Calls in flight where the cap starts to bind", cap * latency / 60000]];
      } },
    { id: "concurrency_needed", kind: "tool", group: TIME, title: "Calls in flight for a target throughput",
      help: "How many calls must be in flight to finish a target number per minute at a latency, and whether the calls in flight you have (Bulk keeps eight) and the rate cap allow it.",
      inputs: [NUM("target", "Target calls per minute", { min: 0.001 }), LATENCY, COUNT("available", "Calls in flight available", { min: 1, default: 8 }), CAP],
      compute: ({ target, latency, available, cap }) => {
        const needed = ceilSafe(target * latency / 60000);
        return [["Calls in flight needed", needed], ["Reachable with the calls in flight available", needed <= available ? "yes" : "no"],
          ["Within the rate cap", target <= cap + EPS ? "yes" : "no"], ["Highest calls per minute possible", Math.min(available * 60000 / latency, cap)]];
      } },
    { id: "review_queue", kind: "tool", group: TIME, title: "Review queue wait (M/M/1 or M/M/c)",
      help: "Rows sent to review arrive at random at an average rate and each reviewer clears them at an average rate (exponential times). Gives the chance a row waits, the average wait and the queue length; with one reviewer this is M/M/1.",
      inputs: [NUM("arrivals", "Rows sent to review per hour", { min: 0.000001 }), NUM("service", "Rows one reviewer clears per hour", { min: 0.000001 }),
        COUNT("reviewers", "Reviewers", { min: 1, max: 10000, default: 1 })],
      compute: ({ arrivals, service, reviewers }) => {
        const q = erlang(arrivals, service, reviewers);
        if (!q) return { rows: [["Utilization per reviewer", arrivals / (service * reviewers)], ["Chance a row waits", null], ["Average wait before review (minutes)", null],
          ["Average time until reviewed (minutes)", null], ["Average rows waiting", null], ["Average rows in review or waiting", null]],
        note: "Rows arrive as fast as reviewers clear them or faster, so the queue grows without limit." };
        return [["Utilization per reviewer", q.rho], ["Chance a row waits", q.wait], ["Average wait before review (minutes)", q.wq * 60], ["Average time until reviewed (minutes)", q.w * 60],
          ["Average rows waiting", arrivals * q.wq], ["Average rows in review or waiting", arrivals * q.w]];
      } },
    { id: "reviewers_for_wait", kind: "tool", group: TIME, title: "Reviewers needed for a target wait",
      help: "The fewest reviewers that keep the average wait before review at or under a target, with random arrivals and review times (M/M/c).",
      inputs: [NUM("arrivals", "Rows sent to review per hour", { min: 0.000001 }), NUM("service", "Rows one reviewer clears per hour", { min: 0.000001 }),
        NUM("target", "Longest acceptable average wait (minutes)", { min: 0.000001 })],
      compute: ({ arrivals, service, target }) => {
        let b = 1;
        for (let c = 1; c <= 100000; c++) {
          b = erlangB(arrivals / service, c, b);
          const q = queueAt(arrivals, service, c, b);
          if (q && q.wq * 60 <= target + EPS) return [["Reviewers needed", c], ["Average wait with them (minutes)", q.wq * 60], ["Utilization per reviewer", q.rho], ["Chance a row waits", q.wait]];
        }
        throw new Error("More than 100,000 reviewers would be needed.");
      } },
    { id: "attempts_for_target", kind: "tool", group: TIME, title: "Attempts needed at a failure rate",
      help: "With independent failures, how many attempts a row needs for its chance of succeeding at least once to reach a target.",
      inputs: [SHARE("failure", "Chance one attempt fails"), SHARE("target", "Target chance of success")],
      compute: ({ failure, target }) => {
        open(failure, "The failure chance"); open(target, "The target");
        const attempts = Math.max(1, ceilSafe(Math.log(1 - target) / Math.log(failure)));
        return [["Attempts needed", attempts], ["Retries after the first", attempts - 1], ["Chance of success within them", 1 - Math.pow(failure, attempts)],
          ["Average attempts until success, with no limit", 1 / (1 - failure)]];
      } },
    { id: "calls_with_retries", kind: "tool", group: TIME, title: "Calls and leftover failures with retries",
      help: "How many calls a run makes when each failed row is retried up to a limit, and how many rows are still failing after the last attempt. Failures are assumed independent.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), SHARE("failure", "Chance one attempt fails"), COUNT("attempts", "Attempts per row at most", { min: 1, max: 100, default: 3 })],
      compute: ({ rows, failure, attempts }) => {
        need(failure < 1, "With every attempt failing, no row ever succeeds.");
        const calls = rows * (1 - Math.pow(failure, attempts)) / (1 - failure);
        return [["Expected calls", calls], ["Expected retries", calls - rows], ["Expected rows still failing", rows * Math.pow(failure, attempts)], ["Extra calls as a share of rows", calls / rows - 1]];
      } },
    { id: "backoff_schedule", kind: "tool", group: TIME, title: "Exponential backoff schedule",
      help: "The wait before each retry when the wait starts at a base and is multiplied by a factor each time, optionally capped, and the total time spent waiting.",
      inputs: [NUM("base", "First wait (ms)", { min: 1, default: 500 }), NUM("factor", "Multiply each wait by", { min: 1, default: 2 }),
        COUNT("retries", "Retries", { min: 1, max: 30, default: 5 }), NUM("cap", "Longest wait (ms, optional)", { min: 1, optional: true })],
      compute: ({ base, factor, retries, cap }) => {
        let total = 0, longest = 0;
        const rows = [];
        for (let retry = 1; retry <= retries; retry++) {
          const wait = Math.min(base * Math.pow(factor, retry - 1), cap === null ? Infinity : cap);
          total += wait; longest = Math.max(longest, wait);
          rows.push([retry, wait, total]);
        }
        return { rows: [["Total wait (ms)", total], ["Longest single wait (ms)", longest], ["Total wait", readable(total / 1000)]],
          table: { columns: ["Retry", "Wait before it (ms)", "Waited in total (ms)"], rows } };
      } },
    { id: "littles_law", kind: "tool", group: TIME, title: "Little's law: in flight, rate and time",
      help: "Items in a system on average = arrival rate × time each spends there, for calls in flight, rows in a review queue or anything steady. Fill exactly two to get the third.",
      inputs: [NUM("inSystem", "Items in the system on average", { optional: true }), NUM("rate", "Arrivals per second", { optional: true }),
        NUM("time", "Time each spends in the system (seconds)", { optional: true })],
      compute: ({ inSystem, rate, time }) => {
        const given = [inSystem, rate, time].filter((value) => value !== null).length;
        need(given === 2, "Fill exactly two of the three values.");
        if (inSystem === null) return [["Items in the system on average", rate * time], ["Arrivals per second", rate], ["Time in the system (seconds)", time]];
        if (rate === null) { need(time > 0, "The time must be above 0."); return [["Items in the system on average", inSystem], ["Arrivals per second", inSystem / time], ["Time in the system (seconds)", time]]; }
        need(rate > 0, "The arrival rate must be above 0.");
        return [["Items in the system on average", inSystem], ["Arrivals per second", rate], ["Time in the system (seconds)", inSystem / rate]];
      } },
    { id: "latency_percentiles", kind: "tool", group: TIME, title: "Latency percentiles from timings",
      help: "Paste call latencies in milliseconds (from Inspect JSON or a run's results) for their mean, nearest-rank percentiles and slowest call, and the share slower than a timeout.",
      inputs: [{ name: "values", label: "Latencies (ms)", type: "textarea", rows: 5, required: true, placeholder: "420\n610\n530" }, NUM("timeout", "Timeout (ms, optional)", { optional: true })],
      compute: ({ values, timeout }) => {
        const sorted = numbers(values, "latency", (x) => x >= 0, "a latency of 0 ms or more").sort((a, b) => a - b), n = sorted.length;
        const rank = (q) => sorted[Math.max(1, ceilSafe(q * n)) - 1];
        return { rows: [["Calls", n], ["Mean (ms)", sorted.reduce((sum, x) => sum + x, 0) / n], ["50th percentile (ms)", rank(0.5)], ["90th percentile (ms)", rank(0.9)],
          ["95th percentile (ms)", rank(0.95)], ["99th percentile (ms)", rank(0.99)], ["Slowest (ms)", sorted[n - 1]],
          ["Share slower than the timeout", timeout === null ? null : sorted.filter((x) => x > timeout).length / n]], note: "Nearest-rank percentiles: each is one of the typed latencies." };
      } },
    { id: "backlog_clearance", kind: "tool", group: TIME, title: "Time to clear a review backlog",
      help: "How long a backlog of rows waiting for review takes to clear while new rows keep arriving, at the team's combined review rate.",
      inputs: [COUNT("backlog", "Rows waiting now"), NUM("arrivals", "New rows per hour"), NUM("capacity", "Rows the team reviews per hour", { min: 0.000001 })],
      compute: ({ backlog, arrivals, capacity }) => {
        const net = capacity - arrivals;
        if (backlog > 0 && net <= 0) return { rows: [["Net rows cleared per hour", net], ["Hours to clear", null], ["Duration", null]], note: "New rows arrive as fast as the team reviews them or faster, so the backlog never clears." };
        const hours = backlog === 0 ? 0 : backlog / net;
        return [["Net rows cleared per hour", net], ["Hours to clear", hours], ["Duration", readable(hours * 3600)]];
      } },
    { id: "cap_overflow", kind: "tool", group: TIME, title: "Chance a minute's calls pass the rate cap",
      help: "With calls arriving at random (Poisson) at an average rate, the chance a minute brings more calls than the cap and how many calls go over it on average. The server's window slides, so treat whole minutes as a guide.",
      inputs: [NUM("mean", "Average calls per minute"), COUNT("cap", "Live calls allowed per minute", { default: 120 })],
      compute: ({ mean, cap }) => {
        const atLeastCap = poissonSf(cap, mean), over = poissonSf(cap + 1, mean);
        const excess = Math.max(0, mean * atLeastCap - cap * over);
        return [["Chance a minute stays within the cap", 1 - over], ["Chance a minute goes over the cap", over], ["Average calls over the cap per minute", excess],
          ["Share of calls over the cap", mean > 0 ? excess / mean : null]];
      } },
    { id: "rate_converter", kind: "tool", group: TIME, title: "Convert a rate",
      help: "A rate of calls or rows per second, minute, hour or day in the other units, and the time between events.",
      inputs: [NUM("value", "Rate"), { name: "unit", label: "Per", type: "select", options: [["s", "second"], ["min", "minute"], ["h", "hour"], ["day", "day"]], default: "min" }],
      compute: ({ value, unit }) => {
        const perSecond = value / { s: 1, min: 60, h: 3600, day: 86400 }[unit];
        return [["Per second", perSecond], ["Per minute", perSecond * 60], ["Per hour", perSecond * 3600], ["Per day", perSecond * 86400], ["Seconds between events", perSecond > 0 ? 1 / perSecond : null]];
      } },
    { id: "merged_latency", kind: "tool", group: TIME, title: "Latency of separate calls against one merged call",
      help: "Paste the latencies of separate calls (one question set each) and type the latency of one merged call that asks them all, to compare waiting for them one after another, all at once, or merged.",
      inputs: [{ name: "values", label: "Latencies of the separate calls (ms)", type: "textarea", rows: 4, required: true, placeholder: "400, 600, 500" }, NUM("merged", "Latency of the merged call (ms)")],
      compute: ({ values, merged }) => {
        const each = numbers(values, "latency", (x) => x >= 0, "a latency of 0 ms or more");
        const sequential = each.reduce((sum, x) => sum + x, 0), parallel = Math.max(...each);
        return [["Separate calls one after another (ms)", sequential], ["Separate calls all at once (ms)", parallel], ["Merged call (ms)", merged],
          ["Saved by merging against one after another (ms)", sequential - merged], ["Saved by merging against all at once (ms)", parallel - merged]];
      } },

    // ---------- Probabilities and odds ----------
    { id: "bayes_lr", kind: "tool", group: ODDS, title: "Update a prior with a likelihood ratio",
      help: "Bayes' rule in odds form: posterior odds = prior odds × likelihood ratio. Also gives the evidence in log-odds and in bits.",
      inputs: [SHARE("prior", "Prior probability"), NUM("ratio", "Likelihood ratio", { min: 0.000000001 })],
      compute: ({ prior, ratio }) => {
        open(prior, "The prior");
        const posterior = odds(prior) * ratio;
        return [["Prior odds", odds(prior)], ["Posterior odds", posterior], ["Posterior probability", fromOdds(posterior)], ["Change in log-odds", Math.log(ratio)], ["Evidence in bits", Math.log2(ratio)]];
      } },
    { id: "lr_needed", kind: "tool", group: ODDS, title: "Evidence needed to reach a target probability",
      help: "The likelihood ratio that moves a prior to a target probability, and how many independent signals of a given strength that takes.",
      inputs: [SHARE("prior", "Prior probability"), SHARE("target", "Target probability"), NUM("each", "Likelihood ratio of one signal (optional)", { min: 0.000000001, optional: true })],
      compute: ({ prior, target, each }) => {
        open(prior, "The prior"); open(target, "The target");
        const ratio = odds(target) / odds(prior);
        const steps = each === null || each === 1 ? null : Math.log(ratio) / Math.log(each);
        return [["Likelihood ratio needed", ratio], ["Evidence in bits", Math.log2(ratio)],
          ["Signals of that strength needed", each === null ? null : Math.abs(Math.log(ratio)) < EPS ? 0 : steps !== null && steps > 0 ? ceilSafe(steps) : null]];
      } },
    { id: "test_posterior", kind: "tool", group: ODDS, title: "Chance a flag is right from sensitivity, specificity and base rate",
      help: "From how often a check flags true cases (sensitivity), clears false ones (specificity) and how common true cases are, the chance a flagged row is a true case and a cleared row is not.",
      inputs: [SHARE("sensitivity", "Sensitivity (true cases flagged)"), SHARE("specificity", "Specificity (other cases cleared)"), SHARE("base", "Base rate of true cases")],
      compute: ({ sensitivity, specificity, base }) => {
        const flagged = sensitivity * base + (1 - specificity) * (1 - base);
        return [["Share of rows flagged", flagged], ["Chance a flagged row is a true case", flagged > 0 ? sensitivity * base / flagged : null],
          ["Chance a cleared row is not a true case", flagged < 1 ? specificity * (1 - base) / (1 - flagged) : null],
          ["Positive likelihood ratio", specificity < 1 ? sensitivity / (1 - specificity) : null], ["Negative likelihood ratio", specificity > 0 ? (1 - sensitivity) / specificity : null]];
      } },
    { id: "prior_shift", kind: "tool", group: ODDS, title: "Move a probability to a new base rate",
      help: "A calibrated probability from rows where a case had one base rate, adjusted to traffic where it has another: the odds are multiplied by the change in base-rate odds.",
      inputs: [SHARE("p", "Probability"), SHARE("from", "Base rate where it was calibrated"), SHARE("to", "Base rate now")],
      compute: ({ p, from, to }) => {
        open(from, "The old base rate"); open(to, "The new base rate");
        const factor = odds(to) / odds(from);
        return [["Odds multiplier", factor], ["Probability at the new base rate", p * factor / (p * factor + 1 - p)]];
      } },
    { id: "noisy_or_and", kind: "tool", group: ODDS, title: "Noisy-OR and noisy-AND of independent signals",
      help: "For independent signals, each firing with its own probability: the chance at least one fires (noisy-OR, with an optional leak for causes not listed), none fire, or all fire (noisy-AND).",
      inputs: [PROBS("Signal probabilities", "0.5\n0.2\n0.1"), SHARE("leak", "Leak: chance it fires with no listed cause", { default: 0 })],
      compute: ({ probs, leak }) => {
        const values = probabilityList(probs);
        const none = (1 - leak) * values.reduce((product, p) => product * (1 - p), 1);
        return [["At least one fires (noisy-OR)", 1 - none], ["None fire", none], ["All fire (noisy-AND)", values.reduce((product, p) => product * p, 1)], ["Strongest single signal", Math.max(...values)]];
      } },
    { id: "k_of_n", kind: "tool", group: ODDS, title: "Chance that at least k of n independent gates pass",
      help: "Each gate passes independently with its own probability. Gives the full distribution of how many pass, and the chance at least k, exactly k and all of them pass.",
      inputs: [PROBS("Pass probability of each gate", "0.9\n0.8\n0.5"), COUNT("k", "At least k passing", { default: 1 })],
      compute: ({ probs, k }) => {
        const values = probabilityList(probs), n = values.length;
        need(n <= 1000, "Type at most 1,000 gates.");
        need(k <= n, "k cannot be more than the number of gates.");
        let dist = [1];
        for (const p of values) {
          const next = new Array(dist.length + 1).fill(0);
          dist.forEach((mass, passing) => { next[passing] += mass * (1 - p); next[passing + 1] += mass * p; });
          dist = next;
        }
        const atLeast = dist.map((_, passing) => dist.slice(passing).reduce((sum, mass) => sum + mass, 0));
        return { rows: [["Gates", n], ["Expected number passing", values.reduce((sum, p) => sum + p, 0)], [`Chance at least ${k} pass`, atLeast[k]],
          [`Chance exactly ${k} pass`, dist[k]], ["Chance all pass", dist[n]]],
        table: { columns: ["Passing", "Chance exactly", "Chance at least"], rows: dist.map((mass, passing) => [passing, mass, atLeast[passing]]) } };
      } },
    { id: "combine_logodds", kind: "tool", group: ODDS, title: "Combine independent evidence in log-odds",
      help: "Several probabilities for the same case, each from an independent source calibrated to the same base rate: each adds its log-odds above the base rate, and the sum gives the combined probability.",
      inputs: [SHARE("base", "Base rate"), PROBS("Probabilities from the sources", "0.8\n0.75")],
      compute: ({ base, probs }) => {
        open(base, "The base rate");
        const values = probabilityList(probs);
        values.forEach((p, index) => need(p > 0 && p < 1, `Value ${index + 1} must be between 0 and 1, not equal to either.`));
        const prior = Math.log(odds(base));
        const evidence = values.map((p) => Math.log(odds(p)) - prior);
        const combined = prior + evidence.reduce((sum, x) => sum + x, 0);
        return { rows: [["Base-rate log-odds", prior], ["Combined log-odds", combined], ["Combined probability", 1 / (1 + Math.exp(-combined))]],
          table: { columns: ["Source", "Probability", "Evidence (log-odds over the base rate)"], rows: values.map((p, index) => [index + 1, p, evidence[index]]) },
          note: "Holds only when the sources are independent given the case." };
      } },
    { id: "expected_value", kind: "tool", group: ODDS, title: "Expected value of a decision",
      help: "List each action's outcomes one per line as action, probability, payoff (a cost is a negative payoff). Each action's probabilities must add up to 1. Shows each action's expected payoff and the best one.",
      inputs: [{ name: "outcomes", label: "Outcomes (action, probability, payoff)", type: "textarea", rows: 6, required: true, placeholder: "automate, 0.92, 10\nautomate, 0.08, -60\nreview, 1, 4" }],
      compute: ({ outcomes }) => {
        const actions = new Map();
        for (const { line, cells } of records(outcomes, ["action", "probability", "payoff"], "outcome")) {
          const p = cellNumber(cells[1], line, "the probability", (x) => x >= 0 && x <= 1, "between 0 and 1");
          const payoff = cellNumber(cells[2], line, "the payoff", () => true, "");
          const entry = actions.get(cells[0]) || { total: 0, value: 0 };
          entry.total += p; entry.value += p * payoff;
          actions.set(cells[0], entry);
        }
        for (const [name, entry] of actions) need(Math.abs(entry.total - 1) <= 1e-6, `The probabilities of ${name} add up to ${Number(entry.total.toPrecision(6))}, not 1.`);
        const ranked = [...actions].sort((a, b) => b[1].value - a[1].value);
        return { rows: [["Best action", ranked[0][0]], ["Its expected payoff", ranked[0][1].value], ["Margin over the next best", ranked.length > 1 ? ranked[0][1].value - ranked[1][1].value : null]],
          table: { columns: ["Action", "Total probability", "Expected payoff"], rows: [...actions].map(([name, entry]) => [name, entry.total, entry.value]) } };
      } },
    { id: "probability_formats", kind: "tool", group: ODDS, title: "Convert a percentage, fraction or odds",
      help: "Type a probability in any form (0.25, 25%, 1/4, 1 in 4, or odds for:against such as 1:3 or 1 to 3) to see it as a decimal, a percentage, an exact fraction, odds and one in N.",
      inputs: [{ name: "value", label: "Probability, percentage, fraction or odds", type: "text", required: true, placeholder: "e.g. 12.5% or 1:7" }],
      compute: ({ value }) => {
        const { n, d } = parseProbability(value);
        const p = Number(n) / Number(d);
        return [["Probability", p], ["Percent", p * 100], ["Fraction", d === 1n ? String(n) : `${n}/${d}`], ["Odds for : against", `${n} : ${d - n}`], ["One in", n > 0n ? Number(d) / Number(n) : null]];
      } },
    { id: "posterior_categories", kind: "tool", group: ODDS, title: "Bayes update over several outcomes",
      help: "One outcome per line as name, prior, likelihood of the evidence under it. Priors are scaled to add up to 1; each posterior is prior × likelihood over the total.",
      inputs: [{ name: "outcomes", label: "Outcomes (name, prior, likelihood)", type: "textarea", rows: 6, required: true, placeholder: "refund, 0.5, 0.2\nshipping, 0.3, 0.6\nother, 0.2, 0.1" }],
      compute: ({ outcomes }) => {
        const seen = new Set();
        const parsed = records(outcomes, ["name", "prior", "likelihood"], "outcome").map(({ line, cells }) => {
          need(!seen.has(cells[0]), `Line ${line}: ${cells[0]} is listed twice.`);
          seen.add(cells[0]);
          return { name: cells[0], prior: cellNumber(cells[1], line, "the prior"), likelihood: cellNumber(cells[2], line, "the likelihood") };
        });
        const priors = parsed.reduce((sum, entry) => sum + entry.prior, 0);
        need(priors > 0, "At least one prior must be above 0.");
        const evidence = parsed.reduce((sum, entry) => sum + entry.prior / priors * entry.likelihood, 0);
        need(evidence > 0, "The evidence has no chance under any outcome with a prior above 0.");
        const rows = parsed.map((entry) => [entry.name, entry.prior / priors, entry.likelihood, entry.prior / priors * entry.likelihood / evidence]);
        const best = rows.reduce((top, row) => (row[3] > top[3] ? row : top), rows[0]);
        return { rows: [["Most likely after the update", best[0]], ["Its probability", best[3]], ["Chance of the evidence", evidence]],
          table: { columns: ["Outcome", "Prior", "Likelihood", "Posterior"], rows } };
      } },
  ],
});
