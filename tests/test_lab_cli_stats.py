"""Tests for the cli-stats Lab pack (jev/lab/packs/cli_stats.py): offline statistics from counts and pair files.

Every expected number is worked out here without jev/lab/mathx.py: by hand for counts and simple fractions, and with
independent references for the rest (statistics.NormalDist for normal quantiles, exact binomial sums by bisection for
Clopper-Pearson, a Simpson integral of the Beta density for Jeffreys, math.erfc for the chi-square tail)."""

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from statistics import NormalDist

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_stats  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)
NORMAL = NormalDist()


def tearDownModule():
    TMP.cleanup()


def write(name, text):
    path = DIR / name
    path.write_text(text, encoding="utf-8")
    return str(path)


# ---------- independent references ----------


def z_of(confidence):
    return NORMAL.inv_cdf(1 - (1 - confidence) / 2)


def ref_wilson(k, n, confidence=0.95):
    z = z_of(confidence)
    p = k / n
    centre = (k + z * z / 2) / (n + z * z)
    half = z * math.sqrt(n) / (n + z * z) * math.sqrt(p * (1 - p) + z * z / (4 * n))
    return max(0.0, centre - half), min(1.0, centre + half)


def binomial_cdf(k, n, p):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(0, k + 1))


def bisect(f, target, increasing, low=0.0, high=1.0):
    for _ in range(200):
        middle = (low + high) / 2
        if (f(middle) < target) == increasing:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def ref_clopper_pearson(k, n, confidence=0.95):
    alpha = 1 - confidence
    low = 0.0 if k == 0 else bisect(lambda p: 1 - binomial_cdf(k - 1, n, p), alpha / 2, True)
    high = 1.0 if k == n else bisect(lambda p: binomial_cdf(k, n, p), alpha / 2, False)
    return low, high


def beta_half_cdf(x, k, n, steps=4000):
    """The Beta(k + 1/2, n - k + 1/2) distribution function: with t = sin^2(u) its density is proportional to
    sin(u)^(2k) cos(u)^(2(n-k)), a smooth integrand that Simpson's rule handles to near machine precision."""
    def integral(top):
        h = top / steps
        f = lambda u: math.sin(u) ** (2 * k) * math.cos(u) ** (2 * (n - k))  # noqa: E731
        return h / 3 * (f(0) + f(top) + sum((4 if i % 2 else 2) * f(i * h) for i in range(1, steps)))
    return integral(math.asin(math.sqrt(x))) / integral(math.pi / 2)


def ref_jeffreys(k, n, confidence=0.95):
    alpha = 1 - confidence
    low = 0.0 if k == 0 else bisect(lambda x: beta_half_cdf(x, k, n), alpha / 2, True)
    high = 1.0 if k == n else bisect(lambda x: beta_half_cdf(x, k, n), 1 - alpha / 2, True)
    return low, high


def r4(value):
    return None if value is None else round(value, 4)


def sig(value):
    return float("%.4g" % value)


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def metric(rows):
    return table(["metric", "value"], rows)


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


# ---------- fixtures: fictional Harbor Coffee Co. support labels ----------

LABELS = write("labels.csv", "label,prediction\nbilling,billing\nbilling,shipping\nshipping,shipping\nproduct,product\n"
                             "product,billing\nshipping,shipping\n")
WIDE = write("raters.csv", "ticket,notes,rater_a,rater_b\nT-1,,billing,billing\nT-2,x,billing,shipping\nT-3,,shipping,shipping\n"
                           "T-4,,product,product\nT-5,,product,billing\nT-6,,shipping,shipping\nT-7,,product,\n")
SCORES = write("scores.jsonl", "\n".join(json.dumps({"first": a, "second": b})
                                         for a, b in [(0, 0), (1, 1), (2, 2), (0, 1), (2, 1), (1, 1)]) + "\n")
