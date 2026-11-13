// Tests for the page-wide pack static/js/lab/packs/chrome/chrome-navigation.js, run against a real chromeCtx built by
// tests/js/lab/fixtures/chrome.mjs. Expected texts are written out by hand from the fixture's COMMANDS and the four
// built-in shortcut rows of static/js/chrome.js (BUILT_IN_SHORTCUTS).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/chrome/chrome-navigation.js";
import { checkPack } from "./harness.mjs";
import { sampleChromeCtx } from "./fixtures/chrome.mjs";

const feature = (id) => pack.features.find((entry) => entry.id === id);

// Built-in rows of the keyboard help, as [keys on a PC, title, group].
const BUILT_INS = [
  ["Ctrl + K", "Open or close the command palette", "Every page"],
  ["Escape", "Close the newest dialog, drawer or palette and return focus", "Every page"],
  ["Tab", "Move through a dialog; focus wraps at its last and first control", "Every page"],
  ["Tab", "From the top of a page, the first Tab reaches Skip to content", "Every page"],
];

// Commands with a pipe in a title, a missing group, a formula-like title and Mod/Meta chords.
const ODD = [
  { key: "chrome-essentials/keyboard_help", title: "Show keyboard shortcuts", keys: "?", group: "Help", surface: "chrome" },
  { key: "shield-inbox/mark", title: "Mark | flag", keys: "Mod+Shift+M", group: null, surface: "shield.inbox" },
  { key: "shield-inbox/sum", title: "=SUM(A1)", keys: null, group: "Inbox", surface: "shield.inbox" },
  { key: "chrome-navigation/next_demo", title: "Go to the next demo in the top bar", keys: null, group: "Go to", surface: "chrome" },
  { key: "shield-inbox/meta", title: "Open the message", keys: "Meta+O", group: "Inbox", surface: "shield.inbox" },
];

const tab = (id) => ({ ctx: () => sampleChromeCtx({ path: "/claims" }), hidden: () => sampleChromeCtx({ path: "/workbench" }),
  check: (ctx) => {
    assert.deepEqual(ctx.calls, [["go", `/workbench#${id}`]]);
    const other = sampleChromeCtx({ path: "/" });
    feature(`go_wb_${id}`).run(other);
    assert.deepEqual(other.calls, [["go", `/workbench#${id}`]]);
  } });

