"""Tests for the cli-pictures Lab pack (jev/lab/packs/cli_pictures.py): offline commands for the sample pictures and the
pictures saved in the Workbench data directory. Fictional Harbor Coffee Co. data only; pictures are built here as bare
PNG and JPEG headers."""

import hashlib
import io
import json
import struct
import sys
import tempfile
import zlib
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import images, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_pictures  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


def png(width, height, color=2, interlace=0):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color, 0, 0, interlace)) + chunk(b"IEND", b"")


def jpeg(width, height, marker=0xC0):
    frame = bytes([8]) + struct.pack(">HH", height, width) + bytes([3]) + bytes(9)
    return b"\xff\xd8\xff" + bytes([marker]) + struct.pack(">H", len(frame) + 2) + frame + b"\xff\xd9"


def hashed(data, extension):
    return hashlib.sha256(data).hexdigest()[:16] + "." + extension


A_DATA, B_DATA, U_DATA = png(400, 300), jpeg(1600, 900), png(320, 320, color=6)
A, B, U = hashed(A_DATA, "png"), hashed(B_DATA, "jpg"), hashed(U_DATA, "png")
C_DATA, D_DATA = png(500, 500), jpeg(300, 300)
C, D, E = "0000000000000000.png", hashed(D_DATA, "png"), "notes.txt"
WIDE = "Image is 1600×900; each side must be 280 to 1568 pixels."
QUESTIONS = {"damaged": {"type": "noul", "instructions": "Is the parcel damaged?"}}


def save_pictures(directory, files):
    folder = directory / "images"
    folder.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (folder / name).write_bytes(data)


def save_test(directory, ident, pictures):
    item = {"id": ident, "name": ident, "state": " ".join(pictures), "questions": QUESTIONS, "expect": {}, "images": pictures}
    (directory / ("%s.json" % ident)).write_text(json.dumps(item))


def setup_basic(directory):
    save_pictures(directory, {A: A_DATA, B: B_DATA, U: U_DATA})
    save_test(directory, "parcel-check", {"photo-abc123": {"file": A}, "sample-ref1": {"sample": "torn-bag"}})
    save_test(directory, "lost-photo", {"photo-lost01": {"file": "fedcba9876543210.jpg"}, "photo-bad001": {"sample": "no-such-sample"}})
    workbench.save_dataset({"name": "Parcel photos", "questions": QUESTIONS, "rows": [
        {"note": "Seal split", "_image": B, "_expect": {"damaged": True}}, {"note": "Fine", "_image": "intact-bag"},
        {"note": "Gone", "_image": "0123456789abcdef.png"},
        {"note": "Held", "_image": "aaaaaaaaaaaaaaaa.png", "_test": True, "_expect": {"damaged": False}},
        {"note": "Held ok", "_image": B, "_test": True}]})


def setup_history(directory):
    setup_basic(directory)
    folder = directory / "datasets" / ".history" / "parcel-photos"
    folder.mkdir(parents=True)
    (folder / "20260101T000000000000Z-abcdefabcdef.json").write_text(json.dumps({"rows": [{"note": "Old", "_image": U}]}))


def setup_bad(directory):
    save_pictures(directory, {A: A_DATA, C: C_DATA, D: D_DATA, E: b"hello"})


def sample_row(name):
    data = (images.SAMPLES_DIR / ("%s.png" % name)).read_bytes()
    width, height = struct.unpack(">II", data[16:24])
    return [name, "sample", "png", width, height, len(data)]


SAMPLE_ROWS = [sample_row(name) for name in images.SAMPLES]
SAVED = sorted([[A, "saved", "png", 400, 300, len(A_DATA)], [B, "saved", "jpg", 1600, 900, len(B_DATA)],
                [U, "saved", "png", 320, 320, len(U_DATA)]])
LIST = ["picture", "kind", "format", "width", "height", "bytes"]
CHECK = ["picture", "kind", "problem"]
MISSING = ["source", "where", "picture", "problem"]
MISSING_ROWS = [["test lost-photo", "picture photo-lost01", "fedcba9876543210.jpg", "file missing"],
                ["test lost-photo", "picture photo-bad001", "no-such-sample", "unknown sample"],
                ["dataset parcel-photos", "row 3", "0123456789abcdef.png", "file missing"],
                ["dataset parcel-photos", "row 4 (held-out)", "aaaaaaaaaaaaaaaa.png", "file missing"]]
VERIFY_ALL = sorted([[A, "ok"], [C, "content hash %s does not match its name" % hashlib.sha256(C_DATA).hexdigest()[:16]],
                     [D, "holds a jpg picture but is named .png"],
                     [E, "not a saved picture name (16 hex digits, then .png or .jpg)"]])
