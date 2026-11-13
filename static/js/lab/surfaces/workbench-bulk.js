// Lab surfaces of the Workbench Bulk tab (static/js/workbench-bulk.js): the rows editor and the results table.
// Pure code: it imports nothing, touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-wb-bulk.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/workbench-bulk.mjs
// (sampleBulkRowsCtx, sampleBulkResultsCtx). This header is the CONTRACT for packs on these two surfaces.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) } and are built once per
// page session. items() and shown() read the page at call time and return the SAME frozen item objects (compare by
// identity) until the list itself changes. Every data field is a getter computed at read time and frozen: read it when
// you need it, never keep it across renders, never write to it.
//
// ===================================================================================================================
// SURFACE "workbench.bulk.rows"  —  builder bulkRowsCtx(source)  —  fixture sampleBulkRowsCtx(overrides)
// ===================================================================================================================
// The rows of the Bulk rows box (the textarea under "Rows · N"), parsed exactly as the server parses them
// (jev/workbench.py parse_rows / rowsPayload): one row per nonempty line, where a line that is a JSON object is that
// object and any other line is text; or, when the box holds a JSON array, one row per element other than null and "".
// items() is [] when the box is empty. The page has no filter of its own here: the box always shows every row, so
// shown() is items() after Lab's filters, then in Lab's sort order. While a Lab filter or sort is active the page says
// under the box which rows match ("Lab filters match 3 of 12 rows: rows 2, 5, 9"). Per-item edits change the shown
// rows only; checks and exports read shown().
//
// Item (one row). Five STORED fields, which are all a copy holds (Lab hands transforms JSON copies, and its preview,
// Apply and one-step Undo compare lists by these fields alone):
//   input      string | object | array | number | boolean   the row as the model reads it, minus what never reaches
//                        it. A string for a text row: a text line, or an object whose only input field is a string
//                        "text" ({"text": "…"} and a plain line read the same). Otherwise the object without "_expect",
//                        "_test" and "_image"; an array or a number/boolean element of a JSON-array box as it is.
//   image      string | null   the picture name under "_image" (a sample such as "torn-bag" or an uploaded file
//                        name). The picture is sent as the asset `photo`; its bytes are not here.
//   labels     object | null   the human labels under "_expect", by question id, exactly as written: a Choice key, true
//                        or false for a Noul (text such as "yes" is kept as written), a level number for a Score, edges
//                        { left, top, right, bottom } for a Box. {} when the row has none or "_expect" is not an object.
//                        NULL ON A HELD-OUT ROW: its label values stay hidden.
//   test       boolean   a held-out test row: the row has a "_test" key ("_test": true, or a malformed marker, which
//                        also sets problem). Held-out rows are protected: see the invariants below.
//   ref        string | null   null on a tuning row. On a held-out row "held-<n>": with input and image it identifies
//                        the row (n counts held-out rows with the same input and picture), so replaceItems can write
//                        its hidden labels back. Keep it as it is.
// Read-only facts on the items items() and shown() return (non-enumerable: not in copies, snapshots or JSON, so a
// transform reads input, not text, and never sets these):
//   position   integer   1-based among nonempty rows: the row numbers Check dataset health, Check Bulk inputs and the
//                        repairs panel print. itemName() returns it as text.
//   line       integer | null   1-based line of the box the row is on; null when the box is a JSON array
//   kind       "text" | "object" | "array" | "value"   text: input is a string; object: a JSON object with other
//                        fields; array: an array element; value: a number or boolean element
//   text       string | null   what the model reads as text: the text row's input, or an object's string "text" field
//   fields     string[]  the input's top-level field names in written order; ["text"] for a text row; [] otherwise
//   labeled    string[]  the question ids with a label on this row, in written order (also on held-out rows: ids
//                        only, never values)
//   inRun      boolean   position <= data.cap: a Bulk run sends this row (rows past the cap are left out)
//   malformed  boolean   the line starts with "{" but is not a JSON object, so it is sent as plain text
//   problem    string | null   why the server would refuse this row before any call ("_expect must be an object…",
//                        "_test must be true…", "_image must name a picture", "…cannot also have its own photo
//                        field", "…has labels but no input"); null when none. Never contains a label value.
//
// data (getters):
//   format         "lines" | "array"   how the box is written (an empty box is "lines")
//   cap            200                  rows a single Bulk run sends at most
//   heldOut        integer              held-out rows in the box
//   questions      { id: { type, instructions, criteria? } }   the questions selected to run on every row (Bulk's
//                                       "Questions to run on every row"), in their order: Choice criteria is
//                                       { key: description }, Score criteria a list of level descriptions, Noul
//                                       criteria optional, Box none. {} when none are selected or Build's
//                                       questions are invalid.
//   questionError  string | null        why the current Build questions cannot run (source "current" only)
//   source         "current" | "sample" | "dataset"   which question set is selected
//   dataset        { id, name } | null  the saved dataset the box was loaded from or saved as; null when none
//   unsaved        boolean              the box differs from its last save or load, or table labels are not in it
//   labelsDirty    boolean              labels chosen in the results table are not in the box yet
//   running        boolean              a Bulk run or retry is in flight
//   health         object | null        the dataset health report (POST /api/workbench/health) while it still matches
//                                       the box, questions and slice field: { rows, unique_inputs, duplicate_groups,
//                                       conflicts, overlap, questions, invalid_labels, by_slice, lab }. Row numbers
//                                       and counts only, never label values. null until the user checks, and again
//                                       after any edit.
//   preflight      object | null        the Check Bulk inputs report (POST /api/workbench/preflight) while it matches:
//                                       { rows, findings: [{ row, question, code, message }], held_out,
//                                       lab: [same shape] }. null until checked and after any edit.
//
// actions (each throws an Error with a message for the user when its guard refuses; call them only from a command or
// a control the user just pressed, never from a fact, metric, check or render). None of them calls the model.
//   replaceItems(next, { label })  Rewrites the WHOLE rows box from next, through the page's own edit path: exactly
//                     what typing in the box does (results stay until the next run, the health, preflight, repair
//                     and pre-run labeling panels see changed rows and hide their reports, the "unsaved" marker shows).
//                     Saving stays explicit (Save dataset). Guards, in order:
//                       - next must be an array of items; refuses while data.labelsDirty;
//                       - invariants below, checked on every item (the first violation throws, naming the row);
//                       - unapplied label repairs or pre-run labeling drafts: the page asks before discarding them
//                         (Cancel throws and changes nothing).
//                     Returns { changed, rows }. A list that writes the same text changes nothing.
//   importItems(items, { label })  Appends items after the existing rows through replaceItems (same guards). Items
//                     are new rows { input, image?, labels? }: other fields are ignored, and none may be held out.
//   checkHealth()    The page's "Check dataset health": local, no model call. Asks first when table labels are not in
//                     the box (the page's settleLabels). Returns the page's promise; data.health fills in.
//   checkPreflight() The page's "Check Bulk inputs": local, no model call, same settle step. data.preflight fills in.
//   openCsvImport()  Opens the page's Import CSV panel. Importing from it stays the page's own explicit step.
//   focusRow(position) Selects that row's line in the rows box and focuses it. Guard: the row must exist and the box
//                     must be written as lines.
// There is no action that runs Bulk, saves a dataset or draws a test split; no pack may add one.
//
// Invariants replaceItems/importItems enforce (and every transform must keep):
//   - An item may hold only the stored fields; input, image and labels of a tuning row can be edited. Positions follow
//     from the list's order. A tuning row whose input, image and labels match a row of the box is written back exactly
//     as that row was (its own line text); a new or edited one is written as the page writes rows (rowLineFor).
//   - input is nonblank text, a JSON object without "_expect", "_test" or "_image" keys, or a JSON array (no labels
//     or picture on an array). With an image the input may not have its own "photo" field. labels is {} (or null) or
//     an object of JSON values by question id (label values are not checked against the questions here: Check dataset
//     health reports invalid ones). For one-step Undo to work, give labels as {} rather than null when there are none.
//   - Held-out rows stay untouched: every one must be in next exactly once, unchanged (same ref, input, image and
//     test); they may move. No row may become held out or stop being held out (a test split is drawn only by
//     Datasets' own split action), and no new or edited tuning row may repeat a held-out row's input and picture.
//   - The box stays in its format: lines, or a JSON array when it was one or when a row is an array.
//   Blank lines are dropped when the box is rewritten; an unchanged list (every row unchanged and in place) writes
//   nothing at all.
//
// refresh() updates the note under the rows box that says which rows Lab's filters match.
//
// Content boundaries for workbench.bulk.rows: everything here is the user's own inputs and human labels; there are
// no model answers on this surface. Exports and metrics may contain inputs, picture names and tuning-row labels and
// must say so in their label or help. They never contain a held-out row's label values (items hide them: do not try
// to recover them) and never invent labels. An export described as a dataset or rows handoff holds inputs and human
// labels only, written as rows the box accepts. CSV goes through csvText/csvCell (formula escaping).
//
// ===================================================================================================================
// SURFACE "workbench.bulk.results"  —  builder bulkResultsCtx(source)  —  fixture sampleBulkResultsCtx(overrides)
// ===================================================================================================================
// The rows of the CURRENT USER'S OWN latest Bulk run in this page session (the results table "N of M rows", with
// every retry merged in), in the page's own order: its column sort (click a header) when one is set, else row order.
// items() is [] before the first run of the session. shown() is items() after Lab's filters, then Lab's sort, which
// applies after the page's column sort; the table lists exactly shown(). READ-ONLY: there is no replaceItems or
// importItems (answers are model output and may not be edited or pasted in).
//
// Item (one row of the run):
//   index      integer   0-based position in the run (the table's # column is index + 1); unique
//   position   integer   index + 1. itemName() returns it as text.
//   status     "answered" | "failed" | "skipped"   failed: the call returned an error; skipped: never sent (the
//                        budget or a missing key stopped the run). Unanswered rows can be retried by the page.
//   error      string | null   the failed call's message
//   test       boolean   a held-out test row: its answers and labels stay hidden (answers and labels are null)
//   text       string    the row as the table prints it: an object with only "text" reads as its text, anything
//                        else as JSON; the "_test" marker is not shown
//   input      any       the row as sent, without "_test" and "_image" (labels were split off before the call)
//   image      string | null   the picture name the row carried
//   answers    { qid: answer } | null   null on held-out and unanswered rows. answer:
//                { type: "choice" | "score" | "noul" | "box",
//                  value       Choice: the chosen key; Score: the score (0..scale, fractional); Noul: P(yes); Box: null
//                  predicted   the class Calibrate scores: the Choice key, the Score level with the highest
//                              probability ("0", "1", …), "yes"/"no" for a Noul (P(yes) >= 0.5); null for a Box
//                  p           the probability of predicted (for a Noul max(P, 1 - P)); null for a Box
//                  confidence  the answer's confidence field; null when it has none (Noul answers carry none)
//                  probabilities [{ key, p }] Choice options / Score levels in the answer's order; Noul [yes, no];
//                              Box []
//                  scale       Score: the highest level index; otherwise null
//                  box         Box: { left, top, right, bottom } fractions; otherwise null
//                  label       the human label for this question in the answer's terms ("yes"/"no", a key, a level
//                              "2", edges for a Box); null when there is none or it fits no class (see labelValid)
//                  labelValid  true / false when a label exists (false: it fits no option or level); null without one
//                  agrees      predicted === label (Box: overlap >= 0.5 of the union); null without a valid label }
//   labels     { qid: value } | null   the human labels now in force for the row, including ones chosen in the
//                        table and not yet kept in the rows box; {} when none; null on held-out rows
//   meta       { model, latency_ms, input_tokens, output_tokens, cost_usd } | null   measured for that call; any field
//                        may be null; null on unanswered rows
//   calCorrect boolean | null   Calibrate's verdict for data.calQuestion on this row; null when not scored
//
// data (getters):
//   run            null before the first run, then { rows, completed, failed, skipped, held_out, wall_ms, input_tokens,
//                  cost_usd, model, requested_model, stopped, retry_error }: measured totals of the run INCLUDING
//                  every retry attempt (wall_ms sums attempts; it is not one wall-clock span). model is what answered
//                  (a version such as "jev-1.14.0" when known), requested_model what was asked.
//   questions      the questions the run asked, { id: { type, instructions, criteria? } } in order; {} before a run
//   questionIds    the question ids in the answers' order (the table's columns); [] when nothing was answered
//   calQuestion    the question Calibrate shows (the table's "label · q" column) or null
//   sort           { key, dir: "asc" | "desc" } the page's own column sort ("__row" is the # column), or null
//   labelsDirty    labels chosen in the table are not in the rows box yet
//   running        a run or retry is in flight
//
// actions (each throws an Error with a message for the user when its guard refuses; none of them calls the model):
//   sortBy(key, dir)  Sets the page's own column sort, as clicking a header does. Guard: key is "__row" or one of
//                     data.questionIds; dir is "asc" or "desc".
//   keepLabels()      The page's "Keep labels in rows": rewrites the rows box as JSON lines carrying the table's
//                     labels, with the page's own confirm when the box changed since the run. Guard: a run exists.
//   downloadCsv()     The page's "Download CSV" of the run (all rows, test rows' answers hidden). Guard: a run exists.
//   focusRow(index)   Scrolls to that row in the table. Guard: the row must be shown.
// There is no action that runs, retries, labels or edits answers; no pack may add one. Retrying stays the page's
// explicit control with its spend preview.
//
// refresh() re-renders the table rows from shown(); the rest of the panel keeps its state.
//
// Content boundaries for workbench.bulk.results:
//   - Every answer here was requested by the current user in this page session. Show, measure and export them; never
//     store them, never present them as a dataset, never fill a missing answer, and never show a held-out row's
//     answers or labels (items already hide them).
//   - Exports that hold answers or probabilities say so in their label or help. An export described as rows, a
//     dataset or a labeling handoff holds inputs and human labels only, never answers, predictions or meta.
//   - cost_usd, tokens and latency are measured values of calls already made. A projection (per 1,000 rows, a
//     larger batch) is arithmetic on them and says so; a spend bound is shown as "≤"/"at most", never as spend.
//   - A rule a pack applies to probabilities (a threshold, "close call", "would go to review") is plain local code,
//     advisory and labeled as such; it never changes Policy's gates or the exported gate.
//   - CSV goes through csvText/csvCell (formula escaping).

