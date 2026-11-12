# Example discovery and handoffs: improvements 76–100

These additions browse authored examples without running a model or changing Build. Advanced
filters live in a disclosure and compose with the existing primitive/picture/expectation/input-shape
controls. Gallery pins and filters last only for the page session.

76. Scope search to titles, example IDs, pattern/summary/code notes, question IDs or instructions.
77. Match every search word across the selected scope.
78. Match any search word across the selected scope.
79. Exclude an authored phrase in the selected scope.
80. Require a minimum question count.
81. Cap the question count.
82. Require a minimum active criterion count (Choice options plus Score levels).
83. Cap the active criterion count.
84. Require a minimum authored-state UTF-8 byte count.
85. Cap the authored-state UTF-8 byte count.
86. Filter for one question type or a mixture of types.
87. Pin or unpin an individual example from its card.
88. Show pinned or unpinned examples only.
89. Pin all shown examples while preserving hidden pins.
90. Unpin all shown examples while preserving hidden pins.
91. Copy all pinned IDs, including hidden pins, in the selected sort order.
92. Download all pinned examples' metadata with the existing explicit allowlist.
93. Download shown metadata as spreadsheet-safe CSV.
94. Copy shown example IDs for a lightweight handoff.
95. Sort by smallest or largest authored state, with stable gallery-order ties.
96. Sort by fewest or most active criteria, with stable gallery-order ties.
97. See a live per-primitive question-count summary for shown examples.
98. Inspect an ordered question outline with IDs, types and criterion counts.
99. Copy an example's authored request without expectations or model answers.
100. Download an example's authored request without expectations or model answers.

Byte counts are authored input sizes, never spend estimates. Text states count their literal
UTF-8 contents; JSON states count their compact JSON encoding. Counts accept inclusive nonnegative
integers, including zero; invalid numeric bounds match nothing. Search never inspects state,
expectations or answers. Metadata CSV retains only IDs, titles, counts, type names and input shapes;
its cells escape spreadsheet formulas. Authored-request handoffs are separately labeled and include
only state, ordered questions and picture references. Pictures themselves travel separately.

Typing updates only cards/counts/actions and keeps the filter controls mounted. Reset resets view
filters and sorting, retaining pins and preview expansion preferences. Opening in Build remains an
explicit separate action; none of these controls changes the current editor or calls the API.

Validation: `tests/js/examples-refinements.test.mjs` exercises combined scope/word/exclusion filters,
zero/invalid/Unicode bounds, stable sorting, primitive summaries, content boundaries, CSV escaping,
actual clipboard/download event payloads, hidden pins and focus-preserving refresh behavior.
