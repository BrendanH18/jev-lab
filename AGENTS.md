# Agent instructions

## What this is

Jev Lab: six small demo apps (Shield, Dispatch, Autopilot, Claims, Find, Play) plus a
Workbench for building your own, all showing what TypeSafe's Jev model (a "System One" model —
typed questions in, typed answers + calibrated probabilities out, no generated prose) can do
inside ordinary software. A stdlib Python HTTP server (`server.py`) serves vanilla JS/CSS pages
and a JSON API; there is no build step and no frontend framework. Every app runs against one
fictional business, **Harbor Coffee Co.**

This is a public repo (`BrendanH18/jev-lab`); keep keys, private data and personal notes out of
it. See CONTRIBUTING.md.

## Commands

```bash
uv run server.py                              # start the app: http://127.0.0.1:8321
python3 server.py                             # same, without uv (stdlib fallback on Python 3.9)

uv run python -m unittest discover tests      # run all tests (no key/network needed)
python3 -m unittest discover tests            # same, no uv
python3 -m unittest tests.test_workbench -v   # run one test module
python3 -m unittest tests.test_workbench.ItemTests.test_save_list_run_delete  # run one test

uv run scripts/validate.py                    # run every built-in scenario against the LIVE model
                                               # and print a report (~100 calls, well under $0.01).
                                               # Needs TYPESAFE_API_KEY. Use after changing question
                                               # wording, thresholds, or the model version — the
                                               # unit tests use fake answers and cannot tell you
                                               # whether Jev's real answers still make sense.
uv run scripts/check.py                       # rerun the checks saved in Workbench datasets against the
                                               # LIVE model (one call per row); exits 1 when a gate misses
                                               # its targets. Needs TYPESAFE_API_KEY. --list makes no calls.
```

Lint with `uv run --locked ruff check` (configured in `pyproject.toml`; CI runs it). No formatter is
configured; match the existing style (see "Conventions" below).

`tests/test_server.py` binds a loopback port and `uv` writes to `~/.cache/uv`, so run the suite
and `uv` commands outside a sandbox; inside one, the server tests fail with `PermissionError`.
The system `python3` is 3.9 without the SDK, which exercises CI's stdlib-fallback path.

Needs a `TYPESAFE_API_KEY` (get one at console.typesafe.ai) to make live calls; the offline test
suite does not need one. The official `typesafe-sdk` is used on Python ≥3.10; a hand-rolled stdlib
`urllib` client in `jev/client.py` is the fallback on 3.9 — CI (`.github/workflows/test.yml`) runs
the locked-SDK suite on 3.10–3.14, the stdlib fallback on 3.9, and separate Ruff and JavaScript
jobs, so both code paths must keep working.

## Architecture

**Everything talks to TypeSafe through exactly one place: `jev/client.py`'s `JevClient`.** It
picks the SDK vs. stdlib backend, holds the per-process `SpendGuard` (budget + rate limit — every
live call goes through `guard.check()`/`guard.record()`), and wraps every response in a
`JevResult` that carries `meta()` (model, latency, tokens, cost) and `trace()` (exact request +
response) for the UI's "Inspect JSON" drawer. No other module should reach the network directly.

**Pattern used by every app: build `state` + a `questions` dict of `noul`/`choice`/`score`/`box`
primitives (helpers in `jev/client.py`), send them in one `system_one()` call, then let plain
Python turn the typed answers into a decision.** Math, dates, regex extraction, and business rules
always stay in code — Jev is only ever asked for a judgment. Each app's module
(`jev/shield.py`, `jev/dispatch.py`, `jev/claims.py`, `jev/find.py`, `jev/play.py`; Claims also uses
the `box` primitive) follows this same shape:
`questions(...)` builds the request, then a separate pure function (e.g. `shield.verdict()`,
`dispatch.plan()`) turns already-fetched answers into the decision — that separation is what lets
`/api/shield/rescore` re-score saved answers with new weights/thresholds without spending another
API call. Workbench test runs (`/api/workbench/items/run`) are different: they send each saved item
to the model again and spend API budget.

**`jev/autopilot.py` is the integration story**: `merged_questions()` concatenates Shield's and
Dispatch's questions with `shield.`/`dispatch.` key prefixes into a *single* request, `split()`
un-prefixes the answers, and the resulting `Autopilot` class runs the same answers through two
parallel `World` instances — an "integrated" pipeline where Shield's verdict gates Dispatch's
action and Shield's sender-identity facts feed Dispatch's authorization checks, and a "naive"
pipeline that runs Dispatch alone with no Shield gate. The UI shows both side by side so the
value of composing the two is visible, not just claimed. `Autopilot.benchmark()` re-runs the same
questions as sequential/parallel/merged calls to measure the token and latency savings of merging.

