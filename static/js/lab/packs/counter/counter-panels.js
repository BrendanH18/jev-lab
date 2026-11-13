// Panels for the turns of the user's own Counter chat ("counter.turns", contract: static/js/lab/surfaces/counter.js):
// a timeline of decisions, a policy what-if explorer, a table of every intent probability per turn, and a summary card.
// Everything reads only the calls the user made in this page load and nothing asks the model. The what-if explorer moves
// the page's own sliders through setPolicy (a re-decide in plain code, no Jev call) and compares the page's decisions
// before and after; it never re-implements decide(). The summary card holds no customer message unless asked.
import { definePack } from "../../kit.js";

const ACTIONS = ["reply", "clarify", "close", "handoff"];
const EVIDENCE = [["frustration", "Frustration", 4], ["asks_for_person", "Asks for a person", 1], ["missed", "Missed", 1], ["resolved", "Resolved", 1],
  ["intent_prob", "Top intent P", 1]];
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const faint = (h, text) => h("p", { class: "faint" }, text);
const turnOrder = (items) => items.filter((item) => Number.isInteger(item?.n)).sort((a, b) => a.n - b.n);
const two = (value) => value.toFixed(2);
const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(2)}`;
const clip = (text, max) => { const chars = Array.from(String(text ?? "")); return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join(""); };
const actionOf = (decision) => (typeof decision?.action === "string" ? decision.action : null);
const show = (value) => (value === null || value === undefined ? "—" : String(value));

// "reply → clarify → handoff", with repeats folded: "reply ×20".
function pathOf(actions) {
  const runs = [];
  for (const action of actions) {
    const name = action ?? "—";
    if (runs.length && runs[runs.length - 1][0] === name) runs[runs.length - 1][1] += 1;
    else runs.push([name, 1]);
  }
  return runs.map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(" → ");
}

// Counts of known actions as "reply 1, clarify 1"; "none" when no turn has one.
function countsOf(actions) {
  const parts = ACTIONS.map((action) => [action, actions.filter((entry) => entry === action).length]).filter(([, count]) => count > 0);
  return parts.length ? parts.map(([action, count]) => `${action} ${count}`).join(", ") : "none";
}

function statusOf(ctx, turns) {
  const chat = ctx.data.chat || {};
  if (chat.stopped === "turn_limit") return `Status: stopped at the ${chat.max_turns ?? 20}-turn limit.`;
  if (chat.stopped === "handoff") {
    const first = turns.find((item) => actionOf(item.decision) === "handoff");
    const reason = typeof first?.decision?.reason === "string" ? first.decision.reason.replace(/\.$/, "") : "";
    return `Status: handed to a person at turn ${first ? first.n : "?"}${reason ? ` (${reason})` : ""}.`;
  }
  const last = turns[turns.length - 1];
  const action = actionOf(last?.decision);
  if (action === "close") return `Status: open; the latest turn (${last.n}) closes the need, and a new one may follow.`;
  return `Status: open; the latest decision (turn ${last.n}) is ${action ?? "not available"}.`;
}

// The turn with the largest value of one evidence field (first on a tie), or null.
function peakOf(turns, field) {
  let best = null;
  for (const item of turns) {
    const value = finite(item.evidence?.[field]);
    if (value !== null && (!best || value > best.value)) best = { item, value };
  }
  return best;
}

const samePolicy = (target, now) => !!target && !!now && Object.keys(target).every((key) => finite(now[key]) !== null && Math.abs(now[key] - target[key]) <= 1e-9);

export default definePack({
  id: "counter-panels",
  surface: "counter.turns",
  title: "Chat panels",
  about: "Panels for your own Counter chat: a timeline of decisions, a policy what-if explorer that moves the page's sliders (a plain-code "
    + "re-decide, no Jev call) and lists the turns it changed, every intent probability per turn, and a summary card to copy. The card "
    + "holds no customer message unless you ask.",
  features: [
    // ---------- conversation timeline ----------
    { id: "timeline", kind: "panel", title: "Decision timeline",
      improvements: [
        { id: "rows", title: "Lay out the chat's turns in order with the decision now beside the one each reply was sent under" },
        { id: "shifts", title: "Mark the turns where the current action differs from the previous turn's" },
        { id: "path", title: "Sum up the chat as a path of decisions, now and as sent, such as reply → clarify → handoff" },
      ],
      render: (h, ctx, api) => {
        const all = turnOrder(ctx.items());
        if (!all.length) return faint(h, "Send a customer turn to see the chat's decisions over time.");
        const only = api.state.shownOnly === true, messages = api.state.messages === true;
        const shown = new Set(ctx.shown());
        const rows = only ? all.filter((item) => shown.has(item)) : all;
        const previous = (item) => all.find((other) => other.n === item.n - 1) || null;
        return h("div", {},
          faint(h, "Your own chat: the page's decision for each turn under the sliders now, and the decision its reply was sent under."),
          h("div", { class: "row" },
            h("label", {}, h("input", { type: "checkbox", "data-control": "messages", checked: messages,
              onchange: (event) => { api.state.messages = event.target.checked === true; api.redraw(); } }), " Show customer messages"),
            h("label", {}, h("input", { type: "checkbox", "data-control": "shown-only", checked: only,
              onchange: (event) => { api.state.shownOnly = event.target.checked === true; api.redraw(); } }), " Only turns the Lab filters show")),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Turn", "Now", "Sent as", "Reason now", "Notes", ...(messages ? ["Customer"] : [])].map((name) => h("th", {}, name)))),
            h("tbody", {}, rows.map((item) => {
              const now = actionOf(item.decision), before = previous(item);
              const shift = before && actionOf(before.decision) !== now ? `${actionOf(before.decision) ?? "—"} → ${now ?? "—"}` : null;
              const notes = [item.changed ? "changed since sent" : null, shift ? `shift: ${shift}` : null].filter(Boolean);
              return h("tr", { "data-turn": String(item.n), "data-changed": item.changed ? "" : undefined, "data-shift": shift || undefined },
                h("td", {}, `Turn ${item.n}`), h("td", {}, show(now)), h("td", {}, show(actionOf(item.sent))),
                h("td", {}, show(item.decision?.reason)), h("td", {}, notes.join(" · ")),
                messages ? h("td", { "data-message": "" }, clip(item.customer, 60)) : null);
            }))),
          h("p", { "data-part": "path-now" }, `Now: ${pathOf(all.map((item) => actionOf(item.decision)))}`),
          h("p", { "data-part": "path-sent" }, `As sent: ${pathOf(all.map((item) => actionOf(item.sent)))}`));
      } },

    // ---------- policy what-if explorer ----------
    { id: "what_if", kind: "panel", title: "Policy what-if",
      improvements: [
        { id: "settings", title: "List the seven policy settings with the value now, the default, the value the shown decisions use and the newest reply's" },
        { id: "rules", title: "Name the rules that read each setting, numbered in the order the page's decide() runs them" },
        { id: "changed_turns", title: "Step or type a setting and list the turns whose decision it changed, from before to after (a plain-code re-decide, no Jev call)" },
        { id: "undo", title: "Undo the last what-if, putting the sliders back as they were" },
      ],
      render: (h, ctx, api) => {
        const policy = ctx.data.policy;
        if (!policy) return faint(h, "The policy has not loaded yet.");
        const state = api.state;
        state.drafts ||= {};
        const limits = ctx.data.limits || {}, defaults = ctx.data.defaults || {}, used = ctx.data.decided_with;
        const rules = Array.isArray(ctx.data.rules) ? ctx.data.rules : [];
        const turns = turnOrder(ctx.items());
        const newest = turns[turns.length - 1] || null;
        // undoing: the move puts back the sliders of the last what-if, so there is nothing left to undo afterwards.
        const move = (changes, undoing = false) => {
          const before = { ...policy };
          try {
            const after = ctx.actions.setPolicy(changes);
            if (samePolicy(before, after)) api.toast("No setting moved.");
            else {
              state.undo = undoing ? null : before;
              state.drafts = {};
              state.baseline = { target: { ...after }, decisions: turns.map((item) => [item.n, item.customer, actionOf(item.decision), item.decision?.reply ?? null]) };
              api.toast(`${undoing ? "Sliders put back" : "Sliders moved"}. The page re-decides your saved answers by plain code, with no Jev call.`);
            }
          } catch (error) { api.toast(error.message, "error"); }
          api.redraw();
        };
        // A baseline belongs to the chat it was taken from: a new chat drops it.
        if (state.baseline && !state.baseline.decisions.every(([n, customer]) => turns.some((item) => item.n === n && item.customer === customer))) state.baseline = null;
        let result = null;
        if (state.baseline && !state.baseline.decisions.length) result = h("p", { "data-part": "what-if" }, "The chat had no turns to re-decide.");
        else if (state.baseline) {
          if (!samePolicy(state.baseline.target, used)) result = h("p", { "data-part": "what-if" }, "Waiting for the page to re-decide the last what-if.");
          else {
            const diffs = state.baseline.decisions.flatMap(([n, , action, reply]) => {
              const item = turns.find((entry) => entry.n === n);
              const now = actionOf(item?.decision), nowReply = item?.decision?.reply ?? null;
              return item && (now !== action || nowReply !== reply) ? [[n, `Turn ${n}: ${action ?? "—"}${reply && reply !== action ? ` (${reply})` : ""} → ${now ?? "—"}${nowReply && nowReply !== now ? ` (${nowReply})` : ""}`]] : [];
            });
            result = h("div", { "data-part": "what-if" }, diffs.length
              ? h("ul", {}, diffs.map(([n, text]) => h("li", { "data-diff": String(n) }, text)))
              : h("p", {}, "The last what-if changed no turn's decision."));
          }
        }
        return h("div", {},
          faint(h, "Moving a setting here moves the page's slider: the page re-decides the answers you already have, in plain code, with no Jev call. Replies already sent never change."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Setting", "Now", "Default", "In use", "Newest reply", "Read by", ""].map((name) => h("th", {}, name)))),
            h("tbody", {}, Object.entries(limits).map(([key, limit]) => {
              const now = finite(policy[key]);
              const readers = rules.map((rule, index) => [rule, index]).filter(([rule]) => Array.isArray(rule.keys) && rule.keys.includes(key));
              const step = (dir) => {
                const next = Number((now + dir * limit.step).toFixed(2));
                return h("button", { class: "btn sm ghost", "data-step": `${key}:${dir}`, disabled: now === null || next < limit.min - 1e-9 || next > limit.max + 1e-9,
                  onclick: () => move({ [key]: next }) }, dir < 0 ? "−" : "+");
              };
              return h("tr", { "data-setting": key },
                h("td", {}, limit.label), h("td", { class: "num" }, show(now)), h("td", { class: "num" }, show(finite(defaults[key]))),
                h("td", { class: "num" }, show(finite(used?.[key]))), h("td", { class: "num" }, show(finite(newest?.sent_policy?.[key]))),
                h("td", { "data-rules": "" }, readers.map(([rule, index]) => `${index + 1}. ${rule.label}`).join("; ")),
                h("td", {}, step(-1), step(1),
                  h("input", { class: "input sm", type: "number", "data-input": key, min: String(limit.min), max: String(limit.max), step: String(limit.step),
                    value: state.drafts[key] ?? show(now), "aria-label": limit.label, oninput: (event) => { state.drafts[key] = event.target.value; } }),
                  h("button", { class: "btn sm ghost", "data-apply": key, onclick: () => move({ [key]: state.drafts[key] ?? now }) }, "Apply")));
            }))),
          result,
          state.undo ? h("button", { class: "btn sm", "data-action": "undo", onclick: () => move({ ...state.undo }, true) }, "Undo last what-if") : null);
      } },

    // ---------- per-turn answer table ----------
    { id: "answer_table", kind: "panel", title: "Answers per turn",
      improvements: [
        { id: "grid", title: "Tabulate every intent's probability for each shown turn, the full answer the page reduces to its top intent" },
        { id: "marks", title: "Mark each turn's top intent, and the model's own choice where it names another intent" },
        { id: "column_max", title: "Mark the turn that gives each intent its highest probability" },
        { id: "quiet", title: "Hide the intents that no listed turn gives 5% or more" },
        { id: "means", title: "Add a row with each intent's mean probability over the listed turns" },
        { id: "deltas", title: "Show how each of the five evidence values moved since the previous turn" },
        { id: "biggest_jump", title: "Point out the largest turn-to-turn move of any evidence value, frustration counted on its 0 to 4 scale" },
      ],
      render: (h, ctx, api) => {
        const rows = turnOrder(ctx.shown());
        if (!ctx.items().length) return faint(h, "Send a customer turn to see its answers.");
        if (!rows.length) return faint(h, "No turn is shown. Clear the Lab filters to see the table.");
        const quiet = api.state.quiet === true;
        const intents = (Array.isArray(ctx.data.intents) ? ctx.data.intents : []).filter((key) => !quiet || rows.some((item) => (finite(item.intents?.[key]) ?? 0) >= 0.05));
        const maxOf = Object.fromEntries(intents.map((key) => {
          let best = null;
          for (const item of rows) { const value = finite(item.intents?.[key]); if (value !== null && (!best || value > best.value)) best = { n: item.n, value }; }
          return [key, best?.n ?? null];
        }));
        const all = turnOrder(ctx.items());
        const deltas = rows.map((item) => {
          const before = all.find((other) => other.n === item.n - 1);
          return { item, moves: EVIDENCE.map(([field]) => {
            const now = finite(item.evidence?.[field]), then = finite(before?.evidence?.[field]);
            return now === null || then === null ? null : now - then;
          }) };
        });
        let jump = null;
        for (const { item, moves } of deltas) {
          moves.forEach((move, index) => {
            if (move === null) return;
            const scaled = Math.abs(move) / EVIDENCE[index][2];
            if (!jump || scaled > jump.scaled + 1e-12) jump = { item, index, move, scaled };
          });
        }
        const mean = (key) => {
          const values = rows.map((item) => finite(item.intents?.[key])).filter((value) => value !== null);
          return values.length ? two(values.reduce((a, b) => a + b, 0) / values.length) : "—";
        };
        return h("div", {},
          faint(h, "Your own calls: every intent probability of each shown turn (the page uses only the top one) and how the five judgments moved."),
          h("label", {}, h("input", { type: "checkbox", "data-control": "quiet", checked: quiet,
            onchange: (event) => { api.state.quiet = event.target.checked === true; api.redraw(); } }), " Hide intents under 5% on every listed turn"),
          h("table", { class: "table lab-table", "data-part": "intents" },
            h("thead", {}, h("tr", {}, h("th", {}, "Turn"), intents.map((key) => h("th", { "data-intent": key }, key.replace(/_/g, " "))))),
            h("tbody", {}, rows.map((item) => h("tr", { "data-turn": String(item.n) }, h("td", {}, `Turn ${item.n}`),
              intents.map((key) => {
                const value = finite(item.intents?.[key]);
                const top = item.evidence?.intent === key, choice = item.intent_choice === key && !top;
                return h("td", { class: "num", "data-cell": key, "data-top": top ? "" : undefined, "data-choice": choice ? "" : undefined,
                  "data-col-max": maxOf[key] === item.n ? "" : undefined },
                `${value === null ? "—" : two(value)}${top ? " (top)" : ""}${choice ? " (model's choice)" : ""}`);
              })))),
            h("tfoot", {}, h("tr", { "data-part": "means" }, h("td", {}, "Mean"), intents.map((key) => h("td", { class: "num" }, mean(key)))))),
          h("table", { class: "table lab-table", "data-part": "deltas" },
            h("thead", {}, h("tr", {}, h("th", {}, "Turn"), EVIDENCE.map(([, name]) => h("th", {}, name)))),
            h("tbody", {}, deltas.map(({ item, moves }) => h("tr", { "data-turn": String(item.n) }, h("td", {}, `Turn ${item.n}`),
              moves.map((move) => h("td", { class: "num" }, move === null ? "—" : signed(move))))))),
          h("p", { "data-part": "jump" }, jump
            ? `Largest move: ${EVIDENCE[jump.index][1].toLowerCase()} ${signed(jump.move)}${EVIDENCE[jump.index][2] > 1 ? ` (of ${EVIDENCE[jump.index][2]})` : ""} from turn ${jump.item.n - 1} to turn ${jump.item.n}.`
            : "No two consecutive turns to compare."));
      } },

    // ---------- session summary card ----------
    { id: "summary_card", kind: "panel", title: "Chat summary card",
      improvements: [
        { id: "card", title: "Sum up the chat in a card: example, turns sent, decisions now and as sent, turns decided differently now, peak judgments and measured calls" },
        { id: "status", title: "Say how the chat stands: open, handed to a person at a turn and why, or at the turn limit" },
        { id: "progress", title: "Show progress through the example the chat started from, and whether it still follows it" },
        { id: "policy", title: "List the policy settings that differ from the defaults, or say the defaults are in force" },
        { id: "copy_text", title: "Copy the card as plain text, with the first and latest customer messages only when asked" },
        { id: "copy_markdown", title: "Copy the card as Markdown" },
      ],
      render: (h, ctx, api) => {
        const turns = turnOrder(ctx.items());
        if (!turns.length) return faint(h, "Send a customer turn to sum up the chat.");
        const chat = ctx.data.chat || {}, sample = chat.sample;
        const now = turns.map((item) => actionOf(item.decision)), sent = turns.map((item) => actionOf(item.sent));
        const changed = turns.filter((item) => item.changed).length;
        const frustration = peakOf(turns, "frustration"), person = peakOf(turns, "asks_for_person");
        const latencies = turns.map((item) => [item, finite(item.meta?.latency_ms)]).filter(([, value]) => value !== null);
        const costs = turns.map((item) => [item, finite(item.meta?.cost_usd)]).filter(([, value]) => value !== null);
        const top = (pairs) => pairs.reduce((best, pair) => (!best || pair[1] > best[1] ? pair : best), null);
        const slowest = top(latencies), costliest = top(costs);
        const defaults = ctx.data.defaults || {}, policy = ctx.data.policy || {};
        const differ = Array.isArray(ctx.data.changed) ? ctx.data.changed : [];
        const withMessages = api.state.messages === true;
        const lines = [
          ["card", `Counter chat · ${sample ? sample.label : "New chat"} · ${plural(turns.length, "customer turn")} of ${chat.max_turns ?? 20}`],
          ["decisions", `Decisions now: ${countsOf(now)} · as sent: ${countsOf(sent)} · decided differently now: ${plural(changed, "turn")}`],
          ["status", statusOf(ctx, turns)],
          ["progress", !sample ? "No example: a new chat."
            : `Example progress: ${chat.turns ?? turns.length} of ${sample.turns} turns sent${chat.following ? ", following the example" : "; the chat departs from the example"}.`],
          ["peaks", [frustration ? `Peak frustration ${frustration.value.toFixed(1)} of 4 (turn ${frustration.item.n})` : "Peak frustration not available",
            person ? `peak ask-for-a-person ${two(person.value)} (turn ${person.item.n})` : "peak ask-for-a-person not available"].join(" · ")],
          ["measured", latencies.length || costs.length ? [
            latencies.length ? `Mean measured latency ${Math.round(latencies.reduce((total, [, value]) => total + value, 0) / latencies.length)} ms · slowest turn ${slowest[0].n} (${Math.round(slowest[1])} ms)` : "Latency not measured",
            costs.length ? `costliest turn ${costliest[0].n} ($${costliest[1].toFixed(6)})` : "cost not measured"].join(" · ") : "No measured calls."],
          ["policy", differ.length ? `Policy: ${differ.map((key) => `${key} ${policy[key]} (default ${defaults[key]})`).join(", ")}.` : "Policy: the defaults."],
        ];
        if (withMessages) {
          const first = turns[0], last = turns[turns.length - 1];
          lines.push(["first", `First customer message (turn ${first.n}): “${first.customer}”`]);
          if (last !== first) lines.push(["latest", `Latest customer message (turn ${last.n}): “${last.customer}”`]);
        }
        const title = `Counter chat summary (your own chat: decisions and measured calls${withMessages ? "; first and latest customer messages" : "; no customer messages"})`;
        return h("div", {},
          h("ul", {}, lines.map(([key, text]) => h("li", { "data-line": key }, text))),
          h("label", {}, h("input", { type: "checkbox", "data-control": "messages", checked: withMessages,
            onchange: (event) => { api.state.messages = event.target.checked === true; api.redraw(); } }), " Include the first and latest customer messages"),
          h("button", { class: "btn sm ghost", "data-copy": "text", onclick: () => api.copy(`${title}\n${lines.map(([, text]) => text).join("\n")}\n`) }, "Copy as text"),
          h("button", { class: "btn sm ghost", "data-copy": "markdown", onclick: () => api.copy(`## ${title}\n\n${lines.map(([, text]) => `- ${text}`).join("\n")}\n`) }, "Copy as Markdown"));
      } },

    // ---------- metrics ----------
    { id: "turns_left", kind: "metric", format: "integer", label: "Customer turns this chat can still take",
      help: "0 once the chat is handed to a person or reaches the 20-turn limit; otherwise the turns left before the limit.",
      compute: (ctx) => {
        const chat = ctx.data.chat;
        if (!chat || !Number.isInteger(chat.turns) || chat.turns < 1) return null;
        if (chat.stopped === "handoff") return { value: 0, detail: "handed to a person" };
        if (chat.stopped === "turn_limit") return { value: 0, detail: `at the ${chat.max_turns}-turn limit` };
        return { value: Math.max(0, chat.max_turns - chat.turns), detail: `of ${chat.max_turns}` };
      } },
    { id: "token_growth", kind: "metric", format: "number", label: "Measured input tokens added per turn",
      help: "Every call reads the whole conversation so far, so input tokens grow turn by turn: from the first to the latest measured turn, per turn.",
      compute: (ctx) => {
        const measured = turnOrder(ctx.items()).filter((item) => integer(item.meta?.input_tokens) !== null);
        if (measured.length < 2) return null;
        const first = measured[0], last = measured[measured.length - 1];
        return { value: (last.meta.input_tokens - first.meta.input_tokens) / (last.n - first.n), detail: `from turn ${first.n} to turn ${last.n}` };
      } },
  ],
});
