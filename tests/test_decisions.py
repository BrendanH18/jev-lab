"""Review queue (jev/decisions.py): label the rows an exported gate routed, and add them to its check's dataset.

The decisions come from the exported gate.py itself, run as a script against the stand-in SDK from test_gate.py, so
the queue reads exactly what the exported file prints. No key, no network.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from jev import checks, decisions, examples, gate, workbench  # noqa: E402
from test_gate import FAKE_SDK, answers  # noqa: E402

QUESTIONS = examples.BULK_QUESTIONS  # department (choice), frustration (score), is_urgent and wants_refund (noul)
RULES = "if department = billing then is_urgent = yes"
CHECK = {"gates": {"department": 0.6, "is_urgent": 0.4}, "signal": "confidence", "bound": "estimate",
         "model": "jev-1.14.0", "min_accuracy": 0.8, "min_coverage": 0.3, "rules": RULES}
SAVED = [{"text": "Charged twice, refund me", "_expect": {"department": "billing", "is_urgent": True}},
         "Where is my parcel?"]

# What gate.py is asked about, and the answers the stand-in SDK gives for each row, in order.
TRAFFIC = [
    ("Refund my order today", answers()),                           # auto
    ("Which beans for espresso?", answers(department=0.3)),         # review: department held
    ("Where is my parcel?", answers()),                             # auto, but already in the dataset
    ("My card was charged twice", answers(urgent=0.45)),            # review: is_urgent held, and the rule breaks
    ("Refund my order today", answers()),                           # auto, the same row again
    ("Thanks for the fast delivery", answers()),                    # auto
    ("Login fails at checkout", answers(urgent=0.95)),              # auto
]


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir / "workbench"
        self.addCleanup(setattr, workbench, "WORKBENCH_DIR", self._orig)

    def save(self, rows=SAVED, check=CHECK):
        workbench.save_dataset({"name": "Tickets", "rows": rows, "questions": QUESTIONS})
        if check is not None:
            checks.save_check("tickets", check)

    def route(self, traffic=TRAFFIC):
        """Run the check's exported gate.py over the traffic, as an application would, and return what it prints."""
        (self.dir / "typesafe_sdk.py").write_text(FAKE_SDK)
        (self.dir / "gate.py").write_text(gate.export_check("tickets")["python"])
        (self.dir / "answers.json").write_text(json.dumps([a for _t, a in traffic]))
        env = dict(os.environ, FAKE_ANSWERS=str(self.dir / "answers.json"), PYTHONPATH=str(self.dir))
        rows = "\n".join(t for t, _a in traffic) + "\n"
        return subprocess.run([sys.executable, str(self.dir / "gate.py")], input=rows, capture_output=True, text=True,
                              env=env, check=True, cwd=self.dir).stdout


