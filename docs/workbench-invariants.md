# Workbench invariants

These rules apply to Workbench, its API, its CLI and its exported gates.
See the [agent instructions](../AGENTS.md), [architecture guide](architecture.md) and
[Workbench guide](workbench.md) for project rules, module responsibilities and panel usage.

## Requests and persistence

`jev/workbench.py` validates arbitrary `state` and `questions` with
`validate_state` and `validate_questions`, calls the model, and checks probability answers
against authored `expect` ranges. Saved tests in `data/workbench/<id>.json` are available for
version control when their inputs are safe to publish. Saved datasets in
`data/workbench/datasets/` are gitignored. Dataset files hold inputs, human `_expect` labels,
configuration and test history.

Bulk runs rows in parallel through `run_bulk` and uses the shared `SpendGuard` for budget
and rate limits. Bulk sends a row's `_image` picture as an asset named `photo` in its state
so Box questions run on that picture. Workbench can export the exact request as runnable
Python, JavaScript or curl.

## Spend previews and retries

Spend previews (`jev/estimate.py`, `POST /api/workbench/estimate`, `static/js/estimate.js`,
and `scripts/check.py --estimate`) count the calls and sum `client.request_reserve_usd` for the
exact requests. Use the run's helpers (`workbench.prepare_bulk`, `prepare_compare`, `job_state`,
`checks.load`, `drift.prepare`, `upgrade.prepare`) so counts, test-row exclusion, the 200-row cap
and image use match the run. Read only the guard's snapshot. Make no model calls, including a
model-list lookup, and never reserve or record budget. Always show estimates as upper bounds
rounded up, using "≤", "at most" or "upper bound". Require explicit confirmation before a run
whose bound exceeds the budget left.

Bulk retries are explicit paid runs of unanswered original row indices only, with matching spend
previews. Preserve successful session answers, human labels, duplicate positions, pictures and test
markers. Combine only an unchanged request and compatible model version. Freeze the requested model
for every batch, refresh derived evaluation after retries, and count spend across attempts. Never
persist answers for retry recovery or let an empty selection fall back to running the full batch.

Bulk retry selection uses original unanswered row indices only. Failed/skipped filters change
presentation, preserving selections across filters. Estimates and paid requests use the same explicit
selection. Selection changes during spend preview require another deliberate retry.

Compare retries preview and send only unanswered calls from the original request, including
individual calls in an order-averaged variant. Preserve successful calls, original row positions,
and held-out exclusions. Pin retries to the resolved version where a requested model has answered,
sharing the pin across variants that asked the same model. Keep incompatible answers out of paired
scores and count spend across attempts. Bind the retry receipt to the original ordered request and
call completion state. Retry requests carry no prior answers. Merge new outcomes in the current tab.
Compare retry selections are page-session only and indexed into the original call array. Reject
explicit empty, repeated or answered positions. Spend previews and paid retries use the same
selection. Changing it during confirmation requires another deliberate retry. Unselected calls
remain pending in the receipt and the report.

## Dataset bundles and revisions

Portable dataset bundles (`jev/bundles.py`) contain only dataset inputs, human labels, question and gate
configuration, test-split history, and referenced pictures. Never include model answers, measured check
results, or application credentials. Preview imports before saving and require explicit replacement of
an existing dataset. Bundled sample pictures become content-addressed uploads so their exact bytes travel
without replacing built-in sample files.

Dataset replacement previews use the same candidate validation as saving, show counts and configuration
changes without label values, and make no writes or model calls. Match exact input occurrences in order
so duplicates remain distinct, with picture names included. Saving a previewed replacement verifies the
saved file revision under the dataset update lock. Changed files require another preview. Preserve the
existing explicit replacement, check compatibility, and test-history semantics.

