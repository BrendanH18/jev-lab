// Plan review: facts, close-call hints, measured call metrics, exports and palette commands for the answers of the
// user's own latest Dispatch command (the "All N answers from the same call" grid).
import { csvText, definePack } from "../../kit.js";

const MISSING = new Set(["not_identified", "not_stated"]);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const ranked = (item) => (Array.isArray(item.ranked) ? item.ranked : []);
const marginOf = (item) => ((item.type === "choice" || item.type === "score") && ranked(item).length >= 2 ? ranked(item)[0].p - ranked(item)[1].p : null);
const thresholdOf = (ctx) => {
  const plan = ctx?.data?.plan;
  return plan && plan.tool_meta && plan.tool_meta[plan.tool] ? num(plan.tool_meta[plan.tool].threshold) : null;
};
const pct = (value) => `${Math.round(value * 100)}%`;

export default definePack({
  id: "dispatch-plan-review",
  surface: "dispatch.plan",
  title: "Plan review",
  about: "Filters, sorts, close-call hints, measured cost and latency, and exports for the answers of your own latest command, plus palette commands that inspect, copy or pick an offered option. Answer exports say they hold model answers; the request export holds no answers, and close-call rules are local advice.",
  features: [
    { id: "p", kind: "fact", type: "number", label: "answer probability", help: "The percentage the card prints.", value: (item) => num(item.p) },
    { id: "margin", kind: "fact", type: "number", label: "lead over the runner-up", help: "Choice and Score answers only.", value: (item) => marginOf(item) },
    { id: "used", kind: "fact", type: "flag", label: "answer used by the plan", value: (item) => item.used === true },
    { id: "group", kind: "fact", type: "category", label: "action group", value: (item) => item.group || null },
    { id: "type", kind: "fact", type: "category", label: "question type", value: (item) => item.type || null },
    { id: "option_count", kind: "fact", type: "number", label: "option count",
      value: (item) => (item.criteria?.length ? item.criteria.length : item.probabilities?.length ? item.probabilities.length : null) },
    { id: "not_found", kind: "fact", type: "flag", label: "not identified or not stated", value: (item) => MISSING.has(item.value) },
    { id: "spread", kind: "fact", type: "number", label: "spread of the probabilities in bits", help: "0 when one option holds everything.",
      value: (item) => {
        const list = Array.isArray(item.probabilities) ? item.probabilities.filter((entry) => num(entry.p) !== null) : [];
        return list.length ? Math.abs(list.reduce((sum, { p }) => sum - (p > 0 ? p * Math.log2(p) : 0), 0)) : null;
      } },
    { id: "answer", kind: "fact", type: "text", label: "answer as printed", value: (item) => item.display || "" },
    { id: "below_threshold", kind: "fact", type: "flag", label: "used answer below the action's threshold",
      help: "Local comparison with the planned action's threshold.",
      value: (item, ctx) => item.used === true && item.type === "choice" && num(item.p) !== null && thresholdOf(ctx) !== null && item.p < thresholdOf(ctx) },

    { id: "close_call", kind: "diagnostic", severity: "advice", label: "Close call",
      check: (item) => {
        const margin = marginOf(item);
        if (margin === null || margin >= 0.1) return null;
        const [first, second] = ranked(item);
        return `${first.key.replace(/_/g, " ")} leads ${second.key.replace(/_/g, " ")} by ${Math.round(margin * 100)} points: a close call by a local 10-point rule, not the page's decision.`;
      } },
    { id: "probability_sum", kind: "diagnostic", severity: "advice", label: "Probabilities do not add up to 100%",
      check: (item) => {
        if (item.type !== "choice" && item.type !== "score") return null;
        const list = (item.probabilities || []).map((entry) => num(entry.p)).filter((p) => p !== null);
        if (!list.length) return null;
        const total = list.reduce((sum, p) => sum + p, 0);
        return Math.abs(total - 1) > 0.02 ? `The listed probabilities add up to ${(total * 100).toFixed(1)}%.` : null;
      } },

    { id: "call_cost", kind: "metric", format: "usd", label: "Cost of the shown call (measured)", compute: (ctx) => num(ctx.data?.meta?.cost_usd) },
    { id: "latency", kind: "metric", format: "ms", label: "Latency of the shown call (measured)", compute: (ctx) => num(ctx.data?.meta?.latency_ms) },
    { id: "tokens", kind: "metric", format: "integer", label: "Tokens in the shown call (measured)",
      compute: (ctx) => {
        const input = num(ctx.data?.meta?.input_tokens), output = num(ctx.data?.meta?.output_tokens);
        return input === null && output === null ? null : (input ?? 0) + (output ?? 0);
      } },
    { id: "used_share", kind: "metric", format: "percent", label: "Shown answers the plan used",
      compute: (ctx) => (ctx.shown().length ? ctx.shown().filter((item) => item.used).length / ctx.shown().length : null) },
    { id: "session_cost", kind: "metric", format: "usd", label: "Cost of this session's commands (measured)",
      help: "Answered commands since the page loaded, at most the latest 50.",
      compute: (ctx) => {
        const costs = (ctx.data?.history || []).map((entry) => num(entry.meta?.cost_usd)).filter((value) => value !== null);
        return costs.length ? { value: costs.reduce((sum, value) => sum + value, 0), detail: `${costs.length} command${costs.length === 1 ? "" : "s"}` } : null;
      } },
    { id: "session_calls", kind: "metric", format: "integer", label: "Commands answered this session",
      compute: (ctx) => (num(ctx.data?.calls) ? ctx.data.calls : null) },
    { id: "cost_per_1000", kind: "metric", format: "usd", label: "1,000 commands like this one (projection)",
      help: "The shown call's measured cost times 1,000: arithmetic, not spend.",
      compute: (ctx) => (num(ctx.data?.meta?.cost_usd) === null ? null : ctx.data.meta.cost_usd * 1000) },

    { id: "answers_csv", kind: "exporter", label: "Shown answers of your latest command as CSV", help: "contains model answers and probabilities",
      filename: "dispatch-answers.csv", mime: "text/csv",
      build: (ctx) => csvText([["question", "type", "used", "answer", "probability"], ...ctx.shown().map((item) => [item.id, item.type, item.used ? "yes" : "no",
        item.value === null || item.value === undefined ? "" : String(item.value), num(item.p) === null ? "" : String(item.p)])]) },
    { id: "request_json", kind: "exporter", label: "Request of your latest command, for the Workbench", help: "state, model and questions only: no answers, plan or measurements",
      filename: "dispatch-request.json", mime: "application/json",
      build: (ctx) => {
        const request = ctx.data?.request;
        if (!request) throw new Error("Run a command first: there is no request yet.");
        return `${JSON.stringify({ state: request.state, model: request.model, questions: request.questions }, null, 2)}\n`;
      } },
    { id: "plan_summary", kind: "exporter", label: "Plan of your latest command as text", help: "contains your command, the planned call, decision, reasons and checks",
      filename: "dispatch-plan.txt",
      build: (ctx) => {
        const plan = ctx.data?.plan;
        if (!plan) throw new Error("Run a command first: there is no plan yet.");
        const confidence = num(plan.confidence);
        return [`Command: ${ctx.data.text ?? ""}`, `Call: ${plan.signature || plan.tool}`,
          `Decision: ${plan.decision}${confidence === null ? "" : ` (confidence ${pct(confidence)})`}${ctx.data.done ? ", executed" : ""}`,
          "Reasons:", ...(plan.reasons || []).map((reason) => `- ${reason}`),
          "Checks:", ...((plan.checks || []).length ? plan.checks.map((check) => `- ${check.level} · ${check.label} · ${check.detail}`) : ["- none"])].join("\n") + "\n";
      } },

    { id: "inspect", kind: "command", group: "Dispatch plan", title: "Inspect the latest command's request JSON",
      when: (ctx) => ctx.items().length > 0, run: (ctx) => ctx.actions.inspect() },
    { id: "copy_call", kind: "command", group: "Dispatch plan", title: "Copy the planned function call",
      when: (ctx) => !!ctx.data.plan,
      run: (ctx) => {
        ctx.env.copy(ctx.data.plan.signature);
        ctx.env.toast?.("Copied the planned call. Nothing has run.");
      } },
    { id: "pick_top_option", kind: "command", group: "Dispatch plan", title: "Pick the likeliest offered option (no model call)",
      when: (ctx) => !!ctx.data.clarify && (ctx.data.clarify.tools.length > 0 || ctx.data.clarify.args.some((arg) => arg.options.length > 0)),
      run: (ctx) => {
        const { tools, args } = ctx.data.clarify;
        if (tools.length) return ctx.actions.pickTool(tools[0].value);
        const arg = args.find((entry) => entry.options.length);
        return ctx.actions.pickArg(arg.name, arg.options[0].value);
      } },
    { id: "copy_command", kind: "command", group: "Dispatch plan", title: "Copy the latest command's text",
      when: (ctx) => ctx.data.text !== null,
      run: (ctx) => {
        ctx.env.copy(ctx.data.text);
        ctx.env.toast?.("Copied the command text.");
      } },
  ],
});
