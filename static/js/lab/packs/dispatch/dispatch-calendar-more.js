// More week planning for the "This week" calendar of the simulated Harbor Coffee Co. world on the Dispatch page:
// load per day, gaps and overlaps (one hour per meeting assumed), early and late slots, who a meeting is with,
// week metrics and exports. Read-only: nothing here moves a meeting, drafts a command or calls the model.
import { csvText, definePack } from "../../kit.js";
import { formatJsonl, formatMarkdownTable } from "../../lib/tables.js";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const HOUR = 60;                       // one hour per meeting assumed, as the week planner's .ics export does
const WORK_START = 8 * 60, WORK_END = 18 * 60;
// jev/dispatch.py plans a vague "morning" as 10:00 and a vague "afternoon" as 14:00.
const VAGUE_SLOTS = [["morning", 600], ["afternoon", 840]];

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const minutesOf = (item) => (typeof item?.minutes === "number" && Number.isFinite(item.minutes) ? item.minutes : null);
const dayIndexOf = (item) => (Number.isInteger(item?.day_index) ? item.day_index : null);
const dayOf = (item) => (typeof item?.day === "string" && item.day !== "" ? item.day : null);
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const nameOf = (item) => item.title || item.id;
const lower = (text) => (typeof text === "string" && text.trim() !== "" ? text.trim().toLowerCase() : null);
const businessDomain = (ctx) => lower(ctx?.data?.business_domain) || "harborcoffee.example";
const listOf = (value) => (Array.isArray(value) ? value : []);

// The other meetings of the world on the same day as item that have a readable start time.
const sameDayTimed = (item, ctx) => ctx.items().filter((other) => other !== item && other.id !== item.id && dayOf(other) === dayOf(item) && minutesOf(other) !== null);
const overlaps = (a, b) => Math.abs(minutesOf(a) - minutesOf(b)) < HOUR;
const located = (item) => dayOf(item) !== null && minutesOf(item) !== null;

// Week order: by weekday, then start time, unknown times last within a day; ties keep the incoming order.
const weekOrder = (items) => items.map((item, index) => ({ item, index })).sort((a, b) => (dayIndexOf(a.item) ?? 9) - (dayIndexOf(b.item) ?? 9)
  || (minutesOf(a.item) ?? 1e9) - (minutesOf(b.item) ?? 1e9) || a.index - b.index).map(({ item }) => item);

// Who a meeting is with, from its attendee domain: the shop itself, a vendor of the world, a customer of the world (by
// email domain), or another organization. name is the vendor's or the one customer's name, null when not known.
function partnerOf(item, ctx) {
  const domain = lower(item.with_domain);
  if (!domain) return null;
  if (domain === businessDomain(ctx)) return { type: "the shop", name: null };
  const vendor = listOf(ctx?.data?.vendors).find((entry) => lower(entry?.domain) === domain);
  if (vendor) return { type: "vendor", name: vendor.name || null };
  const customers = listOf(ctx?.data?.customers).filter((entry) => typeof entry?.email === "string" && lower(entry.email.split("@").pop()) === domain);
  if (customers.length) return { type: "customer", name: customers.length === 1 ? customers[0].name || null : null };
  return { type: "other", name: null };
}

// The weekday (0 Monday … 6 Sunday) of an ISO date, or null when it is unreadable.
function weekdayOf(iso) {
  const match = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : (date.getUTCDay() + 6) % 7;
}

// Free stretches of the working day [08:00, 18:00) around the given meetings, one hour each: [[from, to], ...].
function freeStretches(meetings) {
  const busy = meetings.filter((item) => minutesOf(item) !== null)
    .map((item) => [Math.max(WORK_START, minutesOf(item)), Math.min(WORK_END, minutesOf(item) + HOUR)])
    .filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = WORK_START;
  for (const [from, to] of busy) {
    if (from > cursor) free.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < WORK_END) free.push([cursor, WORK_END]);
  return free;
}
const onWeekday = (items, day) => items.filter((item) => dayOf(item) === day);

