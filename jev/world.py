"""Harbor Coffee Co.: the simulated business the demo apps act on.

Everything here is ordinary deterministic code. Jev never touches this state directly;
it only supplies judgments that code turns into calls on these methods.
"""

from __future__ import annotations

import copy
import datetime as dt
import threading
from typing import Optional

BUSINESS = {
    "name": "Harbor Coffee Co.",
    "domain": "harborcoffee.example",
    "about": "A small coffee roaster with an online shop and a handful of wholesale cafe accounts.",
}

REFUND_WINDOW_DAYS = 30
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"]

TEMPLATES = {
    "shipping_times": {
        "label": "Shipping times",
        "about": "How fast orders ship and arrive, shipping destinations and costs",
        "text": "Thanks for asking! We roast to order and ship within 1-2 business days. "
        "US delivery usually takes 3-5 days; Canada takes 6-10 business days. "
        "Shipping is free on orders over $45.",
    },
    "return_policy": {
        "label": "Returns & refunds",
        "about": "Whether and how a customer can return an item or get a refund",
        "text": "We're sorry it wasn't right. Damaged or incorrect items are refunded in full "
        "within 30 days of delivery. Unopened equipment can be returned within 30 days. "
        "Reply with your order number and a photo and we'll sort it out.",
    },
    "wholesale_pricing": {
        "label": "Wholesale pricing",
        "about": "Prices, minimums, and terms for cafes, offices, and restaurants buying in bulk",
        "text": "We'd love to work together! Wholesale pricing starts at $14.50/lb with a "
        "10 lb minimum, net-30 terms after the first order, and a free tasting visit.",
    },
    "subscription_help": {
        "label": "Subscription help",
        "about": "Pausing, skipping, changing, or cancelling a coffee subscription",
        "text": "You can pause, skip, or cancel your subscription anytime from Account > "
        "Subscriptions. Changes made before the 25th apply to next month's box.",
    },
    "brewing_guide": {
        "label": "Brewing guide",
        "about": "How to brew, grind, dose, or store coffee for the best taste",
        "text": "Start with 1:16 coffee to water, water just off the boil (about 96C), and a "
        "medium-fine grind for pour-over. Store beans airtight and away from light.",
    },
}


def _seed(today: dt.date) -> dict:
    d = lambda days: (today - dt.timedelta(days=days)).isoformat()  # noqa: E731
    return {
        "today": today.isoformat(),
        "balance": 18400.00,
        "customers": {
            "maya_chen": {"name": "Maya Chen", "email": "maya.chen@example.com"},
            "luis_ortega": {"name": "Luis Ortega", "email": "lortega@example.com"},
            "priya_nair": {"name": "Priya Nair", "email": "priya@nairdesign.example"},
            "tom_becker": {"name": "Tom Becker", "email": "tom.becker@example.com"},
            "northside_bistro": {"name": "Northside Bistro", "email": "orders@northsidebistro.example"},
        },
        "orders": {
            "A-1041": {"customer": "maya_chen", "items": "2 x Ethiopia Yirgacheffe, 12 oz bags",
                       "total": 38.00, "status": "delivered", "delivered_on": d(3), "refunded": False},
            "A-1042": {"customer": "luis_ortega", "items": "Conical burr grinder",
                       "total": 249.00, "status": "delivered", "delivered_on": d(12), "refunded": False},
            "A-1043": {"customer": "priya_nair", "items": "Espresso sampler box",
                       "total": 54.00, "status": "in transit", "delivered_on": None, "refunded": False},
            "A-1044": {"customer": "tom_becker", "items": "Cold brew starter kit",
                       "total": 64.00, "status": "delivered", "delivered_on": d(41), "refunded": False},
            "A-1045": {"customer": "northside_bistro", "items": "20 lb House Blend (wholesale)",
                       "total": 310.00, "status": "processing", "delivered_on": None, "refunded": False},
        },
        "vendors": {
            "bean_brokers": {"name": "Bean Brokers Ltd", "about": "green coffee importer",
                             "domain": "beanbrokers.example",
                             "invoices": {"INV-7781": {"amount": 4250.00, "paid": False}}},
            "packright": {"name": "PackRight Packaging", "about": "coffee bags, labels, and boxes",
                          "domain": "packright.example",
                          "invoices": {"PR-2210": {"amount": 860.00, "paid": False}}},
            "coastline_freight": {"name": "Coastline Freight", "about": "pallet shipping for wholesale orders",
                                  "domain": "coastlinefreight.example", "invoices": {}},
            "sparkle_facility": {"name": "Sparkle Facility Services", "about": "cleaning and roaster maintenance",
                                 "domain": "sparklefs.example",
                                 "invoices": {"SF-0930": {"amount": 420.00, "paid": False}}},
        },
        "meetings": {
            "bean_brokers_call": {"title": "Supplier call with Bean Brokers", "day": "tuesday", "time": "10:00",
                                  "with_domain": "beanbrokers.example"},
            "team_sync": {"title": "Weekly team sync", "day": "wednesday", "time": "09:00",
                          "with_domain": "harborcoffee.example"},
            "northside_tasting": {"title": "Wholesale tasting with Northside Bistro", "day": "thursday",
                                  "time": "14:00", "with_domain": "northsidebistro.example"},
            "accountant_review": {"title": "Quarterly review with the accountant", "day": "friday",
                                  "time": "11:00", "with_domain": "ledgerwisecpa.example"},
        },
        "payments": [],
        "tasks": [],
        "outbox": [],
        "activity": [],
    }


