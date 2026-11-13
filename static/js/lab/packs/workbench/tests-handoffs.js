// Reports, handoffs, selection planning and navigation for the Workbench Tests tab ("workbench.tests.items"; contract in
// static/js/lab/surfaces/workbench-tests.js). Exports state their boundary in their label and help: the CI reports (JUnit,
// TAP), the per-question, measurement, coverage, inventory and failure tables and the summary hold IDs, statuses, types,
// expectation kinds, counts and measurements only; one separately named export holds the server's check and error text.
// Requests and traces are not exported (the surface contract). Selection commands
// and the planner change the selection only, through the page's own select action with its one-step Undo, and nothing
// here starts a paid run. Panels show the shown tests by question ID, a question inventory, a planner and a comparison
// of two saved tests, in the page only.
import { compareText, csvText, definePack, toNumber } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { sampleIndexes } from "../../lib/math.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const TYPES = ["noul", "choice", "score", "box"];
const SAVED_ID = /^[a-z0-9-]{1,60}$/;
const STORED_PICTURE = /^[0-9a-f]{16}\.(?:png|jpg)$/;
const SUITE = "Jev saved tests";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const listOf = (value) => (Array.isArray(value) ? value.filter((item) => isObject(item) && typeof item.id === "string") : []);
const shownOf = (ctx) => listOf(typeof ctx?.shown === "function" ? ctx.shown() : []);
const itemsOf = (ctx) => listOf(typeof ctx?.items === "function" ? ctx.items() : []);
const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter(isObject) : []);
const criteriaOf = (question) => (Array.isArray(question.criteria) ? question.criteria.filter(isObject) : []);
const imagesOf = (item) => (Array.isArray(item?.images) ? item.images.filter(isObject) : []);
const statusOf = (item) => (["pass", "fail", "error"].includes(item?.status) ? item.status : "not-run");
const answered = (item) => !!item?.result && !item.result.error;
const checksOf = (item) => (answered(item) && Array.isArray(item.result.checks) ? item.result.checks.filter(isObject) : []);
const metaOf = (item) => (answered(item) && isObject(item.result.meta) ? item.result.meta : null);
const failedIds = (item) => checksOf(item).filter((check) => check.ok === false).map((check) => check.id);
const words = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const blank = (value) => (value === null || value === undefined ? "" : String(value));
const usd = (value) => `$${Number(value.toPrecision(6))}`;
const toast = (ctx, message, kind) => ctx?.env?.toast?.(message, kind);
const UNDO = "Undo selection change restores the previous selection.";

// The expectation keys a run uses for a question of this type (jev/workbench.py check_expectation).
function usedKeys(question) {
  const expect = question.expect;
  if (!isObject(expect)) return [];
  if (question.type === "choice") return ["choice", "min", "max"].filter((key) => has(expect, key));
  if (question.type === "noul" || question.type === "score") return ["min", "max"].filter((key) => has(expect, key));
  if (question.type === "box") return has(expect, "box") ? ["box", "iou_min"].filter((key) => has(expect, key)) : [];
  return [];
}

// A fixed vocabulary for what a question's expectation checks; never its values.
//   none     no expectation (or a falsy one)          empty    {}
//   ignored  keys the run does not use for this type  invalid  not an object (the run reports it as invalid)
//   option, bounds, option+bounds, box                the checks the run makes
function expectationKind(question) {
  const expect = question.expect;
  if (expect === null || expect === undefined || (!isObject(expect) && !expect)) return "none";
  if (!isObject(expect)) return "invalid";
  if (!Object.keys(expect).length) return "empty";
  const used = usedKeys(question);
  if (!used.length) return "ignored";
  return [used.includes("choice") ? "option" : null, used.includes("min") || used.includes("max") ? "bounds" : null, used.includes("box") ? "box" : null]
    .filter(Boolean).join("+");
}
const isChecked = (question) => !["none", "empty", "ignored"].includes(expectationKind(question));

// One question of one test in the latest run: pass, fail, unchecked, not run, error, or no check.
function verdict(item, id) {
  const status = statusOf(item);
  if (status === "not-run") return "not run";
  if (status === "error") return "error";
  const check = checksOf(item).find((entry) => entry.id === id);
  return !check ? "no check" : check.ok === true ? "pass" : check.ok === false ? "fail" : "unchecked";
}

