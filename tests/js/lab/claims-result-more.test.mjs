import assert from "node:assert/strict";
import { test } from "node:test";

import { runExporter } from "../../../static/js/lab/kit.js";
import pack from "../../../static/js/lab/packs/claims/claims-result-more.js";
import { checkPack } from "./harness.mjs";
import { sampleClaimsHistory, sampleClaimsResult, sampleClaimsResultCtx } from "./fixtures/claims.mjs";

// The fixture's shown check ("Crushed box" on A-1044): shows_item 0.94, damage_visible 0.81, severity 1.20 (levels
// 0.05 / 0.70 / 0.20 / 0.05), damage_kind crushed_or_dented 0.66 (then 0.18, 0.09, 0.02, none_visible 0.05),
// matches_note 0.62, raw box 0.55–0.95 × 0.10–0.45 at confidence 0.52, drawn padded as 0.50–1.00 × 0.05–0.50, on a
// 640 × 480 PNG. Policy in force: damage_yes 0.70, damage_no 0.30, shows_order 0.50, matches_note 0.60,
// box_confidence 0.60, full_refund_at 1.50, auto_limit_usd 100. Decision: review, $32.00.
const page = sampleClaimsResultCtx();
const items = page.items();
const withResult = (change) => {
  const result = sampleClaimsResult();
  change(result);
  return result;
};
const empty = () => sampleClaimsResultCtx({ result: null, input: null, history: [], calls: 0 });
const noBox = () => sampleClaimsResultCtx({ result: withResult((r) => { delete r.answers.damage_box; delete r.trace.request.questions.damage_box; }) });
const crushedInput = (note) => ({ order: "A-1044", note, photo: { source: "sample", name: "crushed-box", about: "A shipping box with a crushed corner" } });

// An earlier check of the same claim in this session, answered 0.90 / 0.75 / severity 1.00 / matches 0.70.
function repeatCtx() {
  const history = sampleClaimsHistory();
  const shown = history[3];
  const answers = JSON.parse(JSON.stringify(shown.answers));
  answers.shows_item.noul = 0.9;
  answers.damage_visible.noul = 0.75;
  answers.severity.score = 1.0;
  answers.matches_note.noul = 0.7;
  return sampleClaimsResultCtx({ history: [{ ...shown, call: 0, at: 1_699_999_000_000, answers }, ...history] });
}
// The same history, but the earlier check used a different note: nothing matches.
function otherNoteCtx() {
  const history = sampleClaimsHistory();
  return sampleClaimsResultCtx({ history: [{ ...history[3], call: 0, input: { ...history[3].input, note: "Something else." } }, ...history] });
}
const hiddenCtx = sampleClaimsResultCtx({ result: withResult((r) => {
  r.evidence.damage = 0.25;
  r.location = { shown: false, box: { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45 }, confidence: 0.52, reason: "Hidden: the photo shows no damage, so there is nothing to locate." };
}) });
const blankNoteCtx = sampleClaimsResultCtx({ input: crushedInput("   ") });
const otherOrderCtx = sampleClaimsResultCtx({ input: crushedInput("Same problem as A-1042 had: A-1044's box came crushed.") });

// Reference entropies, computed here directly from the probabilities listed above (checked against Python's
// math.log2: 0.327445, 0.701471, 1.256780, 1.482580, 0.958042 bits), plus exact cases: 1 bit for 50/50, 2 bits for
// four equal levels.
const bits = (...ps) => -ps.reduce((sum, p) => sum + p * Math.log2(p), 0);
const repeat = repeatCtx();
// A box partly outside the picture, off the pixel grid: 0.1234 × 640 = 78.976 -> 78, 0.2345 × 480 = 112.56 -> 112,
// 0.5678 × 640 = 363.392 -> 364, bottom 1.02 clamped to 1 -> 480 (exact fractions in Python).
const oddBox = () => sampleClaimsResultCtx({ result: withResult((r) => { r.answers.damage_box.box = { left: 0.1234, top: 0.2345, right: 0.5678, bottom: 1.02 }; }) });
// Edge items for the flip point, each with the cuts of the policy in force (the slider grids come from ctx.data.limits).
const flipEdges = [
  { type: "noul", value: 1, cuts: [{ key: "shows_order", at: 0.5 }] },
  { type: "noul", value: 0.5, cuts: [{ key: "matches_note", at: 0.5 }] },
  { type: "noul", value: 0.29, cuts: [{ key: "damage_no", at: 0.3 }, { key: "damage_yes", at: 0.7 }] },
  { type: "noul", value: 0.95, cuts: [{ key: "shows_order", at: 0.5 }] },
  { type: "box", value: null, confidence: 0.6, cuts: [{ key: "box_confidence", at: 0.6 }] },
];

