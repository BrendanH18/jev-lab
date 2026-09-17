import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import client as client_mod  # noqa: E402
from jev.client import JevClient, JevError, SpendGuard  # noqa: E402
from jev.config import Settings  # noqa: E402
from jev.replay import ReplayStore, key_for  # noqa: E402

RESPONSE = {"model": "jev-1.13.0", "answers": {"q": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 500, "output_tokens": 1}}
QUESTIONS = {"q": {"type": "noul", "instructions": "Is it?"}}


def settings(**env):
    base = {"TYPESAFE_API_KEY": "sk-test", "JEV_LAB_BUDGET_USD": "0.001"}
    base.update(env)
    return Settings(environ=base, env_file=Path("/nonexistent/.env"))


class ReplayStoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_round_trip_and_persistence(self):
        store = ReplayStore(self.dir / "replay.json", recording=True)
        self.assertIsNone(store.get("jev-latest", "hello", QUESTIONS))
        store.put("jev-latest", "hello", QUESTIONS, RESPONSE, 123.4)
        again = ReplayStore(self.dir / "replay.json")
        entry = again.get("jev-latest", "hello", QUESTIONS)
        self.assertEqual(entry["response"], RESPONSE)
        self.assertEqual(entry["latency_ms"], 123.4)
        self.assertEqual(again.stats()["hits"], 1)
        self.assertEqual(key_for("jev-latest", {"a": 1, "b": 2}, QUESTIONS), key_for("jev-latest", {"b": 2, "a": 1}, QUESTIONS))
        self.assertNotEqual(key_for("jev-latest", "hello", QUESTIONS), key_for("jev-1.13.0", "hello", QUESTIONS))

    def test_corrupt_file_is_ignored(self):
        (self.dir / "replay.json").write_text("{not json")
        self.assertEqual(ReplayStore(self.dir / "replay.json").entries, {})


class SpendGuardTests(unittest.TestCase):
    def test_budget_and_rate_limit(self):
        guard = SpendGuard(budget_usd=0.00003, rpm=2)
        guard.check()
        guard.record(client_mod.JevResult({"questions": {}}, RESPONSE, 1.0))  # 500 tokens = $0.000021
        guard.check()
        guard.record(client_mod.JevResult({"questions": {}}, RESPONSE, 1.0))
        with self.assertRaises(JevError) as ctx:
            guard.check()
        self.assertEqual(ctx.exception.status, 402)
        fast = SpendGuard(budget_usd=0, rpm=2)
        fast.check(); fast.check()
        with self.assertRaises(JevError) as ctx:
            fast.check()
        self.assertEqual(ctx.exception.status, 429)


class JevClientTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.store = ReplayStore(self.dir / "replay.json")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_replay_hit_needs_no_key_and_costs_nothing(self):
        self.store.put("jev-latest", "hello", QUESTIONS, RESPONSE, 88.0)
        c = JevClient(Settings(environ={}, env_file=Path("/nonexistent/.env")), replay=self.store)
        result = c.system_one("hello", QUESTIONS)
        self.assertTrue(result.replayed)
        self.assertEqual(result.answers["q"]["noul"], 0.9)
        self.assertEqual(c.guard.snapshot()["live_calls"], 0)
        with self.assertRaises(JevError) as ctx:
            c.system_one("something new", QUESTIONS)
        self.assertEqual(ctx.exception.status, 401)

    def test_live_call_is_counted_and_recorded(self):
        c = JevClient(settings(JEV_LAB_REPLAY="record"), replay=self.store)
        c._post_system_one = lambda payload: dict(RESPONSE)
        result = c.system_one("hello", QUESTIONS)
        self.assertFalse(result.replayed)
        self.assertAlmostEqual(result.cost_usd, 500 * client_mod.PRICE_PER_INPUT_TOKEN_USD)
        self.assertEqual(c.guard.snapshot()["live_calls"], 1)
        self.assertEqual(len(self.store.entries), 1)
        # A second identical call replays instead of spending.
        self.assertTrue(c.system_one("hello", QUESTIONS).replayed)
        self.assertEqual(c.guard.snapshot()["live_calls"], 1)

    def test_trace_never_contains_the_key(self):
        c = JevClient(settings(), replay=self.store)
        c._post_system_one = lambda payload: dict(RESPONSE)
        trace = json.dumps(c.system_one("hello", QUESTIONS).trace())
        self.assertNotIn("sk-test", trace)

    def test_error_messages(self):
        self.assertIn("rejected the API key", client_mod._error_message(401, {"detail": {"message": "bad"}}))
        self.assertIn("422", client_mod._error_message(422, {"detail": [{"loc": "x"}]}))


@unittest.skipIf(client_mod.TypeSafeClient is None, "typesafe-sdk not installed (Python < 3.10)")
class SdkTransportTests(unittest.TestCase):
    """Drive the real SDK client through an in-memory transport: no network, no key needed."""

    def make_client(self, handler):
        import httpx2
        from typesafe_sdk import TypeSafeClient
        c = JevClient(settings(), replay=ReplayStore(Path(tempfile.mkdtemp()) / "r.json"))
        c._sdk = TypeSafeClient(api_key="sk-test", transport=httpx2.MockTransport(handler))
        c._sdk_key = "sk-test"
        return c

    def test_system_one_and_models_go_through_the_sdk(self):
        import httpx2
        seen = {}

        def handler(request):
            seen["auth"] = request.headers.get("authorization")
            seen["path"] = request.url.path
            if request.url.path.endswith("/models"):
                return httpx2.Response(200, json={"models": [{"name": "jev-latest", "description": "d", "release_date": "2026-01-01"}]})
            seen["body"] = json.loads(request.content)
            return httpx2.Response(200, json=RESPONSE)

        c = self.make_client(handler)
        result = c.system_one({"text": "hi"}, QUESTIONS)
        self.assertEqual(seen["auth"], "Bearer sk-test")
        self.assertEqual(seen["body"]["questions"], QUESTIONS)
        self.assertEqual(seen["body"]["model"], "jev-latest")
        self.assertEqual(result.answers["q"]["noul"], 0.9)
        self.assertEqual(result.input_tokens, 500)
        self.assertIn("typesafe-sdk", result.backend)
        self.assertEqual(c.models()["models"][0]["name"], "jev-latest")

    def test_api_errors_become_jev_errors(self):
        import httpx2

        def handler(request):
            return httpx2.Response(401, json={"detail": {"error_type": "authentication_error", "message": "Invalid key"}})

        c = self.make_client(handler)
        with self.assertRaises(JevError) as ctx:
            c.system_one("x", QUESTIONS)
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("rejected the API key", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
