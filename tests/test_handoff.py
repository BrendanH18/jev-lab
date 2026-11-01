"""Open in Workbench: every demo's request, as its trace shows it, must run in the Workbench.

The Inspect drawer (static/js/handoff.js) turns a trace's request into Workbench Build input: the state and
questions as they are, each sample picture by name, and each uploaded picture by the bytes the page sent,
found by the server's content-hash reference. These tests make each demo's call through the real
JevClient, with the network stubbed, and feed the trace through the same mapping into the Workbench's
validation, so a demo that grows a request the Workbench refuses fails here.
"""

import base64
import hashlib
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from helpers import fake_answers  # noqa: E402
from jev import images, workbench  # noqa: E402
from jev.client import SpendGuard  # noqa: E402
from jev.scenarios import INBOX  # noqa: E402


def workbench_input(trace, uploads=()):
    """What handoff.js hands the Workbench for `trace` (see handoffFromTrace)."""
    request = trace["request"]
    by_hash = {hashlib.sha256(base64.b64decode(b64)).hexdigest()[:12]: b64 for b64 in uploads}
    specs = {}
    for ref, asset in (request.get("assets") or {}).items():
        if asset.get("sample"):
            specs[ref] = {"sample": asset["sample"]}
        else:
            specs[ref] = {"format": asset["format"], "data_base64": by_hash[ref.rsplit("-", 1)[1]]}
    return request["state"], request["questions"], specs


class OpenInWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.sent = []

        def post(payload):
            self.sent.append(payload)
            return {"model": "jev-1.14.0", "answers": fake_answers(payload["questions"]), "usage": {"input_tokens": 100}}

        for target, attr, value in ((server.client, "_post_system_one", post), (server.client, "_memory_key", "sk-test"),
                                    (server.client, "guard", SpendGuard(budget_usd=100, rpm=1000))):
            patcher = patch.object(target, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(server.autopilot.reset)

    def assertRunsInWorkbench(self, trace, uploads=()):
        state, questions, specs = workbench_input(trace, uploads)
        sent = self.sent[-1]
        self.assertEqual((state, questions), (sent["state"], sent["questions"]), "the trace shows the request as sent")
        state, questions = workbench.validate_state(state), workbench.validate_questions(questions)
        self.assertEqual(questions, sent["questions"], "Workbench validation keeps the questions as they are")
        assets = workbench.request_images(state, questions, specs)
        self.assertEqual({ref: a["data"] for ref, a in assets.items()}, {ref: a["data"] for ref, a in (sent.get("assets") or {}).items()})
        return assets

    def test_playground_shield_dispatch_find_and_play(self):
        def play():
            game = server.api_play_new({"seed": 1})
            server.api_play_ask({"id": game["id"], "text": "Is it alive?"})
            return server.api_play_giveup({"id": game["id"]})["traces"][-1]  # traces are released at reveal

        demos = {
            "playground": lambda: server.api_hello({"text": "My order A-1041 arrived damaged. Refund please."})["trace"],
            "shield": lambda: server.api_shield({"message": dict(INBOX[0])})["trace"],
            "dispatch": lambda: server.api_dispatch({"text": "Pay PackRight's open invoice"})["trace"],
            "find": lambda: server.api_find({"queries": ["When do we roast?", "Who handles refunds?"]})["trace"],
            "play": play,
        }
        for name, call in demos.items():
            with self.subTest(demo=name):
                self.assertRunsInWorkbench(call())

    def test_autopilot_with_its_sample_photo(self):
        message = next(m for m in INBOX if m.get("attachments"))
        record = server.api_autopilot_process({"id": message["id"]})["record"]
        assets = self.assertRunsInWorkbench(record["trace"])
        self.assertEqual([a["sample"] for a in assets.values()], [message["attachments"][0]["sample"]])
        self.assertTrue(any(qid.startswith("shield.") for qid in record["trace"]["request"]["questions"]))

    def test_claims_with_a_sample_and_with_an_upload(self):
        order = next(iter(server.dispatch_world.state["orders"]))
        sample = server.api_claims_check({"order": order, "note": "The bag tore.", "image": {"sample": "torn-bag"}})
        self.assertRunsInWorkbench(sample["trace"])

        upload = base64.b64encode(images.sample_bytes("crushed-box")).decode("ascii")
        result = server.api_claims_check({"order": order, "note": "The box was crushed.", "image": {"data_base64": upload}})
        trace = result["trace"]
        (ref, shown), = trace["request"]["assets"].items()
        self.assertNotIn("sample", shown)
        self.assertNotIn(upload, str(trace), "the trace leaves an upload's bytes out, so the page supplies them")
        self.assertEqual(ref, "photo-" + hashlib.sha256(base64.b64decode(upload)).hexdigest()[:12],
                         "handoff.js finds an upload by this reference")
        self.assertRunsInWorkbench(trace, uploads=[upload])


if __name__ == "__main__":
    unittest.main()