const CAP = 200;
const EDGES = ["left", "top", "right", "bottom"];
const EMPTY = Object.freeze([]);
const RESERVED = ["_expect", "_test", "_image"];

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Stable JSON with sorted keys, for comparing inputs regardless of how their fields were written.
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

// A source field: a value, or a function that returns the value now. Errors read as the fallback.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This page cannot do that here.");
  return source[name](...args);
}

const questionsOf = (value) => (isObject(value) ? deepFreeze(plain(value)) : Object.freeze({}));

// ---------- workbench.bulk.rows ----------

// The rows box as the server reads it: [{ raw, line, source, malformed }] and its format.
function parseBox(text) {
  const box = typeof text === "string" ? text : "";
  if (/^\[/.test(box.trim())) {
    try {
      const value = JSON.parse(box);
      if (Array.isArray(value)) {
        return { format: "array", entries: value.filter((raw) => raw !== null && raw !== "").map((raw) => ({ raw, line: null, source: null, malformed: false })) };
      }
    } catch { /* read as lines */ }
  }
  const entries = [];
  box.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith("{")) {
      let value;
      try { value = JSON.parse(line); } catch { value = undefined; }
      if (isObject(value)) return entries.push({ raw: value, line: index + 1, source: line, malformed: false });
      return entries.push({ raw: line, line: index + 1, source: line, malformed: true });
    }
    entries.push({ raw: line, line: index + 1, source: line, malformed: false });
  });
  return { format: "lines", entries };
}