TRIPLES = write("triples.csv", "label,old,new\nbilling,billing,billing\nbilling,shipping,billing\nshipping,shipping,product\n"
                               "product,billing,product\nproduct,product,product\nshipping,product,shipping\n")
# probability,outcome: positives at 0.9, 0.8, 0.6, 0.3; negatives at 0.7, 0.4, 0.2, 0.1. No header: the first line is numbers.
PROBS = write("probs.csv", "0.9,1\n0.8,yes\n0.7,0\n0.6,true\n0.4,no\n0.3,1\n0.2,false\n0.1,0\n")
TIES = write("ties.jsonl", '{"p": 0.8, "y": 1}\n{"p": 0.8, "y": 0}\n{"p": 0.5, "y": true}\n{"p": 0.2, "y": false}\n')

# Counted by hand from LABELS: billing 2 (1 right), product 2 (1 right), shipping 2 (2 right); predictions billing 2,
# product 1, shipping 3. Observed agreement 4/6; chance (2*2 + 2*1 + 2*3)/36 = 1/3; kappa (2/3 - 1/3)/(2/3) = 1/2.
KAPPA_SE = math.sqrt((2 / 3) * (1 / 3) / (6 * (2 / 3) ** 2))


def kappa_rows(confidence):
    z = z_of(confidence)
    return [["pairs", 6], ["categories", 3], ["observed agreement", 0.6667], ["chance agreement", 0.3333], ["kappa", 0.5],
            ["low", r4(0.5 - z * KAPPA_SE)], ["high", r4(min(1.0, 0.5 + z * KAPPA_SE))], ["strength", "moderate"]]


# Per class: billing P 1/2 R 1/2 F 1/2; product P 1/1 R 1/2 F 2/3; shipping P 2/3 R 1 F 4/5.
METRICS = ["class", "support", "predicted", "precision", "recall", "f1"]
METRIC_ROWS = [["billing", 2, 2, 0.5, 0.5, 0.5], ["product", 2, 1, 1.0, 0.5, 0.6667], ["shipping", 2, 3, 0.6667, 1.0, 0.8],
               ["macro avg", 6, 6, r4((0.5 + 1 + 2 / 3) / 3), r4(2 / 3), r4((0.5 + 2 / 3 + 0.8) / 3)],
               ["weighted avg", 6, 6, r4((0.5 + 1 + 2 / 3) / 3), r4(2 / 3), r4((0.5 + 2 / 3 + 0.8) / 3)],
               ["accuracy", 6, 6, None, None, 0.6667]]

# Calibration of PROBS. Ten bins hold one row each: gaps 0.1, 0.2, 0.7, 0.4 | 0.4, 0.7, 0.2, 0.1, so ECE 2.8/8 and MCE 0.7.
LOG_LOSS = -(math.log(0.9) + math.log(0.8) + math.log(0.6) + math.log(0.3)) / 4
CALIBRATION = [["rows", 8], ["positives", 4], ["base rate", 0.5], ["mean probability", 0.5],
               ["brier score", r4((0.01 + 0.04 + 0.49 + 0.16 + 0.16 + 0.49 + 0.04 + 0.01) / 8)], ["log loss", r4(LOG_LOSS)]]
RELIABILITY = ["bin", "range", "rows", "mean probability", "observed rate", "gap", "low", "high"]


def bin_row(number, span, rows, mean, hits, confidence=0.95):
    low, high = ref_wilson(hits, rows, confidence)
    return [number, span, rows, r4(mean), r4(hits / rows), r4(hits / rows - mean), r4(low), r4(high)]


def empty(number, span):
    return [number, span, 0, None, None, None, None, None]


