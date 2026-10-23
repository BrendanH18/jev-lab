"""Claims: judge a customer's damage photo, then let code decide the refund.

One request asks five questions about the photo and one Box question that locates the damage.
Code owns everything else: the order lookup, the refund window, the dollar limit for automatic
approval, and the final decision. Changing the policy reuses the same answers without a new call.

Images and Box are "dreamer-ready" TypeSafe features (https://docs.typesafe.ai/images). Box needs
Jev 1.14; on an older model the request leaves the Box question out.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from . import images
from .client import JevClient, box, choice, chosen, noul, ranked, score, supports_box
from .world import REFUND_WINDOW_DAYS, World

DEFAULT_POLICY = {
    "damage_yes": 0.70,     # at or above: the photo shows damage
    "damage_no": 0.30,      # below: the photo shows no damage; ask for another photo
    "shows_order": 0.50,    # below: the photo may show something else
    "matches_note": 0.50,   # below: the photo does not show what the customer describes
    "full_refund_at": 1.5,  # severity score at or above this earns a full refund
    "auto_limit_usd": 100.0,  # larger refunds always go to a person
    "box_confidence": 0.60,  # below: pad the box before showing or cropping it
}
BOX_PAD = 0.05

DAMAGE_KINDS = {
    "torn_or_open": "A bag, seal, or wrapper is torn, split, or open",
    "crushed_or_dented": "A box or item is crushed, dented, or bent",
    "broken_or_cracked": "Something is cracked, shattered, or snapped",
    "spilled_or_leaking": "Contents have spilled out or liquid has leaked",
    "none_visible": "No damage is visible",
}

# Sample claims for the page and for scripts/validate.py. `expect` is what a person would decide.
EXAMPLES = [
    {"label": "Torn bag", "order": "A-1041", "sample": "torn-bag", "expect": "approve",
     "note": "One bag's seal was torn open and beans spilled all over the box."},
    {"label": "Intact bag", "order": "A-1041", "sample": "intact-bag", "expect": "retake",
     "note": "The bag arrived ripped and half the beans fell out."},
    {"label": "Crushed box", "order": "A-1044", "sample": "crushed-box", "expect": "review",
     "note": "The kit's box came crushed on one corner."},
    {"label": "Grinder", "order": "A-1042", "sample": "grinder-ok", "expect": "retake",
     "note": "The grinder's hopper arrived cracked."},
]

SEVERITY = [
    "None: no visible damage",
    "Cosmetic: packaging is scuffed or dented but the product looks usable",
    "Partial: part of the product is spilled, broken, or unusable",
    "Total: the product is destroyed or entirely unusable",
]


def questions(item: str = "the item described in `order.items`", note: str = "`customer_note`",
              photo: str = "`photo`", with_box: bool = True) -> Dict[str, dict]:
    """The photo questions. Autopilot reuses them with the email standing in for the order and note."""
    qs = {
        "shows_item": noul(
            "Does %s show %s, or the packaging it was shipped in?" % (photo, item),
            yes="The product or its shipping packaging is visible",
            no="The photo shows something unrelated, or nothing recognizable"),
        "damage_visible": noul(
            "Does %s show visible damage to the product or its packaging?" % photo,
            yes={"what": "Damage is visible", "examples": ["a torn bag with beans spilling out", "a crushed box corner",
                                                           "a cracked glass part", "a leak or stain"]},
            no={"what": "Everything visible looks intact", "examples": ["a sealed, undamaged bag",
                                                                         "a machine with no cracks or dents"]}),
        "severity": score("How badly damaged is the product in %s?" % photo, SEVERITY),
        "damage_kind": choice("What kind of damage does %s show?" % photo, DAMAGE_KINDS),
        "matches_note": noul(
            "Does %s show the problem described in %s?" % (photo, note),
            yes="The photo shows the same kind of problem the text describes",
            no="The photo shows a different problem, or no problem"),
    }
    if with_box:
        qs["damage_box"] = box("the most visibly damaged part of the product or its packaging in %s" % photo)
    return qs


def state_for(order_id: str, order: dict, note: str, ref: str) -> dict:
    return {
        "shop": "Harbor Coffee Co., a small coffee roaster",
        "order": {"id": order_id, "items": order["items"]},
        "customer_note": note,
        "photo": ref,
    }


def order_facts(world: World, order_id: str) -> dict:
    """Deterministic facts about the order. No model involved."""
    order = world.state["orders"].get(order_id)
    if order is None:
        raise ValueError("Unknown order %s" % order_id)
    return {
        "order": order_id,
        "items": order["items"],
        "total": order["total"],
        "status": order["status"],
        "refunded": order["refunded"],
        "days_since_delivery": world.days_since_delivery(order_id),
        "customer": world.state["customers"][order["customer"]]["name"],
    }


def _num(policy: Optional[dict], key: str) -> float:
    value = (policy or {}).get(key, DEFAULT_POLICY[key])
    try:
        return float(value)
    except (TypeError, ValueError):
        return DEFAULT_POLICY[key]


def evidence(answers: Dict[str, dict]) -> dict:
    """The photo judgments as plain numbers, for code and for Dispatch's refund check."""
    kind, kind_prob = chosen(answers["damage_kind"])
    return {
        "shows_item": float(answers["shows_item"]["noul"]),
        "damage": float(answers["damage_visible"]["noul"]),
        "severity": float(answers["severity"]["score"]),
        "kind": kind,
        "kind_prob": kind_prob,
        "kinds": ranked(answers["damage_kind"], 3),
        "matches_note": float(answers["matches_note"]["noul"]),
    }