// Question IDs of the tests in first-seen order.
const questionIds = (items) => [...new Set(items.flatMap((item) => questionsOf(item).map((question) => question.id)))];
const pictures = (item) => imagesOf(item).map((image) => [image.ref, image.sample, image.file]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const inputKey = (item) => stableStringify({ state: item.state ?? null, pictures: pictures(item) });
const questionsKey = (item) => stableStringify(questionsOf(item).map((question) => ({ id: question.id, type: question.type, instructions: question.instructions,
  criteria: criteriaOf(question).map((criterion) => [criterion.key, criterion.text]) })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
const requestKey = (item) => `${inputKey(item)}\u0000${questionsKey(item)}`;
const setKey = (item) => JSON.stringify(questionsOf(item).map((question) => [question.id, question.type]).sort());

// Greedy cover: repeatedly take the test that adds the most uncovered goals (the earlier test on a tie).
function cover(tests, goalsOf) {
  const left = new Set(tests.flatMap(goalsOf));
  const chosen = [];
  while (left.size) {
    let best = null, gain = 0;
    for (const test of tests) {
      const adds = new Set(goalsOf(test).filter((goal) => left.has(goal))).size;
      if (adds > gain) { best = test; gain = adds; }
    }
    if (!best) break;
    chosen.push(best.id);
    for (const goal of goalsOf(best)) left.delete(goal);
  }
  return chosen;
}

const typesOf = (item) => [...new Set(questionsOf(item).map((question) => question.type).filter((type) => TYPES.includes(type)))];
const expectedOptions = (item) => questionsOf(item).filter((question) => question.type === "choice" && usedKeys(question).includes("choice")
  && typeof question.expect.choice === "string").map((question) => `${question.id}\u0000${question.expect.choice}`);
const failingQuestionIds = (items) => new Set(items.flatMap((item) => checksOf(item).filter((check) => check.ok === false && check.question).map((check) => check.id)));
const repeatCopies = (items) => {
  const seen = new Set();
  return items.filter((item) => { const key = requestKey(item); if (seen.has(key)) return true; seen.add(key); return false; }).map((item) => item.id);
};
const sharingInput = (ctx) => {
  const selected = new Set(dataOf(ctx).selected || []);
  const inputs = new Set(itemsOf(ctx).filter((item) => selected.has(item.id)).map(inputKey));
  return shownOf(ctx).filter((item) => !selected.has(item.id) && inputs.has(inputKey(item))).map((item) => item.id);
};
const hiddenSelected = (ctx) => {
  const shown = new Set(shownOf(ctx).map((item) => item.id));
  return (dataOf(ctx).selected || []).filter((id) => !shown.has(id));
};
const failingShown = (ctx) => shownOf(ctx).filter((item) => item.status === "fail" || item.status === "error");

// Opens the next (step 1) or previous (step -1) shown failing test after the one open in Build, wrapping around.
function openFailing(ctx, step) {
  const shown = shownOf(ctx), failing = new Set(failingShown(ctx).map((item) => item.id));
  if (!failing.size) throw new Error("No shown test failed or errored in your latest runs.");
  const at = shown.findIndex((item) => item.id === dataOf(ctx).editing_id);
  for (let offset = 1; offset <= shown.length; offset++) {
    const index = at < 0 ? (step > 0 ? offset - 1 : shown.length - offset) : (((at + step * offset) % shown.length) + shown.length) % shown.length;
    if (failing.has(shown[index].id)) {
      toast(ctx, `Opening ${shown[index].id} (${shown[index].status === "fail" ? "failed" : "call error"}) in Build.`);
      return ctx.actions.open(shown[index].id);
    }
  }
  return undefined;
}

function select(ctx, ids, mode, what) {
  ctx.actions.select(ids, mode);
  toast(ctx, `${mode === "add" ? "Added" : "Selected"} ${plural(ids.length, "test")} ${what}. ${UNDO}`);
}

// ---------- exports ----------

const xml = (text) => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const seconds = (ms) => (ms / 1000).toFixed(3);

function junit(ctx) {
  const shown = shownOf(ctx);
  const count = (status) => shown.filter((item) => statusOf(item) === status).length;
  const times = shown.map((item) => (item.result ? finite(item.result.elapsed_ms) : null));
  const total = times.filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const head = `tests="${shown.length}" failures="${count("fail")}" errors="${count("error")}" skipped="${count("not-run")}" time="${seconds(total)}"`;
  const cases = shown.map((item, index) => {
    const open = `    <testcase classname="jev.workbench" name="${xml(item.id)}"${times[index] === null ? "" : ` time="${seconds(times[index])}"`}`;
    const status = statusOf(item);
    if (status === "pass") return `${open}/>`;
    const inner = status === "fail" ? `<failure type="expectation" message="${xml(failedIds(item).length ? `Failed questions: ${failedIds(item).join(", ")}` : "Failed")}"/>`
      : status === "error" ? "<error type=\"call\" message=\"The call failed; its error text is not included\"/>"
        : "<skipped message=\"Not run in this page session\"/>";
    return `${open}>\n      ${inner}\n    </testcase>`;
  });
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<testsuites name="${SUITE}" ${head}>`, `  <testsuite name="${SUITE}" ${head}>`, ...cases,
    "  </testsuite>", "</testsuites>"].join("\n") + "\n";
}

function tap(ctx) {
  const shown = shownOf(ctx);
  const safe = (text) => String(text).replace(/[#\r\n]+/g, " ").trim();
  return ["TAP version 13", `1..${shown.length}`, ...shown.map((item, index) => {
    const status = statusOf(item), n = index + 1, id = safe(item.id);
    if (status === "pass") return `ok ${n} - ${id}`;
    if (status === "not-run") return `ok ${n} - ${id} # SKIP not run in this page session`;
    if (status === "error") return `not ok ${n} - ${id}: call error`;
    const failed = failedIds(item);
    return `not ok ${n} - ${id}: ${failed.length ? `failed ${safe(failed.join(", "))}` : "failed"}`;
  })].join("\n") + "\n";
}

function perQuestion(ctx) {
  const rows = shownOf(ctx).flatMap((item) => [
    ...questionsOf(item).map((question) => [item.id, question.id, question.type, expectationKind(question), verdict(item, question.id)]),
    ...(Array.isArray(item.orphan_expectations) ? item.orphan_expectations : []).map((id) => [item.id, id, "", "orphan", verdict(item, id)]),
  ]);
  return csvText([["test_id", "question_id", "type", "expectation", "verdict"], ...rows]);
}

function measurements(ctx) {
  return csvText([["test_id", "status", "model", "backend", "questions", "input_tokens", "output_tokens", "latency_ms", "elapsed_ms", "cost_usd"],
    ...shownOf(ctx).map((item) => {
      const meta = metaOf(item) || {};
      return [item.id, statusOf(item), blank(meta.model), blank(meta.backend), blank(finite(meta.question_count)), blank(finite(meta.input_tokens)),
        blank(finite(meta.output_tokens)), blank(finite(meta.latency_ms)), blank(item.result ? finite(item.result.elapsed_ms) : null), blank(finite(meta.cost_usd))];
    })]);
}

