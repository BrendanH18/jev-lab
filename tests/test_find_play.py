import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import find, play  # noqa: E402

DOC = "Section A: Pets\nDogs are not allowed inside.\nService animals are always welcome.\nSection B: Pay\nPayday is every other Friday.\n"


class FindTests(unittest.TestCase):
    def test_questions_and_tagging(self):
        lines = find.split_lines(DOC)
        self.assertEqual(len(lines), 5)
        self.assertTrue(find.tagged_document(lines).startswith("L000| Section A: Pets\nL001| Dogs"))
        qs = find.questions(["dogs?", "pay?"], 5)
        self.assertEqual(set(qs), {"q0.where", "q0.exists", "q1.where", "q1.exists"})
        self.assertEqual(len(qs["q0.where"]["criteria"]), 5)

    def test_search_ranks_and_judges(self):
        def picker(state, questions):
            return {"q0.where": "L001", "q0.exists": 0.95, "q1.where": "L004", "q1.exists": 0.1}
        out = find.search(FakeClient(picker), DOC, ["can I bring my dog?", "is there a bonus?"], top=2)
        self.assertEqual(out["results"][0]["hits"][0]["id"], "L001")
        self.assertEqual(out["results"][0]["verdict"], "answered")
        self.assertEqual(out["results"][1]["verdict"], "absent")
        self.assertEqual(out["lines"], 5)
        self.assertEqual(find.verdict(0.5), "partial")

    def test_limits(self):
        with self.assertRaises(ValueError):
            find.search(FakeClient(), "x" * 70_000, ["q"])
        with self.assertRaises(ValueError):
            find.search(FakeClient(), DOC, [""])
        many = "\n".join("line %d" % i for i in range(300))
        out = find.search(FakeClient(lambda s, q: {}), many, ["q"])
        self.assertTrue(out["truncated"])
        self.assertEqual(out["lines"], 255)

    def test_sample_document_fits_one_request(self):
        self.assertLessEqual(len(find.split_lines(find.load_sample())), find.MAX_LINES)


class PlayTests(unittest.TestCase):
    def test_reply_thresholds(self):
        self.assertEqual([play.reply_for(p) for p in (0.99, 0.7, 0.5, 0.3, 0.05)],
                         ["Yes", "Probably", "Hard to say", "Probably not", "No"])

    def test_game_flow(self):
        script = {}

        def picker(state, questions):
            return script.get(state["player_question"], {})

        games = play.Games(FakeClient(picker), words=[{"word": "giraffe", "category": "animal"}])
        g = games.new()
        self.assertNotIn("secret", g)
        script["Is it alive?"] = {"answer_is_yes": 0.97, "is_yes_no_question": 0.99, "names_a_guess": 0.02}
        g = games.ask(g["id"], "Is it alive?")
        self.assertEqual(g["turns"][-1]["reply"], "Yes")
        script["what is it"] = {"is_yes_no_question": 0.05, "names_a_guess": 0.1}
        g = games.ask(g["id"], "what is it")
        self.assertEqual(g["turns"][-1]["kind"], "invalid")
        script["Is it a zebra?"] = {"is_yes_no_question": 0.9, "names_a_guess": 0.95, "guess_matches": 0.03}
        g = games.ask(g["id"], "Is it a zebra?")
        self.assertEqual(g["turns"][-1]["kind"], "guess")
        self.assertFalse(g["over"])
        script["giraffe!"] = {"is_yes_no_question": 0.4, "names_a_guess": 0.97, "guess_matches": 0.96}
        g = games.ask(g["id"], "giraffe!")
        self.assertTrue(g["won"] and g["over"])
        self.assertEqual(g["secret"], "giraffe")
        self.assertEqual(len(g["traces"]), 4)
        with self.assertRaises(ValueError):
            games.ask(g["id"], "again?")

    def test_turn_limit_and_give_up(self):
        games = play.Games(FakeClient(lambda s, q: {"is_yes_no_question": 0.9, "answer_is_yes": 0.5}), words=[{"word": "owl", "category": "animal"}])
        g = games.new()
        for i in range(play.MAX_TURNS):
            g = games.ask(g["id"], "question %d" % i)
        self.assertTrue(g["over"])
        self.assertIn("last question", g["turns"][-1]["reply"])
        g2 = games.give_up(games.new()["id"])
        self.assertEqual(g2["secret"], "owl")

    def test_word_list_loads(self):
        words = play.load_words()
        self.assertGreater(len(words), 50)
        self.assertTrue(all(w["word"] and w["category"] for w in words))


if __name__ == "__main__":
    unittest.main()
