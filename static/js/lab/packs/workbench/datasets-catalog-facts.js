// Catalog facts for the Workbench dataset catalog ("workbench.datasets.catalog"; contract in
// static/js/lab/surfaces/workbench-datasets.js) that the page's 60-odd filters and the starter pack do not offer:
// save age and month, name and ID hygiene, per-question label coverage, split and evaluation health, and advisory
// checks. Summary metadata only: counts, lengths, dates, flags and fixed-vocabulary categories. No fact returns
// notes text, inputs, label values, answers or check configuration; counts are saved human work, never validity.
import { definePack } from "../../kit.js";
import { codePoints, findEmails, findUrls, hasEdgeWhitespace, hasRepeatedSpaces, levenshtein } from "../../lib/text.js";

const DAY_MS = 86400000;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const percent = (share) => `${Math.round(share * 1000) / 10}%`;
const nowOf = (ctx) => finite(ctx?.data?.now);
// Per-question labeled-row counts above zero, in first-seen order.
const labelEntries = (item) => (Array.isArray(item?.question_labels) ? item.question_labels : [])
  .filter((entry) => entry && typeof entry.id === "string" && Number.isInteger(entry.labeled) && entry.labeled > 0);
const labelCounts = (item) => labelEntries(item).map((entry) => entry.labeled);
// The server's file id for a dataset name (jev/workbench.py slugify).
const slugOf = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const nameKey = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const stampMs = (text) => (typeof text === "string" && STAMP.test(text) && Number.isFinite(Date.parse(text)) ? Date.parse(text) : null);

// Whole days since the last save; null without a date, a clock, or for a save after the clock.
function daysSinceSaved(item, ctx) {
  const saved = finite(item?.saved_ms), now = nowOf(ctx);
  if (saved === null || now === null || saved > now) return null;
  return Math.floor((now - saved) / DAY_MS);
}

