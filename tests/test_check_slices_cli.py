"""Slice targets in the terminal: printed evidence and nonzero exit on a slice miss."""

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import check as cli  # noqa: E402
from helpers import FakeClient  # noqa: E402
from jev import checks, workbench  # noqa: E402


class SliceCliTests(unittest.TestCase):
    def test_list_and_run_distinguish_slice_failure_and_missing_slice(self):
        questions = {"refund": {"type": "noul", "instructions": "Refund requested?"}}
        rows = [{"text": str(i), "channel": "email" if i == 0 else "web", "_expect": {"refund": True}}
                for i in range(10)]
        target = {"field": "channel", "value": "email", "min_accuracy": 1, "min_coverage": 1}
        spec = {"model": "jev-1.14.0", "gates": {"refund": 0.6}, "min_accuracy": 0.9,
                "min_coverage": 1, "slice_targets": [target]}
        client = FakeClient(lambda state, _: {"refund": 0.02 if state["text"] == "0" else 0.98})
        client.configured, client.backend = True, "fake"
        client.guard = type("Guard", (), {"snapshot": lambda self: {
            "live_calls": len(client.calls), "input_tokens": 1000, "spent_usd": 0.0}})()

        def main(*args):
            output = io.StringIO()
            with redirect_stdout(output), patch.object(cli, "JevClient", return_value=client):
                code = cli.main(list(args))
            return code, output.getvalue()

        with tempfile.TemporaryDirectory() as directory, patch.object(workbench, "WORKBENCH_DIR", Path(directory)):
            workbench.save_dataset({"name": "Channels", "rows": "\n".join(map(json.dumps, rows)), "questions": questions})
            checks.save_check("channels", spec)
            code, text = main("--list")
            self.assertEqual(code, 0, text)
            self.assertIn("slice 'channel' = 'email': 100.0% accurate", text)
            self.assertEqual(client.calls, [])
            code, text = main("channels")
            self.assertEqual(code, 1, text)
            self.assertIn("slice 'channel' = 'email': FAIL (1 rows, 1 labeled)", text)
            self.assertIn("accuracy 0.0%, target 100.0%  FAIL", text)
            self.assertEqual(len(client.calls), 10)
            checks.save_check("channels", dict(spec, slice_targets=[dict(target, value="missing")]))
            code, text = main("channels")
            self.assertEqual(code, 2, text)
            self.assertIn("slice 'channel' = 'missing': ERROR", text)
            self.assertIn("No rows match this required slice", text)


if __name__ == "__main__":
    unittest.main()
