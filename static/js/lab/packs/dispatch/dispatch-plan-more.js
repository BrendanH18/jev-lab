// Plan, more: runner-up, world-name, priority-cut and threshold-gap facts on the answers of the user's own latest
// Dispatch command, advisory answer checks, metrics over this page load's answered commands, and two exports with
// stated contents. Every rule here is local advice; the page's own thresholds stay the only gate. No model call.
import { csvText, definePack } from "../../kit.js";

const MISSING = new Set(["not_identified", "not_stated"]);
const PRIORITY_CUTS = [0.67, 1.34];  // jev/dispatch.py: low below 0.67, normal below 1.34, urgent from 1.34
const WORLD_TABLE = { order: "orders", vendor: "vendors", meeting: "meetings", customer: "customers" };
const PLAUSIBLE = 0.05;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
const ranked = (item) => list(item.ranked).filter((entry) => num(entry.p) !== null);
const spaced = (key) => String(key).replace(/_/g, " ");
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const thresholdOf = (ctx) => {
  const plan = ctx?.data?.plan;
  return plan && isObject(plan.tool_meta) && isObject(plan.tool_meta[plan.tool]) ? num(plan.tool_meta[plan.tool].threshold) : null;
};
// The user's own "Which <arg>?" pick for this answer's argument, if any (data.override.args).
const pickedArg = (item, ctx) => {
  const override = ctx?.data?.override;
  return !!item.arg && isObject(override) && isObject(override.args) && Object.hasOwn(override.args, item.arg);
};
const priorityScore = (item) => (item.id === "task.priority" && item.type === "score" ? num(item.score) : null);

// The world record a Choice answer names (order, vendor, meeting or customer), or null.
function worldRecord(item, ctx) {
  const table = WORLD_TABLE[item.arg];
  const world = ctx?.data?.world;
  if (!table || !isObject(world) || !isObject(world[table]) || typeof item.value !== "string") return null;
  return isObject(world[table][item.value]) ? world[table][item.value] : null;
}

function valueLabel(item, ctx) {
  if (item.type !== "choice" || typeof item.value !== "string") return "";
  if (MISSING.has(item.value)) return spaced(item.value);
  const record = worldRecord(item, ctx);
  if (item.arg === "order" && record) {
    const customers = ctx.data.world.customers;
    const customer = isObject(customers) && isObject(customers[record.customer]) ? customers[record.customer] : null;
    return customer && typeof customer.name === "string" && customer.name ? `${item.value} · ${customer.name}` : item.value;
  }
  if (item.arg === "meeting" && record && typeof record.title === "string" && record.title) return record.title;
  if ((item.arg === "vendor" || item.arg === "customer") && record && typeof record.name === "string" && record.name) return record.name;
  if (item.arg === "day") return item.value.replace(/^\w/, (c) => c.toUpperCase());
  return spaced(item.value);
}

