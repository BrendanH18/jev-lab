"""Numerics for Lab packs: special functions, the usual probability distributions, descriptive statistics, decimal
rounding and seeded randomness. Standard library only; nothing here touches files, the network or the model.

This is the Python twin of static/js/lab/lib/math.js, with the same algorithms, constants and domain rules under
snake_case names (logGamma is log_gamma, studentTCdf is student_t_cdf, minOf is min_of). Both libraries are tested
against one hard-coded reference table (tests/test_lab_mathx.py and tests/js/lab/lib-math.test.mjs); they agree to
the tolerances there, and mulberry32, shuffled and sample_indexes give exactly the same sequences for the same seed.

Arguments: every number must be a finite int or float (bool is not a number, and neither is a numeric string), and a
list must be a list or tuple of such numbers. An argument outside a function's domain gives None. Nothing raises for
an ordinary bad number, and no function returns NaN or an infinity: a result too large for a float is None as well.
Every numeric result is a float, as in JavaScript (choose(5, 2) is 10.0); sample_indexes gives ints.

Accuracy: relative error is at most 1e-10 over ordinary ranges and usually below 1e-13. The weaker regions are:
  - a probability that is the complement of a tiny one is right to about 1e-16 absolute, so use the function that
    returns the tail you want (normal_sf, chi_square_sf, student_t_sf, binomial_sf, incomplete_gamma_q) and not
    1 - cdf;
  - incomplete_gamma_q and chi_square_sf with a shape below 0.1 and x below 1 are a difference from 1;
  - normal_cdf and normal_sf beyond |z| = 30 lose digits in proportion to z * z (about 3e-13 at |z| = 38);
  - results below 2.3e-308 (subnormal) keep fewer digits;
  - shapes, degrees of freedom and counts above 1e9 lose about one digit per factor of 100, and a continued fraction
    or series that would need more than 500,000 steps (shapes beyond roughly 1e10) gives None.
The loops run in pure Python here, so those large shapes take up to a few seconds instead of milliseconds.
"""

from __future__ import annotations

import math
from decimal import Decimal
from typing import Callable, List, Optional, Sequence, Tuple

__all__ = [
    "is_probability", "is_count", "clamp", "logit", "expit", "round",
    "log_gamma", "log_factorial", "log_choose", "choose", "erf", "erfc",
    "normal_pdf", "normal_cdf", "normal_sf", "normal_quantile",
    "incomplete_beta", "beta_quantile", "incomplete_gamma_p", "incomplete_gamma_q",
    "chi_square_cdf", "chi_square_sf", "chi_square_quantile", "student_t_cdf", "student_t_sf", "student_t_quantile",
    "binomial_pmf", "binomial_cdf", "binomial_sf", "hypergeometric_pmf", "poisson_pmf", "poisson_cdf", "poisson_sf",
    "sum", "mean", "variance", "stdev", "median", "quantile", "min_of", "max_of",
    "mulberry32", "shuffled", "sample_indexes",
]

EPSILON = 2.220446049250313e-16        # 2^-52
TINY = 1e-300                          # keeps the continued fractions away from a division by zero
TWO_PI = 6.283185307179586
LN_SQRT_2PI = 0.9189385332046728       # ln sqrt(2 pi)
INV_SQRT_PI = 0.5641895835477563       # 1 / sqrt(pi)
SQRT1_2 = 0.7071067811865476           # 1 / sqrt(2)
ONE_MINUS_EULER = 0.42278433509846713  # 1 - Euler's constant
LOG_HALF = -0.6931471805599453         # ln(1/2)
LOG_MIN = -744.4400719213812           # ln of the smallest positive double
MIN_VALUE = 5e-324                     # the smallest positive double
MAX_STEPS = 500000                     # ceiling for one continued fraction or series
MAX_SAFE = 2 ** 53 - 1                 # the largest integer a double holds with all its neighbours
INF = float("inf")
NAN = float("nan")

Pair = Tuple[float, float]
Core = Tuple[float, float, float]


# ---------- argument checks and float helpers that never raise ----------

