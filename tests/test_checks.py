"""Checks: a gate saved with a dataset, rerun and judged against its targets. No key, no network."""

import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import check as check_script  # noqa: E402
from helpers import FakeClient  # noqa: E402
from jev import checks, workbench  # noqa: E402
from jev.client import JevError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "money", "tech": None}},
    "refund": {"type": "noul", "instructions": "Does the sender want money back?"},
}
CHECK = {"gates": {"refund": 0.6}, "signal": "confidence", "bound": "estimate", "model": "jev-1.13.0",
         "min_accuracy": 0.9, "min_coverage": 0.5}

# text -> (P(refund), label). Confidence is |2p - 1|: 0.98 -> 0.96, 0.05 -> 0.9, 0.6 -> 0.2 (held by a 0.6 gate).
ROWS = {
    "Charged twice, refund me": (0.98, True),
    "Please send my money back": (0.98, True),
    "Where is my parcel?": (0.05, False),
    "Love the beans": (0.05, False),
    "Maybe a refund, maybe not": (0.6, False),
    "Unlabeled row": (0.98, None),
}


def picker(probs):
    return lambda state, questions: {"refund": probs[state["text"]]}


def rows_text(rows=ROWS):
    lines = []
    for text, (_p, label) in rows.items():
        lines.append(json.dumps({"text": text, "_expect": {"refund": label}}) if label is not None else text)
    return "\n".join(lines)


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

    def save(self, rows=ROWS, questions=Q, check=CHECK):
        workbench.save_dataset({"name": "Refunds", "rows": rows_text(rows), "questions": questions})
        if check is not None:
            checks.save_check("refunds", check)

    def client(self, probs=None):
        probs = probs or {t: p for t, (p, _l) in ROWS.items()}
        return FakeClient(picker(probs))


class ValidateTests(unittest.TestCase):
    def test_saved_form_and_defaults(self):
        check = checks.validate_check({"gates": {"refund": 0.6, "dept": 1}, "model": " jev-1.13.0 ", "min_accuracy": 0.95}, Q)
        self.assertEqual(check, {"gates": {"refund": 0.6, "dept": 1.0}, "signal": "confidence", "bound": "estimate",
                                 "model": "jev-1.13.0", "min_accuracy": 0.95, "min_coverage": 0.0})

    def test_tuned_on_is_kept_when_given(self):
        check = checks.validate_check(dict(CHECK, model="jev-latest", tuned_on=" jev-1.14.0 "), Q)
        self.assertEqual((check["model"], check["tuned_on"]), ("jev-latest", "jev-1.14.0"))
        self.assertNotIn("tuned_on", checks.validate_check(CHECK, Q), "checks saved before tuned_on existed have none")

    def test_rejects(self):
        box = dict(Q, where={"type": "box", "instructions": "Where?"})
        cases = [
            ("not an object", "must be an object", Q),
            (CHECK, "questions first", None),
            (dict(CHECK, gates={}), "at least one", Q),
            (dict(CHECK, gates={"mood": 0.5}), "not one of the dataset's questions", Q),
            (dict(CHECK, gates={"where": 0.5}), "a box question", box),
            (dict(CHECK, gates={"refund": 1.5}), "from 0 to 1", Q),
            (dict(CHECK, signal="vibes"), "signal", Q),
            (dict(CHECK, bound="upper"), "bound", Q),
            (dict(CHECK, model=""), "Name the model", Q),
            (dict(CHECK, model=7), "model must be a string", Q),
            (dict(CHECK, min_accuracy=0.4), "from 0.5 to 1", Q),
            (dict(CHECK, min_accuracy=True), "min_accuracy", Q),
            (dict(CHECK, min_coverage=float("nan")), "min_coverage", Q),
            (dict(CHECK, tuned_on="jev-latest"), "versioned model id", Q),
            (dict(CHECK, tuned_on=14), "versioned model id", Q),
        ]
        for spec, message, questions in cases:
            with self.subTest(message=message), self.assertRaises(workbench.WorkbenchError) as ctx:
                checks.validate_check(spec, questions)
            self.assertIn(message, str(ctx.exception))


