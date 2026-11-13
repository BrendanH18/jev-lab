// Tests for static/js/lab/packs/workbench/build-diff.js on the Build fixture (tests/js/lab/fixtures/workbench-build.mjs:
// seven cards intent, urgency, angry, mug_box, " refund_amount_ok ", a blank-id Choice and a hidden tone). The first
// render takes the baseline checkpoint; typing is simulated by changing a raw editor row in place (the card keeps its
// reference, as on the page), and Raw JSON's Apply by replacing the row objects (fresh cards). Expected changes are
// worked out by hand from those edits; instruction lengths were counted separately (45 and 54 characters).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/build-diff.js";
import { checkPack } from "./harness.mjs";
import { buildResult, buildRows, sampleBuildQuestionsCtx } from "./fixtures/workbench-build.mjs";

const ORIGINAL_IDS = ["intent", "urgency", "angry", "mug_box", " refund_amount_ok ", "", "tone"];
const INTENT = "What does the customer in `ticket.body` want?";
const INTENT_NEW = "Which outcome does the customer in `ticket.body` want?";
const BASE = "“When this panel opened”";

const by = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const act = (t, tree, name, extra = {}) => t.find(tree, (node) => node.attrs?.["data-act"] === name && Object.entries(extra).every(([key, value]) => node.attrs[key] === value));
const changes = (t, tree) => t.findAll(by(t, tree, "data-role", "changes"), (node) => node.tag === "li").map((node) => [node.attrs["data-change"], t.textOf(node.children[0])]);
const kinds = (t, tree) => changes(t, tree).map(([kind]) => kind);
const summary = (t, tree) => t.textOf(by(t, tree, "data-role", "summary"));
const cps = (t, tree) => t.findAll(by(t, tree, "data-role", "checkpoints"), (node) => node.tag === "li").map((node) => node.attrs["data-cp"]);
const facts = (t, tree, seq) => t.textOf(t.find(by(t, tree, "data-cp", seq), (node) => node.attrs?.["data-role"] === "cp-facts")).trim();
const nameOf = (t, tree, seq) => by(t, tree, "data-rename", seq).attrs.value;
const choose = (t, node, value) => t.fire(node, "change", { target: { value } });
const commits = (page) => page.log.filter(([name]) => name === "commit");
const lastToast = (t) => t.env.toasts.at(-1);
const ids = (page) => page.page.rows.map((row) => row.id);
const rows = (page) => page.page.rows;
const blankRow = (id, type) => ({ id, type, instructions: "", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" });
// A page whose baseline is taken now: the panel's first render, with its page memory cleared (one test may open several pages).
const opened = (t, overrides = {}) => {
  for (const key of Object.keys(t.state)) delete t.state[key];
  const page = sampleBuildQuestionsCtx(overrides);
  t.render(page);
  return page;
};
const save = (t, page, name = "") => {
  t.fire(by(t, t.render(page), "data-role", "cp-name"), "input", { target: { value: name } });
  t.fire(act(t, t.render(page), "save"), "click");
  return t.render(page);
};

checkPack(pack, {
  diff: { improvements: {
    baseline: (t) => {
      const page = opened(t);
      let tree = t.render(page);
      assert.deepEqual(cps(t, tree), ["1"]);
      assert.equal(nameOf(t, tree, "1"), "When this panel opened");
      assert.equal(facts(t, tree, "1"), "7 questions · same as now");
      rows(page)[0].instructions = INTENT_NEW;
      tree = t.render(page);
      assert.equal(facts(t, tree, "1"), "7 questions · 1 change from now", "later renders keep the first copy");
      assert.equal(summary(t, tree), "1 change: 1 reworded.");
    },
    save: (t) => {
      const page = opened(t);
      let tree = save(t, page, " Before cleanup ");
      assert.deepEqual(cps(t, tree), ["2", "1"]);
      assert.equal(nameOf(t, tree, "2"), "Before cleanup");
      assert.equal(lastToast(t).message, "Saved “Before cleanup” (7 questions) in this page's memory.");
      tree = save(t, page, "Before cleanup");
      assert.equal(lastToast(t).kind, "error");
      assert.deepEqual(cps(t, tree), ["2", "1"], "a repeated name saves nothing");
      tree = save(t, page, "");
      assert.equal(nameOf(t, tree, "3"), "Checkpoint 3");
      assert.equal(by(t, tree, "data-role", "base").attrs.value, "3", "the newest checkpoint becomes the comparison base");
      assert.equal(commits(page).length, 0, "saving changes nothing in the editor");
    },
    list: (t) => {
      const page = opened(t);
      save(t, page, "A");
      rows(page)[1].id = "urgency_level";
      let tree = t.render(page);
      assert.deepEqual(cps(t, tree), ["2", "1"], "newest first");
      assert.equal(facts(t, tree, "2"), "7 questions · 1 change from now");
      rows(page).push(blankRow("late", "noul"));
      tree = t.render(page);
      assert.equal(facts(t, tree, "1"), "7 questions · 2 changes from now");
    },
    rename: (t) => {
      const page = opened(t);
      save(t, page, "A");
      choose(t, by(t, t.render(page), "data-rename", "1"), " Start ");
      let tree = t.render(page);
      assert.equal(nameOf(t, tree, "1"), "Start");
      choose(t, by(t, tree, "data-rename", "1"), "A");
      assert.match(lastToast(t).message, /already named “A”/);
      choose(t, by(t, t.render(page), "data-rename", "1"), "  ");
      assert.equal(lastToast(t).message, "A checkpoint needs a name.");
      tree = t.render(page);
      assert.equal(nameOf(t, tree, "1"), "Start");
      assert.match(t.textOf(by(t, tree, "data-role", "heading")), /^From “A”/);
    },
    delete: (t) => {
      const page = opened(t);
      save(t, page, "A");
      t.fire(act(t, t.render(page), "delete", { "data-cp": "1" }), "click");
      let tree = t.render(page);
      assert.deepEqual(cps(t, tree), ["2"]);
      t.fire(act(t, tree, "delete", { "data-cp": "2" }), "click");
      tree = t.render(page);
      assert.deepEqual(cps(t, tree), []);
      assert.equal(t.textOf(by(t, tree, "data-role", "no-checkpoint")), "Save a checkpoint to compare with.");
    },
    cap: (t) => {
      const page = opened(t);
      for (let n = 1; n <= 19; n++) save(t, page);
      assert.equal(cps(t, t.render(page)).length, 20);
      assert.doesNotMatch(lastToast(t).message, /Dropped/);
      const tree = save(t, page);
      assert.equal(cps(t, tree).length, 20);
      assert.ok(!cps(t, tree).includes("1"), "the oldest (the baseline) is dropped");
      assert.match(lastToast(t).message, /Dropped the oldest checkpoint, “When this panel opened”: Lab keeps 20\./);
    },
    compare_now: (t) => {
      const page = opened(t);
      save(t, page, "Mid");
      rows(page)[2].instructions = "Is the customer in `ticket.body` furious?";
      t.fire(act(t, t.render(page), "compare", { "data-cp": "1" }), "click");
      const tree = t.render(page);
      assert.equal(by(t, tree, "data-role", "base").attrs.value, "1");
      assert.equal(by(t, tree, "data-role", "target").attrs.value, "now");
      assert.equal(t.textOf(by(t, tree, "data-role", "heading")), `From ${BASE} (7 questions) to the questions now (7 questions).`);
      assert.deepEqual(kinds(t, tree), ["reworded"]);
      assert.equal(by(t, tree, "data-change", "reworded").attrs["data-qid"], "angry");
    },
    compare_two: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      save(t, page, "Second");
      rows(page)[1].id = "urgency_level";  // after "Second": not part of the comparison of the two checkpoints
      choose(t, by(t, t.render(page), "data-role", "base"), "1");
      choose(t, by(t, t.render(page), "data-role", "target"), "2");
      const tree = t.render(page);
      assert.equal(t.textOf(by(t, tree, "data-role", "heading")), `From ${BASE} (7 questions) to “Second” (7 questions).`);
      assert.deepEqual(kinds(t, tree), ["reworded"]);
      assert.equal(act(t, tree, "revert"), null, "edits only act on the questions now");
      assert.equal(act(t, tree, "goto"), null);
    },
    summary: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page)[2].instructions = "Is the customer in  `ticket.body` angry? ";
      rows(page)[3].type = "noul";
      rows(page).splice(6, 1);
      rows(page).push(blankRow("extra", "score"));
      assert.equal(summary(t, t.render(page)), "5 changes: 1 added, 1 removed, 1 type changed, 1 reworded, 1 whitespace only.");
    },
    added: (t) => {
      const page = opened(t);
      rows(page).unshift(blankRow("first_q", "choice"));
      rows(page).push(blankRow("needs_human", "noul"));
      assert.deepEqual(changes(t, t.render(page)), [["added", "Added first_q (choice) at position 1."], ["added", "Added needs_human (noul) at position 9."]]);
    },
    removed: (t) => {
      const page = opened(t);
      rows(page).splice(6, 1);
      rows(page).splice(3, 1);
      assert.deepEqual(changes(t, t.render(page)), [["removed", "Removed mug_box (box) from position 4."], ["removed", "Removed tone (choice) from position 7."]]);
    },
    renamed: (t) => {
      const page = opened(t);
      rows(page)[1].id = "urgency_level";
      rows(page)[5].id = "new_one";
      const tree = t.render(page);
      assert.deepEqual(changes(t, tree), [["renamed", "Renamed “urgency” to “urgency_level”."], ["renamed", "Renamed “(no id)” to “new_one”."]]);
      assert.equal(by(t, tree, "data-change", "renamed").attrs["data-qid"], "urgency_level");
    },
    id_match: (t) => {
      const page = opened(t);
      page.page.rows = rows(page).map((row) => JSON.parse(JSON.stringify(row)));  // Raw JSON's Apply: every card is new
      rows(page)[0].instructions = INTENT_NEW;
      // Every card with an id is found again by its id; the blank-id card cannot be, so it reads as removed and added.
      assert.deepEqual(changes(t, t.render(page)), [
        ["reworded", "intent: instructions reworded (45 → 54 characters)."],
        ["added", "Added question 6 (choice) at position 6."],
        ["removed", "Removed question 6 (choice) from position 6."]]);
    },
    type: (t) => {
      const page = opened(t);
      rows(page)[2].type = "choice";
      assert.deepEqual(changes(t, t.render(page)), [["type", "angry: type noul → choice."]]);
    },
    reworded: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      const tree = t.render(page);
      assert.deepEqual(changes(t, tree), [["reworded", "intent: instructions reworded (45 → 54 characters)."]]);
      const detail = by(t, tree, "data-detail", "instructions");
      assert.equal(t.textOf(t.find(detail, (node) => node.attrs?.["data-side"] === "before")), INTENT);
      assert.equal(t.textOf(t.find(detail, (node) => node.attrs?.["data-side"] === "after")), INTENT_NEW);
    },
    whitespace: (t) => {
      const page = opened(t);
      rows(page)[2].instructions = "Is the customer in   `ticket.body` angry?\n";
      rows(page)[6].choice[0] = ["calm", "Calm  and polite"];
      let tree = t.render(page);
      assert.deepEqual(changes(t, tree), [["spacing", "angry: instructions changed in whitespace only."], ["descriptions", "tone: descriptions changed for calm."]]);
      t.fire(by(t, tree, "data-role", "ignore-space"), "change", { target: { checked: true } });
      tree = t.render(page);
      assert.deepEqual(changes(t, tree), []);
      assert.equal(summary(t, tree), `No changes: the questions now match ${BASE}.`);
    },
    moved: (t) => {
      const page = opened(t);
      const list = rows(page);
      page.page.rows = [...list.slice(1), list[0]];  // intent moved from first to last; the others keep their order
      assert.deepEqual(changes(t, t.render(page)), [["moved", "Moved intent from position 1 to 7."]]);
      // angry pulled to the front: intent and urgency shift down one place but keep their order, so only angry moved.
      const again = opened(t);
      const before = rows(again);
      again.page.rows = [before[2], before[0], before[1], ...before.slice(3)];
      assert.deepEqual(changes(t, t.render(again)), [["moved", "Moved angry from position 3 to 1."]]);
    },
    keys: (t) => {
      const page = opened(t);
      rows(page)[0].choice = [["refund", "Wants money back"], ["where_is_order", "Asks where an order is"], ["delivery", ""], ["", ""]];
      assert.deepEqual(changes(t, t.render(page)), [["keys_added", "intent: option keys added: delivery."], ["keys_removed", "intent: option keys removed: other."]]);
    },
    descriptions: (t) => {
      const page = opened(t);
      rows(page)[6].choice[1] = ["upset", "Upset or angry"];
      rows(page)[6].choice[0] = ["calm", "Calm and polite "];  // an edge space only: trimmed, not a change
      const tree = t.render(page);
      assert.deepEqual(changes(t, tree), [["descriptions", "tone: descriptions changed for upset."]]);
      const detail = by(t, tree, "data-detail", "upset");
      assert.equal(t.textOf(t.find(detail, (node) => node.attrs?.["data-side"] === "before")), "Upset");
      assert.equal(t.textOf(t.find(detail, (node) => node.attrs?.["data-side"] === "after")), "Upset or angry");
    },
    option_order: (t) => {
      const page = opened(t);
      rows(page)[6].choice = [["upset", "Upset"], ["calm", "Calm and polite"]];
      assert.deepEqual(changes(t, t.render(page)), [["options_order", "tone: options reordered: calm, upset → upset, calm."]]);
    },
    levels: (t) => {
      const page = opened(t);
      rows(page)[1].score = ["Not urgent", "", "Soon", "Right now"];  // a blank level moved: the request sends the same levels
      assert.deepEqual(changes(t, t.render(page)), []);
      rows(page)[1].score = ["Not urgent", "Within a day", "", "Right now", "Emergency"];
      const tree = t.render(page);
      assert.deepEqual(changes(t, tree), [
        ["levels", "urgency: text of level 1 changed. A level's number is its meaning, so answers before and after are not comparable there."],
        ["level_count", "urgency: 3 levels → 4 levels; the score's scale changed."]]);
      assert.ok(by(t, tree, "data-detail", "level 1"));
    },
    noul: (t) => {
      const page = opened(t);
      rows(page)[2].noulNo = "Polite or neutral wording";
      let tree = t.render(page);
      assert.deepEqual(changes(t, tree), [["noul", "angry: what a no means changed."]]);
      assert.equal(t.textOf(t.find(by(t, tree, "data-detail", "no"), (node) => node.attrs?.["data-side"] === "after")), "Polite or neutral wording");
      rows(page)[2].noulYes = "Uses threatening words";
      tree = t.render(page);
      assert.deepEqual(changes(t, tree), [["noul", "angry: what a yes and a no mean changed."]]);
    },
    no_change: (t) => {
      const page = opened(t);
      rows(page)[0].choice[3] = ["", ""];
      rows(page)[1].score.push("");
      const tree = t.render(page);
      assert.equal(summary(t, tree), `No changes: the questions now match ${BASE}.`);
      assert.deepEqual(changes(t, tree), []);
      assert.equal(act(t, tree, "copy-md"), null);
    },
    group_filter: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page)[3].type = "noul";
      rows(page).push(blankRow("extra", "noul"));
      choose(t, by(t, t.render(page), "data-role", "group"), "types");
      let tree = t.render(page);
      assert.deepEqual(kinds(t, tree), ["type"]);
      assert.equal(summary(t, tree), "3 changes: 1 added, 1 type changed, 1 reworded.", "the summary still counts every change");
      choose(t, by(t, tree, "data-role", "group"), "questions");
      assert.deepEqual(kinds(t, t.render(page)), ["added"]);
      choose(t, by(t, t.render(page), "data-role", "group"), "criteria");
      tree = t.render(page);
      assert.deepEqual(kinds(t, tree), []);
      assert.equal(t.textOf(by(t, tree, "data-role", "none-shown")), "No change of this kind.");
    },
    go_to: (t) => {
      const page = opened(t);
      rows(page)[2].instructions = "Is the customer furious?";
      rows(page)[6].instructions = "What is the tone?";
      let tree = t.render(page);
      t.fire(act(t, tree, "goto", { "data-qid": "angry" }), "click");
      assert.deepEqual(page.log.at(-1), ["focus", 2]);
      t.fire(act(t, tree, "goto", { "data-qid": "tone" }), "click");
      assert.match(lastToast(t).message, /hidden by the question filters/);
    },
    copy_md: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page)[3].type = "noul";
      t.fire(act(t, t.render(page), "copy-md"), "click");
      const [text] = t.env.copied;
      for (const part of [`# Question changes from ${BASE} to the questions now`, "2 changes: 1 type changed, 1 reworded.",
        "- **reworded**: intent: instructions reworded (45 → 54 characters).", `\`\`\`\n${INTENT}\n\`\`\``, `\`\`\`\n${INTENT_NEW}\n\`\`\``,
        "- **type changed**: mug_box: type box → noul."]) assert.ok(text.includes(part), part);
      for (const part of ["maya@customers.example", "Wants money back", "jev-1.14", "0.82", "iou_min"]) assert.ok(!text.includes(part), `must not hold ${part}`);
      choose(t, by(t, t.render(page), "data-role", "group"), "types");
      t.fire(act(t, t.render(page), "copy-md"), "click");
      assert.ok(!t.env.copied[1].includes("reworded"), "only the shown changes");
      const raw = opened(t, { rawPending: true });
      rows(raw)[0].instructions = INTENT_NEW;
      t.fire(act(t, t.render(raw), "copy-md"), "click");
      assert.equal(lastToast(t).message, "Apply the Raw JSON edits before sharing editor questions.");
      assert.equal(t.env.copied.length, 2);
    },
    download: (t) => {
      const page = opened(t);
      t.fire(act(t, t.render(page), "download", { "data-cp": "1" }), "click");
      const [file] = t.env.downloads;
      assert.equal(file.filename, "jev-checkpoint-when-this-panel-opened.json");
      assert.equal(file.mime, "application/json");
      // The fixture's own record of what a Run sends for these rows.
      assert.deepEqual(JSON.parse(file.text), buildResult().trace.request.questions);
      assert.ok(!file.text.includes("maya@") && !file.text.includes("iou_min"));
      rows(page)[6].id = "intent";
      save(t, page, "Repeated");
      t.fire(act(t, t.render(page), "download", { "data-cp": "2" }), "click");
      assert.match(lastToast(t).message, /repeats the id “intent”/);
      assert.equal(t.env.downloads.length, 1);
      // A repeated Choice key (edge spaces trimmed, as the request does) would silently lose an option: refused too.
      rows(page)[6].id = "tone";
      rows(page)[6].choice = [["calm", "Calm and polite"], [" calm ", "Quiet"]];
      save(t, page, "Repeated key");
      t.fire(act(t, t.render(page), "download", { "data-cp": "3" }), "click");
      assert.equal(lastToast(t).message, "In this checkpoint, “tone” repeats the option key “calm”, so it is not a valid questions map.");
      assert.equal(t.env.downloads.length, 1);
    },
    restore_preview: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page).splice(6, 1);
      t.fire(act(t, t.render(page), "restore-preview", { "data-cp": "1" }), "click");
      let tree = t.render(page);
      assert.equal(t.textOf(by(t, tree, "data-role", "restore-summary")),
        "Restoring would make 2 changes: 1 added, 1 reworded. The questions now are saved as a checkpoint first.");
      assert.equal(commits(page).length, 0);
      rows(page)[1].instructions = "Typed after the preview";
      tree = t.render(page);
      assert.ok(by(t, tree, "data-role", "restore-stale"));
      t.fire(act(t, tree, "apply-restore"), "click");
      assert.match(lastToast(t).message, /changed after this preview/);
      assert.equal(commits(page).length, 0);
      const same = opened(t);
      t.fire(act(t, t.render(same), "restore-preview", { "data-cp": "1" }), "click");
      assert.equal(t.textOf(by(t, t.render(same), "data-role", "restore-summary")), "Nothing to restore: the questions already match.");
    },
    restore: (t) => {
      const page = opened(t);
      const refs = page.items().map((item) => item.ref);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page)[1].id = "urgency_level";
      rows(page).splice(6, 1);
      t.fire(act(t, t.render(page), "restore-preview", { "data-cp": "1" }), "click");
      t.fire(act(t, t.render(page), "apply-restore"), "click");
      assert.deepEqual(ids(page), ORIGINAL_IDS);
      assert.deepEqual(rows(page), buildRows());
      assert.equal(commits(page)[0][1].label, "Restore When this panel opened");
      assert.deepEqual(page.items().slice(0, 6).map((item) => item.ref), refs.slice(0, 6), "edited cards stay the same cards");
      assert.deepEqual(Object.keys(page.page.expect).sort(), ["angry", "intent", "mug_box", "old_question"]);
      // A card that owns an expectation now but is not in the checkpoint: the editor refuses, and nothing changes.
      const owned = opened(t);
      rows(owned).push(blankRow("late", "noul"));
      owned.page.expect = { ...owned.page.expect, late: { min: 0.1 } };
      t.fire(act(t, t.render(owned), "restore-preview", { "data-cp": "1" }), "click");
      t.fire(act(t, t.render(owned), "apply-restore"), "click");
      assert.match(lastToast(t).message, /“late” has human expectations/);
      assert.equal(commits(owned).length, 0);
      assert.deepEqual(cps(t, t.render(owned)), ["1"], "a refused restore saves no checkpoint");
    },
    restore_safety: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page).splice(6, 1);
      t.fire(act(t, t.render(page), "restore-preview", { "data-cp": "1" }), "click");
      t.fire(act(t, t.render(page), "apply-restore"), "click");
      let tree = t.render(page);
      assert.equal(nameOf(t, tree, "2"), "Before restoring When this panel opened");
      assert.equal(facts(t, tree, "2"), "6 questions · 2 changes from now");
      assert.match(lastToast(t).message, /“Before restoring When this panel opened” holds the questions as they were/);
      t.fire(act(t, tree, "restore-preview", { "data-cp": "2" }), "click");
      t.fire(act(t, t.render(page), "apply-restore"), "click");
      assert.deepEqual(ids(page), ORIGINAL_IDS.slice(0, 6), "restoring the safety checkpoint undoes the restore");
      assert.equal(rows(page)[0].instructions, INTENT_NEW);
      const raw = opened(t, { rawPending: true });
      rows(raw)[0].instructions = INTENT_NEW;
      t.fire(act(t, t.render(raw), "restore-preview", { "data-cp": "1" }), "click");
      tree = t.render(raw);
      assert.equal(act(t, tree, "apply-restore").attrs.disabled, true);
      t.fire(act(t, tree, "apply-restore"), "click");
      assert.match(lastToast(t).message, /Apply the Raw JSON edits/);
      assert.deepEqual(cps(t, t.render(raw)), ["1"]);
    },
    revert_one: (t) => {
      const page = opened(t);
      rows(page)[0].instructions = INTENT_NEW;
      rows(page)[1].id = "urgency_level";
      let tree = t.render(page);
      t.fire(act(t, tree, "revert", { "data-kind": "reworded" }), "click");
      assert.equal(rows(page)[0].instructions, INTENT);
      assert.equal(rows(page)[1].id, "urgency_level", "only that question is reverted");
      assert.equal(commits(page)[0][1].label, "Revert intent to When this panel opened");
      assert.equal(lastToast(t).message, "Reverted “intent” to “When this panel opened”. “Before reverting intent” holds the questions as they were.");
      tree = t.render(page);
      // The safety checkpoint holds the reworded intent: one change from now. The comparison base stays the baseline.
      assert.equal(nameOf(t, tree, "2"), "Before reverting intent");
      assert.equal(facts(t, tree, "2"), "7 questions · 1 change from now");
      assert.equal(by(t, tree, "data-role", "base").attrs.value, "1");
      assert.deepEqual(kinds(t, tree), ["renamed"]);
      t.fire(act(t, tree, "revert", { "data-kind": "renamed" }), "click");
      assert.deepEqual(rows(page), buildRows());
      tree = t.render(page);
      assert.equal(nameOf(t, tree, "3"), "Before reverting urgency_level");
      assert.equal(facts(t, tree, "3"), "7 questions · 1 change from now");
      assert.equal(facts(t, tree, "2"), "7 questions · 2 changes from now");
      // Restoring the safety checkpoint undoes the revert.
      t.fire(act(t, tree, "restore-preview", { "data-cp": "2" }), "click");
      t.fire(act(t, t.render(page), "apply-restore"), "click");
      assert.equal(rows(page)[0].instructions, INTENT_NEW);
      assert.equal(rows(page)[1].id, "urgency_level");
    },
    bring_back: (t) => {
      const page = opened(t);
      const toneRef = page.items()[6].ref;
      rows(page).splice(6, 1);
      rows(page).splice(1, 1);
      let tree = t.render(page);
      assert.deepEqual(kinds(t, tree), ["removed", "removed"]);
      t.fire(t.find(tree, (node) => node.attrs?.["data-act"] === "bring-back" && node.attrs["data-ref"] !== toneRef), "click");
      assert.deepEqual(ids(page), ["intent", "urgency", "angry", "mug_box", " refund_amount_ok ", ""]);
      assert.match(lastToast(t).message, /Brought back “urgency” at position 2/);
      tree = t.render(page);
      t.fire(act(t, tree, "bring-back", { "data-ref": toneRef }), "click");
      assert.deepEqual(rows(page), buildRows());
      assert.equal(page.items()[6].ref, toneRef, "the card comes back under its old reference");
      t.fire(act(t, tree, "bring-back", { "data-ref": toneRef }), "click");  // a stale button from the earlier render
      assert.match(lastToast(t).message, /back already/);
      assert.equal(commits(page).length, 2);
    },
  } },
}, { ctx: () => sampleBuildQuestionsCtx() });
