"""Offline commands for pictures (`lab.py pictures ...`): the bundled samples (static/img/samples, jev.images.SAMPLES)
and the pictures saved under the Workbench data directory (images/<sha256 prefix>.<png|jpg>).

List them with their dimensions and sizes, check each against the documented limits (each side 280 to 1568 pixels,
16 MiB) with jev.images.check, find saved pictures nothing references and references whose file is missing, show one
picture's header facts, verify that saved files still match the content hash in their names, count where each picture
is used, and summarize it all. PNG and JPEG headers are read with the standard library only.

Read only: no command writes, moves or deletes a picture, and nothing calls the model. References are read from saved
tests (their "images") and from every dataset row's _image, held-out rows included; no label value is ever printed.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from jev import history, images, workbench
from jev.lab import kit

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
KINDS = ("sample", "saved")
IMAGE = workbench.IMAGE_KEY
PNG_COLORS = {0: "grayscale", 2: "RGB", 3: "palette", 4: "grayscale with alpha", 6: "RGB with alpha"}
JPEG_FRAMES = {0xC0: "baseline", 0xC1: "extended sequential", 0xC2: "progressive", 0xC3: "lossless",
               0xC5: "differential sequential", 0xC6: "differential progressive", 0xC7: "differential lossless",
               0xC9: "arithmetic sequential", 0xCA: "arithmetic progressive", 0xCB: "arithmetic lossless"}


# ---------- the pictures and their references ----------


def _samples() -> List[Tuple[str, str, Path]]:
    return [(name, "sample", images.SAMPLES_DIR / ("%s.png" % name)) for name in images.SAMPLES
            if (images.SAMPLES_DIR / ("%s.png" % name)).is_file()]


def _saved() -> List[Tuple[str, str, Path]]:
    folder = workbench.images_dir()
    if not folder.is_dir():
        return []
    return [(path.name, "saved", path) for path in sorted(folder.iterdir()) if path.is_file()]


def _pictures(kind: Optional[str] = None) -> List[Tuple[str, str, Path]]:
    return [item for item in _samples() + _saved() if not kind or item[1] == kind]


def _header(data: bytes) -> Tuple[Optional[str], Optional[int], Optional[int], Optional[str]]:
    """(format, width, height, problem) read from the header."""
    try:
        fmt, width, height = images.dimensions(data)
    except images.ImageError as err:
        return None, None, None, str(err)
    return fmt, width, height, None


def _limits(data: bytes) -> Optional[str]:
    """The reason these bytes break the documented limits, or None."""
    try:
        images.check(data)
    except images.ImageError as err:
        return str(err)
    return None


def _hash_problems(name: str, data: bytes) -> List[str]:
    """Why a saved picture's file does not match its name: <first 16 hex digits of sha256>.<png|jpg>."""
    if not workbench.IMAGE_FILE.fullmatch(name):
        return ["not a saved picture name (16 hex digits, then .png or .jpg)"]
    out = []
    fmt, _width, _height, problem = _header(data)
    stem, extension = name.split(".")
    if problem:
        out.append("not a picture: %s" % problem)
    elif fmt != extension:
        out.append("holds a %s picture but is named .%s" % (fmt, extension))
    digest = hashlib.sha256(data).hexdigest()[:16]
    if digest != stem:
        out.append("content hash %s does not match its name" % digest)
    return out


def _test_refs() -> Iterable[Tuple[str, str, str, str]]:
    """(test id, reference, "file" or "sample", picture name) for every picture a saved test keeps."""
    for item in workbench.list_items():
        if not isinstance(item, dict) or not isinstance(item.get("images"), dict):
            continue
        for ref, spec in item["images"].items():
            if not isinstance(spec, dict):
                continue
            for key in ("file", "sample"):
                if isinstance(spec.get(key), str):
                    yield str(item.get("id")), str(ref), key, spec[key]


def _datasets() -> List[dict]:
    out = []
    for summary in workbench.list_datasets():
        try:
            out.append(workbench.load_dataset(summary["id"]))
        except workbench.WorkbenchError:
            continue
    return out


def _row_refs(rows: Any) -> Iterable[Tuple[int, bool, Any]]:
    """(row number, held out, _image value) for every row that names a picture."""
    for number, row in enumerate(rows if isinstance(rows, list) else [], 1):
        if isinstance(row, dict) and IMAGE in row:
            yield number, row.get(workbench.TEST_KEY) is True, row[IMAGE]


