"""One-page Markdown or HTML reports of Workbench data, offline: `lab.py report data|dataset|site`.

A report holds counts and configuration only: datasets, saved tests, saved checks, label coverage, held-out row
counts and kept revision history. It never holds an input, a label value or a model answer (saved data holds no
answers), and held-out rows appear only as counts. Everything is read through the app's loaders, so --data-dir
applies. A report prints to stdout, or is written to --out (a site to --out-dir), which must lie outside the Workbench
data directory; an existing file is replaced only with --force. Nothing in the data directory is ever written.
"""

from __future__ import annotations

import argparse
import datetime
import html
import re
import sys
from collections import namedtuple
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from jev import dataset_changes, health, history, workbench
from jev.lab import kit

LABEL = workbench.LABEL_KEY
TEST = workbench.TEST_KEY
LABEL_TYPES = ("choice", "noul", "score")
DATA_SECTIONS = ("overview", "datasets", "labels", "checks", "tests", "history")
DATASET_SECTIONS = ("overview", "questions", "labels", "fields", "check", "guidelines", "history")
INTRO = "Offline summary of Workbench data: counts and configuration only, never inputs, label values or model answers."

Link = namedtuple("Link", "text href")


# ---------- documents: a list of blocks rendered as Markdown or HTML ----------


def _slug(text: str) -> str:
    """The anchor GitHub gives a heading, which the HTML page uses as the heading's id too."""
    return re.sub(r"[^a-z0-9 _-]", "", text.lower()).strip().replace(" ", "-")


def _cell(value: Any) -> str:
    if isinstance(value, float):
        return "%.6g" % value
    return kit.cell_text(value)


def _md_text(text: str) -> str:
    return " ".join(str(text).replace("<", "&lt;").splitlines())


def _md_cell(value: Any) -> str:
    if isinstance(value, Link):
        label = _md_cell(value.text).replace("[", "\\[").replace("]", "\\]")
        return "[%s](%s)" % (label, value.href)
    text = _cell(value).replace("|", "\\|").replace("<", "&lt;")
    return text.replace("\r\n", "<br>").replace("\n", "<br>").replace("\r", "<br>")


def to_markdown(blocks: List[tuple]) -> str:
    out: List[str] = []
    for block in blocks:
        kind = block[0]
        if kind == "h1":
            out.append("# %s" % _md_text(block[1]))
        elif kind == "h2":
            out.append("## %s" % _md_text(block[1]))
        elif kind == "p":
            out.append(_md_text(block[1]))
        elif kind == "list":
            out.append("\n".join("- %s" % _md_cell(item) for item in block[1]))
        elif kind == "table":
            columns, rows = block[1], block[2]
            lines = ["| %s |" % " | ".join(_md_cell(column) for column in columns),
                     "| %s |" % " | ".join("---:" if _numeric(rows, i) else "---" for i in range(len(columns)))]
            lines += ["| %s |" % " | ".join(_md_cell(value) for value in row) for row in rows]
            out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"


def _numeric(rows: List[list], index: int) -> bool:
    values = [row[index] for row in rows if index < len(row) and row[index] is not None]
    return bool(values) and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values)


STYLE = """:root{--bg:#ffffff;--fg:#1d2329;--muted:#5b6670;--line:#d9dee3;--head:#f3f5f7;--link:#0b62c4}
@media (prefers-color-scheme: dark){:root{--bg:#15191d;--fg:#e6e9ec;--muted:#9aa5ae;--line:#2c3339;--head:#1e2429;--link:#7db4f5}}
body{margin:0 auto;max-width:960px;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:1.6rem;margin:0 0 .5rem}
h2{font-size:1.2rem;margin:2rem 0 .5rem;padding-bottom:.25rem;border-bottom:1px solid var(--line)}
p{color:var(--muted)}
a{color:var(--link)}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
th{background:var(--head)}
td.num{text-align:right}"""


def _html_cell(value: Any) -> str:
    if isinstance(value, Link):
        return '<a href="%s">%s</a>' % (html.escape(value.href, quote=True), html.escape(_cell(value.text)))
    return html.escape(_cell(value)).replace("\n", "<br>")