// Every dataset on the page, for checks that must see datasets hidden by filters too.
function everyItem(items, ctx) {
  let all = [];
  try { all = typeof ctx?.items === "function" ? ctx.items() : []; } catch { all = []; }
  const seen = new Map();
  for (const item of [...(Array.isArray(all) ? all : []), ...items]) if (item && typeof item.id === "string" && !seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}

const AGE_BANDS = [[1, "under a day"], [7, "under a week"], [30, "under a month"], [90, "under 3 months"]];

export default definePack({
  id: "datasets-catalog-facts",
  surface: "workbench.datasets.catalog",
  title: "Dataset catalog facts",
  about: "Save age and month, name and ID hygiene, per-question label coverage and split health facts for saved datasets, with advisory checks for names, thin labels and held-out splits. Summary metadata only: counts, lengths, dates and flags, never notes text, inputs, label values, answers or check configuration.",
  features: [
    // ---------- date and freshness ----------
    { id: "days_since_saved", kind: "fact", type: "number", label: "days since last saved", unit: "days",
      help: "Whole days from the last save to now; unknown without a saved date or for a save dated after this computer's clock.",
      value: daysSinceSaved },
    { id: "saved_month", kind: "fact", type: "category", label: "month last saved",
      help: "The UTC month of the last save, as YYYY-MM; unknown without a saved date.",
      value: (item) => (finite(item?.saved_ms) !== null && typeof item.saved_at === "string" ? item.saved_at.slice(0, 7) : null) },
    { id: "save_age_band", kind: "fact", type: "category", label: "save age band",
      help: "under a day, under a week, under a month, under 3 months, or 3 months or more since the last save.",
      value: (item, ctx) => {
        const days = daysSinceSaved(item, ctx);
        if (days === null) return null;
        const band = AGE_BANDS.find(([limit]) => days < limit);
        return band ? band[1] : "3 months or more";
      } },
    { id: "saved_after_split", kind: "fact", type: "flag", label: "a save after its test split was drawn",
      help: "The last save (a bundle import counts) is later than the split's draw time, so rows or labels may have been added or changed since the split.",
      value: (item) => {
        const saved = finite(item?.saved_ms), locked = stampMs(item?.test?.locked_at);
        return !!item?.test && saved !== null && locked !== null && saved > locked;
      } },

    // ---------- name and ID hygiene ----------
    { id: "name_length", kind: "fact", type: "number", label: "name length", unit: "characters",
      help: "Characters in the shown name (the ID when the dataset has no name).",
      value: (item) => (typeof item?.name === "string" ? codePoints(item.name) : null) },
    { id: "id_length", kind: "fact", type: "number", label: "ID length", unit: "characters",
      help: "Characters in the file ID; the server allows at most 60.",
      value: (item) => (typeof item?.id === "string" && item.id ? item.id.length : null) },
    { id: "notes_length", kind: "fact", type: "number", label: "notes length", unit: "characters",
      help: "Characters in the saved notes, ignoring spaces at the ends; 0 without notes. Never the notes themselves.",
      value: (item) => codePoints(typeof item?.notes === "string" ? item.notes.trim() : "") },
    { id: "id_family", kind: "fact", type: "category", label: "ID first word",
      help: "The ID up to its first hyphen, to group related datasets such as harbor-*.",
      value: (item) => (typeof item?.id === "string" && item.id ? item.id.split("-")[0] || null : null) },
    { id: "name_is_id", kind: "fact", type: "flag", label: "a name equal to its ID",
      help: "The dataset has no name of its own (the catalog shows its ID), or its name is spelled exactly like the ID.",
      value: (item) => typeof item?.name === "string" && item.name === item.id },
    { id: "name_spacing", kind: "fact", type: "flag", label: "stray spaces in the name",
      help: "The name starts or ends with whitespace or has two spaces in a row.",
      value: (item) => typeof item?.name === "string" && (hasEdgeWhitespace(item.name) || hasRepeatedSpaces(item.name)) },
    { id: "copy_like_id", kind: "fact", type: "flag", label: "an ID from Load as copy",
      help: "The ID ends in -copy or -copy-N, the names Load as copy suggests.",
      value: (item) => typeof item?.id === "string" && /-copy(?:-\d+)?$/.test(item.id) },

    // ---------- per-question label coverage ----------
    { id: "most_question_labels", kind: "fact", type: "number", label: "most rows labeled for one question", unit: "rows",
      help: "The best-labeled question's labeled rows; unknown with no labels.",
      value: (item) => (labelCounts(item).length ? Math.max(...labelCounts(item)) : null) },
    { id: "question_label_total", kind: "fact", type: "number", label: "saved question labels", unit: "labels",
      help: "Labeled rows summed over the question IDs: a row labeled for two questions counts twice. Any value counts.",
      value: (item) => labelCounts(item).reduce((sum, n) => sum + n, 0) },
    { id: "labels_per_labeled_row", kind: "fact", type: "number", label: "question labels per labeled row", unit: "labels",
      help: "Saved question labels over rows with any label; unknown without labeled rows.",
      value: (item) => (count(item?.labeled) > 0 ? labelCounts(item).reduce((sum, n) => sum + n, 0) / item.labeled : null) },
    { id: "least_question_share", kind: "fact", type: "number", label: "least-labeled question's share of labeled rows", unit: "0 to 1",
      help: "The least-labeled question's labeled rows over rows with any label; 1 means every labeled row carries every labeled question.",
      value: (item) => (count(item?.labeled) > 0 && labelCounts(item).length ? Math.min(...labelCounts(item)) / item.labeled : null) },
    { id: "unlabeled_saved_question", kind: "fact", type: "flag", label: "a saved question with no labels",
      help: "Fewer question IDs carry a label than the dataset saves questions, so at least one saved question has none.",
      value: (item) => labelEntries(item).length < count(item?.questions) },

    // ---------- split and evaluation health ----------
    { id: "smaller_split_side", kind: "fact", type: "number", label: "labeled rows on the smaller split side", unit: "rows",
      help: "The fewer of labeled tuning rows and labeled held-out rows; unknown without a split. A split needs at least 2 on each side.",
      value: (item) => (item?.test ? Math.min(count(item.tuning_labeled), count(item.held_out_labeled)) : null) },
    { id: "evaluation_status", kind: "fact", type: "category", label: "test evaluation status",
      help: "no split, not scored, scored once, or scored 2+ times: recorded looks at the held-out rows, never their results.",
      value: (item) => {
        if (!item?.test) return "no split";
        const looks = count(item.test.looks);
        return looks === 0 ? "not scored" : looks === 1 ? "scored once" : "scored 2+ times";
      } },
    { id: "check_has_notes", kind: "fact", type: "flag", label: "a saved check with advisory notes",
      help: "The server attached advisory notes to the saved check (for example a model pin). Only their count is read.",
      value: (item) => item?.has_check === true && count(item.check_notes) > 0 },
    { id: "agreement_ready", kind: "fact", type: "flag", label: "ready for label agreement",
      help: "Saved questions and labeled rows, so a second person can label a blind sample.",
      value: (item) => item?.agreement_ready === true },
    { id: "agreement_open", kind: "fact", type: "flag", label: "an open label agreement panel",
      help: "Its Label agreement panel is open in this page session; filtering never closes it.",
      value: (item) => item?.agreement_open === true },

    // ---------- checks ----------
    { id: "saved_in_future", kind: "diagnostic", severity: "info", label: "Saved after this computer's clock",
      check: (item, ctx) => {
        const saved = finite(item?.saved_ms), now = nowOf(ctx);
        return saved !== null && now !== null && saved > now
          ? `Saved at ${item.saved_at}, later than this computer's clock; its age is shown as unknown. Check the clock of the computer that saved it.` : null;
      } },
    { id: "name_saves_over", kind: "diagnostic", severity: "advice", scope: "list", label: "Name that would save over another dataset",
      check: (items, ctx) => {
        const all = everyItem(items, ctx);
        const ids = new Set(all.map((item) => item.id));
        return items.filter((item) => item && typeof item.name === "string" && slugOf(item.name) !== item.id && ids.has(slugOf(item.name)))
          .map((item) => `Saving ${item.id} under its name “${item.name.trim()}” would write ${slugOf(item.name)}, another saved dataset (the page asks before replacing it).`);
      } },
    { id: "name_has_contact", kind: "diagnostic", severity: "advice", label: "Contact details in a name",
      check: (item) => (typeof item?.name === "string" && (findEmails(item.name).length || findUrls(item.name).length)
        ? "The name holds an email or web address. Names travel in catalog exports; keep contact details in the notes." : null) },
    { id: "similar_names", kind: "diagnostic", severity: "info", scope: "list", label: "Names that differ by a character or two",
      check: (items) => {
        const named = items.filter((item) => item && typeof item.name === "string" && nameKey(item.name).length >= 5);
        const out = [];
        for (let i = 0; i < named.length; i++) {
          for (let j = i + 1; j < named.length; j++) {
            const a = nameKey(named[i].name), b = nameKey(named[j].name);
            // Two edits cannot bridge a length gap over 2, so skip the distance for those pairs.
            if (a !== b && Math.abs(codePoints(a) - codePoints(b)) <= 2 && levenshtein(a, b) <= 2) out.push(`${named[i].id} and ${named[j].id} have nearly the same name; check they are not two copies of one dataset.`);
          }
        }
        return out;
      } },
    { id: "thin_question_labels", kind: "diagnostic", severity: "advice", label: "Questions with under 10 labeled rows",
      check: (item) => {
        const thin = labelEntries(item).filter((entry) => entry.labeled < 10);
        return thin.length ? `Few labeled rows for ${thin.map((entry) => `${entry.id} (${entry.labeled})`).join(", ")}; a threshold tuned on under 10 rows is noisy.` : null;
      } },
    { id: "held_out_share_range", kind: "diagnostic", severity: "advice", label: "Held-out share outside 10% to 40%",
      check: (item) => {
        if (!item?.test || !(count(item.labeled) > 0)) return null;
        const share = count(item.held_out_labeled) / item.labeled;
        return share < 0.1 || share > 0.4 ? `${percent(share)} of the labeled rows are held out; 10% to 40% usually leaves enough on both sides.` : null;
      } },
    { id: "held_out_without_labels", kind: "diagnostic", severity: "advice", label: "Held-out rows without any label",
      check: (item) => (item?.test && count(item.held_out) > 0 && count(item.held_out_labeled) === 0
        ? `None of the ${plural(item.held_out, "held-out row")} has a label, so scoring the test split has nothing to score.` : null) },
  ],
});
