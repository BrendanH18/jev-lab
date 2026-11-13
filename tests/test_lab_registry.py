"""The Python Lab framework: the pack contract (jev/lab/kit.py), the registry and hooks (jev/lab/__init__.py), the
offline CLI dispatcher (scripts/lab.py), the pack test harness (tests/labkit.py), and the checks that hold for
every pack in jev/lab/packs together."""

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import ROOT, pack_tests, run_cli  # noqa: E402
from jev import lab  # noqa: E402
from jev.lab import kit  # noqa: E402

TESTS = ROOT / "tests"
PACKS = ROOT / "jev" / "lab" / "packs"
# What a pack must never import: it runs offline and never talks to the model.
FORBIDDEN_IMPORT = re.compile(
    r"^\s*(?:import|from)\s+(?:socket|urllib|http|requests|subprocess|ssl|ftplib|smtplib|asyncio|typesafe\w*)\b"
    r"|^\s*from\s+(?:jev|\.\.\.?)\s*(?:\.\s*)?import\s+[^\n]*\bclient\b|^\s*(?:import|from)\s+(?:jev|\.\.)\.client\b", re.M)


def _many(args) -> int:
    kit.emit(args, ["name", "rows"], [["alpha", 3], ["beta", 12]][: args.limit])
    return 1 if args.fail else 0


FIXTURE = kit.define_pack({
    "id": "fixture-pack", "surface": "python.cli", "title": "Fixture pack", "about": "One feature of every kind.",
    "features": [
        {"id": "empty_instructions", "kind": "lint_rule", "title": "Instructions are empty", "level": "problem",
         "check": lambda state, questions, refs: [(qid, "Write instructions.") for qid, q in questions.items() if not q.get("instructions")]},
        {"id": "short_rows", "kind": "health_check", "title": "Very short text rows",
         "check": lambda rows, questions: ([{"rows": [n for n, row in enumerate(rows, 1) if isinstance(row, str) and len(row) < 3],
                                             "message": "Rows shorter than three characters."}]
                                           if any(isinstance(row, str) and len(row) < 3 for row in rows) else [])},
        {"id": "empty_state", "kind": "preflight_check", "title": "Empty request state",
         "check": lambda state, questions, refs: [(None, "This row sends an empty state.")] if state in ("", {}, []) else []},
        {"id": "list_names", "kind": "cli", "title": "List fixture names", "command": ["fixture", "names"],
         "configure": lambda parser: (kit.add_format(parser), parser.add_argument("--limit", type=int, default=2),
                                      parser.add_argument("--fail", action="store_true")),
         "run": _many, "options": [{"id": "limit", "title": "--limit N keeps the first N names"},
                                   {"id": "fail", "title": "--fail exits 1"}]},
        {"id": "echo", "kind": "route", "title": "Echo a number", "path": "/api/lab/fixture-pack/echo",
         "handler": lambda body: {"double": 2 * float(body["x"])}},
        {"id": "pipes", "kind": "format", "title": "pipe-separated text", "name": "pipes",
         "parse": lambda text: [{"text": part} for part in text.split("|") if part],
         "render": lambda rows: "|".join(row["text"] for row in rows)},
        {"id": "only_reads", "kind": "format", "title": "one row per line", "name": "lines",
         "parse": lambda text: [{"text": line} for line in text.splitlines() if line]},
        {"id": "quiet", "kind": "behavior", "title": "A behavior in existing code", "where": "jev/lint.py"},
    ],
})

QUESTION = {"q": {"type": "noul", "instructions": "Is it urgent?"}}

CASES = {
    "empty_instructions": {"hit": ("x", {"q": {"type": "noul", "instructions": ""}}), "miss": ("x", QUESTION), "question": "q", "message": re.compile("Write")},
    "short_rows": {"hit": (["ab", "long enough", "c"], QUESTION), "miss": (["long enough"], QUESTION), "rows": [1, 3], "message": re.compile("shorter")},
    "empty_state": {"hit": ("", QUESTION), "miss": ("text", QUESTION, ["photo"]), "question": None},
    "list_names": {"argv": ["fixture", "names"], "stdout": "name   rows\n-----  ----\nalpha     3\nbeta     12\n",
                   "options": {"limit": {"argv": ["fixture", "names", "--limit", "1", "--format", "csv"], "stdout": '"name","rows"\n"alpha","3"\n'.replace("\n", "\r\n", 1)},
                               "fail": {"argv": ["fixture", "names", "--fail", "--format", "json"], "code": 1,
                                        "stdout": lambda text: json.loads(text) == [{"name": "alpha", "rows": 3}, {"name": "beta", "rows": 12}] or (_ for _ in ()).throw(AssertionError(text))}}},
    "echo": {"body": {"x": "2.5"}, "expect": {"double": 5.0}, "bad": [{}, {"x": "many"}]},
    "pipes": {"parse": {"text": "a|b||c", "rows": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}, "render": {"rows": [{"text": "a"}, {"text": "b"}], "text": "a|b"}},
    "only_reads": {"parse": {"text": "a\n\nb", "rows": [{"text": "a"}, {"text": "b"}]}},
    "quiet": {"check": lambda test: test.assertTrue((ROOT / "jev" / "lint.py").exists())},
}


