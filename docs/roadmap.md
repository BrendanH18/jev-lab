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
   and "sort" as three improvements. The Overview has a pack that filters app cards by their bullet
   count (`docs/lab/index.md`, #1313–#1342). The kit's isolation contract (packs can't touch the DOM,
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
  Namespace CI, no new dependencies without approval.

## Month by month

### December: correctness and accurate docs (P0)

- Fix #91 with one feasible-allocation function shared by the sample-total and allocation tools. Its
  regression test checks that the fixture's total meets the margin and that one row fewer misses it.
- Audit the Toolbox's quantitative packs (`tb-sample-sizes`, `tb-intervals`, `tb-hypothesis-tests`,
  `tb-calibration`, and `jev/lab/mathx.py` against `static/js/lab/lib/math.js`) using reference
  values worked out independently. Fix whatever fails or remove the control.
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
  passing only `TYPESAFE_API_KEY` with `boat run -e`. The PR description records the revision, the
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
  CI job on `namespace-profile-gitrunner` installs Chromium, starts `server.py` on loopback with a
  temporary data directory and a fake model backend, and joins `All tests passed`'s `needs`. Agents
  run it on Boat. The app keeps its zero runtime dependencies on the frontend and no build step.
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

| Measure | Now | May 2027 target |
| --- | --- | --- |
| Open correctness bugs in quantitative tools | ≥1 (#91) | 0, each tool with a reference-value test |
| Live validation | Manual; exits 0 on misses | Manual `--strict` run on Boat recorded in every PR that changes wording, thresholds or the model |
| Lab | 198 JS + 36 Python packs, 134,510 lines | ≤20 JS packs, <15,000 lines (or folded into panels) |
| Workbench boot | 168 modules, 4.28 MB | ≤25 modules, ≤500 KB |
| Client backends | SDK + Python 3.9 `urllib` fallback | SDK only |
| Third-party requests from the app | Google Fonts | None |
| Largest Workbench module | 2,855 lines | ≤1,200 lines |
| Browser-tested flows | 0 | 4 |
| `AGENTS.md` | 524 lines | ≤250 lines, invariants intact |
| Improvement docs | 16 shards | 1 changelog |
| Newcomer path | Undefined | One path, most testers finish it unaided |

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

Made by the maintainer on 2026-11-21.

- **D1. Playwright: approved** as a dev-only test dependency for browser smoke tests in CI (February).
- **D2. Python 3.9 fallback: dropped.** The official SDK becomes the only client (December).
- **D3. No API key in GitHub.** No `TYPESAFE_API_KEY` repository secret and no live job in CI; strict
  live runs stay manual on Boat (January onward).
- **D4. System fonts: approved.** Google Fonts are removed and the app makes no third-party requests
  (December).
- **D5. Prune Lab really hard.** Keep at most about 10% of packs, or fold the survivors into their
  panels (January, with a second pass in April).
