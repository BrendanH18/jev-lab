"""Test split: hold some of a dataset's labeled rows out of every tuning decision, and count each look at them.

Calibrate, Policy, the costs, Review, Rules, and Compare all choose something (a threshold, a wording, a variant)
on the labeled rows they report on. Cross-validation (jev/holdout.py) says what one tuning run delivers on rows
it did not see, but after many rounds of rewording and retuning against the same rows, the choices themselves fit
those rows. A test split guards against that: lock() holds out randomly chosen exact-input groups, targeting a
share of the labeled rows, and marks every copy (including unlabeled ones) with "_test": true.
The marker never reaches the model (workbench._state removes it), the Workbench leaves those rows out of every
tuning panel and Compare, and their answers stay hidden, so nothing is chosen on them.

score() measures a gate (Policy's, or one question's threshold) on the test rows' answers from the user's own
Bulk run, and records the look in the dataset under "test": when, which gates, and which model, never the
answers or the result. Every look makes the next one less trustworthy, since a person who sees a test result
and changes the gate has tuned on the test rows too, so the report says how many looks came before.
"""

from __future__ import annotations

import random
import time
from typing import Any, Dict, List, Optional

from . import decisions, policy, workbench
from .calibrate import CalibrationError
from .workbench import LABEL_KEY, TEST_KEY, WorkbenchError

MIN_SHARE, MAX_SHARE = 0.1, 0.5
DEFAULT_SHARE = 0.25
MIN_ROWS = 2  # labeled rows needed on each side of the split
MAX_LOOKS_KEPT = 100


def _labeled(row: Any) -> bool:
    labels = row.get(LABEL_KEY) if isinstance(row, dict) else None
    return isinstance(labels, dict) and any(v is not None for v in labels.values())


def test_indexes(dataset: dict) -> List[int]:
    """Positions of the dataset's test rows."""
    return [i for i, row in enumerate(dataset["rows"]) if isinstance(row, dict) and row.get(TEST_KEY) is True]


@workbench.dataset_update()
def lock(dataset_id: str, share: Any = DEFAULT_SHARE, seed: Optional[int] = None) -> dict:
    """Hold out whole input groups nearest `share` of labeled rows. seed: tests; None draws at random."""
    if isinstance(share, bool) or not isinstance(share, (int, float)) or not MIN_SHARE <= share <= MAX_SHARE:
        raise WorkbenchError("share must be a number from %g to %g" % (MIN_SHARE, MAX_SHARE))
    dataset = workbench.load_dataset(dataset_id)
    if test_indexes(dataset):
        raise WorkbenchError("The dataset already has test rows. Remove the split first to draw a new one.")
    labeled = [i for i, row in enumerate(dataset["rows"]) if _labeled(row)]
    n = int(share * len(labeled) + 0.5)  # half up, as the page's Math.round counts it
    if len(labeled) < 2 * MIN_ROWS:
        raise WorkbenchError("Label more rows first: a test split needs at least %d labeled rows on each side, and "
                             "%d of %d labeled rows would leave %d and %d." % (MIN_ROWS, round(share * 100),
                                                                               len(labeled), n, len(labeled) - n))
    rng = random.Random(seed) if seed is not None else random.SystemRandom()
    groups: Dict[str, List[int]] = {}
    for i, row in enumerate(dataset["rows"]):
        groups.setdefault(decisions._key(row), []).append(i)
    candidates = list(groups.values())
    rng.shuffle(candidates)
    # At most MAX_BULK_ROWS labeled rows: retain one randomly ordered subset per reachable count.
    subsets = {0: []}
    for positions in candidates:
        weight = sum(_labeled(dataset["rows"][i]) for i in positions)
        if not weight:
            continue  # unrelated unlabeled rows stay available to tuning
        for count, chosen in list(subsets.items()):
            total = count + weight
            if total <= len(labeled) - MIN_ROWS and total not in subsets:
                subsets[total] = chosen + [positions]
    feasible = [count for count in subsets if count >= MIN_ROWS]
    if not feasible:
        raise WorkbenchError("Exact duplicate inputs must stay together: no split can leave at least %d labeled "
                             "rows on each side. Add labeled rows with distinct inputs before drawing a split."
                             % MIN_ROWS)
    # Compare with the requested share before rounding; exact ties round up as before.
    count = min(feasible, key=lambda count: (abs(count - share * len(labeled)), -count))
    for positions in subsets[count]:
        for i in positions:
            row = dataset["rows"][i]
            state = row if isinstance(row, dict) else {"text": row}
            dataset["rows"][i] = dict(state, **{TEST_KEY: True})
    dataset["test"] = {"locked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "looks": []}
    workbench.write_dataset(dataset)
    return dataset


@workbench.dataset_update()
def remove(dataset_id: str) -> bool:
    """Put the test rows back among the rest, and forget the looks. False when the dataset has none."""
    dataset = workbench.load_dataset(dataset_id)
    where = test_indexes(dataset)
    if not where and "test" not in dataset:
        return False
    for i in where:
        dataset["rows"][i] = {k: v for k, v in dataset["rows"][i].items() if k != TEST_KEY}
    dataset.pop("test", None)
    workbench.write_dataset(dataset)
    return True


@workbench.dataset_update()
def score(dataset_id: str, rows: Any, gates: Any, signal: str = "confidence", rules: Any = None,
          model: Optional[str] = None) -> dict:
    """Policy's report for `gates` over the test rows' answers, and the look recorded.

    rows: Policy's rows ({"index", "answers", "labels"}) for the test rows of a Bulk run of this dataset, as the
    browser holds them. There must be one per test row: a gate is measured on every test row or not at all."""
    dataset = workbench.load_dataset(dataset_id)
    expected = len(test_indexes(dataset))
    if not expected:
        raise WorkbenchError("The dataset %r has no test rows. Lock a test split first." % dataset_id)
    if not isinstance(rows, list) or len(rows) != expected:
        raise WorkbenchError("The dataset has %d test rows and %d came with answers. Load the dataset and run all "
                             "of its rows in Bulk first." % (expected, len(rows) if isinstance(rows, list) else 0))
    try:
        rep = policy.evaluate(rows, gates, signal, rules)
    except CalibrationError as err:
        raise WorkbenchError(str(err)) from err
    test = dataset.get("test") if isinstance(dataset.get("test"), dict) else {}
    earlier = [look for look in (test.get("looks") or []) if isinstance(look, dict)]
    look: Dict[str, Any] = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "gates": rep["gates"],
                            "signal": signal}
    if model:
        look["model"] = str(model)[:100]
    dataset["test"] = {"locked_at": test.get("locked_at"), "looks": (earlier + [look])[-MAX_LOOKS_KEPT:]}
    workbench.write_dataset(dataset)
    keys = ("labeled", "unlabeled", "invalid", "skipped", "automated", "correct", "coverage", "accuracy",
            "accuracy_low", "accuracy_high", "accuracy_all", "accuracy_all_low", "accuracy_all_high", "gates",
            "held_by_rules")
    out = {k: rep[k] for k in keys}
    # Per question, accuracy only: which rows were wrong stays hidden, so it cannot be fixed row by row.
    out["questions"] = [{k: q[k] for k in ("qid", "accuracy", "accuracy_low", "accuracy_high")} for q in rep["questions"]]
    out.update(look=len(earlier) + 1, earlier=earlier[-10:], rows=expected)
    return out
