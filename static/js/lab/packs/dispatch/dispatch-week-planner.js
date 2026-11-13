// Week planner: facts, clash and hours checks, counts, an iCalendar and agenda export, and a drafting shortcut for the
// "This week" calendar of the simulated Harbor Coffee Co. world on the Dispatch page. Nothing here moves a meeting.
import { csvText, definePack } from "../../kit.js";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const minutesOf = (item) => (typeof item.minutes === "number" ? item.minutes : null);
const dayIndexOf = (item) => (Number.isInteger(item.day_index) ? item.day_index : null);
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const businessDomain = (ctx) => (typeof ctx?.data?.business_domain === "string" ? ctx.data.business_domain : "harborcoffee.example");
// Week order: by day, then by start time, unknown times last within a day; ties keep the incoming order.
const weekOrder = (items) => items.map((item, index) => ({ item, index })).sort((a, b) => (dayIndexOf(a.item) ?? 9) - (dayIndexOf(b.item) ?? 9)
  || (minutesOf(a.item) ?? 1e9) - (minutesOf(b.item) ?? 1e9) || a.index - b.index).map(({ item }) => item);

// The calendar day of a weekday in the week of an ISO date (Monday-based), as YYYYMMDD; null when the date is unreadable.
function dateOfWeekday(today, dayIndex) {
  const match = typeof today === "string" ? today.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return null;
  const base = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(base.getTime())) return null;
  const monday = base.getTime() - ((base.getUTCDay() + 6) % 7) * 86400000;
  return new Date(monday + dayIndex * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
}
const icsText = (text) => String(text).replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");

