// More facts, advisory checks, metrics and Box exports for the answers of the user's own latest Claims check (surface
// "claims.result"; contract: static/js/lab/surfaces/claims.js). Flip points are plain local arithmetic on the policy in
// force and the sliders' step grid: advisory, never Jev's answer and never the page's decision (that is data.verdict).
// Box exports hold the RAW edges Jev returned (not the padded box the page draws) converted to common formats; they
// hold coordinates only, never the picture's bytes. Pixel formats use one rounding rule: each product of a fraction and
// the picture's size is rounded to 6 decimals, the left/top edge is floored, the right/bottom edge is ceiled, and both
// are clamped to the picture.
import { csvText, definePack } from "../../kit.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const two = (value) => value.toFixed(2);
const pct = (value) => `${Math.round(value * 100)}%`;
const byId = (items, id) => (Array.isArray(items) ? items.find((item) => item?.id === id) || null : null);
const probs = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => entry && num(entry.p) !== null) : []);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

// The value a cut reads: the Box cut (box_confidence) compares with the answer's confidence, every other cut with the value.
const cutBase = (item) => (item?.type === "box" ? num(item.confidence) : num(item?.value));

// The slider value at which a rule "passes at base >= at" changes sides: the first grid step above base while it passes,
// the last grid step at or below base while it fails. null when that lies outside the slider.
function flipAt(base, at, limit) {
  if (!limit || !(num(limit.step) > 0) || num(limit.min) === null || num(limit.max) === null) return null;
  const steps = Math.floor((base - limit.min) / limit.step + 1e-9) + (base >= at ? 1 : 0);
  const next = Number((limit.min + steps * limit.step).toFixed(2));
  return next < limit.min - 1e-9 || next > limit.max + 1e-9 ? null : next;
}

// Every cut that reads this answer with its flip point: [{ key, at, base, side, flip, steps }].
function cutRows(item, ctx) {
  const base = cutBase(item);
  if (base === null || !Array.isArray(item?.cuts)) return [];
  const limits = ctx?.data?.limits || {};
  return item.cuts.filter((cut) => num(cut?.at) !== null).map((cut) => {
    const limit = limits[cut.key];
    const flip = flipAt(base, cut.at, limit);
    return { key: cut.key, at: cut.at, base, side: base >= cut.at ? "at or above" : "below", flip,
      steps: flip === null ? null : Math.round(Math.abs(flip - cut.at) / limit.step) };
  });
}

// The cut that changes sides with the fewest slider steps (the first one on a tie), or null.
function closestFlip(item, ctx) {
  let best = null;
  for (const row of cutRows(item, ctx)) if (row.steps !== null && (!best || row.steps < best.steps)) best = row;
  return best;
}

// Shannon entropy in bits of an answer's distribution (normalized to sum to 1); null without one.
function entropyBits(item) {
  const ps = probs(item).map((entry) => entry.p).filter((p) => p >= 0);
  const total = ps.reduce((sum, p) => sum + p, 0);
  if (ps.length < 2 || !(total > 0)) return null;
  return ps.reduce((sum, p) => (p > 0 ? sum - (p / total) * Math.log2(p / total) : sum), 0);
}

// The largest share one side holds: max(P, 1 - P) for a noul, the top probability otherwise.
function strongest(item) {
  if (item?.type === "noul") return num(item.value) === null ? null : Math.max(item.value, 1 - item.value);
  const ps = probs(item).map((entry) => entry.p);
  return ps.length ? Math.max(...ps) : null;
}

// A raw answer's number: P(yes) for a noul, the score for a score.
const rawNumber = (answer) => (!isObject(answer) ? null : answer.type === "noul" ? num(answer.noul) : answer.type === "score" ? num(answer.score) : null);

