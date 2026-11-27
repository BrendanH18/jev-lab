"""The Python Lab framework: the pack contract (jev/lab/kit.py), the registry and hooks (jev/lab/__init__.py), the
pack test harness (tests/labkit.py), and the checks that hold for every pack in jev/lab/packs together."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import ROOT, pack_tests  # noqa: E402
from jev import lab  # noqa: E402
from jev.lab import kit  # noqa: E402

TESTS = ROOT / "tests"
PACKS = ROOT / "jev" / "lab" / "packs"
# What a pack must never import: it runs offline and never talks to the model.
FORBIDDEN_IMPORT = re.compile(
    r"^\s*(?:import|from)\s+(?:socket|urllib|http|requests|subprocess|ssl|ftplib|smtplib|asyncio|typesafe\w*)\b"
    r"|^\s*from\s+(?:jev|\.\.\.?)\s*(?:\.\s*)?import\s+[^\n]*\bclient\b|^\s*(?:import|from)\s+(?:jev|\.\.)\.client\b",
    re.M,
)

FIXTURE = kit.define_pack(
    {
        "id": "fixture-pack",
        "surface": "python.lint",
        "title": "Fixture pack",
        "about": "One feature of every kind.",
        "features": [
            {
                "id": "empty_instructions",
                "kind": "lint_rule",
                "title": "Instructions are empty",
                "level": "problem",
                "check": lambda state, questions, refs: [
                    (qid, "Write instructions.") for qid, q in questions.items() if not q.get("instructions")
                ],
            },
            {
                "id": "short_rows",
                "kind": "health_check",
                "title": "Very short text rows",
                "check": lambda rows, questions: (
                    [
                        {
                            "rows": [n for n, row in enumerate(rows, 1) if isinstance(row, str) and len(row) < 3],
                            "message": "Rows shorter than three characters.",
                        }
                    ]
                    if any(isinstance(row, str) and len(row) < 3 for row in rows)
                    else []
                ),
            },
            {
                "id": "empty_state",
                "kind": "preflight_check",
                "title": "Empty request state",
                "check": lambda state, questions, refs: (
                    [(None, "This row sends an empty state.")] if state in ("", {}, []) else []
                ),
            },
        ],
    }
)

QUESTION = {"q": {"type": "noul", "instructions": "Is it urgent?"}}

CASES = {
    "empty_instructions": {
        "hit": ("x", {"q": {"type": "noul", "instructions": ""}}),
        "miss": ("x", QUESTION),
        "question": "q",
        "message": re.compile("Write"),
    },
    "short_rows": {
        "hit": (["ab", "long enough", "c"], QUESTION),
        "miss": (["long enough"], QUESTION),
        "rows": [1, 3],
        "message": re.compile("shorter"),
    },
    "empty_state": {"hit": ("", QUESTION), "miss": ("text", QUESTION, ["photo"]), "question": None},
}


class HarnessTests(pack_tests(FIXTURE, CASES)):
    """The harness on a pack with one feature of every kind: one test per feature."""

    @classmethod
    def setUpClass(cls):
        cls.saved = list(lab.all_packs())
        lab._PACKS = cls.saved + [FIXTURE]

    @classmethod
    def tearDownClass(cls):
        lab._PACKS = cls.saved

    def test_one_method_per_feature(self):
        names = sorted(
            name
            for name in dir(type(self))
            if name.startswith("test_")
            and name
            not in (
                "test_pack_shape",
                "test_one_method_per_feature",
                "test_hooks_collect_pack_findings",
            )
        )
        self.assertEqual(names, ["test_empty_instructions", "test_empty_state", "test_short_rows"])

    def test_hooks_collect_pack_findings(self):
        made = lab.lint_findings(
            "x",
            {"a": {"type": "noul", "instructions": ""}, "b": QUESTION["q"]},
            set(),
            lambda level, code, question, message, anchor="": {
                "level": level,
                "code": code,
                "question": question,
                "message": message,
                "anchor": anchor,
            },
        )
        self.assertIn(
            {
                "level": "problem",
                "code": "fixture-pack/empty_instructions",
                "question": "a",
                "message": "Write instructions.",
                "anchor": "",
            },
            made,
        )
        self.assertIn(
            {
                "code": "fixture-pack/short_rows",
                "title": "Very short text rows",
                "rows": [1],
                "message": "Rows shorter than three characters.",
            },
            lab.health_findings(["a", "long enough"], QUESTION),
        )
        self.assertIn(
            {
                "row": 4,
                "question": None,
                "code": "fixture-pack/empty_state",
                "message": "This row sends an empty state.",
            },
            lab.preflight_findings({}, QUESTION, set(), 4),
        )
        self.assertEqual(
            [
                item
                for item in lab.preflight_findings("text", QUESTION, set(), 1)
                if item["code"].startswith("fixture-pack/")
            ],
            [],
        )


class KitTests(unittest.TestCase):
    def test_define_pack_rejects_malformed_packs(self):
        def pack(**feature):
            base = {"id": "f", "kind": "health_check", "title": "T", "check": len}
            base.update(feature)
            return {"id": "p", "surface": "python.lint", "title": "T", "features": [base]}

        self.assertTrue(kit.define_pack(pack())["_defined"])
        for bad, message in [
            ("nope", "expected a dict"),
            (dict(pack(), id="Bad_Id"), "lowercase words joined by hyphens"),
            (dict(pack(), surface="lint"), "starts with python."),
            (dict(pack(), title=" "), "title is required"),
            (dict(pack(), about=""), "about must be text"),
            (dict(pack(), features=[]), "nonempty list"),
            (pack(id="Bad-Id"), "joined by underscores"),
            (pack(kind="widget"), "unknown kind"),
            (pack(kind="cli"), "unknown kind"),
            (pack(title=""), "title is required"),
            (pack(check=None), "check must be a function"),
            (pack(kind="lint_rule", level="problem", check="x"), "check must be a function"),
            (pack(kind="lint_rule", level="info", check=len), "level must be one of"),
            (pack(kind="lint_rule", level="advice", check=len, anchor="x"), "anchor must start with #"),
        ]:
            with self.assertRaisesRegex(kit.PackError, re.escape(message)):
                kit.define_pack(bad)
        twice = pack()
        twice["features"].append(dict(twice["features"][0]))
        with self.assertRaisesRegex(kit.PackError, "feature f: declared twice"):
            kit.define_pack(twice)


class RegistryTests(unittest.TestCase):
    """Rules every pack in jev/lab/packs follows."""

    def test_every_pack_is_defined_named_after_its_module_and_tested(self):
        modules = sorted(path.stem for path in PACKS.glob("*.py") if path.stem != "__init__")
        self.assertEqual([pack["id"] for pack in lab.all_packs()], sorted(name.replace("_", "-") for name in modules))
        for name in modules:
            test = TESTS / ("test_lab_%s.py" % name)
            self.assertTrue(test.exists(), "tests/test_lab_%s.py is missing" % name)
            source = test.read_text()
            self.assertTrue(
                "pack_tests(" in source and ("packs import %s" % name in source or "packs.%s" % name in source),
                "tests/test_lab_%s.py must run pack_tests on the pack" % name,
            )

    def test_finding_codes_are_unique_and_titles_descriptive(self):
        found = [(pack, feature) for pack in lab.all_packs() for feature in pack["features"]]
        codes = [lab.code(pack, feature) for pack, feature in found]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertTrue(all(len(feature["title"].strip()) >= 8 for _pack, feature in found))

    def test_packs_stay_offline(self):
        for path in sorted(PACKS.glob("*.py")):
            hit = FORBIDDEN_IMPORT.search(path.read_text())
            self.assertIsNone(
                hit,
                "%s imports %s: packs never reach the network or the model"
                % (path.name, hit.group(0).strip() if hit else ""),
            )


if __name__ == "__main__":
    unittest.main()
