// Tests for the tb-boxes pack. Every expected value is worked out by hand from the typed edges (fractions of the
// picture's width and height), with the arithmetic in the comment above each case.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-boxes.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const edges = (prefix, [left, top, right, bottom]) => ({ [`${prefix}left`]: left, [`${prefix}top`]: top, [`${prefix}right`]: right, [`${prefix}bottom`]: bottom });
const near = (actual, expected, label) => approx(actual, expected, 1e-9, label);
const rowsLike = (result, expected) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([label, value], i) => near(result.rows[i][1], value, label));
};
const tableLike = (result, columns, expected) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, expected.length);
  expected.forEach((row, i) => row.forEach((cell, j) => near(result.table.rows[i][j], cell, `table ${i},${j}`)));
};
const edgeRows = ([left, top, right, bottom]) => [["Left", left], ["Top", top], ["Right", right], ["Bottom", bottom]];

checkPack(pack, {
  // 0.4 × 1000 = 400 px wide, 0.4 × 500 = 200 px tall: area 80,000 px², share 0.4 × 0.4 = 0.16, ratio 2.
  box_area_aspect: {
    values: { ...edges("", [0.1, 0.2, 0.5, 0.6]), width: 1000, height: 500 },
    expect: [["Width (px)", 400], ["Height (px)", 200], ["Area (px²)", 80000], ["Share of the picture", 0.16], ["Aspect ratio (width ÷ height)", 2], ["Shape", "wider than tall"]],
    more: [{ values: { ...edges("", [0.25, 0, 0.75, 1]), width: 400, height: 200 },
      expect: [["Width (px)", 200], ["Height (px)", 200], ["Area (px²)", 40000], ["Share of the picture", 0.5], ["Aspect ratio (width ÷ height)", 1], ["Shape", "square"]] }],
    invalid: [{ ...edges("", [0.5, 0.2, 0.5, 0.6]), width: 10, height: 10 }, { ...edges("", [0.1, 0.2, 0.5, 0.6]), width: 0, height: 10 }],
  },
  // Center ((0.1 + 0.5) / 2, (0.2 + 0.8) / 2) = (0.3, 0.5); size 0.4 × 0.6.
  box_center_size: {
    values: edges("", [0.1, 0.2, 0.5, 0.8]),
    expect: [["Center x", 0.3], ["Center y", 0.5], ["Width", 0.4], ["Height", 0.6]],
    invalid: [edges("", [0.1, 0.8, 0.5, 0.2]), edges("", [0.1, 0.2, 1.5, 0.8])],
  },
  // 0.5 ± 0.1 and 0.5 ± 0.2; then 0.9 ± 0.2 = 0.7..1.1 → 1, 0.1 ± 0.2 = −0.1..0.3 → 0: clamped.
  center_to_box: {
    values: { x: 0.5, y: 0.5, w: 0.2, h: 0.4 },
    expect: [...edgeRows([0.4, 0.3, 0.6, 0.7]), ["Clamped to the picture", "no"]],
    more: [{ values: { x: 0.9, y: 0.1, w: 0.4, h: 0.4 }, expect: [...edgeRows([0.7, 0, 1, 0.3]), ["Clamped to the picture", "yes"]] }],
    invalid: [{ x: 0.5, y: 0.5, w: 0, h: 0.4 }],
  },
  // 100 / 400, 50 / 500, 300 / 400, 250 / 500; the size form 100 + 200 = 300, 50 + 200 = 250 gives the same box.
  pixels_to_box: {
    values: { form: "corners", a: 100, b: 50, c: 300, d: 250, width: 400, height: 500 },
    expect: edgeRows([0.25, 0.1, 0.75, 0.5]),
    more: [{ values: { form: "size", a: 100, b: 50, c: 200, d: 200, width: 400, height: 500 }, expect: edgeRows([0.25, 0.1, 0.75, 0.5]) }],
    invalid: [{ form: "corners", a: 100, b: 50, c: 500, d: 250, width: 400, height: 500 }, { form: "corners", a: 100, b: 50, c: 100, d: 250, width: 400, height: 500 }],
  },
  // Overlap 0.3..0.5 by 0.2..0.5: 0.2 × 0.3 = 0.06. Boxes that only touch at x = 0.3 share nothing.
  intersection_box: {
    values: { ...edges("a_", [0.1, 0.1, 0.5, 0.5]), ...edges("b_", [0.3, 0.2, 0.7, 0.6]) },
    expect: [["Overlaps", "yes"], ["Left", 0.3], ["Top", 0.2], ["Right", 0.5], ["Bottom", 0.5], ["Area", 0.06]],
    more: [{ values: { ...edges("a_", [0.1, 0.1, 0.3, 0.3]), ...edges("b_", [0.3, 0.1, 0.5, 0.3]) },
      expect: [["Overlaps", "no"], ["Left", null], ["Top", null], ["Right", null], ["Bottom", null], ["Area", 0]] }],
    invalid: [{ ...edges("a_", [0.5, 0.1, 0.3, 0.3]), ...edges("b_", [0.3, 0.1, 0.5, 0.3]) }],
  },
  // On 1000 × 500: gaps (0.5 − 0.2) × 1000 = 300 and (0.6 − 0.2) × 500 = 200, shortest √(300² + 200²) = √130000;
  // centers (0.1, 0.1) and (0.6, 0.75): (0.5 × 1000, 0.65 × 500) = (500, 325), √355625.
  box_gap: {
    values: { ...edges("a_", [0, 0, 0.2, 0.2]), ...edges("b_", [0.5, 0.6, 0.7, 0.9]), width: 1000, height: 500 },
    expect: [["Horizontal gap (px)", 300], ["Vertical gap (px)", 200], ["Shortest distance (px)", Math.sqrt(130000)], ["Distance between centers (px)", Math.sqrt(355625)]],
    more: [{ values: { ...edges("a_", [0.1, 0.1, 0.5, 0.5]), ...edges("b_", [0.3, 0.2, 0.7, 0.6]), width: 100, height: 100 },
      // Overlapping: no gaps; centers (0.3, 0.3) and (0.5, 0.4) → (20, 10) px, √500.
      expect: [["Horizontal gap (px)", 0], ["Vertical gap (px)", 0], ["Shortest distance (px)", 0], ["Distance between centers (px)", Math.sqrt(500)]] },
      // Side by side on 200 × 100: only a horizontal gap of (0.6 − 0.4) × 200 = 40; centers (0.2, 0.5) and (0.8, 0.5) → 120.
      { values: { ...edges("a_", [0, 0.2, 0.4, 0.8]), ...edges("b_", [0.6, 0.3, 1, 0.7]), width: 200, height: 100 },
        expect: [["Horizontal gap (px)", 40], ["Vertical gap (px)", 0], ["Shortest distance (px)", 40], ["Distance between centers (px)", 120]] }],
    invalid: [{ ...edges("a_", [0, 0, 0.2, 0.2]), ...edges("b_", [0.5, 0.6, 0.7, 0.9]), width: 0, height: 500 }],
  },
  // Apart: IoU 0, union 0.08, hull 0..0.6 squared = 0.36, GIoU = −0.28 / 0.36 = −7/9. Overlapping: IoU 0.06 / 0.26 = 3/13,
  // hull 0.1..0.7 × 0.1..0.6 = 0.3, GIoU = 3/13 − 0.04 / 0.3 = 3/13 − 2/15 = 19/195.
  giou: {
    values: { ...edges("a_", [0, 0, 0.2, 0.2]), ...edges("b_", [0.4, 0.4, 0.6, 0.6]) },
    expect: [["IoU", 0], ["Enclosing box area", 0.36], ["GIoU", -7 / 9], ["GIoU loss (1 − GIoU)", 16 / 9]],
    more: [{ values: { ...edges("a_", [0.1, 0.1, 0.5, 0.5]), ...edges("b_", [0.3, 0.2, 0.7, 0.6]) },
      expect: [["IoU", 3 / 13], ["Enclosing box area", 0.3], ["GIoU", 19 / 195], ["GIoU loss (1 − GIoU)", 176 / 195]] }],
  },
  // IoU 3/13; centers (0.3, 0.3) and (0.5, 0.4): d² = 0.04 + 0.01 = 0.05; hull 0.6 × 0.5: c² = 0.36 + 0.25 = 0.61.
  diou: {
    values: { ...edges("a_", [0.1, 0.1, 0.5, 0.5]), ...edges("b_", [0.3, 0.2, 0.7, 0.6]) },
    expect: [["IoU", 3 / 13], ["Squared center distance (d²)", 0.05], ["Squared enclosing diagonal (c²)", 0.61], ["DIoU", 3 / 13 - 5 / 61]],
    // Identical boxes: IoU 1, d² 0, c² = 0.4² + 0.4² = 0.32.
    more: [{ values: { ...edges("a_", [0.1, 0.1, 0.5, 0.5]), ...edges("b_", [0.1, 0.1, 0.5, 0.5]) },
      expect: [["IoU", 1], ["Squared center distance (d²)", 0], ["Squared enclosing diagonal (c²)", 0.32], ["DIoU", 1]] }],
  },
  // A (0.04) wholly inside B (0.16): 0.04 / 0.04 = 1 and 0.04 / 0.16 = 0.25. Partial: 0.06 / 0.16 = 0.375 both ways.
  containment: {
    values: { ...edges("a_", [0.2, 0.2, 0.4, 0.4]), ...edges("b_", [0.1, 0.1, 0.5, 0.5]) },
    expect: [["Overlap area", 0.04], ["Share of A inside B", 1], ["Share of B inside A", 0.25], ["A lies wholly inside B", "yes"], ["B lies wholly inside A", "no"]],
    more: [{ values: { ...edges("a_", [0.1, 0.1, 0.5, 0.5]), ...edges("b_", [0.3, 0.2, 0.7, 0.6]) },
      expect: [["Overlap area", 0.06], ["Share of A inside B", 0.375], ["Share of B inside A", 0.375], ["A lies wholly inside B", "no"], ["B lies wholly inside A", "no"]] },
      // Disjoint boxes share nothing; identical boxes each lie wholly inside the other.
      { values: { ...edges("a_", [0, 0, 0.2, 0.2]), ...edges("b_", [0.5, 0.5, 0.9, 0.9]) },
        expect: [["Overlap area", 0], ["Share of A inside B", 0], ["Share of B inside A", 0], ["A lies wholly inside B", "no"], ["B lies wholly inside A", "no"]] },
      { values: { ...edges("a_", [0.1, 0.2, 0.3, 0.4]), ...edges("b_", [0.1, 0.2, 0.3, 0.4]) },
        expect: [["Overlap area", 0.04], ["Share of A inside B", 1], ["Share of B inside A", 1], ["A lies wholly inside B", "yes"], ["B lies wholly inside A", "yes"]] }],
  },
  // 1 and 2 share 0.25 of a 0.5 union → 0.5; 3 only touches the others → 0. Mean (0.5 + 0 + 0) / 3.
  iou_matrix: {
    values: { boxes: "0, 0, 0.5, 0.5\n{\"left\": 0, \"top\": 0, \"right\": 0.5, \"bottom\": 1}\n\n0.5 0.5 1 1" },
    expect: (result) => {
      rowsLike(result, [["Boxes", 3], ["Mean pairwise IoU", 1 / 6], ["Lowest pairwise IoU", 0], ["Most overlapping pair", "1 and 2"]]);
      tableLike(result, ["box", "1", "2", "3"], [["1", 1, 0.5, 0], ["2", 0.5, 1, 0], ["3", 0, 0, 1]]);
    },
    // Two boxes that do not overlap: no pair to name.
    more: [{ values: { boxes: "0, 0, 0.2, 0.2\n0.5, 0.5, 0.9, 0.9" },
      expect: [["Boxes", 2], ["Mean pairwise IoU", 0], ["Lowest pairwise IoU", 0], ["Most overlapping pair", "none"]] }],
    invalid: [{ boxes: "0, 0, 0.5, 0.5" }, { boxes: "0, 0, 0.5\n0, 0, 1, 1" }, { boxes: "0, 0, 0.5, 0.5\n{\"left\": 0}" }],
  },
  // Box 0.4 × 0.2, margin 0.25 of it: 0.1 and 0.05 each side. Picture margin 0.1: 0.05 − 0.1 → 0, 0.95 + 0.1 → 1.
  expand_box: {
    values: { ...edges("", [0.2, 0.2, 0.6, 0.4]), margin: 0.25, unit: "box" },
    expect: [...edgeRows([0.1, 0.15, 0.7, 0.45]), ["Clamped to the picture", "no"]],
    more: [{ values: { ...edges("", [0.05, 0.3, 0.5, 0.95]), margin: 0.1, unit: "picture" }, expect: [...edgeRows([0, 0.2, 0.6, 1]), ["Clamped to the picture", "yes"]] },
      // Shrinking by a quarter each side keeps the middle half: 0.2..0.6 → 0.3..0.5.
      { values: { ...edges("", [0.2, 0.2, 0.6, 0.6]), margin: -0.25, unit: "box" }, expect: [...edgeRows([0.3, 0.3, 0.5, 0.5]), ["Clamped to the picture", "no"]] }],
    invalid: [{ ...edges("", [0.2, 0.2, 0.6, 0.4]), margin: -0.5, unit: "box" }],
  },
  // −0.1 → 0 and 1.3 → 1: two edges moved; kept 0.5 × 0.8 = 0.4 of 0.6 × 1.1 = 0.66 → 20/33.
  clamp_box: {
    values: { left: -0.1, top: 0.2, right: 0.5, bottom: 1.3 },
    expect: [...edgeRows([0, 0.2, 0.5, 1]), ["Edges moved", 2], ["Share of the box kept", 20 / 33]],
    more: [{ values: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 }, expect: [...edgeRows([0.1, 0.2, 0.5, 0.6]), ["Edges moved", 0], ["Share of the box kept", 1]] }],
    invalid: [{ left: 1.1, top: 0, right: 1.5, bottom: 0.5 }, { left: 0.5, top: 0, right: 0.4, bottom: 0.5 }],
  },
  // x 0.1..0.4, y 0.2..0.7. Clockwise: x' = 1 − y (0.3..0.8), y' = x (0.1..0.4). Half turn: 1 − x, 1 − y.
  // Counterclockwise: x' = y (0.2..0.7), y' = 1 − x (0.6..0.9).
  rotate_box: {
    values: { ...edges("", [0.1, 0.2, 0.4, 0.7]), turn: "cw" },
    expect: edgeRows([0.3, 0.1, 0.8, 0.4]),
    more: [{ values: { ...edges("", [0.1, 0.2, 0.4, 0.7]), turn: "half" }, expect: edgeRows([0.6, 0.3, 0.9, 0.8]) },
      { values: { ...edges("", [0.1, 0.2, 0.4, 0.7]), turn: "ccw" }, expect: edgeRows([0.2, 0.6, 0.7, 0.9]) }],
    invalid: [{ ...edges("", [0.1, 0.2, 0.4, 0.7]), turn: "45" }],
  },
  flip_box: {
    values: { ...edges("", [0.1, 0.2, 0.4, 0.7]), flip: "horizontal" },
    expect: edgeRows([0.6, 0.2, 0.9, 0.7]),
    more: [{ values: { ...edges("", [0.1, 0.2, 0.4, 0.7]), flip: "vertical" }, expect: edgeRows([0.1, 0.3, 0.4, 0.8]) }],
    invalid: [{ ...edges("", [0.4, 0.2, 0.1, 0.7]), flip: "horizontal" }, { ...edges("", [0.1, 0.2, 0.4, 0.7]), flip: "diagonal" }],
  },
  // Crop 0.2..0.6 × 0.2..0.7 (0.4 × 0.5). In: (0.3 − 0.2) / 0.4 = 0.25, (0.4 − 0.2) / 0.5 = 0.4, 0.75, 0.8.
  // A box sticking out on the left keeps 0.2..0.4 of 0.1..0.4: (0, 0.2, 0.5, 0.6) and 2/3 of its area. Out reverses.
  crop_box: {
    values: { ...edges("", [0.3, 0.4, 0.5, 0.6]), ...edges("c_", [0.2, 0.2, 0.6, 0.7]), direction: "in" },
    expect: [...edgeRows([0.25, 0.4, 0.75, 0.8]), ["Share of the box kept", 1]],
    more: [{ values: { ...edges("", [0.1, 0.3, 0.4, 0.5]), ...edges("c_", [0.2, 0.2, 0.6, 0.7]), direction: "in" }, expect: [...edgeRows([0, 0.2, 0.5, 0.6]), ["Share of the box kept", 2 / 3]] },
      { values: { ...edges("", [0.25, 0.4, 0.75, 0.8]), ...edges("c_", [0.2, 0.2, 0.6, 0.7]), direction: "out" }, expect: [...edgeRows([0.3, 0.4, 0.5, 0.6]), ["Share of the box kept", 1]] }],
    invalid: [{ ...edges("", [0.7, 0.7, 0.9, 0.9]), ...edges("c_", [0.2, 0.2, 0.6, 0.7]), direction: "in" }],
  },
  // 800 × 400 into 1000 × 1000: scale min(1.25, 2.5) = 1.25 → 1000 × 500, bars 0 at the sides and 250 above and below.
  // In: top (250 + 0.2 × 500) / 1000 = 0.35, bottom (250 + 0.8 × 500) / 1000 = 0.65. Out reverses it.
  letterbox_box: {
    values: { ...edges("", [0.2, 0.2, 0.6, 0.8]), width: 800, height: 400, canvasWidth: 1000, canvasHeight: 1000, direction: "in" },
    expect: [...edgeRows([0.2, 0.35, 0.6, 0.65]), ["Scale", 1.25], ["Bar on each side (px)", 0], ["Bar above and below (px)", 250]],
    more: [{ values: { ...edges("", [0.2, 0.35, 0.6, 0.65]), width: 800, height: 400, canvasWidth: 1000, canvasHeight: 1000, direction: "out" },
      expect: [...edgeRows([0.2, 0.2, 0.6, 0.8]), ["Scale", 1.25], ["Bar on each side (px)", 0], ["Bar above and below (px)", 250]] }],
    // A box on the top bar (canvas y 0..200, the picture starts at 250) maps to nothing.
    invalid: [{ ...edges("", [0.1, 0, 0.5, 0.2]), width: 800, height: 400, canvasWidth: 1000, canvasHeight: 1000, direction: "out" }],
  },
  // min left 0.1, min top 0.1, max right 0.6, max bottom 0.9: 0.5 × 0.8 = 0.4.
  enclosing_box: {
    values: { boxes: "# three answers\n0.1, 0.2, 0.3, 0.4\n0.2; 0.1; 0.5; 0.3\n\n0.4 0.5 0.6 0.9" },
    expect: [...edgeRows([0.1, 0.1, 0.6, 0.9]), ["Area", 0.4], ["Boxes", 3]],
    invalid: [{ boxes: "" }, { boxes: "0.1, 0.2, 0.05, 0.4" }],
  },
  // Mean of (0,0,.4,.4), (.2,.2,.6,.6), (.1,.1,.5,.5) is (.1,.1,.5,.5). IoU of the first two with it: 0.3² = 0.09 over
  // 0.16 + 0.16 − 0.09 = 0.23 → 9/23; the third is identical. Mean (18/23 + 1) / 3 = 41/69.
  // Median with an outlier (.9,.9,1,1): lefts 0, .1, .2, .9 → 0.15; rights .4, .5, .6, 1 → 0.55. IoUs: 0.25² / (0.32 − 0.0625)
  // = 25/103, 0.35² / (0.32 − 0.1225) = 49/79 twice, and 0 for the outlier.
  consensus_box: {
    values: { boxes: "0, 0, 0.4, 0.4\n0.2, 0.2, 0.6, 0.6\n0.1, 0.1, 0.5, 0.5", method: "mean" },
    expect: [...edgeRows([0.1, 0.1, 0.5, 0.5]), ["Mean IoU with the consensus", 41 / 69], ["Lowest IoU with the consensus", 9 / 23], ["Box farthest from the consensus", 1]],
    more: [{ values: { boxes: "0, 0, 0.4, 0.4\n0.2, 0.2, 0.6, 0.6\n0.1, 0.1, 0.5, 0.5\n0.9, 0.9, 1, 1", method: "median" },
      expect: [...edgeRows([0.15, 0.15, 0.55, 0.55]), ["Mean IoU with the consensus", (25 / 103 + 98 / 79) / 4], ["Lowest IoU with the consensus", 0], ["Box farthest from the consensus", 4]] }],
    invalid: [{ boxes: "0, 0, 0.4, 0.4", method: "mean" }],
  },
  check_edges: {
    values: { boxes: "0.1, 0.2, 0.5, 0.6\n\n0.5 0.2 0.4 0.6\n{\"left\": 0.1, \"top\": 0.2, \"right\": 1.2, \"bottom\": 0.1}\n1, 2, 3\n# done" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Boxes checked", 4], ["Valid", 1], ["With problems", 3]]);
      assert.deepEqual(result.table, { columns: ["line", "status", "problems"], rows: [[1, "valid", ""], [3, "invalid", "right is not above left"],
        [4, "invalid", "an edge is outside 0 to 1; bottom is not above top"], [5, "invalid", "expected four edges, found 3"]] });
    },
    invalid: [{ boxes: "# nothing\n" }],
  },
  // P1–L1: 0.16 / 0.2 = 0.8; P2–L2: 0.3 × 0.4 = 0.12 / 0.2 = 0.6; P1–L3 = 0.01 / 0.19 (below 0.5); P3 overlaps nothing.
  // 2 matches of 3 predictions and 3 labels: precision = recall = F1 = 2/3, mean IoU 0.7.
  match_boxes: {
    values: { predicted: "0, 0, 0.4, 0.4\n0.5, 0.5, 0.9, 0.9\n0, 0.6, 0.2, 0.8", labeled: "0, 0, 0.4, 0.5\n0.6, 0.5, 1, 0.9\n0.3, 0.3, 0.5, 0.5", threshold: 0.5 },
    expect: (result) => {
      rowsLike(result, [["Matches (true positives)", 2], ["False positives", 1], ["Missed labeled boxes", 1], ["Precision", 2 / 3], ["Recall", 2 / 3], ["F1", 2 / 3], ["Mean IoU of the matches", 0.7]]);
      tableLike(result, ["predicted box", "labeled box", "IoU"], [[1, 1, 0.8], [2, 2, 0.6]]);
    },
    more: [
      // Greedy: P1 takes L1 (IoU 1) over L2 (0.16 / 0.2 = 0.8), leaving L2 missed. F1 = 2 × 1 × 0.5 / 1.5 = 2/3.
      { values: { predicted: "0, 0, 0.4, 0.4", labeled: "0, 0, 0.4, 0.4\n0, 0, 0.4, 0.5", threshold: 0.5 },
        expect: [["Matches (true positives)", 1], ["False positives", 0], ["Missed labeled boxes", 1], ["Precision", 1], ["Recall", 0.5], ["F1", 2 / 3], ["Mean IoU of the matches", 1]] },
      // At 0.9 neither 0.8 nor 0.6 counts.
      { values: { predicted: "0, 0, 0.4, 0.4\n0.5, 0.5, 0.9, 0.9", labeled: "0, 0, 0.4, 0.5\n0.6, 0.5, 1, 0.9", threshold: 0.9 },
        expect: [["Matches (true positives)", 0], ["False positives", 2], ["Missed labeled boxes", 2], ["Precision", 0], ["Recall", 0], ["F1", 0], ["Mean IoU of the matches", null]] },
    ],
    invalid: [{ predicted: "", labeled: "0, 0, 1, 1" }, { predicted: "0, 0, 1, 1", labeled: "0, 0, 1, 1", threshold: 2 }],
  },
  // On 1000 × 500: (0.1 − 0.12) × 1000 = −20, 0, (0.5 − 0.45) × 1000 = 50, (0.6 − 0.7) × 500 = −50; mean |e| = 120 / 4 = 30.
  edge_errors: {
    values: { ...edges("a_", [0.1, 0.2, 0.5, 0.6]), ...edges("b_", [0.12, 0.2, 0.45, 0.7]), width: 1000, height: 500 },
    expect: [["Left error (px)", -20], ["Top error (px)", 0], ["Right error (px)", 50], ["Bottom error (px)", -50], ["Largest edge error (px)", 50], ["Mean absolute edge error (px)", 30]],
  },
  // 3 × 3: center (0.75, 0.15) → column 3, row 1, "top right". The box 0.6..0.9 × 0..0.3 lies in row 1 across columns 2
  // (0.6..2/3: 1/15 of 0.3 = 2/9) and 3 (2/3..0.9: 7/30 of 0.3 = 7/9).
  box_region: {
    values: { ...edges("", [0.6, 0, 0.9, 0.3]), rows: 3, cols: 3 },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Center cell", "row 1, column 3"], ["Center region", "top right"], ["Cells the box touches", 2]]);
      tableLike(result, ["cell", "share of the box"], [["row 1, column 2", 2 / 9], ["row 1, column 3", 7 / 9]]);
    },
    more: [{ values: { ...edges("", [0, 0, 0.5, 0.5]), rows: 4, cols: 2 },
      // Center (0.25, 0.25) sits on the line between rows 1 and 2 and counts below it; no name on a 4 × 2 grid. The box
      // stops at the column line 0.5, so it touches column 1 in rows 1 and 2, half its area each.
      expect: (result) => {
        assert.deepEqual(result.rows, [["Center cell", "row 2, column 1"], ["Center region", null], ["Cells the box touches", 2]]);
        tableLike(result, ["cell", "share of the box"], [["row 1, column 1", 0.5], ["row 2, column 1", 0.5]]);
      } },
    // 2 × 2: center (0.7, 0.2) is in the top row, right column; the box lies wholly in that cell.
    { values: { ...edges("", [0.5, 0, 0.9, 0.4]), rows: 2, cols: 2 },
      expect: (result) => {
        assert.deepEqual(result.rows, [["Center cell", "row 1, column 2"], ["Center region", "top right"], ["Cells the box touches", 1]]);
        tableLike(result, ["cell", "share of the box"], [["row 1, column 2", 1]]);
      } },
    // 3 × 3: center (0.5, 0.5) is the middle cell; the box 0.2..0.8 spans all nine cells, the middle one (wholly inside
    // it) holding (1/9) / 0.36 = 25/81 of it; corners (2/15)² / 0.36 = 4/81, sides 10/81: 4·4 + 4·10 + 25 = 81.
    { values: { ...edges("", [0.2, 0.2, 0.8, 0.8]), rows: 3, cols: 3 },
      expect: (result) => {
        assert.deepEqual(result.rows, [["Center cell", "row 2, column 2"], ["Center region", "middle center"], ["Cells the box touches", 9]]);
        tableLike(result, ["cell", "share of the box"], [1, 2, 3].flatMap((r) => [1, 2, 3].map((c) => [`row ${r}, column ${c}`,
          r === 2 && c === 2 ? 25 / 81 : r === 2 || c === 2 ? 10 / 81 : 4 / 81])));
      } }],
    invalid: [{ ...edges("", [0, 0, 0.5, 0.5]), rows: 0, cols: 2 }],
  },
  // 4000 × 3000: 1568 / 4000 = 0.392 → 1568 × 1176 = 1,843,968 px; × 3 = 5,531,904; × 2 / 8 = 460,992 bytes;
  // base64 4 × 153,664 = 614,656. 200 × 100 is grown to a 280 short side: 560 × 280 = 156,800 px; × 1.5 / 8 = 29,400.
  resized_size: {
    values: { width: 4000, height: 3000, bpp: 2 },
    expect: [["Width sent (px)", 1568], ["Height sent (px)", 1176], ["Megapixels", 1.843968], ["Uncompressed RGB size (bytes)", 5531904],
      ["Estimated JPEG size (bytes)", 460992], ["Estimated base64 size (bytes)", 614656]],
    more: [{ values: { width: 200, height: 100, bpp: 1.5 },
      expect: [["Width sent (px)", 560], ["Height sent (px)", 280], ["Megapixels", 0.1568], ["Uncompressed RGB size (bytes)", 470400],
        ["Estimated JPEG size (bytes)", 29400], ["Estimated base64 size (bytes)", 39200]] }],
    // 3000 × 200 grows to a 280 short side at 1.4 × 3000 = 4200 > 1568: too narrow.
    invalid: [{ width: 3000, height: 200 }, { width: 100, height: 100, bpp: 0 }],
  },
  // 200 KB at 2 bpp allows 1,600,000 bits / 2 = 800,000 px. 1568 × 1176 is 4:3, so w = √(800000 × 4/3) = 1032.8 → 1032 and
  // h = √600000 = 774.6 → 774; 1032 × 774 × 2 / 8 = 199,692 bytes. At 10 KB: 40,000 px, short side √30000 = 173 < 280.
  jpeg_budget: {
    values: { width: 4000, height: 3000, budget: 200, bpp: 2 },
    expect: [["Pixels the budget allows", 800000], ["Width (px)", 1032], ["Height (px)", 774], ["Estimated JPEG size (bytes)", 199692], ["Fits the side limits", "yes"]],
    more: [{ values: { width: 4000, height: 3000, budget: 10, bpp: 2 },
      expect: [["Pixels the budget allows", 40000], ["Width (px)", null], ["Height (px)", null], ["Estimated JPEG size (bytes)", null], ["Fits the side limits", "no"]] },
    // 1000 × 800 needs no resize and 800,000 × 2 / 8 = 200,000 bytes is under 1000 KB.
    { values: { width: 1000, height: 800, budget: 1000, bpp: 2 },
      expect: [["Pixels the budget allows", 4000000], ["Width (px)", 1000], ["Height (px)", 800], ["Estimated JPEG size (bytes)", 200000], ["Fits the side limits", "yes"]] }],
    invalid: [{ width: 4000, height: 3000, bpp: 2 }],
  },
}, { ctx: () => fakeCtx({}) });
