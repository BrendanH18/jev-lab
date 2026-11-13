// Panels for the Workbench Tests tab ("workbench.tests.items"; contract in static/js/lab/surfaces/workbench-tests.js): one
// question ID's answers beside its expectations across the shown tests, a rerun change report against the previous
// result this page session saw, and a pass-rate table per question ID, plus five metrics over the latest results.
// Everything comes from the user's own runs of this page session and stays in the page's memory; the only page actions
// are the row's Open and Inspect, and a selection change, each pressed by the user. Nothing here starts a run. The
// answers panel shows expectations and answers in the page; its Markdown copy says it holds them. The change report's
// copy and the pass-rate CSV hold IDs, statuses, counts and measurements only.
import { compareText, csvText, definePack, formatValue, toNumber } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const TYPES = ["noul", "choice", "score", "box"];
const EDGES = ["left", "top", "right", "bottom"];
const Z = 1.959964;  // jev/calibrate.py: two-sided 95% normal quantile
const MAX_ATTEMPTS = 20;
const UNDO = "Undo selection change restores the previous selection.";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const listOf = (value) => (Array.isArray(value) ? value.filter((item) => isObject(item) && typeof item.id === "string") : []);
const shownOf = (ctx) => {
  try { return listOf(ctx?.shown?.()); } catch { return []; }
};
const itemsOf = (ctx) => {
  try { return listOf(ctx?.items?.()); } catch { return []; }
};
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter((question) => isObject(question) && typeof question.id === "string") : []);
const answered = (item) => isObject(item?.result) && !item.result.error;
const checksOf = (item) => (answered(item) && Array.isArray(item.result.checks) ? item.result.checks.filter(isObject) : []);
const checkOf = (item, id) => checksOf(item).find((check) => check.id === id && check.question !== false) || null;
const statusOf = (item) => (["pass", "fail", "error"].includes(item?.status) ? item.status : "not-run");
const metaOf = (item) => (answered(item) && isObject(item.result.meta) ? item.result.meta : null);
const two = (value) => (finite(value) === null ? "—" : value.toFixed(2));
const signed = (value, digits = 2) => (finite(value) === null ? "—" : `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}`);
const usd = (value) => `$${Number(Math.abs(value).toPrecision(6))}`;
const pct = (value) => formatValue(finite(value), "percent");
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function") result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) { api.toast(error.message, "error"); }
}

// 95% Wilson score interval, as jev/calibrate.py wilson().
function wilson(correct, n) {
  if (!n) return [null, null];
  const p = correct / n, z2 = Z * Z;
  const centre = p + z2 / (2 * n);
  const spread = Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denom = 1 + z2 / n;
  return [correct === 0 ? 0 : Math.max(0, (centre - spread) / denom), correct === n ? 1 : Math.min(1, (centre + spread) / denom)];
}

// Question IDs of the shown tests in first-seen order.
function questionIds(shown) {
  const ids = [];
  for (const item of shown) for (const question of questionsOf(item)) if (!ids.includes(question.id)) ids.push(question.id);
  return ids;
}

function verdict(item, id) {
  if (!item.result) return "not run";
  if (item.result.error) return "error";
  const check = checkOf(item, id);
  return !check ? "no check" : check.ok === true ? "pass" : check.ok === false ? "fail" : "unchecked";
}

// ---------- expectations and answers as text, and the distance from a bound ----------

const MEASURE = { choice: "p", noul: "P(yes)", score: "score" };

function expectText(question) {
  const expect = question.expect;
  if (expect === null || expect === undefined) return "none";
  if (!isObject(expect)) return "unreadable";
  if (isObject(expect.box)) return `box, IoU ≥ ${two(finite(expect.iou_min) ?? 0.5)}`;
  const parts = [];
  if (typeof expect.choice === "string") parts.push(`option ${expect.choice}`);
  const measure = MEASURE[question.type] || "value";
  if (finite(expect.min) !== null) parts.push(`${measure} ≥ ${expect.min}`);
  if (finite(expect.max) !== null) parts.push(`${measure} ≤ ${expect.max}`);
  return parts.length ? parts.join(", ") : "{} (checks nothing)";
}

