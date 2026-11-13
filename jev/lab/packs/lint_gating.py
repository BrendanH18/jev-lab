"""Question checks for gating and automation: questions whose answers a threshold, a Policy gate or a consistency
rule cannot use well.

A gate acts on a calibrated probability, and a consistency rule names a question id and an option key. These rules
look for questions that work against that: options a gate would treat as one answer, options that grade the
model's own certainty, instructions that set a confidence bar or ask the model to decide what to do (code's job),
questions that join two conditions so one probability covers both, and ids and keys that rules and saved gates read
badly. The built-in checks and the other lint packs already report Box questions without a Noul, questions that
depend on another answer, requests for the model's confidence, reasoning or generated text, and ids a rule cannot
name; nothing here repeats them. Messages quote ids, option keys and authored words, never a state value.
"""

from __future__ import annotations

import re
from itertools import combinations
from typing import Any, List, Optional, Tuple

from jev import lint
from jev.lab import kit

STATE = "#use-structure-in-the-input-state"
DECOMPOSE = "#decompose-the-questions"
STRUCTURE = "#use-structure-in-the-questions"
ASKED = ("noul", "choice", "score")

Finding = Tuple[Optional[str], str]

# Endings that make two option keys one word: `refund` and `refunds`, `cancel` and `cancel_request`.
KEY_ENDINGS = ("s", "es", "ed", "d", "ing", "_request", "_requested", "_requests")
COMBINED_KEYS = {"both", "all_of_the_above", "all_of_these"}
# "multiple" and "several" stand for other options only when no option is a count ("one", "multiple", "none").
PLURAL_KEYS = {"multiple", "several"}
COUNT_KEYS = {"one", "single", "none", "zero", "0", "1", "two", "few", "many"}
FLAG_PREFIXES = ("is_", "has_", "contains_", "mentions_", "needs_", "wants_", "includes_")
NEGATIVE_ID = re.compile(r"^(?:not|no|isnt|is_not|doesnt|does_not|has_no|cannot|cant)_[a-z0-9]", re.I)
COPY_SUFFIX = re.compile(r"^(.+?)_(?:copy(?:_\d+)?|old|new|v\d+|\d+|alt|draft|backup|tmp)$")
CERTAINTY = re.compile(r"^\s*(?:definitely|certainly|probably|possibly|likely|unlikely|maybe|perhaps|surely|almost certainly"
                       r"|very likely|somewhat likely|not likely)\b", re.I)
# Id endings that say which question type an id belongs to.
CATEGORY_ENDINGS = ("_type", "_kind", "_category", "_class")
AMOUNT_ENDINGS = ("_score", "_level", "_count", "_amount", "_rating", "_degree") + CATEGORY_ENDINGS


# ---------- helpers ----------


def _main(question: dict) -> str:
    """The question text: string instructions, or the `question` field of structured ones."""
    value = question.get("instructions")
    if isinstance(value, dict) and isinstance(value.get("question"), str):
        return value["question"]
    return value if isinstance(value, str) else ""


def _plain(text: str) -> str:
    """Text without quoted data and backticked paths (each becomes "_"), on one line."""
    return " ".join(lint._QUOTED.sub(" _ ", text).split())


def _instructions(question: dict) -> List[str]:
    return list(lint._strings(question.get("instructions")))


def _criteria(question: dict) -> List[str]:
    return list(lint._strings(question.get("criteria")))


def _choices(questions: dict):
    return [(qid, q) for qid, q in questions.items() if q["type"] == "choice"]


def _loose(key: str) -> str:
    return re.sub(r"[\s-]+", "_", key.strip().lower())