def to_html(title: str, blocks: List[tuple]) -> str:
    body: List[str] = []
    for block in blocks:
        kind = block[0]
        if kind == "h1":
            body.append("<h1>%s</h1>" % html.escape(block[1]))
        elif kind == "h2":
            body.append('<h2 id="%s">%s</h2>' % (_slug(block[1]), html.escape(block[1])))
        elif kind == "p":
            body.append("<p>%s</p>" % html.escape(block[1]))
        elif kind == "list":
            body.append("<ul>%s</ul>" % "".join("<li>%s</li>" % _html_cell(item) for item in block[1]))
        elif kind == "table":
            columns, rows = block[1], block[2]
            numeric = [_numeric(rows, i) for i in range(len(columns))]
            head = "".join("<th>%s</th>" % html.escape(str(column)) for column in columns)
            lines = ["<tr>%s</tr>" % "".join(('<td class="num">%s</td>' if numeric[i] else "<td>%s</td>") % _html_cell(value)
                                             for i, value in enumerate(row)) for row in rows]
            body.append('<div class="wrap"><table><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (head, "".join(lines)))
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>%s</title>\n<style>\n%s\n</style>\n'
            "</head>\n<body>\n%s\n</body>\n</html>\n") % (html.escape(title), STYLE, "\n".join(body))


def _page(title: str, args, sections: List[Tuple[str, List[tuple]]], toc: bool = False, top: Optional[List[tuple]] = None) -> List[tuple]:
    """A whole page: the title, the intro (and stamp), an optional table of contents, then each nonempty section."""
    blocks: List[tuple] = [("h1", title), ("p", INTRO)] + (top or [])
    if getattr(args, "stamp", False):
        now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        blocks.append(("p", "Generated %s by lab.py report." % now))
    if toc:
        blocks.append(("list", [Link(heading, "#" + _slug(heading)) for heading, _ in sections]))
    for heading, content in sections:
        blocks.append(("h2", heading))
        blocks.extend(content)
    return blocks


def _table(columns: List[str], rows: List[list], empty: str) -> List[tuple]:
    return [("table", columns, rows)] if rows else [("p", empty)]


# ---------- writing ----------


