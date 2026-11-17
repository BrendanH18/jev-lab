// Tests for static/js/lab/packs/workbench/drift-queue-handoffs.js on the drift queue fixture
// (tests/js/lab/fixtures/workbench-checks.mjs). Expected text is written out by hand from the fixture header:
//   new row 3  topic shipping, urgent yes            ready
//   new row 5  topic billing, tone 1                 needs urgent
//   new row 8  no labels, picture receipt-scan (loaded)        needs topic, urgent
//   new row 11 topic shipping, urgent no, tone 0, picture parcel-photo (not loaded)   ready
//   new row 12 urgent no, blank text, phone           needs topic
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/drift-queue-handoffs.js";
import { checkPack } from "./harness.mjs";
import { sampleDriftItemsRaw, sampleDriftQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleDriftQueueCtx(overrides);
const C = ctx();
const D = Object.fromEntries(C.items().map((item) => [item.line, item]));
const [D3, D5, D8, D11, D12] = [D[3], D[5], D[8], D[11], D[12]];
const withLabels = (item, patch) => ({ ...JSON.parse(JSON.stringify(item)), labels: { ...item.labels, ...patch } });
const blank = { topic: null, urgent: null, tone: null };
const mixedCtx = () =>
  ctx({
    items: [
      { index: 0, line: 1, row: { text: "a", channel: "email" }, labels: { ...blank } },
      { index: 1, line: 2, row: { order_id: "HC-4410", channel: "email", rush: true }, labels: { ...blank } },
      {
        index: 2,
        line: 3,
        row: { text: "b", channel: null, order: { id: "x" }, tags: ["gift"] },
        labels: { ...blank },
      },
    ],
  });
const TODO =
  "- [x] new row 3\n- [ ] new row 5: needs urgent\n- [ ] new row 8: needs topic, urgent\n- [x] new row 11\n- [ ] new row 12: needs topic\n";

checkPack(
  pack,
  {
    blank_labels_csv: {
      ctx: C,
      filename: "jev-new-traffic-to-label.csv",
      text:
        '"new_row","text","channel","picture","label_topic","label_urgent","label_tone"\r\n' +
        '"3","Two bags of Harbor House arrived crushed","email","","","",""\r\n' +
        '"5","Can I pay by invoice for the cafe order?","chat","","","",""\r\n' +
        '"8","Photo of my receipt","chat","receipt-scan","","",""\r\n' +
        '"11","Where is order HC-3110?","email","parcel-photo","","",""\r\n' +
        '"12","","phone","","","",""\r\n',
      excludes: ["shipping", "billing"],
    },
    labels_csv: {
      ctx: C,
      filename: "jev-new-traffic-labels.csv",
      text:
        '"new_row","text","channel","picture","label_topic","label_urgent","label_tone"\r\n' +
        '"3","Two bags of Harbor House arrived crushed","email","","shipping","yes",""\r\n' +
        '"5","Can I pay by invoice for the cafe order?","chat","","billing","","1"\r\n' +
        '"8","Photo of my receipt","chat","receipt-scan","","",""\r\n' +
        '"11","Where is order HC-3110?","email","parcel-photo","shipping","no","0"\r\n' +
        '"12","","phone","","","no",""\r\n',
    },
    inputs_markdown: {
      ctx: C,
      filename: "jev-new-traffic-inputs.md",
      text:
        "| New row | text | channel | Picture |\n| --- | --- | --- | --- |\n" +
        "| 3 | Two bags of Harbor House arrived crushed | email |  |\n" +
        "| 5 | Can I pay by invoice for the cafe order? | chat |  |\n" +
        "| 8 | Photo of my receipt | chat | receipt-scan |\n" +
        "| 11 | Where is order HC-3110? | email | parcel-photo |\n" +
        "| 12 |  | phone |  |\n",
      excludes: ["shipping", "billing"],
    },
    texts_txt: {
      ctx: C,
      filename: "jev-new-traffic-texts.txt",
      text: "Two bags of Harbor House arrived crushed\nCan I pay by invoice for the cafe order?\nPhoto of my receipt\nWhere is order HC-3110?\n\n",
    },
    picture_names: {
      ctx: C,
      filename: "jev-new-traffic-pictures.txt",
      text: "new row 8: receipt-scan (loaded)\nnew row 11: parcel-photo (not loaded)\n",
      excludes: ["receipt-scan.png", "Photo"],
    },
    field_counts_csv: {
      ctx: mixedCtx(),
      filename: "jev-new-traffic-fields.csv",
      text: '"field","rows","kinds"\r\n"text","2","text"\r\n"channel","3","text null"\r\n"order_id","1","text"\r\n"rush","1","true/false"\r\n"order","1","object"\r\n"tags","1","list"\r\n',
      excludes: ["HC-4410", "email", "gift"],
    },
    todo_markdown: { ctx: C, filename: "jev-new-traffic-todo.md", text: TODO, excludes: ["Harbor", "shipping"] },

    set_label_replacing: {
      ctx: C,
      input: [D3, D5, D8],
      params: { question: "urgent", label: "no" },
      output: [withLabels(D3, { urgent: false }), withLabels(D5, { urgent: false }), withLabels(D8, { urgent: false })],
      unchanged: [D11, D12],
      rejects: [
        { params: { question: "mood", label: "no" }, message: /not a question of this queue/ },
        {
          params: { question: "topic", label: "beans" },
          message: /not an option of topic \(billing, shipping, wholesale\)/,
        },
      ],
    },
    clear_shown_labels: {
      input: [D3, D8],
      output: [withLabels(D3, { topic: null, urgent: null, tone: null }), withLabels(D8, {})],
      unchanged: [D8],
    },
    clear_optional_labels: {
      ctx: C,
      input: [D5, D11, D3],
      output: [withLabels(D5, { tone: null }), withLabels(D11, { tone: null }), withLabels(D3, {})],
      unchanged: [D3, D8],
    },

    go_first_shown: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(c.log, [["goTo", 3]]),
      hidden: () => ctx({ open: false }),
    },
    go_last_incomplete: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(c.log, [["goTo", 12]]),
      hidden: () => ctx({ open: false }),
    },
    go_first_not_started: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(c.log, [["goTo", 8]]),
      hidden: () => ctx({ items: sampleDriftItemsRaw().filter((raw) => raw.line === 3 || raw.line === 11) }),
    },
    go_first_picture_not_loaded: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(c.log, [["goTo", 11]]),
      hidden: () =>
        ctx({
          pictures: {
            "receipt-scan": "/api/workbench/images/receipt-scan.png",
            "parcel-photo": "/api/workbench/images/parcel-photo.png",
          },
        }),
    },
    close_labels: {
      ctx: () => ctx(),
      check: (c) => {
        assert.deepEqual(c.log, [["openLabels", false]]);
        assert.equal(c.state.labelsOpen, false);
      },
      hidden: () => ctx({ open: false }),
    },
    copy_todo: {
      ctx: () => ctx(),
      check: (c) => {
        assert.deepEqual(c.env.copied, [TODO]);
        assert.deepEqual(
          c.env.toasts.map((toast) => toast.message),
          ["Copied the to-do: 3 rows still need labels."],
        );
        assert.deepEqual(c.log, []);
      },
      hidden: () => ctx({ open: false }),
    },
  },
  { ctx: () => ctx() },
);
