# Lab: 0 improvements

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

0 improvements in 0 packs.

| Improvements | Area | Count | Packs | Inventory |
| --- | --- | ---: | ---: | --- |

## Adding a pack

A JavaScript pack is one module under `static/js/lab/packs/<page>/` that default-exports `definePack({ ... })`
(see the header of `static/js/lab/kit.js`), with a test `tests/js/lab/<pack id>.test.mjs` that calls `checkPack`.
A Python pack is one module under `jev/lab/packs/` with a test `tests/test_lab_<pack id>.py`. Packs import only
the kit and the shared libraries in `static/js/lab/lib/` (or `jev/lab/`), and reach the page through the `ctx` its
surface passes in. Then run `node scripts/lab_inventory.mjs` to refresh the page indexes and this inventory.
