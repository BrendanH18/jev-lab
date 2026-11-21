# Roadmap: December 2026 – May 2027

Written 2026-11-20 at `d857cba` (#94). It combines three independent audits of the repository: Claude
Opus 5.5 (author), GPT-6.2 Sol and Gemini 4 Neon. Each reviewer measured the code on its own and none
saw the others' conclusions. Every number below was rechecked against this checkout.

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
| Browser tests | Smoke paths in Boat | Playwright in CI | Needs your approval for a dev-only dependency (decision D1) |
| Lab | Freeze; retire controls based on observed friction | Freeze, lazy-load, prune to ~20–30% | Freeze now, lazy-load in Jan, prune by stated criteria in Apr |
| Python 3.9 fallback | Keep | Drop (3.9 is EOL; `pyproject.toml` already needs ≥3.10) | Your call (D2) |
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
- **Restructure `AGENTS.md`.** Reduce the 233 lines of Workbench boundaries to about ten general
  invariants: never persist or replay answers; labels and `_test` markers never reach the model; held-out
  rows never leak; preview before any write; a paid run and its estimate use the same explicit selection;
  filters change presentation only; duplicate inputs share one identity. Move the per-feature detail into
  a tracked `docs/workbench-invariants.md` that AGENTS.md links to. Target: under 250 lines.

### January: a live release check and a fast load (P0)

- Add a `workflow_dispatch` job (plus a weekly schedule if you approve, D3) on a Namespace runner. It
  runs `validate.py --strict` against the synthetic scenarios and publishes a job summary with the
  revision, the answering model version, pass and miss counts, and spend. Raw answers stay in the run's
  artifacts and never go into the repo. Each run costs well under $0.01.
- Check alias freshness: compare `GET /v1/models` with `ALIASES` and the price table in
  `jev/client.py`, and fail the job when a new Jev version appears that the code doesn't know about.
- Set `protocol_version = "HTTP/1.1"`. Serve static files with ETag revalidation, and keep `no-store`
  on HTML (which carries the CSRF token) and `/api/*`.
- **Lazy-load Lab packs** when a Lab disclosure, the Toolbox or the command palette is first opened.
  Generate the page index as a manifest of dynamic `import()` calls. Target: Workbench boot loads at
  most 25 modules and under 500 KB.

### February: browser smoke tests and Workbench structure (P1)

- Write four browser smoke paths: a demo → Inspect → Open in Workbench → run; a Bulk run with a
  simulated partial failure, then a retry; dataset replace → history restore; Review session download
  → restore. Each checks for no console errors and that labels and drafts survive. They run in CI
  under Playwright if you approve D1, otherwise in Boat's desktop Chrome from a checked-in script.
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
- Swap the Google Fonts for a system font stack, and drop the two font hosts from the CSP (D4).
- Measure: walk three or four people (or fresh agents playing newcomers) through the path. Aim for
  most of them to finish unaided in under 10 minutes, and record where they get stuck.

### April: prune Lab and harden the route to production (P2)

- Prune Lab against written criteria. A control stays if it serves a step in a documented workflow,
  isn't a min/max/sort permutation of another control, and has a reference-checked result when it's
  quantitative. Remove the rest and regenerate the inventory. Stop presenting the numbered total as a
  headline metric.
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
| Live validation | Manual; exits 0 on misses | `--strict` run recorded for every model or wording change |
| Workbench boot | 168 modules, 4.28 MB | ≤25 modules, ≤500 KB |
| Largest Workbench module | 2,855 lines | ≤1,200 lines |
| Browser-tested flows | 0 | 4 |
| `AGENTS.md` | 524 lines | ≤250 lines, invariants intact |
| Improvement docs | 16 shards | 1 changelog |
| Newcomer path | Undefined | One path, most testers finish it unaided |

## Top risks

1. **Silent model regressions.** A new Jev version or alias move changes answers with no code change.
   *Mitigation:* the January live job, the alias-freshness check and recording which version answered.
2. **Misleading numbers.** A plausible but wrong statistic drives a bad audit-size or automation
   decision. *Mitigation:* the December audit, reference-value tests, and removing tools nobody can
   verify.
3. **Simplification breaks advanced workflows.** Lazy loading, module splits and pruning touch shared
   state around paid retries, drafts and blind review. *Mitigation:* the February smoke paths come
   before the March and April simplifications, and each change keeps the AGENTS.md invariants.

## Decisions for the maintainer

- **D1.** Approve Playwright as a dev-only test dependency (no runtime or frontend-build change), or keep
  browser checks manual in Boat.
- **D2.** Keep or drop the Python 3.9 stdlib fallback (`jev/client.py` urllib client and its CI job).
- **D3.** Add a `TYPESAFE_API_KEY` repository secret and allow a weekly scheduled live run (spend well
  under $0.01 per run).
- **D4.** Replace Google Fonts with a system font stack, so the local app makes no third-party requests.
- **D5.** How hard to prune Lab in April: by the stated criteria only, or to a target share such as Neon's
  20–30%.
