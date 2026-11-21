import assert from "node:assert/strict";
import { test } from "node:test";
import { compareScorePayload, mergeCompareRetry } from "../../static/js/compare-retry.js";
import { workbenchSource } from "./workbench-source.mjs";

const body = (name) =>
  workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

function retryHarness({ confirmSpend = async () => true, retry, wide = false } = {}) {
  const criteria = { yes: "Yes", no: "No" };
  if (wide) {
    for (let i = 0; i < 253; i++) criteria[`choice-${i}-${"x".repeat(96)}`] = `Choice ${i}`;
  }
  const question = { type: "choice", criteria };
  const other = { type: "noul", instructions: "Has a value?" };
  const variants = [
    { questions: { q: { ...question, instructions: "A" }, other }, model: "", perturb: null, average_orders: false },
    { questions: { q: { ...question, instructions: "B" }, other }, model: "", perturb: "typos", average_orders: true },
  ];
  const tuning = wide ? 199 : 1;
  const rows = Array.from({ length: tuning }, (_, i) => ({ text: `original ${i}`, _expect: { q: "yes" } }));
  rows.push({ text: "held", _test: true });
  const version = "jev-1.14.0";
  const probabilities = (yes, no) => Object.fromEntries(Object.keys(criteria).map((k) => [k, { yes, no }[k] ?? 0]));
  const call = (choice, probs, noul, latency, tokens, cost, extra = {}) => ({
    answers: { q: { type: "choice", choice, probabilities: probs }, other: { type: "noul", noul } },
    picks: { q: choice, other: noul >= 0.5 ? "yes" : "no" },
    meta: { latency_ms: latency, input_tokens: tokens, output_tokens: 1, cost_usd: cost, model: version },
    ...extra,
  });
  const a = call("yes", probabilities(0.9, 0.1), 0.6, 3, 5, 2);
  const b = call("yes", probabilities(0.8, 0.2), 0.7, 4, 6, 3, { input: { text: "orignal" } });
  const reversed = call("no", probabilities(0.4, 0.6), 0.1, 6, 7, 4);
  const skipped = { skipped: true };
  const calls = Array.from({ length: tuning }, () => [a, b, reversed]).flat();
  calls[calls.length - 1] = skipped;
  const empty = (qid) => ({ qid, answered: 0, changed: 0, rate: null, low: null, high: null });
  const initial = {
    variants: variants.map((v, i) => ({
      ...v,
      model: "jev-latest",
      cost_usd: i ? tuning * 3 + (tuning - 1) * 4 : tuning * 2,
      input_tokens: i ? tuning * 6 + (tuning - 1) * 7 : tuning * 5,
      orders: i ? [empty("q")] : null,
    })),
    calls,
    retry: { models: calls.map((c) => c.meta?.model ?? null), token: "signed" },
    results: rows.slice(0, tuning).map(({ _expect: expect, ...row }, index) => ({
      index,
      row,
      expect,
      runs: [a, index + 1 === tuning ? { input: b.input, skipped: true, meta: b.meta } : b],
    })),
    agreement: [empty("q"), empty("other")],
    wall_ms: 42,
  };
  const attempt = {
    updates: [[calls.length - 1, reversed]],
    retry: null,
    wall_ms: 18,
    retry_error: null,
    stopped: null,
  };
  const W = {
    compare: {
      result: null,
      variants: variants.map((v) => ({
        text: JSON.stringify(v.questions),
        model: v.model,
        perturb: v.perturb,
        average: v.average_orders,
      })),
      sliceField: "channel",
    },
    bulk: { rowsText: JSON.stringify(rows) },
  };
  const requests = [];
  const scored = [];
  const errors = [];
  const statuses = { model: "jev-latest" };
  const args = {
    W,
    currentStatus: () => statuses,
    compareVariants: () => variants,
    rowsPayload: JSON.parse,
    confirmSpend: (_api, kind, data) => {
      requests.push({ path: kind, data });
      return confirmSpend(kind, data);
    },
    api: async (path, data) => {
      requests.push({ path, data });
      return path.endsWith("/retry") ? (retry?.(attempt) ?? attempt) : initial;
    },
    render: () => {},
    chooseCmpQuestion: () => "q",
    rescoreCompare: () => scored.push(W.compare.result),
    handleError: (e) => errors.push(e.message),
    mergeCompareRetry,
    toast: (message) => errors.push(message),
  };
  const methods = [
    "compareEditorKey",
    "compareDraftMatches",
    "compareRetryBody",
    "runCompare",
    "retryCompare",
    "cmpQuestions",
  ];
  const fns = new Function(...Object.keys(args), `${methods.map(body).join("\n")}\nreturn { ${methods.join(", ")} };`)(
    ...Object.values(args),
  );
  return { ...fns, W, statuses, rows, initial, attempt, requests, scored, errors };
}

