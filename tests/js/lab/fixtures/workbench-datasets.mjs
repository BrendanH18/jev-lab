// Fixtures for packs on the Workbench Datasets panel (contract: static/js/lab/surfaces/workbench-datasets.js).
// Not a test file.
//
//   import { sampleDatasetsCatalogCtx, sampleDatasetsHistoryCtx, sampleDatasetsAgreementCtx, DATASETS_NOW }
//     from "./fixtures/workbench-datasets.mjs";
//
// Every ctx is made by the real builder from hand-written raw data with the page's exact shapes (GET
// /api/workbench/datasets summaries, a /history listing, an /agreement sample and comparison), so items, data and
// shown() have the page's semantics. Fictional Harbor Coffee Co. data, .example domains only. Clock DATASETS_NOW:
// 2026-11-12T12:00:00Z. Each ctx carries env (fakeEnv(): toasts, copied, downloads), state (the mutable page state the
// actions change) and log (every action the page received, as [name, ...args]). Pass lab: a Lab host (createLab) to
// route matches/arrange through it, as the page does.
//
// ---- sampleDatasetsCatalogCtx(overrides) — "workbench.datasets.catalog" ----
// Six saved datasets in saved order (file names A to Z):
//   archived-refunds      "Archived refunds"; notes "archived: replaced by harbor-support-inbox" (the default page
//                         filter { exclude: "archived" } HIDES it); 9 rows all labeled ({ refund: 9 }); 1 question,
//                         1 guideline; saved check with 1 check note; split 3 held out, 3 labeled, share 1/3, 4 looks,
//                         locked 2026-06-02T09:00:00Z; saved 2026-06-01T10:00:00Z.
//   bean-reviews          "Bean reviews"; no notes; 12 rows all labeled ({ quality: 12 }); 1 question; no guidelines,
//                         check or split; saved 2026-11-10T08:00:00Z. PINNED.
//   cafe-photos           "Cafe photos"; 6 rows, none labeled; no questions; no saved_at.
//   empty-draft           no name (shows its id), no notes field; 0 rows; saved 2026-11-11T07:30:00Z.
//   harbor-support-inbox  "Harbor support inbox"; notes "Email tickets from support@harbor.example"; 40 rows, 30
//                         labeled ({ intent: 30, urgent: 18 }); 2 questions, 2 guidelines; saved check, no notes on it;
//                         split 8 held out, 6 labeled, share 0.2, 1 look, locked 2026-10-31T09:00:00Z; saved
//                         2026-10-30T16:20:00Z. LOADED in the rows box; its Label agreement panel is OPEN.
//   wholesale-leads       "Wholesale leads"; notes "Draft, needs a second labeler"; 20 rows, 5 labeled
//                         ({ route: 5, spam: 3, legacy_tag: 1 }: three question ids although the file saves 2
//                         questions); 1 guideline; no check or split; saved 2026-09-05T12:00:00Z.
// shown() by default: bean-reviews, cafe-photos, empty-draft, harbor-support-inbox, wholesale-leads (saved order).
// overrides: datasets (raw summaries), filters (page settings, default { exclude: "archived" }; {} shows all),
// pinnedIds (default ["bean-reviews"]), loadedId (default "harbor-support-inbox"; null for none), unsaved, saveBusy,
// copyBusy, agreementOpen (ids, default ["harbor-support-inbox"]), now, lab.
//
// ---- sampleDatasetsHistoryCtx(overrides) — "workbench.datasets.history" ----
// harbor-support-inbox's kept revisions, newest first:
//   #1 20261030T162000000000Z-a1b2c3d4e5f6  2026-10-30T16:20:00Z  CURRENT  40 rows · 30 labeled · 8 held out ·
//      [intent, urgent] · check
//   #2 20261028T101500000000Z-0f9e8d7c6b5a  2026-10-28T10:15:00Z  38 rows · 24 labeled · no split · [intent, urgent]
//   #3 20261025T080000000000Z-badbadbadbad  2026-10-25T08:00:00Z  UNREADABLE ("Not a readable dataset file")
//   #4 20261020T090000000000Z-1234567890ab  2026-10-20T09:00:00Z  38 rows · 26 labeled · [intent, urgent]
//   #5 20261001T090000000000Z-cafe00c0ffee  2026-10-01T09:00:00Z  25 rows · 0 labeled · no questions; name "Support"
// Deleted datasets with kept history: old-promos (2 revisions, newest 2026-08-14T15:00:00Z).
// overrides: revisions (raw entries), exists (default true), changedOnly, busy, preview (true: an open preview of
// #2 with a hand-written change summary), deleted (list or null), datasetId, loaded (false: the list is not read yet),
// now, lab.
//
// ---- sampleDatasetsAgreementCtx(overrides) — "workbench.datasets.agreement" ----
// harbor-support-inbox's blind sample: 5 of 30 eligible rows (requested 5, seed 7, recoverable). Questions in order:
// intent (choice: refund / replacement / question), urgent (noul), tone (score: Upset / Neutral / Pleased).
//   row 3   a1f0  email "My order HC-1042 arrived stale..."   asks intent, urgent   second: refund, true    (done)
//   row 7   b2e1  chat  "Do you ship to Canada?"               asks intent           second: question        (done)
//   row 12  c3d2  email "Grinder broke..." picture broken-grinder.png
//                                                             asks intent, urgent, tone   second: replacement (1 of 3)
//   row 18  d4c3  social "Love the new Ethiopian roast!"      asks tone             nothing given
//   row 25  e5b4  a text input "Cancel my subscription"        asks intent, urgent   nothing given
// The CURRENT comparison (made up; Compare was pressed after those labels): 4 labels compared, 2 agree; 3 rows, 1
// agrees on every question (Wilson 0.0615 to 0.7923). intent: 3 rows, 2 agree, kappa 0.5, mixup refund -> replacement.
// urgent: 1 row, 0 agree, kappa null, mixup false -> true. Disagreements: row 3 urgent (saved false, second true) and row
// 12 intent (saved refund, second replacement; SETTLED as replacement). 2 of 2 shown.
// overrides: sample (raw sample or null: nothing drawn), labels (second labels by row_id), report (raw report or null:
// not compared), choices, pendingSettlements, busy, open, now, lab. setSecondLabel goes through the page's real
// changeSecondLabel, so it drops the comparison exactly as the page does.
import { changeSecondLabel, settleKey } from "../../../../static/js/agreement.js";
import { datasetsAgreementCtx, datasetsCatalogCtx, datasetsHistoryCtx } from "../../../../static/js/lab/surfaces/workbench-datasets.js";
import { fakeEnv } from "../harness.mjs";

