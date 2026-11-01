import {
  answerCard, api, barRow, callStats, choiceBars, currentStatus, debounce, h, handleError, icon, initChrome, inspect,
  mount, money, openSettings, pct, photoView, prepareImage, statusBadge, toast,
} from "./common.js";

const S = { setup: null, order: "", note: "", image: null, result: null, policy: {}, policyRev: 0, running: false, note2: "" };

const DECISION_LABELS = { approve: "Approve automatically", review: "Send to a person", retake: "Ask for another photo", reject: "Reject claim" };
const KIND_LABELS = {
  torn_or_open: "Torn or open", crushed_or_dented: "Crushed or dented", broken_or_cracked: "Broken or cracked",
  spilled_or_leaking: "Spilled or leaking", none_visible: "None visible",
};

async function boot() {
  await initChrome("/claims");
  S.setup = await api("/api/claims/setup");
  S.policy = { ...S.setup.policy };
  useExample(S.setup.examples[0]);
  renderPolicy();
  renderModelNote();
  window.addEventListener("jev:status", renderModelNote);
}

function useExample(ex) {
  S.order = ex.order;
  S.note = ex.note;
  const sample = S.setup.samples.find((s) => s.name === ex.sample);
  S.image = { sample: sample.name, url: sample.url, about: sample.about };
  S.result = null;
  renderForm();
  renderResult();
}

