"""Question checks on Choice, Score and Noul criteria: options the model cannot tell apart or that do not cover the
input, Score levels out of order or numbered wrongly, keys that are hard to use in labels, rules and CSV columns,
Noul criteria that look swapped, and structured criteria with holes.

The built-in checks (jev/lint.py) already report options or levels with the same description, uneven option
fields, undescribed options and missing Noul criteria; nothing here repeats them. Messages quote option keys, level
positions and authored words, never a state value.
"""

from __future__ import annotations

import re
from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple

from jev import lint
from jev.lab import kit

STRUCTURE = "#use-structure-in-the-questions"
DECOMPOSE = "#decompose-the-questions"
EMPTY = (None, "", [], {})

# Options that collect whatever the others do not cover.
# "Something else" fallbacks; two of them split the same leftovers. "Cannot tell" fallbacks are a different answer.
OTHER_KEYS = {"other", "others", "anything_else", "something_else", "misc", "miscellaneous", "none_of_these",
              "none_of_the_above"}
CATCH_ALL_KEYS = OTHER_KEYS | {"unknown", "unclear", "not_sure"}
CATCH_ALL_TEXT = re.compile(r"^\s*(?:anything else|something else|other\b|none of (?:these|the above)|everything else)", re.I)
# Options that say the thing asked about is absent.
ABSENT_KEYS = {"none", "not_stated", "not_identified", "not_mentioned", "not_applicable", "n_a", "na", "no_answer",
               "not_found", "not_present", "missing", "not_given"}
ABSENT_TEXT = re.compile(r"^\s*(?:no|none|not|neither|nothing)\b|\b(?:anything else|something else|none of (?:these|the above)"
                         r"|not stated|not given|not mentioned)\b", re.I)
NEGATIVE = re.compile(r"^\s*(?:no|not|never|none|nothing|nobody|without|neither|false)\b|^\s*\w+\s+not\b|^\s*\w+n't\b", re.I)
# Leading words of an ordered amount or frequency, ranked from least to most.
RANK = {"none": 0, "no": 0, "nothing": 0, "never": 0, "zero": 0,
        "few": 1, "little": 1, "slight": 1, "slightly": 1, "minor": 1, "low": 1, "mild": 1, "minimal": 1, "rarely": 1,
        "some": 2, "moderate": 2, "medium": 2, "partial": 2, "sometimes": 2, "occasionally": 2,
        "many": 3, "much": 3, "high": 3, "major": 3, "strong": 3, "serious": 3, "often": 3, "usually": 3, "frequently": 3,
        "all": 4, "total": 4, "extreme": 4, "severe": 4, "critical": 4, "always": 4}
ORDINAL_SETS = [{"low", "medium", "high"}, {"very_low", "low", "medium", "high", "very_high"}, {"small", "medium", "large"},
                {"never", "rarely", "sometimes", "often", "always"}, {"mild", "moderate", "severe"},
                {"poor", "fair", "good", "excellent"}, {"minor", "major", "critical"}, {"cold", "warm", "hot"},
                {"slow", "medium", "fast"}, {"none", "some", "many", "all"}]