// What identifies a row's input as the model reads it, with its picture name: labels and the test marker are left out.
const identityOf = (input, image) => canon([typeof input === "string" ? { text: input } : input, image]);

// The fields a row item stores (enumerable, so Lab's snapshots, copies and Undo see exactly these).
const STORED = ["ref", "input", "image", "labels", "test"];

// One row item: the stored fields, plus read-only facts about the row that copies leave out.
function rowView(entry, position, ref) {
  const { raw } = entry;
  let kind = "value", input = raw, image = null, test = false, labels = {}, labeled = [], problem = null;
  if (typeof raw === "string") kind = "text";
  else if (Array.isArray(raw)) kind = "array";
  else if (isObject(raw)) {
    const fields = Object.fromEntries(Object.entries(raw).filter(([key]) => !RESERVED.includes(key)));
    const keys = Object.keys(fields);
    // An object whose only input field is a string "text" is what the model reads for a text line.
    if (keys.length === 1 && keys[0] === "text" && typeof fields.text === "string") { kind = "text"; input = fields.text; }
    else { kind = "object"; input = fields; }
    const problems = [];
    if (has(raw, "_test")) {
      test = true;
      if (raw._test !== true) problems.push("_test must be true, or left out");
    }
    if (has(raw, "_image")) {
      if (typeof raw._image === "string" && raw._image.trim()) image = raw._image;
      else problems.push("_image must name a picture");
      if (has(raw, "photo")) problems.push("a row with _image cannot also have its own photo field: the picture is sent under it");
    }
    if (has(raw, "_expect")) {
      if (isObject(raw._expect)) {
        labeled = Object.keys(raw._expect);
        labels = plain(raw._expect);
        if (!keys.length && !has(raw, "_test") && !has(raw, "_image")) problems.push("this row has labels but no input");
      } else problems.push("_expect must be an object keyed by question id");
    }
    if (test) labels = null;  // a held-out row's label values stay hidden
    problem = problems.length ? problems.join("; ") : null;
  }
  const item = { ref: test ? ref : null, input: plain(input), image, labels, test };
  const text = kind === "text" ? input : kind === "object" && typeof input.text === "string" ? input.text : null;
  const facts = { position, line: entry.line, kind, text, fields: kind === "text" ? ["text"] : kind === "object" ? Object.keys(input) : [],
    labeled, inRun: position <= CAP, malformed: entry.malformed, problem };
  for (const [name, value] of Object.entries(facts)) Object.defineProperty(item, name, { value: deepFreeze(value), enumerable: false });
  return deepFreeze(item);
}