def _history_refs() -> Iterable[str]:
    folder = history.history_dir()
    if not folder.is_dir():
        return
    for path in sorted(folder.glob("*/*.json")):
        try:
            revision = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(revision, dict):
            for _number, _held, name in _row_refs(revision.get("rows")):
                if isinstance(name, str):
                    yield name


def _referenced(keep_history: bool = False) -> set:
    names = {name for _test, _ref, _key, name in _test_refs()}
    names |= {name for dataset in _datasets() for _n, _held, name in _row_refs(dataset["rows"]) if isinstance(name, str)}
    if keep_history:
        names |= set(_history_refs())
    return names


def _present(name: str, sample: bool) -> Optional[str]:
    """Why a referenced picture cannot be loaded, or None."""
    if sample:
        if name not in images.SAMPLES:
            return "unknown sample"
        return None if (images.SAMPLES_DIR / ("%s.png" % name)).is_file() else "sample file missing"
    if not workbench.IMAGE_FILE.fullmatch(name):
        return "not a picture name"
    return None if (workbench.images_dir() / name).is_file() else "file missing"


def _missing(source: Optional[str] = None) -> List[list]:
    rows = []
    if source in (None, "tests"):
        for test, ref, key, name in _test_refs():
            problem = _present(name, key == "sample")
            if problem:
                rows.append(["test %s" % test, "picture %s" % ref, name, problem])
    if source in (None, "datasets"):
        for dataset in _datasets():
            for number, held, name in _row_refs(dataset["rows"]):
                text = name if isinstance(name, str) else json.dumps(name)
                problem = _present(text, text in images.SAMPLES) if isinstance(name, str) else "not a picture name"
                if problem:
                    rows.append(["dataset %s" % dataset["id"], "row %d%s" % (number, " (held-out)" if held else ""), text, problem])
    return rows


def _unused(keep_history: bool = False) -> List[list]:
    used = _referenced(keep_history)
    return [[name, path.stat().st_size] for name, _kind, path in _saved() if name not in used]


def _violations(kind: Optional[str] = None) -> List[list]:
    rows = []
    for name, picture_kind, path in _pictures(kind):
        problem = _limits(path.read_bytes())
        rows.append([name, picture_kind, problem or "ok"])
    return rows


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


# ---------- pictures list ----------


def _configure_list(parser: Any) -> None:
    parser.add_argument("--kind", choices=KINDS, help="only sample pictures or only saved ones")
    parser.add_argument("--sort", choices=("name", "bytes", "pixels"),
                        help="order by name, or largest first by file size or pixel count (default: samples, then saved by name)")
    kit.add_format(parser)


def run_list(args: Any) -> int:
    rows = []
    for name, kind, path in _pictures(args.kind):
        data = path.read_bytes()
        fmt, width, height, _problem = _header(data)
        rows.append([name, kind, fmt, width, height, len(data)])
    if args.sort == "name":
        rows.sort(key=lambda row: row[0])
    elif args.sort == "bytes":
        rows.sort(key=lambda row: (-row[5], row[0]))
    elif args.sort == "pixels":
        rows.sort(key=lambda row: (-(row[3] or 0) * (row[4] or 0), row[0]))
    _table_or(args, ["picture", "kind", "format", "width", "height", "bytes"], rows, "no pictures")
    return 0


# ---------- pictures check ----------


def _configure_check(parser: Any) -> None:
    parser.add_argument("--kind", choices=KINDS, help="only sample pictures or only saved ones")
    parser.add_argument("--all", action="store_true", help="list every picture, with ok for the ones within the limits")
    kit.add_format(parser)


def run_check(args: Any) -> int:
    rows = _violations(args.kind)
    bad = [row for row in rows if row[2] != "ok"]
    empty = "every picture is within the limits (%d checked)" % len(rows)
    _table_or(args, ["picture", "kind", "problem"], rows if args.all else bad, empty)
    return 1 if bad else 0


# ---------- pictures unused and missing ----------


def _configure_unused(parser: Any) -> None:
    parser.add_argument("--keep-history", action="store_true",
                        help="count pictures that dataset revisions (the undo history) reference as used")
    kit.add_format(parser)


def run_unused(args: Any) -> int:
    rows = _unused(args.keep_history)
    _table_or(args, ["picture", "bytes"], rows, "every saved picture is referenced")
    return 1 if rows else 0


def _configure_missing(parser: Any) -> None:
    parser.add_argument("--source", choices=("tests", "datasets"), help="only references from saved tests or only from datasets")
    kit.add_format(parser)