STYLES = [("snake_case", re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$")), ("camelCase", re.compile(r"^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$")),
          ("kebab-case", re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$")), ("PascalCase", re.compile(r"^(?:[A-Z][a-z0-9]+){2,}$")),
          ("UPPER_CASE", re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$"))]
_RANGE = re.compile(r"(?<![\w.,-])[$€£]?(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*[$€£]?(\d+(?:\.\d+)?)(?![\d.,]*\d)(?!-\d)")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

Finding = Tuple[Optional[str], str]


def _of(questions: dict, qtype: str):
    return [(qid, q) for qid, q in questions.items() if q["type"] == qtype]


def _main(question: dict) -> str:
    value = question.get("instructions")
    if isinstance(value, dict) and isinstance(value.get("question"), str):
        return value["question"]
    return value if isinstance(value, str) else ""


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9$€£](?:[\w$€£%'-]|\.(?=\d))*", text.lower())


def _key_words(key: str) -> str:
    return " ".join(re.split(r"[\s_-]+", key.strip().lower()))


def _named(q: dict) -> List[Tuple[str, Any]]:
    """(name for messages, description) for each option or level of a Choice or Score."""
    if q["type"] == "choice":
        return [("`%s`" % key, about) for key, about in q["criteria"].items()]
    if q["type"] == "score":
        return [("level %d" % i, level) for i, level in enumerate(q["criteria"])]
    if q["type"] == "noul":
        crit = q.get("criteria") or {}
        return [("the %s criterion" % ("yes" if side == "true" else "no"), crit.get(side)) for side in ("true", "false") if side in crit]
    return []


def _texts(q: dict) -> List[Tuple[str, str]]:
    return [(name, about) for name, about in _named(q) if isinstance(about, str) and about.strip()]


def _join(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _cap(text: str) -> str:
    """A message that opens with a name such as "level 2" or "the yes criterion", capitalized as a sentence."""
    return text[:1].upper() + text[1:]


def _catch_all(key: str, about: Any, keys=CATCH_ALL_KEYS) -> bool:
    return key.strip().lower() in keys or (isinstance(about, str) and bool(CATCH_ALL_TEXT.match(about)))


def _absent(key: str, about: Any) -> bool:
    return key.strip().lower() in ABSENT_KEYS or (isinstance(about, str) and bool(ABSENT_TEXT.search(about)))


# ---------- option and level counts ----------

def single_option(state: Any, questions: dict, refs: set) -> List[Finding]:
    return [(qid, "A Choice with one option (`%s`) always returns it. Add the other answers, or ask a Noul."
             % next(iter(q["criteria"]))) for qid, q in _of(questions, "choice") if len(q["criteria"]) == 1]


def yes_no_choice(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        keys = {key.strip().lower() for key in q["criteria"]}
        pairs = [pair for pair in ({"yes", "no"}, {"true", "false"}, {"y", "n"}) if pair <= keys]
        if pairs and keys <= {"yes", "no", "true", "false", "y", "n", "maybe", "unsure", "unknown", "not_sure"}:
            out.append((qid, "The options make this a yes/no question. A Noul returns the probability of yes directly, "
                             "which a threshold in code can use."))
    return out


def score_two_levels(state: Any, questions: dict, refs: set) -> List[Finding]:
    return [(qid, "A Score with two levels is a yes/no question. Use a Noul for a calibrated probability, or add a "
                  "middle level.") for qid, q in _of(questions, "score") if len(q["criteria"]) == 2]


def score_many_levels(state: Any, questions: dict, refs: set) -> List[Finding]:
    return [(qid, "%d levels are hard to tell apart. Keep a Score to about three to five levels, each described by "
                  "what changes from the one before." % len(q["criteria"])) for qid, q in _of(questions, "score") if len(q["criteria"]) > 7]


# ---------- descriptions that say too little ----------

def _restates(key: str, about: Any) -> bool:
    return isinstance(about, str) and lint._norm(about) == lint._norm(_key_words(key))


def options_restate_keys(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        items = list(q["criteria"].items())
        if len(items) >= 2 and all(_restates(key, about) for key, about in items):
            out.append((qid, "Every option only repeats its key, so the criteria tell the model nothing. Say what each "
                             "option covers, what it is not for, and give an example."))
    return out


def one_word_options(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        items = list(q["criteria"].items())
        if (len(items) >= 2 and all(isinstance(about, str) and len(about.split()) == 1 for _key, about in items)
                and not all(_restates(key, about) for key, about in items)):
            out.append((qid, "Every option is described in one word. Say what each covers and what it is not for, so "
                             "the model can place inputs near the line."))
    return out


def one_word_levels(state: Any, questions: dict, refs: set) -> List[Finding]:
    # Levels that are all bare numbers are numeric_levels' finding.
    return [(qid, "Every level is one word. Describe what each level looks like in the input, so the model can tell "
                  "neighbouring levels apart.") for qid, q in _of(questions, "score")
            if all(isinstance(level, str) and len(level.split()) == 1 for level in q["criteria"])
            and not all(re.fullmatch(r"\s*\d+(?:\.\d+)?\s*", level) for level in q["criteria"])]


def option_is_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] in ("choice", "score"):
            asked = [name for name, about in _texts(q) if about.strip().endswith("?")]
            if asked:
                out.append((qid, _cap("%s %s with a question mark. Describe the answer, not another question: what in "
                                      "the input makes it fit." % (_join(asked), "ends" if len(asked) == 1 else "end"))))
    return out


def long_criterion(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        long = [(name, len(about.split())) for name, about in _texts(q) if len(about.split()) > 40]
        if long:
            out.append((qid, _cap("%s runs to %d words. Keep each description short and put details in structured "
                                  "fields (what, not_for, examples)." % long[0])))
    return out


# ---------- options the model cannot tell apart ----------

def keys_differ_by_case(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        groups: Dict[str, List[str]] = {}
        for key in q["criteria"]:
            groups.setdefault(re.sub(r"[\s_-]+", "", key.lower()), []).append("`%s`" % key)
        for names in groups.values():
            if len(names) > 1:
                out.append((qid, "Options %s differ only in case or separators, so labels and rules mix them up. Merge "
                                 "them or rename one." % _join(names)))
    return out


def _bare(words: List[str]) -> List[str]:
    return [w for w in words if w not in ("not", "no", "never", "non")]


def options_differ_by_negation(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        texts = [(name, _words(about.replace("n't", " not"))) for name, about in _texts(q)]
        for (a, wa), (b, wb) in combinations(texts, 2):
            ba, bb = _bare(wa), _bare(wb)
            if ba and ba == bb and (len(ba) != len(wa)) != (len(bb) != len(wb)):
                if len(texts) == 2:
                    out.append((qid, "%s and %s differ only by a negation, so this is a yes/no question. A Noul returns "
                                     "a calibrated probability you can threshold in code." % (a, b)))
                else:
                    out.append((qid, "%s and %s differ only by a negation, so they split one yes/no question between "
                                     "two options. Ask it as a Noul, or say what else tells them apart." % (a, b)))
                break
    return out


def reordered_descriptions(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] not in ("choice", "score"):
            continue
        texts = [(name, _words(about)) for name, about in _texts(q)]
        for (a, wa), (b, wb) in combinations(texts, 2):
            if len(wa) > 1 and wa != wb and sorted(wa) == sorted(wb):
                out.append((qid, _cap("%s and %s use the same words in a different order, so the model may not tell "
                                      "them apart. Say how they differ." % (a, b))))
                break
    return out


def same_leading_words(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] not in ("choice", "score"):
            continue
        texts = [(name, _words(about)) for name, about in _texts(q)]
        for (a, wa), (b, wb) in combinations(texts, 2):
            shared = 0
            while shared < min(len(wa), len(wb)) and wa[shared] == wb[shared]:
                shared += 1
            if shared >= 5 and wa != wb:
                out.append((qid, _cap("%s and %s begin with the same %d words, so the difference comes late. Put what "
                                      "tells them apart first." % (a, b, shared))))
                break
    return out


# ---------- fallbacks ----------

def catch_all_not_last(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        items = list(q["criteria"].items())
        for i, (key, about) in enumerate(items):
            later = items[i + 1:]
            if _catch_all(key, about) and any(not _catch_all(k, a) and not _absent(k, a) for k, a in later):
                out.append((qid, "`%s` is a catch-all but is not the last option. List it after the options it is the "
                                 "fallback for, so people reading and labeling see the specific answers first." % key))
                break
    return out


def conditional_choice_without_fallback(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        if re.match(r"\s*(?:if|when|in case)\b", _main(q), re.I) and not any(
                _catch_all(k, a) or _absent(k, a) for k, a in q["criteria"].items()):
            out.append((qid, "The question applies only when its condition holds, but no option covers the case where "
                             "it does not. Add an option such as `not_stated`, so the model is not forced to pick a "
                             "real answer."))
    return out


def two_catch_alls(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        found = ["`%s`" % k for k, a in q["criteria"].items() if _catch_all(k, a, OTHER_KEYS)]
        if len(found) >= 2:
            out.append((qid, "%s are all catch-alls for something else, so the model splits leftovers between them. "
                             "Keep one, or say how they differ." % _join(found)))
    return out


# ---------- keys ----------

def key_with_spaces(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        spaced = ["`%s`" % k for k in q["criteria"] if re.search(r"\s", k.strip())]
        if spaced:
            out.append((qid, "%s %s spaces. Labels, consistency rules and CSV columns name options by key, where "
                             "spaces are easy to get wrong; use snake_case." % (_join(spaced), "contains" if len(spaced) == 1 else "contain")))
    return out


def mixed_key_styles(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        used = []
        for name, rx in STYLES:
            if any(rx.match(key) for key in q["criteria"]):
                used.append(name)
        if len(used) > 1:
            out.append((qid, "Option keys mix naming styles (%s), which makes them easy to mistype in labels and rules. "
                             "Use one style, such as snake_case." % ", ".join(used)))
    return out


def keys_repeat_question_id(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        stem = qid.rsplit(".", 1)[-1].lower()
        keys = list(q["criteria"])
        if len(keys) >= 2 and len(stem) >= 3 and all(k.lower().startswith(stem + "_") or k.lower().endswith("_" + stem) for k in keys):
            example = keys[0]
            short = example[len(stem) + 1:] if example.lower().startswith(stem + "_") else example[:-len(stem) - 1]
            out.append((qid, "Every option key repeats the question id `%s`. The key is always read beside its question, "
                             "so drop the repeat: `%s` instead of `%s`." % (stem, short, example)))
    return out


def sentence_as_key(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        fallback = CATCH_ALL_KEYS | ABSENT_KEYS  # none_of_the_above is a usual key, not a sentence
        long = [k for k in q["criteria"] if k.strip().lower() not in fallback
                and (len(_key_words(k).split()) >= 4 or len(k) > 40)]
        if long:
            out.append((qid, "Option `%s` reads as a sentence. Keep keys short identifiers, and put the meaning in the "
                             "description." % long[0]))
    return out


def choice_keys_in_instructions(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        text = " ".join(lint._QUOTED.sub(" ", " ".join(lint._strings(q.get("instructions")))).lower().split())
        named = [k for k in q["criteria"] if len(k) >= 3 and re.search(r"\b%s\b" % re.escape(_key_words(k)), text)]
        if len(named) >= 3 and 2 * len(named) >= len(q["criteria"]):
            out.append((qid, "The instructions list the options (%s). The model already sees them in the criteria; keep "
                             "the question short and describe each option there, so the two cannot drift apart."
                             % ", ".join("`%s`" % k for k in named)))
    return out


def ordinal_choice(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "choice"):
        fallback = CATCH_ALL_KEYS | (ABSENT_KEYS - {"none"})
        keys = {k.strip().lower() for k in q["criteria"] if k.strip().lower() not in fallback}
        if len(keys) >= 3 and any(keys <= scale for scale in ORDINAL_SETS):
            out.append((qid, "The options (%s) form an ordered scale. A Score keeps the order, so you can threshold on it "
                             "in code." % ", ".join("`%s`" % k for k in q["criteria"] if k.strip().lower() in keys)))
    return out


# ---------- Noul criteria ----------

def _noul_texts(q: dict) -> Tuple[Any, Any]:
    crit = q.get("criteria") or {}
    return crit.get("true"), crit.get("false")


def noul_same_criteria(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "noul"):
        yes, no = _noul_texts(q)
        if lint._norm(yes) and lint._norm(yes) == lint._norm(no):
            out.append((qid, "The yes and no criteria are the same, so they say nothing about which answer fits. "
                             "Describe what a yes looks like and what a no looks like."))
    return out


def _negative(value: Any) -> bool:
    return isinstance(value, str) and bool(NEGATIVE.search(value))


# A question that asks about an absence ("Is `message` free of complaints?") rightly has a negative yes criterion.
_ASKS_ABSENCE = re.compile(r"\b(?:not|no|never|none|nothing|without|free of|lacks?|lacking|missing|absent|fails?|unable)\b"
                           r"|n't\b", re.I)


_FILLER = {"does", "that", "this", "with", "from", "have", "there", "their", "about", "into", "which", "what", "when",
           "were", "they", "them", "than", "then", "some", "other", "only", "also", "been", "being", "says"}


def _topics(text: str) -> set:
    """Content-word stems (first five letters of words of four or more letters), for "is it about the same thing"."""
    return {w[:5] for w in _words(lint._QUOTED.sub(" ", text)) if len(w) >= 4 and w.isalpha() and w not in _FILLER}


def noul_criteria_swapped(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "noul"):
        yes, no = _noul_texts(q)
        # Only when the negative yes is about what the question asks: "Is this the first message?" may rightly have
        # "No earlier contact" as its yes.
        if (isinstance(no, str) and no.strip() and _negative(yes) and not _negative(no)
                and not _ASKS_ABSENCE.search(lint._QUOTED.sub(" ", _main(q)))
                and _topics(yes) & _topics(_main(q)) & _topics(no)):
            out.append((qid, "The yes criterion reads as a negative and the no criterion does not, so they may be "
                             "swapped. A Noul's true criterion describes when the answer is yes."))
    return out


def noul_both_negative(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "noul"):
        yes, no = _noul_texts(q)
        if (_negative(yes) and _negative(no) and lint._norm(yes) != lint._norm(no)
                and not _ASKS_ABSENCE.search(lint._QUOTED.sub(" ", _main(q)))):
            out.append((qid, "The yes and no criteria both read as negatives, so one of them may be inverted. Describe "
                             "the yes case positively."))
    return out


def yes_no_only_criteria(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "noul"):
        yes, no = _noul_texts(q)
        if lint._norm(yes) in ("yes", "y", "true") and lint._norm(no) in ("no", "n", "false"):
            out.append((qid, "The criteria only say yes and no. Describe what in the input makes the answer yes and what "
                             "makes it no, with an example of each."))
    return out


# ---------- Score levels ----------

# A level numbered like "1 - Calm" or "2) Annoyed". A number followed by another number is a range or a decimal
# ("1-3 bags", "1.5 cups"), not a level number.
_LEADING_NUMBER = re.compile(r"^\s*(\d+)\s*[-–:.)=]\s*(?=[^\d\s])")


def level_number_mismatch(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "score"):
        numbered = [(i, _LEADING_NUMBER.match(level)) for i, level in enumerate(q["criteria"]) if isinstance(level, str)]
        numbered = [(i, m) for i, m in numbered if m]
        if len(numbered) < 2:
            continue
        for i, m in numbered:
            if int(m.group(1)) != i:
                out.append((qid, "Level %d starts with the number %s, but a Score answers with the 0-based position, so "
                                 "the score will not match the number in the text. Number the levels from 0, or drop "
                                 "the numbers." % (i, m.group(1))))
                break
    return out


def numeric_levels(state: Any, questions: dict, refs: set) -> List[Finding]:
    return [(qid, "The levels are bare numbers, so the model has no description of what each means. Describe what "
                  "each level looks like in the input.") for qid, q in _of(questions, "score")
            if all(isinstance(level, str) and re.fullmatch(r"\s*\d+(?:\.\d+)?\s*", level) for level in q["criteria"])]


def _ranked(levels: list) -> List[Tuple[int, str, int]]:
    out = []
    for i, level in enumerate(levels):
        words = _words(level) if isinstance(level, str) else []
        if words and words[0] in RANK:
            out.append((i, words[0], RANK[words[0]]))
    return out


def levels_reversed(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "score"):
        ranked, last = _ranked(q["criteria"]), len(q["criteria"]) - 1
        if (len(ranked) >= 2 and ranked[0][0] == 0 and ranked[-1][0] == last
                and all(a[2] > b[2] for a, b in zip(ranked, ranked[1:]))):
            out.append((qid, "The levels run from \"%s\" down to \"%s\", but level 0 is a Score's lowest answer. If a "
                             "higher score should mean more, reverse the levels." % (ranked[0][1], ranked[-1][1])))
    return out


def levels_out_of_order(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "score"):
        ranked = _ranked(q["criteria"])
        steps = [b[2] - a[2] for a, b in zip(ranked, ranked[1:])]
        if len(ranked) >= 3 and any(s < 0 for s in steps) and any(s > 0 for s in steps):
            drop = next(b for a, b in zip(ranked, ranked[1:]) if b[2] < a[2])
            out.append((qid, "Level %d (\"%s\") comes after a level that reads higher. Order the levels from least to "
                             "most, so the score's position means more." % (drop[0], drop[1])))
    return out


def mixed_level_fields(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "score"):
        described = [level for level in q["criteria"] if level not in EMPTY]
        shapes = {tuple(sorted(level)) if isinstance(level, dict) else type(level).__name__ for level in described}
        if any(isinstance(level, dict) for level in described) and len(shapes) > 1:
            out.append((qid, "The levels are described with different fields. Use the same field names for every level, "
                             "so the model can compare them directly."))
    return out


def uneven_level_labels(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"^\s*[A-Z][\w' -]{0,24}:\s+\S")
    out = []
    for qid, q in _of(questions, "score"):
        texts = [(i, level) for i, level in enumerate(q["criteria"]) if isinstance(level, str) and level.strip()]
        labeled = [i for i, level in texts if rx.match(level)]
        if len(texts) >= 3 and 2 <= len(labeled) < len(texts):
            bare = [i for i, _level in texts if i not in labeled]
            out.append((qid, "Most levels start with a short label (\"Label: ...\"), but %s %s not. Give every level the "
                             "same shape." % (_join(["level %d" % i for i in bare]), "does" if len(bare) == 1 else "do")))
    return out


# ---------- ranges written into descriptions ----------

def _ranges(q: dict) -> List[Tuple[str, float, float, str, str]]:
    out = []
    for name, about in _texts(q):
        found = _RANGE.findall(_DATE.sub(" ", about))
        if len(found) == 1:
            lo, hi = found[0]
            out.append((name, float(lo), float(hi), lo, hi))
    return out


def range_reversed(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        ranges = _ranges(q)
        backwards = [r for r in ranges if r[1] > r[2]]
        # Only among ranges that split the answers into bands; one "open 9-5" alone is a time, not a band.
        if backwards and len(ranges) >= 2:
            name, _lo, _hi, a, b = backwards[0]
            out.append((qid, "The range in %s runs backwards (%s to %s). Write the smaller number first." % (name, a, b)))
    return out


def range_overlap(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        ranges = [r for r in _ranges(q) if r[1] <= r[2]]
        for a, b in combinations(ranges, 2):
            lo, hi = max(a[1], b[1]), min(a[2], b[2])
            if lo <= hi:
                shared = a[4] if a[2] == lo else b[4] if b[2] == lo else a[3] if a[1] == lo else b[3]
                out.append((qid, "The ranges in %s and %s overlap (both include %s), so an input there fits two answers. "
                                 "Make the ranges meet without overlapping, such as 0-9 and 10-19." % (a[0], b[0], shared)))
                break
    return out


def range_gap(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        ranges = sorted((r for r in _ranges(q) if r[1] <= r[2]), key=lambda r: r[1])
        if len(ranges) < 2 or not all(float(r[1]).is_integer() and float(r[2]).is_integer() for r in ranges):
            continue
        for a, b in zip(ranges, ranges[1:]):
            if b[1] > a[2] + 1:
                first, last = int(a[2]) + 1, int(b[1]) - 1
                missed = str(first) if first == last else "%d to %d" % (first, last)
                out.append((qid, "The ranges in %s and %s leave a gap: nothing covers %s. Make each range start right "
                                 "after the one before ends." % (a[0], b[0], missed)))
                break
    return out


# ---------- structured criteria ----------

def _structured(q: dict) -> List[Tuple[str, dict]]:
    return [(name, about) for name, about in _named(q) if isinstance(about, dict)]


def empty_criterion_field(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        for name, about in _structured(q):
            empty = [str(k) for k, v in about.items() if v in EMPTY or (isinstance(v, str) and not v.strip())]
            if empty:
                out.append((qid, _cap("%s has an empty field %s. Fill it in or remove it." % (name, ", ".join("`%s`" % k for k in empty)))))
                break
    return out


def shared_example(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        seen: Dict[str, str] = {}
        for name, about in _structured(q):
            # Only example lists: two options may well share an entry in a field such as not_for.
            listed = {lint._norm(item) for field, value in about.items() if "example" in str(field).lower()
                      and isinstance(value, list) for item in value if isinstance(item, str)}
            clash = [seen[item] for item in sorted(listed) if item and item in seen and seen[item] != name]
            if clash:
                out.append((qid, _cap("%s and %s list the same example, so it counts as evidence for both answers. "
                                      "Keep it under the answer it belongs to." % (clash[0], name))))
                break
            for item in listed:
                seen.setdefault(item, name)
    return out


def score_asks_which(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _of(questions, "score"):
        m = re.match(r"\s*(which|who|whom|whose|where|what (?:kind|type|sort|category))\b", _main(q), re.I)
        if m:
            out.append((qid, "A Score measures how much, but this asks \"%s\". Use a Choice for categories, and a Score "
                             "only for ordered levels." % m.group(1).lower()))
    return out


def _rule(ident: str, title: str, check, level: str = "advice", anchor: str = STRUCTURE) -> dict:
    return {"id": ident, "kind": "lint_rule", "title": title, "level": level, "check": check, "anchor": anchor}


PACK = kit.define_pack({
    "id": "lint-criteria",
    "surface": "python.lint",
    "title": "Choice, Score and Noul criteria",
    "about": "Question checks on criteria: options that overlap, restate their keys or lack a fallback, Score levels "
             "out of order or misnumbered, keys that are awkward in labels and rules, and Noul criteria that look swapped.",
    "features": [
        _rule("single_option", "A Choice with only one option", single_option, level="problem"),
        _rule("yes_no_choice", "A Choice whose options are only yes and no, which a Noul answers better", yes_no_choice),
        _rule("score_two_levels", "A Score with only two levels", score_two_levels),
        _rule("score_many_levels", "A Score with more than seven levels", score_many_levels),
        _rule("options_restate_keys", "Options whose descriptions only repeat their keys", options_restate_keys),
        _rule("one_word_options", "Options all described in a single word", one_word_options),
        _rule("one_word_levels", "Score levels that are each a single word", one_word_levels),
        _rule("option_is_question", "An option or level described as a question", option_is_question),
        _rule("long_criterion", "An option, level or Noul criterion longer than 40 words", long_criterion),
        _rule("keys_differ_by_case", "Option keys that differ only in case or separators", keys_differ_by_case, level="problem"),
        _rule("options_differ_by_negation", "Two options that differ only by a negation", options_differ_by_negation),
        _rule("reordered_descriptions", "Two descriptions with the same words in another order", reordered_descriptions),
        _rule("same_leading_words", "Options or levels that share their first five words", same_leading_words),
        _rule("catch_all_not_last", "A catch-all option such as `other` listed before specific options", catch_all_not_last),
        _rule("conditional_choice_without_fallback", "A conditional Choice (\"If ...\") with no option for when the condition fails", conditional_choice_without_fallback),
        _rule("two_catch_alls", "More than one \"something else\" option (other, misc, none of these)", two_catch_alls),
        _rule("key_with_spaces", "Option keys that contain spaces", key_with_spaces),
        _rule("mixed_key_styles", "Option keys that mix snake_case, camelCase and other styles", mixed_key_styles),
        _rule("keys_repeat_question_id", "Option keys that all repeat the question id", keys_repeat_question_id),
        _rule("sentence_as_key", "An option key that reads as a sentence", sentence_as_key),
        _rule("choice_keys_in_instructions", "Instructions that list the Choice's own options", choice_keys_in_instructions, anchor=DECOMPOSE),
        _rule("ordinal_choice", "Choice options that form an ordered scale a Score would keep", ordinal_choice),
        _rule("noul_same_criteria", "Noul yes and no criteria that are the same", noul_same_criteria, level="problem"),
        _rule("noul_criteria_swapped", "A Noul whose yes criterion reads as the negative case", noul_criteria_swapped),
        _rule("noul_both_negative", "Noul yes and no criteria that both read as negatives", noul_both_negative),
        _rule("yes_no_only_criteria", "Noul criteria that only say yes and no", yes_no_only_criteria),
        _rule("level_number_mismatch", "A level whose leading number is not its 0-based position", level_number_mismatch),
        _rule("numeric_levels", "Score levels that are bare numbers", numeric_levels),
        _rule("levels_reversed", "Score levels that run from most to least", levels_reversed),
        _rule("levels_out_of_order", "Score levels whose amounts go up and down", levels_out_of_order),
        _rule("mixed_level_fields", "Score levels described with different fields", mixed_level_fields),
        _rule("uneven_level_labels", "Score levels where only some start with a \"Label:\"", uneven_level_labels),
        _rule("range_reversed", "A numeric range written backwards (\"20-10\")", range_reversed),
        _rule("range_overlap", "Numeric ranges in options or levels that overlap", range_overlap),
        _rule("range_gap", "Whole-number ranges in options or levels that leave a gap", range_gap),
        _rule("empty_criterion_field", "An empty field in a structured criterion", empty_criterion_field),
        _rule("shared_example", "The same example listed under two answers' example fields", shared_example, level="problem"),
        _rule("score_asks_which", "A Score that asks which or who, a Choice question", score_asks_which),
    ],
})
