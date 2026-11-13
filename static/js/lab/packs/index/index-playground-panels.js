// Panels for the Overview playground ("index.playground", contract: static/js/lab/surfaces/index.js): a probability
// chart of the shown call, a log of this page session's calls with the changes between them, a side-by-side of any
// two calls of the session, and a reading guide that explains each answer type with the user's own numbers.
// Everything comes from the answers of the user's own calls in this page load; every call read from data.history is
// labeled with its number and as earlier or shown. The only action used is draftText, which does not ask the model.
import { definePack } from "../../kit.js";
import { truncate } from "../../lib/text.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const probs = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => entry && finite(entry.p) !== null) : []);
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const history = (ctx) => (Array.isArray(ctx?.data?.history) ? ctx.data.history.filter((entry) => entry && typeof entry === "object") : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? ctx.shown() : []);
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? ctx.items() : []);
const ms = (value) => `${Number(value.toFixed(1))} ms`;
const usd = (value) => `$${value.toFixed(9)}`;
const signed = (delta, format) => `${delta > 0 ? "+" : delta < 0 ? "-" : "±"}${format(Math.abs(delta))}`;
const clockOf = (at) => (finite(at) === null || Math.abs(at) > 8.64e15 ? "time unknown" : `${new Date(at).toISOString().slice(11, 19)} UTC`);
const callName = (entry) => `call ${finite(entry?.call) ?? "?"}`;

const BAR = { position: "relative", flex: "1", height: "10px", background: "var(--track)", borderRadius: "3px", overflow: "hidden", minWidth: "80px" };
const FILL = (p, color = "var(--series)") => ({ width: `${Math.min(1, Math.max(0, p)) * 100}%`, height: "100%", background: color });

// The session entry whose rows are the shown answers (the rows are the same objects as items()).
function shownEntry(ctx) {
  const first = itemsOf(ctx)[0];
  return first ? history(ctx).find((entry) => Array.isArray(entry?.rows) && entry.rows.includes(first)) || null : null;
}
const callTag = (entry, shown) => `Call ${finite(entry?.call) ?? "?"} (${entry === shown ? "shown" : "earlier"})`;
const rowFor = (entry, id) => (Array.isArray(entry?.rows) ? entry.rows.find((row) => row && row.id === id) || null : null);
const rowsOf = (entry) => (Array.isArray(entry?.rows) ? entry.rows.filter((row) => row && typeof row === "object") : []);
const criterionText = (item, key) => (Array.isArray(item?.criteria) ? item.criteria.find((entry) => entry?.key === key)?.text : undefined);

// A probability from 0 to 1 typed by the user, or null.
function readUnit(raw) {
  const text = String(raw ?? "").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return value <= 1 ? value : null;
}

// Local rule shared with the session panels: another Choice key, another rounded Score level, or a yes/no answer on
// the other side of one half. null when the two answers cannot be compared.
function changed(before, after) {
  if (!before || !after || before.type !== after.type) return null;
  if (after.type === "choice") return typeof before.value === "string" && typeof after.value === "string" ? before.value !== after.value : null;
  const x = finite(before.value), y = finite(after.value);
  if (x === null || y === null) return null;
  if (after.type === "score") return Math.round(x) !== Math.round(y);
  if (after.type === "noul") return (x > 0.5) !== (y > 0.5);
  return null;
}

// Half the summed absolute difference of the two answers' listed probabilities; keys missing on one side count as 0.
function shift(before, after) {
  const a = probs(before), b = probs(after);
  if (!a.length || !b.length) return null;
  const p = (list, key) => list.find((entry) => entry.key === key)?.p ?? 0;
  const keys = new Set([...a.map((entry) => entry.key), ...b.map((entry) => entry.key)]);
  let total = 0;
  for (const key of keys) total += Math.abs(p(a, key) - p(b, key));
  return total / 2;
}

// The chart's bars for one answer: authored order (the criteria sent, then anything else as listed) or likeliest first.
function chartEntries(item, order) {
  const list = probs(item).map((entry, index) => ({ key: String(entry.key), p: entry.p, index }));
  if (order === "likeliest") return list.sort((a, b) => b.p - a.p || a.index - b.index);
  const authored = (Array.isArray(item.criteria) ? item.criteria : []).map((entry) => String(entry?.key));
  const rank = (entry) => (authored.includes(entry.key) ? authored.indexOf(entry.key) : authored.length + entry.index);
  return list.sort((a, b) => rank(a) - rank(b));
}

function isChosen(item, key) {
  if (item.type === "choice") return typeof item.value === "string" && item.value === key;
  if (item.type === "score") return finite(item.value) !== null && String(Math.round(item.value)) === key;
  return false;
}

