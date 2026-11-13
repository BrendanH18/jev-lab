// Lab in the browser: the env that packs render and act through, text downloads, and the command palette with its
// shortcuts. Pages call installLab(LAB) once after initChrome(). Nothing here stores anything or calls the server.
import { $, copyText, h, icon, mount, openSettings, toast } from "../common.js";
import { keysMatch } from "./kit.js";
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

let installed = null;

// Adds the Commands button to the top bar, opens the palette on Ctrl/Cmd+K, and routes other shortcuts to the
// commands of the surfaces that are mounted. `chrome` adds data and actions to the page-wide "chrome" surface.
export function installLab(lab, chrome = {}) {
  if (installed) return installed;
  let palette = null;
  let returnFocus = null;
  const close = () => {
    if (!palette) return;
    palette.node.remove();
    palette = null;
    returnFocus?.focus?.();
    returnFocus = null;
  };
  const open = () => {
    if (palette) return;
    returnFocus = document.activeElement;
    palette = renderPalette(labEnv, lab, close);
    document.body.append(palette.node);
    palette.input.focus();
  };
  lab.mount("chrome", {
    env: labEnv,
    items: () => [], shown: () => [],
    data: { path: location.pathname, ...(chrome.data || {}) },
    actions: { go: (path) => { location.href = path; }, openSettings: () => openSettings(), openPalette: open, ...(chrome.actions || {}) },
    refresh: () => {},
  });
  document.addEventListener("keydown", (event) => {
    if (keysMatch(event, "Mod+K")) {
      event.preventDefault();
      if (palette) close(); else open();
      return;
    }
    if (palette || event.defaultPrevented) return;
    if (lab.handleKey(event, (error) => toast(error.message, "error"))) event.preventDefault();
  });
  $(".topbar .spacer")?.after(h("button", { class: "btn sm ghost lab-palette-button", title: "Command palette (Ctrl or Cmd + K)",
    "aria-haspopup": "dialog", onclick: open }, icon("search"), "Commands"));
  installed = { open, close, lab };
  return installed;
}
