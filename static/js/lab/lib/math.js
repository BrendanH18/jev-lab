// Numerics for Lab packs: special functions, the usual probability distributions, descriptive statistics, decimal
// rounding and seeded randomness. Pure code: it imports nothing and touches no DOM, storage or network.
// jev/lab/mathx.py is the same library for Python (snake_case names); both are tested against one reference table.
//
// Arguments: every number must be a finite number (typeof "number"; no NaN, no infinities, no numeric strings), and
// a list must be an array of such numbers. An argument outside a function's domain gives null. Nothing throws, and
// no function returns NaN or an infinity: a result too large for a double is null as well.
//
// Accuracy: relative error is at most 1e-10 over ordinary ranges and usually below 1e-13. The weaker regions are:
//   - a probability that is the complement of a tiny one is right to about 1e-16 absolute, so use the function that
//     returns the tail you want (normalSf, chiSquareSf, studentTSf, binomialSf, incompleteGammaQ) and not 1 - cdf;
//   - incompleteGammaQ and chiSquareSf with a shape below 0.1 and x below 1 are a difference from 1;
//   - normalCdf and normalSf beyond |z| = 30 lose digits in proportion to z * z (about 3e-13 at |z| = 38);
//   - results below 2.3e-308 (subnormal) keep fewer digits;
//   - shapes, degrees of freedom and counts above 1e9 lose about one digit per factor of 100, and a continued
//     fraction or series that would need more than 500,000 steps (shapes beyond roughly 1e10) gives null.

const EPSILON = 2.220446049250313e-16;       // 2^-52
const TINY = 1e-300;                         // keeps the continued fractions away from a division by zero
const TWO_PI = 6.283185307179586;
const LN_SQRT_2PI = 0.9189385332046728;      // ln sqrt(2 pi)
const INV_SQRT_PI = 0.5641895835477563;      // 1 / sqrt(pi)
const ONE_MINUS_EULER = 0.42278433509846713; // 1 - Euler's constant
const LOG_HALF = -0.6931471805599453;        // ln(1/2)
const LOG_MIN = -744.4400719213812;          // ln of the smallest positive double
const MAX_STEPS = 500000;                    // ceiling for one continued fraction or series

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
export function isProbability(x) {
  return isNum(x) && x >= 0 && x <= 1;
}

// true for a nonnegative integer no larger than 2^53 - 1; false for anything else.
export function isCount(x) {
  return isInt(x) && x >= 0;
}

// x limited to [low, high]. The bounds may be infinite ("no bound"); null when x is not finite, a bound is NaN,
// low > high, or the result is not finite.
export function clamp(x, low, high) {
  if (!isNum(x) || typeof low !== "number" || typeof high !== "number" || !(low <= high)) return null;
  return finite(Math.min(Math.max(x, low), high));
}

// ln(p / (1 - p)) for 0 < p < 1, accurate near 0, 1/2 and 1; null otherwise (the ends are infinite).
export function logit(p) {
  if (!isNum(p) || p <= 0 || p >= 1) return null;
  if (p < 0.25) return Math.log(p) - Math.log1p(-p);
  if (p > 0.75) return Math.log1p(p - 1) - Math.log(1 - p);
  return 2 * Math.atanh(2 * p - 1);
}

