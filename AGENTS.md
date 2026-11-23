# Agent instructions

Jev Lab is a public repository (`BrendanH18/jev-lab`) with eight demos and a Workbench for TypeSafe's
Jev model. It uses a stdlib Python HTTP server, the official SDK on Python 3.10+, and vanilla
JavaScript and CSS with no build step. All demos use the fictional Harbor Coffee Co. Keep secrets,
private data and personal notes out of the repository. [CONTRIBUTING.md](CONTRIBUTING.md) is the
guide for human contributors. Agents follow this file.

## Commands and CI

Run builds, tests, untrusted code, Docker and long jobs on Boat. See the sandbox rules below.

```sh
scripts/boat-check.sh -- CMD             # a targeted check while working
scripts/boat-check.sh                    # full check: reproduce CI failures, refresh with --save
scripts/boat-check.sh --status            # inspect without starting a sandbox
scripts/boat-check.sh --done              # delete the sandbox when work in the worktree ends
scripts/boat-check.sh --save              # check and refresh the warm snapshot
```

Use these commands inside the sandbox. The offline tests need no key or external API calls.

```sh
uv run --locked server.py                # http://127.0.0.1:8321
uv run --locked python -m unittest discover tests
uv run --locked python -m unittest tests.test_workbench -v
uv run --locked python -m unittest tests.test_workbench.ItemTests.test_save_list_run_delete
uv run --locked node --test tests/js/*.test.mjs tests/js/lab/*.test.mjs
npx playwright test                      # headless Chromium, real app and loopback model stub
node scripts/lab_inventory.mjs           # regenerate JavaScript Lab page indexes
uv run --locked scripts/lab.py --help     # offline Lab commands
uv run --locked ruff check && uv run --locked ruff format --check
npm run lint                             # Biome
uv run --locked ruff format && npm run format
```

For a cold sandbox, use `uv sync --locked && npm ci && npx playwright install --with-deps chromium`.
Biome and Playwright are the only npm dependencies and are pinned for development. Match Biome's
version in `biome.jsonc`'s `$schema`. Fix all lint and format findings.

### Checks while working and at hand-off

Owner decision (2026-11-22): CI is the gate. It runs the full suite once on every pushed commit, and
`main` requires its **All tests passed** check. Don't run the full `scripts/boat-check.sh` before
handing work back. Every check it runs is a `test.yml` job, and CI also runs the SDK suite on
Python 3.10–3.14.

- While working, run targeted checks on Boat with `scripts/boat-check.sh -- CMD`: the tests that
  cover the code you changed and lint for the areas you touched. Join them into one command, since
  each call may resume the sandbox.
- Python: `uv run --locked python -m unittest tests.test_<module>` for each affected module, plus
  `uv run --locked ruff check && uv run --locked ruff format --check`.
- JavaScript, CSS and JSON: `uv run --locked node --test tests/js/<area>.test.mjs` (or
  `tests/js/lab/*.test.mjs` for Lab) and `npm run --silent lint`. After changing Lab packs or
  surfaces, run `node scripts/lab_inventory.mjs` in the worktree so the regenerated indexes are part
  of the change. Files a check writes on Boat never come back. For changed browser modules, also run
  `node --input-type=module --check < static/js/<file>.js`.
- Browser flows: `npx playwright test tests/browser/<flow>.spec.mjs` for the flows a change touches.
  The warm snapshot has Chromium. A cold sandbox needs `npx playwright install --with-deps chromium`.
- Sample pictures: after changing `scripts/draw_samples.py` or `static/img/samples`, run
  `python3 scripts/draw_samples.py && git add --intent-to-add static/img/samples && git diff --exit-code --stat static/img/samples`.
- CI runs the full suite on every pushed commit. When a CI job fails, reproduce that job or its
  failing test on Boat with the script and fix it. Use the full check only to reproduce CI failures
  or with `--save` to refresh the warm snapshot.
