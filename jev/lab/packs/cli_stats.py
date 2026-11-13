"""Offline statistics commands (`lab.py stats ...`) for numbers and files the user gives.

Counts go on the command line: a proportion's interval (Wilson, Clopper-Pearson, Jeffreys), the sample size a margin
needs, a two-proportion test and McNemar's test for two systems on the same rows. Files hold one pair per line, as CSV
(comma, tab or semicolon, with a header line unless the first line is all numbers) or JSON lines (objects or arrays):

  * label,prediction pairs: a confusion matrix, per-class precision, recall and F1, and Cohen's kappa for two people's
    labels of the same rows;
  * probability,outcome pairs (outcome 1/0, true/false or yes/no): Brier score, log loss, expected calibration error,
    a reliability table, ROC AUC, a threshold sweep and the coverage a confidence threshold keeps.

The numerics come from jev/lab/mathx.py, the Python twin of the browser's math library. Nothing here reads the
Workbench data directory, writes a file or calls the model.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from jev.lab import kit, mathx

METHODS = ("wilson", "clopper-pearson", "jeffreys")
YES = {"1", "true", "yes", "y"}
NO = {"0", "false", "no", "n"}
FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the result in another format"}
LOG_LOSS_CLIP = 1e-15


# ---------- numbers ----------


def _r(value: Optional[float], digits: int = 4) -> Optional[float]:
    """A value rounded to `digits` decimals (halves away from zero), or None."""
    return None if value is None else mathx.round(value, digits)


def _sig(value: Optional[float]) -> Optional[float]:
    """A p-value to four significant digits, so a tiny one still shows."""
    return None if value is None else float("%.4g" % value)


def _z(confidence: float) -> float:
    return mathx.normal_quantile(1 - (1 - confidence) / 2)


def wilson(k: int, n: int, z: float) -> Tuple[float, float]:
    """The Wilson score interval for k successes in n trials."""
    p = k / n
    denominator = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return max(0.0, centre - half), min(1.0, centre + half)


def clopper_pearson(k: int, n: int, confidence: float) -> Tuple[float, float]:
    alpha = 1 - confidence
    low = 0.0 if k == 0 else mathx.beta_quantile(alpha / 2, k, n - k + 1)
    high = 1.0 if k == n else mathx.beta_quantile(1 - alpha / 2, k + 1, n - k)
    return low, high


def jeffreys(k: int, n: int, confidence: float) -> Tuple[float, float]:
    alpha = 1 - confidence
    low = 0.0 if k == 0 else mathx.beta_quantile(alpha / 2, k + 0.5, n - k + 0.5)
    high = 1.0 if k == n else mathx.beta_quantile(1 - alpha / 2, k + 0.5, n - k + 0.5)
    return low, high


def interval(method: str, k: int, n: int, confidence: float) -> Tuple[float, float]:
    if method == "wilson":
        return wilson(k, n, _z(confidence))
    if method == "clopper-pearson":
        return clopper_pearson(k, n, confidence)
    return jeffreys(k, n, confidence)


def _confidence(value: float) -> float:
    if not (isinstance(value, float) and math.isfinite(value) and 0 < value < 1):
        raise kit.CliError("--confidence must be between 0 and 1, such as 0.95")
    return value


def _share(value: Optional[float], flag: str) -> Optional[float]:
    if value is not None and not (math.isfinite(value) and 0 <= value <= 1):
        raise kit.CliError("%s must be between 0 and 1" % flag)
    return value


def _counts(k: int, n: int, what: str = "") -> None:
    if n < 1 or k < 0 or k > n:
        raise kit.CliError("%ssuccesses must be between 0 and the trials, and trials at least 1" % what)


def _add_confidence(parser: Any) -> None:
    parser.add_argument("--confidence", type=float, default=0.95, metavar="LEVEL", help="confidence level (default: 0.95)")


def _metric_table(args: Any, rows: List[list]) -> None:
    kit.emit(args, ["metric", "value"], rows)


# ---------- reading pair files ----------


def _read(path: str) -> str:
    target = Path(path)
    if not target.is_file():
        raise kit.CliError("no file %s" % path)
    try:
        return target.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as err:
        raise kit.CliError("cannot read %s: %s" % (path, err))


def _delimiter(line: str) -> str:
    counts = {",": 0, "\t": 0, ";": 0}
    quoted = False
    for ch in line:
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in counts:
            counts[ch] += 1
    best = max(counts, key=lambda d: (counts[d], d == ","))
    return best if counts[best] else ","


def _number(text: Any) -> bool:
    try:
        return math.isfinite(float(text))
    except (TypeError, ValueError):
        return False


def _cell(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float)) and not isinstance(value, bool):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value, ensure_ascii=False)


def _pick(names: Sequence[str], wanted: Optional[str], width: int) -> List[int]:
    """Indexes of the columns to read: --columns by name (exact, then ignoring case), or the first `width`."""
    if not wanted:
        if len(names) < width:
            raise kit.CliError("the file needs %d columns, it has %d" % (width, len(names)))
        return list(range(width))
    asked = [part.strip() for part in wanted.split(",")]
    if len(asked) != width or not all(asked):
        raise kit.CliError("--columns takes %d column names separated by commas" % width)
    out = []
    for name in asked:
        if name in names:
            out.append(list(names).index(name))
            continue
        folded = [i for i, have in enumerate(names) if str(have).lower() == name.lower()]
        if len(folded) != 1:
            raise kit.CliError("no column %r; the file has %s" % (name, ", ".join(str(n) for n in names)))
        out.append(folded[0])
    return out


def read_pairs(path: str, columns: Optional[str], width: int = 2) -> List[Tuple[int, list]]:
    """(line number, [cell, ...]) for every data line of a CSV or JSON-lines file, with `width` chosen cells."""
    text = _read(path)
    lines = [(number, line.strip()) for number, line in enumerate(text.split("\n"), 1) if line.strip()]
    if not lines:
        raise kit.CliError("%s is empty" % path)
    out: List[Tuple[int, list]] = []
    if lines[0][1][:1] in ("{", "["):
        keys: Optional[List[int]] = None
        names: List[str] = []
        for number, line in lines:
            try:
                value = json.loads(line)
            except ValueError:
                raise kit.CliError("line %d is not JSON" % number)
            if isinstance(value, dict):
                if keys is None:
                    names = list(value)
                    keys = _pick(names, columns, width)
                out.append((number, [_cell(value.get(names[i])) for i in keys]))
            elif isinstance(value, list):
                if columns:
                    raise kit.CliError("--columns names keys of JSON objects or a CSV header; line %d is an array" % number)
                out.append((number, [_cell(value[i]) if i < len(value) else None for i in range(width)]))
            else:
                raise kit.CliError("line %d is neither a JSON object nor an array" % number)
        return out
    try:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=_delimiter(lines[0][1]))
        records = [(reader.line_num, row) for row in reader if any(cell.strip() for cell in row)]
    except csv.Error as err:
        raise kit.CliError("cannot read %s as CSV: %s" % (path, err))
    if not records:
        raise kit.CliError("%s holds only blank cells" % path)
    first = records[0][1]
    header = bool(columns) or not all(_number(cell) for cell in first)
    if header:
        picked = _pick([cell.strip() for cell in first], columns, width)
        records = records[1:]
    else:
        picked = _pick(first, None, width)
    for number, row in records:
        out.append((number, [row[i] if i < len(row) else None for i in picked]))
    return out


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _skipped(count: int) -> None:
    if count:
        print("skipped %d line%s with a blank value" % (count, "" if count == 1 else "s"), file=sys.stderr)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else json.dumps(value)


def label_pairs(path: str, columns: Optional[str], width: int = 2) -> List[tuple]:
    """Tuples of label texts, lines with a blank cell left out (and counted on stderr)."""
    found, skipped = [], 0
    for _number_, cells in read_pairs(path, columns, width):
        if any(_blank(cell) for cell in cells):
            skipped += 1
            continue
        found.append(tuple(_text(cell) for cell in cells))
    _skipped(skipped)
    if not found:
        raise kit.CliError("%s holds no complete pair" % path)
    return found


def _outcome(value: Any, number: int) -> int:
    text = str(value).strip().lower()
    if text in YES:
        return 1
    if text in NO:
        return 0
    if _number(text) and float(text) in (0.0, 1.0):
        return int(float(text))
    raise kit.CliError("line %d: outcome %r is not 1/0, true/false or yes/no" % (number, str(value)))


def probability_pairs(path: str, columns: Optional[str]) -> List[Tuple[float, int]]:
    """(probability, outcome) pairs; a blank line part is skipped, anything else malformed exits 2."""
    found, skipped = [], 0
    for number, (probability, outcome) in read_pairs(path, columns, 2):
        if _blank(probability) or _blank(outcome):
            skipped += 1
            continue
        if isinstance(probability, bool) or not _number(probability) or not 0 <= float(probability) <= 1:
            raise kit.CliError("line %d: probability %r is not a number between 0 and 1" % (number, probability))
        found.append((float(probability), _outcome(outcome, number)))
    _skipped(skipped)
    if not found:
        raise kit.CliError("%s holds no probability,outcome pair" % path)
    return found


def _add_file(parser: Any, what: str) -> None:
    parser.add_argument("file", help="a CSV or JSON-lines file of %s pairs" % what)


def _add_columns(parser: Any, what: str) -> None:
    parser.add_argument("--columns", metavar="A,B", help="the %s columns by header name or JSON key" % what)


# ---------- stats interval ----------


def _configure_interval(parser: Any) -> None:
    parser.add_argument("successes", type=int)
    parser.add_argument("trials", type=int)
    parser.add_argument("--method", choices=METHODS, help="print one method only")
    _add_confidence(parser)
    kit.add_format(parser)


def run_interval(args: Any) -> int:
    _counts(args.successes, args.trials)
    confidence = _confidence(args.confidence)
    rows = []
    for method in ([args.method] if args.method else METHODS):
        low, high = interval(method, args.successes, args.trials, confidence)
        rows.append([method, _r(args.successes / args.trials), _r(low), _r(high)])
    kit.emit(args, ["method", "estimate", "low", "high"], rows)
    return 0


# ---------- stats sample-size ----------


def _configure_sample_size(parser: Any) -> None:
    parser.add_argument("--margin", type=float, required=True, metavar="M", help="the half-width the interval may have")
    parser.add_argument("--expected", type=float, default=0.5, metavar="P", help="the proportion you expect (default: 0.5)")
    parser.add_argument("--population", type=int, metavar="N", help="a finite population of N rows")
    parser.add_argument("--method", choices=("wald", "wilson"), default="wald", help="the interval the margin is for")
    _add_confidence(parser)
    kit.add_format(parser)


def _wilson_half(n: int, p: float, z: float) -> float:
    return z / (n + z * z) * math.sqrt(n * p * (1 - p) + z * z / 4)


def run_sample_size(args: Any) -> int:
    confidence = _confidence(args.confidence)
    margin, p = args.margin, args.expected
    if not (math.isfinite(margin) and 0 < margin <= 0.5):
        raise kit.CliError("--margin must be above 0 and at most 0.5")
    if not (math.isfinite(p) and 0 < p < 1):
        raise kit.CliError("--expected must be between 0 and 1")
    if args.population is not None and args.population < 1:
        raise kit.CliError("--population must be at least 1")
    z = _z(confidence)
    if args.method == "wald":
        base = z * z * p * (1 - p) / (margin * margin)
    else:
        low, high = 1, 1
        while _wilson_half(high, p, z) > margin:
            high *= 2
        while low < high:
            middle = (low + high) // 2
            if _wilson_half(middle, p, z) <= margin:
                high = middle
            else:
                low = middle + 1
        base = float(low)
    if args.population is not None:
        base = base / (1 + (base - 1) / args.population)
    size = int(math.ceil(base - 1e-9))
    rows = [["method", args.method], ["confidence", confidence], ["margin", margin], ["expected proportion", p]]
    if args.population is not None:
        rows.append(["population", args.population])
    rows.append(["sample size", max(size, 1)])
    _metric_table(args, rows)
    return 0


# ---------- stats two-proportions ----------


def _configure_two(parser: Any) -> None:
    for name in ("successes_a", "trials_a", "successes_b", "trials_b"):
        parser.add_argument(name, type=int)
    parser.add_argument("--alternative", choices=("two-sided", "greater", "less"), default="two-sided",
                        help="the alternative to rate A = rate B (greater: A above B)")
    parser.add_argument("--alpha", type=float, metavar="A", help="exit 1 when the p-value is below A")
    _add_confidence(parser)
    kit.add_format(parser)


def run_two(args: Any) -> int:
    k1, n1, k2, n2 = args.successes_a, args.trials_a, args.successes_b, args.trials_b
    _counts(k1, n1, "A's ")
    _counts(k2, n2, "B's ")
    confidence = _confidence(args.confidence)
    _share(args.alpha, "--alpha")
    p1, p2 = k1 / n1, k2 / n2
    difference = p1 - p2
    pooled = (k1 + k2) / (n1 + n2)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    z_value: Optional[float] = None
    p_value = 1.0
    if se > 0:
        z_value = difference / se
        if args.alternative == "greater":
            p_value = mathx.normal_sf(z_value)
        elif args.alternative == "less":
            p_value = mathx.normal_cdf(z_value)
        else:
            p_value = min(1.0, 2 * mathx.normal_sf(abs(z_value)))
    z = _z(confidence)
    l1, u1 = wilson(k1, n1, z)
    l2, u2 = wilson(k2, n2, z)
    low = difference - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
    high = difference + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
    _metric_table(args, [["rate A", _r(p1)], ["rate B", _r(p2)], ["difference", _r(difference)], ["low", _r(low)],
                         ["high", _r(high)], ["z", _r(z_value)], ["p-value", _sig(p_value)]])
    if args.alpha is not None and p_value < args.alpha:
        print("the difference is significant at alpha %g (p = %.4g)" % (args.alpha, p_value), file=sys.stderr)
        return 1
    return 0


# ---------- stats mcnemar ----------


def _configure_mcnemar(parser: Any) -> None:
    parser.add_argument("counts", type=int, nargs="*", metavar="B C",
                        help="rows A got right and B wrong, then rows A got wrong and B right")
    parser.add_argument("--file", metavar="PATH", help="a CSV or JSON-lines file of label,a,b triples to count them from")
    parser.add_argument("--alpha", type=float, metavar="A", help="exit 1 when the exact p-value is below A")
    _add_columns(parser, "label, A and B")
    kit.add_format(parser)


def run_mcnemar(args: Any) -> int:
    _share(args.alpha, "--alpha")
    rows: List[list] = []
    if args.file:
        if args.counts:
            raise kit.CliError("give the counts B C or --file, not both")
        triples = label_pairs(args.file, args.columns, 3)
        b = sum(1 for label, a, other in triples if a == label and other != label)
        c = sum(1 for label, a, other in triples if a != label and other == label)
        rows.append(["pairs", len(triples)])
    else:
        if len(args.counts) != 2 or min(args.counts) < 0:
            raise kit.CliError("give two counts, B C, of zero or more, or --file")
        b, c = args.counts
    discordant = b + c
    chi: Optional[float] = None
    p_chi, p_exact = 1.0, 1.0
    if discordant:
        chi = max(abs(b - c) - 1, 0) ** 2 / discordant
        p_chi = mathx.chi_square_sf(chi, 1)
        p_exact = min(1.0, 2 * mathx.binomial_cdf(min(b, c), discordant, 0.5))
    rows += [["A right, B wrong", b], ["A wrong, B right", c], ["discordant", discordant], ["chi-square", _r(chi)],
             ["p (chi-square)", _sig(p_chi)], ["p (exact)", _sig(p_exact)]]
    _metric_table(args, rows)
    if args.alpha is not None and p_exact < args.alpha:
        print("A and B differ at alpha %g (exact p = %.4g)" % (args.alpha, p_exact), file=sys.stderr)
        return 1
    return 0


# ---------- stats kappa ----------


def _configure_kappa(parser: Any) -> None:
    _add_file(parser, "label")
    parser.add_argument("--weighted", choices=("linear", "quadratic"),
                        help="weighted kappa for numeric (ordinal) labels such as Score levels")
    _add_confidence(parser)
    _add_columns(parser, "two raters'")
    kit.add_format(parser)


def _strength(kappa: float) -> str:
    """Landis and Koch's words for a kappa."""
    if kappa < 0:
        return "poor"
    for top, word in ((0.2, "slight"), (0.4, "fair"), (0.6, "moderate"), (0.8, "substantial")):
        if kappa <= top:
            return word
    return "almost perfect"


