// Checks that hold for every Lab pack together (static/js/lab/packs/<page>/*.js): each is a valid pack named after
// its file, lives with its page, has its own checkPack test, reaches the page only through ctx, and the generated
// page indexes and inventory (scripts/lab_inventory.mjs) match the packs. Run with: node --test tests/js/lab/
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PAGES, ROOT, generate, loadJsPacks, staleFiles } from "../../../scripts/lab_inventory.mjs";
import { improvementsOf, parseKeys } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";

const loaded = await loadJsPacks();
const TESTS = join(ROOT, "tests/js/lab");
// What a pack may import: the kit and the shared pure libraries.
const ALLOWED_IMPORT = /^\.\.\/\.\.\/(?:kit\.js|lib\/[\w.-]+\.js)$/;
// A pack reaches the page, the clipboard and downloads through ctx; it never touches these itself.
const FORBIDDEN = /(?<![.\w$])(?:document|window|navigator|location|localStorage|sessionStorage|indexedDB|globalThis)\.[A-Za-z_$]|(?<![.\w$])(?:fetch|XMLHttpRequest|eval|importScripts|setInterval)\s*\(|\bnew\s+Function\b|\bimport\s*\(/;

test("every pack is a frozen definePack result named after its file, on a surface of its own page", () => {
  const ids = new Set();
  for (const { page, file, pack } of loaded) {
    assert.ok(pack && Object.isFrozen(pack), `${page}/${file} must default-export definePack({ ... })`);
    assert.equal(`${pack.id}.js`, file, `${page}/${file}: the pack id must be the file name`);
    assert.ok(!ids.has(pack.id), `pack id ${pack.id} is used twice`);
    ids.add(pack.id);
    const head = pack.surface.split(".")[0];
    assert.equal(head, page, `${page}/${file}: surface ${pack.surface} must start with its page, "${page}"`);
    assert.ok(page === "chrome" || PAGES.includes(page), `${page} is not a page`);
    if (page === "chrome") {
      assert.equal(pack.surface, "chrome");
      assert.ok(pack.features.every((feature) => feature.kind === "command" || feature.kind === "behavior"), `${file}: page-wide packs hold commands and behaviors only`);
    }
  }
});

test("improvement ids are unique across all packs and every one has a title", () => {
  const seen = new Map();
  for (const { pack } of loaded) {
    for (const item of improvementsOf(pack)) {
      assert.ok(!seen.has(item.id), `${item.id} is declared twice`);
      seen.set(item.id, pack.id);
      assert.ok(item.title.trim().length >= 8, `${item.id} needs a descriptive title`);
    }
  }
});

test("every pack has a test file that runs checkPack on it", () => {
  for (const { page, file, pack } of loaded) {
    const path = join(TESTS, `${pack.id}.test.mjs`);
    assert.ok(existsSync(path), `tests/js/lab/${pack.id}.test.mjs is missing`);
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(`packs/${page}/${file}`) && /\bcheckPack\(/.test(source), `tests/js/lab/${pack.id}.test.mjs must import the pack and call checkPack`);
  }
  const known = new Set(loaded.map(({ pack }) => `${pack.id}.test.mjs`));
  const framework = new Set(["kit.test.mjs", "registry.test.mjs"]);
  for (const name of readdirSync(TESTS).filter((entry) => entry.endsWith(".test.mjs"))) {
    assert.ok(known.has(name) || framework.has(name) || name.startsWith("lib-") || name.startsWith("surface-"), `tests/js/lab/${name} matches no pack`);
  }
});

// Source with comments removed and string/template text blanked; ${...} expressions inside template literals are kept,
// since they are code. A help text that mentions "document.md" or "location" is not a use of the browser global.
function codeOnly(src) {
  let out = "";
  let i = 0;
  const templates = [];  // brace depth at each open ${
  let depth = 0;
  const skipTemplate = () => {  // from just after ` or } up to the closing ` or ${
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i++; out += '""'; return; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; out += "("; templates.push(depth); depth++; return; }
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const end = src.indexOf("*/", i + 2); i = end < 0 ? src.length : end + 2; out += " "; continue; }
    if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c) { if (src[i] === "\\") i++; i++; } i++; out += '""'; continue; }
    if (c === "`") { i++; skipTemplate(); continue; }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (templates.length && templates[templates.length - 1] === depth) { templates.pop(); i++; out += ")"; skipTemplate(); continue; }
    }
    out += c;
    i++;
  }
  return out;
}

test("packs import only the kit and the shared libraries, and never touch the page, storage or network themselves", () => {
  for (const { page, file, path } of loaded) {
    const source = readFileSync(path, "utf8");
    // Static import statements only (a help text may well contain the word "from" followed by a quote).
    const imports = [...source.matchAll(/^\s*import\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/gm), ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)];
    for (const [, specifier] of imports) assert.match(specifier, ALLOWED_IMPORT, `${page}/${file} imports ${specifier}`);
    const statements = (source.match(/^\s*import\b/gm) || []).length;
    assert.equal(imports.length, statements, `${page}/${file}: every import statement must name a module the check can read`);
    const hit = codeOnly(source).match(FORBIDDEN);
    assert.equal(hit, null, `${page}/${file} uses ${hit?.[0]}: go through ctx instead`);
  }
});

test("each page's packs load together: no pack twice, and no two commands share a shortcut", () => {
  for (const page of PAGES) {
    const packs = loaded.filter((entry) => entry.page === page || entry.page === "chrome").map((entry) => entry.pack);
    createLab(packs);
    const chords = new Map();
    for (const pack of packs) {
      for (const feature of pack.features) {
        if (feature.kind !== "command" || !feature.keys) continue;
        const chord = parseKeys(feature.keys);
        assert.ok(chord, `${pack.id}/${feature.id}: ${feature.keys} is not a chord`);
        const key = JSON.stringify(chord);
        assert.ok(!chords.has(key), `${pack.id}/${feature.id} and ${chords.get(key)} share the shortcut ${feature.keys} on the ${page} page`);
        chords.set(key, `${pack.id}/${feature.id}`);
      }
    }
  }
});

test("the generated page indexes and inventory match the packs", async () => {
  const { files } = await generate();
  assert.deepEqual(staleFiles(files), [], "run: node scripts/lab_inventory.mjs");
});

test("the page-access scan reads code only: strings and comments are ignored, template expressions are not", () => {
  const caught = (src) => FORBIDDEN.test(codeOnly(src));
  assert.equal(caught('const name = "find-document.md"; // location.href in a comment'), false);
  assert.equal(caught("const help = 'Uses window.open when you click';"), false);
  assert.equal(caught("/* document.title */ const a = 1;"), false);
  assert.equal(caught("const t = `Saved to ${'document.md'}`;"), false);
  assert.equal(caught("const title = document.title;"), true);
  assert.equal(caught("const t = `Page ${location.href} now`;"), true);
  assert.equal(caught("run: () => fetch('/api/x')"), true);
  assert.equal(caught("const store = localStorage.getItem('k');"), true);
  assert.equal(caught("const a = `x ${`y ${window.name}`}`;"), true);
  assert.equal(caught("const tagged = state.document; tagged.split('\\n');"), false);
});
