"""Record real Jev answers for every built-in scenario into data/replay.json.

Run `python scripts/record_replay.py` (or press "Record demo answers" in the app) once with an API
key. Commit the file, and the built-in demos replay genuine answers for anyone, key or not.
"""

from __future__ import annotations

import time
from typing import Callable, Dict, Optional

from . import dispatch, examples, find, hello, shield, workbench
from .autopilot import Autopilot
from .client import JevClient
from .scenarios import COMMANDS, INBOX
from .world import World


def record_all(client: JevClient, log: Optional[Callable[[str], None]] = None) -> Dict[str, int]:
    """Run every deterministic demo path once. Returns per-section call counts."""
    say = log or (lambda msg: None)
    if not client.replay.recording:
        client.replay.recording = True
    counts: Dict[str, int] = {}
    started = time.perf_counter()
    before = client.guard.snapshot()

    say("playground examples")
    for ex in hello.EXAMPLES:
        hello.ask(client, ex["text"])
    counts["playground"] = len(hello.EXAMPLES)

    say("shield: %d inbox messages" % len(INBOX))
    vendors = World().state["vendors"]
    for message in INBOX:
        client.system_one(shield.state_for(message), shield.questions(vendors))
    counts["shield"] = len(INBOX)

    say("dispatch: %d commands" % len(COMMANDS))
    world = World()
    for text in COMMANDS:
        cands = dispatch.candidates(text)
        client.system_one(dispatch.state_for_command(text), dispatch.questions(world.state, cands, source="command"))
    counts["dispatch"] = len(COMMANDS)

    say("autopilot: full inbox run")
    pilot = Autopilot(client)
    for message in INBOX:
        pilot.process(message)
    counts["autopilot"] = len(INBOX)

    say("find: sample handbook")
    find.search(client, find.load_sample(), find.SAMPLE_QUERIES)
    counts["find"] = 1

    say("workbench examples: %d" % len(examples.EXAMPLES))
    for ex in examples.EXAMPLES:
        client.system_one(ex["state"], ex["questions"])
    counts["examples"] = len(examples.EXAMPLES)

    rows = workbench.load_sample_rows()
    say("workbench bulk sample: %d rows" % len(rows))
    workbench.run_bulk(client, rows, examples.get("support-triage")["questions"])
    counts["bulk"] = len(rows)

    after = client.guard.snapshot()
    counts["live_calls"] = after["live_calls"] - before["live_calls"]
    counts["cost_usd_x1e6"] = int(round((after["spent_usd"] - before["spent_usd"]) * 1e6))
    counts["seconds"] = int(time.perf_counter() - started)
    counts["entries"] = len(client.replay.entries)
    say("done: %d live calls, %d entries in cache" % (counts["live_calls"], counts["entries"]))
    return counts