function coverageMatrix(ctx) {
  const shown = shownOf(ctx), ids = questionIds(shown);
  return csvText([["test_id", ...ids], ...shown.map((item) => [item.id, ...ids.map((id) => {
    const question = questionsOf(item).find((entry) => entry.id === id);
    return question ? expectationKind(question) : "";
  })])]);
}

// The page's inventory rows (static/js/suite-refinements.js suiteQuestionInventory): an expectation counts when the test's
// expect map has the ID, whatever it holds.
function inventoryRows(items) {
  const rows = new Map();
  for (const item of items) {
    for (const question of questionsOf(item)) {
      const row = rows.get(question.id) || { id: question.id, tests: 0, withExpectations: 0, types: new Set() };
      row.tests++;
      if (has(item.expect, question.id)) row.withExpectations++;
      row.types.add(question.type);
      rows.set(question.id, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, types: [...row.types].sort() }));
}

function failuresByQuestion(ctx) {
  const rows = new Map();
  for (const item of shownOf(ctx)) {
    for (const check of checksOf(item).filter((entry) => entry.ok === true || entry.ok === false)) {
      const row = rows.get(check.id) || { id: check.id, checked: 0, passed: 0, failed: 0 };
      row.checked++;
      row[check.ok ? "passed" : "failed"]++;
      rows.set(check.id, row);
    }
  }
  if (!rows.size) throw new Error("No shown test has a checked result yet. Run tests first.");
  const sorted = [...rows.values()].sort((a, b) => b.failed - a.failed || compareText(a.id, b.id));
  return csvText([["question_id", "checked", "passed", "failed"], ...sorted.map((row) => [row.id, row.checked, row.passed, row.failed])]);
}

function summary(ctx) {
  const shown = shownOf(ctx), questions = shown.flatMap(questionsOf), data = dataOf(ctx);
  const byType = TYPES.map((type) => [type, questions.filter((question) => question.type === type).length]).filter(([, count]) => count);
  const count = (status) => shown.filter((item) => statusOf(item) === status).length;
  const spends = shown.map((item) => finite(metaOf(item)?.cost_usd)).filter((value) => value !== null);
  const session = isObject(data.results) ? data.results : null;
  return [`# ${SUITE} summary`, "",
    `- Shown tests: ${shown.length} of ${itemsOf(ctx).length} saved`,
    `- Questions: ${questions.length}${byType.length ? ` (${byType.map(([type, n]) => `${n} ${type}`).join(", ")})` : ""}`,
    `- Questions an expectation checks: ${questions.filter(isChecked).length} of ${questions.length}`,
    `- Picture references: ${shown.reduce((sum, item) => sum + imagesOf(item).length, 0)}`,
    `- Latest results of the shown tests: ${count("pass")} passed, ${count("fail")} failed, ${plural(count("error"), "error")}, ${count("not-run")} not run`,
    `- Measured spend of those latest calls: ${spends.length ? `${usd(spends.reduce((sum, value) => sum + value, 0))} (${plural(spends.length, "call")})` : "none yet"}`,
    `- Session: ${session ? `${plural(session.batches, "paid batch", "paid batches")}, ${usd(session.cost_usd)} measured spend, ${Math.round(session.wall_ms).toLocaleString("en-US")} ms wall time` : "nothing run yet"}`,
    "", "Counts only: no inputs, instructions, expected values or answers. Spend is measured, never an estimate.", ""].join("\n");
}

function filePaths(ctx) {
  const wanted = new Set(dataOf(ctx).selected || []);
  const chosen = itemsOf(ctx).filter((item) => wanted.has(item.id) && SAVED_ID.test(item.id));
  if (!chosen.length) throw new Error("Select saved tests first: this list follows the selection.");
  const stored = [...new Set(chosen.flatMap((item) => imagesOf(item).map((image) => image.file).filter((file) => typeof file === "string" && STORED_PICTURE.test(file))))];
  return [...chosen.map((item) => `data/workbench/${item.id}.json`), ...stored.map((file) => `data/workbench/images/${file}`)].join("\n") + "\n";
}

function checkText(ctx) {
  const rows = shownOf(ctx).filter((item) => item.result).flatMap((item) => (item.result.error
    ? [[item.id, "error", "—", item.result.error]]
    : checksOf(item).map((check) => [item.id, statusOf(item), check.id, (Array.isArray(check.checks) ? check.checks : []).join("; ")])));
  if (!rows.length) throw new Error("No shown test has a result yet. Run tests first.");
  return [`# ${SUITE}: check and error text`, "", "Holds the server's check text from your latest runs, which quotes answers and expected values, and call error text.", "",
    formatMarkdownTable(["Test", "Status", "Question", "Check text"], rows), ""].join("\n");
}

// ---------- panels ----------

const attempt = (api, run) => {
  try { run(); } catch (error) { api.toast(error.message, "error"); }
};

