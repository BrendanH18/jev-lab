"""Find: semantic search over a document with no embeddings, no index, and one request.

Every line gets an ID. For each query, a Choice question over the line IDs says *where* the answer
is (probabilities over lines), and a Noul question says *whether* the document answers it at all.
Several queries share one request because they share the same state. Based on TypeSafe's
line-by-line search cookbook: https://docs.typesafe.ai/cookbooks/semantic_find
"""

from __future__ import annotations

from typing import Dict, List, Optional

from .client import JevClient, choice, noul
from .config import SAMPLES_DIR

MAX_LINES = 255          # a Choice question accepts up to 255 options
MAX_QUERIES = 8
MAX_DOC_CHARS = 60_000
FOUND, ABSENT = 0.7, 0.35  # example thresholds from the cookbook; tune on your own documents

SAMPLE_QUERIES = [
    "can I bring my dog to work?",
    "how much notice do I have to give before I quit?",
    "what do I do if a customer says the coffee tastes stale?",
    "do we ship to Canada?",
    "is there paid parental leave?",
    "what is the wifi password?",
]


def load_sample() -> str:
    return (SAMPLES_DIR / "handbook.txt").read_text()


def split_lines(text: str) -> List[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def line_id(i: int) -> str:
    return "L%03d" % i


def tagged_document(lines: List[str]) -> str:
    return "\n".join("%s| %s" % (line_id(i), line) for i, line in enumerate(lines))


def questions(queries: List[str], n_lines: int) -> Dict[str, dict]:
    ids = {line_id(i): None for i in range(n_lines)}
    qs: Dict[str, dict] = {}
    for qi, query in enumerate(queries):
        qs["q%d.where" % qi] = choice(
            "Which line of `document` contains the answer to: “%s”?" % query, ids)
        qs["q%d.exists" % qi] = noul(
            "Does any line of `document` address or answer: “%s”?" % query,
            yes="At least one line states or directly implies the answer",
            no="No line addresses this question")
    return qs


def verdict(exists: float) -> str:
    if exists >= FOUND:
        return "answered"
    return "absent" if exists < ABSENT else "partial"


def search(client: JevClient, text: str, queries: List[str], top: int = 5) -> dict:
    if len(text) > MAX_DOC_CHARS:
        raise ValueError("Document is too long (%d chars; limit %d)." % (len(text), MAX_DOC_CHARS))
    lines = split_lines(text)
    truncated = len(lines) > MAX_LINES
    lines = lines[:MAX_LINES]
    queries = [q.strip() for q in queries if q.strip()][:MAX_QUERIES]
    if not lines or not queries:
        raise ValueError("Need a document and at least one query.")
    result = client.system_one({"document": tagged_document(lines)}, questions(queries, len(lines)))
    out = []
    for qi, query in enumerate(queries):
        where = result.answers["q%d.where" % qi]
        exists = float(result.answers["q%d.exists" % qi]["noul"])
        probs = where.get("probabilities", {})
        ranked = sorted(range(len(lines)), key=lambda i: probs.get(line_id(i), 0.0), reverse=True)[:top]
        out.append({
            "query": query,
            "exists": exists,
            "verdict": verdict(exists),
            "confidence": float(where.get("confidence", 0.0)),
            "hits": [{"id": line_id(i), "index": i, "text": lines[i], "prob": float(probs.get(line_id(i), 0.0))}
                     for i in ranked],
        })
    return {"results": out, "lines": len(lines), "truncated": truncated, "meta": result.meta(),
            "trace": result.trace(), "thresholds": {"found": FOUND, "absent": ABSENT}}
