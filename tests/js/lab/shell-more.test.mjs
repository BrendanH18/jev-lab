// Tests of the shell-more pack, on sampleShellCtx (tests/js/lab/fixtures/workbench-shell.mjs): tab "bulk" (3rd of 6),
// previous tab "build", guide closed, 4 questions (all gateable), 12 rows, a current run, no health report, no saved
// check, 3 saved tests, 13 examples, 2 datasets of which 1 has a check, and unsaved Bulk rows. Step titles and status
// wording are those of static/js/workbench-guide.js workflowSteps, copied by hand.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/shell-more.js";
import { checkPack } from "./harness.mjs";
import { sampleShellCtx } from "./fixtures/workbench-shell.mjs";

const notReady = () => sampleShellCtx({ ready: false });
const feature = (id) => pack.features.find((entry) => entry.id === id);
const area = (t, tree) => t.findAll(tree, (node) => node.attrs?.["data-area"]).map((node) => node.attrs["data-area"]);

checkPack(pack, {
  copy_tab_links: {
    ctx: () => sampleShellCtx(),
    check: (ctx) => assert.deepEqual(ctx.env.copied, ["- [Build](/workbench#build)\n- [Tests](/workbench#tests)\n- [Bulk](/workbench#bulk)\n"
      + "- [Compare](/workbench#compare)\n- [Examples](/workbench#examples)\n- [Toolbox](/workbench#toolbox)\n"]),
  },
  where_tab: {
    ctx: () => sampleShellCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.env.toasts, [{ message: "Bulk tab: 3 of 6. 3 saved tests.", kind: "" }]);
      const first = sampleShellCtx({ tab: "build", ready: false });
      feature("where_tab").run(first);
      assert.deepEqual(first.env.toasts, [{ message: "Build tab: 1 of 6.", kind: "" }], "no counts before the page has loaded");
      assert.deepEqual([...ctx.calls, ...first.calls], [], "it only reports");
    },
  },
  step_statuses: {
    ctx: () => sampleShellCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.env.toasts.map((toast) => toast.message), ["1. Define typed questions: Questions selected; 2. Add representative inputs: Rows in editor; "
        + "3. Inspect and label the data: Inspect before spending; 4. Run the selected questions: Current run available; "
        + "5. Tune a policy and save a check: Policy available; 6. Export a gate and review traffic: Save a check for the review cycle."]);
      const fresh = notReady();
      feature("step_statuses").run(fresh);
      assert.equal(fresh.env.toasts[0].message, "1. Define typed questions: Start here; 2. Add representative inputs: Add inputs; "
        + "3. Inspect and label the data: Inspect before spending (not available yet); 4. Run the selected questions: Live call required (not available yet); "
        + "5. Tune a policy and save a check: Needs a current run with a gateable question (not available yet); 6. Export a gate and review traffic: Save a check for the review cycle.");
    },
  },
  go_prerequisite: {
    ctx: () => sampleShellCtx({ workspace: { rowCount: 0 } }),
    check: (ctx) => {
      // No rows: "labels" (step 3) is the first unavailable step and needs rows.
      assert.deepEqual(ctx.calls, [["goToStep", "bulk", "#bulk-rows"]]);
      assert.deepEqual(ctx.env.toasts, [{ message: "Inspect and label the data needs rows in the Bulk editor. Going to Add representative inputs.", kind: "" }]);
      const stale = sampleShellCtx({ workspace: { currentRun: false } });
      feature("go_prerequisite").run(stale);
      assert.deepEqual(stale.calls, [["goToStep", "bulk", "#bulk-run"]], "Policy needs a current run: it goes to the Run area and runs nothing");
      assert.equal(stale.env.toasts[0].message, "Tune a policy and save a check needs a current Bulk run. Going to Run the selected questions.");
      const boxes = sampleShellCtx({ workspace: { gateableCount: 0 } });
      feature("go_prerequisite").run(boxes);
      assert.deepEqual(boxes.calls, [["goToStep", "build", "#view"]]);
      const noQuestions = sampleShellCtx({ workspace: { questionCount: 0, gateableCount: 0 } });
      feature("go_prerequisite").run(noQuestions);
      assert.equal(noQuestions.env.toasts[0].message, "Inspect and label the data needs selected questions. Going to Define typed questions.");
      assert.equal(feature("go_prerequisite").when(notReady()), false, "nothing to suggest before the page loads");
    },
    hidden: () => sampleShellCtx(),
  },
  go_unsaved: {
    ctx: () => sampleShellCtx({ tab: "examples", unsaved: { build: true } }),
    check: (ctx) => {
      // From Examples (5th), the next tab with unsaved work wraps around to Build (1st) before Bulk (3rd).
      assert.deepEqual(ctx.calls, [["openTab", "build"]]);
      assert.deepEqual(ctx.env.toasts, [{ message: "Unsaved on Build: Build request.", kind: "" }]);
      const onBuild = sampleShellCtx({ tab: "build", unsaved: { build: true, review: true } });
      feature("go_unsaved").run(onBuild);
      assert.deepEqual(onBuild.calls, [["openTab", "bulk"]]);
      assert.equal(onBuild.env.toasts[0].message, "Unsaved on Bulk: Bulk rows or labels, Review queue labels.");
    },
    hidden: () => sampleShellCtx(),
  },

  gallery_examples: [
    { ctx: sampleShellCtx(), expect: 13 },
    { ctx: sampleShellCtx({ counts: { savedTests: 3, examples: 0, datasets: 2, checks: 1 } }), expect: 0, empty: notReady() },
  ],
  saved_datasets: [
    { ctx: sampleShellCtx(), expect: 2 },
    { ctx: sampleShellCtx({ counts: { savedTests: 0, examples: 13, datasets: 5, checks: 0 } }), expect: 5, empty: notReady() },
  ],

  checklist_csv: {
    ctx: sampleShellCtx(),
    text: '"step","title","status","available","done"\r\n"1","Define typed questions","Questions selected","yes","yes"\r\n'
      + '"2","Add representative inputs","Rows in editor","yes","yes"\r\n"3","Inspect and label the data","Inspect before spending","yes","no"\r\n'
      + '"4","Run the selected questions","Current run available","yes","yes"\r\n"5","Tune a policy and save a check","Policy available","yes","no"\r\n'
      + '"6","Export a gate and review traffic","Save a check for the review cycle","yes","no"\r\n',
    filename: "workbench-checklist.csv",
  },
  counts_csv: {
    ctx: sampleShellCtx(),
    text: '"saved_tests","examples","datasets","checks","questions_selected","gateable_questions","rows","current_run","health_report_current","saved_check"\r\n'
      + '"3","13","2","1","4","4","12","yes","no","no"\r\n',
    filename: "workbench-counts.csv",
    check: () => assert.equal(feature("counts_csv").build(notReady()).split("\r\n")[1], '"","","","","","","","","",""'),
  },
  unsaved_markdown: {
    ctx: sampleShellCtx({ unsaved: { build: true } }),
    text: "# Unsaved work on the Workbench\n\n- Build request · Build tab · unsaved\n- Bulk rows or labels · Bulk tab · unsaved\n"
      + "- pre-run label drafts · Bulk tab · nothing unsaved\n- Review queue labels · Bulk tab · nothing unsaved\n- new-traffic labels · Bulk tab · nothing unsaved\n"
      + "- dataset repairs · Bulk tab · nothing unsaved\n- second-labeling session · Bulk tab · nothing unsaved\n\n2 areas with unsaved work.\n",
    filename: "workbench-unsaved.md",
    check: () => assert.match(feature("unsaved_markdown").build(sampleShellCtx({ unsaved: { bulk: false } })), /\n\nNothing on this page is unsaved\.\n$/),
  },
  handoff_markdown: {
    ctx: sampleShellCtx(),
    text: "# Workbench session handoff\n\nOpen tab: Bulk\n\n## Counts\n\n- Saved tests: 3\n- Gallery examples: 13\n- Saved datasets: 2 (1 with a check)\n"
      + "- Questions selected for Bulk: 4\n- Rows in the Bulk editor: 12\n\n## Guide steps\n\n1. Define typed questions — Questions selected\n"
      + "2. Add representative inputs — Rows in editor\n3. Inspect and label the data — Inspect before spending\n4. Run the selected questions — Current run available\n"
      + "5. Tune a policy and save a check — Policy available\n6. Export a gate and review traffic — Save a check for the review cycle\n\n"
      + "## Unsaved work\n\n- Bulk rows or labels (Bulk tab)\n\nCounts and the guide's wording only. Status describes the workspace, not accuracy or a passing check.\n",
    filename: "workbench-handoff.md",
    check: () => assert.match(feature("handoff_markdown").build(notReady()), /## Counts\n\nThe page has not loaded its counts yet\.\n/),
  },

  overview: { improvements: {
    readiness: (t) => {
      const tree = t.render(sampleShellCtx());
      const meter = t.find(tree, (node) => node.tag === "progress");
      assert.equal(meter.attrs.value, "3");
      assert.equal(meter.attrs.max, "6");
      assert.match(t.textOf(tree), /Guide steps done: 3 of 6/);
      assert.equal(t.textOf(t.find(tree, (node) => node.attrs?.["data-part"] === "todo")),
        "Still to do: Inspect and label the data, Tune a policy and save a check, Export a gate and review traffic.");
      assert.match(t.textOf(t.render(notReady())), /The workspace has not loaded yet\./);
      // A health report and a saved check make 5 of 6; "review" happens outside the page and never counts as done.
      const most = t.render(sampleShellCtx({ workspace: { healthCurrent: true, hasSavedCheck: true } }));
      assert.equal(t.find(most, (node) => node.tag === "progress").attrs.value, "5");
      assert.equal(t.textOf(t.find(most, (node) => node.attrs?.["data-part"] === "todo")), "Still to do: Export a gate and review traffic.");
      // No questions: only "rows" and "run" (the fixture's current-run flag) show in the workspace.
      assert.equal(t.find(t.render(sampleShellCtx({ workspace: { questionCount: 0, gateableCount: 0 } })), (node) => node.tag === "progress").attrs.value, "2");
    },
    unsaved_list: (t) => {
      const ctx = sampleShellCtx({ unsaved: { build: true, review: true } });
      const tree = t.render(ctx);
      assert.deepEqual(area(t, tree), ["Build request", "Bulk rows or labels", "Review queue labels"], "in tab-bar order, each area once");
      assert.match(t.textOf(t.find(tree, (node) => node.attrs?.["data-area"] === "Review queue labels")), /^Review queue labels · Bulk tab \(open now\)$/);
      assert.match(t.textOf(t.find(tree, (node) => node.attrs?.["data-area"] === "Build request")), /^Build request · Build tab Go$/);
      assert.match(t.textOf(t.render(sampleShellCtx({ unsaved: { bulk: false } }))), /Nothing on this page is unsaved\./);
      // The Go button: only for a tab that is not open, and it only opens that tab.
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-go"]).map((node) => node.attrs["data-go"]), ["build"], "no button for the open tab");
      t.fire(t.find(tree, (node) => node.attrs?.["data-go"] === "build"), "click");
      assert.deepEqual(ctx.calls, [["openTab", "build"]]);
      const broken = sampleShellCtx({ unsaved: { build: true } });
      broken.actions.openTab = () => { throw new Error("There is no Workbench tab \"build\"."); };
      t.fire(t.find(t.render(broken), (node) => node.attrs?.["data-go"] === "build"), "click");
      assert.deepEqual(t.env.toasts.at(-1), { message: "There is no Workbench tab \"build\".", kind: "error" });
    },
  } },
}, { ctx: () => sampleShellCtx() });