USAGE = ["picture", "kind", "tests", "datasets", "tuning rows", "test rows"]
USES = {"torn-bag": [1, 0, 0, 0], "intact-bag": [0, 1, 1, 0], A: [1, 0, 0, 0], B: [0, 1, 1, 1]}
USAGE_ROWS = ([[name, "sample"] + USES.get(name, [0, 0, 0, 0]) for name in images.SAMPLES]
              + [[row[0], "saved"] + USES.get(row[0], [0, 0, 0, 0]) for row in SAVED]
              + [["fedcba9876543210.jpg", "missing", 1, 0, 0, 0], ["no-such-sample", "missing", 1, 0, 0, 0],
                 ["0123456789abcdef.png", "missing", 0, 1, 1, 0], ["aaaaaaaaaaaaaaaa.png", "missing", 0, 1, 0, 1]])
TORN = (images.SAMPLES_DIR / "torn-bag.png").read_bytes()
COLORS = {0: "grayscale", 2: "RGB", 3: "palette", 4: "grayscale with alpha", 6: "RGB with alpha"}
TORN_FACTS = [["picture", "torn-bag"], ["kind", "sample"], ["format", "png"], ["width", SAMPLE_ROWS[0][3]], ["height", SAMPLE_ROWS[0][4]],
              ["pixels", SAMPLE_ROWS[0][3] * SAMPLE_ROWS[0][4]], ["aspect ratio", round(SAMPLE_ROWS[0][3] / SAMPLE_ROWS[0][4], 3)],
              ["bytes", len(TORN)], ["sha256", hashlib.sha256(TORN).hexdigest()], ["within limits", "yes"], ["bit depth", TORN[24]],
              ["color type", COLORS[TORN[25]]], ["interlaced", "yes" if TORN[28] else "no"]]
PROGRESSIVE = jpeg(1600, 900, marker=0xC2)
LOOSE = DIR / "upload.jpg"
LOOSE.write_bytes(PROGRESSIVE)
LOOSE_FACTS = [["picture", "upload.jpg"], ["kind", "file"], ["format", "jpg"], ["width", 1600], ["height", 900], ["pixels", 1440000],
               ["aspect ratio", 1.778], ["bytes", len(PROGRESSIVE)], ["sha256", hashlib.sha256(PROGRESSIVE).hexdigest()],
               ["within limits", WIDE], ["encoding", "progressive"], ["bit depth", 8], ["components", 3]]
A_FACTS = [["picture", A], ["kind", "saved"], ["format", "png"], ["width", 400], ["height", 300], ["pixels", 120000],
           ["aspect ratio", 1.333], ["bytes", len(A_DATA)], ["sha256", hashlib.sha256(A_DATA).hexdigest()], ["within limits", "yes"],
           ["bit depth", 8], ["color type", "RGB"], ["interlaced", "no"], ["name matches content", "yes"]]
SIZES = sorted([(len(A_DATA), A), (len(B_DATA), B), (len(U_DATA), U)], key=lambda pair: (-pair[0], pair[1]))
SUMMARY = [["sample pictures", 4], ["saved pictures", 3], ["saved bytes", len(A_DATA) + len(B_DATA) + len(U_DATA)],
           ["largest saved picture", SIZES[0][1]], ["outside the limits", 1], ["unused saved pictures", 1], ["missing references", 4],
           ["names that do not match", 0]]


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(columns, rows):
    expected = [dict(zip(columns, row)) for row in rows]

    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


