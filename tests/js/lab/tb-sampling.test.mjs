// Tests for the tb-sampling Toolbox pack. Counts, quotas, fold sizes and probabilities were worked out by hand (the
// fractions are written next to each case). Which lines a seed picks comes from the reference generator below: the
// published mulberry32, Fisher-Yates and Floyd algorithms written out here, independently of the pack and of
// static/js/lab/lib/math.js, so a case states the exact lines a seed must give.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-sampling.js";
import { runTool } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";

// ---------- reference randomness ----------

// mulberry32 as published by Tommy Ettinger: a |= 0; a = a + 0x6D2B79F5 | 0; t = imul(a ^ a >>> 15, 1 | a);
// t = t + imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 2^32.
function ref(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Durstenfeld's Fisher-Yates over 0..n-1, from the last position down.
function refOrder(n, seed) {
  const r = ref(seed), a = Array.from({ length: n }, (x, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const s = a[i]; a[i] = a[j]; a[j] = s; }
  return a;
}
// Floyd's sample of k from 0..n-1, ascending.
function refFloyd(n, k, seed) {
  const r = ref(seed), s = new Set();
  for (let top = n - k; top < n; top++) { const pick = Math.floor(r() * (top + 1)); s.add(s.has(pick) ? top : pick); }
  return [...s].sort((x, y) => x - y);
}

const L = (...values) => values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join("\n");
const SEEDED = (seed) => `Seed ${seed}: the same seed and lines give the same result.`;
const near = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-12, `${label}: expected ${b}, got ${a}`);

// Ten lines in three classes: A at 1, 3, 5, 7, 10; B at 2, 6, 9; C at 4, 8.
const TEN = L("l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10");
const TEN_LABELS = L("A", "B", "A", "C", "A", "B", "A", "C", "B", "A");
const TEN_CLASS = [..."ABACABACBA"];
// The first quota of each class in the reference order of all ten lines, in line order.
const takeRef = (n, classes, quotas, seed) => {
  const taken = {}, out = [];
  for (const i of refOrder(n, seed)) { const c = classes[i]; taken[c] = (taken[c] || 0) + 1; if (taken[c] <= (quotas[c] || 0)) out.push(i); }
  return out.sort((a, b) => a - b);
};

// Bulk rows by channel: email at 1, 3, 5, 8, 9; chat at 2; phone at 4, 6, 7; line 10 has no channel.
const CHANNELS = ["email", "chat", "email", "phone", "email", "phone", "phone", "email", "email", null];
const CHANNEL_ROWS = L(...CHANNELS.map((channel, i) => (channel ? { text: `m${i + 1}`, channel } : { text: `m${i + 1}` })));

checkPack(pack, {
  sample_lines: {
    // Five nonblank lines, the second pasted line blank: items a b c d e sit on lines 1, 3, 4, 5, 6.
    values: { lines: "a\n\nb\nc\nd\ne", n: "2", seed: "7" },
    expect: (result) => {
      const items = ["a", "b", "c", "d", "e"], numbers = [1, 3, 4, 5, 6], picks = refFloyd(5, 2, 7);
      assert.equal(result.text, picks.map((i) => items[i]).join("\n"));
      assert.equal(result.note, `2 of 5 lines: lines ${picks.map((i) => numbers[i]).join(", ")}. ${SEEDED(7)}`);
    },
    more: [{ values: { lines: "a\nb\nc", n: "3", seed: "99" }, expect: { text: "a\nb\nc" } }],
    invalid: [{ lines: "a\nb", n: "3" }, { lines: " \n ", n: "1" }, { lines: "a", n: "1", seed: "-1" }],
  },
  shuffle_lines: {
    values: { lines: "a\nb\nc\nd\ne", seed: "3" },
    expect: (result) => {
      assert.equal(result.text, refOrder(5, 3).map((i) => "abcde"[i]).join("\n"));
      assert.equal(result.note, `5 lines reordered. ${SEEDED(3)}`);
    },
    more: [{ values: { lines: "only", seed: "8" }, expect: { text: "only" } }],
    invalid: [{ lines: "" }],
  },
  stratified_proportional: {
    // n = 5: A 5·5/10 = 2.5, B 1.5, C 1; floors 2, 1, 1 and the one left goes to the remainders' tie A/B: A (earlier).
    values: { lines: TEN, labels: TEN_LABELS, n: "5", seed: "4" },
    expect: (result) => {
      assert.deepEqual(result.table, { columns: ["Class", "Lines", "Drawn"], rows: [["A", 5, 3], ["B", 3, 1], ["C", 2, 1]] });
      assert.equal(result.text, takeRef(10, TEN_CLASS, { A: 3, B: 1, C: 1 }, 4).map((i) => `l${i + 1}`).join("\n"));
      assert.equal(result.note, `5 of 10 lines across 3 classes. ${SEEDED(4)}`);
    },
    // n = 2: A 1 (remainder 0), B 0.6, C 0.4: the one left goes to B, so C gets none.
    more: [{ values: { lines: TEN, labels: TEN_LABELS, n: "2", seed: "4" }, expect: (result) => {
      assert.deepEqual(result.table.rows, [["A", 5, 1], ["B", 3, 1], ["C", 2, 0]]);
      assert.match(result.note, /Too small for a line at this size: C\./);
    } }],
    invalid: [{ lines: TEN, labels: "A\nB", n: "2" }, { lines: TEN, labels: TEN_LABELS, n: "11" }, { lines: "a\n\nc", labels: "A\nB\nC", n: "1" },
      { lines: "a\nb", labels: "A\n ", n: "1" }],
  },
  stratified_equal: {
    values: { lines: TEN, labels: TEN_LABELS, perClass: "3", seed: "6" },
    expect: (result) => {
      assert.deepEqual(result.table.rows, [["A", 5, 3], ["B", 3, 3], ["C", 2, 2]]);
      assert.equal(result.text, takeRef(10, TEN_CLASS, { A: 3, B: 3, C: 2 }, 6).map((i) => `l${i + 1}`).join("\n"));
      assert.equal(result.note, `8 lines from 3 classes. Fewer than 3 lines, all taken: C. ${SEEDED(6)}`);
    },
    more: [{ values: { lines: "x\ny", labels: "P\nQ", perClass: "1" }, expect: { text: "x\ny" } }],
    invalid: [{ lines: "a", labels: "A", perClass: "0" }],
  },
  holdout_split: {
    // x x y z, half held out: two lines each side. The groups x, y, z in a seeded order; the first way to reach 2 is
    // the x pair unless both singles come before it, then y and z.
    values: { lines: "x\nx\ny\nz", share: "0.5", seed: "1", identity: "exact" },
    expect: (result) => {
      const order = refOrder(3, 1), xLast = order[2] === 0;
      assert.deepEqual(result.rows, [["Held-out lines", 2], ["Tuning lines", 2], ["Held-out share", 0.5]]);
      const side = xLast ? ["tuning", "tuning", "held out", "held out"] : ["held out", "held out", "tuning", "tuning"];
      assert.deepEqual(result.table, { columns: ["Line", "Side"], rows: side.map((s, i) => [i + 1, s]) });
      assert.equal(result.text, xLast ? "y\nz" : "x\nx");
    },
    more: [
      // Eight singles, a quarter: target 2 exactly.
      { values: { lines: "a\nb\nc\nd\ne\nf\ng\nh", share: "0.25", identity: "none" }, expect: (result) => assert.deepEqual(result.rows.slice(0, 2), [["Held-out lines", 2], ["Tuning lines", 6]]) },
      // Groups of 3, 1, 1 and a quarter of 5 (1.25): one alone is 1, below the two each side needs, so 2.
      { values: { lines: "q\nq\nq\nr\ns\nt", share: "0.25", identity: "exact" }, expect: (result) => assert.deepEqual(result.rows[0], ["Held-out lines", 2]) },
    ],
    // a a a b: holding out the triple leaves one line, holding out b holds one: no split works.
    invalid: [{ lines: "a\na\na\nb", share: "0.5", identity: "exact" }, { lines: "a\nb\nc\nd", share: "0" }, { lines: "a\nb\nc\nd", share: "1" }, { lines: "a\nb\nc", share: "0.5" }],
  },
  three_way_split: {
    // a a b c d e f g h i, 20% validation and 20% test: targets 6, 2, 2. The pair goes first, to tuning; the singles in
    // the seeded order then go tuning, tuning, tuning (a three-way tie at 2 goes to tuning), validation, test, tuning
    // (tie at 1), validation, test.
    values: { lines: L("a", "a", "b", "c", "d", "e", "f", "g", "h", "i"), validation: "0.2", test: "0.2", seed: "12", identity: "exact" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Tuning lines", 6], ["Tuning share", 0.6], ["Validation lines", 2], ["Validation share", 0.2], ["Test lines", 2], ["Test share", 0.2]]);
      const singles = refOrder(9, 12).filter((g) => g !== 0);   // group g >= 1 is the line g + 2
      const sides = ["tuning", "tuning", "tuning", "validation", "test", "tuning", "validation", "test"];
      const expected = ["tuning", "tuning"];
      singles.forEach((g, k) => { expected[g + 1] = sides[k]; });
      assert.deepEqual(result.table.rows, expected.map((s, i) => [i + 1, s]));
    },
    // Three lines at 10% and 10%: targets 2.4, 0.3, 0.3, and tuning stays furthest below its target every time.
    more: [{ values: { lines: "a\nb\nc", validation: "0.1", test: "0.1", identity: "none" }, expect: (result) => {
      assert.deepEqual(result.rows, [["Tuning lines", 3], ["Tuning share", 1], ["Validation lines", 0], ["Validation share", 0], ["Test lines", 0], ["Test share", 0]]);
      assert.match(result.note, /No lines went to validation or test: paste more lines or raise its share\./);
    } }],
    invalid: [{ lines: "a\nb\nc", validation: "0.5", test: "0.5" }, { lines: "a\nb\nc", validation: "0", test: "0.2" }, { lines: "a\nb", validation: "0.2", test: "0.2" }],
  },
  kfold_groups: {
    // Groups a×3, b×2, c, d, e into 3 folds: a → 1, b → 2 (tie with 3, lower wins), then the singles in seeded order
    // go to 3, 3 (1 line beats 2), 2 (2 and 2 tie, lower wins): sizes 3, 3, 2.
    values: { lines: L("a", "a", "a", "b", "b", "c", "d", "e"), folds: "3", seed: "5", identity: "exact" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Fold 1 lines", 3], ["Fold 2 lines", 3], ["Fold 3 lines", 2]]);
      const singles = refOrder(5, 5).filter((g) => g >= 2);   // groups c, d, e are 2, 3, 4 -> lines 6, 7, 8
      const fold = [1, 1, 1, 2, 2];
      singles.forEach((g, k) => { fold[g + 3] = [3, 3, 2][k]; });
      assert.deepEqual(result.table, { columns: ["Line", "Fold"], rows: fold.map((f, i) => [i + 1, f]) });
    },
    // Bulk input identity: the same input with its fields in another order, a label and a test marker is one group.
    more: [{ values: { lines: L({ t: "a", c: "x" }, { c: "x", t: "a", _expect: { q: "y" } }, { t: "a", c: "x", _test: true }, "b", "c"), folds: "2", seed: "2" },
      expect: (result) => {
        assert.deepEqual(result.rows, [["Fold 1 lines", 3], ["Fold 2 lines", 2]]);
        assert.deepEqual(result.table.rows.slice(0, 3).map(([, f]) => f), [1, 1, 1]);
      } },
      // A text line is the row {"text": line}: lines 1 and 2 are one group of 2 (fold 1), y and z fill fold 2 whatever the seed.
      { values: { lines: L("x", { text: "x", _expect: { q: "a" } }, "y", "z"), folds: "2", seed: "9" },
        expect: { table: { columns: ["Line", "Fold"], rows: [[1, 1], [2, 1], [3, 2], [4, 2]] } } }],
    invalid: [{ lines: "a\na\nb", folds: "3", identity: "exact" }, { lines: "a\nb", folds: "1" }],
  },
  stratified_kfold: {
    // Six lines, classes A A A B B C (as pasted: A B A B A C), two folds: the seeded order sorted by class is dealt
    // 1, 2, 1, 2, 1, 2, so A gets folds 1, 2, 1, B 2, 1 and C 2, and each fold has 3 lines.
    values: { lines: L("p", "q", "r", "s", "t", "u"), labels: L("A", "B", "A", "B", "A", "C"), folds: "2", seed: "21" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Fold 1 lines", 3], ["Fold 2 lines", 3]]);
      const classOf = [0, 1, 0, 1, 0, 2], fold = [];
      refOrder(6, 21).sort((a, b) => classOf[a] - classOf[b]).forEach((i, p) => { fold[i] = (p % 2) + 1; });
      assert.deepEqual(result.table, { columns: ["Line", "Class", "Fold"], rows: [..."ABABAC"].map((c, i) => [i + 1, c, fold[i]]) });
      assert.equal(result.note, SEEDED(21));
    },
    // Two identical lines of one class always sit at positions 0 and 1: folds 1 and 2.
    more: [{ values: { lines: "same\nsame", labels: "A\nA", folds: "2", seed: "3" }, expect: (result) => {
      assert.deepEqual(result.table.rows.map(([, , f]) => f).sort(), [1, 2]);
      assert.equal(result.note, `1 group of identical lines landed in more than one fold. ${SEEDED(3)}`);
    } }],
    invalid: [{ lines: "a", labels: "A", folds: "2" }],
  },
  systematic_sample: {
    values: { lines: L("r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"), step: "3", start: "2" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Start", 2], ["Lines drawn", 3]]);
      assert.equal(result.text, "r2\nr5\nr8");
      assert.equal(result.note, "One line in every 3, from line 2, of 10 nonblank lines.");
    },
    more: [{ values: { lines: L("r1", "r2", "r3", "r4", "r5", "r6", "r7"), step: "3", seed: "5" }, expect: (result) => {
      const first = 1 + Math.floor(ref(5)() * 3);
      assert.deepEqual(result.rows[0], ["Start", first]);
      assert.equal(result.text, [1, 2, 3, 4, 5, 6, 7].filter((i) => i >= first && (i - first) % 3 === 0).map((i) => `r${i}`).join("\n"));
      assert.match(result.note, /start drawn with seed 5\.$/);
    } }],
    invalid: [{ lines: "a\nb\nc\nd", step: "3", start: "4" }, { lines: "a", step: "3", start: "2" }, { lines: "a", step: "0" }],
  },
  weighted_sample: {
    // Keys ln(u)/w for one seeded u per line in order; the weight-0 line b never wins.
    values: { lines: "a\nb\nc\nd", weights: "1\n0\n2\n4", n: "2", seed: "9" },
    expect: (result) => {
      const r = ref(9), w = [1, 0, 2, 4];
      const keys = w.map((weight) => { const u = r(); return weight > 0 ? Math.log(u) / weight : -Infinity; });
      const top = [0, 1, 2, 3].sort((a, b) => keys[b] - keys[a]).slice(0, 2).sort((a, b) => a - b);
      assert.equal(result.text, top.map((i) => "abcd"[i]).join("\n"));
      assert.match(result.note, /^2 of 3 weighted lines \(total weight 7\): lines /);
    },
    more: [{ values: { lines: "a\nb\nc\nd", weights: "1\n0\n2\n4", n: "3", seed: "9" }, expect: { text: "a\nc\nd" } },
      // A weight so small that ln(u)/weight is -Infinity still beats a weight of 0.
      { values: { lines: "zero\ntiny", weights: "0\n5e-324", n: "1", seed: "1" }, expect: { text: "tiny" } }],
    invalid: [{ lines: "a\nb\nc\nd", weights: "1\n0\n2\n4", n: "4" }, { lines: "a\nb", weights: "1\n-1", n: "1" }, { lines: "a\nb", weights: "1\nx", n: "1" }],
  },
  balanced_slices: {
    // Slices email 5, chat 1, phone 3, (missing) 1 and n = 7: 7/4 = 1 each, chat and (missing) fill at 1; 5 left over
    // email and phone: 2 each and the extra one to the larger, email: 3, 1, 2, 1.
    values: { lines: CHANNEL_ROWS, field: "channel", n: "7", seed: "13" },
    expect: (result) => {
      assert.deepEqual(result.table, { columns: ["Slice", "Rows", "Drawn"], rows: [["email", 5, 3], ["chat", 1, 1], ["phone", 3, 2], ["(missing)", 1, 1]] });
      const classes = CHANNELS.map((c) => c || "-");
      assert.equal(result.text, takeRef(10, classes, { email: 3, chat: 1, phone: 2, "-": 1 }, 13).map((i) => L({ ...(CHANNELS[i] ? { text: `m${i + 1}`, channel: CHANNELS[i] } : { text: `m${i + 1}` }) })).join("\n"));
    },
    // The number 1 and the text "1" are different slices.
    more: [{ values: { lines: L({ k: 1 }, { k: "1" }), field: "k", n: "2" }, expect: (result) => assert.deepEqual(result.table.rows, [["1 (number)", 1, 1], ["1", 1, 1]]) },
      // A text line is the row {"text": line}, so it has the field text: hello on lines 1 and 2, line 3 without it.
      { values: { lines: L("hello", { text: "hello", channel: "x" }, { channel: "y" }), field: "text", n: "2" },
        expect: { table: { columns: ["Slice", "Rows", "Drawn"], rows: [["hello", 2, 1], ["(missing)", 1, 1]] } } }],
    invalid: [{ lines: CHANNEL_ROWS, field: "_expect", n: "1" }, { lines: CHANNEL_ROWS, field: "channel", n: "11" }],
  },
  cluster_sample: {
    // customer c1 on rows 1, 3, 5; c2 on 2, 4; c3 on 6; row 7 has none.
    values: { lines: L({ t: 1, customer: "c1" }, { t: 2, customer: "c2" }, { t: 3, customer: "c1" }, { t: 4, customer: "c2" }, { t: 5, customer: "c1" }, { t: 6, customer: "c3" }, { t: 7 }),
      field: "customer", groups: "2", seed: "17" },
    expect: (result) => {
      const names = ["c1", "c2", "c3"], members = [[1, 3, 5], [2, 4], [6]], picks = refFloyd(3, 2, 17);
      assert.deepEqual(result.table, { columns: ["Value", "Rows"], rows: picks.map((g) => [names[g], members[g].length]) });
      const rows = picks.flatMap((g) => members[g]).sort((a, b) => a - b);
      assert.deepEqual(result.text.split("\n").map((line) => JSON.parse(line).t), rows);
      assert.equal(result.note, `2 of 3 values: ${rows.length} rows. 1 row without customer left out. ${SEEDED(17)}`);
    },
    invalid: [{ lines: L({ customer: "c1" }), field: "customer", groups: "2" }, { lines: L({ t: 1 }), field: "customer", groups: "1" }],
  },
  sample_new_lines: {
    // Input identity: line 1 is saved (labels ignored), line 4 is saved, line 3 repeats line 2's input: new inputs are
    // line 2 and line 5.
    values: { lines: L({ text: "a" }, { text: "b", _expect: { q: "x" } }, { text: "b" }, "c", { text: "d" }), saved: L({ _expect: { q: "y" }, text: "a" }, "c"), n: "2", seed: "1" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Candidate lines", 5], ["Lines already saved", 2], ["Repeated candidate lines", 1], ["New inputs", 2], ["Inputs drawn", 2]]);
      assert.equal(result.text, L({ text: "b", _expect: { q: "x" } }, { text: "d" }));
    },
    // Exact text: only "c" matches a saved line, and the two b lines differ.
    more: [{ values: { lines: L({ text: "a" }, { text: "b", _expect: { q: "x" } }, { text: "b" }, "c", { text: "d" }), saved: L({ _expect: { q: "y" }, text: "a" }, "c"), n: "4", identity: "exact" },
      expect: (result) => assert.deepEqual(result.rows, [["Candidate lines", 5], ["Lines already saved", 1], ["Repeated candidate lines", 0], ["New inputs", 4], ["Inputs drawn", 4]]) }],
    invalid: [{ lines: "a\nb", saved: "a", n: "2" }],
  },
  nested_samples: {
    values: { lines: "a\nb\nc\nd\ne", sizes: "4, 2", seed: "4" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Lines added at 2", 2], ["Lines added at 4", 2]]);
      const rank = []; refOrder(5, 4).forEach((i, p) => { rank[i] = p; });
      assert.deepEqual(result.table, { columns: ["Line", "First in sample of"], rows: rank.map((r, i) => [i + 1, r < 2 ? 2 : r < 4 ? 4 : "—"]) });
    },
    invalid: [{ lines: "a\nb", sizes: "0" }, { lines: "a\nb", sizes: "3" }, { lines: "a\nb", sizes: "x" }, { lines: "a\nb", sizes: " , " }],
  },
  alternate_classes: {
    // A A A B C: the turns go A, B, C, A, A, so b1 is second and c1 third whatever the seed.
    values: { lines: "a1\na2\na3\nb1\nc1", labels: "A\nA\nA\nB\nC", seed: "8" },
    expect: (result) => {
      const aOrder = refOrder(5, 8).filter((i) => i < 3).map((i) => `a${i + 1}`);
      assert.equal(result.text, [aOrder[0], "b1", "c1", aOrder[1], aOrder[2]].join("\n"));
      assert.equal(result.note, `3 classes taking turns. ${SEEDED(8)}`);
    },
    invalid: [{ lines: "a\nb", labels: "A" }],
  },
  bootstrap_resample: {
    values: { lines: "a\nb\nc", seed: "2" },
    expect: (result) => {
      const r = ref(2), picks = [0, 1, 2].map(() => Math.floor(r() * 3)), distinct = new Set(picks).size;
      assert.deepEqual(result.rows, [["Draws", 3], ["Distinct lines drawn", distinct], ["Lines never drawn (out of bag)", 3 - distinct]]);
      assert.equal(result.text, picks.map((i) => "abc"[i]).join("\n"));
    },
    more: [{ values: { lines: "solo", draws: "4", seed: "5" }, expect: [["Draws", 4], ["Distinct lines drawn", 1], ["Lines never drawn (out of bag)", 0]] }],
    invalid: [{ lines: "a", draws: "0" }],
  },
  bootstrap_coverage: {
    // N = m = 2: never drawn (1/2)² = 1/4, distinct 2·3/4, once 2·(1/2)·(1/2) = 1/2, twice 1 − 1/4 − 1/2.
    values: { total: "2" }, expect: [["Expected distinct lines drawn", 1.5], ["Expected share never drawn", 0.25], ["Chance a given line is drawn twice or more", 0.25]],
    more: [
      // N = m = 10: 0.9^10 = 0.3486784401, once 10·0.1·0.9^9 = 0.387420489.
      { values: { total: "10" }, expect: [["Expected distinct lines drawn", 6.513215599], ["Expected share never drawn", 0.3486784401], ["Chance a given line is drawn twice or more", 0.2639010709]] },
      { values: { total: "1", draws: "3" }, expect: [["Expected distinct lines drawn", 1], ["Expected share never drawn", 0], ["Chance a given line is drawn twice or more", 1]] },
    ],
    invalid: [{ total: "0" }],
  },
  inclusion_chances: {
    // N = 10, n = 3: 3/10, 3·2/(10·9) = 1/15, 10/3, 7/9, C(10, 3) = 120, log10 120.
    values: { total: "10", n: "3" },
    expect: [["Chance a given line is drawn", 0.3], ["Chance two given lines are both drawn", 1 / 15], ["Lines each drawn line stands for", 10 / 3],
      ["Finite population correction (variance)", 7 / 9], ["Possible samples", 120], ["Possible samples (log10)", 2.0791812460476249]],
    more: [{ values: { total: "1", n: "1" }, expect: [["Chance a given line is drawn", 1], ["Chance two given lines are both drawn", null], ["Lines each drawn line stands for", 1],
      ["Finite population correction (variance)", null], ["Possible samples", 1], ["Possible samples (log10)", 0]] }],
    invalid: [{ total: "10", n: "11" }],
  },
  class_missing: {
    // N = 10, K = 2, n = 3: none C(8,3)/C(10,3) = 56/120, all K drawn C(8,1)/120 = 8/120.
    values: { total: "10", classShare: "0.2", n: "3" },
    expect: [["Class lines", 2], ["Expected class lines in the sample", 0.6], ["Chance the sample has none", 7 / 15], ["Chance the rest has none", 1 / 15], ["Chance one side lacks the class", 8 / 15]],
    // Share 0.25 of 10 rounds to K = 3: none C(7,3)/120 = 35/120, all three drawn 1/120.
    more: [{ values: { total: "10", classShare: "0.25", n: "3" }, expect: [["Class lines", 3], ["Expected class lines in the sample", 0.9], ["Chance the sample has none", 35 / 120],
      ["Chance the rest has none", 1 / 120], ["Chance one side lacks the class", 36 / 120]] },
      // N = 20, K = 2, n = 5: none 15·14/(20·19) = 21/38, both drawn 5·4/(20·19) = 1/19.
      { values: { total: "20", classShare: "0.1", n: "5" }, expect: [["Class lines", 2], ["Expected class lines in the sample", 0.5], ["Chance the sample has none", 21 / 38],
        ["Chance the rest has none", 1 / 19], ["Chance one side lacks the class", 23 / 38]] }],
    invalid: [{ total: "10", classShare: "0.01", n: "3" }, { total: "10", classShare: "0.2", n: "11" }],
  },
  fold_class_coverage: {
    // N = 7 in folds of 3, 2, 2 and K = 3, C(7,3) = 35: a 2-line fold lacks it C(5,3)/35 = 10/35, the 3-line fold
    // C(4,3)/35 = 4/35; expected 4/35 + 2·10/35; two 2-line folds both lack it C(3,3)/35, any pair with the 3-line
    // fold is impossible; so at least one 24/35 − 1/35. Every fold has one: 3·2·2/35 = 12/35.
    values: { total: "7", k: "3", folds: "3" },
    expect: [["Lines per fold", "2 to 3"], ["Chance the smallest fold lacks the class", 10 / 35], ["Expected folds without the class", 24 / 35],
      ["Chance at least one fold lacks the class", 23 / 35], ["Chance every fold has the class", 12 / 35]],
    // N = 6, K = 2, three folds of 2: one fold lacks it C(4,2)/C(6,2) = 6/15; two class lines cannot cover three folds.
    more: [{ values: { total: "6", k: "2", folds: "3" }, expect: [["Lines per fold", "2"], ["Chance the smallest fold lacks the class", 0.4], ["Expected folds without the class", 1.2],
      ["Chance at least one fold lacks the class", 1], ["Chance every fold has the class", 0]] },
      // N = 10 in folds 3, 3, 2, 2 and K = 4 (C(10,4) = 210): a 2-line fold lacks it 70/210, a 3-line fold 35/210, so
      // 2·35/210 + 2·70/210 = 1 expected; a brute-force count of the 210 placements finds 174 that leave a fold empty.
      { values: { total: "10", k: "4", folds: "4" }, expect: [["Lines per fold", "2 to 3"], ["Chance the smallest fold lacks the class", 1 / 3], ["Expected folds without the class", 1],
        ["Chance at least one fold lacks the class", 29 / 35], ["Chance every fold has the class", 6 / 35]] }],
    invalid: [{ total: "5", k: "6", folds: "2" }, { total: "2", k: "1", folds: "3" }],
  },
  folds_plan: {
    // 23 lines in 5 folds: 5, 5, 5, 4, 4.
    values: { total: "23", folds: "5", minimum: "2" },
    expect: [["Largest fold", 5], ["Smallest fold", 4], ["Folds of the largest size", 3], ["Tuning lines per round, fewest", 18], ["Tuning lines per round, most", 19],
      ["Most folds with at least 2 lines each", 11], ["Lines needed for 5 folds of 2", 10]],
    more: [{ values: { total: "20", folds: "5", minimum: "3" }, expect: [["Largest fold", 4], ["Smallest fold", 4], ["Folds of the largest size", 5], ["Tuning lines per round, fewest", 16],
      ["Tuning lines per round, most", 16], ["Most folds with at least 3 lines each", 6], ["Lines needed for 5 folds of 3", 15]] }],
    invalid: [{ total: "3", folds: "4" }],
  },
  sample_overlap: {
    // N = 10, samples of 3 and 4: mean 12/10; variance 4·0.3·0.7·6/9 = 0.56; none C(7,4)/C(10,4) = 35/210.
    values: { total: "10", first: "3", second: "4" },
    expect: [["Expected lines in both", 1.2], ["Standard deviation", Math.sqrt(0.56)], ["Chance they share none", 1 / 6], ["Chance they share at least one", 5 / 6], ["Smallest possible overlap", 0]],
    more: [{ values: { total: "10", first: "6", second: "7" }, expect: [["Expected lines in both", 4.2], ["Standard deviation", Math.sqrt(7 * 0.6 * 0.4 * 3 / 9)], ["Chance they share none", 0],
      ["Chance they share at least one", 1], ["Smallest possible overlap", 3]] },
      { values: { total: "10", first: "0", second: "4" }, expect: [["Expected lines in both", 0], ["Standard deviation", 0], ["Chance they share none", 1],
        ["Chance they share at least one", 0], ["Smallest possible overlap", 0]] }],
    invalid: [{ total: "10", first: "11", second: "1" }],
  },
  reservoir_check: {
    // k = 2 over 10: replacements 2·(1/3 + … + 1/10) = 2·(H10 − H2) = 2·3601/2520 = 3601/1260.
    values: { total: "10", k: "2" },
    expect: [["Chance each line ends in the reservoir", 0.2], ["Lines kept", 2], ["Expected replacements", 3601 / 1260], ["Expected writes in all", 2 + 3601 / 1260]],
    more: [{ values: { total: "3", k: "5" }, expect: [["Chance each line ends in the reservoir", 1], ["Lines kept", 3], ["Expected replacements", 0], ["Expected writes in all", 3]] },
      // k = 3 over 12: 3·(1/4 + … + 1/12) = 35201/9240 (exact fractions).
      { values: { total: "12", k: "3" }, expect: [["Chance each line ends in the reservoir", 0.25], ["Lines kept", 3], ["Expected replacements", 35201 / 9240], ["Expected writes in all", 3 + 35201 / 9240]] },
      // One line past a reservoir of 999999999: it enters with chance k/N, so 0.999999999 replacements expected.
      { values: { total: "1000000000", k: "999999999" }, expect: (result) => {
        assert.ok(Math.abs(result.rows[2][1] - 0.999999999) <= 1e-12, `replacements ${result.rows[2][1]}`);
      } }],
    invalid: [{ total: "10", k: "0" }],
  },
  seeded_integers: {
    values: { n: "5", low: "1", high: "6", seed: "11" },
    expect: (result) => {
      const r = ref(11);
      assert.equal(result.text, [0, 1, 2, 3, 4].map(() => 1 + Math.floor(r() * 6)).join("\n"));
      assert.equal(result.note, SEEDED(11));
    },
    more: [
      { values: { n: "3", low: "10", high: "14", distinct: true, seed: "11" }, expect: { text: refFloyd(5, 3, 11).map((i) => 10 + i).join("\n") } },
      { values: { n: "5", low: "1", high: "5", distinct: true, seed: "40" }, expect: { text: "1\n2\n3\n4\n5" } },
    ],
    // 0 to 4294967296 holds 2^32 + 1 numbers, one more than the generator's 2^32 values can reach evenly.
    invalid: [{ n: "1", low: "5", high: "4" }, { n: "6", low: "1", high: "5", distinct: true }, { n: "1", low: "0", high: "4294967296" }],
  },
}, { ctx: () => sampleToolboxCtx() });

const tool = (id) => pack.features.find((feature) => feature.id === id);

test("tb-sampling: a held-out split never separates identical inputs, whatever the seed", () => {
  // Bulk rows: the three "a" rows share an input (field order, labels and the test marker ignored).
  const lines = L({ t: "a", c: 1 }, { c: 1, t: "a", _expect: { q: "y" } }, { t: "a", c: 1, _test: true }, "b", "c", "d", "e", "f");
  for (let seed = 0; seed < 40; seed++) {
    const result = runTool(tool("holdout_split"), { lines, share: "0.3", seed: String(seed) });
    const sides = new Set(result.table.rows.slice(0, 3).map(([, side]) => side));
    assert.equal(sides.size, 1, `seed ${seed}`);
    // 0.3 of 8 is 2.4: 2 is always reachable from singles, and 3 (the triple) is further away.
    assert.equal(result.rows[0][1], 2, `seed ${seed}`);
  }
});

test("tb-sampling: the same seed gives the same result and another seed usually differs", () => {
  const lines = Array.from({ length: 30 }, (x, i) => `row ${i + 1}`).join("\n");
  const once = runTool(tool("sample_lines"), { lines, n: "10", seed: "5" }).text;
  assert.equal(runTool(tool("sample_lines"), { lines, n: "10", seed: "5" }).text, once);
  assert.notEqual(runTool(tool("sample_lines"), { lines, n: "10", seed: "6" }).text, once);
});

test("tb-sampling: the fold class coverage matches a direct count", () => {
  // N = 8 in folds 3, 3, 2 with K = 3: count the class placements (C(8,3) = 56) that leave some fold empty.
  const fold = [0, 0, 0, 1, 1, 1, 2, 2];
  let missing = 0, all = 0;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++) {
    all += 1;
    if (new Set([fold[a], fold[b], fold[c]]).size < 3) missing += 1;
  }
  const result = runTool(tool("fold_class_coverage"), { total: "8", k: "3", folds: "3" });
  near(result.rows[3][1], missing / all, "at least one fold");
});

test("tb-sampling: weighted draws follow the weights over many seeds", () => {
  // Weights 1, 2, 4. One draw: c with chance 4/7. Two draws (successive sampling without replacement in proportion to
  // the weight, which Efraimidis-Spirakis reproduces): a is drawn unless it comes last, so with chance
  // 1 − [(4/7)(2/3) + (2/7)(4/5)] = 1 − 64/105 = 41/105. 6000 seeds give standard errors near 0.0064.
  const seeds = 6000;
  let first = 0, second = 0;
  for (let seed = 0; seed < seeds; seed++) {
    if (runTool(tool("weighted_sample"), { lines: "a\nb\nc", weights: "1\n2\n4", n: "1", seed: String(seed) }).text === "c") first += 1;
    if (runTool(tool("weighted_sample"), { lines: "a\nb\nc", weights: "1\n2\n4", n: "2", seed: String(seed) }).text.split("\n").includes("a")) second += 1;
  }
  assert.ok(Math.abs(first / seeds - 4 / 7) < 0.03, `one draw: ${first / seeds}`);
  assert.ok(Math.abs(second / seeds - 41 / 105) < 0.03, `two draws: ${second / seeds}`);
});