function matrixPanel(h, ctx, api) {
  const shown = shownOf(ctx);
  if (!shown.length) return h("p", { class: "faint" }, "No saved test is shown.");
  const failing = failingQuestionIds(shown);
  const ids = questionIds(shown).filter((id) => !api.state.failingOnly || failing.has(id));
  const toggle = h("button", { class: "btn sm ghost", "data-action": "failing-only", "aria-pressed": api.state.failingOnly ? "true" : "false",
    onclick: () => { api.state.failingOnly = !api.state.failingOnly; api.redraw(); } },
  api.state.failingOnly ? "Show every question ID" : "Show only question IDs that failed");
  if (!ids.length) return h("div", {}, toggle, h("p", { class: "faint", "data-empty": "matrix" }, api.state.failingOnly ? "No shown question ID failed in your latest runs." : "The shown tests have no questions."));
  const asking = (id) => shown.filter((item) => questionsOf(item).some((question) => question.id === id));
  const totals = (id) => {
    const verdicts = asking(id).map((item) => verdict(item, id));
    return `${asking(id).length} asked · ${verdicts.filter((v) => v === "pass").length} pass · ${verdicts.filter((v) => v === "fail").length} fail`;
  };
  return h("div", {}, toggle, h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "matrix" },
    h("thead", {}, h("tr", {}, h("th", {}, "test"), ids.map((id) => h("th", { class: "mono" }, id, " ",
      h("button", { class: "btn sm ghost", "data-select-column": id, "aria-label": `Select the shown tests that ask ${id}`,
        onclick: () => attempt(api, () => {
          const chosen = asking(id).map((item) => item.id);
          ctx.actions.select(chosen, "replace");
          api.toast(`Selected ${plural(chosen.length, "test")} that ask ${id}. ${UNDO}`);
        }) }, "Select"))), h("th", {}, ""))),
    h("tbody", {}, shown.map((item) => h("tr", { "data-test": item.id }, h("td", { class: "mono" }, item.id),
      ids.map((id) => h("td", { "data-cell": `${item.id}/${id}` }, questionsOf(item).some((question) => question.id === id) ? verdict(item, id) : "—")),
      h("td", {}, h("button", { class: "btn sm ghost", "data-add-row": item.id, "aria-label": `Add ${item.id} to the selection`,
        onclick: () => attempt(api, () => { ctx.actions.select([item.id], "add"); api.toast(`Added ${item.id} to the selection. ${UNDO}`); }) }, "Add"))))),
    h("tfoot", {}, h("tr", {}, h("td", {}, "totals"), ids.map((id) => h("td", { "data-total": id }, totals(id))), h("td", {}, ""))))),
  h("p", { class: "faint" }, "Cells: pass, fail, unchecked (no expectation), not run, error (the call failed), no check, or — (not asked). From your latest runs in this page session."));
}

function inventoryOf(shown) {
  const rows = new Map();
  for (const item of shown) {
    for (const question of questionsOf(item)) {
      const row = rows.get(question.id) || { id: question.id, tests: [], checked: 0, types: new Set(), wordings: new Map(), lists: new Set(), runChecked: 0, failed: 0 };
      row.tests.push(item.id);
      if (isChecked(question)) row.checked++;
      row.types.add(question.type || "no type");
      const wording = words(question.instructions);
      row.wordings.set(wording, [...(row.wordings.get(wording) || []), item.id]);
      if (criteriaOf(question).length) row.lists.add(JSON.stringify(criteriaOf(question).map((criterion) => criterion.key)));
      const v = verdict(item, question.id);
      if (v === "pass" || v === "fail") row.runChecked++;
      if (v === "fail") row.failed++;
      rows.set(question.id, row);
    }
  }
  return [...rows.values()];
}

// The tests whose wording of a question ID is not the most common one (the first seen wins a tie).
function minorityWording(row) {
  let top = null;
  for (const [wording, ids] of row.wordings) if (!top || ids.length > top[1].length) top = [wording, ids];
  return [...row.wordings].filter(([wording]) => wording !== top[0]).flatMap(([, ids]) => ids);
}

const INVENTORY_SORTS = [["id", "Question ID"], ["tests", "Most tests"], ["failures", "Most failures"]];

function inventoryPanel(h, ctx, api) {
  const all = inventoryOf(shownOf(ctx));
  if (!all.length) return h("p", { class: "faint" }, "The shown tests have no questions.");
  const query = String(api.state.query ?? "").trim().toLowerCase();
  const sort = INVENTORY_SORTS.some(([key]) => key === api.state.sort) ? api.state.sort : "id";
  const rows = all.filter((row) => row.id.toLowerCase().includes(query)).sort((a, b) => (sort === "tests" ? b.tests.length - a.tests.length
    : sort === "failures" ? b.failed - a.failed : 0) || compareText(a.id, b.id));
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Question ID contains ", h("input", { type: "search", "data-action": "inventory-query", value: api.state.query ?? "",
        oninput: (event) => { api.state.query = event.target.value; api.redraw(); } })),
      h("label", {}, " Sort ", h("select", { "data-action": "inventory-sort", value: sort, onchange: (event) => { api.state.sort = event.target.value; api.redraw(); } },
        INVENTORY_SORTS.map(([key, label]) => h("option", { value: key, selected: key === sort }, label))))),
    rows.length ? h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "inventory" },
      h("thead", {}, h("tr", {}, ["question ID", "tests", "checked", "types", "wordings", "criteria lists", "failed / checked in latest runs", ""].map((name) => h("th", {}, name)))),
      h("tbody", {}, rows.map((row) => h("tr", { "data-question": row.id },
        h("td", { class: "mono" }, row.id), h("td", { class: "num" }, String(row.tests.length)), h("td", { class: "num" }, String(row.checked)),
        h("td", {}, [...row.types].sort().join(", ")), h("td", { class: "num" }, String(row.wordings.size)), h("td", { class: "num" }, String(row.lists.size)),
        h("td", { class: "num" }, row.runChecked ? `${row.failed} / ${row.runChecked}` : "—"),
        h("td", {}, row.wordings.size > 1 ? h("button", { class: "btn sm ghost", "data-minority": row.id, "aria-label": `Select the tests with a minority wording of ${row.id}`,
          onclick: () => attempt(api, () => {
            const ids = minorityWording(row);
            ctx.actions.select(ids, "replace");
            api.toast(`Selected ${plural(ids.length, "test")} whose wording of ${row.id} differs from the most common one. ${UNDO}`);
          }) }, "Select minority wording") : null)))))) : h("p", { class: "faint", "data-empty": "inventory" }, "No question ID matches."),
    h("p", { class: "faint" }, "Counts over the shown tests: wordings are distinct instruction texts (spacing ignored), criteria lists distinct ordered option or level keys. No instructions, expected values or answers."));
}