def run_missing(args: Any) -> int:
    rows = _missing(args.source)
    _table_or(args, ["source", "where", "picture", "problem"], rows, "every referenced picture is present")
    return 1 if rows else 0


# ---------- pictures show ----------


def _configure_show(parser: Any) -> None:
    parser.add_argument("name", nargs="?", help="a sample name or a saved picture's file name")
    parser.add_argument("--path", metavar="FILE", help="inspect a picture file anywhere on disk instead")
    kit.add_format(parser)


def _png_facts(data: bytes) -> List[list]:
    if len(data) < 29:
        return []
    return [["bit depth", data[24]], ["color type", PNG_COLORS.get(data[25], "type %d" % data[25])],
            ["interlaced", "yes" if data[28] == 1 else "no"]]


def _jpeg_facts(data: bytes) -> List[list]:
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
            i += 1 if marker == 0xFF else 2
            continue
        (length,) = struct.unpack(">H", data[i + 2:i + 4])
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return [["encoding", JPEG_FRAMES.get(marker, "SOF%X" % (marker - 0xC0))], ["bit depth", data[i + 4]],
                    ["components", data[i + 9] if i + 9 < len(data) else None]]
        i += 2 + length
    return []


def run_show(args: Any) -> int:
    if args.path:
        if args.name:
            raise kit.CliError("name a picture or pass --path, not both")
        path, kind, name = Path(args.path), "file", Path(args.path).name
        if not path.is_file():
            raise kit.CliError("no file %s" % args.path)
    elif not args.name:
        raise kit.CliError("name a sample (%s) or a saved picture, or pass --path" % ", ".join(images.SAMPLES))
    elif args.name in images.SAMPLES:
        path, kind, name = images.SAMPLES_DIR / ("%s.png" % args.name), "sample", args.name
    else:
        path, kind, name = workbench.images_dir() / args.name, "saved", args.name
        if "/" in args.name or "\\" in args.name or not path.is_file():
            raise kit.CliError("no picture %r: name a sample (%s) or a file in the Workbench images folder"
                               % (args.name, ", ".join(images.SAMPLES)))
    data = path.read_bytes()
    fmt, width, height, problem = _header(data)
    if problem:
        raise kit.CliError("%s is not a picture the Workbench reads: %s" % (name, problem))
    rows: List[list] = [["picture", name], ["kind", kind], ["format", fmt], ["width", width], ["height", height],
                        ["pixels", width * height], ["aspect ratio", round(width / height, 3) if height else None],
                        ["bytes", len(data)], ["sha256", hashlib.sha256(data).hexdigest()],
                        ["within limits", _limits(data) or "yes"]]
    rows += _png_facts(data) if fmt == "png" else _jpeg_facts(data)
    if kind == "saved":
        rows.append(["name matches content", "no" if _hash_problems(name, data) else "yes"])
    kit.emit(args, ["fact", "value"], rows)
    return 0


# ---------- pictures verify ----------


def _configure_verify(parser: Any) -> None:
    parser.add_argument("--all", action="store_true", help="list every saved file, with ok for the ones that match")
    kit.add_format(parser)


def _verified() -> List[list]:
    return [[name, "; ".join(_hash_problems(name, path.read_bytes())) or "ok"] for name, _kind, path in _saved()]


def run_verify(args: Any) -> int:
    rows = _verified()
    bad = [row for row in rows if row[1] != "ok"]
    _table_or(args, ["picture", "status"], rows if args.all else bad,
              "every saved picture matches the content hash in its name (%d files)" % len(rows))
    return 1 if bad else 0


# ---------- pictures usage ----------


def _configure_usage(parser: Any) -> None:
    parser.add_argument("--name", metavar="NAME", help="only this picture")
    kit.add_format(parser)


def run_usage(args: Any) -> int:
    counts: Dict[str, Dict[str, Any]] = {}

    def entry(name: str, kind: str) -> Dict[str, Any]:
        return counts.setdefault(name, {"kind": kind, "tests": set(), "datasets": set(), "tuning": 0, "test": 0})

    for name, kind, _path in _pictures():
        entry(name, kind)
    for test, _ref, key, name in _test_refs():
        entry(name, "sample" if key == "sample" and name in images.SAMPLES else "missing")["tests"].add(test)
    for dataset in _datasets():
        for _number, held, name in _row_refs(dataset["rows"]):
            if not isinstance(name, str):
                continue
            item = entry(name, "missing")
            item["datasets"].add(dataset["id"])
            item["test" if held else "tuning"] += 1
    rows = [[name, item["kind"], len(item["tests"]), len(item["datasets"]), item["tuning"], item["test"]]
            for name, item in counts.items() if not args.name or name == args.name]
    if args.name and not rows:
        raise kit.CliError("no picture %r is saved or referenced" % args.name)
    kit.emit(args, ["picture", "kind", "tests", "datasets", "tuning rows", "test rows"], rows)
    return 0