def run_kappa(args: Any) -> int:
    confidence = _confidence(args.confidence)
    pairs = label_pairs(args.file, args.columns)
    n = len(pairs)
    categories = sorted({value for pair in pairs for value in pair})
    first: Dict[str, int] = {}
    second: Dict[str, int] = {}
    for a, b in pairs:
        first[a] = first.get(a, 0) + 1
        second[b] = second.get(b, 0) + 1
    if args.weighted:
        if not all(_number(value) for value in categories):
            raise kit.CliError("--weighted needs numeric labels, such as Score levels")
        values = [float(value) for value in categories]
        spread = max(values) - min(values)

        def weight(a: str, b: str) -> float:
            if spread == 0:
                return 1.0
            distance = abs(float(a) - float(b)) / spread
            return 1 - (distance if args.weighted == "linear" else distance * distance)

        observed = sum(weight(a, b) for a, b in pairs) / n
        chance = sum(first.get(a, 0) * second.get(b, 0) * weight(a, b) for a in categories for b in categories) / (n * n)
    else:
        observed = sum(1 for a, b in pairs if a == b) / n
        chance = sum(first.get(c, 0) * second.get(c, 0) for c in categories) / (n * n)
    rows: List[list] = [["pairs", n], ["categories", len(categories)]]
    if args.weighted:
        rows.append(["weights", args.weighted])
    rows += [["observed agreement", _r(observed)], ["chance agreement", _r(chance)]]
    if chance >= 1:
        rows += [["kappa", None], ["strength", "undefined: both raters used one label only"]]
    else:
        kappa = (observed - chance) / (1 - chance)
        rows.append(["kappa", _r(kappa)])
        if not args.weighted:
            se = math.sqrt(observed * (1 - observed) / (n * (1 - chance) ** 2))
            z = _z(confidence)
            rows += [["low", _r(max(-1.0, kappa - z * se))], ["high", _r(min(1.0, kappa + z * se))]]
        rows.append(["strength", _strength(kappa)])
    _metric_table(args, rows)
    return 0


