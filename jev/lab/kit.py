"""The contract for Python Lab packs, and the helpers they share. Standard library only.

A pack module in jev/lab/packs defines

    PACK = kit.define_pack({"id": "lint-wording", "surface": "python.lint", "title": "...", "about": "...",
                            "features": [...]})

Its id is the module name with hyphens. Each feature is a dict with "id" (lowercase words joined by underscores),
"kind", "title" and what its kind needs:

  lint_rule        "level": "problem" | "advice", "check": check(state, questions, refs) -> [(question id or None,
                   message), ...]; optional "anchor": a "#..." anchor in TypeSafe's guide. Run by jev.lint.check.
  health_check     "check": check(rows, questions) -> [{"rows": [1-based row numbers], "message": str}, ...].
                   Run by jev.health.analyze. Never put a held-out row's label value in a message.
  preflight_check  "check": check(state, questions, refs) -> [(question id or None, message), ...] for one Bulk row's
                   request state. Run by jev.preflight.check.
  cli              "command": ["datasets", "stats"] (one or two words), "run": run(args) -> exit code; optional
                   "configure": configure(parser) and "options": [{"id", "title"}], the flags that each count as an
                   improvement of their own. Run by scripts/lab.py, offline.
  route            "path": "/api/lab/<pack id>/<name>", "handler": handler(body) -> dict. Served by server.py as a POST
                   route behind the same request checks as every other route.
  format           "name": a short format name, and "parse": parse(text) -> rows and/or "render": render(rows) -> text.
  behavior         "where": the file that holds a change made in existing code; the pack records and tests it.

Packs never call the model or the network and never write files except through the app's guarded writers.
"""

from __future__ import annotations

import csv
import io
import json
import re
from typing import Any, Callable, Iterable, List, Optional, Sequence

KINDS = ("lint_rule", "health_check", "preflight_check", "cli", "route", "format", "behavior")
LEVELS = ("problem", "advice")
FORMATS = ("table", "json", "csv", "markdown")

_PACK_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_FEATURE_ID = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
_WORD = re.compile(r"^[a-z][a-z0-9-]*$")
_FORMULA = re.compile(r"^\s*[=+@-]|^[\t\r\n]")


class PackError(ValueError):
    """A pack that does not follow the contract."""


class CliError(Exception):
    """A command-line problem the user can fix: scripts/lab.py prints the message and exits 2."""


