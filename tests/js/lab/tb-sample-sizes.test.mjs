// Tests for finite-batch and stratified audit planning. Expected sizes use independent hypergeometric
// sums, Cochran's formulas, and a direct variance check when a stratum fills.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-sample-sizes.js";
import { checkPack, fakeCtx } from "./harness.mjs";

const STRATA = "retail, 8000, 0.05\nwholesale, 2000, 0.2";

checkPack(
  pack,
  {
    // 40 errors in 2,000 rows: hypergeometric P(X <= c) first at or below 0.05 at n = 143 (c = 0) and 225 (c = 1);
    // binomial at 149 and 236.
    finite_batch_audit: {
      values: { size: "2000", rate: "0.02", allowed: "0", level: "0.95" },
      expect: [
        ["Errors in the batch at that rate", 40],
        ["Rows to audit (finite batch)", 143],
        ["Rows to audit ignoring the batch size", 149],
        ["Share of the batch audited", 0.0715],
      ],
      more: [
        {
          values: { size: "2000", rate: "0.02", allowed: "1", level: "0.95" },
          expect: (result) => {
            assert.equal(result.rows[1][1], 225);
            assert.equal(result.rows[2][1], 236);
          },
        },
        {
          // One error is the smallest positive count. The chance of missing it in n draws is (100 − n)/100.
          values: { size: "100", rate: "0.000000000001", allowed: "0", level: "0.95" },
          expect: (result) => {
            assert.equal(result.rows[0][1], 1);
            assert.equal(result.rows[1][1], 95);
          },
        },
        {
          // At least two errors. The chance of missing both is 23*22/(100*99) at 77 draws and 22*21/(100*99) at 78.
          values: { size: "100", rate: "0.010000000001", allowed: "0", level: "0.95" },
          expect: (result) => {
            assert.equal(result.rows[0][1], 2);
            assert.equal(result.rows[1][1], 78);
          },
        },
        {
          // 0.14 * 100 rounds slightly above 14 in binary floating point.
          values: { size: "100", rate: "0.14", allowed: "0", level: "0.95" },
          expect: (result) => assert.equal(result.rows[0][1], 14),
        },
        {
          // Missing the single error in nine draws has probability exactly 10%.
          values: { size: "10", rate: "0.1", allowed: "0", level: "0.9" },
          expect: (result) => assert.equal(result.rows[1][1], 9),
        },
      ],
      invalid: [
        { size: "100", rate: "0.01", allowed: "1", level: "0.95" },
        { size: "100", rate: "1", allowed: "0", level: "0.95" },
      ],
    },
    // Proportional 400 · 0.8 and 400 · 0.2. Neyman 400 · 8000 √0.0475 / (8000 √0.0475 + 2000 · 0.4) = 274.19 -> 274 and 126.
    stratified_allocation: {
      values: { strata: STRATA, total: "400" },
      expect: {
        table: {
          columns: ["Stratum", "Rows", "Expected rate", "Proportional", "Neyman"],
          rows: [
            ["retail", 8000, 0.05, 320, 274],
            ["wholesale", 2000, 0.2, 80, 126],
          ],
        },
      },
      more: [
        // a and b would get 115.5 and 11.5 rows by Neyman, more than they hold: capped at 100 and 10, c takes the other 90.
        // Proportional quotas 2000/111, 200/111, 20000/111 floor to 199 rows; the extra one goes to b (largest remainder).
        {
          values: { strata: "a, 100, 0.5\nb, 10, 0.5\nc, 1000, 0.001", total: "200" },
          expect: {
            table: {
              columns: ["Stratum", "Rows", "Expected rate", "Proportional", "Neyman"],
              rows: [
                ["a", 100, 0.5, 18, 100],
                ["b", 10, 0.5, 2, 10],
                ["c", 1000, 0.001, 180, 90],
              ],
            },
          },
        },
        // Three equal strata: 33⅓ each, the spare row goes to the first line.
        {
          values: { strata: "1000, 0.1\n1000, 0.1\n1000, 0.1", total: "100" },
          expect: (result) =>
            assert.deepEqual(
              result.table.rows.map((row) => [row[0], row[3], row[4]]),
              [
                ["Stratum 1", 34, 34],
                ["Stratum 2", 33, 33],
                ["Stratum 3", 33, 33],
              ],
            ),
        },
      ],
      invalid: [
        { strata: STRATA, total: "10001" },
        { strata: "retail, 8000, 0.05", total: "10" },
        { strata: "a, 0, 0.1\nb, 10, 0.1", total: "5" },
        { strata: "a, 10, 2\nb, 10, 0.1", total: "5" },
      ],
    },
    // Cochran with V = (0.02 / 1.96)²: (Σ W S)² / (V + Σ W S² / N), Σ W S² / (V + Σ W S² / N) and p(1 − p) / (V + p(1 − p) / N).
    stratified_total: {
      values: { strata: STRATA, margin: "0.02", level: "0.95" },
      expect: [
        ["Rows with Neyman allocation", 583],
        ["Rows with proportional allocation (approximate)", 630],
        ["Rows as one simple random sample", 661],
        ["Expected overall error rate", 0.08],
      ],
      invalid: [{ strata: STRATA, margin: "0", level: "0.95" }],
    },
  },
  { ctx: () => fakeCtx({}) },
);