TEN_BINS = [empty(1, "[0, 0.1)"), bin_row(2, "[0.1, 0.2)", 1, 0.1, 0), bin_row(3, "[0.2, 0.3)", 1, 0.2, 0),
            bin_row(4, "[0.3, 0.4)", 1, 0.3, 1), bin_row(5, "[0.4, 0.5)", 1, 0.4, 0), empty(6, "[0.5, 0.6)"),
            bin_row(7, "[0.6, 0.7)", 1, 0.6, 1), bin_row(8, "[0.7, 0.8)", 1, 0.7, 0), bin_row(9, "[0.8, 0.9)", 1, 0.8, 1),
            bin_row(10, "[0.9, 1]", 1, 0.9, 1)]


def hanley_mcneil(area, positives, negatives, confidence=0.95):
    q1, q2 = area / (2 - area), 2 * area * area / (1 + area)
    se = math.sqrt((area * (1 - area) + (positives - 1) * (q1 - area ** 2) + (negatives - 1) * (q2 - area ** 2)) / (positives * negatives))
    return max(0.0, area - z_of(confidence) * se), min(1.0, area + z_of(confidence) * se)


# AUC of PROBS counted pair by pair: 0.9 and 0.8 beat all 4 negatives, 0.6 beats 3, 0.3 beats 2: 13/16.
AUC_LOW, AUC_HIGH = hanley_mcneil(13 / 16, 4, 4)

SWEEP = ["threshold", "predicted positive", "tp", "fp", "fn", "tn", "precision", "recall", "specificity", "f1", "accuracy"]
# Each threshold counted by hand: predicted positive when the probability is at least the threshold.
S = {0.1: [8, 4, 4, 0, 0, 0.5, 1.0, 0.0, 0.6667, 0.5], 0.2: [7, 4, 3, 0, 1, 0.5714, 1.0, 0.25, 0.7273, 0.625],
     0.3: [6, 4, 2, 0, 2, 0.6667, 1.0, 0.5, 0.8, 0.75], 0.4: [5, 3, 2, 1, 2, 0.6, 0.75, 0.5, 0.6667, 0.625],
     0.5: [4, 3, 1, 1, 3, 0.75, 0.75, 0.75, 0.75, 0.75], 0.6: [4, 3, 1, 1, 3, 0.75, 0.75, 0.75, 0.75, 0.75],
     0.7: [3, 2, 1, 2, 3, 0.6667, 0.5, 0.75, 0.5714, 0.625], 0.8: [2, 2, 0, 2, 4, 1.0, 0.5, 1.0, 0.6667, 0.75],
     0.9: [1, 1, 0, 3, 4, 1.0, 0.25, 1.0, 0.4, 0.625]}

COVERAGE = ["threshold", "automated", "coverage", "correct", "accuracy", "low"]


def coverage_rows(confidence=0.95):
    # Confidence max(p, 1 - p) and correctness by hand: 0.9 R, 0.8 R, 0.7 W, 0.6 R, 0.6 R, 0.7 W, 0.8 R, 0.9 R.
    kept = {0.5: (8, 6), 0.55: (8, 6), 0.6: (8, 6), 0.65: (6, 4), 0.7: (6, 4), 0.75: (4, 4), 0.8: (4, 4), 0.85: (2, 2),
            0.9: (2, 2), 0.95: (0, 0)}
    return [[t, n, r4(n / 8), c, r4(c / n) if n else None, r4(ref_wilson(c, n, confidence)[0]) if n else None]
            for t, (n, c) in kept.items()]


def interval_rows(k, n, confidence=0.95, methods=("wilson", "clopper-pearson", "jeffreys")):
    refs = {"wilson": ref_wilson, "clopper-pearson": ref_clopper_pearson, "jeffreys": ref_jeffreys}
    return [[m, r4(k / n)] + [r4(v) for v in refs[m](k, n, confidence)] for m in methods]


