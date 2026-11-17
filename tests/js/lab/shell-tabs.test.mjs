// Tests of the shell-tabs pack, on sampleShellCtx (tests/js/lab/fixtures/workbench-shell.mjs): tab "bulk" (3rd of 6),
// previous tab "build", 4 questions (all gateable), 12 rows, a current run, no health report, no saved check, 3 saved
// tests, 13 examples, 2 datasets of which 1 has a check, and unsaved Bulk rows. So the guide steps done are questions,
// rows and run (3 of 6). Step titles and status wording are those of static/js/workbench-guide.js, copied by hand.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/shell-tabs.js";
import { checkPack } from "./harness.mjs";
import { sampleShellCtx } from "./fixtures/workbench-shell.mjs";

const notReady = () => sampleShellCtx({ ready: false });
const feature = (id) => pack.features.find((entry) => entry.id === id);
const parts = (t, tree, name) => t.findAll(tree, (node) => node.attrs?.[name]).map((node) => node.attrs[name]);

checkPack(
  pack,
  {
    first_tab: {
      ctx: () => sampleShellCtx(),
      hidden: () => sampleShellCtx({ tab: "build" }),
      check: (ctx) => {
        assert.deepEqual(ctx.calls, [["openTab", "build"]]);
        assert.throws(() => feature("first_tab").run(sampleShellCtx({ tab: "build" })), /Build tab is already open/);
      },
    },
    last_tab: {
      ctx: () => sampleShellCtx(),
      hidden: () => sampleShellCtx({ tab: "toolbox" }),
      check: (ctx) => {
        assert.deepEqual(ctx.calls, [["openTab", "toolbox"]]);
      },
    },
    read_tab_bar: {
      ctx: () => sampleShellCtx(),
      check: (ctx) => {
        assert.deepEqual(ctx.env.toasts, [
          {
            message: "Tabs: 1 Build, 2 Tests (3 saved), 3 Bulk (open, unsaved work), 4 Compare, 5 Examples, 6 Toolbox.",
            kind: "",
          },
        ]);
        const other = sampleShellCtx({ tab: "build", unsaved: { bulk: false, build: true } });
        feature("read_tab_bar").run(other);
        assert.equal(
          other.env.toasts[0].message,
          "Tabs: 1 Build (open, unsaved work), 2 Tests (3 saved), 3 Bulk, 4 Compare, 5 Examples, 6 Toolbox.",
        );
        assert.deepEqual(ctx.calls, []);
      },
    },
    show_counts: {
      ctx: () => sampleShellCtx(),
      hidden: notReady,
      check: (ctx) => {
        assert.equal(
          ctx.env.toasts[0].message,
          "3 saved tests, 13 gallery examples, 2 saved datasets (1 with a check).",
        );
        const one = sampleShellCtx({ counts: { savedTests: 1, examples: 1, datasets: 1, checks: 0 } });
        feature("show_counts").run(one);
        assert.equal(one.env.toasts[0].message, "1 saved test, 1 gallery example, 1 saved dataset (0 with a check).");
      },
    },
    show_guide_progress: {
      ctx: () => sampleShellCtx(),
      hidden: notReady,
      check: (ctx) => {
        assert.equal(
          ctx.env.toasts[0].message,
          "Guide: 3 of 6 steps done. First not done: Inspect and label the data.",
        );
        assert.deepEqual(ctx.calls, []);
      },
    },
    show_waiting_steps: {
      ctx: notReady,
      hidden: () => sampleShellCtx(),
      check: (ctx) => {
        assert.equal(
          ctx.env.toasts[0].message,
          "Not available yet: Inspect and label the data (Inspect before spending); Run the selected questions (Live call required); " +
            "Tune a policy and save a check (Needs a current run with a gateable question).",
        );
      },
    },
    start_from_example: {
      ctx: () => sampleShellCtx({ tab: "build", workspace: { questionCount: 0, gateableCount: 0 } }),
      hidden: () => sampleShellCtx(),
      check: (ctx) => {
        assert.deepEqual(ctx.calls, [["openTab", "examples"]]);
        assert.equal(
          feature("start_from_example").when(
            sampleShellCtx({ tab: "examples", workspace: { questionCount: 0, gateableCount: 0 } }),
          ),
          false,
        );
        assert.equal(feature("start_from_example").when(notReady()), false);
      },
    },

    saved_tests: { ctx: sampleShellCtx(), expect: 3, empty: notReady() },
    saved_checks: { ctx: sampleShellCtx(), expect: 1, empty: notReady() },
    datasets_without_check: [
      { ctx: sampleShellCtx(), expect: 1, empty: notReady() },
      { ctx: sampleShellCtx({ counts: { savedTests: 0, examples: 13, datasets: 5, checks: 2 } }), expect: 3 },
    ],
    ungateable_questions: [
      { ctx: sampleShellCtx({ workspace: { questionCount: 4, gateableCount: 3 } }), expect: 1, empty: notReady() },
      { ctx: sampleShellCtx(), expect: 0 },
    ],
    guide_steps_done: [
      {
        ctx: sampleShellCtx(),
        expect: (result) => {
          assert.equal(result.value, 3);
          assert.equal(result.detail, "of 6");
        },
        empty: notReady(),
      },
      { ctx: sampleShellCtx({ workspace: { healthCurrent: true, hasSavedCheck: true } }), expect: 5 },
    ],

    tab_bar_csv: {
      ctx: sampleShellCtx(),
      filename: "workbench-tabs.csv",
      text:
        '"position","id","label","open","saved_tests","unsaved"\r\n"1","build","Build","no","",""\r\n"2","tests","Tests","no","3",""\r\n' +
        '"3","bulk","Bulk","yes","","Bulk rows or labels"\r\n"4","compare","Compare","no","",""\r\n"5","examples","Examples","no","",""\r\n"6","toolbox","Toolbox","no","",""\r\n',
    },
    steps_json: {
      ctx: sampleShellCtx(),
      filename: "workbench-guide-steps.json",
      excludes: ["#bulk-rows", "target"],
      check: (out) => {
        const steps = JSON.parse(out.text);
        assert.equal(steps.length, 6);
        assert.deepEqual(steps[2], {
          id: "labels",
          position: 3,
          title: "Inspect and label the data",
          tab: "bulk",
          action: "Inspect data",
          status: "Inspect before spending",
          available: true,
          done: false,
        });
        assert.deepEqual(
          steps.map((step) => step.done),
          [true, true, false, true, false, false],
        );
      },
    },

    switcher: {
      improvements: {
        buttons: (t) => {
          const ctx = sampleShellCtx();
          const tree = t.render(ctx);
          assert.deepEqual(
            parts(t, tree, "data-go"),
            ["build", "tests", "compare", "examples", "toolbox"],
            "no button for the open tab",
          );
          assert.equal(t.textOf(t.find(tree, (node) => node.attrs?.["data-go"] === "tests")), "2. Tests (3)");
          assert.equal(t.textOf(t.find(tree, (node) => node.tag === "strong")), "3. Bulk · open");
          t.fire(
            t.find(tree, (node) => node.attrs?.["data-go"] === "compare"),
            "click",
          );
          assert.deepEqual(ctx.calls, [["openTab", "compare"]]);
        },
        unsaved_marks: (t) => {
          const tree = t.render(sampleShellCtx({ unsaved: { build: true, review: true } }));
          const marks = t
            .findAll(tree, (node) => node.attrs?.["data-part"] === "unsaved")
            .map((node) => t.textOf(node));
          assert.deepEqual(marks, [
            " · unsaved: Build request",
            " · unsaved: Bulk rows or labels, Review queue labels",
          ]);
          assert.equal(
            t.findAll(
              t.render(sampleShellCtx({ unsaved: { bulk: false } })),
              (node) => node.attrs?.["data-part"] === "unsaved",
            ).length,
            0,
          );
        },
        back: (t) => {
          const ctx = sampleShellCtx();
          const tree = t.render(ctx);
          assert.deepEqual(parts(t, tree, "data-back"), ["build"]);
          t.fire(
            t.find(tree, (node) => node.attrs?.["data-back"] === "build"),
            "click",
          );
          assert.deepEqual(ctx.calls, [["openTab", "build"]]);
          assert.equal(parts(t, t.render(sampleShellCtx({ previousTab: null })), "data-back").length, 0);
        },
      },
    },
    step_list: {
      improvements: {
        list: (t) => {
          const tree = t.render(sampleShellCtx());
          assert.deepEqual(parts(t, tree, "data-step"), ["questions", "rows", "labels", "run", "policy", "review"]);
          const done = t
            .findAll(
              tree,
              (node) => node.attrs?.["data-step"] && t.find(node, (child) => child.attrs?.["data-part"] === "done"),
            )
            .map((node) => node.attrs["data-step"]);
          assert.deepEqual(done, ["questions", "rows", "run"]);
          assert.match(
            t.textOf(t.find(tree, (node) => node.attrs?.["data-step"] === "labels")),
            /^Inspect and label the data — Inspect before spending/,
          );
        },
        go: (t) => {
          const ctx = notReady();
          const tree = t.render(ctx);
          assert.deepEqual(parts(t, tree, "data-go"), ["questions", "rows", "review"]);
          assert.equal(t.findAll(tree, (node) => node.attrs?.["data-part"] === "waiting").length, 3);
          t.fire(
            t.find(tree, (node) => node.attrs?.["data-go"] === "rows"),
            "click",
          );
          assert.deepEqual(ctx.calls, [["goToStep", "bulk", "#bulk-rows"]]);
          assert.equal(t.textOf(t.find(tree, (node) => node.attrs?.["data-go"] === "rows")), "Open rows");
        },
      },
    },
  },
  { ctx: () => sampleShellCtx() },
);