class StorageTests(Temp):
    def test_save_list_remove(self):
        self.save()
        stored = json.loads((self.dir / "datasets" / "refunds.json").read_text())
        self.assertEqual({k: v for k, v in stored["check"].items() if k != "saved_at"}, CHECK)
        self.assertIn("saved_at", stored["check"])
        self.assertEqual(len(stored["rows"]), len(ROWS), "rows are untouched")
        self.assertNotIn("answers", json.dumps(stored), "a check holds targets, never answers")
        [summary] = checks.listed()
        self.assertEqual(summary["check"]["gates"], {"refund": 0.6})
        self.assertTrue(checks.remove_check("refunds"))
        self.assertFalse(checks.remove_check("refunds"))
        self.assertEqual(checks.listed(), [])
        self.assertIsNone(workbench.list_datasets()[0]["check"])

    def test_listing_notes_a_check_that_asks_an_alias(self):
        self.save()
        self.assertEqual(workbench.list_datasets()[0]["check_notes"], [], "a pinned check has nothing to note")
        self.save(check=dict(CHECK, model="jev-latest", tuned_on="jev-1.13.0"))
        [note] = workbench.list_datasets()[0]["check_notes"]
        self.assertIn("jev-latest now points to jev-1.14.0", note)

    def test_needs_saved_questions(self):
        workbench.save_dataset({"name": "Refunds", "rows": rows_text()})
        with self.assertRaisesRegex(workbench.WorkbenchError, "questions first"):
            checks.save_check("refunds", CHECK)
        with self.assertRaisesRegex(workbench.WorkbenchError, "No saved dataset"):
            checks.save_check("nope", CHECK)

    def test_resaving_rows_keeps_a_check_that_still_fits(self):
        self.save()
        more = dict(ROWS, **{"New labeled row": (0.98, True)})
        saved = workbench.save_dataset({"name": "Refunds", "rows": rows_text(more), "questions": Q})
        self.assertNotIn("check_dropped", saved)
        kept = workbench.load_dataset("refunds")
        self.assertEqual(kept["check"]["gates"], CHECK["gates"])
        self.assertEqual(len(kept["rows"]), len(more))

    def test_resaving_without_the_gated_question_drops_the_check(self):
        self.save()
        saved = workbench.save_dataset({"name": "Refunds", "rows": rows_text(), "questions": {"dept": Q["dept"]}})
        self.assertIn("refund", saved["check_dropped"])
        stored = json.loads((self.dir / "datasets" / "refunds.json").read_text())
        self.assertNotIn("check", stored)
        self.assertNotIn("check_dropped", stored, "the reason is for the response, not the file")


def results(probs_labels):
    """Bulk-shaped results for the refund question: [(P(yes), label or None)]."""
    from helpers import fake_answers
    out = []
    for i, (p, label) in enumerate(probs_labels):
        r = {"index": i, "row": "row %d" % i, "answers": fake_answers({"refund": Q["refund"]}, {"refund": p})}
        if label is not None:
            r["expect"] = {"refund": label}
        out.append(r)
    return out


