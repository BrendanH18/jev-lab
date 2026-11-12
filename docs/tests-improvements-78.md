# Saved-test management improvements

These ten controls are session-only. Filters preserve hidden selections and Run all still covers the entire saved suite. Nothing here runs a model, writes saved tests, or persists answers.

1. Filter by a case-insensitive test ID prefix.
2. Exclude tests containing a selected question type, alongside the existing inclusive type filter.
3. Set a minimum state-input byte count.
4. Set a maximum state-input byte count.
5. Sort by smallest state input first, preserving saved order for ties.
6. Sort by largest state input first, preserving saved order for ties.
7. Download metadata CSV for the current visible tests with spreadsheet formula escaping.
8. Download metadata JSON for all selected tests, including hidden selections.
9. Download metadata CSV for all selected tests, including hidden selections.
10. View live counts of passed, failed, error and unrun tests within the current filters.

Byte counts describe UTF-8 text or serialized JSON, excluding pictures. They are neither token counts nor spend estimates. Downloads share the existing metadata allowlist: IDs, names, authored counts and current session status/cost/latency. They contain no inputs, instructions, notes, labels, answers, traces or error text.
