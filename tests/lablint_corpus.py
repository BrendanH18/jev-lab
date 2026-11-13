"""Built-in requests for the Lab lint packs' tests (tests/test_lab_lint_*.py). Not a test module itself.

Every built-in request tests/test_lint.py's BuiltInRequestTests checks: each demo's request (sent through the real
server handlers with the network stubbed, the same way), every Examples gallery request, and the Bulk sample rows
with both Bulk question sets. Lab lint rules must stay quiet on all of them. The terse Bulk question set is the one
exception a pack may name: it is the deliberately terse Compare variant, with one-word options and label-like
instructions, so the rules written to catch exactly that may report on it.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Iterable, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_lint  # noqa: E402
from jev import examples, workbench  # noqa: E402

TERSE = "terse bulk sample"


def built_in_requests(test: unittest.TestCase) -> List[Tuple[str, object, dict, set]]:
    """(name, state, validated questions, picture references) for every built-in request. `test` is the running
    TestCase: the network stubs are its cleanups."""
    test_lint.BuiltInRequestTests.setUp(test)
    out = [(name, request["state"], request["questions"], set(request.get("assets") or {}))
           for name, request in test_lint.BuiltInRequestTests.demo_requests(test)]
    out += [("example " + e["id"], e["state"], e["questions"], set(e.get("images") or {})) for e in examples.EXAMPLES]
    for row in workbench.load_sample_rows():
        state = workbench.split_labels(row, 0)[0]
        out += [("bulk sample", state, examples.BULK_QUESTIONS, set()), (TERSE, state, examples.TERSE_BULK_QUESTIONS, set())]
    return [(name, state, workbench.validate_questions(questions), refs) for name, state, questions, refs in out]


def assert_quiet(test: unittest.TestCase, pack: dict, terse_ok: Iterable[str] = ()) -> None:
    """Every rule of `pack` reports nothing on every built-in request; on the terse Bulk set only `terse_ok` may."""
    requests = built_in_requests(test)
    test.assertGreater(len(requests), 100)
    allowed = set(terse_ok)
    fired_on_terse = set()
    for name, state, questions, refs in requests:
        for feature in pack["features"]:
            found = list(feature["check"](state, questions, refs))
            if name == TERSE and feature["id"] in allowed:
                fired_on_terse.update([feature["id"]] if found else [])
                continue
            test.assertEqual(found, [], "%s reports on the built-in request %s" % (feature["id"], name))
    test.assertEqual(fired_on_terse, allowed, "the terse exceptions should be exactly the rules that fire on it")
