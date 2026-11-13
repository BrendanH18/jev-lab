// Facts, advisory checks, metrics, exports and commands for the answers of the user's own latest Claims check (surface
// "claims.result"). Distances to cuts are plain local arithmetic on the policy in force, never Jev's answer and never
// the page's decision (that is data.verdict).
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const two = (value) => value.toFixed(2);

// The nearest policy cut that reads this answer: { key, at, distance } or null. The Box cut compares with confidence.
function nearestCut(item) {
  const base = item?.type === "box" ? num(item.confidence) : num(item?.value);
  if (base === null || !Array.isArray(item.cuts)) return null;
  let best = null;
  for (const cut of item.cuts) {
    const at = num(cut?.at);
    if (at === null) continue;
    const distance = Math.abs(base - at);
    if (!best || distance < best.distance) best = { key: cut.key, at, distance, base };
  }
  return best;
}

// The top probability minus the runner-up's, for choice and score answers.
function lead(item) {
  if (item?.type !== "choice" && item?.type !== "score") return null;
  const ps = (Array.isArray(item.probabilities) ? item.probabilities : []).map((entry) => num(entry?.p)).filter((p) => p !== null).sort((a, b) => b - a);
  return ps.length >= 2 ? ps[0] - ps[1] : null;
}

const boxArea = (box) => (box ? (box.right - box.left) * (box.bottom - box.top) : null);
const byId = (items, id) => items.find((item) => item?.id === id) || null;
const policyOf = (ctx) => ctx?.data?.policy || null;
const result = (ctx) => (ctx.data.verdict ? ctx.data : null);

function requireResult(ctx) {
  if (!ctx.data.verdict) throw new Error("Check a claim first: there is no decision to export yet.");
}

