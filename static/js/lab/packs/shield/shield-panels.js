// Panels for the opened message's Shield verdict ("shield.result", contract: static/js/lab/surfaces/shield.js): where
// the risk comes from, which single weight change would flip the level, one signal's weight swept across its slider,
// a trace of the policy rules that decided the level, and all ten answers. Everything reads the current user's own
// screen of the opened message. Shares, flips and traced levels are local arithmetic that mirrors jev/shield.py
// verdict(), labeled as local estimates: the page's verdict stays the decision, and the only way a panel changes it is
// by moving the page's own sliders (setWeights / setPolicy), which re-score with no Jev call.
import { definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value, digits) => (finite(value) === null ? "—" : value.toFixed(digits));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const STEP = 0.05;
const GRID = Object.freeze(Array.from({ length: 21 }, (_, index) => Number((index * STEP).toFixed(2))));
const LEVELS = ["safe", "review", "quarantine"];
const RISKY_ASKS = ["payment_change", "credential_request", "link_lure"];
const HARD_RULES = [["ai_instructions", "prompt_injection"], ["credential_request", "credential_phish"]];
const SOURCES = [["noul", "Noul answers"], ["score", "Score answer (time pressure)"], ["code", "Code check (sender domain)"]];
const faint = (h, text) => h("p", { class: "faint" }, text);
const ruleValue = (ctx, key, fallback) => finite(ctx?.data?.rules?.[key]) ?? fallback;
const nameOf = (ctx, id) => ctx?.data?.signal_names?.[id] || String(id).replace(/_/g, " ");
const tsv = (rows) => `${rows.map((row) => row.join("\t")).join("\n")}\n`;
const stepIndex = (weight) => Math.round(weight / STEP);

// The opened message's eight signal rows when every value and weight is a number, else null.
function complete(ctx) {
  const items = ctx.items();
  return items.length && items.every((item) => finite(item.value) !== null && finite(item.weight) !== null) ? items : null;
}

const contributionOf = (weight, value) => clamp01(weight * value);
const noisyOr = (contributions) => 1 - contributions.reduce((survive, c) => survive * (1 - clamp01(c)), 1);

// Noisy-OR risk with some weights replaced: { signalId: weight }.
const riskWith = (items, override = {}) => noisyOr(items.map((item) => contributionOf(item.id in override ? override[item.id] : item.weight, item.value)));

// The combined risk split into additive shares: each contribution's −ln(1 − c) as a part of their sum, times the
// risk. The shares add up to the risk exactly. A contribution of 1 makes the risk 1, split among those at 1.
function sharesOf(contributions) {
  const risk = noisyOr(contributions);
  const full = contributions.filter((c) => c >= 1).length;
  if (full) return contributions.map((c) => (c >= 1 ? 1 / full : 0));
  const logs = contributions.map((c) => -Math.log1p(-clamp01(c)));
  const total = logs.reduce((a, b) => a + b, 0);
  return total > 0 ? logs.map((value) => (risk * value) / total) : contributions.map(() => 0);
}

// The level jev/shield.py verdict() gives a risk, with the hard rules that fired, the loss score and the thresholds.
// null when the thresholds are missing, or when the loss score decides and is unknown.
function estimateLevel(risk, rules, harm, policy, lift) {
  const quarantineAt = finite(policy?.quarantine_at), reviewAt = finite(policy?.review_at);
  if (finite(risk) === null || quarantineAt === null || reviewAt === null) return null;
  if (rules.some((rule) => rule.action === "quarantine") || risk >= quarantineAt) return "quarantine";
  if (risk >= reviewAt) return harm === null ? null : harm >= lift ? "quarantine" : "review";
  return rules.length ? "review" : "safe";
}

// The hard rules jev/shield.py would fire from these signal values, sender facts and hard-rule threshold.
function traceRules(values, fact, hardAt, ctx) {
  const rules = [];
  for (const [signal, id] of HARD_RULES) {
    if (values[signal] !== null && hardAt !== null && values[signal] >= hardAt) rules.push({ id, action: "quarantine" });
  }
  const prob = finite(fact?.claimed_identity_prob);
  const mismatch = fact?.domain_matches === false && prob !== null && prob >= ruleValue(ctx, "mismatch_prob", 0.6);
  const asks = RISKY_ASKS.map((id) => values[id]).filter((value) => value !== null);
  const risky = asks.length > 0 && Math.max(...asks) >= ruleValue(ctx, "risky_ask", 0.5);
  if (mismatch && risky) rules.push({ id: "impersonation", action: "quarantine" });
  else if (mismatch) rules.push({ id: "unverified_sender", action: "review" });
  return { rules, mismatch, risky };
}

