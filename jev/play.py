"""Play: 20 Questions, refereed by Jev.

The player asks yes/no questions about a secret thing. Each turn is one request with four Noul
questions asked at once: is the answer yes, is this even a yes/no question, is the player making a
guess, and does the guess match. Code turns the probabilities into game moves. The secret never
leaves the server until the game ends, and the request traces are released only at reveal.
"""

from __future__ import annotations

import random
import secrets
import threading
import time
from typing import Dict, List, Optional

from .client import JevClient, noul
from .config import SAMPLES_DIR

MAX_TURNS = 20
MAX_GAMES = 200


def load_words() -> List[dict]:
    words = []
    for line in (SAMPLES_DIR / "words.txt").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        word, _, category = line.partition("|")
        words.append({"word": word.strip(), "category": (category.strip() or "thing")})
    return words


def questions() -> Dict[str, dict]:
    return {
        "answer_is_yes": noul(
            {"question": "For the thing named in `secret`, is the honest answer to `player_question` yes?",
             "focus": "Judge the real-world properties of the secret thing, not the wording."},
            yes="The answer to the player's question is yes for this thing",
            no="The answer is no, or the question does not apply to this thing",
        ),
        "is_yes_no_question": noul(
            "Is `player_question` a question that can be answered with yes or no?",
            yes={"what": "A yes/no question", "examples": ["Is it alive?", "Can you eat it?"]},
            no={"what": "Not a yes/no question", "examples": ["What is it?", "Give me a hint"]},
        ),
        "names_a_guess": noul(
            "Does `player_question` name one specific thing as a guess for what the secret is?",
            yes={"what": "Names a specific thing", "examples": ["Is it a giraffe?", "penguin", "It's a toaster!"]},
            no={"what": "Asks about a property or category", "examples": ["Is it an animal?", "Is it bigger than a car?"]},
        ),
        "guess_matches": noul(
            "Does the thing named in `player_question` refer to the same thing as `secret`? Treat synonyms, "
            "plurals, and spelling mistakes as the same thing.",
            yes="Names the same thing as the secret",
            no="Names a different thing, or names nothing",
        ),
    }


def reply_for(p_yes: float) -> str:
    if p_yes >= 0.85:
        return "Yes"
    if p_yes >= 0.6:
        return "Probably"
    if p_yes <= 0.15:
        return "No"
    if p_yes <= 0.4:
        return "Probably not"
    return "Hard to say"


class Games:
    def __init__(self, client: JevClient, words: Optional[List[dict]] = None):
        self.client = client
        self.words = words or load_words()
        self._games: Dict[str, dict] = {}
        self._lock = threading.Lock()

    def new(self, seed: Optional[int] = None) -> dict:
        rng = random.Random(seed)
        pick = rng.choice(self.words)
        game = {"id": secrets.token_urlsafe(8), "secret": pick["word"], "category": pick["category"],
                "turns": [], "traces": [], "over": False, "won": False, "started": time.time()}
        with self._lock:
            if len(self._games) >= MAX_GAMES:
                oldest = min(self._games.values(), key=lambda g: g["started"])
                self._games.pop(oldest["id"], None)
            self._games[game["id"]] = game
        return self.public(game)

    def get(self, game_id: str) -> dict:
        with self._lock:
            game = self._games.get(game_id)
        if not game:
            raise KeyError("Unknown game")
        return game

    def public(self, game: dict) -> dict:
        out = {k: game[k] for k in ("id", "category", "turns", "over", "won")}
        out["turns_left"] = MAX_TURNS - len(game["turns"])
        if game["over"]:
            out["secret"] = game["secret"]
            out["traces"] = game["traces"]
        return out

    def ask(self, game_id: str, text: str) -> dict:
        game = self.get(game_id)
        text = " ".join(text.split())[:200]
        if game["over"]:
            raise ValueError("This game is over. Start a new one.")
        if not text:
            raise ValueError("Ask something first.")
        state = {"secret": game["secret"], "player_question": text}
        result = self.client.system_one(state, questions())
        a = {k: float(v["noul"]) for k, v in result.answers.items()}
        turn = {"n": len(game["turns"]) + 1, "text": text, "probs": a, "meta": result.meta()}

        if a["names_a_guess"] >= 0.6:
            if a["guess_matches"] >= 0.7:
                turn["reply"], turn["kind"] = "Yes! You got it.", "win"
                game["over"], game["won"] = True, True
            elif a["guess_matches"] <= 0.3:
                turn["reply"], turn["kind"] = "No, it isn't that.", "guess"
            else:
                turn["reply"], turn["kind"] = "Close, but not quite. Be more specific.", "guess"
        elif a["is_yes_no_question"] < 0.5:
            turn["reply"], turn["kind"] = "Ask a yes/no question, or name your guess.", "invalid"
        else:
            turn["reply"], turn["kind"] = reply_for(a["answer_is_yes"]), "answer"

        game["turns"].append(turn)
        game["traces"].append(result.trace())
        if not game["over"] and len(game["turns"]) >= MAX_TURNS:
            game["over"] = True
            game["turns"][-1]["reply"] += " That was your last question."
        return self.public(game)

    def give_up(self, game_id: str) -> dict:
        game = self.get(game_id)
        game["over"] = True
        return self.public(game)
