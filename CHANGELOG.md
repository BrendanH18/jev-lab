# Changelog

## Unreleased

- Enabled HTTP/1.1 connection reuse and conditional requests for static assets. HTML and API
  responses keep their no-store policy.
- Added a guided Reviews-to-Workbench walkthrough with labeled sample rows, a Policy gate export,
  and a repeatable check from the terminal. See the [Workbench tutorial](docs/workbench.md#route-reviews-by-topic).
- Added Basic and Advanced Workbench views. Basic surfaces the Build, Bulk, Policy, gate export,
  and saved-check workflow.
- Consolidated the historical Workbench improvement notes into this changelog. The [Workbench
  reference](docs/workbench.md#reference) describes how to use the current tools.

## 2026-11-21 to 2026-11-23

- Split the Workbench Build, Datasets, and Compare modules along their workflow boundaries.
- Added Chromium coverage for Reviews handoffs, Bulk retry recovery, dataset history and Review
  session restoration, and changes to a Compare retry selection.
- Fixed stratified audit sizing, sample sizes, and confidence interval calculations. Reduced the Lab
  collection to tools that support documented workflows.
- Made the official SDK the only client, added strict mode to live scenario validation, and removed
  external fonts.

## 2026-11-08 to 2026-11-12

The Workbench added local tools for authoring requests, inspecting saved tests and datasets, and
finding example requests. The original inventories are available in the corresponding changes.

- **Build** gained scoped question filtering and navigation, safe rename and insertion, grouped
  duplication and reordering, and Choice and Score criterion editing. It added authored-content
  handoffs in JSON, Markdown, and plain text and metadata-only question outlines. Content diagnostics
  identify missing or repeated fields and whitespace issues. Cleanup previews changes, checks the
  full request before applying, and offers Undo while the editor still matches. Filters keep the
  whole question set available to Run and export. Reordering Choice options keeps descriptions
  paired with their keys, while reordering Score levels can change their numeric meaning.
- **Tests** gained filters and sorting by saved request metadata, expectation coverage, and results
  from the current session. Selection shortcuts can add visible tests, select tests by current
  status, preview pasted IDs, and undo a selection change. Hidden selections survive filters, and
  paid runs keep explicit selections and spend previews. Metadata and schema exports identify
  requests and question structure while omitting expectation values, request content, and answers.
- **Datasets** gained scoped searches, count and share bounds, workflow presets, and session pins.
  The catalog shows labeling progress by tuning and held-out split, and filters can be cleared or
  undone without losing mounted queues. A row with any label counts as labeled. Use dataset health
  to check label validity and completeness. Catalog downloads contain summary metadata.
- **Examples** gained scoped search and filters over types, size, labels, and pictures, compact cards,
  and session pins. Preview and share authored requests without loading them into Build. Authored
  handoffs contain state, ordered questions, and picture references. Metadata exports contain IDs,
  titles, types, counts, and input shapes.
- **Compare** added slice reports for the current run and a labeling handoff for disagreements.
  The handoff preserves original row positions, existing labels, pictures, and held-out markers.
  Applying labels and saving the resulting rows are separate actions.

See the historical mobile screenshots for [Build](docs/screenshots/workbench-next100-mobile.png)
and the [dataset catalog](docs/screenshots/workbench-next100-catalog-mobile.png).

See the original changes in [#73](https://github.com/BrendanH18/jev-lab/pull/73),
[#74](https://github.com/BrendanH18/jev-lab/pull/74),
[#75](https://github.com/BrendanH18/jev-lab/pull/75),
[#76](https://github.com/BrendanH18/jev-lab/pull/76),
[#77](https://github.com/BrendanH18/jev-lab/pull/77),
[#78](https://github.com/BrendanH18/jev-lab/pull/78),
[#79](https://github.com/BrendanH18/jev-lab/pull/79), and
[#80](https://github.com/BrendanH18/jev-lab/pull/80).
