// Numerics for Lab: the normal quantile, the binomial distribution function, the hypergeometric probability and the
// median. The Toolbox sample-size pack (static/js/lab/packs/workbench/tb-sample-sizes.js) uses the first three, and
// Compare's retry estimate (static/js/compare-retry.js) uses median. Pure code: it imports nothing and touches no DOM,
// storage or network.
//
// Arguments: every number must be a finite number (typeof "number"; no NaN, no infinities, no numeric strings), and
// a list must be an array of such numbers. An argument outside a function's domain gives null. Nothing throws, and
// no function returns NaN or an infinity.
//
// Accuracy: relative error is at most 1e-10 over ordinary ranges and usually below 1e-13. The weaker regions are:
//   - a probability that is the complement of a tiny one is right to about 1e-16 absolute;
//   - results below 2.3e-308 (subnormal) keep fewer digits;
//   - shapes, degrees of freedom and counts above 1e9 lose about one digit per factor of 100, and a continued
//     fraction or series that would need more than 500,000 steps (shapes beyond roughly 1e10) gives null.

const EPSILON = 2.220446049250313e-16; // 2^-52
const TINY = 1e-300; // keeps the continued fractions away from a division by zero
const TWO_PI = 6.283185307179586;
const LN_SQRT_2PI = 0.9189385332046728; // ln sqrt(2 pi)
const ONE_MINUS_EULER = 0.42278433509846713; // 1 - Euler's constant
const MAX_STEPS = 500000; // ceiling for one continued fraction or series

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isInt = (x) => typeof x === "number" && Number.isSafeInteger(x);
const finite = (value) => (Number.isFinite(value) ? value : null);

// Coefficients highest power first.
function horner(coefficients, x) {
  let total = 0;
  for (const coefficient of coefficients) total = total * x + coefficient;
  return total;
}

// ---------- utilities ----------

// true for a number in [0, 1]; false for anything else, including NaN and non-numbers.
function isProbability(x) {
  return isNum(x) && x >= 0 && x <= 1;
}

// true for a nonnegative integer no larger than 2^53 - 1; false for anything else.
function isCount(x) {
  return isInt(x) && x >= 0;
}

// ---------- special functions ----------

// (-1)^k (zeta(k) - 1) / k for k = 2..30: the series of ln gamma(2 + w) after its linear term.
const LOG_GAMMA_SERIES = [
  3.1044247747322276e-11, -6.4229645638381e-11, 1.330476437424449e-10, -2.7595228851242334e-10, 5.731367241678862e-10,
  -1.1921401405860912e-9, 2.4836745438024785e-9, -5.183475041970047e-9, 1.0838659214896955e-8, -2.2711094608943164e-8,
  4.7698101693639804e-8, -1.0043224823968099e-7, 2.1207184805554665e-7, -4.492469198764566e-7, 9.55141213040742e-7,
  -2.039215753801366e-6, 4.374866789907488e-6, -9.439488275268397e-6, 2.050721277567069e-5, -4.492623673813314e-5,
  9.945751278180853e-5, -0.00022315475845357939, 0.0005096695247430425, -0.001192753911703261, 0.0028905103307415234,
  -0.007385551028673986, 0.020580808427784546, -0.0673523010531981, 0.3224670334241132,
];

// ln gamma(2 + w) for |w| <= 1/2; exactly 0 at w = 0, so the zeros of ln gamma at 1 and 2 keep full relative accuracy.
function logGammaNearTwo(w) {
  return w * (ONE_MINUS_EULER + w * horner(LOG_GAMMA_SERIES, w));
}

// B(2k) / (2k (2k - 1)) for k = 8..1: the tail of Stirling's series.
const STIRLING_SERIES = [-3617 / 122400, 1 / 156, -691 / 360360, 1 / 1188, -1 / 1680, 1 / 1260, -1 / 360, 1 / 12];

// ln gamma(z) - ((z - 1/2) ln z - z + ln sqrt(2 pi)) for z >= 10, where eight terms are exact to a double.
function stirlingTail(z) {
  return horner(STIRLING_SERIES, 1 / (z * z)) / z;
}