def _outside(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    data = Path(workbench.WORKBENCH_DIR).expanduser().resolve()
    if resolved == data or data in resolved.parents:
        raise kit.CliError("%s is inside the Workbench data directory; write reports somewhere else" % path)
    return resolved


def _write(path_text: str, text: str, force: bool) -> Path:
    path = _outside(Path(path_text))
    if path.is_dir():
        raise kit.CliError("--out %s is a directory; name a file" % path_text)
    if not path.parent.is_dir():
        raise kit.CliError("--out %s: the folder %s does not exist" % (path_text, path.parent))
    if path.exists() and not force:
        raise kit.CliError("%s exists; pass --force to replace it" % path_text)
    path.write_text(text, encoding="utf-8")
    return path


def _deliver(args, title: str, blocks: List[tuple]) -> None:
    text = to_html(title, blocks) if args.html else to_markdown(blocks)
    if args.out:
        _write(args.out, text, args.force)
        print("Wrote the %s report to %s (%d bytes)." % ("HTML" if args.html else "Markdown", args.out, len(text.encode("utf-8"))))
    else:
        sys.stdout.write(text)


def _common(parser, title: str) -> None:
    parser.add_argument("--out", metavar="FILE", help="write the report to FILE, outside the Workbench data directory")
    parser.add_argument("--html", action="store_true", help="a self-contained HTML page instead of Markdown")
    parser.add_argument("--force", action="store_true", help="replace an existing --out file")
    parser.add_argument("--title", help="the report's title (default: %s)" % title)
    parser.add_argument("--stamp", action="store_true", help="add the UTC time the report was made")


def _sections(choices: Tuple[str, ...]):
    def parse(text: str) -> List[str]:
        words = [word.strip() for word in text.split(",") if word.strip()]
        bad = [word for word in words if word not in choices]
        if bad or not words:
            raise argparse.ArgumentTypeError("sections are a comma-separated list of: %s" % ", ".join(choices))
        return list(dict.fromkeys(words))
    return parse


def _share(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        value = -1.0
    if not 0 <= value <= 1:
        raise argparse.ArgumentTypeError("expected a share from 0 to 1, such as 0.8")
    return value


def _positive(text: str) -> int:
    if not text.isdigit() or int(text) < 1:
        raise argparse.ArgumentTypeError("expected a whole number of at least 1")
    return int(text)


# ---------- facts ----------


def _pct(part: int, whole: int) -> Optional[str]:
    return "%.1f%%" % (100.0 * part / whole) if whole else None


def _is_test(row: Any) -> bool:
    return isinstance(row, dict) and row.get(TEST) is True


def _labels(row: Any) -> dict:
    value = row.get(LABEL) if isinstance(row, dict) else None
    return value if isinstance(value, dict) else {}


def _questions(dataset: dict) -> Dict[str, dict]:
    value = dataset.get("questions")
    return {k: v for k, v in value.items() if isinstance(v, dict)} if isinstance(value, dict) else {}


def _check(dataset: dict) -> Optional[dict]:
    value = dataset.get("check")
    return value if isinstance(value, dict) else None


def _status(spec: dict, value: Any) -> str:
    if value is None:
        return "missing"
    try:
        valid, _ = health._label(spec, value)
    except (KeyError, TypeError, AttributeError):
        valid = False
    return "labeled" if valid else "invalid"


def _coverage(dataset: dict) -> List[dict]:
    """Per labelable question: valid, missing and invalid tuning labels, and valid held-out labels. Counts only."""
    tuning = [row for row in dataset["rows"] if not _is_test(row)]
    held = [row for row in dataset["rows"] if _is_test(row)]
    out = []
    for qid, spec in _questions(dataset).items():
        if spec.get("type") not in LABEL_TYPES:
            continue
        statuses = [_status(spec, _labels(row).get(qid)) for row in tuning]
        out.append({"question": qid, "type": spec["type"], "rows": len(tuning), "labeled": statuses.count("labeled"),
                    "missing": statuses.count("missing"), "invalid": statuses.count("invalid"),
                    "held_out": sum(_status(spec, _labels(row).get(qid)) == "labeled" for row in held)})
    return out


def _facts(dataset: dict) -> dict:
    rows = dataset["rows"]
    held = [row for row in rows if _is_test(row)]
    tuning = [row for row in rows if not _is_test(row)]
    test = dataset.get("test") if isinstance(dataset.get("test"), dict) else {}
    looks = test.get("looks") if isinstance(test.get("looks"), list) else []
    guides = dataset.get("guidelines") if isinstance(dataset.get("guidelines"), dict) else {}
    rules = [line for line in str(dataset.get("rules") or "").splitlines() if line.strip() and not line.strip().startswith("#")]
    return {"id": dataset["id"], "name": dataset.get("name") or dataset["id"], "notes": dataset.get("notes") or "",
            "saved": dataset.get("saved_at"), "rows": len(rows), "tuning": len(tuning), "held_out": len(held),
            "labeled": sum(any(v is not None for v in _labels(row).values()) for row in tuning),
            "held_out_labeled": sum(any(v is not None for v in _labels(row).values()) for row in held),
            "questions": len(_questions(dataset)), "check": _check(dataset) is not None, "rules": len(rules),
            "guidelines": len(guides), "looks": len(looks), "locked_at": test.get("locked_at")}


def _datasets(only: Optional[List[str]]) -> List[dict]:
    if only:
        return [workbench.load_dataset(ident) for ident in dict.fromkeys(only)]
    return [workbench.load_dataset(summary["id"]) for summary in workbench.list_datasets()]


def _tests() -> List[dict]:
    items = [item for item in workbench.list_items() if isinstance(item, dict) and isinstance(item.get("id"), str)]
    return sorted(items, key=lambda item: item["id"])


def _kept() -> List[list]:
    """[dataset id, kept revisions, newest revision time, live or deleted] for every dataset with history."""
    root = history.history_dir()
    out = []
    for folder in sorted(root.iterdir()) if root.is_dir() else []:
        if not folder.is_dir() or not re.fullmatch(r"[a-z0-9-]{1,60}", folder.name):
            continue
        kept = history._revisions(folder.name)
        if kept:
            stamp = history.REVISION.fullmatch(kept[-1].stem).group(1)
            when = datetime.datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").strftime("%Y-%m-%dT%H:%M:%SZ")
            out.append([folder.name, len(kept), when, "live" if workbench._dataset_path(folder.name).exists() else "deleted"])
    return out


def _below(datasets: List[dict], share: float) -> List[str]:
    out = []
    for dataset in datasets:
        for item in _coverage(dataset):
            if item["rows"] and item["labeled"] / item["rows"] < share:
                out.append("%s/%s" % (dataset["id"], item["question"]))
    return out


# ---------- sections ----------


def _overview_section(datasets: List[dict], tests: List[dict], kept: List[list]) -> List[tuple]:
    facts = [_facts(dataset) for dataset in datasets]
    rows = [["datasets", len(facts)], ["rows", sum(f["rows"] for f in facts)], ["tuning rows", sum(f["tuning"] for f in facts)],
            ["held-out rows", sum(f["held_out"] for f in facts)], ["labeled tuning rows", sum(f["labeled"] for f in facts)],
            ["questions asked", sum(f["questions"] for f in facts)], ["saved checks", sum(f["check"] for f in facts)],
            ["saved tests", len(tests)], ["datasets with kept history", sum(1 for row in kept if row[3] == "live")],
            ["deleted datasets with kept history", sum(1 for row in kept if row[3] == "deleted")]]
    return [("table", ["what", "count"], rows)]


SORTS = {"id": lambda f: f["id"], "name": lambda f: (str(f["name"]).lower(), f["id"]),
         "rows": lambda f: (-f["rows"], f["id"]), "labeled": lambda f: (-f["labeled"], f["id"]),
         "saved": lambda f: (str(f["saved"] or ""), f["id"])}


def _datasets_section(datasets: List[dict], sort: str = "id", links: Optional[Dict[str, str]] = None) -> List[tuple]:
    facts = sorted((_facts(dataset) for dataset in datasets), key=SORTS[sort])
    if sort == "saved":
        facts.reverse()
    rows = [[Link(f["name"], links[f["id"]]) if links else f["name"], f["id"], f["rows"], f["held_out"], f["labeled"],
             _pct(f["labeled"], f["tuning"]), f["questions"], f["check"], f["saved"]] for f in facts]
    return _table(["dataset", "id", "rows", "held out", "labeled", "labeled share", "questions", "check", "saved"], rows,
                  "No saved datasets.")


def _labels_rows(dataset: dict, with_dataset: bool) -> List[list]:
    out = []
    for item in _coverage(dataset):
        line = [item["question"], item["type"], item["labeled"], item["missing"], item["invalid"],
                _pct(item["labeled"], item["rows"]), item["held_out"]]
        out.append(([dataset["id"]] if with_dataset else []) + line)
    return out


LABEL_COLUMNS = ["question", "type", "labeled", "missing", "invalid", "coverage", "held-out labeled"]


def _labels_section(datasets: List[dict]) -> List[tuple]:
    rows = [line for dataset in datasets for line in _labels_rows(dataset, True)]
    return _table(["dataset"] + LABEL_COLUMNS, rows, "No dataset asks a Choice, Noul or Score question.")


def _check_line(dataset: dict) -> list:
    check = _check(dataset) or {}
    count = lambda key: len(check.get(key)) if isinstance(check.get(key), (dict, list)) else 0  # noqa: E731
    return [dataset["id"], check.get("model"), check.get("tuned_on"), check.get("signal", "confidence"), count("gates"),
            check.get("min_accuracy"), check.get("min_coverage"), count("slice_targets"), count("answer_sets"),
            len([line for line in str(check.get("rules") or "").splitlines() if line.strip()])]


CHECK_COLUMNS = ["dataset", "model", "tuned on", "signal", "gates", "min accuracy", "min coverage", "slice targets",
                 "answer sets", "rules"]


def _checks_section(datasets: List[dict]) -> List[tuple]:
    return _table(CHECK_COLUMNS, [_check_line(dataset) for dataset in datasets if _check(dataset)], "No saved checks.")


def _types(questions: Dict[str, dict]) -> str:
    counts: Dict[str, int] = {}
    for spec in questions.values():
        counts[str(spec.get("type"))] = counts.get(str(spec.get("type")), 0) + 1
    return ", ".join("%d %s" % (n, kind) for kind, n in sorted(counts.items()))


def _test_questions(item: dict) -> Dict[str, dict]:
    value = item.get("questions")
    return {k: v for k, v in value.items() if isinstance(v, dict)} if isinstance(value, dict) else {}


def _test_expect(item: dict) -> dict:
    value = item.get("expect")
    return value if isinstance(value, dict) else {}


def _tests_section(tests: List[dict]) -> List[tuple]:
    """Saved tests in id order (_tests sorts them)."""
    rows = [[item["id"], item.get("name"), len(_test_questions(item)), _types(_test_questions(item)), len(_test_expect(item)),
             len(item.get("images")) if isinstance(item.get("images"), dict) else 0, item.get("saved_at")] for item in tests]
    return _table(["test", "name", "questions", "types", "expectations", "pictures", "saved"], rows, "No saved tests.")


def _history_section(kept: List[list]) -> List[tuple]:
    return _table(["dataset", "revisions kept", "newest revision", "file"], kept, "No dataset history is kept.")


# ---------- report data ----------


def _configure_data(parser) -> None:
    _common(parser, "Workbench data report")
    parser.add_argument("--sections", type=_sections(DATA_SECTIONS), metavar="LIST",
                        help="comma-separated sections in order (default: %s)" % ",".join(DATA_SECTIONS))
    parser.add_argument("--toc", action="store_true", help="add a table of contents linking each section")
    parser.add_argument("--dataset", action="append", metavar="ID", help="report only this dataset (repeatable)")
    parser.add_argument("--fail-under", type=_share, metavar="SHARE",
                        help="exit 1 when a question's tuning label coverage in a reported dataset is below SHARE")
    parser.add_argument("--sort", choices=tuple(SORTS), default="id", help="order of the datasets table (default: id)")


def _data_blocks(args, links: Optional[Dict[str, str]] = None) -> Tuple[str, List[tuple], List[dict]]:
    datasets = _datasets(getattr(args, "dataset", None))
    only = [dataset["id"] for dataset in datasets] if getattr(args, "dataset", None) else None
    tests, kept = _tests(), [row for row in _kept() if not only or row[0] in only]
    builders = {"overview": ("Overview", lambda: _overview_section(datasets, tests, kept)),
                "datasets": ("Datasets", lambda: _datasets_section(datasets, getattr(args, "sort", "id"), links)),
                "labels": ("Label coverage", lambda: _labels_section(datasets)),
                "checks": ("Saved checks", lambda: _checks_section(datasets)),
                "tests": ("Saved tests", lambda: _tests_section(tests)),
                "history": ("Revision history", lambda: _history_section(kept))}
    chosen = getattr(args, "sections", None) or list(DATA_SECTIONS)
    sections = [(builders[key][0], builders[key][1]()) for key in chosen]
    title = args.title or "Workbench data report"
    return title, _page(title, args, sections, getattr(args, "toc", False)), datasets


def run_data(args) -> int:
    title, blocks, datasets = _data_blocks(args)
    _deliver(args, title, blocks)
    if args.fail_under is not None:
        below = _below(datasets, args.fail_under)
        if below:
            print("lab.py: label coverage below %g: %s" % (args.fail_under, ", ".join(below)), file=sys.stderr)
            return 1
    return 0


# ---------- report dataset ----------


def _configure_dataset(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    _common(parser, "the dataset's name")
    parser.add_argument("--sections", type=_sections(DATASET_SECTIONS), metavar="LIST",
                        help="comma-separated sections in order (default: %s)" % ",".join(DATASET_SECTIONS))
    parser.add_argument("--criteria", action="store_true", help="list every Choice option and Score level with its description")
    parser.add_argument("--revisions", type=_positive, default=5, metavar="N", help="list the newest N kept revisions (default 5)")
    parser.add_argument("--since-revision", metavar="REVISION",
                        help="add what changed from a kept revision (an id, a unique prefix, latest or oldest) to now")


def _dataset_overview(dataset: dict) -> List[tuple]:
    f = _facts(dataset)
    rows = [["id", f["id"]], ["name", f["name"]], ["notes", f["notes"]], ["saved", f["saved"]], ["rows", f["rows"]],
            ["tuning rows", f["tuning"]], ["held-out rows", f["held_out"]], ["labeled tuning rows", f["labeled"]],
            ["labeled held-out rows", f["held_out_labeled"]], ["questions", f["questions"]], ["rules", f["rules"]],
            ["labeling guidelines", f["guidelines"]], ["saved check", f["check"]], ["test looks", f["looks"]],
            ["test split locked", f["locked_at"]]]
    return [("table", ["field", "value"], rows)]


def _dataset_questions(dataset: dict, criteria: bool) -> List[tuple]:
    asked = _questions(dataset)
    rows = []
    for number, (qid, spec) in enumerate(asked.items(), 1):
        options = spec.get("criteria")
        count = len(options) if spec.get("type") in ("choice", "score") and isinstance(options, (dict, list)) else None
        rows.append([number, qid, spec.get("type"), count, spec.get("instructions")])
    blocks = _table(["#", "question", "type", "options", "instructions"], rows, "This dataset saves no questions.")
    if criteria:
        detail = []
        for qid, spec in asked.items():
            options = spec.get("criteria")
            if spec.get("type") == "choice" and isinstance(options, dict):
                detail += [[qid, key, text] for key, text in options.items()]
            elif spec.get("type") == "score" and isinstance(options, list):
                detail += [[qid, level, text] for level, text in enumerate(options)]
        if detail:
            blocks.append(("table", ["question", "option", "description"], detail))
    return blocks


def _dataset_fields(dataset: dict) -> List[tuple]:
    """Input field names and how many tuning rows fill them; held-out rows are left out so no field they alone carry shows."""
    tuning = [row for row in dataset["rows"] if not _is_test(row)]
    counts: Dict[str, int] = {}
    for row in tuning:
        fields = {"text": "x"} if isinstance(row, str) else {k: v for k, v in row.items() if k not in (LABEL, TEST)} if isinstance(row, dict) else {}
        for name, value in fields.items():
            counts.setdefault(name, 0)
            counts[name] += value not in (None, "")
    rows = [[name, filled, _pct(filled, len(tuning))] for name, filled in counts.items()]
    return _table(["field", "tuning rows filled", "share"], rows, "No tuning rows.")


def _dataset_check(dataset: dict) -> List[tuple]:
    check = _check(dataset)
    if not check:
        return [("p", "No saved check.")]
    asked = _questions(dataset)
    rules = [line for line in str(check.get("rules") or "").splitlines() if line.strip()]
    blocks: List[tuple] = [("table", ["field", "value"], [
        ["model", check.get("model")], ["tuned on", check.get("tuned_on")], ["signal", check.get("signal", "confidence")],
        ["bound", check.get("bound", "estimate")], ["min accuracy", check.get("min_accuracy")],
        ["min coverage", check.get("min_coverage")], ["rules", len(rules)], ["saved", check.get("saved_at")]])]
    gates = check.get("gates") if isinstance(check.get("gates"), dict) else {}
    if gates:
        blocks.append(("table", ["gated question", "type", "threshold"],
                       [[qid, (asked.get(qid) or {}).get("type"), value] for qid, value in gates.items()]))
    targets = check.get("slice_targets") if isinstance(check.get("slice_targets"), list) else []
    if targets:
        blocks.append(("table", ["slice field", "value", "min accuracy", "min coverage"],
                       [[t.get("field"), t.get("value"), t.get("min_accuracy"), t.get("min_coverage")] for t in targets if isinstance(t, dict)]))
    cuts = check.get("answer_sets") if isinstance(check.get("answer_sets"), dict) else {}
    if cuts:
        blocks.append(("table", ["answer-set question", "cut", "coverage"],
                       [[qid, (c or {}).get("cut"), (c or {}).get("coverage")] for qid, c in cuts.items() if isinstance(c, dict)]))
    if rules:
        blocks.append(("list", rules))
    return blocks


def _dataset_guidelines(dataset: dict) -> List[tuple]:
    guides = dataset.get("guidelines") if isinstance(dataset.get("guidelines"), dict) else {}
    rows = [[qid, bool(str((g or {}).get("note") or "").strip()), len((g or {}).get("examples") or [])]
            for qid, g in guides.items() if isinstance(g, dict)]
    return _table(["question", "note", "examples"], rows, "No labeling guidelines.")


def _dataset_history(dataset_id: str, limit: int) -> List[tuple]:
    found = history.revisions(dataset_id)["revisions"]
    rows = [[entry["revision"], entry["at"][:19] + "Z", entry.get("rows"), entry.get("labeled"), entry.get("test_rows"),
             entry["current"]] for entry in found[:limit]]
    blocks = _table(["revision", "kept at", "rows", "labeled", "held out", "same as now"], rows, "No revisions kept.")
    if len(found) > limit:
        older = len(found) - limit
        blocks.append(("p", "%d older revision%s kept and not listed." % (older, " is" if older == 1 else "s are")))
    return blocks


def _pick_revision(dataset_id: str, word: str) -> Tuple[str, dict]:
    kept = [path.stem for path in history._revisions(dataset_id)]
    if not kept:
        raise kit.CliError("No revisions kept for %r" % dataset_id)
    if word in ("latest", "oldest"):
        found = [kept[-1] if word == "latest" else kept[0]]
    else:
        found = [rev for rev in kept if rev == word] or [rev for rev in kept if rev.startswith(word)]
    if len(found) != 1:
        raise kit.CliError("%r matches %d kept revisions of %r; give one revision id" % (word, len(found), dataset_id))
    return found[0], history._read(dataset_id, found[0])


def _dataset_changes(dataset: dict, word: str) -> Tuple[str, List[tuple]]:
    revision, before = _pick_revision(dataset["id"], word)
    summary = dataset_changes.summarize(before, dataset, "-")
    rows, labels, test = summary["rows"], summary["labels"], summary["test"]
    return revision, [("table", ["change", "count"], [
        ["rows then", rows["before"]], ["rows now", rows["after"]], ["rows added", rows["added"]], ["rows removed", rows["removed"]],
        ["row order changed", rows["order_changed"]], ["labels added", labels["added"]], ["labels removed", labels["removed"]],
        ["labels changed", labels["changed"]], ["held-out rows then", test["before"]], ["held-out rows now", test["after"]],
        ["rows moved in or out of the held-out split", test["changed_membership"]],
        ["questions changed", summary["questions_changed"]], ["rules changed", summary["rules_changed"]],
        ["name or notes changed", summary["metadata_changed"]], ["check changed", summary["check_changed"]]])]


def _dataset_blocks(args, dataset: dict, top: Optional[List[tuple]] = None) -> Tuple[str, List[tuple]]:
    builders = {"overview": ("Overview", lambda: _dataset_overview(dataset)),
                "questions": ("Questions", lambda: _dataset_questions(dataset, getattr(args, "criteria", False))),
                "labels": ("Label coverage", lambda: _table(LABEL_COLUMNS, _labels_rows(dataset, False),
                                                            "No Choice, Noul or Score question is saved.")),
                "fields": ("Input fields", lambda: _dataset_fields(dataset)),
                "check": ("Saved check", lambda: _dataset_check(dataset)),
                "guidelines": ("Labeling guidelines", lambda: _dataset_guidelines(dataset)),
                "history": ("Revision history", lambda: _dataset_history(dataset["id"], getattr(args, "revisions", 5)))}
    chosen = getattr(args, "sections", None) or list(DATASET_SECTIONS)
    sections = [(builders[key][0], builders[key][1]()) for key in chosen]
    if getattr(args, "since_revision", None):
        revision, blocks = _dataset_changes(dataset, args.since_revision)
        sections.append(("Changes since revision %s" % revision, blocks))
    title = getattr(args, "title", None) or "Dataset report: %s" % (dataset.get("name") or dataset["id"])
    return title, _page(title, args, sections, top=top)


def run_dataset(args) -> int:
    title, blocks = _dataset_blocks(args, workbench.load_dataset(args.dataset))
    _deliver(args, title, blocks)
    return 0


# ---------- report site ----------


def _configure_site(parser) -> None:
    parser.add_argument("--out-dir", required=True, metavar="DIR",
                        help="folder for the pages, outside the Workbench data directory (created when its parent exists)")
    parser.add_argument("--markdown", action="store_true", help="write Markdown pages instead of HTML")
    parser.add_argument("--force", action="store_true", help="replace pages that already exist")
    parser.add_argument("--title", help="the index page's title (default: Workbench data report)")
    parser.add_argument("--stamp", action="store_true", help="add the UTC time the pages were made")


def run_site(args) -> int:
    folder = _outside(Path(args.out_dir))
    if folder.exists() and not folder.is_dir():
        raise kit.CliError("--out-dir %s is a file" % args.out_dir)
    if not folder.parent.is_dir():
        raise kit.CliError("--out-dir %s: the folder %s does not exist" % (args.out_dir, folder.parent))
    ext = "md" if args.markdown else "html"
    datasets = _datasets(None)
    links = {dataset["id"]: "dataset-%s.%s" % (dataset["id"], ext) for dataset in datasets}
    index = "index.%s" % ext
    taken = [name for name in [index] + list(links.values()) if (folder / name).exists()]
    if taken and not args.force:
        raise kit.CliError("%d page(s) already exist in %s, such as %s; pass --force to replace them" % (len(taken), args.out_dir, taken[0]))
    page_args = argparse.Namespace(title=args.title, stamp=args.stamp, sort="id", sections=None, toc=True, dataset=None)
    title, blocks, _ = _data_blocks(page_args, links)
    pages = {index: to_markdown(blocks) if args.markdown else to_html(title, blocks)}
    for dataset in datasets:
        dataset_args = argparse.Namespace(title=None, stamp=args.stamp, sections=None, criteria=False, revisions=5, since_revision=None)
        title, blocks = _dataset_blocks(dataset_args, dataset, top=[("list", [Link("Back to the index", index)])])
        pages[links[dataset["id"]]] = to_markdown(blocks) if args.markdown else to_html(title, blocks)
    folder.mkdir(exist_ok=True)
    for name, text in pages.items():
        (folder / name).write_text(text, encoding="utf-8")
    print("Wrote %d %s pages to %s: %s" % (len(pages), "Markdown" if args.markdown else "HTML", args.out_dir, ", ".join(pages)))
    return 0


PACK = kit.define_pack({
    "id": "cli-report",
    "surface": "python.cli",
    "title": "Workbench data reports",
    "about": "Offline `lab.py report` commands that write one-page Markdown or HTML summaries of the Workbench data: "
             "datasets, label coverage, held-out counts, saved checks, saved tests and kept revision history, for one "
             "dataset or the whole data directory, or a linked set of pages. Counts and configuration only; reports "
             "are written outside the data directory.",
    "features": [
        {"id": "data", "kind": "cli", "command": ["report", "data"], "configure": _configure_data, "run": run_data,
         "title": "a one-page Markdown summary of the whole data directory: overview, datasets, label coverage, checks, tests, history",
         "options": [
             {"id": "out", "title": "--out FILE writes the report to a file outside the Workbench data directory"},
             {"id": "html", "title": "--html makes a self-contained HTML page with light and dark styles"},
             {"id": "force", "title": "--force replaces an existing report file, which is otherwise refused"},
             {"id": "title", "title": "--title TEXT names the report"},
             {"id": "stamp", "title": "--stamp adds the UTC time the report was made"},
             {"id": "sections", "title": "--sections LIST picks the sections and their order"},
             {"id": "toc", "title": "--toc adds a table of contents linking each section"},
             {"id": "dataset", "title": "--dataset ID reports only the named datasets"},
             {"id": "fail_under", "title": "--fail-under SHARE exits 1 when a question's tuning label coverage is below SHARE"},
             {"id": "sort", "title": "--sort id|name|rows|labeled|saved orders the datasets table"},
         ]},
        {"id": "dataset", "kind": "cli", "command": ["report", "dataset"], "configure": _configure_dataset, "run": run_dataset,
         "title": "a one-page report on one dataset: counts, questions, label coverage, input fields, check, guidelines, history",
         "options": [
             {"id": "sections", "title": "--sections LIST picks the dataset report's sections and their order"},
             {"id": "criteria", "title": "--criteria lists every Choice option and Score level with its description"},
             {"id": "revisions", "title": "--revisions N lists the newest N kept revisions"},
             {"id": "since_revision", "title": "--since-revision REV adds what changed from a kept revision to now, as counts"},
         ]},
        {"id": "site", "kind": "cli", "command": ["report", "site"], "configure": _configure_site, "run": run_site,
         "title": "write a linked set of HTML pages, an index and one page per dataset, to a folder outside the data directory",
         "options": [
             {"id": "markdown", "title": "--markdown writes the linked pages as Markdown"},
         ]},
    ],
})
