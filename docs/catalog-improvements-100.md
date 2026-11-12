# Dataset catalog: 30 additional controls

These additions use the existing saved summary metadata. They make no model
calls, load no dataset inputs and write no files. Filtering and sorting reuse
mounted cards, retaining every open queue and human edit. New split and guideline
controls, summaries and pin actions live in collapsed groups.

1. Set a minimum held-out row share, counting unlabeled rows too.
2. Set a maximum held-out row share.
3. Require a minimum number of tuning rows with any human label.
4. Cap tuning rows with any human label.
5. Require a minimum number of held-out rows with any human label.
6. Cap held-out rows with any human label.
7. Filter by held-out row-label progress: none, some or every row.
8. Filter by tuning row-label progress: none, some or every row.
9. Require a minimum percentage of saved questions with labeling guidelines.
10. Cap the percentage of saved questions with labeling guidelines.
11. Filter dataset IDs by a case-insensitive prefix.
12. Search for every whitespace-separated word, across the chosen metadata field.
13. Search for any whitespace-separated word.
14. Require a minimum count of questions without labeling guidelines.
15. Cap questions without labeling guidelines.
16. Sort by most recorded test evaluations.
17. Sort by fewest recorded test evaluations.
18. Sort by most labeled tuning rows.
19. Sort by fewest labeled tuning rows.
20. Sort by highest held-out row share.
21. Sort by lowest held-out row share.
22. Sort by highest guideline-question share.
23. Sort by lowest guideline-question share.
24. Pin all currently shown datasets without removing hidden pins.
25. Unpin all currently shown datasets while retaining hidden pins.
26. Copy all pinned dataset IDs, including hidden pins, in the current sort order.
27. Download the metadata CSV for all pinned datasets, including hidden pins.
28. Download the metadata JSON for all pinned datasets, including hidden pins.
29. View a live expanded summary for the shown datasets: tuning rows and their
    labeled count, held-out labeled rows, questions with/without guidelines and
    recorded evaluation looks.
30. Copy both current-view count summaries for a metadata-only handoff.

Count bounds are inclusive, accept explicit zero and reject invalid negative or
fractional counts. Percentage bounds accept fractions from 0 through 100.
Shares with zero denominator are unavailable, excluded by share filters and
sorted last in both directions. Split label-progress filters require that split
to contain rows. Sort ties preserve saved order.

All label counts mean rows with any saved human label. They establish neither
complete/valid labels nor evaluation readiness. Test evaluations are historical
looks, never accuracy. Held-out labels appear only as counts, never values.
Pinned downloads retain the existing names/IDs/counts/timestamps export allowlist
and CSV spreadsheet escaping; inputs, notes, label values, model answers and
check configuration remain excluded. Pins last only for the page session.

Validation: `node --test tests/js/dataset-catalog{,-100}.test.mjs` passes 41 tests,
including combined bounds, unknown shares, all sorts, hidden pins, export
allowlists and mounted human queue preservation.