// 1 / (1 + e^-x), the inverse of logit, without overflow; rounds to exactly 0 or 1 far out (|x| above about 745
// and 37). null for a non-finite x.
export function expit(x) {
  if (!isNum(x)) return null;
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

// x rounded to `digits` decimal places (negative digits round to tens, hundreds, ...), halves away from zero. It
// rounds the shortest decimal text of x, so round(1.005, 2) is 1.01 and round(-2.5) is -3. null when x is not
// finite, digits is not an integer, or the result overflows.
export function round(x, digits = 0) {
  if (!isNum(x) || !isInt(digits)) return null;
  if (x === 0) return 0;
  const [mantissa, exponentText] = Math.abs(x).toExponential().split("e");
  const figures = mantissa.replace(".", "");
  const exponent = Number(exponentText) - (figures.length - 1);   // |x| = figures * 10^exponent
  const drop = -exponent - digits;                                 // how many trailing figures go
  if (drop <= 0) return x;
  if (drop > figures.length) return 0;
  let kept = BigInt(figures.slice(0, figures.length - drop) || "0");
  if (figures.charCodeAt(figures.length - drop) >= 53) kept += 1n;  // the first dropped figure is 5 or more
  const value = Number(`${kept}e${exponent + drop}`);
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : (x < 0 ? -value : value);
}

// ---------- special functions ----------

// (-1)^k (zeta(k) - 1) / k for k = 2..30: the series of ln gamma(2 + w) after its linear term.
const LOG_GAMMA_SERIES = [3.1044247747322276e-11, -6.4229645638381e-11, 1.330476437424449e-10, -2.7595228851242334e-10,
  5.731367241678862e-10, -1.1921401405860912e-09, 2.4836745438024785e-09, -5.183475041970047e-09, 1.0838659214896955e-08,
  -2.2711094608943164e-08, 4.7698101693639804e-08, -1.0043224823968099e-07, 2.1207184805554665e-07, -4.492469198764566e-07,
  9.55141213040742e-07, -2.039215753801366e-06, 4.374866789907488e-06, -9.439488275268397e-06, 2.050721277567069e-05,
  -4.492623673813314e-05, 9.945751278180853e-05, -0.00022315475845357939, 0.0005096695247430425, -0.001192753911703261,
  0.0028905103307415234, -0.007385551028673986, 0.020580808427784546, -0.0673523010531981, 0.3224670334241132];

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
export function logGamma(x) {
  if (!isNum(x) || x <= 0) return null;
  if (x < 0.5) return logGammaNearTwo(x) - Math.log1p(x) - Math.log(x);   // gamma(x) = gamma(2 + x) / (x (1 + x))
  if (x < 1.5) return logGammaNearTwo(x - 1) - Math.log1p(x - 1);
  if (x <= 2.5) return logGammaNearTwo(x - 2);
  if (x < 10) {
    let z = x, product = 1;
    while (z > 2.5) { z -= 1; product *= z; }
    return logGammaNearTwo(z - 2) + Math.log(product);
  }
  return finite((x - 0.5) * Math.log(x) - x + LN_SQRT_2PI + stirlingTail(x));
}

// ln(n!) for a count n; null otherwise.
export function logFactorial(n) {
  return isCount(n) ? logGamma(n + 1) : null;
}

// ln of the binomial coefficient C(n, k) for counts k <= n, without subtracting huge logarithms (right for n up to
// 2^53 - 1); null otherwise.
export function logChoose(n, k) {
  if (!isCount(n) || !isCount(k) || k > n) return null;
  const j = Math.min(k, n - k), m = n - j;
  if (j < 30) {
    let total = 0;
    for (let i = 1; i <= j; i++) total += Math.log((m + i) / i);
    return total;
  }
  return j * Math.log(n / j) - m * Math.log1p(-j / n) + 0.5 * Math.log(n / j / m / TWO_PI)
    + stirlingTail(n) - stirlingTail(j) - stirlingTail(m);
}

const CHOOSE_LIMIT = 2n ** 1024n;

// The binomial coefficient C(n, k) for counts k <= n: the exact integer up to 2^53, the correctly rounded double
// above it, and null when it overflows a double (or for other arguments). Use logChoose for large values.
export function choose(n, k) {
  if (!isCount(n) || !isCount(k) || k > n) return null;
  const j = Math.min(k, n - k);
  if (j >= 1024) return null;   // C(n, j) >= 2^j
  const base = BigInt(n - j);
  let value = 1n;
  for (let i = 1; i <= j; i++) {
    value = value * (base + BigInt(i)) / BigInt(i);   // always divides exactly: value is C(n - j + i, i)
    if (value >= CHOOSE_LIMIT) return null;
  }
  return finite(Number(value));
}

// W. J. Cody's rational approximations (Math. Comp. 23, 1969; SPECFUN's CALERF), good to a few units in the last place.
const ERF_SMALL_TOP = [1.85777706184603153e-1, 3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3];
const ERF_SMALL_BOTTOM = [1, 2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
const ERFC_MIDDLE_TOP = [2.15311535474403846e-8, 5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1,
  2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3];
const ERFC_MIDDLE_BOTTOM = [1, 1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
  3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
const ERFC_FAR_TOP = [1.63153871373020978e-2, 3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1,
  1.60837851487422766e-2, 6.58749161529837803e-4];
const ERFC_FAR_BOTTOM = [1, 2.56852019228982242e0, 1.87295284992346725e0, 5.27905102951428412e-1, 6.05183413124413191e-2,
  2.33520497626869185e-3];

// erf(y) for 0 <= y <= 0.46875.
function erfSmall(y) {
  const square = y * y;
  return y * horner(ERF_SMALL_TOP, square) / horner(ERF_SMALL_BOTTOM, square);
}

// erfc(y) for y > 0.46875. exp(-y * y) is taken in two factors so the rounding of y * y does not reach the result.
function erfcLarge(y) {
  let ratio;
  if (y <= 4) ratio = horner(ERFC_MIDDLE_TOP, y) / horner(ERFC_MIDDLE_BOTTOM, y);
  else {
    const inverse = 1 / (y * y);
    ratio = (INV_SQRT_PI - inverse * horner(ERFC_FAR_TOP, inverse) / horner(ERFC_FAR_BOTTOM, inverse)) / y;
  }
  const head = Math.floor(y * 16) / 16;
  return Math.exp(-head * head) * Math.exp(-(y - head) * (y + head)) * ratio;
}

// The error function erf(x), odd in x and within (-1, 1) (rounds to +-1 beyond |x| = 5.93); null for a non-finite x.
export function erf(x) {
  if (!isNum(x)) return null;
  const y = Math.abs(x);
  if (y <= 0.46875) return x < 0 ? -erfSmall(y) : erfSmall(y);
  const value = 0.5 - erfcLarge(y) + 0.5;
  return x < 0 ? -value : value;
}

// The complementary error function 1 - erf(x), with full relative accuracy in the right tail (0 beyond x = 27.3);
// null for a non-finite x.
export function erfc(x) {
  if (!isNum(x)) return null;
  const y = Math.abs(x);
  if (y <= 0.46875) return 1 - (x < 0 ? -erfSmall(y) : erfSmall(y));
  return x < 0 ? 2 - erfcLarge(y) : erfcLarge(y);
}

// The standard normal density exp(-z^2 / 2) / sqrt(2 pi) (0 beyond |z| = 38.6); null for a non-finite z.
export function normalPdf(z) {
  if (!isNum(z)) return null;
  const y = Math.abs(z), head = Math.floor(y * 16) / 16;
  return Math.exp(-0.5 * head * head) * Math.exp(-0.5 * (y - head) * (y + head)) * (INV_SQRT_PI * Math.SQRT1_2);
}

// The standard normal P[Z <= z], with relative accuracy in the left tail; null for a non-finite z.
export function normalCdf(z) {
  return isNum(z) ? 0.5 * erfc(-z * Math.SQRT1_2) : null;
}

// The standard normal P[Z >= z], with relative accuracy in the right tail; null for a non-finite z.
export function normalSf(z) {
  return isNum(z) ? 0.5 * erfc(z * Math.SQRT1_2) : null;
}

// M. J. Wichura's algorithm AS 241 (Applied Statistics 37, 1988), the one Python's statistics.NormalDist uses.
const QUANTILE_CENTRE_TOP = [2.5090809287301226727e3, 3.3430575583588128105e4, 6.7265770927008700853e4, 4.5921953931549871457e4,
  1.3731693765509461125e4, 1.9715909503065514427e3, 1.3314166789178437745e2, 3.3871328727963666080e0];
const QUANTILE_CENTRE_BOTTOM = [5.2264952788528545610e3, 2.8729085735721942674e4, 3.9307895800092710610e4, 2.1213794301586595867e4,
  5.3941960214247511077e3, 6.8718700749205790830e2, 4.2313330701600911252e1, 1];
const QUANTILE_MIDDLE_TOP = [7.74545014278341407640e-4, 2.27238449892691845833e-2, 2.41780725177450611770e-1, 1.27045825245236838258e0,
  3.64784832476320460504e0, 5.76949722146069140550e0, 4.63033784615654529590e0, 1.42343711074968357734e0];
const QUANTILE_MIDDLE_BOTTOM = [1.05075007164441684324e-9, 5.47593808499534494600e-4, 1.51986665636164571966e-2, 1.48103976427480074590e-1,
  6.89767334985100004550e-1, 1.67638483018380384940e0, 2.05319162663775882187e0, 1];
const QUANTILE_TAIL_TOP = [2.01033439929228813265e-7, 2.71155556874348757815e-5, 1.24266094738807843860e-3, 2.65321895265761230930e-2,
  2.96560571828504891230e-1, 1.78482653991729133580e0, 5.46378491116411436990e0, 6.65790464350110377720e0];
const QUANTILE_TAIL_BOTTOM = [2.04426310338993978564e-15, 1.42151175831644588870e-7, 1.84631831751005468180e-5, 7.86869131145613259100e-4,
  1.48753612908506148525e-2, 1.36929880922735805310e-1, 5.99832206555887937690e-1, 1];

// The standard normal quantile: z with P[Z <= z] = p, for 0 < p < 1 (accurate to about 1e-15 relative; a p within
// 1e-16 of 1 has already lost its tail). null for p <= 0, p >= 1 or a non-finite p.
export function normalQuantile(p) {
  if (!isNum(p) || p <= 0 || p >= 1) return null;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return q * horner(QUANTILE_CENTRE_TOP, r) / horner(QUANTILE_CENTRE_BOTTOM, r);
  }
  const r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  const z = r <= 5 ? horner(QUANTILE_MIDDLE_TOP, r - 1.6) / horner(QUANTILE_MIDDLE_BOTTOM, r - 1.6)
    : horner(QUANTILE_TAIL_TOP, r - 5) / horner(QUANTILE_TAIL_BOTTOM, r - 5);
  return q < 0 ? -z : z;
}

// u - ln(1 + u) for u > -1, without cancellation near 0. `ratio` is 1 + u computed directly, for u close to -1.
function logDeficit(u, ratio) {
  if (u < -0.5) return u - Math.log(ratio);
  if (u < -0.4 || u > 0.4) return u - Math.log1p(u);
  const r = u / (2 + u), t = r * r;
  let series = 0;   // 1/3 + t/5 + t^2/7 + ..., from ln(1 + u) = 2 atanh(r)
  for (let k = 14; k >= 0; k--) series = series * t + 1 / (2 * k + 3);
  return r * (u - 2 * t * series);
}

// ln B(a, b) = ln gamma(a) + ln gamma(b) - ln gamma(a + b) for a, b > 0, stable when one argument is large.
function logBeta(a, b) {
  const small = Math.min(a, b), large = Math.max(a, b);
  if (large < 10) return logGamma(small) + logGamma(large) - logGamma(small + large);
  const total = small + large;   // ln gamma(total) - ln gamma(large) by Stirling, term by term
  return logGamma(small) - ((large - 0.5) * Math.log1p(small / large) + small * (Math.log(total) - 1)
    + stirlingTail(total) - stirlingTail(large));
}

// x^a y^b / B(a, b) for 0 < x < 1 with y = 1 - x. For large a and b the exponent is built around the mean
// a / (a + b), so nothing of size a + b is cancelled.
function betaPrefix(x, y, a, b) {
  if (a >= 10 && b >= 10) {
    const total = a + b, lambda = x * b - y * a;   // (a + b) (x - a / (a + b))
    const exponent = -(a * logDeficit(lambda / a, x * total / a) + b * logDeficit(-lambda / b, y * total / b));
    return Math.sqrt(a / TWO_PI) * Math.sqrt(b / total) * Math.exp(exponent + stirlingTail(total) - stirlingTail(a) - stirlingTail(b));
  }
  const logX = x > 0.5 ? Math.log1p(-y) : Math.log(x);
  const logY = y > 0.5 ? Math.log1p(-x) : Math.log(y);
  return Math.exp(a * logX + b * logY - logBeta(a, b));
}

// The continued fraction of the incomplete beta function (modified Lentz), which converges quickly for
// x < (a + 1) / (a + b + 2); null when it does not settle within MAX_STEPS.
function betaFraction(x, a, b) {
  const total = a + b;
  let c = 1, d = 1 - total * x / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_STEPS; m++) {
    const even = (m / (a - 1 + 2 * m)) * ((b - m) / (a + 2 * m)) * x;
    d = 1 + even * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + even / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    const odd = -((a + m) / (a + 2 * m)) * ((total + m) / (a + 1 + 2 * m)) * x;
    d = 1 + odd * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + odd / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const factor = d * c;
    h *= factor;
    if (Math.abs(factor - 1) <= EPSILON) return h;
  }
  return null;
}

// [I_x(a, b), 1 - I_x(a, b), x^a y^b / B(a, b)] for 0 <= x <= 1 with y = 1 - x given by the caller (so a caller
// that knows the complement exactly loses nothing near x = 1); null when the continued fraction fails.
function betaCore(x, y, a, b) {
  if (x <= 0) return [0, 1, 0];
  if (y <= 0) return [1, 0, 0];
  const prefix = betaPrefix(x, y, a, b);
  if (x * (a + b + 2) <= a + 1) {
    const fraction = prefix > 0 ? betaFraction(x, a, b) : 0;
    if (fraction === null) return null;
    const lower = Math.min(1, prefix * fraction / a);
    return [lower, 1 - lower, prefix];
  }
  const fraction = prefix > 0 ? betaFraction(y, b, a) : 0;
  if (fraction === null) return null;
  const upper = Math.min(1, prefix * fraction / b);
  return [1 - upper, upper, prefix];
}

// The regularized incomplete beta function I_x(a, b) for 0 <= x <= 1 and a, b > 0 (the Beta(a, b) distribution
// function); null otherwise, and null when a and b are too large for the continued fraction (see the file header).
export function incompleteBeta(x, a, b) {
  if (!isProbability(x) || !isNum(a) || !isNum(b) || a <= 0 || b <= 0) return null;
  const core = betaCore(x, 1 - x, a, b);
  return core && core[0];
}

// The root of a monotone function h on [low, high] by Newton steps kept inside a shrinking bracket, with a bisection
// whenever a step leaves the bracket or fails to halve the previous one. evaluate(t) returns [h, dh/dt], or null to
// give up. `relative` picks the step tolerance: relative to t, or absolute for a logarithmic variable.
function solveMonotone(evaluate, low, high, start, increasing, relative) {
  let lo = low, hi = high, t = Math.min(Math.max(start, lo), hi);
  if (!(t >= lo && t <= hi)) t = 0.5 * (lo + hi);
  let best = t, bestError = Infinity, previous = hi - lo;
  for (let i = 0; i < 300; i++) {
    const result = evaluate(t);
    if (result === null || Number.isNaN(result[0])) return null;
    const [h, slope] = result;
    const error = Math.abs(h);
    if (error < bestError) { bestError = error; best = t; }
    if (error <= 8 * EPSILON) return t;
    if ((h < 0) === increasing) lo = t; else hi = t;
    let next = t - h / slope;
    if (!(next > lo && next < hi) || Math.abs(next - t) > 0.5 * Math.abs(previous)) next = 0.5 * (lo + hi);
    const step = next - t;
    if (Math.abs(step) <= 4 * EPSILON * (relative ? Math.abs(next) : Math.max(1, Math.abs(next)))) return next;
    previous = step;
    t = next;
  }
  return best;
}

// A starting value for the Beta(a, b) quantile when a, b >= 1 (Abramowitz and Stegun 26.5.22).
function betaGuess(p, a, b) {
  const z = -normalQuantile(p), lambda = (z * z - 3) / 6;
  const ha = 1 / (2 * a - 1), hb = 1 / (2 * b - 1), h = 2 / (ha + hb);
  const w = z * Math.sqrt(h + lambda) / h - (hb - ha) * (lambda + 5 / 6 - 2 / (3 * h));
  return a / (a + b * Math.exp(2 * w));
}

// v in (0, 1/2] with I_v(a, b) = target, or with I_(1 - v)(a, b) = target when `mirrored`. It works on ln v, where
// the tail is close to a straight line, so a root near 0 keeps its relative accuracy.
function betaRoot(target, a, b, mirrored) {
  const evaluate = (w) => {
    const v = Math.exp(w);
    const core = mirrored ? betaCore(1 - v, v, a, b) : betaCore(v, 1 - v, a, b);
    if (core === null) return null;
    if (!(core[0] > 0)) return [-Infinity, NaN];
    const slope = core[2] / ((1 - v) * core[0]);
    return [Math.log(core[0] / target), mirrored ? -slope : slope];
  };
  let guess;
  if (a >= 1 && b >= 1) guess = Math.log(mirrored ? 1 - betaGuess(target, a, b) : betaGuess(target, a, b));
  else if (mirrored) guess = (Math.log((1 - target) * b) + logBeta(a, b)) / b;
  else guess = (Math.log(target * a) + logBeta(a, b)) / a;
  const w = solveMonotone(evaluate, LOG_MIN, LOG_HALF, guess, !mirrored, false);
  return w === null ? null : Math.exp(w);
}

// [x, 1 - x] with I_x(a, b) = p for 0 <= p <= 1, each computed directly so neither loses digits; null on failure.
function betaQuantilePair(p, a, b) {
  if (p <= 0) return [0, 1];
  if (p >= 1) return [1, 0];
  const middle = betaCore(0.5, 0.5, a, b);
  if (middle === null) return null;
  let x, y;
  if (p <= middle[0]) {
    x = betaRoot(p, a, b, false);
    y = x === null ? null : 1 - x;
  } else {
    y = p >= 0.5 ? betaRoot(1 - p, b, a, false) : betaRoot(p, a, b, true);
    x = y === null ? null : 1 - y;
  }
  return x === null || y === null ? null : [x, y];
}

// The Beta(a, b) quantile: x in [0, 1] with I_x(a, b) = p, for 0 <= p <= 1 and a, b > 0 (0 at p = 0, 1 at p = 1; a
// root closer to 0 or 1 than a double can hold rounds to 0 or 1). null otherwise.
export function betaQuantile(p, a, b) {
  if (!isProbability(p) || !isNum(a) || !isNum(b) || a <= 0 || b <= 0) return null;
  const pair = betaQuantilePair(p, a, b);
  return pair && pair[0];
}

// x^a e^-x / gamma(a) for a, x > 0; for large a the exponent is built around x = a, so nothing of size a is cancelled.
function gammaPrefix(a, x) {
  if (a >= 10) return Math.sqrt(a / TWO_PI) * Math.exp(-a * logDeficit((x - a) / a, x / a) - stirlingTail(a));
  return Math.exp(a * Math.log(x) - x - logGamma(a));
}

// [P(a, x), Q(a, x), x^a e^-x / gamma(a)] for a > 0 and x >= 0: the series below x = a + 1, the continued fraction
// (modified Lentz) above it; null when either does not settle within MAX_STEPS.
function gammaCore(a, x) {
  if (x <= 0) return [0, 1, 0];
  const prefix = gammaPrefix(a, x);
  if (!(prefix > 0)) return x < a + 1 ? [0, 1, 0] : [1, 0, 0];
  if (x < a + 1) {
    let term = 1 / a, total = term;
    for (let n = 1; n <= MAX_STEPS; n++) {
      term *= x / (a + n);
      total += term;
      if (term <= total * EPSILON) {
        const lower = Math.min(1, prefix * total);
        return [lower, 1 - lower, prefix];
      }
    }
    return null;
  }
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let n = 1; n <= MAX_STEPS; n++) {
    const numerator = -n * (n - a);
    b += 2;
    d = numerator * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const factor = d * c;
    h *= factor;
    if (Math.abs(factor - 1) <= EPSILON) {
      const upper = Math.min(1, prefix * h);
      return [1 - upper, upper, prefix];
    }
  }
  return null;
}