// This session's earlier check of the same order, note (trimmed) and sample photo. The newest such entry is the shown
// check itself, so the one before it is the earlier check. Uploads have no identity beyond a file name: never matched.
function earlierCheck(ctx) {
  const input = ctx?.data?.input, history = ctx?.data?.history;
  if (!input || input.photo?.source !== "sample" || !Array.isArray(history)) return null;
  const same = history.filter((entry) => entry && entry.order === input.order && typeof entry.note === "string" && entry.note.trim() === input.note.trim()
    && entry.photo?.source === "sample" && entry.photo.name === input.photo.name);
  return same.length >= 2 ? same[same.length - 2] : null;
}

// Score levels as [[level, p], ...] with whole-number keys.
const levelsOf = (item) => probs(item).flatMap((entry) => (/^\d+$/.test(String(entry.key)) ? [[Number(entry.key), entry.p]] : []));

const area = (box) => (box ? Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top) : null);
const rawBox = (ctx) => {
  const box = byId(ctx.items(), "damage_box")?.box;
  return box && ["left", "top", "right", "bottom"].every((edge) => num(box[edge]) !== null) ? box : null;
};

function requireBox(ctx) {
  const box = rawBox(ctx);
  if (!box) throw new Error("There is no Box answer to export: check a claim first, with a model that answers Box questions (Jev 1.14 or later).");
  const edges = { left: clamp01(box.left), top: clamp01(box.top), right: clamp01(box.right), bottom: clamp01(box.bottom) };
  if (edges.right <= edges.left || edges.bottom <= edges.top) throw new Error("The raw box has no area inside the picture.");
  return edges;
}

// The raw box in whole pixels of the picture the server sent: { x0, y0, x1, y1, width, height, W, H }.
function pixelBox(ctx) {
  const box = requireBox(ctx);
  const W = num(ctx.data.image?.width), H = num(ctx.data.image?.height);
  if (!(W > 0) || !(H > 0)) throw new Error("The picture's size is unknown, so the box cannot be given in pixels.");
  const at = (fraction, size) => Number((fraction * size).toFixed(6));
  const x0 = Math.min(W, Math.max(0, Math.floor(at(box.left, W)))), y0 = Math.min(H, Math.max(0, Math.floor(at(box.top, H))));
  const x1 = Math.min(W, Math.max(0, Math.ceil(at(box.right, W)))), y1 = Math.min(H, Math.max(0, Math.ceil(at(box.bottom, H))));
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0, W, H };
}

const orderOf = (ctx) => ctx.data.input?.order || ctx.data.facts?.order || "";
const boxFile = (suffix, ext) => (ctx) => (/^[A-Za-z0-9-]+$/.test(orderOf(ctx)) ? `claim-box-${orderOf(ctx)}-${suffix}.${ext}` : `claim-box-${suffix}.${ext}`);
const photoName = (ctx) => ctx.data.input?.photo?.name || "photo";
const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fixed6 = (value) => value.toFixed(6);
const percentOf = (fraction) => Number((fraction * 100).toFixed(4));

const REGION_ROWS = ["top", "middle", "bottom"], REGION_COLUMNS = ["left", "centre", "right"];
const third = (value) => (value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2);

