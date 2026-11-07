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
from jev import calibrate, examples, gate, images, policy, rules, workbench  # noqa: E402

try:
    import httpx2
    import typesafe_sdk
except ImportError:  # Python 3.9: the stdlib fallback has no SDK
    typesafe_sdk = None

QUESTIONS = examples.BULK_QUESTIONS  # department (choice), frustration (score), is_urgent and wants_refund (noul)
GATES = {"department": 0.6, "is_urgent": 0.4, "frustration": 0.5}
PHOTO_QUESTIONS = {"damaged": {"type": "noul", "instructions": "Is anything in `photo` damaged?"},
                   "where": {"type": "box", "instructions": "the damage in `photo`"}}
BOX = {"left": 0.1, "top": 0.2, "right": 0.6, "bottom": 0.7}
PHOTO_ANSWERS = {"damaged": {"type": "noul", "noul": 0.95},
                 "where": {"type": "box", "box": BOX, "confidence": 0.8}}


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


# Consistency rules over the same answers: the first breaks when is_urgent is no, the second never does on CASES,
# and the third compares Score levels and writes a Noul's value as `false`.
RULES = ("if department = billing then is_urgent = yes\n"
         "if wants_refund = no and frustration >= 1 then department in billing, shipping\n"
         "if frustration > 1 then wants_refund = false")


def expected_rules(answer_set):
    """The rules Policy holds this row by, as written."""
    parsed = rules.parse(RULES)
    rules.check(parsed, rules.kinds_from_questions(QUESTIONS))
    lines = rules.holding(parsed, answer_set)
    return [r["text"] for r in parsed if r["line"] in lines]


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
from pathlib import Path
from types import SimpleNamespace as NS

class _Q:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

Choice = Noul = NoulCriteria = Score = Box = _Q
class Image:
    def __init__(self, data):
        self.data = Path(data).read_bytes()
QUEUE = []

class TypeSafeClient:
    def __init__(self, **kwargs):
        if not QUEUE and os.environ.get("FAKE_ANSWERS"):
            QUEUE.extend(json.load(open(os.environ["FAKE_ANSWERS"])))

    def system_one(self, state, questions, model=None, assets=None, extra_headers=None):
        if os.environ.get("FAKE_STATES"):
            with open(os.environ["FAKE_STATES"], "a") as states:
                states.write(json.dumps(state) + "\\n")
        raw = QUEUE.pop(0)
        group = lambda t: {k: NS(**a) for k, a in raw.items() if a["type"] == t}
        boxes = {k: NS(box=NS(**a["box"]), confidence=a["confidence"]) for k, a in raw.items() if a["type"] == "box"}
        return NS(choices=group("choice"), nouls=group("noul"), scores=group("score"), boxes=boxes)
