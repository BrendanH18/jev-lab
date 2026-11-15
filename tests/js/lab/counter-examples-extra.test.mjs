// Tests of the counter-examples-extra pack on tests/js/lab/fixtures/counter.mjs. The examples: #0 "Shipping, then
// sorted" (7 + 5 words, 38 + 33 characters; expects reply, close), #1 "Frustration builds" (the active one, 3 of 3
// turns sent; expects a handoff), #2 "A person, please" ("Please connect me to a human agent.", 7 words, 35
// characters; expects a handoff), #3 "Missing the point" (expects a handoff) and #5 "Example 6" ("Do you sell decaf
// beans?", 5 words, 24 characters; expects reply, close). Counts are worked out by hand.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/counter/counter-examples-extra.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { examplesByIndex, sampleCounterExamplesCtx } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterExamplesCtx(overrides);
const E = examplesByIndex(ctx());
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  sent_turns: { items: [E[1], E[0]], values: [3, 0] },
  mean_turn_words: { items: [E[0], E[2], E[5], { label: "Empty", turns: [] }], values: [6, 7, 5, null] },
  total_chars: { items: [E[0], E[2], E[5]], values: [71, 35, 24] },
  asks_person_words: { items: [E[2], E[0], E[3]], values: [true, false, false] },

  person_without_handoff: { hit: { label: "Talk", turns: ["Let me talk to a person."], expect: ["reply"] }, miss: [E[2], E[0], { label: "No expectation", turns: ["A human, please"], expect: [] }],
    message: /^A turn asks for a person, yet no turn is expected to hand off/ },

  handoff_share: [
    { ctx: ctx(), expect: (result) => { assert.equal(result.value, 0.6); assert.equal(result.detail, "3 of 5"); }, empty: ctx({ setup: null }) },
    { ctx: ctx({ hide: [1, 2, 3] }), expect: 0 },
  ],

  checklist_md: { ctx: ctx(), filename: "counter-examples-checklist.md",
    includes: ["# Counter examples checklist\n", "## Shipping, then sorted\n\n- [ ] Turn 1: How long does shipping to Canada take? → reply\n- [ ] Turn 2: Thanks, that answers my question! → close\n",
      "## A person, please\n\n- [ ] Turn 1: Please connect me to a human agent. → handoff\n"],
    check: (out) => {
      assert.equal((out.text.match(/^## /gm) || []).length, 5);
      assert.equal((out.text.match(/^- \[ \] /gm) || []).length, 10);
      const odd = feature("checklist_md").build(fakeCtx({ items: [{ label: "Short", turns: ["Hi", "Hello?"], expect: ["clarify"] }] }));
      assert.ok(odd.includes("- [ ] Turn 2: Hello? → (no expectation)"));
    } },

  say_progress: { ctx: () => ctx(), hidden: () => ctx({ chat: "typed" }), check: (c) => {
    assert.equal(c.env.toasts[0].message, "Frustration builds: 3 of 3 turns sent, following the example.");
    const odd = ctx({ chat: "odd" });
    feature("say_progress").run(odd);
    assert.equal(odd.env.toasts[0].message, "Missing the point: 2 of 3 turns sent, departed from the example.");
    assert.deepEqual(c.log, [], "it only reports");
  } },
}, { ctx: () => ctx() });
