// Facts for "autopilot.records" (contract: static/js/lab/surfaces/autopilot.js): Shield verdict details, each world's
// Dispatch plan and outcome, how the two worlds compare, and what each call measured. Every value is read from a call
// the user made in this server run; scenario labels are used only where a label says so. Nothing is re-scored.
import { definePack } from "../../kit.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const verdictOf = (item) => (isObject(item?.shield?.verdict) ? item.shield.verdict : null);
const senderFactOf = (item) => (isObject(item?.shield?.fact) ? item.shield.fact : null);
const sideOf = (item, world) => (isObject(item?.[world]) ? item[world] : null);
const planOf = (item, world = "integrated") => (isObject(sideOf(item, world)?.plan) ? sideOf(item, world).plan : null);
const checksOf = (item, world) => (Array.isArray(planOf(item, world)?.checks) ? planOf(item, world).checks.filter(isObject) : null);
const ran = (item, world) => isObject(sideOf(item, world)?.executed);
const failed = (item, world, ids) => (checksOf(item, world) || []).some((check) => check.ok === false && (!ids || ids.includes(check.id)));
// Legitimate per the scenario labels: labeled, and not an attack.
const legitimate = (item) => isObject(item?.label) && item.label.attack === false;
const NEW_ACCOUNT = "new account from the email";
const SENDER_CHECKS = ["requester_owns_order", "vendor_domain", "sender_attends"];
const HELD = new Set(["needs_you", "approved", "dismissed", "quarantine"]);

// Dollars a world moved for this email: the executed amount, 0 when it ran nothing or the action moves no money.
function moved(item, world) {
  const side = sideOf(item, world);
  if (!side) return null;
  return isObject(side.executed) ? num(side.executed.amount) ?? 0 : 0;
}

function headroom(item) {
  const plan = planOf(item);
  if (!plan || typeof plan.tool !== "string" || plan.tool === "none") return null;
  const confidence = num(plan.confidence), threshold = num(plan.tool_meta?.[plan.tool]?.threshold);
  return confidence === null || threshold === null ? null : confidence - threshold;
}

function toolMargin(item) {
  const ranking = planOf(item)?.tool_ranking;
  if (!Array.isArray(ranking)) return null;
  const probs = ranking.map((entry) => num(entry?.prob)).filter((prob) => prob !== null).sort((a, b) => b - a);
  return probs.length >= 2 ? probs[0] - probs[1] : null;
}

function topDriver(item) {
  const verdict = verdictOf(item);
  if (!verdict || !Array.isArray(verdict.drivers)) return null;
  const id = verdict.drivers[0];
  if (typeof id !== "string" || !id) return "no strong signal";
  const signal = Array.isArray(verdict.signals) ? verdict.signals.find((entry) => entry?.id === id) : null;
  return typeof signal?.label === "string" && signal.label ? signal.label : id;
}

function domainCheck(item) {
  const fact = senderFactOf(item);
  if (!fact) return null;
  if (fact.lookalike_domain === true) return "lookalike";
  if (fact.domain_matches === true) return "matches";
  if (fact.domain_matches === false) return "mismatch";
  return "nothing to verify";
}

function comparison(item) {
  if (!sideOf(item, "integrated") || !sideOf(item, "naive")) return null;
  const a = ran(item, "integrated"), b = ran(item, "naive");
  return a && b ? "both ran" : a ? "only autopilot ran" : b ? "only dispatch alone ran" : "neither ran";
}

