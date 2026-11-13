// Tests for static/js/lab/packs/counter/counter-panels.js on the fixtures of tests/js/lab/fixtures/counter.mjs.
// Expected values are worked out by hand from the fixture chats:
//   "frustration": turns reply, clarify, handoff (sent and now alike), default policy, handed off at turn 3.
//     Intents (the named ones, the rest shared equally): turn 1 order_status .82, shipping .12, others .06/5 = .012;
//     turn 2 order_status .48, return_policy .40 (the model's choice), others .12/5 = .024; turn 3 order_status .66,
//     return_policy .20, others .14/5 = .028. Means: shipping (.12 + .024 + .028)/3 = .0573, return_policy .612/3 = .204,
//     order_status 1.96/3 = .653, the four quiet intents .064/3 = .021 (no turn gives them 5%).
//     Evidence: frustration 1.1, 3.2, 3.8; person .04, .18, .41; missed .02, .35, .62; resolved .03, .01, 0; top intent
//     .82, .48, .66 -> turn 2 moves +2.10, +0.14, +0.33, −0.02, −0.34; turn 3 +0.60, +0.23, +0.27, −0.01, +0.18. The largest
//     move on a common scale is frustration 2.1 / 4 = .525.
//     Latency 412.3, 388, 451.7 (mean 417.3); cost .000071, .000074, .000077; input tokens 1180, 1236, 1302 -> (1302 − 1180)/2 = 61.
//   "relaxed": the same turns re-decided with streak_turns 3: turn 3 is a reply (order_status) now, sent as a handoff.
//   "shipping": reply, close; 2 of 20 turns, open; tokens 1150, 1199 -> 49.  "long": 20 replies, latency 300 + 10n.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/counter/counter-panels.js";
import { COUNTER_POLICY, sampleCounterChats, sampleCounterTurnsCtx } from "./fixtures/counter.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const cellsOf = (t, row) => t.findAll(row, (node) => node.tag === "td").map(t.textOf);
const part = (t, root, name) => t.find(root, attr("data-part", name));
const line = (t, root, key) => t.textOf(t.find(root, attr("data-line", key)));
const turnRows = (t, root) => t.findAll(root, (node) => node.tag === "tr" && has("data-turn")(node)).map((node) => node.attrs["data-turn"]);
const empty = () => sampleCounterTurnsCtx({ chat: "empty" });
const STREAK = "Frustration stayed above the cut for 2 consecutive turns.";

