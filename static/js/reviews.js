import {
  answerCard, api, barRow, callStats, choiceBars, debounce, h, handleError, icon, initChrome, inspect, mount, statusBadge,
  toast,
} from "./common.js";

const S = { setup: null, review: null, result: null, policy: {}, policyRev: 0, running: false, note2: "" };

const TOPIC_LABELS = {
  roast_flavor: "Roast and flavor", freshness: "Freshness", packaging_shipping: "Packaging and shipping",
  delivery_timing: "Delivery timing", cafe_service: "Café service", subscription_billing: "Subscription and billing",
  equipment: "Equipment", other: "Other",
};
const FLAG_LABELS = { safety: "Safety risk", not_about_us: "Not about us", rating_mismatch: "Stars disagree with words" };
const PRIORITY_TONE = { P1: "critical", P2: "warning", P3: "" };
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

async function boot() {
  await initChrome("/reviews");
  S.setup = await api("/api/reviews/setup");
  S.policy = { ...S.setup.policy };
  useExample(S.setup.examples[0]);
  renderPolicy();
}

function useExample(ex) {
  S.review = { stars: ex.stars, channel: ex.channel, about: ex.about || "", text: ex.text };
  S.result = null;
  renderForm();
  renderResult();
}

// The answers belong to the words they were asked about, so editing the text, channel, or subject clears them.
// The stars never reach Jev, so changing them re-decides from the same answers.
function edited(key, value) {
  S.review[key] = value;
  if (S.result) { S.result = null; renderResult(); }
}

// ---------- review form ----------
function renderForm() {
  const r = S.review;
  const starSelect = h("select", { class: "input", "aria-label": "Stars", disabled: S.running },
    [5, 4, 3, 2, 1].map((n) => h("option", { value: n, selected: n === r.stars }, `${stars(n)} ${n}`)));
  starSelect.addEventListener("change", () => {
    r.stars = Number(starSelect.value);
    if (S.result) { S.result.review.stars = r.stars; S.policyRev++; decideAgain(); }
  });
  const channel = h("select", { class: "input", "aria-label": "Channel", disabled: S.running },
    Object.entries(S.setup.channels).map(([k, label]) => h("option", { value: k, selected: k === r.channel }, label)));
  channel.addEventListener("change", () => edited("channel", channel.value));
  const about = h("input", { class: "input", value: r.about, placeholder: "A product or café (optional)", maxlength: 200, disabled: S.running });
  about.addEventListener("input", () => edited("about", about.value));
  const text = h("textarea", { class: "input", placeholder: "What the reviewer wrote", maxlength: 2000, disabled: S.running }, r.text);
  text.addEventListener("input", () => edited("text", text.value));

  const run = h("button", { class: "btn primary", id: "run", disabled: S.running },
    S.running ? [h("span", { class: "spin" }), " Reading…"] : [icon("eye"), "Triage review"]);
  run.addEventListener("click", check);

  mount("#review-form",
    h("div", { class: "chips" }, S.setup.examples.map((ex) => h("button", { class: "chip", disabled: S.running, onclick: () => useExample(ex) }, ex.label))),
    h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", {}, "Stars"), starSelect),
      h("label", { class: "field" }, h("span", {}, "Channel"), channel)),
    h("label", { class: "field" }, h("span", {}, "About"), about),
    h("label", { class: "field" }, h("span", {}, "Review"), text),
    run);
}

// ---------- the call ----------
async function check() {
  if (!S.review.text.trim()) return toast("Write or pick a review first.");
  const rev = S.policyRev;
  S.running = true;
  renderForm();
  try {
    S.result = await api("/api/reviews/check", { review: { ...S.review }, policy: S.policy });
    S.note2 = "";
    // A slider or the stars moved while the call ran: decide again with the current settings before showing anything.
    if (S.policyRev !== rev) {
      S.result.review.stars = S.review.stars;
      await decideAgain();
    } else renderResult();
  } catch (e) { handleError(e); } finally {
    S.running = false;
    renderForm();
  }
}

// ---------- result ----------
function checkRow(c) {
  const cls = c.ok ? "ok" : c.level === "escalate" ? "blk" : c.level === "moderate" || c.level === "info" ? "info" : "no";
  const ic = c.ok ? "check" : c.level === "escalate" ? "alert" : c.level === "moderate" ? "eye" : c.level === "info" ? "minus" : "hand";
  return h("div", { class: "check" }, h("span", { class: cls }, icon(ic)), h("div", {}, h("b", {}, c.label), " ", h("span", { class: "muted" }, c.detail)));
}

