"""Exercise the live validator's CLI with offline model answers."""

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from helpers import fake_answers  # noqa: E402
from jev.client import JevError  # noqa: E402
from jev.config import Settings  # noqa: E402
from scripts import validate  # noqa: E402


def passing_picks(state, questions):
    if isinstance(state, str):
        return {"department": "billing", "is_urgent": 0.9}
    if "latest_customer_message" in state:
        return {"intent": "shipping_times", "resolved": 0.99 if len(state["conversation"]) == 3 else 0.02}
    if "damage_visible" in questions:
        return {
            "shows_item": 0.95,
            "damage_visible": 0.92,
            "matches_note": 0.9,
            "severity": 2.6,
            "damage_kind": "torn_or_open",
        }
    if "review" in state:
        return {"topic": "cafe_service", "tone": 3.9, "about_us": 0.97}
    if state.get("player_question") == "giraffe":
        return {"names_a_guess": 0.99, "guess_matches": 0.99}
    return {}


class ValidateCliTests(unittest.TestCase):
    def setUp(self):
        fixtures = [
            (validate, "INBOX", [validate.INBOX[3], validate.INBOX[-3]]),
            (validate.examples, "EXAMPLES", validate.examples.EXAMPLES[:1]),
            (validate.claims, "EXAMPLES", validate.claims.EXAMPLES[:1]),
            (validate.counter, "EXAMPLES", validate.counter.EXAMPLES[:1]),
            (validate.reviews, "EXAMPLES", validate.reviews.EXAMPLES[:1]),
        ]
        for module, name, value in fixtures:
            patcher = patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(
            validate.workbench,
            "load_sample_rows",
            return_value=[{"text": "Coffee is late", "_expect": {"department": "shipping"}}],
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def cli(self, *args, picker=passing_picks, drop_answer=None, rpm=120):
        def answer(_client, payload):
            state, questions = payload["state"], payload["questions"]
            answers = fake_answers(questions, picker(state, questions))
            if drop_answer:
                answers.pop(drop_answer(state, questions), None)
            return {"model": payload["model"], "answers": answers, "usage": {"input_tokens": 1000}}

        stdout = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(stdout):
            settings = Settings(
                environ={"TYPESAFE_API_KEY": "sk-test", "JEV_LAB_RPM": str(rpm)}, env_file=Path(tmp) / ".env"
            )
            with (
                patch.object(validate, "Settings", return_value=settings),
                patch.object(validate.JevClient, "_post_system_one", answer),
                patch.object(validate, "JevClient", return_value=validate.JevClient(settings)),
            ):
                status = validate.main(list(args))
        return status, stdout.getvalue()

    def test_strict_passes_a_completed_run_with_matching_scenarios(self):
        code, output = self.cli("--strict")
        self.assertEqual(code, 0, output)
        self.assertIn("8 matched, 0 missed, 0 incomplete", output)
        self.assertIn("accuracy   0% on 1 labeled", output)

    def test_strict_fails_on_a_mismatched_example_and_keeps_the_report(self):
        def pick(state, questions):
            return {"department": "technical"} if isinstance(state, str) else passing_picks(state, questions)

        code, output = self.cli(picker=pick)
        self.assertEqual(code, 0, output)
        self.assertNotIn("Strict validation", output)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            code, output = self.cli("--strict", "--out", str(path), picker=pick)
            self.assertEqual(code, 1, output)
            self.assertIn("7 matched, 1 missed, 0 incomplete", output)
            self.assertEqual(json.loads(path.read_text())["examples"]["failed"], 1)

    def test_strict_marks_a_missing_workbench_answer_incomplete(self):
        code, output = self.cli(
            "--strict", drop_answer=lambda state, _: "is_urgent" if isinstance(state, str) else None
        )
        self.assertEqual(code, 1, output)
        self.assertIn("7 matched, 0 missed, 1 incomplete", output)
        self.assertIn("Response missing answers: is_urgent", output)

    def test_strict_marks_an_omitted_claims_box_incomplete(self):
        def drop_box(_state, _questions):
            return "damage_box"

        code, output = self.cli("--strict", drop_answer=drop_box)
        self.assertEqual(code, 1, output)
        self.assertIn("7 matched, 0 missed, 1 incomplete", output)
        self.assertIn("Response missing answers: damage_box", output)
        code, output = self.cli(drop_answer=drop_box)
        self.assertEqual(code, 0, output)

    def test_strict_waits_at_the_configured_rate_limit(self):
        now = 0.0

        def advance(delay):
            nonlocal now
            now += delay

        with (
            patch("jev.client.time.monotonic", side_effect=lambda: now),
            patch("jev.client.time.sleep", side_effect=advance) as sleep,
        ):
            code, output = self.cli("--strict", rpm=10)
        self.assertEqual(code, 0, output)
        self.assertIn("8 matched, 0 missed, 0 incomplete", output)
        sleep.assert_called_with(60.0)

    def test_strict_fails_on_recoverable_errors_even_when_other_scenarios_match(self):
        for question in ("damage_visible", "resolved", "topic", "wants_refund"):
            with self.subTest(question=question):

                def pick(state, questions):
                    if question in questions:
                        raise JevError("fake model error")
                    return passing_picks(state, questions)

                code, output = self.cli("--strict", picker=pick)
                self.assertEqual(code, 1, output)
                self.assertIn("0 missed, 1 incomplete", output)
                self.assertIn("fake model error", output)
                code, output = self.cli(picker=pick)
                self.assertEqual(code, 0, output)

    def test_strict_checks_integrated_autopilot_execution(self):
        process = validate.Autopilot.process

        def broken_process(pilot, message):
            record = process(pilot, message)
            if message["label"]["attack"]:
                record["integrated"]["error"] = "integrated world error"
            else:
                record["naive"]["error"] = "control world error"
            return record

        with patch.object(validate.Autopilot, "process", broken_process):
            code, output = self.cli("--strict")
        self.assertEqual(code, 1, output)
        self.assertIn("7 matched, 0 missed, 1 incomplete", output)
        self.assertIn("integrated world error", output)

    def test_strict_fails_when_the_scripted_game_does_not_win(self):
        def pick(state, questions):
            if isinstance(state, dict) and "player_question" in state:
                return {"is_yes_no_question": 0.9, "answer_is_yes": 0.8}
            return passing_picks(state, questions)

        code, output = self.cli("--strict", picker=pick)
        self.assertEqual(code, 1, output)
        self.assertIn("7 matched, 1 missed, 0 incomplete", output)
