"""Upgrade: ask a check's tuned-on version and a candidate the same rows, and say whether the check can move.
No key, no network."""

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
from jev import checks, policy, upgrade, workbench  # noqa: E402
from jev.client import JevError  # noqa: E402
from jev.workbench import WorkbenchError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "money", "tech": "bugs", "other": None}},
    "refund": {"type": "noul", "instructions": "Does the sender want money back?"},
}
SPEC = {"gates": {"dept": 0.5, "refund": 0.6}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
        "tuned_on": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.5}


class VersionClient(FakeClient):
    """Answers as `answers[model](text)` says, and reports the model it was asked as the one that answered,
    as a versioned id does. `answered` overrides that, for an alias."""

    def __init__(self, answers, answered=None):
        super().__init__()
        self.answers = answers
        self.answered = answered or {}

    def system_one(self, state, questions, assets=None, model=None):
        self.picker = lambda st, qs: self.answers[model](st["text"])
        res = super().system_one(state, questions, assets, model)
        res.model = self.answered.get(model, model)
        return res


def same(text):
    return {"dept": "billing", "refund": 0.98 if "refund" in text else 0.02}


def unsure(text):
    """Right as often as `same`, but P(refund) 0.75 or 0.25: confidence 0.5, under the 0.6 gate."""
    return {"dept": "billing", "refund": 0.75 if "refund" in text else 0.25}


def wrong(text):
    """Confident and wrong on every refund row."""
    return {"dept": "billing", "refund": 0.02}


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir
        rows = [json.dumps({"text": ("refund %d" if i % 2 else "thanks %d") % i,
                            "_expect": {"dept": "billing", "refund": bool(i % 2)}}) for i in range(20)]
        workbench.save_dataset({"name": "Tickets", "rows": "\n".join(rows), "questions": Q})
        checks.save_check("tickets", SPEC)

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)


class SearchTests(unittest.TestCase):
    def test_search_tunes_for_any_target(self):
        levels = [[90]] * 8 + [[40]] * 2
        right = [True] * 8 + [False, True]
        self.assertEqual(policy.search(levels, right, "estimate", (0.85,)), [[0]], "9 of 10 right reaches 85%")
        self.assertEqual(policy.search(levels, right, "estimate", (0.95,)), [[41]])
        self.assertEqual(len(policy.search(levels, right)), 3, "TARGETS by default")


