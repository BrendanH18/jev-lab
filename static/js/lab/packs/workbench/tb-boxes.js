// Toolbox: Box geometry ("workbench.toolbox", group "Boxes and pictures"). A Box answer's edges are fractions of the
// picture's width and height (0 to 1, left < right, top < bottom). Every tool is a pure function of what is typed into
// its form: it never reads page data, never sees a picture and never calls the model. The two-box IoU, Box edges to
// pixels and the resize to the side limits live in workbench-toolbox-starter.js and are not repeated here.
import { definePack, toNumber } from "../../kit.js";

const GROUP = "Boxes and pictures";
const EDGE_NAMES = ["left", "top", "right", "bottom"];
const MIN_SIDE = 280;
const MAX_SIDE = 1568;
const EPS = 1e-12;

const need = (condition, message) => { if (!condition) throw new Error(message); };
const FRACTION = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const EDGES = (prefix, name) => EDGE_NAMES.map((edge) => FRACTION(`${prefix}${edge}`, `${name} ${edge} (0 to 1)`));
const PIXELS = (name, label, extra = {}) => ({ name, label, type: "integer", min: 1, ...extra });
const BOXES = (name, label, extra = {}) => ({ name, label, type: "textarea", required: true, rows: 5,
  placeholder: "One box per line: left, top, right, bottom\n0.1, 0.2, 0.5, 0.6\n{\"left\": 0.3, \"top\": 0.3, \"right\": 0.7, \"bottom\": 0.8}", ...extra });
const yesNo = (flag) => (flag ? "yes" : "no");

// ---------- box arithmetic ----------

const width = (b) => b.right - b.left;
const height = (b) => b.bottom - b.top;
const area = (b) => width(b) * height(b);
const center = (b) => [(b.left + b.right) / 2, (b.top + b.bottom) / 2];

function overlap(a, b) {
  const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return box.right > box.left && box.bottom > box.top ? box : null;
}
const interArea = (a, b) => { const box = overlap(a, b); return box ? area(box) : 0; };
const enclose = (list) => ({ left: Math.min(...list.map((b) => b.left)), top: Math.min(...list.map((b) => b.top)),
  right: Math.max(...list.map((b) => b.right)), bottom: Math.max(...list.map((b) => b.bottom)) });
function iou(a, b) {
  const inter = interArea(a, b);
  return inter / (area(a) + area(b) - inter);
}
const edgeRows = (b) => [["Left", b.left], ["Top", b.top], ["Right", b.right], ["Bottom", b.bottom]];

// One box from a form's four edge inputs.
function formBox(params, prefix, name) {
  const b = Object.fromEntries(EDGE_NAMES.map((edge) => [edge, params[`${prefix}${edge}`]]));
  need(b.right > b.left, `${name}: right must be above left.`);
  need(b.bottom > b.top, `${name}: bottom must be above top.`);
  return b;
}

// One typed line as a box, or a list of problems. A line is four numbers (commas, semicolons or spaces between them)
// or a Box answer as JSON: {"left": .., "top": .., "right": .., "bottom": ..}.
function lineBox(line) {
  let values;
  if (line.startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { return { problems: ["not valid JSON"] }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { problems: ["not a Box object"] };
    values = EDGE_NAMES.map((edge) => (typeof parsed[edge] === "number" ? parsed[edge] : null));
    if (values.includes(null)) return { problems: ["needs left, top, right and bottom as numbers"] };
  } else {
    const cells = line.split(/[\s,;]+/).filter(Boolean);
    if (cells.length !== 4) return { problems: [`expected four edges, found ${cells.length}`] };
    values = cells.map(toNumber);
    if (values.includes(null)) return { problems: ["an edge is not a number"] };
  }
  const [left, top, right, bottom] = values;
  const problems = [];
  if (values.some((value) => value < 0 || value > 1)) problems.push("an edge is outside 0 to 1");
  if (!(right > left)) problems.push("right is not above left");
  if (!(bottom > top)) problems.push("bottom is not above top");
  return { box: { left, top, right, bottom }, problems };
}

// The boxes typed one per line; blank lines and lines starting with # are skipped. Throws on the first bad line.
function boxList(text, what, least = 1) {
  const out = [];
  String(text ?? "").split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const { box, problems } = lineBox(line);
    need(!problems.length, `${what}, line ${index + 1}: ${problems.join("; ")}.`);
    out.push(box);
  });
  need(out.length >= least, least === 1 ? `Type at least one box in ${what}.` : `Type at least ${least} boxes in ${what}.`);
  return out;
}

