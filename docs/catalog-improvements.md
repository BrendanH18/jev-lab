# Dataset catalog improvements

The catalog uses saved summary metadata. Filters and sorting keep existing dataset
nodes mounted, preserving open queues and human edits. No control here runs the
model or writes a dataset.

1. **Saved on or after:** find datasets saved from a chosen date, inclusive.
2. **Saved on or before:** find datasets saved through a chosen date, inclusive.
3. **Minimum labeled share:** filter by the percentage of rows with any label.
4. **Maximum labeled share:** find datasets below a labeling-progress ceiling.
5. **Newest saved first:** sort dated datasets newest first, unknown dates last.
6. **Oldest saved first:** find older datasets first, unknown dates last.
7. **Lowest labeled share first:** prioritize datasets with the least labeling progress;
   empty datasets appear last because they have no defined share.
8. **Workflow presets:** quickly find partial labeling, wholly unlabeled datasets,
   or fully row-labeled datasets with questions that still need a saved check.
9. **Session pins:** pin datasets and filter to those pins. Clearing filters and
   choosing presets retain pins; reloading the page clears them.
10. **Metadata JSON download:** export the shown, sorted catalog using an explicit
    allowlist of names, IDs, counts, timestamps, and presence flags. Excludes notes,
    inputs, label values, model answers, and check configuration.

A row with any label is counted as labeled. These shares and workflow presets do
not establish that all questions have valid labels or that a dataset is ready to
pass evaluation. Date filters omit datasets without a saved timestamp.

Validation: `node --test tests/js/dataset-catalog.test.mjs` (20 tests), including
boundary dates, fractional and empty shares, stable metadata sorting, independent
presets and pins, export allowlists, and preservation of mounted queue edits.
