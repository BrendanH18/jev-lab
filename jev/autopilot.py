"""Autopilot: Shield + Dispatch merged into one Jev request per email.

The integration is where the value shows up:
  * one request instead of two (both question sets share the same state and run in parallel),
  * Shield's verdict gates Dispatch's actions,
  * the sender facts Shield computes feed Dispatch's authorization checks,
  * the same answers also show what Dispatch alone would have done, at no extra cost.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

from . import dispatch, shield
from .client import JevClient
from .world import World


def _text(message: dict) -> str:
    return "%s\n%s" % (message.get("subject", ""), message.get("body", ""))


def split(answers: Dict[str, dict]) -> tuple:
    s = {k[len("shield."):]: v for k, v in answers.items() if k.startswith("shield.")}
    d = {k[len("dispatch."):]: v for k, v in answers.items() if k.startswith("dispatch.")}
    return s, d


def merged_questions(world: World, cands: dict) -> Dict[str, dict]:
    qs = {"shield." + k: v for k, v in shield.questions(world.state["vendors"]).items()}
    qs.update({"dispatch." + k: v for k, v in dispatch.questions(world.state, cands, source="email").items()})
    return qs


def _context(message: dict, shield_answers: dict) -> dict:
    redirect = float(shield_answers["payment_change"]["noul"]) >= 0.5
    return {
        "via": "autopilot",
        "requested_by": message.get("from_name") or message.get("from_email"),
        "destination": "new account from the email" if redirect else "account on file",
    }


def _run(world: World, plan: dict, context: dict) -> tuple:
    try:
        return world.execute(plan["tool"], plan["exec_args"], context), None
    except (ValueError, KeyError) as err:
        return None, str(err)


class Autopilot:
    def __init__(self, client: JevClient):
        self.client = client
        self.integrated = World()
        self.naive = World()
        self.records: Dict[str, dict] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self.integrated.reset()
            self.naive.reset()
            self.records.clear()

    def process(self, message: dict) -> dict:
        text = _text(message)
        cands = dispatch.candidates(text)
        state = shield.state_for(message)
        result = self.client.system_one(state, merged_questions(self.integrated, cands))
        s_answers, d_answers = split(result.answers)

        fact = shield.facts(message, s_answers, self.integrated.state["vendors"])
        verdict = shield.verdict(s_answers, fact)
        sender = message.get("from_email", "")
        context = _context(message, s_answers)

        with self._lock:
            # Integrated pipeline: Shield gates, sender facts feed Dispatch's checks.
            plan_i = dispatch.plan(d_answers, cands, self.integrated, "email", message.get("body", ""),
                                   sender_email=sender, sender_checks=True)
            executed_i, error_i = None, None
            if verdict["level"] == "quarantine":
                lane = "quarantine"
            elif plan_i["decision"] == "none":
                lane = "ignored"
            elif verdict["level"] == "review":
                lane = "needs_you"
                plan_i["reasons"] = ["Shield flagged this message for review"] + plan_i["reasons"]
                plan_i["decision"] = "confirm" if plan_i["decision"] == "execute" else plan_i["decision"]
            elif plan_i["decision"] == "execute":
                executed_i, error_i = _run(self.integrated, plan_i, context)
                lane = "handled" if executed_i else "needs_you"
            else:
                lane = "needs_you"

            # Dispatch alone: same answers, trusts the email as if the owner had typed it.
            plan_n = dispatch.plan(d_answers, cands, self.naive, "email", message.get("body", ""),
                                   sender_email=sender, sender_checks=False)
            executed_n, error_n = None, None
            if plan_n["decision"] == "execute":
                executed_n, error_n = _run(self.naive, plan_n, context)

            record = {
                "id": message.get("id") or "msg-%d" % (len(self.records) + 1),
                "message": {k: message.get(k) for k in ("from_name", "from_email", "subject", "body")},
                "label": message.get("label"),
                "meta": result.meta(),
                "trace": result.trace(),
                "shield": {"verdict": verdict, "fact": fact},
                "integrated": {"lane": lane, "plan": plan_i, "executed": executed_i, "error": error_i,
                               "context": context, "resolved": bool(executed_i) or lane in ("quarantine", "ignored")},
                "naive": {"plan": plan_n, "executed": executed_n, "error": error_n},
            }
            self.records[record["id"]] = record
            return record

    def resolve(self, record_id: str, approve: bool) -> dict:
        with self._lock:
            record = self.records[record_id]
            integrated = record["integrated"]
            if integrated["resolved"]:
                return record
            if approve and integrated["plan"]["tool"] != "none" and not integrated["plan"]["missing"]:
                executed, error = _run(self.integrated, integrated["plan"], integrated["context"])
                integrated.update({"executed": executed, "error": error, "approved": bool(executed)})
                if error:
                    return record  # stays in "needs you" with the error shown
            else:
                integrated["dismissed"] = True
            integrated["resolved"] = True
            integrated["lane"] = "handled"
            return record

    def benchmark(self, message: dict) -> dict:
        """Measure the same judgments as two separate requests vs one merged request."""
        cands = dispatch.candidates(_text(message))
        state = shield.state_for(message)
        s_q = shield.questions(self.integrated.state["vendors"])
        d_q = dispatch.questions(self.integrated.state, cands, source="email")
        m_q = merged_questions(self.integrated, cands)

        def timed(fn):
            started = time.perf_counter()
            out = fn()
            return out, (time.perf_counter() - started) * 1000

        (s_res, d_res), seq_ms = timed(lambda: (self.client.system_one(state, s_q), self.client.system_one(state, d_q)))

        def parallel():
            with ThreadPoolExecutor(max_workers=2) as pool:
                a = pool.submit(self.client.system_one, state, s_q)
                b = pool.submit(self.client.system_one, state, d_q)
                return a.result(), b.result()

        (ps_res, pd_res), par_ms = timed(parallel)
        m_res, merged_ms = timed(lambda: self.client.system_one(state, m_q))

        def summary(results, wall_ms):
            return {
                "requests": len(results),
                "wall_ms": round(wall_ms, 1),
                "input_tokens": sum(r.input_tokens for r in results),
                "cost_usd": sum(r.cost_usd for r in results),
                "questions": sum(len(r.request["questions"]) for r in results),
            }

        return {
            "sequential": summary([s_res, d_res], seq_ms),
            "parallel": summary([ps_res, pd_res], par_ms),
            "merged": summary([m_res], merged_ms),
            "per_call_ms": {"shield": round(s_res.latency_ms, 1), "dispatch": round(d_res.latency_ms, 1),
                            "merged": round(m_res.latency_ms, 1)},
        }

    def snapshot(self) -> dict:
        with self._lock:
            return {"integrated": self.integrated.snapshot(), "naive": self.naive.snapshot(),
                    "records": list(self.records.values())}


def find_message(inbox: list, message_id: Optional[str]) -> Optional[dict]:
    return next((m for m in inbox if m["id"] == message_id), None)
