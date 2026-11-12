# Thirty saved-test triage improvements

All additions operate on saved request metadata or the current page's user-triggered
results. Controls make no model calls and no file writes. New filters and selection
tools sit in **Advanced suite triage**; new sorts join the existing sort menu.

1. Filter by a case-insensitive test-name prefix.
2. Filter by a case-insensitive test-ID suffix.
3. Match a complete question ID instead of a substring.
4. Filter by minimum uncovered-question count.
5. Filter by maximum uncovered-question count, including zero.
6. Filter by minimum authored Choice-option count.
7. Filter by maximum authored Choice-option count.
8. Filter by minimum authored instruction characters, counted as Unicode code points.
9. Filter by maximum authored instruction characters.
10. Filter by minimum latest observed latency in milliseconds.
11. Filter by maximum latest observed latency in milliseconds.
12. Filter by minimum latest observed spend in USD.
13. Filter by maximum latest observed spend in USD, including measured zero.
14. Filter for measured or unknown latest latency.
15. Filter for measured or unknown latest spend.
16. Sort test IDs Z–A.
17. Sort by fewest pictures first.
18. Sort by most uncovered questions first.
19. Sort by fewest uncovered questions first.
20. Sort by most authored Choice options first.
21. Sort by fewest authored Choice options first.
22. Sort by longest authored instructions first.
23. Sort by shortest authored instructions first.
24. Explicitly replace the full selection with the visible tests.
25. Undo the last selection change, including checkbox and existing selection actions.
26. Add only visible error tests to the selection, retaining hidden selections.
27. Add only visible failed-expectation tests to the selection.
28. Add only visible unrun tests to the selection.
29. See selected tests' latest observed spend and latency sums, with separate measured
    counts and unknowns. Sums exclude earlier rerun attempts and latency is not wall time.
30. Copy selected metadata JSON to the clipboard, including hidden selections and using
    the same restricted metadata allowlist as existing downloads.

Uncovered questions count only current question IDs without expectations. Choice
options count keys in Choice criteria; Score levels do not count. Neither measure
establishes expectation validity or model quality. Integer authored-count bounds
reject negative/fractional/invalid values. Measurement bounds allow decimals but
reject negative or nonfinite values; unknown measurements cannot satisfy any
numeric measurement bound. Sorting is stable and never mutates the saved suite.

Selection Undo has one level, lives only in the page session, and drops deleted
IDs. Filters preserve full selections; only the explicitly named replacement action
removes hidden selections. All existing paid-run preview and request-snapshot
checks remain in place. Clipboard metadata excludes inputs, notes, instructions,
labels, pictures, answers, traces, check messages and error text.

Validation: `node --test tests/js/test-*.test.mjs tests/js/workbench-modules.test.mjs`
covers composed filters, invalid/zero/decimal bounds, Unicode counts, stable sorts,
unknown measurements, selection Undo and deletion, hidden selections, live-search
action availability, metadata exclusions and existing paid-run guards.
