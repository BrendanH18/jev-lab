// Lab surfaces of the Workbench Datasets panel (static/js/workbench-datasets.js, with the pure helpers of
// static/js/dataset-catalog.js, static/js/history.js and static/js/agreement.js). Pure code: it imports only the kit and
// those pure page modules, touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-wb-datasets.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/workbench-datasets.mjs
// (sampleDatasetsCatalogCtx, sampleDatasetsHistoryCtx, sampleDatasetsAgreementCtx). Starter packs:
// static/js/lab/packs/workbench/datasets-catalog-essentials.js, datasets-history-essentials.js and
// datasets-agreement-essentials.js. This header is the CONTRACT for packs on these three surfaces.
//
// Shared rules for all three surfaces
//   - items() and data are FROZEN COPIES built at call time; the page's own objects are never handed out. Never keep
//     them across renders. Items are plain JSON values; the same raw entry in the same state gives the same object.
//   - shown() is what the page shows now: after every page filter AND Lab's filters, in display order (the page's
//     order or sort first, then Lab's sort). Facts must not call shown() (it runs the filters, which run the facts).
//   - Every list here is READ-ONLY to Lab: there is no replaceItems and no importItems, so Edits (transform) and
//     Paste to import (importer) do not render. Saved datasets change only through the panel's own save, settle,
//     split and restore flows, with their previews, confirms and snapshot checks. Kinds these surfaces host: fact,
//     diagnostic, metric, exporter, command, tool, panel (and behavior).
//   - ACTIONS throw an Error with a message for the user when their guard refuses. Call them only from a command or a
//     control the user just pressed, one call per press, never from a fact, metric, check or render. Nothing here
//     saves, deletes or replaces a dataset, and nothing calls the model; a pack must not add a way to.
//   - Nothing here ever holds a model answer. Datasets hold inputs and human labels only (AGENTS.md).
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.datasets.catalog"  —  builder datasetsCatalogCtx(source)  —  "Datasets · data/workbench/datasets/"
// ---------------------------------------------------------------------------------------------------------------
// One item per saved dataset, from the summary metadata GET /api/workbench/datasets returns (jev/workbench.py
// dataset_summary): never rows, inputs or label values. items() is SAVED ORDER (file names, A to Z). shown() applies
// the page's 60-odd catalog filters (search, exclusion, prefixes/suffixes, notes, pins, check, labels, questions,
// timestamp, test split, guidelines, count and share bounds, dates), then Lab's, ordered by the page's sort (pins
// count for "Pinned first") and then Lab's sort. "Copy shown dataset IDs", the shown CSV/JSON downloads, "Pin/Unpin/
// Invert shown" and the shown summaries use exactly this list. Filtering only hides cards: every open Label agreement,
// guideline editor and history panel stays mounted with its human edits. itemName(item) is the dataset id.
// refresh() re-applies filters and order to the mounted cards without re-rendering them.
//
// ITEM  one saved dataset:
//   id                string   the file id ([a-z0-9-], at most 60 characters). Unique.
//   name              string   the saved name; the id when the file has none
//   position          integer  1-based position in saved order
//   notes             string   the saved notes ("" when none). AUTHORED TEXT: see boundaries.
//   has_notes         boolean  notes are not blank
//   saved_at          string | null   "YYYY-MM-DDTHH:MM:SSZ" as saved (rewritten on every save); null when missing
//   saved_ms          number | null   saved_at as epoch milliseconds; null when missing or unreadable
//   rows              integer  rows in the file, held-out rows included
//   labeled           integer  rows with at least one saved human label (any value counts; not validity)
//   unlabeled         integer  rows - labeled (never below 0)
//   label_share       number | null   labeled / rows (0..1); null when the dataset has no rows
//   questions         integer  saved questions (0 when saved without questions)
//   question_labels   [{ id, labeled }]   per question id named in any saved label, the rows labeled for it, in
//                                  first-seen order. Counts only; ids may name questions the file no longer asks.
//   guidelines        integer  questions with labeling guidelines
//   unguided          integer  questions - guidelines (never below 0)
//   has_check         boolean  the dataset has a saved check. Its configuration is NEVER on the item.
//   check_notes       integer  advisory notes the server attached to the check (for example a model-pin note); count only
//   test              null | { rows, labeled, share, looks, locked_at }   the held-out split: held-out rows, those with
//                                  a label, share = held-out labeled / all labeled rows (0..1 or null), recorded test
//                                  evaluations ("looks"), and when the split was drawn ("...Z" or null). null: no split.
//   tuning            integer  rows - held-out rows
//   tuning_labeled    integer  labeled rows outside the split
//   held_out          integer  held-out rows (0 without a split)
//   held_out_labeled  integer  held-out rows with a label
//   loaded            boolean  this dataset is the one loaded in the rows box
//   pinned            boolean  pinned in this page session
//   can_copy          boolean  "Load as copy" is allowed (no held-out rows or test history)
//   agreement_ready   boolean  Label agreement is offered (labeled > 0 and questions > 0)
//   agreement_open    boolean  its Label agreement panel is open
//   split_ready       boolean  "Hold out test rows" is offered (no split yet and at least 4 labeled rows)
//
// DATA
//   total            integer  saved datasets
//   loaded_id        string | null   the dataset loaded in the rows box (null when the box is not linked to one)
//   unsaved          boolean  the rows box has unsaved rows or labels
//   pinned_ids       string[] pinned dataset ids in saved order (session only; hidden datasets can be pinned)
//   filters          object   the page's catalog settings as typed (strings, pinnedIds left out)
//   filters_active   integer  page settings that differ from their defaults (sort excluded, as on the page)
//   sort             string   the page's sort key ("saved" is saved order)
//   save_busy, copy_busy   boolean   a save or a copy load is in flight
//   now              number   epoch milliseconds at the time of the read (the clock for age facts)
//
// ACTIONS
//   load(id)          the card's "Load": replaces the rows box with that dataset (the page asks first when the box has
//                     unsaved rows). Guard: id must be a saved dataset. Returns the page's promise.
//   loadCopy(id)      "Load as copy": an unsaved copy under a new name; Save stays explicit. Guards: saved id, can_copy,
//                     no copy load in flight; the page also refuses when the editor changes during the load.
//   downloadBundle(id) "Download ZIP": the portable bundle (inputs, human labels, configuration, pictures; never
//                     answers). Guard: saved id. The ZIP holds INPUTS: run it only when the user asked for that file.
//   pin(ids, pinned = true)   session pins only; unknown ids are ignored, hidden pins are kept. Guards: ids must be an
//                     array naming at least one saved dataset. Returns the new pinned ids.
//   openAgreement(id) opens that dataset's Label agreement panel (draws nothing). Guard: agreement_ready.
//   resetFilters()    the page's "Clear dataset filters" plus Lab's filters and sort. Pins are kept. No guard.
//
// CONTENT BOUNDARIES (AGENTS.md: dataset catalog)
//   - FACTS land in the Lab facts table and its CSV: counts, shares, dates, flags and fixed-vocabulary categories
//     only. A fact must NEVER return notes text (a has-notes flag or a length is fine).
//   - EXPORTS from this surface carry names, ids, counts, flags and timestamps only, with csvCell/csvText escaping:
//     never notes, inputs, label values, answers or check configuration (none of which except notes is on the item).
//     Do not reuse the page's file names jev-dataset-catalog.* / jev-pinned-datasets.* (their allowlists are fixed).
//   - Counts describe saved human work and recorded evaluation looks: never present them as label validity, model
//     accuracy or evaluation quality.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.datasets.history"  —  builder datasetsHistoryCtx(source)  —  a dataset's "History" panel
// ---------------------------------------------------------------------------------------------------------------
// The kept revisions of ONE dataset (jev/history.py): every saved-over or deleted version, newest first, at most 20.
// The section renders inside each open History panel (the loaded dataset's, and a deleted dataset's); Lab's filters
// and sort are shared by all of them, and each panel builds its own ctx for its dataset. items() is the list as the
// server returned it (newest first; [] before it loads); shown() applies the page's "Hide revisions identical to the
// current file" and Lab's filters, then Lab's sort. The page's "N of M revisions shown" counts Lab's filters too.
// itemName(item) is "#<position>" (1 = newest). refresh() re-renders the panel.
//
// ITEM  one kept revision (counts and question ids only, never rows or label values):
//   revision      string   the revision id ("<UTC stamp>-<hash>"), the key the restore preview needs
//   position      integer  1-based, newest first
//   at            string | null   when it was kept, "YYYY-MM-DDTHH:MM:SS.ffffffZ"; null if unreadable
//   at_ms         number | null   at as epoch milliseconds (microseconds dropped)
//   current       boolean  byte for byte the same as the current file
//   readable      boolean  false for a revision the server could not read; every count below is then null
//   name          string | null   the dataset name saved in that revision
//   saved_at      string | null   its saved_at; saved_ms number | null
//   rows, labeled, held_out   integer | null   rows, rows with a human label, held-out rows in that revision
//   unlabeled     integer | null   rows - labeled
//   questions     string[] the revision's question ids in saved order ([] when it saved none)
//   has_check     boolean  the revision holds a saved check (configuration never on the item)
//   previewing    boolean  this revision's restore preview is open
//
// DATA
//   dataset_id   string    the dataset this panel lists
//   exists       boolean | null   the dataset file exists now (false: a deleted dataset); null before the list loads
//   keep         integer   revisions kept per dataset (20)
//   loaded       boolean   the list has been read in this page session
//   busy         boolean   a read, preview or restore is in flight
//   changed_only boolean   "Hide revisions identical to the current file" is on
//   preview      null | { revision, exists, rows: { before, after, added, removed, order_changed },
//                  labels: { added, removed, changed }, questions_changed, rules_changed, metadata_changed,
//                  check: "preserved" | "removed" | "none", check_changed,
//                  test: { before, after, changed_membership, history }, guidelines: null | { before, after, added,
//                  changed, removed } (counts) }   the open restore preview: the server's change summary, counts only
//   deleted      null | [{ id, name, revisions, latest }]   deleted datasets with kept history, once that list loaded
//   now          number    epoch milliseconds at the time of the read
//
// ACTIONS
//   reload()           re-read the revision list (read only). Guard: not busy.
//   preview(revision)  open the restore preview of a listed, readable revision (the server compares; nothing is
//                      written). Guards: not busy; revision listed and readable.
//   cancelPreview()    close the open preview. Guard: a preview is open.
//   restore()          the preview's "Restore this revision": the page shows its full change summary in a confirm, asks
//                      before discarding unsaved Review edits, keeps the current file as a revision, and requires the
//                      preview's file token. Guards: not busy; a preview is open.
//   setChangedOnly(on) the page's "Hide revisions identical to the current file" checkbox. Guard: on is a boolean.
//
// CONTENT BOUNDARIES (AGENTS.md: dataset revision history)
//   - Revisions hold inputs and human labels, but this surface only ever holds what the listing shows: counts,
//     question ids, names, timestamps and change counts. Exports and facts must keep to that and never present a
//     restore as undoable unless the page says so (it is: the current file is kept first).
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.datasets.agreement"  —  builder datasetsAgreementCtx(source)  —  a dataset's "Label agreement"
// ---------------------------------------------------------------------------------------------------------------
// The blind second-labeling sample of ONE dataset (jev/agreement.py): rows drawn at random from its labeled rows,
// WITHOUT their saved labels, for a second person to label. The section renders inside each open agreement sample;
// Lab's filters and sort are shared. items() is the sample in its order (dataset order); [] before a sample is drawn.
// shown() applies Lab's filters and sort (the page has no other filter here). Hidden rows keep their second labels,
// and Compare always sends every labeled row, shown or not. itemName(item) is "row <number>". refresh() re-renders.
//
// ITEM  one sampled row:
//   row_id        string   the row's stable id (a hash of its input)
//   number        integer  1-based row number in the dataset
//   position      integer  1-based position in the sample
//   input         object | string   the row's input as the card shows it (a copy; no labels, no test marker)
//   picture       string | null     the row's "_image" picture name
//   questions     string[] the questions this row asks (the ones its saved labels cover)
//   second        { [qid]: value | null }   the SECOND person's labels so far, one key per asked question: Noul
//                 true/false, Score an integer level, Choice an option key; null = not given yet
//   given         integer  second labels given; missing integer: asked - given; done boolean: missing === 0
//   differences   null until a CURRENT comparison exists (Compare pressed, nothing edited since); then
//                 [{ question, saved, second, settle }]: this row's disagreements in the shown comparison. saved is the
//                 FIRST (saved) label, revealed by Compare; settle is { set: false } or { set: true, value } (null
//                 value: leave unlabeled). [] when the row agrees or was not in the shown part of the comparison.
//
// DATA
//   dataset_id, dataset_name   string
//   open          boolean  the agreement panel is open
//   busy          boolean  a draw, compare, session restore or settlement save is in flight
//   sample        null | { requested, drawn, eligible, seed, recoverable }   requested rows, rows drawn, labeled rows
//                 eligible, the draw's seed, and whether the session can still be downloaded for recovery
//   questions     [{ id, type, options }]   the sampled questions in saved order; options are the label choices the
//                 page offers as text ("yes"/"no", "0".."n-1", Choice keys; [] for Box)
//   given_rows    integer  rows with at least one second label (what Compare would send)
//   given_labels  integer  second labels given over the whole sample
//   unsaved       boolean  the page counts human agreement edits not yet downloaded (labels, choices, restored
//                 settlements)
//   pending_settlements   integer  restored settlement choices waiting for the next Compare
//   report        null | { overall: { labels, agree, agreement, rows, rows_agree, rows_agreement, rows_low, rows_high },
//                 counts: { rows, matched, not_found, repeated, unlabeled, compared, all_agree, only_second },
//                 questions: [{ id, rows, agree, agreement, low, high, kappa, mixups: [{ saved, second, rows }] }],
//                 disagreements_total, disagreements_shown, truncated, problems_total }   the CURRENT comparison
//                 (null before Compare and after any edit). Rates are 0..1 or null; kappa may be null.
//   choices       integer  explicit settlement choices made on the shown comparison
//   settled_rows  integer  rows "Save settled labels" would write (choices that change a saved label)
//   now           number
//
// ACTIONS
//   setSecondLabel(rowId, question, value)   the card's select: the second person's label (null clears it). It drops
//                     the current comparison and keeps settlement choices for recovery, exactly as the select does.
//                     Guards: not busy; the row is in the sample and asks that question; value is null or valid for
//                     the type (Noul boolean, Score integer level in range, Choice an offered key).
//   compare()         the sample's "Compare N labeled rows" (the page asks first when it would clear settlement
//                     choices). Guards: not busy; at least one second label given. No model call.
//   settle(rowId, question, value)   the comparison's "settle as" select (value null: leave unlabeled). Writes nothing:
//                     "Save settled labels" stays the page's own button. Guards: not busy; a current comparison
//                     shows that disagreement; value is null or valid for the question.
//
// CONTENT BOUNDARIES (AGENTS.md: label agreement, blind labeling)
//   - The sample is BLIND: saved labels are not on any item or in data until the user presses Compare. A pack must
//     never suggest, prefill or reveal a label for a row (no "copy the model", no "majority guess"), never set second
//     labels in bulk, and never infer saved labels from anything else on the page.
//   - FACTS may return counts, positions, flags and question types. They must never return input text or label values
//     (saved or second): those would land in the Lab facts CSV.
//   - EXPORTS may hold row numbers, row ids, question ids and counts. One that holds second labels or (after Compare)
//     saved labels must be a separately named copy/download that says so in its label and help, never an importable
//     session or CSV format (the page's own session and CSV files are the recovery path). Inputs are never exported
//     here: the page's "Download CSV" already carries them.
//   - Agreement and kappa describe two people's labels, never model accuracy.
import { clone } from "../kit.js";
import { catalogActiveFilters, catalogDefaults, canCopyDataset, matchesCatalog, sortedCatalog } from "../../dataset-catalog.js";
import { agreementEditsUnsaved, secondItems, settleKey, settledItems } from "../../agreement.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : typeof value === "number" && value >= 0 && Number.isFinite(value) ? Math.floor(value) : 0);
const textOr = (value, fallback = null) => (typeof value === "string" && value !== "" ? value : fallback);
const has = Object.prototype.hasOwnProperty;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

