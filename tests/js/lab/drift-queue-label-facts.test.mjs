// Tests for static/js/lab/packs/workbench/drift-queue-label-facts.js on the drift queue fixture
// (tests/js/lab/fixtures/workbench-checks.mjs). Queue questions in order: topic (gated), urgent (gated), tone (optional).
// Room 1. Worked out by hand from the fixture header:
//   new row 3   topic shipping, urgent yes            ready, takes the one place in the next Add   (position 1)
//   new row 5   topic billing, tone 1                 urgent missing                               (position 2)
//   new row 8   nothing                               topic and urgent missing                     (position 3)
//   new row 11  topic shipping, urgent no, tone 0     ready, waits for room                        (position 4)
//   new row 12  urgent no                             topic missing                                (position 5)
import pack from "../../../static/js/lab/packs/workbench/drift-queue-label-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleDriftQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleDriftQueueCtx(overrides);
const C = ctx();
const D = Object.fromEntries(C.items().map((item) => [item.line, item]));
const [D3, D5, D8, D11, D12] = [D[3], D[5], D[8], D[11], D[12]];

checkPack(
  pack,
  {
    labeled_share: { ctx: C, items: [D3, D5, D8, D11, D12], values: [2 / 3, 2 / 3, 0, 1, 1 / 3] },
    required_labeled: { ctx: C, items: [D3, D5, D8, D11, D12], values: [2, 1, 0, 2, 1] },
    optional_blank: { ctx: C, items: [D3, D5, D8, D11, D12], values: [1, 0, 1, 0, 1] },
    // Ready rows are 3 and 11 (positions 1 and 4).
    ready_ahead: { ctx: C, items: [D3, D5, D8, D11, D12], values: [0, 1, 1, 1, 2] },

    fully_labeled: { ctx: C, items: [D11, D3, D8], values: [true, false, false] },
    untouched: { items: [D8, D3, D12], values: [true, false, false] },
    ready_waiting: { items: [D11, D3, D5], values: [true, false, false] },

    progress: {
      ctx: C,
      items: [D8, D5, D3, D11, D12, { line: 1 }],
      values: ["no labels", "started", "required done", "all labeled", "started", null],
    },
    add_place: {
      items: [D3, D11, D5, { line: 1 }],
      values: ["in the next Add", "waits for room", "needs labels", null],
    },

    labeled_questions: { items: [D3, D5, D8], values: ["topic, urgent", "topic, tone", ""] },
    missing_questions: { items: [D5, D8, D3], values: ["urgent", "topic, urgent", ""] },
    your_labels: {
      ctx: C,
      items: [D3, D11, D5, D8],
      values: ["topic: shipping; urgent: yes", "topic: shipping; urgent: no; tone: 0", "topic: billing; tone: 1", ""],
    },
  },
  { ctx: () => ctx() },
);