function answerText(answer) {
  if (!isObject(answer)) return "—";
  if (answer.type === "choice") return typeof answer.choice === "string" ? `${answer.choice} (p ${two(finite(answer.probabilities?.[answer.choice]))})` : "—";
  if (answer.type === "score") return `score ${two(finite(answer.score))}`;
  if (answer.type === "noul") return `P(yes) ${two(finite(answer.noul))}`;
  if (answer.type === "box" && isObject(answer.box)) return `box ${EDGES.map((edge) => two(finite(answer.box[edge]))).join(", ")}`;
  return "—";
}

const validBox = (box) => isObject(box) && EDGES.every((edge) => finite(box[edge]) !== null) && box.left < box.right && box.top < box.bottom;

function iou(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const hgt = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * hgt;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : 0;
}

// How far the checked value sits inside (positive) or outside (negative) its nearest bound, as jev/workbench.py checks
// it: Choice the probability of the chosen option, Noul P(yes), Score the score, Box the IoU against iou_min. null
// without a bound (an option-only expectation) or an answer.
function marginOf(question, answer) {
  const expect = question?.expect;
  if (!isObject(expect) || !isObject(answer)) return null;
  if (answer.type === "box") {
    if (!validBox(expect.box) || !validBox(answer.box)) return null;
    return iou(answer.box, expect.box) - (finite(expect.iou_min) ?? 0.5);
  }
  const target = answer.type === "choice" ? finite(answer.probabilities?.[answer.choice]) : answer.type === "score" ? finite(answer.score)
    : answer.type === "noul" ? finite(answer.noul) : null;
  if (target === null) return null;
  const margins = [];
  if (finite(expect.min) !== null) margins.push(target - expect.min);
  if (finite(expect.max) !== null) margins.push(expect.max - target);
  return margins.length ? Math.min(...margins) : null;
}

// Every checked question of the shown tests' latest answered calls: { item, question, check, margin }.
function checkedEntries(shown) {
  return shown.flatMap((item) => questionsOf(item).map((question) => ({ item, question, check: checkOf(item, question.id) }))
    .filter((entry) => entry.check && typeof entry.check.ok === "boolean")
    .map((entry) => ({ ...entry, margin: marginOf(entry.question, entry.check.answer) })));
}

// ---------- answers for one question ID ----------

const ANSWER_SORTS = [["shown", "Shown order"], ["margin", "Closest to a bound first"], ["confidence", "Least confident first"]];

function answerRows(ctx, state) {
  const shown = shownOf(ctx);
  const ids = questionIds(shown);
  const qid = ids.includes(state.qid) ? state.qid : ids[0] || null;
  let rows = shown.map((item, order) => ({ item, order, question: questionsOf(item).find((question) => question.id === qid) })).filter((row) => row.question)
    .map((row) => {
      const check = checkOf(row.item, qid);
      return { ...row, verdict: verdict(row.item, qid), answer: check?.answer ?? null, confidence: finite(check?.confidence), margin: marginOf(row.question, check?.answer) };
    });
  if (state.failedOnly) rows = rows.filter((row) => row.verdict === "fail");
  const sort = ANSWER_SORTS.some(([key]) => key === state.sort) ? state.sort : "shown";
  if (sort !== "shown") {
    rows = rows.map((row) => ({ row, value: row[sort] })).sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.row.order - b.row.order : a.value === null ? 1 : -1;
      return a.value - b.value || a.row.order - b.row.order;
    }).map((entry) => entry.row);
  }
  return { ids, qid, rows, sort };
}

