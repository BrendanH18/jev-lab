// Toolbox: sample-size and allocation calculators for audits. Every tool is pure: it reads
// only the rates, counts and margins typed into its form, never page data, and it never calls the model.
import { definePack, toNumber } from "../../kit.js";
import { binomialCdf, hypergeometricPmf, normalQuantile } from "../../lib/math.js";

const GROUP = "Sample sizes";
const MAX_ROWS = 1e9;
// ---------- inputs ----------

const count = (name, label, placeholder, extra = {}) => ({
  name,
  label,
  type: "integer",
  min: 0,
  max: MAX_ROWS,
  placeholder,
  ...extra,
});
const share = (name, label, placeholder, extra = {}) => ({
  name,
  label,
  type: "number",
  min: 0,
  max: 1,
  placeholder,
  ...extra,
});
const LEVEL = {
  name: "level",
  label: "Confidence level",
  type: "select",
  options: [
    ["0.95", "95%"],
    ["0.9", "90%"],
    ["0.99", "99%"],
  ],
};
const ONE_SIDED = { ...LEVEL, label: "Confidence level (one-sided)" };
const STRATA = {
  name: "strata",
  label: "Strata",
  type: "textarea",
  required: true,
  placeholder: "retail, 8000, 0.05\nwholesale, 2000, 0.2",
};
const STRATA_FORMAT =
  "Paste one stratum per line: name, number of rows in it, expected error rate (the name may be left out).";

// ---------- helpers ----------

const fail = (message) => {
  throw new Error(message);
};
const ceilCount = (x) => (x > 0 ? Math.max(1, Math.ceil(x - 1e-9)) : Math.ceil(x));
const zTwo = (level) => normalQuantile(1 - (1 - Number(level)) / 2);
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);
// Allow roundoff when a computed tail lands on the inclusive significance cutoff.
const probabilityAtMost = (probability, cutoff) =>
  probability !== null && probability <= cutoff * (1 + 8 * Number.EPSILON);

function strictShare(value, label) {
  if (value <= 0 || value >= 1) fail(`${label} must be strictly between 0 and 1.`);
}

// The smallest whole n >= lo with ok(n) true, for ok false then true as n grows; null when none up to limit.
function firstTrue(ok, lo, limit = MAX_ROWS) {
  let hi = Math.max(lo, 1);
  while (!ok(hi)) {
    if (hi >= limit) return null;
    lo = hi + 1;
    hi = Math.min(limit, hi * 2);
  }
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Lines of "name, size, rate" (the name may be left out).
function strata(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) fail("Paste at least two strata, one per line.");
  const list = lines.map((line, index) => {
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim());
    if (cells.length === 2) cells.unshift(`Stratum ${index + 1}`);
    if (cells.length !== 3)
      fail(`Line ${index + 1} ("${short(line)}") needs a name, the number of rows and the expected error rate.`);
    const size = toNumber(cells[1]),
      rate = toNumber(cells[2]);
    if (size === null || !Number.isSafeInteger(size) || size < 1)
      fail(`Line ${index + 1}: the number of rows must be a whole number of at least 1.`);
    if (rate === null || rate < 0 || rate > 1) fail(`Line ${index + 1}: the expected rate must be between 0 and 1.`);
    return { name: cells[0] || `Stratum ${index + 1}`, size, rate, spread: Math.sqrt(rate * (1 - rate)) };
  });
  const population = list.reduce((sum, row) => sum + row.size, 0);
  if (!Number.isSafeInteger(population)) fail("There are too many rows across the strata.");
  return { list, population };
}