test("tb-sample-sizes: every tool is in the Sample sizes group", () => {
  for (const feature of pack.features) assert.equal(feature.group, "Sample sizes");
});

test("tb-sample-sizes: the stratified allocations always add up to the total", () => {
  const tool = pack.features.find((feature) => feature.id === "stratified_allocation");
  for (const total of [1, 7, 99, 401, 1110]) {
    const rows = tool.compute({ strata: "a, 100, 0.5\nb, 10, 0.5\nc, 1000, 0.001", total }).table.rows;
    assert.equal(
      rows.reduce((sum, row) => sum + row[3], 0),
      total,
    );
    assert.equal(
      rows.reduce((sum, row) => sum + row[4], 0),
      total,
    );
    rows.forEach((row) => assert.ok(row[4] <= row[1] && row[3] <= row[1]));
  }
});

test("tb-sample-sizes: the minimum Neyman total meets the margin when a stratum fills", () => {
  const strata = "high,250,0.5\nlow,1000,0.01";
  const planner = pack.features.find((feature) => feature.id === "stratified_total");
  const allocator = pack.features.find((feature) => feature.id === "stratified_allocation");
  const [[, total]] = planner.compute({ strata, margin: 0.002, level: 0.95 });
  const allocation = (total) => allocator.compute({ strata, total }).table.rows.map((row) => row[4]);
  const margin = ([high, low]) =>
    1.959963984540054 * Math.sqrt(0.2 ** 2 * 0.25 * (1 / high - 1 / 250) + 0.8 ** 2 * 0.0099 * (1 / low - 1 / 1000));

  assert.equal(total, 1109);
  assert.deepEqual(allocation(total), [250, 859]);
  assert.ok(margin(allocation(total)) <= 0.002);
  assert.ok(margin(allocation(total - 1)) > 0.002);
});

test("tb-sample-sizes: Neyman allocation samples a small stratum with nonzero spread", () => {
  const strata = "large,1000,0.5\nsmall,1,0.01";
  const planner = pack.features.find((feature) => feature.id === "stratified_total");
  const allocator = pack.features.find((feature) => feature.id === "stratified_allocation");
  const [[, total]] = planner.compute({ strata, margin: 0.5, level: 0.95 });
  // The one-row stratum is fully sampled. In the large stratum, 4 rows give a margin of 0.489 and 3 give 0.564.
  assert.equal(total, 5);
  assert.deepEqual(
    allocator.compute({ strata, total }).table.rows.map((row) => row[4]),
    [4, 1],
  );
});

test("tb-sample-sizes: large quotas round without exceeding stratum capacity", () => {
  const allocator = pack.features.find((feature) => feature.id === "stratified_allocation");
  const rows = allocator.compute({
    strata: "small,2251799813685246,0\nlarge,6755399441055744,0",
    total: 9007199254740990,
  }).table.rows;
  for (const [, size, , proportional, neyman] of rows) {
    assert.equal(proportional, size);
    assert.equal(neyman, size);
  }
});