// The regularized lower incomplete gamma function P(a, x) for a > 0 and x >= 0 (the Gamma(a) distribution function);
// null otherwise.
export function incompleteGammaP(a, x) {
  if (!isNum(a) || !isNum(x) || a <= 0 || x < 0) return null;
  const core = gammaCore(a, x);
  return core && core[0];
}

// The regularized upper incomplete gamma function Q(a, x) = 1 - P(a, x) for a > 0 and x >= 0, with relative accuracy
// in the right tail; null otherwise.
export function incompleteGammaQ(a, x) {
  if (!isNum(a) || !isNum(x) || a <= 0 || x < 0) return null;
  const core = gammaCore(a, x);
  return core && core[1];
}

// x > 0 with P(a, x) = p for 0 < p < 1 and a > 0; null on failure. Below the middle it works on ln x with ln P,
// above it on x with ln Q: each tail is close to a straight line in that variable.
function gammaQuantile(p, a) {
  const middle = gammaCore(a, a);
  if (middle === null) return null;
  const cube = 1 - 1 / (9 * a) + normalQuantile(p) / (3 * Math.sqrt(a));   // Wilson and Hilferty's approximation
  const guess = a >= 1 && cube > 0 ? a * cube * cube * cube : 0;
  if (p <= middle[0]) {
    const evaluate = (w) => {
      const core = gammaCore(a, Math.exp(w));
      if (core === null) return null;
      return core[0] > 0 ? [Math.log(core[0] / p), core[2] / core[0]] : [-Infinity, NaN];
    };
    const start = guess > 0 ? Math.log(guess) : (Math.log(p) + logGamma(a + 1)) / a;
    const w = solveMonotone(evaluate, LOG_MIN, Math.log(a), start, true, false);
    return w === null ? null : Math.exp(w);
  }
  const q = 1 - p;
  let high = 2 * Math.max(a, 1);
  for (let i = 0; i < 64; i++) {
    const core = gammaCore(a, high);
    if (core === null) return null;
    if (core[1] <= q) break;
    high *= 2;
  }
  const evaluate = (x) => {
    const core = gammaCore(a, x);
    if (core === null) return null;
    return core[1] > 0 ? [Math.log(core[1] / q), -core[2] / (x * core[1])] : [-Infinity, NaN];
  };
  return solveMonotone(evaluate, a, high, guess, false, true);
}

