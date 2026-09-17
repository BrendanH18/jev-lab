"""Dispatch: natural language -> typed function calls, gated by confidence and policy.

One Jev request carries the choice of action *and* every action's arguments (speculative
fan-out). Code reads only the chosen action's answers, resolves exact values (amounts,
times, invoices, dates) itself, runs policy checks, and decides whether to execute, ask
for confirmation, ask for clarification, or refuse.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from .client import choice, chosen, ranked, score
from .world import TEMPLATES, WEEKDAYS, World, REFUND_WINDOW_DAYS

TOOLS = {
    "refund_order": {
        "label": "Refund an order", "risk": "medium", "threshold": 0.80,
        "about": "Give a customer money back for an order: refund, reimburse, or credit back",
    },
    "reschedule_meeting": {
        "label": "Reschedule a meeting", "risk": "medium", "threshold": 0.75,
        "about": "Move an existing calendar meeting to a different day or time",
    },
    "pay_vendor": {
        "label": "Pay a vendor", "risk": "high", "threshold": 0.90,
        "about": "Send money to a supplier or service provider, such as paying an invoice or bill",
    },
    "create_task": {
        "label": "Create a task", "risk": "low", "threshold": 0.50,
        "about": "Add a to-do for the team: fix, book, order, clean, follow up on, or look into something",
    },
    "send_info": {
        "label": "Send standard info", "risk": "low", "threshold": 0.50,
        "about": "Answer a customer's question with standard information: shipping times, returns and "
        "refund policy, wholesale pricing, subscription help, or a brewing guide",
    },
    "none": {
        "label": "No action", "risk": "none", "threshold": 0.0,
        "about": "None of these: a thank-you, feedback with no request, a newsletter or promotion, "
        "or something the shop assistant cannot do",
    },
}

REFUND_REASONS = {
    "damaged": "Arrived broken, torn, leaking, stale, or spoiled",
    "wrong_item": "A different product than the one ordered arrived",
    "not_delivered": "The order never arrived or was lost in transit",
    "changed_mind": "Nothing is wrong with it; they no longer want it or ordered by mistake",
    "not_stated": "No reason for the refund is given",
}

TASK_AREAS = {
    "roasting": "Roasting, green coffee, and roast quality",
    "equipment": "Repairs and maintenance of machines: roaster, grinders, espresso machines, fans",
    "shipping": "Packing, labels, carriers, and deliveries",
    "wholesale": "Cafe and business accounts",
    "marketing": "Website, social media, newsletters, and promotions",
    "admin": "Bookkeeping, scheduling, and anything else",
}

PRIORITY_LEVELS = [
    "Low: whenever someone has time",
    "Normal: should happen within the week",
    "Urgent: today, because it blocks sales, shipping, or safety",
]

AMOUNT_RE = re.compile(
    r"\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?|\b(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(?:dollars|usd)\b",
    re.IGNORECASE,
)
TIME_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday)\b",
                     re.IGNORECASE)


# --- deterministic candidate finding ------------------------------------------------------


def find_amounts(text: str) -> List[dict]:
    seen, out = set(), []
    for m in AMOUNT_RE.finditer(text):
        whole = (m.group(1) or m.group(3) or "").replace(",", "")
        frac = m.group(2) or m.group(4) or ""
        try:
            value = round(float(whole + frac), 2)
        except ValueError:
            continue
        if value in seen or value <= 0:
            continue
        seen.add(value)
        out.append({"key": "$" + format(value, ",.2f"), "value": value, "text": m.group(0)})
    return out


def find_times(text: str) -> List[dict]:
    seen, out = set(), []
    for m in TIME_RE.finditer(text):
        if m.group(6):
            hh, mm = 12, 0
        elif m.group(3):
            hh, mm = int(m.group(1)) % 12, int(m.group(2) or 0)
            if m.group(3).lower() == "pm":
                hh += 12
        else:
            hh, mm = int(m.group(4)), int(m.group(5))
        if hh > 23 or mm > 59:
            continue
        key = "%02d:%02d" % (hh, mm)
        if key not in seen:
            seen.add(key)
            out.append({"key": key, "text": m.group(0)})
    return out


def candidates(text: str) -> dict:
    return {"amounts": find_amounts(text), "times": find_times(text)}


# --- questions ----------------------------------------------------------------------------


def state_for_command(text: str) -> dict:
    return {"assistant_for": "Harbor Coffee Co., a small coffee roaster", "request": text}


def questions(world: dict, cands: dict, source: str = "command") -> Dict[str, dict]:
    """Every question any action could need, asked together in one request."""
    if source == "command":
        ref, who = "`request`", "the shop owner's command in `request`"
    else:
        ref, who = "`message`", "the email in `message`"

    orders = {
        oid: "%s: %s ordered %s ($%.2f)" % (oid, world["customers"][o["customer"]]["name"], o["items"], o["total"])
        for oid, o in world["orders"].items()
    }
    orders["not_identified"] = "None of these orders can be identified from the text"

    meetings = {
        mid: "%s (currently %s at %s)" % (m["title"], m["day"].title(), m["time"])
        for mid, m in world["meetings"].items()
    }
    meetings["not_identified"] = "None of these meetings can be identified from the text"

    vendors = {vid: "%s, %s" % (v["name"], v["about"]) for vid, v in world["vendors"].items()}
    vendors["not_identified"] = "None of these vendors can be identified from the text"

    days = {d: None for d in WEEKDAYS}
    days["not_stated"] = "No new day is given; only the time changes or nothing is said"

    times = {t["key"]: "The time written as “%s”" % t["text"] for t in cands["times"]}
    times.update({
        "morning": "Some time in the morning, without an exact time",
        "afternoon": "Some time in the afternoon, without an exact time",
        "not_stated": "No new time is given; the meeting keeps its current time",
    })

    amounts = {a["key"]: "The amount written as “%s”" % a["text"] for a in cands["amounts"]}
    amounts.update({
        "open_invoice": "No amount is written; pay the vendor's outstanding invoice on file",
        "not_stated": "Neither an amount nor an invoice to pay is indicated",
    })

    qs = {
        "tool": choice(
            "Which one action does %s ask Harbor Coffee to take?" % who,
            {name: meta["about"] for name, meta in TOOLS.items()},
        ),
        "refund.order": choice(
            "If %s asks for a refund, which order should be refunded? Match by order number, customer "
            "name, or the items described." % ref,
            orders,
        ),
        "refund.reason": choice("Why does %s say the order should be refunded?" % ref, REFUND_REASONS),
        "reschedule.meeting": choice("Which existing meeting does %s want to move?" % ref, meetings),
        "reschedule.day": choice(
            "If %s moves a meeting, which weekday should it move to? Answer the new day, not the "
            "current one." % ref,
            days,
        ),
        "reschedule.time": choice(
            "If %s moves a meeting, what new start time does it ask for? Answer the new time, not the "
            "current one." % ref,
            times,
        ),
        "pay.vendor": choice("Which vendor does %s want to pay?" % ref, vendors),
        "pay.amount": choice("How much does %s ask to pay the vendor?" % ref, amounts),
        "task.area": choice("If %s asks for work to be done, which area of the business is it?" % ref, TASK_AREAS),
        "task.priority": score("How urgent is the work that %s asks for?" % ref, PRIORITY_LEVELS),
        "info.template": choice(
            "Which standard information best answers what %s is asking about?" % ref,
            {k: t["about"] for k, t in TEMPLATES.items()},
        ),
    }
    if source == "command":
        customers = {cid: c["name"] for cid, c in world["customers"].items()}
        customers["not_identified"] = "No customer can be identified from the text"
        qs["info.customer"] = choice("Which customer should %s send information to?" % ref, customers)
    return qs


# --- resolving answers into a typed call --------------------------------------------------


def _arg(answers: dict, qid: str, override: Optional[dict], name: str) -> dict:
    if override and name in override.get("args", {}):
        value = override["args"][name]
        return {"value": value, "prob": 1.0, "picked_by_user": True, "options": ranked(answers[qid], 4)}
    value, prob = chosen(answers[qid])
    return {"value": value, "prob": prob, "options": ranked(answers[qid], 4)}


def resolve(answers: dict, cands: dict, world: dict, source: str, text: str,
            override: Optional[dict] = None, sender_email: Optional[str] = None) -> dict:
    if override and override.get("tool"):
        tool, tool_prob = override["tool"], 1.0
    else:
        tool, tool_prob = chosen(answers["tool"])

    args: Dict[str, dict] = {}
    exec_args: dict = {}
    missing: List[str] = []

    if tool == "refund_order":
        args["order"] = _arg(answers, "refund.order", override, "order")
        args["reason"] = _arg(answers, "refund.reason", override, "reason")
        if args["order"]["value"] == "not_identified":
            missing.append("order")
        exec_args = {"order": args["order"]["value"],
                     "reason": None if args["reason"]["value"] == "not_stated" else args["reason"]["value"]}
    elif tool == "reschedule_meeting":
        args["meeting"] = _arg(answers, "reschedule.meeting", override, "meeting")
        args["day"] = _arg(answers, "reschedule.day", override, "day")
        args["time"] = _arg(answers, "reschedule.time", override, "time")
        if args["meeting"]["value"] == "not_identified":
            missing.append("meeting")
        day = None if args["day"]["value"] == "not_stated" else args["day"]["value"]
        time_value = {"morning": "10:00", "afternoon": "14:00", "not_stated": None}.get(
            args["time"]["value"], args["time"]["value"])
        if day is None and time_value is None:
            missing.append("day")
        exec_args = {"meeting": args["meeting"]["value"], "day": day, "time": time_value}
    elif tool == "pay_vendor":
        args["vendor"] = _arg(answers, "pay.vendor", override, "vendor")
        args["amount"] = _arg(answers, "pay.amount", override, "amount")
        vendor_id = args["vendor"]["value"]
        amount_key = args["amount"]["value"]
        amount = None
        if vendor_id == "not_identified":
            missing.append("vendor")
        if amount_key == "open_invoice" and vendor_id in world["vendors"]:
            unpaid = [i["amount"] for i in world["vendors"][vendor_id]["invoices"].values() if not i["paid"]]
            if len(unpaid) == 1:
                amount = unpaid[0]
        else:
            amount = next((a["value"] for a in cands["amounts"] if a["key"] == amount_key), None)
        if amount is None:
            missing.append("amount")
        args["amount"]["resolved"] = amount
        exec_args = {"vendor": vendor_id, "amount": amount}
    elif tool == "create_task":
        args["area"] = _arg(answers, "task.area", override, "area")
        priority_score = float(answers["task.priority"]["score"])
        priority = "low" if priority_score < 0.67 else "normal" if priority_score < 1.34 else "urgent"
        args["priority"] = {"value": priority, "prob": float(answers["task.priority"]["confidence"]),
                            "score": priority_score, "ungated": True}
        exec_args = {"area": args["area"]["value"], "priority": priority, "text": text}
    elif tool == "send_info":
        args["template"] = _arg(answers, "info.template", override, "template")
        exec_args = {"template": args["template"]["value"]}
        if source == "command":
            args["customer"] = _arg(answers, "info.customer", override, "customer")
            if args["customer"]["value"] == "not_identified":
                missing.append("customer")
            exec_args["customer"] = args["customer"]["value"]
        else:
            exec_args["to"] = sender_email

    gated = [a["prob"] for a in args.values() if not a.get("ungated")]
    confidence = min([tool_prob] + gated)
    return {
        "tool": tool,
        "tool_prob": tool_prob,
        "tool_ranking": ranked(answers["tool"], 6),
        "args": args,
        "exec_args": exec_args,
        "missing": missing,
        "confidence": confidence,
        "signature": signature(tool, exec_args),
    }


def signature(tool: str, exec_args: dict) -> str:
    if tool == "none":
        return "no_action()"
    shown = []
    for k, v in exec_args.items():
        if k == "text" or v is None:
            continue
        shown.append("%s=%s" % (k, ("%.2f" % v) if isinstance(v, float) else '"%s"' % v))
    return "%s(%s)" % (tool, ", ".join(shown))


# --- policy checks in code ----------------------------------------------------------------


def _check(cid: str, ok: bool, level_if_fail: str, label: str, detail: str) -> dict:
    return {"id": cid, "ok": ok, "level": "ok" if ok else level_if_fail, "label": label, "detail": detail}


def checks(call: dict, world_obj: World, sender_email: Optional[str] = None) -> List[dict]:
    """Deterministic rules. `sender_email` enables the checks that only make sense for email."""
    w = world_obj.state
    tool, a = call["tool"], call["exec_args"]
    out: List[dict] = []
    if call["missing"]:
        return out

    if tool == "refund_order":
        order = w["orders"][a["order"]]
        out.append(_check("not_refunded", not order["refunded"], "block", "Not already refunded",
                          "Already refunded" if order["refunded"] else "No previous refund"))
        days = world_obj.days_since_delivery(a["order"])
        reason = a["reason"]
        if order["status"] == "delivered":
            if reason in ("damaged", "wrong_item"):
                ok = days <= REFUND_WINDOW_DAYS
                out.append(_check("refund_window", ok, "approval", "Within %d-day window" % REFUND_WINDOW_DAYS,
                                  "Delivered %d days ago" % days))
            elif reason == "not_delivered":
                out.append(_check("delivery_claim", False, "approval", "Delivery status agrees",
                                  "Carrier shows delivered %d days ago" % days))
            else:
                out.append(_check("refund_reason", False, "approval", "Refundable reason",
                                  "Reason is %s; policy needs a damaged or wrong item" % (reason or "not given")))
        elif order["status"] == "in transit":
            out.append(_check("refund_reason", reason == "not_delivered", "approval", "Refundable reason",
                              "Order is still in transit"))
        else:
            out.append(_check("refund_status", False, "approval", "Order has shipped",
                              "Order is still %s; cancel instead of refunding" % order["status"]))
        if sender_email is not None:
            owner_email = w["customers"][order["customer"]]["email"]
            ok = sender_email.lower() == owner_email.lower()
            out.append(_check("requester_owns_order", ok, "approval", "Sender is the customer on the order",
                              "Order belongs to %s" % owner_email if not ok else "Sender matches %s" % owner_email))

    elif tool == "reschedule_meeting":
        meeting = w["meetings"][a["meeting"]]
        if sender_email is not None:
            domain = sender_email.rsplit("@", 1)[-1].lower()
            ok = domain == meeting["with_domain"]
            out.append(_check("sender_attends", ok, "approval", "Sender is part of this meeting",
                              "Meeting is with %s; sender is %s" % (meeting["with_domain"], domain)))

    elif tool == "pay_vendor":
        amount, vendor_id = a["amount"], a["vendor"]
        out.append(_check("funds", amount <= w["balance"], "block", "Sufficient balance",
                          "Balance $%s" % format(w["balance"], ",.2f")))
        paid = world_obj.paid_invoice_for(vendor_id, amount)
        open_inv = None if paid else world_obj.open_invoice_for(vendor_id, amount)
        if paid:
            out.append(_check("invoice", False, "block", "Matches an unpaid invoice", "%s is already paid" % paid))
        else:
            out.append(_check("invoice", bool(open_inv), "approval", "Matches an unpaid invoice",
                              ("Matches %s" % open_inv) if open_inv else "No open invoice for $%s" % format(amount, ",.2f")))
        if sender_email is not None:
            domain = sender_email.rsplit("@", 1)[-1].lower()
            expected = w["vendors"][vendor_id]["domain"]
            out.append(_check("vendor_domain", domain == expected, "approval", "Sent from the vendor's domain",
                              "Expected %s, got %s" % (expected, domain)))
    return out


def decide(call: dict, check_list: List[dict]) -> dict:
    tool = call["tool"]
    meta = TOOLS.get(tool, TOOLS["none"])
    reasons: List[str] = []
    if call["tool_prob"] < 0.5:
        return {"decision": "clarify", "reasons": ["Not sure which action is meant (%.0f%%)" % (call["tool_prob"] * 100)]}
    if tool == "none":
        return {"decision": "none", "reasons": ["No supported action requested"]}
    if call["missing"]:
        return {"decision": "clarify", "reasons": ["Missing: %s" % ", ".join(call["missing"])]}
    blocks = [c for c in check_list if c["level"] == "block"]
    approvals = [c for c in check_list if c["level"] == "approval"]
    if blocks:
        return {"decision": "reject", "reasons": [c["detail"] for c in blocks]}
    if approvals:
        reasons = [c["detail"] for c in approvals]
    if call["confidence"] < meta["threshold"]:
        reasons.append("Confidence %.0f%% is below the %.0f%% a %s-risk action needs"
                       % (call["confidence"] * 100, meta["threshold"] * 100, meta["risk"]))
    if reasons:
        return {"decision": "confirm", "reasons": reasons}
    return {"decision": "execute", "reasons": ["Confidence %.0f%% clears %.0f%%; all checks pass"
                                               % (call["confidence"] * 100, meta["threshold"] * 100)]}


def plan(answers: dict, cands: dict, world_obj: World, source: str, text: str,
         override: Optional[dict] = None, sender_email: Optional[str] = None,
         sender_checks: bool = True) -> dict:
    snapshot = world_obj.state
    call = resolve(answers, cands, snapshot, source, text, override, sender_email)
    check_list = checks(call, world_obj, sender_email if sender_checks else None)
    call.update(decide(call, check_list))
    call["checks"] = check_list
    call["tool_meta"] = {k: {"label": v["label"], "risk": v["risk"], "threshold": v["threshold"]}
                         for k, v in TOOLS.items()}
    return call