checkPack(pack, {
  entropy_bits: { items: [...items, { type: "noul", value: 0.5, probabilities: [{ key: "yes", p: 0.5 }, { key: "no", p: 0.5 }] },
    { type: "score", probabilities: ["0", "1", "2", "3"].map((key) => ({ key, p: 0.25 })) }],
  values: [bits(0.94, 0.06), bits(0.81, 0.19), bits(0.05, 0.7, 0.2, 0.05), bits(0.66, 0.18, 0.09, 0.02, 0.05), bits(0.62, 0.38), null, 1, 2],
  tolerance: 1e-9 },
  // shows 0.94 passes 0.50: first step above is 0.95. damage 0.81 passes 0.70 (3 steps to 0.85) and 0.30 (11 steps): 0.85.
  // severity 1.20 is below 1.50: lowering to 1.20 flips it (3 steps of 0.1). matches 0.62 passes 0.60: 0.65, one step.
  // Box confidence 0.52 is below 0.60: lowering to 0.50 stops the padding (2 steps).
  // Edges: 1.00 passes 0.50 and no step above 1 exists; 0.50 passes 0.50 exactly, so 0.55 is the first failing step;
  // 0.29 fails damage_no 0.30 and passes again at 0.25 (one step), closer than damage_yes (9 steps from 0.70 to 0.25);
  // 0.95 on the grid still passes, so the flip is at 1.00 (10 steps); the Box rule reads confidence 0.60, not the value.
  flip_point: { items: [...items, ...flipEdges], values: [0.95, 0.85, 1.2, null, 0.65, 0.5, null, 0.55, 0.25, 1, 0.65], ctx: page },
  steps_to_flip: { items: [...items, ...flipEdges], values: [9, 3, 3, null, 1, 2, null, 1, 1, 10, 1], ctx: page },
  // 0.94 - 0.90, 0.81 - 0.75, 1.20 - 1.00, -, 0.62 - 0.70, -
  repeat_change: { items: repeat.items(), values: [0.04, 0.06, 0.2, null, -0.08, null], ctx: repeat, tolerance: 1e-9 },
  // The shown decision is "review".
  decision_level: { items: [{ check: { ok: false, level: "review" } }, { check: { ok: false, level: "retake" } }, { check: { ok: true, level: "ok" } }, { check: null }],
    values: [true, false, false, false], ctx: page },

  severity_split: { hit: { type: "score", value: 1.5, probabilities: [{ key: "0", p: 0.4 }, { key: "1", p: 0.1 }, { key: "2", p: 0.1 }, { key: "3", p: 0.4 }] },
    miss: [items[2], items[0], { type: "score", value: 1.5, probabilities: [{ key: "1", p: 0.45 }, { key: "2", p: 0.45 }, { key: "0", p: 0.05 }, { key: "3", p: 0.05 }] }],
    message: /^levels 0 \(40%\) and 3 \(40%\) each hold at least 25%/ },
  score_vs_mode: { hit: { type: "score", value: 1.6, probabilities: [{ key: "0", p: 0.05 }, { key: "1", p: 0.5 }, { key: "2", p: 0.3 }, { key: "3", p: 0.15 }] },
    miss: [items[2], items[3]], message: /^the page prints level 2 \(rounded from 1\.60\) while level 1 is the most likely \(50%\)/ },
  kind_without_damage: { hitList: [{ id: "damage_kind", value: "crushed_or_dented", probabilities: [{ key: "crushed_or_dented", p: 0.66 }] }, { id: "damage_visible", value: 0.2 }],
    missList: items, ctx: page, message: /^damage_kind is crushed_or_dented at 66% but damage_visible 0\.20 is below the retake cut 0\.30/ },
  damage_without_severity: { hitList: [{ id: "damage_visible", value: 0.81 }, { id: "severity", value: 0.3 }], missList: items, ctx: page,
    message: /^damage_visible 0\.81 is at or above 0\.70 but severity is only 0\.30/ },
  box_at_border: { hit: [{ type: "box", box: { left: 0.3, top: 0.2, right: 0.995, bottom: 0.6 } }, { type: "box", box: { left: 0, top: 0.005, right: 0.5, bottom: 0.5 } }],
    miss: [items[5], items[0]], message: /reaches the (right edge|left and top edges) \(within 1%\)/ },
  // 0.05 × 0.10 = 0.5% of the picture
  box_tiny: { hit: { type: "box", box: { left: 0.5, top: 0.5, right: 0.55, bottom: 0.6 } }, miss: [items[5], items[1]], message: /covers 0\.5% of the picture/ },
  blank_note: { hitList: blankNoteCtx.items(), missList: items, ctx: blankNoteCtx, missCtx: page, message: /blank, so matches_note \(0\.62\) compared/ },
  note_names_other_order: { hitList: otherOrderCtx.items(), missList: items, ctx: otherOrderCtx, missCtx: page,
    message: /^the note mentions A-1042, but this check was filed against A-1044\.$/ },

  // $100 - $32; a $120 refund is $20 over; a rejection has no refund.
  limit_headroom: [{ ctx: page, expect: 68, empty: empty() },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.amount = 120; }) }), expect: -20 },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.decision = "reject"; }) }), expect: null }],
  // centre (0.75, 0.275): right column, top row
  box_region: [{ ctx: page, expect: "top right", empty: empty() },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.answers.damage_box.box = { left: 0.4, top: 0.4, right: 0.6, bottom: 0.7 }; }) }), expect: "centre" },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.answers.damage_box.box = { left: 0, top: 0.7, right: 0.2, bottom: 0.9 }; }) }), expect: "bottom left" },
    { ctx: noBox(), expect: null }],
  // raw 0.40 × 0.35 = 0.14 lies inside drawn 0.50 × 0.45 = 0.225: IoU 0.14 / 0.225 = 28/45
  box_overlap_drawn: [{ ctx: page, expect: 28 / 45, tolerance: 1e-9, empty: empty() },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.location = { ...r.location, padded: false, box: { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45 } }; }) }), expect: 1, tolerance: 1e-9 },
    { ctx: hiddenCtx, expect: null }],
  // 0.20 + 0.05
  severity_partial_or_worse: [{ ctx: page, expect: 0.25, tolerance: 1e-9, empty: empty() }],
  // 0.66 + 0.18 + 0.09 + 0.02 = 1 - 0.05
  kind_any_damage: [{ ctx: page, expect: 0.95, tolerance: 1e-9, empty: empty() }],

  box_fractions_json: { ctx: page, filename: "claim-box-A-1044-edges.json", excludes: ["data_base64", "omitted"],
    check: (out) => {
      const parsed = JSON.parse(out.text);
      assert.deepEqual(parsed, { order: "A-1044", picture: { width: 640, height: 480 }, raw: { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45, confidence: 0.52 },
        drawn: { shown: true, padded: true, tentative: false, left: 0.5, top: 0.05, right: 1, bottom: 0.5 } });
      assert.deepEqual(JSON.parse(runExporter(pack.features.find((f) => f.id === "box_fractions_json"), hiddenCtx).text).drawn,
        { shown: false, reason: "Hidden: the photo shows no damage, so there is nothing to locate." });
      // The JSON keeps the edges exactly as returned, even past the picture's edge.
      assert.deepEqual(JSON.parse(runExporter(pack.features.find((f) => f.id === "box_fractions_json"), oddBox()).text).raw,
        { left: 0.1234, top: 0.2345, right: 0.5678, bottom: 1.02, confidence: 0.52 });
      assert.throws(() => runExporter(pack.features.find((f) => f.id === "box_fractions_json"), noBox()), /no Box answer/);
    } },
  // Pixels: 0.55 × 640 = 352, 0.10 × 480 = 48, 0.95 × 640 = 608, 0.45 × 480 = 216, so 256 × 168 (area 43,008).
  box_coco: { ctx: page, filename: "claim-box-A-1044-coco.json",
    check: (out) => {
      assert.deepEqual(JSON.parse(out.text), { images: [{ id: 1, file_name: "crushed-box", width: 640, height: 480 }],
        annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [352, 48, 256, 168], area: 43008, iscrowd: 0 }], categories: [{ id: 1, name: "damage" }] });
      assert.deepEqual(JSON.parse(runExporter(pack.features.find((f) => f.id === "box_coco"), oddBox()).text).annotations[0].bbox, [78, 112, 286, 368]);
      assert.equal(JSON.parse(runExporter(pack.features.find((f) => f.id === "box_coco"), oddBox()).text).annotations[0].area, 286 * 368);
      assert.throws(() => runExporter(pack.features.find((f) => f.id === "box_coco"), noBox()), /no Box answer/);
      assert.throws(() => runExporter(pack.features.find((f) => f.id === "box_coco"), sampleClaimsResultCtx({ result: withResult((r) => { r.image = {}; }) })), /size is unknown/);
    } },
  // centre (0.55 + 0.95) / 2, (0.10 + 0.45) / 2; size 0.40 × 0.35. The odd box is clamped first: bottom 1.02 -> 1.
  box_yolo: { ctx: page, text: "0 0.750000 0.275000 0.400000 0.350000\n", filename: "claim-box-A-1044-yolo.txt",
    check: () => assert.equal(runExporter(pack.features.find((f) => f.id === "box_yolo"), oddBox()).text, "0 0.345600 0.617250 0.444400 0.765500\n") },
  box_voc_xml: { ctx: sampleClaimsResultCtx({ input: { order: "A-1044", note: "x", photo: { source: "upload", name: "crack <1> & dent.jpg", about: "" } } }),
    text: "<annotation>\n  <filename>crack &lt;1&gt; &amp; dent.jpg</filename>\n  <size><width>640</width><height>480</height></size>\n  <object>\n    <name>damage</name>\n"
      + "    <bndbox><xmin>352</xmin><ymin>48</ymin><xmax>608</xmax><ymax>216</ymax></bndbox>\n  </object>\n</annotation>\n", filename: "claim-box-A-1044-voc.xml" },
  box_label_studio: { ctx: page, filename: "claim-box-A-1044-label-studio.json",
    check: (out) => assert.deepEqual(JSON.parse(out.text), [{ from_name: "label", to_name: "image", type: "rectanglelabels", original_width: 640, original_height: 480,
      value: { x: 55, y: 10, width: 40, height: 35, rotation: 0, rectanglelabels: ["damage"] } }]) },
  box_svg: { ctx: page, filename: "claim-box-A-1044-overlay.svg",
    text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">\n  <rect x="352" y="48" width="256" height="168" fill="none" stroke="#d33" stroke-width="3"/>\n</svg>\n' },
  box_imagemagick: { ctx: page, filename: "claim-box-A-1044-crop.sh", includes: ["magick photo.png -crop 256x168+352+48 +repage damage.png\n", "640x480 picture"] },
  box_python: { ctx: page, filename: "claim-box-A-1044-crop.py", includes: ["BOX = (352, 48, 608, 216)  # left, upper, right, lower", "array[48:216, 352:608]"] },
  flip_points_csv: { ctx: page, filename: "claim-flip-points.csv",
    text: ['"answer","compared","value","setting","cut","side","flip_at","slider_steps"',
      '"shows_item","value","0.94","shows_order","0.5","at or above","0.95","9"',
      '"damage_visible","value","0.81","damage_no","0.3","at or above","0.85","11"',
      '"damage_visible","value","0.81","damage_yes","0.7","at or above","0.85","3"',
      '"severity","value","1.2","full_refund_at","1.5","below","1.2","3"',
      '"matches_note","value","0.62","matches_note","0.6","at or above","0.65","1"',
      '"damage_box","confidence","0.52","box_confidence","0.6","below","0.5","2"', ""].join("\r\n") },
}, { ctx: () => sampleClaimsResultCtx() });

// The newest matching entry is the shown check itself: with no earlier check of the same claim, nothing is compared.
test("claims-result-more: repeat_change needs an earlier check with the same order, note and sample photo", () => {
  const fact = pack.features.find((f) => f.id === "repeat_change");
  for (const ctx of [page, otherNoteCtx()]) assert.deepEqual(ctx.items().map((item) => fact.value(item, ctx)), [null, null, null, null, null, null]);
});
