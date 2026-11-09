// Run with: node --test tests/js/
// The Workbench page is split across static/js/workbench.js and the workbench-*.js panel modules, which import one
// another (they all call render() from the entry, so the imports form cycles). These checks keep that safe without
// a bundler: names stay unique, every import names a real export, no module uses another's name without importing
// it, and every module can be the first one evaluated without touching an import at load time. No browser needed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { JS_DIR, moduleSources, workbenchModules } from "./workbench-source.mjs";

const allModules = readdirSync(JS_DIR).filter((f) => f.endsWith(".js")).sort();
const sourceOf = Object.fromEntries(allModules.map((f) => [f, readFileSync(new URL(f, JS_DIR), "utf8")]));

// Code with comments and the text of strings, template literals and regular expressions blanked out; the ${...}
// expressions inside template literals are kept, since they are code.
function codeOnly(src) {
  let out = "";
  let i = 0;
  const stack = [];  // open template literals: brace depth of the ${ that entered code
  let depth = 0;
  let last = "";     // last significant character of code, to tell a regex from a division
  const regexCanFollow = (prefix) => !last || "(,=:[!&|?{};+-*%<>~^".includes(last) || /\b(return|typeof|case|in|of|delete|void|throw|new)\s*$/.test(prefix);
  const skipString = (q) => { i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } i++; out += " "; last = "a"; };
  const skipTemplateText = () => {  // from just after ` or } up to the closing ` or ${
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i++; out += " "; last = "a"; return; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; out += " "; stack.push(depth); depth++; last = "{"; return; }
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 2; out += " "; continue; }
    if (c === "'" || c === '"') { skipString(c); continue; }
    if (c === "`") { i++; skipTemplateText(); continue; }
    if (c === "/" && regexCanFollow(out.slice(-12))) {
      i++;
      let inClass = false;
      while (i < src.length && (src[i] !== "/" || inClass)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(src[i] || "")) i++;
      out += " ";
      last = "a";
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (stack.length && stack[stack.length - 1] === depth) { stack.pop(); i++; out += " "; skipTemplateText(); continue; }
    }
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}

// Imports as { from: "x.js", names: [[imported, local], ...] } for the page's relative module imports, read from the
// source with block comments removed (the specifier is a string, so codeOnly would blank it).
function importsOf(src) {
  return [...src.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+\.js)";/gm)].map(([, list, from]) => ({
    from, names: list.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(/\s+as\s+/); return [a, b || a]; }),
  }));
}

function exportsOf(src) {
  const names = new Set();
  for (const [, name] of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/gm)) names.add(name);
  for (const [, list] of src.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const s of list.split(",")) if (s.trim()) names.add(s.trim().split(/\s+as\s+/).pop());
  return names;
}

// Top-level declarations: the ones that start at the beginning of a line.
function topLevelNames(src) {
  return [...src.matchAll(/^(?:export\s+)?(?:(?:async\s+)?function\*?|const|let|var|class)\s+([\w$]+)/gm)].map((m) => m[1]);
}

test("every relative import names something its module exports", () => {
  for (const file of allModules) {
    for (const { from, names } of importsOf(sourceOf[file])) {
      assert.ok(sourceOf[from] !== undefined, `${file} imports ./${from}, which is not in static/js`);
      const exported = exportsOf(sourceOf[from]);
      for (const [name] of names) assert.ok(exported.has(name), `${file} imports ${name} from ./${from}, which does not export it`);
    }
  }
});

test("Workbench modules declare each top-level name once", () => {
  const seen = new Map();
  for (const file of workbenchModules) {
    for (const name of topLevelNames(moduleSources[file])) {
      assert.ok(!seen.has(name), `${name} is declared in both ${seen.get(name)} and ${file}`);
      seen.set(name, file);
    }
  }
});

// Identifiers used as values: not properties (.name) and not object keys ({ name: or , name:).
function usedNames(code) {
  const used = new Set();
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const before = code.slice(Math.max(0, m.index - 40), m.index).trimEnd();
    if (/[\w$]$/.test(code[m.index - 1] || "") || before.endsWith(".")) continue;
    const after = code.slice(m.index + m[0].length).trimStart();
    if (/[{,]$/.test(before) && after.startsWith(":")) continue;
    used.add(m[0]);
  }
  return used;
}

// Names a module binds inside its functions (declarations, destructuring, parameters, catch); a use of one of them
// may be a local, so the check below leaves those to the browser test rather than guessing.
function localNames(code) {
  const names = new Set();
  const add = (list) => { for (const [id] of list.replace(/=[^,]*/g, "").matchAll(/[A-Za-z_$][\w$]*/g)) names.add(id); };
  for (const [, id] of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(id);
  for (const [, list] of code.matchAll(/\b(?:const|let|var)\s*[{[]([^=]*?)[}\]]\s*=/g)) add(list);
  for (const [, list] of code.matchAll(/\bfunction\b[^(]*\(([^)]*)\)/g)) add(list);
  for (const [, list] of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(list);
  for (const [, id] of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(id);
  for (const [, id] of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(id);
  return names;
}

test("a Workbench module imports every name it uses from another Workbench module", () => {
  const owner = new Map();
  for (const file of workbenchModules) for (const name of topLevelNames(moduleSources[file])) owner.set(name, file);
  for (const file of workbenchModules) {
    const code = codeOnly(moduleSources[file]);
    const own = new Set(topLevelNames(moduleSources[file]));
    const used = usedNames(code);
    const locals = localNames(code);
    const imported = new Map(importsOf(moduleSources[file]).flatMap(({ from, names }) => names.map(([name, local]) => [local, [from, name]])));
    for (const [name, home] of owner) {
      if (home === file || own.has(name) || !used.has(name)) continue;
      if (locals.has(name) && !imported.has(name)) continue;
      assert.deepEqual(imported.get(name), [home, name], `${file} uses ${name} from ${home} without importing it`);
    }
  }
});

test("every Workbench module can load first without touching an import at load time", () => {
  // A small stand-in for the browser globals the page's modules reach for while booting; fetch never answers, so
  // boot() waits forever and the process exits once the modules have evaluated.
  const stub = `
    class El { constructor() { this.style = {}; } setAttribute() {} addEventListener() {} append() {} prepend() {}
      replaceChildren() {} querySelector() { return null; } querySelectorAll() { return []; } }
    globalThis.Node = El;
    globalThis.document = { body: new El(), createElement: () => new El(), createElementNS: () => new El(),
      createTextNode: () => new El(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
    globalThis.window = { addEventListener() {}, scrollTo() {} };
    globalThis.location = { hash: "", pathname: "/workbench" };
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    globalThis.fetch = () => new Promise(() => {});
  `;
  for (const file of workbenchModules) {
    const first = new URL(file, JS_DIR).href;
    const entry = new URL("workbench.js", JS_DIR).href;
    const script = `${stub}\nawait import(${JSON.stringify(first)});\nawait import(${JSON.stringify(entry)});\nconsole.log("loaded");`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: fileURLToPath(JS_DIR), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(out.trim(), "loaded", `${file} loaded first`);
  }
});
