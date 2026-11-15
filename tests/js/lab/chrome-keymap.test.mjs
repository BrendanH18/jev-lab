// Tests for the page-wide pack static/js/lab/packs/chrome/chrome-keymap.js, run against a real chromeCtx built by
// tests/js/lab/fixtures/chrome.mjs. Expected messages are written by hand from the fixture's COMMANDS (shortcuts "?"
// and "j", one command without a shortcut), the built-in rows of static/js/chrome.js and the numbers worked out below.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/chrome/chrome-keymap.js";
import { checkPack } from "./harness.mjs";
import { STATUS, sampleChromeCtx } from "./fixtures/chrome.mjs";

const feature = (id) => pack.features.find((entry) => entry.id === id);
const toast = (ctx) => ctx.env.toasts[0];
const command = (title, keys = null, group = "Inbox") => ({ key: `p/${title}`, title, keys, group, surface: "shield.inbox" });
// Commands that press Ctrl+K (the palette's own chord) and Alt+Shift+N twice (letters are case-blind).
const CLASH = [command("Open my palette", "Mod+K", null), command("Next", "Alt+Shift+N", null), command("New", "Alt+Shift+n", null)];
// Binary-exact spend: remaining = 2 - 0.5 - 0.25 = 1.25; average = 0.5 / 3; 1.25 / (0.5 / 3) = 7.5 calls; at $0.50 per
// million input tokens, 1.25 / 0.5 = 2.5 million tokens.
const EXACT = { ...STATUS.connected, price_per_mtok_input: 0.5,
  spend: { budget_usd: 2, spent_usd: 0.5, reserved_usd: 0.25, live_calls: 3, input_tokens: 1200, rpm: 60 } };