- CI doesn't cover these. Do them before hand-off when they apply. For changes that alter visible UI,
  inspect the affected pages at desktop and narrow widths as
  [CONTRIBUTING.md](CONTRIBUTING.md#checks-on-boat) describes. This is computer use, so delegate it to
  Codex with GPT-6.2 Astra (`gpt-6.2-astra`). Run `scripts/boat-check.sh --save` after changing `uv.lock`, `package-lock.json`, Node or
  Python. Run the live `scripts/validate.py --strict` only when the owner asks (see Live model runs).
- In the hand-off report, list the targeted checks that ran and say that CI runs the full check.

### CI

- Use standard GitHub-hosted `ubuntu-24.04` runners for this public repository. Paid larger runners
  are prohibited. The locked-SDK suite runs on Python 3.10–3.14. The browser suite has its own job.
- The required **All tests passed** job depends on every other job in `test.yml` and runs lint,
  format, Node 22 syntax and tests, and sample-picture checks. Add any new test job to its
  `needs`. Put checks that take seconds in that job as steps to save runner starts.
- Keep the `uv.lock` audit and CodeQL workflows. Both run on PRs and weekly. CodeQL also runs on
  `main` and covers Actions, JavaScript and Python. Leave GitHub's CodeQL default setup off.
  Never put a model key in GitHub secrets or call the live model from CI.

## Cloud sandboxes (Boat)

`scripts/boat-check.sh` reads `boat limits --json` itself. Run `boat limits` before a hand-run `boat new`
or `boat run` and get prices from the current output.
The owner's daily starts are shared across projects. [Boat documentation](https://docs.boat.dev/llms.txt)

- Reuse one sandbox per worktree with `scripts/boat-check.sh`. Its ID lives in the worktree's Git
  directory and must never be shared with another agent or worktree. The first check starts from
  `jev-lab-warm` (uv, Node 22, locked venv, Biome, Playwright and Chromium) or starts cold. Each
  later check pushes to a fresh directory and runs with `boat exec --timeout 0`.
- The script uses `--no-env`. Check sandboxes receive no GitHub, agent or model credentials. The
  full check runs every `test.yml` job even when one fails and exits nonzero on any failure. Its SDK
  suite runs on one Python version, which the check prints. Use CI for version-specific failures.
- The sandbox runs only during a check and stops when it ends, pass or fail. A stopped sandbox
  bills nothing. A check within 10 minutes of the stop usually takes the kept machine back without a
  start, and a later one resumes for one start. Never keep a sandbox running to save a start.
  `JEV_BOAT_IDLE` (seconds, default 0) keeps it running and billed after a check. Set it only when
  the owner asks. `--save` saves `jev-lab-warm` without the checkouts. Refresh it after changing
  `uv.lock`, `package-lock.json`, Node or Python.
- If `scripts/boat-check.sh` exits 3 because starts are exhausted, limits cannot be read, or
  `nextStartDollars` is positive, report what still needs a Boat run and stop retrying.
  Set `JEV_BOAT_PAID_START=1` only when the owner approves a paid start. The script already
  retries transient capacity and in-progress resume/stop errors using `--fail-fast`.
- Reserve `boat run --no-env --from jev-lab-warm --push . -- CMD` for a genuine one-off. It costs
  a start and bypasses the guarded push. First verify that
  `git status --porcelain --untracked-files=all -- data/workbench` prints nothing.
- Name every hand-created sandbox `jev-lab-<purpose>` using `boat new --name`. Immediately rename
  any sandbox kept by `boat run --keep` with `boat rename <id> jev-lab-<purpose>`.
  The check script already names its sandboxes `jev-lab-check-<worktree>`.
- Pass the sandbox ID explicitly. `boat exec "$id" "CMD"` has a 30-second default timeout.
  Use `--timeout 0` to lift it. Start the server with `boat exec "$id" --detach "CMD"` and
  inspect it with `boat exec "$id" --status <pid>`.
- View the UI in the sandbox's Chrome or use `boat forward` to the same port on the Mac.
  Never use `boat host` or the in-sandbox `host` for this server.
- `boat push` skips gitignored `.env`, datasets and dataset revisions. It copies saved tests
  (`data/workbench/*.json`) and uploaded pictures (`data/workbench/images/`) even when untracked.
  The check script rejects staged, modified or untracked files under `data/workbench`. Use a
  clone in Boat when local files hold real inputs. Never copy real rows, labels or pictures to Boat.
  Use synthetic or approved datasets for live checks.

### Live model runs

Run live checks only at the owner's request in a separate sandbox from `jev-lab-live`. This
environment injects only its own variables (`TYPESAFE_API_KEY`). Push only committed files and
always delete the sandbox afterwards. Never reuse the check sandbox, read key values from `.env`,
pass them on the command line, or copy `.env` to a sandbox.

```sh
(
  set -eu
  boat limits
  src=$(mktemp -d) id=""
  trap 'if [ -n "$id" ]; then boat delete "$id" --yes; fi; rm -rf "$src"' EXIT
  trap 'exit 130' INT TERM
  git archive HEAD | tar -x -C "$src"
  id=$(boat new --environment jev-lab-live --name jev-lab-live-validate --fail-fast --json | jq -r '.id // empty' | head -n 1)
  boat push "$id" "$src" --to /home/user/jev-lab
  boat exec "$id" --timeout 0 "cd /home/user/jev-lab && uv run --locked scripts/validate.py --strict"
)
```

Use `scripts/validate.py --strict` after changing demo questions, thresholds, examples or the
model version. Every built-in scenario must pass on the live model. Strict mode fails on a miss or
an incomplete scenario. It checks the account's listed Jev names against the alias and price tables
before making paid calls, then verifies the version reported by the responses. Unit tests exercise
logic with fake answers and cannot verify model judgments.

`scripts/check.py` reruns saved Workbench checks with live calls. Its options and exit codes are in the
[Workbench guide](docs/workbench.md#keep-a-gate-as-a-check).

## Architecture and security

- Route all TypeSafe access through `jev/client.py`'s `JevClient`. Every live call goes through
  `SpendGuard.check()` and `record()`. `JevResult.meta()` reports usage and `trace()` feeds
  **Inspect JSON**.
- Build `state` and `noul`/`choice`/`score`/`box` questions, ask for judgments in one
  `system_one()` call, then turn answers into decisions in pure code. Keep calculations, dates,
  extraction and business rules in code so users can reevaluate saved answers without another call.
  Workbench saved-test runs make fresh calls.
- Autopilot merges prefixed Shield and Dispatch questions into one call and evaluates integrated
  and Dispatch-only pipelines in independent `World` instances. They must stay separate from the
  server's shared `dispatch_world`. The benchmark deliberately makes fresh calls.
- Add JSON handlers to `server.py`'s `ROUTES`. `BadRequest`, `WorkbenchError` and `EnvFileError`
  produce 400s. `JevError` carries the model error status. Use the existing `static/*.html` and
  `static/js/*.js` entries and the shared helpers in `static/js/common.js`.
- Workbench panel modules share `W` from `workbench-state.js`. Their cyclic imports permit
  only declarations of functions and constants at load time. `tests/js/workbench-modules.test.mjs`
  checks this. **Open in Workbench** transfers state, ordered questions and pictures through
  `localStorage`, with no answers or server route. Keep demo requests compatible with
  `tests/test_handoff.py`.
- Keep the bind address at `127.0.0.1` and the existing loopback Host allow-list on the configured
  port. Keep the `jev/security.py` checks before route handling, including Origin, Fetch Metadata,
  the per-process `X-Jev-Token` and the JSON body requirement. [SECURITY.md](SECURITY.md)
- Only `jev/envfile.py` may persist secrets. Its preflight checks that `.env` is ignored and
  untracked, and it writes atomically with `0600` permissions. Always redirect
  `server.PROJECT_ROOT`, `Settings(env_file=...)` and `jev.config.WORKBENCH_DIR` to temporary
  paths before constructing a test or development server. See `tests/test_envfile.py`.

Module responsibilities and request flow are in the [architecture guide](docs/architecture.md).

## Workbench invariants

Read the relevant sections of the [Workbench invariants](docs/workbench-invariants.md) before
changing these workflows.

- Show only model answers from calls the current user triggered, or from their own gate decisions
  file in Review. Keep answers and derived results ephemeral. Never add replay data or a cache.
- Persist inputs, human labels, configuration and documented bookkeeping. Keep answers, measured
  results, shortlists and application credentials out of saved datasets, tests, bundles and drafts.
- Strip human labels, `_test` markers and labeling guidelines at each model boundary, including
  exported gates. Keep pictures out of source exports.
- Keep held-out rows outside tuning, audit samples and label handoffs. Reveal held-out metrics
  only on explicit scoring and record each look. Keep held-out label values out of reports and previews.
- Use the shared exact-input identity for health, splits, cross-validation and Review. Ignore labels,
  test markers and JSON field order and retain picture names. Keep identical inputs in the same
  fold or split group and preserve duplicate positions elsewhere.
- Bind previews to validated current inputs, ordered questions and saved revisions where applicable.
  Confirm replacements explicitly. Use the dataset update lock and history-aware write helpers.
- Build spend previews from the same requests and explicit selection the run will use. Show an
  upper bound rounded up and require explicit confirmation when it exceeds the budget left.
- Retry only explicitly selected unanswered calls against compatible requests and model versions.
  Preserve successful answers in the current session. A changed selection needs a new preview.
- Filters, sorting and navigation change presentation only. Preserve edits, hidden selections and
  audit membership. Guard unsaved work before a queue or its saved configuration changes.
- Keep imports and handoffs within their documented field allowlists. Preserve independent blind
  audits and reveal only audit measures supported by the sample.

## Lab packs

- Lab is frozen under the [roadmap](docs/roadmap.md). Fix or delete existing packs and features.
  Adding packs or features is outside the freeze.
- JavaScript packs default-export `definePack` from `static/js/lab/kit.js`. The kit and Lab
  libraries are their only imports. Packs reach the page solely through the `ctx` described by
  `static/js/lab/surfaces/`. Do not expose the DOM, storage, network or paid actions through it.
  Pages use `W.lab` or their generated `LAB`. An unrefined list must retain its baseline behavior.
- Python packs use `jev/lab/kit.py` and never import `jev.client` or use the network. CLI packs
  load through the app's loaders and honor `--data-dir`. Keep findings in the report's `lab`
  field. Lab preflight notes never trigger a run confirmation.
- Lab never calls the model or spends budget, including indirectly through page commands. Pure
  rescoring and replanning are allowed. Its filters, sorts, drafts, previews and tools stay in the
  page session. Chrome stores only the theme preference. Exports follow the Workbench boundaries.
- Verify retained quantitative tools with independent reference values. `tests/js/lab/registry.test.mjs` and
  `tests/js/lab/surface-no-model-calls.test.mjs` enforce pack and surface isolation.
- Run `node scripts/lab_inventory.mjs` after changing JavaScript packs or surfaces. Never edit generated
  `static/js/lab/pages/*.js`. Biome skips these files and the JS tests check the generated indexes.

## Conventions

- Ask before adding a dependency, tool or service and explain the trade-off and preferred option.
  Playwright is approved as a dev-only browser test dependency.
- Use system fonts and keep web fonts, CDNs and other third-party asset requests out of the app.
- Type Python signatures and add `from __future__ import annotations` to every `jev/*.py` module.
  Follow the surrounding string formatting style. Ruff and Biome own layout. Source regex tests
  must tolerate formatter line breaks and optional trailing commas.
- Use reserved `.example` domains and emails in fictional data, scenarios and tests.
  Official service endpoints and documentation links may use real domains.
- Keep project rules and durable knowledge in tracked files, with no agent memory or local notes.
  `CLAUDE.md` contains only `@AGENTS.md`. Track instruction files, shared settings, hooks and
  scripts. Ignore machine-local settings and worktrees.
