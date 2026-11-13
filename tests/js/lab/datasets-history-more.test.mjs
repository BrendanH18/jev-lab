import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/datasets-history-more.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleDatasetsHistoryCtx, sampleRevisionsRaw } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsHistoryCtx(overrides);
const C = ctx();
const [R1, R2, R3, R4, R5] = C.items();
const P = ctx({ preview: true });  // the restore preview of #2 is open
const feature = (id) => pack.features.find((entry) => entry.id === id);

// Five hand-written revisions, newest first, whose question IDs, checks and splits change between neighbours.
const rev = (n, at, fields) => ({ revision: `2026102${n}T000000000000Z-00000000000${n}`, at, current: false, name: "Harbor support inbox",
  saved_at: null, rows: 38, labeled: 24, test_rows: 0, questions: ["intent"], checks: 0, ...fields });
const varied = () => [
  rev(1, "2026-10-28T10:15:00.000000Z", { current: true, rows: 30, labeled: 20, questions: ["intent"], checks: 0, test_rows: 0 }),
  rev(2, "2026-10-28T09:45:00.000000Z", { questions: ["urgent", "intent"], checks: 1, test_rows: 5 }),
  rev(3, "2026-10-27T09:00:00.000000Z", { questions: ["intent", "urgent"], checks: 1, test_rows: 8 }),
  rev(4, "2026-10-26T09:00:00.000000Z", { questions: ["intent", "tone"] }),
  rev(5, "2026-10-25T09:00:00.000000Z", { questions: ["intent", "tone"], name: "Support" }),
];
const V = ctx({ revisions: varied() });
const [V1, V2, V3, V4, V5] = V.items();
const VP = ctx({ revisions: varied(), preview: true });  // previews V2 against the current V1
// A revision whose saved_at (11:00) is later than the time it was kept (10:15).
const [SKEW] = ctx({ revisions: [{ ...sampleRevisionsRaw()[1], saved_at: "2026-10-28T11:00:00Z" }] }).items();
// A saved_at within the same second as the kept time (kept 10:15:00.000000, saved 10:15:00) is no skew.
const [SAME_SECOND] = ctx({ revisions: [{ ...sampleRevisionsRaw()[1], saved_at: "2026-10-28T10:15:00Z" }] }).items();
// The open preview of a deleted dataset: the page's report says exists: false.
const deletedPreview = () => {
  const c = ctx({ preview: true, exists: false });
  c.state.preview.report = { ...c.state.preview.report, exists: false, check: "preserved", check_changed: true,
    rows: { before: 0, after: 38, added: 38, removed: 0, order_changed: false }, test: { before: 0, after: 0, changed_membership: 0, history: "none" },
    labels: { added: 30, removed: 0, changed: 0 }, guidelines: { before: 0, after: 2, added: ["intent", "urgent"], changed: [], removed: [] } };
  return c;
};
// The preview with only the row order and nothing else changing.
const quietPreview = () => {
  const c = ctx({ preview: true });
  c.state.preview.report = { ...c.state.preview.report, rows: { before: 40, after: 40, added: 0, removed: 0, order_changed: true },
    labels: { added: 0, removed: 0, changed: 0 }, check: "preserved", check_changed: false,
    guidelines: { before: 2, after: 2, added: [], changed: [], removed: [] }, test: { before: 8, after: 8, changed_membership: 0, history: "kept" } };
  return c;
};

