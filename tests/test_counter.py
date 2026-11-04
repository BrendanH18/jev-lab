"""Counter's rules and API boundaries, without a model or network."""
import copy
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from helpers import FakeClient, fake_answers  # noqa: E402
from jev import counter, lint, workbench  # noqa: E402


def answers(**picks):
    return fake_answers(counter.questions(), dict({"intent": "shipping_times", "frustration": 0}, **picks))


def actions(rows, policy=None):
    return [d["action"] for d in counter.decide(rows, policy)]


class RuleTests(unittest.TestCase):
    def test_reply_uses_world_template(self):
        d = counter.decide([answers()])[0]
        self.assertEqual((d["action"], d["text"]), ("reply", counter.TEMPLATES["shipping_times"]["text"]))

    def test_person_beats_resolution_and_clarification(self):
        self.assertEqual(actions([answers(asks_for_person=0.5, resolved=1, intent="other")]), ["handoff"])

    def test_streak_is_consecutive_and_inclusive(self):
        hot = answers(frustration=2.5)
        self.assertEqual(actions([hot, answers(), hot, hot]), ["reply", "reply", "reply", "handoff"])

    def test_handoff_stays_after_customer_calms_down(self):
        self.assertEqual(actions([answers(asks_for_person=1), answers(resolved=1), answers()]), ["handoff"] * 3)

    def test_misses_accumulate_across_calm_turns(self):
        self.assertEqual(actions([answers(missed=0.5), answers(), answers(missed=0.5)]), ["reply", "reply", "handoff"])

    def test_streak_beats_misses_and_close(self):
        ds = counter.decide([answers(frustration=3, missed=1), answers(frustration=3, missed=1, resolved=1)])
        self.assertIn("Frustration", ds[-1]["reason"])

    def test_misses_beat_close(self):
        self.assertEqual(actions([answers(missed=1), answers(missed=1, resolved=1)]), ["reply", "handoff"])

    def test_close_beats_other_intent(self):
        self.assertEqual(actions([answers(resolved=0.7, intent="other")]), ["close"])

    def test_other_clarifies(self):
        self.assertEqual(actions([answers(intent="other")]), ["clarify"])

    def test_low_top_probability_clarifies(self):
        a = answers()
        a["intent"]["probabilities"] = dict.fromkeys(counter.INTENTS, 1 / len(counter.INTENTS))
        self.assertEqual(actions([a]), ["clarify"])

    def test_uses_top_probability_not_untrusted_choice(self):
        a = answers()
        a["intent"]["choice"] = "other"
        self.assertEqual(actions([a]), ["reply"])

    def test_closed_chat_can_have_new_need(self):
        self.assertEqual(actions([answers(resolved=1), answers()]), ["close", "reply"])

    def test_decide_is_pure(self):
        rows = [answers(frustration=3)] * 2
        before = copy.deepcopy(rows)
        with patch.object(counter.JevClient, "system_one", side_effect=AssertionError("no call")):
            self.assertEqual(actions(rows), ["reply", "handoff"])
            self.assertEqual(actions(rows, {"streak_turns": 3}), ["reply", "reply"])
        self.assertEqual(rows, before)

    def test_policy_coercion_and_clamps(self):
        p = counter.full_policy({"person_at": "0.8", "streak_turns": 0, "missed_turns": 99,
                                 "resolved_at": float("nan"), "frustration_at": "bad", "intent_min": None})
        self.assertEqual((p["person_at"], p["streak_turns"], p["missed_turns"]), (0.8, 1, 20))
        for k in ("resolved_at", "frustration_at", "intent_min"):
            self.assertEqual(p[k], counter.DEFAULT_POLICY[k])

    def test_questions_pass_lint_and_workbench(self):
        for ex in counter.EXAMPLES:
            state = counter.state_for([{"speaker": "customer", "text": ex["turns"][0]}])
            workbench.validate_state(state)
            qs = workbench.validate_questions(counter.questions())
            self.assertEqual(lint.check(state, qs)["findings"], [])


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient(lambda state, qs: {"intent": "shipping_times", "frustration": 3})
        p = patch.object(server, "client", self.client)
        p.start()
        self.addCleanup(p.stop)
        self.transcript = [{"speaker": "customer", "text": "Where is it?"}]

    def test_setup_and_one_call_per_turn(self):
        self.assertEqual(server.api_counter_setup({})["examples"], counter.EXAMPLES)
        r = server.api_counter_turn({"transcript": self.transcript})
        transcript = self.transcript + [{"speaker": "bot", "text": r["decisions"][-1]["text"]}, self.transcript[0]]
        r2 = server.api_counter_turn({"transcript": transcript, "turn_answers": [r["answers"]]})
        self.assertEqual(r2["decisions"][-1]["action"], "handoff")
        self.assertEqual(len(self.client.calls), 2)
        state, qs = self.client.calls[-1]
        self.assertEqual(len(qs), 5)
        self.assertEqual(state["latest_customer_message"], "Where is it?")
        self.assertEqual(state["conversation"], transcript)
        for k in ("meta", "trace", "answers", "policy"):
            self.assertIn(k, r)
        again = server.api_counter_decide({"turn_answers": [r["answers"], r2["answers"]], "policy": {"streak_turns": 3}})
        self.assertEqual([d["action"] for d in again["decisions"]], ["reply", "reply"])
        self.assertIn("compute_ms", again)
        self.assertEqual(len(self.client.calls), 2)

    def test_invalid_transcripts_make_no_calls(self):
        bad = [None, {}, [], ["text"]]
        bad += [[{"speaker": "customer", "text": t}] for t in (None, " ", "x" * 2001)]
        bad += [[{"speaker": "bot", "text": "hi"}], self.transcript * 40,
                self.transcript + [{"speaker": "bot", "text": "invented"}] + self.transcript]
        for transcript in bad:
            with self.subTest(transcript=transcript), self.assertRaises(server.BadRequest):
                server.api_counter_turn({"transcript": transcript})
        for extra in ({"policy": []}, {"turn_answers": [answers()]}, {"turn_answers": None}):
            with self.assertRaises(server.BadRequest):
                server.api_counter_turn(dict({"transcript": self.transcript}, **extra))
        self.assertEqual(self.client.calls, [])

    def test_invalid_saved_answers(self):
        bad = [None, {}, [None], [{}], [answers()] * 21]
        for key, value in (("intent", {"choice": "unknown"}), ("frustration", {"score": 5}),
                           ("resolved", {"noul": True}), ("missed", {"noul": float("nan")}),
                           ("asks_for_person", {"noul": -1})):
            bad.append([dict(answers(), **{key: value})])
        a = answers()
        a["intent"]["probabilities"]["other"] = "x"
        bad.append([a])
        for rows in bad:
            with self.subTest(rows=rows), self.assertRaises(server.BadRequest):
                server.api_counter_decide({"turn_answers": rows})
        with self.assertRaises(server.BadRequest):
            server.api_counter_decide({"turn_answers": [], "policy": "strict"})
        self.assertEqual(self.client.calls, [])


if __name__ == "__main__":
    unittest.main()