const PLANS = [["spend", "Cheapest by latest measured spend, summed up to a cap (USD)"], ["latency", "Fastest by latest measured latency, summed up to a cap (ms)"],
  ["random", "Seeded random sample of N"], ["nth", "Every Nth shown test"], ["recent", "N most recently saved"]];

// The planner's pick over the shown tests: { ids (shown order), note } or { error }.
function plan(ctx, state) {
  const shown = shownOf(ctx), mode = PLANS.some(([key]) => key === state.mode) ? state.mode : "spend";
  const value = toNumber(state.value);
  if (!shown.length) return { error: "No saved test is shown." };
  const inShownOrder = (ids) => shown.map((item) => item.id).filter((id) => ids.includes(id));
  if (mode === "spend" || mode === "latency") {
    if (value === null || value < 0) return { error: mode === "spend" ? "Enter a spend cap in USD, 0 or more." : "Enter a latency cap in milliseconds, 0 or more." };
    const read = (item) => finite(metaOf(item)?.[mode === "spend" ? "cost_usd" : "latency_ms"]);
    const measured = shown.filter((item) => read(item) !== null).map((item, index) => ({ item, index, value: read(item) }))
      .sort((a, b) => a.value - b.value || a.index - b.index);
    const ids = [];
    let total = 0;
    for (const entry of measured) {
      if (total + entry.value > value + 1e-12) break;
      total += entry.value;
      ids.push(entry.item.id);
    }
    const missing = shown.length - measured.length;
    const sum = mode === "spend" ? `${usd(total)} latest measured spend` : `${Math.round(total).toLocaleString("en-US")} ms summed latest latency (not wall time)`;
    return { ids: inShownOrder(ids), note: `${sum}; not an estimate, the run's spend preview shows the upper bound.${missing ? ` ${plural(missing, "shown test")} without a measured value ${missing === 1 ? "is" : "are"} left out.` : ""}` };
  }
  if (value === null || !Number.isInteger(value) || value < 1) return { error: "Enter a whole number N of 1 or more." };
  if (mode === "random") {
    const seed = toNumber(state.seed ?? "1");
    if (seed === null || !Number.isInteger(seed) || seed < 0) return { error: "Enter a whole-number seed of 0 or more." };
    const indexes = sampleIndexes(shown.length, Math.min(value, shown.length), seed);
    return { ids: indexes.map((index) => shown[index].id), note: `Seed ${seed}: the same seed and shown tests give the same sample.` };
  }
  if (mode === "nth") return { ids: shown.filter((_, index) => index % value === 0).map((item) => item.id), note: `Shown positions 1, ${1 + value}, ${1 + 2 * value}, … in display order.` };
  const dated = shown.map((item, index) => ({ item, index, ms: finite(item.saved_ms) })).filter((entry) => entry.ms !== null)
    .sort((a, b) => b.ms - a.ms || a.index - b.index);
  const missing = shown.length - dated.length;
  return { ids: inShownOrder(dated.slice(0, value).map((entry) => entry.item.id)),
    note: `By last saved time.${missing ? ` ${plural(missing, "shown test")} without a saved time ${missing === 1 ? "is" : "are"} left out.` : ""}` };
}

function plannerPanel(h, ctx, api) {
  const state = api.state, mode = PLANS.some(([key]) => key === state.mode) ? state.mode : "spend";
  const picked = plan(ctx, state);
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Pick ", h("select", { "data-action": "planner-mode", value: mode, onchange: (event) => { state.mode = event.target.value; api.redraw(); } },
        PLANS.map(([key, label]) => h("option", { value: key, selected: key === mode }, label)))),
      h("label", {}, mode === "spend" ? " Cap (USD) " : mode === "latency" ? " Cap (ms) " : " N ",
        h("input", { type: "number", min: "0", "data-action": "planner-value", value: state.value ?? "", oninput: (event) => { state.value = event.target.value; api.redraw(); } })),
      mode === "random" ? h("label", {}, " Seed ", h("input", { type: "number", min: "0", "data-action": "planner-seed", value: state.seed ?? "1",
        oninput: (event) => { state.seed = event.target.value; api.redraw(); } })) : null),
    h("p", { "data-preview": "planner", role: "status" }, picked.error ? picked.error
      : `Would select ${plural(picked.ids.length, "test")}${picked.ids.length ? `: ${picked.ids.join(", ")}` : ""}. ${picked.note}`),
    h("button", { class: "btn sm", "data-action": "planner-apply", disabled: !!picked.error || !picked.ids.length,
      onclick: () => attempt(api, () => {
        const now = plan(ctx, state);
        if (now.error) throw new Error(now.error);
        if (!now.ids.length) throw new Error("Nothing to select.");
        ctx.actions.select(now.ids, "replace");
        api.toast(`Selected ${plural(now.ids.length, "test")}. ${UNDO} Nothing runs until you press Run selected.`);
      }) }, "Replace the selection with these tests"));
}