# ---------- pictures summary ----------


def _configure_summary(parser: Any) -> None:
    kit.add_format(parser)


def run_summary(args: Any) -> int:
    saved = _saved()
    sizes = [(path.stat().st_size, name) for name, _kind, path in saved]
    largest = sorted(sizes, key=lambda pair: (-pair[0], pair[1]))[0] if sizes else None
    rows = [["sample pictures", len(_samples())], ["saved pictures", len(saved)], ["saved bytes", sum(size for size, _ in sizes)],
            ["largest saved picture", largest[1] if largest else None],
            ["outside the limits", sum(row[2] != "ok" for row in _violations())],
            ["unused saved pictures", len(_unused())], ["missing references", len(_missing())],
            ["names that do not match", sum(row[1] != "ok" for row in _verified())]]
    kit.emit(args, ["metric", "value"], rows)
    return 0


PACK = kit.define_pack({
    "id": "cli-pictures",
    "surface": "python.cli",
    "title": "Picture commands",
    "about": "Offline, read-only commands for the sample pictures and the pictures saved in the Workbench data directory: "
             "dimensions and sizes, the 280 to 1568 pixel limits, unused files, missing references, one picture's header "
             "facts, content-hash checks of saved names, where each picture is used, and a summary.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["pictures", "list"], "configure": _configure_list, "run": run_list,
         "title": "List the sample and saved pictures with their format, width, height and size in bytes",
         "options": [{"id": "kind", "title": "--kind sample|saved lists one kind of picture"},
                     {"id": "sort", "title": "--sort orders pictures by name, largest file or most pixels"},
                     dict(FORMAT)]},
        {"id": "check", "kind": "cli", "command": ["pictures", "check"], "configure": _configure_check, "run": run_check,
         "title": "Check every picture against the 280 to 1568 pixel and 16 MiB limits; exit 1 on a violation",
         "options": [{"id": "kind", "title": "--kind sample|saved checks one kind of picture"},
                     {"id": "all", "title": "--all lists every picture, ok or not"},
                     dict(FORMAT)]},
        {"id": "unused", "kind": "cli", "command": ["pictures", "unused"], "configure": _configure_unused, "run": run_unused,
         "title": "Find saved pictures no saved test or dataset row references, with their sizes; exit 1 if any",
         "options": [{"id": "keep_history", "title": "--keep-history counts pictures dataset revisions reference as used"},
                     dict(FORMAT)]},
        {"id": "missing", "kind": "cli", "command": ["pictures", "missing"], "configure": _configure_missing, "run": run_missing,
         "title": "Find saved tests and dataset rows that name a picture whose file is missing or unknown; exit 1 if any",
         "options": [{"id": "source", "title": "--source tests|datasets looks at one kind of reference"}, dict(FORMAT)]},
        {"id": "show", "kind": "cli", "command": ["pictures", "show"], "configure": _configure_show, "run": run_show,
         "title": "Show one picture's header facts: format, size, aspect ratio, sha256, limits, PNG or JPEG encoding details",
         "options": [{"id": "path", "title": "--path FILE inspects a picture file anywhere on disk, for example before upload"},
                     dict(FORMAT)]},
        {"id": "verify", "kind": "cli", "command": ["pictures", "verify"], "configure": _configure_verify, "run": run_verify,
         "title": "Verify that every saved picture's content hash and format match its file name; exit 1 on a mismatch",
         "options": [{"id": "all", "title": "--all lists every saved file, ok or not"}, dict(FORMAT)]},
        {"id": "usage", "kind": "cli", "command": ["pictures", "usage"], "configure": _configure_usage, "run": run_usage,
         "title": "Count where each picture is used: saved tests, datasets, tuning rows and held-out rows",
         "options": [{"id": "name", "title": "--name NAME counts one picture's uses"}, dict(FORMAT)]},
        {"id": "summary", "kind": "cli", "command": ["pictures", "summary"], "configure": _configure_summary, "run": run_summary,
         "title": "Summarize pictures: samples, saved files and bytes, the largest, limit violations, unused, missing and mismatched",
         "options": [dict(FORMAT)]},
    ],
})