# ---------- stats confusion ----------


def _configure_confusion(parser: Any) -> None:
    _add_file(parser, "label,prediction")
    parser.add_argument("--normalize", action="store_true", help="show each cell as a percent of its label's row")
    _add_columns(parser, "label and prediction")
    kit.add_format(parser)


def _pct(part: int, whole: int) -> Optional[float]:
    return _r(100.0 * part / whole, 1) if whole else None


def run_confusion(args: Any) -> int:
    pairs = label_pairs(args.file, args.columns)
    categories = sorted({value for pair in pairs for value in pair})
    counts: Dict[Tuple[str, str], int] = {}
    for label, prediction in pairs:
        counts[(label, prediction)] = counts.get((label, prediction), 0) + 1
    rows = []
    for label in categories:
        cells = [counts.get((label, prediction), 0) for prediction in categories]
        total = sum(cells)
        rows.append([label] + ([_pct(cell, total) for cell in cells] + [100.0 if total else None] if args.normalize
                               else cells + [total]))
    columns_total = [sum(counts.get((label, prediction), 0) for label in categories) for prediction in categories]
    n = len(pairs)
    rows.append(["total"] + ([_pct(cell, n) for cell in columns_total] + [100.0] if args.normalize else columns_total + [n]))
    kit.emit(args, ["label"] + categories + ["total"], rows)
    return 0