def two_rows(k1, n1, k2, n2, confidence=0.95, alternative="two-sided"):
    p1, p2 = k1 / n1, k2 / n2
    pooled = (k1 + k2) / (n1 + n2)
    zv = (p1 - p2) / math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    p = {"two-sided": 2 * (1 - NORMAL.cdf(abs(zv))), "greater": 1 - NORMAL.cdf(zv), "less": NORMAL.cdf(zv)}[alternative]
    l1, u1 = ref_wilson(k1, n1, confidence)
    l2, u2 = ref_wilson(k2, n2, confidence)
    d = p1 - p2
    return [["rate A", r4(p1)], ["rate B", r4(p2)], ["difference", r4(d)], ["low", r4(d - math.hypot(p1 - l1, u2 - p2))],
            ["high", r4(d + math.hypot(u1 - p1, p2 - l2))], ["z", r4(zv)], ["p-value", sig(p)]]


def mcnemar_rows(b, c):
    chi = (abs(b - c) - 1) ** 2 / (b + c)
    exact = 2 * sum(math.comb(b + c, i) for i in range(min(b, c) + 1)) / 2 ** (b + c)
    return [["A right, B wrong", b], ["A wrong, B right", c], ["discordant", b + c], ["chi-square", r4(chi)],
            ["p (chi-square)", sig(math.erfc(math.sqrt(chi / 2)))], ["p (exact)", sig(min(1.0, exact))]]


def size_rows(method, confidence, margin, expected, size, population=None):
    rows = [["method", method], ["confidence", confidence], ["margin", margin], ["expected proportion", expected]]
    return rows + ([["population", population]] if population else []) + [["sample size", size]]


Z95 = z_of(0.95)

