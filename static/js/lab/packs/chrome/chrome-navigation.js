// Chrome navigation: page-wide palette commands that open a Workbench tab from any other page, step to the next or
// previous demo in top-bar order, and copy or count what the keyboard help and the palette list (shortcut lists as
// text, Markdown or CSV, the page's own commands, commands by group) plus Markdown links to this page and to every
// page. Everything comes from ctx.data (paths, labels, the page address and the command and shortcut lists); nothing
// reads storage, calls the server or shows an answer. No command has a shortcut, so none can collide with a page's.
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

// The Workbench tabs the page reads from its address hash (static/js/workbench.js TABS). Build has its own command in
// chrome-essentials, and on the Workbench itself the page's own tab commands take over.
const WORKBENCH_TABS = [["tests", "Tests"], ["bulk", "Bulk"], ["compare", "Compare"], ["examples", "Examples"], ["toolbox", "Toolbox"]];
// Top-bar links that are not demos.
const NOT_DEMOS = new Set(["/", "/workbench"]);
const PAGE_WIDE = "chrome";

// "Mod+Shift+K" as this keyboard shows it: Mod and Meta read as Cmd on a Mac, Ctrl and Meta elsewhere.
export function keysLabel(keys, mac) {
  if (typeof keys !== "string" || !keys) return "";
  return keys.split("+").map((part) => (part === "Mod" ? (mac ? "Cmd" : "Ctrl") : part === "Meta" ? (mac ? "Cmd" : "Meta") : part)).join(" + ");
}

const flat = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();

