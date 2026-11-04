"""Counter: one set of chat judgments per customer turn, a handoff policy in code."""

from __future__ import annotations

import math
from typing import Any, Optional

from .client import JevClient, choice, noul, score
from .reviews import SHOP
from .world import TEMPLATES

MAX_TEXT = 2000
MAX_TURNS = 20
DEFAULT_POLICY = {"person_at": 0.5, "frustration_at": 2.5, "streak_turns": 2,
                  "missed_at": 0.5, "missed_turns": 2, "intent_min": 0.6, "resolved_at": 0.7}
REPLIES = {k: v["text"] for k, v in TEMPLATES.items()}
REPLIES.update({"order_status": "Please check Account > Orders for your tracking link. If it is missing, a person can help.",
                "clarify": "Could you say more about what you need help with?",
                "handoff": "I'll hand this chat to a person at Harbor Coffee Co. Please wait for their reply.",
                "close": "Glad that helped. Thanks for visiting Harbor Coffee Co.!"})
INTENTS = {k: v["about"] for k, v in TEMPLATES.items()}
INTENTS.update({"order_status": "Tracking or the current status of an existing order", "other": "Something else"})
EXAMPLES = [
    {"label": "Shipping, then sorted", "turns": ["How long does shipping to Canada take?", "Thanks, that answers my question!"],
     "expect": ["reply", "close"]},
    {"label": "Frustration builds", "turns": ["Where is my order?", "This is ridiculous. I've waited weeks and your tracking is useless!",
                                               "I'm furious. Still no parcel and no useful help!"],
     "expect": ["reply", "reply", "handoff"]},
    {"label": "A person, please", "turns": ["Please connect me to a human agent."], "expect": ["handoff"]},
    {"label": "Missing the point", "turns": ["I need a refund for a damaged bag.",
                                             "That doesn't answer my question. I already sent the photo and order number.",
                                             "You missed my point again. I already did that and still need my refund."],
     "expect": ["reply", "reply", "handoff"]},
]


def questions() -> dict:
    return {
        "intent": choice("What does the customer need in `latest_customer_message`, in the context of `conversation`?", INTENTS),
        "frustration": score("How frustrated is the customer in `latest_customer_message`?",
                             ["Calm or pleased", "Slightly concerned", "Disappointed or impatient",
                              "Angry or very frustrated", "Furious or at the end of their patience"]),
        "asks_for_person": noul("Does `latest_customer_message` ask to speak with a person?",
                                yes="The customer requests a human agent or a member of staff",
                                no="The customer does not request a person"),
        "missed": noul("Does `latest_customer_message` say the bot's previous reply missed the customer's point?",
                       yes="The customer says the previous reply was irrelevant, misunderstood them, or repeated advice they already tried",
                       no="The customer does not say the previous reply missed the point, or there is no previous reply"),
        "resolved": noul("Does `latest_customer_message` indicate the customer's need has been met?",
                         yes="The customer says the help answered their question or solved their problem",
                         no="The customer still needs help, or only acknowledges a reply without saying it helped"),
    }


def full_policy(raw: Any = None) -> dict:
    if raw is not None and not isinstance(raw, dict):
        raise ValueError("policy must be an object.")
    out = {}
    for key, default in DEFAULT_POLICY.items():
        try:
            value = float((raw or {}).get(key, default))
        except (TypeError, ValueError, OverflowError):
            value = default
        top = MAX_TURNS if key.endswith("turns") else 4 if key == "frustration_at" else 1
        if not math.isfinite(value):
            value = default
        value = max(1 if key.endswith("turns") else 0, min(top, value))
        out[key] = int(value) if key.endswith("turns") else value
    return out


