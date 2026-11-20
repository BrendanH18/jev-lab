"""Offline commands for dataset bundles (`lab.py bundles ...`), the ZIP files the Datasets panel exports and imports.

A bundle (jev/bundles.py) carries a dataset's inputs, human labels, question and gate configuration, test-split history
and referenced pictures; never model answers or measured results. These commands inspect a bundle file before it is
imported: summarize it, validate it as the import would, list its pictures and questions, and say in counts what
importing it over a saved dataset would change. `bundles export` writes a saved dataset's bundle to a file.

Nothing here imports a bundle or writes into the Workbench data directory, and nothing prints a label value: label
counts come from tuning rows, and held-out rows are only counted.
"""

from __future__ import annotations

import base64
import io
import json
import zipfile
from typing import Any, Dict, List, Tuple

from jev import bundles, dataset_changes, decisions, images, workbench
from jev.lab import kit
from jev.lab.packs import cli_gates

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
LABEL_TYPES = ("choice", "noul", "score")


# ---------- reading a bundle file ----------


def _bytes(path: str) -> bytes:
    if ".." in path:
        raise Exception("Invalid file path")
    try:
        with open(path, "rb") as handle:
            data = handle.read(bundles.MAX_BUNDLE_BYTES + 1)
    except OSError as err:
        raise kit.CliError("cannot read %s: %s" % (path, err))
    if len(data) > bundles.MAX_BUNDLE_BYTES:
        raise kit.CliError("%s is over the 8 MiB bundle limit" % path)
    return data


def _read(path: str) -> Tuple[dict, Dict[str, bytes], bytes]:
    """(dataset as the import would save it, stored pictures by name, the file's bytes). Invalid bundles exit 2."""
    raw = _bytes(path)
    try:
        dataset, pictures = bundles._read(base64.b64encode(raw).decode("ascii"))
    except workbench.WorkbenchError as err:
        raise kit.CliError("%s is not a valid dataset bundle: %s" % (path, err))
    return dataset, pictures, raw


def _held_out(row: Any) -> bool:
    return isinstance(row, dict) and row.get(workbench.TEST_KEY) is True


def _labeled(row: Any) -> bool:
    labels = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
    return isinstance(labels, dict) and any(value is not None for value in labels.values())


def _file_argument(parser: Any) -> None:
    parser.add_argument(
        "file", help="a dataset bundle (.zip) exported from the Datasets panel or `lab.py bundles export`"
    )


# ---------- bundles show ----------


