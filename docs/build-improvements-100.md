# Thirty Build authoring improvements

The Advanced authoring tools disclosure holds additional filters, handoffs and navigation.
All filters preserve the full request and existing human expectations. None of these additions
makes a model call, saves a dataset, or persists answers.

1. Match question IDs by a case-insensitive suffix.
2. Match a complete question ID, ignoring surrounding whitespace and case.
3. Filter by a minimum ID character count (Unicode code points after trimming).
4. Filter by a maximum ID character count.
5. Filter by a minimum number of instruction lines.
6. Filter by a maximum number of instruction lines; empty instructions count as zero.
7. Filter instructions by JSON object/array versus text or other JSON literals.
8. Scope existing text search and exclusion to Choice keys only.
9. Scope existing text search and exclusion to active criterion descriptions only.
10. Find questions with or without entirely blank Choice/Score placeholders.
11. Find Choice questions with unnamed descriptions requiring repair.
12. Find repeated Choice keys using the same trimmed, case-sensitive identity as outbound validation.
13. Find repeated question IDs using the same outbound identity.
14. Find instructions with or without backticked references.
15. Navigate to the first shown question.
16. Navigate to the last shown question.
17. Navigate from a card to the previous shown question without wrapping or changing question order.
18. Navigate from a card to the next shown question.
19. Copy a single question ID.
20. Copy one question as authored Markdown, with safe fences around arbitrary authored content.
21. Download one question's JSON, validating its ID and Choice keys before serialization.
22. Download a shown-question outline as spreadsheet-safe CSV (positions, IDs, types and counts only).
23. Copy the shown-question outline as TSV.
24. Download shown instruction text without state, pictures, expectations or answers.
25. Copy shown questions as authored Markdown.
26. See live counts of each question type within the current shown subset.
27. See the shown subset's UTF-8 authored byte count for IDs, instructions and active criterion fields;
    this excludes state, pictures and all model data and is not a spend estimate.
28. Sort Choice options by description A–Z, keeping keys paired with their descriptions and ties stable.
29. Sort Choice options by description Z–A with the same pairing and stability guarantees.
30. Focus a question's instruction editor, expanding that card when necessary.

All new sharing actions block unapplied Raw JSON edits. Navigation and filters make no request edits.
Choice description sorts invalidate prior request products through the existing edit path, leave
human expectations attached to their IDs, and never reorder Score levels.

Evidence: `tests/js/build-advanced.test.mjs` covers combined filters, bounds, Unicode/line counts,
problem identities, scoped search, stable navigation, byte totals, safe CSV, paired sorting, live
toolbar events, sharing boundaries and instruction focus. Existing `tests/js/build-*.test.mjs`
continue to cover editor ordering, expectation preservation, outbound validation and stale results.
