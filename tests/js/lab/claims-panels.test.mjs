// Tests for static/js/lab/packs/claims/claims-panels.js on the fixtures of tests/js/lab/fixtures/claims.mjs.
// Expected values are worked out by hand from the fixture:
//   Box: raw edges left 0.55, top 0.1, right 0.95, bottom 0.45 in a 640 × 480 picture -> 352, 48, 608, 216 px
//     (256 × 168 px, aspect 256 / 168). Drawn padded by 0.05: 0.5, 0.05, 1, 0.5 -> 320, 24, 640, 240 px
//     (area 0.5 × 0.45 = 22.5% of the picture); no edge cut short.
//     A raw box 0.02 … 0.98 across is cut short by 0.03 at the left and right border: 0.03 × 640 = 19.2 -> 19 px each.
//   Policy in force: damage_yes 0.7, damage_no 0.3, shows_order 0.5, matches_note 0.6, box_confidence 0.6,
//     full_refund_at 1.5, auto_limit_usd 100. Answers: damage 0.81, shows 0.94, matches 0.62, box confidence 0.52,
//     severity 1.2, amount $32. Flip points: 0.85 (3 steps), 0.85 (11), 0.95 (9), 0.65 (1), 0.5 (2), 1.2 (3), $30 (14).
//   Session: four checks, calls 1-4: approve $38 790 ms $0.000398, retake $19 905 ms $0.000401, review $249 1104 ms
//     $0.000356 (upload, no Box), review $32 812 ms $0.000412 (the shown Crushed box). Total $0.001567; mean 902.75 ms.
//     Every check was decided with matches_note 0.5; the sliders now hold 0.6.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/claims/claims-panels.js";
import { CLAIMS_POLICY, sampleClaimsHistory, sampleClaimsResult, sampleClaimsResultCtx } from "./fixtures/claims.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const cellsOf = (t, row) => t.findAll(row, (node) => node.tag === "td").map(t.textOf);
const part = (t, root, name) => t.find(root, attr("data-part", name));
const empty = sampleClaimsResultCtx({ result: null, input: null, history: [], calls: 0 });

// The shown result with other Box edges and the box the page draws for them.
function withBox(box, location) {
  const result = sampleClaimsResult();
  result.answers.damage_box = { ...result.answers.damage_box, box };
  result.location = location;
  return sampleClaimsResultCtx({ result });
}
const clampedCtx = () => withBox({ left: 0.02, top: 0.1, right: 0.98, bottom: 0.45 },
  { shown: true, box: { left: 0, top: 0.05, right: 1, bottom: 0.5 }, confidence: 0.52, padded: true, tentative: false, reason: "Padded by 5% on each side." });
const hiddenCtx = () => withBox({ left: 0.55, top: 0.1, right: 0.95, bottom: 0.45 },
  { shown: false, box: { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45 }, confidence: 0.52, reason: "Hidden: the photo shows no damage, so there is nothing to locate." });
function noBoxCtx() {
  const result = sampleClaimsResult();
  delete result.answers.damage_box;
  result.location = { shown: false, reason: "This model does not answer Box questions (Jev 1.14+ needed)." };
  return sampleClaimsResultCtx({ result });
}
// The session plus a fifth check that repeats the first (same order, note and sample photo).
function repeatedHistory() {
  const history = sampleClaimsHistory();
  return [...history, { ...history[0], call: 5, at: 1_700_000_300_000 }];
}
// The session plus a fifth check that uploads a file with the same name, order and note as the third.
function uploadTwice() {
  const history = sampleClaimsHistory();
  return [...history, { ...history[2], call: 5, at: 1_700_000_300_000 }];
}

