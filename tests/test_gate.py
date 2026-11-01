"""Gate export (jev/gate.py): the exported files route rows exactly as the Workbench's Policy does.

The exported Python runs here against a stand-in typesafe_sdk package, and, when the real SDK is
installed (Python 3.10+), against the real client with its HTTP transport mocked, which also checks that
the SDK's question classes send the questions as the Workbench does. The exported JavaScript runs under
Node against a stand-in @typesafe-ai/sdk package, skipped when Node is missing. No key, no network.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from jev import calibrate, examples, gate, policy, workbench  # noqa: E402

try:
    import httpx2
    import typesafe_sdk
except ImportError:  # Python 3.9: the stdlib fallback has no SDK
    typesafe_sdk = None

QUESTIONS = examples.BULK_QUESTIONS  # department (choice), frustration (score), is_urgent and wants_refund (noul)
GATES = {"department": 0.6, "is_urgent": 0.4, "frustration": 0.5}


def answers(department=0.9, urgent=0.9, frustration=0.8):
    """API-shaped answers whose gating signals are set by the arguments."""
    return {
        "department": {"type": "choice", "choice": "billing", "confidence": department,
                       "probabilities": {"billing": 0.8, "shipping": 0.1, "account": 0.05, "product": 0.03, "other": 0.02}},
        "frustration": {"type": "score", "score": 1.2, "confidence": frustration,
                        "probabilities": {"0": 0.1, "1": 0.6, "2": 0.3}, "legend": {"0": "a", "1": "b", "2": "c"}},
        "is_urgent": {"type": "noul", "noul": urgent},
        "wants_refund": {"type": "noul", "noul": 0.2},
    }


# Rows on both sides of every threshold, with ties, and a Noul whose confidence is |2p - 1|.
CASES = [answers(), answers(department=0.59), answers(department=0.6), answers(urgent=0.7), answers(urgent=0.69),
         answers(urgent=0.25), answers(frustration=0.2), answers(department=0.1, urgent=0.5, frustration=0.1)]


def expected(answer_set, gates=GATES, signal="confidence"):
    """The questions Policy holds for these answers: a signal below its threshold, with Policy's tie rule."""
    return [q for q, t in gates.items()
            if calibrate._read(answer_set[q]["type"], answer_set[q], signal)[1] + policy.EPS < t]


def shown(answer_set):
    return {qid: calibrate._read(a["type"], a, "confidence")[0] for qid, a in answer_set.items()}


FAKE_SDK = '''
import json, os
from types import SimpleNamespace as NS

class _Q:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

Choice = Noul = NoulCriteria = Score = _Q
QUEUE = []

class TypeSafeClient:
    def __init__(self, **kwargs):
        if not QUEUE and os.environ.get("FAKE_ANSWERS"):
            QUEUE.extend(json.load(open(os.environ["FAKE_ANSWERS"])))

    def system_one(self, state, questions, model=None):
        raw = QUEUE.pop(0)
        group = lambda t: {k: NS(**a) for k, a in raw.items() if a["type"] == t}
        return NS(choices=group("choice"), nouls=group("noul"), scores=group("score"))
'''

FAKE_JS_SDK = '''
import { readFileSync } from "node:fs";
const queue = process.env.FAKE_ANSWERS ? JSON.parse(readFileSync(process.env.FAKE_ANSWERS, "utf8")) : [];
export class TypeSafeClient {
  async systemOne(request) {
    globalThis.requests = [...(globalThis.requests || []), request];
    return { answers: queue.shift() };
  }
}
'''

