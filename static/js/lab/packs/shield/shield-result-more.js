// More for the opened message's Shield verdict ("shield.result", contract: static/js/lab/surfaces/shield.js): answer
// facts on each signal row, checks, measurements, exports, slider commands and what-if panels. Everything reads the
// current user's own screen of the opened message. What-if numbers are local noisy-OR arithmetic labeled as estimates
// that do not re-check hard rules or the loss score; the page's verdict stays the decision. Weights and thresholds
// change only through the page's own sliders (setWeights / setPolicy), which re-score with no Jev call.
import { definePack, toNumber } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const RISKY_ASKS = ["payment_change", "credential_request", "link_lure"];
const STEP = 0.05;
const onStep = (value) => Number((Math.round(value / STEP) * STEP).toFixed(2));

// Noisy-OR: 1 − Π(1 − c) over contributions, each clamped to 0..1.
const noisyOr = (contributions) => 1 - contributions.reduce((survive, c) => survive * (1 - clamp01(c)), 1);
const ruleValue = (ctx, key, fallback) => finite(ctx?.data?.rules?.[key]) ?? fallback;
const others = (item, ctx) => ctx.items().filter((other) => other?.id !== item?.id).map((other) => finite(other?.contribution)).filter((value) => value !== null);
const survivalOf = (contributions) => contributions.reduce((survive, c) => survive * (1 - clamp01(c)), 1);

// One answer printed for its row: a Noul as P(yes), a Score with its level word, a Choice with the chosen option's probability.
function answerText(item, ctx) {
  const answer = item?.answer;
  if (!answer) return "";
  if (answer.type === "noul") return finite(answer.value) === null ? "" : `${percent(answer.value)} yes`;
  if (answer.type === "score") {
    const value = finite(answer.value);
    if (value === null) return "";
    const scale = finite(answer.scale);
    const level = scale === null ? Math.round(value) : Math.min(scale, Math.max(0, Math.round(value)));
    const word = String(answer.legend?.[String(level)] || "").split(":")[0].trim();
    return `${value.toFixed(2)}${scale === null ? "" : ` of ${scale}`}${word ? ` (${word})` : ""}`;
  }
  if (answer.type === "choice" && typeof answer.value === "string") {
    const label = ctx?.data?.identity_labels?.[answer.value] || ctx?.data?.category_labels?.[answer.value] || answer.value.replace(/_/g, " ");
    const p = finite(answer.probabilities?.[answer.value]);
    return p === null ? label : `${label} (${percent(p)})`;
  }
  return "";
}

// The slider value at which a threshold would cross the risk: the first step above it for a threshold at or under the
// risk, the last step at or under it for a threshold above. null outside the slider's 0..1.
function flipValue(risk, cut) {
  const steps = Math.floor(risk / STEP + 1e-9);
  const next = Number(((cut <= risk ? steps + 1 : steps) * STEP).toFixed(2));
  return next < 0 || next > 1 ? null : next;
}

function stepPolicy(id, key, direction, name) {
  return { id, kind: "command", title: `${direction > 0 ? "Raise" : "Lower"} the ${name} threshold by 0.05`, group: "Shield policy",
    help: "Moves the page's own threshold slider: every verdict is re-scored by code with no Jev call.",
    when: (ctx) => {
      const value = finite(ctx.data?.policy?.[key]);
      return value !== null && (direction > 0 ? value <= 1 - STEP + 1e-9 : value >= STEP - 1e-9);
    },
    run: (ctx) => {
      const value = finite(ctx.data?.policy?.[key]);
      if (value === null) throw new Error("The thresholds arrive with the first verdict.");
      const next = onStep(clamp01(value + direction * STEP));
      ctx.actions.setPolicy({ [key]: next });
      ctx.env.toast(`${key} set to ${next}. Every verdict is re-scored with no Jev call; Reset to defaults brings it back.`);
    } };
}

