// Tests for static/js/lab/packs/workbench/drift-queue-input-facts.js on the drift queue fixture
// (tests/js/lab/fixtures/workbench-checks.mjs) and a few hand-made queues. Expected values are counted by hand:
//   new row 3  "Two bags of Harbor House arrived crushed"   7 words, 40 characters, no digits     email
//   new row 5  "Can I pay by invoice for the cafe order?"   9 words, 40 characters                chat
//   new row 8  "Photo of my receipt"                        4 words, 19 characters, picture receipt-scan (loaded)
//   new row 11 "Where is order HC-3110?"                    4 words, 4 digits, picture parcel-photo (not loaded)
//   new row 12 ""                                           0 words, 0 lines (blank)               phone
import pack from "../../../static/js/lab/packs/workbench/drift-queue-input-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleDriftQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleDriftQueueCtx(overrides);
const blank = { topic: null, urgent: null, tone: null };
const D = Object.fromEntries(ctx().items().map((item) => [item.line, item]));
const [D3, D5, D8, D11, D12] = [D[3], D[5], D[8], D[11], D[12]];

// A hand-made queue: three rows share one text on different channels, a row without a text field, a two-line row with
// an accent, leading spaces and a nested order, a row with a web and an email address, and a 210-character row.
const MULTI_TEXT = "  Café order for Pier Cafe\nSecond line\n";
const twinsCtx = ctx({ items: [
  { index: 0, line: 1, row: { text: "Order HC-2041 arrived late", channel: "email" }, labels: { ...blank } },
  { index: 1, line: 2, row: { text: "Order HC-2041 arrived late", channel: "chat" }, labels: { ...blank } },
  { index: 2, line: 3, row: { text: "Order HC-2041 arrived late", channel: "phone" }, labels: { ...blank } },
  { index: 3, line: 4, row: { order_id: "HC-4410", channel: "email" }, labels: { ...blank } },
  { index: 4, line: 5, row: { text: MULTI_TEXT, channel: "email", order: { id: "HC-5001", bags: 12 } }, labels: { ...blank } },
  { index: 5, line: 6, row: { text: "Reorder at https://harbor.example/reorder or write orders@harbor.example", channel: "web" }, labels: { ...blank } },
  { index: 6, line: 7, row: { text: "Harbor ".repeat(30), channel: "email" }, labels: { ...blank } },
] });
const [T1, T2, , NOTEXT, MULTI, LINKS, LONG] = twinsCtx.items();

checkPack(pack, {
  word_count: { items: [D3, D5, D8, D11, D12, NOTEXT], values: [7, 9, 4, 4, 0, null] },
  // The trailing line break closes the second line instead of opening a third.
  line_count: { items: [D3, D12, MULTI, NOTEXT], values: [1, 0, 2, null] },
  digit_count: { items: [D11, D3, T1, NOTEXT], values: [4, 0, 4, null] },
  // Sorted-key compact JSON written out by hand; "é" is two UTF-8 bytes.
  input_bytes: { items: [D3, D8, MULTI], values: [
    Buffer.byteLength('{"channel":"email","text":"Two bags of Harbor House arrived crushed"}'),
    Buffer.byteLength('{"_image":"receipt-scan","channel":"chat","text":"Photo of my receipt"}'),
    Buffer.byteLength('{"channel":"email","order":{"bags":12,"id":"HC-5001"},"text":"  Café order for Pier Cafe\\nSecond line\\n"}')] },
  nested_fields: { items: [D3, MULTI, NOTEXT], values: [0, 1, 0] },
  queue_position: { items: [D3, D5, D12], values: [1, 2, 5] },
  same_text_rows: { ctx: twinsCtx, items: [T1, T2, NOTEXT, MULTI], values: [2, 2, null, 0] },

  has_text_field: { items: [D3, NOTEXT], values: [true, false] },
  has_web_address: { items: [LINKS, D3, NOTEXT], values: [true, false, false] },
  has_email: { items: [LINKS, D11, D3], values: [true, false, false] },
  edge_spaces: { items: [MULTI, D3, D12], values: [true, false, false] },
  non_ascii: { items: [MULTI, D3, NOTEXT], values: [true, false, false] },

  length_band: { items: [D3, D8, D12, NOTEXT, LONG, { line: 99 }], values: ["medium", "short", "blank", "no text field", "long", null] },
  field_set: { items: [D3, D8, NOTEXT, MULTI, { row: {} }], values: ["channel, text", "channel, text", "channel, order_id", "channel, order, text", "no fields"] },
  picture_state: { items: [D3, D8, D11], values: ["no picture", "loaded", "not loaded"] },

  other_fields: { items: [D3, MULTI, NOTEXT, { row: { text: "only text" } }],
    values: ["channel=email", 'channel=email; order={"bags":12,"id":"HC-5001"}', "channel=email; order_id=HC-4410", ""] },
  picture_name: { items: [D8, D11, D3], values: ["receipt-scan", "parcel-photo", ""] },
}, { ctx: () => ctx() });