class EvaluateTests(unittest.TestCase):
    def check(self, **kw):
        return checks.validate_check(dict(CHECK, **kw), Q)

    def test_pass(self):
        rep = checks.evaluate(results([(0.98, True), (0.05, False), (0.6, False), (0.98, None)]), self.check())
        self.assertEqual(rep["status"], "pass")
        self.assertEqual((rep["labeled"], rep["automated"], rep["correct"], rep["unlabeled"]), (3, 2, 2, 1))
        self.assertTrue(rep["targets"]["accuracy"]["ok"])
        self.assertAlmostEqual(rep["targets"]["coverage"]["value"], 2 / 3)
        self.assertEqual(rep["reasons"], [])

    def test_fails_on_accuracy_and_lists_the_mistakes(self):
        rep = checks.evaluate(results([(0.98, True), (0.98, False), (0.05, False)]), self.check())
        self.assertEqual(rep["status"], "fail")
        self.assertFalse(rep["targets"]["accuracy"]["ok"])
        self.assertTrue(rep["targets"]["coverage"]["ok"])
        self.assertIn("below the 90.0% target", rep["reasons"][0])
        [m] = rep["mistakes"]
        self.assertEqual((m["index"], m["row"], m["wrong"]["refund"]["answer"], m["wrong"]["refund"]["label"]),
                         (1, "row 1", "yes", "no"))

    def test_fails_on_coverage(self):
        rep = checks.evaluate(results([(0.98, True), (0.6, True), (0.55, False)]), self.check())
        self.assertEqual(rep["status"], "fail")
        self.assertTrue(rep["targets"]["accuracy"]["ok"])
        self.assertFalse(rep["targets"]["coverage"]["ok"])
        self.assertIn("below the 50.0% minimum", rep["reasons"][0])

    def test_a_share_equal_to_its_target_meets_it(self):
        rep = checks.evaluate(results([(0.98, True), (0.6, True)]), self.check(min_coverage=0.5, min_accuracy=1))
        self.assertEqual(rep["status"], "pass")

    def test_lower_bound_needs_more_rows(self):
        few = results([(0.98, True)] * 5)
        self.assertEqual(checks.evaluate(few, self.check())["status"], "pass")
        rep = checks.evaluate(few, self.check(bound="lower"))
        self.assertEqual(rep["status"], "fail")
        self.assertLess(rep["targets"]["accuracy"]["value"], 0.9, "the 95% lower bound of 5 of 5")
        self.assertIn("lower bound", rep["reasons"][0])

    def test_nothing_automated_fails(self):
        rep = checks.evaluate(results([(0.6, True), (0.55, False)]), self.check(min_coverage=0))
        self.assertEqual(rep["status"], "fail")
        self.assertIn("automated none", rep["reasons"][0])

    def test_errors_when_rows_lack_answers_or_labels(self):
        rows = results([(0.98, True), (0.05, False)]) + [{"index": 2, "row": "x", "error": "boom"}]
        rep = checks.evaluate(rows, self.check())
        self.assertEqual(rep["status"], "error", "a check is judged on every row or not at all")
        self.assertIn("1 of 3 rows got no answer", rep["reasons"][0])
        self.assertEqual(rep["errors"], [{"index": 2, "error": "boom"}])
        rows = results([(0.98, True), (0.05, False)])
        rows[1]["answers"] = {}  # answered, but not the gated question
        rep = checks.evaluate(rows, self.check(min_accuracy=1, min_coverage=1))
        self.assertEqual(rep["status"], "error", "a row without a gated answer is not dropped from the measure")
        self.assertIn("1 of 2 rows have no readable answer", rep["reasons"][0])
        rep = checks.evaluate(results([(0.98, None)]), self.check())
        self.assertEqual(rep["status"], "error")
        self.assertIn("No row is labeled", rep["reasons"][0])
        rep = checks.evaluate(results([(0.98, True)]) + [{"index": 1, "row": "x", "skipped": True}], self.check(),
                              stopped="Budget reached")
        self.assertEqual(rep["status"], "error")
        self.assertIn("stopped early: Budget reached", rep["reasons"][0])