class RunTests(Temp):
    def test_retune_explains_unavailable_grouped_cross_validation(self):
        answer = FakeClient().system_one({"text": "thanks"}, Q).answers
        results = [{"index": i, "row": {"text": "same", "channel": "email"} if i % 2 else
                    {"channel": "email", "text": "same"}, "answers": answer,
                    "expect": {"dept": "billing", "refund": False}} for i in range(20)]
        report = upgrade.retune(results, SPEC)
        self.assertIsNone(report["unseen"])
        self.assertIn("distinct labeled inputs", report["holdout_problem"])

    def test_upgrade_proposals_require_refitting_answer_sets(self):
        fitted = {"dept": {"cut": 0.2, "coverage": 0.9}}
        for candidate, proposal in ((same, "saved"), (unsure, "retuned")):
            with self.subTest(proposal=proposal):
                checks.save_check("tickets", dict(SPEC, answer_sets=fitted))
                fake = VersionClient({"jev-1.14.0": same, "jev-1.15.0": candidate})
                rep = upgrade.run(fake, "tickets", "jev-1.15.0")
                self.assertIsNotNone(rep["proposals"][proposal])
                self.assertNotIn("answer_sets", rep["proposals"][proposal])
                self.assertIn("Refit Answer sets", " ".join(rep["notes"]))
                self.assertEqual(workbench.load_dataset("tickets")["check"]["answer_sets"], fitted,
                                 "trying a candidate never changes the saved check")

    def test_the_same_answers_keep_the_saved_thresholds(self):
        fake = VersionClient({"jev-1.14.0": same, "jev-1.15.0": same})
        rep = upgrade.run(fake, "tickets", "jev-1.15.0")
        self.assertEqual(fake.models, ["jev-1.14.0"] * 20 + ["jev-1.15.0"] * 20, "every row, asked of each version")
        self.assertEqual(rep["verdict"], "keep", rep["reasons"])
        self.assertEqual((rep["current"]["status"], rep["candidate"]["status"]), ("pass", "pass"))
        self.assertEqual(rep["paired"]["both_right"], 20)
        self.assertEqual(rep["paired"]["p"], 1.0)
        self.assertEqual([q["changed"] for q in rep["changed"]["questions"]], [0, 0])
        saved = rep["proposals"]["saved"]
        self.assertEqual((saved["gates"], saved["model"], saved["tuned_on"]), (SPEC["gates"], "jev-1.15.0", "jev-1.15.0"))
        self.assertEqual((saved["min_accuracy"], saved["min_coverage"]), (0.9, 0.5), "the targets stay")
        self.assertNotIn("saved_at", saved)
        self.assertEqual(rep["calls"], 40)
        self.assertEqual(rep["sides"]["candidate"]["answered_by"], ["jev-1.15.0"])
        checks.save_check("tickets", saved)  # the page saves it through the ordinary endpoint
        self.assertEqual(workbench.load_dataset("tickets")["check"]["tuned_on"], "jev-1.15.0")

    def test_less_confident_answers_need_new_thresholds(self):
        fake = VersionClient({"jev-1.14.0": same, "jev-1.15.0": unsure})
        rep = upgrade.run(fake, "tickets", "jev-1.15.0")
        self.assertEqual(rep["verdict"], "retune", rep["reasons"])
        self.assertEqual(rep["candidate"]["status"], "fail", "the 0.6 refund gate automates nothing now")
        self.assertIsNone(rep["proposals"]["saved"])
        gates = rep["proposals"]["retuned"]["gates"]
        self.assertLessEqual(gates["refund"], 0.5)
        self.assertEqual(rep["retuned"]["report"]["status"], "pass")
        self.assertEqual(rep["retuned"]["unseen"]["folds"], 5)
        self.assertEqual(rep["retuned"]["unseen"]["accuracy"], 1.0)
        self.assertEqual([q["changed"] for q in rep["changed"]["questions"]], [0, 0], "same answers, less sure")

    def test_wrong_answers_stay_on_the_tuned_version(self):
        fake = VersionClient({"jev-1.14.0": same, "jev-1.15.0": wrong})
        rep = upgrade.run(fake, "tickets", "jev-1.15.0")
        self.assertEqual(rep["verdict"], "stay")
        self.assertEqual(rep["proposals"], {"saved": None, "retuned": None})
        p = rep["paired"]
        self.assertEqual((p["both_right"], p["current_only"], p["candidate_only"], p["both_wrong"]), (10, 10, 0, 0))
        self.assertLess(p["p"], 0.01)
        self.assertEqual((p["current"]["accuracy"], p["candidate"]["accuracy"]), (1.0, 0.5))
        refund = rep["changed"]["questions"][1]
        self.assertEqual((refund["qid"], refund["changed"], refund["rows"]), ("refund", 10, 20))
        self.assertEqual(rep["changed"]["rows_total"], 10)
        self.assertEqual(rep["changed"]["rows"][0]["changed"], {"refund": {"current": "yes", "candidate": "no"}})

    def test_an_alias_is_pinned_to_the_version_that_answered(self):
        fake = VersionClient({"jev-1.14.0": same, "jev-latest": same}, answered={"jev-latest": "jev-1.15.0"})
        rep = upgrade.run(fake, "tickets", "jev-latest")
        self.assertEqual(rep["sides"]["candidate"]["model"], "jev-latest")
        self.assertEqual(rep["proposals"]["saved"]["model"], "jev-1.15.0")

    def test_both_sides_answered_by_one_version_is_noted(self):
        fake = VersionClient({"jev-1.14.0": same, "jev-latest": same}, answered={"jev-latest": "jev-1.14.0"})
        rep = upgrade.run(fake, "tickets", "jev-latest")
        self.assertIn("only shows run-to-run variation", " ".join(rep["notes"]))

    def test_a_candidate_answered_by_two_versions_cannot_be_pinned(self):
        fake = VersionClient({"jev-1.14.0": same, "jev-latest": same})
        answered = iter(["jev-1.15.0", "jev-1.16.0"] * 10)
        original = fake.system_one

        def system_one(state, questions, assets=None, model=None):
            res = original(state, questions, assets, model)
            if model == "jev-latest":
                res.model = next(answered)
            return res

        fake.system_one = system_one
        rep = upgrade.run(fake, "tickets", "jev-latest")
        self.assertEqual(rep["verdict"], "error")
        self.assertIn("no one version to pin", rep["reasons"][-1])
        self.assertEqual(rep["proposals"], {"saved": None, "retuned": None})

    def test_a_stopped_run_does_not_spend_on_the_candidate(self):
        class Broke(FakeClient):
            def system_one(self, *a, **kw):
                self.calls.append(a)
                raise JevError("Budget reached", 402)

        broke = Broke()
        rep = upgrade.run(broke, "tickets", "jev-1.15.0")
        self.assertEqual(rep["verdict"], "error")
        self.assertIn("stopped early: Budget reached", rep["reasons"][0])
        self.assertLessEqual(len(broke.calls), 20, "the candidate was never asked")

    def test_rejects(self):
        fake = VersionClient({"jev-1.14.0": same})
        with self.assertRaisesRegex(WorkbenchError, "Name the model to try"):
            upgrade.run(fake, "tickets", " ")
        with self.assertRaisesRegex(WorkbenchError, "tuned on jev-1.14.0 already"):
            upgrade.run(fake, "tickets", "jev-1.14.0")
        checks.remove_check("tickets")
        with self.assertRaisesRegex(WorkbenchError, "has no check"):
            upgrade.run(fake, "tickets", "jev-1.15.0")
        self.assertEqual(fake.calls, [])


