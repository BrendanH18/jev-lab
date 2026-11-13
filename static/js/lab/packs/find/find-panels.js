// Panels for the result cards of the user's own latest Find search ("find.results", contract:
// static/js/lab/surfaces/find.js): a heat table of each question's where-probability per document section, an outline of
// the sections with the questions that matched them, the shape of one question's probability over every searched line,
// and a log of this page session's searches. Everything reads only searches the user ran in this page load and nothing
// searches: the log keeps questions only (never verdicts, probabilities or measurements), and putting a logged question
// back into a box does not search. Sections come from the request's tagged document ("Section X:" lines).
import { definePack } from "../../kit.js";

const HEADING = /^Section [A-Z]:/;
const BEFORE = "Before the first section";
const EPSILON = 1e-9;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const lineId = (index) => `L${String(index).padStart(3, "0")}`;
const faint = (h, text) => h("p", { class: "faint" }, text);
const probsOf = (item) => (Array.isArray(item?.line_probs) ? item.line_probs : null);
const hitsOf = (item) => (Array.isArray(item?.hits) ? item.hits.filter((hit) => hit && typeof hit === "object") : []);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const shade = (level) => `background-color: color-mix(in srgb, var(--series) ${[0, 20, 45, 75][level]}%, transparent)`;
const levelOf = (value) => (value >= 0.5 ? 3 : value >= 0.2 ? 2 : value >= 0.05 ? 1 : 0);
// Same words, ignoring case and spacing.
const norm = (text) => String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// The searched lines' texts by index, from the request's tagged document ("L000| text"), or null without one.
function searchedTexts(ctx) {
  const tagged = ctx?.data?.request?.state?.document;
  if (typeof tagged !== "string") return null;
  const out = [];
  for (const line of tagged.split("\n")) {
    const match = line.match(/^L(\d+)\| ?(.*)$/);
    if (match) out[Number(match[1])] = match[2];
  }
  return out;
}

// The searched document's sections in order, { title, lines: [index] }, and the section of every line (at[index]);
// lines above the first heading form their own section. null without a tagged document.
function outlineOf(ctx) {
  const texts = searchedTexts(ctx);
  if (!texts || !texts.length) return null;
  const sections = [], at = [];
  Array.from(texts, (text, index) => {
    if (typeof text === "string" && HEADING.test(text)) sections.push({ title: text, lines: [] });
    else if (!sections.length) sections.push({ title: BEFORE, lines: [] });
    sections[sections.length - 1].lines.push(index);
    at[index] = sections.length - 1;
    return null;
  });
  return { sections, at, texts };
}

// A question's where-probability in one section: the sum (or the largest) of its lines' numbers; null when the
// response holds no number for any of them.
function cellOf(item, section, mode = "sum") {
  const probs = probsOf(item);
  if (!probs) return null;
  const known = section.lines.map((index) => finite(probs[index])).filter((value) => value !== null);
  if (!known.length) return null;
  return mode === "max" ? Math.max(...known) : sum(known);
}

// The section index holding the most of a question's probability (first on a tie), or null.
function bestSection(item, outline, mode = "sum") {
  let best = null, value = null;
  outline.sections.forEach((section, index) => {
    const cell = cellOf(item, section, mode);
    if (cell !== null && (value === null || cell > value)) { best = index; value = cell; }
  });
  return best;
}

// How many of the likeliest lines it takes to hold a share of the question's known probability; null with none.
function linesTo(probs, share) {
  const ranked = probs.map(finite).filter((value) => value !== null && value > 0).sort((a, b) => b - a);
  const total = sum(ranked);
  if (!(total > 0)) return null;
  let held = 0;
  for (let count = 1; count <= ranked.length; count++) {
    held += ranked[count - 1];
    if (held >= share * total - EPSILON) return count;
  }
  return ranked.length;
}

const BUCKETS = [
  ["missing", "no number", (value) => value === null],
  ["zero", "0", (value) => value === 0],
  ["under_1", "under 1%", (value) => value > 0 && value < 0.01],
  ["1_5", "1% to under 5%", (value) => value >= 0.01 && value < 0.05],
  ["5_20", "5% to under 20%", (value) => value >= 0.05 && value < 0.2],
  ["20_50", "20% to under 50%", (value) => value >= 0.2 && value < 0.5],
  ["50_up", "50% or more", (value) => value >= 0.5],
];

const posOf = (value) => (Number.isInteger(Number(value)) ? Number(value) : null);
const label = (item) => `Q${item.position}`;

