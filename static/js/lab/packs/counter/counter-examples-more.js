// More for the Counter page's example chips ("counter.examples", contract: static/js/lab/surfaces/counter.js): wording
// and expectation facts, consistency checks on the hand-written expectations, a per-turn CSV export and chat
// shortcuts. Expectations are compared only with the decisions of the user's own chat in this page load, and
// never shown as what Jev or the policy decided. Nothing here sends a turn or calls the model.
import { csvText, definePack } from "../../kit.js";

const ACTIONS = ["reply", "clarify", "close", "handoff"];
const turnsOf = (item) => (Array.isArray(item?.turns) ? item.turns.filter((turn) => typeof turn === "string") : []);
const expectOf = (item) => (Array.isArray(item?.expect) ? item.expect.filter((action) => typeof action === "string") : []);
const countChar = (item, char) => {
  const turns = turnsOf(item);
  return turns.length ? turns.reduce((total, turn) => total + [...turn].filter((c) => c === char).length, 0) : null;
};
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listText = (values) => (values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`);
const chatOf = (ctx) => ctx?.data?.chat || null;
const activeItem = (ctx) => {
  const index = chatOf(ctx)?.index;
  return Number.isInteger(index) ? ctx.items().find((item) => item.index === index) || null : null;
};
const policyNote = (ctx) => (ctx?.data?.defaults_in_force ? "the default policy is in force" : "the policy differs from the defaults the expectation was written for");

// Whether another chat may start without losing turns the user is still working on: nothing sent, a stopped chat, or
// an example followed to its last turn.
const settled = (ctx) => {
  const chat = chatOf(ctx);
  if (!chat || ctx.data.running || !ctx.items().length) return false;
  const active = activeItem(ctx);
  return chat.turns === 0 || !!chat.stopped || (!!active && active.following && active.sent >= turnsOf(active).length);
};

const ORDER_WORDS = /\b(?:orders?|refunds?|parcels?|tracking|deliver(?:y|ed))\b/i;

export default definePack({
  id: "counter-examples-more",
  surface: "counter.examples",
  title: "More example tools",
  about: "Wording and expectation facts, expectation consistency checks, a per-turn CSV and chat shortcuts for Counter's built-in "
    + "example conversations. Exports hold the built-in turns and hand-written expectations only; an expectation is compared only with your own chat's decisions.",
  features: [
    { id: "question_marks", kind: "fact", type: "number", label: "question marks in all turns", value: (item) => countChar(item, "?") },
    { id: "exclamation_marks", kind: "fact", type: "number", label: "exclamation marks in all turns", value: (item) => countChar(item, "!") },
    { id: "expected_replies", kind: "fact", type: "number", label: "turns expected to get a template reply",
      help: "Hand-written expectations that say reply.", value: (item) => { const expect = expectOf(item); return expect.length ? expect.filter((action) => action === "reply").length : null; } },
    { id: "mentions_order", kind: "fact", type: "flag", label: "a customer word about an order, refund, parcel, tracking or delivery",
      help: "A turn uses one of the words order, refund, parcel, tracking, delivery or delivered (singular or plural, any case).", value: (item) => turnsOf(item).some((turn) => ORDER_WORDS.test(turn)) },
    { id: "expect_sequence", kind: "fact", type: "category", label: "expected decision sequence",
      help: "The hand-written expectations in order, such as reply → close.", value: (item) => { const expect = expectOf(item); return expect.length ? expect.join(" → ") : null; } },

    { id: "unknown_action", kind: "diagnostic", severity: "problem", label: "An expectation names an unknown decision",
      check: (item, ctx) => {
        const known = Array.isArray(ctx?.data?.actions) && ctx.data.actions.length ? ctx.data.actions : ACTIONS;
        return expectOf(item).flatMap((action, index) => (known.includes(action) ? []
          : [`Turn ${index + 1} of ${item.label} expects “${action}”, which is not one of ${known.join(", ")}.`]));
      } },
    { id: "after_handoff", kind: "diagnostic", severity: "problem", label: "An expectation after a handoff",
      help: "A handoff is final for the chat: the page closes the composer, so no later turn can be sent.",
      check: (item) => {
        const expect = expectOf(item);
        const at = expect.indexOf("handoff");
        if (at < 0 || at === expect.length - 1) return null;
        return `${item.label} expects a handoff on turn ${at + 1} and then ${plural(expect.length - at - 1, "more turn")}; a handoff ends the chat.`;
      } },
    { id: "duplicate_labels", kind: "diagnostic", severity: "advice", scope: "list", label: "Two examples share a name",
      help: "Names are compared ignoring case and spacing.",
      check: (items) => {
        const seen = new Map();
        for (const item of items) {
          const label = String(item?.label ?? "").trim().replace(/\s+/g, " ");
          const key = label.toLowerCase();
          if (!key || !Number.isInteger(item.position)) continue;
          if (!seen.has(key)) seen.set(key, { label, positions: [] });
          seen.get(key).positions.push(item.position);
        }
        return [...seen.values()].filter(({ positions }) => positions.length > 1)
          .map(({ label, positions }) => `Examples ${listText(positions)} share the name “${label}”.`);
      } },
    { id: "departs", kind: "diagnostic", severity: "info", label: "Your chat departs from the expectation",
      help: "The first sent turn where your chat's current decision differs from the hand-written expectation.",
      check: (item, ctx) => {
        if (!item?.active || !item.following) return null;
        const actions = Array.isArray(chatOf(ctx)?.actions) ? chatOf(ctx).actions : [];
        const expect = expectOf(item);
        const compared = Math.min(item.sent, expect.length, actions.length);
        for (let i = 0; i < compared; i++) {
          if (actions[i] !== expect[i]) return `On turn ${i + 1} your chat's current decision is ${actions[i] ?? "missing"}; the hand-written expectation is ${expect[i]} (${policyNote(ctx)}).`;
        }
        return null;
      } },

    { id: "turns_csv", kind: "exporter", label: "Shown examples' turns as CSV",
      help: "one row per built-in customer turn with its hand-written expectation (an expectation beyond the last turn gets a row "
        + "with a blank customer cell); no answers or decisions",
      filename: "counter-example-turns.csv", mime: "text/csv",
      build: (ctx) => csvText([["example", "position", "turn", "customer", "expected"],
        ...ctx.shown().flatMap((item) => {
          const turns = turnsOf(item), expect = expectOf(item);
          return Array.from({ length: Math.max(turns.length, expect.length) }, (_, i) => [item.label, item.position, i + 1, turns[i] ?? "", expect[i] ?? ""]);
        })]) },

    { id: "start_previous", kind: "command", title: "Start the previous example", group: "Counter", keys: "Alt+Shift+P",
      when: settled,
      run: (ctx) => {
        const items = ctx.items();
        const active = activeItem(ctx);
        const previous = active ? items[(items.indexOf(active) - 1 + items.length) % items.length] : items[items.length - 1];
        if (!previous) throw new Error("There is no example to start.");
        ctx.actions.start(previous.index, { discard: chatOf(ctx).turns > 0 });
        ctx.env?.toast?.(`Loaded “${previous.label}”. Press Next sample turn to send its first message.`);
      } },
    { id: "copy_expectations", kind: "command", title: "Copy the current example's expected decisions", group: "Counter",
      when: (ctx) => !!activeItem(ctx) && expectOf(activeItem(ctx)).length > 0,
      run: (ctx) => {
        const active = activeItem(ctx);
        if (!active) throw new Error("The current chat did not start from an example.");
        ctx.env.copy(expectOf(active).map((action, i) => `${i + 1}. ${action}`).join("\n"));
        ctx.env.toast?.("Copied the hand-written expectations for the default policy; they are not Jev's answers.");
      } },
  ],
});