class ScriptTests(Temp):
    def main(self, *argv, client=None):
        out = io.StringIO()
        with patch.object(check_script, "JevClient", lambda: client), redirect_stdout(out):
            code = check_script.main(list(argv))
        return code, out.getvalue()

    @staticmethod
    def configured(candidate):
        fake = VersionClient({"jev-1.14.0": same, "jev-1.15.0": candidate})
        fake.configured, fake.backend = True, "fake"
        fake.guard = type("G", (), {"snapshot": lambda self: {"live_calls": 0, "input_tokens": 0, "spent_usd": 0.0}})()
        return fake

    def test_exit_status_follows_the_verdict(self):
        code, out = self.main("--upgrade-to", "jev-1.15.0", client=self.configured(same))
        self.assertEqual(code, 0, out)
        self.assertIn("KEEP", out)
        code, out = self.main("tickets", "--upgrade-to", "jev-1.15.0", client=self.configured(unsure))
        self.assertEqual(code, 0, out)
        self.assertIn("RETUNE", out)
        self.assertIn("retuned gate: dept>=", out)
        out_file = self.dir / "upgrade.json"
        code, out = self.main("--upgrade-to", "jev-1.15.0", "--out", str(out_file), client=self.configured(wrong))
        self.assertEqual(code, 1, out)
        self.assertIn("STAY", out)
        self.assertEqual(json.loads(out_file.read_text())[0]["verdict"], "stay")
        self.assertEqual(workbench.load_dataset("tickets")["check"]["tuned_on"], "jev-1.14.0", "the script never moves it")

    def test_errors_exit_2(self):
        code, out = self.main("--upgrade-to", "jev-1.14.0", client=self.configured(same))
        self.assertEqual((code, "already" in out), (2, True), out)
        nokey = self.configured(same)
        nokey.configured = False
        code, out = self.main("--upgrade-to", "jev-1.15.0", client=nokey)
        self.assertEqual((code, "No API key" in out), (2, True))
        code, out = self.main("--upgrade-to", "jev-1.15.0", "--drift", "x.jsonl", client=self.configured(same))
        self.assertEqual((code, "one at a time" in out), (2, True), out)


if __name__ == "__main__":
    unittest.main()
