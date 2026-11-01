"""Perturbations rewrite a row's strings or field order, keep its meaning, and repeat on every run."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import perturb, workbench  # noqa: E402

TEXT = {"text": "My order arrived with the bag torn and beans everywhere. Order A-2210, Harbor Coffee."}
ROW = {"channel": "email", "text": TEXT["text"], "meta": {"lang": "en", "tier": "gold", "tags": ["late", "Refund"]}}


class PerturbTests(unittest.TestCase):
    def test_every_kind_is_seeded_by_row_so_reruns_match(self):
        for kind in perturb.KINDS:
            with self.subTest(kind=kind):
                self.assertEqual(perturb.apply(kind, ROW, 3), perturb.apply(kind, ROW, 3))
                self.assertTrue(perturb.changed(ROW, perturb.apply(kind, ROW, 3)))
        rows = [perturb.apply("typos", TEXT, i)["text"] for i in range(10)]
        self.assertGreater(len(set(rows)), 1)  # another row position, another rewrite

    def test_typos_swap_letters_inside_long_lowercase_words_only(self):
        for i in range(20):
            out = perturb.apply("typos", TEXT, i)["text"]
            self.assertNotEqual(out, TEXT["text"])
            before, after = TEXT["text"].split(" "), out.split(" ")
            self.assertEqual(len(before), len(after))
            for a, b in zip(before, after):
                if a != b:
                    self.assertEqual(sorted(a), sorted(b))  # same letters, two of them swapped
                    self.assertEqual((a[0], a[-1]), (b[0], b[-1]))
                    self.assertGreaterEqual(len(a.strip(".,")), 5)
            self.assertIn("A-2210, Harbor Coffee.", out)  # codes and names stay
        self.assertEqual(perturb.apply("typos", {"text": "ok, see you"}, 0), {"text": "ok, see you"})

    def test_lowercase_changes_values_not_field_names(self):
        out = perturb.apply("lowercase", {"Text": "Refund ME", "n": 3, "flags": [True, "Yes"]}, 0)
        self.assertEqual(out, {"Text": "refund me", "n": 3, "flags": [True, "yes"]})

    def test_distractor_extends_only_the_longest_string(self):
        out = perturb.apply("distractor", ROW, 1)
        self.assertEqual({k: v for k, v in out.items() if k != "text"}, {k: v for k, v in ROW.items() if k != "text"})
        self.assertTrue(out["text"].startswith(ROW["text"] + " "))
        self.assertIn(out["text"][len(ROW["text"]) + 1:], perturb.DISTRACTORS)
        same = perturb.apply("distractor", {"a": "same words", "b": "same words"}, 0)
        self.assertEqual(sum(v != "same words" for v in same.values()), 1)
        self.assertEqual(perturb.apply("distractor", {"n": 1}, 0), {"n": 1})

    def test_shuffle_reorders_every_object_and_keeps_list_order(self):
        for i in range(10):
            out = perturb.apply("shuffle", ROW, i)
            self.assertEqual(out, ROW)  # same fields and values
            self.assertNotEqual(list(out), list(ROW))
            self.assertNotEqual(list(out["meta"]), list(ROW["meta"]))
            self.assertEqual(out["meta"]["tags"], ["late", "Refund"])
        self.assertFalse(perturb.changed(TEXT, perturb.apply("shuffle", TEXT, 0)))  # one field: nothing to reorder

    def test_unknown_kind_is_refused(self):
        with self.assertRaises(ValueError):
            perturb.apply("reverse", ROW, 0)
        good = {"questions": {"u": {"type": "noul", "instructions": "Urgent?"}}}
        with self.assertRaisesRegex(workbench.WorkbenchError, "Variant B: perturb"):
            workbench.validate_variants([good, dict(good, perturb="reverse")])
        self.assertEqual([v["perturb"] for v in workbench.validate_variants([good, dict(good, perturb="typos")])],
                         [None, "typos"])


if __name__ == "__main__":
    unittest.main()
