// Lab surface of the Workbench pre-run labeling queue ("Label before running" under the Bulk rows box,
// static/js/workbench-labeling.js prelabelBody, server side jev/prelabel.py) and the labeling guidelines shown beside its
// label controls (static/js/guidelines.js, jev/guidelines.py). Pure code: it imports only the kit, a lib helper and
// the page's own pure modules prelabel.js and guidelines.js, touches no DOM, storage or network, and is tested in
// Node (tests/js/lab/surface-wb-labeling.test.mjs). Fixture for pack tests: tests/js/lab/fixtures/workbench-labeling.mjs
// (sampleLabelingQueueCtx). Starter pack: static/js/lab/packs/workbench/labeling-queue-essentials.js.
// This header is the CONTRACT for packs on this surface.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.labeling.queue"  —  builder labelingQueueCtx(source)  —  "Label before running"
// ---------------------------------------------------------------------------------------------------------------
// The list is the open pre-run labeling queue: the TUNING rows of the Bulk rows box that still miss a human label for
// at least one Choice, Noul or Score question, in the current slice (the page's "Filter by field" / "Value" selects),
// in ROWS-BOX ORDER. The server builds it (POST /api/workbench/prelabel, no model call) when the user presses
// "Label missing rows" or picks a slice. Held-out ("_test") rows, array rows, empty object rows and rows whose every
// question is labeled NEVER enter it, existing labels are never shown (even invalid ones), and Box questions are never
// asked here. Each row carries the user's DRAFT labels: human labels picked in this page session (or merged from the
// user's own labeling CSV or draft file) that only "Apply N labels to rows" writes into the rows box, and only
// "Save dataset" keeps. The page builds ONE ctx per page session; items(), shown() and data read the page at call time.
//
// The queue is EMPTY ([] from items() and shown()) until it is opened, and again whenever the rows box, the questions
// or the typed result-table labels change (the drafts belong to that snapshot; the page then hides them).
// Kinds this surface hosts: fact, diagnostic, transform, metric, exporter, command, tool, panel (and behavior).
// There is no importItems: queue rows come only from the rows box, so Paste to import does not render here.
//
// items()   every queue row of the current slice, rows-box order, as frozen objects (see ITEM). While
//           the queue, its drafts and the current row are unchanged, items() returns the SAME array of the SAME
//           objects, so a fact may cache per ctx.items() array (WeakMap) and compare items by identity or by index.
// shown()   the rows the page shows now, in display order: after the page's "Labeling status" filter (All rows |
//           Incomplete | Ready) and Lab's filters, in rows-box order and then Lab's sort when one is set (Lab's sort
//           applies last; ties keep rows-box order). The same objects as items(). Per-item transforms change only these.
//           Facts must not call shown() (it runs the filters, which run the facts); they may call ctx.items().
// itemName(item) is "Row N" with N = item.row_number, exactly as the queue labels the row.
// refresh() re-renders the queue rows and its "showing N" line (not the Lab section, so its controls keep focus).
//
// ITEM  one queue row (frozen). Four STORED fields, which are all a copy holds (Lab hands transforms JSON copies, and its
// preview, Apply and one-step Undo compare lists by these fields alone):
//   index          integer   0-based position of the row among the NONEMPTY parsed lines of the rows box (the
//                            server's index; Apply, CSV and draft files use it). Unique in the queue.
//   row            string | object   the input as the queue shows it: the row text, or the row object WITHOUT "_expect"
//                            and "_test" (the server strips them). An object keeps "_image" (the picture NAME) and every
//                            other field, nested values included. A copy.
//   missing        string[]  the question ids this row still needs a label for, in question order (nonempty). These are
//                            the only questions a draft may fill: a question the row already labels is not listed.
//   draft          object    { questionId: label } for every missing question that has a draft now (others absent).
//                            Label values as stored: Noul true/false, Score the level index (integer 0..levels-1),
//                            Choice the option key (string). {} when the row has no draft. Keys follow question order,
//                            or the order the last Lab write gave.
// READ-ONLY facts (not enumerable: readable on what items() and shown() return, absent from copies, so a TRANSFORM
// must work from the stored fields: identity is stableStringify(row) from lib/json.js, ready is every missing id in draft):
//   row_number     integer   index + 1, the "Row N" the page shows
//   position       integer   1-based position in this slice's queue (rows-box order), before any filter
//   kind           "text" | "object"
//   identity       string    the row's input identity: JSON with sorted keys of `row` (labels and test markers already
//                            removed, picture name retained). Two queue rows with the same identity are duplicate
//                            inputs, the identity dataset health and Review use. A text row and an object row never match.
//   image          string | null   the picture name ("_image") of an object row, else null
//   picture_loaded boolean   the page has the picture's URL (the queue shows it); false for rows without a picture
//   questions      [{ id, type }]   the missing ids with their type "choice" | "noul" | "score"
//   filled         integer   missing questions with a draft
//   blank          integer   missing questions without one (missing.length - filled)
//   ready          boolean   blank === 0, exactly the page's "Ready" (prelabel.js labelReady)
//   status         "ready" | "incomplete"   as the "Labeling status" filter reads it
//   current        boolean   the row "Next incomplete row" (or the last label edit) went to; at most one row
// A transform returns items with the stored fields only, changing `draft` alone. For one-step Undo to work, give draft
// values as stored (true, 2, "billing", not "yes" or "2") and keep `draft` an object ({} for none).
//
// DATA  ctx.data is computed at every read and deeply frozen; read it when needed.
//   prepared       boolean   a queue is open for the current rows/questions snapshot (false: items() is [])
//   busy           boolean   the page is preparing the queue, applying, exporting or previewing an import (every
//                            action refuses while busy)
//   status         "all" | "incomplete" | "ready"   the page's "Labeling status" filter
//   questions      [{ id, type, instructions, options }]   the queue's Choice/Noul/Score questions in question order
//                  ([] when not prepared). instructions: the authored text (structured instructions as JSON text).
//                  options: [{ value, text, description }] in the order the label select lists them: Noul
//                  { true, "yes" }, { false, "no" }; Score { 0, "0" }, { 1, "1" }, …; Choice { key, key }.
//                  description: the authored criterion text ("" when none; Noul criteria are optional).
//   slice          null when not prepared, else { field: string | null, value: string | null, fields: string[],
//                  values: [{ value, shown, rows }] }   the server's slice: the selected top-level input field and
//                  full normalized value (null = all rows / all values), the fields offered, and the values of the
//                  selected field with their display text (shown) and eligible row counts ([] when no field).
//   eligible       integer | null   tuning rows that miss a label, across ALL slices (null when not prepared)
//   missing        integer | null   missing labels across ALL slices (the "of N missing labels" count)
//   progress       null when not prepared, else { ready, incomplete }   over this slice's queue, ignoring every filter
//   drafts         { labels, rows, outside_slice }   draft labels across ALL slices of this snapshot, as "Apply N labels"
//                  counts them; rows with at least one draft; draft labels on rows outside the current slice (Apply
//                  includes them). All 0 when not prepared.
//   next_index     integer | null   the index of the current row (item.current), null when none
//   csv_preview    null, or { rows, matched, labels }   counts of a labeling CSV / draft-file import waiting for
//                  "Accept imported label drafts" (it never holds the imported values here)
//   dataset        { id: string | null, name: string }   the Bulk dataset the rows came from (id null when unsaved)
//   guidelines     null when not prepared, the dataset is unsaved, or its guidelines are not loaded yet (the page loads them when it
//                  draws the first label control), else { questionId: { note, examples: [{ input, label, why }] } }
//                  for the queue's questions that have a guideline with a note or a valid example. note: trimmed
//                  text ("" when none); examples: the made-up examples whose label is still an option, label as the
//                  option text ("yes", "2", "billing"); why "" when none. HUMAN-ONLY (see boundaries). {} = none saved.
//
// ACTIONS  the page's own operations. Each throws an Error with a message for the user when its guard refuses. Call
// them only from a command, an edit or a control the user just used, one call per use, never from a fact, metric,
// check or render. Every action refuses while data.busy; every action but prepare and resetFilters refuses while
// the queue is not prepared for the current snapshot.
//   setDraft(index, questionId, label)   sets one draft label, exactly as picking it in that row's select (clears a
//                  pending CSV import preview). label: a stored value (true, 2, "billing") or its option text
//                  ("yes", "2"); null or "" clears the draft. Guards: the row is in the queue, the question is one it
//                  misses, the label is one of the question's options.
//   replaceItems(nextItems, { label })   writes the DRAFTS of a whole edited queue (Lab Edits and their Undo). The list
//                  must be items() (or their copies) with only `draft` changed: same length and order, same index, row and
//                  missing on every row. Every draft key must be a missing question of its row and every value one of its
//                  options (stored value or option text; null or "" clears). Any other field is ignored. Rows
//                  whose drafts did not change are not touched; drafts on rows outside the slice and draft keys the
//                  queue does not list are kept. Throws, changing nothing, on any violation. Returns { changed }.
//   goTo(index)    scrolls to a SHOWN row, makes it the current row and focuses its first label select.
//   next(direction = 1)   the page's "Next incomplete row" (-1: previous), in rows-box order over this slice's rows
//                  that Lab's filters leave; it sets the status filter to Incomplete as the button does. Guard: some
//                  such row is incomplete.
//   setStatus(status)   the "Labeling status" filter: "all" | "incomplete" | "ready".
//   prepare(field = null, value = null)   the page's "Label missing rows" / slice selects: asks the server for the
//                  queue of one slice (no model call). Typed result-table labels must be settled first (the page asks).
//                  Drafts survive slice changes; a changed rows box or question set starts with no drafts, as always.
//                  Guards: field is null or one of data.slice.fields; value is null or a string. Returns a promise.
//   resetFilters() status back to "All rows" and Lab's filters and sort cleared. Drafts are kept. No guard.
// There is NO action that applies drafts to the rows box, saves the dataset, downloads or imports the page's labeling
// CSV or draft file, edits guidelines or calls the model, and a pack must not add one: Apply and Save stay explicit
// buttons of the page.
//
// INVARIANTS  Items and data are frozen copies; nothing a pack does reaches the rows box. Drafts change only through
// setDraft / replaceItems, which enforce the page's rules: only missing questions of tuning rows in the queue, only
// valid options, existing labels never replaced, held-out rows never touched. Filters, sorts and navigation are
// presentation only: they never change drafts, what Apply submits (every slice), or the rows box.
//
// CONTENT BOUNDARIES (AGENTS.md: pre-run labeling, its CSV/draft handoffs, labeling guidelines)
//   - There are NO model answers on this surface and a pack must never show one, suggest one, or present anything as
//     the model's view of a row.
//   - Draft labels are HUMAN labels. An edit or command may set a draft only to a label the user explicitly chose in
//     its parameters or a control (for example "set topic to billing on the shown rows"), or copy the user's own draft
//     to rows with the identical input. It must NEVER infer a label from the input (keywords, lengths, similarity),
//     from guideline examples, or from another question's draft.
//   - Commands here must NOT declare `keys`: a Lab shortcut works page-wide, and labeling shortcuts may act only inside
//     the labeling panel (the page's own Ctrl/Cmd+Enter). Commands never apply, save or call the model.
//   - EXPORTS hold what their label says. Inputs and draft labels may appear in a separately named copy/download whose
//     label says it holds inputs and drafts. Never mimic or replace the page's importable files (the tuning labeling CSV
//     with row_id/input/missing/label:<question> columns, the "jev-labeling-draft" JSON): those are bound to the
//     rows/questions snapshot by the server and are only produced there. Held-out rows and existing labels are not on
//     this surface and must not be reconstructed. Pictures appear by name only. CSV goes through csvText/csvCell.
//   - GUIDELINES (data.guidelines) are human-only: show them to the person labeling, count them, check for missing
//     ones. Never put them in a request, a gate or a check, and put notes or examples in an export only when its label
//     says it holds the labeling guidelines. A fact never returns guideline text.
//   - FACTS land in the Lab facts table and its CSV. A fact may return counts, lengths, flags, categories from a fixed
//     vocabulary (question ids and types, statuses, input shape), and input text (it is on screen in full). It must not
//     return guideline notes or examples.
//   - METRICS count this queue, its drafts and filters; nothing here is a measurement of the model.
//
// The ctx also carries `page` ({ matches(rawItem), visible() }): the page's own hook into Lab's filters and sort for the
// queue it renders. It is not part of the pack contract; packs never call it.
import { clone } from "../kit.js";
import { stableStringify } from "../lib/json.js";
import { labelProgress, labelReady, visibleLabels } from "../../prelabel.js";
import { exampleLabelText, shownExamples } from "../../guidelines.js";