test("Compare retries the frozen request and rescoring keeps the current question and slice", async () => {
  const x = retryHarness();
  await x.runCompare();
  x.W.compare.sliceField = "channel";
  x.W.compare.qid = "other"; // This question has no labels, while q does.
  await x.retryCompare();
  const [preview, paid] = x.requests.slice(-2);
  assert.equal(preview.path, "compare_retry");
  assert.equal(paid.path, "/api/workbench/compare/retry");
  assert.equal(preview.data, paid.data);
  assert.deepEqual(paid.data, {
    rows: x.rows,
    variants: x.initial.variants.map(({ questions, model, perturb, average_orders }) => ({
      questions,
      model,
      perturb,
      average_orders,
    })),
    retry: x.initial.retry,
  });
  const result = x.W.compare.result;
  assert.deepEqual(x.scored, [x.initial, result]);
  assert.equal(x.W.compare.sliceField, "channel");
  assert.equal(x.W.compare.qid, "other");
  assert.equal(x.compareRetryBody(), null, "the completed report has no calls to retry");
  assert.equal(result.wall_ms, 60);
  assert.equal(result.cost_usd, 9);
  assert.deepEqual(
    result.variants.map((v) => [v.completed, v.input_tokens, v.latency_ms_median]),
    [
      [1, 5, 3],
      [1, 13, 6],
    ],
  );
  assert.deepEqual(
    result.agreement.map((a) => [a.answered, a.changed]),
    [
      [1, 0],
      [1, 0],
    ],
  );
  assert.equal(result.variants[1].orders[0].changed, 1);
  const averaged = result.results[0].runs[1];
  assert.equal(averaged.input, x.initial.calls[1].input);
  assert.equal(averaged.answers.other, x.initial.calls[1].answers.other);
  assert.equal(averaged.answers.q.choice, "yes");
  assert.ok(Math.abs(averaged.answers.q.probabilities.yes - 0.6) < 1e-12);
  assert.ok(Math.abs(averaged.answers.q.confidence - 0.2) < 1e-12);
});

test("Compare can retry a partial report larger than the server request limit", async () => {
  const x = retryHarness({ wide: true });
  await x.runCompare();
  assert.ok(Buffer.byteLength(JSON.stringify(x.initial.calls)) > 12 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(x.compareRetryBody())) < 100 * 1024);
  await x.retryCompare();
  const result = x.W.compare.result;
  assert.equal(result.results[0], x.initial.results[0], "unaffected rows keep their original results");
  assert.equal(result.results.at(-1).runs[1].answers.q.choice, "yes");
  assert.equal(result.calls.length, 0);
});

test("Compare refreshes pairing and slices when a recovered call would push raw scoring over the body limit", async () => {
  const { initial, attempt } = retryHarness({ wide: true });
  const cap = 12 * 1024 * 1024;
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
  const legacy = () => ({
    rows: initial.results.map((r) => ({
      index: r.index,
      row: r.row,
      label: r.expect.q,
      answers: r.runs.map((run) => run.answers?.q ?? null),
    })),
  });
  const padding = Math.floor((cap - bytes(legacy())) / initial.results.length) - 40;
  assert.ok(padding > 0);
  for (const r of initial.results) r.row.detail = "x".repeat(padding);
  const raw = legacy();
  assert.ok(bytes(raw) < cap);
  const merged = mergeCompareRetry(initial, attempt);
  raw.rows.at(-1).answers[1] = merged.results.at(-1).runs[1].answers.q;
  assert.ok(bytes(raw) > cap);

  const W = { compare: { result: merged, qid: "q", sliceField: "channel" } };
  const requests = [];
  const api = async (path, payload) => {
    requests.push(path);
    assert.ok(bytes(payload) < cap);
    assert.equal(payload.option_keys.length, 255);
    assert.ok(Array.isArray(payload.rows.at(-1).answers[1]));
    if (path.endsWith("/slices")) assert.equal(payload.rows[0].row, merged.results[0].row);
    else assert.ok(!Object.hasOwn(payload.rows[0], "row"));
    return { paired_rows: payload.rows.length };
  };
  const rescore = new Function(
    "W",
    "api",
    "compareScorePayload",
    `let cmpSeq = 0; ${body("rescoreCompare")} return rescoreCompare;`,
  )(W, api, compareScorePayload);
  await rescore();
  assert.deepEqual(requests, ["/api/workbench/compare/score", "/api/workbench/compare/slices"]);
  assert.equal(W.compare.report?.paired_rows, 199, W.compare.reportError);
  assert.equal(W.compare.slices?.paired_rows, 199, W.compare.slicesError);
});