// ---------- claim form ----------
function renderForm() {
  const orders = S.setup.orders;
  const order = orders.find((o) => o.id === S.order) || orders[0];
  const select = h("select", { class: "input", "aria-label": "Order", disabled: S.running },
    orders.map((o) => h("option", { value: o.id, selected: o.id === order.id }, `${o.id} · ${o.customer} · ${money(o.total)}`)));
  select.addEventListener("change", () => { S.order = select.value; S.result = null; renderForm(); renderResult(); });
  const note = h("textarea", { class: "input", placeholder: "What the customer wrote", disabled: S.running }, S.note);
  // The verdict belongs to the note it was checked with, so editing the note clears it.
  note.addEventListener("input", () => { S.note = note.value; if (S.result) { S.result = null; renderResult(); } });

  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/*", class: "hidden" });
  file.addEventListener("change", () => file.files[0] && useFile(file.files[0]));
  const pick = () => { if (!S.running) file.click(); };
  const drop = h("div", { class: "dropzone", role: "button", tabindex: "0", onclick: pick,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } } },
  icon("upload"), h("span", {}, "Upload or drop a photo"), h("span", { class: "faint", style: { fontSize: "11.5px" } }, "Resized in your browser to fit 280–1568 px"));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) useFile(e.dataTransfer.files[0]); });

  const thumbs = h("div", { class: "thumbs" }, S.setup.samples.map((s) => h("button", {
    class: `thumb${S.image?.sample === s.name ? " active" : ""}`, title: s.about, "aria-label": `Sample: ${s.about}`,
    disabled: S.running,
    onclick: () => { S.image = { sample: s.name, url: s.url, about: s.about }; S.result = null; renderForm(); renderResult(); },
  }, h("img", { src: s.url, alt: "" }))));

  const run = h("button", { class: "btn primary", id: "run", disabled: S.running }, S.running ? [h("span", { class: "spin" }), " Checking…"] : [icon("eye"), "Check claim"]);
  run.addEventListener("click", check);

  mount("#claim-form",
    h("div", { class: "chips" }, S.setup.examples.map((ex) => h("button", { class: "chip", disabled: S.running, onclick: () => useExample(ex) }, ex.label))),
    h("label", { class: "field" }, h("span", {}, "Order"), select),
    h("dl", { class: "order-facts" },
      h("dt", {}, "Items"), h("dd", {}, order.items),
      h("dt", {}, "Customer"), h("dd", {}, order.customer),
      h("dt", {}, "Total"), h("dd", { class: "mono" }, money(order.total)),
      h("dt", {}, "Status"), h("dd", {}, order.status === "delivered" ? `Delivered ${order.days_since_delivery} days ago` : order.status),
      h("dt", {}, "Refunded"), h("dd", {}, order.refunded ? "Yes" : "No")),
    h("label", { class: "field" }, h("span", {}, "Customer's note"), note),
    h("div", { class: "field" }, h("span", {}, "Photo"),
      S.image ? h("div", { class: "picked" }, photoView(S.image.url, [], { alt: S.image.about || S.image.name || "Uploaded photo" }),
        h("div", { class: "faint", style: { fontSize: "11.5px" } }, S.image.sample ? `Sample drawing: ${S.image.about}` : `${S.image.name} · resized to ${S.image.width}×${S.image.height} JPEG`)) : null,
      thumbs, drop, file),
    run);
}

async function useFile(f) {
  try {
    const img = await prepareImage(f);
    S.image = img;
    S.result = null;
    renderForm();
    renderResult();
  } catch (e) { toast(e.message || "Could not read that image.", "error"); }
}

// ---------- the call ----------
async function check() {
  if (!S.image) return toast("Choose a photo first.");
  const submitted = S.image; // the answers belong to this picture, whatever is picked while the call runs
  const rev = S.policyRev;
  S.running = true;
  renderForm();
  try {
    const image = submitted.sample ? { sample: submitted.sample } : { data_base64: submitted.data_base64 };
    S.result = await api("/api/claims/check", { order: S.order, note: S.note, image, policy: S.policy });
    S.resultImage = submitted;
    S.note2 = "";
    // A slider moved while the call ran: decide again with the current policy before showing anything.
    if (S.policyRev !== rev) await decideAgain();
    else renderResult();
  } catch (e) { handleError(e); } finally {
    S.running = false;
    renderForm();
  }
}

// ---------- result ----------
function checkRow(c) {
  const cls = c.ok ? "ok" : c.level === "reject" ? "blk" : c.level === "retake" ? "info" : "no";
  const ic = c.ok ? "check" : c.level === "reject" ? "stop" : c.level === "retake" ? "image" : "hand";
  return h("div", { class: "check" }, h("span", { class: cls }, icon(ic)), h("div", {}, h("b", {}, c.label), " ", h("span", { class: "muted" }, c.detail)));
}

function renderResult() {
  const r = S.result;
  if (!r) return mount("#result", h("div", { class: "empty" }, "Pick a photo and check the claim. One call answers every photo question at once."));
  const v = r.verdict;
  const ev = r.evidence;
  const loc = r.location;
  const boxes = loc.shown
    ? [{ box: loc.box, dashed: loc.padded || loc.tentative, label: `${loc.tentative ? "possible damage" : "damage"} · ${pct(loc.confidence)}` }]
    : [];
  const caption = loc.shown ? (loc.reason || `Box confidence ${pct(loc.confidence)}. Edges are fractions of the image size.`) : loc.reason;
  const remedy = v.remedy === "full_refund" ? "Full refund" : "50% credit or a replacement";
  const severityLevel = Math.round(ev.severity);
  const legend = r.answers.severity?.legend || {};

  mount("#result",
    h("div", { class: "panel-head" }, icon("eye"), h("h2", {}, "Claim decision"), h("div", { class: "spacer" }),
      callStats(r.meta, () => inspect(r.trace, "Claims · one Jev request",
        { uploads: S.resultImage?.data_base64 ? [S.resultImage.data_base64] : [] }))),
    h("div", { class: "panel-body grid", style: { gap: "16px" } },
      h("div", { class: "decision" },
        statusBadge(v.decision, DECISION_LABELS[v.decision], "lg"),
        v.decision === "reject" ? null : h("span", { class: "amount" }, money(v.amount)),
        v.decision === "reject" ? null : h("span", { class: "muted" }, remedy),
        h("div", { style: { flex: 1 } }),
        h("span", { class: "redecide-note" }, S.note2)),
      h("ul", { class: "reasons" }, v.reasons.map((t) => h("li", {}, t))),
      h("div", { class: "result-grid" },
        photoView(S.resultImage.url, boxes, { alt: "Claim photo", caption }),
        h("div", { class: "grid", style: { gap: "14px" } },
          h("div", { class: "checks" }, h("div", { class: "section-label" }, "Checks · plain code"), v.checks.map(checkRow)),
          h("div", {},
            h("div", { class: "section-label" }, "Photo judgments · Noul"),
            h("div", { class: "bars" },
              barRow("Shows the order", ev.shows_item, { top: ev.shows_item >= S.policy.shows_order }),
              barRow("Damage visible", ev.damage, { top: ev.damage >= S.policy.damage_yes }),
              barRow("Matches the note", ev.matches_note, { top: ev.matches_note >= S.policy.matches_note }))),
          h("div", {},
            h("div", { class: "section-label" }, `Severity · Score ${ev.severity.toFixed(2)} / 3`),
            h("div", { class: "muted", style: { fontSize: "12.5px" } }, legend[String(severityLevel)] || "")),
          h("div", {},
            h("div", { class: "section-label" }, "Kind of damage · Choice"),
            choiceBars(r.answers.damage_kind, KIND_LABELS, 3)))),
      h("details", {},
        h("summary", { class: "muted", style: { cursor: "pointer", fontSize: "12.5px" } }, `All ${Object.keys(r.answers).length} answers from the one call`),
        h("div", { class: "answers", style: { marginTop: "10px" } },
          Object.entries(r.answers).map(([qid, a]) => answerCard(qid, a, r.trace.request.questions[qid]))))));
}

function renderModelNote() {
  const st = currentStatus();
  if (!st.configured || st.supports_box) return mount("#model-note");
  mount("#model-note", h("div", { class: "callout" }, icon("alert"),
    h("div", {}, h("b", {}, `${st.model} cannot answer Box questions`),
      h("div", { class: "muted" }, "The photo questions still run, but the damage will not be located. Box needs Jev 1.14 or later. ",
        h("button", { class: "btn sm ghost", onclick: () => openSettings() }, "Change model")))));
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
    h("div", { class: "section-label" }, "Photo thresholds"),
    slider("damage_yes", "Damage visible at P ≥", 0, 1, 0.05),
    slider("damage_no", "Ask for another photo below P", 0, 1, 0.05),
    slider("shows_order", "Photo shows the order at P ≥", 0, 1, 0.05),
    slider("matches_note", "Matches the note at P ≥", 0, 1, 0.05),
    slider("box_confidence", "Pad the box below confidence", 0, 1, 0.05),
    h("div", { class: "divider" }),
    h("div", { class: "section-label" }, "Refund rules"),
    slider("full_refund_at", "Full refund at severity ≥", 0, 3, 0.1),
    slider("auto_limit_usd", "Automatic approval up to", 0, 400, 5, (v) => money(v)),
    h("button", { class: "btn sm ghost", onclick: () => { S.policy = { ...S.setup.policy }; S.policyRev++; renderPolicy(); redecide(); } }, icon("reset"), "Reset to defaults"));
}

// Apply the current policy to the current answers. A response is dropped when the policy or the
// result changed while it was in flight; the newer change has its own request.
async function decideAgain() {
  const r = S.result;
  const rev = S.policyRev;
  if (!r) return;
  try {
    const out = await api("/api/claims/decide", { answers: r.answers, facts: r.facts, policy: S.policy });
    if (S.result !== r || S.policyRev !== rev) return;
    Object.assign(r, { verdict: out.verdict, location: out.location, evidence: out.evidence, policy: out.policy });
    S.note2 = `Re-decided in ${out.compute_ms} ms · no Jev call`;
    renderResult();
  } catch (e) { handleError(e); }
}
const redecide = debounce(decideAgain, 120);

boot().catch(handleError);
