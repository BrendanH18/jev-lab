import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import client as client_mod  # noqa: E402
from jev.client import JevClient, JevError, SpendGuard  # noqa: E402
from jev.config import Settings  # noqa: E402

RESPONSE = {"model": "jev-1.13.0", "answers": {"q": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 500, "output_tokens": 1}}
QUESTIONS = {"q": {"type": "noul", "instructions": "Is it?"}}


def settings(**env):
    base = {"TYPESAFE_API_KEY": "sk-test", "JEV_LAB_BUDGET_USD": "0.001"}
    base.update(env)
    return Settings(environ=base, env_file=Path("/nonexistent/.env"))


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
    def test_no_key_is_a_clear_401(self):
        c = JevClient(Settings(environ={}, env_file=Path("/nonexistent/.env")))
        with self.assertRaises(JevError) as ctx:
            c.system_one("hello", QUESTIONS)
        self.assertEqual(ctx.exception.status, 401)
        self.assertFalse(c.configured)

    def test_live_call_is_counted(self):
        c = JevClient(settings())
        c._post_system_one = lambda payload: dict(RESPONSE)
        result = c.system_one("hello", QUESTIONS)
        self.assertAlmostEqual(result.cost_usd, 500 * client_mod.PRICE_PER_INPUT_TOKEN_USD)
        self.assertEqual(result.meta()["question_count"], 1)
        self.assertEqual(c.guard.snapshot()["live_calls"], 1)
        c.system_one("hello", QUESTIONS)
        self.assertEqual(c.guard.snapshot()["live_calls"], 2)

    def test_key_precedence_and_sources(self):
        c = JevClient(settings())
        self.assertEqual(c.key_source, "env")
        c.set_api_key("memory-key")
        self.assertEqual((c.key_source, c.api_key), ("memory", "memory-key"))
        c.set_api_key(None)
        self.assertEqual(c.api_key, "sk-test")

    def test_trace_never_contains_the_key(self):
        c = JevClient(settings())
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
        c = JevClient(settings())
        c._sdk = TypeSafeClient(api_key="sk-test", transport=httpx2.MockTransport(handler))
        c._sdk_key = "sk-test"
        return c

    def test_system_one_and_models_go_through_the_sdk(self):
        import httpx2
        seen = {}

        def handler(request):
            seen["auth"] = request.headers.get("authorization")
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