class World:
    def __init__(self, today: Optional[dt.date] = None):
        self._lock = threading.RLock()
        self._today = today or dt.date.today()
        self.state = _seed(self._today)

    def reset(self) -> None:
        with self._lock:
            self.state = _seed(self._today)

    def snapshot(self) -> dict:
        with self._lock:
            return copy.deepcopy(self.state)

    # --- deterministic facts code can compute exactly -------------------------------

    def days_since_delivery(self, order_id: str) -> Optional[int]:
        delivered = self.state["orders"][order_id]["delivered_on"]
        if not delivered:
            return None
        return (self._today - dt.date.fromisoformat(delivered)).days

    def open_invoice_for(self, vendor_id: str, amount: float) -> Optional[str]:
        for inv_id, inv in self.state["vendors"][vendor_id]["invoices"].items():
            if abs(inv["amount"] - amount) < 0.005:
                return inv_id
        return None

    def paid_invoice_for(self, vendor_id: str, amount: float) -> Optional[str]:
        for inv_id, inv in self.state["vendors"][vendor_id]["invoices"].items():
            if inv["paid"] and abs(inv["amount"] - amount) < 0.005:
                return inv_id
        return None

    # --- actions ----------------------------------------------------------------------

    def _log(self, kind: str, text: str, **extra) -> dict:
        entry = {"kind": kind, "text": text, **extra}
        self.state["activity"].insert(0, entry)
        return entry

    def execute(self, tool: str, args: dict, context: Optional[dict] = None) -> dict:
        context = context or {}
        with self._lock:
            handler = getattr(self, "_do_" + tool, None)
            if handler is None:
                raise ValueError("Unknown action: %s" % tool)
            return handler(args, context)

    def _do_refund_order(self, args: dict, context: dict) -> dict:
        order = self.state["orders"][args["order"]]
        if order["refunded"]:
            raise ValueError("Order %s was already refunded" % args["order"])
        order["refunded"] = True
        order["refund_reason"] = args.get("reason")
        self.state["balance"] = round(self.state["balance"] - order["total"], 2)
        self.state["payments"].insert(0, {"to": context.get("requested_by") or self.state["customers"][order["customer"]]["name"],
                                          "amount": order["total"], "memo": "Refund %s" % args["order"],
                                          "via": context.get("via", "operator")})
        return self._log("refund", "Refunded $%.2f for %s (%s)" % (order["total"], args["order"], args.get("reason")),
                         amount=order["total"], via=context.get("via"))

    def _do_reschedule_meeting(self, args: dict, context: dict) -> dict:
        meeting = self.state["meetings"][args["meeting"]]
        before = "%s %s" % (meeting["day"].title(), meeting["time"])
        if args.get("day"):
            meeting["day"] = args["day"]
        if args.get("time"):
            meeting["time"] = args["time"]
        meeting["moved"] = True
        after = "%s %s" % (meeting["day"].title(), meeting["time"])
        return self._log("calendar", "Moved “%s” from %s to %s" % (meeting["title"], before, after),
                         via=context.get("via"))

    def _do_pay_vendor(self, args: dict, context: dict) -> dict:
        vendor = self.state["vendors"][args["vendor"]]
        amount = float(args["amount"])
        if amount > self.state["balance"]:
            raise ValueError("Insufficient balance")
        invoice = self.open_invoice_for(args["vendor"], amount)
        if invoice and not vendor["invoices"][invoice]["paid"]:
            vendor["invoices"][invoice]["paid"] = True
        destination = context.get("destination", "account on file")
        self.state["balance"] = round(self.state["balance"] - amount, 2)
        self.state["payments"].insert(0, {"to": vendor["name"], "amount": amount,
                                          "memo": invoice or "Unmatched payment", "destination": destination,
                                          "via": context.get("via", "operator")})
        return self._log("payment", "Paid $%s to %s (%s)" % (format(amount, ",.2f"), vendor["name"], invoice or "no invoice"),
                         amount=amount, via=context.get("via"), destination=destination)

    def _do_create_task(self, args: dict, context: dict) -> dict:
        task = {"area": args.get("area", "admin"), "priority": args.get("priority", "normal"),
                "text": args.get("text", ""), "via": context.get("via", "operator")}
        self.state["tasks"].insert(0, task)
        return self._log("task", "New %s task (%s): %s" % (task["area"], task["priority"], _clip(task["text"])),
                         via=context.get("via"))

    def _do_send_info(self, args: dict, context: dict) -> dict:
        template = TEMPLATES[args["template"]]
        to = args.get("to") or self.state["customers"][args["customer"]]["email"]
        self.state["outbox"].insert(0, {"to": to, "template": args["template"], "label": template["label"],
                                        "text": template["text"], "via": context.get("via", "operator")})
        return self._log("reply", "Sent “%s” to %s" % (template["label"], to), via=context.get("via"))


def _clip(text: str, n: int = 70) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"
