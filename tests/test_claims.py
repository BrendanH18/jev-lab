"""Offline tests for image handling and the Claims policy. No API key needed."""

import base64
import struct
import sys
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient, fake_answers  # noqa: E402

from jev import claims, images  # noqa: E402
from jev.world import World  # noqa: E402


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(width, height, extra=b""):
    """A PNG; `extra` holds chunks placed between IHDR and IDAT."""
    raw = b"".join(b"\x00" + b"\x80\x80\x80" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + extra + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def jpeg_header(width, height):
    """Just enough of a baseline JPEG for the size reader: SOI, an APP0 segment, and SOF0."""
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof0 + b"\xff\xd9"


class ImageTests(unittest.TestCase):
    def test_reads_png_and_jpeg_sizes(self):
        self.assertEqual(images.dimensions(png(300, 400)), ("png", 300, 400))
        self.assertEqual(images.dimensions(jpeg_header(1568, 1176)), ("jpg", 1568, 1176))

    def test_enforces_documented_limits(self):
        images.check(png(280, 280))
        with self.assertRaises(images.ImageError):
            images.check(png(279, 600))
        with self.assertRaises(images.ImageError):
            images.check(jpeg_header(1569, 800))
        with self.assertRaises(images.ImageError):
            images.check(b"GIF89a....")

    def test_samples_are_valid_and_parse_from_uploads(self):
        for name in images.SAMPLES:
            entry = images.sample_asset(name)
            self.assertEqual(entry["format"], "png")
            self.assertGreaterEqual(min(entry["width"], entry["height"]), images.MIN_SIDE)
        upload = images.parse_upload({"data_base64": "data:image/png;base64," + base64.b64encode(png(300, 300)).decode()})
        self.assertEqual((upload["width"], upload["height"]), (300, 300))
        with self.assertRaises(images.ImageError):
            images.parse_upload({"sample": "../../.env"})
        with self.assertRaises(images.ImageError):
            images.parse_upload({"data_base64": "not base64!"})

    def test_animated_png_is_found_by_chunk_not_by_bytes(self):
        text_mentioning_actl = chunk(b"tEXt", b"Comment\x00made with acTL-free tools")
        self.assertEqual(images.dimensions(png(300, 300, text_mentioning_actl))[0], "png")
        big_profile = chunk(b"iCCP", b"profile\x00\x00" + b"\x00" * 6000)  # pushes acTL past byte 4096
        animated = png(300, 300, big_profile + chunk(b"acTL", struct.pack(">II", 2, 0)))
        with self.assertRaises(images.ImageError):
            images.dimensions(animated)

    def test_parse_images_checks_references_and_count(self):
        ok = images.parse_images({"photo-abcdef": {"sample": "torn-bag"}})
        self.assertIn("photo-abcdef", ok)
        with self.assertRaises(images.ImageError):
            images.parse_images({"x": {"sample": "torn-bag"}})
        with self.assertRaises(images.ImageError):
            images.parse_images({"photo-abcdef\n": {"sample": "torn-bag"}})
        with self.assertRaises(images.ImageError):
            images.parse_images({"img-%06d" % i: {"sample": "torn-bag"} for i in range(images.MAX_IMAGES + 1)})

    def test_reference_counting(self):
        state = {"photo": "photo-aaa111", "note": "compare with photo-bbb222"}
        questions = {"q": {"type": "noul", "instructions": "Same as photo-aaa111?"}}
        self.assertEqual(images.count_uses(["photo-aaa111", "photo-bbb222"], state, questions), 3)
        self.assertEqual(images.unreferenced(["photo-aaa111", "photo-ccc333"], state, questions), ["photo-ccc333"])
        # A reference that is a prefix of another is neither counted inside it nor taken as used by it.
        nested = {"a": "photo-1234567", "b": "photo-1234567"}
        self.assertEqual(images.count_uses(["photo-123456", "photo-1234567"], nested), 2)
        self.assertEqual(images.unreferenced(["photo-123456", "photo-1234567"], nested), ["photo-123456"])
        self.assertTrue(images.needs_images_header({"b": {"type": "box"}}, None))
        self.assertFalse(images.needs_images_header({"n": {"type": "noul"}}, {}))


GOOD = {"shows_item": 0.95, "damage_visible": 0.92, "matches_note": 0.9, "severity": 2.6,
        "damage_kind": "torn_or_open"}


class ClaimsTests(unittest.TestCase):
    def setUp(self):
        self.world = World()
        self.image = images.sample_asset("torn-bag")

    def run_claim(self, picks, order="A-1041", model="jev-fake"):
        client = FakeClient(lambda state, qs: picks)
        client.model = model
        return claims.check(client, self.world, order, "The bag was torn open.", self.image), client

    def test_clear_damage_on_a_small_order_is_approved(self):
        out, client = self.run_claim(GOOD)
        self.assertEqual(out["verdict"]["decision"], "approve")
        self.assertEqual(out["verdict"]["remedy"], "full_refund")
        self.assertEqual(out["verdict"]["amount"], 38.0)
        self.assertTrue(out["location"]["shown"])
        state = client.calls[0][0]
        self.assertIn(state["photo"], client.assets, "the photo reference is the asset key")
        self.assertEqual(state["order"]["items"], self.world.state["orders"]["A-1041"]["items"])

    def test_no_visible_damage_asks_for_another_photo_and_hides_the_box(self):
        out, _ = self.run_claim(dict(GOOD, damage_visible=0.05, matches_note=0.1, severity=0.1))
        self.assertEqual(out["verdict"]["decision"], "retake")
        self.assertFalse(out["location"]["shown"])

    def test_dollar_limit_and_window_send_claims_to_a_person(self):
        big, _ = self.run_claim(GOOD, order="A-1042")  # $249 grinder
        self.assertEqual(big["verdict"]["decision"], "review")
        old, _ = self.run_claim(GOOD, order="A-1044")  # delivered 41 days ago
        self.assertEqual(old["verdict"]["decision"], "review")
        transit, _ = self.run_claim(GOOD, order="A-1043")
        self.assertEqual(transit["verdict"]["decision"], "reject")

    def test_policy_changes_reuse_the_answers(self):
        out, client = self.run_claim(GOOD, order="A-1042")
        again = claims.redecide(out["answers"], out["facts"], {"auto_limit_usd": 300})
        self.assertEqual(again["verdict"]["decision"], "approve")
        self.assertEqual(len(client.calls), 1)

    def test_minor_damage_offers_partial_credit(self):
        out, _ = self.run_claim(dict(GOOD, severity=1.0))
        self.assertEqual(out["verdict"]["remedy"], "replacement_or_credit")
        self.assertEqual(out["verdict"]["amount"], 19.0)

    def test_uncertain_damage_shows_a_tentative_box_for_the_reviewer(self):
        out, _ = self.run_claim(dict(GOOD, damage_visible=0.5))
        self.assertEqual(out["verdict"]["decision"], "review")
        self.assertTrue(out["location"]["shown"])
        self.assertTrue(out["location"]["tentative"])
        self.assertIn("Tentative", out["location"]["reason"])
        clear, _ = self.run_claim(GOOD)
        self.assertFalse(clear["location"]["tentative"])
        self.assertIsNone(clear["location"]["reason"])

    def test_low_box_confidence_pads_the_box(self):
        edges = {"left": 0.02, "top": 0.3, "right": 0.5, "bottom": 0.98, "confidence": 0.3}
        out, _ = self.run_claim(dict(GOOD, damage_box=edges))
        loc = out["location"]
        self.assertTrue(loc["padded"])
        self.assertEqual(loc["box"]["left"], 0.0)
        self.assertEqual(loc["box"]["bottom"], 1.0)
        self.assertAlmostEqual(loc["box"]["top"], 0.25)

    def test_older_models_and_the_default_alias_skip_the_box_question(self):
        for model in ("jev-1.13.0", "jev-latest"):
            out, client = self.run_claim(GOOD, model=model)
            self.assertNotIn("damage_box", client.calls[0][1], model)
            self.assertFalse(out["box_supported"], model)
            self.assertFalse(out["location"]["shown"], model)
            self.assertEqual(out["verdict"]["decision"], "approve", model)
        out, client = self.run_claim(GOOD, model="jev-preview")
        self.assertIn("damage_box", client.calls[0][1])
        self.assertTrue(out["box_supported"])

    def test_examples_reach_their_intended_decisions_with_clear_answers(self):
        damaged = {"torn-bag": True, "crushed-box": True, "intact-bag": False, "grinder-ok": False}
        intact = dict(GOOD, damage_visible=0.03, matches_note=0.05, severity=0.0, damage_kind="none_visible")
        for ex in claims.EXAMPLES:
            picks = GOOD if damaged[ex["sample"]] else intact
            out = claims.check(FakeClient(lambda state, qs: picks), World(), ex["order"], ex["note"],
                               images.sample_asset(ex["sample"]))
            self.assertEqual(out["verdict"]["decision"], ex["expect"], ex["label"])

    def test_questions_keep_one_judgment_each(self):
        qs = claims.questions()
        self.assertEqual(qs["damage_box"]["type"], "box")
        answers = fake_answers(qs, GOOD)
        self.assertEqual(claims.evidence(answers)["kind"], "torn_or_open")


if __name__ == "__main__":
    unittest.main()
