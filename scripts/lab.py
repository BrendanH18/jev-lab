#!/usr/bin/env python3
"""Offline tools for Workbench data. No API key, no network, no model call.

    python3 scripts/lab.py --help                          # every command
    python3 scripts/lab.py <command> [<subcommand>] --help
    python3 scripts/lab.py inventory [--json]              # the improvements the Python Lab packs hold
    python3 scripts/lab.py --data-dir DIR <command> ...    # read another Workbench data directory

Commands come from the Lab packs in jev/lab/packs (kind "cli"); see jev/lab/kit.py. Exit codes: 0 success; 1 the
command found what it was asked to look for (a finding, a difference, a failed expectation); 2 bad usage or
missing data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import lab, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402

DESCRIPTION = "Offline tools for Workbench data: no API key, no network, no model call."


def run_inventory(args) -> int:
    items = lab.improvements()
    if args.json:
        print(json.dumps(items, indent=1, ensure_ascii=False))
    else:
        for item in items:
            print("%s\t%s" % (item["id"], item["title"]))
        print("%d improvements in %d Python packs" % (len(items), len(lab.all_packs())))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lab.py", description=DESCRIPTION)
    parser.add_argument("--data-dir", metavar="DIR", help="Workbench data directory to read (default: data/workbench)")
    top = parser.add_subparsers(dest="_command", metavar="<command>")
    inventory = top.add_parser("inventory", help="list the improvements the Python Lab packs hold")
    inventory.add_argument("--json", action="store_true", help="print them as JSON")
    inventory.set_defaults(_run=run_inventory)
    groups: Dict[str, tuple] = {}
    leaves = {"inventory"}
    for pack, feature in lab.features("cli"):
        words: List[str] = list(feature["command"])
        path = " ".join(words)
        where = "%s/%s" % (pack["id"], feature["id"])
        if path in leaves or (len(words) == 1 and words[0] in groups) or (len(words) == 2 and words[0] in leaves):
            raise kit.PackError("%s: the command `%s` is already taken" % (where, path))
        description = feature.get("help") or feature["title"]
        if len(words) == 1:
            leaf = top.add_parser(words[0], help=feature["title"], description=description)
        else:
            if words[0] not in groups:
                group = top.add_parser(words[0], help="%s commands" % words[0], description="%s commands." % words[0].capitalize())
                group.set_defaults(_group=group)
                groups[words[0]] = (group, group.add_subparsers(dest="_subcommand", metavar="<subcommand>"))
            leaf = groups[words[0]][1].add_parser(words[1], help=feature["title"], description=description)
        leaves.add(path)
        if "configure" in feature:
            feature["configure"](leaf)
        leaf.set_defaults(_run=feature["run"])
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:  # argparse: 2 for bad usage, 0 after --help
        return int(stop.code or 0)
    run = getattr(args, "_run", None)
    if run is None:
        getattr(args, "_group", parser).print_help()
        return 2
    previous = workbench.WORKBENCH_DIR
    try:
        if args.data_dir:
            directory = Path(args.data_dir)
            if not directory.is_dir():
                print("lab.py: --data-dir %s is not a directory" % args.data_dir, file=sys.stderr)
                return 2
            workbench.WORKBENCH_DIR = directory
        return int(run(args) or 0)
    except (kit.CliError, workbench.WorkbenchError) as err:
        print("lab.py: %s" % err, file=sys.stderr)
        return 2
    finally:
        workbench.WORKBENCH_DIR = previous


if __name__ == "__main__":
    sys.exit(main())
