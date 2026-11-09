// The Workbench page is static/js/workbench.js (the entry: state wiring, tabs, render) plus the static/js/workbench-*.js
// panel modules it imports. Tests that rebuild a named function from the page's source search all of them, so a
// function keeps its test when it moves between modules. Not a test file itself (no .test.mjs suffix).
import { readdirSync, readFileSync } from "node:fs";

export const JS_DIR = new URL("../../static/js/", import.meta.url);

// The entry and every workbench-*.js module, entry first.
export const workbenchModules = ["workbench.js",
  ...readdirSync(JS_DIR).filter((f) => /^workbench-[a-z-]+\.js$/.test(f)).sort()];

export const moduleSources = Object.fromEntries(workbenchModules.map((f) => [f, readFileSync(new URL(f, JS_DIR), "utf8")]));

// All Workbench module sources joined, for the tests' `function name(...) {...}` lookups.
export const workbenchSource = Object.values(moduleSources).join("\n");
