"""Test harness for Python Lab packs (jev/lab/packs). Not a test module itself.

    from jev.lab.packs import lint_wording
    from labkit import pack_tests

    class LintWordingTests(pack_tests(lint_wording.PACK, {"<feature id>": <case>, ...})):
        pass

pack_tests builds a unittest.TestCase with ONE test method per numbered improvement (test_<feature>, plus
test_<feature>__<option> for a cli option and test_<feature>__parse / __render for a format) and fails when a
feature has no case. A case states what THIS feature must produce for concrete inputs, written by hand. Shapes:

  lint_rule        {"hit": (state, questions[, refs]), "miss": (state, questions[, refs]), "question": id or None,
                    "message": regex}   ("question" and "message" are optional). The rule must also stay quiet on
                   every built-in example (jev/examples.py); "examples_ok": [ids] lists examples it may report on.
  health_check     {"hit": (rows, questions), "miss": (rows, questions), "rows": [expected row numbers], "message": regex}
  preflight_check  {"hit": (state, questions[, refs]), "miss": (...), "question": id or None, "message": regex}
  cli              {"argv": [...], "code": 0, "stdout": text | regex | callable(text), "setup": setup(directory),
                    "options": {"<option id>": {"argv", "code", "stdout", "setup"}}}
                   The command runs through scripts/lab.py's main() with --data-dir set to an empty temporary
                   directory that setup(directory: Path) may fill.
  route            {"body": {...}, "expect": dict | callable(result), "bad": [bodies that must raise]}
  format           {"parse": {"text": ..., "rows": [...]}, "render": {"rows": [...], "text": ...}}  (each direction it has)
  behavior         {"check": callable}
"""

from __future__ import annotations

import io
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any, Callable, Dict

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import lab as lab_cli  # noqa: E402  (scripts/lab.py)
from jev import examples, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402


