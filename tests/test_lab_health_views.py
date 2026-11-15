"""Lab pack health-views: rows compared through the fields each question points at, reported without values."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import health  # noqa: E402
from jev.lab.packs import health_views  # noqa: E402

TEAM = {"team": {"type": "choice", "instructions": "Which team handles `text`?",
                 "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems"}}}
WHOLE = {"team": {"type": "choice", "instructions": "Which team handles the ticket?",
                  "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems"}}}


def row(text, ident, team=None, test=False):
    out = {"text": text, "id": ident}
    if team:
        out["_expect"] = {"team": team}
    if test:
        out["_test"] = True
    return out


CASES = {
    "same_view_different_labels": {
        "hit": ([row("Bag torn badly", "T-1", "shipping"), row("Bag torn badly", "T-2", "billing"), row("Refund please", "T-3", "billing")], TEAM),
        # Agreeing labels; a conflict on one exact input (the built-in finding); a held-out copy whose label is never read.
        "miss": ([row("Bag torn badly", "T-1", "shipping"), row("Bag torn badly", "T-2", "shipping"), row("Refund please", "T-3", "billing"),
                  row("Refund please", "T-3", "shipping"), row("Bag torn badly", "T-9", "billing", test=True)], TEAM),
        "rows": [1, 2],
        "message": re.compile(r"^`team` reads `text`, and 2 rows that read the same there but differ elsewhere carry different labels")},
    "same_view_across_split": {
        "hit": ([row("Bag torn badly", "T-1"), row("Bag torn badly", "T-2", test=True), row("Refund please", "T-3")], TEAM),
        "miss": ([row("Bag torn badly", "T-1"), row("Bag torn badly", "T-1", test=True), row("Refund please", "T-3")], TEAM),
        "rows": [1, 2],
        "message": re.compile(r"^`team` reads `text`, which is the same on tuning and held-out rows that differ elsewhere \(2 rows\)")},
}


class HealthViewsTests(pack_tests(health_views.PACK, CASES)):
    def test_questions_reading_the_whole_row_are_left_to_exact_identity(self):
        rows = [row("Bag torn badly", "T-1", "shipping"), row("Bag torn badly", "T-2", "billing"), row("Bag torn badly", "T-3", test=True)]
        self.assertEqual(health_views.same_view_different_labels(rows, WHOLE), [])
        self.assertEqual(health_views.same_view_across_split(rows, WHOLE), [])

    def test_findings_reach_the_health_report(self):
        rows = [row("Bag torn badly", "T-1", "shipping"), row("Bag torn badly", "T-2", "billing")]
        codes = {item["code"] for item in health.analyze(rows, TEAM)["lab"]}
        self.assertIn("health-views/same_view_different_labels", codes)


if __name__ == "__main__":
    unittest.main()