// The chi-square P[X <= x] for df > 0 degrees of freedom (df need not be an integer); 0 for x <= 0. null otherwise.
export function chiSquareCdf(x, df) {
  if (!isNum(x) || !isNum(df) || df <= 0) return null;
  const core = gammaCore(0.5 * df, 0.5 * x);
  return core && core[0];
}

// The chi-square P[X >= x] for df > 0, with relative accuracy in the right tail; 1 for x <= 0. null otherwise.
export function chiSquareSf(x, df) {
  if (!isNum(x) || !isNum(df) || df <= 0) return null;
  const core = gammaCore(0.5 * df, 0.5 * x);
  return core && core[1];
}

// The chi-square quantile: x with P[X <= x] = p, for 0 <= p < 1 and df > 0 (0 at p = 0). null otherwise (p = 1 is
// infinite).
export function chiSquareQuantile(p, df) {
  if (!isNum(p) || !isNum(df) || p < 0 || p >= 1 || df <= 0) return null;
  if (p === 0) return 0;
  const x = gammaQuantile(p, 0.5 * df);
  return x === null ? null : finite(2 * x);
}

// [P[T >= |t|], P[0 <= T <= |t|]] for Student's t with df degrees of freedom; null when the beta function fails.
function studentHalves(t, df) {
  const square = t * t;
  let x, y;   // x = df / (df + t^2) and y = 1 - x, each formed without cancellation
  if (square > df) {
    const r = df / square;
    x = r / (1 + r);
    y = 1 / (1 + r);
  } else {
    const r = square / df;
    x = 1 / (1 + r);
    y = r / (1 + r);
  }
  const core = betaCore(x, y, 0.5 * df, 0.5);
  return core && [0.5 * core[0], 0.5 * core[1]];
}