checkPack(pack, {
  download_keymap_json: { ctx: () => sampleChromeCtx({ path: "/shield" }), check: (ctx) => {
    const [file] = ctx.env.downloads;
    assert.equal(file.filename, "jev-lab-keyboard-shield.json");
    assert.equal(file.mime, "application/json");
    const parsed = JSON.parse(file.text);
    assert.equal(parsed.page, "/shield");
    assert.deepEqual(parsed.shortcuts.map((row) => row.label), ["Ctrl + K", "Escape", "Tab", "Tab", "?", "j", null]);
    assert.deepEqual(parsed.shortcuts[6], { keys: null, label: null, title: "Go to Workbench", group: "Go to" });
    const mac = sampleChromeCtx({ path: "/", mac: true });
    feature("download_keymap_json").run(mac);
    assert.equal(mac.env.downloads[0].filename, "jev-lab-keyboard-overview.json");
    assert.equal(JSON.parse(mac.env.downloads[0].text).shortcuts[0].label, "Cmd + K");
  } },
  check_shortcut_clashes: { ctx: () => sampleChromeCtx({ commands: CLASH }), check: (ctx) => {
    assert.deepEqual(toast(ctx), { message: "2 shortcuts shared: Ctrl + K by Open or close the command palette and Open my palette; Alt + Shift + N by Next and New.", kind: "error" });
    const clean = sampleChromeCtx();
    feature("check_shortcut_clashes").run(clean);
    assert.deepEqual(toast(clean), { message: "No two shortcuts on this page press the same keys.", kind: "" });
    // Mod is Cmd on a Mac, so it clashes with Meta there and with Ctrl elsewhere.
    const pair = [command("One", "Mod+O"), command("Two", "Meta+O")];
    const mac = sampleChromeCtx({ commands: pair, mac: true });
    feature("check_shortcut_clashes").run(mac);
    assert.equal(toast(mac).message, "1 shortcut shared: Cmd + O by One and Two.");
    const pc = sampleChromeCtx({ commands: pair });
    feature("check_shortcut_clashes").run(pc);
    assert.equal(toast(pc).kind, "");
  } },
  check_single_keys: { ctx: () => sampleChromeCtx(), check: (ctx) => {
    assert.equal(toast(ctx).message, "2 shortcuts are single character keys without Ctrl, Cmd or Alt: ? (Show keyboard shortcuts), j (Select the next message). Speech input can press these by accident.");
    const one = sampleChromeCtx({ commands: [command("Help", "?"), command("Open", "Alt+O"), command("Bigger", "Shift+J")] });
    feature("check_single_keys").run(one);
    assert.match(toast(one).message, /^2 shortcuts are single character keys .*: \? \(Help\), Shift\+J \(Bigger\)\./);
    const none = sampleChromeCtx({ commands: [command("Open", "Alt+O"), command("Down", "ArrowDown")] });
    feature("check_single_keys").run(none);
    assert.equal(toast(none).message, "No shortcut on this page is a single character key.");
  } },
  check_duplicate_titles: { ctx: () => sampleChromeCtx({ commands: [command("Copy"), command("copy"), command("Other")] }), check: (ctx) => {
    assert.deepEqual(toast(ctx), { message: "Titles used more than once: Copy (2×).", kind: "error" });
    const clean = sampleChromeCtx();
    feature("check_duplicate_titles").run(clean);
    assert.equal(toast(clean).message, "Every palette command on this page has its own title.");
  } },
  check_long_titles: { ctx: () => sampleChromeCtx({ commands: [command("x".repeat(81)), command("y".repeat(90)), command("z".repeat(80))] }), check: (ctx) => {
    assert.equal(toast(ctx).message, "2 command titles over 80 characters; the longest has 90.");
    const clean = sampleChromeCtx();
    feature("check_long_titles").run(clean);
    assert.equal(toast(clean).message, "No command title is longer than 80 characters.");
  } },
  check_ungrouped: { ctx: () => sampleChromeCtx({ commands: [command("Mark", null, null), command("Open")] }), check: (ctx) => {
    assert.equal(toast(ctx).message, "1 command without a group: Mark.");
    const clean = sampleChromeCtx();
    feature("check_ungrouped").run(clean);
    assert.equal(toast(clean).message, "Every palette command on this page has a group.");
  } },
  run_palette_checks: { ctx: () => sampleChromeCtx(), check: (ctx) => {
    assert.deepEqual(toast(ctx), { message: "Palette checks on 3 commands: 2 single-character shortcuts.", kind: "" });
    const clash = sampleChromeCtx({ commands: CLASH });
    feature("run_palette_checks").run(clash);
    assert.deepEqual(toast(clash), { message: "Palette checks on 3 commands: 2 shared shortcuts, 3 commands without a group.", kind: "error" });
    const clean = sampleChromeCtx({ commands: [command("Go")] });
    feature("run_palette_checks").run(clean);
    assert.equal(toast(clean).message, "Palette checks on 1 command: nothing found.");
  } },
  count_by_modifier: { ctx: () => sampleChromeCtx(), hidden: () => sampleChromeCtx({ commands: [command("Go")] }), check: (ctx) => {
    assert.equal(toast(ctx).message, "2 shortcuts: 0 with Ctrl, 0 with Alt, 0 with Shift, 2 with no modifier.");
    const mixed = sampleChromeCtx({ mac: true, commands: [command("A", "Mod+Shift+M"), command("B", "Meta+O"), command("C", "Alt+Shift+N"), command("D", "?"), command("E")] });
    feature("count_by_modifier").run(mixed);
    assert.equal(toast(mixed).message, "4 shortcuts: 2 with Cmd, 1 with Alt, 2 with Shift, 1 with no modifier.");
  } },
  copy_free_alt_shift: { ctx: () => sampleChromeCtx({ commands: [command("A", "Alt+Shift+N"), command("B", "Alt+Shift+p"), command("C", "Mod+Alt+Shift+Q"), command("D", "Alt+X")] }),
    check: (ctx) => {
      const lines = ctx.env.copied[0].trimEnd().split("\n");
      assert.equal(lines.length, 24);
      assert.deepEqual(lines.slice(0, 2), ["Alt+Shift+A", "Alt+Shift+B"]);
      assert.ok(!lines.includes("Alt+Shift+N") && !lines.includes("Alt+Shift+P"));
      assert.ok(lines.includes("Alt+Shift+Q") && lines.includes("Alt+Shift+X"));
      const full = sampleChromeCtx({ commands: [..."abcdefghijklmnopqrstuvwxyz"].map((letter) => command(letter, `Alt+Shift+${letter}`)) });
      assert.throws(() => feature("copy_free_alt_shift").run(full), /Every Alt\+Shift letter is taken/);
    } },
  show_overlays: { ctx: () => sampleChromeCtx({ layers: ["settings", "palette"] }), check: (ctx) => {
    assert.equal(toast(ctx).message, "Open, oldest first: API key and safety settings, command palette. Escape closes the command palette.");
    const none = sampleChromeCtx();
    feature("show_overlays").run(none);
    assert.equal(toast(none).message, "No dialog, drawer or palette is open.");
  } },
  estimate_calls_left: { ctx: () => sampleChromeCtx({ status: EXACT }), hidden: () => sampleChromeCtx({ status: STATUS.noBudget }), check: (ctx) => {
    assert.equal(toast(ctx).message, "Estimate: about 7 more calls like this run's average fit in the budget left. Not measured spend.");
    // remaining 2 - 0.0125 - 0.0005 = 1.987; 1.987 / (0.0125 / 7) = 1112.72.
    const connected = sampleChromeCtx({ status: STATUS.connected });
    feature("estimate_calls_left").run(connected);
    assert.match(toast(connected).message, /about 1,112 more calls/);
    assert.equal(feature("estimate_calls_left").when(sampleChromeCtx({ status: STATUS.noKey })), false, "no finished call yet");
    assert.throws(() => feature("estimate_calls_left").run(sampleChromeCtx({ status: STATUS.loading })), /needs a budget/);
  } },
  estimate_tokens_left: { ctx: () => sampleChromeCtx({ status: EXACT }), hidden: () => sampleChromeCtx({ status: STATUS.noBudget }), check: (ctx) => {
    assert.equal(toast(ctx).message, "Estimate: the budget left buys about 2,500,000 input tokens at $0.50 per million. Not measured spend.");
    // 1.987 / 0.4 = 4.9675 million.
    const connected = sampleChromeCtx({ status: STATUS.connected });
    feature("estimate_tokens_left").run(connected);
    assert.match(toast(connected).message, /about 4,967,500 input tokens at \$0\.40 per million/);
  } },
  copy_html_link: { ctx: () => sampleChromeCtx({ path: "/find", url: "http://127.0.0.1:8321/find?a=1&b=2" }), hidden: () => sampleChromeCtx({ url: null }), check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ['<a href="http://127.0.0.1:8321/find?a=1&amp;b=2">Jev Lab Find</a>']);
  } },
  copy_page_path: { ctx: () => sampleChromeCtx({ path: "/workbench", url: "http://127.0.0.1:8321/workbench#bulk" }), check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["/workbench"]);
  } },
  download_pages_csv: { ctx: () => sampleChromeCtx({ path: "/shield" }), check: (ctx) => {
    const [file] = ctx.env.downloads;
    assert.equal(file.filename, "jev-lab-pages.csv");
    const lines = file.text.trimEnd().split("\r\n");
    assert.equal(lines.length, 11);
    assert.equal(lines[0], '"position","label","path","current","demo"');
    assert.equal(lines[1], '"1","Overview","/","no","no"');
    assert.equal(lines[2], '"2","Shield","/shield","yes","yes"');
    assert.equal(lines[10], '"10","Workbench","/workbench","no","no"');
  } },
  go_first_demo: { ctx: () => sampleChromeCtx({ path: "/claims" }), hidden: () => sampleChromeCtx({ path: "/shield" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["go", "/shield"]]);
    assert.throws(() => feature("go_first_demo").run(sampleChromeCtx({ path: "/shield" })), /already Shield/);
  } },
  go_last_demo: { ctx: () => sampleChromeCtx({ path: "/" }), hidden: () => sampleChromeCtx({ path: "/counter" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["go", "/counter"]]);
  } },
}, { ctx: () => sampleChromeCtx() });
