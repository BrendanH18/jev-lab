"""Lab packs for the Python side: extra question checks, dataset health and Bulk preflight findings, row formats,
local JSON routes and offline command-line commands.

A pack is one module in jev/lab/packs that defines PACK = kit.define_pack({...}); its id is the module name with
hyphens. Packs are plain code: nothing here calls the model or the network, and nothing writes outside the guarded
writers the app already has. The JavaScript side has the same idea in static/js/lab/.
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Callable, Dict, List, Optional, Tuple

from . import kit

_PACKS: Optional[List[dict]] = None


def all_packs() -> List[dict]:
    """Every pack in jev/lab/packs, sorted by id. Modules are imported once per process."""
    global _PACKS
    if _PACKS is None:
        package = importlib.import_module(__name__ + ".packs")
        found = []
        for info in sorted(pkgutil.iter_modules(package.__path__), key=lambda module: module.name):
            module = importlib.import_module("%s.%s" % (package.__name__, info.name))
            pack = getattr(module, "PACK", None)
            if not isinstance(pack, dict) or not pack.get("_defined"):
                raise kit.PackError("jev/lab/packs/%s.py must define PACK = kit.define_pack({...})" % info.name)
            if pack["id"] != info.name.replace("_", "-"):
                raise kit.PackError("jev/lab/packs/%s.py: the pack id must be %r" % (info.name, info.name.replace("_", "-")))
            found.append(pack)
        _PACKS = found
    return _PACKS


def features(kind: str) -> List[Tuple[dict, dict]]:
    """(pack, feature) for every feature of one kind, in pack then declaration order."""
    return [(pack, feature) for pack in all_packs() for feature in pack["features"] if feature["kind"] == kind]


def improvements() -> List[dict]:
    """Every numbered improvement the Python packs hold; see kit.improvements_of."""
    return [item for pack in all_packs() for item in kit.improvements_of(pack)]


def code(pack: dict, feature: dict) -> str:
    """The stable code a finding from a pack feature carries: "<pack id>/<feature id>"."""
    return "%s/%s" % (pack["id"], feature["id"])


def lint_findings(state, questions: Dict[str, dict], refs, finding: Callable[..., dict]) -> List[dict]:
    """Findings from every lint_rule, built with jev.lint's own _finding(level, code, question, message, anchor).

    A rule's check(state, questions, refs) returns (question id or None, message) pairs. A rule that raises reports
    nothing: a broken extra check must never hide the built-in ones."""
    out = []
    for pack, feature in features("lint_rule"):
        try:
            results = list(feature["check"](state, questions, refs) or [])
        except Exception:  # noqa: BLE001
            continue
        for question, message in results:
            out.append(finding(feature["level"], code(pack, feature), question, message, feature.get("anchor", "")))
    return out


def health_findings(rows: list, questions: Dict[str, dict]) -> List[dict]:
    """Advisory findings from every health_check as {"code", "title", "rows", "message"}.

    rows are the parsed rows as health.analyze receives them (labels under "_expect", test rows marked "_test").
    A check returns {"rows": [1-based row numbers], "message": str} items and must never put a label value of a
    held-out row in a message. A check that raises reports nothing."""
    out = []
    for pack, feature in features("health_check"):
        try:
            results = list(feature["check"](rows, questions) or [])
        except Exception:  # noqa: BLE001
            continue
        for item in results:
            out.append({"code": code(pack, feature), "title": feature["title"], "rows": sorted(set(item.get("rows") or [])),
                        "message": str(item.get("message") or feature["title"])})
    return out


def preflight_findings(state, questions: Dict[str, dict], refs, row: int) -> List[dict]:
    """Findings from every preflight_check for one Bulk row's request state, shaped like jev.preflight's own:
    {"row", "question", "code", "message"}. A check returns (question id or None, message) pairs."""
    out = []
    for pack, feature in features("preflight_check"):
        try:
            results = list(feature["check"](state, questions, refs) or [])
        except Exception:  # noqa: BLE001
            continue
        for question, message in results:
            out.append({"row": row, "question": question, "code": code(pack, feature), "message": message})
    return out


def routes() -> Dict[Tuple[str, str], Callable[[dict], dict]]:
    """The local JSON routes packs add, as server.ROUTES entries. All are POST under /api/lab/."""
    out: Dict[Tuple[str, str], Callable[[dict], dict]] = {}
    for _pack, feature in features("route"):
        key = ("POST", feature["path"])
        if key in out:
            raise kit.PackError("Lab route %s is declared twice" % feature["path"])
        out[key] = feature["handler"]
    return out


def formats() -> List[Tuple[dict, dict]]:
    """(pack, feature) for every row format."""
    return features("format")