class QueueTests(Temp):
    def test_saved_cut_flows_through_gate_script_and_queue(self):
        fitted = {"department": {"cut": 0.2, "coverage": 0.9}}
        self.save(check=dict(CHECK, answer_sets=fitted))
        a = answers(department=0.3)
        a["department"]["probabilities"] = dict.fromkeys(QUESTIONS["department"]["criteria"], 0.025)
        a["department"]["probabilities"].update(billing=0.5, shipping=0.4)
        text = self.route(traffic=[("New shortlisting ticket", a)])
        item = decisions.queue("tickets", text)["items"][0]
        self.assertEqual(item["candidates"]["department"], ["billing", "shipping"])
        self.assertEqual(item["route"], "review")
        self.assertIsNone(item["labels"]["department"])
        self.assertEqual(workbench.load_dataset("tickets")["check"]["answer_sets"], fitted)
        out = server.api_wb_gate_export({"questions": QUESTIONS, "gates": CHECK["gates"],
                                         "model": CHECK["model"], "answer_sets": fitted})
        self.assertIn("ANSWER_SETS =", out["python"])
        self.assertIn("export const ANSWER_SETS", out["javascript"])

    def test_shortlists_are_suggestions_and_never_saved_as_labels(self):
        self.save()
        d = {"route": "review", "held": ["department", "is_urgent"], "rules": [],
             "answers": {"department": "billing", "is_urgent": True}, "row": {"text": "A new ticket"},
             "candidates": {"department": ["billing", "shipping"], "is_urgent": [False, True], "frustration": [0, 1]}}
        item = decisions.queue("tickets", json.dumps(d))["items"][0]
        self.assertEqual(item["candidates"], d["candidates"])
        self.assertIsNone(item["labels"]["department"], "a shortlist does not choose a person's label")
        self.assertIsNone(item["labels"]["is_urgent"])
        # A reviewer can pick an option outside the shortlist.
        item["labels"] = {"department": "none", "is_urgent": False}
        decisions.append("tickets", [item])
        saved = workbench.load_dataset("tickets")
        self.assertEqual(saved["rows"][-1], {"text": "A new ticket", "_expect": item["labels"]})
        self.assertNotIn("candidates", json.dumps(saved))

    def test_invalid_shortlists_report_the_line(self):
        self.save()
        d = {"route": "review", "held": ["department"], "answers": {}, "row": {"text": "new"}}
        for candidates in (["billing"], {"unknown": ["x"]}, {"department": []},
                           {"department": ["billing", "billing"]}, {"department": ["sales"]},
                           {"is_urgent": [None]}, {"frustration": [99]}):
            with self.subTest(candidates=candidates):
                out = decisions.queue("tickets", json.dumps(dict(d, candidates=candidates)))
                self.assertEqual(out["items"], [])
                self.assertEqual(out["problems_total"], 1)
                self.assertIn("Line 1", out["problems"][0]["message"])

    def test_queue_from_the_exported_gate(self):
        self.save()
        out = decisions.queue("tickets", self.route(), audit=2)
        c = out["counts"]
        self.assertEqual((c["decisions"], c["review"], c["auto"], c["in_dataset"], c["repeated"]), (7, 2, 5, 1, 1))
        self.assertEqual((c["queued"], c["audit"], c["dropped"]), (4, 2, 0))
        self.assertEqual(out["room"], 198)
        self.assertEqual(out["gates"], CHECK["gates"])
        review = [i for i in out["items"] if i["kind"] == "review"]
        self.assertEqual([i["row"] for i in review], [{"text": "Which beans for espresso?"}, {"text": "My card was charged twice"}])

        beans, card = review
        self.assertEqual(beans["held"], ["department"])
        self.assertIsNone(beans["labels"]["department"], "a held question starts unlabeled: a person decides it")
        self.assertIs(beans["labels"]["is_urgent"], True, "a gated answer that cleared its threshold is a suggested label")
        self.assertEqual((beans["labels"]["frustration"], beans["labels"]["wants_refund"]), (None, None),
                         "an answer no gate reads is never suggested: it would save the model's answer as a label")
        self.assertEqual(beans["open"], ["department"])

        self.assertEqual(card["rules"], [RULES])
        self.assertEqual(sorted(card["open"]), ["department", "is_urgent"], "a broken rule opens the questions it reads")
        self.assertEqual((card["labels"]["department"], card["labels"]["frustration"]), (None, None))

        audit = [i for i in out["items"] if i["kind"] == "audit"]
        self.assertTrue(all(i["route"] == "auto" for i in audit))
        self.assertTrue(all(v is None for i in audit for v in i["labels"].values()), "an audit row starts unlabeled")
        self.assertTrue(all(i["row"]["text"] != "Where is my parcel?" for i in audit), "rows the dataset has are left out")
        self.assertEqual(len({i["row"]["text"] for i in audit}), 2)

    def test_audit_sample_is_random_but_repeatable(self):
        self.save()
        text = self.route()
        pick = lambda seed: [i["line"] for i in decisions.queue("tickets", text, audit=2, seed=seed)["items"] if i["kind"] == "audit"]  # noqa: E731
        self.assertEqual(pick(0), pick(0))
        self.assertEqual(len({tuple(pick(s)) for s in range(12)}) > 1, True, "other seeds draw other rows")
        everything = decisions.queue("tickets", text, audit=200)
        self.assertEqual(everything["counts"]["audit"], 3, "at most every distinct automated row the dataset lacks")

    def test_audit_rows_stay_when_review_rows_overflow(self):
        self.save()
        lines = [json.dumps({"route": "review", "held": ["department"], "rules": [], "answers": {"department": "billing"},
                             "row": {"text": "ticket %d" % n}}) for n in range(250)]
        lines += [json.dumps({"route": "auto", "held": [], "rules": [], "answers": {"department": "billing"},
                              "row": {"text": "auto %d" % n}}) for n in range(30)]
        out = decisions.queue("tickets", "\n".join(lines), audit=20)
        self.assertEqual((out["counts"]["queued"], out["counts"]["audit"], out["counts"]["dropped"]), (200, 20, 70))

    def test_problems_name_their_lines(self):
        self.save()
        good = json.dumps({"route": "review", "held": ["department"], "rules": [], "answers": {"department": "none"},
                           "row": {"text": "hi"}})
        text = "\n".join([
            good,
            "not json",
            json.dumps({"route": "review", "held": [], "rules": [], "answers": {}}),
            json.dumps({"route": "maybe", "answers": {}, "row": {"text": "x"}}),
            json.dumps({"route": "auto", "held": [], "rules": [], "answers": {"color": "red"}, "row": {"text": "x"}}),
            json.dumps({"route": "auto", "held": [], "rules": [], "answers": {}, "row": "plain text"}),
            json.dumps({"route": "review", "held": [["department"]], "rules": [], "answers": {}, "row": {"text": "y"}}),
        ])
        out = decisions.queue("tickets", text)
        self.assertEqual([p["line"] for p in out["problems"]], [2, 3, 4, 5, 6, 7])
        messages = " | ".join(p["message"] for p in out["problems"])
        self.assertIn("Line 2 is not JSON", messages)
        self.assertIn("Export the gate again", messages)
        self.assertIn("color", messages)
        self.assertEqual(out["counts"]["queued"], 1)

    def test_refusals(self):
        self.save(check=None)
        with self.assertRaisesRegex(workbench.WorkbenchError, "no check"):
            decisions.queue("tickets", "{}")
        checks.save_check("tickets", CHECK)
        for text in ("", None, "  \n"):
            with self.assertRaisesRegex(workbench.WorkbenchError, "Paste the gate's decisions"):
                decisions.queue("tickets", text)
        for audit in (-1, 201, 1.5, True, "3"):
            with self.assertRaisesRegex(workbench.WorkbenchError, "audit"):
                decisions.queue("tickets", "x", audit=audit)
        with self.assertRaisesRegex(workbench.WorkbenchError, "No saved dataset"):
            decisions.queue("other", "x")