def located(answers: Dict[str, dict], ev: dict, policy: Optional[dict] = None) -> dict:
    """The Box answer, hidden when the photo shows no damage. A Box always returns four edges.

    Between `damage_no` and `damage_yes` the claim goes to a person, so the box is shown as a
    tentative hint for them rather than as located damage."""
    answer = answers.get("damage_box")
    if not answer:
        return {"shown": False, "reason": "This model does not answer Box questions (Jev 1.14+ needed)."}
    edges = {k: float(answer["box"][k]) for k in ("left", "top", "right", "bottom")}
    confidence = float(answer.get("confidence", 0.0))
    if ev["damage"] < _num(policy, "damage_no"):
        return {"shown": False, "box": edges, "confidence": confidence,
                "reason": "Hidden: the photo shows no damage, so there is nothing to locate."}
    padded = confidence < _num(policy, "box_confidence")
    if padded:
        edges = {"left": max(0.0, edges["left"] - BOX_PAD), "top": max(0.0, edges["top"] - BOX_PAD),
                 "right": min(1.0, edges["right"] + BOX_PAD), "bottom": min(1.0, edges["bottom"] + BOX_PAD)}
    tentative = ev["damage"] < _num(policy, "damage_yes")
    reasons = []
    if tentative:
        reasons.append("Tentative: damage is uncertain (%.0f%%), so this only shows a reviewer where to look."
                       % (ev["damage"] * 100))
    if padded:
        reasons.append("Padded by %d%% on each side: confidence %.0f%% is below %.0f%%."
                       % (BOX_PAD * 100, confidence * 100, _num(policy, "box_confidence") * 100))
    return {"shown": True, "box": edges, "confidence": confidence, "padded": padded, "tentative": tentative,
            "reason": " ".join(reasons) or None}


def _check(cid: str, ok: bool, level: str, label: str, detail: str) -> dict:
    return {"id": cid, "ok": ok, "level": "ok" if ok else level, "label": label, "detail": detail}


