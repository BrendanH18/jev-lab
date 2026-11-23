#!/usr/bin/env python3
"""Run every built-in scenario against the live model and print what Jev actually said.

    uv run scripts/validate.py [--strict] [--out report.json]

Use it after changing question wording, thresholds, or the model version. It makes paid API calls
and prints a human-readable report; nothing is cached or reused by the app. Costs use the client's
fixed pricing estimate. Use --strict to check model names and fail on scenario mismatches or
incomplete runs.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import calibrate, claims, counter, dispatch, examples, find, hello, images, play, reviews, shield, workbench  # noqa: E402
from jev.autopilot import Autopilot  # noqa: E402
from jev.client import (  # noqa: E402
    ALIASES,
    JevClient,
    JevError,
    JevResult,
    SpendGuard,
    has_known_input_price,
    is_versioned,
    price_per_input_token,
    resolve_alias,
)
from jev.config import Settings  # noqa: E402
from jev.scenarios import COMMANDS, INBOX  # noqa: E402
from jev.world import World  # noqa: E402

PLAY_SCRIPT = [
    "Is it alive?",
    "Is it an animal?",
    "Is it bigger than a car?",
    "Does it have a long neck?",
    "Is it a zebra?",
    "giraffe",
]


class StrictClient(JevClient):
    def __init__(self, settings: Settings | None = None):
        settings = settings or Settings()
        super().__init__(settings, guard=SpendGuard(settings.budget_usd, settings.rpm, wait_for_rate_limit=True))
        self.answered_by: set[str] = set()
        self.model_issue: str | None = None

    def check_model_catalog(self) -> list[str]:
        """Check the account's listed names before making paid calls."""
        catalog = self.models()
        models = catalog.get("models") if isinstance(catalog, dict) else None
        if (
            not isinstance(models, list)
            or not models
            or any(
                not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not entry["name"]
                for entry in models
            )
        ):
            raise JevError("TypeSafe returned an invalid model list.", status=502)
        names = sorted({entry["name"] for entry in models})
        unknown = sorted(
            name for name in {*names, self.model} if name.lower().startswith("jev-") and not known_jev_model(name)
        )
        if unknown:
            raise JevError("Update the Jev alias and input price tables for: %s" % ", ".join(unknown))
        return names

    def system_one(
        self,
        state: Any,
        questions: dict[str, dict],
        assets: dict[str, dict] | None = None,
        model: str | None = None,
    ) -> JevResult:
        # Some demos can recover from a failed call. A model mismatch invalidates the whole run.
        if self.model_issue:
            raise JevError(self.model_issue, status=502)
        result = super().system_one(state, questions, assets=assets, model=model)
        requested = result.request["model"]
        expected = resolve_alias(requested)
        if is_versioned(expected) and expected.count(".") == 1:
            expected += ".0"
        answered = result.response.get("model")
        if isinstance(answered, str) and answered:
            self.answered_by.add(answered)
        if not isinstance(answered, str) or not is_versioned(answered):
            self.model_issue = "%s did not report a versioned model in the response." % requested
        elif not has_known_input_price(answered):
            self.model_issue = "Add %s to the Jev input price table." % answered
        elif answered != expected and (answered.count(".") != 1 or answered + ".0" != expected):
            self.model_issue = "%s expected %s and reported %s." % (requested, expected, answered)
        if self.model_issue:
            raise JevError(self.model_issue, status=502)
        answers = result.answers or {}
        missing = [qid for qid in questions if answers.get(qid) is None]
        if missing:
            raise JevError("Response missing answers: %s" % ", ".join(missing), status=502)
        return result


def known_jev_model(name: str) -> bool:
    if is_versioned(name):
        return has_known_input_price(name)
    target = ALIASES.get(name)
    return bool(
        target
        and is_versioned(target)
        and has_known_input_price(name)
        and has_known_input_price(target)
        and price_per_input_token(name) == price_per_input_token(target)
    )