export default definePack({
  id: "dispatch-week-planner",
  surface: "dispatch.calendar",
  title: "Week planner",
  about: "Filters, sorts, clash and working-hours checks, counts and calendar exports for the simulated shop's meetings this week, plus a shortcut that only drafts a reschedule command. Exports hold simulation data only.",
  features: [
    { id: "day", kind: "fact", type: "category", label: "weekday", value: (item) => item.day || null },
    { id: "start", kind: "fact", type: "number", label: "start minute of the day", unit: "minutes", help: "600 is 10:00.", value: (item) => minutesOf(item) },
    { id: "day_number", kind: "fact", type: "number", label: "weekday number", help: "1 is Monday, 5 is Friday.",
      value: (item) => (dayIndexOf(item) === null ? null : dayIndexOf(item) + 1) },
    { id: "moved", kind: "fact", type: "flag", label: "moved meeting", value: (item) => item.moved === true },
    { id: "morning", kind: "fact", type: "flag", label: "morning start", help: "Starts before 12:00.", value: (item) => minutesOf(item) !== null && minutesOf(item) < 720 },
    { id: "domain", kind: "fact", type: "category", label: "attendee domain", value: (item) => item.with_domain || null },
    { id: "internal", kind: "fact", type: "flag", label: "internal meeting", value: (item, ctx) => !!item.with_domain && item.with_domain === businessDomain(ctx) },
    { id: "title", kind: "fact", type: "text", label: "meeting title", value: (item) => item.title || "" },
    { id: "week_hour", kind: "fact", type: "number", label: "hours into the work week", help: "Monday 00:00 is 0; Tuesday 10:00 is 34.",
      value: (item) => (dayIndexOf(item) === null || minutesOf(item) === null ? null : dayIndexOf(item) * 24 + minutesOf(item) / 60) },
    { id: "clash_count", kind: "fact", type: "number", label: "other meetings at the same time",
      value: (item, ctx) => (!item.day || minutesOf(item) === null ? null
        : ctx.items().filter((other) => other !== item && other.id !== item.id && other.day === item.day && minutesOf(other) === minutesOf(item)).length) },

    { id: "clash", kind: "diagnostic", severity: "problem", scope: "list", label: "Meetings at the same time",
      check: (items) => {
        const slots = new Map();
        for (const item of items) {
          if (!item.day || minutesOf(item) === null) continue;
          const key = `${item.day} ${minutesOf(item)}`;
          slots.set(key, [...(slots.get(key) || []), item]);
        }
        return [...slots.values()].filter((list) => list.length > 1)
          .map((list) => `${list.map((item) => item.title || item.id).join(" and ")} both start ${capital(list[0].day)} ${clock(minutesOf(list[0]))}.`);
      } },
    { id: "outside_hours", kind: "diagnostic", severity: "advice", label: "Outside working hours",
      check: (item) => (minutesOf(item) !== null && (minutesOf(item) < 480 || minutesOf(item) >= 1080)
        ? `Starts at ${clock(minutesOf(item))}, outside 08:00 to 18:00.` : null) },
    { id: "unreadable_time", kind: "diagnostic", severity: "problem", label: "Start time not readable",
      check: (item) => (minutesOf(item) === null ? `The start time ${JSON.stringify(item.time ?? null)} is not HH:MM.` : null) },

    { id: "moved_count", kind: "metric", format: "integer", label: "Meetings moved since the last reset",
      compute: (ctx) => (ctx.items().length ? ctx.items().filter((item) => item.moved === true).length : null) },
    { id: "busiest_day", kind: "metric", format: "text", label: "Busiest shown day",
      compute: (ctx) => {
        const counts = DAYS.map((day) => ctx.shown().filter((item) => item.day === day).length);
        const most = Math.max(...counts);
        if (!most) return null;
        return { value: DAYS.filter((_, index) => counts[index] === most).map(capital).join(", "), detail: `${most} meeting${most === 1 ? "" : "s"}` };
      } },
    { id: "first_meeting", kind: "metric", format: "text", label: "First shown meeting of the week",
      compute: (ctx) => {
        const first = weekOrder(ctx.shown().filter((item) => dayIndexOf(item) !== null && minutesOf(item) !== null))[0];
        return first ? { value: `${capital(first.day)} ${clock(minutesOf(first))}`, detail: first.title } : null;
      } },
    { id: "external_share", kind: "metric", format: "percent", label: "Shown meetings with people outside the shop",
      help: "Meetings without a domain are left out.",
      compute: (ctx) => {
        const known = ctx.shown().filter((item) => item.with_domain);
        return known.length ? known.filter((item) => item.with_domain !== businessDomain(ctx)).length / known.length : null;
      } },
    { id: "off_calendar", kind: "metric", format: "integer", label: "Meetings not on the Monday to Friday calendar",
      help: "The page draws weekdays only, so these are never shown.",
      compute: (ctx) => (ctx.items().length ? ctx.items().filter((item) => item.on_calendar !== true).length : null) },

    { id: "ics", kind: "exporter", label: "Shown meetings as an iCalendar file (.ics)", help: "simulation data; one hour each, dated in the world's current week",
      filename: "harbor-week.ics", mime: "text/calendar",
      build: (ctx) => {
        const today = ctx.data?.today;
        if (!dateOfWeekday(today, 0)) throw new Error("The world's date is not loaded yet.");
        const stamp = `${today.replaceAll("-", "")}T000000Z`;
        const events = ctx.shown().filter((item) => dayIndexOf(item) !== null && minutesOf(item) !== null).flatMap((item) => {
          const date = dateOfWeekday(today, dayIndexOf(item));
          const end = Math.min(minutesOf(item) + 60, 23 * 60 + 59);
          return ["BEGIN:VEVENT", `UID:${item.id}@${businessDomain(ctx)}`, `DTSTAMP:${stamp}`, `DTSTART:${date}T${clock(minutesOf(item)).replace(":", "")}00`,
            `DTEND:${date}T${clock(end).replace(":", "")}00`, `SUMMARY:${icsText(item.title || item.id)}`, "END:VEVENT"];
        });
        return [...["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jev Lab//Dispatch week planner//EN"], ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
      } },
    { id: "agenda", kind: "exporter", label: "Shown meetings as an agenda in week order", help: "simulation data: day, time, title, attendee domain",
      filename: "harbor-agenda.txt",
      build: (ctx) => {
        const list = weekOrder(ctx.shown());
        if (!list.length) return "No meeting is shown.\n";
        return list.map((item) => [`${item.day ? capital(item.day) : "?"} ${minutesOf(item) === null ? item.time || "?" : clock(minutesOf(item))}`,
          item.title || item.id, item.with_domain || "", item.moved ? "moved" : ""].filter(Boolean).join(" · ")).join("\n") + "\n";
      } },
    { id: "meetings_csv", kind: "exporter", label: "Shown meetings as CSV", help: "simulation data: id, title, day, time, attendee domain, moved",
      filename: "harbor-meetings.csv", mime: "text/csv",
      build: (ctx) => csvText([["meeting", "title", "day", "time", "with_domain", "moved"],
        ...ctx.shown().map((item) => [item.id, item.title || "", item.day || "", item.time || "", item.with_domain || "", item.moved ? "yes" : "no"])]) },

    { id: "draft_move", kind: "command", group: "Dispatch calendar", title: "Draft a reschedule command for the first shown meeting",
      when: (ctx) => ctx.shown().some((item) => item.title),
      run: (ctx) => {
        const meeting = ctx.shown().find((item) => item.title);
        if (!meeting) throw new Error("No shown meeting has a title.");
        ctx.actions.draftCommand(`move the ${meeting.title.charAt(0).toLowerCase()}${meeting.title.slice(1)} to `);
        ctx.env?.toast?.("Drafted in the command box. Type the new day or time, then press Enter to plan it.");
      } },
    { id: "copy_today", kind: "command", group: "Dispatch calendar", title: "Copy today's shown meetings",
      when: (ctx) => dateOfWeekday(ctx.data?.today, 0) !== null,
      run: (ctx) => {
        const match = ctx.data.today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const weekday = (new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() + 6) % 7;
        const list = weekday > 4 ? [] : weekOrder(ctx.shown().filter((item) => item.day === DAYS[weekday]));
        ctx.env.copy(list.length ? list.map((item) => `${minutesOf(item) === null ? item.time || "?" : clock(minutesOf(item))} ${item.title || item.id}`).join("\n") : "No meetings today.");
        ctx.env.toast?.(`Copied ${list.length} meeting${list.length === 1 ? "" : "s"} for today.`);
      } },
  ],
});