function diffPanel(h, ctx, api) {
  const items = itemsOf(ctx);
  if (items.length < 2) return h("p", { class: "faint" }, "Save two tests to compare them.");
  const byId = new Map(items.map((item) => [item.id, item]));
  const a = byId.get(api.state.a) || items[0];
  const b = byId.get(api.state.b) || items.find((item) => item !== a);
  const picker = (side, current) => h("select", { "data-action": `diff-${side}`, value: current.id, onchange: (event) => { api.state[side] = event.target.value; api.redraw(); } },
    items.map((item) => h("option", { value: item.id, selected: item.id === current.id }, item.id)));
  const qa = new Map(questionsOf(a).map((question) => [question.id, question])), qb = new Map(questionsOf(b).map((question) => [question.id, question]));
  const shared = [...qa.keys()].filter((id) => qb.has(id));
  const section = (name, title, lines, none) => h("div", { "data-section": name }, h("h4", {}, title),
    lines.length ? h("ul", {}, lines.map((line) => h("li", {}, line))) : h("p", { class: "faint" }, none));
  const onlyA = [...qa.keys()].filter((id) => !qb.has(id)), onlyB = [...qb.keys()].filter((id) => !qa.has(id));
  const shape = shared.flatMap((id) => {
    const one = qa.get(id), two = qb.get(id), out = [];
    if (one.type !== two.type) out.push(`${id}: type ${one.type || "none"} → ${two.type || "none"}`);
    else if (one.type === "score") {
      if (criteriaOf(one).length !== criteriaOf(two).length) out.push(`${id}: ${criteriaOf(one).length} → ${criteriaOf(two).length} levels`);
    } else {
      const keysA = criteriaOf(one).map((criterion) => criterion.key), keysB = criteriaOf(two).map((criterion) => criterion.key);
      const added = keysB.filter((key) => !keysA.includes(key)), removed = keysA.filter((key) => !keysB.includes(key));
      if (added.length || removed.length) out.push(`${id}: ${[added.length ? `options added ${added.join(", ")}` : "", removed.length ? `options removed ${removed.join(", ")}` : ""].filter(Boolean).join("; ")}`);
      else if (JSON.stringify(keysA) !== JSON.stringify(keysB)) out.push(`${id}: the same options in a different order`);
    }
    return out;
  });
  const wording = shared.filter((id) => words(qa.get(id).instructions) !== words(qb.get(id).instructions)).map((id) => `${id}: the wording differs`);
  const kinds = shared.filter((id) => expectationKind(qa.get(id)) !== expectationKind(qb.get(id))).map((id) => `${id}: ${expectationKind(qa.get(id))} → ${expectationKind(qb.get(id))}`);
  const input = [];
  if (a.state_kind !== b.state_kind) input.push(`input shape ${a.state_kind} → ${b.state_kind}`);
  else if (a.state_kind === "object") {
    const ka = Object.keys(a.state), kb = Object.keys(b.state);
    const added = kb.filter((key) => !ka.includes(key)), removed = ka.filter((key) => !kb.includes(key));
    const changed = ka.filter((key) => kb.includes(key) && stableStringify(a.state[key]) !== stableStringify(b.state[key]));
    if (added.length) input.push(`fields added: ${added.join(", ")}`);
    if (removed.length) input.push(`fields removed: ${removed.join(", ")}`);
    if (changed.length) input.push(`fields changed: ${changed.join(", ")}`);
  } else if (stableStringify(a.state) !== stableStringify(b.state)) input.push(a.state_kind === "text" ? "the text differs" : "the input differs");
  const refsA = new Map(imagesOf(a).map((image) => [image.ref, `${image.sample}|${image.file}`])), refsB = new Map(imagesOf(b).map((image) => [image.ref, `${image.sample}|${image.file}`]));
  const picAdded = [...refsB.keys()].filter((ref) => !refsA.has(ref)), picRemoved = [...refsA.keys()].filter((ref) => !refsB.has(ref));
  const picChanged = [...refsA.keys()].filter((ref) => refsB.has(ref) && refsA.get(ref) !== refsB.get(ref));
  if (picAdded.length) input.push(`pictures added: ${picAdded.join(", ")}`);
  if (picRemoved.length) input.push(`pictures removed: ${picRemoved.join(", ")}`);
  if (picChanged.length) input.push(`pictures changed: ${picChanged.join(", ")}`);
  return h("div", {},
    h("div", { class: "chips lab-row" }, h("label", {}, "Test A ", picker("a", a)), h("label", {}, " Test B ", picker("b", b))),
    section("questions", "Question IDs", [onlyA.length ? `only in ${a.id}: ${onlyA.join(", ")}` : "", onlyB.length ? `only in ${b.id}: ${onlyB.join(", ")}` : ""].filter(Boolean),
      "Both tests ask the same question IDs."),
    section("shape", "Types and options", shape, "Shared questions have the same types, options and levels."),
    section("wording", "Wording", wording, "Shared questions have the same wording."),
    section("expectations", "Expectation kinds", kinds, "Shared questions have the same kinds of expectation."),
    section("input", "Input and pictures", input, "The input and pictures are the same."),
    h("p", { class: "faint" }, "Names only: question IDs, option keys, field names and picture references. No input values, wording, expected values or answers."));
}