def clean_transcript(raw: Any) -> list:
    if not isinstance(raw, list) or not raw or len(raw) > MAX_TURNS * 2 - 1 or len(raw) % 2 != 1:
        raise ValueError("transcript must contain 1–20 customer turns alternating with bot replies, ending with a customer.")
    out = []
    for i, turn in enumerate(raw):
        speaker = "customer" if i % 2 == 0 else "bot"
        if not isinstance(turn, dict) or turn.get("speaker") != speaker:
            raise ValueError("transcript must alternate customer and bot speakers.")
        text = turn.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ValueError("Each message must contain 1–2000 characters.")
        if speaker == "bot" and text not in REPLIES.values():
            raise ValueError("Bot replies must be Counter's fixed templates.")
        out.append({"speaker": speaker, "text": text.strip()})
    return out


def state_for(transcript: list) -> dict:
    return {"shop": SHOP, "conversation": transcript, "latest_customer_message": transcript[-1]["text"]}


def check_answers(raw: Any) -> list:
    if not isinstance(raw, list) or len(raw) > MAX_TURNS:
        raise ValueError("turn_answers must be a list of at most 20 answer objects.")
    for answers in raw:
        if not isinstance(answers, dict):
            raise ValueError("Each turn's answers must be an object.")
        for key, q in questions().items():
            a = answers.get(key)
            if not isinstance(a, dict):
                raise ValueError("Missing answer: " + key)
            if key == "intent":
                probs = a.get("probabilities")
                if a.get("choice") not in INTENTS or not isinstance(probs, dict) or set(probs) != set(INTENTS):
                    raise ValueError("intent must choose a known intent and include its probabilities.")
                values, top = list(probs.values()), 1
            else:
                values, top = [a.get("score" if q["type"] == "score" else "noul")], 4 if key == "frustration" else 1
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= top for v in values):
                raise ValueError("Invalid probability or score: " + key)
            if key == "intent" and not math.isclose(sum(values), 1, abs_tol=0.01):
                raise ValueError("intent probabilities must sum to one.")
    return raw


def decide(turn_answers: list, policy: Optional[dict] = None) -> list:
    """Replay saved judgments. A handoff is sticky; a close can be followed by a new need."""
    p = full_policy(policy)
    streak = misses = 0
    handed_off = False
    decisions = []
    for a in check_answers(turn_answers):
        intent = max(a["intent"]["probabilities"], key=a["intent"]["probabilities"].get)
        ev = {k: a[k]["noul"] for k in ("asks_for_person", "missed", "resolved")}
        ev.update(intent=intent, intent_prob=a["intent"]["probabilities"][intent], frustration=a["frustration"]["score"])
        streak = streak + 1 if ev["frustration"] >= p["frustration_at"] else 0
        misses += ev["missed"] >= p["missed_at"]
        action, reply, reason = "reply", intent, "The intent selects a fixed reply."
        if handed_off:
            action, reply, reason = "handoff", "handoff", "Already handed to a person."
        elif ev["asks_for_person"] >= p["person_at"]:
            action, reply, reason = "handoff", "handoff", "The customer asks for a person."
        elif streak >= p["streak_turns"]:
            action, reply, reason = "handoff", "handoff", "Frustration stayed above the cut for %d consecutive turns." % streak
        elif misses >= p["missed_turns"]:
            action, reply, reason = "handoff", "handoff", "The bot missed the point %d times." % misses
        elif ev["resolved"] >= p["resolved_at"]:
            action, reply, reason = "close", "close", "The customer's need is met."
        elif ev["intent_prob"] < p["intent_min"] or intent == "other":
            action, reply, reason = "clarify", "clarify", "The intent is uncertain or has no reply template."
        handed_off = action == "handoff"
        decisions.append({"action": action, "reply": reply, "text": REPLIES[reply], "reason": reason,
                          "streak": streak, "misses": misses, "evidence": ev})
    return decisions


def turn(client: JevClient, transcript: Any, turn_answers: Any, policy: Any = None) -> dict:
    transcript, saved, p = clean_transcript(transcript), check_answers(turn_answers), full_policy(policy)
    if len(saved) != len(transcript) // 2:
        raise ValueError("Provide one saved answer object per previous customer turn.")
    result = client.system_one(state_for(transcript), questions())
    answers = saved + [result.answers]
    return {"answers": result.answers, "decisions": decide(answers, p), "policy": p,
            "meta": result.meta(), "trace": result.trace()}
