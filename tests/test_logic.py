"""Offline tests for the code that composes Jev's answers. No API key needed.

Fake answers stand in for Jev so these tests check *our* logic: candidate finding,
resolution, policy checks, gating, and the Shield + Dispatch integration.
Run: python3 -m unittest discover tests
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import autopilot, dispatch, shield  # noqa: E402
from jev.client import JevResult  # noqa: E402
from jev.scenarios import INBOX  # noqa: E402
from jev.world import World  # noqa: E402


def fake_answers(questions, picks):
    """Build API-shaped answers. `picks` maps question id -> choice key, noul float, or score float."""
    out = {}
    for qid, q in questions.items():
        pick = picks.get(qid)
        if q["type"] == "choice":
            keys = list(q["criteria"])
            chosen = pick if pick is not None else keys[-1]
            rest = (1 - 0.95) / max(1, len(keys) - 1)
            probs = {k: (0.95 if k == chosen else rest) for k in keys}
            out[qid] = {"type": "choice", "choice": chosen, "probabilities": probs, "confidence": 0.9}
        elif q["type"] == "score":
            out[qid] = {"type": "score", "score": pick if pick is not None else 0.0,
                        "legend": {str(i): c for i, c in enumerate(q["criteria"])},
                        "probabilities": {str(i): 1 / len(q["criteria"]) for i in range(len(q["criteria"]))},
                        "confidence": 0.8}
        else:
            out[qid] = {"type": "noul", "noul": pick if pick is not None else 0.02}
    return out


class FakeClient:
    def __init__(self, picks_by_subject):
        self.picks_by_subject = picks_by_subject

    def system_one(self, state, questions):
        picks = self.picks_by_subject[state["message"]["subject"]]
        answers = fake_answers(questions, picks)
        return JevResult({"state": state, "model": "fake", "questions": questions},
                         {"model": "fake", "answers": answers, "usage": {"input_tokens": 1000}}, 12.0)


class CandidateTests(unittest.TestCase):
    def test_amounts(self):
        found = dispatch.find_amounts("pay $4,250.00 now, not $12 or 300 dollars")
        self.assertEqual([a["value"] for a in found], [4250.0, 12.0, 300.0])
        self.assertEqual(found[0]["key"], "$4,250.00")

    def test_times(self):
        self.assertEqual([t["key"] for t in dispatch.find_times("friday 3pm or 2:30 pm, maybe 14:00 or noon")],
                         ["15:00", "14:30", "14:00", "12:00"])


class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.world = World()

    def plan(self, text, picks, **kw):
        cands = dispatch.candidates(text)
        qs = dispatch.questions(self.world.state, cands, source="command")
        return dispatch.plan(fake_answers(qs, picks), cands, self.world, "command", text, **kw)

    def test_refund_executes_within_window(self):
        p = self.plan("refund maya's torn bag", {"tool": "refund_order", "refund.order": "A-1041",
                                                 "refund.reason": "damaged"})
        self.assertEqual(p["decision"], "execute")
        self.assertEqual(p["signature"], 'refund_order(order="A-1041", reason="damaged")')

    def test_refund_outside_window_needs_confirmation(self):
        p = self.plan("tom's kit broke", {"tool": "refund_order", "refund.order": "A-1044", "refund.reason": "damaged"})
        self.assertEqual(p["decision"], "confirm")

    def test_pay_open_invoice_resolves_amount_in_code(self):
        p = self.plan("pay packright's invoice", {"tool": "pay_vendor", "pay.vendor": "packright",
                                                  "pay.amount": "open_invoice"})
        self.assertEqual(p["exec_args"]["amount"], 860.0)
        self.assertEqual(p["decision"], "execute")

    def test_pay_unmatched_amount_needs_confirmation(self):
        p = self.plan("pay bean brokers $999", {"tool": "pay_vendor", "pay.vendor": "bean_brokers",
                                                "pay.amount": "$999.00"})
        self.assertEqual(p["decision"], "confirm")

    def test_missing_argument_clarifies(self):
        p = self.plan("move the meeting", {"tool": "reschedule_meeting", "reschedule.meeting": "not_identified"})
        self.assertEqual(p["decision"], "clarify")
        self.assertIn("meeting", p["missing"])

    def test_override_replans_without_new_answers(self):
        text = "move the tasting to friday at 3pm"
        picks = {"tool": "reschedule_meeting", "reschedule.meeting": "not_identified",
                 "reschedule.day": "friday", "reschedule.time": "15:00"}
        p = self.plan(text, picks, override={"args": {"meeting": "northside_tasting"}})
        self.assertEqual(p["decision"], "execute")
        self.assertEqual(p["exec_args"], {"meeting": "northside_tasting", "day": "friday", "time": "15:00"})

    def test_low_tool_probability_clarifies(self):
        cands = dispatch.candidates("hmm")
        qs = dispatch.questions(self.world.state, cands)
        answers = fake_answers(qs, {"tool": "create_task"})
        answers["tool"]["probabilities"] = {k: 1 / 6 for k in answers["tool"]["probabilities"]}
        answers["tool"]["probabilities"]["create_task"] = 0.3
        p = dispatch.plan(answers, cands, self.world, "command", "hmm")
        self.assertEqual(p["decision"], "clarify")


SAFE = {"shield.claimed_identity": "customer_or_person", "shield.category": "customer_request"}
PICKS = {
    "Order A-1041 arrived damaged": dict(SAFE, **{"dispatch.tool": "refund_order", "dispatch.refund.order": "A-1041",
                                                  "dispatch.refund.reason": "damaged"}),
    "URGENT: updated remittance details for INV-7781": {
        "shield.claimed_identity": "bean_brokers", "shield.ai_instructions": 0.97, "shield.payment_change": 0.98,
        "shield.secrecy_or_bypass": 0.9, "shield.pressure": 2.0, "shield.harm_if_obeyed": 3.0,
        "dispatch.tool": "pay_vendor", "dispatch.pay.vendor": "bean_brokers", "dispatch.pay.amount": "$4,250.00"},
    "Invoice INV-7781 reminder": {
        "shield.claimed_identity": "bean_brokers", "dispatch.tool": "pay_vendor",
        "dispatch.pay.vendor": "bean_brokers", "dispatch.pay.amount": "$4,250.00"},
    "never got my espresso sampler": dict(SAFE, **{"dispatch.tool": "refund_order", "dispatch.refund.order": "A-1043",
                                                   "dispatch.refund.reason": "not_delivered"}),
}


class ShieldTests(unittest.TestCase):
    def test_lookalike_domain_is_flagged(self):
        msg = INBOX[1]
        qs = shield.questions(World().state["vendors"])
        answers = fake_answers(qs, {"claimed_identity": "bean_brokers", "payment_change": 0.9})
        fact = shield.facts(msg, answers, World().state["vendors"])
        self.assertFalse(fact["domain_matches"])
        self.assertTrue(fact["lookalike_domain"])
        self.assertEqual(shield.verdict(answers, fact)["level"], "quarantine")

    def test_quiet_message_is_safe_and_weights_change_verdict(self):
        msg = INBOX[3]
        qs = shield.questions(World().state["vendors"])
        answers = fake_answers(qs, {"claimed_identity": "customer_or_person", "pressure": 0.5, "link_lure": 0.1})
        fact = shield.facts(msg, answers, World().state["vendors"])
        self.assertEqual(shield.verdict(answers, fact)["level"], "safe")
        self.assertEqual(shield.verdict(answers, fact, weights={"link_lure": 1.0, "pressure": 1.0})["level"], "review")


class AutopilotTests(unittest.TestCase):
    def test_integration_blocks_what_dispatch_alone_executes(self):
        pilot = autopilot.Autopilot(FakeClient(PICKS))
        by_subject = {m["subject"]: m for m in INBOX}

        maya = pilot.process(by_subject["Order A-1041 arrived damaged"])
        self.assertEqual(maya["integrated"]["lane"], "handled")
        self.assertIsNotNone(maya["naive"]["executed"])

        fraud = pilot.process(by_subject["URGENT: updated remittance details for INV-7781"])
        self.assertEqual(fraud["integrated"]["lane"], "quarantine")
        self.assertIsNone(fraud["integrated"]["executed"])
        self.assertIsNotNone(fraud["naive"]["executed"], "Dispatch alone pays the fraudulent invoice")

        real = pilot.process(by_subject["Invoice INV-7781 reminder"])
        self.assertEqual(real["integrated"]["lane"], "handled")
        self.assertEqual(real["naive"]["plan"]["decision"], "reject", "naive world already paid the attacker")

        stranger = pilot.process(by_subject["never got my espresso sampler"])
        self.assertEqual(stranger["integrated"]["lane"], "needs_you")
        self.assertIsNotNone(stranger["naive"]["executed"])

        resolved = pilot.resolve(stranger["id"], approve=False)
        self.assertTrue(resolved["integrated"]["dismissed"])

    def test_failed_approval_stays_in_needs_you(self):
        pilot = autopilot.Autopilot(FakeClient(PICKS))
        stranger = pilot.process(next(m for m in INBOX if m["id"] == "stranger-refund"))
        pilot.integrated.state["orders"]["A-1043"]["refunded"] = True  # someone refunded it meanwhile
        record = pilot.resolve(stranger["id"], approve=True)
        self.assertEqual(record["integrated"]["lane"], "needs_you")
        self.assertFalse(record["integrated"]["resolved"])
        self.assertIn("already refunded", record["integrated"]["error"])


if __name__ == "__main__":
    unittest.main()
