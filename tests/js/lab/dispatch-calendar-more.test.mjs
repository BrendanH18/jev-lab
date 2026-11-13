import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-calendar-more.js";
import { fixtureLast, fixtureWorld, sampleDispatchCalendarCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's meetings in world order (today is Friday 2026-03-20): bean_brokers_call Tue 10:00 (vendor), team_sync
// Fri 11:00 (moved, the shop), northside_tasting Thu 14:00 (customer), accountant_review Fri 11:00 (another
// organization), weekend_cupping Sat 08:30 (the shop; hidden by the page), late_pickup Mon 18:30 (vendor),
// inventory_count Thu "TBD" with no domain.
const ctx = sampleDispatchCalendarCtx();
const items = ctx.items();
const empty = () => sampleDispatchCalendarCtx({ world: null });
const without = (...ids) => sampleDispatchCalendarCtx({ matches: (id, item) => !ids.includes(item.id) });

// A busier week for gaps and overlaps: four more meetings appended after the fixture's seven.
//   packaging_review Tue 09:30 (PackRight, a vendor): 09:30-10:30 overlaps the 10:00 Bean Brokers call
//   roaster_service  Tue 11:00 (Roastworks, a vendor): starts the minute the Bean Brokers call ends (back to back)
//   lunch_meetup     Wed 12:30 (nairdesign.example, the one customer Priya Nair): runs into the lunch hour
//   regulars_coffee  Wed 15:00 (mail.example, shared by three customers): a customer, but no single name
const busyWorld = (extra = {}) => {
  const world = fixtureWorld();
  Object.assign(world.meetings, {
    packaging_review: { title: "Packaging review with PackRight", day: "tuesday", time: "09:30", with_domain: "packright.example" },
    roaster_service: { title: "Roaster service visit", day: "tuesday", time: "11:00", with_domain: "roastworks.example" },
    lunch_meetup: { title: "Lunch with Priya Nair", day: "wednesday", time: "12:30", with_domain: "nairdesign.example" },
    regulars_coffee: { title: "Coffee with the regulars", day: "wednesday", time: "15:00", with_domain: "mail.example" },
    ...extra,
  });
  return world;
};
const busy = sampleDispatchCalendarCtx({ world: busyWorld() });
const busyItems = busy.items();
// Order: bean, team, northside, accountant, weekend, late, inventory, packaging, roaster, lunch, regulars.

// The same week with the user's own latest command planning to move team_sync.
const base = fixtureLast();
const moving = sampleDispatchCalendarCtx({ world: busyWorld(),
  last: { ...base, plan: { ...base.plan, tool: "reschedule_meeting", exec_args: { meeting: "team_sync", day: "friday", time: "11:00" } } } });

// Every weekday booked: the busy week plus a Monday 13:00 meeting. Free stretches (08:00-18:00, one hour each):
// Mon 08-13 (5h), 14-18 (4h); Tue 08-09:30, 12-18 (6h); Wed 08-12:30, 13:30-18 (4.5h each); Thu 08-14 (6h), 15-18;
// Fri 08-11, 12-18 (6h). Wednesday is 08-12:30, 13:30-15, 16-18. The first 6-hour stretch in week order is Tuesday's
// (checked with exact arithmetic in a separate script).
const fullWeek = sampleDispatchCalendarCtx({ world: busyWorld({ payroll: { title: "Payroll check-in", day: "monday", time: "13:00", with_domain: "harborcoffee.example" } }) });

checkPack(pack, {
  day_load: { items: busyItems, ctx: busy, values: [3, 2, 2, 2, 1, 1, 2, 3, 3, 2, 2] },
  // bean 10:00 -> roaster 11:00 starts as it ends (0); team/accountant share 11:00 (-60); packaging 09:30 -> bean
  // 10:00 starts 30 minutes before packaging ends (-30); lunch 12:30 ends 13:30, regulars start 15:00 (90); the rest
  // are the last timed meeting of their day.
  next_gap: { items: busyItems, ctx: busy, values: [0, -60, null, -60, null, null, null, -30, null, 90, null] },
  overlap_count: { items: busyItems, ctx: busy, values: [1, 1, 0, 1, 0, 0, null, 1, 0, 0, 0] },
  back_to_back: { items: busyItems, ctx: busy, values: [true, false, false, false, false, false, false, false, true, false, false] },
  early: { items: busyItems, ctx: busy, values: [false, false, false, false, true, false, false, false, false, false, false] },
  late: { items: busyItems, ctx: busy, values: [false, false, false, false, false, true, false, false, false, false, false] },
  // team_sync 11:00 ends exactly at 12:00, so it does not run into lunch.
  lunch: { items: busyItems, ctx: busy, values: [false, false, false, false, false, false, false, false, false, true, false] },
  partner_type: { items: busyItems, ctx: busy,
    values: ["vendor", "the shop", "customer", "other", "the shop", "vendor", null, "vendor", "vendor", "customer", "customer"] },
  partner_name: { items: busyItems, ctx: busy,
    values: ["Bean Brokers Ltd", "", "Northside Bistro", "", "", "Coastline Freight", "", "PackRight Packaging", "Roastworks Machinery", "Priya Nair", ""] },
  in_plan: { items: moving.items(), ctx: moving, values: [false, true, false, false, false, false, false, false, false, false, false] },
  // Today is Friday 2026-03-20: Monday to Thursday are past, Friday is not, and Saturday is not on the calendar.
  past_day: { items: busyItems, ctx: busy, values: [true, false, true, false, false, true, true, true, true, true, true] },

  overlap: { ctx: busy, hitList: busy.shown(), missList: items,
    message: /^Packaging review with PackRight \(09:30\) and Supplier call with Bean Brokers \(10:00\) overlap on Tuesday, if each takes an hour\.$/ },
  heavy_day: { ctx: busy, hitList: busy.shown(), missList: items, message: /^Tuesday has 3 meetings\.$/ },
  moved_conflict: { ctx, hit: items[1], miss: [items[3], { ...items[0], moved: true }],
    message: /^Moved to Friday 11:00, where it overlaps Quarterly review with the accountant\.$/ },
  no_domain: { ctx, hit: items[6], miss: [items[0], items[1]], message: /^No attendee domain is on file, so an emailed request to move it can never pass "Sender is part of this meeting"/ },
  vague_slot: { ctx, hitList: ctx.shown(), missList: [items[1], items[5], items[6]],
    message: /^(Tuesday 10:00 is taken by Supplier call with Bean Brokers: a move to "tuesday morning" would land on it \(the plan reads "morning" as 10:00; local advice\)\.|Thursday 14:00 is taken by Wholesale tasting with Northside Bistro: a move to "thursday afternoon" would land on it \(the plan reads "afternoon" as 14:00; local advice\)\.)$/ },

  longest_free: [{ ctx, expect: (result) => { assert.equal(result.value, 10); assert.equal(result.detail, "Monday 08:00 to 18:00"); }, empty: empty() },
    { ctx: fullWeek, expect: (result) => { assert.equal(result.value, 6); assert.equal(result.detail, "Tuesday 12:00 to 18:00"); } }],
  free_days: [{ ctx, expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "Wednesday"); }, empty: empty() }, { ctx: busy, expect: 0 }],
  // Two meetings tie for the last slot, Friday 11:00: both are named, in shown order.
  last_meeting: [{ ctx, expect: (result) => { assert.equal(result.value, "Friday 11:00"); assert.equal(result.detail, "Weekly team sync, Quarterly review with the accountant"); }, empty: empty() },
    { ctx: without("team_sync", "accountant_review"), expect: "Thursday 14:00" }],
  earliest_start: [{ ctx, expect: (result) => { assert.equal(result.value, "10:00"); assert.equal(result.detail, "Supplier call with Bean Brokers (Tuesday)"); }, empty: empty() },
    { ctx: busy, expect: "09:30" }],
  latest_start: [{ ctx, expect: (result) => { assert.equal(result.value, "18:30"); assert.equal(result.detail, "Late pallet pickup (Monday)"); }, empty: empty() },
    { ctx: without("late_pickup"), expect: "14:00" }],
  // Shown outside domains: beanbrokers, northsidebistro, ledgerwisecpa, coastlinefreight; the busy week adds packright,
  // roastworks, nairdesign and mail.example.
  partner_domains: [{ ctx, expect: 4, empty: empty() }, { ctx: busy, expect: 8 }],

  week_grid: { ctx, filename: "harbor-week-grid.md", text: [
    "| Monday | Tuesday | Wednesday | Thursday | Friday |",
    "| --- | --- | --- | --- | --- |",
    "| 18:30 Late pallet pickup | 10:00 Supplier call with Bean Brokers |  | 14:00 Wholesale tasting with Northside Bistro | 11:00 Weekly team sync (moved) |",
    "|  |  |  | TBD Inventory count | 11:00 Quarterly review with the accountant |",
  ].join("\n") + "\n" },
  jsonl: { ctx, filename: "harbor-meetings.jsonl",
    includes: ['{"id":"bean_brokers_call","title":"Supplier call with Bean Brokers","day":"tuesday","time":"10:00","with_domain":"beanbrokers.example","moved":false}\n',
      '{"id":"inventory_count","title":"Inventory count","day":"thursday","time":"TBD","with_domain":null,"moved":false}\n'],
    excludes: ["weekend_cupping"],
    check: (out) => assert.equal(out.text.split("\n").length - 1, 6) },
  free_slots: { ctx, filename: "harbor-free-time.txt", text: [
    "Free working time, 08:00 to 18:00, one hour per shown meeting (simulation data)",
    "Monday: 08:00–18:00", "Tuesday: 08:00–10:00, 11:00–18:00", "Wednesday: 08:00–18:00", "Thursday: 08:00–14:00, 15:00–18:00",
    "Friday: 08:00–11:00, 12:00–18:00", "Not counted (start time not readable): Inventory count (Thursday)",
  ].join("\n") + "\n" },
  by_domain: { ctx, filename: "harbor-meetings-by-domain.csv", text: [
    '"domain","attendee_type","meetings","titles"', '"beanbrokers.example","vendor","1","Supplier call with Bean Brokers"',
    '"coastlinefreight.example","vendor","1","Late pallet pickup"', '"harborcoffee.example","the shop","1","Weekly team sync"',
    '"ledgerwisecpa.example","other","1","Quarterly review with the accountant"', '"northsidebistro.example","customer","1","Wholesale tasting with Northside Bistro"',
    '"(no domain)","","1","Inventory count"',
  ].join("\r\n") + "\r\n", excludes: ["Weekend cupping"] },
}, { ctx: () => sampleDispatchCalendarCtx() });