export default definePack({
  id: "shield-result-more",
  surface: "shield.result",
  title: "More verdict what-ifs",
  about: "Answer facts, checks, measurements, exports, threshold and weight commands and what-if panels for the verdict of the "
    + "message you opened, from your own screen of it. What-ifs are local estimates; changes go only through the page's sliders "
    + "(no Jev call), and the request export holds the request only, never answers.",
  features: [
    // ---------- facts ----------
    { id: "leave_out_risk", kind: "fact", type: "number", label: "risk without this signal (local estimate)", unit: "0 to 1",
      help: "Noisy-OR of the other seven contributions. Hard rules are not re-checked.",
      value: (item, ctx) => (finite(item?.contribution) === null ? null : noisyOr(others(item, ctx))) },
    { id: "hot_weight", kind: "fact", type: "number", label: "lowest weight to reach 0.15", unit: "0 to 1",
      help: "The smallest slider weight (steps of 0.05) at which this signal's contribution reaches the 0.15 highlight; none when even 1 is too little.",
      value: (item, ctx) => {
        const value = finite(item?.value), hot = ruleValue(ctx, "hot", 0.15);
        if (value === null || value <= 0) return null;
        const weight = Number((Math.ceil(hot / value / STEP - 1e-9) * STEP).toFixed(2));
        return weight > 1 ? null : weight;
      } },
    { id: "default_contribution", kind: "fact", type: "number", label: "contribution at the default weight", unit: "0 to 1",
      help: "min(1, default weight × value).",
      value: (item) => {
        const value = finite(item?.value), base = finite(item?.default_weight);
        return value === null || base === null ? null : Math.min(1, base * value);
      } },
    { id: "weight_step_gain", kind: "fact", type: "number", label: "risk added by one more weight step (local estimate)", unit: "0 to 1",
      help: "How much the noisy-OR risk would rise if this weight moved up one slider step (0.05). Hard rules are not re-checked.",
      value: (item, ctx) => {
        const value = finite(item?.value), weight = finite(item?.weight), contribution = finite(item?.contribution);
        if (value === null || weight === null || contribution === null || weight >= 1 - 1e-9) return null;
        return survivalOf(others(item, ctx)) * (Math.min(1, Math.min(1, weight + STEP) * value) - contribution);
      } },
    { id: "driver", kind: "fact", type: "flag", label: "a verdict driver", help: "The verdict names this signal among its (at most three) drivers.",
      value: (item) => item?.driver === true },
    { id: "risky_ask", kind: "fact", type: "flag", label: "a risky ask at or above 0.5",
      help: "Payment redirect, credential ask or link lure at or above 0.5: with a domain mismatch, code calls it an impersonation.",
      value: (item, ctx) => RISKY_ASKS.includes(item?.id) && finite(item?.value) !== null && item.value >= ruleValue(ctx, "risky_ask", 0.5) },
    { id: "answer_text", kind: "fact", type: "text", label: "answer behind the signal",
      help: "The answer this row reads: a Noul's P(yes), the time-pressure Score with its level, or the claimed sender with its probability.",
      value: answerText },
    { id: "feeds_rule", kind: "fact", type: "category", label: "hard rule it feeds",
      help: "The fired hard rules that read this signal; none when no fired rule does.",
      value: (item) => (Array.isArray(item?.rules) && item.rules.length ? item.rules.join(" + ") : null) },

    // ---------- checks ----------
    { id: "rule_ignores_weight", kind: "diagnostic", severity: "info", label: "Hard rule fired at weight 0",
      check: (item) => (Array.isArray(item?.rules) && item.rules.length && finite(item.weight) === 0
        ? `${item.rules.join(", ")} fired from ${item.name} although its weight is 0: hard rules read the answer, not the weight.` : null) },
    { id: "split_score", kind: "diagnostic", severity: "advice", label: "Score split across levels",
      check: (item) => {
        const answer = item?.answer;
        const top = finite(answer?.top?.p), value = finite(answer?.value);
        if (answer?.type !== "score" || top === null || value === null || top >= 0.6) return null;
        return `${item.name}: the most likely level (${answer.top.key}) holds only ${percent(top)}, so the score ${value.toFixed(2)} averages across levels.`;
      } },
    { id: "drivers_capped", kind: "diagnostic", severity: "info", scope: "list", label: "Hot signals beyond the three drivers",
      check: (items, ctx) => {
        const cap = ruleValue(ctx, "max_drivers", 3);
        const unnamed = items.filter((item) => item?.hot === true && item.driver !== true);
        if (!unnamed.length || (ctx?.data?.verdict?.drivers || []).length < cap) return null;
        return `The verdict names at most ${cap} drivers, so ${unnamed.map((item) => item.name).join(", ")} also ${unnamed.length === 1 ? "adds" : "add"} 0.15 or more without being named.`;
      } },
    { id: "lure_from_vendor", kind: "diagnostic", severity: "advice", scope: "list", label: "Link lure from a matching sender",
      check: (items, ctx) => {
        const fact = ctx?.data?.fact;
        const lure = items.find((item) => item?.id === "link_lure" && finite(item.value) !== null && item.value >= ruleValue(ctx, "risky_ask", 0.5));
        if (!lure || fact?.domain_matches !== true) return null;
        return `${lure.name} is ${percent(lure.value)} and the sender's domain matches ${fact.claimed_label || "the claimed sender"} (${fact.sender_domain}): a genuine sender's link is still worth checking before anyone clicks it.`;
      } },

    // ---------- measurements ----------
    { id: "risk_all_ones", kind: "metric", format: "percent", label: "Risk with every weight at 1 (local estimate)",
      help: "Noisy-OR of the eight signal values themselves. Hard rules are not re-checked.",
      compute: (ctx) => {
        const values = ctx.items().map((item) => finite(item.value));
        return values.length && values.every((value) => value !== null) ? noisyOr(values) : null;
      } },
    { id: "weights_moved", kind: "metric", format: "number", label: "Total weight moved from the defaults",
      help: "The sum of |weight − default| over the eight sliders now. Settings only.",
      compute: (ctx) => {
        const weights = ctx.data?.weights, defaults = ctx.data?.defaults?.weights;
        if (!weights || !defaults) return null;
        const moves = Object.keys(weights).filter((id) => finite(defaults[id]) !== null).map((id) => Math.abs(weights[id] - defaults[id]));
        const moved = moves.filter((value) => value > 1e-9).length;
        return { value: moves.reduce((a, b) => a + b, 0), detail: moved ? `${plural(moved, "slider")} moved` : "every weight at its default" };
      } },
    { id: "harm_moderate", kind: "metric", format: "percent", label: "Chance of moderate or worse loss",
      help: "The loss-if-obeyed answer's probability of level 2 (moderate) or 3 (severe).",
      compute: (ctx) => {
        const entries = Object.entries(ctx.data?.answers?.harm_if_obeyed?.probabilities || {}).filter(([key, p]) => /^\d+$/.test(key) && finite(p) !== null);
        const total = entries.reduce((sum, [, p]) => sum + p, 0);
        return total > 0 ? entries.filter(([key]) => Number(key) >= 2).reduce((sum, [, p]) => sum + p, 0) / total : null;
      } },
    { id: "quarantine_gap", kind: "metric", format: "percent", label: "Risk minus the quarantine threshold",
      help: "The verdict's risk minus quarantine_at on the sliders now: negative means under it.",
      compute: (ctx) => {
        const risk = finite(ctx.data?.verdict?.risk), cut = finite(ctx.data?.policy?.quarantine_at);
        return risk === null || cut === null ? null : risk - cut;
      } },

    // ---------- exports ----------
    { id: "request_json", kind: "exporter", label: "Request for a handoff as JSON",
      help: "the opened message's exact request: its text (state), the questions and the model; no answers, verdict or measurements",
      filename: "shield-request.json", mime: "application/json",
      build: (ctx) => {
        const request = ctx.data?.request;
        if (!request) throw new Error("Open a screened message first: there is no request to export.");
        return `${JSON.stringify({ state: request.state, questions: request.questions, model: request.model }, null, 2)}\n`;
      } },
    { id: "explainer_md", kind: "exporter", label: "Verdict explainer as Markdown",
      help: "the verdict, the fired hard rules and the shown signal rows (your answers); no message text",
      filename: "shield-verdict.md", mime: "text/markdown",
      build: (ctx) => {
        const verdict = ctx.data?.verdict, policy = ctx.data?.policy, names = ctx.data?.signal_names || {};
        if (!verdict) throw new Error("Open a screened message first: there is no verdict to explain.");
        const risk = finite(verdict.risk), harm = finite(verdict.harm);
        const cuts = policy && finite(policy.review_at) !== null && finite(policy.quarantine_at) !== null
          ? ` (review at ${percent(policy.review_at)}, quarantine at ${percent(policy.quarantine_at)})` : "";
        const lines = ["# Shield verdict", "",
          `- Verdict: ${verdict.level || "unknown"}`,
          `- Combined risk: ${risk === null ? "unknown" : percent(risk)}${cuts}`,
          `- Loss if obeyed: ${harm === null ? "unknown" : `${harm} of 3`}`,
          `- Drivers: ${verdict.drivers.length ? verdict.drivers.map((id) => names[id] || id).join(", ") : "none"}`, "",
          "## Hard rules that fired", "",
          ...(verdict.rules.length ? verdict.rules.map((rule) => `- ${rule.id} (${rule.action}): ${rule.text}`) : ["- none"]), "",
          "## Signals", "",
          formatMarkdownTable(["Signal", "Value", "Weight", "Contribution"], ctx.shown().map((item) => [item.name,
            finite(item.value) === null ? "" : item.value.toFixed(2), finite(item.weight) === null ? "" : item.weight.toFixed(2),
            finite(item.contribution) === null ? "" : item.contribution.toFixed(3)])), "",
          "Holds the answers and verdict of your own screen; no message text."];
        return `${lines.join("\n")}\n`;
      } },
    { id: "weights_python", kind: "exporter", label: "Weights and thresholds as Python",
      help: "the slider settings as two Python dicts; no messages and no answers", filename: "shield_policy.py", mime: "text/x-python",
      build: (ctx) => {
        const weights = ctx.data?.weights, policy = ctx.data?.policy;
        if (!weights || !policy) throw new Error("The weights arrive with the first verdict.");
        const order = [...Object.keys(ctx.data.signal_names || {}).filter((id) => id in weights), ...Object.keys(weights).filter((id) => !(id in (ctx.data.signal_names || {})))];
        const dict = (name, keys, source) => [`${name} = {`, ...keys.map((key) => `    ${JSON.stringify(key)}: ${source[key]},`), "}"];
        return [`# Shield slider settings: weights and thresholds only, no messages or answers.`,
          ...dict("WEIGHTS", order, weights), ...dict("POLICY", ["review_at", "quarantine_at", "hard_rule_at"].filter((key) => key in policy), policy), ""].join("\n");
      } },

    // ---------- commands ----------
    stepPolicy("raise_review", "review_at", 1, "review"),
    stepPolicy("lower_review", "review_at", -1, "review"),
    stepPolicy("raise_quarantine", "quarantine_at", 1, "quarantine"),
    stepPolicy("lower_quarantine", "quarantine_at", -1, "quarantine"),
    { id: "inspect_result", kind: "command", title: "Inspect the opened result's JSON", group: "Shield", keys: "Alt+Shift+I",
      help: "Opens the page's Inspect JSON drawer on your own screen of the opened message.",
      when: (ctx) => !!ctx.data?.request, run: (ctx) => ctx.actions.inspect() },
    { id: "defaults_shown", kind: "command", title: "Restore the shown signals' default weights", group: "Shield policy",
      help: "Moves the sliders of the shown rows whose weight differs from its default back to the default; re-scored with no Jev call.",
      when: (ctx) => ctx.shown().some((item) => finite(item.weight) !== null && finite(item.default_weight) !== null && Math.abs(item.weight - item.default_weight) > 1e-9),
      run: (ctx) => {
        const moved = ctx.shown().filter((item) => finite(item.weight) !== null && finite(item.default_weight) !== null && Math.abs(item.weight - item.default_weight) > 1e-9);
        if (!moved.length) throw new Error("Every shown signal is at its default weight.");
        ctx.actions.setWeights(Object.fromEntries(moved.map((item) => [item.id, item.default_weight])));
        ctx.env.toast(`Restored the default weight of ${moved.map((item) => item.name).join(", ")}. Every verdict is re-scored with no Jev call.`);
      } },

    // ---------- panels ----------
    { id: "what_if", kind: "panel", title: "What-if weights (local estimate)",
      improvements: [{ id: "try", title: "Try a weight for each signal in a panel without moving the page's sliders" },
        { id: "estimate", title: "Show the local noisy-OR risk for the tried weights beside the verdict's risk" },
        { id: "clear", title: "Clear the tried weights back to the verdict's weights" },
        { id: "apply", title: "Apply the tried weights to the page's sliders, re-scored with no Jev call" }],
      render: (h, ctx, api) => {
        const items = ctx.items();
        if (!items.length) return h("p", { class: "faint" }, "Open a screened message to try other weights on its signals.");
        const tried = api.state.tried || (api.state.tried = {});
        const weightOf = (item) => (item.id in tried ? tried[item.id] : finite(item.weight) ?? 0);
        const estimate = noisyOr(items.map((item) => Math.min(1, weightOf(item) * (finite(item.value) ?? 0))));
        const risk = finite(ctx.data?.verdict?.risk);
        const set = (item, raw) => {
          const value = toNumber(raw);
          if (value === null || value < 0 || value > 1) { api.toast("A weight is a number from 0 to 1.", "error"); return; }
          tried[item.id] = onStep(value);
          api.redraw();
        };
        const changes = () => Object.fromEntries(items.filter((item) => item.id in tried && Math.abs(tried[item.id] - (finite(item.weight) ?? -1)) > 1e-9).map((item) => [item.id, tried[item.id]]));
        const apply = () => {
          const next = changes();
          if (!Object.keys(next).length) { api.toast("No tried weight differs from the verdict's weights."); return; }
          try {
            ctx.actions.setWeights(next);
            api.state.tried = {};
            api.toast(`Moved ${plural(Object.keys(next).length, "slider")}; every verdict is re-scored with no Jev call.`);
          } catch (error) { api.toast(error.message, "error"); }
          api.redraw();
        };
        return h("div", {}, h("p", { class: "faint" }, "Local noisy-OR arithmetic on your answers: hard rules and the loss score are not re-checked, and the page's verdict stays the decision until you apply."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Signal", "Value", "Verdict weight", "Try weight"].map((label) => h("th", {}, label)))),
            h("tbody", {}, items.map((item) => h("tr", { "data-signal": item.id }, h("td", {}, item.name),
              h("td", { class: "num" }, finite(item.value) === null ? "—" : item.value.toFixed(2)),
              h("td", { class: "num" }, finite(item.weight) === null ? "—" : item.weight.toFixed(2)),
              h("td", {}, h("input", { type: "number", min: "0", max: "1", step: "0.05", value: String(weightOf(item)), "data-weight": item.id,
                "aria-label": `Try a weight for ${item.name}`, oninput: (event) => set(item, event.target.value) })))))),
          h("p", { "data-estimate": "" }, `Local estimate: ${percent(estimate)} · verdict: ${risk === null ? "—" : percent(risk)}`),
          h("button", { class: "btn sm ghost", "data-action": "clear", onclick: () => { api.state.tried = {}; api.redraw(); } }, "Clear tried weights"),
          h("button", { class: "btn sm", "data-action": "apply", onclick: apply }, "Apply to the sliders"));
      } },
    { id: "build_up", kind: "panel", title: "How the risk builds up",
      improvements: [{ id: "table", title: "Show the combined risk as each signal joins, strongest first" },
        { id: "copy", title: "Copy the risk build-up as tab-separated text" }],
      render: (h, ctx, api) => {
        const items = ctx.items();
        if (!items.length) return h("p", { class: "faint" }, "Open a screened message to see how its risk builds up.");
        let survive = 1;
        const rows = items.map((item) => {
          const contribution = finite(item.contribution);
          survive *= 1 - clamp01(contribution ?? 0);
          return { item, contribution, risk: 1 - survive };
        });
        const tsv = [["signal", "contribution", "risk so far"], ...rows.map((row) => [row.item.name, row.contribution === null ? "" : row.contribution.toFixed(3), percent(row.risk)])]
          .map((row) => row.join("\t")).join("\n");
        return h("div", {}, h("p", { class: "faint" }, "Noisy-OR over all eight rows in the page's order, whatever the Lab filter shows. Hard rules can quarantine regardless."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Signal", "Contribution", "Risk so far"].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-signal": row.item.id }, h("td", {}, row.item.name),
              h("td", { class: "num" }, row.contribution === null ? "—" : row.contribution.toFixed(3)), h("td", { class: "num" }, percent(row.risk)))))),
          h("button", { class: "btn sm ghost", "data-copy": "build-up", onclick: () => api.copy(tsv) }, "Copy build-up"));
      } },
    { id: "threshold_flip", kind: "panel", title: "Where a threshold would cross the risk",
      improvements: [{ id: "table", title: "Show the review and quarantine slider values that would put the risk on the other side" },
        { id: "move", title: "Move a threshold slider to that value, re-scored with no Jev call" }],
      render: (h, ctx, api) => {
        const risk = finite(ctx.data?.verdict?.risk), policy = ctx.data?.policy;
        if (risk === null || !policy) return h("p", { class: "faint" }, "Open a screened message to see where each threshold would cross its risk.");
        const rows = [["review_at", "Review"], ["quarantine_at", "Quarantine"]].filter(([key]) => finite(policy[key]) !== null)
          .map(([key, name]) => ({ key, name, cut: policy[key], side: policy[key] <= risk ? "at or above" : "below", flip: flipValue(risk, policy[key]) }));
        const move = (row) => {
          try {
            ctx.actions.setPolicy({ [row.key]: row.flip });
            api.toast(`${row.key} moved to ${row.flip}; every verdict is re-scored with no Jev call.`);
          } catch (error) { api.toast(error.message, "error"); }
        };
        return h("div", {}, h("p", { class: "faint" }, `Risk ${percent(risk)}. Crossing a threshold changes which side the risk is on; hard rules and the loss score can still decide the level.`),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Threshold", "Now", "Risk is", "Crosses at", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-threshold": row.key }, h("td", {}, row.name), h("td", { class: "num" }, String(row.cut)),
              h("td", {}, row.side), h("td", { class: "num" }, row.flip === null ? "outside the slider" : String(row.flip)),
              h("td", {}, row.flip === null ? null : h("button", { class: "btn sm ghost", "data-move": row.key, onclick: () => move(row) }, `Move to ${row.flip}`)))))));
      } },
    { id: "identity_options", kind: "panel", title: "Every claimed-sender option",
      improvements: [{ id: "table", title: "Show every claimed-sender option with its probability, the chosen one marked" }],
      render: (h, ctx) => {
        const answer = ctx.data?.answers?.claimed_identity;
        if (!answer) return h("p", { class: "faint" }, "Open a screened message to see every claimed-sender option.");
        const labels = ctx.data?.identity_labels || {};
        const keys = [...Object.keys(labels), ...Object.keys(answer.probabilities || {}).filter((key) => !(key in labels))];
        return h("table", { class: "table lab-table" },
          h("thead", {}, h("tr", {}, ["Claimed sender", "Probability", ""].map((label) => h("th", {}, label)))),
          h("tbody", {}, keys.map((key) => {
            const p = finite(answer.probabilities?.[key]);
            return h("tr", { "data-option": key, class: key === answer.value ? "active" : "" }, h("td", {}, labels[key] || key.replace(/_/g, " ")),
              h("td", { class: "num" }, p === null ? "—" : percent(p)), h("td", {}, key === answer.value ? "chosen" : ""));
          })));
      } },
  ],
});
