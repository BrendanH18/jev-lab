import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/review-queue-labels.js";
import { checkPack } from "./harness.mjs";
import { sampleReviewEdits, sampleReviewItemsRaw, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleReviewQueueCtx(overrides);
const empty = () => ctx({ report: null });
const R = Object.fromEntries(
  ctx()
    .items()
    .map((item) => [item.line, item]),
);
// Line 2 after you cleared urgent (edited, blank now); line 4 after you cleared tone, which is not gated.
const clearedUrgent = ctx({ edits: { ...sampleReviewEdits(), 2: { urgent: null } } });
const CLEARED2 = clearedUrgent.items().find((item) => item.line === 2);
const CLEARED_TONE = ctx({ edits: { ...sampleReviewEdits(), 4: { topic: "billing", urgent: true, tone: null } } })
  .items()
  .find((item) => item.line === 4);

checkPack(pack, {
  // Line 2's topic is the gate's suggestion; line 4: topic, urgent by hand; 13: all three; 15: topic.
  human_labels: { items: [R[2], R[4], R[6], R[13], R[15]], values: [0, 2, 0, 3, 1] },
  // Line 2 opens urgent (blank); line 4 opens all three, tone blank; line 9 all three blank; line 13 none blank.
  open_blank: { items: [R[2], R[4], R[9], R[13], { row: "x" }], values: [1, 1, 3, 0, null] },
  // "My grinder arrived with a cracked hopper" 7 words + "email"; "Receipt attached, wrong roast sent" 5 + "chat" (the
  // picture name is not text); "Do you roast decaf on Fridays? Ask roastery@harbor.example" 8 + "phone".
  input_words: { items: [R[2], R[6], R[13], { row: "Two words" }, { line: 1 }], values: [8, 6, 9, 2, null] },
  // 40 + 5, 34 + 4.
  input_chars: { items: [R[2], R[6], { row: "Two words" }, { line: 1 }], values: [45, 38, 9, null] },
  contact_details: {
    items: [R[13], R[2], R[6], { row: "See www.harbor.example/faq" }],
    values: [true, false, false, true],
  },
  blind: { items: [R[9], R[15], R[13], R[2]], values: [true, true, false, false] },
  untouched: { items: [R[6], R[9], R[2], R[4]], values: [true, true, false, false] },
  cleared_label: { items: [CLEARED2, CLEARED_TONE, R[2], R[4]], values: [true, true, false, false] },
  edited_questions: {
    items: [R[2], R[4], R[13], R[15], { line: 1 }],
    values: ["none", "topic, urgent", "topic, urgent, tone", "topic", null],
  },
  next_to_decide: { items: [R[2], R[4], R[13], R[6], R[9]], values: ["urgent", "tone", "none", "topic", "topic"] },
  kind_status: {
    items: [R[2], R[4], R[13], R[9]],
    values: ["review · incomplete", "review · ready", "audit · ready", "audit · incomplete"],
  },
  // No slice selected: the first field the page offers, channel.
  slice_value: {
    items: [R[2], R[4], R[13], { slice_values: {} }],
    values: ["email", "chat", "phone", null],
    ctx: ctx(),
  },
  your_labels: {
    items: [R[2], R[4], R[13], R[15]],
    values: ["", "topic=billing; urgent=yes", "topic=beans; urgent=no; tone=2", "topic=shipping"],
  },

  cleared_gated: {
    ctx: clearedUrgent,
    hit: CLEARED2,
    miss: [CLEARED_TONE, R[4], R[9]],
    message: /^You cleared urgent on line 2; it is gated, so Add skips the row until it is labeled again\.$/,
  },

  // chat holds review lines 4 and 6 and no audit row; email and phone have audit rows. An audit-only queue reports nothing.
  slice_without_audit: {
    ctx: ctx(),
    hitList: [],
    missList: [],
    missCtx: ctx({ items: sampleReviewItemsRaw().filter((item) => item.kind === "audit") }),
    message: /^channel = chat has 2 review rows and no audit row, so the audit after Add says nothing about it\.$/,
  },

  human_label_total: {
    ctx: ctx(),
    empty: empty(),
    expect: (result) => {
      assert.equal(result.value, 6);
      assert.equal(result.detail, "on 3 rows");
    },
  },
  untouched_rows: {
    ctx: ctx(),
    empty: empty(),
    expect: (result) => {
      assert.equal(result.value, 2);
      assert.equal(result.detail, "of 6 rows");
    },
  },
  blind_rows: [
    {
      ctx: ctx(),
      empty: empty(),
      expect: (result) => {
        assert.equal(result.value, 2);
        assert.equal(result.detail, "of 3 audit rows");
      },
    },
    { ctx: ctx({ items: sampleReviewItemsRaw().filter((item) => item.kind === "review") }), expect: null },
  ],
  shown_share: [
    { ctx: ctx(), empty: empty(), expect: 1 },
    {
      ctx: ctx({ kind: "audit" }),
      expect: (result) => {
        assert.equal(result.value, 0.5);
        assert.equal(result.detail, "3 of 6 rows");
      },
    },
  ],
  // Missing gated labels: line 2 urgent, line 6 topic and urgent, line 9 both, line 15 urgent.
  gated_labels_left: {
    ctx: ctx(),
    empty: empty(),
    expect: (result) => {
      assert.equal(result.value, 6);
      assert.equal(result.detail, "on 4 rows");
    },
  },

  // Ready audit rows: only line 13 (phone).
  audit_slices_covered: [
    {
      ctx: ctx(),
      empty: empty(),
      expect: (result) => {
        assert.equal(result.value, 1);
        assert.equal(result.detail, "of 3 channel values: phone");
      },
    },
    {
      ctx: ctx({ items: sampleReviewItemsRaw().filter((item) => item.line !== 13) }),
      expect: (result) => {
        assert.equal(result.value, 0);
        assert.equal(result.detail, "of 3 channel values");
      },
    },
  ],

  worksheet_md: {
    ctx: ctx({ sliceField: "channel", sliceValue: "phone" }),
    filename: "jev-review-worksheet.md",
    text: [
      "# Review worksheet · Harbor support inbox",
      "",
      "2 rows · inputs and blank options only: no labels, gate suggestions, answers or shortlists. Pictures by name.",
      "",
      "## Line 13 (audit)",
      "> text: Do you roast decaf on Fridays? Ask roastery@harbor.example · channel: phone",
      "- topic: [ ] billing  [ ] shipping  [ ] wholesale  [ ] beans",
      "- urgent: [ ] yes  [ ] no",
      "- tone: [ ] 0 (Upset)  [ ] 1 (Neutral)  [ ] 2 (Happy)",
      "",
      "## Line 15 (audit)",
      "> text: Parcel left at the wrong door · channel: phone",
      "- topic: [ ] billing  [ ] shipping  [ ] wholesale  [ ] beans",
      "- urgent: [ ] yes  [ ] no",
      "- tone: [ ] 0 (Upset)  [ ] 1 (Neutral)  [ ] 2 (Happy)",
      "",
    ].join("\n"),
    // A review row lists only its open questions, and its picture goes by name.
    check: (out) => assert.ok(!out.text.includes("[x]")),
  },
  slice_progress_csv: {
    ctx: ctx(),
    filename: "jev-review-slices.csv",
    text:
      '"field","value","rows","review","audit","ready","incomplete","blind_audit"\r\n' +
      '"channel","chat","2","2","0","1","1","0"\r\n' +
      '"channel","email","2","1","1","0","2","1"\r\n' +
      '"channel","phone","2","0","2","1","1","1"\r\n',
  },
  // Line 2's topic is the gate's suggestion and stays out; lines 4, 13 and 15 carry labels a person set.
  your_labels_csv: {
    ctx: ctx(),
    filename: "jev-review-your-labels.csv",
    text:
      '"line","kind","question","label"\r\n"4","review","topic","billing"\r\n"4","review","urgent","yes"\r\n' +
      '"13","audit","topic","beans"\r\n"13","audit","urgent","no"\r\n"13","audit","tone","2"\r\n"15","audit","topic","shipping"\r\n',
    excludes: ["Charged", "wholesale", "grinder"],
  },
});

// The worksheet over the whole queue: line 2 lists only urgent (its open question), line 6 its picture by name, and no
// label, suggestion or answer appears (line 2's suggested topic and line 13's labels never show as ticked or named).
test("review-queue-labels: the worksheet lists open questions only and never a label", () => {
  const worksheet = pack.features.find((feature) => feature.id === "worksheet_md").build(ctx());
  assert.ok(
    worksheet.includes(
      "## Line 2 (review)\n> text: My grinder arrived with a cracked hopper · channel: email\n- urgent: [ ] yes  [ ] no\n\n## Line 4 (review)",
    ),
  );
  assert.ok(
    worksheet.includes(
      "## Line 6 (review)\n> text: Receipt attached, wrong roast sent · channel: chat\n> picture: receipt-scan\n- topic: [ ] billing",
    ),
  );
  assert.ok(!/=|\[x\]|suggested:|answer:/.test(worksheet.split("\n").slice(3).join("\n")));
});
