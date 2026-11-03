"""Reviews: read a public review of Harbor Coffee Co., then let code decide what happens to it.

One request asks six questions about the review's text: its topic, how serious the problem is, its
tone, whether it reports a safety or health risk, whether the reviewer wants a reply, and whether
it is about Harbor Coffee Co. at all. Code owns everything else: the team each topic goes to, the
priority cuts, the rating-mismatch arithmetic, and the action. Changing the policy re-decides from
the same answers without a new call.

The star rating stays out of the request. The tone question is judged from the words alone, and
code compares that tone with the stars; if the model saw the stars, the comparison could measure
the rating against itself.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .client import JevClient, choice, chosen, noul, ranked, score

SHOP = "Harbor Coffee Co., a small coffee roaster with two cafés, an online shop, an app, and a bean subscription"
MAX_TEXT = 2000

DEFAULT_POLICY = {
    "safety_at": 0.50,       # at or above: the review reports a safety or health risk; escalate
    "about_us_min": 0.50,    # below: spam, an ad, or another business; hold for moderation
    "wants_reply_at": 0.50,  # at or above: the reviewer asked for a reply, refund, or contact
    "p1_at": 2.0,            # severity score at or above this is P1
    "p2_at": 1.0,            # severity score at or above this is P2 and gets a person's reply
    "mismatch_gap": 2.0,     # tone and stars this many levels apart flag a rating mismatch
    "thank_tone_at": 3.0,    # tone score at or above this may get the thank-you template
}

CHANNELS = {"website": "Website review", "app": "App store review", "maps": "Map listing"}

TOPICS = {
    "roast_flavor": "How the coffee tastes: roast level, flavor, bitterness, acidity, or strength",
    "freshness": "How fresh the beans or grounds are: stale, past the roast date, flat, or without aroma",
    "packaging_shipping": "The parcel or packaging: torn bags, broken seals, leaks, crushed boxes, or wrong items packed",
    "delivery_timing": "When an order arrived: late, lost, or slower than the shipping promised",
    "cafe_service": "A visit to a Harbor Coffee café: staff, waiting, drinks made there, food, seating, or cleanliness",
    "subscription_billing": "Charges and the bean subscription: double charges, renewals, cancellations, or refunds owed",
    "equipment": "Grinders, brewers, kettles, or other gear the shop sells, and whether it works",
    "other": "Anything else, such as the website, the app, or a review that is not about the shop",
}

TEAMS = {
    "quality_safety": "Quality & safety",
    "moderation": "Moderation",
    "roasting": "Roasting",
    "fulfillment": "Fulfillment",
    "cafes": "Cafés",
    "billing": "Billing",
    "equipment_support": "Equipment support",
    "customer_care": "Customer care",
}

# Which team owns each topic. Plain code: change a route here, not in a question.
TOPIC_TEAM = {
    "roast_flavor": "roasting",
    "freshness": "roasting",
    "packaging_shipping": "fulfillment",
    "delivery_timing": "fulfillment",
    "cafe_service": "cafes",
    "subscription_billing": "billing",
    "equipment": "equipment_support",
    "other": "customer_care",
}

ACTIONS = {
    "escalate": "Escalate to quality & safety",
    "moderate": "Hold for moderation",
    "reply": "A person replies",
    "thank": "Thank-you template",
    "log": "Log only",
}

SEVERITY = [
    "No problem: praise, a neutral remark, or nothing that went wrong",
    "Minor annoyance: something was off, but it cost the customer little or nothing",
    "Real problem: it cost the customer money, time, or product they paid for",
    "Safety or health risk: an injury, burn, illness, allergic reaction, or foreign object",
]

TONE = [
    "Very negative: angry, furious, or disgusted",
    "Negative: disappointed or unhappy",
    "Mixed or neutral: neither pleased nor unhappy overall",
    "Positive: pleased or satisfied",
    "Very positive: delighted or enthusiastic",
]

# Sample reviews for the page and for scripts/validate.py. `expect` is what a person would decide.
EXAMPLES = [
    {"label": "Glowing praise", "stars": 5, "channel": "maps", "about": "Pier Street café",
     "text": "Best flat white in town. The barista remembered my name on my second visit and the almond "
             "croissant was still warm from the oven. Already planning to come back on Saturday.",
     "expect": {"action": "thank", "team": "cafes", "flags": []}},
    {"label": "Stale beans", "stars": 2, "channel": "website", "about": "Harbor House Blend, 340 g bag",
     "text": "The bag that came last week says it was roasted almost three months ago. Flat, papery taste and "
             "no crema at all, so I poured most of it out. Could you send a fresh bag to replace it?",
     "expect": {"action": "reply", "team": "roasting", "flags": []}},
    {"label": "Burned hand", "stars": 1, "channel": "app", "about": "Pier Street café",
     "text": "The lid on my takeaway latte wasn't pressed on, and it popped off as the barista handed it to me. "
             "Hot milk went all over my hand and I now have a blister the size of a coin.",
     "expect": {"action": "escalate", "team": "quality_safety", "flags": ["safety"]}},
    {"label": "5 stars, furious", "stars": 5, "channel": "website", "about": "Harbor Burr Grinder",
     "text": "Total waste of $180. The burrs started squealing after one week, and now it grinds half powder, "
             "half gravel. Cheapest-feeling grinder I have ever owned. Do not buy this.",
     "expect": {"action": "reply", "team": "equipment_support", "flags": ["rating_mismatch"]}},
    {"label": "1 star, loves it", "stars": 1, "channel": "maps", "about": "Ethiopia Guji, 250 g bag",
     "text": "Honestly the best coffee I've had all year. Bright, berry-like, and sweet, even as a plain "
             "filter. I'll be ordering it again.",
     "expect": {"action": "reply", "team": "roasting", "flags": ["rating_mismatch"]}},
    {"label": "Spam", "stars": 5, "channel": "maps", "about": "Pier Street café",
     "text": "Cracked phone screen? Quickfix Phones on Elm Road replaces screens while you wait. 50% off this "
             "week only at quickfix.example!",
     "expect": {"action": "moderate", "team": "moderation", "flags": ["not_about_us"]}},
    {"label": "Late delivery", "stars": 2, "channel": "website", "about": "Holiday Gift Box",
     "text": "Ordered on the 2nd with three-day shipping so it would arrive for my sister's birthday on the 8th. "
             "It turned up on the 14th, a week after the party. The coffee itself is fine.",
     "expect": {"action": "reply", "team": "fulfillment", "flags": []}},
    {"label": "Double charge", "stars": 1, "channel": "app", "about": "Monthly bean subscription",
     "text": "I was charged twice for my October subscription box, $24 each time, and only one box arrived. "
             "Please refund the second charge.",
     "expect": {"action": "reply", "team": "billing", "flags": []}},
]


def questions() -> Dict[str, dict]:
    """Six judgments about the review's text. Every rule that uses them lives in triage()."""
    return {
        "topic": choice("What is `review.text` mainly about?", TOPICS),
        "severity": score("How serious is the problem that `review.text` describes?", SEVERITY),
        "tone": score("How does `review.text` feel about Harbor Coffee Co., judged from its words alone?", TONE),
        "safety": noul(
            "Does `review.text` report that someone was hurt or made ill, or that a product contained something harmful?",
            yes={"what": "The review reports an injury, burn, illness, allergic reaction, or foreign object",
                 "examples": ["a burn from a loose lid", "a reaction to an unlisted nut", "glass or plastic in a bag of beans"]},
            no={"what": "Nobody was hurt and nothing harmful was found",
                "examples": ["stale or bitter coffee", "a late parcel", "a rude barista", "a double charge"]}),
        "wants_reply": noul(
            "Does the writer of `review.text` ask Harbor Coffee Co. for a reply, refund, replacement, or contact?",
            yes={"what": "The reviewer asks for something back from the shop",
                 "examples": ["please refund me", "send a fresh bag", "can someone call me", "I'd like an answer"]},
            no={"what": "The reviewer only shares an opinion or experience",
                "examples": ["best latte in town", "too bitter for me", "it arrived late"]}),
        "about_us": noul(
            "Is `review.text` about Harbor Coffee Co.'s own coffee, cafés, shop, or service?",
            yes={"what": "The review is about something Harbor Coffee Co. sells or does",
                 "examples": ["a bag of its beans", "a visit to one of its cafés", "its subscription", "its delivery"]},
            no={"what": "Spam, an advert, or a review of a different business",
                "examples": ["a link to another shop", "a review of a different café", "a giveaway or promotion"]}),
    }


