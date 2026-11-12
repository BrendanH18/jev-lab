# Build authoring improvements

All ten additions operate on the current editor without model calls or saved changes.
Filters preserve the full request; Run and request export still use every question.

1. Filter question IDs by a case-insensitive prefix.
2. Filter by a minimum number of instruction characters (Unicode code points).
3. Filter by a maximum number of instruction characters.
4. Copy the shown questions' instructions together, without state or expectations.
5. Download the shown authored questions as Markdown, with IDs, types, instructions and criteria only. Arbitrary authored Markdown stays inside code fences. Pending Raw JSON edits block this handoff.
6. Sort Choice options by key in descending order, keeping each description with its key.
7. Reverse Choice option order without changing keys or descriptions.
8. Move the shown questions to the beginning as a stable block, preserving hidden questions and expectations.
9. Move the shown questions to the end as a stable block.
10. Remove completely blank Choice/Score criterion placeholders in one action. Unnamed Choice descriptions remain available for repair; every defined criterion and its emitted ordinal stays unchanged.

Question and criterion reordering invalidates request products through the existing editor checks. Human expectations remain attached to their IDs. Markdown and clipboard handoffs contain authored questions only, never model answers, pictures or request state.