def _number(x) -> Optional[float]:
    """x as a float when it is a finite int or float (bool excluded); None otherwise."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    try:
        value = float(x)
    except (OverflowError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _integer(x) -> Optional[int]:
    """x as an int when it is an integer of size at most 2^53 - 1 (an int, or a float with an integral value)."""
    if isinstance(x, bool):
        return None
    if isinstance(x, int):
        return int(x) if -MAX_SAFE <= x <= MAX_SAFE else None
    if isinstance(x, float) and math.isfinite(x) and x.is_integer() and abs(x) <= MAX_SAFE:
        return int(x)
    return None


def _count(x) -> Optional[int]:
    value = _integer(x)
    return value if value is not None and value >= 0 else None


def _probability(x) -> Optional[float]:
    value = _number(x)
    return value if value is not None and 0 <= value <= 1 else None


def _finite(value: float) -> Optional[float]:
    return value if math.isfinite(value) else None


def _exp(x: float) -> float:
    try:
        return math.exp(x)
    except OverflowError:
        return INF


def _log(x: float) -> float:
    if x > 0:
        return math.log(x)
    return -INF if x == 0 else NAN


def _log1p(x: float) -> float:
    if x > -1:
        return math.log1p(x)
    return -INF if x == -1 else NAN


def _divide(a: float, b: float) -> float:
    """a / b as JavaScript gives it: a zero denominator gives an infinity (or NaN for 0 / 0) instead of raising."""
    if b != 0:
        return a / b
    if a == 0 or math.isnan(a):
        return NAN
    return math.copysign(INF, a) * math.copysign(1.0, b)


def _horner(coefficients: Sequence[float], x: float) -> float:
    """A polynomial with its coefficients highest power first."""
    total = 0.0
    for coefficient in coefficients:
        total = total * x + coefficient
    return total


# ---------- utilities ----------

def is_probability(x) -> bool:
    """True for a number in [0, 1]; False for anything else, including NaN and non-numbers."""
    return _probability(x) is not None


def is_count(x) -> bool:
    """True for a nonnegative integer no larger than 2^53 - 1; False for anything else."""
    return _count(x) is not None


def _bound(x) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    try:
        value = float(x)
    except (OverflowError, ValueError):
        return None
    return None if math.isnan(value) else value


def clamp(x, low, high) -> Optional[float]:
    """x limited to [low, high]. The bounds may be infinite ("no bound"); None when x is not finite, a bound is NaN,
    low > high, or the result is not finite."""
    value, lo, hi = _number(x), _bound(low), _bound(high)
    if value is None or lo is None or hi is None or not lo <= hi:
        return None
    return _finite(min(max(value, lo), hi))


def logit(p) -> Optional[float]:
    """ln(p / (1 - p)) for 0 < p < 1, accurate near 0, 1/2 and 1; None otherwise (the ends are infinite)."""
    value = _number(p)
    if value is None or value <= 0 or value >= 1:
        return None
    if value < 0.25:
        return math.log(value) - math.log1p(-value)
    if value > 0.75:
        return math.log1p(value - 1) - math.log(1 - value)
    return 2 * math.atanh(2 * value - 1)


def expit(x) -> Optional[float]:
    """1 / (1 + e^-x), the inverse of logit, without overflow; rounds to exactly 0 or 1 far out. None for a
    non-finite x."""
    value = _number(x)
    if value is None:
        return None
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    e = math.exp(value)
    return e / (1 + e)


def round(x, digits=0) -> Optional[float]:
    """x rounded to `digits` decimal places (negative digits round to tens, hundreds, ...), halves away from zero.
    It rounds the shortest decimal text of x (repr), so round(1.005, 2) is 1.01 and round(-2.5) is -3.0. None when
    x is not finite, digits is not an integer, or the result overflows."""
    value, places = _number(x), _integer(digits)
    if value is None or places is None:
        return None
    if value == 0:
        return 0.0
    _sign, figure_tuple, exponent = Decimal(repr(abs(value))).as_tuple()
    figures = "".join(str(figure) for figure in figure_tuple).rstrip("0")
    exponent += len(figure_tuple) - len(figures)   # |x| = figures * 10^exponent
    drop = -exponent - places                       # how many trailing figures go
    if drop <= 0:
        return value
    if drop > len(figures):
        return 0.0
    kept = int(figures[: len(figures) - drop] or "0")
    if figures[len(figures) - drop] >= "5":         # the first dropped figure is 5 or more
        kept += 1
    result = float("%de%d" % (kept, exponent + drop))
    if not math.isfinite(result):
        return None
    return 0.0 if result == 0 else (-result if value < 0 else result)


# ---------- special functions ----------

# (-1)^k (zeta(k) - 1) / k for k = 2..30: the series of ln gamma(2 + w) after its linear term.
LOG_GAMMA_SERIES = (3.1044247747322276e-11, -6.4229645638381e-11, 1.330476437424449e-10, -2.7595228851242334e-10,
                    5.731367241678862e-10, -1.1921401405860912e-09, 2.4836745438024785e-09, -5.183475041970047e-09,
                    1.0838659214896955e-08, -2.2711094608943164e-08, 4.7698101693639804e-08, -1.0043224823968099e-07,
                    2.1207184805554665e-07, -4.492469198764566e-07, 9.55141213040742e-07, -2.039215753801366e-06,
                    4.374866789907488e-06, -9.439488275268397e-06, 2.050721277567069e-05, -4.492623673813314e-05,
                    9.945751278180853e-05, -0.00022315475845357939, 0.0005096695247430425, -0.001192753911703261,
                    0.0028905103307415234, -0.007385551028673986, 0.020580808427784546, -0.0673523010531981,
                    0.3224670334241132)

# B(2k) / (2k (2k - 1)) for k = 8..1: the tail of Stirling's series.
STIRLING_SERIES = (-3617 / 122400, 1 / 156, -691 / 360360, 1 / 1188, -1 / 1680, 1 / 1260, -1 / 360, 1 / 12)


def _log_gamma_near_two(w: float) -> float:
    """ln gamma(2 + w) for |w| <= 1/2; exactly 0 at w = 0."""
    return w * (ONE_MINUS_EULER + w * _horner(LOG_GAMMA_SERIES, w))


def _stirling_tail(z: float) -> float:
    """ln gamma(z) - ((z - 1/2) ln z - z + ln sqrt(2 pi)) for z >= 10."""
    return _horner(STIRLING_SERIES, 1 / (z * z)) / z


def _lgamma(x: float) -> float:
    """ln gamma(x) for a float x > 0; infinite when it overflows."""
    if x < 0.5:
        return _log_gamma_near_two(x) - math.log1p(x) - math.log(x)   # gamma(x) = gamma(2 + x) / (x (1 + x))
    if x < 1.5:
        return _log_gamma_near_two(x - 1) - math.log1p(x - 1)
    if x <= 2.5:
        return _log_gamma_near_two(x - 2)
    if x < 10:
        z, product = x, 1.0
        while z > 2.5:
            z -= 1
            product *= z
        return _log_gamma_near_two(z - 2) + math.log(product)
    return (x - 0.5) * math.log(x) - x + LN_SQRT_2PI + _stirling_tail(x)


def log_gamma(x) -> Optional[float]:
    """ln gamma(x) for x > 0; None for x <= 0, a non-finite x, or a result that overflows (x above about
    2.5e305)."""
    value = _number(x)
    if value is None or value <= 0:
        return None
    return _finite(_lgamma(value))


def log_factorial(n) -> Optional[float]:
    """ln(n!) for a count n; None otherwise."""
    count = _count(n)
    return None if count is None else _finite(_lgamma(float(count) + 1))


def log_choose(n, k) -> Optional[float]:
    """ln of the binomial coefficient C(n, k) for counts k <= n, without subtracting huge logarithms (right for n
    up to 2^53 - 1); None otherwise."""
    total, part = _count(n), _count(k)
    if total is None or part is None or part > total:
        return None
    nf = float(total)
    j = float(min(part, total - part))
    m = nf - j
    if j < 30:
        value = 0.0
        i = 1.0
        while i <= j:
            value += math.log((m + i) / i)
            i += 1
        return value
    return (j * math.log(nf / j) - m * math.log1p(-j / nf) + 0.5 * math.log(nf / j / m / TWO_PI)
            + _stirling_tail(nf) - _stirling_tail(j) - _stirling_tail(m))


_CHOOSE_LIMIT = 2 ** 1024


def choose(n, k) -> Optional[float]:
    """The binomial coefficient C(n, k) for counts k <= n: the exact integer up to 2^53, the correctly rounded float
    above it, and None when it overflows a float (or for other arguments). Use log_choose for large values."""
    total, part = _count(n), _count(k)
    if total is None or part is None or part > total:
        return None
    j = min(part, total - part)
    if j >= 1024:   # C(n, j) >= 2^j
        return None
    value = 1
    for i in range(1, j + 1):
        value = value * (total - j + i) // i   # always divides exactly: value is C(n - j + i, i)
        if value >= _CHOOSE_LIMIT:
            return None
    try:
        return _finite(float(value))
    except OverflowError:
        return None


# W. J. Cody's rational approximations (Math. Comp. 23, 1969; SPECFUN's CALERF).
ERF_SMALL_TOP = (1.85777706184603153e-1, 3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2,
                 3.20937758913846947e3)
ERF_SMALL_BOTTOM = (1, 2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3)
ERFC_MIDDLE_TOP = (2.15311535474403846e-8, 5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1,
                   2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3,
                   1.23033935479799725e3)
ERFC_MIDDLE_BOTTOM = (1, 1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
                      3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3)
ERFC_FAR_TOP = (1.63153871373020978e-2, 3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1,
                1.60837851487422766e-2, 6.58749161529837803e-4)
ERFC_FAR_BOTTOM = (1, 2.56852019228982242e0, 1.87295284992346725e0, 5.27905102951428412e-1, 6.05183413124413191e-2,
                   2.33520497626869185e-3)


def _erf_small(y: float) -> float:
    """erf(y) for 0 <= y <= 0.46875."""
    square = y * y
    return y * _horner(ERF_SMALL_TOP, square) / _horner(ERF_SMALL_BOTTOM, square)


def _erfc_large(y: float) -> float:
    """erfc(y) for y > 0.46875, with exp(-y * y) taken in two factors so the rounding of y * y does not reach the
    result. Beyond y = 27.3 the result is below the smallest double."""
    if y >= 28:
        return 0.0
    if y <= 4:
        ratio = _horner(ERFC_MIDDLE_TOP, y) / _horner(ERFC_MIDDLE_BOTTOM, y)
    else:
        inverse = 1 / (y * y)
        ratio = (INV_SQRT_PI - inverse * _horner(ERFC_FAR_TOP, inverse) / _horner(ERFC_FAR_BOTTOM, inverse)) / y
    head = math.floor(y * 16) / 16
    return math.exp(-head * head) * math.exp(-(y - head) * (y + head)) * ratio


def erf(x) -> Optional[float]:
    """The error function erf(x), odd in x and within (-1, 1) (rounds to +-1 beyond |x| = 5.93); None for a
    non-finite x."""
    value = _number(x)
    if value is None:
        return None
    y = abs(value)
    if y <= 0.46875:
        return -_erf_small(y) if value < 0 else _erf_small(y)
    result = 0.5 - _erfc_large(y) + 0.5
    return -result if value < 0 else result


def _erfc(value: float) -> float:
    y = abs(value)
    if y <= 0.46875:
        return 1 - (-_erf_small(y) if value < 0 else _erf_small(y))
    return 2 - _erfc_large(y) if value < 0 else _erfc_large(y)


def erfc(x) -> Optional[float]:
    """The complementary error function 1 - erf(x), with full relative accuracy in the right tail (0 beyond
    x = 27.3); None for a non-finite x."""
    value = _number(x)
    return None if value is None else _erfc(value)


def normal_pdf(z) -> Optional[float]:
    """The standard normal density exp(-z^2 / 2) / sqrt(2 pi) (0 beyond |z| = 38.6); None for a non-finite z."""
    value = _number(z)
    if value is None:
        return None
    y = abs(value)
    if y >= 40:
        return 0.0
    head = math.floor(y * 16) / 16
    return math.exp(-0.5 * head * head) * math.exp(-0.5 * (y - head) * (y + head)) * (INV_SQRT_PI * SQRT1_2)


def normal_cdf(z) -> Optional[float]:
    """The standard normal P[Z <= z], with relative accuracy in the left tail; None for a non-finite z."""
    value = _number(z)
    return None if value is None else 0.5 * _erfc(-value * SQRT1_2)


def normal_sf(z) -> Optional[float]:
    """The standard normal P[Z >= z], with relative accuracy in the right tail; None for a non-finite z."""
    value = _number(z)
    return None if value is None else 0.5 * _erfc(value * SQRT1_2)


# M. J. Wichura's algorithm AS 241 (Applied Statistics 37, 1988), the one Python's statistics.NormalDist uses.
QUANTILE_CENTRE_TOP = (2.5090809287301226727e3, 3.3430575583588128105e4, 6.7265770927008700853e4,
                       4.5921953931549871457e4, 1.3731693765509461125e4, 1.9715909503065514427e3,
                       1.3314166789178437745e2, 3.3871328727963666080e0)
QUANTILE_CENTRE_BOTTOM = (5.2264952788528545610e3, 2.8729085735721942674e4, 3.9307895800092710610e4,
                          2.1213794301586595867e4, 5.3941960214247511077e3, 6.8718700749205790830e2,
                          4.2313330701600911252e1, 1)
QUANTILE_MIDDLE_TOP = (7.74545014278341407640e-4, 2.27238449892691845833e-2, 2.41780725177450611770e-1,
                       1.27045825245236838258e0, 3.64784832476320460504e0, 5.76949722146069140550e0,
                       4.63033784615654529590e0, 1.42343711074968357734e0)
QUANTILE_MIDDLE_BOTTOM = (1.05075007164441684324e-9, 5.47593808499534494600e-4, 1.51986665636164571966e-2,
                          1.48103976427480074590e-1, 6.89767334985100004550e-1, 1.67638483018380384940e0,
                          2.05319162663775882187e0, 1)
QUANTILE_TAIL_TOP = (2.01033439929228813265e-7, 2.71155556874348757815e-5, 1.24266094738807843860e-3,
                     2.65321895265761230930e-2, 2.96560571828504891230e-1, 1.78482653991729133580e0,
                     5.46378491116411436990e0, 6.65790464350110377720e0)
QUANTILE_TAIL_BOTTOM = (2.04426310338993978564e-15, 1.42151175831644588870e-7, 1.84631831751005468180e-5,
                        7.86869131145613259100e-4, 1.48753612908506148525e-2, 1.36929880922735805310e-1,
                        5.99832206555887937690e-1, 1)


def _normal_quantile(p: float) -> float:
    q = p - 0.5
    if abs(q) <= 0.425:
        r = 0.180625 - q * q
        return q * _horner(QUANTILE_CENTRE_TOP, r) / _horner(QUANTILE_CENTRE_BOTTOM, r)
    r = math.sqrt(-math.log(p if q < 0 else 1 - p))
    if r <= 5:
        z = _horner(QUANTILE_MIDDLE_TOP, r - 1.6) / _horner(QUANTILE_MIDDLE_BOTTOM, r - 1.6)
    else:
        z = _horner(QUANTILE_TAIL_TOP, r - 5) / _horner(QUANTILE_TAIL_BOTTOM, r - 5)
    return -z if q < 0 else z


def normal_quantile(p) -> Optional[float]:
    """The standard normal quantile: z with P[Z <= z] = p, for 0 < p < 1 (accurate to about 1e-15 relative; a p
    within 1e-16 of 1 has already lost its tail). None for p <= 0, p >= 1 or a non-finite p."""
    value = _number(p)
    if value is None or value <= 0 or value >= 1:
        return None
    return _normal_quantile(value)


def _log_deficit(u: float, ratio: float) -> float:
    """u - ln(1 + u) for u > -1, without cancellation near 0. `ratio` is 1 + u computed directly."""
    if u < -0.5:
        return u - _log(ratio)
    if u < -0.4 or u > 0.4:
        return u - _log1p(u)
    r = u / (2 + u)
    t = r * r
    series = 0.0   # 1/3 + t/5 + t^2/7 + ..., from ln(1 + u) = 2 atanh(r)
    for k in range(14, -1, -1):
        series = series * t + 1 / (2 * k + 3)
    return r * (u - 2 * t * series)


def _log_beta(a: float, b: float) -> float:
    """ln B(a, b) for a, b > 0, stable when one argument is large."""
    small, large = min(a, b), max(a, b)
    if large < 10:
        return _lgamma(small) + _lgamma(large) - _lgamma(small + large)
    total = small + large   # ln gamma(total) - ln gamma(large) by Stirling, term by term
    return _lgamma(small) - ((large - 0.5) * math.log1p(small / large) + small * (_log(total) - 1)
                             + _stirling_tail(total) - _stirling_tail(large))


def _beta_prefix(x: float, y: float, a: float, b: float) -> float:
    """x^a y^b / B(a, b) for 0 < x < 1 with y = 1 - x; built around the mean for large a and b."""
    if a >= 10 and b >= 10:
        total = a + b
        lam = x * b - y * a   # (a + b) (x - a / (a + b))
        exponent = -(a * _log_deficit(lam / a, x * total / a) + b * _log_deficit(-lam / b, y * total / b))
        return (math.sqrt(a / TWO_PI) * math.sqrt(b / total)
                * _exp(exponent + _stirling_tail(total) - _stirling_tail(a) - _stirling_tail(b)))
    log_x = math.log1p(-y) if x > 0.5 else _log(x)
    log_y = math.log1p(-x) if y > 0.5 else _log(y)
    return _exp(a * log_x + b * log_y - _log_beta(a, b))


def _beta_fraction(x: float, y: float, a: float, b: float) -> Optional[float]:
    """The even part of the incomplete beta continued fraction (DLMF 8.17.22 taken in pairs), by modified Lentz:
    I_x(a, b) = x^a y^b / (B(a, b) * fraction). It reads y = 1 - x as given, so a y - b x + 1 keeps its digits near
    x = 1. None when it does not settle within MAX_STEPS."""
    lead = a * y - b * x + 1
    f = a / (a + 1) * lead
    if abs(f) < TINY:
        f = TINY
    c, d = f, 0.0
    for m in range(1, MAX_STEPS + 1):
        shift = a + 2 * m - 1
        numerator = ((a + m - 1) / shift) * ((a + b + m - 1) * x) * (m * ((b - m) * x / shift))
        denominator = m + m * ((b - m) * x / shift) + ((a + m) / (a + 2 * m + 1)) * (lead + m * (1 + y))
        d = denominator + numerator * d
        if abs(d) < TINY:
            d = TINY
        c = denominator + numerator / c
        if abs(c) < TINY:
            c = TINY
        d = 1 / d
        factor = c * d
        f *= factor
        if abs(factor - 1) <= EPSILON:
            return f
    return None


def _beta_core(x: float, y: float, a: float, b: float) -> Optional[Core]:
    """(I_x(a, b), 1 - I_x(a, b), x^a y^b / B(a, b)) with y = 1 - x given by the caller; None on failure."""
    if x <= 0:
        return (0.0, 1.0, 0.0)
    if y <= 0:
        return (1.0, 0.0, 0.0)
    if not a + b < INF:
        return None
    prefix = _beta_prefix(x, y, a, b)
    lower_tail = x * (a + b + 2) <= a + 1 if x <= 0.5 else y * (a + b + 2) >= b + 1
    if lower_tail:
        fraction = _beta_fraction(x, y, a, b) if prefix > 0 else INF
        if fraction is None:
            return None
        lower = min(1.0, prefix / fraction) if fraction != 0 else 1.0
        return (lower, 1 - lower, prefix)
    fraction = _beta_fraction(y, x, b, a) if prefix > 0 else INF
    if fraction is None:
        return None
    upper = min(1.0, prefix / fraction) if fraction != 0 else 1.0
    return (1 - upper, upper, prefix)


def _shapes(a, b) -> Optional[Pair]:
    first, second = _number(a), _number(b)
    if first is None or second is None or first <= 0 or second <= 0:
        return None
    return first, second


def incomplete_beta(x, a, b) -> Optional[float]:
    """The regularized incomplete beta function I_x(a, b) for 0 <= x <= 1 and a, b > 0 (the Beta(a, b)
    distribution function); None otherwise, and None when a and b are too large for the continued fraction."""
    value, shapes = _probability(x), _shapes(a, b)
    if value is None or shapes is None:
        return None
    core = _beta_core(value, 1 - value, shapes[0], shapes[1])
    return None if core is None else core[0]


Evaluate = Callable[[float], Optional[Pair]]


def _solve_monotone(evaluate: Evaluate, low: float, high: float, start: float, increasing: bool,
                    relative: bool) -> Optional[float]:
    """The root of a monotone function by Newton steps kept inside a shrinking bracket, with a bisection whenever a
    step leaves the bracket or fails to halve the previous one. evaluate(t) gives (h, dh/dt), or None to give up."""
    lo, hi = low, high
    t = min(max(start, lo), hi)
    if not lo <= t <= hi:
        t = 0.5 * (lo + hi)
    best, best_error, previous = t, INF, hi - lo
    for _ in range(300):
        result = evaluate(t)
        if result is None or math.isnan(result[0]):
            return None
        h, slope = result
        error = abs(h)
        if error < best_error:
            best_error, best = error, t
        if error <= 8 * EPSILON:
            return t
        if (h < 0) == increasing:
            lo = t
        else:
            hi = t
        following = t - h / slope if slope != 0 else NAN
        if not lo < following < hi or abs(following - t) > 0.5 * abs(previous):
            following = 0.5 * (lo + hi)
        step = following - t
        if abs(step) <= 4 * EPSILON * (abs(following) if relative else max(1.0, abs(following))):
            return following
        previous = step
        t = following
    return best


def _beta_guess(p: float, a: float, b: float) -> float:
    """A starting value for the Beta(a, b) quantile when a, b >= 1 (Abramowitz and Stegun 26.5.22)."""
    z = -_normal_quantile(p)
    lam = (z * z - 3) / 6
    ha, hb = 1 / (2 * a - 1), 1 / (2 * b - 1)
    h = 2 / (ha + hb)
    w = z * math.sqrt(h + lam) / h - (hb - ha) * (lam + 5 / 6 - 2 / (3 * h))
    return a / (a + b * _exp(2 * w))


def _beta_root(target: float, a: float, b: float, mirrored: bool) -> Optional[float]:
    """v in [0, 1/2] with I_v(a, b) = target, or with I_(1 - v)(a, b) = target when `mirrored`, solved on ln v."""
    def evaluate(w: float) -> Optional[Pair]:
        v = math.exp(w)
        core = _beta_core(1 - v, v, a, b) if mirrored else _beta_core(v, 1 - v, a, b)
        if core is None:
            return None
        if not core[0] > 0:
            return (-INF, NAN)
        slope = _divide(core[2], (1 - v) * core[0])
        return (math.log(core[0] / target), -slope if mirrored else slope)

    if a >= 1 and b >= 1:
        guess_x = _beta_guess(target, a, b)
        guess = _log(1 - guess_x if mirrored else guess_x)
    elif mirrored:
        guess = (_log((1 - target) * b) + _log_beta(a, b)) / b
    else:
        guess = (_log(target * a) + _log_beta(a, b)) / a
    w = _solve_monotone(evaluate, LOG_MIN, LOG_HALF, guess, not mirrored, False)
    if w is None:
        return None
    v = math.exp(w)
    if v <= MIN_VALUE:   # the root may lie below the smallest double, and then it rounds to 0
        core = _beta_core(1 - MIN_VALUE, MIN_VALUE, a, b) if mirrored else _beta_core(MIN_VALUE, 1 - MIN_VALUE, a, b)
        if core is not None and (core[0] < target if mirrored else core[0] > target):
            return 0.0
    return v


def _beta_quantile_pair(p: float, a: float, b: float) -> Optional[Pair]:
    """(x, 1 - x) with I_x(a, b) = p, each computed directly so neither loses digits; None on failure."""
    if p <= 0:
        return (0.0, 1.0)
    if p >= 1:
        return (1.0, 0.0)
    middle = _beta_core(0.5, 0.5, a, b)
    if middle is None:
        return None
    if p <= middle[0]:
        x = _beta_root(p, a, b, False)
        return None if x is None else (x, 1 - x)
    y = _beta_root(1 - p, b, a, False) if p >= 0.5 else _beta_root(p, a, b, True)
    return None if y is None else (1 - y, y)


def beta_quantile(p, a, b) -> Optional[float]:
    """The Beta(a, b) quantile: x in [0, 1] with I_x(a, b) = p, for 0 <= p <= 1 and a, b > 0 (0 at p = 0, 1 at
    p = 1; a root closer to 0 or 1 than a float can hold rounds to 0 or 1). None otherwise."""
    value, shapes = _probability(p), _shapes(a, b)
    if value is None or shapes is None:
        return None
    pair = _beta_quantile_pair(value, shapes[0], shapes[1])
    return None if pair is None else pair[0]


def _gamma_prefix(a: float, x: float) -> float:
    """x^a e^-x / gamma(a) for a, x > 0; built around x = a for large a."""
    if a >= 10:
        return math.sqrt(a / TWO_PI) * _exp(-a * _log_deficit((x - a) / a, x / a) - _stirling_tail(a))
    return _exp(a * _log(x) - x - _lgamma(a))


def _gamma_core(a: float, x: float) -> Optional[Core]:
    """(P(a, x), Q(a, x), x^a e^-x / gamma(a)) for a >= 0 and x >= 0: the series below x = a + 1, the continued
    fraction above it; None when either does not settle within MAX_STEPS."""
    if x <= 0:
        return (0.0, 1.0, 0.0)
    if a == 0:   # a half degree of freedom that underflowed: the limit puts all mass at 0
        return (1.0, 0.0, 0.0)
    prefix = _gamma_prefix(a, x)
    if x < a + 1:
        # P = x^a e^-x / gamma(a + 1) * (1 + x / (a + 1) + ...), the front factor formed directly for tiny shapes
        front = _exp(a * _log(x) - x - _lgamma(a + 1)) if a < 10 else prefix / a
        if not front > 0:
            return (0.0, 1.0, prefix)
        term, total = 1.0, 1.0
        for n in range(1, MAX_STEPS + 1):
            term *= x / (a + n)
            total += term
            if term <= total * EPSILON:
                lower = min(1.0, front * total)
                return (lower, 1 - lower, prefix)
        return None
    if not prefix > 0:
        return (1.0, 0.0, 0.0)
    b = x + 1 - a
    c, d = 1 / TINY, _divide(1.0, b)
    h = d
    for n in range(1, MAX_STEPS + 1):
        numerator = -n * (n - a)
        b += 2
        d = numerator * d + b
        if abs(d) < TINY:
            d = TINY
        c = b + numerator / c
        if abs(c) < TINY:
            c = TINY
        d = 1 / d
        factor = d * c
        h *= factor
        if abs(factor - 1) <= EPSILON:
            upper = min(1.0, prefix * h)
            return (1 - upper, upper, prefix)
    return None


def _gamma_arguments(a, x) -> Optional[Pair]:
    shape, value = _number(a), _number(x)
    if shape is None or value is None or shape <= 0 or value < 0:
        return None
    return shape, value


def incomplete_gamma_p(a, x) -> Optional[float]:
    """The regularized lower incomplete gamma function P(a, x) for a > 0 and x >= 0 (the Gamma(a) distribution
    function); None otherwise."""
    args = _gamma_arguments(a, x)
    core = None if args is None else _gamma_core(args[0], args[1])
    return None if core is None else core[0]


def incomplete_gamma_q(a, x) -> Optional[float]:
    """The regularized upper incomplete gamma function Q(a, x) = 1 - P(a, x) for a > 0 and x >= 0, with relative
    accuracy in the right tail; None otherwise."""
    args = _gamma_arguments(a, x)
    core = None if args is None else _gamma_core(args[0], args[1])
    return None if core is None else core[1]


def _gamma_quantile(p: float, a: float) -> Optional[float]:
    """x > 0 with P(a, x) = p for 0 < p < 1 and a > 0; None on failure."""
    middle = _gamma_core(a, a)
    if middle is None:
        return None
    cube = 1 - 1 / (9 * a) + _normal_quantile(p) / (3 * math.sqrt(a))   # Wilson and Hilferty's approximation
    guess = a * cube * cube * cube if a >= 1 and cube > 0 else 0.0
    if p <= middle[0]:
        def evaluate_lower(w: float) -> Optional[Pair]:
            core = _gamma_core(a, math.exp(w))
            if core is None:
                return None
            return (math.log(core[0] / p), core[2] / core[0]) if core[0] > 0 else (-INF, NAN)

        start = math.log(guess) if guess > 0 else (math.log(p) + _lgamma(a + 1)) / a
        w = _solve_monotone(evaluate_lower, LOG_MIN, math.log(a), start, True, False)
        if w is None:
            return None
        x = math.exp(w)
        if x <= MIN_VALUE:   # the root may lie below the smallest double, and then it rounds to 0
            core = _gamma_core(a, MIN_VALUE)
            if core is not None and core[0] > p:
                return 0.0
        return x
    q = 1 - p
    high = 2 * max(a, 1.0)
    for _ in range(64):
        core = _gamma_core(a, high)
        if core is None:
            return None
        if core[1] <= q:
            break
        high *= 2

    def evaluate_upper(x: float) -> Optional[Pair]:
        core = _gamma_core(a, x)
        if core is None:
            return None
        return (math.log(core[1] / q), _divide(-core[2], x * core[1])) if core[1] > 0 else (-INF, NAN)

    return _solve_monotone(evaluate_upper, a, high, guess, False, True)


def _chi_arguments(x, df) -> Optional[Pair]:
    value, freedom = _number(x), _number(df)
    if value is None or freedom is None or freedom <= 0:
        return None
    return value, freedom


def chi_square_cdf(x, df) -> Optional[float]:
    """The chi-square P[X <= x] for df > 0 degrees of freedom (df need not be an integer); 0 for x <= 0. None
    otherwise."""
    args = _chi_arguments(x, df)
    core = None if args is None else _gamma_core(0.5 * args[1], 0.5 * args[0])
    return None if core is None else core[0]


def chi_square_sf(x, df) -> Optional[float]:
    """The chi-square P[X >= x] for df > 0, with relative accuracy in the right tail; 1 for x <= 0. None
    otherwise."""
    args = _chi_arguments(x, df)
    core = None if args is None else _gamma_core(0.5 * args[1], 0.5 * args[0])
    return None if core is None else core[1]


def chi_square_quantile(p, df) -> Optional[float]:
    """The chi-square quantile: x with P[X <= x] = p, for 0 <= p < 1 and df > 0 (0 at p = 0). None otherwise (p = 1
    is infinite)."""
    value, freedom = _number(p), _number(df)
    if value is None or freedom is None or value < 0 or value >= 1 or freedom <= 0:
        return None
    if value == 0 or 0.5 * freedom == 0:   # df / 2 underflows only for the smallest double: all mass at 0
        return 0.0
    x = _gamma_quantile(value, 0.5 * freedom)
    return None if x is None else _finite(2 * x)


def _student_halves(t: float, df: float) -> Optional[Pair]:
    """(P[T >= |t|], P[0 <= T <= |t|]) for Student's t with df degrees of freedom; None when the beta function
    fails."""
    if 0.5 * df == 0:   # df / 2 underflows only for the smallest double: the limit puts no mass near 0
        return (0.5, 0.0)
    square = t * t
    if square > df:
        r = df / square
        if not r >= 1e-300:
            # x underflows (or t^2 overflowed): the first term of I_x(df/2, 1/2) is the whole of it
            a = 0.5 * df
            tail = 0.5 * _exp(a * (math.log(df) - 2 * math.log(abs(t))) - math.log(a) - _log_beta(a, 0.5))
            return (tail, 0.5 - tail)
        x, y = r / (1 + r), 1 / (1 + r)
    else:
        r = square / df
        x, y = 1 / (1 + r), r / (1 + r)
    core = _beta_core(x, y, 0.5 * df, 0.5)
    return None if core is None else (0.5 * core[0], 0.5 * core[1])


def student_t_cdf(t, df) -> Optional[float]:
    """Student's t P[T <= t] for df > 0 degrees of freedom (df need not be an integer), with relative accuracy in
    the left tail; None otherwise."""
    value, freedom = _number(t), _number(df)
    if value is None or freedom is None or freedom <= 0:
        return None
    halves = _student_halves(value, freedom)
    if halves is None:
        return None
    return 0.5 + halves[1] if value > 0 else halves[0]


def student_t_sf(t, df) -> Optional[float]:
    """Student's t P[T >= t] for df > 0, with relative accuracy in the right tail; None otherwise."""
    value, freedom = _number(t), _number(df)
    if value is None or freedom is None or freedom <= 0:
        return None
    halves = _student_halves(value, freedom)
    if halves is None:
        return None
    return 0.5 + halves[1] if value < 0 else halves[0]