checkPack(pack, {
  box_inspector: { improvements: {
    raw_edges: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "left"))).slice(0, 3), ["left", "0.5500", "352"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "top"))).slice(0, 3), ["top", "0.1000", "48"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "right"))).slice(0, 3), ["right", "0.9500", "608"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "bottom"))).slice(0, 3), ["bottom", "0.4500", "216"]);
      assert.match(t.textOf(t.render(noBoxCtx())), /no Box answer/);
      assert.match(t.textOf(t.render(empty)), /Check a claim first/);
    },
    drawn_edges: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "left"))).slice(3, 5), ["0.5000", "320"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "right"))).slice(3, 5), ["1.0000", "640"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "bottom"))).slice(3, 5), ["0.5000", "240"]);
      assert.equal(t.textOf(part(t, root, "state")), "Drawn padded.");
    },
    shift: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(["left", "top", "right", "bottom"].map((edge) => t.textOf(t.find(root, attr("data-shift", edge)))), ["−32", "−24", "+32", "+24"]);
    },
    clamp: (t) => {
      assert.equal(t.textOf(part(t, t.render(sampleClaimsResultCtx()), "clamp")), "Padding stayed inside the picture on every side.");
      assert.equal(t.textOf(part(t, t.render(clampedCtx()), "clamp")),
        "Padding reached the picture's border: left edge cut short by 0.0300 (19 px), right edge cut short by 0.0300 (19 px).");
      assert.equal(part(t, t.render(hiddenCtx()), "clamp"), null);
    },
    hidden: (t) => {
      const root = t.render(hiddenCtx());
      assert.equal(t.textOf(part(t, root, "hidden")),
        "Hidden by the policy (Hidden: the photo shows no damage, so there is nothing to locate): the page draws no box. The raw edges below are what Jev returned.");
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-edge", "left"))), ["left", "0.5500", "352", "—", "—", "—"]);
      assert.equal(part(t, t.render(sampleClaimsResultCtx()), "hidden"), null);
    },
    schematic: (t) => {
      const svg = part(t, t.render(sampleClaimsResultCtx()), "schematic");
      assert.equal(svg.attrs.viewBox, "0 0 640 480");
      const rect = (name) => t.find(svg, attr("data-rect", name)).attrs;
      assert.deepEqual([rect("raw").x, rect("raw").y, rect("raw").width, rect("raw").height], ["352", "48", "256", "168"]);
      assert.deepEqual([rect("drawn").x, rect("drawn").y, rect("drawn").width, rect("drawn").height], ["320", "24", "320", "216"]);
      assert.equal(rect("drawn")["stroke-dasharray"], "6 4");
      assert.equal(t.find(part(t, t.render(hiddenCtx()), "schematic"), attr("data-rect", "drawn")), null);
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleClaimsResultCtx()), attr("data-copy", "edges")), "click");
      assert.equal(t.env.copied[0], "edge\traw fraction\traw px\tdrawn fraction\tdrawn px\nleft\t0.55\t352\t0.5\t320\ntop\t0.1\t48\t0.05\t24\n"
        + "right\t0.95\t608\t1\t640\nbottom\t0.45\t216\t0.5\t240\n");
    },
  } },

  flip_explorer: { improvements: {
    table: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(t.findAll(root, has("data-slider")).map((node) => node.attrs["data-slider"]),
        ["damage_yes", "damage_no", "shows_order", "matches_note", "box_confidence", "full_refund_at", "auto_limit_usd"]);
      const row = (key) => cellsOf(t, t.find(root, attr("data-slider", key))).slice(0, 6);
      assert.deepEqual(row("damage_yes"), ["Damage visible at P ≥", "0.7", "damage visible 81%", "at or above: counts as visible", "0.85", "3"]);
      assert.deepEqual(row("damage_no"), ["Ask for another photo below P", "0.3", "damage visible 81%", "at or above: box shown", "0.85", "11"]);
      assert.deepEqual(row("shows_order").slice(2), ["photo shows the order 94%", "passes", "0.95", "9"]);
      assert.deepEqual(row("box_confidence").slice(2), ["box confidence 52%", "padded", "0.5", "2"]);
      assert.deepEqual(row("full_refund_at").slice(2), ["severity 1.20", "50% credit or a replacement", "1.2", "3"]);
      assert.deepEqual(row("auto_limit_usd").slice(1), ["$100", "refund amount $32.00", "within the limit", "$30", "14"]);
      assert.match(t.textOf(t.render(empty)), /Check a claim first/);
    },
    effect: (t) => {
      const effectIn = (root, key) => t.textOf(t.find(t.find(root, attr("data-slider", key)), has("data-effect")));
      const root = t.render(sampleClaimsResultCtx());
      const effect = (key) => effectIn(root, key);
      // damage 0.81 with damage_yes 0.7 and damage_no 0.3; the box is drawn padded, not tentative (jev/claims.py
      // decide() tests damage_yes first; located() hides below damage_no and marks tentative below damage_yes).
      assert.equal(effect("damage_yes"), "the damage check would go to a person (review), and the box would turn tentative");
      assert.equal(effect("damage_no"), "the box would be hidden");
      assert.equal(effect("matches_note"), "Matches the customer's description would fail (review)");
      assert.equal(effect("box_confidence"), "the box would be drawn as returned");
      assert.equal(effect("full_refund_at"), "the remedy would switch to a full refund");
      assert.equal(effect("auto_limit_usd"), "this amount would exceed the automatic limit (review)");
      // The policy hides the box: padding changes nothing visible.
      assert.equal(effectIn(t.render(hiddenCtx()), "box_confidence"), "nothing visible while the page draws no box");
      // No Box answer, damage already visible: lowering or raising damage_no changes nothing on the page.
      assert.equal(effectIn(t.render(noBoxCtx()), "damage_no"), "nothing visible");
      // damage 0.4: between the cuts (review), box drawn tentative.
      const between = sampleClaimsResult();
      between.answers.damage_visible = { type: "noul", noul: 0.4 };
      between.location = { ...between.location, tentative: true };
      const mid = t.render(sampleClaimsResultCtx({ result: between }));
      assert.equal(effectIn(mid, "damage_yes"), "the damage check would pass, and the box would stop being tentative");
      assert.equal(effectIn(mid, "damage_no"), "the box would be hidden, and the damage check would ask for another photo (retake)");
      // damage 0.2: below damage_no (retake), box hidden; damage_yes flips at 0.2, where decide() passes the check first.
      const low = sampleClaimsResult();
      low.answers.damage_visible = { type: "noul", noul: 0.2 };
      low.location = { shown: false, box: { ...low.answers.damage_box.box }, confidence: 0.52, reason: "Hidden: the photo shows no damage, so there is nothing to locate." };
      const lowRoot = t.render(sampleClaimsResultCtx({ result: low }));
      assert.equal(effectIn(lowRoot, "damage_yes"), "the damage check would pass");
      assert.equal(effectIn(lowRoot, "damage_no"), "the box would be shown, and the damage check would go to a person (review)");
    },
    locked: (t) => {
      assert.equal(t.textOf(part(t, t.render(sampleClaimsResultCtx()), "locked")),
        "No slider reads this failing check: Within 30-day window (review: Delivered 41 days ago). No slider move makes it pass.");
      const result = sampleClaimsResult();
      result.verdict.checks[1] = { ...result.verdict.checks[1], ok: true, level: "ok" };
      assert.equal(part(t, t.render(sampleClaimsResultCtx({ result })), "locked"), null);
    },
    try: (t) => {
      const ctx = sampleClaimsResultCtx();
      t.fire(t.find(t.render(ctx), attr("data-try", "matches_note")), "click");
      assert.deepEqual(ctx.log, [["setPolicy", { ...CLAIMS_POLICY, matches_note: 0.65 }]]);
      assert.match(t.env.toasts[0].message, /matches_note moved to 0\.65.*no Jev call/);
      const busy = sampleClaimsResultCtx({ setup: null });
      assert.equal(t.textOf(t.render(busy)).includes("Try"), true);
      t.fire(t.find(t.render(busy), attr("data-try", "shows_order")), "click");
      assert.equal(t.env.toasts[1].kind, "error");
    },
    put_back: (t) => {
      const ctx = sampleClaimsResultCtx();
      assert.equal(t.find(t.render(ctx), attr("data-action", "put-back")), null);
      t.fire(t.find(t.render(ctx), attr("data-try", "full_refund_at")), "click");
      const button = t.find(t.render(ctx), attr("data-action", "put-back"));
      assert.equal(t.textOf(button), "Put full_refund_at back to 1.5");
      t.fire(button, "click");
      assert.deepEqual(ctx.log.map((entry) => entry[1].full_refund_at), [1.2, 1.5]);
      assert.equal(t.find(t.render(ctx), attr("data-action", "put-back")), null);
    },
    drift: (t) => {
      const ctx = sampleClaimsResultCtx();
      assert.equal(part(t, t.render(ctx), "drift"), null);
      t.fire(t.find(t.render(ctx), attr("data-try", "auto_limit_usd")), "click");
      assert.equal(t.textOf(part(t, t.render(ctx), "drift")),
        "The sliders differ from the policy the shown decision used: auto_limit_usd $30 now, $100 in force. A re-decide may be on its way.");
    },
  } },

  evidence_card: { improvements: {
    lines: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(t.findAll(root, has("data-line")).map(t.textOf), [
        "Photo shows the order: 94% (cut 50%) — passes",
        "Damage visible: 81% (approve at 70%, retake below 30%) — passes",
        "Matches the note: 62% (cut 60%) — passes",
        "Severity: 1.20 of 3, Cosmetic (full refund at 1.50)",
        "Damage kind: Crushed or dented 66%, Torn or open 18%, Broken or cracked 9%",
        "Damage box: drawn, padded, confidence 52%",
      ]);
      assert.equal(t.textOf(t.find(t.render(noBoxCtx()), attr("data-line", "box"))), "Damage box: not answered (Jev 1.14+ needed)");
      assert.match(t.textOf(t.render(empty)), /Check a claim first/);
    },
    decision: (t) => {
      assert.equal(t.textOf(part(t, t.render(sampleClaimsResultCtx()), "decision")), "Decision: Send to a person · 50% credit or a replacement · $32.00 · Why: Delivered 41 days ago");
    },
    note: (t) => {
      const ctx = sampleClaimsResultCtx();
      assert.equal(part(t, t.render(ctx), "note"), null);
      t.fire(t.find(t.render(ctx), attr("data-control", "note")), "change", { target: { checked: true } });
      assert.equal(t.textOf(part(t, t.render(ctx), "note")), "Customer's note: The kit's box came crushed on one corner.");
    },
    copy_text: (t) => {
      const ctx = sampleClaimsResultCtx();
      t.fire(t.find(t.render(ctx), attr("data-copy", "text")), "click");
      const lines = t.env.copied[0].trim().split("\n");
      assert.equal(lines[0], "Claim evidence for order A-1044 (your own check: answers and decision; no picture)");
      assert.equal(lines.length, 9);
      assert.ok(!t.env.copied[0].includes("crushed on one corner"));
      t.state.note = true;
      t.fire(t.find(t.render(ctx), attr("data-copy", "text")), "click");
      assert.ok(t.env.copied[1].startsWith("Claim evidence for order A-1044 (your own check: answers and decision, customer's note; no picture)\n"));
      assert.ok(t.env.copied[1].endsWith("Customer's note: The kit's box came crushed on one corner.\n"));
    },
    copy_markdown: (t) => {
      t.fire(t.find(t.render(sampleClaimsResultCtx()), attr("data-copy", "markdown")), "click");
      const lines = t.env.copied[0].split("\n");
      assert.equal(lines[0], "## Claim evidence for order A-1044 (your own check: answers and decision; no picture)");
      assert.equal(lines[2], "- Photo shows the order: 94% (cut 50%) — passes");
      assert.equal(lines[9], "- Why: Delivered 41 days ago");
    },
  } },

  session_table: { improvements: {
    table: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(t.findAll(root, has("data-call")).map((node) => node.attrs["data-call"]), ["1", "2", "3", "4"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-call", "1"))).slice(0, 8), ["1", "A-1041", "Torn bag", "approve", "$38.00", "jev-1.16", "790 ms", "$0.000398"]);
      assert.deepEqual(cellsOf(t, t.find(root, attr("data-call", "3"))).slice(0, 5), ["3", "A-1042", "upload hopper-crack.jpg", "review", "$249.00"]);
      assert.match(t.textOf(t.render(empty)), /No answered checks/);
    },
    shown: (t) => {
      const root = t.render(sampleClaimsResultCtx());
      assert.deepEqual(t.findAll(root, has("data-shown")).map((node) => node.attrs["data-call"]), ["4"]);
      assert.match(t.textOf(t.find(root, attr("data-call", "4"))), /shown now/);
      assert.deepEqual(t.findAll(t.render(sampleClaimsResultCtx({ input: null })), has("data-shown")), []);
    },
    repeats: (t) => {
      assert.deepEqual(t.findAll(t.render(sampleClaimsResultCtx()), has("data-repeat")), []);
      const root = t.render(sampleClaimsResultCtx({ history: repeatedHistory(), calls: 5 }));
      assert.deepEqual(t.findAll(root, has("data-repeat")).map((node) => [node.attrs["data-call"], node.attrs["data-repeat"]]), [["5", "2"]]);
      // Two uploads with the same file name may be different pictures: never marked as repeats.
      const uploads = t.render(sampleClaimsResultCtx({ history: uploadTwice(), calls: 5 }));
      assert.deepEqual(t.findAll(uploads, has("data-repeat")), []);
    },
    other_policy: (t) => {
      assert.equal(t.findAll(t.render(sampleClaimsResultCtx()), has("data-other-policy")).length, 4);
      assert.equal(t.findAll(t.render(sampleClaimsResultCtx({ settings: { ...CLAIMS_POLICY } })), has("data-other-policy")).length, 0);
    },
    sort: (t) => {
      const ctx = sampleClaimsResultCtx();
      const calls = () => t.findAll(t.render(ctx), has("data-call")).map((node) => node.attrs["data-call"]);
      t.fire(t.find(t.render(ctx), attr("data-sort", "cost")), "click");
      assert.deepEqual(calls(), ["3", "1", "2", "4"]);
      t.fire(t.find(t.render(ctx), attr("data-sort", "cost")), "click");
      assert.deepEqual(calls(), ["4", "2", "1", "3"]);
      t.fire(t.find(t.render(ctx), attr("data-sort", "latency")), "click");
      assert.deepEqual(calls(), ["1", "4", "2", "3"]);
    },
    filter: (t) => {
      const ctx = sampleClaimsResultCtx();
      const control = t.find(t.render(ctx), attr("data-control", "decision"));
      assert.deepEqual(t.findAll(control, (node) => node.tag === "option").map((node) => node.attrs.value), ["all", "approve", "retake", "review"]);
      t.fire(control, "change", { target: { value: "review" } });
      assert.deepEqual(t.findAll(t.render(ctx), has("data-call")).map((node) => node.attrs["data-call"]), ["3", "4"]);
    },
    answers: (t) => {
      const ctx = sampleClaimsResultCtx();
      assert.equal(cellsOf(t, t.find(t.render(ctx), attr("data-call", "1"))).length, 9);
      t.fire(t.find(t.render(ctx), attr("data-control", "answers")), "change", { target: { checked: true } });
      assert.deepEqual(cellsOf(t, t.find(t.render(ctx), attr("data-call", "1"))).slice(8, 12), ["97%", "93%", "91%", "2.10"]);
    },
    totals: (t) => {
      const ctx = sampleClaimsResultCtx();
      assert.equal(t.textOf(part(t, t.render(ctx), "totals")), "4 checks · measured cost $0.001567 · mean latency 903 ms");
      t.state.decision = "review";
      assert.equal(t.textOf(part(t, t.render(ctx), "totals")), "2 checks · measured cost $0.000768 · mean latency 958 ms");
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleClaimsResultCtx()), attr("data-copy", "session")), "click");
      const lines = t.env.copied[0].trim().split("\n");
      assert.equal(lines[0], "call\torder\tclaim\tdecision_when_sent\tamount\tmodel\tlatency\tcost");
      assert.equal(lines[1], "1\tA-1041\tTorn bag\tapprove\t$38.00\tjev-1.16\t790 ms\t$0.000398");
      assert.equal(lines.length, 5);
      assert.ok(!t.env.copied[0].includes("beans spilled"), "no customer's note");
    },
  } },

  drawn_box_area: [{ ctx: sampleClaimsResultCtx(), empty, expect: (result) => { assert.ok(Math.abs(result.value - 0.225) < 1e-12); assert.equal(result.detail, "padded"); } },
    { ctx: hiddenCtx(), expect: null }, { ctx: noBoxCtx(), expect: null }],
  raw_box_aspect: [{ ctx: sampleClaimsResultCtx(), empty, expect: 256 / 168, tolerance: 1e-9 },
    { ctx: sampleClaimsResultCtx({ result: { ...sampleClaimsResult(), image: {} } }), expect: null }],
  border_clipped_px: [{ ctx: sampleClaimsResultCtx(), empty, expect: 0 }, { ctx: clampedCtx(), expect: 38 }, { ctx: hiddenCtx(), expect: null }],
  rules_one_step: { ctx: sampleClaimsResultCtx(), empty, expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "matches_note"); } },
  checks_under_sliders: [{ ctx: sampleClaimsResultCtx(), empty, expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "of 4 checks"); } },
    { ctx: sampleClaimsResultCtx({ settings: { ...CLAIMS_POLICY } }), expect: 4 }],
  session_mean_latency: { ctx: sampleClaimsResultCtx(), empty, expect: 902.75 },
  distinct_claims: [{ ctx: sampleClaimsResultCtx(), empty, expect: 4 }, { ctx: sampleClaimsResultCtx({ history: repeatedHistory(), calls: 5 }), expect: 4 },
    { ctx: sampleClaimsResultCtx({ history: uploadTwice(), calls: 5 }), expect: 5 }],
  box_support_share: { ctx: sampleClaimsResultCtx(), empty, expect: (result) => { assert.equal(result.value, 0.75); assert.equal(result.detail, "3 of 4"); } },
}, { ctx: () => sampleClaimsResultCtx() });
