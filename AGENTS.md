# Agent instructions

## What this is

Jev Lab: eight small demo apps (Shield, Dispatch, Autopilot, Claims, Reviews, Find, Play, Counter) plus a
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
node --test tests/js/*.test.mjs               # browser-module tests (Node 22, no DOM; CI runs them)

uv run scripts/validate.py                    # run every built-in scenario against the LIVE model
                                               # and print a report (~100 calls, well under $0.01).
                                               # Needs TYPESAFE_API_KEY. Use after changing question
                                               # wording, thresholds, or the model version — the
                                               # unit tests use fake answers and cannot tell you
                                               # whether Jev's real answers still make sense.
uv run scripts/check.py                       # rerun the checks saved in Workbench datasets against the
                                               # LIVE model (one call per row); exits 1 when a gate misses
                                               # its targets. Needs TYPESAFE_API_KEY. --list makes no calls.
                                               # <id> --drift rows.jsonl compares unlabeled rows with that
                                               # dataset through its gate (jev/drift.py); exits 1 on a shift.
                                               # --upgrade-to <version> asks each check's tuned-on version and
                                               # <version> every row (jev/upgrade.py); exits 1 if one should stay.
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
(`jev/shield.py`, `jev/dispatch.py`, `jev/claims.py`, `jev/reviews.py`, `jev/counter.py`, `jev/find.py`, `jev/play.py`; Claims
also uses the `box` primitive) follows this same shape:
`questions(...)` builds the request, then a separate pure function (e.g. `shield.verdict()`,
`dispatch.plan()`, `reviews.triage()`) turns already-fetched answers into the decision — that separation is what lets
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
`h()`, `api()` fetch wrapper, the JSON "Inspect" drawer, toasts, the key/settings modal). The drawer's
**Open in Workbench** button (`static/js/handoff.js`) hands the inspected request — state, questions,
pictures, never answers — to the Workbench's Build tab through `localStorage`, with no server route;
`tests/test_handoff.py` checks that every demo's request passes Workbench validation, so a demo that
changes its request shape must keep it acceptable there.

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
(`jev/checks.py`: gates, model, the versioned id that answered the tuning run as `tuned_on`, and
user-chosen targets, never measured results) that the Datasets panel and `scripts/check.py` rerun live,
compares unlabeled new rows with a check's dataset through its gate (`jev/drift.py`, both sides run live), asks a
check's tuned-on version and a newer one the same rows and retunes the gate on the newer one's answers
(`jev/upgrade.py`, both sides run live; moving the check saves thresholds and the version, never answers),
measures how often a second person's blind labels agree with a dataset's and writes the settled ones back
(`jev/agreement.py`, no model calls), holds a random share of a dataset's labeled rows out of tuning as `"_test": true` test rows, scored only on request and
counted (`jev/testsplit.py`; the marker never reaches the model, and checks, drift and upgrade rerun only the other
rows), fits a conformal cut that turns one question's answers into the shortest list that holds the right answer
at a chosen rate, so review chooses among a few options (`jev/answersets.py`), checks consistency rules over a row's answers (`jev/rules.py`: "if A = x then B in y, z", plain code; Policy,
Tune, cost, cross-validation, checks, drift and the exported gate send rows that break one to review),
fits monotone probability maps checked on unseen folds (`jev/recalibrate.py`, without changing routing), runs a
question set over many rows in parallel (`run_bulk`, capped and rate-limited by the same
`SpendGuard`; a row's `_image` picture travels as an asset named `photo` in its state, so Box questions run
too), exports the exact request as runnable Python/JavaScript/curl, and exports a tuned gate as a
Python or JavaScript module whose `decide(state)` routes a row (`jev/gate.py`). Run as a script, that module prints
each decision with its `row`; the Review queue (`jev/decisions.py`) reads those lines back, so a person labels the rows
it sent to review and a random audit sample of the rows it automated, and appends them to the check's dataset.
The queue shows answers read from the user's own decisions file, which their own gate produced; that is their data,
not a canned answer, so never bundle a sample decisions file for the UI to show.
Answer-set cuts can be attached to Policy and saved with checks as `answer_sets` (question IDs to cut/coverage),
then exported as typed `candidates` in gate decisions. They only assist review: thresholds and rules still decide
automation. Review keeps all labels available and hides shortlists on blind audit rows. Model-upgrade proposals
drop fitted cuts so they are refitted on the new model. Persist configuration and human labels, never candidates.
Exported gates accept Bulk's `_image` names, load pictures from a caller-selected directory (the working directory
by default), and send the same `photo` asset reference as Bulk. Samples load as `<name>.png`; uploaded hash filenames
stay unchanged. Pictures stay separate from exported source. Box questions return coordinates but cannot be gated
or shortlisted; Review labels only Choice/Noul/Score and accepts accompanying Box output. Labels and `_test` markers
never reach the model, including direct calls to an exported gate's `decide` function.

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