def clean_review(raw: Any) -> dict:
    """The review as code uses it. ValueError when it cannot be triaged."""
    if not isinstance(raw, dict):
        raise ValueError("review must be an object with stars, channel, and text.")
    stars = raw.get("stars")
    if isinstance(stars, bool) or not isinstance(stars, (int, float)) or stars != int(stars) or not 1 <= stars <= 5:
        raise ValueError("stars must be a whole number from 1 to 5.")
    channel = raw.get("channel")
    if channel not in CHANNELS:
        raise ValueError("channel must be one of: %s." % ", ".join(CHANNELS))
    text = raw.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Write or pick a review first.")
    if len(text) > MAX_TEXT:
        raise ValueError("A review can be at most %d characters." % MAX_TEXT)
    about = raw.get("about")
    if about is not None and not isinstance(about, str):
        raise ValueError("about must be text.")
    return {"stars": int(stars), "channel": channel, "about": (about or "").strip()[:200], "text": text.strip()}


def state_for(review: dict) -> dict:
    """What the model reads. The stars stay in code: see the module docstring."""
    item = {"channel": CHANNELS[review["channel"]], "text": review["text"]}
    if review.get("about"):
        item["about"] = review["about"]
    return {"shop": SHOP, "review": item}


def check_answers(answers: Any) -> Dict[str, dict]:
    """ValueError unless `answers` has every Reviews answer in the shape triage() reads."""
    if not isinstance(answers, dict):
        raise ValueError("answers must be an object.")
    for qid, q in questions().items():
        a = answers.get(qid)
        if not isinstance(a, dict):
            raise ValueError("answers.%s is missing." % qid)
        if q["type"] == "choice":
            if a.get("choice") not in TOPICS or not isinstance(a.get("probabilities", {}), dict):
                raise ValueError("answers.%s must choose one of: %s." % (qid, ", ".join(TOPICS)))
        else:
            field = "score" if q["type"] == "score" else "noul"
            value = a.get(field)
            top = len(q["criteria"]) - 1 if q["type"] == "score" else 1
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= top:
                raise ValueError("answers.%s.%s must be a number from 0 to %d." % (qid, field, top))
    return answers