export const DATASETS_NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
export const CATALOG_SURFACE = "workbench.datasets.catalog";
export const HISTORY_SURFACE = "workbench.datasets.history";
export const AGREEMENT_SURFACE = "workbench.datasets.agreement";

const labHooks = (lab, id) => (lab ? { matches: (item, ctx) => lab.matches(id, item, ctx), arrange: (list, ctx) => lab.arrange(id, list, ctx) } : {});

// ---------- catalog ----------

// Raw dataset summaries exactly as GET /api/workbench/datasets returns them (fresh copies on every call).
export function sampleDatasetsRaw() {
  return [
    { id: "archived-refunds", name: "Archived refunds", notes: "archived: replaced by harbor-support-inbox", saved_at: "2026-06-01T10:00:00Z",
      rows: 9, labeled: 9, labels: { refund: 9 }, questions: 1, guidelines: 1,
      check: { gates: { refund: 0.8 }, model: "jev-1.1", targets: { accuracy: 0.9, coverage: 0.5 } }, check_notes: ["Pinned to jev-1.1."],
      test: { rows: 3, labeled: 3, share: 1 / 3, looks: 4, locked_at: "2026-06-02T09:00:00Z" } },
    { id: "bean-reviews", name: "Bean reviews", notes: "", saved_at: "2026-11-10T08:00:00Z",
      rows: 12, labeled: 12, labels: { quality: 12 }, questions: 1, guidelines: 0, check: null, check_notes: [], test: null },
    { id: "cafe-photos", name: "Cafe photos", notes: "", saved_at: null,
      rows: 6, labeled: 0, labels: {}, questions: 0, guidelines: 0, check: null, check_notes: [], test: null },
    { id: "empty-draft", name: null, saved_at: "2026-11-11T07:30:00Z",
      rows: 0, labeled: 0, labels: {}, questions: 0, guidelines: 0, check: null, check_notes: [], test: null },
    { id: "harbor-support-inbox", name: "Harbor support inbox", notes: "Email tickets from support@harbor.example", saved_at: "2026-10-30T16:20:00Z",
      rows: 40, labeled: 30, labels: { intent: 30, urgent: 18 }, questions: 2, guidelines: 2,
      check: { gates: { intent: 0.7 }, model: "jev-1.2", tuned_on: "jev-1.2-2026-10-01" }, check_notes: [],
      test: { rows: 8, labeled: 6, share: 0.2, looks: 1, locked_at: "2026-10-31T09:00:00Z" } },
    { id: "wholesale-leads", name: "Wholesale leads", notes: "Draft, needs a second labeler", saved_at: "2026-09-05T12:00:00Z",
      rows: 20, labeled: 5, labels: { route: 5, spam: 3, legacy_tag: 1 }, questions: 2, guidelines: 1, check: null, check_notes: [], test: null },
  ];
}

