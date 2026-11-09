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
                                               # --estimate prints the calls and an upper-bound cost instead of
                                               # running (with --model/--drift/--upgrade-to); no calls, no key.
```

Lint with `uv run --locked ruff check` (configured in `pyproject.toml`; CI runs it). No formatter is
configured; match the existing style (see "Conventions" below).

`tests/test_server.py` binds a loopback port and `uv` writes to `~/.cache/uv`, so run the suite
and `uv` commands outside a sandbox; inside one, the server tests fail with `PermissionError`.
The system `python3` is 3.9 without the SDK, which exercises CI's stdlib-fallback path.

Needs a `TYPESAFE_API_KEY` (get one at console.typesafe.ai) to make live calls; the offline test
suite does not need one. The official `typesafe-sdk` is used on Python ≥3.10; a hand-rolled stdlib
`urllib` client in `jev/client.py` is the fallback on 3.9 — CI (`.github/workflows/test.yml`) runs
the locked-SDK suite on 3.10–3.14, the stdlib fallback on 3.9, and separate Ruff, JavaScript and
sample-picture jobs, so both code paths must keep working. `.github/workflows/audit.yml` audits
`uv.lock` (`uv audit`) on PRs and weekly. Every job runs on Namespace runners
(`namespace-profile-gitrunner`, Ubuntu 24.04), never GitHub-hosted ones.

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
page needs new markup) update the relevant `static/*.html`+`static/js/*.js` pair — each demo page
has one JS file with no shared framework, only the helpers in `static/js/common.js` (DOM builder
`h()`, `api()` fetch wrapper, the JSON "Inspect" drawer, toasts, the key/settings modal). The Workbench
page loads one entry, `static/js/workbench.js` (boot, tabs, `render()`), which imports panel modules
`static/js/workbench-*.js` (build, tests, bulk, import, labeling, datasets, checks, drift, review, calibrate,
costs, policy, compare) that share page state through `W` in `workbench-state.js`; their imports form cycles, so
a module may only declare functions and constants at load time (`tests/js/workbench-modules.test.mjs`). The drawer's
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
fits monotone probability maps checked on unseen folds (`jev/recalibrate.py`, without changing routing), retunes a
Policy gate with each question's threshold off and with the question dropped, and lists the request's questions no gate
or rule reads (`jev/prune.py`, no model calls; a live Compare confirms a shorter request), runs a
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
Portable dataset bundles (`jev/bundles.py`) contain only dataset inputs, human labels, question and gate
configuration, test-split history, and referenced pictures. Never include model answers, measured check
results, or application credentials. Preview imports before saving and require explicit replacement of
an existing dataset. Bundled sample pictures become content-addressed uploads so their exact bytes travel
without replacing built-in sample files.
Drift's **Label new traffic** queue carries the full weak-support inputs and their picture names from
the comparison run, with blank human-label controls. Its append endpoint saves inputs and human labels
only, deduplicates against all saved rows (including test rows), and preserves the check and test history.
These targeted rows are not a random audit and must never produce audit-accuracy statistics. Adding
labels makes no model call; rerunning the check is explicit. Saved held-out row identities are excluded
from new-traffic comparisons even when pasted without their `_test` marker.

Spend previews (`jev/estimate.py`, `POST /api/workbench/estimate`, `static/js/estimate.js`, `scripts/check.py
--estimate`) count the calls a paid Workbench run would make and add up `client.request_reserve_usd` for the exact
requests it would send, built through the run's own helpers (`workbench.prepare_bulk`/`prepare_compare`/`job_state`,
`checks.load`, `drift.prepare`, `upgrade.prepare`) so counts, test-row exclusion, the 200-row cap and image uses match
the run. Estimates make no model call (not even the model-list check) and never reserve or record budget; they only
read the guard's snapshot. They are upper bounds: always show them as "≤"/"at most"/"upper bound", rounded up, and
never as measured spend. A run whose bound exceeds the budget left needs an explicit confirm before it starts.

Dataset health (`jev/health.py`, Bulk's **Check dataset health**) inspects current inputs and human labels
without model calls or writes. It reports duplicates, conflicting or invalid labels, missing labels, and
identical inputs across tuning/test rows using row numbers only; never reveal held-out label values
in health reports. Findings are advisory and fixes stay manual. Reports must match the current rows
and selected questions; hide them when either changes.

New test splits keep exact-input groups together, including unlabeled copies, using the same identity as
dataset health and Review (labels and test markers ignored, picture names retained). Select the closest
feasible labeled-row count to the requested share, with at least two labeled rows on each side, and show
the actual share. Existing splits are never regrouped automatically; impossible splits must leave files unchanged.

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

Cross-validation keeps exact-input groups together across threshold/cost tuning, answer sets,
recalibration, and model upgrades. Use the dataset-health/Review identity (labels and test markers
ignored, JSON field order ignored, picture names retained). Assign larger groups first to the
least populated fold, breaking ties by input hash. Require at least one distinct labeled input
per fold as well as the total labeled-row minimum; report why unseen evaluation is unavailable.
Do not silently fall back to splitting duplicate copies between tuning and evaluation.

Saved checks may require `slice_targets` (top-level input field/value plus minimum accuracy and
coverage), using By slice's full normalized value identity and the check's shared confidence basis.
Every required slice must pass; missing or unevaluable slices prevent a pass. Score the current
run's tuning answers only, with no extra calls or held-out rows. Preserve slice configuration in
bundles and model upgrades, and enforce it on upgrade proposals. Persist no measured slice results.
Slice targets evaluate batches; exported per-row gates still route by thresholds and rules.

Exported gate decisions carry versioned configuration provenance (questions including Choice option order,
requested model, thresholds, signal, rules, and answer-set cuts). Review rejects mismatches both when
reading and appending. Legacy review rows without provenance require manual labels and supply no
shortlists; legacy automated rows are excluded from audit sampling and scoring. Provenance identifies
configuration, not file authenticity or an alias's resolved model version. Save only inputs and human
labels in datasets, never provenance, model answers, or measured audit results.

Review queue CSV handoff exports inputs and blank human-label columns only, never model answers,
shortlists, or decision metadata. Import matches the current queue's row and gate configuration,
validates labels before applying them, and preserves review/audit membership. Preview and apply
make no dataset write or model call; normal append saves inputs and human labels only.

Review audit slices describe completed, verified blind audits in the submitted batch, grouped by
the existing full normalized input-value identity. Show counts, accuracy and 95% intervals only;
never infer automation coverage or saved slice-target passes from an automated-only sample.
Reports are ephemeral and make no model calls. Queue filters and navigation change presentation
only: preserve labels, audit membership, CSV handoff, and the set of ready rows eligible to append.

Dataset health by slice reports row and distinct-input counts and per-question valid/missing/invalid
label counts separately for tuning and held-out rows, without label values. Slice values appear only
after a field is selected, using By slice's full normalized value identity and display-only truncation.
Labels and test markers cannot be slice fields. Reports are ephemeral, make no model calls or writes,
and are hidden when rows, questions, labels, or the selected field change.

Pre-run labeling (`jev/prelabel.py`) fills only missing Choice/Noul/Score human labels on tuning
rows, with blank controls and no model calls or file writes. Preserve existing labels (including
invalid ones), duplicate positions, input data, pictures, and held-out markers. Held-out rows and
array states never enter the editable queue. Slice filtering uses full normalized input values;
drafts survive filters but belong to the current rows/questions snapshot. Apply changes the rows
editor only, invalidates old Bulk results and health reports, and requires explicit dataset saving.

Pre-run labeling CSV handoff exports eligible tuning inputs, a missing-question list, and blank
human-label columns for the current slice. Imports match the full rows/question snapshot including
Choice order and duplicate positions, validate all labels, and preview before merging into drafts.
Never export existing labels or held-out inputs. Blank cells preserve drafts; Apply and dataset
Save remain explicit, with no model calls or file writes from export/import. Labeling filters and
next-row navigation change presentation only and preserve drafts across slices. The Workbench
guide only navigates existing panels; it never runs, labels, saves, or changes configuration.

Pre-run labeling draft downloads carry eligible tuning inputs, the question schema, and human draft
labels across all slices; exclude existing labels, held-out inputs, and model answers. A hash binds
restores to the full original rows/questions snapshot, including labels, held-out markers, duplicate
positions, and Choice order. Preview and accept only merge validated drafts; Apply and Save remain
explicit. Pictures travel separately. Warn before unload when current unapplied drafts exist.
Labeling keyboard shortcuts act only inside that panel, preserve native editing behavior, and only
navigate incomplete rows within the current slice; they never apply, save, or call the model.

Labeling guidelines (`jev/guidelines.py`, `static/js/guidelines.js`) are a dataset's optional `guidelines`:
question id -> note and generic examples with valid Choice/Noul/Score labels (Box takes a note only). They are
human-only: never send them to the model (Bulk, checks, drift, upgrade, Compare, request export) and never make
them gate configuration, so exported gates and decision provenance must not change with them. Show them collapsed
beside label controls; on blind audit and agreement rows hide examples matching the row. Bundles carry them, check
saves and upgrades preserve them, a save without them keeps the saved ones, and guidelines for removed questions
are dropped with a warning naming the question. Replacement previews and warnings report question ids and counts,
never notes, examples, or label values. The labeling CSV handoffs do not include them.

Dataset replacement previews use the same candidate validation as saving, show counts and configuration
changes without label values, and make no writes or model calls. Match exact input occurrences in order
so duplicates remain distinct, with picture names included. Saving a previewed replacement verifies the
saved file revision under the dataset update lock; changed files require another preview. Preserve the
existing explicit replacement, check compatibility, and test-history semantics.

Dataset revision history (`jev/history.py`) is the undo for dataset files. Every write that replaces or
deletes a dataset goes through `workbench.write_dataset`/`delete_dataset`, which first copy the current file
byte for byte to `data/workbench/datasets/.history/<id>/<timestamp>-<hash>.json` under the dataset update
lock; a new dataset writer must go through them too. Revisions contain only what dataset files contain
(inputs, human labels, configuration), never model answers or measured results. Keep the newest 20 per
dataset, skip unchanged writes and identical consecutive copies, write atomically, and validate ids and
revision names. Deleting keeps history so the delete can be undone. `.history` is gitignored local state:
never list it as a dataset, bundle it, or accept it as an id. Listings and restore previews show counts and
configuration changes only, never label values. Restore validates the revision with `prepare_dataset`,
reports the `dataset_changes` summary, and requires the preview's file token (a changed file needs another
preview). It restores the revision's own check and labeling guidelines where they fit (drops are reported,
never written), keeps every test look recorded since (looks
never shrink), and snapshots the current file first, so a restore is itself undoable.

Review session recovery downloads human edits only, never suggested model labels, answers, or shortlists.
Restore requires the original decisions text and the same dataset/check snapshot, validates before preview,
and preserves the original random audit membership and blind labeling behavior. Download/restore make
no model calls or dataset writes; accepting a restore changes the queue only, and Add stays explicit.
Review input-slice filters, per-question progress and keyboard navigation change presentation only;
full normalized slice identities preserve labels across filters. Warn before leaving or replacing a
queue with unsaved human edits, including check saves/removal/upgrades, bundle replacement, dataset
deletion and history restore; cancel before any saved configuration changes. Pictures travel
separately from session files.

Workbench input repairs (`jev/dataset_edits.py`) are separate explicit editor actions: prepare,
preview, then apply invalid/conflicting Choice/Noul/Score tuning-label corrections or redundant-copy
cleanup. They make no model calls or dataset writes. Exclude entire input groups containing a
held-out copy. Cleanup requires identical input identity and identical full label maps; never choose
between conflicting labels automatically. Preview binds rows, labels, markers, pictures and ordered
questions; Apply verifies the preview and clears stale Bulk results. Saving remains explicit.
Bulk preflight (`jev/preflight.py`) reads the same capped request states and picture references as
Bulk, reports row numbers/paths without label values, and makes no calls or writes. Findings are
advisory and require a deliberate continue before paid Bulk runs.
Build drafts contain request inputs, ordered questions and pictures only; validate and preview
before explicit replacement. Reject duplicate question IDs/Choice keys before serialization, and
mark answers from changed requests as outdated, including edits during in-flight requests.
Agreement session recovery contains human second labels and explicit settlements only, bound to
the saved dataset/schema and original blind sample. Restore does not reveal saved labels until
Compare. Guard unsaved agreement edits before leaving or replacing their saved configuration.
Compare slices reuse successful paired tuning answers and the selected confidence basis. Disagreement
handoffs carry original inputs and blank label controls, never model suggestions; preserve existing
labels, duplicate positions, pictures and held-out markers. General labeling CSV/draft/apply retains
the full source snapshot. Saved-item search/filtering changes presentation only, preserving edits.