function answersPanel(h, ctx, api) {
  const state = api.state;
  const { ids, qid, rows, sort } = answerRows(ctx, state);
  if (!qid) return h("p", { class: "faint" }, "The shown tests have no questions.");
  const cells = (row) => [row.item.id, row.verdict, expectText(row.question), answerText(row.answer), two(row.confidence), signed(row.margin)];
  const markdown = () => [`# Answers for question ID “${qid}”: your latest answers and expected values`, "",
    "Holds the expected values of your saved tests and the answers of your latest runs in this page session. Write-only: never an import format.", "",
    formatMarkdownTable(["Test", "Verdict", "Expected", "Answer", "Confidence", "Margin"], rows.map(cells)), ""].join("\n");
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Question ID ", h("select", { "data-action": "answers-question", onchange: (event) => { state.qid = event.target.value; api.redraw(); } },
        ids.map((id) => h("option", { value: id, selected: id === qid }, id)))),
      h("label", {}, " Sort ", h("select", { "data-action": "answers-sort", onchange: (event) => { state.sort = event.target.value; api.redraw(); } },
        ANSWER_SORTS.map(([key, label]) => h("option", { value: key, selected: key === sort }, label)))),
      h("button", { class: "btn sm ghost", "data-action": "answers-failed-only", "aria-pressed": state.failedOnly ? "true" : "false",
        onclick: () => { state.failedOnly = !state.failedOnly; api.redraw(); } }, state.failedOnly ? "Show every test" : "Show only failed checks"),
      h("button", { class: "btn sm ghost", "data-action": "answers-copy", disabled: !rows.length,
        onclick: () => { api.copy(markdown()); api.toast(`Copied the answers for ${qid}: it holds your expected values and latest answers.`); } }, "Copy answers and expectations as Markdown")),
    rows.length ? h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "answers" },
      h("thead", {}, h("tr", {}, ["test", "verdict", "expected", "answer", "confidence", "margin", ""].map((name) => h("th", {}, name)))),
      h("tbody", {}, rows.map((row) => h("tr", { "data-test": row.item.id }, cells(row).map((cell, index) => h("td", { class: index >= 4 ? "num" : index === 0 ? "mono" : "" }, cell)),
        h("td", {},
          h("button", { class: "btn sm ghost", "data-open": row.item.id, "aria-label": `Open ${row.item.id} in Build`, onclick: () => attempt(api, () => ctx.actions.open(row.item.id)) }, "Open"),
          row.item.result?.has_trace ? h("button", { class: "btn sm ghost", "data-inspect": row.item.id, "aria-label": `Inspect the latest call of ${row.item.id}`,
            onclick: () => attempt(api, () => ctx.actions.inspect(row.item.id)) }, "Inspect") : null))))))
      : h("p", { class: "faint", "data-empty": "answers" }, "No shown test's check of this question failed."),
    h("p", { class: "faint" }, "Your latest answers in this page session beside each saved test's expectation. Margin: how far the checked value (Choice: the chosen option's probability; Yes/no: P(yes); Score: the score; Box: the IoU over its floor) sits inside (+) or outside (-) its nearest bound; — when only an option is expected."));
}

// ---------- rerun change report ----------

// Records each test's latest result the first time this panel sees it. Returns { id: [attempt, ...] }.
function record(state, ctx) {
  const attempts = isObject(state.attempts) ? state.attempts : (state.attempts = {});
  for (const item of itemsOf(ctx)) {
    if (!isObject(item.result)) continue;
    const sig = stableStringify(item.result);
    const list = attempts[item.id] || (attempts[item.id] = []);
    if (list.at(-1)?.sig === sig) continue;
    const meta = metaOf(item);
    list.push({ sig, status: statusOf(item), model: typeof meta?.model === "string" ? meta.model : null, latency: finite(meta?.latency_ms), cost: finite(meta?.cost_usd),
      config: stableStringify([questionsOf(item), item.orphan_expectations ?? []]),
      checks: Object.fromEntries(checksOf(item).filter((check) => check.question !== false).map((check) => [check.id, { ok: check.ok ?? null, confidence: finite(check.confidence) }])) });
    if (list.length > MAX_ATTEMPTS) list.splice(0, list.length - MAX_ATTEMPTS);
  }
  return attempts;
}

const CHANGE = (before, now) => (before === now ? "unchanged" : before === "fail" && now === "pass" ? "fixed" : before === "pass" && now === "fail" ? "broke" : "changed");

function flips(list) {
  let count = 0;
  for (let index = 1; index < list.length; index++) {
    const a = list[index - 1], b = list[index];
    if (a.config === b.config && a.model === b.model && ["pass", "fail"].includes(a.status) && ["pass", "fail"].includes(b.status) && a.status !== b.status) count++;
  }
  return count;
}

