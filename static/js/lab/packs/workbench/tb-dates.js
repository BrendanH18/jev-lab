// Toolbox: dates and times for planning runs and audits ("workbench.toolbox", group "Dates and times"). Every tool is a
// pure function of what is typed into its form: it never reads the clock, page data or the network, and never calls
// the model, so "today" is always a date the person types. Calendar arithmetic counts whole days on the proleptic
// Gregorian calendar (years 0001 to 9999); times are UTC or a fixed offset, with no time-zone database and no daylight
// saving rules. Business days are Monday to Friday minus the holidays typed into the form.
import { definePack } from "../../kit.js";
import { findIsoDates, lines } from "../../lib/text.js";

const GROUP = "Dates and times";
const DAY_MS = 86400000;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_SPAN = 100000;
const MAX_LIST = 5000;
const MAX_DATES = 100000;

const need = (condition, message) => { if (!condition) throw new Error(message); };
const yesNo = (flag) => (flag ? "yes" : "no");
const pad = (value, width = 2) => String(value).padStart(width, "0");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const percent = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

const DATE = (name, label, extra = {}) => ({ name, label, type: "text", required: true, placeholder: "YYYY-MM-DD", ...extra });
const HOLIDAYS = { name: "holidays", label: "Holidays (YYYY-MM-DD, optional)", type: "textarea", rows: 2, placeholder: "2026-12-25 2027-01-01" };
const CHECK = (name, label, value = false) => ({ name, label, type: "checkbox", default: value });
const MONTH_OPTIONS = MONTHS.map((month, index) => [String(index + 1), month]);

// ---------- calendar arithmetic on day numbers (days since 1970-01-01) ----------

const leap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysIn = (year, month) => (month === 2 ? (leap(year) ? 29 : 28) : [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]);
// Days from civil and back (H. Hinnant's algorithms), exact for every Gregorian date.
function dayNumber(year, month, day) {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
function civil(dayNum) {
  const z = dayNum + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}
const MIN_DAY = dayNumber(1, 1, 1);
const MAX_DAY = dayNumber(9999, 12, 31);
const inYears = (dayNum) => need(dayNum >= MIN_DAY && dayNum <= MAX_DAY, "The result falls outside the years 0001 to 9999.");
const iso = (dayNum) => { const [y, m, d] = civil(dayNum); return `${pad(y, 4)}-${pad(m)}-${pad(d)}`; };
const weekdayIndex = (dayNum) => ((dayNum % 7) + 7 + 3) % 7; // 0 is Monday; 1970-01-01 was a Thursday
const weekdayName = (dayNum) => WEEKDAYS[weekdayIndex(dayNum)];
const business = (dayNum, holidays) => weekdayIndex(dayNum) < 5 && !holidays.has(dayNum);
const validDate = (y, m, d) => y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);

// A date typed as YYYY-MM-DD, as a day number. Throws an Error naming the field.
function parseDate(text, label) {
  const value = String(text ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  need(match, `${label} must be a date written YYYY-MM-DD.`);
  const [y, m, d] = match.slice(1).map(Number);
  need(validDate(y, m, d), `${label}: ${value} is not a real date.`);
  return dayNumber(y, m, d);
}
function parseHolidays(text) {
  const tokens = String(text ?? "").split(/[\s,;]+/).filter(Boolean);
  need(tokens.length <= 1000, "Holidays: give at most 1,000 dates.");
  return new Set(tokens.map((token) => parseDate(token, `Holiday "${token}"`)));
}
// The date the given number of months later (or earlier), with the day moved to the month's last day when it is shorter.
function addMonths(dayNum, months) {
  const [y, m, d] = civil(dayNum);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12), month = total - year * 12 + 1;
  need(year >= 1 && year <= 9999, "The result falls outside the years 0001 to 9999.");
  const day = Math.min(d, daysIn(year, month));
  return { day: dayNumber(year, month, day), clamped: day !== d };
}
// The ISO 8601 week: the week (Monday to Sunday) belongs to the year that holds its Thursday.
function isoWeek(dayNum) {
  const thursday = dayNum - weekdayIndex(dayNum) + 3;
  const year = civil(thursday)[0];
  return { year, week: Math.floor((thursday - dayNumber(year, 1, 1)) / 7) + 1 };
}
const weeksInYear = (year) => isoWeek(dayNumber(year, 12, 28)).week;
// Steps one day at a time in the direction of n until n business days are counted (n = 0 gives the start itself).
function addBusinessDays(start, n, holidays) {
  let day = start, left = Math.abs(n), weekend = 0, skipped = 0;
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    day += step;
    inYears(day);
    if (weekdayIndex(day) >= 5) weekend++;
    else if (holidays.has(day)) skipped++;
    else left--;
  }
  return { day, weekend, skipped };
}
const shiftToBusiness = (dayNum, direction, holidays) => { let day = dayNum; while (!business(day, holidays)) { day += direction; inYears(day); } return day; };

// ---------- times ----------

