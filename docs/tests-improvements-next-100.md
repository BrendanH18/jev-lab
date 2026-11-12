# Saved-suite planning improvements (26–50)

These additions help inspect authored schema coverage and prepare explicit selections before
another paid run. New controls sit in **Suite planning and schema inventory**; eight sorts join
the existing Sort tests menu. Every operation is local to the page session and makes no model
call or saved-file change.

26. Filter by minimum criterion-entry count across authored question types.
27. Filter by maximum criterion-entry count, including zero.
28. Filter by minimum authored criterion-description characters.
29. Filter by maximum authored criterion-description characters.
30. Filter by minimum authored Score-level count.
31. Filter by maximum authored Score-level count.
32. Filter for presence or absence of orphan expectations referencing removed questions.
33. Filter by minimum orphan-expectation count.
34. Filter by maximum orphan-expectation count.
35. Sort by fewest criteria first.
36. Sort by most criteria first.
37. Sort by shortest total authored criteria text first.
38. Sort by longest total authored criteria text first.
39. Sort by fewest Score levels first.
40. Sort by most Score levels first.
41. Sort by fewest orphan expectations first.
42. Sort by most orphan expectations first.
43. See the visible suite's distinct question IDs, occurrence counts, expectation-presence counts,
    and number of IDs used with multiple types; live filters refresh these counts.
44. See the same schema summary for the full selection, including hidden selected tests.
45. Download the visible suite's question inventory as JSON.
46. Download the selected suite's question inventory as JSON, including hidden selections.
47. Preview newline-separated saved-test IDs with matched/unknown counts and duplicate removal,
    without changing selection.
48. Explicitly add previewed known IDs to the selection while retaining hidden selections.
49. Explicitly remove previewed known IDs from the selection while retaining other selections.
50. Add the first N tests in the current visible sort order to the selection.

Criteria sizes count Unicode code points, serializing structured descriptions. Numeric filters
accept nonnegative integers; invalid limits match no tests. Sorting is stable and leaves saved
order unchanged. Diagnostics count authored configuration and never establish expectation
validity, model quality or estimated spend. Orphan diagnostics do not repair or delete anything.

The separately named question inventory is a schema outline: question IDs, type names, test
occurrence counts and counts of expectation presence only. It contains no request state,
instructions, criteria text, expectation values, notes, pictures, answers or current measurements.
Existing saved-test metadata downloads retain their existing allowlist.

Pasted IDs match exactly and case-sensitively. Blank lines and duplicate IDs are ignored;
unknown IDs never enter the selection. Editing pasted IDs invalidates the preview. A changed
saved-ID match requires another preview before applying. First-N accepts positive integers only.
All selection changes support the existing one-level Undo and never start a paid run. Selection
controls are disabled during a spend preview or paid batch; existing request/selection snapshot
guards and explicit nonempty run IDs remain intact.

Proof: `node --test tests/js/suite-refinements.test.mjs tests/js/test-*.test.mjs
 tests/js/workbench-modules.test.mjs` passed 59 tests, covering metrics, Unicode/structured
criteria, every numeric filter and sort, metadata boundaries, exact-ID preview invalidation,
hidden selections, Undo, first-N ordering, live count updates, reset and existing paid-run guards.
