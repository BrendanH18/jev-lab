"""Paths and settings. Process environment wins over the project's `.env` file.

Environment variables (the first three are the official TypeSafe SDK names):
  TYPESAFE_API_KEY        the API key
  TYPESAFE_BASE_URL       API root (default https://api.typesafe.ai)
  TYPESAFE_DEFAULT_MODEL  model name or alias (default jev-latest)
  JEV_LAB_BUDGET_USD      stop making live calls after this much spend in one server run (default 2.00)
  JEV_LAB_RPM             local cap on live calls per minute (default 120)
  PORT                    listen port (default 8321)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping, Optional

from . import envfile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
SAMPLES_DIR = DATA_DIR / "samples"
WORKBENCH_DIR = DATA_DIR / "workbench"
ENV_PATH = PROJECT_ROOT / ".env"

KEY_ENV = "TYPESAFE_API_KEY"
BASE_URL_ENV = "TYPESAFE_BASE_URL"
MODEL_ENV = "TYPESAFE_DEFAULT_MODEL"

DEFAULT_BASE_URL = "https://api.typesafe.ai"
DEFAULT_MODEL = "jev-latest"


class Settings:
    def __init__(self, environ: Optional[Mapping[str, str]] = None, env_file: Path = ENV_PATH):
        self.environ = dict(os.environ if environ is None else environ)
        self.env_file = env_file
        self.file_values = envfile.read(env_file)

    def reload_file(self) -> None:
        self.file_values = envfile.read(self.env_file)

    def get(self, name: str, default: Optional[str] = None) -> Optional[str]:
        value = self.environ.get(name) or self.file_values.get(name)
        return value if value else default

    @property
    def api_key(self) -> Optional[str]:
        return self.get(KEY_ENV)

    @property
    def key_source(self) -> Optional[str]:
        if self.environ.get(KEY_ENV):
            return "env"
        if self.file_values.get(KEY_ENV):
            return "file"
        return None

    @property
    def base_url(self) -> str:
        return (self.get(BASE_URL_ENV, DEFAULT_BASE_URL) or DEFAULT_BASE_URL).rstrip("/")

    @property
    def model(self) -> str:
        return self.get(MODEL_ENV, DEFAULT_MODEL) or DEFAULT_MODEL

    @property
    def budget_usd(self) -> float:
        return _float(self.get("JEV_LAB_BUDGET_USD"), 2.00)

    @property
    def rpm(self) -> int:
        return int(_float(self.get("JEV_LAB_RPM"), 120))

    @property
    def port(self) -> int:
        return int(_float(self.get("PORT"), 8321))


def _float(value: Optional[str], default: float) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default