// The app's resize (static/js/common.js prepareImage): shrink so the longest side is at most the max, then grow so the
// shortest side is at least the min; sides are rounded. Too narrow when a side ends above the max.
function resized(w, h) {
  let scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (Math.min(w, h) * scale < MIN_SIDE) scale = MIN_SIDE / Math.min(w, h);
  const out = { width: Math.round(w * scale), height: Math.round(h * scale), scale };
  need(out.width <= MAX_SIDE && out.height <= MAX_SIDE, `Too narrow: no scale keeps both sides between ${MIN_SIDE} and ${MAX_SIDE} pixels. Crop it first.`);
  return out;
}

// ---------- picture orientation ----------

const ROTATE = {
  cw: (b) => ({ left: 1 - b.bottom, top: b.left, right: 1 - b.top, bottom: b.right }),
  half: (b) => ({ left: 1 - b.right, top: 1 - b.bottom, right: 1 - b.left, bottom: 1 - b.top }),
  ccw: (b) => ({ left: b.top, top: 1 - b.right, right: b.bottom, bottom: 1 - b.left }),
};
const FLIP = {
  horizontal: (b) => ({ ...b, left: 1 - b.right, right: 1 - b.left }),
  vertical: (b) => ({ ...b, top: 1 - b.bottom, bottom: 1 - b.top }),
};

const GRID_NAMES = { 2: [["top", "bottom"], ["left", "right"]], 3: [["top", "middle", "bottom"], ["left", "center", "right"]] };

