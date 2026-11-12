# 25 Build content refinements

The **Content diagnostics and cleanup** disclosure adds local authored-content tools. Filters
compose with existing question filters, keep every question in the request, and preserve typing
focus. Findings are advisory, not model-quality judgments. None makes a model call or saved write.

1. Filter by minimum instruction word count (whitespace-delimited words).
2. Filter by maximum instruction word count, including zero.
3. Filter by minimum active criterion-description character count (Unicode code points).
4. Filter by maximum active criterion-description character count.
5. Find Choice options with or without missing descriptions; blank unnamed placeholders do not count.
6. Find repeated nonempty Choice descriptions using trimmed, case-sensitive equality.
7. Find leading/trailing whitespace in question IDs.
8. Find leading/trailing whitespace in instructions.
9. Find leading/trailing whitespace in Choice keys.
10. Find leading/trailing whitespace in active criterion descriptions.
11. Find multiline active criterion descriptions.
12. Find non-ASCII question IDs; these are supported and the finding is informational.
13. Find unexpected control characters in active authored fields, excluding ordinary tabs and newlines.
14. Find TODO or FIXME words in active authored fields.
15. Find whitespace-only instructions separately from empty instructions.
16. Trim shown question IDs without moving their existing trimmed-identity human expectations.
17. Trim shown instructions without rewriting their internal whitespace.
18. Trim shown Choice keys while keeping each description attached.
19. Trim shown active criterion descriptions for Choice, Score and Noul; inactive fields stay untouched.
20. Normalize CRLF and CR instruction newlines to LF.
21. Normalize newlines in shown active criterion descriptions, preserving option/Score order.
22. Preview a cleanup action before editing, listing affected question positions and IDs, with cancellation.
23. Apply only the previewed cleanup after verifying the full questions/expectations snapshot.
24. Undo the last cleanup only while no newer question or expectation edits would be replaced.
25. Download shown diagnostics as metadata-only JSON: positions, IDs, types, counts and diagnostic flags.

Cleanup rejects duplicate question IDs and Choice keys before editing. Apply and Undo invalidate
old answer products through the existing Build edit path. Hidden questions retain their contents
and collapse state; existing expectations remain unchanged. Unapplied Raw JSON blocks cleanup and
diagnostics downloads. Downloaded diagnostics contain no instructions, criterion text, inputs,
pictures, expectation values or model answers. Cleanup previews and undo records exist in the page
session only.

Proof: `tests/js/build-refinements.test.mjs` covers all diagnostics and count bounds, all six cleanup
actions, active-field isolation, original/hidden row preservation, preview and undo concurrency,
collision rejection, metadata privacy, actual toolbar events, Raw JSON guards and result invalidation.