const valuesOf = (items) => Object.fromEntries(items.map((item) => [item.id, finite(item.value)]));
const verdictRules = (ctx) => (Array.isArray(ctx.data?.verdict?.rules) ? ctx.data.verdict.rules : []);

// The slider value of a "fires at value >= threshold" rule's threshold that changes whether it fires: the first step
// above the value while it fires, the last step at or under it while it does not. null outside the slider.
function hardFlip(value, hardAt) {
  const steps = Math.floor(value / STEP + 1e-9) + (value >= hardAt ? 1 : 0);
  const next = Number((steps * STEP).toFixed(2));
  return next < 0 || next > 1 ? null : next;
}

// The nearest slider weight in one direction at which the estimated level is one the search wants, or null.
function nearestMove(items, item, direction, wanted, estimate) {
  const from = stepIndex(item.weight);
  for (let index = from + direction; index >= 0 && index < GRID.length; index += direction) {
    const weight = GRID[index];
    const level = estimate({ [item.id]: weight });
    if (wanted(level)) return { id: item.id, weight, level, risk: riskWith(items, { [item.id]: weight }), steps: Math.abs(index - from), direction };
  }
  return null;
}

// Everything the weight-flip searches need, or a reason why they cannot run.
function flipSetup(ctx) {
  const items = complete(ctx), verdict = ctx.data?.verdict, policy = ctx.data?.policy;
  if (!items || !verdict || !policy) return null;
  const rules = verdictRules(ctx), harm = finite(verdict.harm), lift = ruleValue(ctx, "harm_quarantine", 2.5);
  const estimate = (override) => estimateLevel(riskWith(items, override), rules, harm, policy, lift);
  return { items, verdict, policy, rules, estimate, now: estimate({}), risk: riskWith(items) };
}

function answerText(answer, ctx) {
  if (!answer) return "—";
  const value = answer.value;
  if (answer.type === "noul") return finite(value) === null ? "—" : `${pct(value)} yes`;
  if (answer.type === "score") return finite(value) === null ? "—" : `${value.toFixed(2)}${finite(answer.scale) === null ? "" : ` of ${answer.scale}`}`;
  if (answer.type === "choice" && typeof value === "string") return ctx.data?.identity_labels?.[value] || ctx.data?.category_labels?.[value] || value.replace(/_/g, " ");
  return "—";
}

// Shares of the opened message's risk, strongest first: [{ item, share }] with the risk, or null.
function rankedShares(ctx) {
  const items = complete(ctx);
  if (!items) return null;
  const contributions = items.map((item) => contributionOf(item.weight, item.value));
  const risk = noisyOr(contributions);
  const shares = sharesOf(contributions);
  const rows = items.map((item, index) => ({ item, share: shares[index], index })).sort((a, b) => b.share - a.share || a.index - b.index);
  return { rows, risk };
}

const signalValue = (ctx, id) => finite(ctx.items().find((item) => item.id === id)?.value);