def _configure_show(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--json", action="store_true", help="print the summary as one JSON object")


def run_show(args: Any) -> int:
    dataset, pictures, raw = _read(args.file)
    rows = dataset["rows"]
    check = dataset.get("check") if isinstance(dataset.get("check"), dict) else None
    test = dataset.get("test") if isinstance(dataset.get("test"), dict) else {}
    facts = {
        "name": dataset["name"],
        "id": dataset["id"],
        "bytes": len(raw),
        "rows": len(rows),
        "held_out_rows": sum(_held_out(row) for row in rows),
        "labeled_tuning_rows": sum(_labeled(row) for row in rows if not _held_out(row)),
        "questions": len(dataset.get("questions") or {}),
        "pictures": len(pictures),
        "picture_bytes": sum(len(data) for data in pictures.values()),
        "rules": bool(dataset.get("rules")),
        "check_model": check.get("model") if check else None,
        "guidelines": len(dataset.get("guidelines") or {}),
        "test_looks": len(test.get("looks") or []),
        "saved_dataset_exists": workbench._dataset_path(dataset["id"]).exists(),
    }
    if args.json:
        print(json.dumps(facts, ensure_ascii=False))
    else:
        kit.emit(args, ["fact", "value"], [[key.replace("_", " "), value] for key, value in facts.items()])
    return 0


# ---------- bundles validate ----------


def _configure_validate(parser: Any) -> None:
    _file_argument(parser)


def run_validate(args: Any) -> int:
    raw = _bytes(args.file)
    try:
        dataset, pictures = bundles._read(base64.b64encode(raw).decode("ascii"))
    except workbench.WorkbenchError as err:
        print("invalid bundle: %s" % err)
        return 1
    print("valid bundle of %s: %d rows, %d pictures" % (dataset["name"], len(dataset["rows"]), len(pictures)))
    return 0


# ---------- bundles pictures ----------


def _configure_pictures(parser: Any) -> None:
    _file_argument(parser)
    kit.add_format(parser)


def run_pictures(args: Any) -> int:
    dataset, _pictures, raw = _read(args.file)
    uses: Dict[str, int] = {}
    for row in dataset["rows"]:
        name = row.get(workbench.IMAGE_KEY) if isinstance(row, dict) else None
        if isinstance(name, str):
            uses[name] = uses.get(name, 0) + 1
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in sorted(name for name in archive.namelist() if name.startswith("images/")):
            info = images.check(archive.read(entry))
            stored = "%s.%s" % (info["sha"], info["format"])
            rows.append(
                [
                    entry[len("images/") :],
                    stored,
                    info["format"],
                    info["width"],
                    info["height"],
                    info["bytes"],
                    uses.get(stored, 0),
                    (workbench.images_dir() / stored).is_file(),
                ]
            )
    cli_gates._table_or(
        args,
        ["in bundle", "saved as", "format", "width", "height", "bytes", "rows", "already saved"],
        rows,
        "the bundle holds no pictures",
    )
    return 0


# ---------- bundles questions ----------


def _configure_questions(parser: Any) -> None:
    _file_argument(parser)
    kit.add_format(parser)


def run_questions(args: Any) -> int:
    dataset, _pictures, _raw = _read(args.file)
    tuning = [row for row in dataset["rows"] if not _held_out(row)]
    rows = []
    for qid, question in (dataset.get("questions") or {}).items():
        qtype = question.get("type")
        valid = 0
        if qtype in LABEL_TYPES:
            for row in tuning:
                labels = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
                if isinstance(labels, dict) and qid in labels:
                    ok, label = decisions.label(question, labels[qid])
                    valid += ok and label is not None
        criteria = question.get("criteria")
        gated = qid in ((dataset.get("check") or {}).get("gates") or {})
        rows.append(
            [
                qid,
                qtype,
                len(criteria) if isinstance(criteria, (dict, list)) else 0,
                valid if qtype in LABEL_TYPES else None,
                gated,
                bool((dataset.get("guidelines") or {}).get(qid)),
            ]
        )
    cli_gates._table_or(
        args,
        ["question", "type", "options or levels", "labeled tuning rows", "gated", "guideline"],
        rows,
        "the bundle holds no questions",
    )
    return 0


# ---------- bundles diff ----------


def _configure_diff(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument(
        "--dataset", metavar="ID", help="compare with this saved dataset instead of the one the bundle's name gives"
    )
    kit.add_format(parser)


def run_diff(args: Any) -> int:
    dataset, _pictures, _raw = _read(args.file)
    target = args.dataset or dataset["id"]
    try:
        prior = workbench.load_dataset(target)
    except workbench.WorkbenchError:
        if args.dataset:
            raise
        prior = {}
    summary = dataset_changes.summarize(prior, dataset, "")
    guides = summary["guidelines"]
    rows: List[list] = [
        ["rows", summary["rows"]["before"], summary["rows"]["after"]],
        ["rows added", None, summary["rows"]["added"]],
        ["rows removed", None, summary["rows"]["removed"]],
        ["row order changed", None, summary["rows"]["order_changed"]],
        ["labels added", None, summary["labels"]["added"]],
        ["labels removed", None, summary["labels"]["removed"]],
        ["labels changed", None, summary["labels"]["changed"]],
        ["questions changed", None, summary["questions_changed"]],
        ["rules changed", None, summary["rules_changed"]],
        ["name or notes changed", None, summary["metadata_changed"]],
        ["check changed", None, summary["check_changed"]],
        ["guidelines", guides["before"], guides["after"]],
        [
            "guidelines added, removed or changed",
            None,
            len(guides["added"]) + len(guides["removed"]) + len(guides["changed"]),
        ],
        ["held-out rows", summary["test"]["before"], summary["test"]["after"]],
        ["rows moved in or out of the split", None, summary["test"]["changed_membership"]],
    ]
    if args.format == "table":
        print(
            "importing %s over %s"
            % (args.file, ("saved dataset %s" % target) if prior else "no saved dataset (it would be new)")
        )
    kit.emit(args, ["change", "saved", "bundle"], rows)
    changed = any(row[2] not in (0, False) if row[1] is None else row[1] != row[2] for row in rows)
    return 1 if changed else 0


# ---------- bundles export ----------


def _configure_export(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument(
        "--out", required=True, metavar="PATH", help="the .zip file to write, outside the Workbench data directory"
    )
    parser.add_argument("--force", action="store_true", help="replace the --out file if it exists")


def run_export(args: Any) -> int:
    target = cli_gates._out_path(args.out, args.force)
    data = base64.b64decode(bundles.export_bundle(args.dataset)["data"])
    target.write_bytes(data)
    print("wrote the bundle of %s to %s (%d bytes)" % (args.dataset, args.out, len(data)))
    return 0


PACK = kit.define_pack(
    {
        "id": "cli-bundles",
        "surface": "python.cli",
        "title": "Dataset bundle commands",
        "about": "Offline `lab.py bundles` commands that inspect a dataset bundle before importing it (summary, validation, "
        "pictures, questions, and what importing it over a saved dataset would change, in counts) and export a "
        "saved dataset's bundle to a file. Nothing is imported, and no label value is printed.",
        "features": [
            {
                "id": "show",
                "kind": "cli",
                "command": ["bundles", "show"],
                "configure": _configure_show,
                "run": run_show,
                "title": "Summarize a bundle file: name, rows, held-out and labeled rows, questions, pictures, rules, check model, guidelines and looks",
                "options": [{"id": "json", "title": "--json prints the summary as one JSON object"}],
            },
            {
                "id": "validate",
                "kind": "cli",
                "command": ["bundles", "validate"],
                "configure": _configure_validate,
                "run": run_validate,
                "title": "Validate a bundle file exactly as the import would, without importing it; exit 1 when it is invalid",
            },
            {
                "id": "pictures",
                "kind": "cli",
                "command": ["bundles", "pictures"],
                "configure": _configure_pictures,
                "run": run_pictures,
                "title": "List a bundle's pictures: the name in the bundle, the name it is saved as, format, size, rows and whether it is already saved",
                "options": [dict(FORMAT)],
            },
            {
                "id": "questions",
                "kind": "cli",
                "command": ["bundles", "questions"],
                "configure": _configure_questions,
                "run": run_questions,
                "title": "List a bundle's questions with their options or levels, valid labels on tuning rows, and whether a gate or guideline covers them",
                "options": [dict(FORMAT)],
            },
            {
                "id": "diff",
                "kind": "cli",
                "command": ["bundles", "diff"],
                "configure": _configure_diff,
                "run": run_diff,
                "title": "Say in counts what importing a bundle over the saved dataset would change: rows, labels, questions, rules, check, guidelines and split; exit 1 if anything",
                "options": [
                    {"id": "dataset", "title": "--dataset ID compares with another saved dataset"},
                    dict(FORMAT),
                ],
            },
            {
                "id": "export",
                "kind": "cli",
                "command": ["bundles", "export"],
                "configure": _configure_export,
                "run": run_export,
                "title": "Write a saved dataset's bundle (.zip) to a file outside the Workbench data directory",
                "options": [{"id": "force", "title": "--force replaces an existing --out file"}],
            },
        ],
    }
)
