# Dataset catalog improvements

These controls inspect saved summary metadata only. They keep existing catalog nodes and their open queues mounted, make no model calls or writes, and retain page-session pins. Tuning row counts mean total rows minus held-out rows; they do not imply usable labels. Test evaluations count previous looks, not evaluation quality.

1. Minimum tuning-row filter, excluding held-out rows.
2. Maximum tuning-row filter, including an explicit zero bound.
3. Minimum test-evaluation count filter.
4. Maximum test-evaluation count filter.
5. Saved-timestamp presence filter to find undated datasets.
6. Fewest guideline questions first sort.
7. Most tuning rows first sort.
8. Fewest tuning rows first sort.
9. Never-scored held-out split workflow preset.
10. Previously-scored held-out split workflow preset.

Clearing filters resets all bounds while preserving pins. Downloads continue to use the existing metadata allowlist; none of these controls export inputs, notes, labels, answers, or check configuration.