def student_t_quantile(p, df) -> Optional[float]:
    """Student's t quantile: t with P[T <= t] = p, for 0 < p < 1 and df > 0. None otherwise, and None when the
    quantile overflows a float (tiny df with p near 0 or 1)."""
    value, freedom = _number(p), _number(df)
    if value is None or freedom is None or value <= 0 or value >= 1 or freedom <= 0:
        return None
    if value == 0.5:
        return 0.0
    if 0.5 * freedom == 0:   # df / 2 underflows only for the smallest double: every other quantile is infinite
        return None
    pair = _beta_quantile_pair(2 * (value if value < 0.5 else 1 - value), 0.5 * freedom, 0.5)
    if pair is None or pair[0] == 0:
        return None
    t = math.sqrt(freedom) * math.sqrt(pair[1] / pair[0])
    return _finite(-t if value < 0.5 else t)


# ---------- discrete distributions ----------

def _stirling_error(n: float) -> float:
    """ln(n!) - ((n + 1/2) ln n - n + ln sqrt(2 pi)) for an integer n >= 1."""
    return _stirling_tail(n) if n >= 10 else _lgamma(n + 1) - ((n + 0.5) * math.log(n) - n + LN_SQRT_2PI)


def _deviance(x: float, mean: float) -> float:
    """x ln(x / mean) + mean - x for x > 0 and mean >= 0 (C. Loader's saddle-point deviance)."""
    return x * _log_deficit((mean - x) / x, mean / x)