def run_cli(argv, setup: Callable[[Path], Any] = None):
    """Run scripts/lab.py with an isolated data directory. Returns (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with tempfile.TemporaryDirectory() as directory:
        if setup:
            previous = workbench.WORKBENCH_DIR
            workbench.WORKBENCH_DIR = Path(directory)
            try:
                setup(Path(directory))
            finally:
                workbench.WORKBENCH_DIR = previous
        with redirect_stdout(out), redirect_stderr(err):
            code = lab_cli.main(["--data-dir", directory] + [str(word) for word in argv])
    return code, out.getvalue(), err.getvalue()


def _triple(value):
    state, questions = value[0], value[1]
    return state, questions, (set(value[2]) if len(value) > 2 else set())


def _matches(test: unittest.TestCase, expected: Any, actual: str, label: str) -> None:
    if expected is None:
        return
    if callable(expected):
        expected(actual)
    elif hasattr(expected, "search"):
        test.assertRegex(actual, expected, label)
    else:
        test.assertEqual(actual, expected, label)


def _pairs_case(feature: dict, case: dict, example_guard: bool):
    def run(self: unittest.TestCase) -> None:
        check = feature["check"]
        hits = list(check(*_triple(case["hit"])))
        self.assertTrue(hits, "%s should report on its hit case" % feature["id"])
        for question, message in hits:
            self.assertTrue(isinstance(message, str) and message.strip(), "a finding needs a message")
            if "question" in case:
                self.assertEqual(question, case["question"])
            if case.get("message") is not None:
                self.assertRegex(message, case["message"])
        self.assertEqual(list(check(*_triple(case["miss"]))), [], "%s should stay quiet on its miss case" % feature["id"])
        if example_guard:
            for example in examples.EXAMPLES:
                if example["id"] in case.get("examples_ok", []):
                    continue
                refs = set((example.get("images") or {}).keys()) if isinstance(example.get("images"), dict) else set()
                found = list(check(example["state"], example["questions"], refs))
                self.assertEqual(found, [], "%s reports on the built-in example %s: %s" % (feature["id"], example["id"], found))
    return run


def _secrets(rows) -> list:
    """Text a health finding must never quote: label values and inputs of the rows it was given (4+ characters)."""
    out = []
    for row in rows:
        values = [row] if isinstance(row, str) else list(row.values()) if isinstance(row, dict) else []
        labels = row.get("_expect") if isinstance(row, dict) else None
        values += list(labels.values()) if isinstance(labels, dict) else []
        out += [value for value in values if isinstance(value, str) and len(value.strip()) >= 4]
    return out


def _health_case(feature: dict, case: dict):
    def run(self: unittest.TestCase) -> None:
        hits = list(feature["check"](*case["hit"]))
        self.assertTrue(hits, "%s should report on its hit case" % feature["id"])
        for item in hits:
            self.assertTrue(item.get("rows") and all(isinstance(n, int) and n >= 1 for n in item["rows"]), "a finding names 1-based rows")
            self.assertTrue(str(item.get("message") or "").strip(), "a finding needs a message")
            if case.get("message") is not None:
                self.assertRegex(item["message"], case["message"])
            for secret in _secrets(case["hit"][0]):
                self.assertNotIn(secret, item["message"], "a health finding never quotes an input or a label value")
        if "rows" in case:
            self.assertEqual(sorted({n for item in hits for n in item["rows"]}), sorted(case["rows"]))
        self.assertEqual(list(feature["check"](*case["miss"])), [], "%s should stay quiet on its miss case" % feature["id"])
    return run


def _cli_case(case: dict):
    def run(self: unittest.TestCase) -> None:
        self.assertIn("argv", case, "a cli case needs argv")
        code, out, err = run_cli(case["argv"], case.get("setup"))
        self.assertEqual(code, case.get("code", 0), "exit code; stdout: %s stderr: %s" % (out[-400:], err[-400:]))
        self.assertTrue("stdout" in case or "stderr" in case, "a cli case states the output it expects")
        _matches(self, case.get("stdout"), out, "stdout")
        _matches(self, case.get("stderr"), err, "stderr")
    return run


def _route_case(feature: dict, case: dict):
    def run(self: unittest.TestCase) -> None:
        result = feature["handler"](dict(case["body"]))
        self.assertIsInstance(result, dict, "a route returns a JSON object")
        if callable(case["expect"]):
            case["expect"](result)
        else:
            self.assertEqual(result, case["expect"])
        for body in case.get("bad", []):
            with self.assertRaises((ValueError, KeyError, TypeError), msg="should reject %r" % (body,)):
                feature["handler"](dict(body))
    return run


def _format_case(feature: dict, case: dict, direction: str):
    def run(self: unittest.TestCase) -> None:
        self.assertIn(direction, case, "a format case needs %r" % direction)
        if direction == "parse":
            self.assertEqual(feature["parse"](case["parse"]["text"]), case["parse"]["rows"])
        else:
            self.assertEqual(feature["render"](case["render"]["rows"]), case["render"]["text"])
    return run


def pack_tests(pack: dict, cases: Dict[str, dict]) -> type:
    """A TestCase class with one test per improvement of `pack`, named test_<feature>[__<part>]."""
    methods: Dict[str, Callable] = {}
    features = {feature["id"]: feature for feature in pack["features"]}

    def shape(self: unittest.TestCase) -> None:
        self.assertTrue(pack.get("_defined"), "PACK must come from kit.define_pack")
        for ident in features:
            self.assertIn(ident, cases, "feature %s has no test case" % ident)
        for ident in cases:
            self.assertIn(ident, features, "case %s matches no feature" % ident)
        for feature in pack["features"]:
            for option in feature.get("options", []) if feature["kind"] == "cli" else []:
                self.assertIn(option["id"], cases.get(feature["id"], {}).get("options", {}), "cli option %s has no test case" % option["id"])

    methods["test_pack_shape"] = shape
    for ident, feature in features.items():
        case = cases.get(ident)
        if case is None:
            continue
        kind = feature["kind"]
        if kind == "lint_rule":
            methods["test_%s" % ident] = _pairs_case(feature, case, True)
        elif kind == "preflight_check":
            methods["test_%s" % ident] = _pairs_case(feature, case, False)
        elif kind == "health_check":
            methods["test_%s" % ident] = _health_case(feature, case)
        elif kind == "cli":
            methods["test_%s" % ident] = _cli_case(case)
            for option in feature.get("options", []):
                if option["id"] in case.get("options", {}):
                    methods["test_%s__%s" % (ident, option["id"])] = _cli_case(case["options"][option["id"]])
        elif kind == "route":
            methods["test_%s" % ident] = _route_case(feature, case)
        elif kind == "format":
            for direction in ("parse", "render"):
                if callable(feature.get(direction)):
                    methods["test_%s__%s" % (ident, direction)] = _format_case(feature, case, direction)
        else:
            def behavior(self: unittest.TestCase, case: dict = case) -> None:
                self.assertTrue(callable(case.get("check")), "a behavior case needs check")
                case["check"](self)
            methods["test_%s" % ident] = behavior
    expected = len(kit.improvements_of(pack)) + 1
    assert len(methods) == expected or any(features[i]["id"] not in cases for i in features), "one test per improvement"
    return type("%sTests" % re.sub(r"(?:^|-)(\w)", lambda m: m.group(1).upper(), pack["id"]), (unittest.TestCase,), methods)