const copyOf = (value) => {
  try { return value === undefined ? null : clone(value); } catch { return null; }
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback, ...args) {
  let value;
  try { value = typeof source[name] === "function" ? source[name](...args) : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function stampMs(text) {
  const match = typeof text === "string" ? STAMP.exec(text) : null;
  if (!match) return null;
  const [y, mo, d, hh, mm, ss] = match.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const back = new Date(ms);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && hh < 24 && mm < 60 && ss < 60 ? ms : null;
}

function call(source, name, where, ...args) {
  if (typeof source[name] !== "function") throw new Error(`${where} cannot do that here.`);
  return source[name](...args);
}

// The Lab hooks a page passes in, applied to raw entries: matches(raw) and arrange(raws) keep the page's raw objects.
function pageHook(source, ctx, of) {
  return {
    matches(raw) {
      if (typeof source.matches !== "function" || !raw || typeof raw !== "object") return true;
      return source.matches(of(raw), ctx) !== false;
    },
    arrange(raws) {
      if (typeof source.arrange !== "function" || !Array.isArray(raws)) return raws;
      const pairs = new Map();
      const list = raws.map((raw) => {
        const item = raw && typeof raw === "object" ? of(raw) : raw;
        pairs.set(item, raw);
        return item;
      });
      const arranged = source.arrange(list, ctx);
      if (!Array.isArray(arranged) || arranged.length !== raws.length || !arranged.every((item) => pairs.has(item))) return raws;
      return arranged.map((item) => pairs.get(item));
    },
  };
}

// A WeakMap cache: the same raw entry with the same signature gives the same frozen item.
function itemCache(make) {
  const cache = new WeakMap();
  return (raw, signature, ...args) => {
    const known = cache.get(raw);
    if (known && known.signature === signature) return known.item;
    const item = deepFreeze(make(raw, ...args));
    cache.set(raw, { signature, item });
    return item;
  };
}

// ---------- workbench.datasets.catalog ----------

function catalogItem(raw, index, { loadedId, pinned, agreementOpen }) {
  const rows = count(raw.rows), labeled = count(raw.labeled), questions = count(raw.questions), guidelines = count(raw.guidelines);
  const test = isObject(raw.test) ? { rows: count(raw.test.rows), labeled: count(raw.test.labeled),
    share: finite(raw.test.share), looks: count(raw.test.looks), locked_at: textOr(raw.test.locked_at) } : null;
  const heldOut = test ? test.rows : 0, heldOutLabeled = test ? test.labeled : 0;
  const id = String(raw.id ?? "");
  const notes = typeof raw.notes === "string" ? raw.notes : "";
  return {
    id,
    name: textOr(raw.name, id),
    position: index + 1,
    notes,
    has_notes: notes.trim() !== "",
    saved_at: textOr(raw.saved_at),
    saved_ms: stampMs(raw.saved_at),
    rows,
    labeled,
    unlabeled: Math.max(0, rows - labeled),
    label_share: rows ? labeled / rows : null,
    questions,
    question_labels: Object.entries(isObject(raw.labels) ? raw.labels : {}).map(([qid, n]) => ({ id: qid, labeled: count(n) })),
    guidelines,
    unguided: Math.max(0, questions - guidelines),
    has_check: isObject(raw.check),
    check_notes: Array.isArray(raw.check_notes) ? raw.check_notes.length : 0,
    test,
    tuning: Math.max(0, rows - heldOut),
    tuning_labeled: Math.max(0, labeled - heldOutLabeled),
    held_out: heldOut,
    held_out_labeled: heldOutLabeled,
    loaded: !!loadedId && loadedId === id,
    pinned,
    can_copy: canCopyDataset(raw),
    agreement_ready: labeled > 0 && questions > 0,
    agreement_open: agreementOpen,
    split_ready: !test && labeled >= 4,
  };
}

// source: {
//   datasets()       the page's saved dataset summaries (W.bulk.datasets), raw
//   filters()        the page's catalog settings object (W.bulk.datasetSearch), pinnedIds included
//   loadedId(), unsaved(), saveBusy(), copyBusy(), agreementOpen(id), now()
//   matches(item, ctx), arrange(items, ctx)   the Lab hooks: LAB.matches / LAB.arrange for "workbench.datasets.catalog"
//   load(id), loadCopy(id), downloadBundle(id), setPins(ids), openAgreement(id), resetFilters(), refresh()
// }
export function datasetsCatalogCtx(source = {}) {
  const make = itemCache(catalogItem);
  const raws = () => {
    const list = read(source, "datasets", []);
    return Array.isArray(list) ? list.filter(isObject) : [];
  };
  const filters = () => ({ ...catalogDefaults(), ...(isObject(read(source, "filters", {})) ? read(source, "filters", {}) : {}) });
  const pins = () => {
    const ids = filters().pinnedIds;
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  };
  const lookup = () => {
    const list = raws();
    const pinned = new Set(pins());
    const loadedId = textOr(read(source, "loadedId", null));
    const position = new Map(list.map((raw, index) => [raw, index]));
    const of = (raw) => {
      const index = position.has(raw) ? position.get(raw) : list.length;
      const open = read(source, "agreementOpen", false, raw.id) === true;
      const state = { loadedId, pinned: pinned.has(raw.id), agreementOpen: open };
      return make(raw, JSON.stringify([index, state.loadedId === raw.id, state.pinned, open]), index, state);
    };
    return { list, of };
  };
  const rawById = (id) => {
    const raw = raws().find((entry) => entry.id === id);
    if (typeof id !== "string" || !raw) throw new Error(`There is no saved dataset “${String(id)}”.`);
    return raw;
  };
  const where = "The dataset catalog";

  const ctx = {
    items() {
      const { list, of } = lookup();
      return list.map(of);
    },
    shown() {
      const { list, of } = lookup();
      const settings = filters();
      const ordered = page.arrange(sortedCatalog(list, settings.sort, pins()));
      return ordered.filter((raw) => matchesCatalog(raw, settings) && page.matches(raw)).map(of);
    },
    get data() {
      const settings = filters();
      const typed = {};
      for (const [key, value] of Object.entries(settings)) {
        if (key !== "pinnedIds" && (typeof value === "string" || typeof value === "number")) typed[key] = String(value);
      }
      const list = raws();
      const pinned = new Set(pins());
      const now = finite(read(source, "now", null));
      return deepFreeze({
        total: list.length,
        loaded_id: textOr(read(source, "loadedId", null)),
        unsaved: read(source, "unsaved", false) === true,
        pinned_ids: list.map((raw) => raw.id).filter((id) => pinned.has(id)),
        filters: typed,
        filters_active: catalogActiveFilters(settings).length,
        sort: textOr(typed.sort, "saved"),
        save_busy: read(source, "saveBusy", false) === true,
        copy_busy: read(source, "copyBusy", false) === true,
        now: now === null ? Date.now() : now,
      });
    },
    actions: {
      load(id) {
        rawById(id);
        return call(source, "load", where, id);
      },
      loadCopy(id) {
        const raw = rawById(id);
        if (read(source, "copyBusy", false) === true) throw new Error("A copy is already loading. Wait for it to finish.");
        if (!canCopyDataset(raw)) throw new Error(`“${id}” has held-out rows or test history. Download its ZIP and import it to copy that history too.`);
        return call(source, "loadCopy", where, id);
      },
      downloadBundle(id) {
        rawById(id);
        return call(source, "downloadBundle", where, id);
      },
      pin(ids, pinned = true) {
        if (!Array.isArray(ids)) throw new Error("Give a list of saved dataset IDs.");
        const saved = raws().map((raw) => raw.id);
        const known = new Set(ids.filter((id) => typeof id === "string" && saved.includes(id)));
        if (!known.size) throw new Error("None of those IDs is a saved dataset. Pins are unchanged.");
        const current = new Set(pins().filter((id) => saved.includes(id)));
        for (const id of known) if (pinned === false) current.delete(id); else current.add(id);
        // Keep the page's pin order (the order pins were made), then new pins in saved order.
        const next = [...pins().filter((id) => current.has(id)), ...saved.filter((id) => current.has(id) && !pins().includes(id))];
        call(source, "setPins", where, next);
        return next;
      },
      openAgreement(id) {
        const raw = rawById(id);
        if (!(count(raw.labeled) > 0 && count(raw.questions) > 0)) throw new Error(`“${id}” needs saved questions and labeled rows before a second person can label a sample.`);
        return call(source, "openAgreement", where, id);
      },
      resetFilters() {
        return call(source, "resetFilters", where);
      },
    },
    refresh() { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item) => (item && typeof item.id === "string" ? item.id : "?"),
  };
  // The page's hook (not for packs): Lab's filters and sort on the page's raw dataset summaries.
  const page = pageHook(source, ctx, (raw) => lookup().of(raw));
  ctx.page = page;
  return ctx;
}

// ---------- workbench.datasets.history ----------

function historyItem(raw, index, previewing) {
  const readable = !raw.error;
  const rows = readable ? count(raw.rows) : null, labeled = readable ? count(raw.labeled) : null;
  return {
    revision: String(raw.revision ?? ""),
    position: index + 1,
    at: textOr(raw.at),
    at_ms: stampMs(raw.at),
    current: raw.current === true,
    readable,
    name: readable ? textOr(raw.name) : null,
    saved_at: readable ? textOr(raw.saved_at) : null,
    saved_ms: readable ? stampMs(raw.saved_at) : null,
    rows,
    labeled,
    held_out: readable ? count(raw.test_rows) : null,
    unlabeled: readable ? Math.max(0, rows - labeled) : null,
    questions: readable && Array.isArray(raw.questions) ? raw.questions.filter((id) => typeof id === "string") : [],
    has_check: readable && count(raw.checks) > 0,
    previewing,
  };
}

function previewOf(report) {
  if (!isObject(report)) return null;
  const rows = isObject(report.rows) ? report.rows : {}, labels = isObject(report.labels) ? report.labels : {};
  const test = isObject(report.test) ? report.test : {}, guides = isObject(report.guidelines) ? report.guidelines : null;
  const ids = (value) => (Array.isArray(value) ? value.length : 0);
  return {
    revision: null,
    exists: report.exists !== false,
    rows: { before: count(rows.before), after: count(rows.after), added: count(rows.added), removed: count(rows.removed), order_changed: rows.order_changed === true },
    labels: { added: count(labels.added), removed: count(labels.removed), changed: count(labels.changed) },
    questions_changed: report.questions_changed === true,
    rules_changed: report.rules_changed === true,
    metadata_changed: report.metadata_changed === true,
    check: ["preserved", "removed", "none"].includes(report.check) ? report.check : "none",
    check_changed: report.check_changed === true,
    test: { before: count(test.before), after: count(test.after), changed_membership: count(test.changed_membership), history: textOr(test.history, "none") },
    guidelines: guides ? { before: count(guides.before), after: count(guides.after), added: ids(guides.added), changed: ids(guides.changed), removed: ids(guides.removed) } : null,
  };
}

// source: {
//   datasetId          the dataset this panel lists (a string or a function)
//   state()            the page's panel state { open, busy, list: { id, exists, keep, revisions } | null,
//                      preview: { entry, report } | null, changedOnly }
//   deleted()          the deleted-dataset listing or null; now()
//   matches(item, ctx), arrange(items, ctx)   the Lab hooks for "workbench.datasets.history"
//   reload(), preview(entry), cancelPreview(), restore(), setChangedOnly(on), refresh()
// }
export function datasetsHistoryCtx(source = {}) {
  const make = itemCache(historyItem);
  const datasetId = () => String(read(source, "datasetId", ""));
  const state = () => {
    const value = read(source, "state", {});
    return isObject(value) ? value : {};
  };
  const listing = () => {
    const list = state().list;
    return isObject(list) && list.id === datasetId() && Array.isArray(list.revisions) ? list : null;
  };
  const lookup = () => {
    const list = (listing()?.revisions || []).filter(isObject);
    const previewing = textOr(state().preview?.entry?.revision);
    const position = new Map(list.map((raw, index) => [raw, index]));
    const of = (raw) => {
      const index = position.has(raw) ? position.get(raw) : list.length;
      const open = !!previewing && raw.revision === previewing;
      return make(raw, JSON.stringify([index, open]), index, open);
    };
    return { list, of };
  };
  const busy = () => state().busy === true;
  const notBusy = () => { if (busy()) throw new Error("Wait for the history to finish reading or restoring."); };
  const where = "The history panel";

  const ctx = {
    items() {
      const { list, of } = lookup();
      return list.map(of);
    },
    shown() {
      const { list, of } = lookup();
      const changedOnly = state().changedOnly === true;
      return page.arrange(list.filter((raw) => (!changedOnly || raw.current !== true) && page.matches(raw))).map(of);
    },
    get data() {
      const list = listing();
      const open = state().preview;
      const preview = previewOf(open?.report);
      if (preview) preview.revision = textOr(open?.entry?.revision);
      const deleted = read(source, "deleted", null);
      const now = finite(read(source, "now", null));
      return deepFreeze({
        dataset_id: datasetId(),
        exists: list ? list.exists !== false : null,
        keep: list && Number.isInteger(list.keep) ? list.keep : 20,
        loaded: !!list,
        busy: busy(),
        changed_only: state().changedOnly === true,
        preview,
        deleted: Array.isArray(deleted) ? deleted.filter(isObject).map((entry) => ({ id: String(entry.id ?? ""), name: textOr(entry.name),
          revisions: count(entry.revisions), latest: textOr(entry.latest) })) : null,
        now: now === null ? Date.now() : now,
      });
    },
    actions: {
      reload() {
        notBusy();
        return call(source, "reload", where);
      },
      preview(revision) {
        notBusy();
        const entry = (listing()?.revisions || []).find((raw) => isObject(raw) && raw.revision === revision);
        if (typeof revision !== "string" || !entry) throw new Error(`Revision “${String(revision)}” is not in this history. Refresh it.`);
        if (entry.error) throw new Error("That revision is not a readable dataset file, so it cannot be restored.");
        return call(source, "preview", where, entry);
      },
      cancelPreview() {
        if (!state().preview) throw new Error("No restore preview is open.");
        return call(source, "cancelPreview", where);
      },
      restore() {
        notBusy();
        if (!state().preview?.report) throw new Error("Preview a revision first: a restore always shows its change summary.");
        return call(source, "restore", where);
      },
      setChangedOnly(on) {
        if (typeof on !== "boolean") throw new Error("Say true or false.");
        return call(source, "setChangedOnly", where, on);
      },
    },
    refresh() { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item) => (item && Number.isInteger(item.position) ? `#${item.position}` : "?"),
  };
  const page = pageHook(source, ctx, (raw) => lookup().of(raw));
  ctx.page = page;
  return ctx;
}

// ---------- workbench.datasets.agreement ----------

const optionsOf = (question) => {
  if (!isObject(question)) return [];
  if (question.type === "noul") return ["yes", "no"];
  if (question.type === "score") return Array.isArray(question.criteria) ? question.criteria.map((_, index) => String(index)) : [];
  if (question.type === "box") return [];
  return isObject(question.criteria) ? Object.keys(question.criteria) : [];
};

// Whether a label value fits a question as its select would produce it.
function validLabel(question, value) {
  if (value === null) return true;
  if (!isObject(question)) return false;
  if (question.type === "noul") return typeof value === "boolean";
  if (question.type === "score") return Number.isInteger(value) && value >= 0 && value < optionsOf(question).length;
  if (question.type === "box") return false;
  return typeof value === "string" && optionsOf(question).includes(value);
}

const labelOf = (value) => (value === undefined || value === "" ? null : copyOf(value));

function agreementItem(raw, index, { labels, rowDiffs }) {
  const asked = Array.isArray(raw.questions) ? raw.questions.filter((qid) => typeof qid === "string") : [];
  const given = isObject(labels) ? labels : {};
  const second = Object.create(null);
  for (const qid of asked) second[qid] = has.call(given, qid) ? labelOf(given[qid]) : null;
  const filled = asked.filter((qid) => second[qid] !== null).length;
  const input = isObject(raw.row) || typeof raw.row === "string" ? copyOf(raw.row) : null;
  return {
    row_id: String(raw.row_id ?? ""),
    number: count(raw.number),
    position: index + 1,
    input,
    picture: isObject(raw.row) ? textOr(raw.row._image) : null,
    questions: asked,
    second: { ...second },
    given: filled,
    missing: asked.length - filled,
    done: asked.length - filled === 0,
    differences: rowDiffs,
  };
}

function reportOf(report, questions) {
  if (!isObject(report)) return null;
  const o = isObject(report.overall) ? report.overall : {}, c = isObject(report.counts) ? report.counts : {};
  const rate = (value) => finite(value);
  const order = Object.keys(isObject(questions) ? questions : {});
  const per = isObject(report.questions) ? report.questions : {};
  const ids = [...order.filter((qid) => has.call(per, qid)), ...Object.keys(per).filter((qid) => !order.includes(qid))];
  const disagreements = Array.isArray(report.disagreements) ? report.disagreements : [];
  const total = count(report.disagreements_total);
  return {
    overall: { labels: count(o.labels), agree: count(o.agree), agreement: rate(o.agreement), rows: count(o.rows), rows_agree: count(o.rows_agree),
      rows_agreement: rate(o.rows_agreement), rows_low: rate(o.rows_low), rows_high: rate(o.rows_high) },
    counts: Object.fromEntries(["rows", "matched", "not_found", "repeated", "unlabeled", "compared", "all_agree", "only_second"].map((key) => [key, count(c[key])])),
    questions: ids.map((qid) => {
      const q = isObject(per[qid]) ? per[qid] : {};
      return { id: qid, rows: count(q.rows), agree: count(q.agree), agreement: rate(q.agreement), low: rate(q.low), high: rate(q.high), kappa: rate(q.kappa),
        mixups: (Array.isArray(q.mixups) ? q.mixups : []).filter(isObject).map((m) => ({ saved: labelOf(m.first), second: labelOf(m.second), rows: count(m.rows) })) };
    }),
    disagreements_total: Math.max(total, disagreements.length),
    disagreements_shown: disagreements.length,
    truncated: total > disagreements.length,
    problems_total: count(report.problems_total),
  };
}

// source: {
//   datasetId, datasetName   strings or functions
//   run()              the page's agreement run for this dataset (W.bulk.agreeRuns[id]) or null:
//                      { open, busy, sample, labels, report, choices, pendingSettlements, sessionPreview }
//   matches(item, ctx), arrange(items, ctx)   the Lab hooks for "workbench.datasets.agreement"
//   setLabel(rowId, question, value), compare(), settle(rowId, question, value), refresh(), now()
// }
export function datasetsAgreementCtx(source = {}) {
  const make = itemCache(agreementItem);
  const run = () => {
    const value = read(source, "run", null);
    return isObject(value) ? value : null;
  };
  const sample = () => (isObject(run()?.sample) ? run().sample : null);
  const questionsRaw = () => (isObject(sample()?.questions) ? sample().questions : {});
  const report = () => (isObject(run()?.report) ? run().report : null);
  const choices = () => (isObject(run()?.choices) ? run().choices : {});
  const lookup = () => {
    const list = (Array.isArray(sample()?.items) ? sample().items : []).filter(isObject);
    const labels = isObject(run()?.labels) ? run().labels : {};
    const rep = report();
    const picks = choices();
    const diffs = new Map();
    if (rep) {
      for (const d of Array.isArray(rep.disagreements) ? rep.disagreements : []) {
        if (!isObject(d)) continue;
        const key = settleKey(d.row_id, d.question);
        const settle = has.call(picks, key) ? { set: true, value: labelOf(picks[key]) } : { set: false };
        const entry = { question: String(d.question ?? ""), saved: labelOf(d.first), second: labelOf(d.second), settle };
        diffs.set(d.row_id, [...(diffs.get(d.row_id) || []), entry]);
      }
    }
    const position = new Map(list.map((raw, index) => [raw, index]));
    const of = (raw) => {
      const index = position.has(raw) ? position.get(raw) : list.length;
      const given = has.call(labels, raw.row_id) ? labels[raw.row_id] : null;
      const rowDiffs = rep ? diffs.get(raw.row_id) || [] : null;
      return make(raw, JSON.stringify([index, given ? Object.entries(given) : null, rowDiffs]), index, { labels: given, rowDiffs });
    };
    return { list, of };
  };
  const busy = () => run()?.busy === true;
  const notBusy = () => { if (busy()) throw new Error("Wait for the agreement sample to finish drawing, comparing or saving."); };
  const where = "Label agreement";
  const questionOf = (qid) => (has.call(questionsRaw(), qid) && isObject(questionsRaw()[qid]) ? questionsRaw()[qid] : null);

  const ctx = {
    items() {
      const { list, of } = lookup();
      return list.map(of);
    },
    shown() {
      const { list, of } = lookup();
      return page.arrange(list.filter((raw) => page.matches(raw))).map(of);
    },
    get data() {
      const a = run(), s = sample(), rep = report();
      const items = Array.isArray(s?.items) ? s.items.filter(isObject) : [];
      const labels = isObject(a?.labels) ? a.labels : {};
      const sent = secondItems(items.filter((item) => Array.isArray(item.questions)), labels);
      const now = finite(read(source, "now", null));
      let settled = 0;
      try { settled = rep ? settledItems(rep.disagreements, choices()).length : 0; } catch { settled = 0; }
      return deepFreeze({
        dataset_id: String(read(source, "datasetId", "")),
        dataset_name: String(read(source, "datasetName", "") || read(source, "datasetId", "")),
        open: a?.open === true,
        busy: busy(),
        sample: s ? { requested: count(s.sample_size), drawn: items.length, eligible: count(s.eligible), seed: finite(s.seed),
          recoverable: !!s.session_context } : null,
        questions: Object.entries(questionsRaw()).map(([id, q]) => ({ id, type: isObject(q) && typeof q.type === "string" ? q.type : "", options: optionsOf(q) })),
        given_rows: sent.length,
        given_labels: sent.reduce((sum, item) => sum + Object.keys(item.labels).length, 0),
        unsaved: agreementEditsUnsaved(a),
        pending_settlements: Array.isArray(a?.pendingSettlements) ? a.pendingSettlements.length : 0,
        report: reportOf(rep, questionsRaw()),
        choices: rep ? Object.keys(choices()).length : 0,
        settled_rows: settled,
        now: now === null ? Date.now() : now,
      });
    },
    actions: {
      setSecondLabel(rowId, question, value = null) {
        notBusy();
        const item = (sample()?.items || []).find((entry) => isObject(entry) && entry.row_id === rowId);
        if (typeof rowId !== "string" || !item) throw new Error(`Row “${String(rowId)}” is not in this agreement sample.`);
        if (!Array.isArray(item.questions) || !item.questions.includes(question)) throw new Error(`Row ${item.number} does not ask “${String(question)}”.`);
        if (!validLabel(questionOf(question), value)) throw new Error(`That is not a label “${question}” offers.`);
        return call(source, "setLabel", where, rowId, question, value);
      },
      compare() {
        notBusy();
        if (!sample()) throw new Error("Draw a sample first.");
        if (!secondItems((sample().items || []).filter((entry) => isObject(entry) && Array.isArray(entry.questions)), run()?.labels || {}).length) {
          throw new Error("Give at least one second label before comparing.");
        }
        return call(source, "compare", where);
      },
      settle(rowId, question, value = null) {
        notBusy();
        const rep = report();
        if (!rep) throw new Error("Compare first: settling needs the current comparison.");
        const found = (Array.isArray(rep.disagreements) ? rep.disagreements : []).find((d) => isObject(d) && d.row_id === rowId && d.question === question);
        if (!found) throw new Error("That row and question is not a disagreement shown in the current comparison.");
        const q = questionOf(question);
        const fits = value === null || validLabel(q, value) || JSON.stringify(value) === JSON.stringify(found.first) || JSON.stringify(value) === JSON.stringify(found.second);
        if (!fits) throw new Error(`That is not a label “${question}” offers.`);
        return call(source, "settle", where, rowId, question, value);
      },
    },
    refresh() { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item) => (item && Number.isInteger(item.number) ? `row ${item.number}` : "?"),
  };
  const page = pageHook(source, ctx, (raw) => lookup().of(raw));
  ctx.page = page;
  return ctx;
}
