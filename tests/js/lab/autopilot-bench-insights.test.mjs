import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/autopilot/autopilot-bench-insights.js";
import { emptyBenchmarkCtx, sampleBenchRuns, sampleBenchmarkCtx } from "./fixtures/autopilot.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's three runs: run 1 on jev-1.1 (no dispatch latency), runs 2 and 3 on jev-1.2. The latest is run 3:
// in turn 1800 ms / 5000 tokens / $0.0008 / 2 requests, parallel 1000 ms, merged 1200 ms / 2800 tokens / $0.00045 / 1
// request / 21 questions; per call: shield 880, dispatch 900, merged 1190.
const [run1, run2] = sampleBenchRuns();
const ctx = () => sampleBenchmarkCtx();
const runsOnly = (...runs) => sampleBenchmarkCtx({ runs });
const empty = emptyBenchmarkCtx();
const one = (expect, more = []) => [{ ctx: ctx(), expect, tolerance: 1e-9 }, ...more, { ctx: empty, expect: null, empty }];
// A panel renders a node or a list of nodes; wrap it so the tree helpers can walk it.
const panel = (t, c) => ({ tag: "div", attrs: {}, children: [t.render(c)].flat() });
// A run 4 of run 2 with some modes replaced, for edge cases (zero denominators, missing numbers, an unknown model).
const variant = (patch) => ({ ...run2, run: 4, ...patch });
const mode = (requests, wall, tokens, cost, questions = 21) => ({ requests, wall_ms: wall, input_tokens: tokens, cost_usd: cost, questions });

