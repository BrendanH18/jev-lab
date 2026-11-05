"""Portable Workbench datasets: configuration, human labels, and their picture bytes, never run results."""

from __future__ import annotations

import base64
import binascii
import io
import json
import time
import zipfile
import zlib
from typing import Any, Dict, Tuple

from . import calibrate, checks, images, policy, rules, testsplit, workbench
from .workbench import WorkbenchError

FORMAT = "jev-lab-dataset"
VERSION = 1
MAX_BUNDLE_BYTES = 8 * 1024 * 1024  # base64 still fits the server's 12 MiB request limit
MAX_BASE64_CHARS = (MAX_BUNDLE_BYTES + 2) // 3 * 4


def _text(value: Any, field: str, limit: int, optional: bool = False) -> str:
    if optional and value is None:
        return ""
    if not isinstance(value, str) or len(value) > limit:
        raise WorkbenchError("Bundle %s must be text, up to %d characters" % (field, limit))
    return value


def _test_history(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise WorkbenchError("Bundle test history must be an object")
    looks = raw.get("looks", [])
    if not isinstance(looks, list) or len(looks) > testsplit.MAX_LOOKS_KEPT:
        raise WorkbenchError("Bundle test history has too many looks or is not a list")
    clean = []
    for look in looks:
        if not isinstance(look, dict):
            raise WorkbenchError("Each bundle test look must be an object")
        try:
            gates = policy._gates(look.get("gates"))
        except calibrate.CalibrationError as err:
            raise WorkbenchError(str(err)) from err
        signal = look.get("signal", "confidence")
        if signal not in calibrate.SIGNALS:
            raise WorkbenchError("Invalid signal in bundle test history")
        entry = {"at": _text(look.get("at"), "test look date", 100), "gates": gates, "signal": signal}
        if "model" in look:
            entry["model"] = _text(look["model"], "test look model", 100)
        clean.append(entry)
    locked = raw.get("locked_at")
    return {"locked_at": _text(locked, "test split date", 100) if locked is not None else None, "looks": clean}


def _dataset(raw: Any, name: Any = None) -> dict:
    """Allowlist persistence fields; existing validators supply the canonical configuration."""
    if not isinstance(raw, dict):
        raise WorkbenchError("Bundle dataset must be an object")
    name = _text(raw.get("name") if name is None else name, "name", 120).strip()
    out = {"id": workbench.slugify(name), "name": name,
           "notes": _text(raw.get("notes"), "notes", 2000, optional=True),
           "rows": workbench.validate_rows(raw.get("rows"))}
    if "saved_at" in raw:
        out["saved_at"] = _text(raw["saved_at"], "saved date", 100)
    if raw.get("questions"):
        out["questions"] = workbench.bulk_questions(raw["questions"])
        workbench._need_pictures([workbench.split_labels(row, i + 1) for i, row in enumerate(out["rows"])],
                                 out["questions"])
    if raw.get("rules"):
        try:
            parsed = rules.parse(raw["rules"])
            rules.check(parsed, rules.kinds_from_questions(out.get("questions") or {}))
        except calibrate.CalibrationError as err:
            raise WorkbenchError(str(err)) from err
        if parsed:
            out["rules"] = raw["rules"].strip()
    if "check" in raw:
        out["check"] = checks.validate_check(raw["check"], out.get("questions"))
        if "saved_at" in raw["check"]:
            out["check"]["saved_at"] = _text(raw["check"]["saved_at"], "check saved date", 100)
    if "test" in raw:
        out["test"] = _test_history(raw["test"])
    elif any(isinstance(row, dict) and row.get(workbench.TEST_KEY) is True for row in out["rows"]):
        raise WorkbenchError("Bundle test rows need their test-split history")
    if len(workbench._dataset_text(out)) > workbench.MAX_DATASET_CHARS:
        raise WorkbenchError("The bundle dataset is too large to save")
    return out


def _names(dataset: dict) -> list:
    return sorted({name for row in dataset["rows"] if (name := workbench.row_picture(row)) is not None})


def export_bundle(dataset_id: str) -> dict:
    """Return {filename, data}, with base64 ZIP bytes for a saved dataset and every referenced picture."""
    with workbench.dataset_update():
        dataset = _dataset(workbench.load_dataset(dataset_id))
    files = {"dataset.json": json.dumps({"format": FORMAT, "version": VERSION, "dataset": dataset},
                                       ensure_ascii=False, allow_nan=False).encode("utf-8")}
    total = sum(map(len, files.values()))
    if total > MAX_BUNDLE_BYTES:
        raise WorkbenchError("Dataset bundle exceeds the 8 MiB limit; split the dataset")
    for name in _names(dataset):
        picture = workbench.picture_asset(name)["data"]
        total += len(picture)
        if total > MAX_BUNDLE_BYTES:
            raise WorkbenchError("Dataset bundle exceeds the 8 MiB limit; split the dataset")
        files["images/" + name] = picture
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    data = buffer.getvalue()
    if len(data) > MAX_BUNDLE_BYTES:
        raise WorkbenchError("Dataset bundle exceeds the 8 MiB limit; split the dataset")
    return {"filename": dataset["id"] + ".zip", "data": base64.b64encode(data).decode("ascii")}


def _reject_constant(value: str) -> None:
    raise ValueError("Non-finite JSON number: " + value)


def _read(data: Any, name: Any = None) -> Tuple[dict, Dict[str, bytes]]:
    if not isinstance(data, str) or not data or len(data) > MAX_BASE64_CHARS:
        raise WorkbenchError("Provide a base64 ZIP bundle up to 8 MiB")
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as err:
        raise WorkbenchError("Bundle data is not valid base64") from err
    if len(raw) > MAX_BUNDLE_BYTES:
        raise WorkbenchError("Bundle exceeds the 8 MiB limit")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            paths = [entry.filename for entry in entries]
            if len(entries) > workbench.MAX_BULK_ROWS + 1 or len(paths) != len(set(paths)):
                raise WorkbenchError("Bundle has too many files or duplicate names")
            if sum(entry.file_size for entry in entries) > MAX_BUNDLE_BYTES:
                raise WorkbenchError("Expanded bundle exceeds the 8 MiB limit")
            if "dataset.json" not in paths:
                raise WorkbenchError("Bundle needs dataset.json")
            if archive.getinfo("dataset.json").file_size > workbench.MAX_DATASET_CHARS * 4:
                raise WorkbenchError("Bundle dataset.json is too large")
            manifest = json.loads(archive.read("dataset.json"), parse_constant=_reject_constant)
            if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or type(manifest.get("version")) is not int or manifest["version"] != VERSION:
                raise WorkbenchError("Unsupported dataset bundle format or version")
            dataset = _dataset(manifest.get("dataset"), name)
            names = _names(dataset)
            if set(paths) != {"dataset.json"} | {"images/" + image for image in names}:
                raise WorkbenchError("Bundle files must be dataset.json and exactly its referenced images")
            pictures = {}
            renamed = {}
            for image in names:
                entry = images.asset(archive.read("images/" + image))
                stored = "%s.%s" % (entry["sha"], entry["format"])
                if image not in images.SAMPLES and image != stored:
                    raise WorkbenchError("Bundle image filename does not match its content: %s" % image)
                pictures[stored] = entry["data"]
                renamed[image] = stored
            dataset["rows"] = [dict(row, **{workbench.IMAGE_KEY: renamed[row[workbench.IMAGE_KEY]]})
                               if isinstance(row, dict) and workbench.IMAGE_KEY in row else row
                               for row in dataset["rows"]]
            if len(workbench._dataset_text(dataset)) > workbench.MAX_DATASET_CHARS:
                raise WorkbenchError("The bundle dataset is too large to save")
            return dataset, pictures
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError, UnicodeError, ValueError,
            RecursionError, zlib.error) as err:
        if isinstance(err, WorkbenchError):
            raise
        raise WorkbenchError("Invalid dataset bundle: %s" % err) from err