def _binomial_term(k: float, n: float, p: float, q: float) -> float:
    """C(n, k) p^k q^(n - k) for integers 0 <= k <= n with q = 1 - p given by the caller (Loader's algorithm)."""
    if p <= 0:
        return 1.0 if k == 0 else 0.0
    if q <= 0:
        return 1.0 if k == n else 0.0
    if k == 0:
        return _exp(n * (math.log1p(-p) if p < 0.5 else math.log(q)))
    if k == n:
        return _exp(n * (math.log1p(-q) if q < 0.5 else math.log(p)))
    m = n - k
    exponent = (_stirling_error(n) - _stirling_error(k) - _stirling_error(m) - _deviance(k, n * p)
                - _deviance(m, n * q))
    return math.sqrt(n / (TWO_PI * k * m)) * _exp(exponent)


def _binomial_arguments(k, n, p) -> Optional[Tuple[int, int, float]]:
    successes, trials, probability = _integer(k), _count(n), _probability(p)
    if successes is None or trials is None or probability is None:
        return None
    return successes, trials, probability


def binomial_pmf(k, n, p) -> Optional[float]:
    """The binomial P[X = k] for n trials with success probability p; 0 for an integer k outside 0..n. None when k
    is not an integer, n is not a count or p is not a probability."""
    args = _binomial_arguments(k, n, p)
    if args is None:
        return None
    successes, trials, probability = args
    if successes < 0 or successes > trials:
        return 0.0
    return _binomial_term(float(successes), float(trials), probability, 1 - probability)


