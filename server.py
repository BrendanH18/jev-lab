#!/usr/bin/env python3
"""Jev Lab: a local server for the demos, the Workbench, and the API-key onboarding.

    uv run server.py        # or: python3 server.py
    open http://127.0.0.1:8321

The TypeSafe API key stays on this server. The browser never sees it, and every request is checked
by jev/security.py so that other websites cannot drive this server or spend your credits.
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from jev import dispatch, envfile, examples, find, hello, security, shield, workbench
from jev.autopilot import Autopilot, find_message
from jev.client import PRICE_PER_INPUT_TOKEN_USD, JevClient, JevError
from jev.config import PROJECT_ROOT, Settings
from jev.play import Games
from jev.scenarios import COMMANDS, INBOX
from jev.world import TEMPLATES, World

VERSION = "0.2.0"
STATIC = PROJECT_ROOT / "static"
PAGES = {"/": "index.html", "/shield": "shield.html", "/dispatch": "dispatch.html", "/autopilot": "autopilot.html",
         "/find": "find.html", "/play": "play.html", "/workbench": "workbench.html"}
MAX_BODY_BYTES = 4 * 1024 * 1024

settings = Settings()
client = JevClient(settings)
dispatch_world = World()
autopilot = Autopilot(client)
games = Games(client)
SESSION_TOKEN = security.new_token()


class BadRequest(Exception):
    pass


# --- status and key management ------------------------------------------------------------


def env_status() -> dict:
    problems = envfile.preflight(PROJECT_ROOT)
    return {
        "path": ".env",
        "exists": settings.env_file.exists(),
        "perms_ok": envfile.permissions_ok(settings.env_file),
        "git_repo": envfile.in_git_repo(PROJECT_ROOT),
        "problems": problems,
        "can_save": not problems,
    }


def api_status(_body):
    return {
        "version": VERSION,
        "configured": client.configured,
        "key_source": client.key_source,
        "model": client.model,
        "backend": client.backend,
        "price_per_mtok_input": PRICE_PER_INPUT_TOKEN_USD * 1_000_000,
        "spend": client.guard.snapshot(),
        "env": env_status(),
    }


def api_key(body):
    key = (body.get("key") or "").strip()
    if not key:
        raise BadRequest("Paste an API key first.")
    previous = client._memory_key
    client.set_api_key(key)
    try:
        models = client.models().get("models", [])
    except JevError:
        client.set_api_key(previous)
        raise
    status = {"saved": False, "save_error": None, "models": models}
    if body.get("save"):
        client.reload_settings()
        existing = client.settings.file_values.get("TYPESAFE_API_KEY")
        if existing and existing != key and not body.get("replace"):
            status["save_error"] = ("A different key is already saved in .env. Use “Forget key” first "
                                    "(or send replace: true). The new key is active for this run only.")
        else:
            try:
                envfile.write_key(PROJECT_ROOT, key)
                client.reload_settings()
                client.set_api_key(None)  # the file is now the source of truth
                status["saved"] = True
            except envfile.EnvFileError as err:
                status["save_error"] = str(err)  # key stays in memory for this run
    status.update(api_status({}))
    return status


def api_key_forget(_body):
    client.set_api_key(None)
    removed = envfile.forget_key(PROJECT_ROOT)
    client.reload_settings()
    if client.settings.key_source == "env":
        client.settings.environ.pop("TYPESAFE_API_KEY", None)  # ignore the process env key for this run
    status = api_status({})
    status["removed_from_file"] = removed
    return status


def api_models(_body):
    return client.models()


# --- demos ---------------------------------------------------------------------------------


def api_scenarios(_body):
    return {"inbox": [dict(m) for m in INBOX], "commands": COMMANDS, "templates": TEMPLATES,
            "hello_examples": hello.EXAMPLES}


def api_hello(body):
    text = (body.get("text") or "").strip()
    if not text:
        raise BadRequest("text is required")
    return hello.ask(client, text[:4000])


def api_shield(body):
    message = body.get("message") or {}
    if not (message.get("body") or message.get("subject")):
        raise BadRequest("message.body is required")
    vendors = dispatch_world.state["vendors"]
    result = client.system_one(shield.state_for(message), shield.questions(vendors))
    fact = shield.facts(message, result.answers, vendors)
    return {"meta": result.meta(), "trace": result.trace(), "answers": result.answers, "fact": fact,
            "verdict": shield.verdict(result.answers, fact, body.get("weights"), body.get("policy"))}


def api_shield_rescore(body):
    """Re-weight existing judgments. Pure code: no Jev call."""
    started = time.perf_counter()
    verdict = shield.verdict(body["answers"], body["fact"], body.get("weights"), body.get("policy"))
    return {"verdict": verdict, "compute_ms": round((time.perf_counter() - started) * 1000, 3)}


def api_shield_batch(body):
    messages = (body.get("messages") or [dict(m) for m in INBOX])[:50]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=min(16, len(messages))) as pool:
        results = list(pool.map(lambda m: dict(api_shield({"message": m, "weights": body.get("weights")}),
                                               id=m.get("id")), messages))
    return {"results": results, "wall_ms": round((time.perf_counter() - started) * 1000, 1),
            "total_cost_usd": sum(r["meta"]["cost_usd"] for r in results),
            "total_input_tokens": sum(r["meta"]["input_tokens"] for r in results)}


def _dispatch_plan(text, answers, override=None):
    cands = dispatch.candidates(text)
    return cands, dispatch.plan(answers, cands, dispatch_world, "command", text, override=override)


def api_dispatch(body):
    text = (body.get("text") or "").strip()[:1000]
    if not text:
        raise BadRequest("text is required")
    cands = dispatch.candidates(text)
    result = client.system_one(dispatch.state_for_command(text),
                               dispatch.questions(dispatch_world.state, cands, source="command"))
    _, plan = _dispatch_plan(text, result.answers)
    out = {"meta": result.meta(), "trace": result.trace(), "answers": result.answers, "candidates": cands,
           "plan": plan}
    if body.get("execute") and plan["decision"] == "execute":
        out["executed"] = dispatch_world.execute(plan["tool"], plan["exec_args"], {"via": "dispatch"})
        out["world"] = dispatch_world.snapshot()
    return out


def api_dispatch_replan(body):
    """Re-plan from answers Jev already gave (e.g. after the user picks a clarification). No Jev call."""
    _, plan = _dispatch_plan(body["text"], body["answers"], body.get("override"))
    return {"plan": plan}


def api_dispatch_execute(body):
    try:
        entry = dispatch_world.execute(body["tool"], body["exec_args"], {"via": "dispatch"})
    except (KeyError, ValueError) as err:
        raise BadRequest(str(err))
    return {"executed": entry, "world": dispatch_world.snapshot()}


def api_dispatch_world(_body):
    return dispatch_world.snapshot()


def api_dispatch_reset(_body):
    dispatch_world.reset()
    return dispatch_world.snapshot()


def _autopilot_worlds():
    return {"integrated": autopilot.integrated.snapshot(), "naive": autopilot.naive.snapshot()}


def api_autopilot_process(body):
    message = find_message(INBOX, body.get("id")) if body.get("id") else body.get("message")
    if not message:
        raise BadRequest("Unknown message")
    return {"record": autopilot.process(message), "worlds": _autopilot_worlds()}


def api_autopilot_resolve(body):
    return {"record": autopilot.resolve(body["id"], bool(body.get("approve"))), "worlds": _autopilot_worlds()}


def api_autopilot_state(_body):
    return autopilot.snapshot()


def api_autopilot_reset(_body):
    autopilot.reset()
    return autopilot.snapshot()


def api_autopilot_benchmark(body):
    if not client.configured:
        raise JevError("The benchmark measures live calls, so it needs an API key.", status=401)
    return autopilot.benchmark(find_message(INBOX, body.get("id")) or INBOX[1])


# --- find / play / workbench ---------------------------------------------------------------


def api_find_sample(_body):
    return {"text": find.load_sample(), "queries": find.SAMPLE_QUERIES}


def api_find(body):
    text = body.get("text")
    if text in (None, ""):
        text = find.load_sample()
    queries = body.get("queries") or []
    if isinstance(queries, str):
        queries = [queries]
    try:
        return find.search(client, str(text), [str(q) for q in queries])
    except ValueError as err:
        raise BadRequest(str(err))


def api_play_new(body):
    return games.new(body.get("seed"))


def api_play_ask(body):
    try:
        return games.ask(str(body.get("id", "")), str(body.get("text", "")))
    except KeyError:
        raise BadRequest("Unknown game; start a new one.")
    except ValueError as err:
        raise BadRequest(str(err))


def api_play_giveup(body):
    try:
        return games.give_up(str(body.get("id", "")))
    except KeyError:
        raise BadRequest("Unknown game; start a new one.")


def api_wb_examples(_body):
    return {"examples": examples.public_examples()}


def api_wb_run(body):
    return workbench.run(client, body.get("state"), body.get("questions"))


def api_wb_export(body):
    return workbench.export(body.get("state"), body.get("questions"), client.model)


def api_wb_items(_body):
    return {"items": workbench.list_items()}


def api_wb_save(body):
    return {"item": workbench.save_item(body)}


def api_wb_delete(body):
    return {"deleted": workbench.delete_item(str(body.get("id", "")))}


def api_wb_run_items(body):
    ids = body.get("ids")
    items = workbench.list_items()
    if ids:
        items = [it for it in items if it["id"] in set(ids)]
    if body.get("item"):  # run an unsaved item
        items = [dict(body["item"], questions=workbench.validate_questions(body["item"].get("questions")))]
    if not items:
        raise BadRequest("No saved tests yet. Save one from the Workbench first.")
    return workbench.run_items(client, items)


def api_wb_bulk(body):
    rows = body.get("rows")
    if isinstance(rows, str):
        rows = [ln.strip() for ln in rows.splitlines() if ln.strip()]
    if not rows:
        rows = workbench.load_sample_rows()
    return workbench.run_bulk(client, rows, body.get("questions"), str(body.get("field") or "text"))


def api_wb_bulk_sample(_body):
    return {"rows": workbench.load_sample_rows(), "questions": examples.get("support-triage")["questions"]}


ROUTES = {
    ("GET", "/api/status"): api_status,
    ("POST", "/api/key"): api_key,
    ("POST", "/api/key/forget"): api_key_forget,
    ("GET", "/api/models"): api_models,
    ("GET", "/api/scenarios"): api_scenarios,
    ("POST", "/api/hello"): api_hello,
    ("POST", "/api/shield"): api_shield,
    ("POST", "/api/shield/rescore"): api_shield_rescore,
    ("POST", "/api/shield/batch"): api_shield_batch,
    ("POST", "/api/dispatch"): api_dispatch,
    ("POST", "/api/dispatch/replan"): api_dispatch_replan,
    ("POST", "/api/dispatch/execute"): api_dispatch_execute,
    ("GET", "/api/dispatch/world"): api_dispatch_world,
    ("POST", "/api/dispatch/reset"): api_dispatch_reset,
    ("POST", "/api/autopilot/process"): api_autopilot_process,
    ("POST", "/api/autopilot/resolve"): api_autopilot_resolve,
    ("GET", "/api/autopilot/state"): api_autopilot_state,
    ("POST", "/api/autopilot/reset"): api_autopilot_reset,
    ("POST", "/api/autopilot/benchmark"): api_autopilot_benchmark,
    ("GET", "/api/find/sample"): api_find_sample,
    ("POST", "/api/find"): api_find,
    ("POST", "/api/play/new"): api_play_new,
    ("POST", "/api/play/ask"): api_play_ask,
    ("POST", "/api/play/giveup"): api_play_giveup,
    ("GET", "/api/workbench/examples"): api_wb_examples,
    ("POST", "/api/workbench/run"): api_wb_run,
    ("POST", "/api/workbench/export"): api_wb_export,
    ("GET", "/api/workbench/items"): api_wb_items,
    ("POST", "/api/workbench/items"): api_wb_save,
    ("POST", "/api/workbench/items/delete"): api_wb_delete,
    ("POST", "/api/workbench/items/run"): api_wb_run_items,
    ("POST", "/api/workbench/bulk"): api_wb_bulk,
    ("GET", "/api/workbench/bulk/sample"): api_wb_bulk_sample,
}

CSP = ("default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


class Handler(BaseHTTPRequestHandler):
    server_version = "JevLab/" + VERSION
    port = 8321

    def log_message(self, fmt, *args):
        if os.environ.get("JEV_LAB_QUIET"):
            return
        sys.stderr.write("  %s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _send(self, status, payload, content_type="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method):
        path = urlparse(self.path).path.rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or 0)
        reason = security.check_request(method, self.headers, SESSION_TOKEN, self.port, has_body=length > 0)
        if reason:
            return self._send(403, {"error": security.REASONS[reason], "reason": reason})
        route = ROUTES.get((method, path))
        if route:
            try:
                if length > MAX_BODY_BYTES:
                    raise BadRequest("Request body too large")
                body = json.loads(self.rfile.read(length).decode() or "{}") if length else {}
                if not isinstance(body, dict):
                    raise BadRequest("Body must be a JSON object")
                self._send(200, route(body))
            except (BadRequest, workbench.WorkbenchError, envfile.EnvFileError) as err:
                self._send(400, {"error": str(err)})
            except JevError as err:
                status = err.status if err.status in (401, 402, 403, 422, 429) else 502
                self._send(status, {"error": str(err), "jev_status": err.status})
            except (KeyError, ValueError, TypeError) as err:
                traceback.print_exc()
                self._send(400, {"error": "Bad request: %s" % err})
            except Exception as err:  # noqa: BLE001
                traceback.print_exc()
                self._send(500, {"error": "Server error: %s" % err})
            return
        if method != "GET":
            return self._send(404, {"error": "Not found"})
        if path in PAGES:
            html = (STATIC / PAGES[path]).read_text()
            html = html.replace("</head>", '<meta name="jev-csrf" content="%s">\n</head>' % SESSION_TOKEN, 1)
            return self._send(200, html.encode(), "text/html; charset=utf-8")
        file = (STATIC / path.lstrip("/")).resolve()
        if not str(file).startswith(str(STATIC)) or not file.is_file():
            return self._send(404, {"error": "Not found"})
        ctype = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, file.read_bytes(), ctype)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    port = settings.port
    Handler.port = port
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as err:
        print("Could not listen on 127.0.0.1:%d (%s). Set PORT=<other port> and try again." % (port, err))
        return 1
    key_note = ("API key from %s" % client.key_source) if client.configured else "no API key yet: connect one in the app"
    print("\n  Jev Lab %s  →  http://127.0.0.1:%d" % (VERSION, port))
    print("  model %s via %s · %s" % (client.model, client.backend, key_note))
    print("  every call is live · spend guard $%.2f per run (JEV_LAB_BUDGET_USD)\n" % client.guard.budget_usd)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
