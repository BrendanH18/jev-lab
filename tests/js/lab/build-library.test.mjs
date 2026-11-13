// Tests for static/js/lab/packs/workbench/build-library.js on the Build fixture (tests/js/lab/fixtures/workbench-build.mjs:
// seven cards intent, urgency, angry, mug_box, " refund_amount_ok ", a blank-id Choice and a hidden tone; expectations
// for intent, angry, mug_box and the orphan old_question). Reference values are worked out by hand from the library
// table in the pack: 20 skeletons, routing 4, sentiment 3, urgency 3, policy 5, extraction 5; 10 Noul, 7 Choice,
// 2 Score, 1 Box. Typing is simulated by firing a control's handlers, as the browser would.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/build-library.js";
import { checkPack } from "./harness.mjs";
import { sampleBuildQuestionsCtx } from "./fixtures/workbench-build.mjs";

const ctx = (overrides = {}) => sampleBuildQuestionsCtx(overrides);
const LIBRARY_ORDER = ["route_team", "intent", "language", "needs_human", "sentiment", "sentiment_scale", "frustrated", "urgency", "urgency_tier",
  "deadline_mentioned", "personal_data", "abusive_language", "legal_threat", "refund_request", "policy_flag", "amount_matches", "reference_present",
  "dates_agree", "extraction_complete", "item_location"];
