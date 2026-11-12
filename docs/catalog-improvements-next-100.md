# Dataset catalog refinements

This batch adds 25 catalog improvements using saved summary metadata. None loads
dataset inputs, runs the model, or writes datasets. Filters, sorting and pin
actions retain mounted cards and unfinished human queues. Bounds combine with
existing filters, accept zero, and are inclusive.

51. Minimum tuning rows without any human label.
52. Maximum tuning rows without any human label.
53. Minimum held-out rows without any human label.
54. Maximum held-out rows without any human label.
55. Minimum tuning row-label share.
56. Maximum tuning row-label share.
57. Minimum held-out row-label share.
58. Maximum held-out row-label share.
59. Sort by most tuning rows without labels.
60. Sort by fewest tuning rows without labels.
61. Sort by most held-out rows without labels.
62. Sort by fewest held-out rows without labels.
63. Sort by highest tuning labeled share.
64. Sort by lowest tuning labeled share.
65. Sort by highest held-out labeled share.
66. Sort by lowest held-out labeled share.
67. Filter dataset IDs by suffix, ignoring case and surrounding whitespace.
68. Filter display names by prefix, with the ID fallback for unnamed datasets.
69. Filter display names by suffix, using the same fallback and normalization.
70. Match a whole name, ID or notes field with exact-field search, honoring the
    selected metadata search scope.
71. View the live count of active filter settings, excluding sort and stored pins.
72. Expand a readable summary of all active filter settings and their values.
73. Remove one active filter from its labeled chip while retaining other settings.
74. Undo the most recent filter or sort change, including Clear or a workflow
    preset, while the catalog is mounted. Undo consumes its one saved step and
    preserves current pins; typing is undone one filter edit at a time.
75. Invert pins for the shown datasets while retaining hidden pins.

Missing-label counts mean rows without any saved human label. Shares count rows
with at least one label, regardless of completeness or validity. These metadata
figures do not establish evaluation readiness or model accuracy. No held-out
label values are shown. Shares for an empty split are unavailable, do not satisfy
numeric share filters, and sort after defined shares in both directions. Count
limits reject negative, fractional or nonfinite values; shares accept fractional
percentages from 0 to 100. Sort ties retain saved order.

Name and ID filters change presentation only. Exact-field search is literal and
case insensitive; it does not treat a search string as a regular expression.
Filter Undo never changes human queue data or pins. The existing CSV/JSON
downloads keep their metadata allowlist and spreadsheet escaping, excluding
inputs, notes, label values, answers and check configuration.

Proof: `node --test tests/js/catalog-refinements.test.mjs
tests/js/dataset-catalog.test.mjs tests/js/dataset-catalog-100.test.mjs` passes
51 tests. The new tests cover all bounds and sorts, unavailable shares,
normalization, scoped exact matches, removable chips, Undo across Clear/presets,
hidden pins, mounted human edits and the unchanged export privacy boundary.