test("Compare counts incompatible retry spend across multiple attempts", () => {
  const { initial, attempt } = retryHarness();
  const failed = {
    ...attempt,
    updates: [[2, { error: "Incompatible version", discarded: { input_tokens: 12, cost_usd: 8 } }]],
    retry: initial.retry,
    retry_error: "Incompatible version",
  };
  const partial = mergeCompareRetry(initial, failed);
  assert.equal(partial.cost_usd, 13);
  assert.equal(partial.variants[1].input_tokens, 18);
  assert.equal(partial.variants[1].completed, 0);
  assert.equal(partial.calls[0], initial.calls[0]);
  const finished = mergeCompareRetry(partial, attempt);
  assert.equal(finished.cost_usd, 17);
  assert.equal(finished.variants[1].input_tokens, 25);
  assert.equal(finished.variants[1].errors, 0);
  assert.equal(finished.variants[1].completed, 1);
});

test("Compare blocks a stale retry before spend and serializes paid clicks", async () => {
  let finish;
  const x = retryHarness({
    confirmSpend: (kind) =>
      kind === "compare"
        ? true
        : new Promise((resolve) => {
            finish = resolve;
          }),
  });
  await x.runCompare();
  const pending = x.retryCompare();
  await x.retryCompare();
  await x.runCompare();
  x.W.compare.variants[1].average = false;
  finish(true);
  await pending;
  assert.deepEqual(
    x.requests.map((r) => r.path),
    ["compare", "/api/workbench/compare", "compare_retry"],
  );
  assert.equal(x.W.compare.result, x.initial);
  assert.equal(x.compareRetryBody(), null);
  assert.match(x.errors[0], /comparison changed/);
  x.W.compare.variants[1].average = true;
  x.statuses.model = "jev-1.15.0";
  assert.deepEqual(
    x.compareRetryBody().variants.map((v) => v.model),
    ["jev-latest", "jev-latest"],
  );
});

test("Compare preserves the previous report if retry fails", async () => {
  const x = retryHarness({
    retry: () => {
      throw new Error("Connection lost");
    },
  });
  await x.runCompare();
  await x.retryCompare();
  assert.equal(x.W.compare.result, x.initial);
  assert.deepEqual(x.scored, [x.initial]);
  assert.deepEqual(x.errors, ["Connection lost"]);
  assert.equal(x.W.compare.running, false);
});

function handoffHarness(api, confirm = () => true) {
  const questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const source = [
    { text: "held", _test: true, _expect: { urgent: true } },
    { text: "duplicate" },
    { text: "duplicate", _expect: { urgent: false } },
  ];
  const prepared = {
    items: [{ index: 1, row: { text: "duplicate" }, missing: ["urgent"] }],
    questions,
    eligible: 1,
    missing: 1,
    fields: [],
    values: [],
    field: null,
    value: null,
  };
  const W = {
    tab: "compare",
    questions: ["old"],
    result: { old: true },
    compare: {
      qid: "urgent",
      sourceText: JSON.stringify(source),
      result: { variants: [{ questions }], results: [] },
      report: { disagreements: [{ index: 0, answers: ["secret answer"] }] },
    },
    bulk: {
      rowsText: "current",
      savedText: "saved",
      source: "sample",
      dataset: { id: "retained" },
      labelsDirty: true,
      labels: { 0: { urgent: true } },
      prelabel: { drafts: { 0: { urgent: false } } },
      health: { report: { old: true } },
    },
  };
  const location = {};
  const messages = [];
  const fn = new Function(
    "W",
    "api",
    "canon",
    "rowsPayload",
    "fromQuestions",
    "toQuestions",
    "confirm",
    "render",
    "toast",
    "handleError",
    "loadPictureUrls",
    "location",
    "syncAttachedSets",
    "$",
    "applyBuildQuestions",
    body("handoffCompareDisagreements") + "; return handoffCompareDisagreements;",
  )(
    W,
    (path, data) => api(path, data, prepared),
    JSON.stringify,
    JSON.parse,
    (q) => q,
    (q) => q,
    confirm,
    () => {},
    (text) => messages.push(text),
    (error) => {
      throw error;
    },
    async () => {},
    location,
    () => {},
    () => null,
    (q) => {
      W.questions = q;
      W.result = null;
      W.raw = false;
      return true;
    },
  );
  return { W, fn, prepared, source, location, messages };
}

