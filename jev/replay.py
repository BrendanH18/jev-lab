"""Replay cache: real Jev answers recorded once, replayed for free.

TypeSafe's own cookbooks ship a `json_cache.json` so readers can run them without a key. This does
the same for Jev Lab's built-in scenarios: `scripts/record_replay.py` records the answers, the file
is committed, and anyone who clones the repo sees genuine Jev output before they have a key.

An entry is keyed by a hash of (model, state, questions), so it is only replayed for the exact same
request. Custom input always goes to the live API.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

VERSION = 1


def canonical(model: str, state: Any, questions: Dict[str, Any]) -> str:
    return json.dumps({"model": model, "state": state, "questions": questions},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def key_for(model: str, state: Any, questions: Dict[str, Any]) -> str:
    return hashlib.sha256(canonical(model, state, questions).encode("utf-8")).hexdigest()


class ReplayStore:
    def __init__(self, path: Path, recording: bool = False):
        self.path = path
        self.recording = recording
        self._lock = threading.Lock()
        self.entries: Dict[str, dict] = {}
        self.hits = 0
        self.load()

    def load(self) -> None:
        try:
            data = json.loads(self.path.read_text())
        except (FileNotFoundError, ValueError):
            data = {}
        if data.get("version") == VERSION and isinstance(data.get("entries"), dict):
            self.entries = data["entries"]

    def get(self, model: str, state: Any, questions: Dict[str, Any]) -> Optional[dict]:
        entry = self.entries.get(key_for(model, state, questions))
        if entry:
            with self._lock:
                self.hits += 1
        return entry

    def put(self, model: str, state: Any, questions: Dict[str, Any], response: dict, latency_ms: float) -> None:
        entry = {"model": response.get("model", model), "response": response,
                 "latency_ms": round(latency_ms, 1), "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        with self._lock:
            self.entries[key_for(model, state, questions)] = entry
            self._save()

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"version": VERSION, "entries": self.entries}, indent=1, sort_keys=True)
        fd, tmp = tempfile.mkstemp(prefix=".replay.", dir=str(self.path.parent))
        with os.fdopen(fd, "w") as handle:
            handle.write(payload)
        os.replace(tmp, self.path)

    def stats(self) -> dict:
        return {"entries": len(self.entries), "hits": self.hits, "recording": self.recording,
                "path": str(self.path)}