def preview_bundle(data: Any, name: Any = None) -> dict:
    """Validate without writing; return the dataset, list summary, picture count, and destination conflict."""
    dataset, pictures = _read(data, name)
    return {"dataset": dataset, "summary": workbench.dataset_summary(dataset), "images": len(pictures),
            "exists": workbench._dataset_path(dataset["id"]).exists()}


@workbench.dataset_update()
def import_bundle(data: Any, name: Any = None, replace: Any = False) -> dict:
    """Validate completely before storing pictures and atomically saving the dataset; replacement is opt-in."""
    if not isinstance(replace, bool):
        raise WorkbenchError("replace must be true or false")
    dataset, pictures = _read(data, name)
    if workbench._dataset_path(dataset["id"]).exists() and not replace:
        raise WorkbenchError("A dataset named %r already exists. Confirm replacement or choose another name."
                             % dataset["name"])
    dataset["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if len(workbench._dataset_text(dataset)) > workbench.MAX_DATASET_CHARS:
        raise WorkbenchError("The bundle dataset is too large to save")
    # Check all collisions before writing. Never replace an existing picture, even during dataset replacement.
    for filename, image in pictures.items():
        path = workbench.images_dir() / filename
        if path.exists() and path.read_bytes() != image:
            raise WorkbenchError("An existing picture has different bytes: %s" % filename)
    if pictures:
        workbench.images_dir().mkdir(parents=True, exist_ok=True)
    for filename, image in pictures.items():
        path = workbench.images_dir() / filename
        if not path.exists():
            partial = path.with_suffix(path.suffix + ".partial")
            partial.write_bytes(image)
            partial.replace(path)
    workbench.write_dataset(dataset)
    return dataset
