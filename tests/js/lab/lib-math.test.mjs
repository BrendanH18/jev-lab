// static/js/lab/lib/math.js: the numerics Lab and Compare import. Run with: node --test tests/js/lab/lib-math.test.mjs
// No expected value here comes from the code under test. They are exact closed forms and identities, exact integer and
// rational arithmetic with BigInt done in this file, published table values, or the reference table below.
//
// How the reference table was computed, in Python with the decimal and fractions modules only (60 to 900 significant
// digits as each row needed, then rounded once to a double):
//   - binomial and hypergeometric rows: exact Fraction sums of math.comb terms; rare events (1 - p)^n in Decimal.
//   - normalQuantile: the double nearest the root, found by bisection over the doubles on the normal distribution
//     function (the Maclaurin series of erf with pi from Machin's formula, at z / sqrt(2) taken exactly).
//   - median: exact Fraction arithmetic on the exact values of the doubles.
// A row is [name, arguments, expected, tolerance]: the tolerance is the largest relative error allowed, 0 means exact,
// and null stands for a result of null. The tolerances follow the accuracy promised in math.js's header, including
// its weaker regions (complements of tiny probabilities, subnormal results, huge shapes).
import assert from "node:assert/strict";
import { test } from "node:test";

import * as math from "../../../static/js/lab/lib/math.js";