class AppendTests(Temp):
    def test_concurrent_dataset_mutations_preserve_both_updates(self):
        for other in ("append", "check"):
            with self.subTest(other=other):
                self.save()
                start = threading.Barrier(2)
                loaded = threading.Barrier(2)
                load = workbench.load_dataset

                def overlapping_load(dataset_id):
                    dataset = load(dataset_id)
                    try:
                        # Without serialization both callers read the old file. A lock makes the
                        # first time out here, then lets the second read the newly committed file.
                        loaded.wait(timeout=0.5)
                    except threading.BrokenBarrierError:
                        pass
                    return dataset

                def update(which):
                    start.wait(timeout=5)
                    if which == 1 and other == "check":
                        return checks.save_check("tickets", dict(CHECK, min_accuracy=0.95))
                    return decisions.append("tickets", [{"row": {"text": "new %d" % which},
                                                          "labels": {"department": "billing"}}])

                with patch.object(workbench, "load_dataset", side_effect=overlapping_load), ThreadPoolExecutor(2) as pool:
                    results = list(pool.map(update, range(2)))
                saved = load("tickets")
                self.assertEqual(results[0]["added"], 1)
                self.assertIn({"text": "new 0", "_expect": {"department": "billing"}}, saved["rows"])
                if other == "append":
                    self.assertEqual(results[1]["added"], 1)
                    self.assertEqual(len(saved["rows"]), len(SAVED) + 2)
                else:
                    self.assertEqual(saved["check"]["min_accuracy"], 0.95)

    def queued(self):
        self.save()
        return decisions.queue("tickets", self.route(), audit=2)

    def test_append_adds_rows_and_labels_only_and_keeps_the_check(self):
        items = self.queued()["items"]
        beans = items[0]
        labeled = dict(beans, labels=dict(beans["labels"], department="product"))
        out = decisions.append("tickets", [labeled])
        self.assertEqual((out["added"], out["already"], out["audit"]), (1, 0, None))
        saved = workbench.load_dataset("tickets")
        self.assertEqual(saved["rows"][-1], {"text": "Which beans for espresso?", "_expect": {"department": "product", "is_urgent": True}})
        self.assertNotIn("answers", json.dumps(saved), "a dataset holds rows and labels, never answers")
        self.assertEqual(saved["check"]["gates"], CHECK["gates"], "the check stays")
        self.assertEqual(out["dataset"]["rows"], 3)
        again = decisions.append("tickets", [labeled])
        self.assertEqual((again["added"], again["already"]), (0, 1), "a row the dataset has is not added twice")
        self.assertEqual(decisions.queue("tickets", self.route())["counts"]["in_dataset"], 2, "and leaves the queue")

    def test_audit_scores_the_gates_automated_decisions(self):
        audit = [i for i in self.queued()["items"] if i["kind"] == "audit"]
        right, wrong = audit
        right = dict(right, labels={"department": right["answers"]["department"], "is_urgent": right["answers"]["is_urgent"]})
        wrong = dict(wrong, labels={"department": "technical", "is_urgent": wrong["answers"]["is_urgent"]})
        out = decisions.append("tickets", [right, wrong])
        rep = out["audit"]
        self.assertEqual((rep["rows"], rep["correct"], rep["accuracy"], rep["target"], rep["ok"]), (2, 1, 0.5, 0.8, False))
        self.assertLess(rep["accuracy_low"], 0.5)
        self.assertGreater(rep["accuracy_high"], 0.5)
        self.assertEqual(rep["wrong"], [{"row": wrong["row"], "wrong": {"department": {"answer": "billing", "label": "technical"}}}])

    def test_audit_needs_every_gated_label(self):
        audit = [i for i in self.queued()["items"] if i["kind"] == "audit"][0]
        out = decisions.append("tickets", [dict(audit, labels={"wants_refund": True})])
        self.assertEqual(out["added"], 1)
        self.assertIsNone(out["audit"], "a row without a label for every gated question is not scored")

    def test_refusals(self):
        beans = self.queued()["items"][0]
        cases = [
            ([], "Label at least one row"),
            ([dict(beans, labels={})], "has no labels"),
            ([dict(beans, labels={"department": None})], "has no labels"),
            ([dict(beans, labels={"department": "sales"})], "not an answer to department"),
            ([dict(beans, labels={"frustration": 7})], "not an answer to frustration"),
            ([dict(beans, labels={"color": "red"})], "not one of the dataset's questions"),
            ([dict(beans, row="text")], "needs its row"),
            ([dict(beans, row={"text": "x", "_expect": {}}, labels={"department": "none"})], "own _expect"),
        ]
        for items, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(workbench.WorkbenchError, message):
                    decisions.append("tickets", items)
        self.assertEqual(len(workbench.load_dataset("tickets")["rows"]), 2, "a refused append writes nothing")

    def test_a_full_dataset_says_how_many_fit(self):
        rows = [{"text": "row %d" % n, "_expect": {"department": "none"}} for n in range(199)]
        self.save(rows=rows)
        items = [{"row": {"text": "new %d" % n}, "labels": {"department": "none"}, "kind": "review"} for n in range(3)]
        with self.assertRaisesRegex(workbench.WorkbenchError, "Add at most 1 of these 3 rows"):
            decisions.append("tickets", items)
        self.assertEqual(decisions.append("tickets", items[:1])["dataset"]["rows"], 200)


class ServerTests(Temp):
    def test_routes(self):
        self.save()
        self.assertIs(server.ROUTES[("POST", "/api/workbench/checks/decisions")], server.api_wb_decisions)
        self.assertIs(server.ROUTES[("POST", "/api/workbench/checks/decisions/add")], server.api_wb_decisions_add)
        line = json.dumps({"route": "review", "held": ["department"], "rules": [], "answers": {"department": "none"},
                           "row": {"text": "hi"}})
        out = server.api_wb_decisions({"id": "tickets", "text": line, "audit": 0})
        self.assertEqual(out["counts"]["queued"], 1)
        item = dict(out["items"][0], labels={"department": "none"})
        self.assertEqual(server.api_wb_decisions_add({"id": "tickets", "items": [item]})["added"], 1)


if __name__ == "__main__":
    unittest.main()
