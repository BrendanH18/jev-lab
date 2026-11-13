"""Question checks on the wording of instructions: words that make a question vague, inverted, leading, or about
something the model cannot judge (arithmetic, dates, the future, itself), and text left unfinished.

Every rule reads only the authored instructions (and, for leftovers such as placeholders, the criteria). Quoted
text and backticked paths are data the question carries, so the phrase rules skip them. Messages quote the authored
words that triggered them, never a state value. These are English heuristics, so almost all of them are advice.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, List, Optional, Tuple

from jev import lint
from jev.lab import kit

STATE = "#use-structure-in-the-input-state"
DECOMPOSE = "#decompose-the-questions"
STRUCTURE = "#use-structure-in-the-questions"
ASKED = ("noul", "choice", "score")  # Box instructions are a noun phrase by design
# Words a question or instruction may open with. A short instruction that opens with none of them reads as a label.
OPENERS = {
    "is", "are", "was", "were", "am", "does", "do", "did", "has", "have", "had", "can", "could", "should", "would",
    "will", "may", "might", "must", "which", "what", "who", "whom", "whose", "where", "when", "why", "how", "given",
    "if", "for", "in", "rate", "classify", "choose", "pick", "select", "judge", "decide", "score", "label", "assess",
}
# Words of a state field name that say the state carries the current date or time (`today`, `sent_at`, `orderDate`).
CLOCK_WORDS = {"date", "dates", "datetime", "today", "now", "time", "timestamp", "day", "deadline", "when", "at",
               "current", "dated"}
UNITS = r"(?:words?|characters?|letters?|lines?|sentences?|paragraphs?|syllables?)"
TIME_UNITS = r"(?:days?|weeks?|months?|years?|hours?|minutes?)"

Finding = Tuple[Optional[str], str]

# Verbs that make what follows the content of the input rather than the question itself: "Does `message` ask how
# many bags come in a box?" is not a request to count, and "Does `message` say the invoice is overdue?" needs no clock.
ASKING = re.compile(r"\b(?:ask|asks|asked|asking|wonder|wonders|wondered|wondering|know|knows|inquire|inquires"
                    r"|enquire|enquires)\b", re.I)
REPORTING = re.compile(ASKING.pattern[:-3] + r"|say|says|said|state|states|stated|mention|mentions|mentioned|claim|claims"
                       r"|claimed|write|writes|wrote|report|reports|reported|tell|tells|told|promise|promises|promised"
                       r"|threaten|threatens|threatened|warn|warns|warned|suggest|suggests|suggested|complain|complains"
                       r"|complained|fear|fears|worry|worries|expect|expects|plan|plans|admit|admits)\b", re.I)


def _plain(text: str) -> str:
    """Text without quoted data and backticked paths (each becomes "_"), on one line."""
    return " ".join(lint._QUOTED.sub(" _ ", text).split())


def _instructions(question: dict) -> List[str]:
    return list(lint._strings(question.get("instructions")))


def _criteria(question: dict) -> List[str]:
    return list(lint._strings(question.get("criteria")))


def _main(question: dict) -> Optional[str]:
    """The question text itself: string instructions, or the `question` field of structured ones."""
    value = question.get("instructions")
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("question"), str):
        return value["question"]
    return None


def _said(text: str) -> str:
    return " ".join(text.lower().split())


def _reported(text: str, start: int, verbs) -> bool:
    """Whether a verb from `verbs` comes earlier in the same sentence than `start`."""
    before = re.split(r"[.?!;]", text[:start])[-1]
    return bool(verbs.search(before))


def _first_hit(rx, texts: Iterable[Optional[str]], unless=None):
    """The first match of `rx` in the texts (quoted data and backticked paths left out), skipping matches that a verb
    from `unless` introduces earlier in the sentence."""
    for text in texts:
        if text:
            plain = _plain(text)
            for m in rx.finditer(plain):
                if unless is None or not _reported(plain, m.start(), unless):
                    return m
    return None


def _phrase(pattern: str, message: str, types=ASKED, main_only: bool = False, flags: int = re.I, unless=None,
            keep_case: bool = False):
    """A rule that reports the first match of `pattern` in a question's instructions. `%(found)s` in the message
    is the matched authored words (lowercased unless `keep_case`)."""
    rx = re.compile(pattern, flags)

    def check(state: Any, questions: dict, refs: set) -> List[Finding]:
        out = []
        for qid, q in questions.items():
            if q["type"] not in types:
                continue
            m = _first_hit(rx, [_main(q)] if main_only else _instructions(q), unless)
            if m:
                found = " ".join(m.group(0).split()) if keep_case else _said(m.group(0))
                out.append((qid, message % {"found": found}))
        return out
    return check


def _in_any_text(pattern: str, message: str, flags: int = re.I):
    """A rule over every string of the instructions and criteria of every question type. Quoted text is data the
    question carries (such as a search for "{{name}}"), so it is left out."""
    rx = re.compile(pattern, flags)

    def check(state: Any, questions: dict, refs: set) -> List[Finding]:
        out = []
        for qid, q in questions.items():
            m = _first_hit(rx, _instructions(q) + _criteria(q))
            if m:
                out.append((qid, message % {"found": m.group(0).strip()}))
        return out
    return check


# ---------- vague and loaded wording ----------

vague_amount = _phrase(
    r"\b(?:a few|several|a lot of|lots of|a bunch of|numerous|plenty of|a handful of)\b",
    "The instructions use \"%(found)s\", an amount the model has to guess. Say in the criteria what counts (for a "
    "Score, one level per amount), or count the items in code.")

degree_in_noul = _phrase(
    r"\b(?:very|really|quite|extremely|somewhat|fairly|highly|overly|excessively)\s+"
    r"(?!(?:first|last|same|end|beginning|start|next|least|best|own|top|bottom|and|but|nor|the|for|with|from|than)\b)"
    r"[a-z]{3,}",
    "A Noul answers yes or no, but \"%(found)s\" asks how much. Use a Score whose levels describe each degree, or ask "
    "a yes/no question with a clear line in the criteria.", types=("noul",))


def negated_noul(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"^\s*(?:\w+n't\b|(?:is|are|was|were|does|do|did|has|have|can|could|should|would|will)\s+"
                    r"(?:\S+\s+){1,3}?not\b)(?!\s+(?:to|only|just)\b)", re.I)
    out = []
    for qid, q in questions.items():
        text = _main(q)
        if q["type"] == "noul" and text and rx.search(_plain(text)):
            out.append((qid, "The question is asked in the negative, so it is unclear whether yes means the thing "
                             "happened or did not. Ask the positive question and invert the answer in code."))
    return out


_NEGATION = re.compile(r"\b(?:not|no|never|none|nothing|nobody|nowhere|without|cannot)\b|n't\b", re.I)
# "not unusual", "not non-dairy"; words that only start with "un" (until, under, unique, unit, ...) are not negatives.
_NOT_UN = re.compile(r"\bnot\s+(?:(?!(?:until|unless|under|unique|unit|union|uniform|univers|unite)\w*)un\w{3,}"
                     r"|non-?\w+)", re.I)


def double_negative(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        if q["type"] not in ASKED:
            continue
        for text in _instructions(q):
            plain = _plain(text)
            # Negatives joined by and/or ("no milk and no sugar") are a list, not a double negative.
            clauses = re.split(r"[,;:.?!]|\b(?:and|or|but|nor)\b", plain, flags=re.I)
            stacked = [c for c in clauses if len(_NEGATION.findall(c)) >= 2] + _NOT_UN.findall(plain)
            if stacked:
                out.append((qid, "The instructions stack two negatives in one clause, which makes a yes hard to read. "
                                 "State the condition positively."))
                break
    return out


leading_question = _phrase(
    r"\b(?:obviously|surely|undoubtedly|isn't it obvious|don't you agree|wouldn't you agree|as everyone knows)\b"
    r"|(?:^|[,.;:!?]\s*)of course\b"
    r"|,\s*(?:right|correct|isn't it|don't you think|agreed)\s*\?",
    "The wording (\"%(found)s\") suggests the answer it expects. Ask neutrally, and describe both answers in the "
    "criteria.")


def noul_open_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        text = _main(q)
        plain = _plain(text or "")
        m = re.match(r"\s*(what|which|who|whom|whose|where|when|why|how)\b", plain, re.I)
        # "When `message` names a product, is it one we sell?" opens with a condition and still asks yes or no.
        if m and m.group(1).lower() in ("when", "where") and re.match(r"[^?]*,\s*(?:is|are|was|were|does|do|did|has|have"
                                                                      r"|can|could|should|would|will)\b", plain, re.I):
            continue
        if q["type"] == "noul" and m:
            out.append((qid, "A Noul answers yes or no, but this asks \"%s ...\". Ask a yes/no question, or use a "
                             "Choice (which one) or a Score (how much)." % m.group(1).lower()))
    return out


# ---------- work that belongs in code ----------

asks_count = _phrase(
    r"\bhow many\b(?!\s+%s\b)(?!\s+%s\b)|\bcount (?:the|how|all|each|every)\b|\b(?:the )?number of times\b"
    r"|\btally up\b|\btotal number of\b" % (UNITS, TIME_UNITS),
    "Counting (\"%(found)s\") is work for code: the model answers judgments, not arithmetic. Count in code, and ask the "
    "model only about each item.", unless=ASKING)

asks_arithmetic = _phrase(
    r"\b(?:calculate|compute|add up|subtract|multiply|divide \S+ by|sum up|the average of"
    r"|what percent(?:age)?|the difference between the (?:amounts|numbers|prices|totals|values|dates))\b",
    "Arithmetic (\"%(found)s\") belongs in code. Get each number (with code when it is written plainly, or with a "
    "Choice), and do the math in code.", unless=ASKING)

asks_date_math = _phrase(
    r"\bhow many %s\b|\b(?:more|less|fewer|over|under|within|at least|at most|no more|no less)(?: than)? \d+ %s\b"
    r"|\b%s (?:between|until|since)\b|\bhow long ago\b|\bhow old\b"
    r"|\b(?:which|what) day of the week\b|\bwhat date (?:is|was|will)\b" % (TIME_UNITS, TIME_UNITS, TIME_UNITS),
    "Date arithmetic (\"%(found)s\") belongs in code: the model does not compute dates. Ask for the date parts, as "
    "the date-parts example does, and compare them in code.", unless=ASKING)

asks_length = _phrase(
    r"\b(?:how many|number of|count (?:the )?)\s*%s\b|\b(?:longer|shorter|more|fewer|less) than \d+ %s\b"
    r"|\b(?:word|character|letter|line) count\b" % (UNITS, UNITS),
    "Text length (\"%(found)s\") is exact in code. Measure it in code and keep the question for a judgment.")

numeric_comparison = _phrase(
    r"\b(?:(?:more|less|fewer|greater|higher|lower|larger|smaller|bigger) than|over|under|above|below|exceeds?"
    r"|exceeding|at least|at most|no more than|no less than|up to)\s+[$€£]?\d[\d,.]*(?![\d,.])(?!\s*(?:%s|%s)\b)"
    % (UNITS, TIME_UNITS),
    "Comparing a number (\"%(found)s\") is exact in code. Get the number (with code when it is written plainly) and "
    "compare it there.")


def future_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"^\s*will\b(?!\s+you\b)|\bin the future\b|\bgoing to (?:happen|churn|buy|leave|cancel|return|renew|pay)\b", re.I)
    out = []
    for qid, q in questions.items():
        # "Does `message` say the customer is going to cancel?" asks about a stated plan, which the input shows now.
        if q["type"] in ASKED and _first_hit(rx, _instructions(q), REPORTING):
            out.append((qid, "This asks what will happen. The model judges what the input shows now: ask about stated "
                             "plans or signals, and predict in code from outcomes you record."))
    return out


# ---------- questions about the model ----------

asks_model_confidence = _phrase(
    r"\bhow (?:sure|confident|certain) are you\b|\byour (?:confidence|certainty)\b"
    r"|\b(?:what is|give|estimate) the (?:probability|likelihood|chance)\b|\b\d{1,3}\s*%\s*(?:sure|certain|confident|likely)\b"
    r"|\bpercent (?:sure|certain|confident|likely)\b|\b(?:probability|likelihood) that\b",
    "Every answer already carries a calibrated probability, so asking for one (\"%(found)s\") adds nothing. Ask the "
    "plain question, then read the probability and apply the threshold in code.", unless=REPORTING)

asks_model_opinion = _phrase(
    r"\bdo you (?:think|believe|feel|agree|consider)\b|\bin your (?:opinion|view|judge?ment)\b"
    r"|\byour (?:opinion|view|guess|impression)\b|\bwould you say\b",
    "The question is about the model (\"%(found)s\"). Ask about the input instead: what in the field you point at "
    "shows it.")

role_preamble = _phrase(
    r"^\s*(?:you are\b|you're\b|act as\b|pretend\b|imagine you\b|your (?:task|job|role|goal) is\b"
    r"|as an? (?:ai|assistant|expert|language model)\b|i want you to\b|you will be given\b)",
    "A role or task preamble (\"%(found)s\") is chat-model prompting. System One reads one narrow question: ask it "
    "directly, and put the context in the state.", main_only=True)

polite_request = _phrase(
    r"^\s*(?:please\s+)?(?:can|could|would) you\b(?!\s+say\b)|^\s*please\b",
    "Address the input, not the model: drop \"%(found)s\" and ask the question itself, such as \"Does `message` ask "
    "for a refund?\"", main_only=True)

# ---------- text left unfinished ----------

template_variable = _in_any_text(
    r"\{\{\s*[\w.]+\s*\}\}|\$\{\s*[\w.]+\s*\}|(?<![{$\w])\{\s*[A-Za-z_][\w.]*\s*\}(?!\})|%\(\w+\)[sd]"
    r"|<%=?\s*[\w.]+\s*%>|(?<![%\w])%[sd](?!\w)",
    "A template variable (%(found)s) was never filled in, so the model reads it literally. Put the value in the "
    "state and point at it with backticks.", flags=0)

insert_placeholder = _in_any_text(
    r"\[(?:insert|add|enter|put|your|fill in)\b[^\]\n]*\]|<(?:insert|add|enter|your)\b[^>\n]*>|\binsert (?:text )?here\b",
    "Placeholder text (%(found)s) was left in, and the model will read it as part of the question. Replace it with "
    "the real wording.")

lorem_ipsum = _in_any_text(
    r"\blorem ipsum\b|\bdolor sit amet\b",
    "Filler text (%(found)s) was left in, and the model will read it as part of the question. Replace it with the "
    "real wording.")


def _where(qid: str, q: dict, text: str) -> str:
    return "instructions" if text in _instructions(q) else "criteria"


def unbalanced_backticks(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        for text in _instructions(q) + _criteria(q):
            if text.count("`") % 2:
                out.append((qid, "The %s have an odd number of backticks, so a path is left open and the checks "
                                 "cannot see it. Close the backtick." % _where(qid, q, text)))
                break
    return out


def unbalanced_quotes(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        for text in _instructions(q) + _criteria(q):
            straight = re.sub(r"\d\"", "", text).count('"')  # 12" is an inch mark
            if straight % 2 or text.count("“") != text.count("”"):
                out.append((qid, "Quotation marks do not pair up in the %s, so the model cannot tell where quoted "
                                 "text ends. Close the quote." % _where(qid, q, text)))
                break
    return out


def dangling_instruction(state: Any, questions: dict, refs: set) -> List[Finding]:
    # A question may end with a preposition ("Which team is it for"), so only words that cannot end one count. A
    # capital A is a grade or a name ("Is the grade an A"), not an article.
    rx = re.compile(r"(?::|\.\.\.|…|\s[-–—]|\b(?:[Aa]nd|[Oo]r|[Tt]he|[Aa]n|a|[Tt]han))\s*$")
    out = []
    for qid, q in questions.items():
        text = _main(q)
        m = rx.search(text or "")
        if m:
            out.append((qid, "The instructions stop mid-sentence (they end with \"%s\"), so something seems to be "
                             "missing. Finish the question." % m.group(0).strip()))
    return out


# ---------- not a question ----------

def _words(text: str) -> List[str]:
    return re.findall(r"[A-Za-z][\w'-]*", _plain(text))


def label_not_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        text = q.get("instructions")
        if q["type"] not in ASKED or not isinstance(text, str):
            continue
        words = _words(text)
        if words and len(words) <= 3 and words[0].lower() not in OPENERS:
            out.append((qid, "The instructions (\"%s\") read as a label, not a question. Ask what the model should "
                             "judge about which field, such as \"Does `message` ask for a refund?\"" % " ".join(text.split())))
    return out


# Openings of a Noul written without a question mark that still ask yes or no: a question missing its mark ("Is
# `message` spam"), or an instruction ("Decide whether ...", "True if ...").
YES_NO_OPENERS = OPENERS | {"whether", "true", "yes", "answer", "check", "determine", "tell", "say", "return", "mark",
                            "flag", "detect", "identify", "verify", "confirm"}


def noul_not_a_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        text = q.get("instructions")
        if q["type"] != "noul" or not isinstance(text, str) or "?" in _plain(text):
            continue
        words = _words(text)
        if len(words) > 3 and words[0].lower() not in YES_NO_OPENERS:
            out.append((qid, "A Noul answers yes or no, but its instructions are not a question. Phrase them as one "
                             "yes/no question, such as \"Does `message` ask for a refund?\""))
    return out


asks_for_text = _phrase(
    r"^\s*(?:please\s+)?(?:summari[sz]e|write|explain|list|translate|rewrite|describe|generate|extract|draft|compose"
    r"|paraphrase|tell me|give me)\b",
    "The instructions ask the model to \"%(found)s\", but System One returns typed answers, never text. Ask a Choice, "
    "Score or Noul about the input, and produce any text elsewhere.", main_only=True)

asks_for_reasoning = _phrase(
    r"\bstep[- ]by[- ]step\b|\bexplain your (?:reasoning|answer|choice)\b|\bshow your (?:work|reasoning)\b"
    r"|\bthink (?:carefully|hard|it through)\b|\bjustify your\b|\blet'?s think\b|\breason (?:through|carefully)\b",
    "System One answers without written reasoning, so \"%(found)s\" does nothing. Split the reasoning into narrow "
    "questions and combine their answers in code.")

_ANSWER_FORM = {"noul": "a Noul returns the probability of yes", "choice": "a Choice returns one of its options",
                "score": "a Score returns a level position"}


def output_format_request(state: Any, questions: dict, refs: set) -> List[Finding]:
    # Only an order to the model: "Answer with yes or no." opens a sentence, while "Does the agent reply with an
    # offer?" asks about the input.
    rx = re.compile(r"(?:^|[.?!:;,]\s*)(?:please\s+)?(?:(?:answer|respond|reply)\s+(?:with|in|only|using|just)"
                    r"|(?:return|output)\s+(?:only|just|json|a json|as))\b"
                    r"|\byes or no only\b|\bonly (?:answer|reply|respond) (?:with )?(?:yes|no|true|false)\b"
                    r"|\((?:yes|y)\s*/\s*(?:no|n)\)|\((?:true|t)\s*/\s*(?:false|f)\)|\bin (?:one|a single) word\b", re.I)
    out = []
    for qid, q in questions.items():
        m = _first_hit(rx, _instructions(q)) if q["type"] in ASKED else None
        if m:
            found = _said(re.sub(r"^[.?!:;,]\s*", "", m.group(0)))
            out.append((qid, "The form of the answer comes from the question type (%s), so a format request (\"%s\") "
                             "is ignored. Remove it." % (_ANSWER_FORM[q["type"]], found)))
    return out


shouting = _phrase(
    r"\b(?:IMPORTANT|MUST|NEVER|ALWAYS|ONLY|NOTE|CRITICAL|WARNING|DO NOT|DON'T|REMEMBER)\b",
    "Capitals (\"%(found)s\") add no weight for System One. Write the condition plainly, and put cases that must not "
    "be missed in the criteria, with examples.", types=("noul", "choice", "score", "box"), flags=0, keep_case=True)

inline_examples = _phrase(
    r"\be\.g\.|\bfor example\b|\bfor instance\b|\bexamples?:",
    "Examples in the question (\"%(found)s\") blur it. Move them into the criteria, under the answer they "
    "illustrate, or into a field of structured instructions.", main_only=True)


def bulleted_instructions(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        text = _main(q) or ""
        items = re.findall(r"^\s*(?:[-*•]|\d+[.)])\s+\S", text, re.M)
        if len(items) >= 2:
            out.append((qid, "The question holds a list of %d items. Ask one narrow question each, or move the list "
                             "into the criteria or a field of structured instructions." % len(items)))
    return out


depends_on_other_answer = _phrase(
    r"\bthe (?:previous|prior|last|above|earlier|next|other|first) question\b|\bthe question above\b"
    r"|\banswer to the (?:previous|other|first|last|above) question\b"
    r"|\bif you answered\b|\bif the answer (?:above |to \w+ )?(?:is|was)\b|^\s*if (?:yes|no|so|not)\s*,",
    "The question depends on another answer (\"%(found)s\"), but the questions in a request are answered "
    "independently and none sees another's answer. Make it stand on its own, and combine the answers in code.")

positional_reference = _phrase(
    r"\b(?:text|message|email|passage|document|review|content|data|input) (?:below|above)\b"
    r"|\b(?:below|above) (?:text|message|email|passage|document)\b"
    r"|\bthe following (?:text|message|email|passage|document|review|conversation|input|content)\b|\bshown below\b",
    "The question points at text by position (\"%(found)s\"), but the state is a separate input. Point at the field "
    "with backticks, such as `message`.")

def hedged_noul(state: Any, questions: dict, refs: set) -> List[Finding]:
    # Only a hedge in the question's own opening ("Might `message` be spam?", "Is `message` possibly spam?"); one later
    # on is usually what the input says ("Does `message` say the order might be late?").
    rx = re.compile(r"^\s*(?:\S+\s+){0,3}?(maybe|possibly|perhaps|might)\b", re.I)
    out = []
    for qid, q in questions.items():
        text = _main(q)
        m = rx.match(_plain(text)) if q["type"] == "noul" and text else None
        if m:
            out.append((qid, "Hedging (\"%s\") blurs what a yes means, and the probability already says how likely it "
                             "is. Ask the plain question." % m.group(1).lower()))
    return out


def _clock_key(key: str) -> bool:
    words = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", key)
    return any(word.lower() in CLOCK_WORDS for word in words)


def _has_clock(state: Any) -> bool:
    if isinstance(state, dict):
        return any(_clock_key(str(key)) or _has_clock(value) for key, value in state.items())
    if isinstance(state, list):
        return any(_has_clock(value) for value in state)
    return False


def relative_time_without_clock(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"\b(?:tomorrow|yesterday|overdue|last (?:week|month|year)|next (?:week|month|year)"
                    r"|this (?:week|month)|(?:\d+|a few|two|three|several) (?:days|weeks|months) ago|recently)\b", re.I)
    if _has_clock(state):
        return []
    out = []
    for qid, q in questions.items():
        m = _first_hit(rx, _instructions(q), REPORTING) if q["type"] in ASKED else None
        if m:
            out.append((qid, "The question depends on the current date (\"%s\"), which the model does not know. Add "
                             "today's date to the state, as the tool-call-check example does with `today`, and point "
                             "at it." % _said(m.group(0))))
    return out


asks_regex_fact = _phrase(
    r"\b(?:contains?|includes?|has|have|mentions?)\s+(?:an?|any|the)\s+(?:valid\s+)?(?:e-?mail(?: address)?"
    r"|phone number|telephone number|url|web address|zip code|postal code|ip address|credit card number|card number"
    r"|iban|order number|tracking number)\b",
    "Whether text \"%(found)s\" is exact with a regular expression in code. Ask the model only for the judgment "
    "around it, such as whose it is or why it was shared.")

link_in_question = _in_any_text(
    r"https?://\S+|\bwww\.[\w-]+\.\S+",
    "The question holds a link (%(found)s), but the model cannot open links and sees only the address. Put the "
    "content you mean in the state.")


def empty_instruction_field(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        value = q.get("instructions")
        if isinstance(value, dict):
            empty = [str(k) for k, v in value.items() if v in (None, [], {}) or (isinstance(v, str) and not v.strip())]
            if empty:
                out.append((qid, "The structured instructions have an empty field %s. Fill it in or remove it."
                                 % ", ".join("`%s`" % k for k in empty)))
    return out


scale_in_text = _phrase(
    r"\bon a (?:\d+[- ]point )?scale\b|\b(?:rate|score|grade)\b[^.?!]*?\bout of (?:3|4|5|7|10|100)\b|\b\d+\s*-\s*\d+ scale\b"
    r"|\brate (?:it |this |them )?(?:from|between) \d+",
    "The instructions name a numeric scale (\"%(found)s\"), but the answer comes from the question type: a Score "
    "returns a level position from 0, a Noul a probability. Describe the levels in the criteria instead.")

open_ended_list = _phrase(
    r"\betc\b\.?|\band so on\b|\band so forth\b|\bor similar\b|\band the like\b",
    "An open list (\"%(found)s\") leaves the model guessing what else counts. Name every case, or describe the rule "
    "that decides, in the criteria.")

and_or = _in_any_text(
    r"\band/or\b",
    "\"%(found)s\" leaves open whether one is enough or both are needed. Say which, or split it into two questions.")


def unstated_baseline(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"\bthan (?:usual|normal|average|before|typical|last time)\b"
                    r"|\bcompared (?:to|with) (?:usual|normal|average|before|last time)\b", re.I)
    out = []
    for qid, q in questions.items():
        m = _first_hit(rx, _instructions(q)) if q["type"] in ASKED else None
        if m and len(lint._paths(q)) < 2:
            out.append((qid, "The question compares with a baseline (\"%s\") that it does not point at. Put the "
                             "baseline in a state field and point at both, or compare the numbers in code." % _said(m.group(0))))
    return out


def negation_in_choice(state: Any, questions: dict, refs: set) -> List[Finding]:
    # Only when the negation is about the options themselves: "Which team should not handle it?", not "Which
    # product does `message` say did not arrive?"
    rx = re.compile(r"^\s*(?:which|what)\b[^?]*?(?:\b(?:not|never)|n't)\s+(?:apply|applies|fit|fits|match|matches|belong"
                    r"|belongs|handle|handles|describe|describes|cover|covers|suit|suits|relevant|appropriate|right"
                    r"|correct|true)\b", re.I)
    out = []
    for qid, q in questions.items():
        text = _main(q)
        if q["type"] == "choice" and text and rx.search(_plain(text)):
            out.append((qid, "A Choice picks the option that fits best, so asking which does not apply inverts it and "
                             "its probabilities. Ask which option fits, and handle exclusions in code."))
    return out


asks_to_rank = _phrase(
    r"^\s*(?:rank|prioriti[sz]e)\b|\brank (?:these|them|the)\b|\bfrom (?:best|most|highest) to (?:worst|least|lowest)\b",
    "Ranking (\"%(found)s\") is work for code. Ask the same Score or Noul about each item, then sort by the answers.")


def _rule(ident: str, title: str, check, level: str = "advice", anchor: str = STRUCTURE) -> dict:
    return {"id": ident, "kind": "lint_rule", "title": title, "level": level, "check": check, "anchor": anchor}


PACK = kit.define_pack({
    "id": "lint-wording",
    "surface": "python.lint",
    "title": "Wording of instructions",
    "about": "Question checks on how instructions are worded: vague or loaded words, negations, work that belongs in "
             "code, questions about the future or the model, and text left unfinished.",
    "features": [
        _rule("vague_amount", "Vague amounts such as \"several\" or \"a few\" in the instructions", vague_amount),
        _rule("degree_in_noul", "A Noul that asks about a degree (\"very\", \"extremely\") a Score would measure", degree_in_noul),
        _rule("negated_noul", "A Noul asked in the negative (\"Doesn't ...\", \"Is it not ...\")", negated_noul),
        _rule("double_negative", "Two negatives in one clause of the instructions", double_negative),
        _rule("leading_question", "Leading wording that suggests the expected answer", leading_question),
        _rule("noul_open_question", "A Noul that opens with what/which/who/how and cannot be answered yes or no", noul_open_question),
        _rule("asks_count", "Instructions that ask the model to count", asks_count, anchor=DECOMPOSE),
        _rule("asks_arithmetic", "Instructions that ask the model to calculate", asks_arithmetic, anchor=DECOMPOSE),
        _rule("asks_date_math", "Instructions that ask for date arithmetic", asks_date_math, anchor=DECOMPOSE),
        _rule("asks_length", "Instructions that ask about text length in words or characters", asks_length, anchor=DECOMPOSE),
        _rule("numeric_comparison", "A comparison with a written number (\"more than $100\") that code does exactly", numeric_comparison, anchor=DECOMPOSE),
        _rule("future_question", "A question about what will happen in the future", future_question),
        _rule("asks_model_confidence", "Instructions that ask the model for its confidence or a probability", asks_model_confidence),
        _rule("asks_model_opinion", "Instructions that ask for the model's own opinion", asks_model_opinion),
        _rule("role_preamble", "A chat-style role preamble (\"You are ...\", \"Act as ...\")", role_preamble),
        _rule("polite_request", "Instructions addressed to the model (\"Can you ...\", \"Please ...\")", polite_request),
        _rule("template_variable", "An unfilled template variable such as {{name}}, ${name} or {name}", template_variable, level="problem", anchor=STATE),
        _rule("insert_placeholder", "\"[insert ...]\" placeholder text left in", insert_placeholder, level="problem"),
        _rule("lorem_ipsum", "Lorem ipsum filler left in instructions or criteria", lorem_ipsum, level="problem"),
        _rule("unbalanced_backticks", "An odd number of backticks, which leaves a path open", unbalanced_backticks, level="problem", anchor=STATE),
        _rule("unbalanced_quotes", "Quotation marks that do not pair up", unbalanced_quotes),
        _rule("dangling_instruction", "Instructions that stop mid-sentence (a trailing colon, ellipsis or \"and\")", dangling_instruction),
        _rule("label_not_question", "Instructions that are only a short label, not a question", label_not_question),
        _rule("noul_not_a_question", "A Noul whose instructions are a statement, not a yes/no question", noul_not_a_question),
        _rule("asks_for_text", "Instructions that ask for generated text (summarize, write, explain, list)", asks_for_text),
        _rule("asks_for_reasoning", "Instructions that ask for step-by-step reasoning", asks_for_reasoning, anchor=DECOMPOSE),
        _rule("output_format_request", "Instructions that ask for an answer format the question type already fixes", output_format_request),
        _rule("shouting", "Emphasis in capitals (IMPORTANT, MUST, NEVER)", shouting),
        _rule("inline_examples", "Examples written into the question itself instead of the criteria", inline_examples),
        _rule("bulleted_instructions", "A question that holds a bulleted or numbered list", bulleted_instructions, anchor=DECOMPOSE),
        _rule("depends_on_other_answer", "A question that depends on another question's answer", depends_on_other_answer, anchor=DECOMPOSE),
        _rule("positional_reference", "Text pointed at by position (\"the text below\") instead of by field", positional_reference, anchor=STATE),
        _rule("hedged_noul", "A Noul hedged with maybe, possibly, perhaps or might", hedged_noul),
        _rule("relative_time_without_clock", "Relative dates (tomorrow, overdue, last week) with no date in the state", relative_time_without_clock, anchor=STATE),
        _rule("asks_regex_fact", "Asking whether text contains an email, phone number or URL, which a regex decides", asks_regex_fact, anchor=DECOMPOSE),
        _rule("link_in_question", "A web link in instructions or criteria, which the model cannot open", link_in_question, anchor=STATE),
        _rule("empty_instruction_field", "An empty field in structured instructions", empty_instruction_field),
        _rule("scale_in_text", "A numeric scale (\"on a scale of 1 to 10\") written into the instructions", scale_in_text),
        _rule("open_ended_list", "An open-ended list (\"etc.\", \"and so on\") in the instructions", open_ended_list),
        _rule("and_or", "\"and/or\", which leaves open whether one or both are needed", and_or, anchor=DECOMPOSE),
        _rule("unstated_baseline", "A comparison with a baseline (\"than usual\") the question does not point at", unstated_baseline, anchor=STATE),
        _rule("negation_in_choice", "A Choice that asks which option does not apply", negation_in_choice),
        _rule("asks_to_rank", "Instructions that ask the model to rank or prioritize", asks_to_rank, anchor=DECOMPOSE),
    ],
})
