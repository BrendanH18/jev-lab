#!/usr/bin/env python3
"""Record real Jev answers for the built-in demos into data/replay.json.

    uv run scripts/record_replay.py        # or: python3 scripts/record_replay.py

Needs TYPESAFE_API_KEY (environment or .env). Costs well under a cent. Commit the resulting file so
the demos replay genuine answers for people who have not set up a key yet.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.client import JevClient, JevError  # noqa: E402
from jev.recording import record_all  # noqa: E402


def main() -> int:
    client = JevClient()
    if not client.configured:
        print("No API key found. Set TYPESAFE_API_KEY or add it to .env first.")
        return 1
    client.replay.recording = True
    print("Recording with %s (%s)…" % (client.model, client.backend))
    try:
        counts = record_all(client, log=lambda msg: print("  " + msg))
    except JevError as err:
        print("Stopped: %s" % err)
        return 2
    print("\nRecorded %d live calls for about $%.4f into %s" % (
        counts["live_calls"], counts["cost_usd_x1e6"] / 1e6, client.replay.path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