**`jev/world.py`'s `World` class is the mutable "business" the apps act on** (orders, vendor
invoices, a calendar, a bank balance, an activity log). It's deliberately dumb: `execute(tool,
args, context)` dispatches to `_do_<tool>` methods that mutate state and log an activity entry.
`server.py` holds one shared `dispatch_world` (used by Shield/Dispatch demos) and `Autopilot` owns
its own pair of `World`s — don't let those get confused with each other.

**`server.py` is a flat `ROUTES: dict[(method, path), handler]` dispatched from one
`BaseHTTPRequestHandler`.** Handlers are plain `def api_foo(body: dict) -> dict` functions —
raise `BadRequest`/`jev.workbench.WorkbenchError`/`jev.envfile.EnvFileError` for 400s, `JevError`
(from `jev/client.py`) carries its own HTTP status through to the response. To add an endpoint:
write the handler, add it to `ROUTES`, and (if the response should ever come back non-JSON or the
page needs new markup) update the relevant `static/*.html`+`static/js/*.js` pair — each app page
has one JS file with no shared framework, only the helpers in `static/js/common.js` (DOM builder
`h()`, `api()` fetch wrapper, the JSON "Inspect" drawer, toasts, the key/settings modal).

**Security is centralized in `jev/security.py`**, called once per request in
`server.py:Handler._handle` before any route runs: Host-header allow-list (blocks DNS rebinding —
only `127.0.0.1`/`localhost`/`[::1]` on the configured port are served), `Sec-Fetch-Site`/`Origin`
checks, a random per-process `SESSION_TOKEN` that every state-changing request must echo back in
`X-Jev-Token` (embedded into served HTML via a `<meta name="jev-csrf">` tag), and a
`Content-Type: application/json`-only rule for bodies. **Never weaken these checks or make the
server bind to anything but 127.0.0.1** — see SECURITY.md for the full threat model.

**`jev/envfile.py` is the only code path allowed to write `.env`.** Before writing a key it
verifies `.env` is gitignored and not already `git`-tracked (`preflight()`), then writes
atomically with `0600` permissions. Do not add another way to persist secrets to disk, and never
construct a test/dev server pointed at the real project's `.env` — always redirect
`server.PROJECT_ROOT` / `Settings(env_file=...)` / `jev.config.WORKBENCH_DIR` to a temp directory
first (see `tests/test_envfile.py` for the pattern). A prior session accidentally overwrote and
then deleted the real `.env` this way; do not repeat it.

**`jev/workbench.py`** is the generic layer the whole thing is trying to demonstrate: it
validates arbitrary `state`/`questions` from the UI (`validate_questions`/`validate_state`), runs
them, checks probability answers against user-authored `expect` ranges, persists runs as JSON
files under `data/workbench/` (one file per saved test — these are meant to be committed), saves
Bulk rows and their `_expect` labels as datasets under `data/workbench/datasets/` (inputs and labels
only — never answers, per the no-replay rule below), keeps a tuned Policy gate with a dataset as a *check*
(`jev/checks.py`: gates, model and user-chosen targets, never measured results) that the Datasets
panel and `scripts/check.py` rerun live, runs a
question set over many rows in parallel (`run_bulk`, capped and rate-limited by the same
`SpendGuard`), and exports the exact request as runnable Python/JavaScript/curl.

## Conventions

- Ask before adding any dependency, tool or service; propose the trade-off and a recommended
  option.
- Python: no type-checker is configured, but signatures are typed; `from __future__ import
  annotations` at the top of every `jev/*.py` module; f-strings/`%`-formatting mixed, follow
  the surrounding function.
- No real domains or emails in fictional data (sample data, scenarios, tests): Harbor Coffee Co. and
  all vendors/customers use the reserved `.example` TLD. Official service endpoints and docs links
  such as `api.typesafe.ai` are fine. This is enforced by nothing but review;
  keep it that way if you add scenario data.
- Every built-in scenario/example must run against the live model cleanly (`scripts/validate.py`)
  before it's considered correct — the offline `tests/` only check that composition code (weights,
  thresholds, gating) behaves correctly given some answers, not that the wording elicits good
  answers from Jev.
- Nothing in the UI may show a canned/replayed answer; every number the app displays must come
  from a call the current user actually triggered (there is no cache — an earlier version had
  one and it was deliberately removed).

## Context maintenance

- Keep project rules and durable project knowledge in tracked `AGENTS.md` and
  repository docs; do not store them in agent auto-memory or machine-local notes.
- `CLAUDE.md` contains only `@AGENTS.md`. Shared hooks, scripts and settings
  belong in tracked files. Do not ignore instruction files or shared settings;
  ignore only machine-local settings and agent worktrees.
