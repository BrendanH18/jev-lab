// Reliability-bin diagnostics for Calibrate (surface "workbench.calibrate"; contract in
// static/js/lab/surfaces/workbench-analysis.js). Rows fall in ten equal-width bins of their stated probability, as
// jev/calibrate.py reliability bins them; a bin's verdict compares its mean stated probability with the 95% Wilson
// interval of its share right. Row facts read the bins of every scored row (so a filter does not move them); checks,
// metrics and the export read the shown rows. Everything is arithmetic on the user's own Bulk run in this page
// session: no model call, no storage. Intervals treat rows as independent; small bins are noisy by nature.
import { csvText, definePack } from "../../kit.js";
import { slugify } from "../../lib/text.js";

const EPS = 1e-9;
const BINS = 10;
const THIN = 5;       // a bin with fewer rows than this is thin
const CROWDED = 0.6;  // a bin holding more than this share of the rows crowds the table
const Z = 1.959964;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value, digits = 4) => (num(value) === null ? "" : value.toFixed(digits));
const fileQid = (ctx) => slugify(ctx?.data?.qid || "") || "question";
const rowsWord = (n) => `${n} shown row${n === 1 ? "" : "s"}`;

function wilson(k, n) {
  const p = k / n, z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [k === 0 ? 0 : Math.max(0, centre - half), k === n ? 1 : Math.min(1, centre + half)];
}

const binOf = (p) => Math.min(Math.floor(p * BINS), BINS - 1);
const bandName = (k) => `${(k / BINS).toFixed(1)}–${((k + 1) / BINS).toFixed(1)}`;
const usable = (rows) => (Array.isArray(rows) ? rows : []).filter((item) => num(item?.top) !== null && item.top >= 0 && item.top <= 1 && typeof item.correct === "boolean");

// The non-empty bins of a list, in bin order: { k, band, count, hits, stated, observed, low, high, verdict }.
function binsOf(rows) {
  const groups = new Map();
  for (const item of usable(rows)) {
    const k = binOf(item.top);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([k, members]) => {
    const hits = members.filter((item) => item.correct).length, count = members.length;
    const stated = members.reduce((total, item) => total + item.top, 0) / count;
    const [low, high] = wilson(hits, count);
    const verdict = stated > high + EPS ? "overconfident" : stated < low - EPS ? "underconfident" : "within its interval";
    return { k, band: bandName(k), count, hits, stated, observed: hits / count, low, high, verdict };
  });
}

// Every scored row's bins, built once per ctx for one synchronous pass: ctx.items() builds a new list on each call,
// so the Refine bar asking four facts of 200 rows would otherwise rebuild and rebin the run 800 times. The entry is
// dropped at the next microtask, before the page can change the run under the same ctx.
const binCache = new WeakMap();
function allBins(ctx) {
  let bins = binCache.get(ctx);
  if (!bins) {
    bins = binsOf(ctx.items());
    binCache.set(ctx, bins);
    queueMicrotask(() => binCache.delete(ctx));
  }
  return bins;
}

// The bin of one row among every scored row, or null.
function binFor(item, ctx) {
  if (num(item?.top) === null || item.top < 0 || item.top > 1 || typeof ctx?.items !== "function") return null;
  const k = binOf(item.top);
  return allBins(ctx).find((bin) => bin.k === k) || null;
}

const said = (bin) => `Rows stating ${bin.band} say ${percent(bin.stated)} on average but ${bin.hits} of ${bin.count} are right (95% interval ${percent(bin.low)}–${percent(bin.high)})`;

