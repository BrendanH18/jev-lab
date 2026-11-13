// Panels for the user's own latest Claims check ("claims.result", contract: static/js/lab/surfaces/claims.js): a Box
// overlay inspector (raw and drawn edges in pixels and fractions), a policy flip-point explorer (which slider move
// changes a rule's side), an evidence card to copy into a ticket, and a table of this session's checks. Flip points
// are plain arithmetic on the policy in force and the sliders' grid: advisory, never Jev's answer and never the page's
// decision; to see a new decision the explorer moves the page's own slider (setPolicy: plain code, no Jev call).
// Pixels use one rounding rule: each product of a fraction and the picture's size is rounded to 6 decimals, the
// left/top edge is floored, the right/bottom edge is ceiled, and both are clamped to the picture. Nothing here holds
// picture bytes; copies say what they hold.
import { definePack } from "../../kit.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const pct0 = (value) => `${Math.round(value * 100)}%`;
const usd = (value) => `$${value.toFixed(2)}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const faint = (h, text) => h("p", { class: "faint" }, text);
const byId = (items, id) => items.find((item) => item?.id === id) || null;
const tsv = (rows) => `${rows.map((row) => row.join("\t")).join("\n")}\n`;
const EDGES = ["left", "top", "right", "bottom"];
const SIGNED = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0");

function edgesOf(box) {
  if (!isObject(box)) return null;
  const out = {};
  for (const edge of EDGES) {
    if (num(box[edge]) === null) return null;
    out[edge] = box[edge];
  }
  return out;
}

const across = (edge) => edge === "left" || edge === "right";
function toPx(fraction, edge, W, H) {
  const size = across(edge) ? W : H;
  const at = Number((fraction * size).toFixed(6));
  return Math.min(size, Math.max(0, edge === "left" || edge === "top" ? Math.floor(at) : Math.ceil(at)));
}
const pxBox = (box, W, H) => Object.fromEntries(EDGES.map((edge) => [edge, toPx(box[edge], edge, W, H)]));
const area = (box) => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);

// What the Box inspector reads: the raw edges, the drawn ones, the picture size and the page's location record.
function boxView(ctx) {
  const item = byId(ctx.items(), "damage_box");
  const raw = edgesOf(item?.box);
  if (!raw) return null;
  const boxPlace = isObject(ctx.data.location) ? ctx.data.location : {};
  const drawn = boxPlace.shown === true ? edgesOf(boxPlace.box) : null;
  const W = num(ctx.data.image?.width), H = num(ctx.data.image?.height);
  return { item, raw, drawn, boxPlace, W: W > 0 ? W : null, H: H > 0 ? H : null };
}

// How far padding was cut short at the picture's border, per edge, as a fraction (0 when it was not).
function clampedBy(view, pad) {
  if (!view.drawn || view.boxPlace.padded !== true) return null;
  return { left: Math.max(0, pad - view.raw.left), top: Math.max(0, pad - view.raw.top),
    right: Math.max(0, view.raw.right + pad - 1), bottom: Math.max(0, view.raw.bottom + pad - 1) };
}

// ---------- flip points ----------

// The slider settings that read an answer (or the refund amount), how each compares, and what a flip changes. pass:
// the rule's side named by its comparison ("base >= at", except auto_limit_usd: "amount <= limit").
const RULES = [
  { key: "damage_yes", reads: "damage_visible", what: "damage visible", sides: ["at or above: counts as visible", "below: not counted as visible"] },
  { key: "damage_no", reads: "damage_visible", what: "damage visible", sides: ["at or above: box shown", "below: box hidden"] },
  { key: "shows_order", reads: "shows_item", what: "photo shows the order", sides: ["passes", "fails"],
    effects: ["Photo shows the order would fail (retake)", "Photo shows the order would pass"] },
  { key: "matches_note", reads: "matches_note", what: "matches the note", sides: ["passes", "fails"],
    effects: ["Matches the customer's description would fail (review)", "Matches the customer's description would pass"] },
  { key: "box_confidence", reads: "damage_box", what: "box confidence", sides: ["drawn as returned", "padded"] },
  { key: "full_refund_at", reads: "severity", what: "severity", sides: ["full refund", "50% credit or a replacement"],
    effects: ["the remedy would switch to a 50% credit or a replacement", "the remedy would switch to a full refund"] },
  { key: "auto_limit_usd", reads: "amount", what: "refund amount", sides: ["within the limit", "over the limit"],
    effects: ["this amount would exceed the automatic limit (review)", "this amount would fit the automatic limit"] },
];
const SLIDER_CHECKS = new Set(["shows_item", "damage", "matches_note", "auto_limit"]);

// What one flip would change, following jev/claims.py: decide() tests damage >= damage_yes before damage < damage_no,
// and located() hides the box below damage_no and pads it below box_confidence (only a drawn box can change).
function effectOf(row, ctx) {
  if (row.rule.effects) return row.rule.effects[row.pass ? 0 : 1];
  const boxPlace = isObject(ctx.data.location) ? ctx.data.location : {};
  const policy = ctx.data.policy || {};
  if (row.rule.key === "box_confidence") {
    return boxPlace.shown !== true ? "nothing visible while the page draws no box" : row.pass ? "the box would be padded" : "the box would be drawn as returned";
  }
  const damage = row.base, yes = num(policy.damage_yes), no = num(policy.damage_no);
  const visible = yes !== null && damage >= yes, aboveNo = no === null || damage >= no;
  const hasBox = edgesOf(byId(ctx.items(), "damage_box")?.box) !== null;
  const parts = [];
  if (row.rule.key === "damage_yes") {
    if (row.pass) {
      parts.push(aboveNo ? "the damage check would go to a person (review)" : "the damage check would ask for another photo (retake)");
      if (boxPlace.shown === true && !boxPlace.tentative) parts.push("the box would turn tentative");
    } else {
      parts.push("the damage check would pass");
      if (boxPlace.shown === true && boxPlace.tentative) parts.push("the box would stop being tentative");
    }
  } else {
    if (hasBox) parts.push(row.pass ? "the box would be hidden" : "the box would be shown");
    if (!visible) parts.push(row.pass ? "the damage check would ask for another photo (retake)" : "the damage check would go to a person (review)");
  }
  return parts.length ? parts.join(", and ") : "nothing visible";
}

// The slider value at which the rule changes sides, or null outside the slider.
function flipOf(rule, base, at, limit) {
  if (!limit || !(num(limit.step) > 0)) return null;
  const { min, max, step } = limit;
  let steps;
  if (rule.key === "auto_limit_usd") {
    const ceil = Math.ceil((base - min) / step - 1e-9);
    steps = base <= at ? ceil - 1 : ceil;
  } else steps = Math.floor((base - min) / step + 1e-9) + (base >= at ? 1 : 0);
  const next = Number((min + steps * step).toFixed(2));
  return next < min - 1e-9 || next > max + 1e-9 ? null : next;
}

// One row per slider reading the shown check: { rule, label, base, at, pass, flip, steps }, in slider order.
function flipRows(ctx) {
  const policy = ctx.data.policy, verdict = ctx.data.verdict, limits = ctx.data.limits || {};
  if (!policy || !verdict || !ctx.items().length) return [];
  return RULES.flatMap((rule) => {
    const at = num(policy[rule.key]), limit = limits[rule.key];
    if (at === null || !limit) return [];
    const item = rule.reads === "amount" ? null : byId(ctx.items(), rule.reads);
    const base = rule.reads === "amount" ? num(verdict.amount) : rule.reads === "damage_box" ? num(item?.confidence) : num(item?.value);
    if (base === null || (rule.reads === "amount" && verdict.decision === "reject")) return [];
    const pass = rule.key === "auto_limit_usd" ? base <= at : base >= at;
    const flip = flipOf(rule, base, at, limit);
    return [{ rule, label: limit.label, base, at, pass, flip, steps: flip === null ? null : Math.round(Math.abs(flip - at) / limit.step) }];
  });
}

const showValue = (row) => (row.rule.reads === "amount" ? usd(row.base) : row.rule.reads === "severity" ? row.base.toFixed(2) : pct0(row.base));
const showSetting = (key, value) => (key === "auto_limit_usd" ? `$${value}` : String(value));

// ---------- the session table ----------

// The identity of a claim: order, trimmed note and SAMPLE photo. An upload is known only by its file name, which two
// different pictures can share, so each upload check counts as its own claim (null here; callers use its index).
const claimKey = (entry) => (entry?.photo?.source !== "sample" ? null
  : JSON.stringify([entry.order, String(entry.note || "").trim(), entry.photo.name || ""]));
const claimKeys = (history) => history.map((entry, index) => claimKey(entry) ?? `upload#${index}`);
const samePolicy = (a, b) => isObject(a) && isObject(b) && Object.keys(b).every((key) => num(a[key]) !== null && Math.abs(a[key] - b[key]) <= 1e-9);
const rawNumber = (answer) => (!isObject(answer) ? null : answer.type === "noul" ? num(answer.noul) : answer.type === "score" ? num(answer.score) : null);
const SORTS = { call: (entry) => num(entry.call), amount: (entry) => num(entry.decided?.amount), latency: (entry) => num(entry.meta?.latency_ms),
  cost: (entry) => num(entry.meta?.cost_usd) };
