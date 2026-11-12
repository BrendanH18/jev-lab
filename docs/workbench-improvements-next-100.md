# 100 more Workbench improvements

This batch builds on the previous [100 improvements](workbench-improvements-100.md), adding
local authoring cleanup, suite planning, catalog recovery and gallery handoffs. No new dependency,
service, API endpoint, sample question or scenario is required. Paid runs keep their existing
explicit selection and spend-preview guards.

| Improvements | Workflow | Inventory |
| --- | --- | --- |
| 1–25 | Build diagnostics and reversible cleanup | [Build](build-improvements-next-100.md) |
| 26–50 | Saved-suite planning and exact-ID selection | [Tests](tests-improvements-next-100.md) |
| 51–75 | Dataset split progress and filter recovery | [Catalog](catalog-improvements-next-100.md) |
| 76–100 | Example discovery, pins and authored handoffs | [Examples](examples-improvements-next-100.md) |

New controls sit in disclosures where appropriate. Filters preserve authored data, hidden
selections and pins. Dataset filters retain mounted human queues. Cleanup requires preview,
checks that questions/expectations still match, and offers a guarded one-step Undo. No operation
in this inventory runs a model or persists model answers. File downloads are explicit.

Schema inventories and diagnostic downloads contain identifiers, types, counts and flags only.
Metadata CSV keeps its explicit allowlist and spreadsheet escaping. Example request downloads
are separately labeled authored-content handoffs: state, ordered questions and picture references,
never expectations or answers. Pictures themselves travel separately.

Validation covers all four groups with focused module/event tests plus the full JavaScript and
Python suites. Built-in scenarios and their model wording remain unchanged, so this batch does
not require live model calls. Browser proof uses disposable authored fixtures with an isolated
settings file and dataset directory; no synthetic model answers are displayed.

Observed validation for this batch: 398 JavaScript tests; 759 Python tests on the locked SDK
path (2 skipped) and stdlib fallback (7 skipped); browser-module syntax checks; Ruff; and unchanged
regenerated sample pictures. GPT-6.1 Terra exercised representative workflows at 1280 px and 390 px
with no console errors or page-level horizontal overflow. Browser checks covered cleanup preview,
Apply and Undo; suite metrics and pasted-ID selection; catalog chip removal/Undo with pin retention;
and scoped example search, pinning, outline and an authored-only request download. Unit/event tests
cover remaining filter combinations and mounted queue preservation. The browser check did not
exhaust every control or exercise an active human queue.

[Mobile Workbench screenshot](screenshots/workbench-next100-mobile.png) ·
[Mobile catalog screenshot](screenshots/workbench-next100-catalog-mobile.png)