// Round down within capacities, then allocate the balance by remainder (earlier lines first on ties).
function largestRemainder(quotas, capacities, total) {
  const floors = quotas.map((quota, i) => Math.min(Math.floor(quota + 1e-9), capacities[i]));
  let left = total - floors.reduce((sum, value) => sum + value, 0);
  if (left === 0) return floors;
  const order = quotas
    .map((quota, index) => ({ index, fraction: quota - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  // At very large totals floating-point quotas can also round above the available budget.
  const step = left < 0 ? -1 : 1;
  if (step === -1) order.reverse();
  while (left !== 0) {
    for (const { index } of order) {
      if (left === 0) break;
      const next = floors[index] + step;
      if (next < 0 || next > capacities[index]) continue;
      floors[index] = next;
      left -= step;
    }
  }
  return floors;
}

// Neyman allocation (n_h proportional to N_h S_h) with every stratum capped at its size; the rows a capped stratum
// cannot take go to the others. Strata with no spread left share the rest by size.
function neymanQuotas(weights, capacities, total) {
  const quotas = capacities.map(() => 0);
  let free = capacities.map((_, i) => i).filter((i) => capacities[i] > 0);
  let remaining = total;
  while (remaining > 0 && free.length) {
    const shares = free.some((i) => weights[i] > 0) ? weights : capacities;
    const sum = free.reduce((sum, i) => sum + shares[i], 0);
    const next = [];
    for (const i of free) {
      const quota = remaining * (shares[i] / sum);
      quotas[i] = Math.min(quota, capacities[i]);
      if (quota < capacities[i]) next.push(i);
    }
    if (next.length === free.length) break;
    for (const i of free) {
      if (quotas[i] === capacities[i]) remaining -= capacities[i];
    }
    free = next;
  }
  return quotas;
}

// An indexed heap lets each row transfer update only the strata whose priorities changed.
function stratumQueue(length, compare) {
  const heap = Array.from({ length }, (_, i) => i).sort(compare);
  const positions = new Array(length);
  heap.forEach((index, i) => {
    positions[index] = i;
  });
  function swap(a, b) {
    [heap[a], heap[b]] = [heap[b], heap[a]];
    positions[heap[a]] = a;
    positions[heap[b]] = b;
  }
  return {
    first: () => heap[0],
    update(index) {
      let i = positions[index];
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (compare(heap[i], heap[parent]) >= 0) break;
        swap(i, parent);
        i = parent;
      }
      for (;;) {
        const left = 2 * i + 1;
        if (left >= length) break;
        const right = left + 1;
        const child = right < length && compare(heap[right], heap[left]) < 0 ? right : left;
        if (compare(heap[i], heap[child]) <= 0) break;
        swap(i, child);
        i = child;
      }
    },
  };
}

// Start near the optimum using capped quotas. Exchange rows until no feasible move reduces variance.
// Marginal gains diminish with each row added, so this also minimizes variance over all whole-row allocations.
// See Wright (2014), https://www.census.gov/library/working-papers/2014/adrm/rrs2014-07.html.
function neymanAllocation(list, total) {
  const weights = list.map((row) => row.size * row.spread);
  const minimum = weights.filter((weight) => weight > 0).length;
  const reserved = weights.map((weight) => Number(total >= minimum && weight > 0));
  const capacities = list.map((row, i) => row.size - reserved[i]);
  const remaining = total - (total >= minimum ? minimum : 0);
  const quotas = neymanQuotas(weights, capacities, remaining);
  const counts = largestRemainder(quotas, capacities, remaining).map((n, i) => n + reserved[i]);
  // Square root of the variance reduction from going from n to n + 1, up to a common factor.
  const priority = (index, n) => (weights[index] === 0 ? 0 : weights[index] / Math.sqrt(n * (n + 1)));
  const gain = (i) => (counts[i] < list[i].size ? priority(i, counts[i]) : 0);
  const loss = (i) => (counts[i] > 0 ? priority(i, counts[i] - 1) : Infinity);
  const receivers = stratumQueue(list.length, (a, b) => gain(b) - gain(a) || a - b);
  const donors = stratumQueue(list.length, (a, b) => loss(a) - loss(b) || a - b);
  for (;;) {
    const add = receivers.first();
    const remove = donors.first();
    if (gain(add) <= loss(remove)) return counts;
    counts[add] += 1;
    receivers.update(add);
    donors.update(add);
    counts[remove] -= 1;
    receivers.update(remove);
    donors.update(remove);
  }
}

// ---------- tools ----------

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

export default definePack({
  id: "tb-sample-sizes",
  surface: "workbench.toolbox",
  title: "Finite and stratified audits",
  about: "Plan an audit from a finite batch or estimate its size and allocation across strata.",
  features: [
    tool(
      "finite_batch_audit",
      "Rows to audit from a finite batch",
      "How many rows to draw without replacement from a batch so that, if the batch held errors at the rate you want to rule out, finding no more than the allowed errors would happen with at most 1 − confidence chance (exact hypergeometric), next to the size that ignores the batch. Batches up to 1,000,000 rows.",
      [
        count("size", "Rows in the batch", "e.g. 2000", { min: 1, max: 1e6 }),
        share("rate", "Error rate to rule out", "e.g. 0.02"),
        count("allowed", "Errors allowed in the audit", "e.g. 0", { default: 0, max: 10000 }),
        ONE_SIDED,
      ],
      ({ size, rate, allowed, level }) => {
        strictShare(rate, "The error rate");
        const whole = Math.floor(rate * size);
        // Compare rates so rounding in rate * size cannot promote an exact batch count or erase a fractional one.
        const errors = rate <= whole / size ? whole : whole + 1;
        const alpha = 1 - Number(level);
        if (errors <= allowed)
          fail(`At that rate the batch holds only ${errors} errors, no more than the errors allowed.`);
        const passes = (n) => {
          let total = 0;
          for (let j = 0; j <= allowed; j++) total += hypergeometricPmf(j, size, errors, n);
          return total;
        };
        let lo = allowed + 1,
          hi = size;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (probabilityAtMost(passes(mid), alpha)) hi = mid;
          else lo = mid + 1;
        }
        const binomial = firstTrue((n) => probabilityAtMost(binomialCdf(allowed, n, rate), alpha), allowed + 1);
        return [
          ["Errors in the batch at that rate", errors],
          ["Rows to audit (finite batch)", lo],
          ["Rows to audit ignoring the batch size", binomial],
          ["Share of the batch audited", lo / size],
        ];
      },
    ),
    tool(
      "stratified_allocation",
      "Split an audit across strata",
      `How to split a fixed number of audited rows across strata (for example customer types or slices): proportional to each stratum's size, and Neyman's allocation, which minimizes estimated variance when every stratum with a rate between 0% and 100% can receive a row. Both allocations use whole rows and cap each stratum at its size. ${STRATA_FORMAT}`,
      [STRATA, count("total", "Rows to audit in all", "e.g. 400", { min: 1, max: Number.MAX_SAFE_INTEGER })],
      ({ strata: text, total }) => {
        const { list, population } = strata(text);
        if (total > population) fail("The rows to audit cannot be more than the rows in all strata.");
        const proportional = largestRemainder(
          list.map((row) => (total * row.size) / population),
          list.map((row) => row.size),
          total,
        );
        const neyman = neymanAllocation(list, total);
        return {
          table: {
            columns: ["Stratum", "Rows", "Expected rate", "Proportional", "Neyman"],
            rows: list.map((row, i) => [row.name, row.size, row.rate, proportional[i], neyman[i]]),
          },
          note: `${total} rows over ${list.length} strata.`,
        };
      },
    ),
    tool(
      "stratified_total",
      "Rows for a stratified audit's margin",
      `Plans sample sizes for the margin using your assumed error rates, S² = p(1 − p), and the finite population correction. Neyman uses the same whole-row allocation as Split an audit across strata. To calculate a confidence interval from the audit, sample at least two rows per stratum or audit the entire stratum. The proportional and simple random totals use Cochran's formulas. The proportional approximation assumes fractional quotas. Rounding to whole rows can miss the margin or leave a stratum unsampled. ${STRATA_FORMAT}`,
      [STRATA, share("margin", "Margin of error (e.g. 0.02)", "e.g. 0.02"), LEVEL],
      ({ strata: text, margin, level }) => {
        if (margin <= 0) fail("The margin must be above 0.");
        const { list, population } = strata(text);
        const v = (margin / zTwo(level)) ** 2;
        const weights = list.map((row) => row.size / population);
        const ws2 = weights.reduce((sum, w, i) => sum + w * list[i].spread ** 2, 0);
        const overall = weights.reduce((sum, w, i) => sum + w * list[i].rate, 0),
          s2 = overall * (1 - overall);
        const minimum = list.filter((row) => row.spread > 0).length;
        const neymanTotal = minimum
          ? firstTrue(
              (total) => {
                const counts = neymanAllocation(list, total);
                const variance = list.reduce((sum, row, i) => {
                  if (row.spread === 0) return sum;
                  const n = counts[i];
                  return sum + (weights[i] * row.spread) ** 2 * ((row.size - n) / row.size / n);
                }, 0);
                return variance <= v;
              },
              minimum,
              population,
            )
          : 0;
        return [
          ["Rows with Neyman allocation", neymanTotal],
          ["Rows with proportional allocation (approximate)", ceilCount(ws2 / (v + ws2 / population))],
          ["Rows as one simple random sample", ceilCount(s2 / (v + s2 / population))],
          ["Expected overall error rate", overall],
        ];
      },
    ),
  ],
});