checkPack(pack, {
  token_saving_share: one(0.44, [{ ctx: runsOnly(run1), expect: 2200 / 5200 }, { ctx: runsOnly(variant({ sequential: mode(2, 2000, 0, 0.0008) })), expect: null }]),
  time_saved: one(600, [{ ctx: runsOnly(run1), expect: 1150 }]),
  merged_minus_parallel: one(200, [{ ctx: runsOnly(run2), expect: -100 }]),
  speedup: one(1.5, [{ ctx: runsOnly(run2), expect: 2 }, { ctx: runsOnly(variant({ merged: mode(1, 0, 2800, 0.00045) })), expect: null }]),
  // 0.0008 - 0.00045 and, for run 1, 0.00084 - 0.00048.
  cost_saved: one(0.00035, [{ ctx: runsOnly(run1), expect: 0.00036 }]),
  merged_cost_thousand: one(0.45, [{ ctx: runsOnly(run1), expect: 0.48 }]),
  merged_call_latency: one(1190, [{ ctx: runsOnly(run1), expect: 1240 }, { ctx: runsOnly(variant({ per_call_ms: { shield: 1, dispatch: 2, merged: null } })), expect: null }]),
  separate_latency: one(1780, [{ ctx: runsOnly(run1), expect: null }]),
  tokens_per_question: one(2800 / 21, [{ ctx: runsOnly(variant({ merged: mode(1, 1000, 2600, 0.00045, 26) })), expect: 100 },
    { ctx: runsOnly(variant({ merged: mode(1, 1000, 2600, 0.00045, 0) })), expect: null }]),
  run_count: one(3, [{ ctx: runsOnly(run2), expect: 1 }]),
  // (0.00084 + 0.00084 + 0.00048) + 2 × (0.0008 + 0.0008 + 0.00045) = 0.00216 + 0.0041
  session_spend: one(0.00626, [{ ctx: runsOnly(run2, variant({ sequential: mode(2, 1, 1, null), parallel: mode(2, 1, 1, 0.0008), merged: mode(1, 1, 1, null) })), expect: 0.00285 },
    { ctx: runsOnly(variant({ sequential: mode(2, 1, 1, null), parallel: mode(2, 1, 1, null), merged: mode(1, 1, 1, null) })), expect: null }]),
  model_count: one(2, [{ ctx: runsOnly(run2), expect: 1 }, { ctx: runsOnly(run2, { ...run1, run: 5, model: null }), expect: 2 }]),
  median_merged: one(1100, [{ ctx: runsOnly(run1), expect: (result) => { assert.equal(result.value, 1250); assert.equal(result.detail, "1 run on jev-1.1"); } }]),
  median_sequential: one(1900, [{ ctx: runsOnly(run1, run2), expect: 2000 }]),
  merged_beats_parallel: one(0.5, [{ ctx: runsOnly(run1), expect: 1 }]),

  runs_csv: { ctx: runsOnly(run2), filename: "autopilot-benchmark.csv",
    text: '"run","model","email","sequential ms","sequential input tokens","sequential cost usd","sequential requests","parallel ms","parallel input tokens","parallel cost usd","parallel requests","merged ms","merged input tokens","merged cost usd","merged requests"\r\n'
      + '"2","jev-1.2","bec-invoice","2000","5000","0.0008","2","1100","5000","0.0008","2","1000","2800","0.00045","1"\r\n' },
  latest_json: { ctx: ctx(), filename: "autopilot-benchmark-latest.json", includes: ['"run": 3', '"model": "jev-1.2"'],
    check: (out) => { const run = JSON.parse(out.text); assert.equal(run.merged.input_tokens, 2800); assert.deepEqual(run.per_call_ms, { shield: 880, dispatch: 900, merged: 1190 }); } },
  summary_md: { ctx: ctx(), filename: "autopilot-benchmark.md",
    includes: ["## Autopilot benchmark, run 3 (jev-1.2)", "| 2 calls, in turn | 1800 ms | 5,000 | $0.00080 | 2 |", "| 2 calls, parallel | 1000 ms | 5,000 | $0.00080 | 2 |",
      "| 1 merged call | 1200 ms | 2,800 | $0.00045 | 1 |", "Measured by your own run"] },
  // 100 emails × (5000 - 2800) tokens = 220,000 tokens a day; at $0.50 per million that is $0.11 a day and $3.30 in 30 days.
  merge_savings: { values: { separate: 5000, merged: 2800, price: 0.5 },
    expect: [["Tokens saved per email", 2200], ["Tokens saved per day", 220000], ["Dollars saved per day (projection)", 0.11], ["Dollars saved per 30 days (projection)", 3.3]],
    tolerance: 1e-9,
    more: [{ values: { emails: 0, separate: 10, merged: 4, price: 2 }, expect: [["Tokens saved per email", 6], ["Tokens saved per day", 0], ["Dollars saved per day (projection)", 0], ["Dollars saved per 30 days (projection)", 0]] },
      { values: { emails: 10, separate: 100, merged: 150, price: 1 }, expect: (result) => { assert.equal(result.rows[0][1], -50); assert.match(result.note, /more tokens/); } }],
    invalid: [{ emails: 10, merged: 1, price: 1 }, { emails: -1, separate: 1, merged: 1, price: 1 }, { emails: 1.5, separate: 1, merged: 1, price: 1 }] },
  history: { improvements: {
    table: (t) => {
      const tree = panel(t, ctx());
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-run"]).map((node) => node.attrs["data-run"]), ["1", "2", "3"]);
      assert.ok(t.textOf(t.find(tree, (node) => node.attrs?.["data-run"] === "3")).includes("1200 ms"));
      assert.match(t.textOf(panel(t, emptyBenchmarkCtx())), /No benchmark run yet/);
    },
    other_model: (t) => {
      const tree = panel(t, ctx());
      const marked = t.findAll(tree, (node) => node.attrs?.["data-run"] && t.textOf(node).includes("other model")).map((node) => node.attrs["data-run"]);
      assert.deepEqual(marked, ["1"]);
    },
    fastest: (t) => {
      const tree = panel(t, ctx());
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-run"] && t.textOf(node).includes("fastest merged")).map((node) => node.attrs["data-run"]), ["2"]);
      assert.deepEqual(t.findAll(tree, (node) => node.attrs?.["data-fastest"] === "true").map((node) => node.attrs["data-run"]), ["2"]);
    },
  } },
}, { ctx: () => sampleBenchmarkCtx() });