checkPack(pack, {
  timeline: { improvements: {
    rows: (t) => {
      const root = t.render(sampleCounterTurnsCtx());
      assert.deepEqual(turnRows(t, root), ["1", "2", "3"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-turn", "1"))), ["Turn 1", "reply", "reply", "The intent selects a fixed reply.", ""]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-turn", "3"))).slice(0, 4), ["Turn 3", "handoff", "handoff", STREAK]);
      assert.deepEqual(cellsOf(t, t.find(t.render(sampleCounterTurnsCtx({ chat: "relaxed" })), attr("data-turn", "3"))).slice(1, 3), ["reply", "handoff"]);
      assert.deepEqual(cellsOf(t, t.find(t.render(sampleCounterTurnsCtx({ chat: "odd" })), attr("data-turn", "2"))).slice(1, 4), ["—", "—", "—"]);
      assert.match(t.textOf(t.render(empty())), /Send a customer turn/);
      // Turns decided differently now are noted: the relaxed chat's turn 3 only.
      assert.deepEqual(t.findAll(t.render(sampleCounterTurnsCtx()), has("data-changed")), []);
      const relaxed = t.render(sampleCounterTurnsCtx({ chat: "relaxed" }));
      assert.deepEqual(t.findAll(relaxed, has("data-changed")).map((node) => node.attrs["data-turn"]), ["3"]);
      assert.equal(cellsOf(t, t.find(relaxed, attr("data-turn", "3")))[4], "changed since sent · shift: clarify → reply");
      // Customer messages appear only when asked, clipped to 60 characters.
      const ctx = sampleCounterTurnsCtx({ hide: [2] });
      assert.equal(t.find(t.render(ctx), has("data-message")), null);
      t.fire(t.find(t.render(ctx), attr("data-control", "messages")), "change", { target: { checked: true } });
      assert.deepEqual(t.findAll(t.render(ctx), has("data-message")).map(t.textOf).slice(0, 2),
        ["Where is my order?", "This is ridiculous. I've waited weeks and your tracking is …"]);
      // The timeline shows every turn unless asked to keep to the turns the Lab filters show.
      assert.deepEqual(turnRows(t, t.render(ctx)), ["1", "2", "3"]);
      t.fire(t.find(t.render(ctx), attr("data-control", "shown-only")), "change", { target: { checked: true } });
      const only = t.render(ctx);
      assert.deepEqual(turnRows(t, only), ["1", "3"]);
      assert.equal(t.find(only, attr("data-turn", "3")).attrs["data-shift"], "clarify → handoff", "the shift still compares with turn 2");
    },
    shifts: (t) => {
      const root = t.render(sampleCounterTurnsCtx());
      assert.deepEqual(t.findAll(root, has("data-shift")).map((node) => [node.attrs["data-turn"], node.attrs["data-shift"]]),
        [["2", "reply → clarify"], ["3", "clarify → handoff"]]);
      assert.deepEqual(t.findAll(t.render(sampleCounterTurnsCtx({ chat: "long" })), has("data-shift")), []);
    },
    path: (t) => {
      const root = t.render(sampleCounterTurnsCtx({ chat: "relaxed" }));
      assert.equal(t.textOf(part(t, root, "path-now")), "Now: reply → clarify → reply");
      assert.equal(t.textOf(part(t, root, "path-sent")), "As sent: reply → clarify → handoff");
      assert.equal(t.textOf(part(t, t.render(sampleCounterTurnsCtx({ chat: "long" })), "path-now")), "Now: reply ×20");
    },
  } },

  what_if: { improvements: {
    settings: (t) => {
      const root = t.render(sampleCounterTurnsCtx({ chat: "relaxed" }));
      assert.deepEqual(t.findAll(root, has("data-setting")).map((node) => node.attrs["data-setting"]),
        ["person_at", "frustration_at", "streak_turns", "missed_at", "missed_turns", "intent_min", "resolved_at"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-setting", "streak_turns"))).slice(0, 5), ["Consecutive frustrated turns", "3", "2", "3", "2"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-setting", "frustration_at"))).slice(1, 5), ["2.5", "2.5", "2.5", "2.5"]);
      assert.match(t.textOf(t.render(sampleCounterTurnsCtx({ setup: null }))), /not loaded yet/);
    },
    rules: (t) => {
      const root = t.render(sampleCounterTurnsCtx());
      const rules = (key) => t.textOf(t.find(t.find(root, attr("data-setting", key)), has("data-rules")));
      assert.equal(rules("person_at"), "2. The customer asks for a person");
      assert.equal(rules("streak_turns"), "3. Frustration stayed above the cut for consecutive turns");
      assert.equal(rules("missed_turns"), "4. The bot missed the point too often");
      assert.equal(rules("resolved_at"), "5. The customer's need is met");
      assert.equal(rules("intent_min"), "6. The intent is uncertain or has no reply template");
    },
    undo: (t) => {
      const ctx = sampleCounterTurnsCtx();
      assert.equal(t.find(t.render(ctx), attr("data-action", "undo")), null);
      t.fire(t.find(t.render(ctx), attr("data-step", "missed_turns:1")), "click");
      t.fire(t.find(t.render(ctx), attr("data-action", "undo")), "click");
      assert.deepEqual(ctx.log.map((entry) => entry[1].missed_turns), [3, 2]);
      assert.deepEqual(ctx.state.policy, { ...COUNTER_POLICY });
      // Undo is one step: once the sliders are back, there is nothing left to undo (it does not redo).
      assert.equal(t.find(t.render(ctx), attr("data-action", "undo")), null);
    },
    changed_turns: (t) => {
      const ctx = sampleCounterTurnsCtx();
      // Stepping goes through setPolicy only: one notch of the slider's step, and never past its ends.
      const low = sampleCounterTurnsCtx({ policy: { ...COUNTER_POLICY, streak_turns: 1 } });
      assert.equal(t.find(t.render(low), attr("data-step", "streak_turns:-1")).attrs.disabled, true);
      assert.equal(t.find(t.render(low), attr("data-step", "streak_turns:1")).attrs.disabled, false);
      t.fire(t.find(t.render(ctx), attr("data-step", "streak_turns:1")), "click");
      assert.deepEqual(ctx.log, [["setPolicy", { ...COUNTER_POLICY, streak_turns: 3 }]]);
      assert.match(t.env.toasts[0].message, /no Jev call/);
      assert.equal(t.textOf(part(t, t.render(ctx), "what-if")), "Waiting for the page to re-decide the last what-if.");
      // The page's re-decide answers: the decisions of the relaxed chat under streak_turns 3.
      ctx.state.decidedWith = { ...COUNTER_POLICY, streak_turns: 3 };
      ctx.state.decisions = sampleCounterChats().relaxed.decisions;
      const root = t.render(ctx);
      assert.deepEqual(t.findAll(root, has("data-diff")).map((node) => [node.attrs["data-diff"], t.textOf(node)]), [["3", "Turn 3: handoff → reply (order_status)"]]);
      // A what-if that changes no decision says so.
      // A typed value: 0.65 is on intent_min's 0.05 grid; the turns keep their decisions, and the panel says so.
      t.fire(t.find(t.render(ctx), attr("data-input", "intent_min")), "input", { target: { value: "0.65" } });
      t.fire(t.find(t.render(ctx), attr("data-apply", "intent_min")), "click");
      assert.deepEqual(ctx.log[1], ["setPolicy", { ...COUNTER_POLICY, streak_turns: 3, intent_min: 0.65 }]);
      ctx.state.decidedWith = { ...ctx.state.policy };
      assert.equal(t.textOf(part(t, t.render(ctx), "what-if")), "The last what-if changed no turn's decision.");
      // 0.63 is off the grid: the page's guard refuses it and nothing moves.
      t.fire(t.find(t.render(ctx), attr("data-input", "intent_min")), "input", { target: { value: "0.63" } });
      t.fire(t.find(t.render(ctx), attr("data-apply", "intent_min")), "click");
      assert.equal(ctx.log.length, 2);
      assert.equal(t.env.toasts.at(-1).kind, "error");
      assert.match(t.env.toasts.at(-1).message, /steps of 0\.05/);
      // A new chat drops the comparison; a what-if on a chat with no turns says there was nothing to re-decide.
      Object.assign(ctx.state, { turns: [], transcript: [], decisions: [], decidedWith: null });
      assert.equal(part(t, t.render(ctx), "what-if"), null);
      t.fire(t.find(t.render(ctx), attr("data-step", "person_at:-1")), "click");
      assert.equal(t.textOf(part(t, t.render(ctx), "what-if")), "The chat had no turns to re-decide.");
    },
  } },

  answer_table: { improvements: {
    grid: (t) => {
      const root = t.render(sampleCounterTurnsCtx());
      const table = part(t, root, "intents");
      assert.deepEqual(t.findAll(table, has("data-intent")).map((node) => node.attrs["data-intent"]),
        ["shipping_times", "return_policy", "wholesale_pricing", "subscription_help", "brewing_guide", "order_status", "other"]);
      assert.deepEqual(cellsOf(t, t.find(table, attr("data-turn", "1"))), ["Turn 1", "0.12", "0.01", "0.01", "0.01", "0.01", "0.82 (top)", "0.01"]);
      assert.deepEqual(cellsOf(t, t.find(table, attr("data-turn", "3"))), ["Turn 3", "0.03", "0.20", "0.03", "0.03", "0.03", "0.66 (top)", "0.03"]);
      assert.deepEqual(turnRows(t, part(t, t.render(sampleCounterTurnsCtx({ hide: [1] })), "intents")), ["2", "3"]);
      assert.match(t.textOf(t.render(empty())), /Send a customer turn/);
    },
    marks: (t) => {
      const root = t.render(sampleCounterTurnsCtx());
      const row = t.find(part(t, root, "intents"), attr("data-turn", "2"));
      assert.deepEqual(t.findAll(row, has("data-top")).map((node) => node.attrs["data-cell"]), ["order_status"]);
      assert.deepEqual(t.findAll(root, has("data-choice")).map((node) => [node.attrs["data-cell"], t.textOf(node)]), [["return_policy", "0.40 (model's choice)"]]);
    },
    column_max: (t) => {
      const root = part(t, t.render(sampleCounterTurnsCtx()), "intents");
      const maxima = Object.fromEntries(t.findAll(root, has("data-col-max")).map((node) => [node.attrs["data-cell"],
        t.find(root, (tr) => tr.tag === "tr" && tr.children.includes(node)).attrs["data-turn"]]));
      assert.deepEqual(maxima, { shipping_times: "1", return_policy: "2", wholesale_pricing: "3", subscription_help: "3", brewing_guide: "3", order_status: "1", other: "3" });
    },
    quiet: (t) => {
      const ctx = sampleCounterTurnsCtx();
      t.fire(t.find(t.render(ctx), attr("data-control", "quiet")), "change", { target: { checked: true } });
      const table = part(t, t.render(ctx), "intents");
      assert.deepEqual(t.findAll(table, has("data-intent")).map((node) => node.attrs["data-intent"]), ["shipping_times", "return_policy", "order_status"]);
      assert.deepEqual(cellsOf(t, t.find(table, attr("data-turn", "2"))), ["Turn 2", "0.02", "0.40 (model's choice)", "0.48 (top)"]);
    },
    means: (t) => {
      assert.deepEqual(cellsOf(t, part(t, t.render(sampleCounterTurnsCtx()), "means")), ["Mean", "0.06", "0.20", "0.02", "0.02", "0.02", "0.65", "0.02"]);
    },
    deltas: (t) => {
      const table = part(t, t.render(sampleCounterTurnsCtx()), "deltas");
      assert.deepEqual(cellsOf(t, t.find(table, attr("data-turn", "1"))), ["Turn 1", "—", "—", "—", "—", "—"]);
      assert.deepEqual(cellsOf(t, t.find(table, attr("data-turn", "2"))), ["Turn 2", "+2.10", "+0.14", "+0.33", "−0.02", "−0.34"]);
      assert.deepEqual(cellsOf(t, t.find(table, attr("data-turn", "3"))), ["Turn 3", "+0.60", "+0.23", "+0.27", "−0.01", "+0.18"]);
    },
    biggest_jump: (t) => {
      assert.equal(t.textOf(part(t, t.render(sampleCounterTurnsCtx()), "jump")), "Largest move: frustration +2.10 (of 4) from turn 1 to turn 2.");
      // Without frustration's turn 2 shown, the largest move left is turn 3's: missed +0.27 vs frustration 0.60 / 4 = 0.15.
      assert.equal(t.textOf(part(t, t.render(sampleCounterTurnsCtx({ hide: [2] })), "jump")), "Largest move: missed +0.27 from turn 2 to turn 3.");
      assert.equal(t.textOf(part(t, t.render(sampleCounterTurnsCtx({ chat: "typed" })), "jump")), "No two consecutive turns to compare.");
    },
  } },

  summary_card: { improvements: {
    card: (t) => {
      const root = t.render(sampleCounterTurnsCtx());
      assert.equal(line(t, root, "card"), "Counter chat · Frustration builds · 3 customer turns of 20");
      assert.equal(line(t, root, "decisions"), "Decisions now: reply 1, clarify 1, handoff 1 · as sent: reply 1, clarify 1, handoff 1 · decided differently now: 0 turns");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "relaxed" })), "decisions"),
        "Decisions now: reply 2, clarify 1 · as sent: reply 1, clarify 1, handoff 1 · decided differently now: 1 turn");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "typed" })), "card"), "Counter chat · New chat · 1 customer turn of 20");
      assert.match(t.textOf(t.render(empty())), /Send a customer turn/);
      // Peaks: frustration 1.1, 3.2, 3.8 and ask-for-a-person .04, .18, .41 both peak at turn 3; shipping: 0.2 at turn 1, .02 at turn 2.
      assert.equal(line(t, root, "peaks"), "Peak frustration 3.8 of 4 (turn 3) · peak ask-for-a-person 0.41 (turn 3)");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "shipping" })), "peaks"), "Peak frustration 0.2 of 4 (turn 1) · peak ask-for-a-person 0.02 (turn 2)");
      // Measured: (412.3 + 388 + 451.7) / 3 = 417.33 ms; 20 turns at 300 + 10n ms average 405 ms, and with equal costs the first is named.
      assert.equal(line(t, root, "measured"), "Mean measured latency 417 ms · slowest turn 3 (452 ms) · costliest turn 3 ($0.000077)");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "long" })), "measured"), "Mean measured latency 405 ms · slowest turn 20 (500 ms) · costliest turn 1 ($0.000070)");
      // The odd chat: NaN latency and a text cost are not measurements.
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "odd" })), "measured"), "No measured calls.");
    },
    status: (t) => {
      assert.equal(line(t, t.render(sampleCounterTurnsCtx()), "status"), "Status: handed to a person at turn 3 (Frustration stayed above the cut for 2 consecutive turns).");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "relaxed" })), "status"), "Status: open; the latest decision (turn 3) is reply.");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "shipping" })), "status"), "Status: open; the latest turn (2) closes the need, and a new one may follow.");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "long" })), "status"), "Status: stopped at the 20-turn limit.");
    },
    progress: (t) => {
      assert.equal(line(t, t.render(sampleCounterTurnsCtx()), "progress"), "Example progress: 3 of 3 turns sent, following the example.");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "odd" })), "progress"), "Example progress: 2 of 3 turns sent; the chat departs from the example.");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "typed" })), "progress"), "No example: a new chat.");
    },
    policy: (t) => {
      assert.equal(line(t, t.render(sampleCounterTurnsCtx()), "policy"), "Policy: the defaults.");
      assert.equal(line(t, t.render(sampleCounterTurnsCtx({ chat: "relaxed" })), "policy"), "Policy: streak_turns 3 (default 2).");
    },
    copy_text: (t) => {
      const ctx = sampleCounterTurnsCtx();
      t.fire(t.find(t.render(ctx), attr("data-copy", "text")), "click");
      const lines = t.env.copied[0].trim().split("\n");
      assert.equal(lines[0], "Counter chat summary (your own chat: decisions and measured calls; no customer messages)");
      assert.equal(lines.length, 8);
      assert.ok(!t.env.copied[0].includes("Where is my order?"));
      // Only when asked: the first and latest customer messages join the card, and the copy says it holds them.
      assert.equal(t.find(t.render(ctx), attr("data-line", "first")), null);
      t.fire(t.find(t.render(ctx), attr("data-control", "messages")), "change", { target: { checked: true } });
      const root = t.render(ctx);
      assert.equal(line(t, root, "first"), "First customer message (turn 1): “Where is my order?”");
      assert.equal(line(t, root, "latest"), "Latest customer message (turn 3): “I'm furious. Still no parcel and no useful help!”");
      assert.equal(t.find(t.render(sampleCounterTurnsCtx({ chat: "typed" })), attr("data-line", "latest")), null, "a one-turn chat names its message once");
      t.fire(t.find(t.render(ctx), attr("data-copy", "text")), "click");
      assert.ok(t.env.copied[1].startsWith("Counter chat summary (your own chat: decisions and measured calls; first and latest customer messages)\n"));
      assert.ok(t.env.copied[1].endsWith("Latest customer message (turn 3): “I'm furious. Still no parcel and no useful help!”\n"));
    },
    copy_markdown: (t) => {
      t.fire(t.find(t.render(sampleCounterTurnsCtx()), attr("data-copy", "markdown")), "click");
      const lines = t.env.copied[0].split("\n");
      assert.equal(lines[0], "## Counter chat summary (your own chat: decisions and measured calls; no customer messages)");
      assert.equal(lines[1], "");
      assert.equal(lines[2], "- Counter chat · Frustration builds · 3 customer turns of 20");
      assert.equal(lines[8], "- Policy: the defaults.");
    },
  } },

  turns_left: [
    { ctx: sampleCounterTurnsCtx(), empty: empty(), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "handed to a person"); } },
    { ctx: sampleCounterTurnsCtx({ chat: "shipping" }), expect: (result) => { assert.equal(result.value, 18); assert.equal(result.detail, "of 20"); } },
    { ctx: sampleCounterTurnsCtx({ chat: "long" }), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "at the 20-turn limit"); } },
  ],
  token_growth: [
    { ctx: sampleCounterTurnsCtx(), empty: empty(), expect: (result) => { assert.equal(result.value, 61); assert.equal(result.detail, "from turn 1 to turn 3"); } },
    { ctx: sampleCounterTurnsCtx({ chat: "shipping" }), expect: 49 },
    { ctx: sampleCounterTurnsCtx({ chat: "typed" }), expect: null },
  ],
}, { ctx: () => sampleCounterTurnsCtx() });