CASES = {
    "interval": {
        "argv": ["stats", "interval", 8, 10], "stdout": table(["method", "estimate", "low", "high"], interval_rows(8, 10)),
        "options": {
            "method": {"argv": ["stats", "interval", 8, 10, "--method", "jeffreys"],
                       "stdout": table(["method", "estimate", "low", "high"], interval_rows(8, 10, methods=("jeffreys",)))},
            "confidence": {"argv": ["stats", "interval", 37, 50, "--confidence", "0.9"],
                           "stdout": table(["method", "estimate", "low", "high"], interval_rows(37, 50, 0.9))},
            "format": {"argv": ["stats", "interval", 0, 12, "--format", "json"],
                       "stdout": same_json([dict(zip(["method", "estimate", "low", "high"], row)) for row in interval_rows(0, 12)])}}},
    "sample_size": {
        # (z / 0.05)^2 * 0.25 = 384.15, so 385 rows.
        "argv": ["stats", "sample-size", "--margin", "0.05"],
        "stdout": metric(size_rows("wald", 0.95, 0.05, 0.5, math.ceil(Z95 ** 2 * 0.25 / 0.0025))),
        "options": {
            "confidence": {"argv": ["stats", "sample-size", "--margin", "0.05", "--confidence", "0.9"],
                           "stdout": metric(size_rows("wald", 0.9, 0.05, 0.5, 271))},
            "expected": {"argv": ["stats", "sample-size", "--margin", "0.05", "--expected", "0.2"],
                         "stdout": metric(size_rows("wald", 0.95, 0.05, 0.2, math.ceil(Z95 ** 2 * 0.16 / 0.0025)))},
            "population": {"argv": ["stats", "sample-size", "--margin", "0.05", "--population", "1000"],
                           # Cochran: n0 / (1 + (n0 - 1) / N) = 384.15 / 1.3831 = 277.7, so 278.
                           "stdout": metric(size_rows("wald", 0.95, 0.05, 0.5, 278, 1000))},
            "method": {"argv": ["stats", "sample-size", "--margin", "0.05", "--method", "wilson"],
                       # At p = 1/2 the Wilson half-width is z / (2 sqrt(n + z^2)): n >= (z / 0.1)^2 - z^2 = 380.3.
                       "stdout": metric(size_rows("wilson", 0.95, 0.05, 0.5, math.ceil((Z95 / 0.1) ** 2 - Z95 ** 2)))}}},
    "two_proportions": {
        "argv": ["stats", "two-proportions", 45, 60, 30, 60], "stdout": metric(two_rows(45, 60, 30, 60)),
        "options": {
            "confidence": {"argv": ["stats", "two-proportions", 45, 60, 30, 60, "--confidence", "0.99"],
                           "stdout": metric(two_rows(45, 60, 30, 60, 0.99))},
            "alternative": {"argv": ["stats", "two-proportions", 30, 60, 45, 60, "--alternative", "less"],
                            "stdout": metric(two_rows(30, 60, 45, 60, alternative="less"))},
            "alpha": {"argv": ["stats", "two-proportions", 45, 60, 30, 60, "--alpha", "0.01"], "code": 1,
                      "stdout": metric(two_rows(45, 60, 30, 60)),
                      "stderr": "the difference is significant at alpha 0.01 (p = %.4g)\n" % (2 * (1 - NORMAL.cdf(2 * math.sqrt(2))))}}},
    "mcnemar": {
        "argv": ["stats", "mcnemar", 10, 3], "stdout": metric(mcnemar_rows(10, 3)),
        "options": {
            # TRIPLES: old right and new wrong once (shipping -> product); old wrong and new right three times.
            "file": {"argv": ["stats", "mcnemar", "--file", TRIPLES], "stdout": metric([["pairs", 6]] + mcnemar_rows(1, 3))},
            "alpha": {"argv": ["stats", "mcnemar", 10, 3, "--alpha", "0.1"], "code": 1, "stdout": metric(mcnemar_rows(10, 3)),
                      "stderr": "A and B differ at alpha 0.1 (exact p = 0.09229)\n"}}},
    "kappa": {
        "argv": ["stats", "kappa", LABELS], "stdout": metric(kappa_rows(0.95)),
        "options": {
            # Linear weights 1 - |a - b| / 2 by hand: observed 5/6, chance 22/36, kappa (30 - 22) / (36 - 22) = 4/7.
            "weighted": {"argv": ["stats", "kappa", SCORES, "--weighted", "linear"],
                         "stdout": metric([["pairs", 6], ["categories", 3], ["weights", "linear"], ["observed agreement", 0.8333],
                                           ["chance agreement", 0.6111], ["kappa", 0.5714], ["strength", "moderate"]])},
            "confidence": {"argv": ["stats", "kappa", LABELS, "--confidence", "0.8"], "stdout": metric(kappa_rows(0.8))},
            "columns": {"argv": ["stats", "kappa", WIDE, "--columns", "rater_a,RATER_B"], "stdout": metric(kappa_rows(0.95)),
                        "stderr": "skipped 1 line with a blank value\n"}}},
    "confusion": {
        "argv": ["stats", "confusion", LABELS],
        "stdout": table(["label", "billing", "product", "shipping", "total"],
                        [["billing", 1, 0, 1, 2], ["product", 1, 1, 0, 2], ["shipping", 0, 0, 2, 2], ["total", 2, 1, 3, 6]]),
        "options": {
            "normalize": {"argv": ["stats", "confusion", LABELS, "--normalize"],
                          "stdout": table(["label", "billing", "product", "shipping", "total"],
                                          [["billing", 50.0, 0.0, 50.0, 100.0], ["product", 50.0, 50.0, 0.0, 100.0],
                                           ["shipping", 0.0, 0.0, 100.0, 100.0], ["total", 33.3, 16.7, 50.0, 100.0]])},
            "format": {"argv": ["stats", "confusion", LABELS, "--format", "csv"],
                       "stdout": kit.render(["label", "billing", "product", "shipping", "total"],
                                            [["billing", 1, 0, 1, 2], ["product", 1, 1, 0, 2], ["shipping", 0, 0, 2, 2],
                                             ["total", 2, 1, 3, 6]], "csv") + "\n"}}},
    "metrics": {
        "argv": ["stats", "metrics", LABELS], "stdout": table(METRICS, METRIC_ROWS),
        "options": {
            # billing as positive: TP 1, FP 1 (product -> billing), FN 1 (billing -> shipping), TN 3.
            "positive": {"argv": ["stats", "metrics", LABELS, "--positive", "billing"],
                         "stdout": metric([["positives", 2], ["tp", 1], ["fp", 1], ["fn", 1], ["tn", 3], ["accuracy", 0.6667],
                                           ["precision", 0.5], ["recall", 0.5], ["specificity", 0.75], ["npv", 0.75], ["f1", 0.5],
                                           ["mcc", r4((1 * 3 - 1 * 1) / math.sqrt(2 * 2 * 4 * 4))]])},
            "min_f1": {"argv": ["stats", "metrics", LABELS, "--min-f1", "0.7"], "code": 1, "stdout": table(METRICS, METRIC_ROWS),
                       "stderr": "F1 below 0.7: billing, product\n"},
            "format": {"argv": ["stats", "metrics", LABELS, "--format", "json"],
                       "stdout": same_json([dict(zip(METRICS, row)) for row in METRIC_ROWS])}}},
    "calibration": {
        "argv": ["stats", "calibration", PROBS], "stdout": metric(CALIBRATION + [["ece", 0.35], ["mce", 0.7], ["bins", 10]]),
        "options": {
            # Five bins: [0.1], [0.2, 0.3], [0.4], [0.6, 0.7], [0.8, 0.9]; gaps 0.1, 0.25, 0.4, 0.15, 0.15; ECE 1.6/8.
            "bins": {"argv": ["stats", "calibration", PROBS, "--bins", "5"],
                     "stdout": metric(CALIBRATION + [["ece", 0.2], ["mce", 0.4], ["bins", 5]])},
            # Two equal-count bins: 0.1-0.4 (mean 0.25, one positive in 4) and 0.6-0.9 (mean 0.75, three in 4): no gap.
            "strategy": {"argv": ["stats", "calibration", PROBS, "--bins", "2", "--strategy", "quantile"],
                         "stdout": metric(CALIBRATION + [["ece", 0.0], ["mce", 0.0], ["bins", 2]])},
            "max_ece": {"argv": ["stats", "calibration", PROBS, "--max-ece", "0.3"], "code": 1,
                        "stdout": metric(CALIBRATION + [["ece", 0.35], ["mce", 0.7], ["bins", 10]]),
                        "stderr": "expected calibration error 0.3500 is above --max-ece 0.3\n"}}},
    "reliability": {
        "argv": ["stats", "reliability", PROBS], "stdout": table(RELIABILITY, TEN_BINS),
        "options": {
            "bins": {"argv": ["stats", "reliability", PROBS, "--bins", "4"],
                     "stdout": table(RELIABILITY, [bin_row(1, "[0, 0.25)", 2, 0.15, 0), bin_row(2, "[0.25, 0.5)", 2, 0.35, 1),
                                                   bin_row(3, "[0.5, 0.75)", 2, 0.65, 1), bin_row(4, "[0.75, 1]", 2, 0.85, 2)])},
            "confidence": {"argv": ["stats", "reliability", PROBS, "--bins", "2", "--confidence", "0.8"],
                           "stdout": table(RELIABILITY, [bin_row(1, "[0, 0.5)", 4, 0.25, 1, 0.8), bin_row(2, "[0.5, 1]", 4, 0.75, 3, 0.8)])},
            "format": {"argv": ["stats", "reliability", PROBS, "--bins", "2", "--format", "json"],
                       "stdout": same_json([dict(zip(RELIABILITY, row)) for row in
                                            [bin_row(1, "[0, 0.5)", 4, 0.25, 1), bin_row(2, "[0.5, 1]", 4, 0.75, 3)]])}}},
    "auc": {
        "argv": ["stats", "auc", PROBS],
        "stdout": metric([["rows", 8], ["positives", 4], ["negatives", 4], ["auc", 0.8125], ["low", r4(AUC_LOW)],
                          ["high", r4(AUC_HIGH)], ["gini", 0.625]]),
        "options": {
            "confidence": {"argv": ["stats", "auc", PROBS, "--confidence", "0.5"],
                           "stdout": metric([["rows", 8], ["positives", 4], ["negatives", 4], ["auc", 0.8125],
                                             ["low", r4(hanley_mcneil(13 / 16, 4, 4, 0.5)[0])],
                                             ["high", r4(hanley_mcneil(13 / 16, 4, 4, 0.5)[1])], ["gini", 0.625]])},
            # TIES: positives 0.8 and 0.5, negatives 0.8 and 0.2: 0.8 ties 0.8 (one half), beats 0.2; 0.5 beats 0.2: 2.5/4.
            "format": {"argv": ["stats", "auc", TIES, "--format", "json"],
                       "stdout": same_json([{"metric": m, "value": v} for m, v in [
                           ["rows", 4], ["positives", 2], ["negatives", 2], ["auc", 0.625], ["low", r4(hanley_mcneil(0.625, 2, 2)[0])],
                           ["high", r4(hanley_mcneil(0.625, 2, 2)[1])], ["gini", 0.25]]])}}},
    "sweep": {
        "argv": ["stats", "sweep", PROBS], "stdout": table(SWEEP, [[t] + S[t] for t in sorted(S)]),
        "options": {
            # 0.25 keeps the same rows as 0.3, and 0.75 the same as 0.8.
            "step": {"argv": ["stats", "sweep", PROBS, "--step", "0.25"],
                     "stdout": table(SWEEP, [[0.25] + S[0.3], [0.5] + S[0.5], [0.75] + S[0.8]])},
            # Youden's J (recall + specificity - 1) by threshold: 0, .25, .5, .25, .5, .5, .25, .5, .25: 0.3 is the lowest best.
            "best": {"argv": ["stats", "sweep", PROBS, "--best", "youden"], "stdout": table(SWEEP, [[0.3] + S[0.3]])},
            "format": {"argv": ["stats", "sweep", PROBS, "--step", "0.5", "--format", "markdown"],
                       "stdout": kit.render(SWEEP, [[0.5] + S[0.5]], "markdown") + "\n"}}},
    "coverage": {
        "argv": ["stats", "coverage", PROBS], "stdout": table(COVERAGE, coverage_rows()),
        "options": {
            # Lower bounds: 6/8 0.409, 4/6 0.300, 4/4 0.510: 0.75 is the lowest threshold reaching 0.5.
            "min_accuracy": {"argv": ["stats", "coverage", PROBS, "--min-accuracy", "0.5"],
                             "stdout": table(COVERAGE, [row for row in coverage_rows() if row[0] == 0.75])},
            "confidence": {"argv": ["stats", "coverage", PROBS, "--confidence", "0.8"], "stdout": table(COVERAGE, coverage_rows(0.8))}}},
}