// The list checks' exact findings (checkPack only checks that each finding matches the pattern), and odd inputs.
const byId = (id) => pack.features.find((feature) => feature.id === id);
test("dispatch-calendar-more list checks report every finding, and odd items give no value", () => {
  assert.deepEqual(byId("vague_slot").check(ctx.shown(), ctx), [
    'Tuesday 10:00 is taken by Supplier call with Bean Brokers: a move to "tuesday morning" would land on it (the plan reads "morning" as 10:00; local advice).',
    'Thursday 14:00 is taken by Wholesale tasting with Northside Bistro: a move to "thursday afternoon" would land on it (the plan reads "afternoon" as 14:00; local advice).',
  ]);
  // Sorted by title, the overlap is still reported once, earlier start first.
  assert.equal(byId("overlap").check([...busy.shown()].reverse(), busy).length, 1);
  assert.deepEqual(byId("heavy_day").check(busy.shown(), busy), ["Tuesday has 3 meetings."]);
  // A reschedule plan without a meeting never marks an item without an id.
  const noMeeting = sampleDispatchCalendarCtx({ last: { ...base, plan: { ...base.plan, tool: "reschedule_meeting", exec_args: { day: "friday" } } } });
  assert.equal(byId("in_plan").value({ title: "No id" }, noMeeting), false);
  for (const feature of pack.features.filter((entry) => entry.kind === "fact")) {
    for (const odd of [{}, { day: 3, minutes: "10:00", with_domain: 7 }]) assert.doesNotThrow(() => feature.value(odd, ctx), feature.id);
  }
  assert.equal(byId("past_day").value(items[0], sampleDispatchCalendarCtx({ world: { ...fixtureWorld(), today: "soon" } })), false);
});