'''

FAKE_JS_SDK = '''
import { appendFileSync, readFileSync } from "node:fs";
const queue = process.env.FAKE_ANSWERS ? JSON.parse(readFileSync(process.env.FAKE_ANSWERS, "utf8")) : [];
export function image(blob) { return { blob }; }
export class TypeSafeClient {
  async systemOne(request) {
    if (process.env.FAKE_STATES) appendFileSync(process.env.FAKE_STATES, JSON.stringify(request.state) + "\\n");
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
                    self.assertEqual(decision, {"route": "review" if held else "auto", "held": held, "rules": [],
                                                "answers": shown(case),
                                                "provenance": gate.provenance(QUESTIONS, GATES, signal, "jev-1.14.0")})

    @staticmethod
    def client(raw):
        """A client whose result, like the SDK's, groups the answers by type."""
        group = lambda t: {k: SimpleNamespace(**a) for k, a in raw.items() if a["type"] == t}  # noqa: E731
        boxes = {k: SimpleNamespace(box=SimpleNamespace(**a["box"]), confidence=a["confidence"])
                 for k, a in raw.items() if a["type"] == "box"}
        result = SimpleNamespace(choices=group("choice"), nouls=group("noul"), scores=group("score"), boxes=boxes)
        return SimpleNamespace(system_one=lambda state, questions, model=None, **kwargs: result)

    def test_answer_set_candidates_match_in_python_and_javascript_without_changing_routing(self):
        sets = {"department": {"cut": 0.2, "coverage": 0.9},
                "is_urgent": {"cut": 0.5, "coverage": 0.9},
                "frustration": {"cut": 0.3, "coverage": 0.9}}
        case = answers(department=0.4, urgent=0.5)
        case["department"]["probabilities"] = dict.fromkeys(QUESTIONS["department"]["criteria"], 0.0)
        case["department"]["probabilities"].update(billing=0.6, shipping=0.2, technical=0.2 - 5e-10)
        partial = dict(case, department=dict(case["department"], probabilities={"billing": 1}),
                       frustration=dict(case["frustration"], probabilities={"1": 1}))
        missing = {k: v for k, v in case.items() if k != "is_urgent"}
        no_match = dict(case, department=dict(case["department"], probabilities={
            "billing": 0.16, "shipping": 0.17, "technical": 0.17, "product": 0.17, "wholesale": 0.17, "none": 0.16}))
        cases = [case, partial, missing, no_match]
        exported = gate.export(QUESTIONS, GATES, "confidence", "m", rules=RULES, answer_sets=sets)
        module = self.python_module(exported["python"])
        plain = self.python_module(gate.export(QUESTIONS, GATES, "confidence", "m", rules=RULES)["python"])
        out = [module["decide"]({"text": "hi"}, self.client(c)) for c in cases]
        for c, d in zip(cases, out):
            self.assertEqual({k: v for k, v in d.items() if k not in ("candidates", "provenance")},
                             {k: v for k, v in plain["decide"]({"text": "hi"}, self.client(c)).items() if k != "provenance"})
        self.assertEqual(out[0]["candidates"], {"department": ["billing", "shipping", "technical"],
                                                 "is_urgent": [True, False], "frustration": [1, 2]})
        self.assertEqual(out[1]["candidates"]["department"], list(QUESTIONS["department"]["criteria"]))
        self.assertEqual(out[1]["candidates"]["frustration"], [0, 1, 2])
        self.assertEqual(out[2]["candidates"]["is_urgent"], [True, False])
        self.assertEqual(out[3]["candidates"]["department"], ["shipping", "technical", "product", "wholesale", "billing", "none"])
        # Invalid probabilities must not narrow the labeler's choices, including NaN and boolean values.
        for invalid in (None, {"1": float("nan"), "0": 0.2, "2": 0.8}, {"0": True, "1": 0, "2": 0}):
            bad = dict(case, frustration=dict(case["frustration"], probabilities=invalid))
            grouped = self.client(bad).system_one({}, {})
            self.assertEqual(module["candidates"](grouped)["frustration"], [0, 1, 2])
        if shutil.which("node"):
            package = self.tmp / "node_modules" / "@typesafe-ai" / "sdk"
            package.mkdir(parents=True)
            (package / "package.json").write_text(json.dumps({"type": "module", "main": "index.mjs"}))
            (package / "index.mjs").write_text(FAKE_JS_SDK)
            (self.tmp / "gate.mjs").write_text(exported["javascript"])
            (self.tmp / "run.mjs").write_text(JS_RUNNER)
            js = json.loads(subprocess.run(["node", "run.mjs", json.dumps(cases)], capture_output=True,
                                          text=True, check=True, cwd=self.tmp).stdout)
            self.assertEqual(js, out)
            (self.tmp / "fallback.mjs").write_text('''import { candidates } from "./gate.mjs";
import assert from "node:assert/strict";
for (const probabilities of [null, {0: 0.2, 1: NaN, 2: 0.8}, {0: true, 1: 0, 2: 0}]) {
  assert.deepEqual(candidates({frustration: {probabilities}}).frustration, [0, 1, 2]);
}
''')
            subprocess.run(["node", "fallback.mjs"], capture_output=True, text=True, check=True, cwd=self.tmp)

    def test_rules_route_as_policy_does(self):
        partial = {k: v for k, v in answers().items() if k != "is_urgent"}  # the first rule cannot be checked
        angry = dict(answers(), frustration=dict(answers()["frustration"], probabilities={"0": 0.1, "1": 0.2, "2": 0.7}))
        cases = CASES + [partial, angry, dict(angry, wants_refund={"type": "noul", "noul": 0.9})]  # the last breaks rule 3
        module = self.python_module(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0", rules=RULES)["python"])
        seen = set()
        for case in cases:
            decision = module["decide"]({"text": "hi"}, self.client(case))
            want = expected_rules(case)
            seen.update(want)
            self.assertEqual(decision["rules"], want)
            if want:
                self.assertEqual(decision["route"], "review")
        self.assertEqual(len(seen), 2, "the cases break the first and third rules")
        # Policy agrees row by row: labeled on department alone, with its threshold at 0, only a rule holds a row.
        rows = [{"index": i, "answers": c, "labels": {"department": "billing"}} for i, c in enumerate(cases)]
        rep = policy.evaluate(rows, {"department": 0.0}, "confidence", RULES)
        self.assertEqual([not r["automated"] for r in rep["rows"]], [bool(expected_rules(c)) for c in cases])
        if shutil.which("node"):
            package = self.tmp / "node_modules" / "@typesafe-ai" / "sdk"
            package.mkdir(parents=True)
            (package / "package.json").write_text(json.dumps({"name": "@typesafe-ai/sdk", "type": "module", "main": "index.mjs"}))
            (package / "index.mjs").write_text(FAKE_JS_SDK)
            (self.tmp / "run.mjs").write_text(JS_RUNNER)
            (self.tmp / "gate.mjs").write_text(gate.export(QUESTIONS, GATES, "confidence", "m", rules=RULES)["javascript"])
            out = json.loads(subprocess.run(["node", "run.mjs", json.dumps(cases)], capture_output=True, text=True,
                                            check=True, cwd=self.tmp).stdout)
            self.assertEqual([d["rules"] for d in out], [expected_rules(c) for c in cases])
        with self.assertRaises(workbench.WorkbenchError):
            gate.export(QUESTIONS, GATES, "confidence", "m", rules="if department = refunds then is_urgent = yes")

    def test_a_missing_answer_holds_its_question(self):
        module = self.python_module(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["python"])
        partial = {k: v for k, v in answers().items() if k != "is_urgent"}
        decision = module["decide"]({"text": "hi"}, self.client(partial))
        self.assertEqual((decision["route"], decision["held"], decision["answers"]["is_urgent"]), ("review", ["is_urgent"], None))

    def test_python_picture_gate_sends_the_asset_and_returns_box_and_candidates(self):
        photo = self.tmp / "pictures"
        photo.mkdir()
        data = images.sample_bytes("torn-bag")
        (photo / "torn-bag.png").write_bytes(data)
        saved = "0123456789abcdef.jpg"
        (photo / saved).write_bytes(data)
        module = self.python_module(gate.export(PHOTO_QUESTIONS, {"damaged": 0.8}, model="jev-1.14.0",
                                               answer_sets={"damaged": {"cut": 0.5, "coverage": 0.9}})["python"])
        client = self.client(PHOTO_ANSWERS)
        for name in ("torn-bag", saved):
            row = {"note": "A torn bag", "_image": name, "_expect": {"damaged": True}, "_test": True}
            original = dict(row)
            with patch.object(client, "system_one", wraps=client.system_one) as call:
                decision = module["decide"](row, client, image_dir=photo)
            state = call.call_args.args[0]
            self.assertEqual(state, {"note": "A torn bag", "photo": workbench._ref(name)})
            asset = call.call_args.kwargs["assets"][state["photo"]]
            self.assertEqual(asset.data, data)
            self.assertEqual(call.call_args.kwargs["extra_headers"], {images.IMAGES_HEADER: "true"})
            self.assertEqual(row, original, "library calls do not rewrite the caller's row")
            self.assertEqual(decision, {"route": "auto", "held": [], "rules": [],
                                       "answers": {"damaged": True, "where": BOX}, "candidates": {"damaged": [True]},
                                       "provenance": module["PROVENANCE"]})
        self.assertIsNone(module["decide"]({"_image": "torn-bag"}, self.client({"damaged": PHOTO_ANSWERS["damaged"]}),
                                         image_dir=photo)["answers"]["where"])
        unsure = dict(PHOTO_ANSWERS, damaged={"type": "noul", "noul": 0.7})
        self.assertEqual(module["decide"]({"_image": "torn-bag"}, self.client(unsure), image_dir=photo)["route"], "review")

    def test_python_picture_gate_rejects_bad_input_before_calling_the_model(self):
        module = self.python_module(gate.export(PHOTO_QUESTIONS, {"damaged": 0.8}, model="jev-1.14.0")["python"])
        client = self.client(PHOTO_ANSWERS)
        with patch.object(client, "system_one", side_effect=AssertionError("Unexpected model call")):
            for row in ({"text": "no picture"}, {"_image": "../torn-bag.png"}, {"_image": "torn-bag", "photo": "mine"}):
                with self.subTest(row=row), self.assertRaises(ValueError):
                    module["decide"](row, client, image_dir=self.tmp)
            with self.assertRaises((ValueError, OSError)):
                module["decide"]({"_image": "torn-bag"}, client, image_dir=self.tmp)

    def test_python_picture_script_keeps_the_original_image_row(self):
        (self.tmp / "typesafe_sdk.py").write_text(FAKE_SDK)
        (self.tmp / "gate.py").write_text(gate.export(PHOTO_QUESTIONS, {"damaged": 0.8}, model="jev-1.14.0")["python"])
        (self.tmp / "torn-bag.png").write_bytes(images.sample_bytes("torn-bag"))
        (self.tmp / "answers.json").write_text(json.dumps([PHOTO_ANSWERS]))
        row = {"note": "A torn bag", "_image": "torn-bag", "_expect": {"damaged": True}, "_test": True}
        env = dict(os.environ, FAKE_ANSWERS=str(self.tmp / "answers.json"), PYTHONPATH=str(self.tmp),
                   FAKE_STATES=str(self.tmp / "states.jsonl"))
        result = subprocess.run([sys.executable, "gate.py"], input=json.dumps(row) + "\n", capture_output=True,
                                text=True, env=env, check=True, cwd=self.tmp)
        decision = json.loads(result.stdout)
        self.assertEqual(decision["row"], {"note": "A torn bag", "_image": "torn-bag"})
        self.assertEqual(decision["answers"]["where"], BOX)
        self.assertEqual(json.loads((self.tmp / "states.jsonl").read_text()),
                         {"note": "A torn bag", "photo": workbench._ref("torn-bag")})

    @unittest.skipUnless(shutil.which("node"), "Node is not installed")
    def test_javascript_picture_gate_and_script(self):
        package = self.tmp / "node_modules" / "@typesafe-ai" / "sdk"
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"type": "module", "main": "index.mjs"}))
        (package / "index.mjs").write_text(FAKE_JS_SDK)
        (self.tmp / "gate.mjs").write_text(gate.export(PHOTO_QUESTIONS, {"damaged": 0.8}, model="jev-1.14.0",
                                                    answer_sets={"damaged": {"cut": 0.5, "coverage": 0.9}})["javascript"])
        photo = self.tmp / "pictures"
        photo.mkdir()
        (photo / "torn-bag.png").write_bytes(images.sample_bytes("torn-bag"))
        saved = "0123456789abcdef.jpg"
        (photo / saved).write_bytes(images.sample_bytes("torn-bag"))
        runner = '''import { decide, PROVENANCE } from "./gate.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const result = JSON.parse(process.argv[2]);
const refs = JSON.parse(process.argv[3]);
let calls = 0;
const client = { systemOne: async (request, options) => {
  calls++;
  assert.deepEqual(request.state, {note: "A torn bag", photo: refs.shift()});
  const [[ref, asset]] = Object.entries(request.assets);
  assert.equal(ref, request.state.photo);
  assert.deepEqual(Buffer.from(await asset.blob.arrayBuffer()), readFileSync("pictures/torn-bag.png"));
  assert.deepEqual(options.headers, {"TypeSafe-Danger-Zone-Images": "true"});
  return {answers: result};
}};
for (const name of ["torn-bag", "0123456789abcdef.jpg"]) {
  const row = {note: "A torn bag", _image: name, _expect: {damaged: true}, _test: true};
  const original = structuredClone(row);
  const out = await decide(row, client, "pictures");
  assert.deepEqual(out, {route: "auto", held: [], rules: [], answers: {damaged: true, where: result.where.box},
                         candidates: {damaged: [true]}, provenance: PROVENANCE});
  assert.deepEqual(row, original);
}
assert.equal(calls, 2);
const noCall = {systemOne() { throw Error("Unexpected model call"); }};
for (const row of [{text: "no picture"}, {_image: "../torn-bag.png"}, {_image: "torn-bag", photo: "mine"},
                   {_image: "intact-bag"}]) {
  await assert.rejects(() => decide(row, noCall, "pictures"));
}
const partial = await decide({_image: "torn-bag"}, {systemOne: async () => ({answers: {damaged: result.damaged}})}, "pictures");
assert.equal(partial.answers.where, null);
const unsure = await decide({_image: "torn-bag"}, {systemOne: async () => ({answers: {...result, damaged: {type: "noul", noul: 0.7}}})}, "pictures");
assert.equal(unsure.route, "review");
'''
        (self.tmp / "run.mjs").write_text(runner)
        subprocess.run(["node", "run.mjs", json.dumps(PHOTO_ANSWERS),
                        json.dumps([workbench._ref("torn-bag"), workbench._ref(saved)])],
                       cwd=self.tmp, capture_output=True, text=True, check=True)
        shutil.copy(photo / "torn-bag.png", self.tmp / "torn-bag.png")
        (self.tmp / "answers.json").write_text(json.dumps([PHOTO_ANSWERS]))
        row = {"note": "A torn bag", "_image": "torn-bag", "_expect": {"damaged": True}, "_test": True}
        result = subprocess.run(["node", "gate.mjs"], input=json.dumps(row) + "\n", capture_output=True,
                                text=True, check=True, cwd=self.tmp,
                                env=dict(os.environ, FAKE_ANSWERS=str(self.tmp / "answers.json"),
                                         FAKE_STATES=str(self.tmp / "states.jsonl")))
        decision = json.loads(result.stdout)
        self.assertEqual(decision["row"], {"note": "A torn bag", "_image": "torn-bag"})
        self.assertEqual(decision["answers"]["where"], BOX)
        self.assertEqual(json.loads((self.tmp / "states.jsonl").read_text()),
                         {"note": "A torn bag", "photo": workbench._ref("torn-bag")})

    def test_python_runs_as_a_script_over_rows(self):
        (self.tmp / "typesafe_sdk.py").write_text(FAKE_SDK)
        (self.tmp / "gate.py").write_text(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["python"])
        (self.tmp / "answers.json").write_text(json.dumps(CASES[:3]))
        rows = 'Order A-1041 arrived damaged.\n\n{"text": "Refund please", "channel": "email", "_expect": {"is_urgent": true}}\n42\n'
        env = dict(os.environ, FAKE_ANSWERS=str(self.tmp / "answers.json"), PYTHONPATH=str(self.tmp),
                   FAKE_STATES=str(self.tmp / "states.jsonl"))
        out = subprocess.run([sys.executable, str(self.tmp / "gate.py")], input=rows, capture_output=True, text=True,
                             env=env, check=True, cwd=self.tmp).stdout.splitlines()
        self.assertEqual([json.loads(line)["route"] for line in out], ["auto", "review", "auto"])
        sent = [json.loads(line) for line in (self.tmp / "states.jsonl").read_text().splitlines()]
        self.assertEqual(sent, [{"text": "Order A-1041 arrived damaged."}, {"text": "Refund please", "channel": "email"},
                                {"text": "42"}], "labels never reach the model")
        self.assertEqual([json.loads(line)["row"] for line in out], sent, "each decision carries the row it was asked about")
        self.assertTrue(all(json.loads(line)["provenance"] == gate.provenance(QUESTIONS, GATES, model="jev-1.14.0")
                            for line in out))

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
        self.assertEqual(decision, {"route": "review", "held": ["department"], "rules": [], "answers": shown(CASES[1]),
                                    "provenance": gate.provenance(QUESTIONS, GATES, model="jev-1.14.0")})
        (request,) = sent
        self.assertEqual(request["model"], "jev-1.14.0")
        self.assertEqual(request["questions"], workbench.bulk_questions(QUESTIONS), "the SDK sends the questions as the Workbench does")

    @unittest.skipUnless(typesafe_sdk, "the TypeSafe SDK needs Python 3.10+")
    def test_python_picture_gate_with_real_sdk_multipart(self):
        from email.parser import BytesParser
        from email.policy import default

        sent = []

        def handler(request):
            sent.append(request)
            return httpx2.Response(200, json={"model": "jev-1.14.0", "answers": PHOTO_ANSWERS,
                                              "usage": {"input_tokens": 100, "output_tokens": 4}})

        (self.tmp / "torn-bag.png").write_bytes(images.sample_bytes("torn-bag"))
        namespace = {"__name__": "gate"}
        code = gate.export(PHOTO_QUESTIONS, {"damaged": 0.8}, model="jev-1.14.0")["python"]
        exec(compile(code, "gate.py", "exec"), namespace)
        client = typesafe_sdk.TypeSafeClient(api_key="sk-test", transport=httpx2.MockTransport(handler), compression=False)
        decision = namespace["decide"]({"_image": "torn-bag", "_expect": {"damaged": True}, "_test": True},
                                       client, image_dir=self.tmp)
        self.assertEqual(decision["answers"], {"damaged": True, "where": BOX})
        self.assertEqual(decision["route"], "auto")
        (request,) = sent
        self.assertEqual(request.headers[images.IMAGES_HEADER], "true")
        self.assertTrue(request.headers["content-type"].startswith("multipart/form-data"))
        message = BytesParser(policy=default).parsebytes(
            ("Content-Type: " + request.headers["content-type"] + "\r\n\r\n").encode() + request.content)
        parts = [part.get_payload(decode=True) for part in message.iter_parts()]
        self.assertIn(images.sample_bytes("torn-bag"), parts)
        payloads = [json.loads(part) for part in parts if part.startswith(b"{")]
        (payload,) = payloads
        self.assertEqual(payload["state"], {"photo": workbench._ref("torn-bag")})
        self.assertEqual(payload["questions"], PHOTO_QUESTIONS)
        self.assertIn(workbench._ref("torn-bag"), payload["assets"])

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
                    want.append({"route": "review" if held else "auto", "held": held, "rules": [], "answers": shown(case),
                                                "provenance": gate.provenance(QUESTIONS, GATES, signal, "jev-1.14.0")})
                self.assertEqual(json.loads(out), want)
        # An answer the model left out holds its question, even when its id names an inherited property, and an
        # unreadable signal (here a Choice answer without its confidence) holds its question too.
        named = {"constructor": {"type": "noul", "instructions": "Is it spam?"}, "department": QUESTIONS["department"]}
        (self.tmp / "gate.mjs").write_text(gate.export(named, {"constructor": 0.4, "department": 0.6}, "confidence", "m")["javascript"])
        unreadable = dict(answers()["department"], confidence=None)
        cases = [{"department": answers()["department"]}, {"department": unreadable, "constructor": {"type": "noul", "noul": 0.95}}]
        out = json.loads(subprocess.run(["node", "run.mjs", json.dumps(cases)], capture_output=True, text=True, check=True,
                                        cwd=self.tmp).stdout)
        self.assertEqual([(d["route"], d["held"], d["answers"]["constructor"]) for d in out],
                         [("review", ["constructor"], None), ("review", ["department"], True)])
        (self.tmp / "gate.mjs").write_text(gate.export(QUESTIONS, GATES, "confidence", "jev-1.14.0")["javascript"])
        (self.tmp / "answers.json").write_text(json.dumps(CASES[:2]))
        rows = 'Order A-1041 arrived damaged.\n{"text": "Refund please", "_expect": {"is_urgent": true}}\n'
        out = subprocess.run(["node", "gate.mjs"], input=rows, capture_output=True, text=True, check=True, cwd=self.tmp,
                             env=dict(os.environ, FAKE_ANSWERS=str(self.tmp / "answers.json"),
                                      FAKE_STATES=str(self.tmp / "states.jsonl"))).stdout.splitlines()
        self.assertEqual([json.loads(line)["route"] for line in out], ["auto", "review"])
        sent = [json.loads(line) for line in (self.tmp / "states.jsonl").read_text().splitlines()]
        self.assertEqual(sent, [{"text": "Order A-1041 arrived damaged."}, {"text": "Refund please"}], "labels never reach the model")
        self.assertEqual([json.loads(line)["row"] for line in out], sent, "each decision carries the row it was asked about")
        self.assertTrue(all(json.loads(line)["provenance"] == gate.provenance(QUESTIONS, GATES, model="jev-1.14.0")
                            for line in out))