export default definePack({
  id: "tb-boxes",
  surface: "workbench.toolbox",
  title: "Box geometry tools",
  about: "Calculators for Box answers and pictures: shapes, overlap scores, containment, conversions after rotating, flipping, cropping or letterboxing a picture, consensus boxes, matching answers to labeled boxes, and picture sizes. They compute from the edges and sizes you type only; JPEG sizes are estimates.",
  features: [
    { id: "box_area_aspect", kind: "tool", group: GROUP, title: "Area and aspect ratio of a box",
      help: "A box's size in pixels on a picture of a given size, its share of the picture, and its aspect ratio (width ÷ height in pixels, so it is right on pictures that are not square).",
      inputs: [...EDGES("", "Box"), PIXELS("width", "Picture width (px)"), PIXELS("height", "Picture height (px)")],
      compute: (params) => {
        const b = formBox(params, "", "Box");
        const w = width(b) * params.width, h = height(b) * params.height, ratio = w / h;
        return [["Width (px)", w], ["Height (px)", h], ["Area (px²)", w * h], ["Share of the picture", area(b)], ["Aspect ratio (width ÷ height)", ratio],
          ["Shape", Math.abs(ratio - 1) < 1e-9 ? "square" : ratio > 1 ? "wider than tall" : "taller than wide"]];
      } },
    { id: "box_center_size", kind: "tool", group: GROUP, title: "Center and size of a box",
      help: "A box's center and its width and height, all as fractions of the picture: the center-and-size form many labeling tools use.",
      inputs: EDGES("", "Box"),
      compute: (params) => {
        const b = formBox(params, "", "Box");
        const [x, y] = center(b);
        return [["Center x", x], ["Center y", y], ["Width", width(b)], ["Height", height(b)]];
      } },
    { id: "center_to_box", kind: "tool", group: GROUP, title: "Center and size to box edges",
      help: "Edges from a center and a size (fractions of the picture). Edges past the picture are clamped to 0 or 1, and the result says so.",
      inputs: [FRACTION("x", "Center x (0 to 1)"), FRACTION("y", "Center y (0 to 1)"), FRACTION("w", "Width (0 to 1)"), FRACTION("h", "Height (0 to 1)")],
      compute: ({ x, y, w, h }) => {
        need(w > 0 && h > 0, "Width and height must be above 0.");
        const raw = { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 };
        const b = Object.fromEntries(EDGE_NAMES.map((edge) => [edge, Math.min(1, Math.max(0, raw[edge]))]));
        return [...edgeRows(b), ["Clamped to the picture", yesNo(EDGE_NAMES.some((edge) => b[edge] !== raw[edge]))]];
      } },
    { id: "pixels_to_box", kind: "tool", group: GROUP, title: "Pixel box to fractions",
      help: "A box drawn in pixels as Box edges (fractions of width and height). Give it as corner pixels (x1, y1, x2, y2) or as a corner and a size (x, y, width, height).",
      inputs: [{ name: "form", label: "Pixel form", type: "select", options: [["corners", "Corners: x1, y1, x2, y2"], ["size", "Corner and size: x, y, width, height"]] },
        { name: "a", label: "x1 or x (px)", type: "number", min: 0 }, { name: "b", label: "y1 or y (px)", type: "number", min: 0 },
        { name: "c", label: "x2 or box width (px)", type: "number", min: 0 }, { name: "d", label: "y2 or box height (px)", type: "number", min: 0 },
        PIXELS("width", "Picture width (px)"), PIXELS("height", "Picture height (px)")],
      compute: ({ form, a, b, c, d, width: pw, height: ph }) => {
        const right = form === "size" ? a + c : c, bottom = form === "size" ? b + d : d;
        need(right > a && bottom > b, "The box needs a positive width and height.");
        need(right <= pw && bottom <= ph, "The box runs past the picture's right or bottom edge.");
        return edgeRows({ left: a / pw, top: b / ph, right: right / pw, bottom: bottom / ph });
      } },
    { id: "intersection_box", kind: "tool", group: GROUP, title: "Overlap region of two boxes",
      help: "The edges of the region two boxes share, and its area as a share of the picture. Boxes that only touch share no region.",
      inputs: [...EDGES("a_", "Box A"), ...EDGES("b_", "Box B")],
      compute: (params) => {
        const box = overlap(formBox(params, "a_", "Box A"), formBox(params, "b_", "Box B"));
        return [["Overlaps", yesNo(box)], ["Left", box ? box.left : null], ["Top", box ? box.top : null], ["Right", box ? box.right : null],
          ["Bottom", box ? box.bottom : null], ["Area", box ? area(box) : 0]];
      } },
    { id: "box_gap", kind: "tool", group: GROUP, title: "Distance between two boxes",
      help: "How far apart two boxes are in pixels on a picture of a given size: the gaps between their edges (0 when they overlap on that axis), the shortest distance between them, and the distance between their centers.",
      inputs: [...EDGES("a_", "Box A"), ...EDGES("b_", "Box B"), PIXELS("width", "Picture width (px)"), PIXELS("height", "Picture height (px)")],
      compute: (params) => {
        const a = formBox(params, "a_", "Box A"), b = formBox(params, "b_", "Box B");
        const gx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) * params.width;
        const gy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) * params.height;
        const [ax, ay] = center(a), [bx, by] = center(b);
        return [["Horizontal gap (px)", gx], ["Vertical gap (px)", gy], ["Shortest distance (px)", Math.hypot(gx, gy)],
          ["Distance between centers (px)", Math.hypot((ax - bx) * params.width, (ay - by) * params.height)]];
      } },
    { id: "giou", kind: "tool", group: GROUP, title: "Generalized IoU of two boxes",
      help: "GIoU = IoU − (C − U) / C, where U is the union area and C the area of the smallest box around both. Unlike IoU it still ranks boxes that do not overlap: it runs from −1 (far apart) to 1 (identical).",
      inputs: [...EDGES("a_", "Box A"), ...EDGES("b_", "Box B")],
      compute: (params) => {
        const a = formBox(params, "a_", "Box A"), b = formBox(params, "b_", "Box B");
        const inter = interArea(a, b), union = area(a) + area(b) - inter, hull = area(enclose([a, b]));
        const g = inter / union - (hull - union) / hull;
        return [["IoU", inter / union], ["Enclosing box area", hull], ["GIoU", g], ["GIoU loss (1 − GIoU)", 1 - g]];
      } },
    { id: "diou", kind: "tool", group: GROUP, title: "Distance IoU of two boxes",
      help: "DIoU = IoU − d² / c², where d is the distance between the centers and c the diagonal of the smallest box around both, measured in fractions of the picture's width and height. It penalizes boxes whose centers are far apart.",
      inputs: [...EDGES("a_", "Box A"), ...EDGES("b_", "Box B")],
      compute: (params) => {
        const a = formBox(params, "a_", "Box A"), b = formBox(params, "b_", "Box B");
        const [ax, ay] = center(a), [bx, by] = center(b), hull = enclose([a, b]);
        const d2 = (ax - bx) ** 2 + (ay - by) ** 2, c2 = width(hull) ** 2 + height(hull) ** 2, value = iou(a, b);
        return [["IoU", value], ["Squared center distance (d²)", d2], ["Squared enclosing diagonal (c²)", c2], ["DIoU", value - d2 / c2]];
      } },
    { id: "containment", kind: "tool", group: GROUP, title: "How much of one box lies inside another",
      help: "The share of each box's area that lies inside the other, for checking that an answer falls within a region (a label on a package, a face inside a frame) rather than how alike the boxes are.",
      inputs: [...EDGES("a_", "Box A"), ...EDGES("b_", "Box B")],
      compute: (params) => {
        const a = formBox(params, "a_", "Box A"), b = formBox(params, "b_", "Box B"), inter = interArea(a, b);
        return [["Overlap area", inter], ["Share of A inside B", inter / area(a)], ["Share of B inside A", inter / area(b)],
          ["A lies wholly inside B", yesNo(a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom)],
          ["B lies wholly inside A", yesNo(b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom)]];
      } },
    { id: "iou_matrix", kind: "tool", group: GROUP, title: "IoU between every pair of boxes",
      help: "A table of the IoU of every pair among several boxes (for example the same Box question answered by several labelers or variants), with the mean and lowest pairwise IoU as a measure of how well they agree.",
      inputs: [BOXES("boxes", "Boxes")],
      compute: ({ boxes }) => {
        const list = boxList(boxes, "Boxes", 2);
        const pairs = [];
        list.forEach((a, i) => list.forEach((b, j) => { if (j > i) pairs.push({ i, j, value: iou(a, b) }); }));
        const best = pairs.reduce((top, pair) => (pair.value > top.value ? pair : top), pairs[0]);
        const lowest = Math.min(...pairs.map((pair) => pair.value));
        return { rows: [["Boxes", list.length], ["Mean pairwise IoU", pairs.reduce((total, pair) => total + pair.value, 0) / pairs.length],
          ["Lowest pairwise IoU", lowest], ["Most overlapping pair", `${best.i + 1} and ${best.j + 1}`]],
        table: { columns: ["box", ...list.map((_, index) => String(index + 1))], rows: list.map((a, i) => [String(i + 1), ...list.map((b) => iou(a, b))]) } };
      } },
    { id: "expand_box", kind: "tool", group: GROUP, title: "Expand or shrink a box by a margin",
      help: "Moves every edge outward by a margin (inward when the margin is negative), as a share of the box's own width and height or of the picture's, then clamps the box to the picture. Useful before cropping around an answer.",
      inputs: [...EDGES("", "Box"), { name: "margin", label: "Margin per side (negative shrinks)", type: "number", min: -1, max: 10, default: 0.1 },
        { name: "unit", label: "Margin is a share of", type: "select", options: [["box", "the box's width and height"], ["picture", "the picture's width and height"]] }],
      compute: (params) => {
        const b = formBox(params, "", "Box");
        const dx = params.unit === "box" ? params.margin * width(b) : params.margin, dy = params.unit === "box" ? params.margin * height(b) : params.margin;
        const raw = { left: b.left - dx, top: b.top - dy, right: b.right + dx, bottom: b.bottom + dy };
        need(raw.right - raw.left > EPS && raw.bottom - raw.top > EPS, "That margin shrinks the box to nothing.");
        const out = Object.fromEntries(EDGE_NAMES.map((edge) => [edge, Math.min(1, Math.max(0, raw[edge]))]));
        need(out.right > out.left && out.bottom > out.top, "The box ends up outside the picture.");
        return [...edgeRows(out), ["Clamped to the picture", yesNo(EDGE_NAMES.some((edge) => out[edge] !== raw[edge]))]];
      } },
    { id: "clamp_box", kind: "tool", group: GROUP, title: "Clamp a box to the picture",
      help: "Pulls edges that run past the picture (below 0 or above 1, as pixel arithmetic or a margin can produce) back to its border, and says how much of the box stays.",
      inputs: EDGE_NAMES.map((edge) => ({ name: edge, label: `Box ${edge} (any number)`, type: "number" })),
      compute: (raw) => {
        need(raw.right > raw.left && raw.bottom > raw.top, "Right must be above left and bottom above top.");
        const out = Object.fromEntries(EDGE_NAMES.map((edge) => [edge, Math.min(1, Math.max(0, raw[edge]))]));
        need(out.right > out.left && out.bottom > out.top, "The box lies wholly outside the picture.");
        return [...edgeRows(out), ["Edges moved", EDGE_NAMES.filter((edge) => out[edge] !== raw[edge]).length], ["Share of the box kept", area(out) / area(raw)]];
      } },
    { id: "rotate_box", kind: "tool", group: GROUP, title: "Box after rotating the picture",
      help: "Where a box lands when its picture is turned a quarter or half turn, for answers given on a picture that was rotated before or after the call.",
      inputs: [...EDGES("", "Box"), { name: "turn", label: "Picture turned", type: "select", options: [["cw", "90° clockwise"], ["half", "180°"], ["ccw", "90° counterclockwise"]] }],
      compute: (params) => edgeRows(ROTATE[params.turn](formBox(params, "", "Box"))) },
    { id: "flip_box", kind: "tool", group: GROUP, title: "Box after flipping the picture",
      help: "Where a box lands when its picture is mirrored left to right or flipped top to bottom.",
      inputs: [...EDGES("", "Box"), { name: "flip", label: "Flip", type: "select", options: [["horizontal", "Left to right (mirror)"], ["vertical", "Top to bottom"]] }],
      compute: (params) => edgeRows(FLIP[params.flip](formBox(params, "", "Box"))) },
    { id: "crop_box", kind: "tool", group: GROUP, title: "Box after cropping the picture",
      help: "Converts a box between the full picture and a crop of it (the crop's edges as fractions of the full picture). Into the crop, the part outside the crop is cut off and the share kept is reported; back to the full picture, a box found on the crop is placed on the original.",
      inputs: [...EDGES("", "Box"), ...EDGES("c_", "Crop"),
        { name: "direction", label: "Direction", type: "select", options: [["in", "Full picture to the crop"], ["out", "Crop back to the full picture"]] }],
      compute: (params) => {
        const b = formBox(params, "", "Box"), c = formBox(params, "c_", "Crop"), cw = width(c), ch = height(c);
        if (params.direction === "out") {
          return [...edgeRows({ left: c.left + b.left * cw, top: c.top + b.top * ch, right: c.left + b.right * cw, bottom: c.top + b.bottom * ch }), ["Share of the box kept", 1]];
        }
        const kept = overlap(b, c);
        need(kept, "The box lies outside the crop.");
        return [...edgeRows({ left: (kept.left - c.left) / cw, top: (kept.top - c.top) / ch, right: (kept.right - c.left) / cw, bottom: (kept.bottom - c.top) / ch }),
          ["Share of the box kept", area(kept) / area(b)]];
      } },
    { id: "letterbox_box", kind: "tool", group: GROUP, title: "Box after letterboxing the picture",
      help: "A picture scaled to fit a canvas without changing its shape and centered, with bars filling the rest. Converts a box between the original picture and the padded canvas, and gives the scale and bar sizes.",
      inputs: [...EDGES("", "Box"), PIXELS("width", "Picture width (px)"), PIXELS("height", "Picture height (px)"),
        PIXELS("canvasWidth", "Canvas width (px)", { default: MAX_SIDE }), PIXELS("canvasHeight", "Canvas height (px)", { default: MAX_SIDE }),
        { name: "direction", label: "Direction", type: "select", options: [["in", "Original picture to the canvas"], ["out", "Canvas back to the original picture"]] }],
      compute: (params) => {
        const b = formBox(params, "", "Box"), { width: pw, height: ph, canvasWidth: cw, canvasHeight: ch } = params;
        const scale = Math.min(cw / pw, ch / ph), sw = pw * scale, sh = ph * scale, padX = (cw - sw) / 2, padY = (ch - sh) / 2;
        let out;
        if (params.direction === "in") out = { left: (padX + b.left * sw) / cw, top: (padY + b.top * sh) / ch, right: (padX + b.right * sw) / cw, bottom: (padY + b.bottom * sh) / ch };
        else {
          const raw = { left: (b.left * cw - padX) / sw, top: (b.top * ch - padY) / sh, right: (b.right * cw - padX) / sw, bottom: (b.bottom * ch - padY) / sh };
          out = Object.fromEntries(EDGE_NAMES.map((edge) => [edge, Math.min(1, Math.max(0, raw[edge]))]));
          need(out.right > out.left && out.bottom > out.top, "The box lies wholly on the bars, outside the picture.");
        }
        return [...edgeRows(out), ["Scale", scale], ["Bar on each side (px)", padX], ["Bar above and below (px)", padY]];
      } },
    { id: "enclosing_box", kind: "tool", group: GROUP, title: "Smallest box around several boxes",
      help: "The tightest box that holds every box listed, for cropping around several answers at once.",
      inputs: [BOXES("boxes", "Boxes")],
      compute: ({ boxes }) => {
        const list = boxList(boxes, "Boxes");
        const hull = enclose(list);
        return [...edgeRows(hull), ["Area", area(hull)], ["Boxes", list.length]];
      } },
    { id: "consensus_box", kind: "tool", group: GROUP, title: "Consensus of several boxes",
      help: "One box from several (labelers or variants answering the same Box question): each edge is the mean or the median of that edge. Also gives how well each box agrees with the consensus by IoU.",
      inputs: [BOXES("boxes", "Boxes"), { name: "method", label: "Combine edges by", type: "select", options: [["mean", "Mean"], ["median", "Median"]] }],
      compute: ({ boxes, method }) => {
        const list = boxList(boxes, "Boxes", 2);
        const pick = (values) => {
          if (method === "mean") return values.reduce((total, value) => total + value, 0) / values.length;
          const sorted = [...values].sort((x, y) => x - y), middle = sorted.length >> 1;
          return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        };
        const consensus = Object.fromEntries(EDGE_NAMES.map((edge) => [edge, pick(list.map((b) => b[edge]))]));
        const scores = list.map((b) => iou(b, consensus));
        const worst = scores.indexOf(Math.min(...scores));
        return [...edgeRows(consensus), ["Mean IoU with the consensus", scores.reduce((total, value) => total + value, 0) / scores.length],
          ["Lowest IoU with the consensus", scores[worst]], ["Box farthest from the consensus", worst + 1]];
      } },
    { id: "check_edges", kind: "tool", group: GROUP, title: "Check that box edges are valid",
      help: "Checks each typed box (four numbers or a Box answer's JSON per line) for edges outside 0 to 1, right not above left and bottom not above top, and lists the problems by line.",
      inputs: [BOXES("boxes", "Boxes")],
      compute: ({ boxes }) => {
        const rows = [];
        String(boxes ?? "").split(/\r\n|\r|\n/).forEach((raw, index) => {
          const line = raw.trim();
          if (!line || line.startsWith("#")) return;
          const { problems } = lineBox(line);
          rows.push([index + 1, problems.length ? "invalid" : "valid", problems.join("; ")]);
        });
        need(rows.length > 0, "Type at least one box.");
        const bad = rows.filter((row) => row[1] === "invalid").length;
        return { rows: [["Boxes checked", rows.length], ["Valid", rows.length - bad], ["With problems", bad]], table: { columns: ["line", "status", "problems"], rows } };
      } },
    { id: "match_boxes", kind: "tool", group: GROUP, title: "Match predicted boxes to labeled boxes",
      help: "Pairs predicted boxes with labeled boxes by IoU, greedily from the highest IoU down, each box used once and a pair counting only at or above the threshold. Unmatched predictions are false positives and unmatched labels are misses.",
      inputs: [BOXES("predicted", "Predicted boxes"), BOXES("labeled", "Labeled boxes"), FRACTION("threshold", "IoU threshold", { default: 0.5 })],
      compute: ({ predicted, labeled, threshold }) => {
        const preds = boxList(predicted, "Predicted boxes"), labels = boxList(labeled, "Labeled boxes");
        const pairs = [];
        preds.forEach((p, i) => labels.forEach((l, j) => { const value = iou(p, l); if (value >= threshold && value > 0) pairs.push({ i, j, value }); }));
        pairs.sort((x, y) => y.value - x.value || x.i - y.i || x.j - y.j);
        const usedP = new Set(), usedL = new Set(), matches = [];
        for (const pair of pairs) {
          if (usedP.has(pair.i) || usedL.has(pair.j)) continue;
          usedP.add(pair.i); usedL.add(pair.j); matches.push(pair);
        }
        const tp = matches.length, precision = tp / preds.length, recall = tp / labels.length;
        return { rows: [["Matches (true positives)", tp], ["False positives", preds.length - tp], ["Missed labeled boxes", labels.length - tp],
          ["Precision", precision], ["Recall", recall], ["F1", tp ? 2 * precision * recall / (precision + recall) : 0],
          ["Mean IoU of the matches", tp ? matches.reduce((total, pair) => total + pair.value, 0) / tp : null]],
        table: { columns: ["predicted box", "labeled box", "IoU"], rows: matches.map((pair) => [pair.i + 1, pair.j + 1, pair.value]) } };
      } },
    { id: "edge_errors", kind: "tool", group: GROUP, title: "Edge errors of a Box answer",
      help: "How far each edge of an answer is from the labeled box, in pixels on a picture of a given size (positive: the answer's edge is right of or below the label's), with the largest and the mean absolute error. Complements IoU when a fixed pixel tolerance matters.",
      inputs: [...EDGES("a_", "Answer"), ...EDGES("b_", "Labeled box"), PIXELS("width", "Picture width (px)"), PIXELS("height", "Picture height (px)")],
      compute: (params) => {
        const a = formBox(params, "a_", "Answer"), b = formBox(params, "b_", "Labeled box");
        const errors = EDGE_NAMES.map((edge) => (a[edge] - b[edge]) * (edge === "left" || edge === "right" ? params.width : params.height));
        const absolute = errors.map(Math.abs);
        return [["Left error (px)", errors[0]], ["Top error (px)", errors[1]], ["Right error (px)", errors[2]], ["Bottom error (px)", errors[3]],
          ["Largest edge error (px)", Math.max(...absolute)], ["Mean absolute edge error (px)", absolute.reduce((total, value) => total + value, 0) / 4]];
      } },
    { id: "box_region", kind: "tool", group: GROUP, title: "Grid cells a box covers",
      help: "Lays a grid over the picture and gives the cell holding the box's center (a center on a grid line counts in the cell right of or below it), its name on a 2×2 or 3×3 grid (\"top right\"), and how much of the box falls in each cell it touches. Useful for turning Box answers into coarse location labels.",
      inputs: [...EDGES("", "Box"), { name: "rows", label: "Grid rows", type: "integer", min: 1, max: 12, default: 3 }, { name: "cols", label: "Grid columns", type: "integer", min: 1, max: 12, default: 3 }],
      compute: (params) => {
        const b = formBox(params, "", "Box"), { rows, cols } = params;
        const [x, y] = center(b);
        const row = Math.min(rows - 1, Math.floor(y * rows + EPS)), col = Math.min(cols - 1, Math.floor(x * cols + EPS));
        const names = rows === cols && GRID_NAMES[rows] ? `${GRID_NAMES[rows][0][row]} ${GRID_NAMES[rows][1][col]}` : null;
        const cells = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const shared = interArea(b, { left: c / cols, top: r / rows, right: (c + 1) / cols, bottom: (r + 1) / rows });
            if (shared > EPS) cells.push([`row ${r + 1}, column ${c + 1}`, shared / area(b)]);
          }
        }
        return { rows: [["Center cell", `row ${row + 1}, column ${col + 1}`], ["Center region", names], ["Cells the box touches", cells.length]],
          table: { columns: ["cell", "share of the box"], rows: cells } };
      } },
    { id: "resized_size", kind: "tool", group: GROUP, title: "Megapixels and JPEG size of a resized picture",
      help: "The size a picture is sent at after the app's resize to sides of 280 to 1568 pixels, its megapixels, its uncompressed size, and an estimated JPEG size (and its base64 size inside a request) at an assumed bits per pixel. Real JPEG sizes depend on the picture; measure one of yours to set the assumption.",
      inputs: [PIXELS("width", "Original width (px)"), PIXELS("height", "Original height (px)"), { name: "bpp", label: "Bits per pixel (assumption)", type: "number", min: 0.01, max: 24, default: 2 }],
      compute: ({ width: w, height: h, bpp }) => {
        const out = resized(w, h), pixels = out.width * out.height, jpeg = Math.ceil(pixels * bpp / 8);
        return { rows: [["Width sent (px)", out.width], ["Height sent (px)", out.height], ["Megapixels", pixels / 1e6], ["Uncompressed RGB size (bytes)", pixels * 3],
          ["Estimated JPEG size (bytes)", jpeg], ["Estimated base64 size (bytes)", 4 * Math.ceil(jpeg / 3)]], note: `An estimate at ${bpp} bits per pixel, not a measured file size.` };
      } },
    { id: "jpeg_budget", kind: "tool", group: GROUP, title: "Largest picture under a JPEG size budget",
      help: "The largest size, keeping the picture's shape and the side limits (280 to 1568 pixels), whose estimated JPEG size fits a byte budget at an assumed bits per pixel. Says when even the smallest allowed size is over budget.",
      inputs: [PIXELS("width", "Original width (px)"), PIXELS("height", "Original height (px)"), { name: "budget", label: "Size budget (KB, 1 KB = 1,000 bytes)", type: "number", min: 0.001 },
        { name: "bpp", label: "Bits per pixel (assumption)", type: "number", min: 0.01, max: 24, default: 2 }],
      compute: ({ width: w, height: h, budget, bpp }) => {
        const start = resized(w, h), allowed = budget * 1000 * 8 / bpp;
        let out = { width: start.width, height: start.height };
        if (out.width * out.height > allowed) {
          const scale = Math.sqrt(allowed / (start.width * start.height));
          out = { width: Math.floor(start.width * scale + EPS), height: Math.floor(start.height * scale + EPS) };
        }
        const fits = Math.min(out.width, out.height) >= MIN_SIDE;
        return { rows: [["Pixels the budget allows", Math.floor(allowed + EPS)], ["Width (px)", fits ? out.width : null], ["Height (px)", fits ? out.height : null],
          ["Estimated JPEG size (bytes)", fits ? Math.ceil(out.width * out.height * bpp / 8) : null], ["Fits the side limits", yesNo(fits)]],
        note: fits ? `An estimate at ${bpp} bits per pixel.` : `Over budget even with the shortest side at ${MIN_SIDE} pixels: raise the budget or lower the bits per pixel.` };
      } },
  ],
});