def binomial_cdf(k, n, p) -> Optional[float]:
    """The binomial P[X <= k]; 0 for k < 0 and 1 for k >= n. None for the arguments binomial_pmf rejects."""
    args = _binomial_arguments(k, n, p)
    if args is None:
        return None
    successes, trials, probability = args
    if successes < 0:
        return 0.0
    if successes >= trials:
        return 1.0
    core = _beta_core(1 - probability, probability, float(trials - successes), float(successes + 1))
    return None if core is None else core[0]


def binomial_sf(k, n, p) -> Optional[float]:
    """The binomial P[X >= k] (k itself included), with relative accuracy in the right tail; 1 for k <= 0 and 0 for
    k > n. None for the arguments binomial_pmf rejects."""
    args = _binomial_arguments(k, n, p)
    if args is None:
        return None
    successes, trials, probability = args
    if successes <= 0:
        return 1.0
    if successes > trials:
        return 0.0
    core = _beta_core(probability, 1 - probability, float(successes), float(trials - successes + 1))
    return None if core is None else core[0]


def hypergeometric_pmf(k, population, successes, draws) -> Optional[float]:
    """The hypergeometric P[X = k]: k successes in `draws` draws without replacement from `population` items of
    which `successes` are successes. 0 for an integer k outside the possible range. None when k is not an integer,
    the others are not counts, or successes or draws exceed population."""
    hits, total, good, drawn = _integer(k), _count(population), _count(successes), _count(draws)
    if hits is None or total is None or good is None or drawn is None or good > total or drawn > total:
        return None
    failures = total - good
    if hits < 0 or hits > drawn or hits > good or drawn - hits > failures:
        return 0.0
    if drawn == 0:
        return 1.0
    p, q = drawn / total, (total - drawn) / total
    return (_binomial_term(float(hits), float(good), p, q) * _binomial_term(float(drawn - hits), float(failures), p, q)
            / _binomial_term(float(drawn), float(total), p, q))