# ---------- stats metrics ----------


def _configure_metrics(parser: Any) -> None:
    _add_file(parser, "label,prediction")
    parser.add_argument("--positive", metavar="CLASS", help="a binary report with CLASS as the positive class")
    parser.add_argument("--min-f1", type=float, metavar="X", help="exit 1 when a class's F1 is below X")
    _add_columns(parser, "label and prediction")
    kit.add_format(parser)


def _ratio(part: float, whole: float) -> Optional[float]:
    return part / whole if whole else None


def _f1(precision: Optional[float], recall: Optional[float]) -> Optional[float]:
    if precision is None or recall is None:
        return None
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def _binary_report(args: Any, pairs: List[tuple]) -> Optional[float]:
    positive = args.positive
    tp = sum(1 for label, prediction in pairs if label == positive and prediction == positive)
    fp = sum(1 for label, prediction in pairs if label != positive and prediction == positive)
    fn = sum(1 for label, prediction in pairs if label == positive and prediction != positive)
    tn = len(pairs) - tp - fp - fn
    precision, recall = _ratio(tp, tp + fp), _ratio(tp, tp + fn)
    f1 = _f1(precision, recall)
    denominator = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = (tp * tn - fp * fn) / denominator if denominator else None
    _metric_table(args, [["positives", tp + fn], ["tp", tp], ["fp", fp], ["fn", fn], ["tn", tn],
                         ["accuracy", _r((tp + tn) / len(pairs))], ["precision", _r(precision)], ["recall", _r(recall)],
                         ["specificity", _r(_ratio(tn, tn + fp))], ["npv", _r(_ratio(tn, tn + fn))], ["f1", _r(f1)],
                         ["mcc", _r(mcc)]])
    return f1