export default definePack({
  id: "claims-result-insights",
  surface: "claims.result",
  title: "Claim answer insights",
  about: "Filters, advisory checks, metrics and exports for the answers of your own latest Claims check: distances to the policy cuts, leads over the runner-up, the raw box in pixels and this session's checks. Exports that hold answers or the customer's notes say so; the policy export holds settings only.",
  features: [
    { id: "type", kind: "fact", type: "category", label: "question type", value: (item) => item.type || null },
    { id: "yes_probability", kind: "fact", type: "number", label: "yes probability", value: (item) => (item.type === "noul" ? num(item.value) : null) },
    { id: "confidence", kind: "fact", type: "number", label: "answer confidence", value: (item) => num(item.confidence) },
    { id: "top_probability", kind: "fact", type: "number", label: "top probability", value: (item) => num(item.top?.p) },
    { id: "cut_distance", kind: "fact", type: "number", label: "distance to the nearest policy cut",
      help: "Plain arithmetic on the policy in force; the Box cut compares with its confidence.", value: (item) => nearestCut(item)?.distance ?? null },
    { id: "runner_up_lead", kind: "fact", type: "number", label: "lead over the runner-up", value: (item) => lead(item) },
    { id: "instructions", kind: "fact", type: "text", label: "question text", value: (item) => item.instructions },
    { id: "failing_check", kind: "fact", type: "flag", label: "a failing plain-code check", value: (item) => !!item.check && item.check.ok === false },
    { id: "close_call", kind: "fact", type: "flag", label: "a close call (within 0.10 of a cut)",
      value: (item) => { const cut = nearestCut(item); return !!cut && cut.distance <= 0.1 + 1e-9; } },

    { id: "near_cut", kind: "diagnostic", label: "Within 0.05 of a policy cut", severity: "advice",
      check: (item) => {
        const cut = nearestCut(item);
        if (!cut || cut.distance > 0.05 + 1e-9) return null;
        return `${item.type === "box" ? "confidence" : "value"} ${two(cut.base)} sits ${two(cut.distance)} from ${cut.key} ${two(cut.at)}; a small slider move flips this rule (advisory).`;
      } },
    { id: "narrow_lead", kind: "diagnostic", label: "Runner-up close behind", severity: "advice",
      check: (item) => { const gap = lead(item); return gap !== null && gap < 0.15 ? `the top answer leads by only ${two(gap)}.` : null; } },
    { id: "wide_box", kind: "diagnostic", label: "Box covers more than half of the photo", severity: "info",
      check: (item) => { const area = boxArea(item.box); return area !== null && area > 0.5 ? `the raw box covers ${Math.round(area * 100)}% of the picture.` : null; } },
    { id: "kind_vs_damage", kind: "diagnostic", scope: "list", label: "Kind says none visible while damage reads visible", severity: "advice",
      check: (items, ctx) => {
        const kind = byId(items, "damage_kind"), damage = byId(items, "damage_visible"), yes = num(policyOf(ctx)?.damage_yes);
        return kind?.value === "none_visible" && num(damage?.value) !== null && yes !== null && damage.value >= yes
          ? `damage_kind is none_visible but damage_visible is ${two(damage.value)} (at or above ${two(yes)}).` : null;
      } },
    { id: "severity_vs_damage", kind: "diagnostic", scope: "list", label: "Severity at least 1 while damage reads below the retake cut", severity: "advice",
      check: (items, ctx) => {
        const severity = byId(items, "severity"), damage = byId(items, "damage_visible"), no = num(policyOf(ctx)?.damage_no);
        return num(severity?.value) !== null && severity.value >= 1 && num(damage?.value) !== null && no !== null && damage.value < no
          ? `severity ${two(severity.value)} but damage_visible ${two(damage.value)} is below ${two(no)}.` : null;
      } },

    { id: "refund_share", kind: "metric", label: "refund as a share of the order total", format: "percent",
      compute: (ctx) => {
        const r = result(ctx), total = num(r?.facts?.total), amount = num(r?.verdict?.amount);
        return r && r.verdict.decision !== "reject" && total && amount !== null ? amount / total : null;
      } },
    { id: "failing_checks", kind: "metric", label: "failing plain-code checks", format: "integer",
      compute: (ctx) => (result(ctx) && Array.isArray(ctx.data.verdict.checks) ? ctx.data.verdict.checks.filter((check) => !check.ok).length : null) },
    { id: "box_area", kind: "metric", label: "raw box area as a share of the photo", format: "percent", help: "The edges Jev returned, before the policy hides or pads them.",
      compute: (ctx) => boxArea(byId(ctx.items(), "damage_box")?.box || null) },
    { id: "box_pixels", kind: "metric", label: "raw box size in pixels", format: "text",
      compute: (ctx) => {
        const box = byId(ctx.items(), "damage_box")?.box, width = num(ctx.data.image?.width), height = num(ctx.data.image?.height);
        return box && width && height ? `${Math.round((box.right - box.left) * width)} × ${Math.round((box.bottom - box.top) * height)} px` : null;
      } },
    { id: "cost_per_thousand", kind: "metric", label: "cost per 1,000 checks at this call's measured cost", format: "usd",
      help: "Projection: arithmetic on one measured call, not spend.",
      compute: (ctx) => { const cost = num(ctx.data.meta?.cost_usd); return cost === null ? null : cost * 1000; } },
    { id: "tokens_per_question", kind: "metric", label: "input tokens per question", format: "number",
      compute: (ctx) => {
        const tokens = num(ctx.data.meta?.input_tokens), count = num(ctx.data.meta?.question_count);
        return tokens !== null && count ? tokens / count : null;
      } },
    { id: "session_approvals", kind: "metric", label: "this session's checks approved when sent", format: "percent",
      help: "Each check as decided under the policy of its time.",
      compute: (ctx) => {
        const history = ctx.data.history || [];
        return history.length ? { value: history.filter((entry) => entry.decided?.decision === "approve").length / history.length,
          detail: `${history.filter((entry) => entry.decided?.decision === "approve").length} of ${history.length}` } : null;
      } },
    { id: "settings_changed", kind: "metric", label: "policy settings changed from the defaults", format: "integer",
      compute: (ctx) => (ctx.data.settings ? ctx.data.changed.length : null) },
    { id: "session_cost", kind: "metric", label: "measured cost of this session's checks", format: "usd",
      compute: (ctx) => {
        const costs = (ctx.data.history || []).map((entry) => num(entry.meta?.cost_usd)).filter((value) => value !== null);
        return costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
      } },

    { id: "decision_summary", kind: "exporter", label: "Decision summary", help: "order, photo name, decision, reasons, checks and the policy in force; no note and no raw answers",
      filename: (ctx) => `claim-${ctx.data.input?.order || "decision"}.txt`,
      build: (ctx) => {
        requireResult(ctx);
        const { verdict, input, policy, labels } = ctx.data;
        const photo = input?.photo ? `${input.photo.source} ${input.photo.name}` : "unknown";
        return [
          `Claim decision for order ${input?.order || ctx.data.facts?.order || "?"} (your own check)`,
          `Photo: ${photo}`,
          `Decision: ${labels.decisions[verdict.decision] || verdict.decision} (${verdict.decision})`,
          verdict.decision === "reject" ? null : `Remedy: ${labels.remedies[verdict.remedy] || verdict.remedy} · $${two(verdict.amount)}`,
          "Reasons:", ...verdict.reasons.map((reason) => `- ${reason}`),
          "Checks (plain code):", ...verdict.checks.map((check) => `- [${check.level}] ${check.label}: ${check.detail}`),
          `Policy in force: ${Object.entries(policy || {}).map(([key, value]) => `${key} ${two(value)}`).join(", ")}`,
        ].filter((line) => line !== null).join("\n") + "\n";
      } },
    { id: "answers_csv", kind: "exporter", label: "Answers as CSV", help: "the answers and top probabilities of your own check",
      filename: "claim-answers.csv", mime: "text/csv",
      build: (ctx) => csvText([["id", "type", "value", "display", "confidence", "top_key", "top_p"],
        ...ctx.shown().map((item) => [item.id, item.type, item.value ?? "", item.display, item.confidence ?? "", item.top?.key ?? "", item.top?.p ?? ""])]) },
    { id: "policy_json", kind: "exporter", label: "Policy in force as JSON", help: "settings only", filename: "claims-policy.json", mime: "application/json",
      build: (ctx) => {
        if (!ctx.data.policy) throw new Error("Check a claim first: no decision has a policy yet.");
        return `${JSON.stringify(ctx.data.policy, null, 2)}\n`;
      } },
    { id: "checks_markdown", kind: "exporter", label: "Plain-code checks as a Markdown table", help: "the checks of the shown decision",
      filename: "claim-checks.md", mime: "text/markdown",
      build: (ctx) => {
        requireResult(ctx);
        return `${formatMarkdownTable(["check", "result", "detail"], ctx.data.verdict.checks.map((check) => [check.label, check.level, check.detail]))}\n`;
      } },
    { id: "session_csv", kind: "exporter", label: "This session's checks as CSV", help: "inputs including the customer's notes, the decision when sent and the measured cost; no answers",
      filename: "claims-session.csv", mime: "text/csv",
      build: (ctx) => csvText([["call", "order", "example", "photo", "note", "decision_when_sent", "amount_when_sent", "model", "cost_usd"],
        ...(ctx.data.history || []).map((entry) => [entry.call, entry.order, entry.example || "", entry.photo ? `${entry.photo.source}: ${entry.photo.name}` : "",
          entry.note, entry.decided?.decision || "", num(entry.decided?.amount) === null ? "" : two(entry.decided.amount), entry.meta?.model || "", entry.meta?.cost_usd ?? ""])]) },

    { id: "cover_refund", kind: "command", title: "Raise the automatic limit to cover this refund", group: "Claims policy",
      when: (ctx) => {
        const amount = num(ctx.data.verdict?.amount), limit = num(ctx.data.settings?.auto_limit_usd);
        return amount !== null && limit !== null && amount > limit && Math.ceil(amount / 5) * 5 <= 400;
      },
      run: (ctx) => {
        const next = Math.ceil(ctx.data.verdict.amount / 5) * 5;
        ctx.actions.setPolicy({ auto_limit_usd: next });
        ctx.env?.toast?.(`Automatic approval limit set to $${next}. The decision is re-made by plain code, with no Jev call.`);
      } },
    { id: "focus_damage_slider", kind: "command", title: "Focus the damage threshold slider", group: "Claims policy",
      run: (ctx) => ctx.actions.focusPolicy("damage_yes") },

    { id: "box_to_pixels", kind: "tool", title: "Box edges to pixels", group: "Claims", help: "Turns a Box's edge fractions into pixel positions for a picture of the size you give.",
      inputs: [
        { name: "left", label: "Left edge (0–1)", type: "number", min: 0, max: 1 },
        { name: "top", label: "Top edge (0–1)", type: "number", min: 0, max: 1 },
        { name: "right", label: "Right edge (0–1)", type: "number", min: 0, max: 1 },
        { name: "bottom", label: "Bottom edge (0–1)", type: "number", min: 0, max: 1 },
        { name: "width", label: "Picture width (px)", type: "integer", min: 1 },
        { name: "height", label: "Picture height (px)", type: "integer", min: 1 },
      ],
      compute: ({ left, top, right, bottom, width, height }) => {
        if (right <= left || bottom <= top) throw new Error("The right and bottom edges must be past the left and top edges.");
        return [["left px", Math.round(left * width)], ["top px", Math.round(top * height)], ["width px", Math.round((right - left) * width)],
          ["height px", Math.round((bottom - top) * height)], ["share of the picture", (right - left) * (bottom - top)]];
      } },
  ],
});