class RunTests(Temp):
    def test_run_asks_the_saved_model_and_judges_every_row(self):
        self.save()
        client = self.client()
        rep = checks.run(client, "refunds")
        self.assertEqual(len(client.calls), len(ROWS))
        self.assertEqual(set(client.models), {"jev-1.13.0"})
        self.assertNotIn("_expect", json.dumps([state for state, _ in client.calls]), "labels never reach the model")
        self.assertEqual(rep["status"], "pass")
        self.assertEqual((rep["labeled"], rep["automated"], rep["correct"]), (5, 4, 4))
        self.assertEqual((rep["id"], rep["name"], rep["model"], rep["answered_by"]), ("refunds", "Refunds", "jev-1.13.0", ["jev-fake"]))
        self.assertGreater(rep["cost_usd"], 0)
        self.assertEqual(rep["latency_ms_median"], 12.0)

    def test_model_override_and_a_regression(self):
        self.save()
        worse = {t: p for t, (p, _l) in ROWS.items()}
        worse["Where is my parcel?"] = 0.98  # now confidently wrong, and automated
        client = self.client(worse)
        rep = checks.run(client, "refunds", "jev-1.14.0")
        self.assertEqual(set(client.models), {"jev-1.14.0"})
        self.assertEqual(rep["model"], "jev-1.14.0")
        self.assertEqual(rep["status"], "fail")
        self.assertEqual(rep["mistakes"][0]["row"], "Where is my parcel?")

    def test_run_notes_a_version_other_than_the_one_tuned_on(self):
        self.save(check=dict(CHECK, model="jev-latest", tuned_on="jev-1.13.0"))
        client = self.client()
        client.model = "jev-1.14.0"  # the version the alias answers with now
        rep = checks.run(client, "refunds")
        self.assertEqual(set(client.models), {"jev-latest"})
        self.assertEqual((rep["status"], rep["answered_by"]), ("pass", ["jev-1.14.0"]), "notes never change the status")
        [note] = rep["notes"]
        self.assertIn("Answered by jev-1.14.0, but these thresholds were tuned on answers from jev-1.13.0", note)

    def test_run_notes_an_alias_and_nothing_once_pinned(self):
        self.save(check=dict(CHECK, model="jev-latest", tuned_on="jev-1.14.0"))
        client = self.client()
        client.model = "jev-1.14.0"
        [note] = checks.run(client, "refunds")["notes"]
        self.assertIn("Asks jev-latest, an alias; this run was answered by jev-1.14.0", note)
        self.save(check=dict(CHECK, model="jev-1.14.0", tuned_on="jev-1.14.0"))
        self.assertEqual(checks.run(client, "refunds")["notes"], [])

    def test_run_without_a_check(self):
        self.save(check=None)
        with self.assertRaisesRegex(workbench.WorkbenchError, "has no check"):
            checks.run(self.client(), "refunds")


class ScriptTests(Temp):
    def main(self, *argv, client=None):
        out = io.StringIO()
        with patch.object(check_script, "JevClient", lambda: client), redirect_stdout(out):
            code = check_script.main(list(argv))
        return code, out.getvalue()

    def test_list_makes_no_calls(self):
        self.save()
        code, out = self.main("--list")
        self.assertEqual(code, 0)
        self.assertIn("refund>=0.60", out)
        self.assertIn("90.0% accurate, at least 50.0% automated", out)
        self.assertNotIn("note:", out)
        self.save(check=dict(CHECK, model="jev-latest", tuned_on="jev-1.13.0"))
        code, out = self.main("--list")
        self.assertEqual(code, 0)
        self.assertIn("model jev-latest  tuned on jev-1.13.0", out)
        self.assertIn("note: jev-latest now points to jev-1.14.0", out)

    def test_exit_status_follows_the_checks(self):
        self.save()
        good = self.client()
        good.configured, good.backend = True, "fake"
        good.guard = type("G", (), {"snapshot": lambda self: {"live_calls": 6, "input_tokens": 6000, "spent_usd": 0.0}})()
        code, out = self.main(client=good)
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)
        self.assertIn("1 of 1 checks passed", out)
        worse = {t: p for t, (p, _l) in ROWS.items()}
        worse["Love the beans"] = 0.98
        bad = self.client(worse)
        bad.configured, bad.backend, bad.guard = True, "fake", good.guard
        code, out = self.main("refunds", "--model", "jev-1.14.0", client=bad)
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL", out)
        self.assertIn("wrong but automated, row 4: Love the beans", out)

    def test_errors_exit_2(self):
        code, out = self.main(client=None)
        self.assertEqual(code, 2)
        self.assertIn("No dataset", out)
        self.save()
        code, out = self.main("missing")
        self.assertEqual(code, 2)
        self.assertIn("Datasets with a check: refunds", out)
        nokey = self.client()
        nokey.configured = False
        code, out = self.main(client=nokey)
        self.assertEqual((code, "No API key" in out), (2, True))

        class Broke(FakeClient):
            configured, backend = True, "fake"

            def system_one(self, *a, **kw):
                raise JevError("Budget reached", 402)

        broke = Broke()
        broke.guard = type("G", (), {"snapshot": lambda self: {"live_calls": 0, "input_tokens": 0, "spent_usd": 0.0}})()
        code, out = self.main(client=broke)
        self.assertEqual(code, 2, out)
        self.assertIn("stopped early", out)


if __name__ == "__main__":
    unittest.main()