function reportRows(ctx, attempts) {
  return shownOf(ctx).map((item) => ({ item, list: attempts[item.id] || [] }))
    .filter(({ item, list }) => list.length >= 2 && isObject(item.result) && list.at(-1).sig === stableStringify(item.result))
    .map(({ item, list }) => {
      const before = list.at(-2), now = list.at(-1);
      const ids = [...new Set([...Object.keys(before.checks), ...Object.keys(now.checks)])];
      return { id: item.id, before, now, change: CHANGE(before.status, now.status),
        broke: ids.filter((id) => before.checks[id]?.ok === true && now.checks[id]?.ok === false),
        fixed: ids.filter((id) => before.checks[id]?.ok === false && now.checks[id]?.ok === true),
        confidence: ids.filter((id) => finite(before.checks[id]?.confidence) !== null && finite(now.checks[id]?.confidence) !== null)
          .map((id) => ({ id, before: before.checks[id].confidence, now: now.checks[id].confidence })),
        latency: before.latency !== null && now.latency !== null ? now.latency - before.latency : null,
        cost: before.cost !== null && now.cost !== null ? now.cost - before.cost : null,
        edited: before.config !== now.config, model: before.model && now.model && before.model !== now.model ? `${before.model} → ${now.model}` : null };
    });
}

const latencyText = (value) => (value === null ? "—" : `${value >= 0 ? "+" : "-"}${Math.round(Math.abs(value))} ms`);
const costText = (value) => (value === null ? "—" : `${value >= 0 ? "+" : "-"}${usd(value)}`);
const flagsText = (row) => [row.edited ? "edited between runs" : "", row.model ? `model ${row.model}` : ""].filter(Boolean).join("; ") || "—";

function rerunPanel(h, ctx, api) {
  const state = api.state;
  const attempts = record(state, ctx);
  const all = reportRows(ctx, attempts);
  const rows = state.changedOnly ? all.filter((row) => row.change !== "unchanged") : all;
  const history = shownOf(ctx).filter((item) => (attempts[item.id] || []).length);
  const shifts = rows.flatMap((row) => row.confidence.map((entry) => ({ test: row.id, ...entry })));
  const markdown = () => ["# Rerun change report: your saved tests, latest run against the previous one this page session saw", "",
    formatMarkdownTable(["Test", "Before", "Now", "Change", "Newly failing", "Newly passing", "Latency change", "Spend change", "Notes"],
      rows.map((row) => [row.id, row.before.status, row.now.status, row.change, row.broke.join(", ") || "—", row.fixed.join(", ") || "—", latencyText(row.latency), costText(row.cost), flagsText(row)])),
    "", "IDs, statuses, question IDs and measured latency and spend only: no answers, expected values or check text.", ""].join("\n");
  const forget = h("button", { class: "btn sm ghost", "data-action": "forget-attempts",
    onclick: () => { state.attempts = {}; api.redraw(); api.toast("Forgot the recorded attempts; the current results are the new starting point."); } }, "Forget recorded attempts");
  if (!history.length) return h("p", { class: "faint" }, "Run tests first: the report compares each test's latest result with the previous one this panel saw in this page session.");
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("button", { class: "btn sm ghost", "data-action": "changed-only", "aria-pressed": state.changedOnly ? "true" : "false",
        onclick: () => { state.changedOnly = !state.changedOnly; api.redraw(); } }, state.changedOnly ? "Show every rerun test" : "Show only changed statuses"),
      h("button", { class: "btn sm ghost", "data-action": "copy-report", disabled: !rows.length,
        onclick: () => { api.copy(markdown()); api.toast("Copied the change report: IDs, statuses and measurements only."); } }, "Copy report as Markdown"),
      forget),
    rows.length ? h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "report" },
      h("thead", {}, h("tr", {}, ["test", "before", "now", "change", "newly failing", "newly passing", "latency change", "spend change", "notes"].map((name) => h("th", {}, name)))),
      h("tbody", {}, rows.map((row) => h("tr", { "data-change": row.id },
        h("td", { class: "mono" }, row.id), h("td", {}, row.before.status), h("td", {}, row.now.status), h("td", {}, row.change),
        h("td", { "data-broke": row.id }, row.broke.join(", ") || "—"), h("td", { "data-fixed": row.id }, row.fixed.join(", ") || "—"),
        h("td", { class: "num", "data-latency": row.id }, latencyText(row.latency)), h("td", { class: "num", "data-cost": row.id }, costText(row.cost)),
        h("td", { "data-notes": row.id }, flagsText(row)))))))
      : h("p", { class: "faint", "data-empty": "report" }, state.changedOnly ? "No rerun test changed status." : "No shown test has been rerun since this panel first saw its result."),
    shifts.length ? h("div", {}, h("h4", {}, "Confidence change per question"), h("table", { class: "table", "data-table": "confidence" },
      h("thead", {}, h("tr", {}, ["test", "question", "before", "now", "change"].map((name) => h("th", {}, name)))),
      h("tbody", {}, shifts.map((entry) => h("tr", { "data-shift": `${entry.test}/${entry.id}` }, h("td", { class: "mono" }, entry.test), h("td", { class: "mono" }, entry.id),
        h("td", { class: "num" }, two(entry.before)), h("td", { class: "num" }, two(entry.now)), h("td", { class: "num" }, signed(entry.now - entry.before))))))) : null,
    h("h4", {}, "Attempts seen in this page session"),
    h("table", { class: "table", "data-table": "history" },
      h("thead", {}, h("tr", {}, ["test", "attempts", "statuses", "pass/fail flips, same request and model"].map((name) => h("th", {}, name)))),
      h("tbody", {}, history.map((item) => {
        const list = attempts[item.id];
        return h("tr", { "data-history": item.id }, h("td", { class: "mono" }, item.id), h("td", { class: "num" }, String(list.length)),
          h("td", {}, list.map((entry) => entry.status).join(" → ")), h("td", { "data-flaky": item.id }, flips(list) >= 2 ? `${flips(list)} (flaky)` : String(flips(list))));
      }))),
    h("p", { class: "faint" }, "Results this panel saw while open in this page session, kept in the page's memory only (up to 20 per test). Confidence comes from your own answers; latency and spend are measured, not estimates. A test edited between runs answers a different request."));
}