export default definePack({
  id: "dispatch-calendar-more",
  surface: "dispatch.calendar",
  title: "Calendar load and gaps",
  about: "Load per day, gaps, overlaps and back-to-back meetings (one hour per meeting assumed), early, late and lunch slots, who each meeting is with, week metrics and exports for the simulated shop's calendar. Hints that mirror the plan's rules are local advice; exports hold simulation data only.",
  features: [
    { id: "day_load", kind: "fact", type: "number", label: "meetings on the same day", help: "Counts this meeting and every other one that day, shown or not.",
      value: (item, ctx) => (dayOf(item) === null ? null
        : 1 + ctx.items().filter((other) => other !== item && other.id !== item.id && dayOf(other) === dayOf(item)).length) },
    { id: "next_gap", kind: "fact", type: "number", label: "free minutes before the next meeting that day", unit: "minutes",
      help: "One hour per meeting assumed; negative when the next one starts before this one ends. Empty for the day's last meeting.",
      value: (item, ctx) => {
        if (!located(item)) return null;
        const later = sameDayTimed(item, ctx).map(minutesOf).filter((start) => start >= minutesOf(item));
        return later.length ? Math.min(...later) - (minutesOf(item) + HOUR) : null;
      } },
    { id: "overlap_count", kind: "fact", type: "number", label: "other meetings it overlaps", help: "One hour per meeting assumed; same-time clashes count too.",
      value: (item, ctx) => (located(item) ? sameDayTimed(item, ctx).filter((other) => overlaps(item, other)).length : null) },
    { id: "back_to_back", kind: "fact", type: "flag", label: "back-to-back with another meeting",
      help: "Another meeting that day starts the minute this one ends, or ends the minute it starts (one hour each).",
      value: (item, ctx) => located(item) && sameDayTimed(item, ctx).some((other) => Math.abs(minutesOf(other) - minutesOf(item)) === HOUR) },
    { id: "early", kind: "fact", type: "flag", label: "early start", help: "Starts before 09:00.", value: (item) => minutesOf(item) !== null && minutesOf(item) < 540 },
    { id: "late", kind: "fact", type: "flag", label: "late start", help: "Starts at 17:00 or later.", value: (item) => minutesOf(item) !== null && minutesOf(item) >= 1020 },
    { id: "lunch", kind: "fact", type: "flag", label: "runs into the lunch hour", help: "Overlaps 12:00 to 13:00, one hour per meeting assumed.",
      value: (item) => minutesOf(item) !== null && minutesOf(item) > 660 && minutesOf(item) < 780 },
    { id: "partner_type", kind: "fact", type: "category", label: "attendee type",
      help: "From the attendee domain: the shop itself, a vendor or a customer of the simulated world, or another organization.",
      value: (item, ctx) => partnerOf(item, ctx)?.type ?? null },
    { id: "partner_name", kind: "fact", type: "text", label: "vendor or customer met",
      help: "The vendor or customer whose domain the meeting is with; empty when it is the shop, another organization, or several customers share the domain.",
      value: (item, ctx) => partnerOf(item, ctx)?.name || "" },
    { id: "in_plan", kind: "fact", type: "flag", label: "meeting your latest command moves",
      help: "The meeting named by your own latest command's reschedule plan, run or not.",
      value: (item, ctx) => {
        const plan = ctx?.data?.plan;
        return !!plan && typeof item.id === "string" && item.id !== "" && plan.tool === "reschedule_meeting" && plan.exec_args?.meeting === item.id;
      } },
    { id: "past_day", kind: "fact", type: "flag", label: "day already past in the world's week",
      help: "The meeting's weekday comes before the simulated world's today (a Friday in the seeded world).",
      value: (item, ctx) => {
        const today = weekdayOf(ctx?.data?.today);
        return today !== null && dayIndexOf(item) !== null && dayIndexOf(item) < today;
      } },

    { id: "overlap", kind: "diagnostic", severity: "advice", scope: "list", label: "Meetings that overlap",
      help: "Different start times less than an hour apart on one day; meetings at the same time are reported by \"Meetings at the same time\".",
      check: (items) => {
        const timed = weekOrder(items.filter(located));
        const out = [];
        timed.forEach((a, i) => timed.slice(i + 1).forEach((b) => {
          if (dayOf(a) === dayOf(b) && minutesOf(a) !== minutesOf(b) && overlaps(a, b)) {
            out.push(`${nameOf(a)} (${clock(minutesOf(a))}) and ${nameOf(b)} (${clock(minutesOf(b))}) overlap on ${capital(dayOf(a))}, if each takes an hour.`);
          }
        }));
        return out;
      } },
    { id: "heavy_day", kind: "diagnostic", severity: "advice", scope: "list", label: "Day with three or more meetings",
      check: (items) => {
        const days = [...new Set(items.map(dayOf).filter(Boolean))]
          .sort((a, b) => (DAYS.indexOf(a) === -1 ? 9 : DAYS.indexOf(a)) - (DAYS.indexOf(b) === -1 ? 9 : DAYS.indexOf(b)));
        return days.map((day) => [day, onWeekday(items, day).length]).filter(([, count]) => count >= 3)
          .map(([day, count]) => `${capital(day)} has ${count} meetings.`);
      } },
    { id: "moved_conflict", kind: "diagnostic", severity: "advice", label: "Moved onto another meeting",
      help: "A meeting moved since the last Reset that now overlaps another one (one hour each).",
      check: (item, ctx) => {
        if (item.moved !== true || !located(item)) return null;
        const hit = sameDayTimed(item, ctx).filter((other) => overlaps(item, other));
        return hit.length ? `Moved to ${capital(dayOf(item))} ${clock(minutesOf(item))}, where it overlaps ${hit.map(nameOf).join(" and ")}.` : null;
      } },
    { id: "no_domain", kind: "diagnostic", severity: "advice", label: "No attendee domain",
      check: (item) => (lower(item.with_domain) ? null
        : "No attendee domain is on file, so an emailed request to move it can never pass \"Sender is part of this meeting\" and would need your approval (local advice mirroring the plan's check).") },
    { id: "vague_slot", kind: "diagnostic", severity: "advice", scope: "list", label: "Vague move would land on a meeting",
      help: "The plan reads a vague \"morning\" as 10:00 and \"afternoon\" as 14:00.",
      check: (items) => DAYS.flatMap((day) => VAGUE_SLOTS.flatMap(([word, start]) => {
        const holders = onWeekday(items, day).filter((item) => minutesOf(item) !== null && Math.abs(minutesOf(item) - start) < HOUR);
        return holders.length ? [`${capital(day)} ${clock(start)} is taken by ${holders.map(nameOf).join(" and ")}: a move to "${day} ${word}" would land on it `
          + `(the plan reads "${word}" as ${clock(start)}; local advice).`] : [];
      })) },

    { id: "longest_free", kind: "metric", format: "number", label: "Longest free stretch in working hours (hours)",
      help: "08:00 to 18:00 on weekdays, one hour per shown meeting; meetings without a readable time are left out.",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        let best = null;
        for (const day of DAYS) {
          for (const [from, to] of freeStretches(onWeekday(shown, day))) if (!best || to - from > best.to - best.from) best = { day, from, to };
        }
        return best ? { value: (best.to - best.from) / 60, detail: `${capital(best.day)} ${clock(best.from)} to ${clock(best.to)}` } : 0;
      } },
    { id: "free_days", kind: "metric", format: "integer", label: "Weekdays with no shown meeting",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        const free = DAYS.filter((day) => !onWeekday(shown, day).length);
        return { value: free.length, detail: free.map(capital).join(", ") };
      } },
    { id: "last_meeting", kind: "metric", format: "text", label: "Last shown meeting of the week",
      compute: (ctx) => {
        const list = weekOrder(ctx.shown().filter((item) => dayIndexOf(item) !== null && minutesOf(item) !== null));
        const last = list[list.length - 1];
        if (!last) return null;
        const tied = list.filter((item) => dayIndexOf(item) === dayIndexOf(last) && minutesOf(item) === minutesOf(last));
        return { value: `${capital(dayOf(last))} ${clock(minutesOf(last))}`, detail: tied.map(nameOf).join(", ") };
      } },
    ...[["earliest_start", "Earliest shown start time", Math.min], ["latest_start", "Latest shown start time", Math.max]].map(([id, label, pick]) => ({
      id, kind: "metric", format: "text", label, help: "Any weekday.",
      compute: (ctx) => {
        const timed = ctx.shown().filter((item) => dayIndexOf(item) !== null && minutesOf(item) !== null);
        if (!timed.length) return null;
        const minute = pick(...timed.map(minutesOf));
        return { value: clock(minute), detail: timed.filter((item) => minutesOf(item) === minute).map((item) => `${nameOf(item)} (${capital(dayOf(item))})`).join(", ") };
      },
    })),
    { id: "partner_domains", kind: "metric", format: "integer", label: "Outside domains among shown meetings",
      help: "Distinct attendee domains other than the shop's own.",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        const domains = [...new Set(shown.map((item) => lower(item.with_domain)).filter((domain) => domain && domain !== businessDomain(ctx)))];
        return { value: domains.length, detail: domains.join(", ") };
      } },

    { id: "week_grid", kind: "exporter", label: "Shown meetings as a Markdown week grid", help: "simulation data: one column per weekday, meetings in time order",
      filename: "harbor-week-grid.md", mime: "text/markdown",
      build: (ctx) => {
        const columns = DAYS.map((day) => weekOrder(onWeekday(ctx.shown(), day))
          .map((item) => `${minutesOf(item) === null ? item.time || "?" : clock(minutesOf(item))} ${nameOf(item)}${item.moved ? " (moved)" : ""}`));
        const depth = Math.max(0, ...columns.map((column) => column.length));
        const rows = Array.from({ length: depth }, (_, row) => columns.map((column) => column[row] || ""));
        return `${formatMarkdownTable(DAYS.map(capital), rows)}\n`;
      } },
    { id: "jsonl", kind: "exporter", label: "Shown meetings as JSON Lines", help: "simulation data: id, title, day, time, attendee domain, moved",
      filename: "harbor-meetings.jsonl", mime: "application/x-ndjson",
      build: (ctx) => formatJsonl(ctx.shown().map((item) => ({ id: item.id, title: item.title || "", day: item.day ?? null, time: item.time ?? null,
        with_domain: item.with_domain ?? null, moved: item.moved === true }))) },
    { id: "free_slots", kind: "exporter", label: "Free working time per weekday as text",
      help: "simulation data: free stretches between 08:00 and 18:00 around the shown meetings, one hour each",
      filename: "harbor-free-time.txt",
      build: (ctx) => {
        const shown = ctx.shown();
        const lines = DAYS.map((day) => {
          const free = freeStretches(onWeekday(shown, day));
          return `${capital(day)}: ${free.length ? free.map(([from, to]) => `${clock(from)}–${clock(to)}`).join(", ") : "fully booked"}`;
        });
        const untimed = shown.filter((item) => DAYS.includes(dayOf(item)) && minutesOf(item) === null);
        return ["Free working time, 08:00 to 18:00, one hour per shown meeting (simulation data)", ...lines,
          ...(untimed.length ? [`Not counted (start time not readable): ${untimed.map((item) => `${nameOf(item)} (${capital(dayOf(item))})`).join(", ")}`] : [])].join("\n") + "\n";
      } },
    { id: "by_domain", kind: "exporter", label: "Shown meetings by attendee domain as CSV",
      help: "simulation data: domain, attendee type, meeting count and titles; meetings without a domain come last",
      filename: "harbor-meetings-by-domain.csv", mime: "text/csv",
      build: (ctx) => {
        const groups = new Map();
        for (const item of ctx.shown()) {
          const key = lower(item.with_domain) || "";
          groups.set(key, [...(groups.get(key) || []), item]);
        }
        const keys = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || (a < b ? -1 : a > b ? 1 : 0));
        return csvText([["domain", "attendee_type", "meetings", "titles"], ...keys.map((key) => {
          const list = groups.get(key);
          return [key || "(no domain)", key ? partnerOf(list[0], ctx)?.type || "" : "", list.length, list.map(nameOf).join("; ")];
        })]);
      } },
  ],
});