Dataset revision history (`jev/history.py`) is the undo for dataset files. Every write that replaces or
deletes a dataset goes through `workbench.write_dataset`/`delete_dataset`, which first copy the current file
byte for byte to `data/workbench/datasets/.history/<id>/<timestamp>-<hash>.json` under the dataset update
lock. A new dataset writer must go through them too. Revisions contain only what dataset files contain
(inputs, human labels, configuration), never model answers or measured results. Keep the newest 20 per
dataset, skip unchanged writes and identical consecutive copies, write atomically, and validate ids and
revision names. Deleting keeps history so the delete can be undone. `.history` is gitignored local
state. Never list it as a dataset, bundle it, or accept it as an id. Listings and restore previews
show counts and configuration changes only, never label values. Restore validates the revision
with `prepare_dataset`, reports the `dataset_changes` summary, and requires the preview's file token.
A changed file needs another preview. Restore uses the revision's own check and labeling guidelines
where they fit and reports any drops. It preserves every test look recorded since and snapshots the
current file so the restore can be undone.

## Held-out evaluation

`jev/testsplit.py` marks test rows with `"_test": true`. Only an explicit test scoring action
can evaluate those rows and record a look. Checks, drift and upgrades run on tuning rows.

New test splits keep exact-input groups together, including unlabeled copies, using the same identity as
dataset health and Review (labels and test markers ignored, picture names retained). Select the closest
feasible labeled-row count to the requested share, with at least two labeled rows on each side, and show
the actual share. Keep existing groups intact. Impossible splits must leave files unchanged.

Cross-validation keeps exact-input groups together across threshold/cost tuning, answer sets,
recalibration, and model upgrades. Use the dataset-health/Review identity (labels and test markers
ignored, JSON field order ignored, picture names retained). Assign larger groups first to the
least populated fold, breaking ties by input hash. Require at least one distinct labeled input
per fold as well as the total labeled-row minimum. Report why unseen evaluation is unavailable.
Do not silently fall back to splitting duplicate copies between tuning and evaluation.

## Dataset health and edits