export default definePack({
  id: "shield-panels",
  surface: "shield.result",
  title: "Verdict panels",
  about: "Panels for the verdict of the message you opened, from your own screen of it: where its risk comes from, which single weight "
    + "change would flip its level, one weight's estimated level at every slider step, a trace of the policy rules behind the level, and all ten answers. "
    + "Shares, flips and traces are local estimates; changes go only through the page's own sliders, re-scored with no Jev call.",
  features: [
    // ---------- where the risk comes from ----------
    { id: "risk_breakdown", kind: "panel", title: "Where the risk comes from (local estimate)",
      improvements: [
        { id: "shares", title: "Split the combined risk into per-signal shares that add up to it exactly" },
        { id: "bars", title: "Draw a bar for each signal's share of the risk" },
        { id: "sources", title: "Total the risk shares by source: Noul answers, the time-pressure Score and the domain check" },
        { id: "defaults", title: "Compare each signal's share at the current weights with its share at the default weights" },
        { id: "sort", title: "Order the breakdown by share or by Shield's signal order" },
        { id: "unit", title: "Show the shares as risk points or as percent of the risk" },
        { id: "copy", title: "Copy the risk breakdown as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const items = complete(ctx);
        if (!items) return faint(h, "Open a screened message to see where its risk comes from.");
        const contributions = items.map((item) => contributionOf(item.weight, item.value));
        const risk = noisyOr(contributions), shares = sharesOf(contributions);
        const hasDefaults = items.every((item) => finite(item.default_weight) !== null);
        const defaultContributions = hasDefaults ? items.map((item) => contributionOf(item.default_weight, item.value)) : null;
        const defaultRisk = hasDefaults ? noisyOr(defaultContributions) : null;
        const defaultShares = hasDefaults ? sharesOf(defaultContributions) : null;
        const sort = api.state.sort === "order" ? "order" : "share";
        const unit = api.state.unit === "percent" ? "percent" : "points";
        const show = (share, total) => (unit === "percent" ? (total > 0 ? pct(share / total) : "—") : share.toFixed(3));
        const rows = items.map((item, index) => ({ item, index, contribution: contributions[index], share: shares[index],
          defaultShare: defaultShares ? defaultShares[index] : null }));
        if (sort === "share") rows.sort((a, b) => b.share - a.share || a.index - b.index);
        else rows.sort((a, b) => (a.item.position ?? 99) - (b.item.position ?? 99) || a.index - b.index);
        const sources = SOURCES.map(([key, label]) => ({ key, label, share: rows.filter((row) => row.item.source === key).reduce((sum, row) => sum + row.share, 0),
          count: rows.filter((row) => row.item.source === key).length })).filter((source) => source.count > 0);
        const copy = () => api.copy(tsv([["signal", "contribution", "risk points", "percent of risk"],
          ...rows.map((row) => [row.item.name, row.contribution.toFixed(3), row.share.toFixed(4), risk > 0 ? pct(row.share / risk) : ""])]));
        const select = (name, value, options) => h("select", { "data-control": name, value, "aria-label": name === "sort" ? "Order the breakdown" : "Show the shares as",
          onchange: (event) => { api.state[name] = event.target.value; api.redraw(); } }, options.map(([key, label]) => h("option", { value: key, selected: key === value }, label)));
        return h("div", {},
          faint(h, `Local estimate: each signal's −ln(1 − contribution), as a part of their total, times the noisy-OR risk ${pct(risk)}. The shares add up to the risk; hard rules can still decide the level.`),
          h("div", { class: "row" }, select("sort", sort, [["share", "Largest share first"], ["order", "Shield's signal order"]]),
            select("unit", unit, [["points", "Risk points"], ["percent", "Percent of the risk"]])),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Signal", "Contribution", unit === "percent" ? "Share of risk" : "Risk points", "", hasDefaults ? "At default weights" : null].filter(Boolean).map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-signal": row.item.id }, h("td", {}, row.item.name),
              h("td", { class: "num" }, row.contribution.toFixed(3)),
              h("td", { class: "num", "data-share": "" }, show(row.share, risk)),
              h("td", {}, h("span", { class: "lab-bar", "data-bar": row.item.id, style: `width: ${risk > 0 ? ((row.share / risk) * 100).toFixed(1) : "0.0"}%` })),
              hasDefaults ? h("td", { class: "num", "data-default-share": "" }, show(row.defaultShare, defaultRisk)) : null)))),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Source", "Signals", unit === "percent" ? "Share of risk" : "Risk points"].map((label) => h("th", {}, label)))),
            h("tbody", {}, sources.map((source) => h("tr", { "data-source": source.key }, h("td", {}, source.label), h("td", { class: "num" }, String(source.count)),
              h("td", { class: "num", "data-share": "" }, show(source.share, risk)))))),
          h("button", { class: "btn sm ghost", "data-copy": "breakdown", onclick: copy }, "Copy breakdown"));
      } },

    // ---------- which weight change flips the level ----------
    { id: "weight_flips", kind: "panel", title: "Which weight change flips the level (local estimate)",
      improvements: [
        { id: "raise", title: "Find, for each signal, the nearest higher weight that would change the verdict's level" },
        { id: "lower", title: "Find, for each signal, the nearest lower weight that would change the verdict's level" },
        { id: "smallest", title: "Point out the single weight move with the fewest slider steps that flips the level" },
        { id: "target", title: "Search only for moves that reach a chosen level: safe, review or quarantine" },
        { id: "locked", title: "Say when fired hard rules hold quarantine whatever the weights" },
        { id: "agree", title: "Confirm the local estimate reproduces the verdict's risk and level before trusting a flip" },
        { id: "apply", title: "Move a signal's slider to its flip weight, re-scored with no Jev call" },
        { id: "copy", title: "Copy the weight flips as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const setup = flipSetup(ctx);
        if (!setup) return faint(h, "Open a screened message to see which weight change would flip its level.");
        const { items, verdict, rules, estimate, now, risk } = setup;
        const agrees = finite(verdict.risk) !== null && Math.abs(risk - verdict.risk) <= 1e-6 && now === verdict.level;
        const agree = h("p", { "data-agree": agrees ? "yes" : "no" }, agrees
          ? `The local estimate reproduces the verdict: risk ${pct(risk)}, ${now}.`
          : `The local estimate (risk ${pct(risk)}, ${now || "level unknown"}) differs from the verdict (${finite(verdict.risk) === null ? "risk unknown" : `risk ${pct(verdict.risk)}`}, ${verdict.level || "level unknown"}): a re-score may be on its way, so treat these flips with care.`);
        if (now === null) return h("div", {}, agree, faint(h, "The loss score is missing, so the level cannot be estimated for other weights."));
        const target = LEVELS.includes(api.state.target) ? api.state.target : "any";
        const wanted = (level) => level !== null && level !== now && (target === "any" || level === target);
        const rows = items.map((item) => ({ item, up: nearestMove(items, item, 1, wanted, estimate), down: nearestMove(items, item, -1, wanted, estimate) }));
        let best = null;
        for (const row of rows) for (const move of [row.up, row.down]) if (move && (!best || move.steps < best.steps)) best = move;
        const locked = rules.filter((rule) => rule.action === "quarantine");
        const apply = (move) => {
          try {
            ctx.actions.setWeights({ [move.id]: move.weight });
            api.toast(`${nameOf(ctx, move.id)} weight moved to ${move.weight}; every verdict is re-scored with no Jev call.`);
          } catch (error) { api.toast(error.message, "error"); }
          api.redraw();
        };
        const cell = (move) => (move ? h("span", {}, `${move.weight} → ${move.level} (${pct(move.risk)})`,
          h("button", { class: "btn sm ghost", "data-apply": `${move.id}:${move.weight}`, onclick: () => apply(move) }, "Move")) : "none");
        const copy = () => api.copy(tsv([["signal", "weight now", "raise to", "level", "lower to", "level"],
          ...rows.map((row) => [row.item.name, row.item.weight, row.up?.weight ?? "", row.up?.level ?? "", row.down?.weight ?? "", row.down?.level ?? ""])]));
        return h("div", {},
          faint(h, `Local noisy-OR estimate, one slider at a time in steps of ${STEP}, with the fired hard rules and the loss score held as they are. The level now: ${now}.`),
          agree,
          locked.length ? h("p", { "data-locked": "" }, `Fired hard rules (${locked.map((rule) => rule.id).join(", ")}) quarantine this message whatever the weights: no weight change alone flips it.`) : null,
          h("label", {}, "Reach ", h("select", { "data-control": "target", value: target, onchange: (event) => { api.state.target = event.target.value; api.redraw(); } },
            [["any", "any other level"], ...LEVELS.map((level) => [level, level])].map(([key, label]) => h("option", { value: key, selected: key === target }, label)))),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Signal", "Weight now", "Raise to", "Lower to"].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-signal": row.item.id, "data-best": best && best.id === row.item.id ? (best.direction > 0 ? "raise" : "lower") : undefined },
              h("td", {}, row.item.name), h("td", { class: "num" }, fixed(row.item.weight, 2)),
              h("td", { "data-raise": "" }, cell(row.up)), h("td", { "data-lower": "" }, cell(row.down)))))),
          best ? h("p", { "data-smallest": "" }, `Smallest move: ${nameOf(ctx, best.id)} to ${best.weight} (${plural(best.steps, "step")}) gives ${best.level}.`)
            : h("p", { "data-smallest": "" }, "No single weight move reaches that level."),
          h("button", { class: "btn sm ghost", "data-copy": "flips", onclick: copy }, "Copy flips"));
      } },

    // ---------- one weight across its slider ----------
    { id: "weight_sweep", kind: "panel", title: "One weight across its slider (local estimate)",
      improvements: [
        { id: "table", title: "Show the estimated risk and level at every slider step of one chosen signal's weight" },
        { id: "current", title: "Mark the step the verdict used and the default weight's step" },
        { id: "boundaries", title: "Mark the steps where the estimated level changes" },
      ],
      render: (h, ctx, api) => {
        const setup = flipSetup(ctx);
        if (!setup) return faint(h, "Open a screened message to sweep one of its weights.");
        const { items, estimate } = setup;
        const item = items.find((entry) => entry.id === api.state.signal) || items[0];
        const current = stepIndex(item.weight);
        const base = finite(item.default_weight) === null ? null : stepIndex(item.default_weight);
        const rows = GRID.map((weight, index) => ({ weight, index, risk: riskWith(items, { [item.id]: weight }), level: estimate({ [item.id]: weight }) }));
        return h("div", {},
          h("label", {}, "Signal ", h("select", { "data-control": "signal", value: item.id, onchange: (event) => { api.state.signal = event.target.value; api.redraw(); } },
            items.map((entry) => h("option", { value: entry.id, selected: entry.id === item.id }, entry.name)))),
          faint(h, `Local noisy-OR estimate with the other seven weights, the fired hard rules and the loss score held as they are. Value ${fixed(item.value, 2)}.`),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Weight", "Risk", "Level", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-step": String(row.weight), "data-current": row.index === current ? "" : undefined,
              "data-default": row.index === base ? "" : undefined, "data-boundary": row.index > 0 && row.level !== rows[row.index - 1].level ? "" : undefined },
            h("td", { class: "num" }, row.weight.toFixed(2)), h("td", { class: "num" }, pct(row.risk)), h("td", {}, row.level || "unknown"),
            h("td", {}, [row.index === current ? "verdict's weight" : null, row.index === base ? "default" : null,
              row.index > 0 && row.level !== rows[row.index - 1].level ? "level changes" : null].filter(Boolean).join(" · ")))))));
      } },

    // ---------- the policy rules behind the level ----------
    { id: "rule_trace", kind: "panel", title: "How the level was decided",
      improvements: [
        { id: "hard_rules", title: "Trace each hard rule: the answer it reads against the hard-rule threshold" },
        { id: "sender", title: "Trace the sender check: domain match and the claimed sender's probability against its cut" },
        { id: "risky_ask", title: "Trace the largest risky ask and the sender rule it leads to" },
        { id: "thresholds", title: "Trace the risk against the quarantine and review thresholds" },
        { id: "harm", title: "Trace whether the loss score lifts a review to a quarantine" },
        { id: "decided_by", title: "Name the step that decided the level" },
        { id: "agree", title: "Flag a difference between the traced rules and level and the page's verdict" },
        { id: "move_hard", title: "Move the hard-rule threshold to where a hard rule would stop or start firing, re-scored with no Jev call" },
        { id: "copy", title: "Copy the rule trace as plain text" },
      ],
      render: (h, ctx, api) => {
        const verdict = ctx.data?.verdict, policy = ctx.data?.policy, items = ctx.items();
        if (!verdict || !policy || !items.length) return faint(h, "Open a screened message to trace how its level was decided.");
        const values = valuesOf(items), fact = isObject(ctx.data?.fact) ? ctx.data.fact : null;
        const hardAt = finite(policy.hard_rule_at), reviewAt = finite(policy.review_at), quarantineAt = finite(policy.quarantine_at);
        const risk = finite(verdict.risk), harm = finite(verdict.harm), lift = ruleValue(ctx, "harm_quarantine", 2.5);
        const mismatchCut = ruleValue(ctx, "mismatch_prob", 0.6), riskyCut = ruleValue(ctx, "risky_ask", 0.5);
        const traced = traceRules(values, fact, hardAt, ctx);
        const sign = (value, cut) => (value >= cut ? "≥" : "<");
        const lines = [];
        const line = (step, text) => { lines.push({ step, text }); };
        for (const [signal, id] of HARD_RULES) {
          const value = values[signal];
          line("hard_rules", value === null || hardAt === null ? `${nameOf(ctx, signal)}: unknown, so ${id} cannot be traced.`
            : `${nameOf(ctx, signal)} ${pct(value)} ${sign(value, hardAt)} hard_rule_at ${pct(hardAt)}: ${id} ${value >= hardAt ? "fires (quarantine)" : "does not fire"}.`);
        }
        const prob = finite(fact?.claimed_identity_prob);
        const claimed = fact ? fact.claimed_label || ctx.data?.identity_labels?.[fact.claimed_identity] || fact.claimed_identity || "the claimed sender" : "";
        const domain = fact?.sender_domain || "(no domain)";
        line("sender", !fact ? "No sender facts: the domain check cannot be traced."
          : fact.domain_matches === null ? `Claimed sender ${claimed} has no domain to verify, so there is no mismatch.`
            : fact.domain_matches === true ? `Sender domain ${domain} matches ${fact.expected_domain} for ${claimed}: no mismatch.`
              : `Sender domain ${domain} is not ${fact.expected_domain} for ${claimed}; P(${claimed}) ${prob === null ? "unknown" : `${pct(prob)} ${sign(prob, mismatchCut)} ${pct(mismatchCut)}`}: ${traced.mismatch ? "counts as a mismatch" : "too unsure to count as a mismatch"}.`);
        const asks = RISKY_ASKS.filter((id) => values[id] !== null).map((id) => ({ id, value: values[id] })).sort((a, b) => b.value - a.value);
        line("risky_ask", asks.length ? `Largest risky ask: ${nameOf(ctx, asks[0].id)} ${pct(asks[0].value)} ${sign(asks[0].value, riskyCut)} ${pct(riskyCut)}.` : "No risky-ask answer to trace.");
        line("risky_ask", traced.mismatch && traced.risky ? "Mismatch with a risky ask: impersonation fires (quarantine)."
          : traced.mismatch ? "Mismatch without a risky ask: unverified_sender fires (review)." : "No mismatch: no sender rule fires.");
        const quarantineRules = traced.rules.filter((rule) => rule.action === "quarantine");
        if (risk === null || quarantineAt === null || reviewAt === null) line("thresholds", "The risk or a threshold is missing.");
        else {
          line("thresholds", `Risk ${pct(risk)} ${sign(risk, quarantineAt)} quarantine_at ${pct(quarantineAt)}.`);
          line("thresholds", `Risk ${pct(risk)} ${sign(risk, reviewAt)} review_at ${pct(reviewAt)}.`);
        }
        const band = risk !== null && quarantineAt !== null && reviewAt !== null && !quarantineRules.length && risk < quarantineAt && risk >= reviewAt;
        line("harm", harm === null ? "Loss if obeyed: unknown."
          : risk === null || quarantineAt === null || reviewAt === null ? `Loss if obeyed ${harm.toFixed(2)}: without the risk and thresholds, the lift cannot be traced.`
          : !band ? `Loss if obeyed ${harm.toFixed(2)}: the lift does not apply (only for a risk between review_at and quarantine_at with no quarantine rule).`
            : `Loss if obeyed ${harm.toFixed(2)} ${sign(harm, lift)} ${lift}: ${harm >= lift ? "lifts the review to quarantine" : "no lift"}.`);
        let level = null, reason = "";
        if (quarantineRules.length) { level = "quarantine"; reason = `hard rule ${quarantineRules.map((rule) => rule.id).join(", ")}`; }
        else if (risk === null || quarantineAt === null || reviewAt === null) reason = "the risk or a threshold is missing";
        else if (risk >= quarantineAt) { level = "quarantine"; reason = "risk at or above quarantine_at"; }
        else if (risk >= reviewAt) {
          if (harm === null) reason = "the loss score is missing";
          else if (harm >= lift) { level = "quarantine"; reason = "the loss score lifts the review"; }
          else { level = "review"; reason = `risk at or above review_at${traced.rules.length ? ` and rule ${traced.rules.map((rule) => rule.id).join(", ")}` : ""}`; }
        } else if (traced.rules.length) { level = "review"; reason = `rule ${traced.rules.map((rule) => rule.id).join(", ")}`; }
        else { level = "safe"; reason = "no rule fired and the risk is under review_at"; }
        line("decided_by", `Decided by: ${reason}${level ? ` → ${level}` : ""}.`);
        const pageIds = verdictRules(ctx).map((rule) => rule.id).join(", ");
        const tracedIds = traced.rules.map((rule) => rule.id).join(", ");
        const agrees = pageIds === tracedIds && level === verdict.level;
        const text = lines.map((entry) => entry.text);
        const moves = HARD_RULES.flatMap(([signal, id]) => {
          const value = values[signal];
          if (value === null || hardAt === null) return [];
          const to = hardFlip(value, hardAt);
          return to === null ? [] : [{ id, to, fires: value >= hardAt }];
        });
        const move = (entry) => {
          try {
            ctx.actions.setPolicy({ hard_rule_at: entry.to });
            api.toast(`hard_rule_at moved to ${entry.to}; every verdict is re-scored with no Jev call.`);
          } catch (error) { api.toast(error.message, "error"); }
          api.redraw();
        };
        return h("div", {},
          faint(h, "Mirrors jev/shield.py on your answers and the sliders now; the page's verdict stays the decision."),
          h("ol", {}, lines.map((entry) => h("li", { "data-step": entry.step }, entry.text))),
          h("p", { "data-agree": agrees ? "yes" : "no" }, agrees ? `The trace matches the page's verdict (${verdict.level}${pageIds ? `; ${pageIds}` : ""}).`
            : `The trace (${level || "unknown"}; rules ${tracedIds || "none"}) differs from the page's verdict (${verdict.level || "unknown"}; rules ${pageIds || "none"}): a re-score may be on its way.`),
          h("div", {}, moves.map((entry) => h("button", { class: "btn sm ghost", "data-move-hard": entry.id, onclick: () => move(entry) },
            `Move hard_rule_at to ${entry.to} (${entry.id} would ${entry.fires ? "stop" : "start"} firing)`))),
          h("button", { class: "btn sm ghost", "data-copy": "trace", onclick: () => api.copy(`Shield rule trace (your own screen; local mirror of the policy)\n${text.join("\n")}\n`) }, "Copy trace"));
      } },

    // ---------- all ten answers ----------
    { id: "answer_sheet", kind: "panel", title: "All ten answers",
      improvements: [
        { id: "table", title: "List all ten answers of the opened message with type, value, top option and confidence" },
        { id: "kinds", title: "Show every message-kind option with its probability, the chosen one marked" },
        { id: "levels", title: "Show every level of the time-pressure score, which the page does not list, with its legend and probability" },
      ],
      render: (h, ctx) => {
        const answers = ctx.data?.answers;
        if (!isObject(answers)) return faint(h, "Open a screened message to see all its answers.");
        const category = answers.category;
        const labels = ctx.data?.category_labels || {};
        const keys = category ? [...Object.keys(labels), ...Object.keys(category.probabilities || {}).filter((key) => !(key in labels))] : [];
        return h("div", {},
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Question", "Type", "Answer", "Top option", "Confidence"].map((label) => h("th", {}, label)))),
            h("tbody", {}, Object.entries(answers).map(([id, answer]) => h("tr", { "data-answer": id }, h("td", {}, id), h("td", {}, answer.type || "—"),
              h("td", {}, answerText(answer, ctx)), h("td", {}, answer.top ? `${answer.top.key} ${pct(answer.top.p)}` : "—"),
              h("td", { class: "num" }, finite(answer.confidence) === null ? "—" : pct(answer.confidence)))))),
          category ? h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Message kind", "Probability", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, keys.map((key) => {
              const p = finite(category.probabilities?.[key]);
              return h("tr", { "data-kind": key, class: key === category.value ? "active" : "" }, h("td", {}, labels[key] || key.replace(/_/g, " ")),
                h("td", { class: "num" }, p === null ? "—" : pct(p)), h("td", {}, key === category.value ? "chosen" : ""));
            }))) : faint(h, "The response has no message-kind answer."),
          Object.entries(answers).filter(([, answer]) => answer.type === "score").map(([id, answer]) => {
            const keys = [...new Set([...Object.keys(answer.legend || {}), ...Object.keys(answer.probabilities || {})])].sort((a, b) => Number(a) - Number(b));
            const nearest = finite(answer.value) === null ? null : String(Math.round(answer.value));
            return h("table", { class: "table lab-table", "data-score": id },
              h("thead", {}, h("tr", {}, [`${id} level`, "Legend", "Probability", ""].map((label) => h("th", {}, label)))),
              h("tbody", {}, keys.map((key) => {
                const p = finite(answer.probabilities?.[key]);
                return h("tr", { "data-level": `${id}:${key}` }, h("td", { class: "num" }, key), h("td", {}, String(answer.legend?.[key] || "")),
                  h("td", { class: "num" }, p === null ? "—" : pct(p)), h("td", {}, key === nearest ? `score ${answer.value.toFixed(2)} rounds here` : ""));
              })));
          }));
      } },

    // ---------- metrics ----------
    { id: "largest_share", kind: "metric", format: "percent", label: "Largest single share of the risk (local estimate)",
      help: "The biggest signal's −ln(1 − contribution) share of the noisy-OR risk, as a percent of the risk.",
      compute: (ctx) => {
        const ranked = rankedShares(ctx);
        if (!ranked || !(ranked.risk > 0)) return null;
        return { value: ranked.rows[0].share / ranked.risk, detail: ranked.rows[0].item.name };
      } },
    { id: "signals_for_80", kind: "metric", format: "integer", label: "Signals that carry 80% of the risk (local estimate)",
      help: "The fewest signals, largest share first, whose shares add up to at least 80% of the risk.",
      compute: (ctx) => {
        const ranked = rankedShares(ctx);
        if (!ranked || !(ranked.risk > 0)) return null;
        let total = 0;
        for (let index = 0; index < ranked.rows.length; index++) {
          total += ranked.rows[index].share;
          if (total >= 0.8 * ranked.risk - 1e-12) return { value: index + 1, detail: ranked.rows.slice(0, index + 1).map((row) => row.item.name).join(", ") };
        }
        return ranked.rows.length;
      } },
    { id: "domain_check_share", kind: "metric", format: "percent", label: "Share of the risk from the domain check (local estimate)",
      help: "The sender-domain code check's share of the noisy-OR risk, as a percent of the risk.",
      compute: (ctx) => {
        const ranked = rankedShares(ctx);
        if (!ranked || !(ranked.risk > 0)) return null;
        const row = ranked.rows.find((entry) => entry.item.id === "identity_mismatch");
        return row ? row.share / ranked.risk : null;
      } },
    { id: "hard_rule_margin", kind: "metric", format: "number", label: "Hard-rule threshold minus the highest rule answer",
      help: "hard_rule_at minus the larger of the AI-instructions and credential-ask answers: at or below 0, a hard rule fires.",
      compute: (ctx) => {
        const hardAt = finite(ctx.data?.policy?.hard_rule_at);
        const reads = HARD_RULES.map(([signal]) => ({ signal, value: signalValue(ctx, signal) })).filter((entry) => entry.value !== null);
        if (hardAt === null || !reads.length) return null;
        const top = reads.reduce((a, b) => (b.value > a.value ? b : a));
        return { value: hardAt - top.value, detail: nameOf(ctx, top.signal) };
      } },
    { id: "identity_cut_margin", kind: "metric", format: "number", label: "Claimed sender's probability above the mismatch cut",
      help: "When the sender domain does not match: P(claimed sender) minus 0.6; at or above 0 the mismatch counts. Unavailable when the domain matches or there is nothing to verify.",
      compute: (ctx) => {
        const fact = ctx.data?.fact, prob = finite(fact?.claimed_identity_prob);
        return fact?.domain_matches === false && prob !== null ? prob - ruleValue(ctx, "mismatch_prob", 0.6) : null;
      } },
    { id: "risky_ask_margin", kind: "metric", format: "number", label: "Largest risky ask above its cut",
      help: "The largest of payment redirect, credential ask and link lure, minus 0.5: at or above 0, a domain mismatch is an impersonation.",
      compute: (ctx) => {
        const asks = RISKY_ASKS.map((id) => ({ id, value: signalValue(ctx, id) })).filter((entry) => entry.value !== null);
        if (!asks.length) return null;
        const top = asks.reduce((a, b) => (b.value > a.value ? b : a));
        return { value: top.value - ruleValue(ctx, "risky_ask", 0.5), detail: nameOf(ctx, top.id) };
      } },
    { id: "harm_lift_margin", kind: "metric", format: "number", label: "Loss score above the quarantine lift",
      help: "The loss-if-obeyed score minus 2.5: at or above 0, a review with risk at or above review_at becomes a quarantine.",
      compute: (ctx) => {
        const harm = finite(ctx.data?.verdict?.harm);
        return harm === null ? null : harm - ruleValue(ctx, "harm_quarantine", 2.5);
      } },
    { id: "level_at_defaults", kind: "metric", format: "text", label: "Level with every slider at its default (local estimate)",
      help: "jev/shield.py's rules applied locally to your answers with the default weights and thresholds.",
      compute: (ctx) => {
        const items = complete(ctx), defaults = ctx.data?.defaults, verdict = ctx.data?.verdict;
        if (!items || !verdict || !isObject(defaults?.policy) || items.some((item) => finite(item.default_weight) === null)) return null;
        const risk = riskWith(items, Object.fromEntries(items.map((item) => [item.id, item.default_weight])));
        const traced = traceRules(valuesOf(items), ctx.data?.fact, finite(defaults.policy.hard_rule_at), ctx);
        const level = estimateLevel(risk, traced.rules, finite(verdict.harm), defaults.policy, ruleValue(ctx, "harm_quarantine", 2.5));
        return level === null ? null : { value: level, detail: `risk ${pct(risk)}` };
      } },
    { id: "thresholds_moved", kind: "metric", format: "integer", label: "Thresholds moved from the defaults",
      help: "How many of review_at, quarantine_at and hard_rule_at differ from their defaults now. Settings only.",
      compute: (ctx) => {
        const policy = ctx.data?.policy, defaults = ctx.data?.defaults?.policy;
        if (!policy || !defaults) return null;
        const moved = ["review_at", "quarantine_at", "hard_rule_at"].filter((key) => finite(policy[key]) !== null && finite(defaults[key]) !== null && Math.abs(policy[key] - defaults[key]) > 1e-9);
        return { value: moved.length, detail: moved.length ? moved.join(", ") : "every threshold at its default" };
      } },
  ],
});