// ---------- pass rate by question ID ----------

const RATE_SORTS = [["seen", "First seen"], ["low", "Lowest 95% lower bound first"], ["rate", "Lowest pass rate first"], ["checked", "Most checks first"]];

function rateRows(ctx, state) {
  const shown = shownOf(ctx);
  const entries = checkedEntries(shown);
  const type = TYPES.includes(state.type) ? state.type : "all";
  const rows = questionIds(shown).map((id, order) => {
    const mine = entries.filter((entry) => entry.question.id === id);
    const types = [...new Set(shown.flatMap((item) => questionsOf(item).filter((question) => question.id === id).map((question) => question.type || "no type")))].sort(compareText);
    const passed = mine.filter((entry) => entry.check.ok).length;
    const [low, high] = wilson(passed, mine.length);
    const confidence = (ok) => mean(mine.filter((entry) => entry.check.ok === ok).map((entry) => finite(entry.check.confidence)).filter((value) => value !== null));
    return { id, order, types, checked: mine.length, passed, rate: mine.length ? passed / mine.length : null, low, high, passConfidence: confidence(true), failConfidence: confidence(false),
      failing: mine.filter((entry) => entry.check.ok === false).map((entry) => entry.item.id) };
  }).filter((row) => row.checked && (type === "all" || row.types.includes(type)));
  const below = String(state.below ?? "").trim();
  const share = below === "" ? null : toNumber(below);
  const badShare = below !== "" && (share === null || share < 0 || share > 100);
  const kept = share === null || badShare ? rows : rows.filter((row) => row.rate < share / 100);
  const sort = RATE_SORTS.some(([key]) => key === state.sort) ? state.sort : "seen";
  const value = (row) => (sort === "low" ? row.low : sort === "rate" ? row.rate : sort === "checked" ? -row.checked : row.order);
  return { rows: kept.slice().sort((a, b) => value(a) - value(b) || a.order - b.order), sort, type, badShare, entries };
}