JS_RUNNER = '''
import { decide } from "./gate.mjs";
const cases = JSON.parse(process.argv[2]);
const out = [];
for (const answers of cases) out.push(await decide({ text: "hi" }, { systemOne: async () => ({ answers }) }));
console.log(JSON.stringify(out));
'''


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def python_module(self, code):
        """Exec the exported Python with the stand-in SDK importable."""
        (self.tmp / "typesafe_sdk.py").write_text(FAKE_SDK)
        sys.path.insert(0, str(self.tmp))
        self.addCleanup(sys.path.remove, str(self.tmp))
        with patch.dict(sys.modules):
            sys.modules.pop("typesafe_sdk", None)
            namespace = {"__name__": "gate"}
            exec(compile(code, "gate.py", "exec"), namespace)
            return namespace

    def test_python_routes_as_policy_does(self):
        for signal in calibrate.SIGNALS:
            with self.subTest(signal=signal):
                code = gate.export(QUESTIONS, GATES, signal, "jev-1.14.0")["python"]
                module = self.python_module(code)
                for case in CASES:
                    decision = module["decide"]({"text": "hi"}, self.client(case))
                    held = expected(case, signal=signal)
                    self.assertEqual(decision, {"route": "review" if held else "auto", "held": held, "answers": shown(case)})

    @staticmethod
    def client(raw):
        """A client whose result, like the SDK's, groups the answers by type."""
        group = lambda t: {k: SimpleNamespace(**a) for k, a in raw.items() if a["type"] == t}  # noqa: E731
        result = SimpleNamespace(choices=group("choice"), nouls=group("noul"), scores=group("score"))
        return SimpleNamespace(system_one=lambda state, questions, model=None: result)

    def test_a_missing_answer_holds_its_question(self):
        module = self.python_module(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["python"])
        partial = {k: v for k, v in answers().items() if k != "is_urgent"}
        decision = module["decide"]({"text": "hi"}, self.client(partial))
        self.assertEqual((decision["route"], decision["held"], decision["answers"]["is_urgent"]), ("review", ["is_urgent"], None))

    def test_python_runs_as_a_script_over_rows(self):
        (self.tmp / "typesafe_sdk.py").write_text(FAKE_SDK)
        (self.tmp / "gate.py").write_text(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["python"])
        (self.tmp / "answers.json").write_text(json.dumps(CASES[:3]))
        rows = 'Order A-1041 arrived damaged.\n\n{"text": "Refund please", "channel": "email"}\n42\n'
        env = dict(os.environ, FAKE_ANSWERS=str(self.tmp / "answers.json"), PYTHONPATH=str(self.tmp))
        out = subprocess.run([sys.executable, str(self.tmp / "gate.py")], input=rows, capture_output=True, text=True,
                             env=env, check=True, cwd=self.tmp).stdout.splitlines()
        self.assertEqual([json.loads(line)["route"] for line in out], ["auto", "review", "auto"])

    @unittest.skipUnless(typesafe_sdk, "the TypeSafe SDK needs Python 3.10+")
    def test_python_with_the_real_sdk(self):
        sent = []

        def handler(request):
            sent.append(json.loads(request.content))
            return httpx2.Response(200, json={"model": "jev-1.14.0", "answers": CASES[1],
                                              "usage": {"input_tokens": 100, "output_tokens": 4}})

        namespace = {"__name__": "gate"}
        exec(compile(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["python"], "gate.py", "exec"), namespace)
        client = typesafe_sdk.TypeSafeClient(api_key="sk-test", transport=httpx2.MockTransport(handler), compression=False)
        decision = namespace["decide"]({"text": "hi"}, client)
        self.assertEqual(decision, {"route": "review", "held": ["department"], "answers": shown(CASES[1])})
        (request,) = sent
        self.assertEqual(request["model"], "jev-1.14.0")
        self.assertEqual(request["questions"], workbench.bulk_questions(QUESTIONS), "the SDK sends the questions as the Workbench does")

    @unittest.skipUnless(shutil.which("node"), "Node is not installed")
    def test_javascript_routes_as_policy_does(self):
        package = self.tmp / "node_modules" / "@typesafe-ai" / "sdk"
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"name": "@typesafe-ai/sdk", "type": "module", "main": "index.mjs"}))
        (package / "index.mjs").write_text(FAKE_JS_SDK)
        (self.tmp / "run.mjs").write_text(JS_RUNNER)
        for signal in calibrate.SIGNALS:
            with self.subTest(signal=signal):
                (self.tmp / "gate.mjs").write_text(gate.export(QUESTIONS, GATES, signal, "jev-1.14.0")["javascript"])
                out = subprocess.run(["node", "run.mjs", json.dumps(CASES)], capture_output=True, text=True, check=True,
                                     cwd=self.tmp).stdout
                want = []
                for case in CASES:
                    held = expected(case, signal=signal)
                    want.append({"route": "review" if held else "auto", "held": held, "answers": shown(case)})
                self.assertEqual(json.loads(out), want)
        (self.tmp / "gate.mjs").write_text(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["javascript"])
        (self.tmp / "answers.json").write_text(json.dumps(CASES[:2]))
        rows = 'Order A-1041 arrived damaged.\n{"text": "Refund please"}\n'
        out = subprocess.run(["node", "gate.mjs"], input=rows, capture_output=True, text=True, check=True, cwd=self.tmp,
                             env=dict(os.environ, FAKE_ANSWERS=str(self.tmp / "answers.json"))).stdout.splitlines()
        self.assertEqual([json.loads(line)["route"] for line in out], ["auto", "review"])