checkPack(pack, {
  // #1 8 - #2 0; #2 0 - #4 0 (the unreadable #3 is skipped); #4 0 - #5 0.
  held_out_change: { items: [R1, R2, R3, R4, R5], values: [8, 0, null, 0, null], ctx: C },
  // V3 [intent, urgent] against V4 [intent, tone] adds urgent and removes tone; V1 [intent] against V2 removes urgent.
  questions_added: { items: [V1, V2, V3, V4, V5], values: [0, 0, 1, 0, null], ctx: V },
  questions_removed: { items: [V1, V2, V3, V4, V5], values: [1, 0, 1, 0, null], ctx: V },
  // Oct 30 16:20 - Oct 28 10:15 = 54 h 5 min; Oct 28 10:15 - Oct 25 08:00 = 74 h 15 min; Oct 25 08:00 - Oct 20 09:00 = 119 h;
  // Oct 20 - Oct 1 at 09:00 = 19 days = 456 h; the oldest has nothing before it.
  hours_since_previous: { items: [R1, R2, R3, R4, R5], values: [54 + 5 / 60, 74.25, 119, 456, null], ctx: C, tolerance: 1e-12 },
  // saved_at to kept: same minute; Oct 27 18:00 -> Oct 28 10:15 = 16 h 15 min; unreadable; 17:00 -> 09:00 = 16 h; 08:59 -> 09:00.
  hours_save_to_kept: { items: [R1, R2, R3, R4, R5], values: [0, 16.25, null, 16, 1 / 60], tolerance: 1e-12 },
  // Current file (#1) has 30 labeled rows: 30 - 30, 24 - 30, unreadable, 26 - 30, 0 - 30.
  labeled_vs_current: { items: [R1, R2, R3, R4, R5], values: [0, -6, null, -4, -30], ctx: C },
  // #4 is "Harbor support inbox", the older #5 "Support".
  name_changed: { items: [R4, R1, R2, R3, R5], values: [true, false, false, false, false], ctx: C },
  check_change: { items: [V1, V2, V3, V4, V5], values: ["check removed", "no check change", "check added", "no check change", null], ctx: V },
  // Held-out rows 0, 5, 8, 0, 0 from newest to oldest.
  split_change: { items: [V1, V2, V3, V4, V5], values: ["split removed", "held-out rows changed", "split added", "no split change", null], ctx: V },
  question_change: { items: [V1, V2, V3, V4, V5], values: ["questions removed", "questions reordered", "questions replaced", "same questions", null], ctx: V },

  // V1 keeps 30 rows, V2 38.
  rows_removed: { hit: V1, miss: [V2, V3, V4, V5], ctx: V, message: /^8 rows fewer than the older revision/ },
  questions_dropped: { hit: [V1, V3], miss: [V2, V4, V5], ctx: V, message: /^Drops (urgent|tone), which the older revision asked/ },
  // V1 (10:15) and V2 (09:45) are 30 minutes apart; the sample revisions are days apart.
  save_burst: { hitList: V.items(), missList: C.items(), ctx: V, missCtx: C, message: /^1 revision kept within an hour of the next newer one: .*20-revision limit/ },
  saved_after_kept: { hit: SKEW, miss: [R1, R2, R3, R5, SAME_SECOND] },
  // The sample preview: labels 0 added, 6 removed, 1 changed; guidelines changed ["intent"]; test 8 -> 0, 8 rows change membership.
  // Quiet when the preview changes no label (quietPreview), not only when no preview is open.
  preview_label_loss: { hitList: P.items(), missList: C.items(), ctx: P, missCtx: quietPreview(),
    message: /^Restoring would remove 6 labels and change 1 label of the current file\. The current file is kept as a revision first, so the restore can be undone\.$/ },
  preview_guideline_change: { hitList: P.items(), missList: C.items(), ctx: P, missCtx: quietPreview(), message: /^Restoring would change 1 question guideline\.$/ },
  preview_split_change: { hitList: P.items(), missList: C.items(), ctx: P, missCtx: quietPreview(),
    message: /^Restoring would change held-out membership for 8 rows \(8 → 0 held out\)\. Recorded test looks: kept\.$/ },

  readable_share: { ctx: C, expect: (result) => { assert.equal(result.value, 0.8); assert.equal(result.detail, "4 of 5 revisions"); }, empty: ctx({ revisions: [] }) },
  // Nov 12 12:00 - Oct 30 16:20 = 12 days 19 h 40 min.
  days_since_newest: { ctx: C, expect: 12 + (19 * 60 + 40) / 1440, tolerance: 1e-12, empty: ctx({ revisions: [] }) },
  // Labeled rows newest to oldest (readable): 30, 24, 26, 0. Only #4 -> #2 drops (26 -> 24).
  largest_label_drop: [{ ctx: C, expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "into revision #2"); }, empty: ctx({ revisions: [] }) },
    { ctx: ctx({ revisions: sampleRevisionsRaw().slice(0, 2) }), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "labeled rows never dropped"); } },
    { ctx: ctx({ revisions: sampleRevisionsRaw().slice(0, 1) }), expect: null }],

  change_log: { ctx: C, filename: "harbor-support-inbox-revision-changes.md",
    text: "# Revision changes · harbor-support-inbox\n\n"
      + "- #1 (2026-10-30 16:20): rows +2, labeled +6, held out +8, check added · current\n"
      + "- #2 (2026-10-28 10:15): labeled -2\n"
      + "- #3 (2026-10-25 08:00): unreadable\n"
      + "- #4 (2026-10-20 09:00): rows +13, labeled +26, questions added intent, urgent, renamed from “Support”\n"
      + "- #5 (2026-10-01 09:00): oldest kept\n" },
  // With "Hide revisions identical to the current file" on, #1 is not shown.
  deltas_csv: { ctx: ctx({ changedOnly: true }), filename: "harbor-support-inbox-revision-deltas.csv",
    text: '"revision","position","kept_at","rows_change","labeled_change","held_out_change","questions_added","questions_removed","check_change"\r\n'
      + '"20261028T101500000000Z-0f9e8d7c6b5a",2,"2026-10-28T10:15:00.000000Z",0,-2,0,"","","none"\r\n'
      + '"20261025T080000000000Z-badbadbadbad",3,"2026-10-25T08:00:00.000000Z","","","","","",""\r\n'
      + '"20261020T090000000000Z-1234567890ab",4,"2026-10-20T09:00:00.000000Z",13,26,0,"intent urgent","","none"\r\n'
      + '"20261001T090000000000Z-cafe00c0ffee",5,"2026-10-01T09:00:00.000000Z","","","","","",""\r\n' },
  preview_summary: { ctx: P, filename: "harbor-support-inbox-restore-preview.md",
    text: "# Restore preview · harbor-support-inbox · revision 20261028T101500000000Z-0f9e8d7c6b5a\n\n"
      + "| | Current file | After restore |\n| --- | --- | --- |\n| Rows | 40 | 38 |\n| Held-out rows | 8 | 0 |\n| Guideline questions | 2 | 2 |\n\n"
      + "- Rows: 0 added, 2 removed, order unchanged\n- Labels: 0 added, 6 removed, 1 changed\n"
      + "- Questions changed: no · rules changed: no · metadata changed: no\n"
      + "- Saved check: removed (the revision has none)\n"
      + "- Held-out membership changes: 8; recorded test looks: kept\n"
      + "- Guidelines: 0 added, 1 changed, 0 removed\n"
      + "- The current file is kept as a revision first, so the restore can be undone.\n",
    check: () => {
      assert.throws(() => runExporter(feature("preview_summary"), C), /Open a restore preview first/);
      // A deleted dataset has no current file to keep: the summary must not promise an undo.
      const text = runExporter(feature("preview_summary"), deletedPreview()).text;
      assert.match(text, /\n- Saved check: restored from the revision\n/);
      assert.match(text, /\n- The dataset file is deleted: restoring recreates it\.\n$/);
      assert.doesNotMatch(text, /undone/);
    } },
  deleted_list: { ctx: C, filename: "deleted-datasets-history.md",
    text: "| Dataset | Name | Kept revisions | Newest kept (UTC) |\n| --- | --- | --- | --- |\n| old-promos | Old promos | 2 | 2026-08-14 15:00 |\n",
    check: () => {
      assert.throws(() => runExporter(feature("deleted_list"), ctx({ deleted: null })), /Load the deleted datasets list first/);
      // A pipe in a name is escaped so the table keeps four columns; a missing name shows a dash.
      const text = runExporter(feature("deleted_list"), ctx({ deleted: [{ id: "a-b", name: "Beans | grinders", revisions: 3, latest: null }, { id: "c", revisions: 1, latest: "2026-01-02T03:04:05.000000Z" }] })).text;
      assert.equal(text.split("\n").slice(2).join("\n"), "| a-b | Beans \\| grinders | 3 | — |\n| c | — | 1 | 2026-01-02 03:04 |\n");
    } },

  restore_preview: { improvements: {
    losses: (t) => {
      const text = (c) => t.textOf(t.find(t.render(c), (node) => node.attrs.class === "losses"));
      assert.equal(text(P), "Would remove or change: 2 rows removed; 6 labels removed; 1 label changed; held-out membership changes for 8 rows; "
        + "1 question guideline changed; saved check removed (the revision has none).");
      // Only the row order changes: nothing is lost.
      assert.equal(text(quietPreview()), "Nothing would be removed or changed.");
      assert.equal(text(deletedPreview()), "Would remove or change: saved check restored from the revision.");
      assert.match(t.textOf(t.render(C)), /^Preview restoring a revision/);
    },
    question_ids: (t) => {
      const text = (c) => t.textOf(t.find(t.render(c), (node) => node.attrs.class === "questions"));
      assert.equal(text(P), "Same question IDs in the same order.");  // #2 and the current #1 both ask intent, urgent
      assert.equal(text(VP), "Adds urgent; drops none.");  // V2 [urgent, intent] against the current V1 [intent]
      assert.match(text(ctx({ revisions: sampleRevisionsRaw().slice(1), preview: true })), /not among the kept revisions/);
      assert.match(text(deletedPreview()), /^The dataset file is deleted/);
    },
  } },
}, { ctx: () => ctx({ preview: true }) });

test("datasets-history-more: facts and checks give unavailable values on odd items, never an exception", () => {
  const odd = [{}, { revision: 7, readable: true, questions: "intent" }, { readable: true, at_ms: "soon", saved_ms: NaN }];
  for (const c of [C, ctx({ revisions: [] }), ctx({ loaded: false })]) {
    for (const f of pack.features) {
      for (const item of odd) {
        if (f.kind === "fact") {
          const value = f.value(item, c);
          if (f.type === "number") assert.equal(value, null, `${f.id}`);
          if (f.type === "flag") assert.equal(value, false, `${f.id}`);
          if (f.type === "category") assert.equal(value, null, `${f.id}`);
        } else if (f.kind === "diagnostic" && (f.scope || "item") === "item") assert.equal(f.check(item, c, 0) ?? null, null, `${f.id}`);
      }
      if (f.kind === "diagnostic" && f.scope === "list") f.check(odd, c);
    }
  }
});
