// Lab in the browser: the env that packs render and act through, text downloads, the command palette with its
// shortcuts, the keyboard help, and the page-wide "chrome" surface (static/js/lab/surfaces/chrome.js). Pages call
// installLab(LAB) once, right after initChrome() has drawn the top bar. Nothing here stores anything or calls the
// server. The palette and the keyboard help are layers of common.js (openLayer): Escape closes the newest overlay
// only, and closing one gives focus back to whatever had it when it opened.
import { $, copyText, currentStatus, focusMain, h, icon, mount, openLayer, openLayers, openSettings, setTheme, systemPrefersLight,
  themePreference, toast, trapTab } from "../common.js";
import { commandRows, keyboardHelp, keysLabel } from "../chrome.js";
import { keysMatch } from "./kit.js";
import { chromeCtx } from "./surfaces/chrome.js";
import { renderPalette } from "./ui.js";

// Save text as a file from this browser. The object URL is released after the click.
export function downloadText(filename, text, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = h("a", { href: url, download: filename, style: { display: "none" } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const labEnv = { h, mount, toast, copy: copyText, download: downloadText };

const isMac = () => {
  try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ""); } catch { return false; }
};

let installed = null;

// The keyboard help dialog: the built-in shortcuts and every mounted command, with its shortcut when it has one.
// Returns its close function; a second call while it is open does nothing.
function helpDialog(lab) {
  let release = null;
  let wrap = null;
  const close = () => {
    if (!wrap) return;
    wrap.remove();
    wrap = null;
    const done = release;
    release = null;
    done?.();
  };
  const open = () => {
    if (wrap) return;
    const mac = isMac();
    const rows = keyboardHelp(commandRows(lab));
    const closeBtn = h("button", { class: "btn ghost sm", type: "button", onclick: () => close() }, "Close");
    wrap = h("div", { class: "modal-wrap", "data-lab-help": "", onclick: (event) => { if (event.target === wrap) close(); }, onkeydown: (event) => trapTab(event, wrap) },
      h("div", { class: "panel lab-help", role: "dialog", "aria-modal": "true", "aria-labelledby": "lab-help-title" },
        h("div", { class: "panel-head" }, icon("list"), h("h3", { id: "lab-help-title" }, "Keyboard shortcuts"), h("div", { class: "spacer" }), closeBtn),
        h("div", { class: "panel-body grid", style: { gap: "10px" } },
          h("p", { class: "faint" }, "Commands without a shortcut run from the command palette. Shortcuts without Ctrl, Cmd or Alt are ignored while you type."),
          h("div", { class: "scroll" }, h("table", { class: "table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Keys"), h("th", {}, "Does"), h("th", {}, "Where"))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-lab-command": row.key || null },
              h("td", {}, row.keys ? h("kbd", {}, keysLabel(row.keys, mac)) : h("span", { class: "faint" }, "Palette")),
              h("td", {}, row.title),
              h("td", { class: "faint" }, row.group || "")))))))));
    release = openLayer("help", close);
    document.body.append(wrap);
    closeBtn.focus();
  };
  return { open, close, isOpen: () => !!wrap };
}

// Adds the Commands button to the top bar, opens the palette on Ctrl/Cmd+K, routes other shortcuts to the commands
// of the surfaces that are mounted, and mounts the page-wide "chrome" surface. `chrome` may add data and actions to
// it under names the contract does not already use.
export function installLab(lab, chrome = {}) {
  if (installed) return installed;
  let palette = null;
  let release = null;
  const close = () => {
    if (!palette) return;
    palette.node.remove();
    palette = null;
    const done = release;
    release = null;
    done?.();  // focus goes back to what had it when the palette opened
  };
  const open = () => {
    if (palette) return;
    palette = renderPalette(labEnv, lab, close);
    palette.node.addEventListener("keydown", (event) => trapTab(event, palette.node));
    release = openLayer("palette", close);
    document.body.append(palette.node);
    palette.input.focus();
  };
  const help = helpDialog(lab);
  const ctx = chromeCtx({
    path: () => location.pathname,
    url: () => location.href,
    status: () => currentStatus(),
    theme: () => themePreference(),
    systemLight: () => systemPrefersLight(),
    layers: () => openLayers(),
    commands: () => commandRows(lab),
    mac: () => isMac(),
    go: (path) => { location.href = path; },
    openSettings: () => openSettings(),
    openPalette: open,
    setTheme: (preference) => setTheme(preference),
    copy: (text) => copyText(text),
    openHelp: () => help.open(),
    focusMain: () => focusMain(),
    openOfficial: (url) => { window.open(url, "_blank", "noopener"); },
  });
  for (const [name, value] of Object.entries(chrome.data || {})) if (!(name in ctx.data)) ctx.data[name] = value;
  for (const [name, value] of Object.entries(chrome.actions || {})) if (!(name in ctx.actions) && typeof value === "function") ctx.actions[name] = value;
  ctx.env = labEnv;
  lab.mount("chrome", ctx);
  document.addEventListener("keydown", (event) => {
    if (keysMatch(event, "Mod+K")) {
      event.preventDefault();
      if (palette) close(); else open();
      return;
    }
    // While a dialog, the drawer, the palette or the help is open, shortcuts would act on the page behind it.
    if (palette || openLayers().length || event.defaultPrevented) return;
    if (lab.handleKey(event, (error) => toast(error.message, "error"))) event.preventDefault();
  });
  $(".topbar .spacer")?.after(h("button", { class: "btn sm ghost lab-palette-button", title: "Command palette (Ctrl or Cmd + K)",
    "aria-haspopup": "dialog", onclick: open }, icon("search"), "Commands"));
  installed = { open, close, help, ctx, lab };
  return installed;
}
