// Tests for static/js/lab/packs/autopilot/autopilot-bench-more.js on sampleBenchmarkCtx() (tests/js/lab/fixtures/autopilot.mjs):
//   run 1 jev-1.1: in turn 2400 ms, parallel 1300, merged 1250; tokens 5200/5200/3000; cost .00084/.00084/.00048; calls 1150/—/1240
//   run 2 jev-1.2: in turn 2000 ms, parallel 1100, merged 1000; tokens 5000/5000/2800; cost .0008/.0008/.00045; calls 950/1040/990
//   run 3 jev-1.2: in turn 1800 ms, parallel 1000, merged 1200; tokens 5000/5000/2800; cost .0008/.0008/.00045; calls 880/900/1190
// Reference values worked by hand. Time saved on jev-1.2: 1000 and 600 ms, mean 800, sample sd 200*sqrt(2), standard
// error 200; Student t(0.975, 1 df) = 12.7062047 (printed tables), so the half-width is 2541.24 ms. Merged minus parallel:
// -100 and +200, mean 50, standard error 150, half-width 1905.93 ms. With three runs t(0.975, 2 df) = 4.3026527.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/autopilot/autopilot-bench-more.js";
import { emptyBenchmarkCtx, sampleBenchmarkCtx, sampleBenchRuns } from "./fixtures/autopilot.mjs";
import { checkPack } from "./harness.mjs";

const T1 = 12.706204736174698, T2 = 4.302652729749464;
const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const empty = emptyBenchmarkCtx();
const only = (...numbers) => sampleBenchmarkCtx({ runs: sampleBenchRuns().filter((run) => numbers.includes(run.run)) });

// Three runs on one model whose merged call is 100, 110 and 90 ms faster (sign -1) or slower (+1) than parallel.
function steadyRuns(sign) {
  const mode = (wall) => ({ requests: 1, wall_ms: wall, input_tokens: 2800, cost_usd: 0.00045, questions: 21 });
  return [100, 110, 90].map((gap, index) => ({ run: index + 1, at: 1_793_000_000_000 + index, model: "jev-1.2", id: "bec-invoice",
    sequential: mode(2000), parallel: mode(1000), merged: mode(1000 + sign * gap), per_call_ms: { shield: 900, dispatch: 900, merged: 950 } }));
}

const cellsOf = (t, root, attrName, value) => t.findAll(t.find(root, attr(attrName, value)), (node) => node.tag === "td").map(t.textOf);
const colOf = (t, root, model, key) => t.textOf(t.find(t.find(root, attr("data-model", model)), attr("data-col", key)));