const by = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const act = (t, tree, name, extra = {}) => t.find(tree, (node) => node.attrs?.["data-act"] === name && Object.entries(extra).every(([key, value]) => node.attrs[key] === value));
const shownKeys = (t, tree) => t.findAll(tree, (node) => node.tag === "li" && node.attrs["data-skeleton"]).map((node) => node.attrs["data-skeleton"]);
const choose = (t, node, value) => t.fire(node, "change", { target: { value } });
const type = (t, node, value) => t.fire(node, "input", { target: { value } });
const tick = (t, node, checked) => t.fire(node, "change", { target: { checked } });
const preview = (t, page, key) => { t.fire(act(t, t.render(page), "preview", { "data-key": key }), "click"); return t.render(page); };
const draftJson = (t, tree) => JSON.parse(t.textOf(by(t, tree, "data-role", "json")));
const commits = (page) => page.log.filter(([name]) => name === "commit");
const ids = (page) => page.page.rows.map((row) => row.id);
const blankQuestion = (id, type, extra = {}) => ({ id, type, instructions: "", noulYes: "", noulNo: "", ...extra });
const lastToast = (t) => t.env.toasts.at(-1);
const ninetyNine = () => ctx({ rows: Array.from({ length: 99 }, (_, index) => ({ id: `q_${index + 1}`, type: "noul", instructions: "",
  choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" })), expect: {}, hide: [] });

checkPack(pack, {
  library: { improvements: {
    catalog: (t) => {
      const tree = t.render(ctx());
      assert.equal(t.textOf(by(t, tree, "data-role", "count")), "20 of 20 skeletons shown");
      assert.deepEqual(t.findAll(tree, (node) => node.tag === "h4" && node.attrs["data-need"]).map(t.textOf),
        ["Routing · 4", "Sentiment · 3", "Urgency · 3", "Policy flags · 5", "Extraction checks · 5"]);
      assert.deepEqual(shownKeys(t, tree), LIBRARY_ORDER);
      assert.match(t.textOf(by(t, tree, "data-skeleton", "route_team")), /route_team · choice · billing, shipping, product, account, other/);
      assert.match(t.textOf(by(t, tree, "data-skeleton", "urgency")), /urgency · score · 4 levels/);
    },
    need: (t) => {
      const page = ctx();
      choose(t, by(t, t.render(page), "data-role", "need"), "urgency");
      const tree = t.render(page);
      assert.deepEqual(shownKeys(t, tree), ["urgency", "urgency_tier", "deadline_mentioned"]);
      assert.equal(t.textOf(by(t, tree, "data-role", "count")), "3 of 20 skeletons shown");
      choose(t, by(t, tree, "data-role", "need"), "policy");
      assert.deepEqual(shownKeys(t, t.render(page)), ["personal_data", "abusive_language", "legal_threat", "refund_request", "policy_flag"]);
    },
    type: (t) => {
      const page = ctx();
      choose(t, by(t, t.render(page), "data-role", "type"), "score");
      assert.deepEqual(shownKeys(t, t.render(page)), ["sentiment_scale", "urgency"]);
      choose(t, by(t, t.render(page), "data-role", "type"), "box");
      assert.deepEqual(shownKeys(t, t.render(page)), ["item_location"]);
      choose(t, by(t, t.render(page), "data-role", "type"), "noul");
      assert.equal(shownKeys(t, t.render(page)).length, 10);
    },
    search: (t) => {
      const page = ctx();
      const tree = t.render(page);
      const list = by(t, tree, "data-role", "list");
      type(t, by(t, tree, "data-role", "search"), "FRAUD");  // an option key, any case; the list updates without a re-render
      assert.deepEqual(shownKeys(t, list), ["policy_flag"]);
      type(t, by(t, tree, "data-role", "search"), "response time");  // words of urgency's note
      assert.deepEqual(shownKeys(t, list), ["urgency"]);
      // Every word must match: "team" is in route_team's title and language's note; both have the key "other".
      type(t, by(t, tree, "data-role", "search"), "team other");
      assert.deepEqual(shownKeys(t, list), ["route_team", "language"]);
      assert.equal(t.textOf(by(t, list, "data-role", "count")), "2 of 20 skeletons shown");
    },
    reset: (t) => {
      const page = ctx();
      type(t, by(t, t.render(page), "data-role", "search"), "zzz");
      let tree = t.render(page);
      assert.match(t.textOf(by(t, tree, "data-role", "no-match")), /No skeleton matches/);
      assert.equal(t.textOf(by(t, tree, "data-role", "count")), "0 of 20 skeletons shown");
      t.fire(act(t, tree, "reset-empty"), "click");
      tree = t.render(page);
      assert.equal(shownKeys(t, tree).length, 20);
      assert.equal(by(t, tree, "data-role", "search").attrs.value, "");
      choose(t, by(t, tree, "data-role", "need"), "sentiment");
      choose(t, by(t, t.render(page), "data-role", "type"), "choice");
      choose(t, by(t, t.render(page), "data-role", "sort"), "title");
      tick(t, by(t, t.render(page), "data-role", "hide-used"), true);
      assert.deepEqual(shownKeys(t, t.render(page)), ["sentiment"]);
      t.fire(act(t, t.render(page), "reset"), "click");
      tree = t.render(page);
      assert.equal(shownKeys(t, tree).length, 20);
      assert.equal(by(t, tree, "data-role", "hide-used").attrs.checked, false);
      assert.equal(by(t, tree, "data-role", "need").attrs.value, "");
      assert.equal(by(t, tree, "data-role", "type").attrs.value, "");
      assert.equal(by(t, tree, "data-role", "sort").attrs.value, "title", "the order is not a filter: reset keeps it");
    },
    sort: (t) => {
      const page = ctx();
      choose(t, by(t, t.render(page), "data-role", "sort"), "title");
      let tree = t.render(page);
      // Titles A to Z, worked out by hand ("Mentions a deadline" before "Message intent").
      assert.deepEqual(shownKeys(t, tree), ["abusive_language", "amount_matches", "refund_request", "frustrated", "dates_agree", "extraction_complete",
        "item_location", "deadline_mentioned", "intent", "language", "needs_human", "sentiment", "policy_flag", "reference_present", "route_team",
        "sentiment_scale", "personal_data", "legal_threat", "urgency", "urgency_tier"]);
      assert.equal(t.findAll(tree, (node) => node.tag === "h4" && node.attrs["data-need"]).length, 0, "no need headings when sorted");
      choose(t, by(t, tree, "data-role", "sort"), "type");
      tree = t.render(page);
      const keys = shownKeys(t, tree);
      assert.deepEqual(keys.slice(0, 2), ["abusive_language", "amount_matches"], "Noul first, by title");
      assert.deepEqual(keys.slice(10, 12), ["extraction_complete", "intent"], "then Choice, by title");
      assert.deepEqual(keys.slice(-3), ["sentiment_scale", "urgency", "item_location"], "then Score, then Box");
    },
    in_editor: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-in-editor"]).map((node) => node.attrs["data-in-editor"]), ["intent", "urgency"]);
      const bare = t.render(ctx({ rows: [], expect: {} }));
      assert.equal(t.findAll(bare, (node) => node.attrs?.["data-in-editor"]).length, 0);
    },
    hide_used: (t) => {
      const page = ctx();
      tick(t, by(t, t.render(page), "data-role", "hide-used"), true);
      const keys = shownKeys(t, t.render(page));
      assert.equal(keys.length, 18);
      assert.ok(!keys.includes("intent") && !keys.includes("urgency"));
      tick(t, by(t, t.render(page), "data-role", "hide-used"), false);
      assert.equal(shownKeys(t, t.render(page)).length, 20);
    },
    preview: (t) => {
      const page = ctx();
      const tree = preview(t, page, "route_team");
      assert.equal(by(t, tree, "data-role", "preview").attrs["data-key"], "route_team");
      assert.deepEqual(draftJson(t, tree), blankQuestion("route_team", "choice",
        { choice: [["billing", ""], ["shipping", ""], ["product", ""], ["account", ""], ["other", ""]] }));
      assert.equal(commits(page).length, 0, "a preview changes nothing");
      t.fire(act(t, tree, "close-preview"), "click");
      assert.equal(by(t, t.render(page), "data-role", "preview"), null);
    },
    to_write: (t) => {
      const page = ctx();
      const lines = (key) => t.findAll(by(t, preview(t, page, key), "data-role", "to-write"), (node) => node.tag === "li").map(t.textOf);
      assert.deepEqual(lines("sentiment_scale"), ["the instructions", "5 level texts"]);
      assert.deepEqual(lines("route_team"), ["the instructions", "5 option descriptions"]);
      assert.deepEqual(lines("needs_human"), ["the instructions", "what a yes means (and, if useful, what a no means)"]);
      assert.deepEqual(lines("item_location"), ["the instructions", "which picture it looks at (attach one in Pictures)"]);
    },
    note: (t) => {
      const page = ctx();
      const tree = preview(t, page, "deadline_mentioned");
      assert.equal(t.textOf(by(t, tree, "data-role", "note")),
        "Note for you (never added to the question): Keep date arithmetic in code: ask only whether a deadline is mentioned.");
      t.fire(act(t, tree, "add"), "click");
      const added = page.page.rows.at(-1);
      assert.equal(added.id, "deadline_mentioned");
      assert.equal(added.instructions, "");
      assert.ok(!JSON.stringify(added).includes("arithmetic"), "the note never reaches the question");
    },
    custom_id: (t) => {
      const page = ctx();
      let tree = preview(t, page, "needs_human");
      const tryId = (value) => { choose(t, by(t, tree, "data-role", "id"), value); tree = t.render(page); return t.textOf(by(t, tree, "data-role", "draft-error")); };
      assert.equal(tryId("angry"), "“angry” is already a question id in the editor.");
      assert.equal(tryId("old_question"), "Expectations already exist for “old_question”; choose another id.");
      assert.equal(tryId("needs a person"), "An id cannot contain spaces.");
      assert.equal(tryId("  "), "Give the question an id.");
      t.fire(act(t, tree, "add"), "click");
      assert.equal(commits(page).length, 0, "a refused id adds nothing");
      assert.equal(lastToast(t).kind, "error");
      assert.equal(tryId(" escalate "), "");
      assert.equal(draftJson(t, tree).id, "escalate");
      t.fire(act(t, tree, "add"), "click");
      assert.equal(page.page.rows.at(-1).id, "escalate");
    },
    free_id: (t) => {
      const page = ctx();
      const tree = preview(t, page, "intent");
      assert.equal(by(t, tree, "data-role", "id").attrs.value, "intent_2");
      assert.equal(t.textOf(by(t, tree, "data-role", "free-id")), "“intent” is taken here, so the suggested id is “intent_2”.");
      const free = preview(t, page, "route_team");
      assert.equal(by(t, free, "data-role", "id").attrs.value, "route_team");
      assert.equal(by(t, free, "data-role", "free-id"), null);
    },
    pick_keys: (t) => {
      const page = ctx();
      let tree = preview(t, page, "route_team");
      const keyBox = (key) => t.find(by(t, tree, "data-role", "keys"), (node) => node.attrs?.["data-key"] === key);
      for (const key of ["account", "other"]) { tick(t, keyBox(key), false); tree = t.render(page); }
      assert.deepEqual(draftJson(t, tree).choice, [["billing", ""], ["shipping", ""], ["product", ""]]);
      for (const key of ["product", "shipping"]) { tick(t, keyBox(key), false); tree = t.render(page); }
      assert.equal(t.textOf(by(t, tree, "data-role", "draft-error")), "Keep at least two option keys.");
      tick(t, keyBox("other"), true);
      tree = t.render(page);
      assert.deepEqual(draftJson(t, tree).choice, [["billing", ""], ["other", ""]], "a re-checked key keeps its library place");
    },
    extra_key: (t) => {
      const page = ctx();
      let tree = preview(t, page, "sentiment");
      type(t, by(t, tree, "data-role", "extra-key"), " very_negative ");
      t.fire(act(t, tree, "extra-key"), "click");
      tree = t.render(page);
      assert.deepEqual(draftJson(t, tree).choice.map(([key]) => key), ["positive", "neutral", "negative", "mixed", "very_negative"]);
      assert.ok(t.find(tree, (node) => node.attrs?.["data-key"] === "very_negative"), "the new key gets its own checkbox");
      for (const bad of ["two words", "positive", ""]) {
        type(t, by(t, tree, "data-role", "extra-key"), bad);
        t.fire(act(t, tree, "extra-key"), "click");
        assert.equal(lastToast(t).kind, "error", `should refuse ${JSON.stringify(bad)}`);
      }
      assert.equal(draftJson(t, t.render(page)).choice.length, 5);
    },
    level_count: (t) => {
      const page = ctx();
      let tree = preview(t, page, "urgency");
      assert.equal(draftJson(t, tree).score.length, 4);
      choose(t, by(t, tree, "data-role", "levels"), "7");
      tree = t.render(page);
      assert.deepEqual(draftJson(t, tree).score, ["", "", "", "", "", "", ""]);
      assert.equal(t.textOf(t.findAll(by(t, tree, "data-role", "to-write"), (node) => node.tag === "li")[1]), "7 level texts");
      for (const bad of ["1", "26", "3.5"]) {
        choose(t, by(t, tree, "data-role", "levels"), bad);
        tree = t.render(page);
        assert.equal(t.textOf(by(t, tree, "data-role", "draft-error")), "A Score takes 2 to 25 levels.");
      }
    },
    add: (t) => {
      const page = ctx();
      t.fire(act(t, preview(t, page, "route_team"), "add"), "click");
      assert.equal(commits(page).length, 1);
      assert.equal(commits(page)[0][1].label, "Add Route to a team from the library");
      assert.equal(page.page.rows.length, 8);
      const last = page.items().at(-1);
      assert.equal(last.qid, "route_team");
      assert.deepEqual(last.choice, [["billing", ""], ["shipping", ""], ["product", ""], ["account", ""], ["other", ""]]);
      assert.equal(last.instructions, "");
      assert.equal(lastToast(t).kind, "success");
      assert.equal(by(t, t.render(page), "data-role", "preview"), null, "the preview closes after adding");
      const raw = ctx({ rawPending: true });
      t.fire(act(t, preview(t, raw, "language"), "add"), "click");
      assert.equal(commits(raw).length, 0);
      assert.match(lastToast(t).message, /Apply the Raw JSON edits/);
    },
    insert_at: (t) => {
      const page = ctx();
      const urgencyRef = page.items()[1].ref;
      let tree = preview(t, page, "needs_human");
      choose(t, by(t, tree, "data-role", "position"), urgencyRef);
      tree = t.render(page);
      t.fire(act(t, tree, "add"), "click");
      assert.deepEqual(ids(page), ["intent", "urgency", "needs_human", "angry", "mug_box", " refund_amount_ok ", "", "tone"]);
      assert.deepEqual(Object.keys(page.page.expect).sort(), ["angry", "intent", "mug_box", "old_question"], "expectations stay with their questions");
      tree = preview(t, page, "frustrated");
      choose(t, by(t, tree, "data-role", "position"), "gone-ref");
      t.fire(act(t, t.render(page), "add"), "click");
      assert.match(lastToast(t).message, /no longer in the editor/);
      assert.equal(page.page.rows.length, 8);
    },
    copy_json: (t) => {
      const page = ctx();
      t.fire(act(t, preview(t, page, "language"), "copy-json"), "click");
      assert.deepEqual(JSON.parse(t.env.copied[0]), blankQuestion("language", "choice", { choice: [["en", ""], ["es", ""], ["fr", ""], ["de", ""], ["other", ""]] }));
      assert.equal(commits(page).length, 0);
    },
    select_shown: (t) => {
      const page = ctx();
      tick(t, by(t, t.render(page), "data-select", "needs_human"), true);
      choose(t, by(t, t.render(page), "data-role", "need"), "urgency");
      t.fire(act(t, t.render(page), "select-shown"), "click");
      // 1 hidden selection + the 3 shown urgency skeletons.
      assert.equal(t.textOf(act(t, t.render(page), "batch-preview")), "Preview adding 4 selected skeletons");
      t.fire(act(t, t.render(page), "batch-preview"), "click");
      let tree = t.render(page);
      // needs_human stays selected although the need filter hides it; urgency is taken, so it becomes urgency_2.
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-batch-id"]).map((node) => node.attrs["data-batch-id"]),
        ["needs_human", "urgency_2", "urgency_tier", "deadline_mentioned"]);
      tick(t, by(t, tree, "data-select", "urgency_tier"), false);
      tree = t.render(page);
      assert.equal(t.textOf(act(t, tree, "batch-preview")), "Preview adding 3 selected skeletons");
      assert.equal(by(t, tree, "data-role", "batch"), null, "changing the selection drops the old batch preview");
      t.fire(act(t, tree, "clear-selection"), "click");
      tree = t.render(page);
      assert.equal(act(t, tree, "batch-preview").attrs.disabled, true);
      assert.equal(t.textOf(act(t, tree, "batch-preview")), "Preview adding 0 selected skeletons");
    },
    batch_preview: (t) => {
      const page = ctx();
      for (const key of ["urgency", "sentiment", "intent"]) tick(t, by(t, t.render(page), "data-select", key), true);
      t.fire(act(t, t.render(page), "batch-preview"), "click");
      const tree = t.render(page);
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-batch-id"]).map(t.textOf),
        ["Message intent → intent_2 (choice)", "Overall sentiment → sentiment (choice)", "Urgency level → urgency_2 (score)"]);
      assert.equal(commits(page).length, 0, "a batch preview changes nothing");
      t.fire(act(t, tree, "batch-cancel"), "click");
      assert.equal(by(t, t.render(page), "data-role", "batch"), null);
    },
    batch_add: (t) => {
      const page = ctx();
      for (const key of ["intent", "sentiment_scale"]) tick(t, by(t, t.render(page), "data-select", key), true);
      t.fire(act(t, t.render(page), "batch-preview"), "click");
      t.fire(act(t, t.render(page), "batch-add"), "click");
      assert.equal(commits(page).length, 1, "one edit for the whole batch");
      assert.deepEqual(ids(page).slice(-2), ["intent_2", "sentiment_scale"]);
      const rows = page.page.rows.slice(-2);
      assert.deepEqual(rows[0].choice, [["request", ""], ["complaint", ""], ["question", ""], ["feedback", ""], ["other", ""]]);
      assert.deepEqual(rows[1].score, ["", "", "", "", ""]);
      assert.ok(rows.every((row) => row.instructions === ""));
      assert.match(lastToast(t).message, /Added intent_2, sentiment_scale/);
      assert.match(t.textOf(act(t, t.render(page), "batch-preview")), /0 selected skeletons/);
    },
    room: (t) => {
      assert.equal(t.textOf(by(t, t.render(ctx()), "data-role", "room")).split(".")[0], "Room for 93 more questions (7 of 100 used)");
      const full = ninetyNine();
      assert.match(t.textOf(by(t, t.render(full), "data-role", "room")), /^Room for 1 more question \(99 of 100 used\)/);
      for (const key of ["route_team", "language"]) tick(t, by(t, t.render(full), "data-select", key), true);
      t.fire(act(t, t.render(full), "batch-preview"), "click");
      const tree = t.render(full);
      assert.equal(t.textOf(by(t, tree, "data-role", "batch-room")), "Only 1 more question fits in this request.");
      const add = act(t, tree, "batch-add");
      assert.equal(add.attrs.disabled, true);
      t.fire(add, "click");
      assert.equal(commits(full).length, 0);
      assert.equal(lastToast(t).kind, "error");
    },
    added_log: (t) => {
      const page = ctx();
      t.fire(act(t, preview(t, page, "route_team"), "add"), "click");
      let tree = t.render(page);
      assert.equal(t.textOf(by(t, tree, "data-added", "route_team")).startsWith("route_team (Route to a team)"), true);
      t.fire(act(t, tree, "goto", { "data-qid": "route_team" }), "click");
      assert.deepEqual(page.log.at(-1), ["focus", 7], "the new card is the eighth");
      page.page.rows = page.page.rows.slice(0, -1);
      tree = t.render(page);
      assert.match(t.textOf(by(t, tree, "data-added", "route_team")), /no longer in the editor/);
      assert.equal(act(t, tree, "goto"), null);
    },
    templates: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(t.findAll(tree, (node) => node.tag === "li" && node.attrs["data-template"]).map((node) => node.attrs["data-template"]),
        ["yes_no_unsure", "low_medium_high", "positive_neutral_negative", "complete_partial_missing", "none_minor_major", "approve_review_reject"]);
      assert.match(t.textOf(by(t, tree, "data-template", "none_minor_major")), /None, minor or major none, minor, major/);
      // Choice questions with an id: intent and tone (the blank-id Choice card is left out, hidden tone is kept).
      assert.deepEqual(t.findAll(by(t, tree, "data-role", "template-target"), (node) => node.tag === "option").map(t.textOf), ["intent", "tone"]);
      assert.match(t.textOf(by(t, t.render(ctx({ rows: [], expect: {} })), "data-role", "no-target")), /Add a Choice question with an id/);
    },
    template_preview: (t) => {
      const page = ctx();
      t.fire(act(t, t.render(page), "template-preview", { "data-template": "yes_no_unsure" }), "click");
      let tree = t.render(page);
      assert.equal(t.textOf(by(t, tree, "data-role", "template-has")), "intent has none of these keys yet.");
      assert.match(t.textOf(by(t, tree, "data-role", "template-gain")), /^It would gain: yes, no, unsure/);
      page.page.rows[0].choice[3] = ["yes", ""];  // the user types "yes" into intent's blank row
      tree = t.render(page);
      assert.equal(t.textOf(by(t, tree, "data-role", "template-has")), "intent already has: yes.");
      assert.match(t.textOf(by(t, tree, "data-role", "template-gain")), /^It would gain: no, unsure/);
      assert.equal(commits(page).length, 0);
    },
    template_apply: (t) => {
      const page = ctx();
      const urgencyRow = page.page.rows[1];
      t.fire(act(t, t.render(page), "template-preview", { "data-template": "yes_no_unsure" }), "click");
      t.fire(act(t, t.render(page), "template-apply"), "click");
      // The blank row of intent takes "yes"; no and unsure are appended; existing rows are untouched.
      assert.deepEqual(page.page.rows[0].choice, [["refund", "Wants money back"], ["where_is_order", "Asks where an order is"], ["other", ""],
        ["yes", ""], ["no", ""], ["unsure", ""]]);
      assert.equal(page.page.rows[1], urgencyRow, "other cards keep their identity");
      assert.deepEqual(page.page.expect.intent, { choice: "refund" });
      assert.equal(commits(page)[0][1].label, "Add Yes, no or unsure keys to intent");
      const raw = ctx({ rawPending: true });
      t.fire(act(t, t.render(raw), "template-preview", { "data-template": "low_medium_high" }), "click");
      t.fire(act(t, t.render(raw), "template-apply"), "click");
      assert.equal(commits(raw).length, 0);
      assert.match(lastToast(t).message, /Apply the Raw JSON edits/);
    },
    template_save: (t) => {
      const page = ctx();
      const toneRef = page.items()[6].ref;
      choose(t, by(t, t.render(page), "data-role", "template-target"), toneRef);
      t.fire(act(t, t.render(page), "template-save"), "click");
      let tree = t.render(page);
      assert.match(t.textOf(by(t, tree, "data-template", "session_1")), /Keys of “tone” \(this session\) calm, upset/);
      t.fire(act(t, tree, "template-save"), "click");
      assert.match(lastToast(t).message, /already exists/);
      choose(t, by(t, t.render(page), "data-role", "template-target"), page.items()[0].ref);
      t.fire(act(t, t.render(page), "template-preview", { "data-template": "session_1" }), "click");
      t.fire(act(t, t.render(page), "template-apply"), "click");
      tree = t.render(page);
      assert.deepEqual(page.page.rows[0].choice.slice(3), [["calm", ""], ["upset", ""]]);
    },
    catalog_md: (t) => {
      t.fire(act(t, t.render(ctx()), "catalog"), "click");
      const [file] = t.env.downloads;
      assert.equal(file.filename, "jev-question-library.md");
      assert.equal(file.mime, "text/markdown");
      for (const part of ["# Question library", "## Routing", "## Extraction checks",
        "- **Route to a team**: `route_team` (choice; keys `billing`, `shipping`, `product`, `account`, `other`).",
        "- **Urgency level**: `urgency` (score; 4 levels). Tie each level to a response time your team can keep.",
        "## Choice key templates", "- **Approve, review or reject**: `approve`, `review`, `reject`"]) assert.ok(file.text.includes(part), part);
      for (const part of ["Wants money back", "maya@customers.example", "refund_amount_ok"]) assert.ok(!file.text.includes(part), `no editor content: ${part}`);
    },
  } },
}, { ctx: () => ctx() });