def _num(policy: Optional[dict], key: str) -> float:
    value = (policy or {}).get(key, DEFAULT_POLICY[key])
    try:
        return float(value)
    except (TypeError, ValueError):
        return DEFAULT_POLICY[key]


def full_policy(policy: Optional[dict] = None) -> dict:
    return {k: _num(policy, k) for k in DEFAULT_POLICY}


def evidence(answers: Dict[str, dict]) -> dict:
    """The judgments as plain numbers."""
    topic, topic_prob = chosen(answers["topic"])
    return {
        "topic": topic,
        "topic_prob": topic_prob,
        "topics": ranked(answers["topic"], 3),
        "severity": float(answers["severity"]["score"]),
        "tone": float(answers["tone"]["score"]),
        "safety": float(answers["safety"]["noul"]),
        "wants_reply": float(answers["wants_reply"]["noul"]),
        "about_us": float(answers["about_us"]["noul"]),
    }


def rating_gap(tone: float, stars: int) -> float:
    """How many levels the words' tone (0-4) sits from the stars, mapped 1-5 -> 0-4."""
    return abs(tone - (stars - 1))


def priority(severity: float, policy: Optional[dict] = None) -> str:
    if severity >= _num(policy, "p1_at"):
        return "P1"
    if severity >= _num(policy, "p2_at"):
        return "P2"
    return "P3"


def _check(cid: str, ok: bool, level: str, label: str, detail: str) -> dict:
    return {"id": cid, "ok": ok, "level": "ok" if ok else level, "label": label, "detail": detail}


def _pct(p: float) -> str:
    return "%.0f%%" % (p * 100)


