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
from helpers import FakeClient, fake_answers
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

    def test_sample_pictures_are_served_as_png(self):
        status, headers, body = self.request("GET", "/img/samples/torn-bag.png")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertTrue(body.startswith(b"\x89PNG"))

    def test_claims_check_over_http_sends_the_photo_once(self):
        fake = FakeClient(lambda state, qs: {"shows_item": 0.9, "damage_visible": 0.9, "matches_note": 0.9,
                                             "severity": 2.5, "damage_kind": "torn_or_open"})
        server.dispatch_world.reset()
        self.addCleanup(server.dispatch_world.reset)
        payload = json.dumps({"order": "A-1041", "note": "Torn bag", "image": {"sample": "torn-bag"}})
        with patch.object(server.client, "system_one", side_effect=fake.system_one):
            status, _, body = self.request("POST", "/api/claims/check", payload, self.post_headers())
        self.assertEqual(status, 200, body)
        out = json.loads(body)
        self.assertEqual(out["verdict"]["decision"], "approve")
        self.assertEqual(len(fake.assets), 1)
        self.assertEqual(next(iter(fake.assets.values()))["sample"], "torn-bag")

    def test_bad_photo_is_refused_without_a_model_call(self):
        payload = json.dumps({"order": "A-1041", "note": "", "image": {"data_base64": "R0lGODlhAQABAAAAACw="}})
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/claims/check", payload, self.post_headers())
        self.assertEqual(status, 400)
        self.assertIn("PNG or JPEG", json.loads(body)["error"])

    def test_claims_decide_is_pure_code(self):
        from jev import claims
        answers = fake_answers(claims.questions(), {"shows_item": 0.9, "damage_visible": 0.9, "matches_note": 0.9,
                                                    "severity": 2.5})
        facts = claims.order_facts(server.dispatch_world, "A-1042")
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            low = server.api_claims_decide({"answers": answers, "facts": facts})
            high = server.api_claims_decide({"answers": answers, "facts": facts, "policy": {"auto_limit_usd": 300}})
        self.assertEqual((low["verdict"]["decision"], high["verdict"]["decision"]), ("review", "approve"))

    def test_calibrate_over_http_is_pure_code(self):
        rows = [{"index": 0, "answer": {"type": "noul", "noul": 0.9}, "label": "yes"},
                {"index": 1, "answer": {"type": "noul", "noul": 0.3}, "label": "yes"}]
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/calibrate", json.dumps({"rows": rows}),
                                           self.post_headers())
            lower, _, lbody = self.request("POST", "/api/workbench/calibrate", json.dumps({"rows": rows, "bound": "lower"}),
                                           self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/calibrate", json.dumps({"rows": "x"}), self.post_headers())
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["accuracy"], 0.5)
        self.assertEqual(json.loads(body)["bound"], "estimate")
        self.assertEqual(lower, 200, lbody)
        self.assertEqual([t["threshold"] for t in json.loads(lbody)["targets"]], [None] * 3)
        self.assertEqual(bad, 400)
        self.assertIn("rows must be a list", json.loads(err)["error"])

    def test_datasets_over_http(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server.workbench, "WORKBENCH_DIR", Path(folder)), \
                patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            rows = '{"text": "Charged twice", "_expect": {"dept": "billing"}}\nplain row'
            status, _, body = self.request("POST", "/api/workbench/datasets", json.dumps({"name": "Tickets", "rows": rows}),
                                           self.post_headers())
            self.assertEqual(status, 200, body)
            self.assertEqual(json.loads(body)["dataset"], {"id": "tickets", "name": "Tickets", "notes": "",
                                                           "saved_at": json.loads(body)["dataset"]["saved_at"], "rows": 2,
                                                           "labeled": 1, "labels": {"dept": 1}, "questions": 0})
            status, _, body = self.request("GET", "/api/workbench/datasets")
            self.assertEqual([d["id"] for d in json.loads(body)["datasets"]], ["tickets"])
            status, _, body = self.request("POST", "/api/workbench/datasets/load", json.dumps({"id": "tickets"}),
                                           self.post_headers())
            self.assertEqual(json.loads(body)["dataset"]["rows"][1], "plain row")
            bad, _, err = self.request("POST", "/api/workbench/datasets/load", json.dumps({"id": "../.env"}),
                                       self.post_headers())
            self.assertEqual(bad, 400)
            self.assertIn("Invalid dataset id", json.loads(err)["error"])
            forged, _, _ = self.request("POST", "/api/workbench/datasets", json.dumps({"name": "x", "rows": "y"}),
                                        {"Content-Type": "application/json"})
            self.assertEqual(forged, 403, "saving needs the session token")
            status, _, body = self.request("POST", "/api/workbench/datasets/delete", json.dumps({"id": "tickets"}),
                                           self.post_headers())
            self.assertTrue(json.loads(body)["deleted"])
            self.assertEqual(list(Path(folder, "datasets").iterdir()), [])

    def test_policy_over_http_is_pure_code(self):
        rows = [{"index": 0, "answers": {"u": {"type": "noul", "noul": 0.9}}, "labels": {"u": "yes"}},
                {"index": 1, "answers": {"u": {"type": "noul", "noul": 0.6}}, "labels": {"u": "no"}}]
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/policy", json.dumps({"rows": rows, "gates": {"u": 0.5}}),
                                           self.post_headers())
            tuned, _, tbody = self.request("POST", "/api/workbench/policy/tune", json.dumps({"rows": rows, "questions": ["u"]}),
                                           self.post_headers())
            ltuned, _, ltbody = self.request("POST", "/api/workbench/policy/tune",
                                             json.dumps({"rows": rows, "questions": ["u"], "bound": "lower"}), self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/policy", json.dumps({"rows": rows, "gates": {"u": 2}}),
                                       self.post_headers())
        self.assertEqual(status, 200, body)
        self.assertEqual((json.loads(body)["automated"], json.loads(body)["accuracy"]), (1, 1.0))
        self.assertEqual(tuned, 200, tbody)
        self.assertEqual(json.loads(tbody)["targets"][0]["gates"], {"u": 0.21})
        self.assertEqual(ltuned, 200, ltbody)
        self.assertEqual(json.loads(ltbody)["targets"][0]["gates"], None)  # one right row cannot show 90%
        self.assertEqual(bad, 400)
        self.assertIn("from 0 to 1", json.loads(err)["error"])

    def test_holdout_over_http_is_pure_code(self):
        rows = [{"index": i, "answers": {"u": {"type": "noul", "noul": 0.55 + 0.04 * i}}, "labels": {"u": i % 4 != 0},
                 "key": "row %d" % i} for i in range(12)]
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/holdout", json.dumps({"rows": rows, "questions": ["u"]}),
                                           self.post_headers())
            few, _, fbody = self.request("POST", "/api/workbench/holdout",
                                         json.dumps({"rows": rows[:5], "questions": ["u"], "folds": 3}), self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/holdout",
                                       json.dumps({"rows": rows, "questions": ["u"], "folds": 1}), self.post_headers())
        self.assertEqual(status, 200, body)
        report = json.loads(body)
        self.assertEqual((report["labeled"], report["folds"], report["bound"]), (12, 5, "estimate"))
        self.assertEqual(sum(p["rows"] for p in report["targets"][0]["parts"]), 12)
        self.assertEqual(few, 200, fbody)
        self.assertEqual((json.loads(fbody)["targets"], json.loads(fbody)["minimum"]), ([], 6))
        self.assertEqual(bad, 400)
        self.assertIn("folds", json.loads(err)["error"])

    def test_cost_over_http_is_pure_code(self):
        rows = [{"index": i, "answers": {"u": {"type": "noul", "noul": p}}, "labels": {"u": label}, "key": "row %d" % i}
                for i, (p, label) in enumerate([(0.95, True), (0.9, False), (0.8, True), (0.7, True), (0.6, False), (0.55, True)]
                                               * 2)]
        costs = {"review": 1, "error": 3}
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/cost", json.dumps(
                {"rows": rows, "questions": ["u"], "costs": costs, "gates": {"u": 0.5}, "tune": False}), self.post_headers())
            tuned, _, tbody = self.request("POST", "/api/workbench/cost", json.dumps(
                {"rows": rows, "questions": ["u"], "costs": costs}), self.post_headers())
            held, _, hbody = self.request("POST", "/api/workbench/holdout", json.dumps(
                {"rows": rows, "questions": ["u"], "costs": costs}), self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/cost", json.dumps(
                {"rows": rows, "questions": ["u"], "costs": {"review": -1, "error": 3}}), self.post_headers())
        self.assertEqual(status, 200, body)
        report = json.loads(body)
        self.assertEqual((report["best"], report["current"]["cost"], report["review_all"]["cost"]), (None, 12.0, 12.0))
        self.assertEqual(tuned, 200, tbody)
        self.assertEqual(json.loads(tbody)["best"]["gates"], {"u": 0.21})
        self.assertEqual(held, 200, hbody)
        self.assertEqual(sum(p["rows"] for p in json.loads(hbody)["cost"]["parts"]), 12)
        self.assertEqual(bad, 400)
        self.assertIn("review cost", json.loads(err)["error"])

    def test_review_over_http_is_pure_code(self):
        rows = [{"index": 0, "answers": {"u": {"type": "noul", "noul": 0.97}}, "labels": {"u": False}},
                {"index": 1, "answers": {"u": {"type": "noul", "noul": 0.6}}, "labels": {}}]
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/review",
                                           json.dumps({"rows": rows, "question": "u", "threshold": 0.4}), self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/review",
                                       json.dumps({"rows": rows, "question": "u", "threshold": "high"}), self.post_headers())
        self.assertEqual(status, 200, body)
        report = json.loads(body)
        self.assertEqual([(s["index"], s["strong"]) for s in report["suspects"]], [(0, True)])
        self.assertEqual([r["index"] for r in report["next"]], [1])
        self.assertEqual(bad, 400)
        self.assertIn("threshold", json.loads(err)["error"])

    def test_slices_over_http_are_pure_code(self):
        rows = ([{"row": {"channel": "email"}, "correct": True, "automated": True}] * 20
                + [{"row": {"channel": "chat"}, "correct": False, "automated": True}] * 5)
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/slices", json.dumps({"rows": rows}), self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/slices", json.dumps({"rows": "all"}), self.post_headers())
        self.assertEqual(status, 200, body)
        report = json.loads(body)
        self.assertEqual(report["field"], "channel")
        self.assertEqual([(s["value"], s["below"]) for s in report["slices"]], [("email", False), ("chat", True)])
        self.assertEqual(bad, 400)
        self.assertIn("rows", json.loads(err)["error"])

    def test_csv_import_over_http_is_pure_code(self):
        questions = {"u": {"type": "noul", "instructions": "Urgent?"}}
        text = "text,u\nShip it today,yes\nNo rush,maybe\n"
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/import",
                                           json.dumps({"text": text, "questions": questions}), self.post_headers())
            bad, _, err = self.request("POST", "/api/workbench/import",
                                       json.dumps({"text": text, "questions": questions, "columns": {"u": "guess"}}),
                                       self.post_headers())
        self.assertEqual(status, 200, body)
        report = json.loads(body)
        self.assertEqual(report["rows"], [{"text": "Ship it today", "_expect": {"u": True}}, {"text": "No rush"}])
        self.assertEqual(report["problems"], [{"column": "u", "question": "u", "value": "maybe", "rows": 1}])
        self.assertEqual(bad, 400)
        self.assertIn("label:<question id>", json.loads(err)["error"])

    def test_bulk_text_accepts_json_lines_with_labels(self):
        fake = FakeClient()
        rows = 'plain\n{"text": "labeled", "_expect": {"u": true}}'
        payload = json.dumps({"rows": rows, "questions": {"u": {"type": "noul", "instructions": "Urgent?"}}})
        with patch.object(server.client, "system_one", side_effect=fake.system_one):
            status, _, body = self.request("POST", "/api/workbench/bulk", payload, self.post_headers())
        self.assertEqual(status, 200, body)
        self.assertEqual([c[0] for c in fake.calls if c[0]["text"] == "labeled"], [{"text": "labeled"}])
        self.assertEqual(json.loads(body)["labeled"], 1)

    def test_compare_over_http_runs_both_variants_then_scores_without_calls(self):
        fake = FakeClient(lambda s, q: {"u": 0.9 if q["u"]["instructions"] == "Urgent today?" else 0.2})
        variants = [{"questions": {"u": {"type": "noul", "instructions": "Urgent today?"}}},
                    {"questions": {"u": {"type": "noul", "instructions": "Urgent?"}}, "model": "jev-1.14.0"}]
        rows = '{"text": "now", "_expect": {"u": true}}\nlater'
        with patch.object(server.client, "system_one", side_effect=fake.system_one):
            status, _, body = self.request("POST", "/api/workbench/compare", json.dumps({"rows": rows, "variants": variants}),
                                           self.post_headers())
        self.assertEqual(status, 200, body)
        run = json.loads(body)
        self.assertEqual((run["rows"], run["labeled"], len(fake.calls)), (2, 1, 4))
        self.assertEqual(run["variants"][1]["model"], "jev-1.14.0")
        scored_rows = [{"index": r["index"], "label": (r.get("expect") or {}).get("u"),
                        "answers": [x["answers"]["u"] for x in r["runs"]], "meta": [x["meta"] for x in r["runs"]]}
                       for r in run["results"]]
        with patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/compare/score",
                                           json.dumps({"rows": scored_rows, "first": "B"}), self.post_headers())
        self.assertEqual(status, 200, body)
        report = json.loads(body)
        self.assertEqual([v["accuracy"] for v in report["variants"]], [1.0, 0.0])
        self.assertEqual(report["paired"]["a_only"], 1)
        cascade = report["cascade"]
        self.assertEqual((cascade["first"], cascade["rows"]), ("B", 1))
        self.assertAlmostEqual(cascade["second_alone"]["cost_usd"], run["results"][0]["runs"][0]["meta"]["cost_usd"])

    def test_compare_checks_models_before_any_call(self):
        listed = {"models": [{"name": "jev-latest"}, {"name": "jev-preview"}]}
        q = {"u": {"type": "noul", "instructions": "Urgent?"}}
        payload = json.dumps({"rows": "a row", "variants": [{"questions": q}, {"questions": q, "model": "gpt-9"}]})
        with patch.object(server.client, "models", return_value=listed), \
                patch.object(server.client, "system_one", side_effect=AssertionError("Unexpected API call")):
            status, _, body = self.request("POST", "/api/workbench/compare", payload, self.post_headers())
            one, _, err = self.request("POST", "/api/workbench/compare", json.dumps({"variants": [{"questions": q}]}),
                                       self.post_headers())
        self.assertEqual(status, 400)
        self.assertIn("gpt-9 is not available", json.loads(body)["error"])
        self.assertEqual(one, 400)
        self.assertIn("exactly two variants", json.loads(err)["error"])

    def test_model_choice_is_checked_against_the_key(self):
        self.addCleanup(server.client.set_model, None)
        listed = {"models": [{"name": "jev-latest"}, {"name": "jev-preview"}]}  # the list currently holds aliases
        with patch.object(server.client, "models", return_value=listed):
            with self.assertRaises(server.BadRequest):
                server.api_model({"model": "gpt-9"})
            with self.assertRaises(server.BadRequest):
                server.api_model({"model": "jev-1.14.0-rc1"})
            preview = server.api_model({"model": "jev-preview"})
            versioned = server.api_model({"model": "jev-1.14.0"})  # accepted even though it is not listed
            status = server.api_model({"model": "jev-latest"})
        self.assertEqual((preview["model"], preview["supports_box"]), ("jev-preview", True))
        self.assertEqual((versioned["model"], versioned["supports_box"]), ("jev-1.14.0", True))
        self.assertEqual((status["model"], status["supports_box"]), ("jev-latest", False))
        # Choosing the configured default is not an override.
        self.assertEqual(status["model_source"], "settings" if server.client.settings.model == "jev-latest" else "selected")
        self.assertEqual(server.api_model({"model": ""})["model_source"], "settings")


if __name__ == "__main__":
    unittest.main()
