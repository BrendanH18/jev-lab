// Starter pack for the Counter page's example chips ("counter.examples", contract: static/js/lab/surfaces/counter.js).
// It reads the built-in example conversations and their hand-written expectations, and compares an expectation only
// with the decisions of the user's own chat in this page load. Nothing here sends a turn or calls the model.
import { definePack } from "../../kit.js";

const MAX_CHARS = 2000;
const MAX_TURNS = 20;
const turnsOf = (item) => (Array.isArray(item?.turns) ? item.turns.filter((turn) => typeof turn === "string") : []);
const expectOf = (item) => (Array.isArray(item?.expect) ? item.expect.filter((action) => typeof action === "string") : []);
const wordsIn = (text) => text.split(/\s+/).filter(Boolean).length;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const chatOf = (ctx) => ctx?.data?.chat || null;
const activeItem = (ctx) => {
  const index = chatOf(ctx)?.index;
  return Number.isInteger(index) ? ctx.items().find((item) => item.index === index) || null : null;
};

// The active example's sent turns compared with its expectations: { agree, compared } or null.
function agreement(ctx) {
  const item = activeItem(ctx);
  const actions = Array.isArray(chatOf(ctx)?.actions) ? chatOf(ctx).actions : [];
  if (!item || !item.following) return null;
  const expect = expectOf(item);
  const compared = Math.min(item.sent, expect.length, actions.length);
  if (!compared) return null;
  let agree = 0;
  for (let i = 0; i < compared; i++) if (actions[i] === expect[i]) agree++;
  return { agree, compared };
}

// Whether a pack may start another chat without losing turns the user is still working on.
const settled = (ctx) => {
  const chat = chatOf(ctx);
  if (!chat || ctx.data.running || !ctx.items().length) return false;
  const active = activeItem(ctx);
  return chat.turns === 0 || !!chat.stopped || (!!active && active.following && active.sent >= turnsOf(active).length);
};

