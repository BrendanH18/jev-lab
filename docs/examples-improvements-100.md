# Example discovery improvements

The gallery now helps find and inspect a starting request without loading it into the editor or making a model call. Its ten additions are:

1. Search titles, pattern descriptions, code notes and question IDs, without losing input focus.
2. Filter by typed question primitive.
3. Filter by picture presence.
4. Filter by authored expectation presence.
5. Filter by state input shape (text, object or array).
6. Sort by title or question count, with gallery-order ties.
7. Preview the authored state, ordered questions and picture names directly in a card. Expectations and answers are excluded from preview JSON.
8. Expand or collapse previews for the shown cards together, preserving hidden cards' expansion preferences.
9. Download shown example metadata with an explicit allowlist: ID, title, question and expectation counts, type names, picture count and input shape. No request contents, filenames, expectation values or answers travel in this download.
10. Switch to compact cards while retaining the request preview and explicit Open in Build action.

Filters combine, and the live count and empty state reflect the current view. Reset restores the gallery defaults. Only Open in Build loads a request; running remains a separate action. These are authored starting points, never displayed model results.

Proof: `tests/js/examples-browser.test.mjs` covers combined filtering, stable ordering, metadata privacy, focus-preserving card updates, one-root reset, preview expansion, request-only previews and explicit editor loading.
