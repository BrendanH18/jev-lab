// Starter pack for the Shield verdict's signal rows ("shield.result", contract: static/js/lab/surfaces/shield.js).
// It reads only the opened message's own screened result. The what-if numbers are plain local arithmetic (the same
// noisy-OR the page explains), labeled as local estimates: the page's verdict stays the decision, and the one command
// that changes it moves the page's own weight slider, which re-scores without a Jev call.
import { csvText, definePack, toNumber } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const SOURCE_WORDS = { noul: "Noul answer", score: "Score answer", code: "code check" };
const HARD_RULE_SIGNALS = { ai_instructions: "prompt_injection", credential_request: "credential_phish" };

// Noisy-OR: 1 − Π(1 − c) over contributions, each clamped to 0..1.
const noisyOr = (contributions) => 1 - contributions.reduce((survive, c) => survive * (1 - Math.max(0, Math.min(1, c))), 1);
const contributionsOf = (items) => items.map((item) => finite(item?.contribution)).filter((value) => value !== null);

// Top probability minus the runner-up of a Choice answer, or null.
function margin(answer) {
  const values = Object.values(answer?.probabilities || {}).filter((value) => finite(value) !== null).sort((a, b) => b - a);
  return values.length >= 2 ? values[0] - values[1] : null;
}

function weightChange(item) {
  const weight = finite(item?.weight), base = finite(item?.default_weight);
  return weight === null || base === null ? null : weight - base;
}

// A list of numbers from free text: commas, semicolons, spaces or new lines between them.
function numbersIn(text, label) {
  const parts = String(text ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) throw new Error(`${label}: type at least one number.`);
  return parts.map((part) => {
    const value = toNumber(part);
    if (value === null || value < 0 || value > 1) throw new Error(`${label}: “${part}” is not a number from 0 to 1.`);
    return value;
  });
}

