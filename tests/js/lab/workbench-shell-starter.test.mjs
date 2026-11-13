// Tests of the Workbench page tools starter pack, on sampleShellCtx (tests/js/lab/fixtures/workbench-shell.mjs): tab
// "bulk", previous tab "build", guide closed, 4 questions (all gateable), 12 rows, a current run, no health report,
// no saved check, 3 saved tests, 2 datasets of which 1 has a check, and unsaved Bulk rows.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/workbench-shell-starter.js";
import { checkPack } from "./harness.mjs";
import { sampleShellCtx } from "./fixtures/workbench-shell.mjs";

const opened = (tab) => (ctx) => assert.deepEqual(ctx.calls, [["openTab", tab]]);
const openCase = (tab, from = "bulk") => ({ ctx: () => sampleShellCtx({ tab: from }), check: opened(tab), hidden: () => sampleShellCtx({ tab }) });
const stepped = (tab, target) => (ctx) => assert.deepEqual(ctx.calls, [["goToStep", tab, target]]);
const notReady = () => sampleShellCtx({ ready: false });

checkPack(pack, {
  open_build: openCase("build"),
  open_tests: openCase("tests"),
  open_bulk: openCase("bulk", "examples"),
  open_compare: openCase("compare"),
  open_examples: openCase("examples"),
  open_toolbox: openCase("toolbox"),
  next_tab: {
    ctx: () => sampleShellCtx({ tab: "toolbox" }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["openTab", "build"]], "the last tab wraps to the first");
      const middle = sampleShellCtx();
      pack.features.find((feature) => feature.id === "next_tab").run(middle);
      assert.deepEqual(middle.calls, [["openTab", "compare"]]);
    },
  },
  tab_to_left: {
    ctx: () => sampleShellCtx({ tab: "build" }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["openTab", "toolbox"]], "the first tab wraps to the last");
      const middle = sampleShellCtx();
      pack.features.find((feature) => feature.id === "tab_to_left").run(middle);
      assert.deepEqual(middle.calls, [["openTab", "tests"]]);
    },
  },
  back_tab: { ctx: () => sampleShellCtx(), check: opened("build"), hidden: () => sampleShellCtx({ previousTab: null }) },
  focus_tabs: { ctx: () => sampleShellCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["focusTabs"]]) },
  toggle_guide: {
    ctx: () => sampleShellCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["setGuideOpen", true]]);
      const open = sampleShellCtx({ guideOpen: true });
      pack.features.find((feature) => feature.id === "toggle_guide").run(open);
      assert.deepEqual(open.calls, [["setGuideOpen", false]]);
    },
  },
  next_step: {
    ctx: () => sampleShellCtx(),
    check: (ctx) => {
      // Questions, rows and a current run are done; the health report is not, so "labels" is next.
      assert.deepEqual(ctx.calls, [["goToStep", "bulk", "#dataset-health"]]);
      assert.deepEqual(ctx.env.toasts, [{ message: "Inspect and label the data: Inspect before spending.", kind: "" }]);
      const fresh = notReady();
      pack.features.find((feature) => feature.id === "next_step").run(fresh);
      assert.deepEqual(fresh.calls, [["goToStep", "build", "#view"]], "before the page loads, the first step is next");
    },
  },
  step_questions: { ctx: () => sampleShellCtx(), check: stepped("build", "#view") },
  step_rows: { ctx: () => sampleShellCtx(), check: stepped("bulk", "#bulk-rows") },
  step_labels: { ctx: () => sampleShellCtx(), check: stepped("bulk", "#dataset-health"), hidden: notReady },
  step_run: { ctx: () => sampleShellCtx(), check: stepped("bulk", "#bulk-run"), hidden: () => sampleShellCtx({ workspace: { rowCount: 0 } }) },
  step_policy: { ctx: () => sampleShellCtx(), check: stepped("bulk", "#policy"), hidden: () => sampleShellCtx({ workspace: { currentRun: false } }) },
  step_review: { ctx: () => sampleShellCtx(), check: stepped("bulk", "#datasets") },
  show_unsaved: {
    ctx: () => sampleShellCtx({ unsaved: { build: true, review: true } }),
    check: (ctx) => {
      assert.deepEqual(ctx.env.toasts, [{ message: "Unsaved: Build request, Bulk rows or labels, Review queue labels.", kind: "" }]);
      const clean = sampleShellCtx({ unsaved: { bulk: false } });
      pack.features.find((feature) => feature.id === "show_unsaved").run(clean);
      assert.deepEqual(clean.env.toasts, [{ message: "Nothing on this page is unsaved.", kind: "" }]);
    },
  },

  questions_selected: [{ ctx: sampleShellCtx(), expect: 4 }, { ctx: sampleShellCtx({ workspace: { questionCount: 0 } }), expect: 0, empty: notReady() }],
  rows_in_editor: [{ ctx: sampleShellCtx(), expect: 12, empty: notReady() }],
  gateable_questions: [{ ctx: sampleShellCtx({ workspace: { gateableCount: 3 } }), expect: 3, empty: notReady() }],
  steps_available: [
    { ctx: sampleShellCtx(), expect: 6 },
    { ctx: sampleShellCtx({ workspace: { questionCount: 0, rowCount: 0, currentRun: false, gateableCount: 0 } }), expect: 3, empty: notReady() },
  ],
  unsaved_areas: [
    { ctx: sampleShellCtx(), expect: 1 },
    { ctx: sampleShellCtx({ unsaved: { build: true, review: true } }), expect: 3, empty: notReady() },
  ],
  check_share: [
    { ctx: sampleShellCtx(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "1 of 2"); } },
    { ctx: sampleShellCtx({ counts: { savedTests: 0, examples: 13, datasets: 0, checks: 0 } }), expect: null, empty: notReady() },
  ],

  guide_checklist: {
    ctx: sampleShellCtx(),
    text: "# Workbench checklist\n\n- [x] Define typed questions — Questions selected\n- [x] Add representative inputs — Rows in editor\n"
      + "- [ ] Inspect and label the data — Inspect before spending\n- [x] Run the selected questions — Current run available\n"
      + "- [ ] Tune a policy and save a check — Policy available\n- [ ] Export a gate and review traffic — Save a check for the review cycle\n",
    filename: "workbench-checklist.md",
    check: () => {
      // Before the page loads: workflowSteps({}) — nothing is done and labels, run and policy are not available.
      const feature = pack.features.find((entry) => entry.id === "guide_checklist");
      assert.equal(feature.build(notReady()), "# Workbench checklist\n\n- [ ] Define typed questions — Start here\n- [ ] Add representative inputs — Add inputs\n"
        + "- [ ] Inspect and label the data — Inspect before spending (not available yet)\n- [ ] Run the selected questions — Live call required (not available yet)\n"
        + "- [ ] Tune a policy and save a check — Needs a current run with a gateable question (not available yet)\n"
        + "- [ ] Export a gate and review traffic — Save a check for the review cycle\n");
    },
  },
  workspace_summary: {
    ctx: sampleShellCtx(),
    filename: "workbench-workspace.json",
    check: (out) => {
      assert.deepEqual(JSON.parse(out.text), {
        tab: "bulk", counts: { savedTests: 3, examples: 13, datasets: 2, checks: 1 },
        workspace: { questionCount: 4, rowCount: 12, gateableCount: 4, currentRun: true, healthCurrent: false, hasSavedCheck: false },
        unsaved: { build: false, bulk: true, labeling: false, review: false, drift: false, datasetEdits: false, agreement: false, any: true },
      });
      // Before the page loads, counts and workspace are null rather than made-up zeros.
      const feature = pack.features.find((entry) => entry.id === "workspace_summary");
      assert.deepEqual(JSON.parse(feature.build(sampleShellCtx({ ready: false, tab: "toolbox", unsaved: { bulk: false } }))), {
        tab: "toolbox", counts: null, workspace: null,
        unsaved: { build: false, bulk: false, labeling: false, review: false, drift: false, datasetEdits: false, agreement: false, any: false },
      });
    },
  },
}, { ctx: () => sampleShellCtx() });
