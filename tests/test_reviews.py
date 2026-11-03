"""Offline tests for the Reviews triage policy and its routes. No API key needed."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from helpers import FakeClient, fake_answers  # noqa: E402

import server  # noqa: E402

from jev import lint, reviews, workbench  # noqa: E402

# A plain complaint: a real problem, unhappy, about us, no safety risk, no reply asked for.
BASE = {"topic": "freshness", "severity": 1.6, "tone": 1.0, "safety": 0.02, "wants_reply": 0.1, "about_us": 0.97}
REVIEW = {"stars": 2, "channel": "website", "about": "Harbor House Blend", "text": "Stale beans."}


def answers(**picks):
    return fake_answers(reviews.questions(), dict(BASE, **picks))


def triage(review=None, policy=None, **picks):
    return reviews.triage(answers(**picks), dict(REVIEW, **(review or {})), policy)


def failing(out):
    return [c["id"] for c in out["checks"] if not c["ok"]]


class TriageRuleTests(unittest.TestCase):
    def test_safety_escalates_as_p1_with_no_public_reply(self):
        out = triage(safety=0.8, severity=0.4, about_us=0.1)
        self.assertEqual((out["action"], out["team"], out["priority"]), ("escalate", "quality_safety", "P1"))
        self.assertEqual(out["flags"], ["safety"])
        self.assertFalse(out["auto_reply_allowed"])
        self.assertEqual(failing(out), ["safety"])
        self.assertEqual([c["id"] for c in out["checks"]], ["safety"], "safety decides before any other rule")

    def test_safety_threshold_is_inclusive(self):
        self.assertEqual(triage(safety=0.5)["action"], "escalate")
        self.assertNotEqual(triage(safety=0.49)["action"], "escalate")

    def test_not_about_us_is_held_for_moderation(self):
        out = triage(about_us=0.2, wants_reply=0.9, tone=4.0)
        self.assertEqual((out["action"], out["team"]), ("moderate", "moderation"))
        self.assertEqual(out["flags"], ["not_about_us"])
        self.assertFalse(out["auto_reply_allowed"])
        self.assertEqual([(c["id"], c["ok"]) for c in out["checks"]], [("safety", True), ("about_us", False)])

    def test_each_topic_routes_to_its_team(self):
        self.assertEqual(set(reviews.TOPIC_TEAM), set(reviews.TOPICS))
        for topic, team in reviews.TOPIC_TEAM.items():
            with self.subTest(topic=topic):
                out = triage(topic=topic)
                self.assertEqual(out["team"], team)
                self.assertIn(team, reviews.TEAMS)

    def test_priority_follows_the_severity_cuts(self):
        for severity, expected in ((0.0, "P3"), (0.99, "P3"), (1.0, "P2"), (1.99, "P2"), (2.0, "P1"), (2.9, "P1")):
            with self.subTest(severity=severity):
                self.assertEqual(triage(severity=severity)["priority"], expected)

    def test_a_real_problem_gets_a_persons_reply(self):
        out = triage(severity=1.6, tone=1.0)
        self.assertEqual((out["action"], out["priority"], out["flags"]), ("reply", "P2", []))
        self.assertEqual(failing(out), ["severity"])
        self.assertFalse(out["auto_reply_allowed"])

    def test_asking_for_a_reply_gets_one_even_when_minor(self):
        out = triage(severity=0.3, tone=2.0, wants_reply=0.8)
        self.assertEqual(out["action"], "reply")
        self.assertEqual(failing(out), ["wants_reply"])

    def test_positive_low_severity_unflagged_review_may_be_thanked(self):
        out = triage(review={"stars": 5}, topic="cafe_service", severity=0.1, tone=3.8)
        self.assertEqual((out["action"], out["team"], out["priority"]), ("thank", "cafes", "P3"))
        self.assertTrue(out["auto_reply_allowed"])
        self.assertEqual(failing(out), [])

    def test_neutral_low_severity_review_is_logged(self):
        out = triage(review={"stars": 3}, severity=0.2, tone=2.0)
        self.assertEqual(out["action"], "log")
        self.assertFalse(out["auto_reply_allowed"])
        self.assertEqual(failing(out), ["positive"])

    def test_every_check_has_the_claims_shape(self):
        for out in (triage(safety=0.9), triage(about_us=0.1), triage(), triage(severity=0, tone=4, review={"stars": 5})):
            for c in out["checks"]:
                self.assertEqual(set(c), {"id", "ok", "level", "label", "detail"})
                self.assertEqual(c["level"] == "ok", c["ok"])
            self.assertTrue(out["reasons"])


class MismatchTests(unittest.TestCase):
    def test_gap_maps_stars_onto_the_tone_scale(self):
        self.assertEqual(reviews.rating_gap(4.0, 5), 0.0)
        self.assertEqual(reviews.rating_gap(0.0, 1), 0.0)
        self.assertAlmostEqual(reviews.rating_gap(0.3, 5), 3.7)
        self.assertAlmostEqual(reviews.rating_gap(3.5, 1), 3.5)
        self.assertAlmostEqual(reviews.rating_gap(2.0, 3), 0.0)

    def test_five_stars_with_furious_words_is_flagged_and_replied_to(self):
        out = triage(review={"stars": 5}, tone=0.3, severity=0.5)
        self.assertEqual(out["flags"], ["rating_mismatch"])
        self.assertEqual(out["action"], "reply")
        self.assertAlmostEqual(out["evidence"]["rating_gap"], 3.7)

    def test_one_star_with_glowing_words_is_flagged(self):
        out = triage(review={"stars": 1}, tone=3.6, severity=0.0)
        self.assertEqual((out["action"], out["flags"]), ("reply", ["rating_mismatch"]))

    def test_gap_threshold_is_inclusive(self):
        self.assertEqual(triage(review={"stars": 4}, tone=1.0, severity=0)["flags"], ["rating_mismatch"])  # gap 2.0
        self.assertEqual(triage(review={"stars": 4}, tone=1.01, severity=0)["flags"], [])


class PolicyTests(unittest.TestCase):
    def test_policy_changes_redecide_from_the_same_answers(self):
        client = FakeClient(lambda state, qs: dict(BASE, severity=1.4, tone=1.0))
        out = reviews.check(client, REVIEW)
        self.assertEqual(out["triage"]["action"], "reply")
        stricter = reviews.redecide(out["answers"], out["review"], {"p2_at": 1.5, "p1_at": 2.5})
        self.assertEqual((stricter["triage"]["action"], stricter["triage"]["priority"]), ("log", "P3"))
        self.assertEqual(stricter["policy"]["p2_at"], 1.5)
        escalate = reviews.redecide(out["answers"], out["review"], {"safety_at": 0.01})
        self.assertEqual(escalate["triage"]["action"], "escalate")
        moderate = reviews.redecide(out["answers"], out["review"], {"about_us_min": 0.99})
        self.assertEqual(moderate["triage"]["action"], "moderate")
        self.assertEqual(len(client.calls), 1, "re-deciding makes no call")

    def test_mismatch_gap_and_thank_tone_are_policy(self):
        a = answers(severity=0.1, tone=2.2)
        five = dict(REVIEW, stars=5)
        self.assertEqual(reviews.triage(a, five)["action"], "log")  # gap 1.8, tone below 3
        self.assertEqual(reviews.triage(a, five, {"mismatch_gap": 1.5})["flags"], ["rating_mismatch"])
        self.assertEqual(reviews.triage(a, five, {"thank_tone_at": 2.0})["action"], "thank")

    def test_bad_policy_values_fall_back_to_defaults(self):
        out = reviews.redecide(answers(), REVIEW, {"p2_at": "lots", "safety_at": None})
        self.assertEqual(out["policy"], reviews.DEFAULT_POLICY)

    def test_check_sends_one_request_without_the_stars(self):
        client = FakeClient()
        out = reviews.check(client, dict(REVIEW, text="  Stale beans.  "))
        state, qs = client.calls[0]
        self.assertEqual(list(qs), ["topic", "severity", "tone", "safety", "wants_reply", "about_us"])
        self.assertEqual(state["review"]["text"], "Stale beans.")
        self.assertNotIn("stars", state["review"], "the tone question must not see the rating it is compared with")
        self.assertEqual(out["review"]["stars"], 2)
        for key in ("answers", "triage", "policy", "meta", "trace"):
            self.assertIn(key, out)


class ExampleTests(unittest.TestCase):
    def test_examples_are_fictional_and_complete(self):
        self.assertGreaterEqual(len(reviews.EXAMPLES), 8)
        for ex in reviews.EXAMPLES:
            with self.subTest(example=ex["label"]):
                self.assertEqual(reviews.clean_review(ex)["stars"], ex["stars"])
                self.assertIn(ex["expect"]["action"], reviews.ACTIONS)
                self.assertIn(ex["expect"]["team"], reviews.TEAMS)
                self.assertNotIn("@", ex["text"])
                for word in ex["text"].replace("!", " ").split():
                    if "." in word.strip(".,") and word.strip(".,").split(".")[-1].isalpha():
                        self.assertTrue(word.strip(".,").endswith(".example"), word)

    def test_examples_reach_their_intended_decisions_with_clear_answers(self):
        """With the answers a careful reader would give, code makes the decision a person expects."""
        clear = {
            "Glowing praise": dict(topic="cafe_service", severity=0.0, tone=3.9, wants_reply=0.05),
            "Stale beans": dict(topic="freshness", severity=2.0, tone=1.0, wants_reply=0.9),
            "Burned hand": dict(topic="cafe_service", severity=3.0, tone=0.5, safety=0.95),
            "5 stars, furious": dict(topic="equipment", severity=2.0, tone=0.1),
            "1 star, loves it": dict(topic="roast_flavor", severity=0.0, tone=3.9),
            "Spam": dict(topic="other", severity=0.0, tone=2.5, about_us=0.02),
            "Late delivery": dict(topic="delivery_timing", severity=1.8, tone=1.0),
            "Double charge": dict(topic="subscription_billing", severity=2.0, tone=1.0, wants_reply=0.95),
        }
        self.assertEqual(set(clear), {ex["label"] for ex in reviews.EXAMPLES})
        for ex in reviews.EXAMPLES:
            with self.subTest(example=ex["label"]):
                out = reviews.triage(answers(**clear[ex["label"]]), ex)
                self.assertEqual({"action": out["action"], "team": out["team"], "flags": out["flags"]}, ex["expect"])

    def test_questions_have_no_lint_problem(self):
        state = reviews.state_for(reviews.clean_review(reviews.EXAMPLES[0]))
        qs = workbench.validate_questions(reviews.questions())
        self.assertEqual(lint.check(state, qs)["findings"], [])


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient(lambda state, qs: dict(BASE))
        patcher = patch.object(server, "client", self.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_setup_lists_examples_policy_and_teams(self):
        out = server.api_reviews_setup({})
        self.assertEqual(out["policy"], reviews.DEFAULT_POLICY)
        self.assertEqual(out["examples"], reviews.EXAMPLES)
        self.assertEqual(out["teams"], reviews.TEAMS)
        self.assertIn(("GET", "/api/reviews/setup"), server.ROUTES)
        self.assertEqual(server.PAGES["/reviews"], "reviews.html")

    def test_check_and_decide(self):
        out = server.api_reviews_check({"review": REVIEW})
        self.assertEqual(out["triage"]["action"], "reply")
        again = server.api_reviews_decide({"answers": out["answers"], "review": out["review"], "policy": {"p2_at": 2.5}})
        self.assertEqual(again["triage"]["action"], "log")
        self.assertIn("compute_ms", again)
        self.assertEqual(len(self.client.calls), 1)

    def test_check_rejects_bad_reviews_without_a_call(self):
        bad = [None, "Stale beans.", dict(REVIEW, stars=0), dict(REVIEW, stars=6), dict(REVIEW, stars=2.5),
               dict(REVIEW, stars="5"), dict(REVIEW, stars=True), dict(REVIEW, channel="fax"), dict(REVIEW, text="  "),
               dict(REVIEW, text=None), dict(REVIEW, text="x" * (reviews.MAX_TEXT + 1)), dict(REVIEW, about=7)]
        for review in bad:
            with self.subTest(review=review):
                with self.assertRaises(server.BadRequest):
                    server.api_reviews_check({"review": review})
        with self.assertRaises(server.BadRequest):
            server.api_reviews_check({"review": REVIEW, "policy": [1, 2]})
        self.assertEqual(self.client.calls, [])

    def test_decide_rejects_bad_answers(self):
        good = answers()
        missing = {k: v for k, v in good.items() if k != "tone"}
        bad_answers = [None, [], missing, dict(good, topic={"choice": "weather"}), dict(good, severity={"score": 7}),
                       dict(good, safety={"noul": "yes"}), dict(good, about_us={"noul": 1.5}),
                       dict(good, wants_reply="no")]
        for bad in bad_answers:
            with self.subTest(answers=bad):
                with self.assertRaises(server.BadRequest):
                    server.api_reviews_decide({"answers": bad, "review": REVIEW})
        with self.assertRaises(server.BadRequest):
            server.api_reviews_decide({"answers": good, "review": dict(REVIEW, stars=9)})
        with self.assertRaises(server.BadRequest):
            server.api_reviews_decide({"answers": good, "review": REVIEW, "policy": "strict"})
        self.assertEqual(self.client.calls, [])


if __name__ == "__main__":
    unittest.main()