// ln gamma(x) for x > 0; null for x <= 0, a non-finite x, or a result that overflows (x above about 2.5e305).
function logGamma(x) {
  if (!isNum(x) || x <= 0) return null;
  if (x < 0.5) return logGammaNearTwo(x) - Math.log1p(x) - Math.log(x); // gamma(x) = gamma(2 + x) / (x (1 + x))
  if (x < 1.5) return logGammaNearTwo(x - 1) - Math.log1p(x - 1);
  if (x <= 2.5) return logGammaNearTwo(x - 2);
  if (x < 10) {
    let z = x,
      product = 1;
    while (z > 2.5) {
      z -= 1;
      product *= z;
    }
    return logGammaNearTwo(z - 2) + Math.log(product);
  }
  return finite((x - 0.5) * Math.log(x) - x + LN_SQRT_2PI + stirlingTail(x));
}

// M. J. Wichura's algorithm AS 241 (Applied Statistics 37, 1988), the one Python's statistics.NormalDist uses.
const QUANTILE_CENTRE_TOP = [
  2.5090809287301226727e3, 3.3430575583588128105e4, 6.7265770927008700853e4, 4.5921953931549871457e4,
  1.3731693765509461125e4, 1.9715909503065514427e3, 1.3314166789178437745e2, 3.387132872796366608,
];
const QUANTILE_CENTRE_BOTTOM = [
  5.226495278852854561e3, 2.8729085735721942674e4, 3.930789580009271061e4, 2.1213794301586595867e4,
  5.3941960214247511077e3, 6.871870074920579083e2, 4.2313330701600911252e1, 1,
];
const QUANTILE_MIDDLE_TOP = [
  7.7454501427834140764e-4, 2.27238449892691845833e-2, 2.4178072517745061177e-1, 1.27045825245236838258,
  3.64784832476320460504, 5.7694972214606914055, 4.6303378461565452959, 1.42343711074968357734,
];
const QUANTILE_MIDDLE_BOTTOM = [
  1.05075007164441684324e-9, 5.475938084995344946e-4, 1.51986665636164571966e-2, 1.4810397642748007459e-1,
  6.8976733498510000455e-1, 1.6763848301838038494, 2.05319162663775882187, 1,
];
const QUANTILE_TAIL_TOP = [
  2.01033439929228813265e-7, 2.71155556874348757815e-5, 1.2426609473880784386e-3, 2.6532189526576123093e-2,
  2.9656057182850489123e-1, 1.7848265399172913358, 5.4637849111641143699, 6.6579046435011037772,
];
const QUANTILE_TAIL_BOTTOM = [
  2.04426310338993978564e-15, 1.4215117583164458887e-7, 1.8463183175100546818e-5, 7.868691311456132591e-4,
  1.48753612908506148525e-2, 1.3692988092273580531e-1, 5.9983220655588793769e-1, 1,
];

// The standard normal quantile: z with P[Z <= z] = p, for 0 < p < 1 (accurate to about 1e-15 relative; a p within
// 1e-16 of 1 has already lost its tail). null for p <= 0, p >= 1 or a non-finite p.
export function normalQuantile(p) {
  if (!isNum(p) || p <= 0 || p >= 1) return null;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * horner(QUANTILE_CENTRE_TOP, r)) / horner(QUANTILE_CENTRE_BOTTOM, r);
  }
  const r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  const z =
    r <= 5
      ? horner(QUANTILE_MIDDLE_TOP, r - 1.6) / horner(QUANTILE_MIDDLE_BOTTOM, r - 1.6)
      : horner(QUANTILE_TAIL_TOP, r - 5) / horner(QUANTILE_TAIL_BOTTOM, r - 5);
  return q < 0 ? -z : z;
}

// u - ln(1 + u) for u > -1, without cancellation near 0. `ratio` is 1 + u computed directly, for u close to -1.
function logDeficit(u, ratio) {
  if (u < -0.5) return u - Math.log(ratio);
  if (u < -0.4 || u > 0.4) return u - Math.log1p(u);
  const r = u / (2 + u),
    t = r * r;
  let series = 0; // 1/3 + t/5 + t^2/7 + ..., from ln(1 + u) = 2 atanh(r)
  for (let k = 14; k >= 0; k--) series = series * t + 1 / (2 * k + 3);
  return r * (u - 2 * t * series);
}

