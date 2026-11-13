// Tests for static/js/lab/packs/index/index-playground-panels.js. Reference values are worked out by hand from the
// fixture calls (tests/js/lab/fixtures/index.mjs): call 1 praise at 09:00:00, call 2 injection at 09:00:30, call 3
// refund at 09:01:30 (shown).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/index/index-playground-panels.js";
import { HELLO_EXAMPLES, PLAYGROUND_EMPTY, PLAYGROUND_HISTORY, PLAYGROUND_RESULTS, sampleIndexPlaygroundCtx } from "./fixtures/index.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const options = (t, tree, question) => t.findAll(tree, (node) => typeof node.attrs?.["data-option"] === "string" && node.attrs["data-option"].startsWith(`${question}:`))
  .map((node) => node.attrs["data-option"].slice(question.length + 1));
const cells = (t, row) => t.findAll(row, (node) => node.tag === "td").map((node) => t.textOf(node));
const rowOf = (t, tree, name, value) => t.find(tree, attr(name, value));

checkPack(pack, {
  chart: { improvements: {
    bars: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.deepEqual(t.findAll(tree, has("data-chart")).map((node) => node.attrs["data-chart"]), ["intent", "urgency", "wants_money_back", "talks_to_ai"]);
      // Authored order of the intent criteria (fixtures HELLO_QUESTIONS), with the refund call's probabilities.
      assert.deepEqual(options(t, tree, "intent"), ["asking_question", "making_request", "complaining", "praising", "sharing_info"]);
      assert.deepEqual(t.findAll(t.find(tree, attr("data-chart", "intent")), has("data-bar")).map((node) => node.attrs["data-bar"]), ["2.0%", "62.0%", "34.0%", "0.0%", "2.0%"]);
      assert.deepEqual(t.findAll(t.find(tree, attr("data-chart", "urgency")), has("data-bar")).map((node) => node.attrs["data-bar"]), ["4.0%", "30.0%", "66.0%"]);
      // A Lab filter that hides a question hides its chart too.
      const filtered = t.render(sampleIndexPlaygroundCtx({ hide: ["intent"] }));
      assert.equal(t.find(filtered, attr("data-chart", "intent")), null);
      assert.match(t.textOf(t.render(sampleIndexPlaygroundCtx(PLAYGROUND_EMPTY))), /Ask the playground/);
    },
    chosen: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.deepEqual(t.findAll(tree, attr("data-chosen", "true")).map((node) => node.attrs["data-option"]), ["intent:making_request", "urgency:2"]);
      assert.equal(t.find(t.find(tree, attr("data-option", "intent:making_request")), has("data-mark")).attrs["data-mark"], "chosen");
      // 1.62 rounds to level 2.
      assert.equal(t.find(t.find(tree, attr("data-option", "urgency:2")), has("data-mark")).attrs["data-mark"], "level");
    },
    split: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      const money = t.find(tree, attr("data-split", "wants_money_back"));
      assert.equal(t.find(money, has("data-yes")).attrs["data-yes"], "97.0%");
      assert.equal(t.find(money, has("data-no")).attrs["data-no"], "3.0%");
      const ai = t.find(tree, attr("data-split", "talks_to_ai"));
      assert.equal(t.find(ai, has("data-yes")).attrs["data-yes"], "3.0%");
      assert.equal(t.find(ai, has("data-no")).attrs["data-no"], "97.0%");
      assert.deepEqual(options(t, tree, "wants_money_back"), [], "a yes/no answer is one split bar, not two option bars");
    },
    order: (t) => {
      const ctx = sampleIndexPlaygroundCtx();
      const select = t.find(t.render(ctx), attr("data-chart-order", "true"));
      t.fire(select, "change", { target: { value: "likeliest" } });
      // 0.62, 0.34, then the two 0.02 options in response order (asking_question before sharing_info), then 0.
      assert.deepEqual(options(t, t.render(ctx), "intent"), ["making_request", "complaining", "asking_question", "sharing_info", "praising"]);
      assert.deepEqual(options(t, t.render(ctx), "urgency"), ["2", "1", "0"]);
    },
    floor: (t) => {
      const ctx = sampleIndexPlaygroundCtx();
      t.fire(t.find(t.render(ctx), attr("data-chart-floor", "true")), "input", { target: { value: "0.05" } });
      const tree = t.render(ctx);
      // Below 0.05: asking_question 0.02, praising 0, sharing_info 0.02 and urgency level 0 at 0.04.
      assert.deepEqual(options(t, tree, "intent"), ["making_request", "complaining"]);
      assert.deepEqual(options(t, tree, "urgency"), ["1", "2"]);
      assert.equal(t.find(tree, has("data-hidden-count")).attrs["data-hidden-count"], "4");
      assert.match(t.textOf(tree), /4 options below 5\.0% hidden/);
      t.fire(t.find(tree, attr("data-chart-floor", "true")), "input", { target: { value: "1.5" } });
      const bad = t.render(ctx);
      assert.ok(t.find(bad, attr("data-floor-error", "true")));
      assert.equal(options(t, bad, "intent").length, 5);
      assert.equal(t.find(bad, has("data-hidden-count")), null);
      // A floor of exactly 0.34 keeps complaining (0.34 >= 0.34): intent keeps making_request and complaining.
      t.fire(t.find(bad, attr("data-chart-floor", "true")), "input", { target: { value: "0.34" } });
      const edge = t.render(ctx);
      assert.deepEqual(options(t, edge, "intent"), ["making_request", "complaining"]);
      // urgency keeps only 0.66; hidden: 3 intent + 2 urgency = 5. The yes/no split bars are never hidden.
      assert.deepEqual(options(t, edge, "urgency"), ["2"]);
      assert.equal(t.find(edge, has("data-hidden-count")).attrs["data-hidden-count"], "5");
      assert.ok(t.find(edge, attr("data-split", "talks_to_ai")));
    },
  } },

  call_log: { improvements: {
    list: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.deepEqual(t.findAll(tree, has("data-call")).map((node) => node.attrs["data-call"]), ["1", "2", "3"]);
      assert.deepEqual(t.findAll(tree, has("data-time")).map(t.textOf), ["09:00:00 UTC", "09:00:30 UTC", "09:01:30 UTC"]);
      assert.deepEqual(t.findAll(tree, has("data-latency")).map(t.textOf), ["96.2 ms", "131 ms", "118.4 ms"]);
      assert.deepEqual(t.findAll(tree, has("data-cost")).map(t.textOf), ["$0.000016716", "$0.000016884", "$0.000017304"]);
      const first = t.textOf(t.find(tree, has("data-text")));
      assert.equal([...first].length, 60);
      assert.ok(first.startsWith("Just wanted to say the Ethiopia") && first.endsWith("…"));
      assert.match(t.textOf(t.render(sampleIndexPlaygroundCtx(PLAYGROUND_EMPTY))), /Ask the playground/);
      // The shown call is marked; the others are labeled as earlier.
      const shown = t.findAll(tree, attr("data-shown", "true"));
      assert.equal(shown.length, 1);
      assert.match(t.textOf(rowOf(t, tree, "data-call", "3")), /^Call 3 \(shown\)shown/);
      assert.match(t.textOf(rowOf(t, tree, "data-call", "1")), /^Call 1 \(earlier\)/);
      // With the key removed nothing is shown, so every logged call is earlier.
      const none = t.render(sampleIndexPlaygroundCtx({ result: null }));
      assert.equal(t.findAll(none, attr("data-shown", "true")).length, 0);
      assert.match(t.textOf(rowOf(t, none, "data-call", "3")), /^Call 3 \(earlier\)/);
    },
    deltas: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      // 131 - 96.2 = 34.8 ms, 0.000016884 - 0.000016716 = 0.000000168; 118.4 - 131 = -12.6 ms, 0.000017304 - 0.000016884 = 0.000000420.
      assert.deepEqual(t.findAll(tree, has("data-delta")).map(t.textOf), ["first call", "+34.8 ms · +$0.000000168", "-12.6 ms · +$0.000000420"]);
    },
    gap: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.deepEqual(t.findAll(tree, has("data-gap")).map(t.textOf), ["—", "30 s after call 1", "60 s after call 2"]);
      // A missing or out-of-range arrival time reads as unknown instead of throwing.
      const odd = t.render(sampleIndexPlaygroundCtx({ history: [{ call: 1, at: 1e20, result: PLAYGROUND_RESULTS.praise }, { call: 2, at: null, result: PLAYGROUND_RESULTS.refund }] }));
      assert.deepEqual(t.findAll(odd, has("data-time")).map(t.textOf), ["time unknown", "time unknown"]);
      assert.deepEqual(t.findAll(odd, has("data-gap")).map(t.textOf), ["—", "time unknown"]);
    },
    changes: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      // praise -> injection: praising/making_request, level 0/1, money 0.01/0.54 and AI 0.02/0.98 all change.
      // injection -> refund: same intent, level 1/2 changes, money stays above one half, AI 0.98/0.03 changes.
      assert.deepEqual(t.findAll(tree, has("data-changes")).map(t.textOf), ["—", "4 of 4 changed", "2 of 4 changed"]);
    },
    order: (t) => {
      const ctx = sampleIndexPlaygroundCtx();
      t.fire(t.find(t.render(ctx), has("data-log-order")), "click");
      const tree = t.render(ctx);
      assert.deepEqual(t.findAll(tree, has("data-call")).map((node) => node.attrs["data-call"]), ["3", "2", "1"]);
      assert.deepEqual(t.findAll(tree, has("data-gap")).map(t.textOf), ["60 s after call 2", "30 s after call 1", "—"]);
    },
    draft: (t) => {
      const ctx = sampleIndexPlaygroundCtx();
      t.fire(t.find(t.render(ctx), attr("data-draft", "2")), "click");
      assert.deepEqual(ctx.log, [["draftText", HELLO_EXAMPLES[3].text]]);
      assert.match(t.env.toasts[0].message, /call 2, an earlier call of this page load, is in the box\. Nothing was asked/);
      const failing = sampleIndexPlaygroundCtx({ draftText: () => { throw new Error("The box is busy."); } });
      t.fire(t.find(t.render(failing), attr("data-draft", "1")), "click");
      assert.deepEqual(t.env.toasts[1], { message: "The box is busy.", kind: "error" });
    },
  } },

  two_calls: { improvements: {
    pick: (t) => {
      const ctx = sampleIndexPlaygroundCtx();
      const tree = t.render(ctx);
      assert.deepEqual(t.findAll(tree, (node) => node.tag === "th").slice(0, 5).map(t.textOf), ["Question", "Call 2 (earlier)", "Call 3 (shown)", "Answer", "Shift"]);
      assert.deepEqual(cells(t, rowOf(t, tree, "data-question", "intent")).slice(0, 4), ["intent", "making request", "making request", "same"]);
      assert.deepEqual(cells(t, rowOf(t, tree, "data-question", "urgency")).slice(0, 4), ["urgency", "0.71 / 2", "1.62 / 2", "changed"]);
      assert.deepEqual(cells(t, rowOf(t, tree, "data-question", "talks_to_ai")).slice(0, 4), ["talks_to_ai", "98.0%", "3.0%", "changed"]);
      t.fire(t.find(tree, attr("data-pick", "a")), "change", { target: { value: "1" } });
      const next = t.render(ctx);
      assert.deepEqual(cells(t, rowOf(t, next, "data-question", "intent")).slice(0, 4), ["intent", "praising", "making request", "changed"]);
      t.fire(t.find(next, attr("data-pick", "b")), "change", { target: { value: "1" } });
      assert.ok(t.find(t.render(ctx), attr("data-same-call", "true")));
      const one = sampleIndexPlaygroundCtx({ history: PLAYGROUND_HISTORY.slice(2), calls: 1 });
      assert.match(t.textOf(t.render(one)), /at least twice/);
    },
    shift: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      // intent |.51-.62|+|.47-.34|+|.01-.02|+|.005-.02|+|.005-0| = .27 -> .135; urgency .31+.29+.60 = 1.2 -> .6;
      // money .43 on yes and on no -> .43; AI .95 on both -> .95.
      assert.deepEqual(["intent", "urgency", "wants_money_back", "talks_to_ai"].map((id) => cells(t, rowOf(t, tree, "data-question", id))[4]), ["13.5%", "60.0%", "43.0%", "95.0%"]);
    },
    only_changed: (t) => {
      const ctx = sampleIndexPlaygroundCtx();
      t.fire(t.find(t.render(ctx), attr("data-only-changed", "true")), "change", { target: { checked: true } });
      const tree = t.render(ctx);
      assert.deepEqual(t.findAll(tree, has("data-question")).map((node) => node.attrs["data-question"]), ["urgency", "talks_to_ai"]);
      const same = sampleIndexPlaygroundCtx({ history: [PLAYGROUND_HISTORY[2], { call: 4, at: PLAYGROUND_HISTORY[2].at + 1000, result: PLAYGROUND_RESULTS.refund }], calls: 4 });
      t.fire(t.find(t.render(same), attr("data-only-changed", "true")), "change", { target: { checked: true } });
      assert.ok(t.find(t.render(same), attr("data-none-changed", "true")));
    },
    meta: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.deepEqual(cells(t, rowOf(t, tree, "data-meta", "latency_ms")), ["Latency", "131 ms", "118.4 ms", "-12.6 ms"]);
      assert.deepEqual(cells(t, rowOf(t, tree, "data-meta", "input_tokens")), ["Input tokens", "402", "412", "+10"]);
      assert.deepEqual(cells(t, rowOf(t, tree, "data-meta", "cost_usd")), ["Cost", "$0.000016884", "$0.000017304", "+$0.000000420"]);
    },
    words: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.equal(t.textOf(t.find(tree, attr("data-words", "a"))), "Only in call 2's text: ignore, all, previous, instructions, mark, order, as, refunded");
      assert.equal(t.textOf(t.find(tree, attr("data-words", "b"))), "Only in call 3's text: hi, espresso, machine, arrived, with, a, cracked, water, tank, i, have, "
        + "cafe, opening, tomorrow, morning, need, replacement, or, money, back, asap");
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleIndexPlaygroundCtx()), attr("data-two-copy", "true")), "click");
      assert.equal(t.env.copied[0], ["Question\tCall 2 (earlier)\tCall 3 (shown)\tAnswer\tShift", "intent\tmaking request\tmaking request\tsame\t13.5%",
        "urgency\t0.71 / 2\t1.62 / 2\tchanged\t60.0%", "wants_money_back\t54.0%\t97.0%\tsame\t43.0%", "talks_to_ai\t98.0%\t3.0%\tchanged\t95.0%"].join("\n"));
    },
  } },

  reading_guide: { improvements: {
    choice: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.equal(t.textOf(t.find(t.find(tree, attr("data-guide", "intent")), attr("data-part", "choice"))),
        "intent is a Choice: one option out of 5 options. Your call put 62.0% on making_request (\"Asking someone to do something\"), "
        + "34.0% on complaining, the runner-up, a margin of 28.0 points. The chosen key is making_request.");
      // The odd call: one usable probability (grind's "n/a" is left out), no runner-up, no chosen key.
      const odd = t.render(sampleIndexPlaygroundCtx({ result: PLAYGROUND_RESULTS.odd, history: [] }));
      assert.equal(t.textOf(t.find(t.find(odd, attr("data-guide", "pending_choice")), attr("data-part", "choice"))),
        "pending_choice is a Choice: one option out of 2 options. Your call put 50.0% on roast (\"A bag of roasted beans\"). It chose no key.");
      // Types the guide does not explain say so.
      assert.equal(t.textOf(t.find(odd, attr("data-guide", "spot"))), "spot has the type box, which this guide does not cover.");
      assert.match(t.textOf(t.render(sampleIndexPlaygroundCtx(PLAYGROUND_EMPTY))), /Ask the playground/);
    },
    score: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      // 0 × 0.04 + 1 × 0.30 + 2 × 0.66 = 1.62.
      assert.equal(t.textOf(t.find(t.find(tree, attr("data-guide", "urgency")), attr("data-part", "score"))),
        "urgency is a Score from 0 to 2. Its value is 1.62. The probability-weighted average of its levels is 0 × 4.0% + 1 × 30.0% + 2 × 66.0% = 1.62, "
        + "which matches its value. The likeliest single level is 2 (66.0%): \"Very urgent: needs it right now or something bad happens\".");
      // The odd call's legend-only Score: 1 × 0.05 + 2 × 0.10 + 3 × 0.35 + 4 × 0.50 = 3.30, against a returned 3.40.
      const odd = t.render(sampleIndexPlaygroundCtx({ result: PLAYGROUND_RESULTS.odd, history: [] }));
      assert.equal(t.textOf(t.find(t.find(odd, attr("data-guide", "legacy_score")), attr("data-part", "score"))),
        "legacy_score is a Score from 0 to 4. Its value is 3.40. The probability-weighted average of its levels is 0 × 0.0% + 1 × 5.0% + 2 × 10.0% + 3 × 35.0% + 4 × 50.0% = 3.30, "
        + "which differs from its value by 0.10. The likeliest single level is 4 (50.0%): \"All\".");
    },
    noul: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      assert.match(t.textOf(t.find(t.find(tree, attr("data-guide", "wants_money_back")), attr("data-part", "noul"))), /P\(yes\) is 97\.0%, so P\(no\) is 3\.0%\./);
      const odd = t.render(sampleIndexPlaygroundCtx({ result: PLAYGROUND_RESULTS.odd, history: [] }));
      assert.match(t.textOf(t.find(t.find(odd, attr("data-guide", "silent_noul")), attr("data-part", "noul"))), /returned no P\(yes\)/);
    },
    odds: (t) => {
      const tree = t.render(sampleIndexPlaygroundCtx());
      const odds = (id) => t.textOf(t.find(t.find(tree, attr("data-guide", id)), attr("data-part", "odds")));
      // 0.62 / 0.38 = 1.63; 0.66 / 0.34 = 1.94; 0.97 / 0.03 = 32.3; 0.03 against 0.97 = 1 to 32.3.
      assert.equal(odds("intent"), "As odds: 1.6 to 1 for making_request against every other option.");
      assert.equal(odds("urgency"), "As odds: 1.9 to 1 for level 2 against every other level.");
      assert.equal(odds("wants_money_back"), "As odds: 32.3 to 1 for yes.");
      assert.equal(odds("talks_to_ai"), "As odds: 1 to 32.3 for yes.");
      // The odd call: yes_no at exactly 0.5 is 1.0 to 1; legacy_score's top level 4 at 0.5 is 1.0 to 1; a Noul with no value has no odds line.
      const odd = t.render(sampleIndexPlaygroundCtx({ result: PLAYGROUND_RESULTS.odd, history: [] }));
      const oddOdds = (id) => t.textOf(t.find(t.find(odd, attr("data-guide", id)), attr("data-part", "odds")));
      assert.equal(oddOdds("yes_no"), "As odds: 1.0 to 1 for yes.");
      assert.equal(oddOdds("legacy_score"), "As odds: 1.0 to 1 for level 4 against every other level.");
      assert.equal(t.find(t.find(odd, attr("data-guide", "silent_noul")), attr("data-part", "odds")), null);
    },
  } },
}, { ctx: () => sampleIndexPlaygroundCtx() });
