import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/drift-queue-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleDriftQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleDriftQueueCtx(overrides);
const empty = () => ctx({ labeling: null });
const D = Object.fromEntries(ctx().items().map((item) => [item.line, item]));
const [D3, D5, D8, D11, D12] = [D[3], D[5], D[8], D[11], D[12]];
// Rows the comparison could also queue: one without a text field, one with a nested order.
const [NOTEXT, NESTED] = ctx({ items: [
  { index: 0, line: 1, row: { order_id: "HC-4410", channel: "email" }, labels: { topic: null, urgent: null, tone: null } },
  { index: 1, line: 2, row: { text: "Bulk order for Pier Cafe", channel: "email", order: { id: "HC-5001", bags: 12 } }, labels: { topic: null, urgent: null, tone: null } },
] }).items();
// An expected item: a plain copy with the labels patched.
const withLabels = (item, patch) => ({ ...JSON.parse(JSON.stringify(item)), labels: { ...item.labels, ...patch } });

checkPack(pack, {
  labels_chosen: { items: [D3, D5, D8, D11, D12], values: [2, 2, 0, 3, 1] },
  required_missing: { items: [D3, D5, D8, D11, D12], values: [0, 1, 2, 0, 1] },
  // "Two bags of Harbor House arrived crushed" is 40 characters, "Photo of my receipt" 19; a blank text is 0.
  input_characters: { items: [D3, D8, D12, NOTEXT], values: [40, 19, 0, null] },
  // The picture name is not a field.
  input_fields: { items: [D3, D8, NESTED], values: [2, 2, 3] },
  has_picture: { items: [D8, D11, D3], values: [true, true, false] },
  picture_not_loaded: { items: [D11, D8, D3], values: [true, false, false] },
  // Room for 1: new row 3 takes it, new row 11 is ready but waits.
  will_add: { items: [D3, D11, D5], values: [true, false, false] },
  status: { items: [D3, D5, D11, { status: "maybe" }], values: ["ready", "incomplete", "ready", null] },
  input_text: { items: [D3, D5, D12, NOTEXT], values: ["Two bags of Harbor House arrived crushed", "Can I pay by invoice for the cafe order?", "", ""] },

  blank_text: { hit: D12, miss: [D3, NOTEXT], message: /blank/ },
  // New row 5 lacks urgent, new row 12 lacks topic; 8 has no label at all, 3 and 11 are ready.
  partly_labeled: { hit: [D5, D12], miss: [D3, D8, D11, { labeled: ["tone"], ready: false }, {}], message: /^(urgent|topic) still needs a label, so Add skips this row\.$/ },

  fill_blank_label: { ctx: ctx(), input: [D3, D5, D8], params: { question: "urgent", label: "no" },
    output: [withLabels(D3, {}), withLabels(D5, { urgent: false }), withLabels(D8, { urgent: false })],
    unchanged: [D3, D11],
    rejects: [{ params: { question: "mood", label: "no" }, message: /not a question of this queue/ },
      { params: { question: "urgent", label: "maybe" }, message: /not an option of urgent/ },
      { params: { question: "tone", label: "Happy" }, message: /not an option of tone \(0, 1, 2\)/ }] },
  clear_question: { ctx: ctx(), input: [D3, D8, D11], params: { question: "topic" },
    output: [withLabels(D3, { topic: null }), withLabels(D8, {}), withLabels(D11, { topic: null })],
    unchanged: [D8],
    rejects: [{ params: { question: "Topic" }, message: /not a question/ }] },

  // 2 of 5 ready; with room 5 nothing waits.
  ready_share: { ctx: ctx(), expect: 0.4, empty: empty() },
  labels_total: { ctx: ctx(), expect: 8, empty: empty() },
  ready_over_room: [{ ctx: ctx(), expect: 1, empty: empty() }, { ctx: ctx({ room: 5 }), expect: 0 }],

  inputs_jsonl: { ctx: ctx(), filename: "jev-new-traffic-inputs.jsonl",
    text: '{"text":"Two bags of Harbor House arrived crushed","channel":"email"}\n'
      + '{"text":"Can I pay by invoice for the cafe order?","channel":"chat"}\n'
      + '{"text":"Photo of my receipt","channel":"chat","_image":"receipt-scan"}\n'
      + '{"text":"Where is order HC-3110?","channel":"email","_image":"parcel-photo"}\n'
      + '{"text":"","channel":"phone"}\n',
    excludes: ["shipping", "billing", "labels"] },
  progress_csv: { ctx: ctx(), filename: "jev-new-traffic-progress.csv",
    text: '"new_row","status","labels_chosen","required_missing"\r\n"3","ready","2",""\r\n"5","incomplete","2","urgent"\r\n'
      + '"8","incomplete","0","topic urgent"\r\n"11","ready","3",""\r\n"12","incomplete","1","topic"\r\n',
    excludes: ["Harbor", "shipping"] },

  go_first_incomplete: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", 5]]), hidden: () => ctx({ open: false }) },
  open_labels: { ctx: () => ctx({ open: false }),
    check: (c) => {
      assert.deepEqual(c.log, [["openLabels", true]]);
      assert.equal(c.state.labelsOpen, true);
    },
    hidden: () => ctx() },
}, { ctx: () => ctx() });
