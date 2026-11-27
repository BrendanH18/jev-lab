// Lab surface of the Workbench saved checks (Bulk tab, Datasets panel): the Review queue read from the user's own gate
// decisions (static/js/workbench-review.js, jev/decisions.py). Pure code: it imports only the kit and a lib helper,
// touches no DOM, storage or network, and is tested in Node (tests/js/lab/surface-wb-review.test.mjs).
// Fixtures for pack tests: tests/js/lab/fixtures/workbench-checks.mjs (sampleReviewQueueCtx).
// This header is the CONTRACT for packs on this surface.
//
// Common rules
//   - items() returns deeply frozen plain JSON objects. While nothing they derive from changes, items() returns the SAME
//     array of the SAME objects, and shown() returns those same objects, so facts may compare items by identity.
//     Facts must not call shown() (it runs the filters, which run the facts); they may call ctx.items().
//   - data is computed at every read and deeply frozen.
//   - Actions throw an Error with a message for the user when a guard refuses. Call them only from a command, an edit
//     or a control the user just used, one call per use, never from a fact, metric, check or render.
//   - NO ACTION ON THIS SURFACE CALLS THE MODEL OR SPENDS BUDGET. Running a check, comparing new rows and trying a
//     new version stay the page's own buttons (with their spend preview and confirm); no action presses them.
//   - Commands on this surface must NOT declare `keys`: the Review queue's own Ctrl/Cmd+Enter navigation acts only
//     inside the queue, and a Lab shortcut would work page-wide.
//   - CSV goes through the kit's csvText/csvCell (spreadsheet formula escaping). Pictures appear by NAME only.
//   - The Review queue has one ctx per check, and Lab's filters and sort are shared by every check's queue. With
//     several queues open at once, the command palette acts on the queue drawn last.
//   - Labeling guidelines are not on this surface (the page shows them beside each label control); a pack must not
//     reconstruct them, and on blind audit rows the page hides examples that match the row.
//
// Label values are stored as the page stores them: Noul true / false, Score the level index (integer 0..levels-1),
// Choice the option key (string); null = no label. Option text is "yes"/"no", "0", "1", …, the key.
//
// =====================================================================================================================
// SURFACE "workbench.review.queue"  —  builder reviewQueueCtx(source)  —  the Review queue of a check
// =====================================================================================================================
// One ctx per check. The list is the queue read from the user's own gate decisions file: every row the gate sent to
// review, then the random audit sample of rows it automated, in file order (by line). The page's "Queue rows" (kind),
// "Labeling status" and "Input slice" filters and Lab's filters decide shown(); Lab's sort applies last. Filters,
// sorts and navigation are presentation only: CSV handoff, session download and "Add N labeled rows" use the WHOLE
// queue, and the ready rows Add takes never depend on what is shown. Kinds: fact, diagnostic, transform, metric,
// exporter, command, tool, panel. There is no importItems.
//
// itemName(item) is "line N". refresh() redraws the queue cards and its "showing N" line.
//
// ITEM
//   line           integer   the decision's line in the file (unique)
//   position       integer   1-based position in the queue, before any filter
//   kind           "review" | "audit"
//   row            object    the input exactly as the decision printed it, "_image" kept by name
//   identity       string    JSON with sorted keys of row
//   image          string | null;   picture_loaded  boolean
//   verified       boolean   the decision carries provenance matching this check's gate ("gate matches check")
//   held           string[]  held question ids (review rows; [] on audit rows)
//   rules          string[]  rules the row broke, as the gate printed them
//   open           string[]  question ids a person must decide (held, rule-read, and every question on audit rows)
//   labels         { questionId: label | null }   the current labels of every queue question: human labels, and on
//                  review rows the gate's cleared gated answers the queue starts from (suggested)
//   edited         string[]  question ids a person changed in this session (select, CSV import, restore)
//   suggested      string[]  review rows: labeled question ids that are the gate's starting suggestion, not a human
//                  edit; [] on audit rows
//   missing        string[]  gated question ids without a label
//   ready          boolean   every gated question is labeled;   status  "ready" | "incomplete"
//   will_add       boolean   ready and among the first `room` ready rows in queue order: Add saves it now
//   revealed       boolean   the page shows the gate's answers: review rows always, audit rows once ready
//   answers        null on an unrevealed (blind) audit row, else { questionId: answer } from the user's decisions
//                  file (Noul true/false, Score level, Choice key; Box answers appear as the gate printed them)
//   candidates     null when unrevealed, else { questionId: [label, …] } the attached shortlist ({} when none)
//   disagree       null when unrevealed, else question ids whose label differs from the gate's answer
//   slice_values   { field: value }   the row's full normalized value for each slice field the page offers
//   current        boolean   the row Next (or the last label edit) went to
//
// DATA
//   dataset        { id, name }
//   busy           boolean   reading, CSV export/import, session download/restore or Add is running (actions refuse)
//   read           boolean   a queue has been read (false: items() is [])
//   text_changed   boolean   the decisions box changed since the queue was read
//   filters        { kind: "all" | "review" | "audit", status: "all" | "incomplete" | "ready", slice_field, slice_value }
//   slice_fields   [{ name, values: string[] }]
//   questions      [{ id, type, gated, threshold, instructions, options }]   threshold null when not gated
//   gates          { questionId: threshold }
//   counts         { decisions, review, auto, in_dataset, repeated, unverified, queued, audit, dropped }   integers
//   problems_total integer   lines that could not be read
//   room, ready, incomplete, adding   integers (adding = min(ready, room))
//   progress       { questionId: { labeled, missing } }   over the whole queue, as the page lists it
//   edits          { rows, labels }   human edits of this session (what a Review session download keeps)
//   session_available boolean   "Download Review session" is possible now
//   csv_preview    null | { matched, changed }   an imported labeling CSV waiting for "Apply imported labels"
//   audit_requested integer | null   the audit sample size asked for when the queue was read
//   next_line      integer | null
//
// ACTIONS (all but resetFilters refuse while data.busy or before a queue is read)
//   setLabel(line, questionId, label)   one label, exactly as the row's select (records a human edit, drops a pending
//                  CSV or session preview). Guards: the line is queued, a queue question, a valid option or null/"".
//   replaceItems(nextItems, { label })   Lab Edits: the whole queue with only `labels` changed (same length, order,
//                  line, kind and input). Changed labels are recorded as human edits. Throws, changing nothing, on any
//                  violation.
//   goTo(line)     scrolls to a shown row and focuses its first open label.
//   next(direction = 1)   the page's "Next incomplete row" (-1: previous) over rows the kind, slice and Lab filters
//                  leave; it sets the status filter to Incomplete as the button does. Guard: such a row exists.
//   setKind(kind), setStatus(status), setSlice(field, value)   the page's filters ("" field = all inputs; value
//                  defaults to the field's first value). Presentation only. Guards: known values.
//   resetFilters() kind and status back to all, slice cleared, Lab's filters and sort cleared. Labels are kept.
// There is NO action that reads decisions, adds rows, downloads or imports the CSV or a session, or calls the model.
//
// BOUNDARIES (AGENTS.md: Review queue, audit, provenance)
//   - Blind audit: an audit row's answers, shortlist and disagreement stay null until its gated questions are labeled.
//     A pack must never reveal, hint at or sort by them before that, and never copy an answer or a shortlist into a
//     label. Labels are HUMAN; an edit may set one only to a value the user chose explicitly.
//   - Never infer accuracy, automation coverage or slice-target passes from the queue: audit results come only from
//     the page's audit report after Add. Metrics here count labeling progress, edits, kinds, provenance and filters.
//   - Exports never mimic the page's labeling CSV or Review session file. An export holding inputs, labels or answers
//     must say so in its label; one that leaves out inputs, labels and answers is preferred. Never export answers or
//     shortlists of unrevealed audit rows (they are null here).
//
// Each ctx also carries `page`: the page's own hook into Lab's filters and sort. It is not part of the pack contract;
// packs never call it.
import { clone } from "../kit.js";
import { stableStringify } from "../lib/json.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const own = (object, key) => isObject(object) && Object.hasOwn(object, key);
const asText = (value) =>
  typeof value === "string" ? value : value === null || value === undefined ? "" : (JSON.stringify(value) ?? "");
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const has = (value) => value !== null && value !== undefined;
const textList = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
const copy = (value) => {
  try {
    return value === undefined ? null : clone(value);
  } catch {
    return null;
  }
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
  try {
    value = typeof source[name] === "function" ? source[name]() : source[name];
  } catch {
    value = undefined;
  }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("The page cannot do that here.");
  return source[name](...args);
}