def triage(answers: Dict[str, dict], review: dict, policy: Optional[dict] = None) -> dict:
    """Pure policy: answers plus the review's stars -> action, team, priority, and flags. No model call."""
    ev = evidence(answers)
    stars = int(review["stars"])
    gap = rating_gap(ev["tone"], stars)
    pri = priority(ev["severity"], policy)
    checks: List[dict] = []
    flags: List[str] = []

    def done(action: str, team: str, prio: str, reasons: List[str]) -> dict:
        return {"action": action, "action_label": ACTIONS[action], "team": team, "team_label": TEAMS[team],
                "priority": prio, "flags": flags, "checks": checks, "reasons": reasons,
                "auto_reply_allowed": action == "thank", "evidence": dict(ev, stars=stars, rating_gap=gap)}

    safety_at = _num(policy, "safety_at")
    unsafe = ev["safety"] >= safety_at
    checks.append(_check("safety", not unsafe, "escalate", "No safety or health risk",
                         "%s that it reports an injury, illness, or foreign object (escalate at %s)"
                         % (_pct(ev["safety"]), _pct(safety_at))))
    if unsafe:
        flags.append("safety")
        return done("escalate", "quality_safety", "P1", [
            "Reports a safety or health risk: escalated as P1 to quality & safety, and no public reply until "
            "a person has looked at it"])

    about_min = _num(policy, "about_us_min")
    ours = ev["about_us"] >= about_min
    checks.append(_check("about_us", ours, "moderate", "About Harbor Coffee Co.",
                         "%s that it is about the shop (hold below %s)" % (_pct(ev["about_us"]), _pct(about_min))))
    if not ours:
        flags.append("not_about_us")
        return done("moderate", "moderation", pri, [
            "Looks like spam, an advert, or another business: held for a person to moderate, with no reply"])

    team = TOPIC_TEAM[ev["topic"]]
    checks.append(_check("topic", True, "", "Routed by topic", "%s (%s) goes to %s"
                         % (ev["topic"].replace("_", " "), _pct(ev["topic_prob"]), TEAMS[team])))

    p1, p2 = _num(policy, "p1_at"), _num(policy, "p2_at")
    serious = ev["severity"] >= p2
    checks.append(_check("severity", not serious, "reply", "No real problem reported",
                         "Severity %.2f of 3 is %s (P1 at %.1f, P2 at %.1f)" % (ev["severity"], pri, p1, p2)))

    reply_at = _num(policy, "wants_reply_at")
    asks = ev["wants_reply"] >= reply_at
    checks.append(_check("wants_reply", not asks, "reply", "No reply requested",
                         "%s that the reviewer asks for a reply, refund, or contact (reply at %s)"
                         % (_pct(ev["wants_reply"]), _pct(reply_at))))

    gap_at = _num(policy, "mismatch_gap")
    mismatch = gap >= gap_at
    checks.append(_check("rating", not mismatch, "reply", "Stars match the words",
                         "%d stars sit at level %d; the words read %.2f of 4, %.2f levels apart (flag at %.1f)"
                         % (stars, stars - 1, ev["tone"], gap, gap_at)))
    if mismatch:
        flags.append("rating_mismatch")

    if asks or serious or mismatch:
        why = []
        if asks:
            why.append("the reviewer asks for a reply")
        if serious:
            why.append("severity %.2f is at or above the P2 cut" % ev["severity"])
        if mismatch:
            why.append("the stars and the words disagree")
        return done("reply", team, pri, ["A person replies: " + "; ".join(why)])

    thank_at = _num(policy, "thank_tone_at")
    positive = ev["tone"] >= thank_at
    checks.append(_check("positive", positive, "info", "Positive enough to thank",
                         "Tone %.2f of 4 (thank-you template at %.1f)" % (ev["tone"], thank_at)))
    if positive:
        return done("thank", team, pri, ["Positive, low severity, nothing flagged: the thank-you template may be posted"])
    return done("log", team, pri, ["Nothing to act on: logged for %s" % TEAMS[team]])


def check_policy(policy: Any) -> Optional[dict]:
    if policy is not None and not isinstance(policy, dict):
        raise ValueError("policy must be an object.")
    return policy


def check(client: JevClient, review: Any, policy: Optional[dict] = None) -> dict:
    """One live call: the review questions, then code applies the policy."""
    review = clean_review(review)
    policy = check_policy(policy)
    result = client.system_one(state_for(review), questions())
    return {
        "review": review,
        "answers": result.answers,
        "triage": triage(result.answers, review, policy),
        "policy": full_policy(policy),
        "meta": result.meta(),
        "trace": result.trace(),
    }


def redecide(answers: Any, review: Any, policy: Optional[dict] = None) -> dict:
    """Apply a changed policy to existing answers. Pure code: no Jev call."""
    policy = check_policy(policy)
    answers = check_answers(answers)
    review = clean_review(review)
    return {"triage": triage(answers, review, policy), "policy": full_policy(policy)}