checkPack(pack, {
  mean_time_saved: [{ ctx: sampleBenchmarkCtx(), empty, expect: (result) => {
    assert.equal(result.value, 800);
    assert.equal(result.detail, "2 runs on jev-1.2; 95% interval -1,741 ms to 3,341 ms");   // 800 -/+ 2541.24
  } }, { ctx: only(1), expect: (result) => {
    assert.equal(result.value, 1150);
    assert.equal(result.detail, "1 run on jev-1.1; an interval needs 2 runs");
  } }],
  mean_parallel_gap: [{ ctx: sampleBenchmarkCtx(), empty, expect: (result) => {
    assert.equal(result.value, 50);
    assert.equal(result.detail, "2 runs; 95% interval -1,856 ms to 1,956 ms; no clear difference");   // 50 -/+ 1905.93
  } }, { ctx: sampleBenchmarkCtx({ runs: steadyRuns(-1) }), expect: (result) => {
    // gaps -100, -110, -90: mean -100, sd 10, half-width T2 * 10 / sqrt(3) = 24.84
    assert.equal(result.value, -100);
    assert.equal(result.detail, "3 runs; 95% interval -125 ms to -75 ms; merged faster than parallel");
  } }],
  geo_speedup: [{ ctx: sampleBenchmarkCtx(), empty, expect: Math.sqrt(2 * 1.5), tolerance: 1e-12 },   // ratios 2000/1000 and 1800/1200
    { ctx: only(1), expect: 2400 / 1250, tolerance: 1e-12 }],
  parallel_speedup: { ctx: sampleBenchmarkCtx(), empty, expect: 1.8, tolerance: 1e-12 },
  pooled_cost_share: [{ ctx: sampleBenchmarkCtx(), empty, expect: 0.4375, tolerance: 1e-9 },   // (0.0016 - 0.0009) / 0.0016
    { ctx: only(1), expect: 3 / 7, tolerance: 1e-9 }],   // (0.00084 - 0.00048) / 0.00084
  merged_spread: [{ ctx: sampleBenchmarkCtx(), empty, expect: Math.sqrt(20000), tolerance: 1e-12 },   // merged 1000 and 1200
    { ctx: only(1), expect: null }],
  latest_vs_earlier: [{ ctx: sampleBenchmarkCtx(), empty, expect: (result) => {
    assert.equal(result.value, 200);   // 1200 now against the median 1000 of run 2 (run 1 is another model)
    assert.equal(result.detail, "against the median of 1 earlier run");
  } }, { ctx: only(1, 3), expect: null }],
  merged_vs_slower_call: [{ ctx: sampleBenchmarkCtx(), empty, expect: 290 },   // 1190 - max(880, 900)
    { ctx: only(1), expect: null }],   // run 1 has no Dispatch call latency
  beats_in_turn: { ctx: sampleBenchmarkCtx(), empty, expect: (result) => {
    // 2 of 2 wins; Wilson: z = 1.959964, centre (1 + z^2/4) / (1 + z^2/2) = 0.6712, half 0.3288 -> 34% to 100%
    assert.equal(result.value, 1);
    assert.equal(result.detail, "2 of 2 runs; 95% interval 34% to 100%");
  } },
  latest_spend: { ctx: sampleBenchmarkCtx(), empty, expect: 0.00205, tolerance: 1e-9 },   // 0.0008 + 0.0008 + 0.00045
  hours_per_thousand: { ctx: sampleBenchmarkCtx(), empty, expect: 800 * 1000 / 3_600_000, tolerance: 1e-12 },

  stats_md: { ctx: sampleBenchmarkCtx(), filename: "autopilot-benchmark-stats.md",
    includes: ["Runs of different models are kept apart", "| jev-1.1 | 1 | +1,150 ms | needs 2 runs | -50 ms | needs 2 runs | 42% | 43% |",
      "| jev-1.2 | 2 | +800 ms | -1,741 ms to 3,341 ms | +50 ms | -1,856 ms to 1,956 ms | 44% | 44% |"],
    excludes: ["bec-invoice", "Roastwell"],
    check: () => assert.throws(() => pack.features.find((feature) => feature.id === "stats_md").build(empty), /Run the benchmark first/) },
  by_model_csv: { ctx: sampleBenchmarkCtx(), filename: "autopilot-benchmark-by-model.csv",
    // tokens 2200/5200 = 0.4231, cost 0.00036/0.00084 = 0.4286; bounds 800 -/+ 2541.24 and 50 -/+ 1905.93, one decimal
    text: "model,runs,mean saved ms,saved low ms,saved high ms,mean merged minus parallel ms,gap low ms,gap high ms,token saving share,cost saving share\r\n"
      + "jev-1.1,1,1150,,,-50,,,0.4231,0.4286\r\njev-1.2,2,800,-1741.2,3341.2,50,-1855.9,1955.9,0.44,0.4375\r\n" },
  per_call_csv: { ctx: sampleBenchmarkCtx(), filename: "autopilot-benchmark-calls.csv",
    text: "run,model,shield call ms,dispatch call ms,merged call ms,sequential wall ms,merged wall ms\r\n1,jev-1.1,1150,,1240,2400,1250\r\n2,jev-1.2,950,1040,990,2000,1000\r\n3,jev-1.2,880,900,1190,1800,1200\r\n" },

  savings_by_model: { improvements: {
    by_model: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.deepEqual(t.findAll(root, has("data-model")).map((row) => row.attrs["data-model"]), ["jev-1.1", "jev-1.2"]);
      assert.equal(colOf(t, root, "jev-1.1", "runs"), "1");
      assert.equal(colOf(t, root, "jev-1.2", "runs"), "2");
      assert.match(t.textOf(t.render(emptyBenchmarkCtx())), /No benchmark run yet/);
    },
    interval: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.equal(colOf(t, root, "jev-1.2", "saved"), "800 ms");
      assert.equal(colOf(t, root, "jev-1.2", "saved_interval"), "-1,741 ms to 3,341 ms");
      assert.equal(colOf(t, root, "jev-1.1", "saved"), "1,150 ms");
    },
    parallel_interval: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.equal(colOf(t, root, "jev-1.2", "gap"), "+50 ms");
      assert.equal(colOf(t, root, "jev-1.2", "gap_interval"), "-1,856 ms to 1,956 ms");
      assert.equal(colOf(t, root, "jev-1.1", "gap"), "-50 ms");
    },
    verdict: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.equal(colOf(t, root, "jev-1.2", "verdict"), "no clear difference");
      assert.equal(colOf(t, root, "jev-1.1", "verdict"), "needs 2 runs");
      assert.equal(colOf(t, t.render(sampleBenchmarkCtx({ runs: steadyRuns(-1) })), "jev-1.2", "verdict"), "merged faster than parallel");
      // +100, +110, +90: interval 100 -/+ T2 * 10 / sqrt(3) lies above zero
      assert.equal(colOf(t, t.render(sampleBenchmarkCtx({ runs: steadyRuns(1) })), "jev-1.2", "verdict"), "merged slower than parallel");
      assert.ok(T2 * 10 / Math.sqrt(3) < 90);
    },
    more_runs: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.deepEqual(t.findAll(t.find(root, has("data-more-runs")), (node) => node.tag === "li").map(t.textOf), ["Run the benchmark once more on jev-1.1 for an interval."]);
      assert.equal(t.find(t.render(sampleBenchmarkCtx({ runs: steadyRuns(1) })), has("data-more-runs")), null);
    },
    shares: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.deepEqual([colOf(t, root, "jev-1.1", "tokens"), colOf(t, root, "jev-1.1", "cost")], ["42%", "43%"]);
      assert.deepEqual([colOf(t, root, "jev-1.2", "tokens"), colOf(t, root, "jev-1.2", "cost")], ["44%", "44%"]);   // 0.44 and 0.4375
    },
  } },

  run_compare: { improvements: {
    pick: (t) => {
      const ctx = sampleBenchmarkCtx();
      const heads = () => t.findAll(t.find(t.render(ctx), (node) => node.tag === "thead"), (node) => node.tag === "th").map(t.textOf).slice(1, 3);
      assert.deepEqual(heads(), ["Run 2", "Run 3"]);   // the two latest runs by default
      t.fire(t.find(t.render(ctx), attr("data-pick", "a")), "change", { target: { value: "1" } });
      assert.deepEqual(heads(), ["Run 1", "Run 3"]);
      assert.match(t.textOf(t.render(only(2))), /Run the benchmark twice/);
    },
    diff: (t) => {
      const ctx = sampleBenchmarkCtx();
      let root = t.render(ctx);
      assert.deepEqual(cellsOf(t, root, "data-mode", "sequential"), ["2 calls, in turn", "2,000 ms", "1,800 ms", "-200 ms", "0", "$0"]);
      assert.deepEqual(cellsOf(t, root, "data-mode", "merged"), ["1 merged call", "1,000 ms", "1,200 ms", "+200 ms", "0", "$0"]);
      t.state.a = 1;
      root = t.render(ctx);
      // run 1 -> run 3: 5200 -> 5000 tokens, $0.00084 -> $0.0008
      assert.deepEqual(cellsOf(t, root, "data-mode", "sequential"), ["2 calls, in turn", "2,400 ms", "1,800 ms", "-600 ms", "-200", "-$0.00004"]);
    },
    model_warning: (t) => {
      const ctx = sampleBenchmarkCtx();
      assert.equal(t.find(t.render(ctx), has("data-model-warning")), null);
      t.state.a = 1;
      assert.equal(t.textOf(t.find(t.render(ctx), has("data-model-warning"))), "Run 1 used jev-1.1 and run 3 used jev-1.2: compare runs of the same model.");
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleBenchmarkCtx()), attr("data-copy", "compare")), "click");
      assert.deepEqual(t.env.copied, ["Benchmark run 2 (jev-1.2) against run 3 (jev-1.2), measured:\n- 2 calls, in turn: 2,000 ms -> 1,800 ms (-200 ms), tokens 0, cost $0\n"
        + "- 2 calls, parallel: 1,100 ms -> 1,000 ms (-100 ms), tokens 0, cost $0\n- 1 merged call: 1,000 ms -> 1,200 ms (+200 ms), tokens 0, cost $0\n"]);
    },
  } },

  time_split: { improvements: {
    breakdown: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      assert.deepEqual(cellsOf(t, root, "data-mode", "sequential"), ["2 calls, in turn", "1,800 ms", "1,780 ms", "20 ms"]);   // 880 + 900 on the server
      assert.deepEqual(cellsOf(t, root, "data-mode", "merged"), ["1 merged call", "1,200 ms", "1,190 ms", "10 ms"]);
      assert.equal(t.find(root, attr("data-mode", "parallel")), null);
    },
    pick_run: (t) => {
      const ctx = sampleBenchmarkCtx();
      t.fire(t.find(t.render(ctx), has("data-run-pick")), "change", { target: { value: "2" } });
      const root = t.render(ctx);
      assert.deepEqual(cellsOf(t, root, "data-mode", "sequential"), ["2 calls, in turn", "2,000 ms", "1,990 ms", "10 ms"]);
      assert.deepEqual(cellsOf(t, root, "data-mode", "merged"), ["1 merged call", "1,000 ms", "990 ms", "10 ms"]);
    },
    missing: (t) => {
      const ctx = sampleBenchmarkCtx();
      assert.equal(t.find(t.render(ctx), has("data-missing")), null);
      t.state.run = 1;
      const root = t.render(ctx);
      assert.equal(t.textOf(t.find(root, has("data-missing"))), "Not reported for run 1: Dispatch call latency.");
      assert.deepEqual(cellsOf(t, root, "data-mode", "sequential"), ["2 calls, in turn", "2,400 ms", "—", "—"]);
    },
  } },

  trend: { improvements: {
    chart: (t) => {
      const root = t.render(sampleBenchmarkCtx());
      const rows = t.findAll(root, has("data-run"));
      assert.equal(rows.length, 9);
      const bar = (run, mode) => t.textOf(t.find(rows.find((row) => row.attrs["data-run"] === run && row.attrs["data-mode"] === mode), has("data-bar")));
      // scaled to the largest wall time shown, 2400 ms = 20 blocks
      assert.equal(bar("1", "sequential").length, 20);
      assert.equal(bar("2", "sequential").length, 17);   // 2000 / 2400 * 20 = 16.67
      assert.equal(bar("1", "merged").length, 10);       // 1250 / 2400 * 20 = 10.42
      assert.deepEqual(t.findAll(rows[0], (node) => node.tag === "td").map(t.textOf).filter((text, index) => index !== 2), ["Run 1 · jev-1.1", "2 calls, in turn", "2,400 ms"]);
    },
    measure: (t) => {
      const ctx = sampleBenchmarkCtx();
      t.fire(t.find(t.render(ctx), has("data-measure")), "change", { target: { value: "input_tokens" } });
      let row = t.find(t.render(ctx), (node) => node.attrs?.["data-run"] === "2" && node.attrs?.["data-mode"] === "merged");
      assert.equal(t.textOf(t.find(row, has("data-bar"))).length, 11);   // 2800 / 5200 * 20 = 10.77
      assert.equal(t.textOf(t.findAll(row, (node) => node.tag === "td")[3]), "2,800");
      t.fire(t.find(t.render(ctx), has("data-measure")), "change", { target: { value: "cost_usd" } });
      row = t.find(t.render(ctx), (node) => node.attrs?.["data-run"] === "2" && node.attrs?.["data-mode"] === "merged");
      assert.equal(t.textOf(t.find(row, has("data-bar"))).length, 11);   // 0.00045 / 0.00084 * 20 = 10.71
      assert.equal(t.textOf(t.findAll(row, (node) => node.tag === "td")[3]), "$0.00045");
    },
    model: (t) => {
      const ctx = sampleBenchmarkCtx();
      t.fire(t.find(t.render(ctx), has("data-model")), "change", { target: { value: "jev-1.2" } });
      const rows = t.findAll(t.render(ctx), has("data-run"));
      assert.deepEqual([...new Set(rows.map((row) => row.attrs["data-run"]))], ["2", "3"]);
      // now scaled to 2000 ms
      assert.equal(t.textOf(t.find(rows.find((row) => row.attrs["data-run"] === "2" && row.attrs["data-mode"] === "sequential"), has("data-bar"))).length, 20);
      assert.equal(t.textOf(t.find(rows.find((row) => row.attrs["data-run"] === "3" && row.attrs["data-mode"] === "merged"), has("data-bar"))).length, 12);
    },
  } },
}, { ctx: () => sampleBenchmarkCtx() });

assert.ok(Math.abs(T1 * 200 - 2541.2409) < 1e-3 && Math.abs(T1 * 150 - 1905.9307) < 1e-3);