// A short name for file names: the page path without its slash ("overview" for "/"), letters, digits and hyphens.
export function pageSlug(path) {
  const text = String(path || "/").replace(/^\/+/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return text || "overview";
}

const pageName = (ctx) => (ctx.data.page ? ctx.data.page.label : ctx.data.path);

// The demo `step` places away from the current page in top-bar order, wrapping around and skipping Overview and the
// Workbench. null when the current page is not in the bar.
export function neighbourDemo(links, step) {
  const at = links.findIndex((link) => link.current);
  if (at < 0) return null;
  for (let move = 1; move <= links.length; move++) {
    const link = links[(at + step * move + links.length * move) % links.length];
    if (!NOT_DEMOS.has(link.path) && !link.current) return link;
  }
  return null;
}

// The keyboard help's rows as [shortcut, action, group] cells, with "Palette only" for a command without a shortcut.
const shortcutRows = (ctx) => ctx.data.shortcuts.map((row) => [row.keys ? keysLabel(row.keys, ctx.data.mac) : "Palette only", flat(row.title), flat(row.group)]);

export function shortcutsText(ctx) {
  return [["Shortcut", "Action", "Group"], ...shortcutRows(ctx)].map((cells) => cells.map(flat).join("\t")).join("\n") + "\n";
}

export function shortcutsMarkdown(ctx) {
  return `# Jev Lab keyboard shortcuts: ${pageName(ctx)}\n\n${formatMarkdownTable(["Shortcut", "Action", "Group"], shortcutRows(ctx))}\n`;
}

const withKeys = (ctx, row) => (row.keys ? `${flat(row.title)} (${keysLabel(row.keys, ctx.data.mac)})` : flat(row.title));

// Commands in palette order, grouped by their group in order of first appearance ("Other" for none), as Markdown.
export function commandsByGroup(ctx) {
  const groups = new Map();
  for (const row of ctx.data.commands) {
    const name = row.group ? flat(row.group) : "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(`- ${withKeys(ctx, row)}`);
  }
  return [...groups].map(([name, lines]) => `## ${name}\n\n${lines.join("\n")}\n`).join("\n");
}

// Text inside [ ] of a Markdown link, and an address inside ( ).
const linkText = (text) => String(text).replace(/[\\[\]]/g, (char) => `\\${char}`);
const linkUrl = (url) => String(url).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

// The page address up to its path ("http://127.0.0.1:8321"), or null without an http(s) address.
const origin = (url) => {
  const match = /^(https?:\/\/[^/?#]+)/.exec(url || "");
  return match ? match[1] : null;
};

const openTab = ([id, label]) => ({ id: `go_wb_${id}`, kind: "command", group: "Go to", title: `Open the Workbench ${label} tab`,
  help: `Opens the Workbench with the ${label} tab selected. On the Workbench itself, its own tab commands do this.`,
  when: (ctx) => ctx.data.path !== "/workbench", run: (ctx) => ctx.actions.go(`/workbench#${id}`) });

const stepDemo = (id, step, title) => ({ id, kind: "command", group: "Go to", title,
  help: "Demos in top-bar order (Shield to Counter), wrapping around; Overview and the Workbench are skipped.",
  when: (ctx) => neighbourDemo(ctx.data.links, step) !== null,
  run: (ctx) => {
    const link = neighbourDemo(ctx.data.links, step);
    if (!link) throw new Error("This page is not in the top bar, so it has no next or previous demo.");
    ctx.actions.go(link.path);
  } });

export default definePack({
  id: "chrome-navigation",
  surface: "chrome",
  title: "Every page: navigation and shortcut lists",
  about: "Page-wide palette commands that open each Workbench tab from any page, step to the next or previous demo in top-bar order, and copy, download or count the keyboard shortcuts and palette commands, plus Markdown links to this page and to every page. They hold only page paths, labels, the page address and command titles with their shortcuts.",
  features: [
    ...WORKBENCH_TABS.map(openTab),
    stepDemo("next_demo", 1, "Go to the next demo in the top bar"),
    stepDemo("previous_demo", -1, "Go to the previous demo in the top bar"),

    { id: "copy_shortcuts_text", kind: "command", group: "Help", title: "Copy the keyboard shortcut list as text",
      help: "Tab-separated: shortcut, action and group for every row of the keyboard help, as this keyboard names the keys.",
      run: (ctx) => ctx.env.copy(shortcutsText(ctx)) },
    { id: "copy_shortcuts_markdown", kind: "command", group: "Help", title: "Copy the keyboard shortcut list as Markdown",
      help: "A Markdown table of every row of the keyboard help.", run: (ctx) => ctx.env.copy(shortcutsMarkdown(ctx)) },
    { id: "copy_keyed_shortcuts", kind: "command", group: "Help", title: "Copy only the shortcuts that have a key",
      help: "One line per shortcut (the built-in ones and commands with a key); palette-only commands are left out.",
      run: (ctx) => {
        const rows = ctx.data.shortcuts.filter((row) => row.keys);
        ctx.env.copy(rows.map((row) => `${keysLabel(row.keys, ctx.data.mac)}\t${flat(row.title)}`).join("\n") + "\n");
      } },
    { id: "copy_palette_only", kind: "command", group: "Help", title: "Copy the commands that have no shortcut",
      help: "Titles of the commands you can reach only from the palette, one per line.",
      when: (ctx) => ctx.data.commands.some((row) => !row.keys),
      run: (ctx) => ctx.env.copy(ctx.data.commands.filter((row) => !row.keys).map((row) => flat(row.title)).join("\n") + "\n") },
    { id: "count_commands", kind: "command", group: "Help", title: "Count the commands on this page",
      run: (ctx) => {
        const rows = ctx.data.commands;
        const wide = rows.filter((row) => row.surface === PAGE_WIDE).length;
        const keyed = rows.filter((row) => row.keys).length;
        const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
        ctx.env.toast(`${plural(rows.length, "command")} on this page: ${wide} page-wide and ${rows.length - wide} from this page's own tools; `
          + `${keyed} ${keyed === 1 ? "has" : "have"} a shortcut.`);
      } },
    { id: "count_by_group", kind: "command", group: "Help", title: "Count the commands in each group",
      help: "Groups in palette order; commands without a group count as Other.",
      when: (ctx) => ctx.data.commands.length > 0,
      run: (ctx) => {
        const counts = new Map();
        for (const row of ctx.data.commands) {
          const name = row.group ? flat(row.group) : "Other";
          counts.set(name, (counts.get(name) || 0) + 1);
        }
        ctx.env.toast(`Commands by group: ${[...counts].map(([name, n]) => `${name} ${n}`).join(", ")}.`);
      } },
    { id: "copy_page_commands", kind: "command", group: "Help", title: "Copy this page's own commands (not the page-wide ones)",
      help: "Titles of the commands this page's tools add, with their shortcuts, one per line.",
      when: (ctx) => ctx.data.commands.some((row) => row.surface !== PAGE_WIDE),
      run: (ctx) => ctx.env.copy(ctx.data.commands.filter((row) => row.surface !== PAGE_WIDE).map((row) => withKeys(ctx, row)).join("\n") + "\n") },
    { id: "copy_commands_grouped", kind: "command", group: "Help", title: "Copy the palette commands grouped as Markdown",
      help: "A heading per group and a bullet per command, with its shortcut where it has one.",
      when: (ctx) => ctx.data.commands.length > 0, run: (ctx) => ctx.env.copy(commandsByGroup(ctx)) },
    { id: "download_commands_csv", kind: "command", group: "Help", title: "Download the palette commands as CSV",
      help: "Columns: command, shortcut (as written in the pack, Mod meaning Ctrl or Cmd), group, surface and id; spreadsheet formulas are escaped.",
      when: (ctx) => ctx.data.commands.length > 0,
      run: (ctx) => {
        const rows = ctx.data.commands.map((row) => [row.title, row.keys || "", row.group || "", row.surface || "", row.key || ""]);
        ctx.env.download(`jev-lab-commands-${pageSlug(ctx.data.path)}.csv`, csvText([["command", "shortcut", "group", "surface", "id"], ...rows]), "text/csv");
      } },

    { id: "where_am_i", kind: "command", group: "Page", title: "Say which page this is and where it sits in the top bar",
      run: (ctx) => {
        const links = ctx.data.links;
        const at = links.findIndex((link) => link.current);
        ctx.env.toast(at < 0 ? `This page (${ctx.data.path}) is not in the top bar.` : `${links[at].label}: page ${at + 1} of ${links.length} in the top bar.`);
      } },
    { id: "copy_markdown_link", kind: "command", group: "Page", title: "Copy a Markdown link to this page",
      help: "[Page name](address), with the address as the browser shows it (hash kept).",
      when: (ctx) => ctx.data.url !== null,
      run: (ctx) => {
        if (!ctx.data.url) throw new Error("This page has no link to copy.");
        ctx.env.copy(`[${linkText(`Jev Lab ${pageName(ctx)}`)}](${linkUrl(ctx.data.url)})`);
      } },
    { id: "copy_link_without_hash", kind: "command", group: "Page", title: "Copy this page's link without the #tab part",
      when: (ctx) => typeof ctx.data.url === "string" && ctx.data.url.includes("#"),
      run: (ctx) => {
        const url = ctx.data.url;
        if (!url || !url.includes("#")) throw new Error("This page's link has no # part to leave out.");
        ctx.env.copy(url.slice(0, url.indexOf("#")));
      } },
    { id: "copy_bar_links", kind: "command", group: "Page", title: "Copy links to every page as a Markdown list",
      help: "The ten top-bar pages in bar order, each a full link on this server.",
      when: (ctx) => origin(ctx.data.url) !== null,
      run: (ctx) => {
        const base = origin(ctx.data.url);
        if (!base) throw new Error("This page has no address to build links from.");
        ctx.env.copy(ctx.data.links.map((link) => `- [${linkText(link.label)}](${linkUrl(base + link.path)})`).join("\n") + "\n");
      } },
  ],
});
