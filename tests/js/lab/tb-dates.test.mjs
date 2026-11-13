// Tests for the tb-dates pack. Reference values are counted by hand from a calendar: 2026-01-01 and 2026-11-12 are
// Thursdays, 2026-11-01 is a Sunday, 2027-01-01 a Friday and 2027-02-01 a Monday; 2026 starts on a Thursday, so it has
// 53 ISO weeks. Unix times: 1970-01-01 to 2026-01-01 is 56 * 365 + 14 leap days = 20,454 days, and 2026-11-12 is 315
// days later, so 2026-11-12T00:00:00Z is 20,769 * 86,400 = 1,794,441,600 seconds.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-dates.js";
import { checkPack } from "./harness.mjs";

const exactly = (rows, table, text) => (result) => {
  assert.deepEqual(result.rows, rows);
  if (table !== undefined) assert.deepEqual(result.table, table);
  if (text !== undefined) assert.equal(result.text, text);
};
const MIDNIGHT = 1794441600; // 2026-11-12T00:00:00Z

checkPack(pack, {
  // November 1 to 30 is 29 days, then 25 more: 54.
  days_between: {
    values: { start: "2026-11-01", end: "2026-12-25" },
    expect: [["Days from start to end", 54], ["Dates counted with both ends", 55], ["Weeks", 54 / 7], ["Whole weeks and days", "7 weeks, 5 days"], ["Order", "end is after start"]],
    more: [
      { values: { start: "2026-12-25", end: "2026-11-01" }, expect: [["Days from start to end", -54], ["Dates counted with both ends", 55], ["Weeks", -54 / 7], ["Whole weeks and days", "7 weeks, 5 days"], ["Order", "end is before start"]] },
      { values: { start: "2026-11-12", end: "2026-11-12" }, expect: [["Days from start to end", 0], ["Dates counted with both ends", 1], ["Weeks", 0], ["Whole weeks and days", "0 weeks, 0 days"], ["Order", "same day"]] },
      // 2024 is a leap year: February 29 lies between.
      { values: { start: "2024-02-28", end: "2024-03-08" }, expect: [["Days from start to end", 9], ["Dates counted with both ends", 10], ["Weeks", 9 / 7], ["Whole weeks and days", "1 week, 2 days"], ["Order", "end is after start"]] },
    ],
    invalid: [{ start: "2026-02-29", end: "2026-03-01" }, { start: "2026/11/01", end: "2026-11-02" }, { start: "", end: "2026-11-02" }],
  },
  // Monday November 2 to Sunday November 15: 10 weekdays, 4 weekend days; the 11th (a Wednesday) is a holiday, the 14th
  // is a Saturday anyway, and December 25 is outside the range.
  business_days_between: {
    values: { start: "2026-11-02", end: "2026-11-15", holidays: "2026-11-11, 2026-11-14\n2026-12-25" },
    expect: [["Business days", 9], ["Calendar days (both ends)", 14], ["Weekend days", 4], ["Holidays on weekdays", 1]],
    more: [{ values: { start: "2026-11-14", end: "2026-11-14" }, expect: [["Business days", 0], ["Calendar days (both ends)", 1], ["Weekend days", 1], ["Holidays on weekdays", 0]] }],
    invalid: [{ start: "2026-11-15", end: "2026-11-02" }, { start: "2026-11-02", end: "2026-11-15", holidays: "2026-13-01" }],
  },
  // Thursday the 12th plus 3: Friday 13 (1), Monday 16 (2), Tuesday 17 (3).
  add_business_days: {
    values: { start: "2026-11-12", days: 3 },
    expect: [["Date", "2026-11-17"], ["Weekday", "Tuesday"], ["Calendar days from the start", 5], ["Weekend days skipped", 2], ["Holidays skipped", 0]],
    more: [
      { values: { start: "2026-11-12", days: 3, holidays: "2026-11-16" }, expect: [["Date", "2026-11-18"], ["Weekday", "Wednesday"], ["Calendar days from the start", 6], ["Weekend days skipped", 2], ["Holidays skipped", 1]] },
      { values: { start: "2026-11-16", days: -1 }, expect: [["Date", "2026-11-13"], ["Weekday", "Friday"], ["Calendar days from the start", -3], ["Weekend days skipped", 2], ["Holidays skipped", 0]] },
      { values: { start: "2026-11-14", days: 0 }, expect: [["Date", "2026-11-14"], ["Weekday", "Saturday"], ["Calendar days from the start", 0], ["Weekend days skipped", 0], ["Holidays skipped", 0]] },
    ],
    invalid: [{ start: "2026-11-12", days: 1.5 }, { start: "2026-11-12", days: 10001 }, { start: "9999-12-31", days: 1 }],
  },
  // January 31 plus a month lands on February 28 (2026 is not a leap year), a Saturday, 28 days later.
  add_to_date: {
    values: { date: "2026-01-31", amount: 1, unit: "months" },
    expect: [["Date", "2026-02-28"], ["Weekday", "Saturday"], ["Days from the date", 28], ["Moved to the month's last day", "yes"]],
    more: [
      // 2025-01-01 was a Wednesday, so 2025-02-28 (58 days later) was a Friday.
      { values: { date: "2024-02-29", amount: 1, unit: "years" }, expect: [["Date", "2025-02-28"], ["Weekday", "Friday"], ["Days from the date", 365], ["Moved to the month's last day", "yes"]] },
      { values: { date: "2026-11-12", amount: -2, unit: "weeks" }, expect: [["Date", "2026-10-29"], ["Weekday", "Thursday"], ["Days from the date", -14], ["Moved to the month's last day", "no"]] },
      { values: { date: "2026-03-31", amount: -1, unit: "months" }, expect: [["Date", "2026-02-28"], ["Weekday", "Saturday"], ["Days from the date", -31], ["Moved to the month's last day", "yes"]] },
      { values: { date: "2026-11-12", amount: 49, unit: "days" }, expect: [["Date", "2026-12-31"], ["Weekday", "Thursday"], ["Days from the date", 49], ["Moved to the month's last day", "no"]] },
    ],
    invalid: [{ date: "9999-12-31", amount: 1, unit: "days" }, { date: "9999-12-31", amount: 1, unit: "months" }, { date: "2026-11-12", amount: 1, unit: "decades" }],
  },
  // November 12 is day 304 + 12 = 316 of 2026, in week 46 (45 Thursdays after the one on January 1).
  weekday_and_week: {
    values: { date: "2026-11-12" },
    expect: [["Weekday", "Thursday"], ["ISO weekday number", 4], ["ISO week", "2026-W46"], ["Day of the year", 316], ["Days left in the year", 49], ["Leap year", "no"]],
    more: [
      // Friday 2027-01-01 shares its week with Thursday 2026-12-31: week 53 of 2026.
      { values: { date: "2027-01-01" }, expect: [["Weekday", "Friday"], ["ISO weekday number", 5], ["ISO week", "2026-W53"], ["Day of the year", 1], ["Days left in the year", 364], ["Leap year", "no"]] },
      // Monday 2024-12-30 shares its week with Thursday 2025-01-02: week 1 of 2025.
      { values: { date: "2024-12-30" }, expect: [["Weekday", "Monday"], ["ISO weekday number", 1], ["ISO week", "2025-W01"], ["Day of the year", 365], ["Days left in the year", 1], ["Leap year", "yes"]] },
    ],
    invalid: [{ date: "2026-11-31" }],
  },
  iso_week_dates: {
    values: { year: 2026, week: 46 },
    expect: exactly([["Monday", "2026-11-09"], ["Sunday", "2026-11-15"], ["Weeks in the year", 53]], { columns: ["day", "date"], rows: [["Monday", "2026-11-09"], ["Tuesday", "2026-11-10"],
      ["Wednesday", "2026-11-11"], ["Thursday", "2026-11-12"], ["Friday", "2026-11-13"], ["Saturday", "2026-11-14"], ["Sunday", "2026-11-15"]] }),
    // January 4, 2026 is a Sunday, so week 1 starts Monday December 29, 2025. 2025 starts on a Wednesday: 52 weeks.
    more: [{ values: { year: 2026, week: 1 }, expect: exactly([["Monday", "2025-12-29"], ["Sunday", "2026-01-04"], ["Weeks in the year", 53]]) },
      { values: { year: 2025, week: 52 }, expect: exactly([["Monday", "2025-12-22"], ["Sunday", "2025-12-28"], ["Weeks in the year", 52]]) }],
    invalid: [{ year: 2025, week: 53 }, { year: 2026, week: 0 }],
  },
  // 09:30:05.25 after midnight is 34,205.25 seconds.
  unix_to_iso: {
    values: { value: MIDNIGHT + 34205.25 },
    expect: [["ISO 8601 (UTC)", "2026-11-12T09:30:05.250Z"], ["Date (UTC)", "2026-11-12"], ["Time (UTC)", "09:30:05.250"], ["Weekday (UTC)", "Thursday"],
      ["Unix seconds", 1794475805.25], ["Unix milliseconds", 1794475805250]],
    more: [
      { values: { value: -1 }, expect: [["ISO 8601 (UTC)", "1969-12-31T23:59:59Z"], ["Date (UTC)", "1969-12-31"], ["Time (UTC)", "23:59:59"], ["Weekday (UTC)", "Wednesday"], ["Unix seconds", -1], ["Unix milliseconds", -1000]] },
      { values: { value: 0, unit: "ms" }, expect: [["ISO 8601 (UTC)", "1970-01-01T00:00:00Z"], ["Date (UTC)", "1970-01-01"], ["Time (UTC)", "00:00:00"], ["Weekday (UTC)", "Thursday"], ["Unix seconds", 0], ["Unix milliseconds", 0]] },
    ],
    invalid: [{ value: 1e15 }, { value: "soon" }],
  },
  // 09:30:05 at +02:00 is 07:30:05 UTC: 27,005 seconds after midnight.
  iso_to_unix: {
    values: { stamp: "2026-11-12T09:30:05+02:00" },
    expect: [["Unix seconds", MIDNIGHT + 27005], ["Unix milliseconds", (MIDNIGHT + 27005) * 1000], ["UTC", "2026-11-12T07:30:05Z"], ["Offset", "+02:00"]],
    more: [
      { values: { stamp: "2026-11-12 09:30" }, expect: [["Unix seconds", MIDNIGHT + 34200], ["Unix milliseconds", (MIDNIGHT + 34200) * 1000], ["UTC", "2026-11-12T09:30:00Z"], ["Offset", "none (read as UTC)"]] },
      { values: { stamp: "2026-11-12" }, expect: [["Unix seconds", MIDNIGHT], ["Unix milliseconds", MIDNIGHT * 1000], ["UTC", "2026-11-12T00:00:00Z"], ["Offset", "none (read as UTC)"]] },
      { values: { stamp: "1970-01-01T00:00:00.1239Z" }, expect: [["Unix seconds", 0.123], ["Unix milliseconds", 123], ["UTC", "1970-01-01T00:00:00.123Z"], ["Offset", "Z"]] },
      // 00:30 at -05:30 is 06:00 UTC.
      { values: { stamp: "2026-11-12T00:30:00-0530" }, expect: [["Unix seconds", MIDNIGHT + 21600], ["Unix milliseconds", (MIDNIGHT + 21600) * 1000], ["UTC", "2026-11-12T06:00:00Z"], ["Offset", "-05:30"]] },
    ],
    // The last two land in years 10000 and 0000 once moved to UTC.
    invalid: [{ stamp: "2026-11-12T24:00" }, { stamp: "12/11/2026" }, { stamp: "2026-11-12T10:00+19:00" }, { stamp: "9999-12-31T23:00:00-05:00" }, { stamp: "0001-01-01T00:00:00+05:00" }],
  },
  // Line 2 reads month first (and could be December 11); line 3's Thursday agrees; line 6's Friday does not.
  normalize_dates: {
    values: { text: "2026-11-12\n11/12/2026\nThu, 12 Nov 2026\nNovember 3rd, 2026\n2026/02/30\nFri 2026-11-12\nsoon\n\n20261231\n13.01.2026" },
    expect: exactly([["Lines", 9], ["Dates read", 5], ["Lines not read", 4], ["Could be read either way", 1], ["Earliest", "2026-11-03"], ["Latest", "2026-12-31"]],
      { columns: ["line", "input", "date", "status"], rows: [[1, "2026-11-12", "2026-11-12", "ok"], [2, "11/12/2026", "2026-11-12", "ok"], [3, "Thu, 12 Nov 2026", "2026-11-12", "ok"],
        [4, "November 3rd, 2026", "2026-11-03", "ok"], [5, "2026/02/30", "", "no such date"], [6, "Fri 2026-11-12", "", "weekday does not match"], [7, "soon", "", "not a date format"],
        [9, "20261231", "2026-12-31", "ok"], [10, "13.01.2026", "", "no such date"]] },
      "2026-11-12\n2026-11-12\n2026-11-12\n2026-11-03\n2026-12-31"),
    more: [
      { values: { text: "2026-11-12\n11/12/2026\nNov 3, 2026\n20261231", sort: true, unique: true },
        expect: exactly([["Lines", 4], ["Dates read", 4], ["Lines not read", 0], ["Could be read either way", 1], ["Earliest", "2026-11-03"], ["Latest", "2026-12-31"]], undefined, "2026-11-03\n2026-11-12\n2026-12-31") },
      // Day first: 13.01 is January 13; 11/12 is December 11; 5/5 reads the same both ways.
      { values: { text: "13.01.2026\n11/12/2026\n5/5/2026", order: "dmy" },
        expect: exactly([["Lines", 3], ["Dates read", 3], ["Lines not read", 0], ["Could be read either way", 1], ["Earliest", "2026-01-13"], ["Latest", "2026-12-11"]], undefined, "2026-01-13\n2026-12-11\n2026-05-05") },
      { values: { text: "12-Sep-2026\n1 Sept 2026" }, expect: exactly([["Lines", 2], ["Dates read", 2], ["Lines not read", 0], ["Could be read either way", 0], ["Earliest", "2026-09-01"], ["Latest", "2026-09-12"]], undefined, "2026-09-12\n2026-09-01") },
      { values: { text: "never" }, expect: exactly([["Lines", 1], ["Dates read", 0], ["Lines not read", 1], ["Could be read either way", 0], ["Earliest", null], ["Latest", null]], undefined, "") },
    ],
    invalid: [{ text: "  " }, { text: "2026-11-12", order: "ymd" }],
  },
  // November 12 + 30 days is Saturday December 12.
  refund_window: {
    values: { purchase: "2026-11-12", length: 30 },
    expect: [["Window closes on", "2026-12-12"], ["Weekday", "Saturday"], ["Moved to a business day", "no"], ["Check date inside the window", null], ["Days left on the check date", null]],
    more: [
      { values: { purchase: "2026-11-12", length: 30, move: true }, expect: [["Window closes on", "2026-12-14"], ["Weekday", "Monday"], ["Moved to a business day", "yes"], ["Check date inside the window", null], ["Days left on the check date", null]] },
      { values: { purchase: "2026-11-12", length: 30, move: true, holidays: "2026-12-14", check: "2026-12-15" },
        expect: [["Window closes on", "2026-12-15"], ["Weekday", "Tuesday"], ["Moved to a business day", "yes"], ["Check date inside the window", "yes"], ["Days left on the check date", 0]] },
      { values: { purchase: "2026-11-12", length: 30, move: true, holidays: "2026-12-14", check: "2026-12-16" },
        expect: [["Window closes on", "2026-12-15"], ["Weekday", "Tuesday"], ["Moved to a business day", "yes"], ["Check date inside the window", "no"], ["Days left on the check date", -1]] },
      // Before the purchase: not inside, 18 + 15 + 11 = 44 days before the close.
      { values: { purchase: "2026-11-12", length: 30, move: true, holidays: "2026-12-14", check: "2026-11-01" },
        expect: [["Window closes on", "2026-12-15"], ["Weekday", "Tuesday"], ["Moved to a business day", "yes"], ["Check date inside the window", "no"], ["Days left on the check date", 44]] },
      // Ten business days: 13, 16-20, 23-25, (26 is a holiday), 27.
      { values: { purchase: "2026-11-12", length: 10, unit: "business", holidays: "2026-11-26" },
        expect: [["Window closes on", "2026-11-27"], ["Weekday", "Friday"], ["Moved to a business day", "no"], ["Check date inside the window", null], ["Days left on the check date", null]] },
      { values: { purchase: "2026-11-12", length: 0, check: "2026-11-12" },
        expect: [["Window closes on", "2026-11-12"], ["Weekday", "Thursday"], ["Moved to a business day", "no"], ["Check date inside the window", "yes"], ["Days left on the check date", 0]] },
    ],
    invalid: [{ purchase: "2026-11-12", length: -1 }, { purchase: "2026-11-12", length: 30, check: "tomorrow" }],
  },
  // 2025-01-31 to 2026-01-31 is 365 days, then 273 to October 31 and 12 more: 650. 21 months reach 2026-10-31.
  date_age: {
    values: { date: "2025-01-31", asOf: "2026-11-12" },
    expect: [["Days", 650], ["Weeks", 650 / 7], ["Completed months", 21], ["Completed years", 1], ["Years, months and days", "1 year, 9 months, 12 days"], ["When", "in the past"]],
    more: [
      { values: { date: "2026-01-31", asOf: "2026-02-28" }, expect: [["Days", 28], ["Weeks", 4], ["Completed months", 1], ["Completed years", 0], ["Years, months and days", "0 years, 1 month, 0 days"], ["When", "in the past"]] },
      { values: { date: "2026-12-25", asOf: "2026-11-12" }, expect: [["Days", -43], ["Weeks", -43 / 7], ["Completed months", 1], ["Completed years", 0], ["Years, months and days", "0 years, 1 month, 13 days"], ["When", "in the future"]] },
      { values: { date: "2026-11-12", asOf: "2026-11-12" }, expect: [["Days", 0], ["Weeks", 0], ["Completed months", 0], ["Completed years", 0], ["Years, months and days", "0 years, 0 months, 0 days"], ["When", "the same day"]] },
    ],
    invalid: [{ date: "2026-11-12", asOf: "" }],
  },
  // October has 31 days, so November 12 is day 43 of Q4; 18 + 31 = 49 days remain.
  quarter_bounds: {
    values: { date: "2026-11-12" },
    expect: [["Month start", "2026-11-01"], ["Month end", "2026-11-30"], ["Days in the month", 30], ["Quarter", "Q4 2026"], ["Quarter start", "2026-10-01"], ["Quarter end", "2026-12-31"],
      ["Day of the quarter", 43], ["Days left in the quarter", 49], ["Year start", "2026-01-01"], ["Year end", "2026-12-31"]],
    more: [
      { values: { date: "2026-11-12", start: "7" }, expect: [["Month start", "2026-11-01"], ["Month end", "2026-11-30"], ["Days in the month", 30], ["Quarter", "FY2027 Q2"], ["Quarter start", "2026-10-01"],
        ["Quarter end", "2026-12-31"], ["Day of the quarter", 43], ["Days left in the quarter", 49], ["Year start", "2026-07-01"], ["Year end", "2027-06-30"]] },
      // An April year: February 2026 is in the fourth quarter of the year that started 2025-04-01.
      { values: { date: "2026-02-10", start: "4" }, expect: [["Month start", "2026-02-01"], ["Month end", "2026-02-28"], ["Days in the month", 28], ["Quarter", "FY2026 Q4"], ["Quarter start", "2026-01-01"],
        ["Quarter end", "2026-03-31"], ["Day of the quarter", 41], ["Days left in the quarter", 49], ["Year start", "2025-04-01"], ["Year end", "2026-03-31"]] },
    ],
    invalid: [{ date: "2026-11-12", start: "13" }],
  },
  // Line 2 has a date but no time. Line 4 (10:00:20 at +01:00) is 09:00:20 UTC, 10.5 seconds before line 3.
  log_durations: {
    values: { text: "2026-11-12T09:00:00Z start\n2026-11-12 daily report\n2026-11-12 09:00:30.500 step\n2026-11-12T10:00:20+01:00 back\n2026-11-12T09:05:00Z done" },
    expect: exactly([["Lines with a timestamp", 4], ["Lines without one", 1], ["First to last (seconds)", 300], ["First to last", "5 min"], ["Longest gap (seconds)", 280],
      ["Longest gap ends on line", 5], ["Median gap (seconds)", 30.5], ["Steps back in time", 1]],
    { columns: ["line", "timestamp (UTC)", "seconds since previous", "seconds since first"], rows: [[1, "2026-11-12T09:00:00Z", null, 0],
      [3, "2026-11-12T09:00:30.500Z", 30.5, 30.5], [4, "2026-11-12T09:00:20Z", -10.5, 20], [5, "2026-11-12T09:05:00Z", 280, 300]] }),
    more: [
      { values: { text: "x 2026-01-01T00:00Z" }, expect: exactly([["Lines with a timestamp", 1], ["Lines without one", 0], ["First to last (seconds)", 0], ["First to last", "0 s"],
        ["Longest gap (seconds)", null], ["Longest gap ends on line", null], ["Median gap (seconds)", null], ["Steps back in time", 0]]) },
      // 1 day, 1 hour, 2 minutes, 5.5 seconds = 90,125.5 seconds; two gaps of 60 and 90,065.5 have median 45,062.75.
      { values: { text: "2026-11-12T09:00:00Z\n2026-11-12T09:01:00Z\n2026-11-13T10:02:05.500Z" }, expect: exactly([["Lines with a timestamp", 3], ["Lines without one", 0],
        ["First to last (seconds)", 90125.5], ["First to last", "1 d 1 h 2 min 5.5 s"], ["Longest gap (seconds)", 90065.5], ["Longest gap ends on line", 3], ["Median gap (seconds)", 45062.75], ["Steps back in time", 0]]) },
      // Line 1's first date has no time, so its timestamp is the later one; line 2's date is glued to a digit and is not
      // read. 09:00 to 09:01:30 is 90 seconds.
      { values: { text: "report 2026-11-11 run at 2026-11-12T09:00:00Z\nid 12026-11-12T09:00:10Z\n2026-11-12T09:01:30Z" }, expect: exactly([["Lines with a timestamp", 2], ["Lines without one", 1],
        ["First to last (seconds)", 90], ["First to last", "1 min 30 s"], ["Longest gap (seconds)", 90], ["Longest gap ends on line", 3], ["Median gap (seconds)", 90], ["Steps back in time", 0]]) },
    ],
    invalid: [{ text: "no dates at all" }, { text: "2026-11-12 only a date" }],
  },
  // November 1, 2026 is a Sunday: 5 Sundays and 4 Saturdays; holidays on Wednesday 11 and Thursday 26 (28 is a Saturday).
  month_calendar: {
    values: { year: 2026, month: "11", holidays: "2026-11-11 2026-11-26 2026-11-28" },
    expect: exactly([["Days", 30], ["Weekdays", 21], ["Weekend days", 9], ["Holidays on weekdays", 2], ["Business days", 19], ["First day", "Sunday"], ["Last day", "Monday"]], undefined,
      ["November 2026", "Mo Tu We Th Fr Sa Su", `${" ".repeat(19)}1`, " 2  3  4  5  6  7  8", " 9 10 11 12 13 14 15", "16 17 18 19 20 21 22", "23 24 25 26 27 28 29", "30"].join("\n")),
    more: [{ values: { year: 2027, month: "2" }, expect: exactly([["Days", 28], ["Weekdays", 20], ["Weekend days", 8], ["Holidays on weekdays", 0], ["Business days", 20], ["First day", "Monday"], ["Last day", "Sunday"]], undefined,
      "February 2027\nMo Tu We Th Fr Sa Su\n 1  2  3  4  5  6  7\n 8  9 10 11 12 13 14\n15 16 17 18 19 20 21\n22 23 24 25 26 27 28") }],
    invalid: [{ year: 0, month: "1" }, { year: 2026, month: "13" }],
  },
  // November 2026: Thursdays 5, 12, 19, 26; Mondays 2, 9, 16, 23, 30; Tuesdays 3, 10, 17, 24.
  nth_weekday: {
    values: { year: 2026, month: "11", weekday: "3", which: "4" },
    expect: [["Date", "2026-11-26"], ["Day of the month", 26], ["Thursdays in the month", 4]],
    more: [
      { values: { year: 2026, month: "11", weekday: "0", which: "last" }, expect: [["Date", "2026-11-30"], ["Day of the month", 30], ["Mondays in the month", 5]] },
      { values: { year: 2026, month: "11", weekday: "1", which: "2" }, expect: [["Date", "2026-11-10"], ["Day of the month", 10], ["Tuesdays in the month", 4]] },
    ],
    invalid: [{ year: 2026, month: "11", weekday: "3", which: "5" }],
  },
  // Monthly from January 31 keeps the 31st where it exists: February 28, March 31, April 30.
  repeating_schedule: {
    values: { start: "2026-01-31", every: 1, unit: "months", count: 4 },
    expect: exactly([["Dates", 4], ["Moved to a business day", 0], ["First", "2026-01-31"], ["Last", "2026-04-30"]],
      { columns: ["#", "date", "weekday", "moved"], rows: [[1, "2026-01-31", "Saturday", ""], [2, "2026-02-28", "Saturday", ""], [3, "2026-03-31", "Tuesday", ""], [4, "2026-04-30", "Thursday", ""]] },
      "2026-01-31\n2026-02-28\n2026-03-31\n2026-04-30"),
    more: [
      { values: { start: "2026-01-31", every: 1, unit: "months", count: 2, adjust: "next" }, expect: exactly([["Dates", 2], ["Moved to a business day", 2], ["First", "2026-02-02"], ["Last", "2026-03-02"]],
        { columns: ["#", "date", "weekday", "moved"], rows: [[1, "2026-02-02", "Monday", "from 2026-01-31"], [2, "2026-03-02", "Monday", "from 2026-02-28"]] }) },
      { values: { start: "2026-01-31", every: 1, unit: "months", count: 2, adjust: "previous", holidays: "2026-01-30" }, expect: exactly([["Dates", 2], ["Moved to a business day", 2], ["First", "2026-01-29"], ["Last", "2026-02-27"]]) },
      { values: { start: "2026-11-12", every: 2, unit: "weeks", count: 3 }, expect: exactly([["Dates", 3], ["Moved to a business day", 0], ["First", "2026-11-12"], ["Last", "2026-12-10"]], undefined, "2026-11-12\n2026-11-26\n2026-12-10") },
    ],
    invalid: [{ start: "2026-11-12", every: 1, unit: "days", count: 0 }, { start: "2026-11-12", every: 0, unit: "days", count: 2 }],
  },
  // 09:30 at -05:00 is 14:30 UTC, 23:30 at +09:00.
  offset_convert: {
    values: { time: "2026-11-12 09:30", from: "-05:00", to: "+09:00" },
    expect: [["At the target offset", "2026-11-12T23:30:00+09:00"], ["UTC", "2026-11-12T14:30:00Z"], ["Hours between the offsets", 14], ["Calendar day", "same day"]],
    more: [
      { values: { time: "2026-11-12T20:00", from: "UTC+2", to: "-0800" }, expect: [["At the target offset", "2026-11-12T10:00:00-08:00"], ["UTC", "2026-11-12T18:00:00Z"], ["Hours between the offsets", -10], ["Calendar day", "same day"]] },
      { values: { time: "2026-11-12 22:15", from: "Z", to: "+05:30" }, expect: [["At the target offset", "2026-11-13T03:45:00+05:30"], ["UTC", "2026-11-12T22:15:00Z"], ["Hours between the offsets", 5.5], ["Calendar day", "next day"]] },
      { values: { time: "2026-11-12 01:00", from: "+09", to: "UTC" }, expect: [["At the target offset", "2026-11-11T16:00:00Z"], ["UTC", "2026-11-11T16:00:00Z"], ["Hours between the offsets", -9], ["Calendar day", "previous day"]] },
    ],
    invalid: [{ time: "2026-11-12", from: "Z", to: "Z" }, { time: "2026-11-12T09:30Z", from: "Z", to: "Z" }, { time: "2026-11-12 09:30", from: "+25:00", to: "Z" },
      { time: "2026-11-12 09:30", from: "Z", to: "PST" }, { time: "9999-12-31 23:00", from: "Z", to: "+05:00" }],
  },
  // November 12 to January 5: 19 + 31 + 5 = 55 days.
  split_range: {
    values: { start: "2026-11-12", end: "2027-01-05" },
    expect: exactly([["Periods", 3], ["Days (both ends)", 55], ["Partial periods", 2]], { columns: ["period", "from", "to", "days", "partial"],
      rows: [["2026-11", "2026-11-12", "2026-11-30", 19, "yes"], ["2026-12", "2026-12-01", "2026-12-31", 31, "no"], ["2027-01", "2027-01-01", "2027-01-05", 5, "yes"]] }),
    more: [
      // Thursday the 12th sits in week 46 (Monday 9 to Sunday 15); Monday the 23rd starts week 48.
      { values: { start: "2026-11-12", end: "2026-11-23", period: "week" }, expect: exactly([["Periods", 3], ["Days (both ends)", 12], ["Partial periods", 2]], { columns: ["period", "from", "to", "days", "partial"],
        rows: [["2026-W46", "2026-11-12", "2026-11-15", 4, "yes"], ["2026-W47", "2026-11-16", "2026-11-22", 7, "no"], ["2026-W48", "2026-11-23", "2026-11-23", 1, "yes"]] }) },
      { values: { start: "2026-12-28", end: "2027-01-03", period: "week" }, expect: exactly([["Periods", 1], ["Days (both ends)", 7], ["Partial periods", 0]], { columns: ["period", "from", "to", "days", "partial"],
        rows: [["2026-W53", "2026-12-28", "2027-01-03", 7, "no"]] }) },
      { values: { start: "2026-12-31", end: "2027-01-01", period: "quarter" }, expect: exactly([["Periods", 2], ["Days (both ends)", 2], ["Partial periods", 2]], { columns: ["period", "from", "to", "days", "partial"],
        rows: [["2026-Q4", "2026-12-31", "2026-12-31", 1, "yes"], ["2027-Q1", "2027-01-01", "2027-01-01", 1, "yes"]] }) },
      { values: { start: "9999-12-15", end: "9999-12-31", period: "quarter" }, expect: exactly([["Periods", 1], ["Days (both ends)", 17], ["Partial periods", 1]]) },
    ],
    invalid: [{ start: "2026-11-12", end: "2026-11-11" }, { start: "2000-01-01", end: "2030-01-01", period: "week" }],
  },
  // Dates 2, 3, 6, 10, 10 November: 4, 5 and 7, 8, 9 never appear.
  missing_dates: {
    values: { text: "run 2026-11-02 ok\nrun 2026-11-03 ok\n2026-11-06 late\n2026-11-10 2026-11-10" },
    expect: exactly([["Dates found", 5], ["Distinct dates", 4], ["First", "2026-11-02"], ["Last", "2026-11-10"], ["Days in the range", 9], ["Missing days", 5]],
      { columns: ["from", "to", "days missing"], rows: [["2026-11-04", "2026-11-05", 2], ["2026-11-07", "2026-11-09", 3]] }, "2026-11-04\n2026-11-05\n2026-11-07\n2026-11-08\n2026-11-09"),
    more: [
      // Business days only: the 7th and 8th are a weekend, leaving 2-6, 9, 10 (7 days) with 4, 5 and 9 missing.
      { values: { text: "2026-11-02 2026-11-03 2026-11-06 2026-11-10", businessOnly: true }, expect: exactly([["Dates found", 4], ["Distinct dates", 4], ["First", "2026-11-02"], ["Last", "2026-11-10"],
        ["Business days in the range", 7], ["Missing days", 3]], { columns: ["from", "to", "days missing"], rows: [["2026-11-04", "2026-11-05", 2], ["2026-11-09", "2026-11-09", 1]] }, "2026-11-04\n2026-11-05\n2026-11-09") },
      { values: { text: "2026-11-02 2026-11-03 2026-11-06 2026-11-10", businessOnly: true, holidays: "2026-11-09" }, expect: exactly([["Dates found", 4], ["Distinct dates", 4], ["First", "2026-11-02"],
        ["Last", "2026-11-10"], ["Business days in the range", 6], ["Missing days", 2]], { columns: ["from", "to", "days missing"], rows: [["2026-11-04", "2026-11-05", 2]] }) },
      // Thursday the 5th and Tuesday the 10th: the missing Friday the 6th and Monday the 9th form one gap across the weekend.
      { values: { text: "2026-11-05 2026-11-10", businessOnly: true }, expect: exactly([["Dates found", 2], ["Distinct dates", 2], ["First", "2026-11-05"], ["Last", "2026-11-10"],
        ["Business days in the range", 4], ["Missing days", 2]], { columns: ["from", "to", "days missing"], rows: [["2026-11-06", "2026-11-09", 2]] }) },
    ],
    invalid: [{ text: "no dates here" }, { text: "0000-01-01 only" }],
  },
  count_by_period: {
    values: { text: "2026-11-02 2026-11-03 2026-11-03 2026-12-20 2027-02-01" },
    expect: exactly([["Dates", 5], ["Periods", 4], ["Busiest", "2026-11 (3)"], ["Periods with none", 1]],
      { columns: ["month", "dates", "share"], rows: [["2026-11", 3, "60.0%"], ["2026-12", 1, "20.0%"], ["2027-01", 0, "0.0%"], ["2027-02", 1, "20.0%"]] }),
    more: [
      // Mondays: Nov 2 and Feb 1; Tuesdays: Nov 3 twice; December 20 is a Sunday.
      { values: { text: "2026-11-02 2026-11-03 2026-11-03 2026-12-20 2027-02-01", period: "weekday" }, expect: exactly([["Dates", 5], ["Periods", 7], ["Busiest", "Monday (2)"], ["Periods with none", 4]],
        { columns: ["weekday", "dates", "share"], rows: [["Monday", 2, "40.0%"], ["Tuesday", 2, "40.0%"], ["Wednesday", 0, "0.0%"], ["Thursday", 0, "0.0%"], ["Friday", 0, "0.0%"], ["Saturday", 0, "0.0%"], ["Sunday", 1, "20.0%"]] }) },
      { values: { text: "2026-11-02 2026-11-03 2026-11-03 2026-12-20 2027-02-01", period: "quarter" }, expect: exactly([["Dates", 5], ["Periods", 2], ["Busiest", "2026-Q4 (4)"], ["Periods with none", 0]],
        { columns: ["quarter", "dates", "share"], rows: [["2026-Q4", 4, "80.0%"], ["2027-Q1", 1, "20.0%"]] }) },
      { values: { text: "2026-12-31 and 2027-01-04", period: "week" }, expect: exactly([["Dates", 2], ["Periods", 2], ["Busiest", "2026-W53 (1)"], ["Periods with none", 0]],
        { columns: ["ISO week", "dates", "share"], rows: [["2026-W53", 1, "50.0%"], ["2027-W01", 1, "50.0%"]] }) },
      { values: { text: "2025-06-01 2026-11-12", period: "year" }, expect: exactly([["Dates", 2], ["Periods", 2], ["Busiest", "2025 (1)"], ["Periods with none", 0]]) },
    ],
    invalid: [{ text: "nothing" }, { text: "1000-01-01 2026-01-01", period: "week" }],
  },
});