class ProvenanceTests(unittest.TestCase):
    def test_identity_covers_request_and_routing_changes(self):
        baseline = gate.provenance(QUESTIONS, GATES, model="jev-1.14.0")
        self.assertEqual(baseline["version"], 1)
        self.assertEqual(baseline["model"], "jev-1.14.0")
        self.assertRegex(baseline["fingerprint"], r"^[0-9a-f]{64}$")
        reworded = dict(QUESTIONS, department=dict(QUESTIONS["department"], instructions="Where should this go?"))
        reordered = dict(QUESTIONS, department=dict(QUESTIONS["department"], criteria=dict(
            reversed(list(QUESTIONS["department"]["criteria"].items())))))
        variants = [
            {"questions": reworded}, {"questions": reordered}, {"model": "jev-1.15.0"},
            {"gates": dict(GATES, department=0.7)}, {"signal": "top_probability"}, {"rules": RULES},
            {"answer_sets": {"department": {"cut": 0.2, "coverage": 0.9}}},
        ]
        for changes in variants:
            with self.subTest(changes=changes):
                args = dict(questions=QUESTIONS, gates=GATES, model="jev-1.14.0")
                args.update(changes)
                self.assertNotEqual(gate.provenance(**args), baseline)

    def test_identity_ignores_ordinary_object_field_order_and_source_metadata(self):
        questions = {qid: dict(reversed(list(spec.items()))) for qid, spec in reversed(list(QUESTIONS.items()))}
        baseline = gate.provenance(QUESTIONS, GATES, model="jev-1.14.0")
        self.assertEqual(gate.provenance(questions, dict(reversed(list(GATES.items()))), model=" jev-1.14.0 "), baseline)
        a = gate.export(QUESTIONS, GATES, model="jev-1.14.0", source={"dataset": "First", "min_accuracy": 0.9})
        b = gate.export(QUESTIONS, GATES, model="jev-1.14.0", source={"dataset": "Second", "min_accuracy": 0.95})
        for exported in (a, b):
            self.assertIn(baseline["fingerprint"], exported["python"])
            self.assertIn(baseline["fingerprint"], exported["javascript"])