function confusionOf(ctx, qid) {
  const entries = shownOf(ctx).flatMap((item) => questionsOf(item).filter((question) => question.id === qid && question.type === "choice").map((question) => ({ item, question })));
  const pairs = entries.map(({ item, question }) => {
    const answer = checkOf(item, qid)?.answer;
    return { expected: isObject(question.expect) && typeof question.expect.choice === "string" ? question.expect.choice : null,
      chosen: isObject(answer) && answer.type === "choice" && typeof answer.choice === "string" ? answer.choice : null };
  }).filter((pair) => pair.expected !== null && pair.chosen !== null);
  const options = [];
  for (const { question } of entries) for (const criterion of Array.isArray(question.criteria) ? question.criteria : []) if (isObject(criterion) && !options.includes(criterion.key)) options.push(criterion.key);
  for (const pair of pairs) for (const key of [pair.expected, pair.chosen]) if (!options.includes(key)) options.push(key);
  return { pairs, options };
}

function ratesPanel(h, ctx, api) {
  const state = api.state;
  const { rows, sort, type, badShare, entries } = rateRows(ctx, state);
  if (!entries.length) return h("p", { class: "faint" }, "Run tests first: no shown test has a checked result in this page session.");
  const choiceIds = questionIds(shownOf(ctx)).filter((id) => shownOf(ctx).some((item) => questionsOf(item).some((question) => question.id === id && question.type === "choice")));
  const confusionId = choiceIds.includes(state.confusion) ? state.confusion : choiceIds[0] || null;
  const confusion = confusionId ? confusionOf(ctx, confusionId) : null;
  const csv = () => csvText([["question_id", "types", "checked", "passed", "pass_rate", "wilson_low", "wilson_high"],
    ...rows.map((row) => [row.id, row.types.join(" "), row.checked, row.passed, row.rate.toFixed(4), row.low.toFixed(4), row.high.toFixed(4)])]);
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Type ", h("select", { "data-action": "rates-type", onchange: (event) => { state.type = event.target.value; api.redraw(); } },
        ["all", ...TYPES].map((key) => h("option", { value: key, selected: key === type }, key === "all" ? "All types" : key)))),
      h("label", {}, " Sort ", h("select", { "data-action": "rates-sort", onchange: (event) => { state.sort = event.target.value; api.redraw(); } },
        RATE_SORTS.map(([key, label]) => h("option", { value: key, selected: key === sort }, label)))),
      h("label", {}, " Pass rate below (%) ", h("input", { type: "number", min: "0", max: "100", "data-action": "rates-below", value: state.below ?? "",
        oninput: (event) => { state.below = event.target.value; api.redraw(); } })),
      h("button", { class: "btn sm ghost", "data-action": "rates-csv", disabled: !rows.length,
        onclick: () => { api.download("jev-question-pass-rates.csv", csv(), "text/csv"); api.toast("Downloaded pass rates by question ID: counts and rates only."); } }, "Download as CSV")),
    badShare ? h("p", { class: "lab-error", role: "alert", "data-error": "below" }, "Type a share from 0 to 100, or leave it blank.") : null,
    rows.length ? h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "rates" },
      h("thead", {}, h("tr", {}, ["question ID", "types", "checked", "passed", "pass rate", "95% interval", "mean confidence, passed", "mean confidence, failed", ""].map((name) => h("th", {}, name)))),
      h("tbody", {}, rows.map((row) => h("tr", { "data-question": row.id },
        h("td", { class: "mono" }, row.id), h("td", {}, row.types.join(", ")), h("td", { class: "num" }, String(row.checked)), h("td", { class: "num" }, String(row.passed)),
        h("td", { class: "num" }, pct(row.rate)), h("td", { class: "num" }, `${pct(row.low)}–${pct(row.high)}`),
        h("td", { class: "num" }, two(row.passConfidence)), h("td", { class: "num" }, two(row.failConfidence)),
        h("td", {}, h("button", { class: "btn sm ghost", "data-select-failing": row.id, disabled: !row.failing.length, "aria-label": `Select the shown tests whose check of ${row.id} failed`,
          onclick: () => attempt(api, () => {
            ctx.actions.select(row.failing, "replace");
            api.toast(`Selected ${plural(row.failing.length, "test")} whose check of ${row.id} failed. ${UNDO}`);
          }) }, "Select failing")))))))
      : h("p", { class: "faint", "data-empty": "rates" }, "No question ID matches."),
    confusion ? h("div", {},
      h("h4", {}, "Expected option against chosen option"),
      h("label", {}, "Choice question ID ", h("select", { "data-action": "confusion-question", onchange: (event) => { state.confusion = event.target.value; api.redraw(); } },
        choiceIds.map((id) => h("option", { value: id, selected: id === confusionId }, id)))),
      confusion.pairs.length ? h("table", { class: "table", "data-table": "confusion" },
        h("thead", {}, h("tr", {}, h("th", {}, "expected \\ chosen"), confusion.options.map((key) => h("th", { class: "mono" }, key)))),
        h("tbody", {}, confusion.options.map((expected) => h("tr", {}, h("th", { class: "mono" }, expected), confusion.options.map((chosen) => h("td", { class: "num", "data-oc": `${expected}|${chosen}` },
          String(confusion.pairs.filter((pair) => pair.expected === expected && pair.chosen === chosen).length)))))))
        : h("p", { class: "faint", "data-empty": "confusion" }, "No shown test of this question has both an expected option and an answer.")) : null,
    h("p", { class: "faint" }, "Checked questions of the shown tests' latest calls in this page session, with the 95% Wilson interval; comparisons across question IDs are exploratory. Confidence comes from your own answers (Yes/no answers carry none). The CSV holds IDs, types, counts and rates only."));
}