class CliStatsTests(pack_tests(cli_stats.PACK, CASES)):
    def test_known_published_values(self):
        # Textbook values for 8 successes in 10 trials at 95%.
        rows = json.loads(run_cli(["stats", "interval", 8, 10, "--format", "json"])[1])
        self.assertEqual([(row["low"], row["high"]) for row in rows], [(0.4902, 0.9433), (0.4439, 0.9748), (0.4972, 0.9559)])

    def test_usage_errors_exit_two(self):
        for argv in (["stats", "interval", 11, 10], ["stats", "interval", 1, 0], ["stats", "interval", 1, 2, "--confidence", "1"],
                     ["stats", "sample-size", "--margin", "0"], ["stats", "sample-size", "--margin", "0.1", "--expected", "1"],
                     ["stats", "mcnemar", 3], ["stats", "mcnemar", 1, 2, "--file", TRIPLES],
                     ["stats", "kappa", str(DIR / "missing.csv")], ["stats", "kappa", LABELS, "--weighted", "linear"],
                     ["stats", "kappa", WIDE, "--columns", "rater_a,nobody"], ["stats", "metrics", LABELS, "--positive", "refund"],
                     ["stats", "calibration", PROBS, "--bins", "0"], ["stats", "sweep", PROBS, "--step", "0"],
                     ["stats", "auc", write("one-class.csv", "p,y\n0.4,1\n0.7,1\n")],
                     ["stats", "calibration", write("bad-p.csv", "p,y\n0.4,1\n1.7,0\n")],
                     ["stats", "calibration", write("bad-y.csv", "p,y\n0.4,maybe\n")]):
            self.assertEqual(run_cli(argv)[0], 2, argv)

    def test_blank_only_files_exit_two(self):
        blank = write("blank-cells.csv", ",\n,\n")
        for command in ("kappa", "confusion", "metrics", "calibration", "reliability", "auc", "sweep", "coverage"):
            self.assertEqual(run_cli(["stats", command, blank])[0], 2, command)

    def test_weighted_average_follows_support(self):
        # Unequal supports: billing 3 (2 right), shipping 1 (1 right); predictions billing 2, shipping 2.
        # billing P 2/2 R 2/3 F 0.8; shipping P 1/2 R 1/1 F 2/3. Weighted by support 3:1 (not by predictions 2:2).
        path = write("uneven.csv", "label,prediction\nbilling,billing\nbilling,billing\nbilling,shipping\nshipping,shipping\n")
        rows = {row["class"]: row for row in json.loads(run_cli(["stats", "metrics", path, "--format", "json"])[1])}
        self.assertEqual(rows["macro avg"], {"class": "macro avg", "support": 4, "predicted": 4, "precision": 0.75,
                                             "recall": r4((2 / 3 + 1) / 2), "f1": r4((0.8 + 2 / 3) / 2)})
        self.assertEqual(rows["weighted avg"], {"class": "weighted avg", "support": 4, "predicted": 4,
                                                "precision": r4((3 * 1 + 0.5) / 4), "recall": 0.75,
                                                "f1": r4((3 * 0.8 + 2 / 3) / 4)})

    def test_quadratic_weighted_kappa(self):
        # Weights 1 - (|a - b| / 2)^2 on SCORES by hand: observed (4 + 2 * 0.75) / 6 = 11/12;
        # chance (2 * 4 + 2 * 5.5 + 2 * 4) / 36 = 27/36 = 0.75; kappa (11/12 - 3/4) / (1/4) = 2/3.
        self.assertEqual(run_cli(["stats", "kappa", SCORES, "--weighted", "quadratic"])[1],
                         metric([["pairs", 6], ["categories", 3], ["weights", "quadratic"], ["observed agreement", 0.9167],
                                 ["chance agreement", 0.75], ["kappa", 0.6667], ["strength", "substantial"]]))

    def test_coverage_exits_one_when_no_threshold_is_good_enough(self):
        code, out, err = run_cli(["stats", "coverage", PROBS, "--min-accuracy", "0.9"])
        self.assertEqual((code, out), (1, ""))
        self.assertIn("no threshold keeps an accuracy lower bound of 0.9", err)

    def test_semicolon_and_tab_files_and_json_arrays(self):
        rows = json.loads(run_cli(["stats", "auc", write("semi.csv", "0.9;1\n0.2;0\n0.6;0\n"), "--format", "json"])[1])
        self.assertEqual(rows[3], {"metric": "auc", "value": 1.0})
        arrays = write("arrays.jsonl", '["billing", "billing"]\n["product", "billing"]\n')
        self.assertEqual(json.loads(run_cli(["stats", "confusion", arrays, "--format", "json"])[1])[0],
                         {"label": "billing", "billing": 1, "product": 0, "total": 1})


if __name__ == "__main__":
    unittest.main()
