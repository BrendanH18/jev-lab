import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-week-planner.js";
import { sampleDispatchCalendarCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's meetings in world order (today is Friday 2026-03-20): bean_brokers_call Tue 10:00, team_sync Fri 11:00
// (moved, internal), northside_tasting Thu 14:00, accountant_review Fri 11:00, weekend_cupping Sat 08:30 (internal;
// hidden by the page because it is not a weekday), late_pickup Mon 18:30, inventory_count Thu "TBD" with no domain.
const ctx = sampleDispatchCalendarCtx();
const items = ctx.items();
const empty = () => sampleDispatchCalendarCtx({ world: null });
const without = (...ids) => sampleDispatchCalendarCtx({ matches: (id, item) => !ids.includes(item.id) });

checkPack(pack, {
  day: { items, ctx, values: ["tuesday", "friday", "thursday", "friday", "saturday", "monday", "thursday"] },
  start: { items, ctx, values: [600, 660, 840, 660, 510, 1110, null] },
  day_number: { items, ctx, values: [2, 5, 4, 5, null, 1, 4] },
  moved: { items, ctx, values: [false, true, false, false, false, false, false] },
  morning: { items, ctx, values: [true, true, false, true, true, false, false] },
  domain: { items, ctx, values: ["beanbrokers.example", "harborcoffee.example", "northsidebistro.example", "ledgerwisecpa.example", "harborcoffee.example", "coastlinefreight.example", null] },
  internal: { items, ctx, values: [false, true, false, false, true, false, false] },
  title: { items, ctx, values: ["Supplier call with Bean Brokers", "Weekly team sync", "Wholesale tasting with Northside Bistro", "Quarterly review with the accountant",
    "Weekend cupping with the roasting team", "Late pallet pickup", "Inventory count"] },
  week_hour: { items, ctx, values: [34, 107, 86, 107, null, 18.5, null] },
  clash_count: { items, ctx, values: [0, 1, 0, 1, 0, 0, null] },

  clash: { ctx, hitList: items, missList: [items[0], items[2], items[6]], message: /^Weekly team sync and Quarterly review with the accountant both start Friday 11:00\.$/ },
  outside_hours: { ctx, hit: [items[5], { ...items[0], minutes: 450 }], miss: [items[0], items[6], { ...items[0], minutes: 1079 }], message: /^Starts at (18:30|07:30), outside 08:00 to 18:00\.$/ },
  unreadable_time: { ctx, hit: items[6], miss: items[0], message: /^The start time "TBD" is not HH:MM\.$/ },

  moved_count: { ctx, expect: 1, empty: empty() },
  busiest_day: [{ ctx, expect: "Thursday, Friday", empty: empty() }, { ctx: without("inventory_count"), expect: "Friday" },
    { ctx, expect: (result) => assert.equal(result.detail, "2 meetings") }],
  first_meeting: [{ ctx, expect: "Monday 18:30", empty: empty() }, { ctx: without("late_pickup"), expect: "Tuesday 10:00" }],
  external_share: [{ ctx, expect: 0.8, empty: empty() }, { ctx: without("team_sync"), expect: 1 }],
  off_calendar: { ctx, expect: 1, empty: empty() },

  ics: { ctx, filename: "harbor-week.ics",
    includes: ["BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Jev Lab//Dispatch week planner//EN\r\nBEGIN:VEVENT\r\nUID:bean_brokers_call@harborcoffee.example\r\n"
      + "DTSTAMP:20260320T000000Z\r\nDTSTART:20260317T100000\r\nDTEND:20260317T110000\r\nSUMMARY:Supplier call with Bean Brokers\r\nEND:VEVENT\r\n",
    "DTSTART:20260316T183000\r\nDTEND:20260316T193000\r\nSUMMARY:Late pallet pickup", "DTSTART:20260320T110000", "END:VCALENDAR\r\n"],
    excludes: ["Inventory count", "Weekend cupping"],
    check: (out) => assert.equal(out.text.split("BEGIN:VEVENT").length - 1, 5) },
  agenda: { ctx, filename: "harbor-agenda.txt",
    text: ["Monday 18:30 · Late pallet pickup · coastlinefreight.example", "Tuesday 10:00 · Supplier call with Bean Brokers · beanbrokers.example",
      "Thursday 14:00 · Wholesale tasting with Northside Bistro · northsidebistro.example", "Thursday TBD · Inventory count",
      "Friday 11:00 · Weekly team sync · harborcoffee.example · moved", "Friday 11:00 · Quarterly review with the accountant · ledgerwisecpa.example"].join("\n") + "\n" },
  meetings_csv: { ctx, filename: "harbor-meetings.csv",
    includes: ['"meeting","title","day","time","with_domain","moved"\r\n', '"team_sync","Weekly team sync","friday","11:00","harborcoffee.example","yes"\r\n',
      '"inventory_count","Inventory count","thursday","TBD","","no"\r\n'],
    excludes: ["weekend_cupping"] },

  draft_move: {
    ctx: () => sampleDispatchCalendarCtx(),
    check: (c) => assert.deepEqual(c.recorded, [["draftCommand", "move the supplier call with Bean Brokers to "]]),
    hidden: empty,
  },
  copy_today: {
    ctx: () => sampleDispatchCalendarCtx(),
    check: (c) => {
      assert.deepEqual(c.env.copied, ["11:00 Weekly team sync\n11:00 Quarterly review with the accountant"]);
      assert.equal(c.env.toasts[0].message, "Copied 2 meetings for today.");
    },
    hidden: empty,
  },
}, { ctx: () => sampleDispatchCalendarCtx() });