test("handoff sends only source inputs/schema/indices and opens blank controls against full original rows", async () => {
  const calls = [];
  const x = handoffHarness(async (path, data, prepared) => {
    calls.push({ path, data });
    return prepared;
  });
  await x.fn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workbench/compare/labeling");
  assert.deepEqual(Object.keys(calls[0].data).sort(), ["indices", "qid", "questions", "rows"]);
  assert.ok(!JSON.stringify(calls).includes("secret answer"));
  assert.deepEqual(JSON.parse(x.W.bulk.rowsText), x.source);
  assert.equal(x.W.bulk.savedText, "saved", "does not mark the rows saved");
  assert.equal(x.W.bulk.dataset.id, "retained");
  assert.equal(x.W.bulk.result, null);
  assert.deepEqual(x.W.bulk.prelabel.drafts, {});
  assert.deepEqual(x.W.bulk.prelabel.report, x.prepared);
  assert.equal(x.W.bulk.prelabel.context, JSON.stringify([x.W.bulk.rowsText, x.prepared.questions, false]));
  assert.equal(x.location.hash, "bulk");
});

test("canceling handoff preserves Build, editor labels, and unfinished drafts", async () => {
  const x = handoffHarness(
    async (_, __, prepared) => prepared,
    () => false,
  );
  const before = JSON.parse(JSON.stringify({ questions: x.W.questions, bulk: x.W.bulk }));
  await x.fn();
  assert.deepEqual({ questions: x.W.questions, bulk: x.W.bulk }, before);
  assert.equal(x.W.tab, "compare");
});

test("pending handoff is rejected when rows, question schema or drafts changed", async () => {
  for (const change of [
    (x) => {
      x.W.bulk.rowsText = "new row edit";
    },
    (x) => {
      x.W.questions = ["new question edit"];
    },
    (x) => {
      x.W.bulk.prelabel.drafts[0].urgent = true;
    },
  ]) {
    let finish;
    let confirmed = false;
    const x = handoffHarness(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      () => {
        confirmed = true;
        return true;
      },
    );
    const pending = x.fn();
    change(x);
    const changed = JSON.parse(JSON.stringify({ questions: x.W.questions, bulk: x.W.bulk }));
    finish(x.prepared);
    await pending;
    assert.equal(confirmed, false);
    assert.deepEqual({ questions: x.W.questions, bulk: x.W.bulk }, changed);
  }
});

test("already labeled disagreements leave the current editor untouched", async () => {
  const x = handoffHarness(async () => ({ items: [] }));
  await x.fn();
  assert.equal(x.W.bulk.rowsText, "current");
  assert.match(x.messages[0], /already have labels/);
});

test("Compare slice controls retain full value identity behind display truncation", () => {
  const report = {
    fields: [{ name: "channel" }],
    field: "channel",
    slices: [
      {
        value: "full-value-A",
        shown: "full…",
        rows: 1,
        paired: { rows: 1, p_value: 1 },
        variants: Array.from({ length: 2 }, () => ({
          correct: 1,
          labeled: 1,
          accuracy: 1,
          accuracy_low: 0.2,
          accuracy_high: 1,
          targets: [{ target: 0.95, threshold: null, coverage: null }],
        })),
      },
    ],
  };
  const h = (tag, attrs, ...children) => ({
    tag,
    attrs,
    children: children.flat(Infinity).filter((child) => child != null),
    addEventListener() {},
  });
  const fn = new Function(
    "W",
    "h",
    "rescoreCompare",
    "render",
    "pct",
    "withCI",
    body("compareSlices") + "; return compareSlices;",
  )(
    { compare: { slices: report } },
    h,
    async () => {},
    () => {},
    String,
    (value) => value,
  );
  const text = JSON.stringify(fn());
  assert.match(text, /full-value-A/);
  assert.match(text, /full…/);
  assert.match(text, /not reached/);
});