// ln B(a, b) = ln gamma(a) + ln gamma(b) - ln gamma(a + b) for a, b > 0, stable when one argument is large.
function logBeta(a, b) {
  const small = Math.min(a, b),
    large = Math.max(a, b);
  if (large < 10) return logGamma(small) + logGamma(large) - logGamma(small + large);
  const total = small + large; // ln gamma(total) - ln gamma(large) by Stirling, term by term
  return (
    logGamma(small) -
    ((large - 0.5) * Math.log1p(small / large) +
      small * (Math.log(total) - 1) +
      stirlingTail(total) -
      stirlingTail(large))
  );
}

// x^a y^b / B(a, b) for 0 < x < 1 with y = 1 - x. For large a and b the exponent is built around the mean
// a / (a + b), so nothing of size a + b is cancelled.
function betaPrefix(x, y, a, b) {
  if (a >= 10 && b >= 10) {
    const total = a + b,
      lambda = x * b - y * a; // (a + b) (x - a / (a + b))
    const exponent = -(a * logDeficit(lambda / a, (x * total) / a) + b * logDeficit(-lambda / b, (y * total) / b));
    return (
      Math.sqrt(a / TWO_PI) *
      Math.sqrt(b / total) *
      Math.exp(exponent + stirlingTail(total) - stirlingTail(a) - stirlingTail(b))
    );
  }
  const logX = x > 0.5 ? Math.log1p(-y) : Math.log(x);
  const logY = y > 0.5 ? Math.log1p(-x) : Math.log(y);
  return Math.exp(a * logX + b * logY - logBeta(a, b));
}

// The even part of the continued fraction of the incomplete beta function (DLMF 8.17.22 with its terms taken in
// pairs, the form Boost uses), by modified Lentz: I_x(a, b) = x^a y^b / (B(a, b) * fraction). It reads y = 1 - x
// as given, so the quantity a y - b x + 1 that steers convergence keeps its digits when x is close to 1 (a large a
// with x rounded to 1 used to give probabilities above 1). It converges quickly for x < (a + 1) / (a + b + 2), where
// that quantity is at least 2x; null when it does not settle within MAX_STEPS.
function betaFraction(x, y, a, b) {
  const lead = a * y - b * x + 1;
  let f = (a / (a + 1)) * lead;
  if (Math.abs(f) < TINY) f = TINY;
  let c = f,
    d = 0;
  for (let m = 1; m <= MAX_STEPS; m++) {
    const shift = a + 2 * m - 1; // each product is formed so that nothing overflows for shapes up to the double limit
    const numerator = ((a + m - 1) / shift) * ((a + b + m - 1) * x) * (m * (((b - m) * x) / shift));
    const denominator = m + m * (((b - m) * x) / shift) + ((a + m) / (a + 2 * m + 1)) * (lead + m * (1 + y));
    d = denominator + numerator * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = denominator + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const factor = c * d;
    f *= factor;
    if (Math.abs(factor - 1) <= EPSILON) return f;
  }
  return null;
}

// [I_x(a, b), 1 - I_x(a, b), x^a y^b / B(a, b)] for 0 <= x <= 1 with y = 1 - x given by the caller (so a caller
// that knows the complement exactly loses nothing near x = 1); null when the continued fraction fails.
function betaCore(x, y, a, b) {
  if (x <= 0) return [0, 1, 0];
  if (y <= 0) return [1, 0, 0];
  if (!(a + b < Infinity)) return null; // shapes whose sum overflows are far beyond the continued fraction anyway
  const prefix = betaPrefix(x, y, a, b);
  // x < (a + 1) / (a + b + 2), tested on the smaller of x and y so that a rounded x near 1 cannot decide it
  const lowerTail = x <= 0.5 ? x * (a + b + 2) <= a + 1 : y * (a + b + 2) >= b + 1;
  if (lowerTail) {
    const fraction = prefix > 0 ? betaFraction(x, y, a, b) : Infinity;
    if (fraction === null) return null;
    const lower = Math.min(1, prefix / fraction);
    return [lower, 1 - lower, prefix];
  }
  const fraction = prefix > 0 ? betaFraction(y, x, b, a) : Infinity;
  if (fraction === null) return null;
  const upper = Math.min(1, prefix / fraction);
  return [1 - upper, upper, prefix];
}