CASES = {
    "list": {"argv": ["pictures", "list"], "setup": setup_basic, "stdout": table(LIST, SAMPLE_ROWS + SAVED),
             "options": {
                 "kind": {"argv": ["pictures", "list", "--kind", "saved"], "setup": setup_basic, "stdout": table(LIST, SAVED)},
                 "sort": {"argv": ["pictures", "list", "--sort", "pixels"], "setup": setup_basic,
                          "stdout": table(LIST, [SAVED[[row[0] for row in SAVED].index(B)]]
                                          + sorted(SAMPLE_ROWS, key=lambda row: (-row[3] * row[4], row[0]))
                                          + [row for name in (A, U) for row in SAVED if row[0] == name])},
                 "format": {"argv": ["pictures", "list", "--kind", "saved", "--format", "json"], "setup": setup_basic,
                            "stdout": same_json(LIST, SAVED)}}},
    "check": {"argv": ["pictures", "check"], "setup": setup_basic, "code": 1, "stdout": table(CHECK, [[B, "saved", WIDE]]),
              "options": {
                  "kind": {"argv": ["pictures", "check", "--kind", "sample"], "setup": setup_basic,
                           "stdout": "every picture is within the limits (4 checked)\n"},
                  "all": {"argv": ["pictures", "check", "--all", "--kind", "saved"], "setup": setup_basic, "code": 1,
                          "stdout": table(CHECK, [[row[0], "saved", WIDE if row[0] == B else "ok"] for row in SAVED])},
                  "format": {"argv": ["pictures", "check", "--format", "json"], "setup": setup_basic, "code": 1,
                             "stdout": same_json(CHECK, [[B, "saved", WIDE]])}}},
    "unused": {"argv": ["pictures", "unused"], "setup": setup_basic, "code": 1, "stdout": table(["picture", "bytes"], [[U, len(U_DATA)]]),
               "options": {
                   "keep_history": {"argv": ["pictures", "unused", "--keep-history"], "setup": setup_history,
                                    "stdout": "every saved picture is referenced\n"},
                   "format": {"argv": ["pictures", "unused", "--format", "csv"], "setup": setup_basic, "code": 1,
                              "stdout": kit.render(["picture", "bytes"], [[U, len(U_DATA)]], "csv") + "\n"}}},
    "missing": {"argv": ["pictures", "missing"], "setup": setup_basic, "code": 1, "stdout": table(MISSING, MISSING_ROWS),
                "options": {
                    "source": {"argv": ["pictures", "missing", "--source", "datasets"], "setup": setup_basic, "code": 1,
                               "stdout": table(MISSING, MISSING_ROWS[2:])},
                    "format": {"argv": ["pictures", "missing", "--source", "tests", "--format", "json"], "setup": setup_basic, "code": 1,
                               "stdout": same_json(MISSING, MISSING_ROWS[:2])}}},
    "show": {"argv": ["pictures", "show", "torn-bag"], "stdout": table(["fact", "value"], TORN_FACTS),
             "options": {
                 "path": {"argv": ["pictures", "show", "--path", str(LOOSE)], "stdout": table(["fact", "value"], LOOSE_FACTS)},
                 "format": {"argv": ["pictures", "show", A, "--format", "json"], "setup": setup_basic,
                            "stdout": same_json(["fact", "value"], A_FACTS)}}},
    "verify": {"argv": ["pictures", "verify"], "setup": setup_bad, "code": 1,
               "stdout": table(["picture", "status"], [row for row in VERIFY_ALL if row[1] != "ok"]),
               "options": {
                   "all": {"argv": ["pictures", "verify", "--all"], "setup": setup_bad, "code": 1, "stdout": table(["picture", "status"], VERIFY_ALL)},
                   "format": {"argv": ["pictures", "verify", "--format", "json"], "setup": setup_basic, "stdout": same_json(["picture", "status"], [])}}},
    "usage": {"argv": ["pictures", "usage"], "setup": setup_basic, "stdout": table(USAGE, USAGE_ROWS),
              "options": {
                  "name": {"argv": ["pictures", "usage", "--name", B], "setup": setup_basic, "stdout": table(USAGE, [[B, "saved", 0, 1, 1, 1]])},
                  "format": {"argv": ["pictures", "usage", "--format", "csv"], "setup": setup_basic,
                             "stdout": kit.render(USAGE, USAGE_ROWS, "csv") + "\n"}}},
    "summary": {"argv": ["pictures", "summary"], "setup": setup_basic, "stdout": table(["metric", "value"], SUMMARY),
                "options": {"format": {"argv": ["pictures", "summary", "--format", "json"], "setup": setup_bad,
                                       "stdout": same_json(["metric", "value"], [
                                           ["sample pictures", 4], ["saved pictures", 4],
                                           ["saved bytes", len(A_DATA) + len(C_DATA) + len(D_DATA) + 5],
                                           ["largest saved picture", sorted([(len(A_DATA), A), (len(C_DATA), C), (len(D_DATA), D), (5, E)],
                                                                            key=lambda pair: (-pair[0], pair[1]))[0][1]],
                                           ["outside the limits", 1], ["unused saved pictures", 4], ["missing references", 0],
                                           ["names that do not match", 3]])}}},
}


class CliPicturesTests(pack_tests(cli_pictures.PACK, CASES)):
    def test_usage_errors_exit_two(self):
        for argv in (["pictures", "show"], ["pictures", "show", "no-such.png"], ["pictures", "show", "../%s" % A],
                     ["pictures", "show", "torn-bag", "--path", str(LOOSE)], ["pictures", "show", "--path", str(DIR / "none.png")],
                     ["pictures", "usage", "--name", "nothing.png"]):
            self.assertEqual(run_cli(argv, setup_basic)[0], 2, argv)

    def test_nothing_is_written_or_removed(self):
        import lab as lab_cli  # scripts/lab.py, on the path through labkit

        def snapshot(directory):
            return {str(path.relative_to(directory)): path.read_bytes() for path in sorted(directory.rglob("*")) if path.is_file()}

        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            previous = workbench.WORKBENCH_DIR
            workbench.WORKBENCH_DIR = directory
            try:
                setup_history(directory)
            finally:
                workbench.WORKBENCH_DIR = previous
            before = snapshot(directory)
            for command in ("list", "check", "unused", "missing", "verify", "usage", "summary"):
                with redirect_stdout(io.StringIO()):
                    lab_cli.main(["--data-dir", name, "pictures", command])
            with redirect_stdout(io.StringIO()):
                lab_cli.main(["--data-dir", name, "pictures", "show", A])
            self.assertEqual(snapshot(directory), before)

    def test_held_out_labels_never_shown(self):
        for command in ("missing", "usage"):
            _code, out, _err = run_cli(["pictures", command, "--format", "json"], setup_basic)
            self.assertNotIn("damaged", out)
            self.assertNotIn("Held", out)
