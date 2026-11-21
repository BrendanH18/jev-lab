// Merge sparse Compare retries in the browser, where the original answers already live.
import { median } from "./lab/lib/math.js";

const usage = ["input_tokens", "output_tokens", "cost_usd"];

// Share Choice option names across the two variants and all rows sent for scoring.
export function compareScorePayload(rows) {
  const keys = new Map();
  function keyIndex(key) {
    if (!keys.has(key)) keys.set(key, keys.size);
    return keys.get(key);
  }
  const packed = rows.map((row) => ({
    ...row,
    answers: row.answers.map((answer) => {
      const probs = answer?.probabilities;
      if (
        answer?.type !== "choice" ||
        typeof answer.choice !== "string" ||
        !probs ||
        typeof probs !== "object" ||
        Array.isArray(probs)
      )
        return answer;
      return [
        keyIndex(answer.choice),
        Object.entries(probs).map(([key, value]) => [keyIndex(key), value]),
        answer.confidence ?? null,
      ];
    }),
  }));
  return { rows: packed, option_keys: [...keys.keys()] };
}

function choiceProbabilities(answer, options) {
  const probs = answer?.probabilities;
  if (answer?.type !== "choice" || !probs || typeof probs !== "object" || Array.isArray(probs)) return null;
  if (Object.keys(probs).length !== options.length || !options.includes(answer.choice)) return null;
  return options.every(
    (key) => Object.hasOwn(probs, key) && typeof probs[key] === "number" && probs[key] >= 0 && probs[key] <= 1,
  )
    ? probs
    : null;
}

// Mirror jev/orders.py for newly completed pairs. Keep the first call's non-Choice answers.
function pair(first, second, questions) {
  const metas = [first.meta, second.meta].filter(Boolean);
  const run = {};
  if (Object.hasOwn(first, "input")) run.input = first.input;
  if (metas.length) {
    run.meta = { ...metas[0], calls: metas.length, latency_ms: Math.max(...metas.map((m) => m.latency_ms)) };
    for (const key of usage) run.meta[key] = metas.reduce((sum, meta) => sum + (meta[key] || 0), 0);
  }
  if (!first.answers || !second.answers) {
    const failed = [first, second].find((call) => Object.hasOwn(call, "error"));
    if (failed) run.error = failed.error;
    else run.skipped = true;
    return { run, picks: {} };
  }
  const answers = Object.assign(Object.create(null), first.answers);
  const picks = Object.assign(Object.create(null), first.picks);
  const orders = Object.create(null);
  for (const [qid, q] of Object.entries(questions)) {
    if (q.type !== "choice") continue;
    const options = Object.keys(q.criteria);
    if (options.length < 2) continue;
    const a = choiceProbabilities(answers[qid], options);
    const b = choiceProbabilities(Object.hasOwn(second.answers, qid) ? second.answers[qid] : null, options);
    if (!a || !b) {
      delete answers[qid];
      delete picks[qid];
      continue;
    }
    const probabilities = Object.fromEntries(options.map((key) => [key, (a[key] + b[key]) / 2]));
    const choice = options.reduce((best, key) => (probabilities[key] > probabilities[best] ? key : best));
    const even = 1 / options.length;
    const confidence = Math.max(0, (probabilities[choice] - even) / (1 - even));
    orders[qid] = [answers[qid].choice, second.answers[qid].choice];
    answers[qid] = { ...answers[qid], probabilities, choice, confidence };
    picks[qid] = choice;
  }
  return { run: { ...run, answers, orders }, picks };
}

// 95% Wilson interval, with the same quantile and endpoints as jev/calibrate.py.
function rates(entry, changed, answered) {
  if (!answered) return { ...entry, changed, answered, rate: null, low: null, high: null };
  const z = 1.959964;
  const rate = changed / answered;
  const square = z * z;
  const center = rate + square / (2 * answered);
  const spread = z * Math.sqrt((rate * (1 - rate)) / answered + square / (4 * answered * answered));
  const denom = 1 + square / answered;
  const low = changed === 0 ? 0 : Math.max(0, (center - spread) / denom);
  const high = changed === answered ? 1 : Math.min(1, (center + spread) / denom);
  return { ...entry, changed, answered, rate, low, high };
}

