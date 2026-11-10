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
