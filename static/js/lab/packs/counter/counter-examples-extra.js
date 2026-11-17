// More facts, a consistency check, a metric, a checklist export and a progress command for the Counter page's example
// chips ("counter.examples", contract: static/js/lab/surfaces/counter.js). The examples are built-in scenarios with a
// hand-written expectation of what the DEFAULT policy decides; nothing here is Jev's answer or the page's decision,
// nothing starts an example or sends a turn, and the wording rule is plain local code.
import { definePack } from "../../kit.js";
import { codePoints } from "../../lib/text.js";

const turnsOf = (item) => (Array.isArray(item?.turns) ? item.turns.filter((turn) => typeof turn === "string") : []);
const expectOf = (item) => (Array.isArray(item?.expect) ? item.expect : []);
const wordsIn = (text) => text.split(/\s+/).filter(Boolean).length;
const oneLine = (text) => String(text ?? "").replace(/[\r\n]+/g, " ");
// Local wording rule: the customer names a person to talk to (the same words as counter-turns-extra).
const PERSON_WORDS = /\b(?:person|human|agent|someone|somebody|manager|representative|real people)\b/i;
const asksPerson = (item) => turnsOf(item).some((turn) => PERSON_WORDS.test(turn));

export default definePack({
  id: "counter-examples-extra",
  surface: "counter.examples",
  title: "More example facts",
  about:
    "Turns of each example you have sent, mean words per turn, characters in all turns and person-asking wording (a local rule); a check for an example that asks for a person but expects no handoff; the share of shown examples expecting a handoff; a hand-validation checklist of the expected decisions; and a command that says how far the current example has got. Inputs and hand-written expectations only, never answers.",
  features: [
    {
      id: "sent_turns",
      kind: "fact",
      type: "number",
      label: "turns of it sent in the current chat",
      unit: "turns",
      help: "0 for every example the current chat did not start from.",
      value: (item) => (item?.active ? (Number.isInteger(item.sent) ? item.sent : null) : 0),
    },
    {
      id: "mean_turn_words",
      kind: "fact",
      type: "number",
      label: "mean words per customer turn",
      unit: "words",
      value: (item) => {
        const turns = turnsOf(item);
        return turns.length ? turns.reduce((total, turn) => total + wordsIn(turn), 0) / turns.length : null;
      },
    },
    {
      id: "total_chars",
      kind: "fact",
      type: "number",
      label: "characters in all turns",
      unit: "characters",
      value: (item) => turnsOf(item).reduce((total, turn) => total + codePoints(turn), 0) || null,
    },
    {
      id: "asks_person_words",
      kind: "fact",
      type: "flag",
      label: "a turn with words asking for a person (local wording rule)",
      value: asksPerson,
    },

    {
      id: "person_without_handoff",
      kind: "diagnostic",
      severity: "advice",
      label: "Asks for a person but expects no handoff",
      help: "Local wording rule against the hand-written expectation: worth a second look when the example is edited in jev/counter.py.",
      check: (item) =>
        asksPerson(item) && expectOf(item).length && !expectOf(item).includes("handoff")
          ? "A turn asks for a person, yet no turn is expected to hand off. Check the expectation against the default policy's person_at cut."
          : null,
    },

    {
      id: "handoff_share",
      kind: "metric",
      format: "percent",
      label: "Shown examples expected to end in a handoff",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        const handoffs = shown.filter((item) => expectOf(item).includes("handoff")).length;
        return { value: handoffs / shown.length, detail: `${handoffs} of ${shown.length}` };
      },
    },

    {
      id: "checklist_md",
      kind: "exporter",
      label: "Shown examples as a hand-validation checklist (Markdown; customer turns and expectations)",
      help: "one heading per shown example and a box to tick per turn with its expected decision under the default policy; no answers",
      filename: "counter-examples-checklist.md",
      mime: "text/markdown",
      build: (ctx) =>
        [
          "# Counter examples checklist",
          "",
          "Expected decisions are hand-written for the default policy.",
          "",
          ...ctx
            .shown()
            .flatMap((item) => [
              `## ${oneLine(item.label)}`,
              "",
              ...turnsOf(item).map(
                (turn, index) =>
                  `- [ ] Turn ${index + 1}: ${oneLine(turn)} → ${expectOf(item)[index] || "(no expectation)"}`,
              ),
              "",
            ]),
        ].join("\n"),
    },

    {
      id: "say_progress",
      kind: "command",
      group: "Counter",
      title: "Say how far the current example has got",
      when: (ctx) => ctx.items().some((item) => item.active),
      run: (ctx) => {
        const item = ctx.items().find((entry) => entry.active);
        if (!item) throw new Error("The current chat did not start from an example.");
        ctx.env.toast(
          `${item.label}: ${item.sent} of ${turnsOf(item).length} turns sent, ${item.following ? "following the example" : "departed from the example"}.`,
        );
      },
    },
  ],
});