export default definePack({
  id: "calibrate-reliability-bins",
  surface: "workbench.calibrate",
  title: "Calibrate: reliability bins",
  about: "Ten equal-width bins of stated probability, as the page's reliability table bins them: each row's bin and its verdict, and checks for thin, crowded, out-of-order, overconfident and underconfident bins among the shown rows. Arithmetic on your own run in this page session; nothing calls the model.",
  features: [
    // ---------- row facts (bins of every scored row) ----------
    { id: "bin_gap", kind: "fact", type: "number", label: "its reliability bin's stated minus share right",
      help: "Over every scored row in the row's bin: positive, the bin's answers state more than they get right.",
      value: (item, ctx) => {
        const bin = binFor(item, ctx);
        return bin && bin.stated - bin.observed;
      } },
    { id: "bin_rows", kind: "fact", type: "number", label: "rows in its reliability bin", value: (item, ctx) => binFor(item, ctx)?.count ?? null },
    { id: "bin_accuracy", kind: "fact", type: "number", label: "share right in its reliability bin", value: (item, ctx) => binFor(item, ctx)?.observed ?? null },
    { id: "stated_band", kind: "fact", type: "category", label: "stated probability band",
      help: "The reliability table's bin, 0.1 wide; a stated probability of exactly 1 falls in 0.9–1.0.",
      value: (item) => (num(item.top) === null || item.top < 0 || item.top > 1 ? null : bandName(binOf(item.top))) },
    { id: "bin_verdict", kind: "fact", type: "category", label: "its reliability bin's verdict",
      help: "Overconfident when the bin's mean stated probability is above the 95% interval of its share right, underconfident when below, else within its interval.",
      value: (item, ctx) => binFor(item, ctx)?.verdict ?? null },

    // ---------- checks on the shown rows ----------
    { id: "thin_bins", kind: "diagnostic", severity: "info", scope: "list", label: "Reliability bins with few rows",
      check: (rows) => {
        const bins = binsOf(rows), thin = bins.filter((bin) => bin.count < THIN);
        return thin.length
          ? `${thin.length} of the ${bins.length} bins with rows hold fewer than ${THIN} rows (${thin.map((bin) => `${bin.band}: ${bin.count}`).join(", ")}): one row more or less moves their share right a lot.`
          : null;
      } },
    { id: "non_monotone_bins", kind: "diagnostic", severity: "advice", scope: "list", label: "Higher stated probability, fewer rows right",
      help: "Compares each bin with rows to the next one up: a higher stated probability should not be right less often.",
      check: (rows) => {
        const bins = binsOf(rows);
        return bins.slice(1).map((bin, i) => (bin.observed < bins[i].observed - EPS
          ? `Rows stating ${bin.band} are right less often (${percent(bin.observed)} of ${bin.count}) than rows stating ${bins[i].band} (${percent(bins[i].observed)} of ${bins[i].count}): the stated probability does not order these rows well.`
          : null)).filter(Boolean);
      } },
    { id: "overconfident_bins", kind: "diagnostic", severity: "advice", scope: "list", label: "Bins that state more than they get right",
      check: (rows) => binsOf(rows).filter((bin) => bin.verdict === "overconfident")
        .map((bin) => `${said(bin)}: the answers are overconfident here, so a threshold read off their probabilities automates too much.`) },
    { id: "underconfident_bins", kind: "diagnostic", severity: "info", scope: "list", label: "Bins that get more right than they state",
      check: (rows) => binsOf(rows).filter((bin) => bin.verdict === "underconfident")
        .map((bin) => `${said(bin)}: the answers are underconfident here, so a lower threshold may hold up.`) },
    { id: "crowded_bin", kind: "diagnostic", severity: "info", scope: "list", label: "One bin holds most rows",
      check: (rows) => {
        const all = usable(rows).length;
        if (all < THIN) return null;
        return binsOf(rows).filter((bin) => bin.count / all > CROWDED)
          .map((bin) => `${bin.count} of ${rowsWord(all)} state ${bin.band}: the reliability table says little about other probabilities.`);
      } },

    // ---------- metrics on the shown rows ----------
    { id: "bins_with_rows", kind: "metric", format: "integer", label: "reliability bins with shown rows",
      compute: (ctx) => {
        const bins = binsOf(ctx.shown());
        return bins.length ? { value: bins.length, detail: bins.map((bin) => `${bin.band}: ${bin.count}`).join(", ") } : null;
      } },
    { id: "thin_bin_rows", kind: "metric", format: "percent", label: `share of shown rows in bins with fewer than ${THIN} rows`,
      compute: (ctx) => {
        const bins = binsOf(ctx.shown());
        if (!bins.length) return null;
        const all = bins.reduce((total, bin) => total + bin.count, 0), thin = bins.filter((bin) => bin.count < THIN).reduce((total, bin) => total + bin.count, 0);
        return { value: thin / all, detail: `${thin} of ${rowsWord(all)}` };
      } },
    { id: "miscalibrated_rows", kind: "metric", format: "percent", label: "share of shown rows in bins outside their interval",
      help: "Rows in bins whose mean stated probability falls outside the 95% Wilson interval of the bin's share right.",
      compute: (ctx) => {
        const bins = binsOf(ctx.shown());
        if (!bins.length) return null;
        const all = bins.reduce((total, bin) => total + bin.count, 0);
        const off = bins.filter((bin) => bin.verdict !== "within its interval").reduce((total, bin) => total + bin.count, 0);
        return { value: off / all, detail: `${off} of ${rowsWord(all)}` };
      } },
    { id: "monotone_violations", kind: "metric", format: "integer", label: "neighbouring bins right less often as stated probability rises",
      compute: (ctx) => {
        const bins = binsOf(ctx.shown());
        if (!bins.length) return null;
        return bins.slice(1).filter((bin, i) => bin.observed < bins[i].observed - EPS).length;
      } },
    { id: "shown_ece", kind: "metric", format: "number", label: "calibration error of the shown rows (ten equal-width bins)",
      help: "Rows-weighted mean of |mean stated − share right| over the bins of the shown rows. A separate figure from the page's ECE, which covers every scored row.",
      compute: (ctx) => {
        const bins = binsOf(ctx.shown());
        if (!bins.length) return null;
        const all = bins.reduce((total, bin) => total + bin.count, 0);
        return { value: bins.reduce((total, bin) => total + bin.count * Math.abs(bin.stated - bin.observed), 0) / all, detail: `${rowsWord(all)} in ${bins.length} bins` };
      } },

    // ---------- export ----------
    { id: "bins_csv", kind: "exporter", label: "Reliability bins of the shown rows with verdicts as CSV", mime: "text/csv",
      help: "Aggregates of the shown rows: each bin's rows, rows right, mean stated probability, share right with its 95% interval, and its verdict.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-shown-bins.csv`,
      build: (ctx) => {
        const bins = binsOf(ctx.shown());
        if (!bins.length) throw new Error("There are no shown rows with a stated probability.");
        return csvText([["stated probability", "rows", "right", "mean stated", "share right", "low", "high", "verdict"],
          ...bins.map((bin) => [bin.band, bin.count, bin.hits, fixed(bin.stated), fixed(bin.observed), fixed(bin.low), fixed(bin.high), bin.verdict])]);
      } },
  ],
});