def _join(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _ticked(names) -> List[str]:
    return ["`%s`" % name for name in names]


def _search(rx, texts: List[str]):
    for text in texts:
        m = rx.search(_plain(text))
        if m:
            return m
    return None


def _said(text: str) -> str:
    return " ".join(text.lower().split())


# ---------- options a gate would treat the same ----------

_ALIAS = re.compile(r"\b(?:same as|treat(?:ed)? (?:it |this )?(?:as|like)|identical to|equivalent to|"
                    r"handled? (?:the same )?(?:as|like)|alias (?:of|for)|counts? as)\s+(?:option\s+)?[`\"'“‘]?"
                    r"([A-Za-z0-9][\w-]*)", re.I)


def option_alias(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        keys = {key.strip().lower(): key for key in q["criteria"]}
        for key, about in q["criteria"].items():
            for text in lint._strings(about):
                m = _ALIAS.search(text)
                other = keys.get(m.group(1).lower()) if m else None
                if other is not None and other != key:
                    out.append((qid, "`%s` is described as the same as `%s`, so labels and a gate treat them as one answer "
                                     "while the model splits probability between them. Merge them into one option."
                                % (key, other)))
                    break
    return out


def inflected_option_keys(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        for a, b in combinations(list(q["criteria"]), 2):
            la, lb = _loose(a), _loose(b)
            short, long = (la, lb) if len(la) <= len(lb) else (lb, la)
            if short and any(long == short + ending for ending in KEY_ENDINGS):
                out.append((qid, "Options `%s` and `%s` differ only by an ending, so they read as one answer split in two, "
                                 "and a gate or rule that names one misses the other. Merge them, or rename one to say "
                                 "how they differ." % (a, b)))
                break
    return out


def combined_option(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        keys = {_loose(key) for key in q["criteria"]}
        for key in q["criteria"]:
            loose = _loose(key)
            parts = re.split(r"_and_", loose)
            joined = len(parts) == 2 and all(part in keys and part != loose for part in parts)
            plural = loose in PLURAL_KEYS and not (keys & COUNT_KEYS)
            if ((loose in COMBINED_KEYS or plural) and len(keys) >= 3) or joined:
                out.append((qid, "`%s` stands for several other options at once, so a gate on this Choice cannot tell "
                                 "which of them holds. Ask a Noul for each, and combine the answers in code." % key))
                break
    return out


def flag_options(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        flags = [key for key in q["criteria"] if _loose(key).startswith(FLAG_PREFIXES)]
        if len(flags) >= 2:
            out.append((qid, "Options %s read as yes/no facts, which can hold together, but a Choice returns one. Ask a "
                             "Noul for each, so each gets its own probability and threshold." % _join(_ticked(flags))))
    return out


def negated_key_pair(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        keys = {_loose(key): key for key in q["criteria"]}
        for loose, key in keys.items():
            m = re.match(r"^(?:not|no|non)_(.+)$", loose)
            if m and m.group(1) in keys:
                other = keys[m.group(1)]
                said = [_bare_negation(" ".join(lint._strings(q["criteria"][name]))) for name in (other, key)]
                if said[0] and said[0] == said[1]:
                    break  # the descriptions differ only by a negation too: lint-criteria reports that pair
                tail = ("This is a yes/no question: a Noul returns the probability of yes, which a threshold uses directly."
                        if len(keys) == 2 else "They split one yes/no question across options; ask it as a Noul.")
                out.append((qid, "Options `%s` and `%s` are one condition and its negation. %s" % (other, key, tail)))
                break
    return out


def numeric_choice_keys(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        keys = list(q["criteria"])
        if not 3 <= len(keys) <= 10 or any(about in (None, "", {}, []) for about in q["criteria"].values()):
            continue
        parts = [re.fullmatch(r"(.*?)(\d+)", key.strip()) for key in keys]
        if not all(parts) or len({m.group(1).lower() for m in parts}) != 1:
            continue
        numbers = sorted(int(m.group(2)) for m in parts)
        if numbers[0] in (0, 1) and numbers == list(range(numbers[0], numbers[0] + len(numbers))):
            out.append((qid, "The options are numbered %s to %s, an ordered scale. A Choice treats them as unrelated "
                             "categories, and a rule cannot compare them with >= or <; a Score keeps the order."
                        % (keys[0], keys[-1])))
    return out


def certainty_in_options(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] == "choice":
            named = [("`%s`" % key, [key.replace("_", " ")] + list(lint._strings(about))) for key, about in q["criteria"].items()]
        elif q["type"] == "score":
            named = [("level %d" % i, list(lint._strings(level))) for i, level in enumerate(q["criteria"])]
        else:
            continue
        graded = [name for name, texts in named if any(CERTAINTY.match(text) for text in texts[:2])]
        if len(graded) >= 2:
            out.append((qid, "%s grade how sure the answer is. Every answer already carries a calibrated probability, "
                             "and a threshold in code turns it into sure or unsure; describe the facts each answer "
                             "stands for instead." % _join(graded)))
    return out


# ---------- confidence and decisions belong in code ----------

_DOUBT = re.compile(r"\b(?:if|when|where) (?:you are |you're |it is |it's )?(?:unsure|not sure|uncertain|unclear|in doubt|"
                    r"ambiguous|undecided)\b[^.;?]*?\b(?:answer|choose|pick|select|say|mark|return|use|default to|"
                    r"lean|go with|assume)\b|\bwhen in doubt\b|\bdefault to (?:yes|no|true|false|`)|"
                    r"\bassume (?:yes|no|true|false) unless\b|\bgive (?:it |them )?the benefit of the doubt\b", re.I)


def doubt_rule(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] not in ASKED:
            continue
        texts = _instructions(q) + _criteria(q)
        m = _search(_DOUBT, texts)
        if m:
            out.append((qid, "The question says what to answer when in doubt (\"%s\"), which pushes doubtful inputs "
                             "toward one answer and hides the doubt from the probability. Describe the answers, and let "
                             "a threshold in code send doubtful rows to review." % _said(m.group(0))))
    return out


_BAR = re.compile(r"\bonly (?:if|when) (?:you are |you're |it is |it's )?(?:certain|sure|confident|absolutely sure)\b|"
                  r"\b(?:with|at) (?:high|full|absolute|complete|total) (?:confidence|certainty)\b|"
                  r"\berr on the side of\b|\bbe (?:conservative|cautious|strict|lenient)\b|"
                  r"\b(?:confidence|probability|certainty) (?:threshold|cut-?off|of at least|above|over|below)\b|"
                  r"\b(?:use|apply|set|meet|pass|clear|reach|exceed)(?:s|es)? (?:a |the |this |that )?(?:high |low |strict )?"
                  r"threshold\b|\bbeyond (?:a |any )?(?:reasonable )?doubt\b", re.I)


def confidence_bar(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] not in ASKED:
            continue
        m = _search(_BAR, _instructions(q) + _criteria(q))
        if m:
            out.append((qid, "The wording sets a confidence bar (\"%s\"), which is the threshold's job: it skews the "
                             "probability instead of letting code choose the bar. Ask the plain question, and set the "
                             "threshold in Calibrate or Policy." % _said(m.group(0))))
    return out


_DECIDE = re.compile(r"^\s*should (?:we|i|you|staff|the (?:shop|team|agent|staff|company|system|bot))\b|"
                     r"\bshould (?:this|it|that|the)(?: \w+)? be (?:escalated|approved|rejected|refunded|flagged|blocked|deleted|"
                     r"removed|banned|accepted|declined|paid|closed)\b|"
                     r"\b(?:auto-?approve|auto-?reject|auto-?refund)\w*|"
                     r"\bautomatically (?:approve|reject|refund|pay|send|escalate|close|accept|decline|delete|ban)\w*|"
                     r"\b(?:approve|accept) or (?:reject|deny|decline)\b|"
                     r"\bneeds? (?:a )?(?:human|manual) review\b|\bshould (?:a human|a person|someone) (?:review|check|look)\b",
                     re.I)


def asks_for_decision(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        m = _search(_DECIDE, _instructions(q)) if q["type"] in ASKED else None
        if m:
            out.append((qid, "The question asks the model to decide what to do (\"%s\"). That is a business rule: ask "
                             "about the facts it rests on, and decide in code from their answers and thresholds."
                        % _said(m.group(0))))
    return out


_LIKELY = re.compile(r"\bhow (?:likely|probable|unlikely)\b|\b(?:is|are|was|were) (?:it|this|that|there) (?:likely|probable|"
                     r"unlikely)\b|\bwhat are the (?:chances|odds)\b|\bthe (?:chances?|odds) (?:of|that)\b|"
                     r"\blikelihood of\b", re.I)


def likelihood_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        m = _search(_LIKELY, [_main(q)]) if q["type"] in ("noul", "score") else None
        if m:
            out.append((qid, "The question asks how likely something is (\"%s\"), so the answer's probability is a "
                             "probability of a likelihood, which no threshold reads plainly. Ask whether it is so; the "
                             "probability is the likelihood." % _said(m.group(0))))
    return out


_CUTOFF = re.compile(r"\b(?:(?:more|less|fewer|greater|higher|lower|larger|smaller|bigger) than|over|under|above|below"
                     r"|exceeds?|exceeding|at least|at most|no more than|no less than|up to)\s+[$€£]?\d[\d,.]*(?![\d,.])", re.I)


def numeric_cutoff_in_criteria(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        m = _search(_CUTOFF, _criteria(q)) if q["type"] in ASKED else None
        if m:
            out.append((qid, "A criterion is decided by a written number (\"%s\"). Code compares numbers exactly: get "
                             "the number with code or a question of its own, and keep the criteria for the judgment."
                        % _said(m.group(0))))
    return out


# ---------- one question, one condition ----------

_COMPOUND = re.compile(r"^\s*(?:is|are|does|do|has|have|was|were|did|can|will)\b[^?]*?\b(?:and|or)\s+(?:is|are|does|do|has|"
                       r"have|was|were|did|can|will)\s+(?:it|they|he|she|the|this|that|there|_)\b", re.I)


def compound_noul(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        text = _main(q)
        m = _COMPOUND.search(_plain(text)) if q["type"] == "noul" and text else None
        if m:
            out.append((qid, "The Noul joins two yes/no conditions, so one probability has to cover both and a gate "
                             "cannot tell which failed. Ask each as its own Noul, and combine them in code or with a "
                             "consistency rule."))
    return out


_EQUALS = re.compile(r"`([^`\n]+)`\s+(?:equals?(?: to)?|==|is equal to|is set to|matches exactly|is exactly)\s+"
                     r"(?:\"[^\"]*\"|'[^']*'|“[^”]*”|`[^`]*`|[$€£]?\d[\d,.]*(?![\w.])|true|false|null|yes|no"
                     r"|(?!(?:the|a|an|what|whatever|that|this|its|their|his|her|any|one|some|each|another|which)\b)"
                     r"[A-Za-z][\w-]*(?=\s*[?.,;]|\s*$))", re.I)
_IS_LITERAL = re.compile(r"^\s*(?:is|was|does)\s+`([^`\n]+)`\s+(?:equal to\s+)?(?:\"[^\"]*\"|'[^']*'|“[^”]*”|"
                         r"[$€£]?\d[\d,.]*|true|false|null)\s*\??\s*$", re.I)


def field_equality_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] not in ASKED:
            continue
        for text in _instructions(q):
            m = _EQUALS.search(text) or _IS_LITERAL.search(text)
            if m:
                out.append((qid, "The question checks whether `%s` equals a written value, which code decides exactly "
                                 "and for free. Compare it in code, and keep the question for a judgment." % m.group(1)))
                break
    return out


_REASON = re.compile(r"(?:,|\band)\s*why\s*\?|\band why\b|\bwhy or why not\b|\bexplain why\b|\bgive (?:a|the|your) reasons?\b"
                     r"|\bstate (?:a|the|your) reasons?\b|\bwith (?:a|the|your) reasons?\b|\bsay why\b", re.I)


def asks_for_reason(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        m = _search(_REASON, _instructions(q)) if q["type"] in ASKED else None
        if m:
            out.append((qid, "The question asks for a reason (\"%s\"), but System One returns a typed answer and its "
                             "probability, never text. Drop it, or ask a Choice whose options are the reasons."
                        % _said(m.group(0).lstrip(",").strip())))
    return out


_MULTI = re.compile(r"\b(?:select|choose|pick|tick|check|mark) (?:all|every|each|any) (?:that|which|of the|options)\b|"
                    r"\ball that apply\b|\bone or more\b|\bany number of\b|\bas many as apply\b", re.I)


def multi_select_choice(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        m = _search(_MULTI, _instructions(q))
        if m:
            out.append((qid, "The Choice asks for several options (\"%s\"), but it returns exactly one, so the others "
                             "are lost and a gate sees a split probability. Ask a Noul for each option instead."
                        % _said(m.group(0))))
    return out


_IF_PRESENT = re.compile(r"\bif (?:any|present|visible|there is (?:one|any)|it exists|one exists|shown|it is there|found)\b", re.I)


def box_if_present(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        m = _search(_IF_PRESENT, _instructions(q)) if q["type"] == "box" else None
        if m:
            out.append((qid, "The Box says \"%s\", but a Box always returns four edges, whether or not the thing is "
                             "there. Drop the condition, and gate the box on a Noul that asks whether it is visible."
                        % _said(m.group(0))))
    return out


_TOPIC_NOUNS = r"(?:question|issue|request|problem|complaint|matter|case|message|topic|enquiry|inquiry|team|ticket)s?"


def _about_option(key: str) -> "re.Pattern[str]":
    """The Noul's question is about this option: "Is `message` a billing question?", "Is it about billing?",
    "... for the shipping team?". A key word used in passing ("mention shipping costs") is not."""
    words = r"\s+".join(re.escape(word) for word in re.findall(r"[a-z0-9]+", key.lower()))
    return re.compile(r"\b(?:about|an?|for(?: the)?)\s+%s(?:\s+%s)?\s*[?.]?\s*$" % (words, _TOPIC_NOUNS), re.I)


def noul_repeats_choice_option(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    choices = [(cid, c, set(lint._paths(c))) for cid, c in _choices(questions)]
    for qid, q in questions.items():
        if q["type"] != "noul":
            continue
        paths = set(lint._paths(q))
        text = _plain(_main(q))
        for cid, c, cpaths in choices:
            if not (paths & cpaths):
                continue
            hit = next((key for key in c["criteria"] if len(re.sub(r"[^a-z0-9]", "", key.lower())) >= 4
                        and _about_option(key).search(text)), None)
            if hit:
                out.append((qid, "This Noul asks about `%s`, which is also an option of Choice `%s` on the same field, so "
                                 "the two answers can disagree on a row. Keep one, or add a consistency rule such as "
                                 "`if %s = yes then %s = %s`." % (hit, cid, qid, cid, hit)))
                break
    return out


def _bare_negation(text: str) -> str:
    text = re.sub(r"n't\b", " not", text.lower())
    return " ".join(w for w in re.findall(r"[a-z0-9]+", text) if w not in ("not", "no", "never"))


def inverse_nouls(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    nouls = [(qid, _main(q)) for qid, q in questions.items() if q["type"] == "noul" and _main(q)]
    for (a, ta), (b, tb) in combinations(nouls, 2):
        if lint._norm(ta) != lint._norm(tb) and _bare_negation(ta) == _bare_negation(tb) and _bare_negation(ta):
            out.append((a, "Nouls `%s` and `%s` ask the same thing, one in the negative, so one is 1 minus the other and "
                           "pays for the same answer twice. Keep the positive one and invert it in code." % (a, b)))
    return out


# ---------- ids and keys that rules and saved gates read ----------


def padded_option_key(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in _choices(questions):
        padded = [key for key in q["criteria"] if key != key.strip()]
        if padded:
            out.append((qid, "Option %s has spaces at its start or end. Labels must match keys exactly and consistency "
                             "rules trim what they name, so neither can reach it. Remove the spaces."
                        % _join(['"%s"' % key for key in padded])))
    return out


def negative_id(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        head, dot, last = qid.rpartition(".")
        if q["type"] != "noul" or not NEGATIVE_ID.match(last):
            continue
        positive = head + dot + NEGATIVE_ID.sub(lambda m: m.group(0)[-1], last)
        out.append((qid, "Noul `%s` is named for the negative, so a rule reads `%s = no` as a double negative and a "
                         "threshold on yes automates the absence. Name it for the positive, such as `%s`, and ask that "
                         "question." % (qid, qid, positive)))
    return out


def copy_id(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid in questions:
        m = COPY_SUFFIX.match(qid)
        if not m:
            continue
        loose_copy = re.search(r"_copy(?:_\d+)?$", qid)
        if m.group(1) in questions or loose_copy:
            out.append((qid, "`%s` looks like a copy left from duplicating a question. Labels, saved gates, rules and "
                             "decisions files are keyed by id, so give it a lasting name before you label or tune it."
                        % qid))
    return out


def id_reads_as_other_type(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        last = qid.rsplit(".", 1)[-1].lower()
        if q["type"] == "noul" and last.endswith(AMOUNT_ENDINGS):
            what = "a category or an amount"
        elif q["type"] == "score" and last.endswith(CATEGORY_ENDINGS):
            what = "a category, which a Choice answers"
        elif q["type"] == "choice" and last.startswith(("is_", "has_")):
            what = "a yes/no fact, which a Noul answers"
        else:
            continue
        out.append((qid, "The %s `%s` is named like %s, so consistency rules and gates that name it read wrongly (such "
                         "as `if %s = ...`). Rename it to say what its answer is." % (q["type"].capitalize(), qid, what, qid)))
    return out


def _rule(ident: str, title: str, check, level: str = "advice", anchor: str = STRUCTURE) -> dict:
    return {"id": ident, "kind": "lint_rule", "title": title, "level": level, "check": check, "anchor": anchor}


PACK = kit.define_pack({
    "id": "lint-gating",
    "surface": "python.lint",
    "title": "Questions a gate can use",
    "about": "Question checks for gating and automation: options a gate would treat as one, certainty and decisions "
             "that belong to thresholds and code, questions that join two conditions, and ids and keys that "
             "consistency rules and saved gates read badly.",
    "features": [
        _rule("option_alias", "An option described as the same as another option", option_alias),
        _rule("inflected_option_keys", "Option keys that differ only by an ending (refund, refunds)", inflected_option_keys),
        _rule("combined_option", "An option that stands for several others (both, a_and_b)", combined_option, anchor=DECOMPOSE),
        _rule("flag_options", "Choice options that are yes/no facts (is_..., has_...)", flag_options, anchor=DECOMPOSE),
        _rule("negated_key_pair", "Two options that are a condition and its negation (refund, no_refund)", negated_key_pair),
        _rule("numeric_choice_keys", "Choice options numbered as a scale (1, 2, 3 or tier_1, tier_2)", numeric_choice_keys),
        _rule("certainty_in_options", "Options or levels that grade certainty (definitely, probably, possibly)", certainty_in_options),
        _rule("doubt_rule", "Instructions that say what to answer when in doubt", doubt_rule),
        _rule("confidence_bar", "Wording that sets a confidence bar or threshold (\"only if certain\")", confidence_bar),
        _rule("asks_for_decision", "A question that asks the model to decide an action (\"Should we refund?\")", asks_for_decision, anchor=DECOMPOSE),
        _rule("likelihood_question", "A Noul or Score that asks how likely something is", likelihood_question),
        _rule("numeric_cutoff_in_criteria", "Criteria decided by a written number (\"over $100\")", numeric_cutoff_in_criteria, anchor=DECOMPOSE),
        _rule("compound_noul", "A Noul that joins two yes/no conditions with and/or", compound_noul, anchor=DECOMPOSE),
        _rule("field_equality_question", "A question that checks whether a field equals a written value", field_equality_question, anchor=DECOMPOSE),
        _rule("asks_for_reason", "A question that asks for a reason (\"and why?\")", asks_for_reason, anchor=DECOMPOSE),
        _rule("multi_select_choice", "A Choice that asks for all options that apply", multi_select_choice, anchor=DECOMPOSE),
        _rule("box_if_present", "A Box described \"if any\" or \"if present\"", box_if_present, anchor=DECOMPOSE),
        _rule("noul_repeats_choice_option", "A Noul that asks about another Choice's option on the same field", noul_repeats_choice_option, anchor=DECOMPOSE),
        _rule("inverse_nouls", "Two Nouls that ask the same thing, one in the negative", inverse_nouls, anchor=DECOMPOSE),
        _rule("padded_option_key", "An option key with spaces at its start or end", padded_option_key, level="problem"),
        _rule("negative_id", "A Noul id named for the negative (not_spam, no_refund)", negative_id),
        _rule("copy_id", "A question id left from duplicating a question (urgent_copy, urgent_2)", copy_id),
        _rule("id_reads_as_other_type", "A question id named like another question type (a Noul called ..._score)", id_reads_as_other_type),
    ],
})
