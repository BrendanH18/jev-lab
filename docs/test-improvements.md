# Saved test diagnostics and selection

These ten controls help inspect a suite and choose its next paid batch. They use
saved requests and results from the current page session; opening or changing a
control never calls the model.

1. **Minimum question count** filters out smaller requests.
2. **Maximum question count** bounds the request sizes shown, combining with the minimum.
3. **Input shape** distinguishes plain text, JSON objects, and JSON arrays.
4. **Notes presence** locates tests with or without documentation.
5. **Slowest observed call** sorts by the latest current session latency, leaving unmeasured tests last.
6. **Costliest observed call** sorts by actual latest-call spend; measured zero remains ahead of unmeasured tests.
7. **Run not run** runs just tests without a current result using the normal spend preview.
8. **Select failed / errors** adds all currently unsuccessful tests to the selection, retaining other selections across filters.
9. **Selected request summary** counts the selected tests, questions, expectations, and pictures, including hidden selections. These are input counts, not spend estimates.
10. **Compact result presentation** hides checks and call details when the display checkbox is cleared. Status and error text remain visible, and results stay in memory.

Filters preserve selection and Run all's scope. Run not run is disabled when no
eligible IDs remain; it cannot send an empty IDs list to the API. Sorting uses
current results only and changes no saved file. Compact presentation does not
remove results or their accumulated spend.

Validation: Node 22 runs of `test-selection.test.mjs`, `test-tools.test.mjs`, and
`test-diagnostics.test.mjs` passed all 20 tests. Coverage includes explicit paid
request IDs, changed-preview cancellation, partial result retention, filter
composition, measured-versus-missing sort order, selected totals, and compact
result preservation.