// BEGIN REFERENCE TABLE
const REFERENCE = JSON.parse(String.raw`
{"values": [
["normalQuantile", [0.5], 0, 0],
["normalQuantile", [1e-300], -37.0470962993612, 1e-14],
["normalQuantile", [1e-100], -21.273453560965326, 1e-14],
["normalQuantile", [1e-20], -9.262340089798407, 1e-14],
["normalQuantile", [1e-10], -6.361340902404057, 1e-14],
["normalQuantile", [0.001], -3.0902323061678136, 1e-14],
["normalQuantile", [0.025], -1.9599639845400543, 1e-14],
["normalQuantile", [0.07499999999999998], -1.4395314709384561, 1e-14],
["normalQuantile", [0.075], -1.439531470938456, 1e-14],
["normalQuantile", [0.1], -1.2815515655446004, 1e-14],
["normalQuantile", [0.3], -0.5244005127080408, 1e-14],
["normalQuantile", [0.6], 0.2533471031357997, 1e-14],
["normalQuantile", [0.9], 1.2815515655446006, 1e-14],
["normalQuantile", [0.925], 1.4395314709384561, 1e-14],
["normalQuantile", [0.95], 1.6448536269514722, 1e-14],
["normalQuantile", [0.975], 1.9599639845400538, 1e-14],
["normalQuantile", [0.99], 2.3263478740408408, 1e-14],
["normalQuantile", [0.995], 2.5758293035489004, 1e-14],
["normalQuantile", [0.999], 3.090232306167813, 1e-14],
["normalQuantile", [0.9999999999], 6.361340889697422, 1e-14],
["normalQuantile", [0.9999999999999999], 8.209536151601387, 1e-14],
["binomialCdf", [3, 10, 0.5], 0.171875, 1e-13],
["binomialCdf", [0, 10, 0.3], 0.028247524900000005, 1e-13],
["binomialCdf", [9, 10, 0.3], 0.9999940951, 1e-13],
["binomialCdf", [5, 20, 0.1], 0.988746865835491, 1e-13],
["binomialCdf", [40, 100, 0.5], 0.028443966820490395, 1e-13],
["binomialCdf", [60, 100, 0.5], 0.9823998998911476, 1e-13],
["binomialCdf", [480, 1000, 0.5], 0.10872414660207047, 1e-13],
["binomialCdf", [10, 1000, 0.001], 0.9999999904000448, 1e-13],
["binomialCdf", [950, 1000, 0.5], 1.0, 1e-13],
["binomialCdf", [20, 1000, 0.5], 3.234135263244699e-260, 1e-13],
["binomialCdf", [7, 40, 0.83], 2.125506329588378e-19, 1e-13],
["binomialCdf", [130, 300, 0.25], 0.9999999999984809, 1e-13],
["binomialCdf", [-1, 5, 0.5], 0, 0],
["binomialCdf", [5, 5, 0.5], 1, 0],
["hypergeometricPmf", [1, 10, 5, 3], 0.4166666666666667, 1e-13],
["hypergeometricPmf", [0, 52, 4, 5], 0.6588419983377967, 1e-13],
["hypergeometricPmf", [2, 52, 4, 5], 0.03992981808107859, 1e-13],
["hypergeometricPmf", [4, 52, 4, 5], 1.846892603195124e-05, 1e-13],
["hypergeometricPmf", [5, 100, 30, 20], 0.19182559242904654, 1e-13],
["hypergeometricPmf", [50, 1000, 500, 100], 0.08389209209281304, 1e-13],
["hypergeometricPmf", [0, 10, 0, 3], 1.0, 1e-13],
["hypergeometricPmf", [3, 10, 10, 3], 1.0, 1e-13],
["hypergeometricPmf", [0, 10, 5, 0], 1.0, 1e-13],
["hypergeometricPmf", [5, 1000000000, 1000, 10000], 8.160482385114546e-13, 1e-13],
["hypergeometricPmf", [10, 1000000, 100000, 100], 0.13187194057525317, 1e-13],
["hypergeometricPmf", [30, 200, 60, 50], 2.1553900193214857e-07, 1e-13],
["hypergeometricPmf", [0, 1000000000, 1000, 10000], 0.9900497793009961, 1e-13],
["hypergeometricPmf", [100, 1000000000, 500000000, 100], 7.888570003688069e-31, 1e-13],
["hypergeometricPmf", [50, 2000000000, 1000000000, 50], 8.881778756909963e-16, 1e-13],
["hypergeometricPmf", [10, 1000000000000, 1000000, 100000], 2.492282627554326e-17, 1e-13],
["hypergeometricPmf", [1, 1000, 1, 999], 0.999, 1e-13],
["hypergeometricPmf", [-1, 10, 5, 3], 0, 0],
["hypergeometricPmf", [4, 10, 5, 3], 0, 0],
["hypergeometricPmf", [6, 10, 5, 8], 0, 0],
["hypergeometricPmf", [0, 10, 5, 8], 0, 0],
["binomialCdf", [0, 1000000000000000, 1e-20], 0.9999900000499998, 1e-13],
["binomialCdf", [0, 1000000, 1e-07], 0.9048374135117722, 1e-13],
["binomialCdf", [0, 1000000000000, 1e-12], 0.36787944117125837, 1e-13],
["median", [[3, 1, 2]], 2, 0],
["median", [[4, 1, 3, 2]], 2.5, 0],
["median", [[-1.7e+308, 1.7e+308]], 0, 0],
["median", [[5]], 5, 0],
["median", [[2, 2, 1, 9, 9, 9]], 5.5, 0],
["median", [[]], null, 0],
["median", [[1, null]], null, 0],
["median", [null], null, 0],
["normalQuantile", [0], null, 0],
["normalQuantile", [1], null, 0],
["normalQuantile", [-0.5], null, 0],
["binomialCdf", [2, 5.5, 0.5], null, 0],
["hypergeometricPmf", [1, 10, 11, 3], null, 0],
["hypergeometricPmf", [1, 10, 5, 11], null, 0],
["hypergeometricPmf", [0.5, 10, 5, 3], null, 0],
["hypergeometricPmf", [1, -10, 5, 3], null, 0]
]
}
`);
// END REFERENCE TABLE

const EXPORTS = ["normalQuantile", "binomialCdf", "hypergeometricPmf", "median"];

// The number of arguments each numeric function takes, and a valid set of them.
const VALID = {
  normalQuantile: [0.3],
  binomialCdf: [3, 10, 0.3],
  hypergeometricPmf: [2, 20, 7, 5],
};
const PROBABILITIES = /Cdf|Pmf/;

function near(actual, expected, tolerance, label) {
  if (expected === null || typeof expected === "boolean" || tolerance === 0 || expected === 0) {
    assert.ok(actual === expected, `${label}: got ${actual}, expected exactly ${expected}`);
    return;
  }
  assert.equal(typeof actual, "number", `${label}: got ${actual}, expected ${expected}`);
  const error = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    error <= tolerance,
    `${label}: got ${actual}, expected ${expected} (relative error ${error.toExponential(2)} > ${tolerance})`,
  );
}