// ---------- labels ----------

const LABEL_TYPES = Object.freeze(["choice", "noul", "score"]);

// The options a label select lists for a question, as { value, text, description }.
function optionsOf(question) {
  const type = question?.type;
  const criteria = question?.criteria;
  if (type === "noul") {
    return [
      { value: true, text: "yes", description: asText(own(criteria, "true") ? criteria.true : null) },
      { value: false, text: "no", description: asText(own(criteria, "false") ? criteria.false : null) },
    ];
  }
  if (type === "score")
    return (Array.isArray(criteria) ? criteria : []).map((text, index) => ({
      value: index,
      text: String(index),
      description: asText(text),
    }));
  if (type === "choice")
    return Object.entries(isObject(criteria) ? criteria : {}).map(([key, text]) => ({
      value: key,
      text: key,
      description: asText(text),
    }));
  return [];
}

// A label as stored for the question, from a stored value or its option text; undefined when it is not an option.
function storedLabel(question, label) {
  for (const option of optionsOf(question)) {
    if (option.value === label) return option.value;
    if (typeof label === "string" && option.text === label) return option.value;
  }
  return undefined;
}

// The text the page compares labels and answers by (workbench-calibrate.js labelText).
function labelKey(value, type) {
  if (!has(value) || value === "") return "";
  if (type === "noul") {
    if (value === true || /^(yes|true|1|y)$/i.test(String(value))) return "yes";
    if (value === false || /^(no|false|0|n)$/i.test(String(value))) return "no";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const labelShown = (label) => (typeof label === "string" ? `“${label}”` : asText(label));

function questionList(questions, gates) {
  return Object.entries(isObject(questions) ? questions : {})
    .filter(([, question]) => LABEL_TYPES.includes(question?.type))
    .map(([id, question]) => ({
      id,
      type: question.type,
      gated: own(gates, id),
      threshold: own(gates, id) ? finite(gates[id]) : null,
      instructions: asText(question.instructions),
      options: optionsOf(question),
    }));
}

function numberMap(object) {
  return Object.fromEntries(Object.entries(isObject(object) ? object : {}).map(([key, value]) => [key, finite(value)]));
}

// Validates one row's label changes. labels: { questionId: label } -> { questionId: stored | null } for the questions
// whose value changes. Throws on an unknown question or an invalid option.
function labelChanges(name, current, draft, questions) {
  if (!isObject(draft)) throw new Error(`${name}: labels must be an object of question ids and labels.`);
  const out = {};
  for (const [qid, raw] of Object.entries(draft)) {
    if (!own(questions, qid) || !LABEL_TYPES.includes(questions[qid]?.type))
      throw new Error(`${name}: ${qid} is not a question of this queue.`);
    let value = null;
    if (raw !== undefined && raw !== null && raw !== "") {
      value = storedLabel(questions[qid], raw);
      if (value === undefined)
        throw new Error(
          `${name}: ${labelShown(raw)} is not a label option for ${qid} (options: ${optionsOf(questions[qid])
            .map((option) => option.text)
            .join(", ")}).`,
        );
    }
    const before = has(current[qid]) ? current[qid] : null;
    if (
      labelKey(before, questions[qid].type) !== labelKey(value, questions[qid].type) ||
      (before === null) !== (value === null)
    )
      out[qid] = value;
  }
  return out;
}

const imageOf = (row) => (isObject(row) && typeof row._image === "string" ? row._image : null);
const readyOf = (labels, gates) =>
  Object.keys(isObject(gates) ? gates : {}).every((qid) => isObject(labels) && has(labels[qid]));

// Arranges raw rows the way the page shows them: matches on the derived item, then Lab's sort over the items.
function arrangeRaws(source, ctx, raws, byRaw) {
  const passed = raws.filter(
    (raw) => typeof source.matches !== "function" || source.matches(byRaw.get(raw), ctx) !== false,
  );
  if (typeof source.arrange !== "function") return passed;
  const back = new Map(passed.map((raw) => [byRaw.get(raw), raw]));
  const arranged = source.arrange(
    passed.map((raw) => byRaw.get(raw)),
    ctx,
  );
  if (!Array.isArray(arranged) || arranged.length !== passed.length || !arranged.every((item) => back.has(item)))
    return passed;
  return arranged.map((item) => back.get(item));
}

// An edited labels map: missing keys mean unchanged; returns only keys whose values the edit states.
function changeOnly(next, before) {
  if (next === undefined) return {};
  if (!isObject(next)) return next; // labelChanges rejects it
  const out = {};
  for (const [qid, value] of Object.entries(next)) {
    if (!own(before, qid) || stableStringify(before[qid] ?? null) !== stableStringify(value ?? null)) out[qid] = value;
  }
  return out;
}

// =====================================================================================================================
// workbench.review.queue
// =====================================================================================================================

const REVIEW_KINDS = Object.freeze(["all", "review", "audit"]);
const REVIEW_STATUSES = Object.freeze(["all", "incomplete", "ready"]);

// The page's own filters (workbench-review.js queueVisible), used when the page passes none.
function reviewPageVisible(raws, gates, kind, status, field, value) {
  return raws.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (status === "all" || readyOf(item.labels, gates) === (status === "ready")) &&
      (!field || item.slice_values?.[field] === value),
  );
}

// source: {
//   dataset()      { id, name } of the check's dataset
//   queue()        the page's Review queue state (W.bulk.checkRuns[id].queue): { busy, report, edits, kindFilter,
//                  statusFilter, sliceField, sliceValue, nextLine, text, readText, csvPreview, ... }
//   pictures()     picture name -> URL the page has loaded
//   pageVisible()  optional: the raw rows the page's kind/status/slice filters leave (workbench-review.js queueVisible)
//   matches(item, ctx), arrange(items, ctx)   LAB.matches / LAB.arrange for "workbench.review.queue"
//   writeLabels(changes, label)   changes: [[line, { questionId: label | null }], ...] already validated; sets the labels
//                  and records them as human edits, as the row's select does
//   goTo(line), next(direction), setFilter(name, value) (name: kindFilter | statusFilter), setSlice(field, value),
//   resetFilters(), refresh()
// }
export function reviewQueueCtx(source = {}) {
  const queueOf = () => {
    const q = read(source, "queue", null);
    return isObject(q) ? q : {};
  };
  const reportOf = () => {
    const report = queueOf().report;
    return isObject(report) && Array.isArray(report.items) ? report : null;
  };
  const busy = () => queueOf().busy === true;
  const rawItems = () => (reportOf()?.items || []).filter((raw) => isObject(raw) && Number.isInteger(raw.line));
  const questionsOf = () => (isObject(reportOf()?.questions) ? reportOf().questions : {});
  const gatesOf = () => (isObject(reportOf()?.gates) ? reportOf().gates : {});
  const editsOf = () => (isObject(queueOf().edits) ? queueOf().edits : {});
  const filters = () => {
    const q = queueOf();
    const fields = Array.isArray(reportOf()?.slice_fields) ? reportOf().slice_fields : [];
    const field =
      typeof q.sliceField === "string" && fields.some((entry) => entry?.name === q.sliceField) ? q.sliceField : "";
    return {
      kind: REVIEW_KINDS.includes(q.kindFilter) ? q.kindFilter : "all",
      status: REVIEW_STATUSES.includes(q.statusFilter) ? q.statusFilter : "all",
      slice_field: field,
      slice_value: field && typeof q.sliceValue === "string" ? q.sliceValue : "",
    };
  };

  let memo = null;
  const lookup = () => {
    const report = reportOf();
    const raws = rawItems();
    const q = queueOf();
    const pictures = read(source, "pictures", {});
    const loaded = (name) => name !== null && isObject(pictures) && typeof pictures[name] === "string";
    const key = [
      count(report?.room),
      q.nextLine ?? "",
      stableStringify(editsOf()) ?? "",
      raws
        .map((raw) => `${raw.line}:${stableStringify(raw.labels) ?? ""}:${loaded(imageOf(raw.row)) ? 1 : 0}`)
        .join("|"),
    ].join("\u0000");
    if (
      memo &&
      memo.report === report &&
      memo.items === report?.items &&
      memo.length === raws.length &&
      memo.key === key
    )
      return memo.value;
    const questions = questionsOf();
    const gates = gatesOf();
    const edits = editsOf();
    const qids = Object.keys(questions).filter((qid) => LABEL_TYPES.includes(questions[qid]?.type));
    let room = count(report?.room);
    const byRaw = new Map();
    const list = raws.map((raw, position) => {
      const row = copy(raw.row);
      const kind = raw.kind === "audit" ? "audit" : "review";
      const labels = Object.fromEntries(
        qids.map((qid) => [qid, has(raw.labels?.[qid]) ? copy(raw.labels[qid]) : null]),
      );
      const edited = Object.keys(isObject(edits[raw.line]) ? edits[raw.line] : {}).filter((qid) => qids.includes(qid));
      const ready = readyOf(labels, gates);
      const willAdd = ready && room > 0;
      if (willAdd) room--;
      const revealed = kind === "review" || ready;
      const answers = isObject(raw.answers) ? raw.answers : {};
      const image = imageOf(row);
      const item = deepFreeze({
        line: raw.line,
        position: position + 1,
        kind,
        row,
        identity: stableStringify(row) ?? "",
        image,
        picture_loaded: loaded(image),
        verified: isObject(raw.provenance),
        held: textList(raw.held),
        rules: textList(raw.rules),
        open: textList(raw.open),
        labels,
        edited,
        suggested: kind === "review" ? qids.filter((qid) => has(labels[qid]) && !edited.includes(qid)) : [],
        missing: Object.keys(gates).filter((qid) => !has(labels[qid])),
        ready,
        status: ready ? "ready" : "incomplete",
        will_add: willAdd,
        revealed,
        answers: revealed ? copy(answers) : null,
        candidates: revealed ? (isObject(raw.candidates) ? copy(raw.candidates) : {}) : null,
        disagree: revealed
          ? qids.filter(
              (qid) =>
                has(labels[qid]) &&
                labelKey(labels[qid], questions[qid].type) !== labelKey(answers[qid], questions[qid].type),
            )
          : null,
        slice_values: isObject(raw.slice_values) ? copy(raw.slice_values) : {},
        current: q.nextLine === raw.line,
      });
      byRaw.set(raw, item);
      return item;
    });
    Object.freeze(list);
    memo = { report, items: report?.items, length: raws.length, key, value: { raws, list, byRaw } };
    return memo.value;
  };
  const items = () => lookup().list;
  const pageRaws = () => {
    const { raws } = lookup();
    const f = filters();
    if (typeof source.pageVisible === "function") {
      const given = source.pageVisible();
      if (Array.isArray(given)) return given.filter((raw) => raws.includes(raw));
    }
    return reviewPageVisible(raws, gatesOf(), f.kind, f.status, f.slice_field, f.slice_value);
  };
  const visibleRaws = () => {
    if (!reportOf()) return [];
    return arrangeRaws(source, ctx, pageRaws(), lookup().byRaw);
  };
  const notBusy = () => {
    if (busy()) throw new Error("Wait for the Review operation to finish.");
  };
  const writable = () => {
    notBusy();
    if (!reportOf()) throw new Error("Read the gate's decisions first: there is no Review queue yet.");
  };
  const itemAt = (line) => {
    const item = items().find((entry) => entry.line === line);
    if (!item) throw new Error(`Line ${Number.isInteger(line) ? line : String(line)} is not in this Review queue.`);
    return item;
  };

  const ctx = {
    items,
    shown() {
      const { byRaw } = lookup();
      return visibleRaws().map((raw) => byRaw.get(raw));
    },
    get data() {
      const q = queueOf();
      const report = reportOf();
      const list = items();
      const gates = gatesOf();
      const counts = isObject(report?.counts) ? report.counts : {};
      const edits = editsOf();
      const ready = list.filter((item) => item.ready).length;
      const dataset = read(source, "dataset", {});
      const preview = isObject(q.csvPreview) && isObject(q.csvPreview.counts) ? q.csvPreview.counts : null;
      const questions = report ? questionList(questionsOf(), gates) : [];
      return deepFreeze({
        dataset: {
          id: isObject(dataset) && typeof dataset.id === "string" ? dataset.id : null,
          name: isObject(dataset) ? asText(dataset.name || dataset.id) : "",
        },
        busy: busy(),
        read: !!report,
        text_changed: !!report && typeof q.text === "string" && q.text !== q.readText,
        filters: filters(),
        slice_fields: (Array.isArray(report?.slice_fields) ? report.slice_fields : [])
          .filter((field) => isObject(field) && typeof field.name === "string")
          .map((field) => ({ name: field.name, values: textList(field.values) })),
        questions,
        gates: numberMap(gates),
        counts: Object.fromEntries(
          ["decisions", "review", "auto", "in_dataset", "repeated", "unverified", "queued", "audit", "dropped"].map(
            (name) => [name, count(counts[name])],
          ),
        ),
        problems_total: count(report?.problems_total),
        room: count(report?.room),
        ready,
        incomplete: list.length - ready,
        adding: Math.min(ready, count(report?.room)),
        progress: Object.fromEntries(
          questions.map((question) => {
            const labeled = list.filter((item) => has(item.labels[question.id])).length;
            return [question.id, { labeled, missing: list.length - labeled }];
          }),
        ),
        edits: {
          rows: Object.values(edits).filter((labels) => isObject(labels) && Object.keys(labels).length).length,
          labels: Object.values(edits).reduce(
            (n, labels) => n + (isObject(labels) ? Object.keys(labels).length : 0),
            0,
          ),
        },
        session_available:
          !!report &&
          typeof report.session_context === "string" &&
          report.session_context !== "" &&
          q.text === q.readText,
        csv_preview: preview ? { matched: count(preview.matched), changed: count(preview.changed) } : null,
        audit_requested: report && Number.isInteger(report.audit_requested) ? report.audit_requested : null,
        next_line:
          report && Number.isInteger(q.nextLine) && list.some((item) => item.line === q.nextLine) ? q.nextLine : null,
      });
    },
    actions: {
      setLabel(line, questionId, label) {
        writable();
        const item = itemAt(line);
        const changes = labelChanges(`Line ${item.line}`, item.labels, { [questionId]: label }, questionsOf());
        if (!Object.keys(changes).length) return { changed: 0 };
        call(source, "writeLabels", [[item.line, changes]], `Line ${item.line}`);
        return { changed: 1 };
      },
      replaceItems(nextItems, { label = "Lab edit" } = {}) {
        writable();
        const current = items();
        if (!Array.isArray(nextItems)) throw new Error("Give the whole Review queue as a list.");
        if (nextItems.length !== current.length)
          throw new Error(
            `Edits cannot add or remove queued rows: the queue lists ${current.length}, the edit gave ${nextItems.length}.`,
          );
        const changes = [];
        nextItems.forEach((entry, position) => {
          const was = current[position];
          if (!isObject(entry) || entry.line !== was.line)
            throw new Error(`Position ${position + 1}: edits cannot reorder, add or replace queued rows.`);
          if (entry.kind !== was.kind) throw new Error(`Line ${was.line}: review and audit membership cannot change.`);
          if (stableStringify(entry.row) !== was.identity)
            throw new Error(`Line ${was.line}: edits cannot change the input, only labels.`);
          const changed = labelChanges(
            `Line ${was.line}`,
            was.labels,
            changeOnly(entry.labels, was.labels),
            questionsOf(),
          );
          if (Object.keys(changed).length) changes.push([was.line, changed]);
        });
        if (changes.length) call(source, "writeLabels", changes, String(label || "Lab edit"));
        return { changed: changes.length };
      },
      goTo(line) {
        writable();
        const item = itemAt(line);
        if (!ctx.shown().includes(item)) throw new Error(`Line ${item.line} is hidden by the current filters.`);
        return call(source, "goTo", item.line);
      },
      next(direction = 1) {
        writable();
        if (direction !== 1 && direction !== -1) throw new Error("Go to the next (1) or previous (-1) incomplete row.");
        const f = filters();
        const { raws, byRaw } = lookup();
        const open = raws.filter(
          (raw) =>
            (f.kind === "all" || raw.kind === f.kind) &&
            (!f.slice_field || raw.slice_values?.[f.slice_field] === f.slice_value) &&
            !byRaw.get(raw).ready &&
            (typeof source.matches !== "function" || source.matches(byRaw.get(raw), ctx) !== false),
        );
        if (!open.length) throw new Error("No incomplete row is left under the row kind, slice and Lab filters.");
        return call(source, "next", direction);
      },
      setKind(kind) {
        writable();
        if (!REVIEW_KINDS.includes(kind))
          throw new Error(`Unknown row kind “${String(kind)}”: use all, review or audit.`);
        return call(source, "setFilter", "kindFilter", kind);
      },
      setStatus(status) {
        writable();
        if (!REVIEW_STATUSES.includes(status))
          throw new Error(`Unknown labeling status “${String(status)}”: use all, incomplete or ready.`);
        return call(source, "setFilter", "statusFilter", status);
      },
      setSlice(field = "", value = null) {
        writable();
        if (field === "" || field === null) return call(source, "setSlice", "", "");
        const entry = (Array.isArray(reportOf().slice_fields) ? reportOf().slice_fields : []).find(
          (option) => option?.name === field,
        );
        if (!entry) throw new Error(`“${String(field)}” is not an input slice of this queue.`);
        const values = textList(entry.values);
        const chosen = value === null || value === undefined ? values[0] : value;
        if (!values.includes(chosen)) throw new Error(`“${String(chosen)}” is not a value of ${field} in this queue.`);
        return call(source, "setSlice", field, chosen);
      },
      resetFilters() {
        return call(source, "resetFilters");
      },
    },
    refresh() {
      if (typeof source.refresh === "function") source.refresh();
    },
    itemName: (item) => (item && Number.isInteger(item.line) ? `line ${item.line}` : "?"),
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