class ValidationTests(unittest.TestCase):
    def test_bad_gates_are_refused(self):
        box = dict(QUESTIONS, where={"type": "box", "instructions": "the tear in `photo`"})
        for args in ((QUESTIONS, {"nope": 0.5}, "confidence", "m"), (QUESTIONS, {}, "confidence", "m"),
                     (QUESTIONS, {"department": 1.5}, "confidence", "m"), (QUESTIONS, GATES, "loudness", "m"),
                     (QUESTIONS, GATES, "confidence", " "), (box, GATES, "confidence", "m")):
            with self.subTest(args=args[1:]), self.assertRaises(workbench.WorkbenchError):
                gate.export(*args)

    def test_the_header_says_where_the_thresholds_came_from(self):
        out = gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0",
                          {"dataset": "Support tickets", "min_accuracy": 0.95, "min_coverage": 0.6, "bound": "lower"})
        line = ('Thresholds from the check saved with the Jev Lab dataset "Support tickets", whose targets are 95% accuracy'
                " on automated rows at 95% confidence and at least 60% of rows automated.")
        self.assertIn(line, out["python"])
        self.assertIn("// " + line, out["javascript"])
        self.assertIn("Workbench Policy on one Bulk run", gate.export(QUESTIONS, GATES, "confidence", "m")["python"])


    def test_a_dataset_name_cannot_become_code(self):
        name = 'Tickets """\nimport os; os.exit(1)  # */ \\'
        out = gate.export(QUESTIONS, GATES, "confidence", "m", {"dataset": name})
        tree = compile(out["python"], "gate.py", "exec", flags=0x400, dont_inherit=True)  # PyCF_ONLY_AST
        self.assertEqual([type(n).__name__ for n in tree.body[:4]], ["Expr", "Import", "Import", "ImportFrom"])
        self.assertNotIn("\nimport os", out["python"])
        self.assertNotIn("\nimport os", out["javascript"])


class RouteTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        patcher = patch.object(workbench, "WORKBENCH_DIR", Path(tmp))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_policy_gate_and_saved_check(self):
        self.assertIs(server.ROUTES[("POST", "/api/workbench/gate/export")], server.api_wb_gate_export)
        out = server.api_wb_gate_export({"questions": QUESTIONS, "gates": GATES, "signal": "top_probability"})
        self.assertIn("MODEL = %r" % server.client.model, out["python"])
        self.assertIn("SIGNAL = 'top_probability'", out["python"])

        workbench.save_dataset({"name": "Tickets", "rows": ["Refund please"], "questions": QUESTIONS})
        with self.assertRaises(workbench.WorkbenchError):
            server.api_wb_gate_export({"dataset": "tickets"})
        from jev import checks
        checks.save_check("tickets", {"gates": GATES, "signal": "confidence", "bound": "estimate", "model": "jev-1.13.0",
                                      "min_accuracy": 0.9, "min_coverage": 0.5})
        out = server.api_wb_gate_export({"dataset": "tickets"})
        self.assertIn("MODEL = 'jev-1.13.0'", out["python"])
        self.assertIn('dataset "Tickets", whose targets are 90% accuracy on automated rows and at least 50%', out["python"])


if __name__ == "__main__":
    unittest.main()