// ---------- metrics ----------

function mixedIds(ctx) {
  const entries = checkedEntries(shownOf(ctx));
  if (!entries.length) return null;
  const ids = questionIds(shownOf(ctx)).filter((id) => {
    const oks = entries.filter((entry) => entry.question.id === id).map((entry) => entry.check.ok);
    return oks.includes(true) && oks.includes(false);
  });
  return { value: ids.length, detail: ids.length ? ids.join(", ") : "Every checked question ID passes everywhere or fails everywhere." };
}

function confidenceGap(ctx) {
  const entries = checkedEntries(shownOf(ctx)).filter((entry) => finite(entry.check.confidence) !== null);
  const passed = entries.filter((entry) => entry.check.ok).map((entry) => entry.check.confidence);
  const failed = entries.filter((entry) => !entry.check.ok).map((entry) => entry.check.confidence);
  if (!passed.length || !failed.length) return null;
  return { value: mean(passed) - mean(failed), detail: `${two(mean(passed))} on ${plural(passed.length, "passed check")}, ${two(mean(failed))} on ${plural(failed.length, "failed check")}` };
}

function oneCheckAway(ctx) {
  const run = shownOf(ctx).filter(answered);
  if (!run.length) return null;
  const ids = run.filter((item) => statusOf(item) === "fail" && checksOf(item).filter((check) => check.ok === false).length === 1).map((item) => item.id);
  return { value: ids.length, detail: ids.length ? ids.join(", ") : "No failing test misses exactly one check." };
}

function confidentFailures(ctx) {
  const entries = checkedEntries(shownOf(ctx));
  if (!entries.length) return null;
  const hits = entries.filter((entry) => !entry.check.ok && finite(entry.check.confidence) !== null && entry.check.confidence >= 0.8);
  return { value: hits.length, detail: hits.length ? hits.map((entry) => `${entry.item.id}: ${entry.question.id}`).join(", ") : "No failed check came with a confidence of 0.8 or more." };
}

function closestMiss(ctx) {
  const misses = checkedEntries(shownOf(ctx)).filter((entry) => !entry.check.ok && entry.margin !== null && entry.margin < 0);
  if (!misses.length) return null;
  const best = misses.reduce((top, entry) => (entry.margin > top.margin ? entry : top));
  return { value: -best.margin, detail: `${best.item.id}: ${best.question.id}` };
}