checkPack(pack, {
  go_wb_tests: tab("tests"),
  go_wb_bulk: tab("bulk"),
  go_wb_compare: tab("compare"),
  go_wb_examples: tab("examples"),
  go_wb_toolbox: tab("toolbox"),

  next_demo: { ctx: () => sampleChromeCtx({ path: "/shield" }), hidden: () => sampleChromeCtx({ path: "/settings-elsewhere" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["go", "/dispatch"]]);
    // Counter is the last demo: the next one wraps to Shield, past the Workbench and Overview.
    const counter = sampleChromeCtx({ path: "/counter" });
    feature("next_demo").run(counter);
    assert.deepEqual(counter.calls, [["go", "/shield"]]);
    const overview = sampleChromeCtx({ path: "/" });
    feature("next_demo").run(overview);
    assert.deepEqual(overview.calls, [["go", "/shield"]]);
    const workbench = sampleChromeCtx({ path: "/workbench" });
    feature("next_demo").run(workbench);
    assert.deepEqual(workbench.calls, [["go", "/shield"]]);
    assert.throws(() => feature("next_demo").run(sampleChromeCtx({ path: "/nowhere" })), /not in the top bar/);
  } },
  previous_demo: { ctx: () => sampleChromeCtx({ path: "/claims" }), hidden: () => sampleChromeCtx({ path: "/nowhere" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["go", "/autopilot"]]);
    const shield = sampleChromeCtx({ path: "/shield" });
    feature("previous_demo").run(shield);
    assert.deepEqual(shield.calls, [["go", "/counter"]]);
    const overview = sampleChromeCtx({ path: "/" });
    feature("previous_demo").run(overview);
    assert.deepEqual(overview.calls, [["go", "/counter"]]);
    const workbench = sampleChromeCtx({ path: "/workbench" });
    feature("previous_demo").run(workbench);
    assert.deepEqual(workbench.calls, [["go", "/counter"]]);
  } },

  copy_shortcuts_text: { ctx: () => sampleChromeCtx(), check: (ctx) => {
    const lines = [["Shortcut", "Action", "Group"], ...BUILT_INS, ["?", "Show keyboard shortcuts", "Help"], ["j", "Select the next message", "Inbox"],
      ["Palette only", "Go to Workbench", "Go to"]].map((cells) => cells.join("\t"));
    assert.deepEqual(ctx.env.copied, [lines.join("\n") + "\n"]);
    const mac = sampleChromeCtx({ mac: true });
    feature("copy_shortcuts_text").run(mac);
    assert.match(mac.env.copied[0], /^Shortcut\tAction\tGroup\nCmd \+ K\tOpen or close the command palette\tEvery page\n/);
    assert.equal(ctx.calls.length, 0);
  } },
  copy_shortcuts_markdown: { ctx: () => sampleChromeCtx({ path: "/claims", commands: ODD.slice(0, 2) }), check: (ctx) => {
    const expected = "# Jev Lab keyboard shortcuts: Claims\n\n"
      + "| Shortcut | Action | Group |\n| --- | --- | --- |\n"
      + BUILT_INS.map((row) => `| ${row.join(" | ")} |\n`).join("")
      + "| ? | Show keyboard shortcuts | Help |\n"
      + "| Ctrl + Shift + M | Mark \\| flag |  |\n";
    assert.deepEqual(ctx.env.copied, [expected]);
    // No commands on the Overview: only the four built-in rows, titled by the page label.
    const empty = sampleChromeCtx({ path: "/", commands: [] });
    feature("copy_shortcuts_markdown").run(empty);
    assert.deepEqual(empty.env.copied, ["# Jev Lab keyboard shortcuts: Overview\n\n| Shortcut | Action | Group |\n| --- | --- | --- |\n"
      + BUILT_INS.map((row) => `| ${row.join(" | ")} |\n`).join("")]);
    // Off the bar the title falls back to the path.
    const off = sampleChromeCtx({ path: "/Odd Page_2", commands: [] });
    feature("copy_shortcuts_markdown").run(off);
    assert.match(off.env.copied[0], /^# Jev Lab keyboard shortcuts: \/Odd Page_2\n/);
  } },
  copy_keyed_shortcuts: { ctx: () => sampleChromeCtx({ commands: ODD, mac: true }), check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["Cmd + K\tOpen or close the command palette\n"
      + "Escape\tClose the newest dialog, drawer or palette and return focus\n"
      + "Tab\tMove through a dialog; focus wraps at its last and first control\n"
      + "Tab\tFrom the top of a page, the first Tab reaches Skip to content\n"
      + "?\tShow keyboard shortcuts\n"
      + "Cmd + Shift + M\tMark | flag\n"
      + "Cmd + O\tOpen the message\n"]);
  } },
  copy_palette_only: { ctx: () => sampleChromeCtx({ commands: ODD }), hidden: () => sampleChromeCtx({ commands: [ODD[0], ODD[1]] }), check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["=SUM(A1)\nGo to the next demo in the top bar\n"]);
  } },
  count_commands: { ctx: () => sampleChromeCtx(), check: (ctx) => {
    // COMMANDS: two page-wide (keyboard help, go to Workbench), one from the Shield inbox; two have a shortcut.
    assert.deepEqual(ctx.env.toasts, [{ message: "3 commands on this page: 2 page-wide and 1 from this page's own tools; 2 have a shortcut.", kind: "" }]);
    const one = sampleChromeCtx({ commands: [ODD[3]] });
    feature("count_commands").run(one);
    assert.equal(one.env.toasts[0].message, "1 command on this page: 1 page-wide and 0 from this page's own tools; 0 have a shortcut.");
    const keyed = sampleChromeCtx({ commands: [ODD[0]] });
    feature("count_commands").run(keyed);
    assert.equal(keyed.env.toasts[0].message, "1 command on this page: 1 page-wide and 0 from this page's own tools; 1 has a shortcut.");
  } },
  count_by_group: { ctx: () => sampleChromeCtx({ commands: ODD }), hidden: () => sampleChromeCtx({ commands: [] }), check: (ctx) => {
    // Groups in order of first appearance: Help, (none) -> Other, Inbox (twice), Go to.
    assert.deepEqual(ctx.env.toasts, [{ message: "Commands by group: Help 1, Other 1, Inbox 2, Go to 1.", kind: "" }]);
  } },
  copy_page_commands: { ctx: () => sampleChromeCtx({ commands: ODD }),
    hidden: () => sampleChromeCtx({ commands: [ODD[0], ODD[3]] }), check: (ctx) => {
      assert.deepEqual(ctx.env.copied, ["Mark | flag (Ctrl + Shift + M)\n=SUM(A1)\nOpen the message (Meta + O)\n"]);
    } },
  copy_commands_grouped: { ctx: () => sampleChromeCtx({ commands: ODD }), hidden: () => sampleChromeCtx({ commands: [] }), check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["## Help\n\n- Show keyboard shortcuts (?)\n\n"
      + "## Other\n\n- Mark | flag (Ctrl + Shift + M)\n\n"
      + "## Inbox\n\n- =SUM(A1)\n- Open the message (Meta + O)\n\n"
      + "## Go to\n\n- Go to the next demo in the top bar\n"]);
  } },
  download_commands_csv: { ctx: () => sampleChromeCtx({ path: "/reviews", commands: ODD.slice(0, 3) }),
    hidden: () => sampleChromeCtx({ commands: [] }), check: (ctx) => {
      // Every cell quoted; the formula-like title gets a leading apostrophe.
      const text = '"command","shortcut","group","surface","id"\r\n'
        + '"Show keyboard shortcuts","?","Help","chrome","chrome-essentials/keyboard_help"\r\n'
        + '"Mark | flag","Mod+Shift+M","","shield.inbox","shield-inbox/mark"\r\n'
        + '"\'=SUM(A1)","","Inbox","shield.inbox","shield-inbox/sum"\r\n';
      assert.deepEqual(ctx.env.downloads, [{ filename: "jev-lab-commands-reviews.csv", text, mime: "text/csv" }]);
      // File names: "/" is the Overview, and other characters collapse to single hyphens.
      for (const [path, filename] of [["/", "jev-lab-commands-overview.csv"], ["/Odd Page_2", "jev-lab-commands-odd-page-2.csv"]]) {
        const other = sampleChromeCtx({ path });
        feature("download_commands_csv").run(other);
        assert.equal(other.env.downloads[0].filename, filename);
      }
    } },

  where_am_i: { ctx: () => sampleChromeCtx({ path: "/find" }), check: (ctx) => {
    assert.deepEqual(ctx.env.toasts, [{ message: "Find: page 7 of 10 in the top bar.", kind: "" }]);
    const off = sampleChromeCtx({ path: "/elsewhere" });
    feature("where_am_i").run(off);
    assert.equal(off.env.toasts[0].message, "This page (/elsewhere) is not in the top bar.");
  } },
  copy_markdown_link: { ctx: () => sampleChromeCtx({ path: "/workbench", url: "http://127.0.0.1:8321/workbench#bulk" }),
    hidden: () => sampleChromeCtx({ url: null }), check: (ctx) => {
      assert.deepEqual(ctx.env.copied, ["[Jev Lab Workbench](http://127.0.0.1:8321/workbench#bulk)"]);
      const odd = sampleChromeCtx({ path: "/x", url: "http://localhost:8321/x(1)" });
      feature("copy_markdown_link").run(odd);
      assert.deepEqual(odd.env.copied, ["[Jev Lab /x](http://localhost:8321/x%281%29)"]);
    } },
  copy_link_without_hash: { ctx: () => sampleChromeCtx({ path: "/workbench", url: "http://127.0.0.1:8321/workbench?x=1#tests" }),
    hidden: () => sampleChromeCtx({ path: "/workbench" }), check: (ctx) => {
      assert.deepEqual(ctx.env.copied, ["http://127.0.0.1:8321/workbench?x=1"]);
      assert.equal(feature("copy_link_without_hash").when(sampleChromeCtx({ url: null })), false);
    } },
  copy_bar_links: { ctx: () => sampleChromeCtx({ path: "/play", url: "http://localhost:8321/play#round" }),
    hidden: () => sampleChromeCtx({ url: null }), check: (ctx) => {
      const base = "http://localhost:8321";
      const pages = [["Overview", "/"], ["Shield", "/shield"], ["Dispatch", "/dispatch"], ["Autopilot", "/autopilot"], ["Claims", "/claims"],
        ["Reviews", "/reviews"], ["Find", "/find"], ["Play", "/play"], ["Counter", "/counter"], ["Workbench", "/workbench"]];
      assert.deepEqual(ctx.env.copied, [pages.map(([label, path]) => `- [${label}](${base}${path})`).join("\n") + "\n"]);
    } },
}, { ctx: () => sampleChromeCtx() });
