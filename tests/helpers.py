"""Shared fakes for the offline tests. No API key, no network."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.client import JevResult  # noqa: E402


def fake_answers(questions, picks=None):
    """API-shaped answers. `picks` maps question id -> choice key, noul float, or score float."""
    picks = picks or {}
    out = {}
    for qid, q in questions.items():
        pick = picks.get(qid)
        if q["type"] == "choice":
            keys = list(q["criteria"])
            chosen = pick if pick is not None else keys[-1]
            rest = 0.05 / max(1, len(keys) - 1)
            probs = {k: (0.95 if k == chosen else rest) for k in keys}
            out[qid] = {"type": "choice", "choice": chosen, "probabilities": probs, "confidence": 0.9}
        elif q["type"] == "score":
            n = len(q["criteria"])
            out[qid] = {"type": "score", "score": pick if pick is not None else 0.0,
                        "legend": {str(i): c for i, c in enumerate(q["criteria"])},
                        "probabilities": {str(i): 1 / n for i in range(n)}, "confidence": 0.8}
        else:
            out[qid] = {"type": "noul", "noul": pick if pick is not None else 0.02}
    return out


class FakeClient:
    """Stands in for JevClient. `picker(state, questions)` returns the picks for that request."""

    def __init__(self, picker=None, input_tokens=1000):
        self.picker = picker or (lambda state, questions: {})
        self.input_tokens = input_tokens
        self.calls = []
        self.model = "jev-fake"

    def system_one(self, state, questions):
        self.calls.append((state, questions))
        answers = fake_answers(questions, self.picker(state, questions))
        return JevResult({"state": state, "model": self.model, "questions": questions},
                         {"model": self.model, "answers": answers, "usage": {"input_tokens": self.input_tokens}}, 12.0)