export default definePack({
  id: "shield-signal-insights",
  surface: "shield.result",
  title: "Signal insights",
  about: "Filters, checks, local what-if estimates, exports, calculators and a mute command for the weighted signals of the message you opened, "
    + "from your own screen of it. The estimates are local arithmetic, never a new verdict; the CSV holds that message's answers.",
  features: [
    { id: "value", kind: "fact", type: "number", label: "signal value", unit: "0 to 1",
      help: "The probability the weight multiplies (pressure: score ÷ 2; domain mismatch: P(claimed sender) when the domain check failed).",
      value: (item) => finite(item?.value) },
    { id: "weight", kind: "fact", type: "number", label: "weight", unit: "0 to 1", value: (item) => finite(item?.weight) },
    { id: "contribution", kind: "fact", type: "number", label: "contribution", unit: "0 to 1", help: "min(1, weight × value).",
      value: (item) => finite(item?.contribution) },
    { id: "weight_change", kind: "fact", type: "number", label: "weight change from default", unit: "−1 to 1", value: weightChange },

    { id: "source", kind: "fact", type: "category", label: "signal source", value: (item) => SOURCE_WORDS[item?.source] || null },
    { id: "name", kind: "fact", type: "text", label: "signal name", value: (item) => item?.name ?? "" },

    { id: "hard_rule", kind: "fact", type: "flag", label: "a fired hard rule", help: "A hard rule that fired reads this signal.",
      value: (item) => Array.isArray(item?.rules) && item.rules.length > 0 },
    { id: "reweighted", kind: "fact", type: "flag", label: "a weight moved from its default",
      value: (item) => { const change = weightChange(item); return change !== null && Math.abs(change) > 1e-9; } },
    { id: "uncertain", kind: "fact", type: "flag", label: "an undecided value (30% to 70%)",
      value: (item) => { const value = finite(item?.value); return value !== null && value >= 0.3 && value <= 0.7; } },

    { id: "muted", kind: "diagnostic", severity: "advice", label: "Strong signal with a small weight",
      check: (item) => {
        const value = finite(item?.value), weight = finite(item?.weight);
        if (value === null || weight === null || value < 0.5 || weight >= 0.1) return null;
        return `${item.name} is ${percent(value)}, but its weight ${weight.toFixed(2)} lets it add only ${percent(finite(item.contribution) ?? 0)} to the risk.`;
      } },
    { id: "near_hard_rule", kind: "diagnostic", severity: "advice", label: "Just under a hard rule",
      help: "AI instructions or credential ask less than 10 points under the hard-rule threshold now set on its slider.",
      check: (item, ctx) => {
        const rule = HARD_RULE_SIGNALS[item?.id];
        const cut = finite(ctx?.data?.policy?.hard_rule_at);
        const value = finite(item?.value);
        if (!rule || cut === null || value === null || value >= cut || cut - value >= 0.1 - 1e-9) return null;
        return `${item.name} is ${percent(value)}, ${((cut - value) * 100).toFixed(1)} points under the hard-rule cut (${percent(cut)}) for ${rule}.`;
      } },
    { id: "single_driver", kind: "diagnostic", severity: "info", scope: "list", label: "One signal carries the risk",
      help: "One shown signal holds at least 75% of the shown signals' summed contributions.",
      check: (items) => {
        const contributions = contributionsOf(items);
        const total = contributions.reduce((a, b) => a + b, 0);
        const top = items.find((item) => finite(item?.contribution) === Math.max(...contributions));
        if (!top || total <= 0 || top.contribution / total < 0.75) return null;
        return `${top.name} holds ${percent(top.contribution / total)} of the shown signals' summed contributions: the risk rests mostly on its weight, though hard rules can still decide the level.`;
      } },

    { id: "risk_without_top", kind: "metric", format: "percent", label: "Risk without the strongest signal (local estimate)",
      help: "Noisy-OR of the other seven contributions. Hard rules are not re-checked.",
      compute: (ctx) => {
        const items = ctx.items();
        if (!items.length) return null;
        const rest = contributionsOf(items.filter((item) => item.rank !== 1));
        return { value: noisyOr(rest), detail: `without ${items.find((item) => item.rank === 1)?.name || "the top signal"}` };
      } },
    { id: "risk_at_defaults", kind: "metric", format: "percent", label: "Risk with the default weights (local estimate)",
      help: "Noisy-OR of default weight × value for all eight signals. Hard rules are not re-checked.",
      compute: (ctx) => {
        const items = ctx.items();
        if (!items.length || items.some((item) => finite(item.default_weight) === null || finite(item.value) === null)) return null;
        return noisyOr(items.map((item) => item.default_weight * item.value));
      } },
    { id: "hot_count", kind: "metric", format: "integer", label: "Signals at or above 0.15 contribution",
      compute: (ctx) => { const items = ctx.items(); return items.length ? items.filter((item) => item.hot).length : null; } },
    { id: "category_margin", kind: "metric", format: "percent", label: "Message kind: lead over the runner-up",
      help: "Top probability minus the second of the category answer.", compute: (ctx) => margin(ctx.data?.answers?.category) },
    { id: "identity_margin", kind: "metric", format: "percent", label: "Claimed sender: lead over the runner-up",
      help: "Top probability minus the second of the claimed_identity answer.", compute: (ctx) => margin(ctx.data?.answers?.claimed_identity) },

    { id: "signals_csv", kind: "exporter", label: "Shown signals as CSV",
      help: "this message's signal values (its answers), weights and contributions; no message text",
      filename: "shield-signals.csv", mime: "text/csv",
      build: (ctx) => csvText([["signal", "name", "source", "value", "weight", "default_weight", "contribution", "hard_rules"],
        ...ctx.shown().map((item) => [item.id, item.name, item.source, item.value ?? "", item.weight ?? "", item.default_weight ?? "", item.contribution ?? "",
          (Array.isArray(item.rules) ? item.rules : []).join(" ")])]) },
    { id: "policy_json", kind: "exporter", label: "Weights and thresholds as JSON",
      help: "the slider settings only; no messages and no answers", filename: "shield-policy.json", mime: "application/json",
      build: (ctx) => {
        if (!ctx.data?.weights || !ctx.data?.policy) throw new Error("The weights arrive with the first verdict.");
        return `${JSON.stringify({ weights: ctx.data.weights, policy: ctx.data.policy }, null, 2)}\n`;
      } },

    { id: "mute_top", kind: "command", title: "Set the strongest signal's weight to 0", group: "Shield",
      when: (ctx) => ctx.items().some((item) => item.rank === 1 && finite(item.weight) > 0),
      run: (ctx) => {
        const top = ctx.items().find((item) => item.rank === 1);
        if (!top) throw new Error("The opened message has no screened signals.");
        ctx.actions.setWeights({ [top.id]: 0 });
        ctx.env?.toast?.(`${top.name} weight set to 0. Every verdict is re-scored without a Jev call; Reset to defaults brings it back.`);
      } },

    { id: "noisy_or", kind: "tool", title: "Noisy-OR risk", group: "Shield",
      help: "Combines contributions (weight × probability) the way Shield does: 1 − Π(1 − c).",
      inputs: [{ name: "contributions", label: "Contributions, 0 to 1", type: "textarea", required: true, default: "0.5, 0.2" }],
      compute: ({ contributions }) => {
        const values = numbersIn(contributions, "Contributions");
        return [["combined risk", noisyOr(values)], ["strongest alone", Math.max(...values)], ["signals", values.length]];
      } },
    { id: "weight_for", kind: "tool", title: "Weight for a contribution", group: "Shield",
      help: "The weight that makes one signal with this probability contribute the target amount (capped at 1), and the lowest slider step (0.05) that reaches it.",
      inputs: [{ name: "probability", label: "Signal probability", type: "number", min: 0, max: 1, default: 0.8 },
        { name: "target", label: "Target contribution", type: "number", min: 0, max: 1, default: 0.4 }],
      compute: ({ probability, target }) => {
        if (probability === 0) throw new Error("A signal with probability 0 contributes nothing at any weight.");
        const weight = target / probability;
        if (weight > 1 + 1e-12) return { rows: [["weight needed", 1]], note: `Even weight 1 gives only ${probability}.` };
        // The slider moves in steps of 0.05: the first step at or above the exact weight (1e-9 absorbs float noise).
        const step = Math.min(1, Number((Math.ceil(weight * 20 - 1e-9) / 20).toFixed(2)));
        return [["weight needed", weight], ["lowest slider step that reaches it", step]];
      } },
  ],
});