// The rows of a parsed box: a held-out row's ref is "held-<n>", n counting the held-out rows with the same input and
// picture, so it stays the same when rows move.
function rowViews(box) {
  const seen = new Map();
  return Object.freeze(box.entries.map((entry, index) => {
    const draft = rowView(entry, index + 1, null);
    if (!draft.test) return draft;
    const key = identityOf(draft.input, draft.image);
    seen.set(key, (seen.get(key) || 0) + 1);
    return rowView(entry, index + 1, `held-${seen.get(key)}`);
  }));
}

// What a pack may set on a row: compared as written (labels {} and null read the same).
const authored = (item) => JSON.stringify([item.input === undefined ? null : item.input, item.image ?? null,
  isObject(item.labels) && Object.keys(item.labels).length ? item.labels : null, item.test === true]);

// One row as written in the box (the page's rowLineFor without labels): plain text stays a line unless it would
// split, lose whitespace or read as JSON.
function lineFor(raw) {
  if (typeof raw === "string") {
    const simple = raw === raw.trim() && !/^[{[]/.test(raw) && !/[\n\r]/.test(raw);
    return simple ? raw : JSON.stringify({ text: raw });
  }
  return JSON.stringify(raw);
}

// The row a new or edited tuning item writes. Throws an Error naming the row.
function rawFromItem(item, where) {
  const { input } = item;
  const image = item.image === undefined || item.image === null ? null : item.image;
  if (image !== null && !(typeof image === "string" && image.trim())) throw new Error(`${where}: image must be a picture name or null.`);
  const labels = item.labels === undefined || item.labels === null ? null : item.labels;
  if (labels !== null && !isObject(labels)) throw new Error(`${where}: labels must be an object keyed by question id, or null.`);
  let copy;
  try { copy = labels === null ? null : plain(labels); } catch { throw new Error(`${where}: labels must be plain JSON values.`); }
  const withLabels = copy && Object.keys(copy).length ? copy : null;
  const extra = { ...(image !== null ? { _image: image } : {}), ...(withLabels ? { _expect: withLabels } : {}) };
  if (typeof input === "string") {
    if (!input.trim()) throw new Error(`${where}: the input is blank, so the row would disappear. Remove the row instead.`);
    return image === null && !withLabels ? input : { text: input, ...extra };
  }
  if (Array.isArray(input)) {
    if (image !== null || withLabels) throw new Error(`${where}: a row that is a JSON array cannot carry a picture or labels. Wrap it in an object first.`);
    return plain(input);
  }
  if (!isObject(input)) throw new Error(`${where}: the input must be text, a JSON object or a JSON array.`);
  const reserved = RESERVED.filter((key) => has(input, key));
  if (reserved.length) throw new Error(`${where}: the input may not hold ${reserved.join(", ")}. Use labels and image; held-out markers come only from a test split.`);
  if (image !== null && has(input, "photo")) throw new Error(`${where}: a row with a picture cannot also have its own photo field.`);
  if (!Object.keys(input).length && image === null) throw new Error(`${where}: the input is an empty object, so the model would read nothing.`);
  let fields;
  try { fields = plain(input); } catch { throw new Error(`${where}: the input must be plain JSON.`); }
  return { ...fields, ...extra };
}

// The rows box text for the next list (null when every row is unchanged and in place), or an Error naming the first
// row that breaks an invariant.
function composeBox(box, views, next) {
  const origin = views.map((view, index) => ({ view, index, key: authored(view), used: false }));
  const held = origin.filter((entry) => entry.view.test);
  const heldIdentities = new Set(held.map((entry) => identityOf(entry.view.input, entry.view.image)));
  const rows = [];
  let same = next.length === views.length;
  next.forEach((item, index) => {
    const where = `Row ${index + 1}`;
    if (!isObject(item)) throw new Error(`${where} is not a row object.`);
    const extra = Object.keys(item).filter((key) => !STORED.includes(key));
    if (extra.length) throw new Error(`${where}: ${extra.join(", ")} cannot be set. Edit input, image or labels; everything else follows from them.`);
    const key = authored(item);
    if (item.test === true) {
      const match = held.find((entry) => !entry.used && entry.view.ref === item.ref && entry.key === key);
      if (!match) {
        if (held.some((entry) => entry.view.ref === item.ref && entry.key === key)) throw new Error(`${where} repeats a held-out row. Held-out rows cannot be copied.`);
        if (held.some((entry) => entry.view.ref === item.ref)) throw new Error(`${where} is a held-out row, which must stay exactly as it is.`);
        throw new Error(`${where} is marked held out. Only Datasets' test split can hold rows out.`);
      }
      match.used = true;
      if (match.index !== index) same = false;
      rows.push({ raw: box.entries[match.index].raw, source: box.entries[match.index].source });
      return;
    }
    if (item.ref !== undefined && item.ref !== null) {
      throw new Error(`${where} carries a held-out row's ref but is not marked held out. Held-out rows cannot become tuning rows here.`);
    }
    const match = origin.find((entry) => !entry.used && !entry.view.test && entry.key === key);
    if (match) {
      match.used = true;
      if (match.index !== index) same = false;
      rows.push({ raw: box.entries[match.index].raw, source: box.entries[match.index].source });
      return;
    }
    same = false;
    const raw = rawFromItem(item, where);
    const view = rowView({ raw, line: null, malformed: false }, index + 1, null);
    if (heldIdentities.has(identityOf(view.input, view.image))) {
      throw new Error(`${where} would repeat the input of a held-out test row. Held-out inputs stay on the test side only.`);
    }
    rows.push({ raw, source: null });
  });
  const missing = held.filter((entry) => !entry.used);
  if (missing.length) {
    throw new Error(`This edit would remove held-out test row${missing.length === 1 ? "" : "s"} ${missing.map((entry) => entry.view.position).join(", ")}. Held-out rows stay untouched.`);
  }
  if (same) return null;  // every row unchanged and in place: the box stays exactly as it is
  if (box.format === "array" || rows.some((row) => Array.isArray(row.raw))) {
    return rows.length ? `[\n${rows.map((row) => JSON.stringify(row.raw)).join(",\n")}\n]` : "";
  }
  return rows.map((row) => row.source ?? lineFor(row.raw)).join("\n");
}

// source: {
//   rowsText: () => the rows box text,      questions: () => the questions selected to run,
//   questionError: () => string | null,     source: () => "current" | "sample" | "dataset",
//   dataset: () => { id, name },            unsaved, labelsDirty, running: () => boolean,
//   health: () => the current health report or null,     preflight: () => the current preflight report or null,
//   matches: (item, ctx) => boolean (LAB.matches),       arrange: (items, ctx) => items (LAB.arrange),
//   confirmDiscard: () => boolean   ask before discarding unapplied repairs or pre-run labeling drafts,
//   write: (text, label) => void    the page's own edit path for the rows box,
//   checkHealth(), checkPreflight(), openCsvImport(), focusLine(line), refresh()   the page's own operations
// }
export function bulkRowsCtx(source = {}) {
  let built = { text: null, box: { format: "lines", entries: [] }, items: EMPTY };
  const parsed = () => {
    const text = read(source, "rowsText", "");
    const current = typeof text === "string" ? text : "";
    if (current !== built.text) {
      const box = parseBox(current);
      built = { text: current, box, items: rowViews(box) };
    }
    return built;
  };
  const replace = (next, options = {}) => {
    if (!Array.isArray(next)) throw new Error("A Lab edit must give the whole list of rows.");
    if (read(source, "labelsDirty", false) === true) {
      throw new Error("Labels chosen in the results table are not in the rows box yet. Use Keep labels in rows first, then preview this edit again.");
    }
    const { text, box, items } = parsed();
    const nextText = composeBox(box, items, next);
    if (nextText === null || nextText === text) return { changed: false, rows: items.length };
    if (typeof source.confirmDiscard === "function" && source.confirmDiscard() === false) {
      throw new Error("Nothing changed: the rows box was kept as it was.");
    }
    call(source, "write", nextText, typeof options?.label === "string" && options.label ? options.label : "Lab edit");
    return { changed: true, rows: parseBox(nextText).entries.length };
  };
  const ctx = {
    items: () => parsed().items,
    shown: () => {
      const list = ctx.items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get format() { return parsed().box.format; },
      get cap() { return CAP; },
      get heldOut() { return parsed().items.filter((item) => item.test).length; },
      get questions() { return questionsOf(read(source, "questions", null)); },
      get questionError() {
        const message = read(source, "questionError", null);
        return typeof message === "string" && message ? message : null;
      },
      get source() {
        const value = read(source, "source", "current");
        return ["current", "sample", "dataset"].includes(value) ? value : "current";
      },
      get dataset() {
        const value = read(source, "dataset", null);
        return isObject(value) && typeof value.id === "string" && value.id ? Object.freeze({ id: value.id, name: typeof value.name === "string" ? value.name : "" }) : null;
      },
      get unsaved() { return read(source, "unsaved", false) === true; },
      get labelsDirty() { return read(source, "labelsDirty", false) === true; },
      get running() { return read(source, "running", false) === true; },
      get health() {
        const report = read(source, "health", null);
        return isObject(report) ? deepFreeze(plain(report)) : null;
      },
      get preflight() {
        const report = read(source, "preflight", null);
        return isObject(report) ? deepFreeze(plain(report)) : null;
      },
    },
    actions: {
      replaceItems: (next, options) => replace(next, options),
      importItems(items, options = {}) {
        if (!Array.isArray(items) || !items.length) throw new Error("There is nothing to import.");
        items.forEach((item, index) => {
          if (!isObject(item)) throw new Error(`Imported row ${index + 1} is not a row object.`);
          if (item.test === true) throw new Error(`Imported row ${index + 1} is marked held out. Only Datasets' test split can hold rows out.`);
        });
        const fresh = items.map((item) => ({ input: item.input, image: item.image ?? null, labels: item.labels ?? {} }));
        return replace([...parsed().items, ...fresh], { label: options?.label || "Import" });
      },
      checkHealth: () => call(source, "checkHealth"),
      checkPreflight: () => call(source, "checkPreflight"),
      openCsvImport: () => call(source, "openCsvImport"),
      focusRow(position) {
        const item = Number.isInteger(position) ? parsed().items.find((entry) => entry.position === position) : undefined;
        if (!item) throw new Error(`There is no row ${String(position)} in the rows box.`);
        if (item.line === null) throw new Error("The rows box is a JSON array, so its rows have no line to go to.");
        return call(source, "focusLine", item.line);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && Number.isInteger(item.position) ? String(item.position) : String(index + 1)),
  };
  return ctx;
}

// ---------- workbench.bulk.results ----------

// The table's text for a row: an object with only "text" reads as its text, anything else as JSON, the test marker
// left out (the page's rowText).
function tableText(row) {
  let value = row;
  if (isObject(value) && has(value, "_test")) {
    const { _test, ...rest } = value;
    value = rest;
  }
  if (typeof value === "string") return value;
  if (isObject(value) && Object.keys(value).length === 1 && typeof value.text === "string") return value.text;
  return JSON.stringify(value) ?? "";
}

function probabilityList(answer) {
  return Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
}

function boxOf(value) {
  if (!isObject(value)) return null;
  const edges = EDGES.map((edge) => finite(value[edge]));
  return edges.includes(null) ? null : { left: edges[0], top: edges[1], right: edges[2], bottom: edges[3] };
}

function overlap(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = width * height;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : 0;
}

// A human label in the answer's own terms (jev/calibrate.py _label), or undefined when it fits no class.
function labelClass(type, raw, answer, levels) {
  if (type === "box") {
    const box = boxOf(raw);
    return box && box.left < box.right && box.top < box.bottom ? box : undefined;
  }
  if (type === "choice") return typeof raw === "string" && probabilityList(answer).some((entry) => entry.key === raw) ? raw : undefined;
  if (type === "noul") {
    if (raw === true || raw === false) return raw ? "yes" : "no";
    const text = String(raw).trim().toLowerCase();
    return ["yes", "true", "1", "y"].includes(text) ? "yes" : ["no", "false", "0", "n"].includes(text) ? "no" : undefined;
  }
  if (!(typeof raw === "number" || (typeof raw === "string" && raw.trim()))) return undefined;
  const level = Number(raw);
  return Number.isInteger(level) && levels.includes(String(level)) ? String(level) : undefined;
}

function answerView(answer, label) {
  const type = typeof answer.type === "string" ? answer.type : "";
  const probabilities = type === "noul" ? [] : type === "box" ? [] : probabilityList(answer);
  let value = null, predicted = null, p = null, scale = null, box = null;
  if (type === "choice") {
    value = typeof answer.choice === "string" ? answer.choice : null;
    predicted = value;
    p = probabilities.find((entry) => entry.key === value)?.p ?? null;
  } else if (type === "score") {
    value = finite(answer.score);
    const levels = isObject(answer.legend) && Object.keys(answer.legend).length ? Object.keys(answer.legend).length : probabilities.length;
    scale = levels ? levels - 1 : null;
    let best = null;
    for (const entry of probabilities) if (!best || entry.p > best.p) best = entry;
    predicted = best ? best.key : null;
    p = best ? best.p : null;
  } else if (type === "noul") {
    value = finite(answer.noul);
    if (value !== null) {
      predicted = value >= 0.5 ? "yes" : "no";
      p = Math.max(value, 1 - value);
      probabilities.push({ key: "yes", p: value }, { key: "no", p: 1 - value });
    }
  } else if (type === "box") box = boxOf(answer.box);
  const hasLabel = label !== undefined && label !== null && label !== "";
  const fitted = hasLabel ? labelClass(type, label, answer, probabilities.map((entry) => entry.key)) : undefined;
  const labelValid = hasLabel ? fitted !== undefined : null;
  let agrees = null;
  if (fitted !== undefined) agrees = type === "box" ? (box ? overlap(fitted, box) + 1e-9 >= 0.5 : null) : predicted === null ? null : predicted === fitted;
  return { type, value, predicted, p, confidence: type === "noul" ? null : finite(answer.confidence), probabilities, scale, box,
    label: fitted === undefined ? null : fitted, labelValid, agrees };
}

const metaOf = (meta) => (isObject(meta) ? {
  model: typeof meta.model === "string" && meta.model ? meta.model : null, latency_ms: finite(meta.latency_ms),
  input_tokens: finite(meta.input_tokens), output_tokens: finite(meta.output_tokens), cost_usd: finite(meta.cost_usd),
} : null);

function resultItem(raw, labels, verdict) {
  const row = raw.row;
  const test = isObject(row) && row._test === true;
  const status = isObject(raw.answers) ? "answered" : typeof raw.error === "string" && raw.error ? "failed" : "skipped";
  const input = isObject(row) ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_test" && key !== "_image")) : row;
  const own = isObject(labels) ? labels : {};
  const answers = status === "answered" && !test
    ? Object.fromEntries(Object.entries(raw.answers).filter(([, answer]) => isObject(answer)).map(([qid, answer]) => [qid, answerView(answer, own[qid])]))
    : null;
  return deepFreeze({ index: raw.index, position: raw.index + 1, status, error: status === "failed" ? raw.error : null, test,
    text: tableText(row), input: plain(input) ?? null, image: isObject(row) && typeof row._image === "string" && row._image ? row._image : null,
    answers, labels: test ? null : plain(own), meta: status === "answered" ? metaOf(raw.meta) : null,
    calCorrect: test || typeof verdict !== "boolean" ? null : verdict });
}

// source: {
//   result: () => the page's Bulk result ({ results, rows, completed, wall_ms, input_tokens, cost_usd, model, … }) or null,
//   order: () => result.results in the page's order (its column sort),
//   labels: () => { index: { qid: value } } the human labels now in force,     questions: () => the questions asked,
//   calQuestion: () => qid | null,     calReport: () => Calibrate's report ({ rows: [{ index, correct }] }) or null,
//   sort: () => { key, dir: 1 | -1 } | null,     requestedModel: () => string,     labelsDirty, running: () => boolean,
//   matches, arrange   (LAB.matches / LAB.arrange),
//   sortBy(key, dir 1 | -1), keepLabels(), downloadCsv(), focusRow(index), refresh()   the page's own operations
// }
export function bulkResultsCtx(source = {}) {
  const result = () => {
    const value = read(source, "result", null);
    return isObject(value) && Array.isArray(value.results) ? value : null;
  };
  const cache = new WeakMap();
  const verdicts = () => {
    const report = read(source, "calReport", null);
    const rows = isObject(report) && Array.isArray(report.rows) ? report.rows : [];
    return new Map(rows.filter((row) => isObject(row) && Number.isInteger(row.index)).map((row) => [row.index, row.correct]));
  };
  const itemFor = (raw, labels, verdict) => {
    const key = JSON.stringify([labels ?? null, verdict ?? null]);
    const known = cache.get(raw);
    if (known && known.key === key) return known.item;
    const item = resultItem(raw, labels, verdict);
    cache.set(raw, { key, item });
    return item;
  };
  const questionIds = () => {
    const first = result()?.results.find((row) => isObject(row?.answers));
    return first ? Object.keys(first.answers) : [];
  };
  const items = () => {
    const current = result();
    if (!current) return EMPTY;
    const ordered = read(source, "order", null);
    const list = (Array.isArray(ordered) ? ordered : current.results).filter((raw) => isObject(raw) && Number.isInteger(raw.index));
    const labels = read(source, "labels", {});
    const marks = verdicts();
    return list.map((raw) => itemFor(raw, isObject(labels) ? labels[raw.index] : undefined, marks.get(raw.index)));
  };
  const ctx = {
    items,
    shown: () => {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get run() {
        const current = result();
        if (!current) return null;
        const rows = current.results.filter(isObject);
        const count = (status) => rows.filter((raw) => (isObject(raw.answers) ? "answered" : typeof raw.error === "string" && raw.error ? "failed" : "skipped") === status).length;
        const requested = read(source, "requestedModel", null);
        return Object.freeze({ rows: finite(current.rows) ?? rows.length, completed: count("answered"), failed: count("failed"), skipped: count("skipped"),
          held_out: rows.filter((raw) => isObject(raw.row) && raw.row._test === true).length,
          wall_ms: finite(current.wall_ms), input_tokens: finite(current.input_tokens), cost_usd: finite(current.cost_usd),
          model: typeof current.model === "string" ? current.model : null, requested_model: typeof requested === "string" && requested ? requested : null,
          stopped: typeof current.stopped === "string" && current.stopped ? current.stopped : null,
          retry_error: typeof current.retry_error === "string" && current.retry_error ? current.retry_error : null });
      },
      get questions() { return result() ? questionsOf(read(source, "questions", null)) : Object.freeze({}); },
      get questionIds() { return Object.freeze(questionIds()); },
      get calQuestion() {
        const qid = read(source, "calQuestion", null);
        return result() && typeof qid === "string" && qid ? qid : null;
      },
      get sort() {
        const sort = read(source, "sort", null);
        return result() && isObject(sort) && typeof sort.key === "string" && sort.key ? Object.freeze({ key: sort.key, dir: sort.dir === 1 ? "asc" : "desc" }) : null;
      },
      get labelsDirty() { return read(source, "labelsDirty", false) === true; },
      get running() { return read(source, "running", false) === true; },
    },
    actions: {
      sortBy(key, dir = "desc") {
        if (!result()) throw new Error("Run Bulk first: there is no table to sort.");
        if (key !== "__row" && !questionIds().includes(key)) throw new Error(`There is no column ${String(key)} in the results table.`);
        if (dir !== "asc" && dir !== "desc") throw new Error("Sort direction must be asc or desc.");
        return call(source, "sortBy", key, dir === "asc" ? 1 : -1);
      },
      keepLabels() {
        if (!result()) throw new Error("Run Bulk first: there are no table labels to keep.");
        return call(source, "keepLabels");
      },
      downloadCsv() {
        if (!result()) throw new Error("Run Bulk first: there is no table to download.");
        return call(source, "downloadCsv");
      },
      focusRow(index) {
        const item = Number.isInteger(index) ? ctx.shown().find((entry) => entry.index === index) : undefined;
        if (!item) throw new Error(`Row ${Number.isInteger(index) ? index + 1 : String(index)} is not shown in the results table.`);
        return call(source, "focusRow", index);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && Number.isInteger(item.position) ? String(item.position) : String(index + 1)),
  };
  return ctx;
}
