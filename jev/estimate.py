"""Spend previews: what a paid Workbench run would send and hold against the budget, before it starts.

Each preview builds the requests a run sends, through the same code the run uses (workbench.prepare_bulk,
workbench.prepare_compare, checks.load, drift.prepare, upgrade.prepare, workbench.job_state), and adds up
client.request_reserve_usd for each one: the same high estimate a live call holds against the SpendGuard until it
settles. So the total is an upper bound on what the run can be billed, never a measured cost.

A preview makes no network call and never reserves or records anything in the guard; it only reads the guard's
snapshot to say whether the run fits the budget that is left. Validation errors are the run's own, so a preview
fails where the run would.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import checks, drift, upgrade, workbench
from .client import JevClient, request_reserve_usd
from .compare import NAMES

KINDS = ("bulk", "compare", "check", "drift", "upgrade", "items")


def _rows_cost(split: List[tuple], questions: Dict[str, dict], model: str, field: str = "text",
               kind: Optional[str] = None) -> List[float]:
    """One reserve per row: the state the run sends for that row, with its picture's reference."""
    out = []
    for index in range(len(split)):
        state, _sent = workbench.job_state(split, index, field, kind)
        out.append(request_reserve_usd(state, questions, model, workbench.picture_refs(split, index)))
    return out


def _part(label: str, model: str, costs: List[float]) -> dict:
    return {"label": label, "model": model, "calls": len(costs), "usd": sum(costs)}


def _nonempty(rows: List[Any]) -> int:
    return sum(1 for r in rows if r not in (None, ""))


def summarize(client: JevClient, kind: str, parts: List[dict], **extra: Any) -> dict:
    """The preview for a run made of `parts`, and how it compares with the budget left. Reads the guard only."""
    calls = sum(p["calls"] for p in parts)
    usd = sum(p["usd"] for p in parts)
    snap = client.guard.snapshot()
    budget = float(snap["budget_usd"] or 0)
    if budget > 0:
        remaining: Optional[float] = max(0.0, budget - snap["spent_usd"] - snap["reserved_usd"])
        fits = usd <= remaining + 1e-12
    else:  # no budget set: nothing to run out of
        remaining, fits = None, True
    notes = []
    if not fits:
        notes.append("The upper bound is more than the budget left. The guard stops the run when the budget is "
                     "spent, so the rows after that get no answer.")
    rpm = int(snap.get("rpm") or 0)
    if rpm > 0 and calls > rpm:
        notes.append("%d calls is more than the local limit of %d live calls a minute; calls past it fail with a "
                     "rate-limit error and leave their rows without answers." % (calls, rpm))
    out = {"kind": kind, "calls": calls, "usd": usd, "upper_bound": True,
           "models": sorted({p["model"] for p in parts if p["calls"]}), "parts": parts,
           "budget_usd": budget if budget > 0 else None, "remaining_usd": remaining, "fits": fits, "notes": notes}
    out.update(extra)
    return out


def for_bulk(client: JevClient, rows: List[Any], questions: Any, field: str = "text", model: Optional[str] = None) -> dict:
    """workbench.run_bulk: one call per row, the first MAX_BULK_ROWS rows. Bulk sends test rows too."""
    questions, split = workbench.prepare_bulk(rows, questions)
    asked = model or client.model
    return summarize(client, "bulk", [_part("rows", asked, _rows_cost(split, questions, asked, field))],
                     rows=len(split), capped=max(0, _nonempty(rows) - len(split)), held_out=0)


def for_compare(client: JevClient, rows: List[Any], variants: Any, field: str = "text") -> dict:
    """workbench.run_compare: one call per row and variant, two for a variant that averages over both orders.
    Test rows are left out."""
    variants, models, asked, split, held_out, jobs = workbench.prepare_compare(client, rows, variants)
    costs: Dict[int, List[float]] = {}
    width = sum(len(sets) for sets in asked)
    for n, (index, questions, model, kind) in enumerate(jobs):
        state, _sent = workbench.job_state(split, index, field, kind)
        variant = 0 if n % width < len(asked[0]) else 1
        costs.setdefault(variant, []).append(
            request_reserve_usd(state, questions, model, workbench.picture_refs(split, index)))
    parts = [_part("variant %s%s" % (NAMES[v], ", both orders" if variants[v]["average_orders"] else ""),
                   models[v], costs.get(v, [])) for v in range(len(variants))]
    given = min(_nonempty(rows), workbench.MAX_BULK_ROWS)
    return summarize(client, "compare", parts, rows=len(split), held_out=held_out,
                     capped=max(0, _nonempty(rows) - given))


def for_check(client: JevClient, dataset_id: str, model: Optional[str] = None) -> dict:
    """checks.run: one call per tuning row of the dataset; its test rows are not sent."""
    dataset, check = checks.load(dataset_id)
    asked = checks.asked_model(check, model)
    tuning = workbench.tuning_rows(dataset)
    questions, split = workbench.prepare_bulk(tuning, dataset["questions"])
    return summarize(client, "check", [_part("dataset rows", asked, _rows_cost(split, questions, asked))],
                     id=dataset_id, rows=len(split), held_out=len(dataset["rows"]) - len(tuning))


def for_drift(client: JevClient, dataset_id: str, rows: Any, model: Optional[str] = None) -> dict:
    """drift.run: the dataset's tuning rows, then the new rows that are not test rows, one call per row each. The run
    skips the new rows when the dataset's run stops early; the preview counts both, as an upper bound."""
    dataset, _check, fresh, held_out, questions, asked = drift.prepare(dataset_id, rows, model)
    tuning = workbench.tuning_rows(dataset)
    questions, ref = workbench.prepare_bulk(tuning, questions)
    questions, new = workbench.prepare_bulk(fresh, questions)
    parts = [_part("dataset rows", asked, _rows_cost(ref, questions, asked)),
             _part("new rows", asked, _rows_cost(new, questions, asked))]
    return summarize(client, "drift", parts, id=dataset_id, rows=len(ref) + len(new),
                     held_out=(len(dataset["rows"]) - len(tuning)) + held_out)


def for_upgrade(client: JevClient, dataset_id: str, candidate: Any) -> dict:
    """upgrade.run: every tuning row asked of the tuned-on version and of the candidate. The run skips the candidate
    when the first side stops early; the preview counts both, as an upper bound."""
    dataset, _check, current, candidate, questions = upgrade.prepare(dataset_id, candidate)
    tuning = workbench.tuning_rows(dataset)
    questions, split = workbench.prepare_bulk(tuning, questions)
    parts = [_part("tuned-on version", current, _rows_cost(split, questions, current)),
             _part("candidate", candidate, _rows_cost(split, questions, candidate))]
    return summarize(client, "upgrade", parts, id=dataset_id, rows=len(split),
                     held_out=len(dataset["rows"]) - len(tuning))


def for_items(client: JevClient, chosen: List[dict]) -> dict:
    """workbench.run_items: one call per saved test, with its saved pictures, asking the current model."""
    model = client.model
    costs = [request_reserve_usd(it.get("state"), it.get("questions") or {}, model, list((it.get("images") or {}).keys()))
             for it in chosen]
    return summarize(client, "items", [_part("saved tests", model, costs)], rows=len(costs))
