# Lab: 6,302 improvements

Lab is the extension layer of Jev Lab. Small, self-contained **packs** declare features (filters and sorts over a
list, advisory checks, previewed edits, metrics, copy and download formats, paste importers, commands with
shortcuts, calculators, panels), and one generic set of controls shows them on every page:

- **Lab tools** is a disclosure beside each list or result it works on. *Refine* filters and sorts by derived
  facts, *Checks* runs advisory checks on the shown items, *Edits* previews a change before you apply it (with one
  guarded Undo), *Metrics* computes from what the page already holds, and *Copy and download* states what each
  file contains.
- **Toolbox** is a Workbench tab of calculators and converters for people building typed-answer gates.
- **Commands** (the top-bar button, or Ctrl/Cmd + K) is a palette of every action the current page offers, with
  its keyboard shortcut.
- `scripts/lab.py` is the same idea for the terminal: offline subcommands for datasets, saved tests, questions
  and statistics.

Every improvement here runs locally. None calls the model, adds a dependency, changes a built-in scenario or the
wording of a model-facing question, or shows an answer the current user did not request in this session. Lab
keeps its filters, sorts and drafts in the page session only. Exports state their content boundary, and the
existing rules for held-out rows, labels, audits and spend previews apply unchanged.

## How improvements are counted

One numbered improvement is one user-visible capability with its own test, named by the improvement's id. A
numeric fact gives three (a minimum filter, a maximum filter, and sorting in either direction), a yes/no fact one
(with or without), a text fact two (a contains filter and sorting), a category fact two (a filter and a
breakdown of the shown items), a panel as many as it lists, and every check, edit, metric, export, importer,
command, tool, command-line subcommand or option, and behavior one. `tests/js/lab/harness.mjs` and
`tests/labkit.py` refuse a pack whose features lack a concrete case.

## Inventory

6,302 improvements in 198 packs.

| Improvements | Area | Count | Packs | Inventory |
| --- | --- | ---: | ---: | --- |
| 1–313 | Autopilot | 313 | 8 | [autopilot.md](autopilot.md) |
| 314–405 | Every page | 92 | 4 | [chrome.md](chrome.md) |
| 406–610 | Claims | 205 | 6 | [claims.md](claims.md) |
| 611–806 | Counter | 196 | 7 | [counter.md](counter.md) |
| 807–1,108 | Dispatch | 302 | 9 | [dispatch.md](dispatch.md) |
| 1,109–1,312 | Find | 204 | 6 | [find.md](find.md) |
| 1,313–1,462 | Overview | 150 | 5 | [index.md](index.md) |
| 1,463–1,611 | Play | 149 | 5 | [play.md](play.md) |
| 1,612–2,213 | Command line | 602 | 21 | [python-cli.md](python-cli.md) |
| 2,214–2,233 | Row formats | 20 | 1 | [python-formats.md](python-formats.md) |
| 2,234–2,370 | Dataset health | 137 | 8 | [python-health.md](python-health.md) |
| 2,371–2,522 | Question checks | 152 | 5 | [python-lint.md](python-lint.md) |
| 2,523–2,688 | Reviews | 166 | 4 | [reviews.md](reviews.md) |
| 2,689–2,896 | Shield | 208 | 5 | [shield.md](shield.md) |
| 2,897–3,202 | Workbench · Build | 306 | 8 | [workbench-build.md](workbench-build.md) |
| 3,203–3,488 | Workbench · Bulk | 286 | 7 | [workbench-bulk.md](workbench-bulk.md) |
| 3,489–3,729 | Workbench · Calibrate | 241 | 8 | [workbench-calibrate.md](workbench-calibrate.md) |
| 3,730–3,955 | Workbench · Checks | 226 | 5 | [workbench-checks.md](workbench-checks.md) |
| 3,956–4,245 | Workbench · Compare | 290 | 8 | [workbench-compare.md](workbench-compare.md) |
| 4,246–4,357 | Workbench · Costs | 112 | 4 | [workbench-costs.md](workbench-costs.md) |
| 4,358–4,686 | Workbench · Datasets | 329 | 10 | [workbench-datasets.md](workbench-datasets.md) |
| 4,687–4,821 | Workbench · Drift | 135 | 5 | [workbench-drift.md](workbench-drift.md) |
| 4,822–4,919 | Workbench · Examples | 98 | 2 | [workbench-examples.md](workbench-examples.md) |
| 4,920–5,097 | Workbench · Labeling | 178 | 5 | [workbench-labeling.md](workbench-labeling.md) |
| 5,098–5,242 | Workbench · Policy | 145 | 4 | [workbench-policy.md](workbench-policy.md) |
| 5,243–5,441 | Workbench · Review | 199 | 6 | [workbench-review.md](workbench-review.md) |
| 5,442–5,500 | Workbench · Page | 59 | 3 | [workbench-shell.md](workbench-shell.md) |
| 5,501–5,801 | Workbench · Tests | 301 | 8 | [workbench-tests.md](workbench-tests.md) |
| 5,802–6,302 | Workbench · Toolbox | 501 | 21 | [workbench-toolbox.md](workbench-toolbox.md) |

## Adding a pack

A JavaScript pack is one module under `static/js/lab/packs/<page>/` that default-exports `definePack({ ... })`
(see the header of `static/js/lab/kit.js`), with a test `tests/js/lab/<pack id>.test.mjs` that calls `checkPack`.
A Python pack is one module under `jev/lab/packs/` with a test `tests/test_lab_<pack id>.py`. Packs import only
the kit and the shared libraries in `static/js/lab/lib/` (or `jev/lab/`), and reach the page through the `ctx` its
surface passes in. Then run `node scripts/lab_inventory.mjs` to refresh the page indexes and this inventory.