def _text(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _check_feature(where: str, feature: dict) -> None:
    kind = feature.get("kind")
    if kind not in KINDS:
        raise PackError("%s: unknown kind %r" % (where, kind))
    if not _text(feature.get("title")):
        raise PackError("%s: title is required" % where)
    if kind in ("lint_rule", "health_check", "preflight_check") and not callable(feature.get("check")):
        raise PackError("%s: check must be a function" % where)
    if kind == "lint_rule":
        if feature.get("level") not in LEVELS:
            raise PackError("%s: level must be one of %s" % (where, ", ".join(LEVELS)))
        if feature.get("anchor", "") and not str(feature["anchor"]).startswith("#"):
            raise PackError("%s: anchor must start with #" % where)
    if kind == "cli":
        command = feature.get("command")
        if not (isinstance(command, (list, tuple)) and 1 <= len(command) <= 2 and all(isinstance(word, str) and _WORD.match(word) for word in command)):
            raise PackError("%s: command must be one or two lowercase words" % where)
        if not callable(feature.get("run")):
            raise PackError("%s: run must be a function" % where)
        if "configure" in feature and not callable(feature["configure"]):
            raise PackError("%s: configure must be a function" % where)
        options = feature.get("options", [])
        ids = [option.get("id") for option in options if isinstance(option, dict)]
        if (not isinstance(options, list) or len(ids) != len(options) or len(set(ids)) != len(ids)
                or not all(_FEATURE_ID.match(str(option["id"])) and _text(option.get("title")) for option in options)):
            raise PackError("%s: options must be a list of distinct {id, title}" % where)
    if kind == "route":
        if not (isinstance(feature.get("path"), str) and re.match(r"^/api/lab/[a-z0-9][a-z0-9/_-]*$", feature["path"])):
            raise PackError("%s: path must start with /api/lab/ and use lowercase letters, digits, - _ /" % where)
        if not callable(feature.get("handler")):
            raise PackError("%s: handler must be a function" % where)
    if kind == "format":
        if not _text(feature.get("name")):
            raise PackError("%s: name is required" % where)
        if not (callable(feature.get("parse")) or callable(feature.get("render"))):
            raise PackError("%s: a format needs parse, render or both" % where)
    if kind == "behavior" and not _text(feature.get("where")):
        raise PackError("%s: where is required" % where)


def define_pack(pack: dict) -> dict:
    """Validate a pack and return it. Raises PackError naming the pack and the feature at fault."""
    if not isinstance(pack, dict):
        raise PackError("Lab pack: expected a dict")
    where = "Lab pack %s" % (pack.get("id") or "(no id)")
    if not _PACK_ID.match(str(pack.get("id") or "")):
        raise PackError("%s: id must be lowercase words joined by hyphens" % where)
    for field in ("surface", "title"):
        if not _text(pack.get(field)):
            raise PackError("%s: %s is required" % (where, field))
    if not str(pack["surface"]).startswith("python."):
        raise PackError("%s: a Python pack's surface starts with python." % where)
    if "about" in pack and not _text(pack["about"]):
        raise PackError("%s: about must be text" % where)
    features = pack.get("features")
    if not isinstance(features, list) or not features:
        raise PackError("%s: features must be a nonempty list" % where)
    seen = set()
    for feature in features:
        ident = feature.get("id") if isinstance(feature, dict) else None
        at = "%s, feature %s" % (where, ident or "(no id)")
        if not isinstance(feature, dict) or not _FEATURE_ID.match(str(ident or "")):
            raise PackError("%s: id must be lowercase words joined by underscores" % at)
        if ident in seen:
            raise PackError("%s: declared twice" % at)
        seen.add(ident)
        _check_feature(at, feature)
    pack["_defined"] = True
    return pack


def improvements_of(pack: dict) -> List[dict]:
    """Every numbered improvement a pack holds: {"id", "title", "kind", "pack", "pack_title", "surface", "about",
    "feature"}. A cli feature is one plus one per listed option; a format is one per direction it supports; every
    other feature is one."""
    out: List[dict] = []

    def add(feature: dict, suffix: str, title: str) -> None:
        out.append({"id": "%s/%s%s" % (pack["id"], feature["id"], suffix), "title": title, "kind": feature["kind"],
                    "pack": pack["id"], "pack_title": pack["title"], "surface": pack["surface"],
                    "about": pack.get("about", ""), "feature": feature["id"]})

    for feature in pack["features"]:
        kind, title = feature["kind"], feature["title"]
        if kind == "lint_rule":
            add(feature, "", "Question check (%s): %s" % (feature["level"], title))
        elif kind == "health_check":
            add(feature, "", "Dataset health: %s" % title)
        elif kind == "preflight_check":
            add(feature, "", "Bulk preflight: %s" % title)
        elif kind == "cli":
            command = "lab.py %s" % " ".join(feature["command"])
            add(feature, "", "`%s`: %s" % (command, title))
            for option in feature.get("options", []):
                add(feature, ".%s" % option["id"], "`%s`: %s" % (command, option["title"]))
        elif kind == "route":
            add(feature, "", "Local API `POST %s`: %s" % (feature["path"], title))
        elif kind == "format":
            if callable(feature.get("parse")):
                add(feature, ".parse", "Read rows from %s" % title)
            if callable(feature.get("render")):
                add(feature, ".render", "Write rows as %s" % title)
        else:
            add(feature, "", title)
    return out


# ---------- shared helpers for packs ----------


def csv_cell(value: Any) -> str:
    """A value as CSV cell text. Text a spreadsheet would run as a formula gets a leading apostrophe."""
    text = "" if value is None else str(value)
    return "'" + text if _FORMULA.match(text) else text


def csv_text(rows: Iterable[Sequence[Any]]) -> str:
    """Rows as CSV (CRLF line ends, every cell quoted, formulas defused)."""
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    for row in rows:
        writer.writerow([csv_cell(cell) for cell in row])
    return out.getvalue()


def cell_text(value: Any) -> str:
    """How a table cell prints: floats to at most six significant digits, None as an empty cell, the rest as text."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return "%.6g" % value
    return str(value)


def text_table(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    """A padded plain-text table; numbers are right-aligned and line breaks inside a cell become spaces. No trailing spaces."""
    cells = [[" ".join(cell_text(cell).splitlines()) for cell in row] for row in rows]
    widths = [max([len(str(column))] + [len(row[index]) for row in cells if index < len(row)]) for index, column in enumerate(columns)]
    numeric = [bool(rows) and all(isinstance(row[index], (int, float)) and not isinstance(row[index], bool)
                                  for row in rows if index < len(row) and row[index] is not None) for index in range(len(columns))]

    def line(values: Sequence[str]) -> str:
        parts = [(value.rjust(widths[index]) if numeric[index] else value.ljust(widths[index])) for index, value in enumerate(values)]
        return "  ".join(parts).rstrip()

    return "\n".join([line([str(column) for column in columns]), line(["-" * width for width in widths])] + [line(row) for row in cells])


def markdown_table(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    """A GitHub-flavored Markdown table. Pipes are escaped and line breaks become <br>."""
    def cell(value: Any) -> str:
        return cell_text(value).replace("|", "\\|").replace("\r\n", "<br>").replace("\n", "<br>").replace("\r", "<br>")

    lines = ["| %s |" % " | ".join(cell(column) for column in columns), "| %s |" % " | ".join("---" for _ in columns)]
    lines += ["| %s |" % " | ".join(cell(value) for value in row) for row in rows]
    return "\n".join(lines)


def render(columns: Sequence[str], rows: Sequence[Sequence[Any]], fmt: str = "table") -> str:
    """Rows in one of FORMATS: a text table, a JSON list of objects, CSV, or a Markdown table."""
    if fmt == "json":
        return json.dumps([dict(zip(columns, row)) for row in rows], indent=1, ensure_ascii=False, default=str)
    if fmt == "csv":
        return csv_text([columns] + [list(row) for row in rows]).rstrip("\r\n")
    if fmt == "markdown":
        return markdown_table(columns, rows)
    if fmt == "table":
        return text_table(columns, rows)
    raise CliError("--format must be one of: %s" % ", ".join(FORMATS))


def add_format(parser: Any, default: str = "table") -> None:
    """Give a command the shared --format option."""
    parser.add_argument("--format", choices=FORMATS, default=default, help="output format (default: %s)" % default)


def emit(args: Any, columns: Sequence[str], rows: Sequence[Sequence[Any]], out: Optional[Callable[[str], None]] = None) -> None:
    """Print rows in the format the command was asked for (args.format, a text table when the command has none)."""
    (out or print)(render(columns, rows, getattr(args, "format", "table")))
