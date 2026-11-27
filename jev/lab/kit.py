"""The contract for Python Lab packs. Standard library only.

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

Packs never call the model or the network and never write files except through the app's guarded writers.
"""

from __future__ import annotations

import re
from typing import Any

KINDS = ("lint_rule", "health_check", "preflight_check")
LEVELS = ("problem", "advice")

_PACK_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_FEATURE_ID = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")


class PackError(ValueError):
    """A pack that does not follow the contract."""


def _text(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _check_feature(where: str, feature: dict) -> None:
    kind = feature.get("kind")
    if kind not in KINDS:
        raise PackError("%s: unknown kind %r" % (where, kind))
    if not _text(feature.get("title")):
        raise PackError("%s: title is required" % where)
    if not callable(feature.get("check")):
        raise PackError("%s: check must be a function" % where)
    if kind == "lint_rule":
        if feature.get("level") not in LEVELS:
            raise PackError("%s: level must be one of %s" % (where, ", ".join(LEVELS)))
        if feature.get("anchor", "") and not str(feature["anchor"]).startswith("#"):
            raise PackError("%s: anchor must start with #" % where)


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
