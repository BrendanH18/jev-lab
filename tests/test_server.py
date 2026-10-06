"""Exercise the real HTTP handler over loopback, without external API calls."""

import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
from helpers import fake_answers
from jev.client import JevError


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class QuietHandler(server.Handler):
            def log_message(self, *_args):
                pass

        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.addClassCleanup(cls.httpd.server_close)
        cls.port = cls.httpd.server_address[1]
        QuietHandler.port = cls.port
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.thread.join, 5)
        cls.addClassCleanup(cls.httpd.shutdown)

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        return response.status, dict(response.getheaders()), response.read()

    def post_headers(self, **extra):
        return {"X-Jev-Token": server.SESSION_TOKEN, "Content-Type": "application/json", **extra}

    def test_pages_receive_session_token_and_security_headers(self):
        for path in server.PAGES:
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertIn('name="jev-csrf"', body.decode())
                self.assertIn(server.SESSION_TOKEN, body.decode())
                self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
                self.assertEqual(headers["Cache-Control"], "no-store")
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertIn("script-src 'self'", headers["Content-Security-Policy"])

    def test_browser_assets_are_served(self):
        for path in ("/css/app.css", "/js/common.js", "/js/../css/app.css"):
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertIn("charset=utf-8", headers["Content-Type"])
                self.assertTrue(body)

    def test_foreign_host_is_rejected(self):
        status, _, body = self.request("GET", "/", headers={"Host": "attacker.example"})
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["reason"], "host")

    def test_static_content_type_cannot_inject_headers_or_body(self):
        with tempfile.TemporaryDirectory() as folder:
            static = Path(folder)
            asset = b"body { color: green; }"
            (static / "asset.css").write_bytes(asset)
            for newline in ("\r\n", "\r", "\n"):
                with self.subTest(newline=newline):
                    content_type = "text/css" + newline + "X-Injected: yes" + newline * 2 + "injected body"
                    with patch.object(server, "STATIC", static), patch.object(
                        server.mimetypes, "guess_type", return_value=(content_type, None)
                    ):
                        status, headers, body = self.request("GET", "/asset.css")
                    self.assertEqual(status, 200)
                    self.assertNotIn("X-Injected", headers)
                    self.assertEqual(headers["Content-Type"],
                                     "text/cssX-Injected: yesinjected body; charset=utf-8")
                    self.assertEqual(headers["Content-Length"], str(len(asset)))
                    self.assertEqual(headers["Cache-Control"], "no-store")
                    self.assertEqual(body, asset)

    def test_post_without_session_token_is_rejected(self):
        status, _, body = self.request("POST", "/api/workbench/export", "{}",
                                       {"Content-Type": "application/json"})
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["reason"], "token")

    def test_invalid_content_lengths_are_rejected_without_reading_body(self):
        for length in ("not-a-number", "-1"):
            with self.subTest(length=length):
                status, _, body = self.request("POST", "/api/workbench/export",
                                               headers=self.post_headers(**{"Content-Length": length}))
                self.assertEqual(status, 400)
                self.assertIn("Content-Length", json.loads(body)["error"])

    def test_oversized_body_is_rejected_without_reading_it(self):
        status, _, body = self.request("POST", "/api/workbench/export", headers=self.post_headers(
            **{"Content-Length": str(server.MAX_BODY_BYTES + 1)}))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"], "Request body too large")

    def test_non_object_json_body_is_rejected(self):
        status, _, body = self.request("POST", "/api/workbench/export", "[]", self.post_headers())
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"], "Body must be a JSON object")

    def test_export_works_without_a_model_call(self):
        payload = json.dumps({"state": "A synthetic ticket", "questions": {
            "urgent": {"type": "noul", "instructions": "Is the ticket urgent?"}}})
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/export", payload, self.post_headers())
        self.assertEqual(status, 200)
        self.assertEqual(set(json.loads(body)), {"python", "javascript", "curl"})

    def test_static_traversal_cannot_read_sibling_with_matching_prefix(self):
        with tempfile.TemporaryDirectory(prefix="static-private-", dir=server.PROJECT_ROOT) as folder:
            sibling = Path(folder)
            (sibling / "private.txt").write_text("private fixture")
            status, _, body = self.request("GET", "/../%s/private.txt" % sibling.name)
        self.assertEqual(status, 404)
        self.assertNotIn(b"private fixture", body)

    def test_static_symlink_cannot_read_outside_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            static = root / "static"
            static.mkdir()
            private = root / "private.txt"
            private.write_text("private fixture")
            (static / "linked.txt").symlink_to(private)
            with patch.object(server, "STATIC", static):
                status, _, body = self.request("GET", "/linked.txt")
        self.assertEqual(status, 404)
        self.assertNotIn(b"private fixture", body)

    def test_static_traversal_cannot_read_parent_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            static = root / "static"
            static.mkdir()
            (root / "private.txt").write_text("private fixture")
            with patch.object(server, "STATIC", static):
                status, _, body = self.request("GET", "/../private.txt")
        self.assertEqual(status, 404)
        self.assertNotIn(b"private fixture", body)

    def test_static_symlink_within_directory_is_served(self):
        with tempfile.TemporaryDirectory() as folder:
            static = Path(folder) / "static"
            static.mkdir()
            asset = static / "asset.css"
            asset.write_text("body { color: green; }")
            (static / "linked.css").symlink_to(asset)
            with patch.object(server, "STATIC", static):
                status, headers, body = self.request("GET", "/linked.css")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/css; charset=utf-8")
        self.assertEqual(body, b"body { color: green; }")

    def test_shield_batch_keeps_results_when_one_call_fails(self):
        messages = [
            {"id": "a", "from_name": "A", "from_email": "a@example.com", "subject": "One", "body": "Hello"},
            {"id": "b", "from_name": "B", "from_email": "b@example.com", "subject": "Two", "body": "Hello"},
        ]

        def fake(body):
            if body["message"]["id"] == "a":
                raise JevError("slow down", status=429)
            return {"meta": {"cost_usd": 0.01, "input_tokens": 4}, "answers": {}, "fact": {}, "verdict": {}}

        with patch.object(server, "api_shield", side_effect=fake):
            out = server.api_shield_batch({"messages": messages})
        self.assertEqual([r["id"] for r in out["results"]], ["a", "b"])
        self.assertEqual(out["results"][0]["status"], 429)
        self.assertEqual(out["completed"], 1)
        self.assertIsNone(out["stopped"])
        self.assertAlmostEqual(out["total_cost_usd"], 0.01)

    def test_dispatch_execute_requires_a_plan_from_this_server(self):
        server.dispatch_world.reset()
        server._approved_plans.clear()
        self.addCleanup(server.dispatch_world.reset)
        self.addCleanup(server._approved_plans.clear)
        with self.assertRaises(server.BadRequest) as ctx:
            server.api_dispatch_execute({
                "tool": "refund_order", "exec_args": {"order": "A-1041", "reason": "damaged"}})
        self.assertIn("not approved", str(ctx.exception))
        self.assertFalse(server.dispatch_world.state["orders"]["A-1041"]["refunded"])

        text = "pay packright's invoice"
        cands = server.dispatch.candidates(text)
        questions = server.dispatch.questions(server.dispatch_world.state, cands, source="command")
        answers = fake_answers(questions, {"tool": "pay_vendor", "pay.vendor": "packright", "pay.amount": "open_invoice"})
        plan = server.dispatch.plan(answers, cands, server.dispatch_world, "command", text)
        self.assertEqual(plan["decision"], "execute")
        server._remember_plan(plan)
        # The browser's JSON.stringify turns 860.0 into 860, which comes back as an int.
        args = dict(plan["exec_args"], amount=int(plan["exec_args"]["amount"]))
        self.assertEqual(server._action_key(plan["tool"], args), server._action_key(plan["tool"], plan["exec_args"]))
        out = server.api_dispatch_execute({"tool": plan["tool"], "exec_args": args})
        self.assertEqual(out["executed"]["kind"], "payment")
        with self.assertRaises(server.BadRequest):
            server.api_dispatch_execute({"tool": plan["tool"], "exec_args": args})

        confirm = dict(plan, decision="confirm")
        server._remember_plan(confirm)
        self.assertIsNotNone(server.dispatch.recheck(confirm, server.dispatch_world))
        with self.assertRaises(server.BadRequest) as blocked:
            server.api_dispatch_execute({"tool": plan["tool"], "exec_args": args})
        self.assertIn("paid", str(blocked.exception).lower())


if __name__ == "__main__":
    unittest.main()