def run_metrics(args: Any) -> int:
    _share(args.min_f1, "--min-f1")
    pairs = label_pairs(args.file, args.columns)
    if args.positive is not None:
        if args.positive not in {value for pair in pairs for value in pair}:
            raise kit.CliError("--positive %s is neither a label nor a prediction in the file" % args.positive)
        f1 = _binary_report(args, pairs)
        low = [args.positive] if args.min_f1 is not None and (f1 or 0.0) < args.min_f1 else []
    else:
        n = len(pairs)
        rows, low = [], []
        sums = [0.0, 0.0, 0.0]
        weighted = [0.0, 0.0, 0.0]
        categories = sorted({value for pair in pairs for value in pair})
        for category in categories:
            support = sum(1 for label, _p in pairs if label == category)
            predicted = sum(1 for _l, prediction in pairs if prediction == category)
            hits = sum(1 for label, prediction in pairs if label == category == prediction)
            precision = hits / predicted if predicted else 0.0
            recall = hits / support if support else 0.0
            f1 = _f1(precision, recall)
            for index, value in enumerate((precision, recall, f1)):
                sums[index] += value
                weighted[index] += value * support
            rows.append([category, support, predicted, _r(precision), _r(recall), _r(f1)])
            if args.min_f1 is not None and f1 < args.min_f1:
                low.append(category)
        count = len(categories)
        rows.append(["macro avg", n, n] + [_r(value / count) for value in sums])
        rows.append(["weighted avg", n, n] + [_r(value / n) for value in weighted])
        rows.append(["accuracy", n, n, None, None, _r(sum(1 for label, prediction in pairs if label == prediction) / n)])
        kit.emit(args, ["class", "support", "predicted", "precision", "recall", "f1"], rows)
    if low:
        print("F1 below %g: %s" % (args.min_f1, ", ".join(low)), file=sys.stderr)
        return 1
    return 0


# ---------- calibration, reliability ----------