// Student's t P[T <= t] for df > 0 degrees of freedom (df need not be an integer), with relative accuracy in the
// left tail; null otherwise.
export function studentTCdf(t, df) {
  if (!isNum(t) || !isNum(df) || df <= 0) return null;
  const halves = studentHalves(t, df);
  return halves && (t > 0 ? 0.5 + halves[1] : halves[0]);
}

// Student's t P[T >= t] for df > 0, with relative accuracy in the right tail; null otherwise.
export function studentTSf(t, df) {
  if (!isNum(t) || !isNum(df) || df <= 0) return null;
  const halves = studentHalves(t, df);
  return halves && (t < 0 ? 0.5 + halves[1] : halves[0]);
}

// Student's t quantile: t with P[T <= t] = p, for 0 < p < 1 and df > 0. null otherwise, and null when the quantile
// overflows a double (tiny df with p near 0 or 1).
export function studentTQuantile(p, df) {
  if (!isNum(p) || !isNum(df) || p <= 0 || p >= 1 || df <= 0) return null;
  if (p === 0.5) return 0;
  const pair = betaQuantilePair(2 * (p < 0.5 ? p : 1 - p), 0.5 * df, 0.5);
  if (pair === null) return null;
  const t = Math.sqrt(df) * Math.sqrt(pair[1] / pair[0]);
  return finite(p < 0.5 ? -t : t);
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

// The binomial P[X = k] for n trials with success probability p; 0 for an integer k outside 0..n. null when k is
// not an integer, n is not a count or p is not a probability.
export function binomialPmf(k, n, p) {
  if (!binomialArguments(k, n, p)) return null;
  return k < 0 || k > n ? 0 : binomialTerm(k, n, p, 1 - p);
}

// The binomial P[X <= k]; 0 for k < 0 and 1 for k >= n. null for the arguments binomialPmf rejects.
export function binomialCdf(k, n, p) {
  if (!binomialArguments(k, n, p)) return null;
  if (k < 0) return 0;
  if (k >= n) return 1;
  const core = betaCore(1 - p, p, n - k, k + 1);
  return core && core[0];
}

// The binomial P[X >= k] (k itself included), with relative accuracy in the right tail; 1 for k <= 0 and 0 for
// k > n. null for the arguments binomialPmf rejects.
export function binomialSf(k, n, p) {
  if (!binomialArguments(k, n, p)) return null;
  if (k <= 0) return 1;
  if (k > n) return 0;
  const core = betaCore(p, 1 - p, k, n - k + 1);
  return core && core[0];
}

// The hypergeometric P[X = k]: k successes in `draws` draws without replacement from `population` items of which
// `successes` are successes. 0 for an integer k outside the possible range. null when k is not an integer, the
// others are not counts, or successes or draws exceed population.
export function hypergeometricPmf(k, population, successes, draws) {
  if (!isInt(k) || !isCount(population) || !isCount(successes) || !isCount(draws) || successes > population || draws > population) return null;
  const failures = population - successes;
  if (k < 0 || k > draws || k > successes || draws - k > failures) return 0;
  if (draws === 0) return 1;
  const p = draws / population, q = (population - draws) / population;
  return binomialTerm(k, successes, p, q) * binomialTerm(draws - k, failures, p, q) / binomialTerm(draws, population, p, q);
}

// Whether k and mean are an integer and a nonnegative number.
const poissonArguments = (k, mean) => isInt(k) && isNum(mean) && mean >= 0;

// The Poisson P[X = k] for a mean >= 0; 0 for a negative integer k. null when k is not an integer or the mean is
// negative or not finite.
export function poissonPmf(k, mean) {
  if (!poissonArguments(k, mean)) return null;
  if (k < 0) return 0;
  if (mean === 0) return k === 0 ? 1 : 0;
  if (k === 0) return Math.exp(-mean);
  return Math.exp(-stirlingError(k) - deviance(k, mean)) / Math.sqrt(TWO_PI * k);
}

// The Poisson P[X <= k]; 0 for k < 0. null for the arguments poissonPmf rejects.
export function poissonCdf(k, mean) {
  if (!poissonArguments(k, mean)) return null;
  if (k < 0) return 0;
  const core = gammaCore(k + 1, mean);
  return core && core[1];
}

// The Poisson P[X >= k] (k itself included), with relative accuracy in the right tail; 1 for k <= 0. null for the
// arguments poissonPmf rejects.
export function poissonSf(k, mean) {
  if (!poissonArguments(k, mean)) return null;
  if (k <= 0) return 1;
  const core = gammaCore(k, mean);
  return core && core[0];
}

// ---------- descriptive statistics ----------

// Whether values is a nonempty array of finite numbers (a hole in a sparse array is not a number).
function isList(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  for (let i = 0; i < values.length; i++) if (!isNum(values[i])) return false;
  return true;
}

// Neumaier's compensated sum of a checked list; NaN or an infinity if the running total overflows.
function total(values) {
  let running = 0, carry = 0;
  for (const value of values) {
    const next = running + value;
    carry += Math.abs(running) >= Math.abs(value) ? (running - next) + value : (value - next) + running;
    running = next;
  }
  return running + carry;
}

// The sum of a list, compensated so rounding errors do not pile up (sum([0.1, 0.2, 0.3]) is 0.6). null for an empty
// list, a non-array, a non-finite entry, or a sum that overflows.
export function sum(values) {
  return isList(values) ? finite(total(values)) : null;
}

// The arithmetic mean of a list; null where sum is null.
export function mean(values) {
  return isList(values) ? finite(total(values) / values.length) : null;
}

// The variance of a list: the sample variance (divide by n - 1) by default, the population variance (divide by n)
// with sample = false. null where sum is null, for a sample of fewer than two values, or on overflow.
export function variance(values, sample = true) {
  if (!isList(values) || (sample && values.length < 2)) return null;
  const centre = total(values) / values.length;
  const deviations = values.map((value) => value - centre);
  const drift = total(deviations);   // zero in exact arithmetic; corrects the rounding of the mean
  const squares = total(deviations.map((d) => d * d)) - drift * drift / values.length;
  return finite(Math.max(0, squares) / (sample ? values.length - 1 : values.length));
}

// The standard deviation of a list: the square root of variance(values, sample); null where that is null.
export function stdev(values, sample = true) {
  const value = variance(values, sample);
  return value === null ? null : Math.sqrt(value);
}

// A sorted copy of a checked list.
const sorted = (values) => values.slice().sort((a, b) => a - b);

// a + fraction * (b - a) for a <= b, without overflow when b - a does not fit a double.
function between(a, b, fraction) {
  const value = a + fraction * (b - a);
  return Number.isFinite(value) ? value : a * (1 - fraction) + b * fraction;
}

// The median of a list (the mean of the two middle values for an even count); null where sum is null.
export function median(values) {
  if (!isList(values)) return null;
  const ordered = sorted(values), half = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[half] : between(ordered[half - 1], ordered[half], 0.5);
}

// The q-quantile of a list for 0 <= q <= 1, by linear interpolation between order statistics ("type 7", the default
// of R, NumPy and spreadsheets): quantile(v, 0) is the minimum, 0.5 the median, 1 the maximum. null where sum is
// null or when q is not a probability.
export function quantile(values, q) {
  if (!isList(values) || !isProbability(q)) return null;
  const ordered = sorted(values), position = (ordered.length - 1) * q, index = Math.floor(position);
  if (index >= ordered.length - 1) return ordered[ordered.length - 1];
  return between(ordered[index], ordered[index + 1], position - index);
}

// The smallest value of a list; null where sum is null.
export function minOf(values) {
  if (!isList(values)) return null;
  let low = values[0];
  for (const value of values) if (value < low) low = value;
  return low;
}

// The largest value of a list; null where sum is null.
export function maxOf(values) {
  if (!isList(values)) return null;
  let high = values[0];
  for (const value of values) if (value > high) high = value;
  return high;
}

// ---------- seeded randomness ----------

// A deterministic generator: a function that returns the next float in [0, 1) each time it is called (mulberry32,
// 32 bits of state, the same sequence as mathx.mulberry32 in Python). The seed is any integer up to 2^53 - 1 in
// size, taken modulo 2^32; null for any other seed. Not for secrets.
export function mulberry32(seed) {
  if (!isInt(seed)) return null;
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A shuffled copy of a list (Fisher-Yates driven by mulberry32(seed)); the input is not changed and the same seed
// always gives the same order, in JavaScript and Python. null when list is not an array or the seed is invalid.
export function shuffled(list, seed) {
  const random = mulberry32(seed);
  if (!Array.isArray(list) || random === null) return null;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// `size` distinct indexes drawn from 0..count - 1, in ascending order (Floyd's algorithm driven by
// mulberry32(seed)): a seeded sample without replacement that costs O(size) however large count is. null when count
// or size is not a count, size > count, count > 2^32, or the seed is invalid.
export function sampleIndexes(count, size, seed) {
  const random = mulberry32(seed);
  if (!isCount(count) || !isCount(size) || size > count || count > 4294967296 || random === null) return null;
  const chosen = new Set();
  for (let top = count - size; top < count; top++) {
    const pick = Math.floor(random() * (top + 1));
    chosen.add(chosen.has(pick) ? top : pick);
  }
  return Array.from(chosen).sort((a, b) => a - b);
}
