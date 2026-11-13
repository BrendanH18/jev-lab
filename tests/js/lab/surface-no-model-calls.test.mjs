// Lab's promise: no Lab tool calls the model or spends budget, not even by pressing a page's own Run button. Every
// surface's actions are the only way a pack reaches its page, so this checks every fixture ctx (built by the real
// builders) for an action named like a model call, and every builder source for a paid endpoint.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures");
const SURFACES = join(here, "../../../static/js/lab/surfaces");

// Action names that would press a paid button or ask the model: the actions removed from the surfaces (Build's,
// Compare's and Autopilot's run, the checks list's run(id), the saved tests' run(ids), Autopilot's step and its
// benchmark, Dispatch's preview and useExample) and the names a page's own model-calling operation goes by.
const MODEL_CALLING = Object.freeze([
  "run", "runAll", "runSelected", "runShown", "runCheck", "runTests", "runCompare", "runBulk", "runDrift", "runUpgrade",
  "retry", "retryBulk", "step", "ask", "askAll", "preview", "useExample", "screen", "scan", "scanAll", "process",
  "processAll", "benchmark", "send", "sendTurn", "search", "check", "triage", "drift", "upgrade",
]);
// Local actions that share a name with the list above, each checked by hand to make no model call.
const ALLOWED = Object.freeze({
  // The page's restore preview of a saved dataset revision (counts and configuration changes, no model call).
  sampleDatasetsHistoryCtx: ["preview"],
});

// The endpoints of the pages' model-calling and paid operations (plus /api/play/new, which starts a game: a builder
// has no reason to name it either). A path is matched whole, so the plain-code ones that share a prefix
// (/api/shield/rescore, /api/dispatch/replan, /api/workbench/compare/score, ...) are not caught.
const PAID_ENDPOINTS = Object.freeze([
  "/api/hello", "/api/shield", "/api/shield/batch", "/api/dispatch", "/api/claims/check", "/api/reviews/check",
  "/api/counter/turn", "/api/find", "/api/play/ask", "/api/play/new", "/api/autopilot/process", "/api/autopilot/benchmark",
  "/api/workbench/run", "/api/workbench/items/run", "/api/workbench/bulk", "/api/workbench/compare",
  "/api/workbench/checks/run", "/api/workbench/checks/drift", "/api/workbench/checks/upgrade",
]);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (source, endpoint) => new RegExp(`${escape(endpoint)}(?![\\w/-])`).test(source);

const fixtureFiles = readdirSync(FIXTURES).filter((name) => name.endsWith(".mjs")).sort();

test("the denylist leaves the surfaces' local actions alone", () => {
  for (const name of ["select", "setPolicy", "setWeights", "draftCommand", "replan", "pickTool", "runPlan", "reset", "inspect", "compare",
    "checkHealth", "checkPreflight", "checkQuestions", "checkUnseen", "checkGates", "prepare", "newGame"]) {
    assert.equal(MODEL_CALLING.includes(name), false, `${name} is a local action`);
  }
  assert.equal(mentions("POST /api/shield/rescore re-decides", "/api/shield"), false);
  assert.equal(mentions("POST /api/dispatch/replan", "/api/dispatch"), false);
  assert.equal(mentions("(/api/workbench/compare/score and /slices)", "/api/workbench/compare"), false);
  assert.equal(mentions("an /api/shield response", "/api/shield"), true);
  assert.equal(mentions("POST /api/dispatch, one call", "/api/dispatch"), true);
});

test("no fixture ctx offers an action that calls the model", async () => {
  let checked = 0;
  for (const file of fixtureFiles) {
    const mod = await import(pathToFileURL(join(FIXTURES, file)).href);
    for (const [exported, make] of Object.entries(mod)) {
      if (!/^sample\w*Ctx$/.test(exported) || typeof make !== "function") continue;
      const ctx = make();
      assert.ok(ctx && ctx.actions && typeof ctx.actions === "object", `${file} ${exported}() builds a ctx with actions`);
      const allowed = ALLOWED[exported] || [];
      const offending = Object.keys(ctx.actions).filter((name) => MODEL_CALLING.includes(name) && !allowed.includes(name));
      assert.deepEqual(offending, [], `${file} ${exported}(): actions that would call the model`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `every fixture ctx was checked (${checked})`);
});

test("no surface builder mentions a paid endpoint", () => {
  const files = readdirSync(SURFACES).filter((name) => name.endsWith(".js")).sort();
  assert.ok(files.length >= 19);
  for (const file of files) {
    const source = readFileSync(join(SURFACES, file), "utf8");
    const found = PAID_ENDPOINTS.filter((endpoint) => mentions(source, endpoint));
    assert.deepEqual(found, [], `${file} mentions a paid endpoint`);
  }
});