def _bins_of(pairs: List[Tuple[float, int]], bins: int, strategy: str) -> List[List[Tuple[float, int]]]:
    """The pairs grouped into `bins` bins: equal width on [0, 1] (uniform) or equal counts by rank (quantile)."""
    groups: List[List[Tuple[float, int]]] = [[] for _ in range(bins)]
    if strategy == "uniform":
        for pair in pairs:
            groups[min(int(math.floor(pair[0] * bins + 1e-9)), bins - 1)].append(pair)
    else:
        ordered = sorted(pairs, key=lambda pair: pair[0])
        for rank, pair in enumerate(ordered):
            groups[rank * bins // len(ordered)].append(pair)
    return groups


def _bins_argument(value: int) -> int:
    if value < 1 or value > 1000:
        raise kit.CliError("--bins must be between 1 and 1000")
    return value


def _configure_calibration(parser: Any) -> None:
    _add_file(parser, "probability,outcome")
    parser.add_argument("--bins", type=int, default=10, metavar="N", help="bins for the calibration error (default: 10)")
    parser.add_argument("--strategy", choices=("uniform", "quantile"), default="uniform",
                        help="equal-width bins (uniform) or bins with equal row counts (quantile)")
    parser.add_argument("--max-ece", type=float, metavar="X", help="exit 1 when the expected calibration error is above X")
    _add_columns(parser, "probability and outcome")
    kit.add_format(parser)


def run_calibration(args: Any) -> int:
    bins = _bins_argument(args.bins)
    _share(args.max_ece, "--max-ece")
    pairs = probability_pairs(args.file, args.columns)
    n = len(pairs)
    positives = sum(y for _p, y in pairs)
    brier = sum((p - y) ** 2 for p, y in pairs) / n
    loss = -sum(math.log(min(max(p, LOG_LOSS_CLIP), 1 - LOG_LOSS_CLIP)) if y
                else math.log(1 - min(max(p, LOG_LOSS_CLIP), 1 - LOG_LOSS_CLIP)) for p, y in pairs) / n
    gaps = [(len(group), abs(sum(p for p, _y in group) / len(group) - sum(y for _p, y in group) / len(group)))
            for group in _bins_of(pairs, bins, args.strategy) if group]
    ece = sum(size * gap for size, gap in gaps) / n
    mce = max(gap for _size, gap in gaps)
    _metric_table(args, [["rows", n], ["positives", positives], ["base rate", _r(positives / n)],
                         ["mean probability", _r(sum(p for p, _y in pairs) / n)], ["brier score", _r(brier)],
                         ["log loss", _r(loss)], ["ece", _r(ece)], ["mce", _r(mce)], ["bins", bins]])
    if args.max_ece is not None and ece > args.max_ece:
        print("expected calibration error %.4f is above --max-ece %g" % (ece, args.max_ece), file=sys.stderr)
        return 1
    return 0


def _edge(value: float) -> str:
    return "%g" % round(value, 6)


def _configure_reliability(parser: Any) -> None:
    _add_file(parser, "probability,outcome")
    parser.add_argument("--bins", type=int, default=10, metavar="N", help="number of bins (default: 10)")
    parser.add_argument("--strategy", choices=("uniform", "quantile"), default="uniform",
                        help="equal-width bins (uniform) or bins with equal row counts (quantile)")
    _add_confidence(parser)
    _add_columns(parser, "probability and outcome")
    kit.add_format(parser)


def run_reliability(args: Any) -> int:
    bins = _bins_argument(args.bins)
    confidence = _confidence(args.confidence)
    pairs = probability_pairs(args.file, args.columns)
    z = _z(confidence)
    rows = []
    for index, group in enumerate(_bins_of(pairs, bins, args.strategy)):
        if args.strategy == "uniform":
            span = "[%s, %s%s" % (_edge(index / bins), _edge((index + 1) / bins), "]" if index == bins - 1 else ")")
        elif group:
            span = "[%s, %s]" % (_edge(group[0][0]), _edge(group[-1][0]))
        else:
            span = ""
        if not group:
            rows.append([index + 1, span, 0, None, None, None, None, None])
            continue
        size, hits = len(group), sum(y for _p, y in group)
        mean = sum(p for p, _y in group) / size
        low, high = wilson(hits, size, z)
        rows.append([index + 1, span, size, _r(mean), _r(hits / size), _r(hits / size - mean), _r(low), _r(high)])
    kit.emit(args, ["bin", "range", "rows", "mean probability", "observed rate", "gap", "low", "high"], rows)
    return 0


# ---------- stats auc ----------


def _configure_auc(parser: Any) -> None:
    _add_file(parser, "probability,outcome")
    _add_confidence(parser)
    _add_columns(parser, "probability and outcome")
    kit.add_format(parser)


def auc(pairs: List[Tuple[float, int]]) -> float:
    """The area under the ROC curve: the chance a positive row scores above a negative one, ties counting half."""
    ordered = sorted(pairs, key=lambda pair: pair[0])
    rank_sum, index = 0.0, 0
    while index < len(ordered):
        end = index
        while end + 1 < len(ordered) and ordered[end + 1][0] == ordered[index][0]:
            end += 1
        average = (index + end) / 2 + 1
        rank_sum += average * sum(y for _p, y in ordered[index:end + 1])
        index = end + 1
    positives = sum(y for _p, y in pairs)
    negatives = len(pairs) - positives
    return (rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def run_auc(args: Any) -> int:
    confidence = _confidence(args.confidence)
    pairs = probability_pairs(args.file, args.columns)
    positives = sum(y for _p, y in pairs)
    negatives = len(pairs) - positives
    if not positives or not negatives:
        raise kit.CliError("AUC needs rows of both outcomes; this file has %s only" % ("positives" if positives else "negatives"))
    area = auc(pairs)
    q1, q2 = area / (2 - area), 2 * area * area / (1 + area)
    variance = (area * (1 - area) + (positives - 1) * (q1 - area * area) + (negatives - 1) * (q2 - area * area)) \
        / (positives * negatives)
    half = _z(confidence) * math.sqrt(max(variance, 0.0))
    _metric_table(args, [["rows", len(pairs)], ["positives", positives], ["negatives", negatives], ["auc", _r(area)],
                         ["low", _r(max(0.0, area - half))], ["high", _r(min(1.0, area + half))], ["gini", _r(2 * area - 1)]])
    return 0


# ---------- stats sweep, coverage ----------


def _thresholds(start: float, step: float) -> List[float]:
    if not (math.isfinite(step) and 0.001 <= step <= 0.5):
        raise kit.CliError("--step must be between 0.001 and 0.5")
    out, index = [], 0
    while True:
        value = round(start + index * step, 10)
        if value >= 1:
            return out
        if value > 0:
            out.append(value)
        index += 1


SWEEP = ["threshold", "predicted positive", "tp", "fp", "fn", "tn", "precision", "recall", "specificity", "f1", "accuracy"]


def _configure_sweep(parser: Any) -> None:
    _add_file(parser, "probability,outcome")
    parser.add_argument("--step", type=float, default=0.1, metavar="S", help="threshold step (default: 0.1)")
    parser.add_argument("--best", choices=("f1", "youden", "accuracy"),
                        help="print only the threshold with the best F1, Youden's J or accuracy (the lowest on a tie)")
    _add_columns(parser, "probability and outcome")
    kit.add_format(parser)


def run_sweep(args: Any) -> int:
    thresholds = _thresholds(0.0, args.step)
    pairs = probability_pairs(args.file, args.columns)
    rows, scores = [], []
    for t in thresholds:
        tp = sum(1 for p, y in pairs if p >= t and y)
        fp = sum(1 for p, y in pairs if p >= t and not y)
        fn = sum(1 for p, y in pairs if p < t and y)
        tn = len(pairs) - tp - fp - fn
        precision, recall, specificity = _ratio(tp, tp + fp), _ratio(tp, tp + fn), _ratio(tn, tn + fp)
        f1 = _f1(precision, recall) if precision is not None else (0.0 if recall is not None else None)
        accuracy = (tp + tn) / len(pairs)
        rows.append([t, tp + fp, tp, fp, fn, tn, _r(precision), _r(recall), _r(specificity), _r(f1), _r(accuracy)])
        if args.best == "f1":
            scores.append(f1 if f1 is not None else -1.0)
        elif args.best == "youden":
            scores.append((recall or 0.0) + (specificity or 0.0) - 1)
        else:
            scores.append(accuracy)
    if args.best:
        top = max(scores)
        rows = [rows[scores.index(top)]]
    kit.emit(args, SWEEP, rows)
    return 0


def _configure_coverage(parser: Any) -> None:
    _add_file(parser, "probability,outcome")
    parser.add_argument("--min-accuracy", type=float, metavar="A",
                        help="print the lowest threshold whose accuracy lower bound reaches A; exit 1 when none does")
    parser.add_argument("--step", type=float, default=0.05, metavar="S", help="threshold step from 0.5 (default: 0.05)")
    _add_confidence(parser)
    _add_columns(parser, "probability and outcome")
    kit.add_format(parser)


def run_coverage(args: Any) -> int:
    confidence = _confidence(args.confidence)
    _share(args.min_accuracy, "--min-accuracy")
    thresholds = _thresholds(0.5, args.step)
    pairs = probability_pairs(args.file, args.columns)
    z = _z(confidence)
    rows = []
    for t in thresholds:
        kept = [(p, y) for p, y in pairs if max(p, 1 - p) >= t - 1e-9]
        correct = sum(1 for p, y in kept if (p >= 0.5) == bool(y))
        accuracy = _ratio(correct, len(kept))
        low = wilson(correct, len(kept), z)[0] if kept else None
        rows.append([t, len(kept), _r(len(kept) / len(pairs)), correct, _r(accuracy), _r(low), low])
    columns = ["threshold", "automated", "coverage", "correct", "accuracy", "low"]
    if args.min_accuracy is not None:
        reached = [row for row in rows if row[-1] is not None and row[-1] >= args.min_accuracy]
        if not reached:
            print("no threshold keeps an accuracy lower bound of %g or more" % args.min_accuracy, file=sys.stderr)
            return 1
        rows = reached[:1]
    kit.emit(args, columns, [row[:-1] for row in rows])
    return 0


# ---------- the pack ----------

CONFIDENCE = "--confidence LEVEL sets the confidence level of the %s"

PACK = kit.define_pack({
    "id": "cli-stats",
    "surface": "python.cli",
    "title": "Statistics from counts and pair files",
    "about": "Offline statistics for evaluation numbers: proportion intervals, sample sizes, two-proportion and McNemar "
             "tests, Cohen's kappa, confusion matrices and per-class metrics from label,prediction files, and "
             "calibration, reliability, AUC, threshold sweeps and coverage from probability,outcome files. "
             "Numerics come from jev/lab/mathx.py; nothing reads Workbench data or calls the model.",
    "features": [
        {"id": "interval", "kind": "cli", "command": ["stats", "interval"], "configure": _configure_interval, "run": run_interval,
         "title": "Print Wilson, Clopper-Pearson and Jeffreys intervals for K successes in N trials",
         "options": [{"id": "method", "title": "--method wilson|clopper-pearson|jeffreys prints one interval only"},
                     {"id": "confidence", "title": CONFIDENCE % "intervals"},
                     dict(FORMAT)]},
        {"id": "sample_size", "kind": "cli", "command": ["stats", "sample-size"], "configure": _configure_sample_size,
         "run": run_sample_size,
         "title": "Work out how many labeled rows an accuracy estimate needs for a chosen margin of error",
         "options": [{"id": "confidence", "title": CONFIDENCE % "margin"},
                     {"id": "expected", "title": "--expected P plans for an expected proportion instead of 0.5"},
                     {"id": "population", "title": "--population N applies the finite-population correction"},
                     {"id": "method", "title": "--method wilson finds the smallest size whose Wilson interval meets the margin"}]},
        {"id": "two_proportions", "kind": "cli", "command": ["stats", "two-proportions"], "configure": _configure_two,
         "run": run_two,
         "title": "Compare two proportions: the difference with a Newcombe interval, a pooled z test and its p-value",
         "options": [{"id": "confidence", "title": CONFIDENCE % "difference's interval"},
                     {"id": "alternative", "title": "--alternative greater|less runs a one-sided test"},
                     {"id": "alpha", "title": "--alpha A exits 1 when the difference is significant at A"}]},
        {"id": "mcnemar", "kind": "cli", "command": ["stats", "mcnemar"], "configure": _configure_mcnemar, "run": run_mcnemar,
         "title": "McNemar's test for two systems on the same rows from their discordant counts: chi-square and exact p",
         "options": [{"id": "file", "title": "--file PATH counts the discordant rows from label,a,b triples"},
                     {"id": "alpha", "title": "--alpha A exits 1 when the exact p-value is below A"}]},
        {"id": "kappa", "kind": "cli", "command": ["stats", "kappa"], "configure": _configure_kappa, "run": run_kappa,
         "title": "Cohen's kappa for two people's labels of the same rows, with an interval and Landis-Koch strength",
         "options": [{"id": "weighted", "title": "--weighted linear|quadratic gives weighted kappa for ordinal labels"},
                     {"id": "confidence", "title": CONFIDENCE % "kappa interval"},
                     {"id": "columns", "title": "--columns A,B reads two named columns of a wider file"}]},
        {"id": "confusion", "kind": "cli", "command": ["stats", "confusion"], "configure": _configure_confusion,
         "run": run_confusion,
         "title": "Build a confusion matrix with row and column totals from a label,prediction file",
         "options": [{"id": "normalize", "title": "--normalize shows each cell as a percent of its label's row"},
                     dict(FORMAT)]},
        {"id": "metrics", "kind": "cli", "command": ["stats", "metrics"], "configure": _configure_metrics, "run": run_metrics,
         "title": "Per-class precision, recall and F1 with macro and weighted averages and accuracy from label,prediction pairs",
         "options": [{"id": "positive", "title": "--positive CLASS prints a binary report: counts, specificity, NPV, F1, MCC"},
                     {"id": "min_f1", "title": "--min-f1 X exits 1 naming the classes whose F1 is below X"},
                     dict(FORMAT)]},
        {"id": "calibration", "kind": "cli", "command": ["stats", "calibration"], "configure": _configure_calibration,
         "run": run_calibration,
         "title": "Score probability,outcome pairs: Brier score, log loss, expected and maximum calibration error",
         "options": [{"id": "bins", "title": "--bins N sets how many bins the calibration error uses"},
                     {"id": "strategy", "title": "--strategy quantile bins rows into equal-count bins by rank"},
                     {"id": "max_ece", "title": "--max-ece X exits 1 when the expected calibration error is above X"}]},
        {"id": "reliability", "kind": "cli", "command": ["stats", "reliability"], "configure": _configure_reliability,
         "run": run_reliability,
         "title": "Print a reliability table: per bin the rows, mean probability, observed rate, gap and its interval",
         "options": [{"id": "bins", "title": "--bins N sets the number of reliability bins"},
                     {"id": "confidence", "title": CONFIDENCE % "observed rates' intervals"},
                     dict(FORMAT)]},
        {"id": "auc", "kind": "cli", "command": ["stats", "auc"], "configure": _configure_auc, "run": run_auc,
         "title": "ROC AUC of probability,outcome pairs with a Hanley-McNeil interval and the Gini coefficient",
         "options": [{"id": "confidence", "title": CONFIDENCE % "AUC interval"}, dict(FORMAT)]},
        {"id": "sweep", "kind": "cli", "command": ["stats", "sweep"], "configure": _configure_sweep, "run": run_sweep,
         "title": "Sweep decision thresholds: counts, precision, recall, specificity, F1 and accuracy at each",
         "options": [{"id": "step", "title": "--step S sets the spacing of the swept thresholds"},
                     {"id": "best", "title": "--best f1|youden|accuracy prints only the best threshold"},
                     dict(FORMAT)]},
        {"id": "coverage", "kind": "cli", "command": ["stats", "coverage"], "configure": _configure_coverage,
         "run": run_coverage,
         "title": "Coverage and accuracy kept at each confidence threshold, with the accuracy's lower bound",
         "options": [{"id": "min_accuracy", "title": "--min-accuracy A picks the lowest threshold whose lower bound reaches A"},
                     {"id": "confidence", "title": CONFIDENCE % "accuracy lower bounds"}]},
    ],
})
