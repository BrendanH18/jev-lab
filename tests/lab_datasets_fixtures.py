"""Saved datasets and output matchers shared by the `lab.py datasets` pack tests
(tests/test_lab_cli_datasets_browse.py, tests/test_lab_cli_datasets_quality.py). Not a test module itself.

Every setup runs inside labkit.run_cli with jev.workbench.WORKBENCH_DIR pointed at a fresh temporary directory, and
saves through jev.workbench.save_dataset, so the files look exactly as the app writes them. Fictional data only.
Held-out rows carry text no output may ever show: HELD_OUT_TEXTS.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from jev import checks, workbench

SUPPORT_QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team should handle the ticket?",
                   "criteria": {"billing": "Charges, refunds, invoices", "shipping": "Delivery and damage",
                                "product": "Products and stock"}},
    "is_urgent": {"type": "noul", "instructions": "Does it need action today?"},
    "frustration": {"type": "score", "instructions": "How frustrated is the customer?",
                    "criteria": ["calm", "annoyed", "angry"]},
}

SUPPORT_ROWS = [
    {"text": "Charged twice for order A-1", "channel": "email", "_expect": {"department": "billing", "is_urgent": True, "frustration": 2}},
    {"text": "Bag arrived torn", "channel": "chat", "_expect": {"department": "shipping", "is_urgent": False}},
    {"text": "Do you sell decaf?", "channel": "email", "_expect": {"department": "product", "is_urgent": False, "frustration": 0}},
    {"text": "Bag arrived torn", "channel": "chat", "_expect": {"department": "product"}},
    {"text": "Where is my refund?", "channel": "phone", "_expect": {"department": "billing", "is_urgent": "maybe", "frustration": 1}},
    "Grinder makes a squeal",
    {"text": "Held out torn parcel", "channel": "email", "_test": True,
     "_expect": {"department": "shipping", "is_urgent": True, "frustration": 2}},
    {"text": "Held out ticket two", "channel": "fax", "_test": True, "_expect": {"department": "billing"}},
]
HELD_OUT_TEXTS = ("Held out", "fax", "Held-out missing", "aaaaaaaaaaaaaaaa", "Secret", "meh")

REFUND_ROWS = [
    {"text": "Where is my refund?", "channel": "phone", "lang": "en", "_expect": {"wants_refund": True}},
    {"text": "Bag arrived torn", "channel": "chat", "lang": "en", "_expect": {"wants_refund": True, "department": "shipping"}},
    {"text": "Is the cafe open Sunday? We would like to bring a group of twelve for a birthday brunch at eleven.", "lang": "en"},
    {"text": "Refund for torn bag", "lang": "en", "_image": "torn-bag", "_expect": {"wants_refund": True}},
]
LONG_TEXT = REFUND_ROWS[2]["text"]

PHOTO_ROWS = [
    {"note": "Seal split", "order": {"id": "A-1", "items": 2}, "_image": "torn-bag"},
    {"note": "Fine", "_image": "intact-bag"},
    {"note": "Corner dent", "order": {"id": "A-3"}, "_image": "0123456789abcdef.png"},
    {"note": "Lost upload", "_image": "fedcba9876543210.jpg"},
    {"note": "Seal split again", "_image": "torn-bag", "_test": True},
    {"note": "Held-out missing", "_image": "aaaaaaaaaaaaaaaa.png", "_test": True},
]


def save_support(directory: Path) -> None:
    """support-tickets, saved twice (5 rows, then 8), then given a check and two recorded test looks."""
    workbench.save_dataset({"name": "Support tickets", "questions": SUPPORT_QUESTIONS, "rows": SUPPORT_ROWS[:5]})
    workbench.save_dataset({
        "name": "Support tickets", "notes": "Harbor Coffee support inbox, autumn sample", "questions": SUPPORT_QUESTIONS,
        "rules": "if department = billing then frustration >= 1", "rows": SUPPORT_ROWS,
        "guidelines": {"department": {"note": "Refunds go to billing.",
                                      "examples": [{"input": "Please refund my order", "label": "billing"}]},
                       "is_urgent": {"note": "Same-day problems only."}}})
    checks.save_check("support-tickets", {
        "gates": {"department": 0.8, "is_urgent": 0.7}, "model": "jev-latest", "tuned_on": "jev-1.14.0",
        "min_accuracy": 0.9, "min_coverage": 0.5, "rules": "if department = billing then frustration >= 1",
        "slice_targets": [{"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4}],
        "answer_sets": {"department": {"cut": 0.12, "coverage": 0.9}}})
    dataset = workbench.load_dataset("support-tickets")
    dataset["test"]["looks"] = [{"at": "2026-10-01T09:00:00Z", "gates": {"department": 0.8}, "signal": "confidence",
                                 "model": "jev-1.14.0"},
                                {"at": "2026-10-20T15:30:00Z", "gates": {"department": 0.85, "is_urgent": 0.7},
                                 "signal": "confidence"}]
    workbench.write_dataset(dataset)


def save_refund(directory: Path) -> None:
    workbench.save_dataset({
        "name": "Refund requests", "notes": "Refund questions from the cafe counter",
        "questions": {"wants_refund": {"type": "noul", "instructions": "Does the customer want money back?"},
                      "department": {"type": "choice", "instructions": "Which team should handle it?",
                                     "criteria": {"billing": "Money", "shipping": "Parcels"}}},
        "rows": REFUND_ROWS})
    checks.save_check("refund-requests", {"gates": {"wants_refund": 0.75}, "model": "jev-1.14.0",
                                          "min_accuracy": 0.95, "min_coverage": 0.3})


def save_photo(directory: Path) -> None:
    workbench.save_dataset({"name": "Photo claims", "rows": PHOTO_ROWS})
    (directory / "images").mkdir(parents=True, exist_ok=True)
    (directory / "images" / "0123456789abcdef.png").write_bytes(b"not really a png")


def save_old_menu(directory: Path) -> None:
    """A deleted dataset whose history is kept: two hand-written revisions with fixed times."""
    folder = directory / "datasets" / ".history" / "old-menu"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "20250101T000000000000Z-aaaaaaaaaaaa.json").write_text(json.dumps({"name": "Old menu", "rows": ["Latte", "Mocha"]}))
    (folder / "20260301T120000000000Z-bbbbbbbbbbbb.json").write_text(json.dumps({
        "name": "Old menu", "questions": {"hot": {"type": "noul", "instructions": "Is it served hot?"}},
        "rows": ["Latte", "Mocha", {"text": "Cortado", "_expect": {"hot": True}}]}))


def save_all(directory: Path) -> None:
    save_support(directory)
    save_refund(directory)
    save_photo(directory)
    save_old_menu(directory)


REVIEW_ROWS = [
    {"text": "Great beans", "store": "pier", "_expect": {"tone": "good"}},
    {"text": "Great beans", "store": "pier", "_expect": {"tone": "bad"}},
    {"text": "great  beans ", "store": "pier", "_expect": {"tone": "good", "roast": 5}},
    {"text": "Stale roast", "store": "pier", "_expect": {"tone": "bad", "aroma": "flat"}},
    {"text": "Stale roast", "store": "pier", "_test": True, "_expect": {"tone": "meh"}},
    {"text": "Stale roast", "store": "dock", "_expect": {"tone": "bad"}},
    {"text": "Lovely crema", "store": "dock"},
    {"text": "Lovely crema", "store": "dock", "_expect": {"tone": "good"}},
    {"text": "Secret tasting note", "store": "dock", "_test": True, "_expect": {"tone": "good"}},
    {"text": "Secret tasting note", "store": "dock", "_test": True},
    {"text": "Great beans", "store": "pier"},
]

NEXT_ROWS = [
    {"text": "Charged twice for order A-1", "channel": "email", "_expect": {"department": "billing", "is_urgent": True, "frustration": 1}},
    {"text": "Bag arrived torn", "channel": "chat", "_expect": {"department": "shipping", "is_urgent": False}},
    {"text": "Do you sell decaf?", "channel": "email", "_expect": {"department": "product", "is_urgent": False, "frustration": 0}},
    {"text": "Mug handle snapped", "channel": "chat", "_expect": {"department": "product"}},
    {"text": "Held out torn parcel", "channel": "email", "_test": True, "_expect": {"department": "shipping"}},
]


def save_reviews(directory: Path) -> None:
    """bean-reviews: duplicates, a near-duplicate, a conflict, invalid and unknown labels, held-out copies."""
    workbench.save_dataset({"name": "Bean reviews", "rows": REVIEW_ROWS, "questions": {
        "tone": {"type": "choice", "instructions": "Is the review positive?", "criteria": {"good": "Positive", "bad": "Negative"}},
        "roast": {"type": "score", "instructions": "How dark is the roast?", "criteria": ["light", "medium", "dark"]}}})


def save_quality(directory: Path) -> None:
    """Every dataset above, plus bean-reviews and support-tickets-next (support-tickets with changes)."""
    save_all(directory)
    save_reviews(directory)
    workbench.save_dataset({"name": "Support tickets next", "questions": SUPPORT_QUESTIONS, "rows": NEXT_ROWS})


# ---------- output matchers ----------


def never_held_out(text: str) -> None:
    for secret in HELD_OUT_TEXTS:
        if secret in text:
            raise AssertionError("output shows held-out input %r:\n%s" % (secret, text))


def json_is(expected, drop=()):
    """stdout parses as JSON equal to `expected` once the keys in `drop` are removed from each object."""
    def check(text: str) -> None:
        never_held_out(text)
        value = json.loads(text)
        if isinstance(value, list):
            value = [{k: v for k, v in item.items() if k not in drop} if isinstance(item, dict) else item for item in value]
        if value != expected:
            raise AssertionError("expected %r\n     got %r" % (expected, value))
    return check


def fields_are(expected, drop=()):
    """A field/value listing (as JSON) equal to the `expected` dict once `drop` fields are removed."""
    def check(text: str) -> None:
        never_held_out(text)
        value = {item["field"]: item["value"] for item in json.loads(text) if item["field"] not in drop}
        if value != expected:
            raise AssertionError("expected %r\n     got %r" % (expected, value))
    return check


def column_is(column, expected):
    """The JSON list's values of one column, in order."""
    def check(text: str) -> None:
        never_held_out(text)
        value = [item[column] for item in json.loads(text)]
        if value != expected:
            raise AssertionError("expected %r\n     got %r" % (expected, value))
    return check


def lines_match(patterns):
    """Each stdout line fully matches the regex at the same position, and there are as many lines as patterns."""
    def check(text: str) -> None:
        never_held_out(text)
        lines = text.splitlines()
        if len(lines) != len(patterns) or not all(re.fullmatch(p, line) for p, line in zip(patterns, lines)):
            raise AssertionError("lines do not match %r:\n%s" % (patterns, text))
    return check


def jsonl_is(expected):
    """stdout is JSON Lines equal to `expected`, one object per line."""
    def check(text: str) -> None:
        never_held_out(text)
        value = [json.loads(line) for line in text.splitlines()]
        if value != expected:
            raise AssertionError("expected %r\n     got %r" % (expected, value))
    return check