@dataclass
class Validation:
    matched: int = 0
    missed: int = 0
    incomplete: int = 0

    def check(self, matches: bool) -> None:
        if matches:
            self.matched += 1
        else:
            self.missed += 1


def pct(p):
    return "%3.0f%%" % (100 * p)


def section(title):
    print("\n" + "=" * 78 + "\n" + title + "\n" + "=" * 78)


def run(client: JevClient, out: dict, validation: Validation) -> None:
    section("Playground · 4 questions per text")
    out["playground"] = []
    for ex in hello.EXAMPLES:
        r = hello.ask(client, ex["text"])
        a = r["answers"]
        out["playground"].append({"label": ex["label"], "answers": a, "meta": r["meta"]})
        print(
            "%-16s intent=%-16s urgency=%.2f money_back=%s talks_to_ai=%s  (%d ms)"
            % (
                ex["label"],
                a["intent"]["choice"],
                a["urgency"]["score"],
                pct(a["wants_money_back"]["noul"]),
                pct(a["talks_to_ai"]["noul"]),
                r["meta"]["latency_ms"],
            )
        )

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
        ok = v["level"] == expected
        validation.check(ok)
        flagged = v["level"] != "safe"
        should_flag = expected != "safe"
        confusion["tp" if should_flag and flagged else "fp" if flagged else "fn" if should_flag else "tn"] += 1
        hot = ", ".join("%s=%s" % (s["id"], pct(s["value"])) for s in v["signals"] if s["value"] >= 0.3)
        print(
            "%-20s expect=%-10s -> %-10s %s risk=%s harm=%.2f ident=%s(%s) %s"
            % (
                m["id"],
                expected,
                v["level"],
                "ok" if ok else "??",
                pct(v["risk"]),
                res.answers["harm_if_obeyed"]["score"],
                fact["claimed_identity"],
                pct(fact["claimed_identity_prob"]),
                "domain=" + str(fact["domain_matches"]),
            )
        )
        if hot:
            print("%22s signals: %s" % ("", hot))
        if v["rules"]:
            print("%22s rules: %s" % ("", "; ".join(r["text"] for r in v["rules"])))
        out["shield"].append(
            {"id": m["id"], "attack": attack, "verdict": v, "fact": fact, "answers": res.answers, "meta": res.meta()}
        )
    print("confusion:", confusion)
    out["shield_confusion"] = confusion

    section("Dispatch · commands (fresh world, nothing executed)")
    world = World()
    out["dispatch"] = []
    for text in COMMANDS:
        cands = dispatch.candidates(text)
        res = client.system_one(
            dispatch.state_for_command(text), dispatch.questions(world.state, cands, source="command")
        )
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
        attack = bool(m["label"]["attack"])
        harm_n = bool(n["executed"]) and attack
        harm_i = bool(i["executed"]) and attack
        if i["error"]:
            validation.incomplete += 1
        elif attack:
            validation.check(not harm_i)
        print(
            "%-20s %-6s shield=%-10s auto=%-10s %-52s | alone=%s%s"
            % (
                m["id"],
                "attack" if attack else "benign",
                rec["shield"]["verdict"]["level"],
                i["lane"],
                (i["executed"] or {}).get("text", i["plan"]["signature"])[:52],
                (n["executed"] or {}).get("text", n["plan"]["decision"])[:40],
                "  <-- HARMFUL" if harm_n else "",
            )
        )
        if harm_i:
            print("%22s !!! integrated pipeline executed a harmful action" % "")
        if i["error"]:
            print("%22s integrated execution failed: %s" % ("", i["error"]))
        out["autopilot"].append(
            {
                "id": m["id"],
                "lane": i["lane"],
                "integrated": i["plan"]["signature"],
                "executed": i["executed"],
                "naive_executed": n["executed"],
                "harm_i": harm_i,
                "harm_n": harm_n,
                "verdict": rec["shield"]["verdict"]["level"],
            }
        )
    print("balances: integrated $%.2f  naive $%.2f" % (pilot.integrated.state["balance"], pilot.naive.state["balance"]))
    try:
        b = pilot.benchmark(INBOX[1])
        print(
            "benchmark: sequential %d ms / parallel %d ms / merged %d ms; tokens %d vs %d"
            % (
                b["sequential"]["wall_ms"],
                b["parallel"]["wall_ms"],
                b["merged"]["wall_ms"],
                b["sequential"]["input_tokens"],
                b["merged"]["input_tokens"],
            )
        )
        out["benchmark"] = b
    except JevError as err:
        validation.incomplete += 1
        print("benchmark failed:", err)

    section("Find · sample handbook")
    f = find.search(client, find.load_sample(), find.SAMPLE_QUERIES)
    out["find"] = f["results"]
    for r in f["results"]:
        hit = r["hits"][0]
        print(
            "%-52s %-8s exists=%s  top %s %s: %s"
            % (r["query"][:52], r["verdict"], pct(r["exists"]), hit["id"], pct(hit["prob"]), hit["text"][:60])
        )
    print("(%d ms, %d tokens)" % (f["meta"]["latency_ms"], f["meta"]["input_tokens"]))

    section("Workbench examples · shipped expectations")
    items = [
        {
            "id": e["id"],
            "name": e["title"],
            "state": e["state"],
            "questions": e["questions"],
            "expect": e["expect"],
            "images": e.get("images"),
        }
        for e in examples.EXAMPLES
    ]
    rep = workbench.run_items(client, items)
    out["examples"] = rep
    for r in rep["runs"]:
        if r.get("error") or any(q["answer"] is None for q in r["results"].values()):
            validation.incomplete += 1
        else:
            validation.check(r["ok"])
        print("%-22s %s" % (r["id"], "PASS" if r["ok"] else "FAIL" if not r.get("error") else "ERROR " + r["error"]))
        for qid, q in r.get("results", {}).items():
            a = q["answer"]
            if a is None:
                val = "—"
            elif a["type"] == "box":
                val = "box %s" % " ".join("%.2f" % a["box"][k] for k in ("left", "top", "right", "bottom"))
            else:
                val = (
                    a.get("choice")
                    if a["type"] == "choice"
                    else ("%.2f" % a["score"] if a["type"] == "score" else pct(a["noul"]))
                )
            flag = "" if q["ok"] is None else ("ok " if q["ok"] else "XX ")
            print("%24s %s%-18s %-14s %s" % ("", flag, qid, val, ", ".join(q["checks"])))
    print("passed %d / failed %d" % (rep["passed"], rep["failed"]))

    section("Claims · sample photos (drawings), decision vs what a person would decide")
    out["claims"] = []
    world = World()
    for ex in claims.EXAMPLES:
        try:
            r = claims.check(client, world, ex["order"], ex["note"], images.sample_asset(ex["sample"]))
        except JevError as err:
            validation.incomplete += 1
            print("%-12s error: %s" % (ex["label"], err))
            continue
        ev, v, loc = r["evidence"], r["verdict"], r["location"]
        ok = v["decision"] == ex["expect"]
        validation.check(ok)
        print(
            "%-12s expect=%-8s -> %-8s %s shows=%s damage=%s matches=%s severity=%.2f kind=%s box=%s (%d ms)"
            % (
                ex["label"],
                ex["expect"],
                v["decision"],
                "ok" if ok else "??",
                pct(ev["shows_item"]),
                pct(ev["damage"]),
                pct(ev["matches_note"]),
                ev["severity"],
                ev["kind"],
                (
                    "%s conf=%s"
                    % (
                        " ".join("%.2f" % loc["box"][k] for k in ("left", "top", "right", "bottom")),
                        pct(loc["confidence"]),
                    )
                )
                if loc.get("shown")
                else "hidden",
                r["meta"]["latency_ms"],
            )
        )
        out["claims"].append(
            {
                "label": ex["label"],
                "expect": ex["expect"],
                "decision": v["decision"],
                "evidence": ev,
                "location": loc,
                "meta": r["meta"],
            }
        )

    section("Counter · sample conversations, decisions vs what a person would decide")
    out["counter"] = []
    for ex in counter.EXAMPLES:
        transcript, saved, got = [], [], []
        for text in ex["turns"]:
            transcript.append({"speaker": "customer", "text": text})
            try:
                r = counter.turn(client, transcript, saved)
            except JevError as err:
                validation.incomplete += 1
                print("%s error: %s" % (ex["label"], err))
                break
            saved.append(r["answers"])
            d = r["decisions"][-1]
            got.append(d["action"])
            transcript.append({"speaker": "bot", "text": d["text"]})
            out["counter"].append({"label": ex["label"], "turn": len(saved), "decision": d, "meta": r["meta"]})
        ok = got == ex["expect"]
        if len(got) == len(ex["turns"]):
            validation.check(ok)
        print("%s expect=%s got=%s %s" % (ex["label"], ex["expect"], got, "ok" if ok else "??"))

    section("Reviews · sample reviews, triage vs what a person would decide")
    out["reviews"] = []
    matched = 0
    for ex in reviews.EXAMPLES:
        try:
            r = reviews.check(client, ex)
        except JevError as err:
            validation.incomplete += 1
            print("%-18s error: %s" % (ex["label"], err))
            continue
        t, ev = r["triage"], r["triage"]["evidence"]
        got = {"action": t["action"], "team": t["team"], "flags": t["flags"]}
        ok = got == ex["expect"]
        validation.check(ok)
        matched += ok
        print(
            "%-18s expect=%-8s %-17s -> %-8s %-17s %s %s flags=%s"
            % (
                ex["label"],
                ex["expect"]["action"],
                ex["expect"]["team"],
                t["action"],
                t["team"],
                t["priority"],
                "ok" if ok else "??",
                ",".join(t["flags"]) or "-",
            )
        )
        print(
            "%20s topic=%s(%s) severity=%.2f tone=%.2f stars=%d gap=%.2f safety=%s reply=%s about_us=%s (%d ms)"
            % (
                "",
                ev["topic"],
                pct(ev["topic_prob"]),
                ev["severity"],
                ev["tone"],
                ev["stars"],
                ev["rating_gap"],
                pct(ev["safety"]),
                pct(ev["wants_reply"]),
                pct(ev["about_us"]),
                r["meta"]["latency_ms"],
            )
        )
        if not ok and ex["expect"]["flags"] != t["flags"]:
            print("%20s expected flags=%s" % ("", ",".join(ex["expect"]["flags"]) or "-"))
        out["reviews"].append(
            {
                "label": ex["label"],
                "expect": ex["expect"],
                "got": got,
                "priority": t["priority"],
                "evidence": ev,
                "meta": r["meta"],
            }
        )
    print("matched %d / %d" % (matched, len(reviews.EXAMPLES)))

    section("Play · scripted game, secret = giraffe")
    games = play.Games(client, words=[{"word": "giraffe", "category": "animal"}])
    g = games.new()
    out["play"] = []
    for q in PLAY_SCRIPT:
        if g["over"]:
            break
        g = games.ask(g["id"], q)
        t = g["turns"][-1]
        print(
            "%-28s -> %-32s yes=%s yn=%s guess=%s match=%s"
            % (
                q,
                t["reply"],
                pct(t["probs"]["answer_is_yes"]),
                pct(t["probs"]["is_yes_no_question"]),
                pct(t["probs"]["names_a_guess"]),
                pct(t["probs"]["guess_matches"]),
            )
        )
        out["play"].append(t)
    validation.check(g["won"] and len(out["play"]) == len(PLAY_SCRIPT))

    section("Bulk · 40 sample tickets with the bulk taxonomy (examples.BULK_QUESTIONS)")
    rows = workbench.load_sample_rows()
    bulk = workbench.run_bulk(client, rows, examples.BULK_QUESTIONS)
    out["bulk"] = bulk["results"]
    depts: dict = {}
    answered = []
    for r in bulk["results"]:
        a = r.get("answers")
        if not a:
            validation.incomplete += 1
            error = "skipped after a stopped run" if r.get("skipped") else r.get("error", "no answers")
            print("row %d error: %s" % (r["index"], error))
            continue
        missing = [qid for qid in examples.BULK_QUESTIONS if a.get(qid) is None]
        if missing:
            validation.incomplete += 1
            print("row %d missing answers: %s" % (r["index"], ", ".join(missing)))
            continue
        answered.append(r)
        depts[a["department"]["choice"]] = depts.get(a["department"]["choice"], 0) + 1
        print(
            "%-64s %-10s fr=%.2f urg=%s refund=%s"
            % (
                r["row"]["text"][:64],
                a["department"]["choice"],
                a["frustration"]["score"],
                pct(a["is_urgent"]["noul"]),
                pct(a["wants_refund"]["noul"]),
            )
        )
    print(
        "departments:",
        depts,
        "| wall %d ms, %d tokens, $%.5f" % (bulk["wall_ms"], bulk["input_tokens"], bulk["cost_usd"]),
    )
    out["calibrate"] = {}
    for qid in examples.BULK_QUESTIONS if answered else ():  # evaluate() refuses an empty run
        report = calibrate.evaluate(
            [
                {"index": r["index"], "answer": r["answers"][qid], "label": (r.get("expect") or {}).get(qid)}
                for r in answered
            ]
        )
        if not report["labeled"]:
            continue
        reach = ", ".join(
            "%d%% at >=%.2f automates %s" % (t["target"] * 100, t["threshold"], pct(t["coverage"]))
            if t["threshold"] is not None
            else "%d%% unreachable" % (t["target"] * 100)
            for t in report["targets"]
        )
        print(
            "%-13s accuracy %s on %d labeled, ECE %.3f | %s"
            % (qid, pct(report["accuracy"]), report["labeled"], report["ece"], reach)
        )
        out["calibrate"][qid] = {
            k: report[k] for k in ("accuracy", "labeled", "ece", "targets", "confusion", "classes")
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", help="write the full answers as JSON here")
    parser.add_argument(
        "--strict", action="store_true", help="fail on model drift, a scenario miss, or an incomplete run"
    )
    args = parser.parse_args(argv)
    client = StrictClient() if args.strict else JevClient()
    if not client.configured:
        print("No API key. Set TYPESAFE_API_KEY or add it to .env.")
        return 1
    print("model %s via %s" % (client.model, client.backend))
    out: dict = {}
    validation = Validation()
    started = time.perf_counter()
    try:
        if isinstance(client, StrictClient):
            names = client.check_model_catalog()
            out["models"] = {"available": names}
            print("Available model names: %s" % ", ".join(names))
        run(client, out, validation)
    except JevError as err:
        validation.incomplete += 1
        print("\nStopped: %s" % err)
        return 2
    finally:
        if isinstance(client, StrictClient):
            answered_by = sorted(client.answered_by)
            out.setdefault("models", {}).update(answered_by=answered_by, issue=client.model_issue)
            print("\nModels reported by responses: %s" % (", ".join(answered_by) or "none"))
            print(
                "\nStrict validation · %d matched, %d missed, %d incomplete"
                % (validation.matched, validation.missed, validation.incomplete)
            )
        s = client.guard.snapshot()
        print(
            "\n%d live calls · %d input tokens · $%.5f · %.1f s"
            % (s["live_calls"], s["input_tokens"], s["spent_usd"], time.perf_counter() - started)
        )
        if args.out:
            Path(args.out).write_text(json.dumps(out, indent=1, default=str))
    return int(
        isinstance(client, StrictClient) and bool(validation.missed or validation.incomplete or client.model_issue)
    )


if __name__ == "__main__":
    sys.exit(main())