// Words of a text, lowercased, in first-appearance order, without repeats.
function wordSet(text) {
  const out = [];
  for (const word of String(text ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) if (!out.includes(word)) out.push(word);
  return out;
}
const WORDS_SHOWN = 40;
const wordList = (list) => (list.length > WORDS_SHOWN ? `${list.slice(0, WORDS_SHOWN).join(", ")} and ${list.length - WORDS_SHOWN} more` : list.join(", ") || "none");

// Odds for an outcome of probability p, as "1.6 to 1" (for) or "1 to 32.3" (against).
function oddsText(p) {
  if (p >= 1) return "certain in the listed probabilities";
  if (p <= 0) return "no chance in the listed probabilities";
  return p >= 0.5 ? `${(p / (1 - p)).toFixed(1)} to 1` : `1 to ${((1 - p) / p).toFixed(1)}`;
}

function guideLines(item) {
  const lines = [];
  const list = probs(item).slice().sort((a, b) => b.p - a.p);
  if (item.type === "choice") {
    const sent = Array.isArray(item.criteria) ? item.criteria.length : 0;
    if (list.length) {
      const [top, second] = list;
      const description = criterionText(item, top.key);
      lines.push(["choice", `${item.id} is a Choice: one option out of ${plural(sent || list.length, "option")}. Your call put ${pct(top.p)} on ${top.key}`
        + `${description ? ` ("${description}")` : ""}${second ? `, ${pct(second.p)} on ${second.key}, the runner-up, a margin of ${((top.p - second.p) * 100).toFixed(1)} points` : ""}.`
        + `${typeof item.value === "string" ? ` The chosen key is ${item.value}.` : " It chose no key."}`]);
    } else lines.push(["choice", `${item.id} is a Choice, but your call listed no probabilities for it.`]);
  } else if (item.type === "score") {
    const levels = probs(item);
    const value = finite(item.value);
    if (levels.length && levels.every((entry) => /^\d+$/.test(entry.key))) {
      const weighted = levels.reduce((total, entry) => total + Number(entry.key) * entry.p, 0);
      const terms = levels.map((entry) => `${entry.key} × ${pct(entry.p)}`).join(" + ");
      const top = list[0];
      const description = criterionText(item, top.key);
      // Say whether the returned value matches the weighted average rather than assuming it does.
      const agrees = value === null ? "" : Math.abs(value - weighted) < 0.005 ? ", which matches its value" : `, which differs from its value by ${Math.abs(value - weighted).toFixed(2)}`;
      lines.push(["score", `${item.id} is a Score from 0 to ${finite(item.scale) ?? "?"}. ${value === null ? "Its value is missing." : `Its value is ${value.toFixed(2)}.`} `
        + `The probability-weighted average of its levels is ${terms} = ${weighted.toFixed(2)}${agrees}. The likeliest single level is ${top.key} (${pct(top.p)})`
        + `${description ? `: "${description}"` : ""}.`]);
    } else lines.push(["score", `${item.id} is a Score${value === null ? " with no value" : ` of ${value.toFixed(2)}`}, but its levels are not listed as numbers.`]);
  } else if (item.type === "noul") {
    const p = finite(item.value);
    lines.push(["noul", p === null ? `${item.id} is a yes/no (Noul) answer, but your call returned no P(yes) for it.`
      : `${item.id} is a yes/no (Noul) answer: P(yes) is ${pct(p)}, so P(no) is ${pct(1 - p)}. It is one probability, not a decision; `
        + "any cut-off for acting on it is a rule in your own code."]);
  } else lines.push(["other", `${item.id} has the type ${item.type || "(none)"}, which this guide does not cover.`]);
  if (item.type === "noul" && finite(item.value) !== null) lines.push(["odds", `As odds: ${oddsText(item.value)} for yes.`]);
  else if (item.type === "choice" && list.length) lines.push(["odds", `As odds: ${oddsText(list[0].p)} for ${list[0].key} against every other option.`]);
  else if (item.type === "score" && list.length) lines.push(["odds", `As odds: ${oddsText(list[0].p)} for level ${list[0].key} against every other level.`]);
  return lines;
}

const NO_CALL = "Ask the playground to see this. It only uses the answers of your own calls in this page load.";

export default definePack({
  id: "index-playground-panels",
  surface: "index.playground",
  title: "Playground panels",
  about: "A probability chart of your shown call, a log of this page load's calls with the changes between them, a side-by-side of any two of them, "
    + "and a guide that explains Choice, Score and yes/no answers with your own numbers. Earlier calls are always labeled as earlier, and nothing here asks the model.",
  features: [
    { id: "chart", kind: "panel", title: "Probability chart",
      improvements: [
        { id: "bars", title: "Chart every listed probability of the shown answers as one bar per option, grouped by question" },
        { id: "chosen", title: "Mark the chosen Choice option and the Score's rounded level in the chart" },
        { id: "split", title: "Draw each yes/no answer as one bar split into P(yes) and P(no)" },
        { id: "order", title: "Order each question's bars as authored or likeliest first" },
        { id: "floor", title: "Hide chart options below a probability floor you set, with a count of what is hidden" },
      ],
      render: (h, ctx, api) => {
        const shown = shownOf(ctx);
        if (!shown.length) return h("p", { class: "faint" }, NO_CALL);
        const order = api.state.order === "likeliest" ? "likeliest" : "authored";
        const rawFloor = api.state.floor ?? "";
        const floor = String(rawFloor).trim() === "" ? 0 : readUnit(rawFloor);
        let hidden = 0;
        const groups = shown.map((item) => {
          const head = h("div", { class: "lab-chart-head" }, h("b", {}, item.id), ` · ${item.type || "unknown"}${item.display ? ` · ${item.display}` : ""}`);
          if (item.type === "noul") {
            const p = finite(item.value);
            if (p === null) return h("div", { "data-chart": item.id }, head, h("p", { class: "faint" }, "No P(yes) to chart."));
            return h("div", { "data-chart": item.id }, head,
              h("div", { "data-split": item.id, title: `yes ${pct(p)} · no ${pct(1 - p)}`, style: { ...BAR, display: "flex" } },
                h("div", { "data-yes": pct(p), style: FILL(p) }), h("div", { "data-no": pct(1 - p), style: FILL(1 - p, "var(--line-strong)") })),
              h("span", { class: "faint" }, `yes ${pct(p)} · no ${pct(1 - p)}`));
          }
          const entries = chartEntries(item, order);
          if (!entries.length) return h("div", { "data-chart": item.id }, head, h("p", { class: "faint" }, "No listed probabilities to chart."));
          const kept = floor === null ? entries : entries.filter((entry) => entry.p >= floor);
          hidden += entries.length - kept.length;
          return h("div", { "data-chart": item.id }, head, kept.map((entry) => {
            const chosen = isChosen(item, entry.key);
            return h("div", { "data-option": `${item.id}:${entry.key}`, "data-chosen": chosen ? "true" : null,
              style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" } },
              h("span", { style: { width: "9em", overflow: "hidden", textOverflow: "ellipsis" } }, entry.key),
              h("div", { style: BAR }, h("div", { "data-bar": pct(entry.p), style: FILL(entry.p) })),
              h("span", { class: "num", style: { width: "4em", textAlign: "right" } }, pct(entry.p)),
              chosen ? h("span", { class: "badge", "data-mark": item.type === "score" ? "level" : "chosen" }, item.type === "score" ? "score level" : "chosen") : null);
          }));
        });
        return h("div", { style: { display: "grid", gap: "8px" } },
          h("p", { class: "faint" }, `${shownEntry(ctx) ? `${callTag(shownEntry(ctx), shownEntry(ctx))}: ` : ""}the probabilities your call returned for the shown answers.`),
          h("div", { class: "row lab-row" },
            h("label", {}, "Order ", h("select", { "data-chart-order": "true", value: order, "aria-label": "Bar order",
              onchange: (event) => { api.state.order = event.target.value; api.redraw(); } },
            h("option", { value: "authored", selected: order === "authored" }, "as authored"), h("option", { value: "likeliest", selected: order === "likeliest" }, "likeliest first"))),
            h("label", {}, "Hide below ", h("input", { type: "number", min: "0", max: "1", step: "0.01", value: rawFloor, "data-chart-floor": "true", "aria-label": "Probability floor",
              oninput: (event) => { api.state.floor = event.target.value; api.redraw(); } }))),
          floor === null ? h("p", { class: "faint", "data-floor-error": "true" }, "Enter a floor from 0 to 1; every option is shown meanwhile.")
            : hidden ? h("p", { class: "faint", "data-hidden-count": String(hidden) }, `${plural(hidden, "option")} below ${pct(floor)} hidden.`) : null,
          groups);
      } },

    { id: "call_log", kind: "panel", title: "Session call log",
      improvements: [
        { id: "list", title: "List every answered call of this page load with its time, text and measured latency and cost, the shown one marked" },
        { id: "deltas", title: "Show each call's change in measured latency and cost from the call before it" },
        { id: "gap", title: "Show the time between each call and the one before it" },
        { id: "changes", title: "Count how many answers changed from the call before (local rule)" },
        { id: "order", title: "List the calls newest first or oldest first" },
        { id: "draft", title: "Put a logged call's text in the box without asking" },
      ],
      render: (h, ctx, api) => {
        const list = history(ctx);
        if (!list.length) return h("p", { class: "faint" }, NO_CALL);
        const shown = shownEntry(ctx);
        const newestFirst = api.state.newestFirst === true;
        const rows = list.map((entry, index) => {
          const before = index > 0 ? list[index - 1] : null;
          const latency = finite(entry.meta?.latency_ms), cost = finite(entry.meta?.cost_usd);
          const lastLatency = finite(before?.meta?.latency_ms), lastCost = finite(before?.meta?.cost_usd);
          const gap = before && finite(entry.at) !== null && finite(before.at) !== null ? (entry.at - before.at) / 1000 : null;
          let comparable = 0, moved = 0;
          for (const row of rowsOf(entry)) {
            const result = changed(rowFor(before, row?.id), row);
            if (result === null) continue;
            comparable++;
            if (result) moved++;
          }
          const draft = () => {
            try {
              ctx.actions.draftText(entry.text);
              api.toast(`The text of ${callName(entry)}${entry === shown ? "" : ", an earlier call of this page load,"} is in the box. Nothing was asked; edit it to ask.`);
            } catch (error) { api.toast(error.message, "error"); }
          };
          return h("tr", { "data-call": String(finite(entry.call) ?? index + 1) },
            h("td", {}, callTag(entry, shown), entry === shown ? h("span", { class: "badge", "data-shown": "true", style: { marginLeft: "6px" } }, "shown") : null),
            h("td", { "data-time": "true" }, clockOf(entry.at)),
            h("td", { "data-text": "true", title: entry.text ?? "" }, typeof entry.text === "string" ? truncate(entry.text, 60) : "—"),
            h("td", { class: "num", "data-latency": "true" }, latency === null ? "—" : ms(latency)),
            h("td", { class: "num", "data-cost": "true" }, cost === null ? "—" : usd(cost)),
            h("td", { class: "num", "data-delta": "true" }, !before ? "first call"
              : `${latency === null || lastLatency === null ? "—" : signed(latency - lastLatency, ms)} · ${cost === null || lastCost === null ? "—" : signed(cost - lastCost, usd)}`),
            h("td", { "data-gap": "true" }, !before ? "—" : gap === null ? "time unknown" : `${Number(gap.toFixed(1))} s after ${callName(before)}`),
            h("td", { "data-changes": "true" }, !before ? "—" : comparable ? `${moved} of ${comparable} changed` : "not comparable"),
            h("td", {}, typeof entry.text === "string" && entry.text.trim()
              ? h("button", { class: "btn sm ghost", "data-draft": String(finite(entry.call) ?? index + 1), onclick: draft }, "Put text in box") : null));
        });
        if (newestFirst) rows.reverse();
        return h("div", {},
          h("p", { class: "faint" }, `Your ${plural(list.length, "answered call")} of this page load. Latency and cost are measured; "changed" is a local rule `
            + "(another Choice key, another rounded Score level, or a yes/no answer across one half)."),
          h("button", { class: "btn sm ghost", "data-log-order": newestFirst ? "newest" : "oldest", onclick: () => { api.state.newestFirst = !newestFirst; api.redraw(); } },
            newestFirst ? "Show oldest first" : "Show newest first"),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Call", "Time", "Text", "Latency", "Cost", "Change from previous", "Gap", "Answers", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows)));
      } },

    { id: "two_calls", kind: "panel", title: "Two calls side by side",
      improvements: [
        { id: "pick", title: "Pick any two calls of this page load to compare their answers question by question" },
        { id: "shift", title: "Show how much probability moved per question between the two picked calls" },
        { id: "only_changed", title: "Show only the questions whose answer changed between the two picked calls" },
        { id: "meta", title: "Compare the two picked calls' measured latency, input tokens and cost" },
        { id: "words", title: "List the words each picked call's text has that the other's lacks" },
        { id: "copy", title: "Copy the two-call comparison as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const list = history(ctx);
        if (list.length < 2) return h("p", { class: "faint" }, "Ask the playground at least twice in this page load to compare two calls.");
        const shown = shownEntry(ctx);
        const keyOf = (entry, index) => String(finite(entry.call) ?? `#${index + 1}`);
        const keys = list.map(keyOf);
        const pickA = keys.includes(api.state.a) ? api.state.a : keys[keys.length - 2];
        const pickB = keys.includes(api.state.b) ? api.state.b : keys[keys.length - 1];
        const a = list[keys.indexOf(pickA)], b = list[keys.indexOf(pickB)];
        const picker = (name, value) => h("select", { "data-pick": name, value, "aria-label": name === "a" ? "First call" : "Second call",
          onchange: (event) => { api.state[name] = event.target.value; api.redraw(); } },
        list.map((entry, index) => h("option", { value: keys[index], selected: keys[index] === value }, callTag(entry, shown))));
        const controls = h("div", { class: "row lab-row" }, picker("a", pickA), h("span", {}, "vs"), picker("b", pickB),
          h("label", {}, h("input", { type: "checkbox", "data-only-changed": "true", checked: api.state.onlyChanged === true,
            onchange: (event) => { api.state.onlyChanged = !!event.target.checked; api.redraw(); } }), " Only changed"));
        if (a === b) return h("div", {}, controls, h("p", { class: "faint", "data-same-call": "true" }, "Pick two different calls."));
        const ids = [];
        for (const row of [...rowsOf(a), ...rowsOf(b)]) if (!ids.includes(row.id)) ids.push(row.id);
        const head = ["Question", callTag(a, shown), callTag(b, shown), "Answer", "Shift"];
        const rows = ids.map((id) => {
          const left = rowFor(a, id), right = rowFor(b, id);
          const differs = changed(left, right), moved = left && right ? shift(left, right) : null;
          return { differs, cells: [id, left ? left.display || "no value" : "not asked", right ? right.display || "no value" : "not asked",
            differs === null ? "—" : differs ? "changed" : "same", moved === null ? "—" : pct(moved)] };
        }).filter((row) => api.state.onlyChanged !== true || row.differs === true);
        const metaRow = (label, field, format) => {
          const x = finite(a.meta?.[field]), y = finite(b.meta?.[field]);
          return h("tr", { "data-meta": field }, h("td", {}, label), h("td", { class: "num" }, x === null ? "—" : format(x)), h("td", { class: "num" }, y === null ? "—" : format(y)),
            h("td", { class: "num" }, x === null || y === null ? "—" : signed(y - x, format)));
        };
        const wordsA = wordSet(a.text), wordsB = wordSet(b.text);
        const text = [head, ...rows.map((row) => row.cells)].map((row) => row.join("\t")).join("\n");
        return h("div", {}, controls,
          h("p", { class: "faint" }, `Both are your own calls of this page load. "Changed" is a local rule; shift is half the summed difference of the listed probabilities.`),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, head.map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.length ? rows.map((row) => h("tr", { "data-question": row.cells[0] }, row.cells.map((cell, index) => h("td", { class: index === 4 ? "num" : null }, cell))))
              : h("tr", { "data-none-changed": "true" }, h("td", { colspan: "5" }, "No answer changed between these two calls.")))),
          h("table", { class: "table lab-table", "data-meta-table": "true" },
            h("thead", {}, h("tr", {}, ["Measured", callTag(a, shown), callTag(b, shown), "Difference"].map((label) => h("th", {}, label)))),
            h("tbody", {}, metaRow("Latency", "latency_ms", ms), metaRow("Input tokens", "input_tokens", (value) => String(value)), metaRow("Cost", "cost_usd", usd))),
          h("p", { "data-words": "a" }, `Only in ${callName(a)}'s text: ${wordList(wordsA.filter((word) => !wordsB.includes(word)))}`),
          h("p", { "data-words": "b" }, `Only in ${callName(b)}'s text: ${wordList(wordsB.filter((word) => !wordsA.includes(word)))}`),
          h("button", { class: "btn sm ghost", "data-two-copy": "true", onclick: () => { api.copy(text); api.toast("Copied the comparison of your two calls."); } }, "Copy comparison"));
      } },

    { id: "reading_guide", kind: "panel", title: "How to read these answers",
      improvements: [
        { id: "choice", title: "Explain a Choice answer with its own top option, runner-up and margin" },
        { id: "score", title: "Explain a Score answer by working out the probability-weighted average of its levels with your numbers" },
        { id: "noul", title: "Explain a yes/no answer's P(yes) and P(no) with your numbers" },
        { id: "odds", title: "Restate each answer's top probability as odds" },
      ],
      render: (h, ctx) => {
        const shown = shownOf(ctx);
        if (!shown.length) return h("p", { class: "faint" }, NO_CALL);
        return h("div", {},
          h("p", { class: "faint" }, "What each of your shown answers means, worked out from its own numbers. Odds are arithmetic on the listed probabilities."),
          shown.map((item) => h("div", { "data-guide": item.id },
            guideLines(item).map(([part, line]) => h("p", { "data-part": part }, line)))));
      } },
  ],
});