export default definePack({
  id: "autopilot-record-facts",
  surface: "autopilot.records",
  title: "Record facts: Shield, plans and calls",
  about: "Filters, sorts and breakdowns over what each processed email's call returned and what both worlds did with it: Shield's harm, rules and sender-domain check, each world's decision, checks and dollars moved, and the call's tokens and model. Values come from your own calls in this server run; the two 'legitimate email' filters use the scenario labels, which Jev never sees.",
  features: [
    // ---------- Shield verdict ----------
    { id: "harm", kind: "fact", type: "number", label: "shield harm score", help: "Shield's harm-if-obeyed score, 0 to 3.", value: (item) => num(verdictOf(item)?.harm) },
    { id: "rules_fired", kind: "fact", type: "number", label: "shield rules fired",
      value: (item) => (Array.isArray(verdictOf(item)?.rules) ? verdictOf(item).rules.length : null) },
    { id: "identity_prob", kind: "fact", type: "number", label: "claimed identity probability", value: (item) => num(senderFactOf(item)?.claimed_identity_prob) },
    { id: "review_margin", kind: "fact", type: "number", label: "risk minus the review threshold",
      help: "Shield's risk minus its review threshold; negative means below it. Plain arithmetic on your verdict.",
      value: (item) => {
        const verdict = verdictOf(item), risk = num(verdict?.risk), bound = num(verdict?.policy?.review_at);
        return risk === null || bound === null ? null : risk - bound;
      } },
    { id: "top_driver", kind: "fact", type: "category", label: "top shield driver", value: topDriver },
    { id: "domain_check", kind: "fact", type: "category", label: "sender domain check",
      help: "Shield's code check of the sender domain against the identity Jev says the email claims.", value: domainCheck },
    { id: "rule_texts", kind: "fact", type: "text", label: "fired rule texts",
      value: (item) => (Array.isArray(verdictOf(item)?.rules) ? verdictOf(item).rules.map((rule) => (typeof rule?.text === "string" ? rule.text : "")).filter(Boolean).join("; ") : "") },

    // ---------- Dispatch plans and outcomes ----------
    { id: "plan_confidence", kind: "fact", type: "number", label: "plan confidence",
      help: "Autopilot's plan confidence: the lowest of the tool's and its gated arguments' probabilities, the number Dispatch compares with the tool's threshold.",
      value: (item) => num(planOf(item)?.confidence) },
    { id: "confidence_headroom", kind: "fact", type: "number", label: "confidence above the tool threshold",
      help: "Autopilot's plan confidence minus the chosen tool's threshold; negative means below the bar. Unavailable when no tool was chosen.", value: headroom },
    { id: "tool_margin", kind: "fact", type: "number", label: "tool choice margin", help: "The chosen tool's probability minus the runner-up's.", value: toolMargin },
    { id: "missing_arguments", kind: "fact", type: "number", label: "missing arguments",
      value: (item) => (Array.isArray(planOf(item)?.missing) ? planOf(item).missing.length : null) },
    { id: "naive_failed_checks", kind: "fact", type: "number", label: "failed checks in dispatch alone",
      value: (item) => (checksOf(item, "naive") ? checksOf(item, "naive").filter((check) => check.ok === false).length : null) },
    { id: "amount_integrated", kind: "fact", type: "number", label: "dollars autopilot moved", value: (item) => moved(item, "integrated") },
    { id: "amount_naive", kind: "fact", type: "number", label: "dollars dispatch alone moved", value: (item) => moved(item, "naive") },
    { id: "processing_order", kind: "fact", type: "number", label: "processing order", help: "1 is the first email processed in this server run.",
      value: (item) => (Number.isInteger(item?.order) ? item.order : null) },
    { id: "new_account", kind: "fact", type: "flag", label: "payment to an account from the email",
      help: "A vendor payment, run in either world or only proposed, bound for the account the email supplied rather than the one on file.",
      value: (item) => ["integrated", "naive"].some((world) => sideOf(item, world)?.executed?.destination === NEW_ACCOUNT)
        || (planOf(item)?.tool === "pay_vendor" && sideOf(item, "integrated")?.context?.destination === NEW_ACCOUNT) },
    { id: "sender_check_failed", kind: "fact", type: "flag", label: "failed sender check", value: (item) => failed(item, "integrated", SENDER_CHECKS) },
    { id: "photo_check_failed", kind: "fact", type: "flag", label: "failed photo check", value: (item) => failed(item, "integrated", ["photo_evidence"]) },
    { id: "blocking_check", kind: "fact", type: "flag", label: "blocking policy check in either world",
      value: (item) => ["integrated", "naive"].some((world) => (checksOf(item, world) || []).some((check) => check.ok === false && check.level === "block")) },
    { id: "integrated_decision", kind: "fact", type: "category", label: "autopilot decision", value: (item) => planOf(item)?.decision ?? null },
    { id: "naive_decision", kind: "fact", type: "category", label: "dispatch-alone decision", value: (item) => planOf(item, "naive")?.decision ?? null },
    { id: "action_kind", kind: "fact", type: "category", label: "autopilot action kind",
      value: (item) => {
        const side = sideOf(item, "integrated");
        if (!side) return null;
        return isObject(side.executed) ? (typeof side.executed.kind === "string" && side.executed.kind ? side.executed.kind : null) : "nothing ran";
      } },
    { id: "executed_text", kind: "fact", type: "text", label: "autopilot action text",
      value: (item) => (typeof sideOf(item, "integrated")?.executed?.text === "string" ? item.integrated.executed.text : "") },
    { id: "first_reason", kind: "fact", type: "text", label: "first autopilot reason",
      value: (item) => (Array.isArray(planOf(item)?.reasons) && typeof planOf(item).reasons[0] === "string" ? planOf(item).reasons[0] : "") },

    // ---------- the two worlds compared ----------
    { id: "legit_held", kind: "fact", type: "flag", label: "legitimate email autopilot held back",
      help: "Per the scenario labels: not an attack, yet Autopilot quarantined it or asked you first (approved and dismissed included).", value: (item) => legitimate(item) && HELD.has(item.outcome) },
    { id: "legit_rejected_naive", kind: "fact", type: "flag", label: "legitimate email dispatch alone rejected",
      help: "Per the scenario labels: not an attack, and Dispatch alone rejected it.", value: (item) => legitimate(item) && planOf(item, "naive")?.decision === "reject" },
    { id: "world_comparison", kind: "fact", type: "category", label: "what each world ran", value: comparison },

    // ---------- the call ----------
    { id: "input_tokens", kind: "fact", type: "number", label: "input tokens", value: (item) => num(item?.meta?.input_tokens) },
    { id: "tokens_per_question", kind: "fact", type: "number", label: "input tokens per question",
      value: (item) => {
        const tokens = num(item?.meta?.input_tokens), questions = num(item?.meta?.question_count);
        return tokens === null || !questions ? null : tokens / questions;
      } },
    { id: "model", kind: "fact", type: "category", label: "answering model",
      value: (item) => (typeof item?.meta?.model === "string" && item.meta.model ? item.meta.model : null) },
  ],
});