// ---------- exact arithmetic helpers (BigInt) ----------

const bitLength = (value) => (value === 0n ? 0 : value.toString(2).length);

// [numerator, denominator] with numerator / denominator exactly the value of the double x >= 0.
function exactRational(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (exponent === 0) return [fraction, 1n << 1074n];
  const power = exponent - 1075; // x = (2^52 + fraction) * 2^power
  const mantissa = fraction | (1n << 52n);
  return power >= 0 ? [mantissa << BigInt(power), 1n] : [mantissa, 1n << BigInt(-power)];
}

// numerator / denominator as a double, rounded once (the quotient is first taken to 70 significant bits).
function ratioToNumber(numerator, denominator) {
  if (numerator === 0n) return 0;
  const shift = Math.max(0, 70 - (bitLength(numerator) - bitLength(denominator)));
  const quotient = (numerator << BigInt(shift)) / denominator;
  return Number(quotient) * 2 ** -Math.min(shift, 1000) * 2 ** -(shift - Math.min(shift, 1000));
}

function chooseBig(n, k) {
  if (k < 0 || k > n) return 0n;
  let out = 1n;
  for (let i = 1; i <= k; i++) out = (out * BigInt(n - k + i)) / BigInt(i);
  return out;
}

// sum over j in [from, to] of C(n, j) p^j (1 - p)^(n - j), exactly, for a double p in [0, 1].
function binomialSumExact(n, p, from, to) {
  const [num, den] = exactRational(p);
  let total = 0n;
  for (let j = Math.max(0, from); j <= Math.min(n, to); j++)
    total += chooseBig(n, j) * num ** BigInt(j) * (den - num) ** BigInt(n - j);
  return ratioToNumber(total, den ** BigInt(n));
}

// ---------- the module surface ----------

test("the module exports exactly the documented names, all functions", () => {
  assert.deepEqual(Object.keys(math).sort(), [...EXPORTS].sort());
  for (const name of EXPORTS) assert.equal(typeof math[name], "function", name);
});

// ---------- the reference table ----------

