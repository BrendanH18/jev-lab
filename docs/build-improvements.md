# Build editor improvements

These controls edit the current request or copy request content. They do not run the model or save anything.

1. **Rename safely** moves a question's human expectation to its new id and rejects collisions.
2. **Insert before** creates a blank question of the current type immediately before its card.
3. **Insert after** creates a blank question of the current type immediately after its card. Both insertion controls reveal the new card by clearing question filters.
4. **Duplicate Choice option** copies its description into an independent option with a unique key.
5. **Duplicate Score level** inserts an editable copy immediately after a level. Later numeric scores move up.
6. **Choice option endpoints** move a key and its description directly to the first or last position.
7. **Score level endpoints** move a level directly to the first or last ordinal; the control warns that numeric scores change.
8. **Copy instructions** copies a question's instructions alone.
9. **Copy criteria** copies a question's current typed criteria as JSON, without inputs, expectations or answers.
10. **Live criteria summary** counts named Choice options, defined Score levels or defined Noul outcomes; Box reports that it has no criteria. Blank editor rows do not inflate counts.

The card toolbar wraps. Criteria controls occupy a wrapping row beneath their inputs so buttons remain reachable on narrow screens.

Validation: `node --test tests/js/build-editing.test.mjs tests/js/build-controls.test.mjs` passed all 29 tests. The added tests exercise rename conflicts and expectation migration, insertion positions, independent option duplication, the actual Choice/Score endpoint and duplication controls, copy isolation, and summary counts. No built-in scenario or live-model question wording changed.

## More authoring controls

These ten additions operate on the current editor only. Filters preserve every question in Run and export; none of these controls runs the model or saves a file.

1. **Instructions filter** finds questions with or without authored instructions.
2. **Defined criteria filter** finds questions with or without named Choice options, defined Score levels or Noul outcomes. Box has no criteria.
3. **Human expectations filter** finds questions with or without a saved human expectation.
4. **Copy shown ids** copies only the visible authored question identifiers, one per line.
5. **Duplicate shown** inserts independent copies after visible questions, with collision-free ids and no copied expectations.
6. **Move to position** moves a question to an explicit one-based position, preserving its identity and expectations.
7. **Insert Choice option before** adds a fresh blank key and description before the selected option.
8. **Insert Choice option after** adds a fresh blank option after the selected option.
9. **Insert Score level before** inserts an empty level before the selected ordinal.
10. **Insert Score level after** inserts an empty level after the selected ordinal. Both Score controls warn that inserting levels changes later numeric scores.

Edits invalidate prior answers and exports. Choice key/description pairs and Score order remain intact; duplicate questions have independent nested criteria. `tests/js/build-authoring.test.mjs` exercises the filters, actual controls, position validation, copy boundaries and expectation preservation.