export function sampleDatasetsCatalogCtx(overrides = {}) {
  const state = {
    datasets: overrides.datasets || sampleDatasetsRaw(),
    filters: { ...("filters" in overrides ? overrides.filters : { exclude: "archived" }), pinnedIds: [...(overrides.pinnedIds || ["bean-reviews"])] },
    loadedId: "loadedId" in overrides ? overrides.loadedId : "harbor-support-inbox",
    unsaved: overrides.unsaved === true,
    saveBusy: overrides.saveBusy === true,
    copyBusy: overrides.copyBusy === true,
    agreementOpen: new Set(overrides.agreementOpen || ["harbor-support-inbox"]),
  };
  const log = [];
  const ctx = datasetsCatalogCtx({
    datasets: () => state.datasets,
    filters: () => state.filters,
    loadedId: () => state.loadedId,
    unsaved: () => state.unsaved,
    saveBusy: () => state.saveBusy,
    copyBusy: () => state.copyBusy,
    agreementOpen: (id) => state.agreementOpen.has(id),
    now: () => overrides.now ?? DATASETS_NOW,
    ...labHooks(overrides.lab, CATALOG_SURFACE),
    load: (id) => { log.push(["load", id]); state.loadedId = id; },
    loadCopy: (id) => { log.push(["loadCopy", id]); },
    downloadBundle: (id) => { log.push(["downloadBundle", id]); },
    setPins: (ids) => { log.push(["setPins", ids]); state.filters.pinnedIds = ids; },
    openAgreement: (id) => { log.push(["openAgreement", id]); state.agreementOpen.add(id); },
    resetFilters: () => { log.push(["resetFilters"]); state.filters = { pinnedIds: state.filters.pinnedIds }; },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = state;
  ctx.log = log;
  return ctx;
}

// ---------- history ----------

export function sampleRevisionsRaw() {
  return [
    { revision: "20261030T162000000000Z-a1b2c3d4e5f6", at: "2026-10-30T16:20:00.000000Z", current: true, name: "Harbor support inbox",
      saved_at: "2026-10-30T16:20:00Z", rows: 40, labeled: 30, test_rows: 8, questions: ["intent", "urgent"], checks: 1 },
    { revision: "20261028T101500000000Z-0f9e8d7c6b5a", at: "2026-10-28T10:15:00.000000Z", current: false, name: "Harbor support inbox",
      saved_at: "2026-10-27T18:00:00Z", rows: 38, labeled: 24, test_rows: 0, questions: ["intent", "urgent"], checks: 0 },
    { revision: "20261025T080000000000Z-badbadbadbad", at: "2026-10-25T08:00:00.000000Z", current: false, error: "Not a readable dataset file" },
    { revision: "20261020T090000000000Z-1234567890ab", at: "2026-10-20T09:00:00.000000Z", current: false, name: "Harbor support inbox",
      saved_at: "2026-10-19T17:00:00Z", rows: 38, labeled: 26, test_rows: 0, questions: ["intent", "urgent"], checks: 0 },
    { revision: "20261001T090000000000Z-cafe00c0ffee", at: "2026-10-01T09:00:00.000000Z", current: false, name: "Support",
      saved_at: "2026-10-01T08:59:00Z", rows: 25, labeled: 0, test_rows: 0, questions: [], checks: 0 },
  ];
}

// The server's restore preview of revision #2 against the current file (jev/dataset_changes.py shape).
export function sampleRestoreReport() {
  return { id: "harbor-support-inbox", exists: true, revision: "token-1",
    rows: { before: 40, after: 38, added: 0, removed: 2, order_changed: false },
    labels: { added: 0, removed: 6, changed: 1 }, questions_changed: false, rules_changed: false, metadata_changed: false,
    check: "none", check_dropped: null, check_changed: true,
    guidelines: { before: 2, after: 2, added: [], changed: ["intent"], removed: [], dropped: [] },
    test: { before: 8, after: 0, changed_membership: 8, history: "kept" } };
}

export function sampleDatasetsHistoryCtx(overrides = {}) {
  const revisions = overrides.revisions || sampleRevisionsRaw();
  const datasetId = overrides.datasetId || "harbor-support-inbox";
  const state = {
    open: true,
    busy: overrides.busy === true,
    list: overrides.loaded === false ? null : { id: datasetId, exists: overrides.exists !== false, keep: 20, revisions },
    preview: overrides.preview ? { entry: revisions[1], report: sampleRestoreReport() } : null,
    changedOnly: overrides.changedOnly === true,
  };
  const deleted = "deleted" in overrides ? overrides.deleted : [{ id: "old-promos", name: "Old promos", revisions: 2, latest: "2026-08-14T15:00:00.000000Z" }];
  const log = [];
  const ctx = datasetsHistoryCtx({
    datasetId,
    state: () => state,
    deleted: () => deleted,
    now: () => overrides.now ?? DATASETS_NOW,
    ...labHooks(overrides.lab, HISTORY_SURFACE),
    reload: () => { log.push(["reload"]); },
    preview: (entry) => { log.push(["preview", entry.revision]); state.preview = { entry, report: sampleRestoreReport() }; },
    cancelPreview: () => { log.push(["cancelPreview"]); state.preview = null; },
    restore: () => { log.push(["restore", state.preview.entry.revision]); },
    setChangedOnly: (on) => { log.push(["setChangedOnly", on]); state.changedOnly = on; },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = state;
  ctx.log = log;
  return ctx;
}

// ---------- agreement ----------

export function sampleAgreementSample() {
  return {
    questions: {
      intent: { type: "choice", instructions: "What does the customer want?",
        criteria: { refund: "Money back", replacement: "A new item sent", question: "Information only" } },
      urgent: { type: "noul", instructions: "Does this need a reply today?", criteria: { true: "Reply today", false: "Can wait" } },
      tone: { type: "score", instructions: "How does the customer feel?", criteria: ["Upset", "Neutral", "Pleased"] },
    },
    items: [
      { row_id: "a1f0", number: 3, row: { text: "My order HC-1042 arrived stale, refund please", channel: "email" }, questions: ["intent", "urgent"] },
      { row_id: "b2e1", number: 7, row: { text: "Do you ship to Canada?", channel: "chat" }, questions: ["intent"] },
      { row_id: "c3d2", number: 12, row: { text: "Grinder broke after two days", channel: "email", _image: "broken-grinder.png" }, questions: ["intent", "urgent", "tone"] },
      { row_id: "d4c3", number: 18, row: { text: "Love the new Ethiopian roast!", channel: "social" }, questions: ["tone"] },
      { row_id: "e5b4", number: 25, row: "Cancel my subscription", questions: ["intent", "urgent"] },
    ],
    eligible: 30, csv: "row_id,text,channel,label:intent,label:urgent,label:tone\n", session_context: "ctx-7", seed: 7, sample_size: 5,
  };
}

export function sampleAgreementLabels() {
  return { a1f0: { intent: "refund", urgent: true }, b2e1: { intent: "question" }, c3d2: { intent: "replacement", urgent: null } };
}

export function sampleAgreementReport() {
  return {
    questions: {
      intent: { rows: 3, agree: 2, agreement: 2 / 3, low: 0.2077, high: 0.9385, kappa: 0.5, mixups: [{ first: "refund", second: "replacement", rows: 1 }] },
      urgent: { rows: 1, agree: 0, agreement: 0, low: 0, high: 0.7935, kappa: null, mixups: [{ first: false, second: true, rows: 1 }] },
    },
    overall: { labels: 4, agree: 2, agreement: 0.5, rows: 3, rows_agree: 1, rows_agreement: 1 / 3, rows_low: 0.0615, rows_high: 0.7923 },
    disagreements: [
      { row_id: "a1f0", number: 3, row: { text: "My order HC-1042 arrived stale, refund please", channel: "email" }, question: "urgent", first: false, second: true },
      { row_id: "c3d2", number: 12, row: { text: "Grinder broke after two days", channel: "email", _image: "broken-grinder.png" }, question: "intent", first: "refund", second: "replacement" },
    ],
    disagreements_total: 2,
    counts: { rows: 3, matched: 3, not_found: 0, repeated: 0, unlabeled: 0, compared: 3, all_agree: 1, only_second: 0 },
    problems: [], problems_total: 0,
    second_items: [],
  };
}

export function sampleDatasetsAgreementCtx(overrides = {}) {
  const run = {
    open: overrides.open !== false,
    rows: "5",
    busy: overrides.busy === true,
    sample: "sample" in overrides ? overrides.sample : sampleAgreementSample(),
    labels: overrides.labels || sampleAgreementLabels(),
    report: "report" in overrides ? overrides.report : sampleAgreementReport(),
    choices: overrides.choices || { [settleKey("c3d2", "intent")]: "replacement" },
    pendingSettlements: overrides.pendingSettlements || [],
    sessionPreview: null,
    problem: null,
  };
  const log = [];
  const ctx = datasetsAgreementCtx({
    datasetId: "harbor-support-inbox",
    datasetName: "Harbor support inbox",
    run: () => run,
    now: () => overrides.now ?? DATASETS_NOW,
    ...labHooks(overrides.lab, AGREEMENT_SURFACE),
    setLabel: (rowId, question, value) => { log.push(["setLabel", rowId, question, value]); changeSecondLabel(run, rowId, question, value); },
    compare: () => { log.push(["compare"]); },
    settle: (rowId, question, value) => { log.push(["settle", rowId, question, value]); run.choices[settleKey(rowId, question)] = value; run.sessionPreview = null; },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = run;
  ctx.log = log;
  return ctx;
}