// ---------- discrete distributions ----------

// ln(n!) - ((n + 1/2) ln n - n + ln sqrt(2 pi)) for an integer n >= 1: what Stirling's formula leaves out.
function stirlingError(n) {
  return n >= 10 ? stirlingTail(n) : logGamma(n + 1) - ((n + 0.5) * Math.log(n) - n + LN_SQRT_2PI);
}

// x ln(x / mean) + mean - x for x > 0 and mean >= 0: the deviance term of C. Loader's saddle-point form.
function deviance(x, mean) {
  return x * logDeficit((mean - x) / x, mean / x);
}

// C(n, k) p^k q^(n - k) for integers 0 <= k <= n with q = 1 - p given by the caller (Loader's algorithm, as in R's
// dbinom), so no factorial or power is ever formed.
function binomialTerm(k, n, p, q) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (q <= 0) return k === n ? 1 : 0;
  if (k === 0) return Math.exp(n * (p < 0.5 ? Math.log1p(-p) : Math.log(q)));
  if (k === n) return Math.exp(n * (q < 0.5 ? Math.log1p(-q) : Math.log(p)));
  const m = n - k;
  const exponent = stirlingError(n) - stirlingError(k) - stirlingError(m) - deviance(k, n * p) - deviance(m, n * q);
  return Math.sqrt(n / (TWO_PI * k * m)) * Math.exp(exponent);
}

// Whether k, n and p are an integer, a count and a probability.
const binomialArguments = (k, n, p) => isInt(k) && isCount(n) && isProbability(p);

// The binomial P[X <= k] for n trials with success probability p; 0 for k < 0 and 1 for k >= n. null when k is not
// an integer, n is not a count or p is not a probability.
export function binomialCdf(k, n, p) {
  if (!binomialArguments(k, n, p)) return null;
  if (k < 0) return 0;
  if (k >= n) return 1;
  const core = betaCore(1 - p, p, n - k, k + 1);
  return core && core[0];
}

// The hypergeometric P[X = k]: k successes in `draws` draws without replacement from `population` items of which
// `successes` are successes. 0 for an integer k outside the possible range. null when k is not an integer, the
// others are not counts, or successes or draws exceed population.
export function hypergeometricPmf(k, population, successes, draws) {
  if (
    !isInt(k) ||
    !isCount(population) ||
    !isCount(successes) ||
    !isCount(draws) ||
    successes > population ||
    draws > population
  )
    return null;
  const failures = population - successes;
  if (k < 0 || k > draws || k > successes || draws - k > failures) return 0;
  if (draws === 0) return 1;
  const p = draws / population,
    q = (population - draws) / population;
  return (
    (binomialTerm(k, successes, p, q) * binomialTerm(draws - k, failures, p, q)) / binomialTerm(draws, population, p, q)
  );
}

// ---------- descriptive statistics ----------

// Whether values is a nonempty array of finite numbers (a hole in a sparse array is not a number).
function isList(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  for (let i = 0; i < values.length; i++) if (!isNum(values[i])) return false;
  return true;
}

// A sorted copy of a checked list.
const sorted = (values) => values.slice().sort((a, b) => a - b);

// a + fraction * (b - a) for a <= b, without overflow when b - a does not fit a double.
function between(a, b, fraction) {
  const value = a + fraction * (b - a);
  return Number.isFinite(value) ? value : a * (1 - fraction) + b * fraction;
}

// The median of a list (the mean of the two middle values for an even count); null for an empty list, a non-array
// or a non-finite entry.
export function median(values) {
  if (!isList(values)) return null;
  const ordered = sorted(values),
    half = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[half] : between(ordered[half - 1], ordered[half], 0.5);
}