const history = (ctx) => list(ctx?.data?.history);
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
// "clarify 1 · confirm 1": counts, largest first, ties A to Z.
function mixText(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name, count]) => `${name} ${count}`).join(" · ");
}
const normalized = (text) => String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export default definePack({
  id: "dispatch-plan-more",
  surface: "dispatch.plan",
  title: "Plan, more",
  about: "Runner-up, world-name, priority and threshold-gap facts on the answers of your own latest command, advisory answer checks, metrics over this page load's commands, and plan and session exports that say what they hold. Rules are local advice, never the page's decision; nothing here calls the model.",
  features: [
    { id: "runner_up", kind: "fact", type: "text", label: "runner-up option", help: "The second most likely option of the answer.",
      value: (item) => (ranked(item).length >= 2 ? spaced(ranked(item)[1].key) : "") },
    { id: "runner_up_p", kind: "fact", type: "number", label: "runner-up probability",
      value: (item) => (ranked(item).length >= 2 ? ranked(item)[1].p : null) },
    { id: "top_two", kind: "fact", type: "number", label: "top-two probability share", help: "The two likeliest options together; near 1 means the rest hardly count.",
      value: (item) => (ranked(item).length >= 2 ? ranked(item)[0].p + ranked(item)[1].p : null) },
    { id: "plausible_options", kind: "fact", type: "number", label: "options at 5% or more",
      value: (item) => (ranked(item).length ? ranked(item).filter((entry) => entry.p >= PLAUSIBLE).length : null) },
    { id: "world_record", kind: "fact", type: "flag", label: "answer naming a world record", help: "The chosen key is an order, vendor, meeting or customer in the current world.",
      value: (item, ctx) => worldRecord(item, ctx) !== null },
    { id: "value_label", kind: "fact", type: "text", label: "chosen value with world names", help: "Choice answers, with order, vendor, meeting and customer keys read as names.",
      value: (item, ctx) => valueLabel(item, ctx) },
    { id: "priority_level", kind: "fact", type: "category", label: "priority level from the score",
      help: "task.priority mapped with the cut-offs 0.67 and 1.34 that jev/dispatch.py uses (a local mirror).",
      value: (item) => {
        const score = priorityScore(item);
        return score === null ? null : score < PRIORITY_CUTS[0] ? "low" : score < PRIORITY_CUTS[1] ? "normal" : "urgent";
      } },
    { id: "cutoff_distance", kind: "fact", type: "number", label: "distance to the nearest priority cut-off",
      help: "How far the task.priority score sits from 0.67 or 1.34.",
      value: (item) => {
        const score = priorityScore(item);
        return score === null ? null : Math.min(...PRIORITY_CUTS.map((cut) => Math.abs(score - cut)));
      } },
    { id: "threshold_gap", kind: "fact", type: "number", label: "gap to the action's threshold",
      help: "A used Choice answer's probability minus the planned action's threshold; negative is below it (local comparison).",
      value: (item, ctx) => (item.used === true && item.type === "choice" && num(item.p) !== null && thresholdOf(ctx) !== null ? item.p - thresholdOf(ctx) : null) },
    { id: "replaced_by_pick", kind: "fact", type: "flag", label: "answer replaced by your pick",
      help: "You picked another value for it in \"Which did you mean?\", so the plan uses your pick.",
      value: (item, ctx) => {
        const override = ctx?.data?.override;
        if (!isObject(override) || item.used !== true) return false;
        if (item.id === "tool") return typeof override.tool === "string" && override.tool !== item.value;
        return pickedArg(item, ctx) && String(override.args[item.arg]) !== String(item.value);
      } },

    { id: "used_not_found", kind: "diagnostic", severity: "advice", label: "Used answer found nothing",
      help: "Quiet when you picked a value for it in \"Which <arg>?\", since the plan then uses your pick.",
      check: (item, ctx) => (item.used === true && MISSING.has(item.value) && !pickedArg(item, ctx)
        ? `${item.id} is ${spaced(item.value)}, so the plan has no ${item.arg || "value"} from the command: name it in the command (local advice).` : null) },
    { id: "tool_runner_up_none", kind: "diagnostic", severity: "info", label: "No action is the runner-up",
      check: (item) => {
        if (item.id !== "tool" || ranked(item).length < 2 || ranked(item)[1].key !== "none") return null;
        return `The second likeliest action is no action at ${Math.round(ranked(item)[1].p * 100)}%: the command may not ask for anything (local advice).`;
      } },
    { id: "near_priority_cut", kind: "diagnostic", severity: "advice", label: "Priority score near a cut-off",
      check: (item) => {
        const score = priorityScore(item);
        if (score === null) return null;
        const cut = PRIORITY_CUTS.find((value) => Math.abs(score - value) <= 0.05 + 1e-9);  // tolerance for binary rounding at exactly 0.05
        return cut === undefined ? null : `Score ${score.toFixed(2)} is within 0.05 of the ${cut} cut-off, so a slightly different wording could change the priority (local advice).`;
      } },
    { id: "not_in_criteria", kind: "diagnostic", severity: "problem", label: "Chosen key was not offered",
      check: (item) => {
        if (item.type !== "choice" || item.value === null || item.value === undefined || !list(item.criteria).length) return null;
        return list(item.criteria).some((entry) => entry.key === item.value) ? null : `${item.id} chose "${item.value}", which is not one of the options the request sent.`;
      } },
    { id: "chosen_not_top", kind: "diagnostic", severity: "advice", label: "Chosen key is not the likeliest",
      check: (item) => {
        if (item.type !== "choice" || typeof item.value !== "string" || !ranked(item).length) return null;
        const top = ranked(item)[0];
        const chosen = ranked(item).find((entry) => entry.key === item.value);
        return top.key !== item.value && (!chosen || top.p > chosen.p) ? `${item.id} chose "${item.value}" but "${top.key}" has the highest probability (${Math.round(top.p * 100)}%).` : null;
      } },

    { id: "median_latency", kind: "metric", format: "ms", label: "Median latency of this session's commands (measured)",
      help: "Answered commands since the page loaded, at most the latest 50, the shown one included.",
      compute: (ctx) => {
        const values = history(ctx).map((entry) => num(entry.meta?.latency_ms)).filter((value) => value !== null);
        return values.length ? { value: median(values), detail: plural(values.length, "command") } : null;
      } },
    { id: "average_cost", kind: "metric", format: "usd", label: "Average cost per command this session (measured)",
      compute: (ctx) => {
        const values = history(ctx).map((entry) => num(entry.meta?.cost_usd)).filter((value) => value !== null);
        return values.length ? { value: values.reduce((sum, value) => sum + value, 0) / values.length, detail: plural(values.length, "command") } : null;
      } },
    { id: "decision_mix", kind: "metric", format: "text", label: "Decisions this session", help: "Each command's decision as first returned, before any pick.",
      compute: (ctx) => {
        const decisions = history(ctx).map((entry) => entry.decision).filter((value) => typeof value === "string" && value);
        return decisions.length ? mixText(decisions) : null;
      } },
    { id: "tool_mix", kind: "metric", format: "text", label: "Planned actions this session", help: "Each command's planned action as first returned.",
      compute: (ctx) => {
        const tools = history(ctx).map((entry) => entry.tool).filter((value) => typeof value === "string" && value);
        return tools.length ? mixText(tools.map(spaced)) : null;
      } },
    { id: "confirm_share", kind: "metric", format: "percent", label: "Commands that needed confirmation",
      compute: (ctx) => {
        const decisions = history(ctx).map((entry) => entry.decision).filter((value) => typeof value === "string" && value);
        return decisions.length ? { value: decisions.filter((value) => value === "confirm").length / decisions.length, detail: `of ${plural(decisions.length, "command")}` } : null;
      } },
    { id: "repeated_commands", kind: "metric", format: "integer", label: "Commands repeated within this session",
      help: "Commands whose text matches an earlier one of this session, ignoring case and spacing.",
      compute: (ctx) => {
        const entries = history(ctx);
        if (!entries.length) return null;
        const seen = new Set();
        let repeated = 0;
        for (const entry of entries) {
          const key = normalized(entry.text);
          if (seen.has(key)) repeated++;
          seen.add(key);
        }
        return repeated;
      } },

    { id: "session_csv", kind: "exporter", label: "This session's commands as CSV",
      help: "contains your command texts, each plan's action, decision and confidence as first returned, and measured latency and cost; earlier commands are marked earlier; no answers",
      filename: "dispatch-session.csv", mime: "text/csv",
      build: (ctx) => {
        const entries = history(ctx);
        if (!entries.length) throw new Error("Run a command first: this session has no answered command yet.");
        return csvText([["call", "when", "command", "action", "decision", "confidence", "latency_ms", "cost_usd"],
          ...entries.map((entry, index) => [entry.call ?? index + 1, index === entries.length - 1 ? "latest (shown)" : "earlier", entry.text ?? "", entry.tool ?? "",
            entry.decision ?? "", num(entry.confidence) ?? "", num(entry.meta?.latency_ms) ?? "", num(entry.meta?.cost_usd) ?? ""])]);
      } },
    { id: "plan_json", kind: "exporter", label: "Plan of your latest command as JSON",
      help: "contains your command text and the plan: planned call, action ranking, argument probabilities, decision, reasons and checks; no question text or measurements",
      filename: "dispatch-plan.json", mime: "application/json",
      build: (ctx) => {
        const plan = ctx.data?.plan;
        if (!plan) throw new Error("Run a command first: there is no plan yet.");
        return `${JSON.stringify({ command: ctx.data.text ?? "", executed: ctx.data.done === true, plan }, null, 2)}\n`;
      } },
  ],
});