export default definePack({
  id: "find-panels",
  surface: "find.results",
  title: "Find panels",
  about: "Panels for your own latest Find search: each question's probability per document section, an outline of sections with the "
    + "questions that matched them, one question's probability over every line, and a log of this session's searches. The log keeps your "
    + "questions only, never answers, and nothing here searches.",
  features: [
    // ---------- query by section heat table ----------
    { id: "section_heat", kind: "panel", title: "Questions by section",
      improvements: [
        { id: "table", title: "Show each shown question's where-probability added up per document section, as a table of sections by questions" },
        { id: "shade", title: "Shade each cell by its probability so the strong sections stand out" },
        { id: "best", title: "Mark the section holding the most probability for each question" },
        { id: "mode", title: "Switch the cells between a section's total and its single likeliest line" },
        { id: "top_for", title: "Count for each section how many shown questions put the most probability there" },
        { id: "untouched", title: "List the sections that no shown question gives 5% or more" },
        { id: "copy", title: "Copy the table as tab-separated text (holds answers)" },
      ],
      render: (h, ctx, api) => {
        if (!ctx.items().length) return faint(h, "Search first to see where each question's probability falls by section.");
        const outline = outlineOf(ctx);
        if (!outline) return faint(h, "This search holds no tagged document to group by section.");
        const shown = ctx.shown();
        if (!shown.length) return faint(h, "No question is shown. Clear the Lab filters to see the table.");
        const mode = api.state.mode === "max" ? "max" : "sum";
        const best = new Map(shown.map((item) => [item.position, bestSection(item, outline, mode)]));
        const cells = outline.sections.map((section) => shown.map((item) => cellOf(item, section, mode)));
        const untouched = outline.sections.filter((section) => shown.every((item) => (cellOf(item, section) ?? 0) < 0.05 - EPSILON));
        const copy = () => api.copy(`${[["section", ...shown.map(label)], ...outline.sections.map((section, row) => [section.title,
          ...cells[row].map((value) => (value === null ? "" : String(Number(value.toFixed(4)))))])].map((row) => row.join("\t")).join("\n")}\n`);
        return h("div", {},
          faint(h, `Your own search: each question's where-probability ${mode === "max" ? "of the likeliest line" : "added up over the lines"} of each section. A dash: the response holds no number there.`),
          h("label", {}, "Cells: ", h("select", { class: "input sm", "data-control": "mode", value: mode, onchange: (event) => { api.state.mode = event.target.value; api.redraw(); } },
            h("option", { value: "sum", selected: mode === "sum" }, "Section total"), h("option", { value: "max", selected: mode === "max" }, "Likeliest line"))),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Section"),
              shown.map((item) => h("th", { "data-question": String(item.position), title: item.query }, label(item))),
              h("th", {}, "Most for"))),
            h("tbody", {}, outline.sections.map((section, row) => h("tr", { "data-section": section.title }, h("td", {}, section.title),
              shown.map((item, column) => {
                const value = cells[row][column];
                const isBest = best.get(item.position) === row;
                return h("td", { class: "num", "data-cell": String(item.position), "data-level": value === null ? undefined : String(levelOf(value)),
                  "data-best": isBest ? "" : undefined, style: value === null ? undefined : shade(levelOf(value)) }, value === null ? "—" : `${pct(value)}${isBest ? " ★" : ""}`);
              }),
              h("td", { class: "num", "data-top-for": "" }, String(shown.filter((item) => best.get(item.position) === row).length)))))),
          h("p", { "data-part": "untouched" }, untouched.length
            ? `No shown question gives 5% or more to: ${untouched.map((section) => section.title).join("; ")}.`
            : "Every section gets 5% or more from at least one shown question."),
          h("button", { class: "btn sm ghost", "data-copy": "heat", onclick: copy }, "Copy table"));
      } },

    // ---------- section outline ----------
    { id: "section_outline", kind: "panel", title: "Section outline with matched questions",
      improvements: [
        { id: "outline", title: "List the searched document's sections in order with their first line and line count" },
        { id: "top_matches", title: "Under each section, name the shown questions whose top line lies in it, with that line's probability and the verdict" },
        { id: "listed_matches", title: "Also name questions whose card lists a lower-ranked line in a section other than their top line's" },
        { id: "matched_only", title: "Show only the sections that hold a shown question's top line" },
        { id: "copy", title: "Copy the outline with its matched questions as Markdown (holds answers)" },
      ],
      render: (h, ctx, api) => {
        if (!ctx.items().length) return faint(h, "Search first to see which questions matched each section.");
        const outline = outlineOf(ctx);
        if (!outline) return faint(h, "This search holds no tagged document to outline.");
        const sectionOf = (hit) => (Number.isInteger(hit?.index) && hit.index < outline.at.length ? outline.at[hit.index] ?? null : null);
        const top = outline.sections.map(() => []), listed = outline.sections.map(() => []);
        for (const item of ctx.shown()) {
          const hits = hitsOf(item);
          const own = hits[0] ? sectionOf(hits[0]) : null;
          if (own !== null) top[own].push({ item, hit: hits[0] });
          const seen = new Set();
          for (const hit of hits.slice(1)) {
            const at = sectionOf(hit);
            if (!hit.listed || at === null || at === own || seen.has(at)) continue;
            seen.add(at);
            listed[at].push({ item, hit });
          }
        }
        const only = api.state.matchedOnly === true;
        const rows = outline.sections.map((section, index) => ({ section, index })).filter((row) => !only || top[row.index].length);
        const prob = (hit) => (finite(hit.prob) === null ? "no number" : pct(hit.prob));
        const head = (section) => `${section.title} · ${lineId(section.lines[0])} · ${plural(section.lines.length, "line")}`;
        const topText = ({ item, hit }) => `${label(item)} “${item.query}” · top line ${hit.id} at ${prob(hit)} · ${item.verdict ?? "no verdict"}`;
        const listedText = ({ item, hit }) => `${label(item)} lists ${hit.id} at ${prob(hit)}`;
        const copy = () => api.copy(`# Document outline with matched questions (your own search; holds answers)\n\n${rows.map(({ section, index }) => [`- ${head(section)}`,
          ...top[index].map((entry) => `  - ${topText(entry)}`), ...listed[index].map((entry) => `  - ${listedText(entry)}`)].join("\n")).join("\n")}\n`);
        return h("div", {},
          faint(h, "Your own search: each section of the searched document, the shown questions whose top line lies in it, and those whose card lists another line there."),
          h("label", {}, h("input", { type: "checkbox", "data-control": "matched-only", checked: only,
            onchange: (event) => { api.state.matchedOnly = event.target.checked === true; api.redraw(); } }), " Only sections holding a top line"),
          h("ul", { class: "lab-list" }, rows.map(({ section, index }) => h("li", { "data-section": section.title },
            h("div", {}, h("strong", { "data-part": "head" }, head(section)),
              h("ul", {}, top[index].map((entry) => h("li", { "data-top": label(entry.item) }, topText(entry))),
                listed[index].map((entry) => h("li", { "data-listed": label(entry.item) }, listedText(entry)))))))),
          h("button", { class: "btn sm ghost", "data-copy": "outline", onclick: copy }, "Copy as Markdown"));
      } },

    // ---------- one question's probability over every line ----------
    { id: "distribution", kind: "panel", title: "Probability over every line",
      improvements: [
        { id: "buckets", title: "Count one shown question's searched lines by probability range, from no number to 50% or more (the focused question first)" },
        { id: "coverage", title: "Show how many of the likeliest lines hold 50%, 80% and 95% of the question's probability" },
        { id: "likeliest", title: "List the question's ten likeliest lines with bars, beyond the five on its card" },
        { id: "overlap", title: "Compare with a second question: the probability they share and the lines both give 5% or more" },
      ],
      render: (h, ctx, api) => {
        if (!ctx.items().length) return faint(h, "Search first to see a question's probability over every line.");
        const shown = ctx.shown();
        if (!shown.length) return faint(h, "No question is shown. Clear the Lab filters to choose one.");
        const byPosition = (position) => shown.find((item) => item.position === position) || null;
        const item = byPosition(api.state.question) || byPosition(ctx.data.focus) || shown[0];
        const other = api.state.other === item.position ? null : byPosition(api.state.other);
        const picker = h("label", {}, "Question: ", h("select", { class: "input sm", "data-control": "question", value: String(item.position),
          onchange: (event) => { api.state.question = posOf(event.target.value); api.redraw(); } },
        shown.map((entry) => h("option", { value: String(entry.position), selected: entry === item }, `${label(entry)} ${entry.query}`))));
        const probs = probsOf(item);
        if (!probs) return h("div", {}, picker, faint(h, `The response holds no line probabilities for ${label(item)}.`));
        const values = probs.map(finite);
        const texts = searchedTexts(ctx) || [];
        const counts = BUCKETS.map(([key, name, test]) => [key, name, values.filter((value) => test(value)).length]);
        const most = Math.max(1, ...counts.map(([, , count]) => count));
        const ranked = values.map((value, index) => ({ value, index })).filter((entry) => entry.value !== null && entry.value > 0)
          .sort((a, b) => b.value - a.value || a.index - b.index);
        const cover = [0.5, 0.8, 0.95].map((share) => linesTo(probs, share));
        const min = finite(ctx.data.rules?.highlight_min) ?? 0.05;
        let overlap = null;
        if (other && probsOf(other)) {
          const theirs = probsOf(other).map(finite);
          let shared = 0;
          const both = [];
          values.forEach((value, index) => {
            const their = theirs[index] ?? null;
            if (value === null || their === null) return;
            shared += Math.min(value, their);
            if (value >= min && their >= min) both.push(lineId(index));
          });
          overlap = `${label(item)} and ${label(other)} share ${pct(shared)} (the smaller of the two per line, added up) · lines both give ${pct(min)} or more: ${both.length ? both.join(", ") : "none"}`;
        }
        return h("div", {},
          faint(h, "Your own search: the where-probability of every searched line for one question."),
          picker,
          h("table", { class: "table lab-table", "data-part": "buckets" },
            h("thead", {}, h("tr", {}, ["Probability", "Lines", ""].map((name) => h("th", {}, name)))),
            h("tbody", {}, counts.map(([key, name, count]) => h("tr", { "data-bucket": key }, h("td", {}, name), h("td", { class: "num" }, String(count)),
              h("td", {}, h("div", { class: "bar" }, h("i", { style: `width: ${((count / most) * 100).toFixed(1)}%` }))))))),
          h("p", { "data-part": "coverage" }, cover[0] === null ? "No line has a probability above 0."
            : `Likeliest lines holding 50% of the probability: ${cover[0]} · 80%: ${cover[1]} · 95%: ${cover[2]} (of ${plural(values.length, "line")}).`),
          h("ol", { "data-part": "likeliest" }, ranked.slice(0, 10).map((entry) => h("li", { "data-line": lineId(entry.index) },
            `${lineId(entry.index)} ${pct(entry.value)} `, h("span", { class: "bar", style: "display: inline-block; width: 8em; vertical-align: middle" }, h("i", { style: `width: ${(entry.value * 100).toFixed(1)}%` })),
            ` ${texts[entry.index] ?? ""}`))),
          h("label", {}, "Compare with: ", h("select", { class: "input sm", "data-control": "other", value: other ? String(other.position) : "",
            onchange: (event) => { api.state.other = posOf(event.target.value || "x"); api.redraw(); } },
          h("option", { value: "", selected: !other }, "No second question"),
          shown.filter((entry) => entry !== item).map((entry) => h("option", { value: String(entry.position), selected: entry === other }, `${label(entry)} ${entry.query}`)))),
          overlap ? h("p", { "data-part": "overlap" }, overlap) : null);
      } },

    // ---------- session query log ----------
    { id: "query_log", kind: "panel", title: "This session's searches",
      improvements: [
        { id: "log", title: "Keep a list of this page session's searches with their questions in order, never their answers" },
        { id: "gaps", title: "Say which searches ran while the panel was closed and are missing from the list" },
        { id: "repeats", title: "Mark questions asked again from an earlier search" },
        { id: "changes", title: "Show which questions each search added and dropped since the one before it" },
        { id: "re_add", title: "Put an earlier question back into a question box, without searching" },
        { id: "copy", title: "Copy the logged questions as text, one block per search (no answers)" },
        { id: "clear", title: "Clear the list; the next search starts it again" },
      ],
      render: (h, ctx, api) => {
        const state = api.state;
        if (!Array.isArray(state.log)) state.log = [];
        const count = ctx.data.searches;
        if (ctx.items().length && Number.isInteger(count) && count > 0 && count !== state.last) {
          state.log.push({ search: count, queries: [...ctx.data.searched] });
          state.last = count;
        }
        const log = state.log;
        if (!log.length) return faint(h, "Searches you run while this panel is open are listed here: questions only, never answers.");
        const boxes = new Set((ctx.data.queries || []).map(norm).filter(Boolean));
        const gaps = [];
        log.forEach((entry, index) => {
          const from = index ? log[index - 1].search + 1 : (state.cleared ?? 0) + 1;
          if (entry.search > from) gaps.push(from === entry.search - 1 ? `search ${from}` : `searches ${from}–${entry.search - 1}`);
        });
        const add = (query) => {
          try {
            ctx.actions.addQuery(query);
            api.toast("Put in a question box. Press Search to run it; nothing was searched.");
          } catch (error) { api.toast(error.message, "error"); }
          api.redraw();
        };
        const copy = () => api.copy(`Find questions of this page session (questions only, no answers)\n\n${log.map((entry) => [`Search ${entry.search}`,
          ...entry.queries.map((query) => `- ${query}`)].join("\n")).join("\n\n")}\n`);
        return h("div", {},
          faint(h, "Your questions of this page session as you searched them while this panel was open; the list lasts until the page reloads."),
          gaps.length ? h("p", { "data-part": "gaps" }, `Not listed: ${gaps.join(", ")} ran while this panel was closed.`) : null,
          h("ol", {}, log.map((entry, index) => {
            const before = index ? new Set(log[index - 1].queries.map(norm)) : null;
            const now = new Set(entry.queries.map(norm));
            const dropped = before ? log[index - 1].queries.filter((query) => !now.has(norm(query))) : [];
            const first = (query) => log.slice(0, index).find((earlier) => earlier.queries.some((other) => norm(other) === norm(query)));
            return h("li", { "data-search": String(entry.search) }, h("strong", {}, `Search ${entry.search}`),
              h("ul", {}, entry.queries.map((query) => {
                const earlier = first(query);
                const added = before && !before.has(norm(query));
                return h("li", { "data-query": query, "data-repeat": earlier ? String(earlier.search) : undefined, "data-added": added ? "" : undefined },
                  query, earlier ? ` · asked in search ${earlier.search}` : "", added ? " · new" : "",
                  !boxes.has(norm(query)) && norm(query) ? h("button", { class: "btn sm ghost", "data-add": query, onclick: () => add(query) }, "Put in a box") : null);
              })),
              dropped.length ? h("p", { "data-dropped": "" }, `Dropped since search ${log[index - 1].search}: ${dropped.join("; ")}`) : null);
          })),
          h("button", { class: "btn sm ghost", "data-copy": "log", onclick: copy }, "Copy questions"),
          h("button", { class: "btn sm ghost", "data-action": "clear", onclick: () => { state.log = []; state.cleared = state.last ?? 0; api.redraw(); } }, "Clear list"));
      } },

    // ---------- metrics ----------
    { id: "heaviest_section", kind: "metric", format: "text", label: "Section with the most probability across the shown questions",
      help: "Each shown question's where-probability added up per section, then over the questions: the section most answers point at.",
      compute: (ctx) => {
        const outline = outlineOf(ctx), shown = ctx.shown();
        if (!outline || !shown.length) return null;
        let best = null;
        outline.sections.forEach((section) => {
          const cells = shown.map((item) => cellOf(item, section)).filter((value) => value !== null);
          if (cells.length && (!best || sum(cells) > best.total)) best = { section, total: sum(cells) };
        });
        return best ? { value: best.section.title, detail: `${best.total.toFixed(2)} summed over ${plural(shown.length, "question")}` } : null;
      } },
    { id: "top_in_best_section", kind: "metric", format: "percent", label: "Shown questions whose top line is in their most probable section",
      help: "Low means a question's top line sits in one section while most of its probability lies in another: read both.",
      compute: (ctx) => {
        const outline = outlineOf(ctx);
        if (!outline) return null;
        const rated = ctx.shown().flatMap((item) => {
          const index = item?.top?.index, best = bestSection(item, outline);
          return Number.isInteger(index) && index < outline.at.length && best !== null ? [outline.at[index] === best] : [];
        });
        if (!rated.length) return null;
        const yes = rated.filter(Boolean).length;
        return { value: yes / rated.length, detail: `${yes} of ${rated.length}` };
      } },
    { id: "mean_lines_80", kind: "metric", format: "number", label: "Mean lines holding 80% of a shown question's probability",
      help: "Per shown question, how many of its likeliest lines hold 80% of its where-probability, averaged. Near 1: each answer sits on one line.",
      compute: (ctx) => {
        const counts = ctx.shown().map((item) => (probsOf(item) ? linesTo(probsOf(item), 0.8) : null)).filter((value) => value !== null);
        return counts.length ? { value: sum(counts) / counts.length, detail: `over ${plural(counts.length, "question")}` } : null;
      } },
  ],
});