const ANSWER_COLUMNS = ["shows_item", "damage_visible", "matches_note", "severity"];

// The shown result is the newest check (any change of order, note or photo clears it), so it is the last entry when
// that entry was made for the shown input.
function shownIndex(ctx) {
  const input = ctx.data.input, history = Array.isArray(ctx.data.history) ? ctx.data.history : [];
  const last = history[history.length - 1];
  if (!input || !last) return -1;
  const same = last.order === input.order && String(last.note ?? "") === String(input.note ?? "")
    && last.photo?.source === input.photo?.source && last.photo?.name === input.photo?.name;
  return same ? history.length - 1 : -1;
}

function sessionRows(ctx) {
  const history = Array.isArray(ctx.data.history) ? ctx.data.history : [];
  const seen = new Map(), keys = claimKeys(history);
  return history.map((entry, index) => {
    const key = keys[index];
    const nth = (seen.get(key) || 0) + 1;
    seen.set(key, nth);
    return { entry, index, nth, claim: entry.example || (entry.photo ? `${entry.photo.source === "upload" ? "upload " : ""}${entry.photo.name}` : "") };
  });
}

export default definePack({
  id: "claims-panels",
  surface: "claims.result",
  title: "Claim panels",
  about: "Panels for your own latest Claims check: the Box drawn over the photo with its raw and drawn edges in pixels and fractions, the "
    + "slider values where each policy rule would change sides, an evidence card to copy, and a table of this session's checks. Flip points "
    + "are advisory arithmetic; slider moves re-decide by plain code with no Jev call, and nothing holds picture bytes.",
  features: [
    // ---------- Box overlay inspector ----------
    { id: "box_inspector", kind: "panel", title: "Box overlay inspector",
      improvements: [
        { id: "raw_edges", title: "Show the raw Box edges Jev returned as fractions and as pixels of the picture" },
        { id: "drawn_edges", title: "Show the edges of the box the page draws, as fractions and pixels, with whether it is padded or tentative" },
        { id: "shift", title: "Show how many pixels padding moved each edge from the raw box" },
        { id: "clamp", title: "Say which edges padding pushed past the picture's border and by how many pixels" },
        { id: "hidden", title: "Say when the policy hides the box, while still showing the raw edges" },
        { id: "schematic", title: "Draw the raw and drawn boxes inside the picture's frame, without the picture" },
        { id: "copy", title: "Copy the raw and drawn edges as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        if (!ctx.items().length) return faint(h, "Check a claim first to inspect its Box.");
        const view = boxView(ctx);
        if (!view) return faint(h, "This check has no Box answer: the model answers Box questions from Jev 1.14 on.");
        const { raw, drawn, boxPlace, W, H } = view;
        const px = W && H;
        const rawPx = px ? pxBox(raw, W, H) : null, drawnPx = px && drawn ? pxBox(drawn, W, H) : null;
        const pad = num(ctx.data.rules?.box_pad) ?? 0.05;
        const clamp = clampedBy(view, pad);
        const clamped = clamp ? EDGES.filter((edge) => clamp[edge] > 1e-9) : [];
        const state = drawn ? `Drawn ${boxPlace.padded ? "padded" : "as returned"}${boxPlace.tentative ? ", tentative" : ""}.` : null;
        const frameW = px ? W : 1, frameH = px ? H : 1;
        const svgNum = (value) => String(Number(value.toFixed(3)));
        const rect = (name, box, extra = {}) => h("rect", { "data-rect": name, x: svgNum(box.left * frameW), y: svgNum(box.top * frameH),
          width: svgNum((box.right - box.left) * frameW), height: svgNum((box.bottom - box.top) * frameH), fill: "none", ...extra });
        const copy = () => api.copy(tsv([["edge", "raw fraction", "raw px", "drawn fraction", "drawn px"],
          ...EDGES.map((edge) => [edge, raw[edge], rawPx ? rawPx[edge] : "", drawn ? drawn[edge] : "", drawnPx ? drawnPx[edge] : ""])]));
        return h("div", {},
          faint(h, `Your own check's Box, in a ${px ? `${W} × ${H}` : "picture of unknown"} picture. Pixels: left and top floored, right and bottom ceiled. Coordinates only, never the picture.`),
          drawn ? h("p", { "data-part": "state" }, state)
            : h("p", { "data-part": "hidden" }, `Hidden by the policy${boxPlace.reason ? ` (${String(boxPlace.reason).replace(/\.$/, "")})` : ""}: the page draws no box. The raw edges below are what Jev returned.`),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Edge", "Raw", "Raw px", "Drawn", "Drawn px", "Moved px"].map((label) => h("th", {}, label)))),
            h("tbody", {}, EDGES.map((edge) => h("tr", { "data-edge": edge }, h("td", {}, edge),
              h("td", { class: "num" }, raw[edge].toFixed(4)), h("td", { class: "num" }, rawPx ? String(rawPx[edge]) : "—"),
              h("td", { class: "num" }, drawn ? drawn[edge].toFixed(4) : "—"), h("td", { class: "num" }, drawnPx ? String(drawnPx[edge]) : "—"),
              h("td", { class: "num", "data-shift": edge }, drawnPx ? SIGNED(drawnPx[edge] - rawPx[edge]) : "—"))))),
          clamp ? h("p", { "data-part": "clamp" }, clamped.length
            ? `Padding reached the picture's border: ${clamped.map((edge) => `${edge} edge cut short by ${clamp[edge].toFixed(4)}${px ? ` (${Math.round(Number((clamp[edge] * (across(edge) ? W : H)).toFixed(6)))} px)` : ""}`).join(", ")}.`
            : "Padding stayed inside the picture on every side.") : null,
          h("svg", { "data-part": "schematic", viewBox: `0 0 ${frameW} ${frameH}`, role: "img", "aria-label": "The raw and drawn boxes in the picture's frame" },
            h("rect", { "data-rect": "frame", x: "0", y: "0", width: String(frameW), height: String(frameH), fill: "none" }),
            rect("raw", raw, { stroke: "currentColor" }),
            drawn ? rect("drawn", drawn, { stroke: "currentColor", "stroke-dasharray": boxPlace.padded || boxPlace.tentative ? "6 4" : "none" }) : null),
          h("button", { class: "btn sm ghost", "data-copy": "edges", onclick: copy }, "Copy edges"));
      } },

    // ---------- policy flip points ----------
    { id: "flip_explorer", kind: "panel", title: "Policy flip points (advisory)",
      improvements: [
        { id: "table", title: "List every slider with the answer or amount its rule reads, its side and the slider value where it flips" },
        { id: "effect", title: "Say what each flip would change: a check's result, the remedy, or how the box is drawn" },
        { id: "locked", title: "Name failing checks no slider reads, so no slider move can make them pass" },
        { id: "try", title: "Move a slider to its flip value, re-decided by plain code with no Jev call" },
        { id: "put_back", title: "Put a tried slider back to the value it had before" },
        { id: "drift", title: "Show sliders that differ from the policy the shown decision used" },
      ],
      render: (h, ctx, api) => {
        const rows = flipRows(ctx);
        if (!rows.length) return faint(h, "Check a claim first to see where each policy rule would change sides.");
        const failing = (Array.isArray(ctx.data.verdict.checks) ? ctx.data.verdict.checks : []).filter((check) => check && check.ok === false && !SLIDER_CHECKS.has(check.id));
        const policy = ctx.data.policy, settings = ctx.data.settings;
        const drift = settings ? RULES.filter((rule) => num(settings[rule.key]) !== null && num(policy[rule.key]) !== null && Math.abs(settings[rule.key] - policy[rule.key]) > 1e-9) : [];
        const before = isObject(api.state.before) ? api.state.before : null;
        const move = (key, value, remember) => {
          try {
            ctx.actions.setPolicy({ [key]: value });
            api.state.before = remember;
            api.toast(`${key} moved to ${showSetting(key, value)}. The page re-decides by plain code, with no Jev call.`);
          } catch (error) { api.toast(error.message, "error"); }
          api.redraw();
        };
        return h("div", {},
          faint(h, "Plain arithmetic on the policy in force and each slider's steps: where one rule would change sides, with every other setting as it is. The page's decision stays the decision."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Slider", "In force", "Reads", "Side", "Flips at", "Steps", "Would change", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-slider": row.rule.key },
              h("td", {}, row.label), h("td", { class: "num" }, showSetting(row.rule.key, row.at)),
              h("td", {}, `${row.rule.what} ${showValue(row)}`), h("td", { "data-side": "" }, row.rule.sides[row.pass ? 0 : 1]),
              h("td", { class: "num", "data-flip": "" }, row.flip === null ? "outside the slider" : showSetting(row.rule.key, row.flip)),
              h("td", { class: "num" }, row.steps === null ? "—" : String(row.steps)),
              h("td", { "data-effect": "" }, row.flip === null ? "—" : effectOf(row, ctx)),
              h("td", {}, row.flip === null ? null : h("button", { class: "btn sm ghost", "data-try": row.rule.key,
                onclick: () => move(row.rule.key, row.flip, { key: row.rule.key, value: num(settings?.[row.rule.key]) ?? row.at }) }, "Try")))))),
          failing.length ? h("p", { "data-part": "locked" }, `No slider reads ${failing.length === 1 ? "this failing check" : "these failing checks"}: ${failing.map((check) => `${check.label} (${check.level}: ${check.detail})`).join("; ")}. No slider move makes ${failing.length === 1 ? "it" : "them"} pass.`) : null,
          drift.length ? h("p", { "data-part": "drift" }, `The sliders differ from the policy the shown decision used: ${drift.map((rule) => `${rule.key} ${showSetting(rule.key, settings[rule.key])} now, ${showSetting(rule.key, policy[rule.key])} in force`).join("; ")}. A re-decide may be on its way.`) : null,
          before ? h("button", { class: "btn sm", "data-action": "put-back", onclick: () => move(before.key, before.value, null) }, `Put ${before.key} back to ${showSetting(before.key, before.value)}`) : null);
      } },

    // ---------- evidence card ----------
    { id: "evidence_card", kind: "panel", title: "Evidence card",
      improvements: [
        { id: "lines", title: "Summarize each answer against the policy cut it meets, with the page's check result" },
        { id: "decision", title: "Add the page's decision, remedy, amount and reasons to the card" },
        { id: "note", title: "Include the customer's note in the card only when asked" },
        { id: "copy_text", title: "Copy the evidence card as plain text for a ticket" },
        { id: "copy_markdown", title: "Copy the evidence card as Markdown" },
      ],
      render: (h, ctx, api) => {
        const items = ctx.items(), verdict = ctx.data.verdict, policy = ctx.data.policy || {};
        if (!items.length || !verdict) return faint(h, "Check a claim first to build its evidence card.");
        const labels = ctx.data.labels || {};
        const checkWord = (item) => (!item?.check ? "" : item.check.ok ? " — passes" : ` — fails (${item.check.level})`);
        const at = (key) => (num(policy[key]) === null ? "?" : key === "full_refund_at" ? policy[key].toFixed(2) : pct0(policy[key]));
        const lines = [];
        const shows = byId(items, "shows_item"), damage = byId(items, "damage_visible"), matches = byId(items, "matches_note");
        const severity = byId(items, "severity"), kind = byId(items, "damage_kind"), box = byId(items, "damage_box");
        if (num(shows?.value) !== null) lines.push(["shows_item", `Photo shows the order: ${pct0(shows.value)} (cut ${at("shows_order")})${checkWord(shows)}`]);
        if (num(damage?.value) !== null) lines.push(["damage", `Damage visible: ${pct0(damage.value)} (approve at ${at("damage_yes")}, retake below ${at("damage_no")})${checkWord(damage)}`]);
        if (num(matches?.value) !== null) lines.push(["matches_note", `Matches the note: ${pct0(matches.value)} (cut ${at("matches_note")})${checkWord(matches)}`]);
        if (num(severity?.value) !== null) {
          const word = String(severity.label || "").split(":")[0].trim();
          lines.push(["severity", `Severity: ${severity.value.toFixed(2)} of ${severity.scale ?? "?"}${word ? `, ${word}` : ""} (full refund at ${at("full_refund_at")})`]);
        }
        if (kind && Array.isArray(kind.probabilities) && kind.probabilities.length) {
          const top = [...kind.probabilities].sort((a, b) => b.p - a.p).slice(0, 3);
          lines.push(["kind", `Damage kind: ${top.map((entry) => `${labels.kinds?.[entry.key] || String(entry.key).replace(/_/g, " ")} ${pct0(entry.p)}`).join(", ")}`]);
        }
        const boxPlace = ctx.data.location;
        lines.push(["box", !box ? "Damage box: not answered (Jev 1.14+ needed)"
          : boxPlace?.shown ? `Damage box: drawn${boxPlace.padded ? ", padded" : ""}${boxPlace.tentative ? ", tentative" : ""}, confidence ${num(box.confidence) === null ? "?" : pct0(box.confidence)}`
            : "Damage box: hidden by the policy"]);
        const decision = [`Decision: ${labels.decisions?.[verdict.decision] || verdict.decision}${verdict.decision === "reject" ? ""
          : ` · ${labels.remedies?.[verdict.remedy] || verdict.remedy} · ${num(verdict.amount) === null ? "?" : usd(verdict.amount)}`}`,
          ...(Array.isArray(verdict.reasons) && verdict.reasons.length ? [`Why: ${verdict.reasons.join("; ")}`] : [])];
        const withNote = api.state.note === true;
        const note = withNote && typeof ctx.data.input?.note === "string" ? ctx.data.input.note.trim() : null;
        const order = ctx.data.input?.order || ctx.data.facts?.order || "?";
        const title = `Claim evidence for order ${order} (your own check: answers and decision${note !== null ? ", customer's note" : ""}; no picture)`;
        const body = [...lines.map(([, text]) => text), ...decision, ...(note !== null ? [`Customer's note: ${note || "(blank)"}`] : [])];
        return h("div", {},
          h("ul", {}, lines.map(([key, text]) => h("li", { "data-line": key }, text))),
          h("p", { "data-part": "decision" }, decision.join(" · ")),
          note !== null ? h("p", { "data-part": "note" }, `Customer's note: ${note || "(blank)"}`) : null,
          h("label", {}, h("input", { type: "checkbox", "data-control": "note", checked: withNote,
            onchange: (event) => { api.state.note = event.target.checked === true; api.redraw(); } }), " Include the customer's note"),
          h("button", { class: "btn sm ghost", "data-copy": "text", onclick: () => api.copy(`${title}\n${body.join("\n")}\n`) }, "Copy as text"),
          h("button", { class: "btn sm ghost", "data-copy": "markdown", onclick: () => api.copy(`## ${title}\n\n${body.map((line) => `- ${line}`).join("\n")}\n`) }, "Copy as Markdown"));
      } },

    // ---------- this session's checks ----------
    { id: "session_table", kind: "panel", title: "This session's checks",
      improvements: [
        { id: "table", title: "List this session's answered checks with order, claim, decision when sent, amount, model, latency and cost" },
        { id: "shown", title: "Mark the check whose result is shown now" },
        { id: "repeats", title: "Mark repeat checks of the same order, note and sample photo" },
        { id: "other_policy", title: "Mark checks decided under sliders other than the ones now" },
        { id: "sort", title: "Sort the session's checks by call, amount, latency or cost" },
        { id: "filter", title: "Show only the session's checks with one decision" },
        { id: "answers", title: "Add the yes probabilities and severity of each check as columns" },
        { id: "totals", title: "Total the listed checks' count, measured cost and mean latency" },
        { id: "copy", title: "Copy the listed checks as tab-separated text, without notes" },
      ],
      render: (h, ctx, api) => {
        const all = sessionRows(ctx);
        if (!all.length) return faint(h, "No answered checks in this page session yet.");
        const labels = ctx.data.labels?.decisions || {};
        const shown = shownIndex(ctx), settings = ctx.data.settings;
        const decisions = [...new Set(all.map((row) => row.entry.decided?.decision).filter(Boolean))];
        const filter = decisions.includes(api.state.decision) ? api.state.decision : "all";
        const sort = isObject(api.state.sort) && SORTS[api.state.sort.key] ? api.state.sort : { key: "call", dir: "asc" };
        const withAnswers = api.state.answers === true;
        const value = SORTS[sort.key];
        const rows = all.filter((row) => filter === "all" || row.entry.decided?.decision === filter).sort((a, b) => {
          const x = value(a.entry), y = value(b.entry);
          if (x === null || y === null) return x === y ? a.index - b.index : x === null ? 1 : -1;
          return (x - y) * (sort.dir === "desc" ? -1 : 1) || a.index - b.index;
        });
        const answer = (entry, id) => {
          const v = rawNumber(entry.answers?.[id]);
          return v === null ? "" : id === "severity" ? v.toFixed(2) : pct0(v);
        };
        const cells = (row) => {
          const { entry } = row;
          return [entry.call ?? "", entry.order, row.claim, entry.decided?.decision || "", num(entry.decided?.amount) === null ? "" : usd(entry.decided.amount),
            entry.meta?.model || "", num(entry.meta?.latency_ms) === null ? "" : `${Math.round(entry.meta.latency_ms)} ms`,
            num(entry.meta?.cost_usd) === null ? "" : `$${entry.meta.cost_usd.toFixed(6)}`, ...(withAnswers ? ANSWER_COLUMNS.map((id) => answer(entry, id)) : [])];
        };
        const costs = rows.map((row) => num(row.entry.meta?.cost_usd)).filter((v) => v !== null);
        const latencies = rows.map((row) => num(row.entry.meta?.latency_ms)).filter((v) => v !== null);
        const header = ["#", "Order", "Claim", "Decision when sent", "Amount", "Model", "Latency", "Cost", ...(withAnswers ? ANSWER_COLUMNS : []), ""];
        const sortButton = (key, label) => h("button", { class: "btn sm ghost", "data-sort": key, "aria-pressed": sort.key === key ? "true" : "false",
          onclick: () => { api.state.sort = { key, dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc" }; api.redraw(); } },
        `${label}${sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}`);
        const copy = () => api.copy(tsv([["call", "order", "claim", "decision_when_sent", "amount", "model", "latency", "cost", ...(withAnswers ? ANSWER_COLUMNS : [])], ...rows.map(cells)]));
        return h("div", {},
          faint(h, "Your own checks of this page session, each decided under the sliders of its time; earlier checks are not the shown result."),
          h("div", { class: "row" }, "Sort: ", sortButton("call", "Call"), sortButton("amount", "Amount"), sortButton("latency", "Latency"), sortButton("cost", "Cost"),
            h("select", { "data-control": "decision", value: filter, "aria-label": "Decision when sent", onchange: (event) => { api.state.decision = event.target.value; api.redraw(); } },
              [["all", "Every decision"], ...decisions.map((key) => [key, labels[key] || key])].map(([key, label]) => h("option", { value: key, selected: key === filter }, label))),
            h("label", {}, h("input", { type: "checkbox", "data-control": "answers", checked: withAnswers,
              onchange: (event) => { api.state.answers = event.target.checked === true; api.redraw(); } }), " Show answers")),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, header.map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => {
              const marks = [row.index === shown ? "shown now" : null, row.nth > 1 ? `repeat ${row.nth}` : null,
                settings && row.entry.decided?.policy && !samePolicy(row.entry.decided.policy, settings) ? "other sliders" : null].filter(Boolean);
              return h("tr", { "data-call": String(row.entry.call ?? row.index + 1), "data-shown": row.index === shown ? "" : undefined,
                "data-repeat": row.nth > 1 ? String(row.nth) : undefined,
                "data-other-policy": marks.includes("other sliders") ? "" : undefined },
              cells(row).map((cell) => h("td", {}, String(cell))), h("td", {}, marks.join(" · ")));
            }))),
          h("p", { "data-part": "totals" }, `${plural(rows.length, "check")} · measured cost ${costs.length ? `$${costs.reduce((a, b) => a + b, 0).toFixed(6)}` : "—"} · mean latency ${latencies.length ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms` : "—"}`),
          h("button", { class: "btn sm ghost", "data-copy": "session", onclick: copy }, "Copy checks"));
      } },

    // ---------- metrics ----------
    { id: "drawn_box_area", kind: "metric", format: "percent", label: "Drawn box area as a share of the photo",
      help: "The box the page draws, after any padding; unavailable while the policy hides it or the model gave no Box.",
      compute: (ctx) => {
        const view = ctx.items().length ? boxView(ctx) : null;
        return view?.drawn ? { value: area(view.drawn), detail: view.boxPlace.padded ? "padded" : "as returned" } : null;
      } },
    { id: "raw_box_aspect", kind: "metric", format: "number", label: "Raw box aspect ratio (width ÷ height in pixels)",
      help: "The raw box's width over its height, both in pixels of the picture the server sent.",
      compute: (ctx) => {
        const view = ctx.items().length ? boxView(ctx) : null;
        if (!view || !view.W || !view.H) return null;
        const height = (view.raw.bottom - view.raw.top) * view.H;
        return height > 0 ? ((view.raw.right - view.raw.left) * view.W) / height : null;
      } },
    { id: "border_clipped_px", kind: "metric", format: "integer", label: "Padding cut short at the picture's border, in pixels",
      help: "Pixels of padding lost on all four edges because the padded box would leave the picture; 0 when none was.",
      compute: (ctx) => {
        const view = ctx.items().length ? boxView(ctx) : null;
        if (!view || !view.drawn || !view.W || !view.H) return null;
        const clamp = clampedBy(view, num(ctx.data.rules?.box_pad) ?? 0.05);
        if (!clamp) return 0;
        return EDGES.reduce((sum, edge) => sum + Math.round(Number((clamp[edge] * (across(edge) ? view.W : view.H)).toFixed(6))), 0);
      } },
    { id: "rules_one_step", kind: "metric", format: "integer", label: "Policy rules one slider step from flipping (advisory)",
      help: "How many sliders' rules would change sides with a single step of that slider.",
      compute: (ctx) => {
        const rows = flipRows(ctx);
        if (!rows.length) return null;
        const close = rows.filter((row) => row.steps !== null && row.steps <= 1);
        return { value: close.length, detail: close.map((row) => row.rule.key).join(", ") || "none" };
      } },
    { id: "checks_under_sliders", kind: "metric", format: "integer", label: "This session's checks decided under the sliders now",
      help: "Checks of this page session whose decision was made under exactly the policy in the sliders now.",
      compute: (ctx) => {
        const history = ctx.data.history || [], settings = ctx.data.settings;
        if (!history.length || !settings) return null;
        const same = history.filter((entry) => samePolicy(entry.decided?.policy, settings)).length;
        return { value: same, detail: `of ${plural(history.length, "check")}` };
      } },
    { id: "session_mean_latency", kind: "metric", format: "ms", label: "Mean measured latency of this session's checks",
      help: "The server's latency for each answered check of this page session, averaged.",
      compute: (ctx) => {
        const values = (ctx.data.history || []).map((entry) => num(entry.meta?.latency_ms)).filter((value) => value !== null);
        return values.length ? { value: values.reduce((a, b) => a + b, 0) / values.length, detail: `${plural(values.length, "check")}` } : null;
      } },
    { id: "distinct_claims", kind: "metric", format: "integer", label: "Distinct claims checked this session",
      help: "Different combinations of order, note (trimmed) and sample photo among this session's checks; each upload counts as its own claim.",
      compute: (ctx) => {
        const history = Array.isArray(ctx.data.history) ? ctx.data.history : [];
        return history.length ? new Set(claimKeys(history)).size : null;
      } },
    { id: "box_support_share", kind: "metric", format: "percent", label: "This session's checks with a Box answer",
      help: "The share of this session's checks whose model answered the Box question (Jev 1.14 or later).",
      compute: (ctx) => {
        const history = ctx.data.history || [];
        if (!history.length) return null;
        const yes = history.filter((entry) => entry.box_supported === true).length;
        return { value: yes / history.length, detail: `${yes} of ${history.length}` };
      } },
  ],
});
