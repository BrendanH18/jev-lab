import base64
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import client as client_mod  # noqa: E402
from jev import images  # noqa: E402
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
        fast.check()
        fast.check()
        with self.assertRaises(JevError) as ctx:
            fast.check()
        self.assertEqual(ctx.exception.status, 429)

    def test_reservation_blocks_a_second_call_before_either_is_billed(self):
        guard = SpendGuard(budget_usd=0.00002, rpm=10)
        guard.check(0.000015)
        with self.assertRaises(JevError) as ctx:
            guard.check(0.000015)
        self.assertEqual(ctx.exception.status, 402)
        self.assertEqual(guard.snapshot()["live_calls"], 0)
        guard.release(0.000015)
        guard.check(0.000015)
        self.assertAlmostEqual(guard.snapshot()["reserved_usd"], 0.000015)


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

    def test_failed_call_releases_the_reservation(self):
        c = JevClient(settings(JEV_LAB_BUDGET_USD="2"))

        def fail(_payload):
            raise JevError("down", status=503)

        c._post_system_one = fail
        with self.assertRaises(JevError):
            c.system_one("hello", QUESTIONS)
        snap = c.guard.snapshot()
        self.assertEqual(snap["reserved_usd"], 0.0)
        self.assertEqual(snap["live_calls"], 0)
        c._post_system_one = lambda payload: dict(RESPONSE)
        c.system_one("hello", QUESTIONS)
        self.assertEqual(c.guard.snapshot()["live_calls"], 1)
        self.assertEqual(c.guard.snapshot()["reserved_usd"], 0.0)

    def test_price_follows_the_answered_model(self):
        self.assertEqual(client_mod.price_per_input_token("jev-1.13.0"), client_mod.PRICE_PER_INPUT_TOKEN_USD)
        self.assertEqual(client_mod.price_per_input_token("jev-latest"), client_mod.PRICE_PER_INPUT_TOKEN_USD)
        self.assertEqual(client_mod.price_per_input_token("jev-9.0.0"), client_mod.PRICE_PER_INPUT_TOKEN_USD)
        result = client_mod.JevResult(
            {"model": "jev-latest", "questions": {}}, dict(RESPONSE, model="jev-1.13.0"), 1.0)
        self.assertAlmostEqual(result.cost_usd, 500 * client_mod.PRICE_PER_INPUT_TOKEN_USD)

    def test_images_are_sent_but_never_traced(self):
        c = JevClient(settings(JEV_LAB_BUDGET_USD="2"))
        sent = {}
        c._post_system_one = lambda payload: sent.update(payload) or dict(RESPONSE)
        photo = images.sample_asset("torn-bag")
        ref = images.new_ref(photo["data"], "photo")
        result = c.system_one({"photo": ref}, {"q": client_mod.box("the bag in `photo`")}, assets={ref: photo},
                              model="jev-1.14.0")
        self.assertIs(sent["assets"][ref], photo)
        self.assertEqual(result.request["model"], "jev-1.14.0")
        shown = result.trace()["request"]["assets"][ref]
        self.assertIn("omitted", shown["data_base64"])
        self.assertLess(len(json.dumps(result.trace())), 2000)

    def test_stdlib_fallback_sends_base64_images_with_the_header(self):
        c = JevClient(settings(JEV_LAB_BUDGET_USD="2"))
        seen = {}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return False

            def read(self):
                return json.dumps(RESPONSE).encode()

        def urlopen(request, timeout=None):
            seen["headers"] = {k.lower(): v for k, v in request.header_items()}
            seen["body"] = json.loads(request.data)
            return Response()

        photo = images.sample_asset("intact-bag")
        ref = images.new_ref(photo["data"], "photo")
        with patch.object(client_mod, "TypeSafeClient", None), \
                patch.object(client_mod.urllib.request, "urlopen", urlopen):
            result = c.system_one({"photo": ref}, QUESTIONS, assets={ref: photo})
            plain = c.system_one("no pictures", QUESTIONS)
        self.assertEqual(seen["headers"].get(images.IMAGES_HEADER.lower()), None, "plain calls skip the header")
        self.assertEqual(result.answers["q"]["noul"], 0.9)
        self.assertEqual(plain.backend, "stdlib fallback")

        with patch.object(client_mod, "TypeSafeClient", None), \
                patch.object(client_mod.urllib.request, "urlopen", urlopen):
            c.system_one({"photo": ref}, QUESTIONS, assets={ref: photo})
        self.assertEqual(seen["headers"][images.IMAGES_HEADER.lower()], "true")
        sent = seen["body"]["assets"][ref]
        self.assertEqual((sent["type"], sent["format"]), ("image", "png"))
        self.assertEqual(base64.b64decode(sent["data_base64"]), photo["data"])

    def test_unreferenced_image_is_refused_before_spending(self):
        c = JevClient(settings(JEV_LAB_BUDGET_USD="2"))
        c._post_system_one = lambda payload: self.fail("no call should be made")
        photo = images.sample_asset("torn-bag")
        with self.assertRaises(images.ImageError):
            c.system_one("no reference here", QUESTIONS, assets={"photo-123456": photo})
        self.assertEqual(c.guard.snapshot()["reserved_usd"], 0.0)

    def test_images_raise_the_reservation(self):
        payload = {"state": {"photo": "photo-abc"}, "model": "jev-1.14.0", "questions": QUESTIONS}
        plain = client_mod.estimate_reserve_usd(payload, "jev-1.14.0")
        with_image = client_mod.estimate_reserve_usd(dict(payload, assets={"photo-abc": {}}), "jev-1.14.0", 1)
        self.assertAlmostEqual(with_image - plain, images.RESERVE_TOKENS_PER_IMAGE * client_mod.price_per_input_token("jev-1.14.0"))

    def test_model_override_and_box_support(self):
        c = JevClient(settings(TYPESAFE_DEFAULT_MODEL="jev-1.13.0"))
        self.assertFalse(client_mod.supports_box(c.model))
        c.set_model("jev-1.14.0")
        self.assertEqual((c.model, c.model_source), ("jev-1.14.0", "selected"))
        self.assertTrue(client_mod.supports_box(c.model))
        c.set_model(None)
        self.assertEqual((c.model, c.model_source), ("jev-1.13.0", "settings"))
        # Aliases per https://docs.typesafe.ai/models#aliases: jev-latest -> 1.13, jev-preview -> 1.14.
        self.assertFalse(client_mod.supports_box("jev-latest"))
        self.assertTrue(client_mod.supports_box("jev-preview"))
        self.assertTrue(client_mod.supports_box("jev-2.0.0"))
        self.assertEqual(client_mod.resolve_alias("jev-1.14.0"), "jev-1.14.0")

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
        self.assertNotIn("typesafe-danger-zone-images", seen)

    def test_images_go_as_multipart_with_the_images_header(self):
        import httpx2
        seen = {}

        def handler(request):
            seen["headers"] = request.headers
            seen["body"] = request.content
            if request.headers.get("content-encoding") == "zstd":  # the SDK's default where zstd is available
                from compression.zstd import decompress
                seen["body"] = decompress(request.content)
            return httpx2.Response(200, json=dict(RESPONSE, answers={"b": {
                "type": "box", "box": {"left": 0.1, "top": 0.2, "right": 0.5, "bottom": 0.6}, "confidence": 0.8}}))

        c = self.make_client(handler)
        photo = images.sample_asset("grinder-ok")
        ref = images.new_ref(photo["data"], "photo")
        result = c.system_one({"photo": ref}, {"b": client_mod.box("the hopper in `photo`")}, assets={ref: photo})
        self.assertEqual(seen["headers"].get(images.IMAGES_HEADER), "true")
        self.assertTrue(seen["headers"]["content-type"].startswith("multipart/form-data"))
        self.assertIn(photo["data"][:64], seen["body"])
        self.assertIn(('"%s":{"type":"image","part":"asset-0"}' % ref).encode(), seen["body"])
        self.assertEqual(result.answers["b"]["box"]["right"], 0.5)

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