def decide(ev: dict, facts: dict, policy: Optional[dict] = None) -> dict:
    """Pure policy: photo evidence plus order facts -> approve, review, retake, or reject."""
    checks: List[dict] = []
    days = facts.get("days_since_delivery")
    checks.append(_check("not_refunded", not facts["refunded"], "reject", "Not already refunded",
                         "Already refunded" if facts["refunded"] else "No previous refund"))
    if facts["status"] != "delivered":
        checks.append(_check("delivered", False, "reject", "Order was delivered",
                             "Order is %s; damage claims start after delivery" % facts["status"]))
    else:
        checks.append(_check("window", days <= REFUND_WINDOW_DAYS, "review",
                             "Within %d-day window" % REFUND_WINDOW_DAYS, "Delivered %d days ago" % days))

    shows = ev["shows_item"] >= _num(policy, "shows_order")
    checks.append(_check("shows_item", shows, "retake", "Photo shows the order",
                         "%.0f%% that the photo shows this item or its packaging" % (ev["shows_item"] * 100)))
    if ev["damage"] >= _num(policy, "damage_yes"):
        checks.append(_check("damage", True, "", "Damage visible", "%.0f%% that damage is visible" % (ev["damage"] * 100)))
    elif ev["damage"] < _num(policy, "damage_no"):
        checks.append(_check("damage", False, "retake", "Damage visible",
                             "Only %.0f%% that damage is visible" % (ev["damage"] * 100)))
    else:
        checks.append(_check("damage", False, "review", "Damage visible",
                             "%.0f%% is between the retake and approve thresholds" % (ev["damage"] * 100)))
    checks.append(_check("matches_note", ev["matches_note"] >= _num(policy, "matches_note"), "review",
                         "Matches the customer's description",
                         "%.0f%% that the photo shows the problem described" % (ev["matches_note"] * 100)))

    full = ev["severity"] >= _num(policy, "full_refund_at")
    remedy = "full_refund" if full else "replacement_or_credit"
    amount = facts["total"] if full else round(facts["total"] / 2, 2)
    limit = _num(policy, "auto_limit_usd")
    checks.append(_check("auto_limit", amount <= limit, "review", "Within the automatic limit",
                         "$%.2f against a $%.2f limit" % (amount, limit)))

    failing = [c for c in checks if not c["ok"]]
    if any(c["level"] == "reject" for c in failing):
        decision = "reject"
    elif any(c["level"] == "retake" for c in failing):
        decision = "retake"
    elif failing:
        decision = "review"
    else:
        decision = "approve"
    reasons = [c["detail"] for c in failing] or [
        "Damage is visible and matches the note; %s of $%.2f is within the automatic limit"
        % ("full refund" if full else "50% credit", amount)]
    return {"decision": decision, "remedy": remedy, "amount": amount, "checks": checks, "reasons": reasons}


def check(client: JevClient, world: World, order_id: str, note: str, image: dict,
          policy: Optional[dict] = None) -> dict:
    """One live call: the photo questions, then code applies the policy."""
    facts = order_facts(world, order_id)
    ref = images.new_ref(image["data"], "photo")
    with_box = supports_box(client.model)
    state = state_for(order_id, world.state["orders"][order_id], note.strip()[:2000], ref)
    result = client.system_one(state, questions(with_box=with_box), assets={ref: image})
    ev = evidence(result.answers)
    return {
        "answers": result.answers,
        "evidence": ev,
        "facts": facts,
        "location": located(result.answers, ev, policy),
        "verdict": decide(ev, facts, policy),
        "policy": dict(DEFAULT_POLICY, **{k: _num(policy, k) for k in DEFAULT_POLICY}),
        "box_supported": with_box,
        "image": {k: image[k] for k in ("format", "width", "height", "bytes") if k in image},
        "meta": result.meta(),
        "trace": result.trace(),
    }


def redecide(answers: Dict[str, dict], facts: dict, policy: Optional[dict] = None) -> dict:
    """Apply a changed policy to existing answers. Pure code: no Jev call."""
    ev = evidence(answers)
    return {"evidence": ev, "location": located(answers, ev, policy), "verdict": decide(ev, facts, policy),
            "policy": dict(DEFAULT_POLICY, **{k: _num(policy, k) for k in DEFAULT_POLICY})}