const LABELING_STATUSES = Object.freeze(["all", "incomplete", "ready"]);
const LABELING_TYPES = Object.freeze(["choice", "noul", "score"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const own = (object, key) => isObject(object) && Object.prototype.hasOwnProperty.call(object, key);
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : (JSON.stringify(value) ?? ""));
const copy = (value) => {
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
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

// The options a label select lists for a question, as { value, text, description }.
function optionsOf(question) {
  const type = question?.type;
  const criteria = question?.criteria;
  if (type === "noul") {
    return [{ value: true, text: "yes", description: asText(own(criteria, "true") ? criteria.true : null) },
      { value: false, text: "no", description: asText(own(criteria, "false") ? criteria.false : null) }];
  }
  if (type === "score") return (Array.isArray(criteria) ? criteria : []).map((text, index) => ({ value: index, text: String(index), description: asText(text) }));
  if (type === "choice") return Object.entries(isObject(criteria) ? criteria : {}).map(([key, text]) => ({ value: key, text: key, description: asText(text) }));
  return [];
}

// A label as stored for the question, from a stored value or its option text; undefined when it is not an option.
function storedLabel(question, label) {
  const options = optionsOf(question);
  for (const option of options) {
    if (option.value === label) return option.value;
    if (typeof label === "string" && option.text === label) return option.value;
  }
  return undefined;
}

const labelShown = (label) => (typeof label === "string" ? `“${label}”` : asText(label));

// source: {
//   state()        the page's pre-run labeling state (W.bulk.prelabel), raw: { busy, report, context, drafts, status,
//                  nextIndex, csvPreview, field, value }. Read at every call: the page may replace the object.
//   current()      whether state.report belongs to the current rows/questions snapshot (the page's prelabelContext)
//   pictures()     picture name -> URL the page has loaded (W.bulk.pictures)
//   dataset()      the Bulk dataset { id, name } (W.bulk.dataset)
//   guidelines()   the loaded guidelines of that dataset ({ guidelines, questions, ... } from the server) or null
//   matches(item, ctx), arrange(items, ctx)   the Lab hooks: LAB.matches / LAB.arrange for "workbench.labeling.queue"
//   writeDrafts(changes, label)   changes: [[index, { questionId: label | null }], ...] already validated; merges them
//                  into state.drafts (null deletes), clears a pending import preview, re-renders, tells the user
//   goTo(index), next(direction), setStatus(status), prepare(field, value), resetFilters(), refresh()
// }
export function labelingQueueCtx(source = {}) {
  const stateOf = () => {
    const state = read(source, "state", null);
    return isObject(state) ? state : {};
  };
  const prepared = () => {
    const state = stateOf();
    return isObject(state.report) && Array.isArray(state.report.items) && read(source, "current", false) === true;
  };
  const busy = () => stateOf().busy === true;
  const draftsOf = () => {
    const drafts = stateOf().drafts;
    return isObject(drafts) ? drafts : {};
  };
  const rawItems = () => (prepared() ? stateOf().report.items.filter((raw) => isObject(raw) && Number.isInteger(raw.index)) : []);
  const questionMap = () => {
    const questions = prepared() ? stateOf().report.questions : null;
    return isObject(questions) ? questions : {};
  };

  // The key order of each row's draft as the last Lab write gave it, so items() after a Lab edit equal the edited list
  // (Lab's one-step Undo compares JSON snapshots). Reset when the queue is reopened.
  const orders = { report: null, byIndex: new Map() };
  const remember = (index, draft) => {
    if (orders.report !== stateOf().report) orders.byIndex = new Map();
    orders.report = stateOf().report;
    orders.byIndex.set(index, Object.keys(draft).filter((qid) => draft[qid] !== null && draft[qid] !== undefined && draft[qid] !== ""));
    memo = null;
  };

  // One list of items per (queue, drafts, current row, loaded pictures): the page asks for it many times per render.
  let memo = null;
  const lookup = () => {
    const state = stateOf();
    const raws = rawItems();
    const pictures = read(source, "pictures", {});
    const picturesKey = raws.map((raw) => (isObject(raw.row) && typeof raw.row._image === "string" && isObject(pictures)
      && typeof pictures[raw.row._image] === "string" ? 1 : 0)).join("");
    const key = `${stableStringify(draftsOf())}\u0000${state.nextIndex ?? ""}\u0000${picturesKey}`;
    if (memo && memo.report === state.report && memo.length === raws.length && memo.key === key) return memo.value;
    const questions = questionMap();
    const drafts = draftsOf();
    const order = orders.report === state.report ? orders.byIndex : new Map();
    const byRaw = new Map();
    const list = raws.map((raw, position) => {
      const row = copy(raw.row);
      const missing = (Array.isArray(raw.missing) ? raw.missing : []).filter((qid) => typeof qid === "string");
      const saved = isObject(drafts[raw.index]) ? drafts[raw.index] : {};
      const draft = {};
      for (const qid of [...(order.get(raw.index) || []).filter((qid) => missing.includes(qid)), ...missing]) {
        const value = saved[qid];
        if (value !== undefined && value !== null && !own(draft, qid)) draft[qid] = copy(value);
      }
      const filled = Object.keys(draft).length;
      const ready = labelReady({ index: raw.index, missing }, drafts);
      const image = isObject(row) && typeof row._image === "string" ? row._image : null;
      // STORED fields are enumerable: what Lab's copies, previews, snapshots and Undo see.
      const item = { index: raw.index, row: deepFreeze(row), missing: deepFreeze(missing), draft: deepFreeze(draft) };
      // READ-ONLY facts are not enumerable: readable on items() and shown(), absent from copies.
      const facts = {
        row_number: raw.index + 1,
        position: position + 1,
        kind: typeof row === "string" ? "text" : "object",
        identity: stableStringify(row) ?? "",
        image,
        picture_loaded: image !== null && isObject(pictures) && typeof pictures[image] === "string",
        questions: deepFreeze(missing.map((qid) => ({ id: qid, type: typeof questions[qid]?.type === "string" ? questions[qid].type : "" }))),
        filled,
        blank: missing.length - filled,
        ready,
        status: ready ? "ready" : "incomplete",
        current: state.nextIndex === raw.index,
      };
      for (const [name, value] of Object.entries(facts)) Object.defineProperty(item, name, { value, enumerable: false });
      Object.freeze(item);
      byRaw.set(raw, item);
      return item;
    });
    Object.freeze(list);
    memo = { report: state.report, length: raws.length, key, value: { raws, list, byRaw } };
    return memo.value;
  };
  const items = () => lookup().list;

  // The raw queue rows the page shows: status filter, then Lab's filters, then Lab's sort.
  const visibleRaws = () => {
    if (!prepared()) return [];
    const { raws, byRaw } = lookup();
    const status = LABELING_STATUSES.includes(stateOf().status) ? stateOf().status : "all";
    const passed = visibleLabels(raws, draftsOf(), status)
      .filter((raw) => typeof source.matches !== "function" || source.matches(byRaw.get(raw), ctx) !== false);
    if (typeof source.arrange !== "function") return passed;
    const back = new Map(passed.map((raw) => [byRaw.get(raw), raw]));
    const arranged = source.arrange(passed.map((raw) => byRaw.get(raw)), ctx);
    if (!Array.isArray(arranged) || arranged.length !== passed.length || !arranged.every((item) => back.has(item))) return passed;
    return arranged.map((item) => back.get(item));
  };

  const notBusy = () => { if (busy()) throw new Error("Wait for the labeling queue to finish preparing, applying or importing."); };
  const writable = () => {
    notBusy();
    if (!prepared()) throw new Error("Open the queue with Label missing rows first. It closes when the rows, questions or typed labels change.");
  };
  const itemAt = (index) => {
    const item = items().find((entry) => entry.index === index);
    if (!item) throw new Error(`Row ${Number.isInteger(index) ? index + 1 : String(index)} is not in this labeling queue.`);
    return item;
  };
  const call = (name, ...args) => {
    if (typeof source[name] !== "function") throw new Error("The labeling queue cannot do that here.");
    return source[name](...args);
  };
  // A row's draft change: every missing question, with its stored label or null. Throws on an invalid label.
  const draftChange = (item, draft) => {
    if (!isObject(draft)) throw new Error(`Row ${item.row_number}: drafts must be an object of question ids and labels.`);
    for (const qid of Object.keys(draft)) {
      if (!item.missing.includes(qid)) throw new Error(`Row ${item.row_number}: ${qid} is not missing a label on this row. Existing labels are never replaced here.`);
    }
    const questions = questionMap();
    const labels = {};
    for (const qid of item.missing) {
      const raw = draft[qid];
      if (raw === undefined || raw === null || raw === "") { labels[qid] = null; continue; }
      const value = storedLabel(questions[qid], raw);
      if (value === undefined) {
        throw new Error(`Row ${item.row_number}: ${labelShown(raw)} is not a label option for ${qid} (options: ${optionsOf(questions[qid]).map((option) => option.text).join(", ")}).`);
      }
      labels[qid] = value;
    }
    return labels;
  };
  const sameDraft = (labels, draft) => stableStringify(Object.fromEntries(Object.entries(labels).filter(([, value]) => value !== null))) === stableStringify(draft);

  const ctx = {
    items,
    shown() {
      const { byRaw } = lookup();
      return visibleRaws().map((raw) => byRaw.get(raw));
    },
    get data() {
      const state = stateOf();
      const ready = prepared();
      const report = ready ? state.report : null;
      const questions = questionMap();
      const raws = rawItems();
      const drafts = ready ? draftsOf() : {};
      const inSlice = new Set(raws.map((raw) => String(raw.index)));
      let labels = 0, rows = 0, outside = 0;
      for (const [index, entry] of Object.entries(drafts)) {
        const count = entry && typeof entry === "object" ? Object.keys(entry).length : 0;
        labels += count;
        if (count) rows++;
        if (!inSlice.has(index)) outside += count;
      }
      const preview = isObject(state.csvPreview) && isObject(state.csvPreview.counts) ? state.csvPreview.counts : null;
      const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
      const dataset = read(source, "dataset", {});
      const loaded = ready && isObject(dataset) && typeof dataset.id === "string" ? read(source, "guidelines", null) : null;
      let guidelines = null;
      if (isObject(loaded) && (isObject(loaded.guidelines) || loaded.guidelines === undefined)) {
        guidelines = {};
        for (const [qid, question] of Object.entries(questions)) {
          if (!own(loaded.guidelines, qid) || !isObject(loaded.guidelines[qid])) continue;
          const guideline = loaded.guidelines[qid];
          const note = typeof guideline.note === "string" ? guideline.note.trim() : "";
          const examples = shownExamples(guideline, question).examples.map((example) => ({ input: asText(example.input),
            label: exampleLabelText(example.label, question), why: typeof example.why === "string" ? example.why : "" }));
          if (note || examples.length) guidelines[qid] = { note, examples };
        }
      }
      const slice = report ? {
        field: typeof report.field === "string" ? report.field : null,
        value: typeof report.value === "string" ? report.value : null,
        fields: (Array.isArray(report.fields) ? report.fields : []).map((field) => (isObject(field) ? field.name : field)).filter((name) => typeof name === "string"),
        values: (Array.isArray(report.values) ? report.values : []).filter(isObject)
          .map((entry) => ({ value: asText(entry.value), shown: asText(entry.shown ?? entry.value), rows: count(entry.rows) })),
      } : null;
      const nextIndex = ready && Number.isInteger(state.nextIndex) && raws.some((raw) => raw.index === state.nextIndex) ? state.nextIndex : null;
      return deepFreeze({
        prepared: ready,
        busy: busy(),
        status: LABELING_STATUSES.includes(state.status) ? state.status : "all",
        questions: Object.entries(questions).filter(([, question]) => LABELING_TYPES.includes(question?.type))
          .map(([id, question]) => ({ id, type: question.type, instructions: asText(question.instructions), options: optionsOf(question) })),
        slice,
        eligible: report && Number.isInteger(report.eligible) ? report.eligible : null,
        missing: report && Number.isInteger(report.missing) ? report.missing : null,
        progress: ready ? labelProgress(raws, drafts) : null,
        drafts: { labels, rows, outside_slice: outside },
        next_index: nextIndex,
        csv_preview: preview ? { rows: count(preview.rows), matched: count(preview.matched), labels: count(preview.labels) } : null,
        dataset: { id: isObject(dataset) && typeof dataset.id === "string" ? dataset.id : null, name: isObject(dataset) ? asText(dataset.name) : "" },
        guidelines,
      });
    },
    actions: {
      setDraft(index, questionId, label) {
        writable();
        const item = itemAt(index);
        if (typeof questionId !== "string" || !item.missing.includes(questionId)) {
          throw new Error(`Row ${item.row_number} does not miss a label for ${String(questionId)}. Existing labels are never replaced here.`);
        }
        const next = { ...item.draft, [questionId]: label };
        const labels = draftChange(item, next);
        if (sameDraft(labels, item.draft)) return { changed: 0 };
        call("writeDrafts", [[item.index, labels]], `Row ${item.row_number}`);
        remember(item.index, next);
        return { changed: 1 };
      },
      replaceItems(nextItems, { label = "Lab edit" } = {}) {
        writable();
        const current = items();
        if (!Array.isArray(nextItems)) throw new Error("Give the whole labeling queue as a list.");
        if (nextItems.length !== current.length) {
          throw new Error(`Edits cannot add or remove queue rows: the queue lists ${current.length} row${current.length === 1 ? "" : "s"}, the edit gave ${nextItems.length}.`);
        }
        const changes = [];
        const drafts = [];
        nextItems.forEach((entry, position) => {
          const was = current[position];
          if (!isObject(entry) || entry.index !== was.index) throw new Error(`Position ${position + 1}: edits cannot reorder, add or replace queue rows.`);
          if (stableStringify(entry.row) !== was.identity) throw new Error(`Row ${was.row_number}: edits cannot change the input, only draft labels.`);
          if (stableStringify(entry.missing) !== stableStringify(was.missing)) throw new Error(`Row ${was.row_number}: the questions missing a label come from the rows box and cannot change here.`);
          const draft = entry.draft === undefined || entry.draft === null ? {} : entry.draft;
          const labels = draftChange(was, draft);
          drafts.push([was.index, draft]);
          if (!sameDraft(labels, was.draft)) changes.push([was.index, labels]);
        });
        if (changes.length) call("writeDrafts", changes, String(label || "Lab edit"));
        for (const [index, draft] of drafts) remember(index, draft);
        return { changed: changes.length };
      },
      goTo(index) {
        writable();
        const item = itemAt(index);
        if (!ctx.shown().includes(item)) throw new Error(`Row ${item.row_number} is hidden by the current filters.`);
        return call("goTo", item.index);
      },
      next(direction = 1) {
        writable();
        if (direction !== 1 && direction !== -1) throw new Error("Go to the next (1) or previous (-1) incomplete row.");
        const { list } = lookup();
        const open = list.filter((item) => !item.ready && (typeof source.matches !== "function" || source.matches(item, ctx) !== false));
        if (!open.length) throw new Error("No incomplete row is left in this slice under the Lab filters.");
        return call("next", direction);
      },
      setStatus(status) {
        notBusy();
        if (!LABELING_STATUSES.includes(status)) throw new Error(`Unknown labeling status “${String(status)}”: use all, incomplete or ready.`);
        return call("setStatus", status);
      },
      prepare(field = null, value = null) {
        notBusy();
        if (field !== null) {
          const report = prepared() ? stateOf().report : null;
          const fields = report && Array.isArray(report.fields) ? report.fields.map((entry) => (isObject(entry) ? entry.name : entry)) : [];
          if (typeof field !== "string" || !fields.includes(field)) throw new Error(`“${String(field)}” is not a field this queue can be sliced by.`);
        }
        if (value !== null && typeof value !== "string") throw new Error("A slice value is text, or null for all values.");
        return call("prepare", field, field === null ? null : value);
      },
      resetFilters() {
        return call("resetFilters");
      },
    },
    refresh() { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item) => (item && Number.isInteger(item.row_number) ? `Row ${item.row_number}` : "?"),
    // The page's hook (not for packs): Lab's filters on a raw queue row, and the raw rows the page draws, in order.
    page: {
      matches(raw) {
        if (typeof source.matches !== "function" || !isObject(raw)) return true;
        const item = lookup().byRaw.get(raw);
        return !item || source.matches(item, ctx) !== false;
      },
      visible: () => visibleRaws(),
    },
  };
  return ctx;
}