class HarnessTests(pack_tests(FIXTURE, CASES)):
    """The harness on a pack with one feature of every kind: one test per improvement."""

    @classmethod
    def setUpClass(cls):
        cls.saved = list(lab.all_packs())
        lab._PACKS = cls.saved + [FIXTURE]

    @classmethod
    def tearDownClass(cls):
        lab._PACKS = cls.saved

    def test_one_method_per_improvement(self):
        names = sorted(name for name in dir(type(self)) if name.startswith("test_") and name not in ("test_pack_shape", "test_one_method_per_improvement",
                                                                                                    "test_hooks_collect_pack_findings", "test_routes_are_post_under_api_lab"))
        self.assertEqual(names, ["test_echo", "test_empty_instructions", "test_empty_state", "test_list_names", "test_list_names__fail", "test_list_names__limit",
                                 "test_only_reads__parse", "test_pipes__parse", "test_pipes__render", "test_quiet", "test_short_rows"])
        self.assertEqual(len(names), len(kit.improvements_of(FIXTURE)))

    def test_hooks_collect_pack_findings(self):
        made = lab.lint_findings("x", {"a": {"type": "noul", "instructions": ""}, "b": QUESTION["q"]}, set(),
                                 lambda level, code, question, message, anchor="": {"level": level, "code": code, "question": question, "message": message, "anchor": anchor})
        self.assertIn({"level": "problem", "code": "fixture-pack/empty_instructions", "question": "a", "message": "Write instructions.", "anchor": ""}, made)
        self.assertIn({"code": "fixture-pack/short_rows", "title": "Very short text rows", "rows": [1], "message": "Rows shorter than three characters."},
                      lab.health_findings(["a", "long enough"], QUESTION))
        self.assertIn({"row": 4, "question": None, "code": "fixture-pack/empty_state", "message": "This row sends an empty state."},
                      lab.preflight_findings({}, QUESTION, set(), 4))
        self.assertEqual([item for item in lab.preflight_findings("text", QUESTION, set(), 1) if item["code"].startswith("fixture-pack/")], [])

    def test_routes_are_post_under_api_lab(self):
        routes = lab.routes()
        self.assertEqual(routes[("POST", "/api/lab/fixture-pack/echo")]({"x": 4}), {"double": 8.0})
        self.assertTrue(all(method == "POST" and path.startswith("/api/lab/") for method, path in routes))


class KitTests(unittest.TestCase):
    def test_improvements_by_kind(self):
        items = kit.improvements_of(FIXTURE)
        self.assertEqual([item["id"] for item in items], [
            "fixture-pack/empty_instructions", "fixture-pack/short_rows", "fixture-pack/empty_state", "fixture-pack/list_names",
            "fixture-pack/list_names.limit", "fixture-pack/list_names.fail", "fixture-pack/echo", "fixture-pack/pipes.parse", "fixture-pack/pipes.render",
            "fixture-pack/only_reads.parse", "fixture-pack/quiet"])
        self.assertEqual([item["title"] for item in items][:7], [
            "Question check (problem): Instructions are empty", "Dataset health: Very short text rows", "Bulk preflight: Empty request state",
            "`lab.py fixture names`: List fixture names", "`lab.py fixture names`: --limit N keeps the first N names", "`lab.py fixture names`: --fail exits 1",
            "Local API `POST /api/lab/fixture-pack/echo`: Echo a number"])
        self.assertTrue(all(item["pack"] == "fixture-pack" and item["surface"] == "python.cli" and item["pack_title"] == "Fixture pack" for item in items))

    def test_define_pack_rejects_malformed_packs(self):
        def pack(**feature):
            base = {"id": "f", "kind": "behavior", "title": "T", "where": "x.py"}
            base.update(feature)
            return {"id": "p", "surface": "python.lint", "title": "T", "features": [base]}

        self.assertTrue(kit.define_pack(pack())["_defined"])
        for bad, message in [
            ("nope", "expected a dict"), (dict(pack(), id="Bad_Id"), "lowercase words joined by hyphens"), (dict(pack(), surface="lint"), "starts with python."),
            (dict(pack(), title=" "), "title is required"), (dict(pack(), about=""), "about must be text"), (dict(pack(), features=[]), "nonempty list"),
            (pack(id="Bad-Id"), "joined by underscores"), (pack(kind="widget"), "unknown kind"), (pack(title=""), "title is required"),
            (pack(kind="lint_rule", level="problem"), "check must be a function"), (pack(kind="lint_rule", level="info", check=len), "level must be one of"),
            (pack(kind="lint_rule", level="advice", check=len, anchor="x"), "anchor must start with #"),
            (pack(kind="cli", command=["Bad Word"], run=len), "one or two lowercase words"), (pack(kind="cli", command=["a", "b", "c"], run=len), "one or two"),
            (pack(kind="cli", command=["a"]), "run must be a function"), (pack(kind="cli", command=["a"], run=len, options=[{"id": "x"}]), "options must be"),
            (pack(kind="cli", command=["a"], run=len, options=[{"id": "x", "title": "X"}, {"id": "x", "title": "Y"}]), "options must be"),
            (pack(kind="route", path="/api/other/x", handler=len), "must start with /api/lab/"), (pack(kind="route", path="/api/lab/p/x"), "handler must be"),
            (pack(kind="format", name="x"), "parse, render or both"), (pack(kind="format", parse=len), "name is required"), (pack(where=""), "where is required"),
        ]:
            with self.assertRaisesRegex(kit.PackError, re.escape(message)):
                kit.define_pack(bad)
        twice = pack()
        twice["features"].append(dict(twice["features"][0]))
        with self.assertRaisesRegex(kit.PackError, "feature f: declared twice"):
            kit.define_pack(twice)

    def test_render_formats_and_formula_escaping(self):
        columns, rows = ["name", "share", "note"], [["a", 0.5, None], ["=cmd|x", 12, "line\nbreak"], ["c", 1 / 3, True]]
        self.assertEqual(kit.render(columns, rows, "table").splitlines(), [
            "name       share  note", "------  --------  ----------", "a            0.5", "=cmd|x        12  line break", "c       0.333333  yes"])
        self.assertEqual(json.loads(kit.render(columns, rows, "json"))[1], {"name": "=cmd|x", "share": 12, "note": "line\nbreak"})
        self.assertEqual(kit.render(columns, rows[:2], "csv"), '"name","share","note"\r\n"a","0.5",""\r\n"\'=cmd|x","12","line\nbreak"')
        self.assertEqual(kit.render(columns, rows, "markdown").splitlines()[2:], ["| a | 0.5 |  |", "| =cmd\\|x | 12 | line<br>break |", "| c | 0.333333 | yes |"])
        self.assertEqual([kit.csv_cell(text) for text in ["=1", "+1", "-1", "@a", " =1", "\tx", "plain", None, 5]], ["'=1", "'+1", "'-1", "'@a", "' =1", "'\tx", "plain", "", "5"])
        with self.assertRaisesRegex(kit.CliError, "--format must be one of"):
            kit.render(columns, rows, "yaml")
        self.assertEqual(kit.text_table(["n"], [[1], [22]]), " n\n--\n 1\n22")