export default definePack({
  id: "tests-handoffs",
  surface: "workbench.tests.items",
  title: "Saved test reports and planning",
  about: "Report and handoff exports for the shown saved tests (JUnit XML, TAP, per-question verdicts, measurements, a coverage matrix, the question inventory as CSV, failures by question, a summary, selected file paths, and one separately named export of check and error text), selection-planning and navigation commands that change only the selection or open Build, and panels for a test-by-question table, a question inventory, a selection planner and a two-test comparison. Nothing here starts a paid run or exports a request; only the check-text export holds answer-bearing text, and it says so.",
  features: [
    // ---------- exports ----------
    { id: "junit_xml", kind: "exporter", label: "Shown results as JUnit XML", filename: "jev-tests-junit.xml", mime: "application/xml",
      help: "One testcase per shown test: ID, pass, failure (with failed question IDs), call error or skipped (not run), and measured server time. No check text, error text, inputs or answers.",
      build: junit },
    { id: "tap", kind: "exporter", label: "Shown results as TAP", filename: "jev-tests.tap",
      help: "ok / not ok per shown test, with failed question IDs and SKIP for tests not run in this session. No check text, error text, inputs or answers.",
      build: tap },
    { id: "per_question_csv", kind: "exporter", label: "Shown results per question as CSV", filename: "jev-tests-per-question.csv", mime: "text/csv",
      help: "Test ID, question ID, type, expectation kind (none, empty, ignored, invalid, option, bounds, box, orphan) and latest verdict. No expected values, answers or check text.",
      build: perQuestion },
    { id: "measurements_csv", kind: "exporter", label: "Shown measurements as CSV", filename: "jev-tests-measurements.csv", mime: "text/csv",
      help: "Status, model, backend, question count, input and output tokens, latency, server time and spend of each shown test's latest call, all measured; blank when unknown. Not estimates.",
      build: measurements },
    { id: "coverage_matrix_csv", kind: "exporter", label: "Shown coverage matrix as CSV", filename: "jev-tests-coverage-matrix.csv", mime: "text/csv",
      help: "One row per shown test and one column per question ID; a cell holds the expectation kind, or is blank when the test does not ask the ID. Kinds only, no expected values.",
      build: coverageMatrix },
    { id: "inventory_csv", kind: "exporter", label: "Shown question inventory as CSV", filename: "jev-question-inventory-shown.csv", mime: "text/csv",
      help: "The page's inventory fields only: question ID, tests, tests with an expectation entry, and types. No instructions, labels, state or answers.",
      build: (ctx) => csvText([["id", "tests", "withExpectations", "types"], ...inventoryRows(shownOf(ctx)).map((row) => [row.id, row.tests, row.withExpectations, row.types.join(" ")])]) },
    { id: "failures_by_question_csv", kind: "exporter", label: "Failed checks by question ID as CSV", filename: "jev-tests-failures-by-question.csv", mime: "text/csv",
      help: "Per question ID: checked, passed and failed checks in the shown tests' latest runs, most failures first. Counts only.",
      build: failuresByQuestion },
    { id: "summary_markdown", kind: "exporter", label: "Shown suite summary as Markdown", filename: "jev-tests-summary.md", mime: "text/markdown",
      help: "Counts of shown tests, questions by type, checked questions, pictures and latest statuses, with measured spend and the session totals. No inputs, instructions, expected values or answers.",
      build: summary },
    { id: "file_paths", kind: "exporter", label: "Selected test file paths", filename: "jev-selected-test-files.txt",
      help: "data/workbench/<id>.json for each selected test (hidden ones included) and the stored pictures they use, one path per line for git add. Bundled sample pictures are not listed; IDs the server cannot load are left out.",
      build: filePaths },
    { id: "check_text_markdown", kind: "exporter", label: "Shown results with check and error text as Markdown", filename: "jev-tests-check-text.md", mime: "text/markdown",
      help: "Holds the server's check text from your latest runs, which quotes answers and expected values, and call error text. Write-only: never an import format. No inputs or instructions.",
      build: checkText },

    // ---------- selection planning (selection only, never a run) ----------
    { id: "select_type_cover", kind: "command", title: "Select shown tests that cover every question type", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && shownOf(ctx).some((item) => typesOf(item).length),
      run: (ctx) => select(ctx, cover(shownOf(ctx), typesOf), "replace", "that together ask every question type in the shown tests") },
    { id: "select_option_cover", kind: "command", title: "Select shown tests that cover every expected option", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && shownOf(ctx).some((item) => expectedOptions(item).length),
      run: (ctx) => select(ctx, cover(shownOf(ctx), expectedOptions), "replace", "that together expect every expected Choice option of the shown tests") },
    { id: "select_one_per_question_set", kind: "command", title: "Select one shown test per question set", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && shownOf(ctx).some((item) => questionsOf(item).length),
      run: (ctx) => {
        const seen = new Set();
        const ids = shownOf(ctx).filter((item) => questionsOf(item).length && !seen.has(setKey(item)) && seen.add(setKey(item))).map((item) => item.id);
        select(ctx, ids, "replace", "(the first shown test of each set of question IDs and types)");
      } },
    { id: "select_failure_neighbours", kind: "command", title: "Select shown tests that ask a failing question ID", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && failingQuestionIds(itemsOf(ctx)).size > 0,
      run: (ctx) => {
        const failing = failingQuestionIds(itemsOf(ctx));
        const ids = shownOf(ctx).filter((item) => questionsOf(item).some((question) => failing.has(question.id))).map((item) => item.id);
        if (!ids.length) throw new Error("No shown test asks a question ID that failed in your latest runs.");
        select(ctx, ids, "replace", `that ask ${failing.size === 1 ? "the question ID" : "a question ID"} that failed in your latest runs`);
      } },
    { id: "select_repeat_copies", kind: "command", title: "Select shown repeat requests, keeping the first of each", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && repeatCopies(shownOf(ctx)).length > 0,
      run: (ctx) => select(ctx, repeatCopies(shownOf(ctx)), "replace", "that repeat an earlier shown test's request") },
    { id: "add_shared_inputs", kind: "command", title: "Add shown tests that share an input with a selected test", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && sharingInput(ctx).length > 0,
      run: (ctx) => select(ctx, sharingInput(ctx), "add", "that send the same input and pictures as a selected test") },
    { id: "keep_shown_selection", kind: "command", title: "Drop hidden tests from the selection", group: "Saved tests",
      when: (ctx) => !dataOf(ctx).busy && hiddenSelected(ctx).length > 0,
      run: (ctx) => {
        const hidden = new Set(hiddenSelected(ctx));
        const keep = (dataOf(ctx).selected || []).filter((id) => !hidden.has(id));
        ctx.actions.select(keep, "replace");
        toast(ctx, `Removed ${plural(hidden.size, "hidden test")} from the selection; ${plural(keep.length, "shown test")} stay selected. ${UNDO}`);
      } },

    // ---------- navigation ----------
    { id: "open_next_failing", kind: "command", title: "Open the next shown failing test in Build", group: "Saved tests", keys: "Alt+Shift+N",
      when: (ctx) => failingShown(ctx).length > 0, run: (ctx) => openFailing(ctx, 1) },
    { id: "open_previous_failing", kind: "command", title: "Open the previous shown failing test in Build", group: "Saved tests", keys: "Alt+Shift+B",
      when: (ctx) => failingShown(ctx).length > 0, run: (ctx) => openFailing(ctx, -1) },
    { id: "open_selected", kind: "command", title: "Open the selected test in Build", group: "Saved tests",
      when: (ctx) => (dataOf(ctx).selected || []).length === 1,
      run: (ctx) => ctx.actions.open(dataOf(ctx).selected[0]) },
    { id: "inspect_slowest", kind: "command", title: "Inspect the slowest shown call", group: "Saved tests",
      when: (ctx) => shownOf(ctx).some((item) => item.result?.has_trace && finite(metaOf(item)?.latency_ms) !== null),
      run: (ctx) => {
        let slowest = null;
        for (const item of shownOf(ctx)) {
          const latency = item.result?.has_trace ? finite(metaOf(item)?.latency_ms) : null;
          if (latency !== null && (!slowest || latency > slowest.latency)) slowest = { item, latency };
        }
        if (!slowest) throw new Error("No shown test has a measured call to inspect.");
        toast(ctx, `Inspecting ${slowest.item.id}: ${Math.round(slowest.latency)} ms measured latency.`);
        return ctx.actions.inspect(slowest.item.id);
      } },
    { id: "inspect_editing", kind: "command", title: "Inspect the latest call of the test open in Build", group: "Saved tests",
      when: (ctx) => itemsOf(ctx).some((item) => item.id === dataOf(ctx).editing_id && item.result?.has_trace),
      run: (ctx) => ctx.actions.inspect(dataOf(ctx).editing_id) },
    { id: "copy_status_line", kind: "command", title: "Copy a one-line session status", group: "Saved tests",
      when: (ctx) => isObject(dataOf(ctx).results),
      run: (ctx) => {
        const results = dataOf(ctx).results;
        const line = `${SUITE}: ${results.passed} passed, ${results.failed} failed, ${plural(results.errors, "error")}, ${results.unrun} not run of ${itemsOf(ctx).length} saved · ${plural(results.batches, "paid batch", "paid batches")} · ${usd(results.cost_usd)} measured spend · ${Math.round(results.wall_ms).toLocaleString("en-US")} ms wall time`;
        ctx.env?.copy?.(line);
        toast(ctx, "Copied the session status line.");
      } },

    // ---------- panels ----------
    { id: "question_matrix", kind: "panel", title: "Test-by-question table",
      improvements: [
        { id: "grid", title: "Grid of the shown tests by question ID with a text verdict per cell" },
        { id: "totals", title: "Totals per question ID: tests asking it, passed and failed" },
        { id: "failing_only", title: "Narrow the grid to question IDs that failed in the latest runs" },
        { id: "select_column", title: "Select the shown tests that ask one question ID" },
        { id: "add_row", title: "Add one test to the selection from its grid row" },
      ],
      render: matrixPanel },
    { id: "question_inventory", kind: "panel", title: "Suite question inventory",
      improvements: [
        { id: "table", title: "One row per question ID with tests, checked tests and types" },
        { id: "variants", title: "Wording and criteria-list variant counts per question ID" },
        { id: "search", title: "Narrow the inventory to question IDs containing typed text" },
        { id: "sort", title: "Sort the inventory by ID, tests or failures" },
        { id: "select_minority", title: "Select the tests that use a minority wording of a question ID" },
      ],
      render: inventoryPanel },
    { id: "selection_planner", kind: "panel", title: "Selection planner",
      improvements: [
        { id: "spend_cap", title: "Plan the cheapest shown tests whose latest measured spend sums to at most a cap" },
        { id: "latency_cap", title: "Plan the fastest shown tests whose latest measured latency sums to at most a cap" },
        { id: "random_sample", title: "Plan a seeded random sample of N shown tests" },
        { id: "every_nth", title: "Plan a selection of every Nth shown test" },
        { id: "most_recent", title: "Plan a selection of the N most recently saved shown tests" },
      ],
      render: plannerPanel },
    { id: "compare_two", kind: "panel", title: "Compare two saved tests",
      improvements: [
        { id: "questions", title: "Question IDs only one of two chosen tests asks" },
        { id: "shape", title: "Type, option and level changes for question IDs both tests ask" },
        { id: "wording", title: "Which shared questions are worded differently" },
        { id: "expectations", title: "Expectation-kind changes for shared question IDs" },
        { id: "input", title: "Input fields and picture references added, removed or changed" },
      ],
      render: diffPanel },
  ],
});