class ValidationTests(unittest.TestCase):
    def test_bad_gates_are_refused(self):
        box = dict(QUESTIONS, where={"type": "box", "instructions": "the tear in `photo`"})
        for args in ((QUESTIONS, {"nope": 0.5}, "confidence", "m"), (QUESTIONS, {}, "confidence", "m"),
                     (QUESTIONS, {"department": 1.5}, "confidence", "m"), (QUESTIONS, GATES, "loudness", "m"),
                     (QUESTIONS, GATES, "confidence", " "), (box, {"where": 0.8}, "confidence", "m")):
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


    def test_a_question_or_option_named_proto_is_refused(self):
        for questions in (dict(QUESTIONS, __proto__={"type": "noul", "instructions": "Is it spam?"}),
                          dict(QUESTIONS, kind={"type": "choice", "instructions": "Which?", "criteria": {"__proto__": "x", "b": "y"}})):
            with self.subTest(questions=list(questions)), self.assertRaises(workbench.WorkbenchError):
                gate.export(questions, GATES, "confidence", "m")

    def test_a_dataset_name_cannot_become_code(self):
        name = 'Tickets """\nimport os; os.exit(1)  # */ \\'
        out = gate.export(QUESTIONS, GATES, "confidence", "m", {"dataset": name})
        tree = compile(out["python"], "gate.py", "exec", flags=0x400, dont_inherit=True)  # PyCF_ONLY_AST
        self.assertEqual(type(tree.body[0]).__name__, "Expr")
        self.assertNotIn("os", [alias.name for node in tree.body if type(node).__name__ == "Import" for alias in node.names])
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

    def test_image_dataset_exports_its_gate_with_box_output(self):
        from jev import checks
        workbench.save_dataset({"name": "Photos", "rows": [{"_image": "torn-bag"}], "questions": PHOTO_QUESTIONS})
        checks.save_check("photos", {"gates": {"damaged": 0.8}, "model": "jev-1.14.0", "min_accuracy": 0.9})
        out = server.api_wb_gate_export({"dataset": "photos"})
        self.assertIn("Box(", out["python"])
        self.assertIn('dataset "Photos"', out["python"])
        self.assertIn('"type": "box"', out["javascript"])


if __name__ == "__main__":
    unittest.main()