def _poisson_arguments(k, mean) -> Optional[Tuple[int, float]]:
    count, rate = _integer(k), _number(mean)
    if count is None or rate is None or rate < 0:
        return None
    return count, rate


def poisson_pmf(k, mean) -> Optional[float]:
    """The Poisson P[X = k] for a mean >= 0; 0 for a negative integer k. None when k is not an integer or the mean
    is negative or not finite."""
    args = _poisson_arguments(k, mean)
    if args is None:
        return None
    count, rate = args
    if count < 0:
        return 0.0
    if rate == 0:
        return 1.0 if count == 0 else 0.0
    if count == 0:
        return math.exp(-rate)
    kf = float(count)
    return _exp(-_stirling_error(kf) - _deviance(kf, rate)) / math.sqrt(TWO_PI * kf)


def poisson_cdf(k, mean) -> Optional[float]:
    """The Poisson P[X <= k]; 0 for k < 0. None for the arguments poisson_pmf rejects."""
    args = _poisson_arguments(k, mean)
    if args is None:
        return None
    count, rate = args
    if count < 0:
        return 0.0
    core = _gamma_core(float(count) + 1, rate)
    return None if core is None else core[1]


def poisson_sf(k, mean) -> Optional[float]:
    """The Poisson P[X >= k] (k itself included), with relative accuracy in the right tail; 1 for k <= 0. None for
    the arguments poisson_pmf rejects."""
    args = _poisson_arguments(k, mean)
    if args is None:
        return None
    count, rate = args
    if count <= 0:
        return 1.0
    core = _gamma_core(float(count), rate)
    return None if core is None else core[0]