// Z, UTC, GMT, +HH, +HHMM or +HH:MM (optionally after UTC or GMT), as minutes east of UTC.
function parseOffset(text, label) {
  const value = String(text ?? "").trim();
  const match = /^(?:Z|(?:UTC|GMT)?\s*(?:([+-])(\d{1,2})(?::?(\d{2}))?)?)$/i.exec(value);
  need(value !== "" && match, `${label} must be an offset such as Z, +02:00, -0530 or UTC+9.`);
  if (!match[1]) return 0;
  const hours = Number(match[2]), minutes = Number(match[3] || 0);
  need(hours <= 18 && minutes < 60 && hours * 60 + minutes <= 18 * 60, `${label}: offsets run from -18:00 to +18:00.`);
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}
const offsetText = (minutes) => (minutes === 0 ? "Z" : `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`);

const STAMP = "(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d+))?)?)?(?:\\s?(Z|UTC|[+-]\\d{2}(?::?\\d{2})?))?";
// Reads a timestamp match: { ms, offset } with ms since 1970 in UTC, offset in minutes or null when none was written
// (then the time is read as UTC). Fractions finer than a millisecond are cut off. null when a part is out of range.
function readStamp(match) {
  const [y, mo, d] = [1, 2, 3].map((k) => Number(match[k]));
  if (!validDate(y, mo, d)) return null;
  const [h, mi, s] = [4, 5, 6].map((k) => Number(match[k] || 0));
  if (h > 23 || mi > 59 || s > 59) return null;
  const milli = match[7] ? Number(match[7].slice(0, 3).padEnd(3, "0")) : 0;
  let offset = null;
  if (match[8]) {
    try { offset = parseOffset(match[8], "Offset"); } catch { return null; }
  }
  return { ms: dayNumber(y, mo, d) * DAY_MS + h * 3600000 + mi * 60000 + s * 1000 + milli - (offset || 0) * 60000, offset, hasTime: match[4] !== undefined };
}
// A moment as ISO 8601 at a fixed offset (Z for UTC); milliseconds are shown only when there are some.
function stampText(ms, offset = 0) {
  const local = ms + offset * 60000;
  const dayNum = Math.floor(local / DAY_MS);
  const rest = local - dayNum * DAY_MS;
  const h = Math.floor(rest / 3600000), mi = Math.floor((rest % 3600000) / 60000), s = Math.floor((rest % 60000) / 1000), milli = rest % 1000;
  return `${iso(dayNum)}T${pad(h)}:${pad(mi)}:${pad(s)}${milli ? `.${pad(milli, 3)}` : ""}${offsetText(offset)}`;
}
const MIN_MS = MIN_DAY * DAY_MS;
const MAX_MS = (MAX_DAY + 1) * DAY_MS - 1;
const inRange = (ms) => need(ms >= MIN_MS && ms <= MAX_MS, "The result falls outside the years 0001 to 9999.");
const lowest = (days) => days.reduce((a, b) => (b < a ? b : a));
const highest = (days) => days.reduce((a, b) => (b > a ? b : a));
// Every YYYY-MM-DD date in pasted text as day numbers (findIsoDates already keeps only real dates; year 0000 is left out).
function datesIn(text) {
  const found = findIsoDates(text).filter((value) => !value.startsWith("0000")).map((value) => parseDate(value, "Date"));
  need(found.length > 0, "Text with dates: no YYYY-MM-DD date was found.");
  need(found.length <= MAX_DATES, "Text with dates: give at most 100,000 dates.");
  return found;
}
// A duration in seconds as days, hours, minutes and seconds ("1 d 2 h 0 min 5 s" leaves out zero parts: "1 d 2 h 5 s").
function readable(seconds) {
  if (seconds === 0) return "0 s";
  const sign = seconds < 0 ? "-" : "";
  let rest = Math.round(Math.abs(seconds) * 1000);
  const parts = [];
  for (const [unit, size] of [["d", 86400000], ["h", 3600000], ["min", 60000]]) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${count} ${unit}`);
    rest -= count * size;
  }
  if (rest) parts.push(`${rest / 1000} s`);
  return sign + parts.join(" ");
}

// ---------- reading pasted dates ----------

const MONTH_WORDS = new Map(MONTHS.flatMap((name, index) => [[name.toLowerCase(), index + 1], [name.slice(0, 3).toLowerCase(), index + 1]]).concat([["sept", 9]]));
const WEEKDAY_WORDS = new Map(WEEKDAYS.flatMap((name, index) => [[name.toLowerCase(), index], [name.slice(0, 3).toLowerCase(), index]]));
// One pasted date in a common written form: { day } or { error }, plus either: true when a numeric day/month date
// reads as a different real date the other way round.
function readWrittenDate(raw, order) {
  let text = raw.trim();
  let weekday = null;
  const lead = /^([A-Za-z]+)\.?,?\s+(?=\S)/.exec(text);
  if (lead && WEEKDAY_WORDS.has(lead[1].toLowerCase())) { weekday = WEEKDAY_WORDS.get(lead[1].toLowerCase()); text = text.slice(lead[0].length); }
  let y, m, d, either = false, match;
  const monthOf = (word) => MONTH_WORDS.get(word.toLowerCase().replace(/\.$/, ""));
  if ((match = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text))) [y, m, d] = [match[1], match[3], match[4]].map(Number);
  else if ((match = /^(\d{4})(\d{2})(\d{2})$/.exec(text))) [y, m, d] = match.slice(1).map(Number);
  else if ((match = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(text))) {
    const a = Number(match[1]), b = Number(match[3]);
    y = Number(match[4]);
    [m, d] = order === "dmy" ? [b, a] : [a, b];
    either = a !== b && validDate(y, m, d) && validDate(y, d, m);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]+\.?)(?:,?[ -]|,)\s*(\d{4})$/i.exec(text)) && monthOf(match[2])) {
    [d, m, y] = [Number(match[1]), monthOf(match[2]), Number(match[3])];
  } else if ((match = /^([A-Za-z]+\.?) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(text)) && monthOf(match[1])) {
    [m, d, y] = [monthOf(match[1]), Number(match[2]), Number(match[3])];
  } else return { error: "not a date format" };
  if (!validDate(y, m, d)) return { error: "no such date" };
  const day = dayNumber(y, m, d);
  if (weekday !== null && weekdayIndex(day) !== weekday) return { error: "weekday does not match" };
  return { day, either };
}

// The start of the period holding a day, its label and the next period's start.
const PERIODS = {
  week: { start: (day) => day - weekdayIndex(day), label: (start) => { const w = isoWeek(start); return `${pad(w.year, 4)}-W${pad(w.week)}`; }, next: (start) => start + 7 },
  month: { start: (day) => { const [y, m] = civil(day); return dayNumber(y, m, 1); }, label: (start) => iso(start).slice(0, 7), next: (start) => addMonths(start, 1).day },
  quarter: { start: (day) => { const [y, m] = civil(day); return dayNumber(y, m - ((m - 1) % 3), 1); },
    label: (start) => { const [y, m] = civil(start); return `${pad(y, 4)}-Q${(m + 2) / 3}`; }, next: (start) => addMonths(start, 3).day },
  year: { start: (day) => dayNumber(civil(day)[0], 1, 1), label: (start) => pad(civil(start)[0], 4), next: (start) => addMonths(start, 12).day },
};
// Every period from the one holding first to the one holding last: [{ start, end, label }]. Capped at 1,000.
function periodsBetween(first, last, kind) {
  const period = PERIODS[kind];
  const out = [];
  for (let start = period.start(first); start <= last;) {
    need(out.length < 1000, "The dates span more than 1,000 periods; choose a longer period.");
    let next;
    try { next = period.next(start); } catch { next = MAX_DAY + 1; }
    out.push({ start, end: next - 1, label: period.label(start) });
    start = next;
  }
  return out;
}

export default definePack({
  id: "tb-dates",
  surface: "workbench.toolbox",
  title: "Date and time tools",
  about: "Toolbox tools for planning runs and audits with dates: days and business days between dates, adding business days, ISO weeks, Unix time, normalizing pasted dates, refund windows, quarter boundaries and gaps in a log. They work only on what is typed into the form, never read the clock, and use UTC or fixed offsets with no daylight saving rules.",
  features: [
    { id: "days_between", kind: "tool", group: GROUP, title: "Days between two dates",
      help: "Calendar days from the start date to the end date (negative when the end comes first), the number of dates when both ends are counted, and the same span in weeks.",
      inputs: [DATE("start", "Start date"), DATE("end", "End date")],
      compute: ({ start, end }) => {
        const a = parseDate(start, "Start date"), b = parseDate(end, "End date");
        const days = b - a, size = Math.abs(days);
        return [["Days from start to end", days], ["Dates counted with both ends", size + 1], ["Weeks", days / 7],
          ["Whole weeks and days", `${plural(Math.floor(size / 7), "week")}, ${plural(size % 7, "day")}`],
          ["Order", days > 0 ? "end is after start" : days < 0 ? "end is before start" : "same day"]];
      } },
    { id: "business_days_between", kind: "tool", group: GROUP, title: "Business days between two dates",
      help: "Monday-to-Friday dates from the start to the end, both counted (as a spreadsheet's NETWORKDAYS does), leaving out the holidays listed. The end must not come before the start; spans up to 100,000 days.",
      inputs: [DATE("start", "Start date"), DATE("end", "End date"), HOLIDAYS],
      compute: ({ start, end, holidays }) => {
        const a = parseDate(start, "Start date"), b = parseDate(end, "End date"), off = parseHolidays(holidays);
        need(b >= a, "End date must not come before the start date.");
        need(b - a < MAX_SPAN, "The span is longer than 100,000 days.");
        let work = 0, weekend = 0, closed = 0;
        for (let day = a; day <= b; day++) {
          if (weekdayIndex(day) >= 5) weekend++;
          else if (off.has(day)) closed++;
          else work++;
        }
        return [["Business days", work], ["Calendar days (both ends)", b - a + 1], ["Weekend days", weekend], ["Holidays on weekdays", closed]];
      } },
    { id: "add_business_days", kind: "tool", group: GROUP, title: "Add business days to a date",
      help: "The date a number of business days after the start (or before it, for a negative number), skipping weekends and the holidays listed; the start itself is not counted, as in a spreadsheet's WORKDAY. Zero gives the start date. Up to 10,000 days either way.",
      inputs: [DATE("start", "Start date"), { name: "days", label: "Business days", type: "integer", min: -10000, max: 10000 }, HOLIDAYS],
      compute: ({ start, days, holidays }) => {
        const a = parseDate(start, "Start date");
        const result = addBusinessDays(a, days, parseHolidays(holidays));
        return [["Date", iso(result.day)], ["Weekday", weekdayName(result.day)], ["Calendar days from the start", result.day - a],
          ["Weekend days skipped", result.weekend], ["Holidays skipped", result.skipped]];
      } },
    { id: "add_to_date", kind: "tool", group: GROUP, title: "Add days, weeks, months or years to a date",
      help: "Moves a date by a whole number of days, weeks, months or years (negative goes back). Adding months or years keeps the day of the month, moving it to the month's last day when the month is shorter (January 31 plus one month is February 28 or 29).",
      inputs: [DATE("date", "Date"), { name: "amount", label: "Amount", type: "integer", min: -100000, max: 100000 },
        { name: "unit", label: "Unit", type: "select", options: [["days", "days"], ["weeks", "weeks"], ["months", "months"], ["years", "years"]], default: "days" }],
      compute: ({ date, amount, unit }) => {
        const a = parseDate(date, "Date");
        let result;
        if (unit === "days" || unit === "weeks") { result = { day: a + amount * (unit === "weeks" ? 7 : 1), clamped: false }; inYears(result.day); }
        else result = addMonths(a, amount * (unit === "years" ? 12 : 1));
        return [["Date", iso(result.day)], ["Weekday", weekdayName(result.day)], ["Days from the date", result.day - a], ["Moved to the month's last day", yesNo(result.clamped)]];
      } },
    { id: "weekday_and_week", kind: "tool", group: GROUP, title: "Weekday, ISO week and day of year",
      help: "The weekday of a date, its ISO 8601 week (weeks run Monday to Sunday and belong to the year holding their Thursday, so early January can be in the previous year's last week), its day of the year and the days left in the year.",
      inputs: [DATE("date", "Date")],
      compute: ({ date }) => {
        const day = parseDate(date, "Date");
        const [year] = civil(day);
        const week = isoWeek(day);
        const ofYear = day - dayNumber(year, 1, 1) + 1;
        return [["Weekday", weekdayName(day)], ["ISO weekday number", weekdayIndex(day) + 1], ["ISO week", `${pad(week.year, 4)}-W${pad(week.week)}`],
          ["Day of the year", ofYear], ["Days left in the year", (leap(year) ? 366 : 365) - ofYear], ["Leap year", yesNo(leap(year))]];
      } },
    { id: "iso_week_dates", kind: "tool", group: GROUP, title: "Dates of an ISO week",
      help: "The Monday-to-Sunday dates of an ISO 8601 week, such as week 46 of 2026, and how many weeks that year has (52 or 53).",
      inputs: [{ name: "year", label: "ISO year", type: "integer", min: 1, max: 9999 }, { name: "week", label: "Week", type: "integer", min: 1, max: 53 }],
      compute: ({ year, week }) => {
        const weeks = weeksInYear(year);
        need(week <= weeks, `${year} has ${weeks} ISO weeks.`);
        const jan4 = dayNumber(year, 1, 4);
        const monday = jan4 - weekdayIndex(jan4) + (week - 1) * 7;
        inYears(monday); inYears(monday + 6);
        return { rows: [["Monday", iso(monday)], ["Sunday", iso(monday + 6)], ["Weeks in the year", weeks]],
          table: { columns: ["day", "date"], rows: WEEKDAYS.map((name, k) => [name, iso(monday + k)]) } };
      } },
    { id: "unix_to_iso", kind: "tool", group: GROUP, title: "Unix time to ISO 8601 (UTC)",
      help: "A Unix timestamp (seconds or milliseconds since 1970-01-01 00:00 UTC) as an ISO 8601 date and time in UTC, rounded to the millisecond. Years 0001 to 9999.",
      inputs: [{ name: "value", label: "Unix time", type: "number" }, { name: "unit", label: "Unit", type: "select", options: [["s", "seconds"], ["ms", "milliseconds"]], default: "s" }],
      compute: ({ value, unit }) => {
        const ms = Math.round(unit === "s" ? value * 1000 : value);
        need(ms >= MIN_MS && ms <= MAX_MS, "Unix time: the moment falls outside the years 0001 to 9999.");
        const text = stampText(ms);
        const day = Math.floor(ms / DAY_MS);
        return [["ISO 8601 (UTC)", text], ["Date (UTC)", iso(day)], ["Time (UTC)", text.slice(11, -1)], ["Weekday (UTC)", weekdayName(day)],
          ["Unix seconds", ms / 1000], ["Unix milliseconds", ms]];
      } },
    { id: "iso_to_unix", kind: "tool", group: GROUP, title: "ISO 8601 to Unix time",
      help: "A date and time such as 2026-11-12T09:30:00+02:00 (or with a space instead of T, a Z, or no offset, which reads as UTC) as Unix seconds and milliseconds and as UTC. A date alone means midnight. Fractions finer than a millisecond are cut off.",
      inputs: [{ name: "stamp", label: "Date and time", type: "text", required: true, placeholder: "2026-11-12T09:30:00+02:00" }],
      compute: ({ stamp }) => {
        const match = new RegExp(`^${STAMP}$`, "i").exec(stamp.trim());
        need(match, "Date and time must look like 2026-11-12T09:30:00Z, with an optional offset such as +02:00.");
        const read = readStamp(match);
        need(read, "Date and time: a part is out of range (month, day, hour, minute, second or offset).");
        inRange(read.ms);
        return [["Unix seconds", read.ms / 1000], ["Unix milliseconds", read.ms], ["UTC", stampText(read.ms)],
          ["Offset", read.offset === null ? "none (read as UTC)" : offsetText(read.offset)]];
      } },
    { id: "normalize_dates", kind: "tool", group: GROUP, title: "Normalize a pasted list of dates",
      help: "Reads one date per line in common written forms (2026-11-12, 2026/11/12, 20261112, 11/12/2026 or 12.11.2026 in the order you choose, 12 Nov 2026, Nov 12, 2026, with an optional weekday that must agree) and writes each as YYYY-MM-DD. Two-digit years are not read. Counts dates whose day and month could be read either way. At most 5,000 lines.",
      inputs: [{ name: "text", label: "Dates (one per line)", type: "textarea", required: true, rows: 6 },
        { name: "order", label: "Numeric dates like 11/12/2026", type: "select", options: [["mdy", "Month first"], ["dmy", "Day first"]], default: "mdy" },
        CHECK("sort", "Sort the output"), CHECK("unique", "List each date once")],
      compute: ({ text, order, sort, unique }) => {
        const all = lines(text).map((line, index) => [index + 1, line]).filter(([, line]) => line.trim() !== "");
        need(all.length <= MAX_LIST, "Dates: give at most 5,000 lines.");
        const table = [], days = [];
        let either = 0;
        for (const [number, line] of all) {
          const read = readWrittenDate(line, order);
          if (read.error) { table.push([number, line.trim(), "", read.error]); continue; }
          if (read.either) either++;
          days.push(read.day);
          table.push([number, line.trim(), iso(read.day), "ok"]);
        }
        let out = days;
        if (unique) out = [...new Set(out)];
        if (sort) out = [...out].sort((a, b) => a - b);
        const some = days.length > 0;
        return { rows: [["Lines", all.length], ["Dates read", days.length], ["Lines not read", all.length - days.length], ["Could be read either way", either],
          ["Earliest", some ? iso(lowest(days)) : null], ["Latest", some ? iso(highest(days)) : null]],
        table: { columns: ["line", "input", "date", "status"], rows: table }, text: out.map(iso).join("\n") };
      } },
    { id: "refund_window", kind: "tool", group: GROUP, title: "When a refund window closes",
      help: "The last day of a window that opens on the purchase date and lasts a number of calendar or business days (the purchase day is day 0, holidays skipped for business days). A calendar window that ends on a weekend or holiday can move to the next business day. With a check date, says whether that date is inside the window and how many days are left.",
      inputs: [DATE("purchase", "Purchase date"), { name: "length", label: "Window length", type: "integer", min: 0, max: 3650, default: 30 },
        { name: "unit", label: "Counted in", type: "select", options: [["calendar", "calendar days"], ["business", "business days"]], default: "calendar" },
        CHECK("move", "Move a weekend or holiday close to the next business day"), HOLIDAYS, DATE("check", "Check date (optional)", { required: false })],
      compute: ({ purchase, length, unit, move, holidays, check }) => {
        const start = parseDate(purchase, "Purchase date"), off = parseHolidays(holidays);
        let close = unit === "business" ? addBusinessDays(start, length, off).day : start + length;
        inYears(close);
        const before = close;
        if (move && unit === "calendar") close = shiftToBusiness(close, 1, off);
        const asked = check.trim() !== "";
        const on = asked ? parseDate(check, "Check date") : null;
        return [["Window closes on", iso(close)], ["Weekday", weekdayName(close)], ["Moved to a business day", yesNo(close !== before)],
          ["Check date inside the window", asked ? yesNo(on >= start && on <= close) : null], ["Days left on the check date", asked ? close - on : null]];
      } },
    { id: "date_age", kind: "tool", group: GROUP, title: "How old a date is",
      help: "The time from a date to an as-of date (typed, never read from the clock): days, weeks, completed months and years, and a years-months-days phrase. A month is completed on the same day number, or on the month's last day when that month is shorter.",
      inputs: [DATE("date", "Date"), DATE("asOf", "As of")],
      compute: ({ date, asOf }) => {
        const a = parseDate(date, "Date"), b = parseDate(asOf, "As of");
        const [early, late] = a <= b ? [a, b] : [b, a];
        const [y1, m1] = civil(early), [y2, m2] = civil(late);
        let months = (y2 - y1) * 12 + (m2 - m1);
        while (months > 0 && addMonths(early, months).day > late) months--;
        const rest = late - addMonths(early, months).day;
        const phrase = `${plural(Math.floor(months / 12), "year")}, ${plural(months % 12, "month")}, ${plural(rest, "day")}`;
        return [["Days", b - a], ["Weeks", (b - a) / 7], ["Completed months", months], ["Completed years", Math.floor(months / 12)], ["Years, months and days", phrase],
          ["When", a < b ? "in the past" : a > b ? "in the future" : "the same day"]];
      } },
    { id: "quarter_bounds", kind: "tool", group: GROUP, title: "Quarter and month boundaries of a date",
      help: "The first and last day of a date's month, quarter and year, the day of the quarter and the days left in it after this date. With a fiscal year that starts in another month, the fiscal year is named by the calendar year it ends in (a year starting July 2026 is FY2027).",
      inputs: [DATE("date", "Date"), { name: "start", label: "Year starts in", type: "select", options: MONTH_OPTIONS, default: "1" }],
      compute: ({ date, start }) => {
        const day = parseDate(date, "Date");
        const first = Number(start);
        const [y, m] = civil(day);
        const monthStart = dayNumber(y, m, 1);
        const yearOf = m >= first ? y : y - 1;
        const yearStart = dayNumber(yearOf, first, 1);
        const quarter = Math.floor(((m - first + 12) % 12) / 3) + 1;
        const quarterStart = addMonths(yearStart, (quarter - 1) * 3).day;
        const quarterEnd = addMonths(yearStart, quarter * 3).day - 1;
        const label = first === 1 ? `Q${quarter} ${y}` : `FY${yearOf + 1} Q${quarter}`;
        return [["Month start", iso(monthStart)], ["Month end", iso(monthStart + daysIn(y, m) - 1)], ["Days in the month", daysIn(y, m)], ["Quarter", label],
          ["Quarter start", iso(quarterStart)], ["Quarter end", iso(quarterEnd)], ["Day of the quarter", day - quarterStart + 1], ["Days left in the quarter", quarterEnd - day],
          ["Year start", iso(yearStart)], ["Year end", iso(addMonths(yearStart, 12).day - 1)]];
      } },
    { id: "log_durations", kind: "tool", group: GROUP, title: "Durations between timestamps in a log",
      help: "Finds the first date-and-time on each pasted log line (2026-11-12T09:30:05Z, 2026-11-12 09:30:05.250+02:00; no offset reads as UTC) and measures the gap from the line before, the time since the first line and the whole span. Steps back in time are counted. At most 5,000 lines.",
      inputs: [{ name: "text", label: "Log lines", type: "textarea", required: true, rows: 6 }],
      compute: ({ text }) => {
        const all = lines(text);
        need(all.length <= MAX_LIST, "Log lines: give at most 5,000 lines.");
        const pattern = new RegExp(`(?<!\\d)${STAMP}`, "gi");
        const stamps = [];
        all.forEach((line, index) => {
          for (const match of line.matchAll(pattern)) {
            const read = readStamp(match);
            if (read && read.hasTime) { stamps.push({ line: index + 1, ms: read.ms }); break; }
          }
        });
        need(stamps.length > 0, "Log lines: no date with a time was found.");
        const gaps = stamps.slice(1).map((stamp, k) => ({ line: stamp.line, seconds: (stamp.ms - stamps[k].ms) / 1000 }));
        const longest = gaps.reduce((best, gap) => (!best || gap.seconds > best.seconds ? gap : best), null);
        const sorted = gaps.map((gap) => gap.seconds).sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        const median = sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null;
        const span = (stamps[stamps.length - 1].ms - stamps[0].ms) / 1000;
        return { rows: [["Lines with a timestamp", stamps.length], ["Lines without one", all.length - stamps.length], ["First to last (seconds)", span], ["First to last", readable(span)],
          ["Longest gap (seconds)", longest ? longest.seconds : null], ["Longest gap ends on line", longest ? longest.line : null], ["Median gap (seconds)", median],
          ["Steps back in time", gaps.filter((gap) => gap.seconds < 0).length]],
        table: { columns: ["line", "timestamp (UTC)", "seconds since previous", "seconds since first"],
          rows: stamps.map((stamp, k) => [stamp.line, stampText(stamp.ms), k ? (stamp.ms - stamps[k - 1].ms) / 1000 : null, (stamp.ms - stamps[0].ms) / 1000]) } };
      } },
    { id: "month_calendar", kind: "tool", group: GROUP, title: "Calendar of a month",
      help: "A Monday-first calendar of one month as text, with its weekdays, weekend days and business days (weekdays minus the holidays listed).",
      inputs: [{ name: "year", label: "Year", type: "integer", min: 1, max: 9999 }, { name: "month", label: "Month", type: "select", options: MONTH_OPTIONS, default: "1" }, HOLIDAYS],
      compute: ({ year, month, holidays }) => {
        const m = Number(month), off = parseHolidays(holidays);
        const first = dayNumber(year, m, 1), count = daysIn(year, m);
        const cells = [...Array(weekdayIndex(first)).fill("  "), ...Array.from({ length: count }, (_, k) => String(k + 1).padStart(2))];
        const rows = [];
        for (let k = 0; k < cells.length; k += 7) rows.push(cells.slice(k, k + 7).join(" ").trimEnd());
        let weekdays = 0, closed = 0;
        for (let day = first; day < first + count; day++) if (weekdayIndex(day) < 5) { weekdays++; if (off.has(day)) closed++; }
        return { rows: [["Days", count], ["Weekdays", weekdays], ["Weekend days", count - weekdays], ["Holidays on weekdays", closed], ["Business days", weekdays - closed],
          ["First day", weekdayName(first)], ["Last day", weekdayName(first + count - 1)]],
        text: [`${MONTHS[m - 1]} ${year}`, "Mo Tu We Th Fr Sa Su", ...rows].join("\n") };
      } },
    { id: "nth_weekday", kind: "tool", group: GROUP, title: "The nth weekday of a month",
      help: "The date of, say, the second Tuesday or the last Friday of a month, for scheduling a recurring audit or review.",
      inputs: [{ name: "year", label: "Year", type: "integer", min: 1, max: 9999 }, { name: "month", label: "Month", type: "select", options: MONTH_OPTIONS, default: "1" },
        { name: "weekday", label: "Weekday", type: "select", options: WEEKDAYS.map((name, k) => [String(k), name]), default: "0" },
        { name: "which", label: "Which one", type: "select", options: [["1", "first"], ["2", "second"], ["3", "third"], ["4", "fourth"], ["5", "fifth"], ["last", "last"]], default: "1" }],
      compute: ({ year, month, weekday, which }) => {
        const m = Number(month), wd = Number(weekday);
        const first = dayNumber(year, m, 1), count = daysIn(year, m);
        const firstHit = first + ((wd - weekdayIndex(first) + 7) % 7);
        const hits = Math.floor((first + count - 1 - firstHit) / 7) + 1;
        const nth = which === "last" ? hits : Number(which);
        need(nth <= hits, `${MONTHS[m - 1]} ${year} has only ${hits} ${WEEKDAYS[wd]}s.`);
        const day = firstHit + (nth - 1) * 7;
        return [["Date", iso(day)], ["Day of the month", day - first + 1], [`${WEEKDAYS[wd]}s in the month`, hits]];
      } },
    { id: "repeating_schedule", kind: "tool", group: GROUP, title: "Dates of a repeating schedule",
      help: "The next dates of a schedule that repeats every few days, weeks or months from a start date (monthly dates keep the start's day number, or the month's last day). Dates on a weekend or holiday can move to the next or previous business day. Up to 500 dates.",
      inputs: [DATE("start", "First date"), { name: "every", label: "Every", type: "integer", min: 1, max: 1000, default: 1 },
        { name: "unit", label: "Unit", type: "select", options: [["days", "days"], ["weeks", "weeks"], ["months", "months"]], default: "weeks" },
        { name: "count", label: "How many dates", type: "integer", min: 1, max: 500, default: 6 },
        { name: "adjust", label: "On a weekend or holiday", type: "select", options: [["none", "Keep the date"], ["next", "Move to the next business day"], ["previous", "Move to the previous business day"]], default: "none" },
        HOLIDAYS],
      compute: ({ start, every, unit, count, adjust, holidays }) => {
        const a = parseDate(start, "First date"), off = parseHolidays(holidays);
        const table = [], dates = [];
        for (let k = 0; k < count; k++) {
          const planned = unit === "months" ? addMonths(a, k * every).day : a + k * every * (unit === "weeks" ? 7 : 1);
          inYears(planned);
          const day = adjust === "none" ? planned : shiftToBusiness(planned, adjust === "next" ? 1 : -1, off);
          dates.push(day);
          table.push([k + 1, iso(day), weekdayName(day), day !== planned ? `from ${iso(planned)}` : ""]);
        }
        return { rows: [["Dates", count], ["Moved to a business day", table.filter((row) => row[3]).length], ["First", iso(dates[0])], ["Last", iso(dates[dates.length - 1])]],
          table: { columns: ["#", "date", "weekday", "moved"], rows: table }, text: dates.map(iso).join("\n") };
      } },
    { id: "offset_convert", kind: "tool", group: GROUP, title: "Convert a time between UTC offsets",
      help: "A wall-clock date and time at one fixed UTC offset shown at another, for example a 09:30 review at -05:00 is 23:30 at +09:00. Offsets only: daylight saving rules are not applied, so give the offset in force on that date.",
      inputs: [{ name: "time", label: "Date and time (no offset)", type: "text", required: true, placeholder: "2026-11-12 09:30" },
        { name: "from", label: "From offset", type: "text", required: true, placeholder: "-05:00" }, { name: "to", label: "To offset", type: "text", required: true, placeholder: "+09:00" }],
      compute: ({ time, from, to }) => {
        const match = new RegExp(`^${STAMP}$`, "i").exec(time.trim());
        need(match && match[4] !== undefined, "Date and time must look like 2026-11-12 09:30 or 2026-11-12T09:30:00.");
        need(!match[8], "Date and time: give the offset in From offset instead.");
        const read = readStamp(match);
        need(read, "Date and time: a part is out of range.");
        const fromMin = parseOffset(from, "From offset"), toMin = parseOffset(to, "To offset");
        const ms = read.ms - fromMin * 60000;
        inRange(ms); inRange(ms + toMin * 60000);
        const shift = Math.floor((ms + toMin * 60000) / DAY_MS) - Math.floor(read.ms / DAY_MS);
        return [["At the target offset", stampText(ms, toMin)], ["UTC", stampText(ms)], ["Hours between the offsets", (toMin - fromMin) / 60],
          ["Calendar day", shift === 0 ? "same day" : shift === 1 ? "next day" : shift === -1 ? "previous day" : `${shift > 0 ? "+" : ""}${shift} days`]];
      } },
    { id: "split_range", kind: "tool", group: GROUP, title: "Split a date range into weeks, months or quarters",
      help: "Cuts a date range into ISO weeks (Monday to Sunday), calendar months or calendar quarters, with the first and last period clipped to the range, to plan batches or audit periods. At most 1,000 periods.",
      inputs: [DATE("start", "Start date"), DATE("end", "End date"),
        { name: "period", label: "Period", type: "select", options: [["week", "weeks"], ["month", "months"], ["quarter", "quarters"]], default: "month" }],
      compute: ({ start, end, period }) => {
        const a = parseDate(start, "Start date"), b = parseDate(end, "End date");
        need(b >= a, "End date must not come before the start date.");
        const table = periodsBetween(a, b, period).map((p) => {
          const from = Math.max(a, p.start), until = Math.min(b, p.end);
          return [p.label, iso(from), iso(until), until - from + 1, yesNo(from !== p.start || until !== p.end)];
        });
        return { rows: [["Periods", table.length], ["Days (both ends)", b - a + 1], ["Partial periods", table.filter((row) => row[4] === "yes").length]],
          table: { columns: ["period", "from", "to", "days", "partial"], rows: table } };
      } },
    { id: "missing_dates", kind: "tool", group: GROUP, title: "Missing days in a list of dates",
      help: "Reads every YYYY-MM-DD date in the pasted text (a run log, an export) and lists the days between the first and last that never appear, as single dates and as gaps, optionally counting business days only. Spans up to 100,000 days; at most 5,000 missing dates are listed.",
      inputs: [{ name: "text", label: "Text with dates", type: "textarea", required: true, rows: 6 }, CHECK("businessOnly", "Business days only"), HOLIDAYS],
      compute: ({ text, businessOnly, holidays }) => {
        const found = datesIn(text);
        const off = parseHolidays(holidays);
        const seen = new Set(found);
        const first = lowest(found), last = highest(found);
        need(last - first < MAX_SPAN, "The dates span more than 100,000 days.");
        const counts = (day) => !businessOnly || business(day, off);
        // A gap runs over consecutive counted days that never appear; with business days only it spans the weekend
        // between them and closes at a day that appears.
        let expected = 0, current = null;
        const missing = [], gaps = [];
        for (let day = first; day <= last; day++) {
          if (!counts(day)) continue;
          expected++;
          if (seen.has(day)) { current = null; continue; }
          missing.push(day);
          if (current) { current.to = day; current.days++; } else { current = { from: day, to: day, days: 1 }; gaps.push(current); }
        }
        return { rows: [["Dates found", found.length], ["Distinct dates", seen.size], ["First", iso(first)], ["Last", iso(last)],
          [businessOnly ? "Business days in the range" : "Days in the range", expected], ["Missing days", missing.length]],
        table: { columns: ["from", "to", "days missing"], rows: gaps.map((gap) => [iso(gap.from), iso(gap.to), gap.days]) },
        text: missing.slice(0, MAX_LIST).map(iso).join("\n"), note: missing.length > MAX_LIST ? "Only the first 5,000 missing dates are listed." : null };
      } },
    { id: "count_by_period", kind: "tool", group: GROUP, title: "Count dates by weekday, week, month or quarter",
      help: "Reads every YYYY-MM-DD date in the pasted text and counts them per weekday, ISO week, month, quarter or year. Periods between the first and last date with no dates are listed with 0, so quiet stretches show. At most 1,000 periods.",
      inputs: [{ name: "text", label: "Text with dates", type: "textarea", required: true, rows: 6 },
        { name: "period", label: "Count by", type: "select", options: [["weekday", "weekday"], ["week", "ISO week"], ["month", "month"], ["quarter", "quarter"], ["year", "year"]], default: "month" }],
      compute: ({ text, period }) => {
        const found = datesIn(text);
        let groups;
        if (period === "weekday") {
          const counts = WEEKDAYS.map(() => 0);
          for (const day of found) counts[weekdayIndex(day)]++;
          groups = WEEKDAYS.map((name, k) => [name, counts[k]]);
        } else {
          const spans = periodsBetween(lowest(found), highest(found), period);
          const counts = new Map(spans.map((span) => [span.start, 0]));
          for (const day of found) { const start = PERIODS[period].start(day); counts.set(start, counts.get(start) + 1); }
          groups = spans.map((span) => [span.label, counts.get(span.start)]);
        }
        const busiest = groups.reduce((best, group) => (group[1] > best[1] ? group : best), groups[0]);
        return { rows: [["Dates", found.length], ["Periods", groups.length], ["Busiest", `${busiest[0]} (${busiest[1]})`], ["Periods with none", groups.filter((group) => group[1] === 0).length]],
          table: { columns: [period === "weekday" ? "weekday" : period === "week" ? "ISO week" : period, "dates", "share"], rows: groups.map(([label, count]) => [label, count, percent(count, found.length)]) } };
      } },
  ],
});