function renderResult() {
  const r = S.result;
  if (!r) return mount("#result", h("div", { class: "empty" }, "Pick or write a review and triage it. One call answers every question at once."));
  const t = r.triage;
  const ev = t.evidence;
  const p = r.policy;
  const legend = (qid, value) => (r.answers[qid]?.legend || {})[String(Math.round(value))] || "";

  mount("#result",
    h("div", { class: "panel-head" }, icon("eye"), h("h2", {}, "Review decision"), h("div", { class: "spacer" }),
      callStats(r.meta, () => inspect(r.trace, "Reviews · one Jev request"))),
    h("div", { class: "panel-body grid", style: { gap: "16px" } },
      h("div", { class: "decision" },
        statusBadge(t.action, t.action_label, "lg"),
        h("span", { class: "team" }, t.team_label),
        h("span", { class: `badge ${PRIORITY_TONE[t.priority] || ""}` }, t.priority),
        t.flags.map((f) => h("span", { class: "badge accent" }, icon("alert"), FLAG_LABELS[f] || f)),
        h("div", { style: { flex: 1 } }),
        h("span", { class: "redecide-note" }, S.note2)),
      h("ul", { class: "reasons" }, t.reasons.map((x) => h("li", {}, x)),
        h("li", {}, t.auto_reply_allowed ? "A public auto-reply is allowed: the thank-you template." : "No public auto-reply.")),
      h("div", { class: "result-grid" },
        h("div", { class: "checks" }, h("div", { class: "section-label" }, "Checks · plain code"), t.checks.map(checkRow)),
        h("div", { class: "grid", style: { gap: "14px" } },
          h("div", {},
            h("div", { class: "section-label" }, "Judgments · Noul"),
            h("div", { class: "bars" },
              barRow("Safety or health risk", ev.safety, { top: ev.safety >= p.safety_at }),
              barRow("About Harbor Coffee Co.", ev.about_us, { top: ev.about_us >= p.about_us_min }),
              barRow("Wants a reply", ev.wants_reply, { top: ev.wants_reply >= p.wants_reply_at }))),
          h("div", {},
            h("div", { class: "section-label" }, `Severity · Score ${ev.severity.toFixed(2)} / 3`),
            h("div", { class: "scale-note" }, legend("severity", ev.severity))),
          h("div", {},
            h("div", { class: "section-label" }, `Tone of the words · Score ${ev.tone.toFixed(2)} / 4`),
            h("div", { class: "scale-note" }, legend("tone", ev.tone)),
            h("div", { class: "scale-note" }, `${stars(ev.stars)} is level ${ev.stars - 1} of 4 · ${ev.rating_gap.toFixed(2)} levels apart`)),
          h("div", {},
            h("div", { class: "section-label" }, "Topic · Choice"),
            choiceBars(r.answers.topic, TOPIC_LABELS, 3)))),
      h("details", {},
        h("summary", { class: "muted", style: { cursor: "pointer", fontSize: "12.5px" } }, `All ${Object.keys(r.answers).length} answers from the one call`),
        h("div", { class: "answers", style: { marginTop: "10px" } },
          Object.entries(r.answers).map(([qid, a]) => answerCard(qid, a, r.trace.request.questions[qid]))))));
}

// ---------- policy: re-decide without a call ----------
function renderPolicy() {
  const slider = (key, label, min, max, step, fmt = (v) => v.toFixed(2)) => {
    const out = h("output", {}, fmt(S.policy[key]));
    const input = h("input", { type: "range", min, max, step, value: S.policy[key], "aria-label": label });
    input.addEventListener("input", () => {
      S.policy[key] = Number(input.value);
      S.policyRev++;
      out.textContent = fmt(S.policy[key]);
      redecide();
    });
    return h("div", { class: "slider" }, h("span", { class: "name" }, label), input, out);
  };
  mount("#policy",
    h("div", { class: "section-label" }, "Judgment thresholds"),
    slider("safety_at", "Escalate a safety risk at P ≥", 0, 1, 0.05),
    slider("about_us_min", "Moderate when about us is below P", 0, 1, 0.05),
    slider("wants_reply_at", "Reviewer wants a reply at P ≥", 0, 1, 0.05),
    h("div", { class: "divider" }),
    h("div", { class: "section-label" }, "Priority and actions"),
    slider("p1_at", "P1 at severity ≥", 0, 3, 0.1, (v) => v.toFixed(1)),
    slider("p2_at", "P2 and a reply at severity ≥", 0, 3, 0.1, (v) => v.toFixed(1)),
    slider("mismatch_gap", "Stars and words disagree at a gap ≥", 0.5, 4, 0.25),
    slider("thank_tone_at", "Thank-you template at tone ≥", 0, 4, 0.1, (v) => v.toFixed(1)),
    h("button", { class: "btn sm ghost", onclick: () => { S.policy = { ...S.setup.policy }; S.policyRev++; renderPolicy(); redecide(); } }, icon("reset"), "Reset to defaults"));
}

// Apply the current policy and stars to the current answers. A response is dropped when the policy or the
// result changed while it was in flight; the newer change has its own request.
async function decideAgain() {
  const r = S.result;
  const rev = S.policyRev;
  if (!r) return;
  try {
    const out = await api("/api/reviews/decide", { answers: r.answers, review: r.review, policy: S.policy });
    if (S.result !== r || S.policyRev !== rev) return;
    Object.assign(r, { triage: out.triage, policy: out.policy });
    S.note2 = `Re-decided in ${out.compute_ms} ms · no Jev call`;
    renderResult();
  } catch (e) { handleError(e); }
}
const redecide = debounce(decideAgain, 120);

boot().catch(handleError);
