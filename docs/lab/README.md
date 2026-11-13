# Lab: 4,332 improvements

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

4,332 improvements in 119 packs.

| Improvements | Area | Count | Packs | Inventory |
| --- | --- | ---: | ---: | --- |
| 1–294 | Autopilot | 294 | 7 | [autopilot.md](autopilot.md) |
| 295–369 | Every page | 75 | 3 | [chrome.md](chrome.md) |
| 370–543 | Claims | 174 | 5 | [claims.md](claims.md) |
| 544–690 | Counter | 147 | 4 | [counter.md](counter.md) |
| 691–932 | Dispatch | 242 | 7 | [dispatch.md](dispatch.md) |
| 933–1,083 | Find | 151 | 4 | [find.md](find.md) |
| 1,084–1,217 | Overview | 134 | 4 | [index.md](index.md) |
| 1,218–1,320 | Play | 103 | 3 | [play.md](play.md) |
| 1,321–1,617 | Command line | 297 | 8 | [python-cli.md](python-cli.md) |
| 1,618–1,695 | Dataset health | 78 | 3 | [python-health.md](python-health.md) |
| 1,696–1,816 | Question checks | 121 | 3 | [python-lint.md](python-lint.md) |
| 1,817–1,984 | Reviews | 168 | 4 | [reviews.md](reviews.md) |
| 1,985–2,162 | Shield | 178 | 4 | [shield.md](shield.md) |
| 2,163–2,382 | Workbench · Build | 220 | 5 | [workbench-build.md](workbench-build.md) |
| 2,383–2,463 | Workbench · Bulk | 81 | 2 | [workbench-bulk.md](workbench-bulk.md) |
| 2,464–2,601 | Workbench · Calibrate | 138 | 3 | [workbench-calibrate.md](workbench-calibrate.md) |
| 2,602–2,643 | Workbench · Checks | 42 | 1 | [workbench-checks.md](workbench-checks.md) |
| 2,644–2,880 | Workbench · Compare | 237 | 6 | [workbench-compare.md](workbench-compare.md) |
| 2,881–2,954 | Workbench · Costs | 74 | 2 | [workbench-costs.md](workbench-costs.md) |
| 2,955–3,227 | Workbench · Datasets | 273 | 7 | [workbench-datasets.md](workbench-datasets.md) |
| 3,228–3,258 | Workbench · Drift | 31 | 1 | [workbench-drift.md](workbench-drift.md) |
| 3,259–3,357 | Workbench · Examples | 99 | 2 | [workbench-examples.md](workbench-examples.md) |
| 3,358–3,475 | Workbench · Labeling | 118 | 3 | [workbench-labeling.md](workbench-labeling.md) |
| 3,476–3,562 | Workbench · Policy | 87 | 2 | [workbench-policy.md](workbench-policy.md) |
| 3,563–3,652 | Workbench · Review | 90 | 2 | [workbench-review.md](workbench-review.md) |
| 3,653–3,693 | Workbench · Page | 41 | 2 | [workbench-shell.md](workbench-shell.md) |
| 3,694–3,965 | Workbench · Tests | 272 | 7 | [workbench-tests.md](workbench-tests.md) |
| 3,966–4,332 | Workbench · Toolbox | 367 | 15 | [workbench-toolbox.md](workbench-toolbox.md) |

## Adding a pack

A JavaScript pack is one module under `static/js/lab/packs/<page>/` that default-exports `definePack({ ... })`
(see the header of `static/js/lab/kit.js`), with a test `tests/js/lab/<pack id>.test.mjs` that calls `checkPack`.
A Python pack is one module under `jev/lab/packs/` with a test `tests/test_lab_<pack id>.py`. Packs import only
the kit and the shared libraries in `static/js/lab/lib/` (or `jev/lab/`), and reach the page through the `ctx` its
surface passes in. Then run `node scripts/lab_inventory.mjs` to refresh the page indexes and this inventory.