# ---------- descriptive statistics ----------

def _numbers(values) -> Optional[List[float]]:
    """values as a list of floats when it is a nonempty list or tuple of finite numbers; None otherwise."""
    if not isinstance(values, (list, tuple)) or not values:
        return None
    out = []
    for value in values:
        number = _number(value)
        if number is None:
            return None
        out.append(number)
    return out


def _total(values: Sequence[float]) -> float:
    """Neumaier's compensated sum; NaN or an infinity if the running total overflows."""
    running, carry = 0.0, 0.0
    for value in values:
        following = running + value
        if abs(running) >= abs(value):
            carry += (running - following) + value
        else:
            carry += (value - following) + running
        running = following
    return running + carry


def sum(values) -> Optional[float]:
    """The sum of a list, compensated so rounding errors do not pile up (sum([0.1, 0.2, 0.3]) is 0.6). None for an
    empty list, a non-list, a non-finite entry, or a sum that overflows."""
    numbers = _numbers(values)
    return None if numbers is None else _finite(_total(numbers))


def mean(values) -> Optional[float]:
    """The arithmetic mean of a list; None where sum is None."""
    numbers = _numbers(values)
    return None if numbers is None else _finite(_total(numbers) / len(numbers))


def variance(values, sample=True) -> Optional[float]:
    """The variance of a list: the sample variance (divide by n - 1) by default, the population variance (divide by
    n) with sample=False. None where sum is None, for a sample of fewer than two values, or on overflow."""
    numbers = _numbers(values)
    if numbers is None or (sample and len(numbers) < 2):
        return None
    centre = _total(numbers) / len(numbers)
    deviations = [value - centre for value in numbers]
    drift = _total(deviations)   # zero in exact arithmetic; corrects the rounding of the mean
    squares = _total([d * d for d in deviations]) - drift * drift / len(numbers)
    if math.isnan(squares):
        return None
    return _finite(max(0.0, squares) / (len(numbers) - 1 if sample else len(numbers)))