export default definePack({
  id: "tests-panels",
  surface: "workbench.tests.items",
  title: "Saved test result panels",
  about: "Panels for the latest results of your saved tests in this page session: one question ID's answers beside each test's expectation, a rerun change report against the previous result the panel saw, and a pass-rate table per question ID with 95% intervals, plus five metrics. Results are kept in the page's memory only; nothing here starts a run. The answers copy holds your answers and expected values and says so; the report copy and the pass-rate CSV hold IDs, statuses, counts and measurements only.",
  features: [
    { id: "question_answers", kind: "panel", title: "Answers for one question ID",
      improvements: [
        { id: "table", title: "Each shown test's expectation beside its latest answer for one question ID" },
        { id: "margin", title: "How far each answer sits inside or outside its nearest expectation bound" },
        { id: "sort", title: "Sort the answers by margin, confidence or shown order" },
        { id: "failed_only", title: "Show only the tests whose check of that question failed" },
        { id: "copy", title: "Copy the answers and expectations of one question ID as Markdown" },
      ],
      render: answersPanel },
    { id: "rerun_report", kind: "panel", title: "Rerun change report",
      improvements: [
        { id: "status_changes", title: "Each rerun test's status now against its previous result in this session" },
        { id: "regressions", title: "Question checks that passed before and fail now" },
        { id: "fixes", title: "Question checks that failed before and pass now" },
        { id: "confidence_shift", title: "Confidence change per question between the two runs" },
        { id: "measured_delta", title: "Measured latency and spend change between the two runs" },
        { id: "edited_between", title: "Flag reruns whose questions or expectations changed between runs" },
        { id: "model_changed", title: "Flag reruns answered by another model than before" },
        { id: "history", title: "Every result seen in this session per test, as a status sequence" },
        { id: "flaky", title: "Count pass/fail flips with the same request and model, and mark flaky tests" },
        { id: "changed_only", title: "Show only the rerun tests whose status changed" },
        { id: "copy", title: "Copy the change report as Markdown" },
        { id: "forget", title: "Forget the recorded attempts and start over from the current results" },
      ],
      render: rerunPanel },
    { id: "pass_rates", kind: "panel", title: "Pass rate by question ID",
      improvements: [
        { id: "table", title: "Pass rate per question ID with a 95% Wilson interval" },
        { id: "sort", title: "Sort question IDs by lower bound, pass rate or checks" },
        { id: "below", title: "Show only question IDs whose pass rate is below a typed share" },
        { id: "type_filter", title: "Narrow the pass-rate table to one question type" },
        { id: "confidence_split", title: "Mean answer confidence on passed and on failed checks per question ID" },
        { id: "option_confusion", title: "Expected option against chosen option for a Choice question ID" },
        { id: "select_failing", title: "Select the shown tests whose check of a question ID failed" },
        { id: "csv", title: "Download pass rates by question ID as CSV" },
      ],
      render: ratesPanel },
    { id: "mixed_question_ids", kind: "metric", format: "integer", label: "Question IDs that pass in one test and fail in another",
      help: "Checked question IDs of the shown tests' latest calls with at least one pass and one failure.",
      compute: mixedIds },
    { id: "confidence_gap", kind: "metric", label: "Confidence gap between passed and failed checks",
      help: "Mean answer confidence on passed checks minus that on failed checks, over the shown tests' latest calls. Near zero or negative: confidence does not tell passes from failures. Yes/no answers carry no confidence.",
      compute: confidenceGap },
    { id: "one_check_away", kind: "metric", format: "integer", label: "Failing tests one check away from passing",
      help: "Shown tests whose latest call failed exactly one check (orphan expectations included).",
      compute: oneCheckAway },
    { id: "confident_failures", kind: "metric", format: "integer", label: "Failed checks with a confidence of 0.8 or more",
      help: "Checked questions of the shown tests' latest calls that failed although the answer stated a confidence of at least 0.8.",
      compute: confidentFailures },
    { id: "closest_miss", kind: "metric", label: "Closest miss of a failed check",
      help: "The smallest distance by which a failed check's value missed its bound (probability, P(yes), score, or IoU over its floor). Option-only expectations have no distance.",
      compute: closestMiss },
  ],
});
