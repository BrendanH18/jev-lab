# Roadmap: December 2026 – May 2027

Written 2026-11-20 at `d857cba` (#94). It combines three independent audits of the repository: Claude
Opus 5.5 (author), GPT-6.2 Sol and Gemini 4 Neon. Each reviewer measured the code on its own and none
saw the others' conclusions. Every number below was rechecked against this checkout. The maintainer's
decisions of 2026-11-21 (see [Decisions](#decisions)) are folded into the plan.

## In one paragraph

Jev Lab has shipped 93 commits in nine weeks. The demos and the Workbench's evaluation lifecycle
(datasets, checks, drift, upgrades, blind review, exported gates) are a coherent, well-guarded product.
Since early November, though, most of the effort has gone into counting features: seven "30/100
improvements" PRs, then Lab (#81, #82), which added 6,302 numbered capabilities and about 144k lines.
Lab is now 73% of the product code and the eight demos are under 5%. The next six months should
**stop growing the feature count and make what exists correct, verified against the live model, fast
to load and easy to learn.** All three reviewers reached this conclusion independently.

## Audit

### There is no written roadmap

No ROADMAP file, milestone or roadmap issue exists. The de facto roadmap is the stream of merged PRs,
the 16 `docs/*-improvements*.md` files and the rules added to `AGENTS.md`. Only two items are open:
bug #91 and Dependabot PR #86.

| Phase | When | PRs | What happened |
| --- | --- | --- | --- |
| Demos | Sep 17 – Nov 4 | #1–#47 | Six demos grow to eight (Reviews #45, Counter #47 are the last) |
| Workbench lifecycle | Oct 24 – Nov 10 | #13–#72 | Compare, Policy, checks, drift, upgrade, review, bundles, history, splits, retries |
| Feature-count waves | Nov 8 – Nov 12 | #73–#80 | Batches of 30 or 100 filters, sorts, presets and metadata exports |
| Lab | Nov 13 – Nov 15 | #81, #82 | 6,302 numbered improvements in 198 packs, about 144k lines |
| Hygiene | Nov 16 – Nov 21 | #83–#94 | Biome/Ruff, required CI, Dependabot, Boat, secret-scanning ignores, Compare retries |

### Where the code is

| Area | Lines | Share of product code |
| --- | ---: | ---: |
| Lab (`static/js/lab`, `jev/lab`) | 134,510 | ~73% |
| Workbench core (16 `workbench*.js` modules alone: 19,285) | ~35,000 | ~19% |
| Eight demos (Python modules + JS entry scripts) | ~6,700 | ~4% |
| Server, client, security, CSS | ~4,200 | ~2% |
| Tests | 128,694 | (930 Python test methods, 266 JS test files) |

### Findings

1. **Feature count is rewarded over value.** The Lab inventory counts "filter by min", "filter by max"
   and "sort" as three improvements. The Overview had a pack that filtered app cards by their bullet
   count. The kit's isolation contract (packs can't touch the DOM,
   network or model) is sound and worth keeping. What should go is the per-item counting incentive.
2. **Statistical correctness is at risk because of that scale.** Bug #91: the audit planner recommends
   681 rows where 1,109 are needed, because the unconstrained Neyman formula ignores a stratum that runs
   out of rows. Its own test didn't catch it. The Workbench helps people decide how much to automate,
   so wrong numbers do real harm. With about 500 Toolbox calculators reviewed at this speed, #91 is
   unlikely to be the only one.
3. **The live model has no automatic check.** CI uses only fake answers. `scripts/validate.py` covers all
   eight demos, but `main()` returns 0 whenever the calls complete, however bad the answers are
   (`scripts/validate.py:401`). Nothing runs it on a schedule. Model aliases and prices are hard-coded
   in `jev/client.py:53-68` (`jev-latest` → 1.14.0) and change only when someone edits them. Yet
   AGENTS.md says a scenario isn't correct until it passes live.
4. **The Workbench loads 168 ES modules (4.28 MB) up front.** The generated
   `static/js/lab/pages/workbench.js` imports every pack at boot. The server speaks HTTP/1.0 (no
   `protocol_version`) and sends `Cache-Control: no-store` on static files (`server.py:1220`), so every
   reload fetches everything again over new connections.
5. **The Workbench UI is hard to change safely.** The three largest modules are `workbench-build.js`
   (2,855 lines), `workbench-datasets.js` (2,371) and `workbench-compare.js` (2,119). They share the
   mutable `W` state through cyclic imports. Only a load-time rule and Node tests without a DOM guard
   them. No test runs in a real browser.
6. **Agent instructions and docs have turned into a changelog.** `AGENTS.md` is 524 lines and about
   6,000 words. 233 of those lines are "Workbench data boundaries", added one paragraph per PR. Every
   agent session loads all of it. The docs add up to 16 improvement shards, an 1,883-line
   `docs/workbench.md` and a 7,500-line Lab inventory. They are already drifting:
   `docs/architecture.md:117` and `docs/workbench.md:1177` still describe datasets as committed,
   although #92 gitignored them.
7. **New users have a hard start.** The README's Workbench row is one 110-word sentence, and the
   Workbench has 14 panels. Nothing leads a new user from "try a demo" to "ship an exported gate", even
   though Open in Workbench, `jev/gate.py` and `scripts/check.py` already cover that whole path.
8. **Security and CI are in good shape.** Loopback bind, Host/Origin checks, CSRF token, atomic `0600`
   key writes, the spend guard, CodeQL, `uv audit`, Dependabot, a required aggregate check and
   Namespace runners are all in place, and CI is green in 2–5 minutes. Two gaps remain. The CSP allows
   Google Fonts (`server.py:1199`), so a local app contacts a third party. Saved tests and uploaded
   pictures under `data/workbench/` can still be committed by accident.

### Where the reviewers differed

| Topic | Sol | Neon | Resolution in this plan |
| --- | --- | --- | --- |
| New demos | Stop entirely | Add 1–2 in March | None until the live gate exists; at most one in May, and only if it's green |
| Browser tests | Smoke paths in Boat | Playwright in CI | Playwright in CI, approved (D1) |
| Lab | Freeze; retire controls based on observed friction | Freeze, lazy-load, prune to ~20–30% | Freeze now and prune harder than either in January: keep ≤10% (D5) |
| Python 3.9 fallback | Keep | Drop (3.9 is EOL; `pyproject.toml` already needs ≥3.10) | Drop in December (D2) |
| Live checks in CI | Strict mode, run on Boat | Scheduled CI job | No key in GitHub: strict runs stay manual on Boat (D3) |
| Main measure of success | 4 of 5 newcomers finish unaided | Load size, AGENTS.md size, browser coverage | Both. The newcomer test is run informally, since there is no user panel |

## Principles for this cycle

- **Feature freeze on breadth.** No new Lab packs, no "N improvements" PRs and no new filter, sort or
  preset micro-controls. Bug fixes, deletions and consolidations are welcome.
- **Correct before clever.** Every quantitative output either has an independent reference test or
  is removed.
- **Live evidence for live claims.** Changes to a demo, wording or model need a recorded live run.
- **One path, taught well.** Choose the newcomer path first, then simplify everything else around it.
- The hard constraints don't change: loopback-only stdlib server, no canned answers, no frontend build,
  GitHub-hosted CI, no new dependencies without approval.

## Month by month

### December: correctness and accurate docs (P0)

- Fix #91 with one feasible-allocation function shared by the sample-total and allocation tools. Its
  regression test checks that the fixture's total meets the margin and that one row fewer misses it.
- Audit the retained Toolbox calculators (`tb-sample-sizes` and `workbench-toolbox-starter`)
  and the shared math in `jev/lab/mathx.py` and `static/js/lab/lib/math.js` using independent
  reference values. Fix whatever fails or remove the control.
- Add `scripts/validate.py --strict`: exit non-zero when a scenario misses its expectation or doesn't
  finish.
- Merge or close #86. Fix the stale dataset wording in `docs/architecture.md` and `docs/workbench.md`.
- **Drop the Python 3.9 stdlib fallback (D2).** Delete the `urllib` backend in `jev/client.py` so the
  official SDK is the only client, remove the 3.9 CI job from `test.yml` and from `All tests passed`'s
  `needs`, and update AGENTS.md, README and CONTRIBUTING.
- **Use system fonts (D4).** Remove the Google Fonts `@import` from `static/css/app.css`, switch to a
  system font stack, take both font hosts out of the CSP (`server.py:1199`) and update `SECURITY.md:58`.
  The local app then makes no third-party requests.
- **Restructure `AGENTS.md`.** Reduce the 233 lines of Workbench boundaries to about ten general
  invariants: never persist or replay answers; labels and `_test` markers never reach the model; held-out
  rows never leak; preview before any write; a paid run and its estimate use the same explicit selection;
  filters change presentation only; duplicate inputs share one identity. Move the per-feature detail into
  a tracked `docs/workbench-invariants.md` that AGENTS.md links to. Target: under 250 lines.

### January: prune Lab hard, a manual live check and a fast load (P0)

- **Prune Lab hard (D5).** Lab is isolated behind its kit (packs reach a page only through `ctx`), so
  deleting packs can't break the core workflows. A pack survives only if it does all of these:
  - serves a step on the newcomer path or a documented Workbench workflow (calibrate, Policy, checks,
    review, drift, upgrade);
  - doesn't repeat a panel's own control or another pack as a min, max or sort variant;
  - has reference-value tests when it computes a number.

  Apply the same rules to the 36 Python packs and the `scripts/lab.py` commands. Target: keep at most
  20 of the 198 JavaScript packs and under 15,000 Lab lines in total. Delete the numbered inventory in
  `docs/lab/` and the rule of one test per numbered improvement, because the count is no longer a goal.
  If the survivors fit naturally in their panels, fold them in and retire the Lab layer altogether.
- **Live checks stay manual (D3).** There is no API key in GitHub and no live job in CI. Any PR that
  changes demo wording, thresholds, examples or the model runs `scripts/validate.py --strict` on Boat,
  in its own sandbox from the `jev-lab-live` environment (D7). The PR description records the revision, the
  version that answered, pass and miss counts, and spend. The same run compares `GET /v1/models` with
  `ALIASES` and the price table in `jev/client.py`, and fails when a Jev version appears that the code
  doesn't know about.
- Set `protocol_version = "HTTP/1.1"`. Serve static files with ETag revalidation, and keep `no-store`
  on HTML (which carries the CSRF token) and `/api/*`.
- If the Workbench boot still loads more than 25 modules or 500 KB after pruning, lazy-load the
  remaining packs the first time a Lab disclosure, the Toolbox or the command palette opens.

### February: browser smoke tests and Workbench structure (P1)

- Write four browser smoke paths: a demo → Inspect → Open in Workbench → run; a Bulk run with a
  simulated partial failure, then a retry; dataset replace → history restore; Review session download
  → restore. Each checks for no console errors and that labels and drafts survive. They use
  Playwright (D1): `@playwright/test` pinned in `package.json` as a dev dependency next to Biome. A new
  CI job on `ubuntu-24.04` installs Chromium, starts `server.py` on loopback with a
  temporary data directory and a fake model backend, and joins `All tests passed`'s `needs`. Agents
  run the affected specs on Boat. The app keeps its zero runtime dependencies on the frontend and no build step.
- Split `workbench-build.js`, `workbench-datasets.js` and `workbench-compare.js` along their existing
  seams (editor, catalog, retries). Replace cross-module reads of `W` with a few named actions in
  `workbench-state.js`. Target: no module over 1,200 lines, and the cycle count falling.

### March: one path for newcomers (P1)

- Choose one guided path and make it excellent: **Reviews → Inspect JSON → Open in Workbench → Bulk
  over sample rows → Policy → export the gate → `scripts/check.py`**, with Autopilot as the next step
  for composition.
- Add a Workbench **Basic** view showing the panels on that path (Build, Bulk, Policy, Export, Checks),
  with **Advanced** revealing the rest. Visibility only; no data or behavior changes.
- Rewrite the README's Workbench section as five short steps. Fold the 16 `docs/*-improvements*.md`
  files into one `CHANGELOG.md`. Restructure `docs/workbench.md` into a short tutorial plus a reference.
- Measure: walk three or four people (or fresh agents playing newcomers) through the path. Aim for
  most of them to finish unaided in under 10 minutes, and record where they get stuck.

### April: a second pruning pass and the route to production (P2)

- Prune again using the March walkthroughs: delete surviving Lab packs and Workbench controls that no
  tester used and no documented workflow needs.
- Make the exported gate the documented way to graduate: `scripts/check.py --format json|github` for
  users' own CI, and one worked example in the docs from synthetic `.example` data to a passing check.

### May: refresh, release and replan (P2)

- Rerun `validate.py --strict` on the current model and refresh the demos where wording has slipped.
  Consider one new demo only if the live gate has been green since January.
- Retake screenshots, tag a release (0.3 or 1.0, your choice) with a changelog, rerun the newcomer walkthrough
  and compare with March.
- Write the next roadmap from what the live runs, the walkthroughs and the issue tracker show.

## Success measures

| Measure | 2026-11-20 | Latest | May 2027 target |
| --- | --- | --- | --- |
| Open correctness bugs in quantitative tools | ≥1 (#91) | 0 known (#91 fixed) | 0, each tool with a reference-value test |
| Live validation | Manual; exits 0 on misses | `--strict` exists; runs are manual | Manual `--strict` run on Boat recorded in every PR that changes wording, thresholds or the model |
| Lab | 198 JS + 35 Python packs, 134,510 lines | 7 JS + 4 Python packs, 11,226 lines | ≤20 JS packs, <15,000 lines (or folded into panels) |
| Workbench boot | 168 modules, 4.28 MB | 31 JavaScript files, 460 KB decoded (2026-11-27) | ≤25 modules, ≤500 KB |
| Client backends | SDK + Python 3.9 `urllib` fallback | SDK only | SDK only |
| Third-party requests from the app | Google Fonts | None | None |
| Largest Workbench module | 2,855 lines | 1,168 lines | ≤1,200 lines |
| Browser-tested flows | 0 | 7 specs | 4 |
| `AGENTS.md` | 524 lines | 248 lines | ≤250 lines, invariants intact |
| Improvement docs | 16 shards | 1 changelog | 1 changelog |
| Newcomer path | Undefined | Reviews walkthrough and Basic view; walkthrough not yet run | One path, most testers finish it unaided |

The 2026-11-27 startup measurement uses Chromium's Resource Timing through the point where the
Build request editor becomes editable in a fresh browser context on Boat. Deferring Tests, Compare
and Examples brought it from 69 JavaScript files and 1,117 KB decoded to 57 files and 937 KB.
Deferring Bulk brought it down to 31 files and 460,143 decoded bytes.

## Top risks

1. **Silent model regressions.** A new Jev version or alias move changes answers with no code change.
   Live checks run only when someone changes wording or the model (D3), so an alias that moves between
   PRs goes unnoticed until the next one. *Mitigation:* the manual strict run with its alias check,
   recording which version answered, and a manual run before each release.
2. **Misleading numbers.** A plausible but wrong statistic drives a bad audit-size or automation
   decision. *Mitigation:* the December audit, reference-value tests, and removing tools nobody can
   verify.
3. **Simplification breaks advanced workflows.** Module splits and the Basic view touch shared state
   around paid retries, drafts and blind review. *Mitigation:* January's pruning removes only isolated
   Lab packs; the February smoke paths come before the March and April changes to the panels, and each
   change keeps the AGENTS.md invariants.

## Decisions

Made by the maintainer on 2026-11-21, except D9 and D10 (2026-11-22).

- **D1. Playwright: approved** as a dev-only test dependency for browser smoke tests in CI (February).
- **D2. Python 3.9 fallback: dropped.** The official SDK becomes the only client (December).
- **D3. No API key in GitHub.** No `TYPESAFE_API_KEY` repository secret and no live job in CI; strict
  live runs stay manual on Boat (January onward).
- **D4. System fonts: approved.** Google Fonts are removed and the app makes no third-party requests
  (December).
- **D5. Prune Lab really hard.** Keep at most about 10% of packs, or fold the survivors into their
  panels (January, with a second pass in April).
- **D6. One reused Boat sandbox per worktree.** Boat checks run through `scripts/boat-check.sh`, which
  creates one long-lived sandbox per worktree from the `jev-lab-warm` snapshot and reuses it, instead of a
  new `boat run` sandbox per check. The account's 200 daily starts are shared by every project and ran out
  on 2026-11-21. Check sandboxes carry no credentials (`--no-env`).
- **D7. Live runs use the `jev-lab-live` Boat environment.** It injects only `TYPESAFE_API_KEY`, with no
  GitHub, agent or Boat credentials. A live run gets its own sandbox, only when the maintainer asks, and it
  is deleted afterwards. Agents never read keys from `.env` or pass them on the command line.
- **D8. Name every hand-made Boat sandbox `jev-lab-<purpose>`.** `boat new` gets `--name`, and a kept `boat run`
  sandbox is renamed at once, so sandboxes on the shared account can be traced to this project.
- **D9. Stop check sandboxes as soon as each check ends** (2026-11-22). This replaces the 45-minute idle
  window that kept D6's sandbox running, and billed, between checks to save a start. The account used
  about 194 plan-hours in a day against the roughly 89 a day the plan sustains. A stopped sandbox bills
  nothing, and Boat keeps its machine for 10 minutes after the stop, so a check within that time takes it
  back without a start. `JEV_BOAT_IDLE` keeps it running only when the owner asks. The keepalive that renews
  auto-stop during a check exits, and stops the sandbox, once `scripts/boat-check.sh` is gone, and the exit
  trap is armed before the sandbox is created or resumed.
- **D10. CI runs the full check; agents run targeted checks** (2026-11-22). CI runs the full suite once, on
  the pushed commit, and `main` requires **All tests passed**. Agents no longer run the full
  `scripts/boat-check.sh` before hand-off. While working, they run the tests that cover their change and lint
  for the areas they touched through `scripts/boat-check.sh -- CMD`, then push. A failed CI job is reproduced
  on Boat, fixed and pushed again. The full Boat check is for reproducing CI failures and refreshing the warm
  snapshot. Every check it runs is already a `test.yml` job.