Dataset health (`jev/health.py`, Bulk's **Check dataset health**) inspects current inputs and human labels
without model calls or writes. It reports duplicates, conflicting or invalid labels, missing labels, and
identical inputs across tuning/test rows using row numbers only. Never reveal held-out label values
in health reports. Findings are advisory and fixes stay manual. Reports must match the current rows
and selected questions. Hide them when either changes.

Dataset health by slice reports row and distinct-input counts and per-question valid/missing/invalid
label counts separately for tuning and held-out rows, without label values. Slice values appear only
after a field is selected, using By slice's full normalized value identity and display-only truncation.
Labels and test markers cannot be slice fields. Reports are ephemeral, make no model calls or writes,
and are hidden when rows, questions, labels, or the selected field change.

Workbench input repairs (`jev/dataset_edits.py`) cover corrections of invalid or conflicting
Choice/Noul/Score tuning labels and redundant-copy cleanup. Prepare, preview and apply are separate
explicit actions with no model calls or dataset writes. Exclude entire input groups containing a
held-out copy. Cleanup requires identical input identity and identical full label maps. Never choose
between conflicting labels automatically. Preview binds rows, labels, markers, pictures and ordered
questions. Apply verifies the preview and clears stale Bulk results. Saving remains explicit.

Bulk preflight (`jev/preflight.py`) reads the same capped request states and picture references as
Bulk, reports row numbers/paths without label values, and makes no calls or writes. Findings are
advisory and require a deliberate continue before paid Bulk runs.

## Pre-run labeling and guidelines

Pre-run labeling (`jev/prelabel.py`) fills only missing Choice/Noul/Score human labels on tuning
rows, with blank controls and no model calls or file writes. Preserve existing labels (including
invalid ones), duplicate positions, input data, pictures, and held-out markers. Held-out rows and
array states never enter the editable queue. Slice filtering uses full normalized input values.
Drafts survive filters but belong to the current rows/questions snapshot. Apply changes the rows
editor only, invalidates old Bulk results and health reports, and requires explicit dataset saving.

Pre-run labeling CSV handoff exports eligible tuning inputs, a missing-question list, and blank
human-label columns for the current slice. Imports match the full rows/question snapshot including
Choice order and duplicate positions, validate all labels, and preview before merging into drafts.
Never export existing labels or held-out inputs. Blank cells preserve drafts. Apply and dataset
Save remain explicit, with no model calls or file writes from export/import. Labeling filters and
next-row navigation change presentation only and preserve drafts across slices. The Workbench
guide only navigates existing panels. It never runs, labels, saves, or changes configuration.

Pre-run labeling draft downloads carry eligible tuning inputs, the question schema, and human draft
labels across all slices. Exclude existing labels, held-out inputs, and model answers. A hash binds
restores to the full original rows/questions snapshot, including labels, held-out markers, duplicate
positions, and Choice order. Preview and accept only merge validated drafts. Apply and Save remain
explicit. Pictures travel separately. Warn before unload when current unapplied drafts exist.
Labeling keyboard shortcuts act only inside that panel, preserve native editing behavior, and only
navigate incomplete rows within the current slice. They never apply, save, or call the model.

Labeling guidelines (`jev/guidelines.py`, `static/js/guidelines.js`) are a dataset's optional
`guidelines` mapping. Each question ID maps to a note and generic examples with valid Choice/Noul/Score
labels. Box takes a note only. Keep guidelines out of model requests (Bulk, checks, drift, upgrade,
Compare and request export), exported gates, decision provenance and labeling CSV handoffs. Show
them collapsed beside label controls. On blind audit and agreement rows hide examples matching the
row. Bundles carry them, check saves and upgrades preserve them, and a save without them keeps the
saved ones. Drop guidelines for removed questions with a warning naming the question. Replacement
previews and warnings report question IDs and counts only.

## Policy, saved checks and model upgrades

`jev/checks.py` saves a tuned Policy gate with its dataset as a check. It stores the
gate, model, the versioned ID that answered the tuning run as `tuned_on`, and user-chosen
targets. The Datasets panel and `scripts/check.py` rerun checks live. `jev/upgrade.py` asks a
check's tuned-on version and the candidate the same rows live, then retunes the gate from
the candidate's answers. Moving the check saves thresholds and the version.

`jev/rules.py` applies consistency rules such as “if A = x then B in y, z” to a row's
answers in code. Policy, Tune, cost, cross-validation, checks, drift and exported gates
send rows that break a rule to review. `jev/recalibrate.py` fits monotone probability maps
checked on unseen folds while preserving routing. `jev/prune.py` retunes with each question's
threshold off and with the question dropped, and identifies questions unused by any gate
or rule. Pruning analysis makes zero model calls. A live Compare verifies a shorter request.

Saved checks may require `slice_targets` (top-level input field/value plus minimum accuracy and
coverage), using By slice's full normalized value identity and the check's shared confidence basis.
Every required slice must pass. Missing or unevaluable slices prevent a pass. Score the current
run's tuning answers only, with no extra calls or held-out rows. Preserve slice configuration in
bundles and model upgrades, and enforce it on upgrade proposals. Persist no measured slice results.
Slice targets evaluate batches. Exported per-row gates still route by thresholds and rules.

## Gate exports and Review

`jev/gate.py` exports a tuned gate as a Python or JavaScript module whose `decide(state)`
routes a row. Run as a script, the module prints each decision with its `row`. The Review queue
(`jev/decisions.py`) reads these from the user's own gate decisions file for labeling. The queue
includes the rows routed for review and a random sample of automated rows for blind audit. People
can append their labeled rows to the check's dataset. Never bundle a sample decisions file for
the UI to show.

`jev/answersets.py` fits a conformal cut that produces the shortest list intended to
contain the correct answer at the chosen rate.

Answer-set cuts can be attached to Policy and saved with checks as `answer_sets` (question IDs to
cut and coverage), then exported as typed `candidates` in gate decisions. Thresholds and rules
decide automation, and the cuts assist reviewers. Review keeps all labels available and hides
shortlists on blind audit rows. Model-upgrade proposals drop fitted cuts so they are refitted on
the new model. Persist configuration and human labels, never candidates.

Exported gates accept Bulk's `_image` names, load pictures from a caller-selected directory
(the working directory by default), and send the same `photo` asset reference as Bulk. Samples load
as `<name>.png`. Uploaded hash filenames stay unchanged. Pictures travel separately from exported
source. Box questions return coordinates and are ineligible for gating or shortlists. Review labels
only Choice/Noul/Score and accepts accompanying Box output. Labels and `_test` markers never reach
the model, including direct calls to an exported gate's `decide` function.

Exported gate decisions carry versioned configuration provenance (questions including Choice option order,
requested model, thresholds, signal, rules, and answer-set cuts). Review rejects mismatches both when
reading and appending. Legacy review rows without provenance require manual labels and supply no
shortlists. Legacy automated rows are excluded from audit sampling and scoring. Treat provenance only
as the identity of the requested configuration. Save only inputs and human labels from Review in
datasets, never provenance, model answers, or measured audit results.

Review queue CSV handoff exports inputs and blank human-label columns only, never model answers,
shortlists, or decision metadata. Import matches the current queue's row and gate configuration,
validates labels before applying them, and preserves review/audit membership. Preview and apply
make no dataset write or model call. Normal append saves inputs and human labels only.

Review audit slices describe completed, verified blind audits in the submitted batch, grouped by
the existing full normalized input-value identity. Show counts, accuracy and 95% intervals only.
Never infer automation coverage or saved slice-target passes from an automated-only sample.
Reports are ephemeral and make no model calls. Queue filters and navigation change presentation
only. Preserve labels, audit membership, CSV handoff, and the set of ready rows eligible to append.

Review session recovery downloads human edits only, never suggested model labels, answers, or shortlists.
Restore requires the original decisions text and the same dataset/check snapshot, validates before preview,
and preserves the original random audit membership and blind labeling behavior. Download/restore make
no model calls or dataset writes. Accepting a restore changes the queue only, and Add stays explicit.
Review input-slice filters, per-question progress and keyboard navigation change presentation only.
Full normalized slice identities preserve labels across filters. Warn before leaving or replacing a
queue with unsaved human edits, including check saves/removal/upgrades, bundle replacement, dataset
deletion and history restore. Cancel before any saved configuration changes. Pictures travel
separately from session files.

## Drift and traffic labels

`jev/drift.py` compares unlabeled new rows with a check's dataset through its gate,
running both sides live.

Drift's **Label new traffic** queue carries the full weak-support inputs and their picture names from
the comparison run, with blank human-label controls. Its append endpoint saves inputs and human labels
only, deduplicates against all saved rows (including test rows), and preserves the check and test history.
Keep these targeted labels out of random audit samples and accuracy statistics. Adding
labels makes no model call. Rerunning the check is explicit. Saved held-out row identities are excluded
from new-traffic comparisons even when pasted without their `_test` marker.

Drift labeling draft recovery carries original weak-support inputs, ordered question schema and human
draft labels only, bound to the unchanged saved dataset/check snapshot. Restore previews before explicit
acceptance, works without a paid comparison, and never restores model answers, shortlists or measured
drift results. Pictures travel separately. Download and restore make no model calls or dataset writes.
Add remains explicit. Guard unsaved traffic labels before leaving or replacing queues or their saved
configuration, including check changes, dataset replacement/deletion and history restore.

## Agreement and Compare labels

`jev/agreement.py` compares a second person's blind labels with a dataset's labels offline
and writes the human settlements.

Agreement session recovery contains human second labels and explicit settlements only, bound to
the saved dataset/schema and original blind sample. Restore does not reveal saved labels until
Compare. Guard unsaved agreement edits before leaving or replacing their saved configuration.
Compare slices reuse successful paired tuning answers and the selected confidence basis. Disagreement
handoffs carry original inputs and blank label controls, never model suggestions. Preserve existing
labels, duplicate positions, pictures and held-out markers. General labeling CSV/draft/apply retains
the full source snapshot. Saved-item search/filtering changes presentation only, preserving edits.

## Build editor

Build drafts contain request inputs, ordered questions and pictures only. Validate and preview
before explicit replacement. Reject duplicate question IDs and Choice keys before serialization.
Reject duplicate JSON state keys before outbound actions. Plain text remains supported. Mark
answers from changed requests as outdated, including edits during in-flight requests.

Preserve question IDs and criteria order when editing the Build form. Duplicates get independent
criteria and unique IDs without copied expectations. Refuse deletion Undo if it would overwrite a
reused ID or changed expectation. The explicit rename action migrates human expectations with the question
and rejects ID or expectation collisions. Collapse state and presence filters keep the full
request. Duplicate shown creates independent questions with unique IDs and no copied expectations.

Inserting questions and duplicating criteria preserve the surrounding order. Criterion insertion
keeps Choice key and description pairs together and warns that Score ordinals change. Choice
description sorting preserves key pairs and leaves Score levels alone. Moving or duplicating Score
levels changes their numeric meaning. Reversing Score levels requires confirmation for the same
reason. Build subset moves preserve expectations and the relative order within each of the shown
and hidden question groups. Blank-criterion cleanup removes only empty placeholders.

Clipboard helpers copy only authored instructions or criteria. Build question sharing and authored
Markdown and instruction handoffs export only explicitly shown authored questions, excluding
state, pictures, expectations and answers. Unapplied Raw JSON edits block sharing and handoffs,
including single-question handoffs. Question outlines contain IDs, types, positions and authored
counts only. Outline CSV applies spreadsheet escaping.

Build authoring diagnostics inspect active authored fields only. Duplicate-ID and Choice-key
filters use outbound validation's trimmed, case-sensitive identity. Diagnostics export identifiers,
types, counts and flags only.

Build content cleanup is an explicit preview, Apply and Undo workflow bound to the full ordered
questions and human expectations. Trim only selected active fields, preserve criteria order and
expectations, reject ID and key collisions, and block pending Raw JSON edits. Refuse Undo if
it would overwrite newer question or expectation edits.

## Saved tests

Saved-test selections and results are session-only. Filters never change selection or the scope
of Run all. Every paid run and its spend preview use the same explicit nonempty IDs. An empty list
must never reach the API, whose legacy semantics mean all tests. Guard duplicate runs and changed
selections or requests during preview. Partial batches preserve other current results, invalidate
results for changed or deleted tests, and accumulate spend and wall time across completed batches.

Cost and latency sorts use current session results only, with unknown values last. Observation
filters and summaries use the latest session measurements and mark unknowns explicitly. Keep
summed latency separate from wall time. Request-size summaries count authored inputs. State-byte
controls count authored state in UTF-8. Authored coverage counts describe uncovered question IDs
and Choice keys only.

Count bounds, selected-ID copying and one-step selection Undo preserve hidden selections.
The explicit Replace selection with visible action drops hidden selections. Selection Undo is
session-only and drops deleted IDs. Pasted-ID selection previews match exact case-sensitive IDs
and invalidate when the pasted IDs or matched saved IDs change. Selection actions remain local
and preserve existing paid-run guards.

Saved-test metadata downloads contain counts, IDs, names and current session status, cost and
latency only. Selected downloads include hidden selections, follow the same allowlist and use
spreadsheet escaping. Saved-suite question inventories are separate schema handoffs with question
IDs, types and occurrence and expectation-presence counts. Keep authored text, inputs, label
values and answers out of these inventories.

## Dataset catalog

Catalog filters and sorts use summary metadata and keep open queues mounted and edits intact.
Date, label share, workflow presets, pins, scoped search, exclusions, guideline counts, count
bounds, filter chips and filter Undo change presentation only. Pins are session-only. Pin shown
and Unpin shown preserve hidden pins, and pinned handoffs include hidden pins. Filter Undo
preserves current pins.

Catalog CSV and JSON are limited to names, IDs, counts and timestamps. Spreadsheet exports escape
formulas. Keep inputs, label values, notes, answers and check configuration out of the downloads.

Tuning-row counts exclude held-out rows. Split shares include unlabeled inputs. Missing-label
and split-label shares use summary counts of rows with any human label. These label counts only
describe label presence. Undefined shares, including empty splits, sort last and cannot satisfy
numeric share filters. Evaluation-count filters describe recorded test looks.

Load as copy is an unsaved editor action. It uses a unique name, guards unsaved editor changes
and invalidates stale results. Checks and guidelines stay with the original. Use bundles to copy
datasets with held-out rows or evaluation history and preserve their test history.

## Example gallery

Example discovery filters/sorts and compact cards are session-only presentation. Request previews
show authored state, ordered questions and picture names only, never expectations or model answers.
Example metadata downloads contain IDs, titles, counts, types and input shapes only. Opening an
example in Build stays explicit. Gallery browsing never runs a model or changes editor data.

Example search inspects authored descriptions, never state/expectations/answers. Pins are session
state and hidden pins survive shown-only actions and filter reset. Metadata exports retain their
allowlist. Separately labeled request handoffs contain only authored state, ordered questions and
picture references. Gallery size counts are UTF-8 authored input sizes, never spend estimates.
