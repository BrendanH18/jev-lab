# Lab: 5,279 improvements

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

5,279 improvements in 156 packs.

| Improvements | Area | Count | Packs | Inventory |
| --- | --- | ---: | ---: | --- |
| 1–313 | Autopilot | 313 | 8 | [autopilot.md](autopilot.md) |
| 314–388 | Every page | 75 | 3 | [chrome.md](chrome.md) |
| 389–593 | Claims | 205 | 6 | [claims.md](claims.md) |
| 594–740 | Counter | 147 | 5 | [counter.md](counter.md) |
| 741–1,042 | Dispatch | 302 | 9 | [dispatch.md](dispatch.md) |
| 1,043–1,212 | Find | 170 | 5 | [find.md](find.md) |
| 1,213–1,362 | Overview | 150 | 5 | [index.md](index.md) |
| 1,363–1,480 | Play | 118 | 4 | [play.md](play.md) |
| 1,481–1,907 | Command line | 427 | 12 | [python-cli.md](python-cli.md) |
| 1,908–1,927 | Row formats | 20 | 1 | [python-formats.md](python-formats.md) |
| 1,928–2,037 | Dataset health | 110 | 5 | [python-health.md](python-health.md) |
| 2,038–2,181 | Question checks | 144 | 4 | [python-lint.md](python-lint.md) |
| 2,182–2,347 | Reviews | 166 | 4 | [reviews.md](reviews.md) |
| 2,348–2,555 | Shield | 208 | 5 | [shield.md](shield.md) |
| 2,556–2,861 | Workbench · Build | 306 | 8 | [workbench-build.md](workbench-build.md) |
| 2,862–3,147 | Workbench · Bulk | 286 | 7 | [workbench-bulk.md](workbench-bulk.md) |
| 3,148–3,276 | Workbench · Calibrate | 129 | 3 | [workbench-calibrate.md](workbench-calibrate.md) |
| 3,277–3,353 | Workbench · Checks | 77 | 2 | [workbench-checks.md](workbench-checks.md) |
| 3,354–3,643 | Workbench · Compare | 290 | 8 | [workbench-compare.md](workbench-compare.md) |
| 3,644–3,712 | Workbench · Costs | 69 | 2 | [workbench-costs.md](workbench-costs.md) |
| 3,713–3,993 | Workbench · Datasets | 281 | 8 | [workbench-datasets.md](workbench-datasets.md) |
| 3,994–4,023 | Workbench · Drift | 30 | 1 | [workbench-drift.md](workbench-drift.md) |
| 4,024–4,121 | Workbench · Examples | 98 | 2 | [workbench-examples.md](workbench-examples.md) |
| 4,122–4,238 | Workbench · Labeling | 117 | 3 | [workbench-labeling.md](workbench-labeling.md) |
| 4,239–4,321 | Workbench · Policy | 83 | 2 | [workbench-policy.md](workbench-policy.md) |
| 4,322–4,437 | Workbench · Review | 116 | 3 | [workbench-review.md](workbench-review.md) |
| 4,438–4,477 | Workbench · Page | 40 | 2 | [workbench-shell.md](workbench-shell.md) |
| 4,478–4,778 | Workbench · Tests | 301 | 8 | [workbench-tests.md](workbench-tests.md) |
| 4,779–5,279 | Workbench · Toolbox | 501 | 21 | [workbench-toolbox.md](workbench-toolbox.md) |

## Adding a pack

A JavaScript pack is one module under `static/js/lab/packs/<page>/` that default-exports `definePack({ ... })`
(see the header of `static/js/lab/kit.js`), with a test `tests/js/lab/<pack id>.test.mjs` that calls `checkPack`.
A Python pack is one module under `jev/lab/packs/` with a test `tests/test_lab_<pack id>.py`. Packs import only
the kit and the shared libraries in `static/js/lab/lib/` (or `jev/lab/`), and reach the page through the `ctx` its
surface passes in. Then run `node scripts/lab_inventory.mjs` to refresh the page indexes and this inventory.
