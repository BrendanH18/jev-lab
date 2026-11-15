import assert from "node:assert/strict";

import { settleKey } from "../../../static/js/agreement.js";
import pack from "../../../static/js/lab/packs/workbench/agreement-report-stats.js";
import { checkPack } from "./harness.mjs";
import { sampleAgreementReport, sampleDatasetsAgreementCtx } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsAgreementCtx(overrides);
// Before Compare (and before a draw for the sample metric).
const notCompared = () => ctx({ report: null });
const nothing = () => ctx({ sample: null, report: null });
const report = (patch) => { const r = sampleAgreementReport(); patch(r); return r; };
// intent with 90% agreement on 10 rows but kappa 0.20.
const paradox = () => ctx({ report: report((r) => { r.questions.intent = { rows: 10, agree: 9, agreement: 0.9, low: 0.6, high: 0.98, kappa: 0.2, mixups: [] }; }) });
// Narrow intervals: 10 points for intent, 20 for urgent.
const narrow = () => ctx({ report: report((r) => { Object.assign(r.questions.intent, { low: 0.85, high: 0.95 }); Object.assign(r.questions.urgent, { low: 0.6, high: 0.8 }); }) });

// Panels. Fixture (tests/js/lab/fixtures/workbench-datasets.mjs): the current comparison shows two differences, row 3 (a1f0)
// urgent saved no / second yes, not settled, and row 12 (c3d2) intent saved refund / second replacement, settled as
// replacement. Settled choices that change a saved label: 1 row.
const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cells = (t, row) => row.children.filter((child) => child && child.tag === "td").map(t.textOf);
const rows = (t, tree) => t.findAll(tree, (node) => node.tag === "tr" && node.attrs["data-difference"] !== undefined).map((node) => node.attrs["data-difference"]);

