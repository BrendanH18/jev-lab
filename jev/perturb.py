"""Perturb: rewrite a Bulk row the way real input varies, to see whether an answer depends on it.

Compare can send one variant's rows through a perturbation. When both variants otherwise ask the same
questions of the same model, every answer that changes changed because of the rewrite alone: an input
check, the input-side companion to the order check in compare.agreement.

Each perturbation is plain code that keeps the meaning of the row:

  * typos: swap two neighboring letters inside some longer lowercase words.
  * lowercase: lowercase every string.
  * distractor: append one unrelated sentence to the longest string.
  * shuffle: list every object's fields in another order.

Only string values change, never field names, and list items keep their order. The random choices are
seeded by the perturbation and the row's position, so the same rows get the same rewrite on every run,
and a rerun of a comparison asks about exactly the same inputs.
"""

from __future__ import annotations

import json
import random
import re
from typing import Any, Callable, List

KINDS = ("typos", "lowercase", "distractor", "shuffle")

TYPO_RATE = 0.15  # the chance that an eligible word gets a typo
# Unrelated to any support question, and neutral in tone, so a right answer should not move.
DISTRACTORS = (
    "Sent from my phone.",
    "Unrelated, but it is raining here today.",
    "I hope your week is going well.",
    "Thanks for reading this.",
    "I am writing this on my lunch break.",
)
# Lowercase words of five or more letters: capitalized names, codes, and acronyms stay intact.
_WORD = re.compile(r"\b[a-z]{5,}\b")


def check(kind: Any) -> None:
    if kind not in KINDS:
        raise ValueError("perturbation must be one of %s" % ", ".join(KINDS))


def _map_strings(value: Any, fn: Callable[[str], str]) -> Any:
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, dict):
        return {k: _map_strings(v, fn) for k, v in value.items()}
    if isinstance(value, list):
        return [_map_strings(v, fn) for v in value]
    return value


def _strings(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def _swap(word: str, rng: random.Random) -> str:
    """Swap two neighboring interior letters that differ, keeping the first and last letter."""
    spots = [i for i in range(1, len(word) - 2) if word[i] != word[i + 1]]
    if not spots:
        return word
    i = rng.choice(spots)
    return word[:i] + word[i + 1] + word[i] + word[i + 2:]


def _typos(text: str, rng: random.Random) -> str:
    words = list(_WORD.finditer(text))
    if not words:
        return text
    hit = {m.start() for m in words if rng.random() < TYPO_RATE}
    if not hit:  # every string with a long word gets at least one typo
        hit = {rng.choice(words).start()}
    out, last = [], 0
    for m in words:
        out.append(text[last:m.start()])
        out.append(_swap(m.group(), rng) if m.start() in hit else m.group())
        last = m.end()
    out.append(text[last:])
    return "".join(out)


def _shuffle(value: Any, rng: random.Random) -> Any:
    if isinstance(value, list):
        return [_shuffle(v, rng) for v in value]
    if not isinstance(value, dict):
        return value
    keys = list(value)
    if len(keys) > 1:
        order = keys[:]
        rng.shuffle(order)
        if order == keys:  # an object with two or more fields always gets another order
            order = keys[1:] + keys[:1]
        keys = order
    return {k: _shuffle(value[k], rng) for k in keys}


def _distractor(value: Any, rng: random.Random) -> Any:
    strings = [s for s in _strings(value) if s.strip()]
    if not strings:
        return value
    target = max(strings, key=len)  # the first longest string: usually the message itself
    sentence = rng.choice(DISTRACTORS)
    done = []

    def add(s: str) -> str:
        if s is target and not done:
            done.append(True)
            return s.rstrip() + " " + sentence
        return s

    return _map_strings(value, add)


def apply(kind: str, state: Any, index: int) -> Any:
    """The state with `kind` applied. Seeded by kind and row index, so it is the same on every run."""
    check(kind)
    rng = random.Random("%s:%d" % (kind, index))
    if kind == "lowercase":
        return _map_strings(state, str.lower)
    if kind == "typos":
        return _map_strings(state, lambda s: _typos(s, rng))
    if kind == "shuffle":
        return _shuffle(state, rng)
    return _distractor(state, rng)


def changed(before: Any, after: Any) -> bool:
    """Whether the model sees different input. Field order counts, so a shuffled object differs."""
    return json.dumps(before, ensure_ascii=False) != json.dumps(after, ensure_ascii=False)
