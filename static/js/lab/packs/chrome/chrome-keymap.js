// Chrome keymap: page-wide palette commands that download the keyboard map, check the palette's commands and
// shortcuts for accessibility problems (shared chords, single-character shortcuts, duplicate or very long titles,
// commands without a group), list the Alt+Shift letters still free, say which overlays are open, give two labeled
// estimates of what the budget left would buy, and copy or download page links. Everything comes from ctx.data;
// nothing reads storage, calls the server or shows an answer, and no command has a shortcut of its own.
import { csvText, definePack, parseKeys } from "../../kit.js";

const NOT_DEMOS = new Set(["/", "/workbench"]);
const LONG_TITLE = 80;
// Chords the page reserves for itself (static/js/chrome.js BUILT_IN_SHORTCUTS); Tab is listed twice there on purpose.
const RESERVED = [["Mod+K", "Open or close the command palette"], ["Escape", "Close the newest dialog, drawer or palette"]];

const flat = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

export function keysLabel(keys, mac) {
  if (typeof keys !== "string" || !keys) return "";
  return keys.split("+").map((part) => (part === "Mod" ? (mac ? "Cmd" : "Ctrl") : part === "Meta" ? (mac ? "Cmd" : "Meta") : part)).join(" + ");
}

export function pageSlug(path) {
  const text = String(path || "/").replace(/^\/+/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return text || "overview";
}

// One chord as the keyboard sees it: Mod is Cmd (Meta) on a Mac and Ctrl elsewhere. null when keys is not a chord.
export function chordId(keys, mac) {
  const chord = parseKeys(keys);
  if (!chord) return null;
  const ctrl = chord.ctrl || (chord.mod && !mac), meta = chord.meta || (chord.mod && mac);
  return [ctrl && "Ctrl", meta && "Meta", chord.alt && "Alt", chord.shift && "Shift", chord.key].filter(Boolean).join("+");
}

// Groups of two or more entries (commands with a shortcut plus the reserved chords) that press the same chord.
export function clashes(ctx) {
  const mac = ctx.data.mac;
  const byChord = new Map();
  const add = (keys, title) => {
    const id = chordId(keys, mac);
    if (!id) return;
    if (!byChord.has(id)) byChord.set(id, { keys, titles: [] });
    byChord.get(id).titles.push(flat(title));
  };
  for (const [keys, title] of RESERVED) add(keys, title);
  for (const row of ctx.data.commands) if (row.keys) add(row.keys, row.title);
  return [...byChord.values()].filter((entry) => entry.titles.length > 1);
}

// Commands whose shortcut is one character key with no Ctrl, Cmd or Alt (Shift allowed): WCAG 2.1.4 asks that such
// shortcuts can be turned off or remapped, because speech input can press them by accident.
export const singleKeys = (ctx) => ctx.data.commands.filter((row) => {
  const chord = row.keys && parseKeys(row.keys);
  return chord && chord.bare && chord.key.length === 1;
});

export function duplicateTitles(ctx) {
  const counts = new Map();
  for (const row of ctx.data.commands) {
    const title = flat(row.title).toLowerCase();
    counts.set(title, (counts.get(title) || { title: flat(row.title), count: 0 }));
    counts.get(title).count++;
  }
  return [...counts.values()].filter((entry) => entry.count > 1);
}

export const longTitles = (ctx) => ctx.data.commands.filter((row) => flat(row.title).length > LONG_TITLE);
export const ungrouped = (ctx) => ctx.data.commands.filter((row) => !row.group);

// Letters a to z that no command uses with exactly Alt+Shift (the chord most page packs pick).
export function freeAltShiftLetters(ctx) {
  const taken = new Set();
  for (const row of ctx.data.commands) {
    const chord = row.keys && parseKeys(row.keys);
    if (chord && chord.alt && chord.shift && !chord.mod && !chord.ctrl && !chord.meta && /^[a-z]$/.test(chord.key)) taken.add(chord.key);
  }
  return [..."abcdefghijklmnopqrstuvwxyz"].filter((letter) => !taken.has(letter));
}

const demos = (ctx) => ctx.data.links.filter((link) => !NOT_DEMOS.has(link.path));
const goDemo = (id, title, pick) => ({ id, kind: "command", group: "Go to", title,
  help: "Demos are the top-bar pages from Shield to Counter; Overview and the Workbench are not demos.",
  when: (ctx) => { const link = pick(demos(ctx)); return !!link && !link.current; },
  run: (ctx) => {
    const link = pick(demos(ctx));
    if (!link) throw new Error("The top bar has no demos.");
    if (link.current) throw new Error(`This is already ${link.label}.`);
    ctx.actions.go(link.path);
  } });

const spendOf = (ctx) => (ctx.data.status.loaded ? ctx.data.status.spend : null);
// Measured spend per finished live call, or null without a finished call.
function averageCost(spend) {
  if (!spend || !isNumber(spend.live_calls) || spend.live_calls <= 0 || !isNumber(spend.spent_usd)) return null;
  return spend.spent_usd / spend.live_calls;
}
const remaining = (ctx) => { const spend = spendOf(ctx); return spend && isNumber(spend.remaining_usd) ? spend.remaining_usd : null; };

// A price with at least two decimals: 0.5 -> "0.50", 0.042 -> "0.042".
const priceText = (price) => (Number(price.toFixed(2)) === price ? price.toFixed(2) : String(price));
const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pageName = (ctx) => (ctx.data.page ? ctx.data.page.label : ctx.data.path);

function report(ctx, found, ok, describe) {
  if (!found.length) ctx.env.toast(ok);
  else ctx.env.toast(describe(found), "error");
}

export default definePack({
  id: "chrome-keymap",
  surface: "chrome",
  title: "Every page: keyboard map, palette checks and link exports",
  about: "Page-wide palette commands that download the keyboard map as JSON, check the palette for shortcuts that clash or are a single character key, duplicate, very long or ungrouped command titles, count shortcuts by modifier, list free Alt+Shift letters, say which overlays are open, estimate (labeled as estimates) the calls and input tokens the budget left would buy, and copy or download page links. They hold only command titles and shortcuts, page paths and labels, and the allow-listed status.",
  features: [
    { id: "download_keymap_json", kind: "command", group: "Help", title: "Download the keyboard map as JSON",
      help: "Every row of the keyboard help: the shortcut as written (Mod meaning Ctrl or Cmd), as this keyboard names it, the action and its group. Palette-only commands have a null shortcut.",
      run: (ctx) => {
        const rows = ctx.data.shortcuts.map((row) => ({ keys: row.keys, label: row.keys ? keysLabel(row.keys, ctx.data.mac) : null, title: flat(row.title), group: row.group }));
        ctx.env.download(`jev-lab-keyboard-${pageSlug(ctx.data.path)}.json`, `${JSON.stringify({ page: ctx.data.path, shortcuts: rows }, null, 2)}\n`, "application/json");
      } },
    { id: "check_shortcut_clashes", kind: "command", group: "Accessibility", title: "Check the shortcuts on this page for clashes",
      help: "Two commands, or a command and Ctrl/Cmd+K or Escape, that press the same keys: only one of them can work.",
      run: (ctx) => report(ctx, clashes(ctx), "No two shortcuts on this page press the same keys.",
        (found) => `${plural(found.length, "shortcut")} shared: ${found.map((entry) => `${keysLabel(entry.keys, ctx.data.mac)} by ${entry.titles.join(" and ")}`).join("; ")}.`) },
    { id: "check_single_keys", kind: "command", group: "Accessibility", title: "Check for single-character shortcuts",
      help: "Shortcuts that are one letter, digit or symbol without Ctrl, Cmd or Alt. Speech input can press them by accident (WCAG 2.1.4). Advisory.",
      run: (ctx) => {
        const found = singleKeys(ctx);
        ctx.env.toast(found.length
          ? `${plural(found.length, "shortcut")} ${found.length === 1 ? "is a" : "are"} single character ${found.length === 1 ? "key" : "keys"} without Ctrl, Cmd or Alt: ${found.map((row) => `${row.keys} (${flat(row.title)})`).join(", ")}. Speech input can press these by accident.`
          : "No shortcut on this page is a single character key.");
      } },
    { id: "check_duplicate_titles", kind: "command", group: "Accessibility", title: "Check for palette commands with the same title",
      help: "Two commands with the same title (ignoring case) read the same to a screen reader and in the palette.",
      run: (ctx) => report(ctx, duplicateTitles(ctx), "Every palette command on this page has its own title.",
        (found) => `Titles used more than once: ${found.map((entry) => `${entry.title} (${entry.count}×)`).join(", ")}.`) },
    { id: "check_long_titles", kind: "command", group: "Accessibility", title: `Check for command titles longer than ${LONG_TITLE} characters`,
      run: (ctx) => {
        const found = longTitles(ctx);
        ctx.env.toast(found.length ? `${plural(found.length, "command title")} over ${LONG_TITLE} characters; the longest has ${Math.max(...found.map((row) => flat(row.title).length))}.`
          : `No command title is longer than ${LONG_TITLE} characters.`);
      } },
    { id: "check_ungrouped", kind: "command", group: "Accessibility", title: "Check for palette commands without a group",
      run: (ctx) => {
        const found = ungrouped(ctx);
        ctx.env.toast(found.length ? `${plural(found.length, "command")} without a group: ${found.map((row) => flat(row.title)).join(", ")}.` : "Every palette command on this page has a group.");
      } },
    { id: "run_palette_checks", kind: "command", group: "Accessibility", title: "Run every palette check and sum up the findings",
      help: "Shared shortcuts, single-character shortcuts, duplicate titles, long titles and commands without a group, counted in one line.",
      run: (ctx) => {
        const parts = [[clashes(ctx).length, "shared shortcut"], [singleKeys(ctx).length, "single-character shortcut"],
          [duplicateTitles(ctx).length, "duplicate title"], [longTitles(ctx).length, "long title"], [ungrouped(ctx).length, "command without a group"]];
        const found = parts.filter(([count]) => count > 0);
        ctx.env.toast(found.length ? `Palette checks on ${plural(ctx.data.commands.length, "command")}: ${found.map(([count, word]) => plural(count, word, word === "command without a group" ? "commands without a group" : `${word}s`)).join(", ")}.`
          : `Palette checks on ${plural(ctx.data.commands.length, "command")}: nothing found.`, clashes(ctx).length ? "error" : "");
      } },
    { id: "count_by_modifier", kind: "command", group: "Help", title: "Count the shortcuts by modifier key",
      help: "Commands with a shortcut, counted by Ctrl/Cmd, Alt and Shift (one shortcut can count under several) and by no modifier.",
      when: (ctx) => ctx.data.commands.some((row) => row.keys),
      run: (ctx) => {
        const chords = ctx.data.commands.map((row) => row.keys && parseKeys(row.keys)).filter(Boolean);
        const mod = chords.filter((chord) => chord.mod || chord.ctrl || chord.meta).length;
        const alt = chords.filter((chord) => chord.alt).length, shift = chords.filter((chord) => chord.shift).length;
        const none = chords.filter((chord) => !chord.mod && !chord.ctrl && !chord.meta && !chord.alt && !chord.shift).length;
        ctx.env.toast(`${plural(chords.length, "shortcut")}: ${mod} with ${ctx.data.mac ? "Cmd" : "Ctrl"}, ${alt} with Alt, ${shift} with Shift, ${none} with no modifier.`);
      } },
    { id: "copy_free_alt_shift", kind: "command", group: "Help", title: "Copy the Alt+Shift letters no command on this page uses",
      help: "Letters a to z that are still free as Alt+Shift shortcuts here, for people writing a pack.",
      run: (ctx) => {
        const free = freeAltShiftLetters(ctx);
        if (!free.length) throw new Error("Every Alt+Shift letter is taken on this page.");
        ctx.env.copy(`${free.map((letter) => `Alt+Shift+${letter.toUpperCase()}`).join("\n")}\n`);
      } },
    { id: "show_overlays", kind: "command", group: "Page", title: "Say which dialogs and drawers are open",
      help: "Oldest first; Escape closes the newest.",
      run: (ctx) => {
        const names = { settings: "API key and safety settings", inspector: "request inspector", palette: "command palette", help: "keyboard help" };
        const layers = ctx.data.layers;
        ctx.env.toast(layers.length ? `Open, oldest first: ${layers.map((name) => names[name] || name).join(", ")}. Escape closes the ${names[layers[layers.length - 1]] || layers[layers.length - 1]}.`
          : "No dialog, drawer or palette is open.");
      } },
    { id: "estimate_calls_left", kind: "command", group: "Spend", title: "Estimate how many more calls the budget left allows at this run's average",
      help: "Budget left divided by the measured cost per finished call so far, rounded down. An estimate: calls differ in size.",
      when: (ctx) => remaining(ctx) !== null && averageCost(spendOf(ctx)) > 0,
      run: (ctx) => {
        const left = remaining(ctx), average = averageCost(spendOf(ctx));
        if (left === null || !(average > 0)) throw new Error("This needs a budget and at least one finished call with a cost.");
        const calls = Math.floor(Number((left / average).toPrecision(12)));
        ctx.env.toast(`Estimate: about ${calls.toLocaleString("en-US")} more ${calls === 1 ? "call" : "calls"} like this run's average fit in the budget left. Not measured spend.`);
      } },
    { id: "estimate_tokens_left", kind: "command", group: "Spend", title: "Estimate the input tokens the budget left would buy at the model's price",
      help: "Budget left divided by the price per million input tokens (output tokens are free), rounded down. An estimate, not a reservation.",
      when: (ctx) => remaining(ctx) !== null && ctx.data.status.price_per_mtok_input > 0,
      run: (ctx) => {
        const left = remaining(ctx), price = ctx.data.status.price_per_mtok_input;
        if (left === null || !(price > 0)) throw new Error("This needs a budget and the model's price.");
        const tokens = Math.floor(Number(((left / price) * 1e6).toPrecision(12)));
        ctx.env.toast(`Estimate: the budget left buys about ${tokens.toLocaleString("en-US")} input tokens at $${priceText(price)} per million. Not measured spend.`);
      } },
    { id: "copy_html_link", kind: "command", group: "Page", title: "Copy an HTML link to this page",
      when: (ctx) => ctx.data.url !== null,
      run: (ctx) => {
        if (!ctx.data.url) throw new Error("This page has no link to copy.");
        ctx.env.copy(`<a href="${escapeHtml(ctx.data.url)}">${escapeHtml(`Jev Lab ${pageName(ctx)}`)}</a>`);
      } },
    { id: "copy_page_path", kind: "command", group: "Page", title: "Copy this page's path", help: "The path only, such as /shield: no server address, query or #tab part.",
      run: (ctx) => ctx.env.copy(ctx.data.path) },
    { id: "download_pages_csv", kind: "command", group: "Page", title: "Download the top-bar pages as CSV",
      help: "Columns: position, label, path, current (yes or no) and whether it is a demo.",
      run: (ctx) => ctx.env.download("jev-lab-pages.csv", csvText([["position", "label", "path", "current", "demo"],
        ...ctx.data.links.map((link, index) => [index + 1, link.label, link.path, link.current ? "yes" : "no", NOT_DEMOS.has(link.path) ? "no" : "yes"])]), "text/csv") },
    goDemo("go_first_demo", "Go to the first demo in the top bar", (list) => list[0] || null),
    goDemo("go_last_demo", "Go to the last demo in the top bar", (list) => list[list.length - 1] || null),
  ],
});