class CliTests(unittest.TestCase):
    def test_inventory_lists_python_improvements(self):
        code, out, _ = run_cli(["inventory", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), lab.improvements())
        code, out, _ = run_cli(["inventory"])
        self.assertEqual(code, 0)
        self.assertIn("%d improvements in %d Python packs" % (len(lab.improvements()), len(lab.all_packs())), out)

    def test_usage_errors_exit_two_and_help_exits_zero(self):
        self.assertEqual(run_cli([])[0], 2)
        self.assertEqual(run_cli(["no-such-command"])[0], 2)
        code, out, _ = run_cli(["--help"])
        self.assertEqual(code, 0)
        self.assertIn("no API key, no network, no model call", out)
        sys.path.insert(0, str(ROOT / "scripts"))
        import lab as lab_cli
        import io
        from contextlib import redirect_stderr
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(lab_cli.main(["--data-dir", str(ROOT / "no" / "such" / "dir"), "inventory"]), 2)
        self.assertIn("is not a directory", err.getvalue())


class RegistryTests(unittest.TestCase):
    """Rules every pack in jev/lab/packs follows."""

    def test_every_pack_is_defined_named_after_its_module_and_tested(self):
        modules = sorted(path.stem for path in PACKS.glob("*.py") if path.stem != "__init__")
        self.assertEqual([pack["id"] for pack in lab.all_packs()], sorted(name.replace("_", "-") for name in modules))
        for name in modules:
            test = TESTS / ("test_lab_%s.py" % name)
            self.assertTrue(test.exists(), "tests/test_lab_%s.py is missing" % name)
            source = test.read_text()
            self.assertTrue("pack_tests(" in source and ("packs import %s" % name in source or "packs.%s" % name in source),
                            "tests/test_lab_%s.py must run pack_tests on the pack" % name)

    def test_improvement_ids_commands_and_routes_are_unique(self):
        ids = [item["id"] for item in lab.improvements()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(len(item["title"].strip()) >= 8 for item in lab.improvements()))
        sys.path.insert(0, str(ROOT / "scripts"))
        import lab as lab_cli
        lab_cli.build_parser()  # raises PackError when two packs claim one command
        for pack, feature in lab.features("route"):
            self.assertTrue(feature["path"].startswith("/api/lab/%s/" % pack["id"]), "%s must live under /api/lab/%s/" % (feature["path"], pack["id"]))
        lab.routes()  # raises PackError on a duplicate path

    def test_packs_stay_offline(self):
        for path in sorted(PACKS.glob("*.py")):
            hit = FORBIDDEN_IMPORT.search(path.read_text())
            self.assertIsNone(hit, "%s imports %s: packs never reach the network or the model" % (path.name, hit.group(0).strip() if hit else ""))


if __name__ == "__main__":
    unittest.main()