export default definePack({
  id: "claims-result-more",
  surface: "claims.result",
  title: "Claim margins and Box formats",
  about: "Flip points, entropy, repeat-check changes and advisory checks for the answers of your own latest Claims check, plus Box geometry metrics and the raw Box in COCO, YOLO, Pascal VOC, Label Studio, SVG, ImageMagick and Python formats. Flip points are plain arithmetic on the policy in force, never the page's decision; Box exports hold coordinates only, never picture bytes.",
  features: [
    { id: "entropy_bits", kind: "fact", type: "number", label: "answer entropy in bits",
      help: "Shannon entropy of the answer's probabilities: 0 when one option holds everything, 1 bit for a 50/50 yes or no. None for the Box.",
      value: (item) => entropyBits(item) },
    { id: "flip_point", kind: "fact", type: "number", label: "slider value where the closest cut flips",
      help: "The step of the slider reading this answer at which its rule changes sides (the Box's padding rule reads confidence). Plain arithmetic, advisory.",
      value: (item, ctx) => closestFlip(item, ctx)?.flip ?? null },
    { id: "steps_to_flip", kind: "fact", type: "number", label: "slider steps to a flip",
      help: "How many steps that slider must move from the policy in force before the rule reading this answer changes sides. Plain arithmetic, advisory.",
      value: (item, ctx) => closestFlip(item, ctx)?.steps ?? null },
    { id: "repeat_change", kind: "fact", type: "number", label: "change since an earlier check of the same claim",
      help: "This answer minus the same answer in your previous check of this session with the same order, note and sample photo (yes probabilities and scores).",
      value: (item, ctx) => {
        const now = num(item?.value), earlier = earlierCheck(ctx);
        if (now === null || !earlier) return null;
        const before = rawNumber(isObject(earlier.answers) ? earlier.answers[item.id] : null);
        return before === null || earlier.answers[item.id].type !== item.type ? null : now - before;
      } },
    { id: "decisive", kind: "fact", type: "flag", label: "a decisive answer (90% or more one way)",
      value: (item) => { const share = strongest(item); return share !== null && share >= 0.9 - 1e-9; } },
    { id: "decision_level", kind: "fact", type: "flag", label: "a failing check at the decision's level",
      help: "The plain-code check reading this answer failed at the level the shown decision took.",
      value: (item, ctx) => !!item?.check && item.check.ok === false && !!ctx?.data?.verdict && item.check.level === ctx.data.verdict.decision },

    { id: "severity_split", kind: "diagnostic", label: "Severity split between far-apart levels", severity: "advice",
      check: (item) => {
        if (item?.type !== "score") return null;
        const strong = levelsOf(item).filter(([, p]) => p >= 0.25 - 1e-9).sort((a, b) => a[0] - b[0]);
        if (strong.length < 2 || strong[strong.length - 1][0] - strong[0][0] < 2) return null;
        const [low, high] = [strong[0], strong[strong.length - 1]];
        return `levels ${low[0]} (${pct(low[1])}) and ${high[0]} (${pct(high[1])}) each hold at least 25%: the score averages two far-apart readings.`;
      } },
    { id: "score_vs_mode", kind: "diagnostic", label: "Printed severity level is not the most likely level", severity: "advice",
      check: (item) => {
        if (item?.type !== "score" || num(item.value) === null) return null;
        let mode = null;
        for (const entry of levelsOf(item)) if (!mode || entry[1] > mode[1]) mode = entry;
        const printed = Math.round(item.value);
        return mode && mode[0] !== printed
          ? `the page prints level ${printed} (rounded from ${two(item.value)}) while level ${mode[0]} is the most likely (${pct(mode[1])}).` : null;
      } },
    { id: "kind_without_damage", kind: "diagnostic", scope: "list", label: "Damage kind named while damage reads below the retake cut", severity: "advice",
      check: (items, ctx) => {
        const kind = byId(items, "damage_kind"), damage = byId(items, "damage_visible"), no = num(ctx?.data?.policy?.damage_no);
        if (!kind || typeof kind.value !== "string" || kind.value === "none_visible" || num(damage?.value) === null || no === null) return null;
        const p = probs(kind).find((entry) => entry.key === kind.value)?.p ?? null;
        return p !== null && p >= 0.5 && damage.value < no
          ? `damage_kind is ${kind.value} at ${pct(p)} but damage_visible ${two(damage.value)} is below the retake cut ${two(no)}.` : null;
      } },
    { id: "damage_without_severity", kind: "diagnostic", scope: "list", label: "Damage reads visible while severity is near None", severity: "advice",
      check: (items, ctx) => {
        const damage = byId(items, "damage_visible"), severity = byId(items, "severity"), yes = num(ctx?.data?.policy?.damage_yes);
        return num(damage?.value) !== null && num(severity?.value) !== null && yes !== null && damage.value >= yes && severity.value < 0.5
          ? `damage_visible ${two(damage.value)} is at or above ${two(yes)} but severity is only ${two(severity.value)}.` : null;
      } },
    { id: "box_at_border", kind: "diagnostic", label: "Box touches the picture's edge", severity: "info",
      check: (item) => {
        const box = item?.type === "box" ? item.box : null;
        if (!box) return null;
        const sides = [["left", box.left <= 0.01], ["top", box.top <= 0.01], ["right", box.right >= 0.99], ["bottom", box.bottom >= 0.99]]
          .filter(([, near]) => near).map(([side]) => side);
        return sides.length ? `the raw box reaches the ${sides.join(" and ")} edge${sides.length === 1 ? "" : "s"} (within 1%): the damage may continue outside the frame.` : null;
      } },
    { id: "box_tiny", kind: "diagnostic", label: "Box covers under 1% of the photo", severity: "info",
      check: (item) => {
        const size = item?.type === "box" ? area(item.box) : null;
        return size !== null && size < 0.01 ? `the raw box covers ${(size * 100).toFixed(1)}% of the picture: make sure it marks the damage, not a speck.` : null;
      } },
    { id: "box_hidden_by_policy", kind: "diagnostic", scope: "list", label: "Box hidden by the policy", severity: "info",
      check: (items, ctx) => {
        const location = ctx?.data?.location, damage = num(ctx?.data?.evidence?.damage), no = num(ctx?.data?.policy?.damage_no);
        if (!items.length || !location || location.shown !== false || !isObject(location.box)) return null;
        return `Jev returned a box, but the policy hides it${damage !== null && no !== null ? `: damage_visible ${two(damage)} is below damage_no ${two(no)}` : ""}. Box exports still hold the raw edges.`;
      } },
    { id: "blank_note", kind: "diagnostic", scope: "list", label: "Note was blank when matches_note was asked", severity: "advice",
      check: (items, ctx) => {
        const note = ctx?.data?.input?.note, matches = byId(items, "matches_note");
        return typeof note === "string" && note.trim() === "" && matches
          ? `the customer's note was blank, so matches_note${num(matches.value) === null ? "" : ` (${two(matches.value)})`} compared the photo with no description.` : null;
      } },
    { id: "note_names_other_order", kind: "diagnostic", scope: "list", label: "Note names a different order", severity: "advice",
      check: (items, ctx) => {
        const note = ctx?.data?.input?.note, order = orderOf(ctx);
        if (!items.length || typeof note !== "string" || !order) return null;
        const others = [...new Set(note.match(/\bA-\d{4}\b/g) || [])].filter((id) => id !== order);
        return others.length ? `the note mentions ${others.join(", ")}, but this check was filed against ${order}.` : null;
      } },

    { id: "limit_headroom", kind: "metric", label: "automatic-limit headroom for this refund", format: "usd",
      help: "The automatic limit in force minus the refund amount of the shown decision; negative when the refund is over the limit.",
      compute: (ctx) => {
        const verdict = ctx.data.verdict, limit = num(ctx.data.policy?.auto_limit_usd), amount = num(verdict?.amount);
        if (!verdict || verdict.decision === "reject" || limit === null || amount === null) return null;
        return { value: Math.round((limit - amount) * 100) / 100, detail: `$${two(amount)} against a $${two(limit)} limit` };
      } },
    { id: "box_region", kind: "metric", label: "where the raw box sits in the photo", format: "text",
      help: "The cell of a 3 × 3 grid that holds the centre of the box Jev returned.",
      compute: (ctx) => {
        const box = rawBox(ctx);
        if (!box) return null;
        const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
        const row = REGION_ROWS[third(y)], column = REGION_COLUMNS[third(x)];
        return { value: row === "middle" && column === "centre" ? "centre" : `${row} ${column}`, detail: `centre at ${pct(x)} across, ${pct(y)} down` };
      } },
    { id: "box_overlap_drawn", kind: "metric", label: "overlap of the raw and drawn box (IoU)", format: "percent",
      help: "Intersection over union of the box Jev returned and the box the page draws after padding; unavailable while the policy hides it.",
      compute: (ctx) => {
        const raw = rawBox(ctx), location = ctx.data.location;
        if (!raw || !location?.shown || !isObject(location.box)) return null;
        const drawn = location.box;
        const inter = Math.max(0, Math.min(raw.right, drawn.right) - Math.max(raw.left, drawn.left)) * Math.max(0, Math.min(raw.bottom, drawn.bottom) - Math.max(raw.top, drawn.top));
        const union = area(raw) + area(drawn) - inter;
        return union > 0 ? { value: inter / union, detail: location.padded ? "padded box" : "drawn as returned" } : null;
      } },
    { id: "severity_partial_or_worse", kind: "metric", label: "severity level 2 or higher (Partial or worse)", format: "percent",
      help: "The probability the severity answer puts on levels 2 and 3.",
      compute: (ctx) => {
        const levels = levelsOf(byId(ctx.items(), "severity"));
        return levels.length ? levels.filter(([level]) => level >= 2).reduce((sum, [, p]) => sum + p, 0) : null;
      } },
    { id: "kind_any_damage", kind: "metric", label: "damage kind other than none visible", format: "percent",
      help: "The probability the damage_kind answer puts on any kind of damage.",
      compute: (ctx) => {
        const entries = probs(byId(ctx.items(), "damage_kind"));
        return entries.length ? entries.filter((entry) => entry.key !== "none_visible").reduce((sum, entry) => sum + entry.p, 0) : null;
      } },

    { id: "box_fractions_json", kind: "exporter", label: "Box edges as JSON", help: "the raw edges and confidence Jev returned, and the box the page draws (or why it is hidden); coordinates only",
      filename: boxFile("edges", "json"), mime: "application/json",
      build: (ctx) => {
        const raw = requireBox(ctx), item = byId(ctx.items(), "damage_box"), location = ctx.data.location || {};
        const drawn = location.shown && isObject(location.box)
          ? { shown: true, padded: location.padded === true, tentative: location.tentative === true, ...location.box }
          : { shown: false, reason: location.reason || null };
        return `${JSON.stringify({ order: orderOf(ctx) || null, picture: { width: num(ctx.data.image?.width), height: num(ctx.data.image?.height) },
          raw: { ...raw, confidence: num(item?.confidence) }, drawn }, null, 2)}\n`;
      } },
    { id: "box_coco", kind: "exporter", label: "Box as COCO JSON", help: "one image and one 'damage' annotation with the raw box in pixels; coordinates only",
      filename: boxFile("coco", "json"), mime: "application/json",
      build: (ctx) => {
        const px = pixelBox(ctx);
        return `${JSON.stringify({ images: [{ id: 1, file_name: photoName(ctx), width: px.W, height: px.H }],
          annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [px.x0, px.y0, px.width, px.height], area: px.width * px.height, iscrowd: 0 }],
          categories: [{ id: 1, name: "damage" }] }, null, 2)}\n`;
      } },
    { id: "box_yolo", kind: "exporter", label: "Box as a YOLO label line", help: "class 0 (damage), then centre x, centre y, width and height as fractions of the picture; coordinates only",
      filename: boxFile("yolo", "txt"),
      build: (ctx) => {
        const box = requireBox(ctx);
        return `0 ${[(box.left + box.right) / 2, (box.top + box.bottom) / 2, box.right - box.left, box.bottom - box.top].map(fixed6).join(" ")}\n`;
      } },
    { id: "box_voc_xml", kind: "exporter", label: "Box as Pascal VOC XML", help: "the picture's name and size and one 'damage' object with the raw box in pixels; coordinates only",
      filename: boxFile("voc", "xml"), mime: "application/xml",
      build: (ctx) => {
        const px = pixelBox(ctx);
        return ["<annotation>", `  <filename>${xml(photoName(ctx))}</filename>`, `  <size><width>${px.W}</width><height>${px.H}</height></size>`,
          "  <object>", "    <name>damage</name>",
          `    <bndbox><xmin>${px.x0}</xmin><ymin>${px.y0}</ymin><xmax>${px.x1}</xmax><ymax>${px.y1}</ymax></bndbox>`,
          "  </object>", "</annotation>", ""].join("\n");
      } },
    { id: "box_label_studio", kind: "exporter", label: "Box as a Label Studio rectangle", help: "a rectanglelabels result with the raw box in percent of the picture; coordinates only",
      filename: boxFile("label-studio", "json"), mime: "application/json",
      build: (ctx) => {
        const box = requireBox(ctx);
        return `${JSON.stringify([{ from_name: "label", to_name: "image", type: "rectanglelabels",
          original_width: num(ctx.data.image?.width), original_height: num(ctx.data.image?.height),
          value: { x: percentOf(box.left), y: percentOf(box.top), width: percentOf(box.right - box.left), height: percentOf(box.bottom - box.top),
            rotation: 0, rectanglelabels: ["damage"] } }], null, 2)}\n`;
      } },
    { id: "box_svg", kind: "exporter", label: "Box as an SVG overlay", help: "an outline of the raw box in the picture's pixel size, to lay over the photo; no picture inside",
      filename: boxFile("overlay", "svg"), mime: "image/svg+xml",
      build: (ctx) => {
        const px = pixelBox(ctx);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px.W} ${px.H}" width="${px.W}" height="${px.H}">\n`
          + `  <rect x="${px.x0}" y="${px.y0}" width="${px.width}" height="${px.height}" fill="none" stroke="#d33" stroke-width="3"/>\n</svg>\n`;
      } },
    { id: "box_imagemagick", kind: "exporter", label: "Box as an ImageMagick crop", help: "a crop command for the raw box in pixels; the picture travels separately",
      filename: boxFile("crop", "sh"),
      build: (ctx) => {
        const px = pixelBox(ctx);
        return `# Raw damage box of your own check on ${orderOf(ctx) || "this order"}, in pixels of the ${px.W}x${px.H} picture Jev saw.\n`
          + `magick photo.${ctx.data.image?.format === "jpeg" ? "jpg" : ctx.data.image?.format || "png"} -crop ${px.width}x${px.height}+${px.x0}+${px.y0} +repage damage.png\n`;
      } },
    { id: "box_python", kind: "exporter", label: "Box as Python crop code", help: "a Pillow crop tuple and a NumPy slice for the raw box in pixels; the picture travels separately",
      filename: boxFile("crop", "py"), mime: "text/x-python",
      build: (ctx) => {
        const px = pixelBox(ctx);
        return [`# Raw damage box of your own check on ${orderOf(ctx) || "this order"}, in pixels of the ${px.W}x${px.H} picture Jev saw.`,
          `BOX = (${px.x0}, ${px.y0}, ${px.x1}, ${px.y1})  # left, upper, right, lower`,
          "# Pillow:        image.crop(BOX)",
          `# NumPy / OpenCV: array[${px.y0}:${px.y1}, ${px.x0}:${px.x1}]`, ""].join("\n");
      } },
    { id: "flip_points_csv", kind: "exporter", label: "Flip points as CSV", help: "each answer value read by a policy cut, the cut, its side and the slider value where it flips; holds answer values, plain arithmetic, advisory",
      filename: "claim-flip-points.csv", mime: "text/csv",
      build: (ctx) => {
        if (!ctx.data.policy || !ctx.items().length) throw new Error("Check a claim first: there are no answers to compare with the policy.");
        return csvText([["answer", "compared", "value", "setting", "cut", "side", "flip_at", "slider_steps"],
          ...ctx.items().flatMap((item) => cutRows(item, ctx).map((row) => [item.id, item.type === "box" ? "confidence" : "value", row.base, row.key, row.at,
            row.side, row.flip ?? "", row.steps ?? ""]))]);
      } },
  ],
});