checkPack(pack, {
  // intent: p_o 2/3, kappa 0.5 -> (2/3 - 0.5) / 0.5 = 1/3. urgent has no kappa. A kappa of 1 implies nothing.
  chance_agreement: [{ ctx: ctx(), empty: notCompared(), tolerance: 1e-12,
    expect: (result) => { assert.ok(Math.abs(result.value - 1 / 3) < 1e-12); assert.equal(result.detail, "intent 33.3%"); } },
  { ctx: ctx({ report: report((r) => { r.questions.intent.kappa = 1; }) }), expect: null }],
  // 0.7923 - 0.0615.
  row_interval_width: { ctx: ctx(), empty: notCompared(),
    expect: (result) => { assert.ok(Math.abs(result.value - 0.7308) < 1e-12); assert.equal(result.detail, "6.2% to 79.2% over 3 rows"); } },
  // ⌈(0.98 / 0.1)²⌉ = ⌈96.04⌉ = 97; 3 compared; the dataset has 30 labeled rows.
  rows_for_ten_points: { ctx: ctx(), empty: notCompared(),
    expect: (result) => { assert.equal(result.value, 94); assert.equal(result.detail, "3 of about 97 compared; the dataset has only 30 labeled rows"); } },
  undrawn_rows: { ctx: ctx(), empty: nothing(), expect: (result) => { assert.equal(result.value, 25); assert.equal(result.detail, "5 of 30 labeled rows drawn"); } },
  questions_compared: { ctx: ctx(), empty: notCompared(), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "of 3 sampled questions"); } },
  full_agreement_questions: [{ ctx: ctx(), empty: notCompared(), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "none"); } },
    { ctx: ctx({ report: report((r) => { Object.assign(r.questions.urgent, { agree: 1, agreement: 1 }); }) }),
      expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "urgent"); } }],
  // Row 3's urgent difference is open; row 12's intent difference is settled.
  unsettled_differences: { ctx: ctx(), empty: notCompared(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "of 2 shown differences"); } },
  rows_with_differences: { ctx: ctx(), empty: notCompared(), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "of 3 compared rows"); } },
  labels_compared_share: [{ ctx: ctx(), empty: notCompared(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "4 of 4 second labels"); } },
    { ctx: ctx({ report: report((r) => { r.overall.labels = 3; }) }), expect: 0.75 }],

  // Only intent has a kappa in the sample; with urgent at 0.10 the spread is 0.50 - 0.10.
  kappa_range: [{ ctx: ctx({ report: report((r) => { r.questions.urgent.kappa = 0.1; }) }), empty: notCompared(),
    expect: (result) => { assert.ok(Math.abs(result.value - 0.4) < 1e-12); assert.equal(result.detail, "urgent 0.10 to intent 0.50"); } },
  { ctx: ctx(), expect: null }],

  // (0.9 - 0.2) / (1 - 0.2) = 0.875.
  kappa_paradox: { ctx: paradox(), hitList: [], missList: [], missCtx: ctx(),
    message: /^intent: 90\.0% agreement but kappa 0\.20; chance alone gives about 87\.5%\. Sample rows where the less common labels are likely\.$/ },
  // intent 20.8%–93.8% (73 points), urgent 0.0%–79.3%.
  wide_question_interval: { ctx: ctx(), hitList: [], missList: [], missCtx: narrow(),
    message: /^(intent: agreement could be anywhere from 20\.8% to 93\.8% over 3 compared rows|urgent: agreement could be anywhere from 0\.0% to 79\.3% over 1 compared row); label more rows before trusting it\.$/ },
  // Row 3's urgent settled as its saved label (no): nothing to write for it; row 12 still changes, so 1 row is written.
  choices_keep_saved: { ctx: ctx({ choices: { [settleKey("c3d2", "intent")]: "replacement", [settleKey("a1f0", "urgent")]: false } }), hitList: [], missList: [], missCtx: ctx(),
    message: /^1 settlement choice keeps the saved label, so Save settled labels writes nothing for it; it writes 1 row\.$/ },
  labels_not_compared: { ctx: ctx({ report: report((r) => { r.overall.labels = 3; }) }), hitList: [], missList: [], missCtx: ctx(),
    message: /^1 second label was not compared \(rows no longer in the dataset, repeated rows, or questions without a saved label\)\.$/ },
  // Row 12 has 1 of 3 second labels and was compared.
  compared_partly_labeled: { ctx: ctx(), hitList: [], missList: [], missCtx: notCompared(),
    message: /^Row 12 was compared with questions still unlabeled; label them and compare again for a full comparison\.$/ },

  kappa_table_md: { ctx: ctx(), filename: "harbor-support-inbox-kappa.md",
    text: "Kappa by question · Harbor support inbox · two people's labels, not the model\n\n"
      + "| Question | Rows | Agree | Observed | Kappa | Chance |\n| --- | --- | --- | --- | --- | --- |\n"
      + "| intent | 3 | 2 | 66.7% | 0.50 | 33.3% |\n| urgent | 1 | 0 | 0.0% | — | — |\n",
    excludes: ["refund", "replacement", "true", "false"] },
  row_progress_csv: { ctx: ctx(), filename: "harbor-support-inbox-agreement-rows.csv",
    text: '"row","row_id","asked","given","missing","differences","settled"\r\n'
      + '"3","a1f0","2","2","0","1","0"\r\n"7","b2e1","1","1","0","0","0"\r\n"12","c3d2","3","1","2","1","1"\r\n'
      + '"18","d4c3","1","0","1","0","0"\r\n"25","e5b4","2","0","2","0","0"\r\n',
    check: (out) => assert.ok(!/HC-1042|Canada|refund/.test(out.text)) },
  desk: { improvements: {
    list: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(rows(t, tree), ["a1f0:urgent", "c3d2:intent"]);
      assert.deepEqual(cells(t, byAttr(t, tree, "data-difference", "a1f0:urgent")).slice(0, 5), ["3", "urgent", "no", "yes", "not settled"]);
      assert.deepEqual(cells(t, byAttr(t, tree, "data-difference", "c3d2:intent")).slice(0, 5), ["12", "intent", "refund", "replacement", "settled: second label"]);
      // Blind before Compare: no difference, no label.
      const before = t.textOf(t.render(ctx({ report: null })));
      assert.match(before, /^Compare first/);
      assert.ok(!/refund|replacement|yes/.test(before));
    },
    settle: (t) => {
      const page = ctx();
      const tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-settle", "c3d2:intent:second").attrs["aria-pressed"], "true");
      t.fire(byAttr(t, tree, "data-settle", "a1f0:urgent:second"), "click");
      assert.deepEqual(page.log.at(-1), ["settle", "a1f0", "urgent", true]);
      t.fire(byAttr(t, tree, "data-settle", "a1f0:urgent:saved"), "click");
      assert.deepEqual(page.log.at(-1), ["settle", "a1f0", "urgent", false]);
      t.fire(byAttr(t, tree, "data-settle", "c3d2:intent:none"), "click");
      assert.deepEqual(page.log.at(-1), ["settle", "c3d2", "intent", null]);
      assert.equal(cells(t, byAttr(t, t.render(page), "data-difference", "c3d2:intent"))[4], "settled: no label");
    },
    unsettled_only: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "unsettled-only"), "click");
      assert.deepEqual(rows(t, t.render(page)), ["a1f0:urgent"]);
      const all = ctx({ choices: { [settleKey("c3d2", "intent")]: "replacement", [settleKey("a1f0", "urgent")]: false } });
      t.state.unsettledOnly = true;
      assert.match(t.textOf(t.render(all)), /Every shown difference is settled\./);
    },
    summary: (t) => {
      assert.equal(t.textOf(byAttr(t, t.render(ctx()), "data-part", "summary")),
        "2 shown differences · 1 settled · 1 would change the saved label · Save settled labels writes 1 row");
      // Row 3 kept as saved: two settled, still one change.
      const kept = ctx({ choices: { [settleKey("c3d2", "intent")]: "replacement", [settleKey("a1f0", "urgent")]: false } });
      assert.equal(t.textOf(byAttr(t, t.render(kept), "data-part", "summary")),
        "2 shown differences · 2 settled · 1 would change the saved label · Save settled labels writes 1 row");
    },
  } },
});