test("every row of the reference table", () => {
  const seen = new Set();
  for (const [name, args, expected, tolerance] of REFERENCE.values) {
    seen.add(name);
    near(math[name](...args), expected, tolerance, `${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  }
  assert.deepEqual([...seen].sort(), [...EXPORTS].sort(), "the table covers every export");
});

// ---------- domain rules: null, never NaN, never a throw ----------

test("a non-number in any position gives null, never NaN and never a throw", () => {
  const bad = [
    NaN,
    Infinity,
    -Infinity,
    "1",
    "",
    null,
    undefined,
    true,
    false,
    1n,
    {},
    [],
    [1],
    () => 1,
    new Number(1),
  ];
  for (const [name, args] of Object.entries(VALID)) {
    assert.notEqual(math[name](...args), null, `${name}(${args}) is valid`);
    for (let position = 0; position < args.length; position++) {
      for (const value of bad) {
        const call = args.slice();
        call[position] = value;
        assert.equal(math[name](...call), null, `${name} with ${String(value)} at position ${position}`);
      }
    }
  }
  for (const value of [
    [],
    [1, NaN],
    [1, Infinity],
    [1, "2"],
    [1, null],
    "12",
    null,
    undefined,
    5,
    { 0: 1, length: 1 },
    // biome-ignore lint/suspicious/noSparseArray: the test feeds a sparse array on purpose
    [1, , 3],
  ]) {
    assert.equal(math.median(value), null, `median(${JSON.stringify(value)})`);
  }
});

test("over a grid of edge values every result is null or finite, and every probability lies in [0, 1]", () => {
  const edge = [
    0,
    5e-324,
    1e-300,
    1e-20,
    0.001,
    0.1,
    0.5,
    0.9,
    0.999,
    0.9999999999999999,
    1,
    2.5,
    7,
    30,
    1000,
    1e9,
    2 ** 53 - 1,
    1e20,
    1e154,
    1e300,
    1.7976931348623157e308,
  ];
  const values = [...edge, ...edge.filter((v) => v !== 0).map((v) => -v)];
  const few = values.filter((_, i) => i % 3 === 0);
  for (const [name, args] of Object.entries(VALID)) {
    const grid = args.length <= 2 ? values : few;
    const visit = (call) => {
      if (call.length === args.length) {
        const result = math[name](...call);
        const ok =
          result === null || typeof result === "boolean" || (typeof result === "number" && Number.isFinite(result));
        assert.ok(ok, `${name}(${call.join(", ")}) gave ${result}`);
        if (typeof result === "number" && PROBABILITIES.test(name)) {
          assert.ok(result >= 0 && result <= 1, `${name}(${call.join(", ")}) gave ${result}, outside [0, 1]`);
        }
        return;
      }
      for (const value of grid) visit([...call, value]);
    };
    visit([]);
  }
});

// ---------- the normal quantile ----------

test("normalQuantile matches published values and is symmetric", () => {
  // Published: the 97.5% point 1.959963984540054 (NIST/SEMATECH e-Handbook; 1.95996 39845 40054 23552), 95% 1.6448536269514722,
  // 99.5% 2.5758293035489004, 99.9% 3.090232306167813.
  near(math.normalQuantile(0.975), 1.959963984540054, 1e-15, "z 0.975");
  near(math.normalQuantile(0.95), 1.6448536269514722, 1e-15, "z 0.95");
  near(math.normalQuantile(0.995), 2.5758293035489004, 1e-15, "z 0.995");
  near(math.normalQuantile(0.999), 3.090232306167813, 1e-15, "z 0.999");
  assert.equal(math.normalQuantile(0.5), 0);
  for (const p of [2 ** -50, 2 ** -30, 2 ** -10, 0.0625, 0.125, 0.25, 0.375, 0.4375]) {
    // 1 - p is exact for these
    near(math.normalQuantile(1 - p), -math.normalQuantile(p), 1e-15, `symmetry at ${p}`);
  }
});

// ---------- the binomial and hypergeometric distributions ----------

test("binomialCdf is the exact rational sum (BigInt)", () => {
  for (const p of [0.3, 0.5, 0.01, 0.875, 1 / 3]) {
    for (const n of [1, 7, 20, 60]) {
      for (let k = -1; k <= n + 1; k++) {
        near(
          math.binomialCdf(k, n, p),
          k < 0 ? 0 : binomialSumExact(n, p, 0, k),
          1e-13,
          `binomialCdf(${k}, ${n}, ${p})`,
        );
      }
    }
  }
  assert.equal(math.binomialCdf(5, 5, 0.3), 1);
  assert.equal(math.binomialCdf(2.5, 5, 0.3), null);
});

test("hypergeometricPmf is the exact ratio C(K, k) C(N - K, n - k) / C(N, n) and sums to 1", () => {
  for (const [population, successes, draws] of [
    [10, 5, 3],
    [52, 4, 5],
    [52, 13, 13],
    [100, 30, 20],
    [500, 7, 250],
    [1000, 500, 100],
    [60, 0, 10],
    [60, 60, 10],
    [60, 20, 60],
  ]) {
    let total = 0;
    for (let k = -1; k <= draws + 1; k++) {
      const exact = ratioToNumber(
        chooseBig(successes, k) * chooseBig(population - successes, draws - k),
        chooseBig(population, draws),
      );
      const got = math.hypergeometricPmf(k, population, successes, draws);
      near(got, exact, 2e-14, `hypergeometricPmf(${k}, ${population}, ${successes}, ${draws})`);
      total += got;
    }
    near(total, 1, 1e-14, `the pmf over all k for ${population}, ${successes}, ${draws}`);
  }
  assert.equal(math.hypergeometricPmf(0, 10, 5, 0), 1);
  assert.equal(math.hypergeometricPmf(1, 10, 11, 3), null);
});

// ---------- the median ----------

test("median on lists worked out by hand", () => {
  assert.equal(math.median([2, 4, 4, 4, 5, 5, 7, 9]), 4.5);
  assert.equal(math.median([3, 1, 2]), 2);
  assert.equal(math.median([-1.7e308, 1.7e308]), 0, "no overflow between the middle values");
  assert.equal(math.median([1.7e308, 1.7e308]), 1.7e308);
  const input = [3, 1, 2];
  math.median(input);
  assert.deepEqual(input, [3, 1, 2], "the input is not sorted in place");
});
