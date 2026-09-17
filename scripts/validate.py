#!/usr/bin/env python3
"""Run every built-in scenario against the live model and print what Jev actually said.

    uv run scripts/validate.py [--out report.json]

Use it after changing question wording, thresholds, or the model version. It spends real credits
(about a hundred small calls, well under a cent) and prints a human-readable report; nothing is
cached or reused by the app.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import dispatch, examples, find, hello, play, shield, workbench  # noqa: E402
from jev.autopilot import Autopilot  # noqa: E402
from jev.client import JevClient, JevError  # noqa: E402
from jev.scenarios import COMMANDS, INBOX  # noqa: E402
from jev.world import World  # noqa: E402

PLAY_SCRIPT = ["Is it alive?", "Is it an animal?", "Is it bigger than a car?", "Does it have a long neck?",
               "Is it a zebra?", "giraffe"]


def pct(p):
    return "%3.0f%%" % (100 * p)


def section(title):
    print("\n" + "=" * 78 + "\n" + title + "\n" + "=" * 78)


def run(client: JevClient, out: dict) -> None:
    section("Playground · 4 questions per text")
    out["playground"] = []
    for ex in hello.EXAMPLES:
        r = hello.ask(client, ex["text"])
        a = r["answers"]
        out["playground"].append({"label": ex["label"], "answers": a, "meta": r["meta"]})
        print("%-16s intent=%-16s urgency=%.2f money_back=%s talks_to_ai=%s  (%d ms)" % (
            ex["label"], a["intent"]["choice"], a["urgency"]["score"], pct(a["wants_money_back"]["noul"]),
            pct(a["talks_to_ai"]["noul"]), r["meta"]["latency_ms"]))

    section("Shield · verdict per inbox message (label = scenario ground truth)")
    vendors = World().state["vendors"]
    out["shield"] = []
    confusion = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    for m in INBOX:
        res = client.system_one(shield.state_for(m), shield.questions(vendors))
        fact = shield.facts(m, res.answers, vendors)
        v = shield.verdict(res.answers, fact)
        attack = bool(m["label"]["attack"])
        expected = m["label"].get("shield", "quarantine" if attack else "safe")
        flagged = v["level"] != "safe"
        should_flag = expected != "safe"
        confusion["tp" if should_flag and flagged else "fp" if flagged else "fn" if should_flag else "tn"] += 1
        hot = ", ".join("%s=%s" % (s["id"], pct(s["value"])) for s in v["signals"] if s["value"] >= 0.3)
        print("%-20s expect=%-10s -> %-10s %s risk=%s harm=%.2f ident=%s(%s) %s" % (
            m["id"], expected, v["level"], "ok" if (v["level"] == expected) else "??", pct(v["risk"]),
            res.answers["harm_if_obeyed"]["score"], fact["claimed_identity"], pct(fact["claimed_identity_prob"]),
            "domain=" + str(fact["domain_matches"])))
        if hot:
            print("%22s signals: %s" % ("", hot))
        if v["rules"]:
            print("%22s rules: %s" % ("", "; ".join(r["text"] for r in v["rules"])))
        out["shield"].append({"id": m["id"], "attack": attack, "verdict": v, "fact": fact, "answers": res.answers,
                              "meta": res.meta()})
    print("confusion:", confusion)
    out["shield_confusion"] = confusion

    section("Dispatch · commands (fresh world, nothing executed)")
    world = World()
    out["dispatch"] = []
    for text in COMMANDS:
        cands = dispatch.candidates(text)
        res = client.system_one(dispatch.state_for_command(text), dispatch.questions(world.state, cands, source="command"))
        p = dispatch.plan(res.answers, cands, world, "command", text)
        top = ", ".join("%s %s" % (t["value"], pct(t["prob"])) for t in p["tool_ranking"][:2])
        print("%-58s -> %-9s conf=%s  %s" % (text[:58], p["decision"], pct(p["confidence"]), p["signature"]))
        print("%60s tools: %s%s" % ("", top, ("; " + "; ".join(p["reasons"])) if p["decision"] != "execute" else ""))
        out["dispatch"].append({"text": text, "plan": p, "answers": res.answers, "meta": res.meta()})

    section("Autopilot · full inbox, integrated vs Dispatch alone")
    pilot = Autopilot(client)
    out["autopilot"] = []
    for m in INBOX:
        rec = pilot.process(m)
        i, n = rec["integrated"], rec["naive"]
        harm_n = bool(n["executed"]) and bool(m["label"]["attack"])
        harm_i = bool(i["executed"]) and bool(m["label"]["attack"])
        print("%-20s %-6s shield=%-10s auto=%-10s %-52s | alone=%s%s" % (
            m["id"], "attack" if m["label"]["attack"] else "benign", rec["shield"]["verdict"]["level"], i["lane"],
            (i["executed"] or {}).get("text", i["plan"]["signature"])[:52],
            (n["executed"] or {}).get("text", n["plan"]["decision"])[:40], "  <-- HARMFUL" if harm_n else ""))
        if harm_i:
            print("%22s !!! integrated pipeline executed a harmful action" % "")
        out["autopilot"].append({"id": m["id"], "lane": i["lane"], "integrated": i["plan"]["signature"],
                                 "executed": i["executed"], "naive_executed": n["executed"], "harm_i": harm_i,
                                 "harm_n": harm_n, "verdict": rec["shield"]["verdict"]["level"]})
    print("balances: integrated $%.2f  naive $%.2f" % (pilot.integrated.state["balance"], pilot.naive.state["balance"]))
    try:
        b = pilot.benchmark(INBOX[1])
        print("benchmark: sequential %d ms / parallel %d ms / merged %d ms; tokens %d vs %d" % (
            b["sequential"]["wall_ms"], b["parallel"]["wall_ms"], b["merged"]["wall_ms"],
            b["sequential"]["input_tokens"], b["merged"]["input_tokens"]))
        out["benchmark"] = b
    except JevError as err:
        print("benchmark failed:", err)

    section("Find · sample handbook")
    f = find.search(client, find.load_sample(), find.SAMPLE_QUERIES)
    out["find"] = f["results"]
    for r in f["results"]:
        hit = r["hits"][0]
        print("%-52s %-8s exists=%s  top %s %s: %s" % (r["query"][:52], r["verdict"], pct(r["exists"]), hit["id"],
                                                      pct(hit["prob"]), hit["text"][:60]))
    print("(%d ms, %d tokens)" % (f["meta"]["latency_ms"], f["meta"]["input_tokens"]))

    section("Workbench examples · shipped expectations")
    items = [{"id": e["id"], "name": e["title"], "state": e["state"], "questions": e["questions"], "expect": e["expect"]}
             for e in examples.EXAMPLES]
    rep = workbench.run_items(client, items)
    out["examples"] = rep
    for r in rep["runs"]:
        print("%-22s %s" % (r["id"], "PASS" if r["ok"] else "FAIL" if not r.get("error") else "ERROR " + r["error"]))
        for qid, q in r.get("results", {}).items():
            a = q["answer"]
            val = a.get("choice") if a["type"] == "choice" else ("%.2f" % a["score"] if a["type"] == "score" else pct(a["noul"]))
            flag = "" if q["ok"] is None else ("ok " if q["ok"] else "XX ")
            print("%24s %s%-18s %-14s %s" % ("", flag, qid, val, ", ".join(q["checks"])))
    print("passed %d / failed %d" % (rep["passed"], rep["failed"]))

    section("Play · scripted game, secret = giraffe")
    games = play.Games(client, words=[{"word": "giraffe", "category": "animal"}])
    g = games.new()
    out["play"] = []
    for q in PLAY_SCRIPT:
        if g["over"]:
            break
        g = games.ask(g["id"], q)
        t = g["turns"][-1]
        print("%-28s -> %-32s yes=%s yn=%s guess=%s match=%s" % (q, t["reply"], pct(t["probs"]["answer_is_yes"]),
              pct(t["probs"]["is_yes_no_question"]), pct(t["probs"]["names_a_guess"]), pct(t["probs"]["guess_matches"])))
        out["play"].append(t)

    section("Bulk · 40 sample tickets with the bulk taxonomy (examples.BULK_QUESTIONS)")
    rows = workbench.load_sample_rows()
    bulk = workbench.run_bulk(client, rows, examples.BULK_QUESTIONS)
    out["bulk"] = bulk["results"]
    depts: dict = {}
    for r in bulk["results"]:
        a = r.get("answers")
        if not a:
            print("row %d error: %s" % (r["index"], r.get("error")))
            continue
        depts[a["department"]["choice"]] = depts.get(a["department"]["choice"], 0) + 1
        print("%-64s %-10s fr=%.2f urg=%s refund=%s" % (r["row"][:64], a["department"]["choice"], a["frustration"]["score"],
                                                        pct(a["is_urgent"]["noul"]), pct(a["wants_refund"]["noul"])))
    print("departments:", depts, "| wall %d ms, %d tokens, $%.5f" % (bulk["wall_ms"], bulk["input_tokens"], bulk["cost_usd"]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", help="write the full answers as JSON here")
    args = parser.parse_args()
    client = JevClient()
    if not client.configured:
        print("No API key. Set TYPESAFE_API_KEY or add it to .env.")
        return 1
    print("model %s via %s" % (client.model, client.backend))
    out: dict = {}
    started = time.perf_counter()
    try:
        run(client, out)
    except JevError as err:
        print("\nStopped: %s" % err)
        return 2
    finally:
        s = client.guard.snapshot()
        print("\n%d live calls · %d input tokens · $%.5f · %.1f s" % (
            s["live_calls"], s["input_tokens"], s["spent_usd"], time.perf_counter() - started))
        if args.out:
            Path(args.out).write_text(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