export default definePack({
  id: "counter-example-guide",
  surface: "counter.examples",
  title: "Example guide",
  about: "Filters, checks, counts, exports and shortcuts over Counter's built-in example conversations and their hand-written expectations. "
    + "Exports hold inputs and expectations only; an expectation is compared only with your own chat's decisions, never shown as Jev's answer.",
  features: [
    { id: "turn_count", kind: "fact", type: "number", label: "customer turns", value: (item) => turnsOf(item).length || null },
    { id: "word_count", kind: "fact", type: "number", label: "customer words in all turns",
      value: (item) => turnsOf(item).reduce((total, turn) => total + wordsIn(turn), 0) || null },
    { id: "longest_turn", kind: "fact", type: "number", label: "longest turn in characters",
      value: (item) => { const turns = turnsOf(item); return turns.length ? Math.max(...turns.map((turn) => [...turn].length)) : null; } },
    { id: "first_handoff", kind: "fact", type: "number", label: "turn where a handoff is expected",
      help: "The first turn whose hand-written expectation is a handoff.",
      value: (item) => { const at = expectOf(item).indexOf("handoff"); return at < 0 ? null : at + 1; } },
    { id: "final_expect", kind: "fact", type: "category", label: "expected final decision",
      value: (item) => { const expect = expectOf(item); return expect.length ? expect[expect.length - 1] : null; } },
    { id: "expects_close", kind: "fact", type: "flag", label: "an expected close", value: (item) => expectOf(item).includes("close") },
    { id: "active", kind: "fact", type: "flag", label: "the example the current chat started from", value: (item) => item?.active === true },
    { id: "label", kind: "fact", type: "text", label: "example name", value: (item) => item?.label ?? "" },
    { id: "turn_text", kind: "fact", type: "text", label: "customer turn text", value: (item) => turnsOf(item).join(" / ") },
    { id: "on_track", kind: "fact", type: "flag", label: "your chat matching the expectation so far",
      help: "The current chat follows this example and every sent turn's current decision, under the policy now in force, equals its hand-written expectation.",
      value: (item, ctx) => {
        if (!item?.active) return false;
        const result = agreement(ctx);
        return !!result && result.agree === result.compared;
      } },

    { id: "expect_length", kind: "diagnostic", severity: "problem", label: "Expectations do not match the turns",
      check: (item) => {
        const turns = turnsOf(item).length, expect = expectOf(item).length;
        return turns === expect ? null : `${item.label} has ${plural(turns, "turn")} but ${plural(expect, "expectation")}.`;
      } },
    { id: "server_limits", kind: "diagnostic", severity: "problem", label: "The server would refuse this conversation",
      check: (item) => {
        const turns = turnsOf(item);
        const out = [];
        if (turns.length > MAX_TURNS) out.push(`${item.label} has ${turns.length} turns; a chat holds at most ${MAX_TURNS}.`);
        turns.forEach((turn, index) => {
          if (!turn.trim()) out.push(`Turn ${index + 1} of ${item.label} is blank.`);
          else if ([...turn].length > MAX_CHARS) out.push(`Turn ${index + 1} of ${item.label} is longer than ${MAX_CHARS.toLocaleString("en-US")} characters.`);
        });
        return out;
      } },
    { id: "duplicate_turns", kind: "diagnostic", severity: "advice", scope: "list", label: "The same customer turn in two examples",
      check: (items) => {
        const seen = new Map();
        for (const item of items) {
          for (const turn of new Set(turnsOf(item).map((text) => text.trim().toLowerCase()).filter(Boolean))) {
            if (!seen.has(turn)) seen.set(turn, []);
            seen.get(turn).push(String(item?.label ?? "an unnamed example"));
          }
        }
        return [...seen].filter(([, labels]) => labels.length > 1).map(([turn, labels]) => `“${turn}” appears in ${labels.join(" and ")}.`);
      } },

    { id: "calls_to_run_all", kind: "metric", format: "integer", label: "Live calls to step through the shown examples",
      help: "One call per customer turn: an upper bound of calls, not spend.",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? shown.reduce((total, item) => total + turnsOf(item).length, 0) : null;
      } },
    { id: "expectation_agreement", kind: "metric", format: "percent", label: "Your chat's decisions that match the example's expectation",
      help: "The sent turns of the example the current chat follows, under the policy now in force.",
      compute: (ctx) => {
        const result = agreement(ctx);
        if (!result) return null;
        const policy = ctx.data.defaults_in_force ? "default policy in force" : "policy changed from the defaults";
        return { value: result.agree / result.compared, detail: `${result.agree} of ${plural(result.compared, "sent turn")}; ${policy}` };
      } },

    { id: "examples_md", kind: "exporter", label: "Shown examples as Markdown",
      help: "the built-in customer turns with the hand-written expectation of each; no answers or decisions",
      filename: "counter-examples.md", mime: "text/markdown",
      build: (ctx) => {
        const lines = ["# Counter example conversations", "", "Built-in customer turns and the hand-written expectation of each for the default policy; no answers.", ""];
        for (const item of ctx.shown()) {
          const expect = expectOf(item);
          lines.push(`## ${item.label}`, "", ...turnsOf(item).map((turn, index) => `${index + 1}. ${turn} (expected: ${expect[index] ?? "none"})`), "");
        }
        return lines.join("\n");
      } },
    { id: "examples_jsonl", kind: "exporter", label: "Shown examples as JSON Lines",
      help: "one line per example with its label, customer turns and hand-written expectations; no answers",
      filename: "counter-examples.jsonl", mime: "application/x-ndjson",
      build: (ctx) => ctx.shown().map((item) => `${JSON.stringify({ label: item.label, turns: turnsOf(item), expect: expectOf(item) })}\n`).join("") },

    { id: "start_next", kind: "command", title: "Start the next example", group: "Counter", keys: "Alt+Shift+N",
      when: settled,
      run: (ctx) => {
        const items = ctx.items();
        const active = activeItem(ctx);
        const next = active ? items[(items.indexOf(active) + 1) % items.length] : items[0];
        if (!next) throw new Error("There is no example to start.");
        ctx.actions.start(next.index, { discard: chatOf(ctx).turns > 0 });
        ctx.env?.toast?.(`Loaded “${next.label}”. Press Next sample turn to send its first message.`);
      } },
    { id: "restart_active", kind: "command", title: "Restart the current example from its first turn", group: "Counter",
      when: (ctx) => !!activeItem(ctx) && chatOf(ctx).turns > 0 && settled(ctx),
      run: (ctx) => {
        const active = activeItem(ctx);
        if (!active) throw new Error("The current chat did not start from an example.");
        ctx.actions.start(active.index, { discard: true });
      } },
    { id: "copy_turns", kind: "command", title: "Copy the current example's customer turns", group: "Counter",
      when: (ctx) => !!activeItem(ctx),
      run: (ctx) => {
        const active = activeItem(ctx);
        if (!active) throw new Error("The current chat did not start from an example.");
        ctx.env.copy(turnsOf(active).map((turn, index) => `${index + 1}. ${turn}`).join("\n"));
        ctx.env.toast?.("Copied the example's customer turns, without expectations.");
      } },
  ],
});
