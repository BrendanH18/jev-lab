"""Read the exact Bulk states for missing paths and picture files, without calls."""

from __future__ import annotations

from typing import Any

from . import lab, lint, workbench
from .workbench import WorkbenchError


def check(rows: Any, questions: Any) -> dict:
    if isinstance(rows, str):
        rows = workbench.parse_rows(rows)
    if not isinstance(rows, list):
        raise WorkbenchError("rows must be text or a list")
    asked = workbench.validate_questions(questions)
    split = workbench._split_rows(rows)
    findings = []
    notes = []  # advisory findings from Lab packs (kind preflight_check); they never ask for a confirm before a run
    for index, (row, _) in enumerate(split):
        # Findings contain positions and paths only, never inputs or labels.
        state, _ = workbench.job_state(split, index, "text", None)
        workbench.validate_state(state)
        refs = workbench.picture_refs(split, index)
        for qid, question in asked.items():
            findings.extend(dict(f, row=index + 1) for f in lint._missing_paths(qid, question, state, set(refs)))
        notes.extend(lab.preflight_findings(state, asked, set(refs), index + 1))
        if workbench.has_box(asked) and not refs:
            findings.append({"row": index + 1, "question": None, "code": "missing_picture",
                             "message": "Box questions need a picture on this row."})
        if refs:
            try:
                workbench._picture(split, index)
            except (WorkbenchError, OSError):
                findings.append({"row": index + 1, "question": None, "code": "missing_picture",
                                 "message": "The named picture could not be loaded."})
    return {"rows": len(split), "findings": findings, "held_out": sum(workbench.row_test(row) for row, _ in split),
            "lab": notes}