def stdev(values, sample=True) -> Optional[float]:
    """The standard deviation of a list: the square root of variance(values, sample); None where that is None."""
    value = variance(values, sample)
    return None if value is None else math.sqrt(value)


def _between(a: float, b: float, fraction: float) -> float:
    """a + fraction * (b - a) for a <= b, without overflow when b - a does not fit a float."""
    value = a + fraction * (b - a)
    return value if math.isfinite(value) else a * (1 - fraction) + b * fraction


def median(values) -> Optional[float]:
    """The median of a list (the mean of the two middle values for an even count); None where sum is None."""
    numbers = _numbers(values)
    if numbers is None:
        return None
    ordered = sorted(numbers)
    half = len(ordered) // 2
    return ordered[half] if len(ordered) % 2 else _between(ordered[half - 1], ordered[half], 0.5)


def quantile(values, q) -> Optional[float]:
    """The q-quantile of a list for 0 <= q <= 1, by linear interpolation between order statistics ("type 7", the
    default of R, NumPy and spreadsheets). None where sum is None or when q is not a probability."""
    numbers, share = _numbers(values), _probability(q)
    if numbers is None or share is None:
        return None
    ordered = sorted(numbers)
    position = (len(ordered) - 1) * share
    index = math.floor(position)
    if index >= len(ordered) - 1:
        return ordered[-1]
    return _between(ordered[index], ordered[index + 1], position - index)


def min_of(values) -> Optional[float]:
    """The smallest value of a list; None where sum is None."""
    numbers = _numbers(values)
    if numbers is None:
        return None
    low = numbers[0]
    for value in numbers:
        if value < low:
            low = value
    return low


def max_of(values) -> Optional[float]:
    """The largest value of a list; None where sum is None."""
    numbers = _numbers(values)
    if numbers is None:
        return None
    high = numbers[0]
    for value in numbers:
        if value > high:
            high = value
    return high


# ---------- seeded randomness ----------

def mulberry32(seed) -> Optional[Callable[[], float]]:
    """A deterministic generator: a function that returns the next float in [0, 1) each time it is called
    (mulberry32, 32 bits of state). It gives exactly the sequence math.js's mulberry32 gives for the same seed. The
    seed is any integer up to 2^53 - 1 in size, taken modulo 2^32; None for any other seed. Not for secrets."""
    start = _integer(seed)
    if start is None:
        return None
    state = [start % 4294967296]

    def following() -> float:
        current = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = current
        t = ((current ^ (current >> 15)) * (current | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return following


def shuffled(items, seed) -> Optional[list]:
    """A shuffled copy of a list or tuple, as a list (Fisher-Yates driven by mulberry32(seed)); the input is not
    changed and the same seed always gives the same order, in Python and JavaScript. None when items is not a list
    or tuple or the seed is invalid."""
    random = mulberry32(seed)
    if not isinstance(items, (list, tuple)) or random is None:
        return None
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = math.floor(random() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def sample_indexes(count, size, seed) -> Optional[List[int]]:
    """`size` distinct indexes drawn from 0..count - 1, in ascending order (Floyd's algorithm driven by
    mulberry32(seed)), the same as math.js's sampleIndexes. None when count or size is not a count, size > count,
    count > 2^32, or the seed is invalid."""
    random = mulberry32(seed)
    total, wanted = _count(count), _count(size)
    if total is None or wanted is None or wanted > total or total > 4294967296 or random is None:
        return None
    chosen = set()
    for top in range(total - wanted, total):
        pick = math.floor(random() * (top + 1))
        chosen.add(top if pick in chosen else pick)
    return sorted(chosen)