function updateAgreement(entries, touched, variants) {
  return entries.map((entry) => {
    const { qid, reordered, perturbed } = entry;
    const options = reordered ? variants.map((v) => Object.keys(v.questions[qid].criteria)) : null;
    let { answered, changed, same_position: samePosition } = entry;
    // A row with a pending call could not contribute a pair to the previous agreement table.
    for (const pairs of touched) {
      if (perturbed && !pairs.some(({ run }) => Object.hasOwn(run, "input"))) continue;
      if (!pairs.every(({ run, picks }) => run.answers && Object.hasOwn(picks, qid))) continue;
      answered += 1;
      const [a, b] = pairs.map(({ picks }) => picks[qid]);
      if (a === b) continue;
      changed += 1;
      if (options) {
        const place = options[0].indexOf(a);
        if (place >= 0 && place === options[1].indexOf(b)) samePosition += 1;
      }
    }
    const update = rates(entry, changed, answered);
    if (reordered) update.same_position = samePosition;
    return update;
  });
}

export function mergeCompareRetry(previous, attempt) {
  const calls = previous.calls.slice();
  const [a, b] = previous.variants.map((v) => (v.average_orders ? 2 : 1));
  const width = a + b;
  const touched = new Set();
  const updated = new Set();
  const spend = [[], []];
  for (const [position, call] of attempt.updates) {
    if (!Number.isInteger(position) || !calls[position] || calls[position].answers || updated.has(position)) {
      throw new Error("Retry returned an unexpected Compare call.");
    }
    calls[position] = call;
    const meta = call.meta || call.discarded;
    if (meta) spend[position % width < a ? 0 : 1].push(meta);
    touched.add(Math.floor(position / width));
    updated.add(position);
  }

  const newPairs = [];
  const results = previous.results.map((row, index) => {
    if (!touched.has(index)) return row;
    const start = index * width;
    const pairs = [calls.slice(start, start + a), calls.slice(start + a, start + width)].map((orders, v) => {
      const changed = orders.some((_, offset) => updated.has(start + (v ? a : 0) + offset));
      if (orders.length === 2) {
        const merged = pair(orders[0], orders[1], previous.variants[v].questions);
        return changed ? merged : { ...merged, run: row.runs[v] };
      }
      const { picks = {}, discarded: _discarded, ...outcome } = orders[0];
      return { run: changed ? outcome : row.runs[v], picks };
    });
    newPairs.push(pairs);
    return { ...row, runs: pairs.map(({ run }) => run) };
  });
  const variants = previous.variants.map((variant, index) => {
    const runs = results.map((row) => row.runs[index]);
    const completed = runs.filter((run) => run.answers);
    return {
      ...variant,
      completed: completed.length,
      errors: runs.filter((run) => Object.hasOwn(run, "error")).length,
      perturbed_rows: runs.filter((run) => Object.hasOwn(run, "input")).length,
      unperturbed_rows: variant.perturb ? runs.filter((run) => !Object.hasOwn(run, "input") && !run.skipped).length : 0,
      orders:
        variant.orders?.map((entry) => {
          const pairs = runs.flatMap((run) =>
            run.orders && Object.hasOwn(run.orders, entry.qid) ? [run.orders[entry.qid]] : [],
          );
          return rates(entry, pairs.filter(([first, second]) => first !== second).length, pairs.length);
        }) ?? null,
      latency_ms_median: median(completed.map((run) => run.meta.latency_ms)),
      input_tokens: spend[index].reduce((sum, meta) => sum + meta.input_tokens, variant.input_tokens),
      cost_usd: spend[index].reduce((sum, meta) => sum + meta.cost_usd, variant.cost_usd),
    };
  });
  return {
    ...previous,
    results,
    variants,
    agreement: updateAgreement(previous.agreement, newPairs, variants),
    calls: attempt.retry ? calls : [],
    retry: attempt.retry,
    stopped: attempt.stopped,
    retry_error: attempt.retry_error,
    wall_ms: previous.wall_ms + attempt.wall_ms,
    cost_usd: variants.reduce((sum, variant) => sum + variant.cost_usd, 0),
  };
}
