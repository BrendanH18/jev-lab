// Lab kit: the contract between a page and its Lab packs, and the engines that run what packs declare.
// Pure code: it imports nothing and touches no DOM, storage, clipboard or network, so Node can test all of it.
//
// A pack is one module that default-exports definePack({ id, surface, title, about, features }): id is its file name,
// surface the list or page area it attaches to, about one or two sentences for the inventory. A feature has a kind:
//   fact        a derived value of ONE list item (number | flag | text | category). The Refine bar turns it into
//               filters, sorting, a summary and a column of the facts table.
//   diagnostic  an advisory finding about one item or about the whole list.
//   transform   an explicit preview -> Apply -> Undo edit of the list's items (a pure function).
//   metric      one aggregate computed from data already on the page.
//   exporter    text to copy or download, with a content boundary the pack states in its label/help.
//   importer    pasted text parsed into items.
//   command     an action for the command palette, with an optional keyboard shortcut.
//   tool        a standalone calculator or converter with typed inputs.
//   panel       a bespoke widget; it lists the improvements it holds.
//   behavior    a change that lives in existing page code; the pack records and tests it.
// Packs never call the model and never read storage. They get everything through the ctx a surface passes in.

export const KINDS = Object.freeze(["fact", "diagnostic", "transform", "metric", "exporter", "importer", "command", "tool", "panel", "behavior"]);
export const FACT_TYPES = Object.freeze(["number", "flag", "text", "category"]);
export const SEVERITIES = Object.freeze(["info", "advice", "problem"]);
export const INPUT_TYPES = Object.freeze(["number", "integer", "text", "textarea", "select", "checkbox"]);
export const FORMATS = Object.freeze(["number", "integer", "percent", "usd", "ms", "text"]);
export const FACT_OPS = Object.freeze({ number: ["min", "max"], flag: ["with", "without"], text: ["contains"], category: ["is"] });

const PACK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FEATURE_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const INPUT_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const isText = (value) => typeof value === "string" && value.trim() !== "";
const isFn = (value) => typeof value === "function";

// ---------- packs ----------

function checkInputs(where, inputs) {
  if (!Array.isArray(inputs)) throw new Error(`${where}: inputs must be an array`);
  const names = new Set();
  for (const input of inputs) {
    if (!input || !INPUT_NAME.test(input.name || "")) throw new Error(`${where}: every input needs a name of letters, digits and underscores`);
    if (names.has(input.name)) throw new Error(`${where}: input ${input.name} is declared twice`);
    names.add(input.name);
    if (!isText(input.label)) throw new Error(`${where}: input ${input.name} needs a label`);
    if (!INPUT_TYPES.includes(input.type)) throw new Error(`${where}: input ${input.name} has an unknown type`);
    if (input.type === "select" && !(Array.isArray(input.options) && input.options.length)) throw new Error(`${where}: select ${input.name} needs options`);
  }
}

const REQUIRED = {
  fact: (f) => isText(f.label) && FACT_TYPES.includes(f.type) && isFn(f.value),
  diagnostic: (f) => isText(f.label) && isFn(f.check) && SEVERITIES.includes(f.severity || "advice") && ["item", "list"].includes(f.scope || "item"),
  transform: (f) => isText(f.label) && (isFn(f.each) !== isFn(f.all)),
  metric: (f) => isText(f.label) && isFn(f.compute) && FORMATS.includes(f.format || "number"),
  exporter: (f) => isText(f.label) && isFn(f.build) && (isText(f.filename) || isFn(f.filename)),
  importer: (f) => isText(f.label) && isFn(f.parse),
  command: (f) => isText(f.title) && isFn(f.run) && (f.keys === undefined || isText(f.keys)) && (f.when === undefined || isFn(f.when)),
  tool: (f) => isText(f.title) && isText(f.group) && isText(f.help) && isFn(f.compute) && Array.isArray(f.inputs),
  panel: (f) => isText(f.title) && isFn(f.render) && Array.isArray(f.improvements) && f.improvements.length > 0
    && f.improvements.every((item) => item && FEATURE_ID.test(item.id || "") && isText(item.title))
    && new Set(f.improvements.map((item) => item.id)).size === f.improvements.length,
  behavior: (f) => isText(f.title) && isText(f.where),
};

// Validates a pack and freezes it. Throws an Error that names the pack and the feature at fault.
export function definePack(pack) {
  if (!pack || typeof pack !== "object") throw new Error("Lab pack: expected an object");
  const where = `Lab pack ${pack.id || "(no id)"}`;
  if (!PACK_ID.test(pack.id || "")) throw new Error(`${where}: id must be lowercase words joined by hyphens`);
  if (!isText(pack.surface)) throw new Error(`${where}: surface is required`);
  if (!isText(pack.title)) throw new Error(`${where}: title is required`);
  if (pack.about !== undefined && !isText(pack.about)) throw new Error(`${where}: about must be text`);
  if (!Array.isArray(pack.features) || !pack.features.length) throw new Error(`${where}: features must be a nonempty array`);
  const seen = new Set();
  for (const feature of pack.features) {
    const at = `${where}, feature ${feature?.id || "(no id)"}`;
    if (!feature || !FEATURE_ID.test(feature.id || "")) throw new Error(`${at}: id must be lowercase words joined by underscores`);
    if (seen.has(feature.id)) throw new Error(`${at}: declared twice`);
    seen.add(feature.id);
    if (!KINDS.includes(feature.kind)) throw new Error(`${at}: unknown kind ${JSON.stringify(feature.kind)}`);
    if (!REQUIRED[feature.kind](feature)) throw new Error(`${at}: a ${feature.kind} is missing a required field or has one of the wrong type`);
    if (feature.kind === "tool") checkInputs(at, feature.inputs);
    if (feature.kind === "transform" && feature.params !== undefined) checkInputs(at, feature.params);
  }
  return Object.freeze({ ...pack, features: Object.freeze(pack.features.map((feature) => Object.freeze({ ...feature }))) });
}

const PREFIX = { diagnostic: "Check: ", transform: "Transform: ", metric: "Metric: ", exporter: "Export: ", importer: "Import: ", command: "Command: ", tool: "Tool: ", behavior: "" };

// Every numbered improvement a pack holds, as { id, title, kind, pack, surface, feature, facet }. A numeric fact is
// three (minimum filter, maximum filter, sort), a flag one, text two (contains filter, sort), a category two (filter,
// breakdown), a panel as many as it lists, and everything else one.
export function improvementsOf(pack) {
  const out = [];
  const add = (feature, suffix, title, facet = null) => out.push({ id: `${pack.id}/${feature.id}${suffix}`, title, kind: feature.kind,
    pack: pack.id, surface: pack.surface, feature: feature.id, facet });
  for (const feature of pack.features) {
    if (feature.kind === "fact") {
      const label = feature.label;
      if (feature.type === "number") {
        add(feature, ".min", `Filter by minimum ${label}`, "min");
        add(feature, ".max", `Filter by maximum ${label}`, "max");
        add(feature, ".sort", `Sort by ${label}, ascending or descending`, "sort");
      } else if (feature.type === "flag") add(feature, "", `Filter by ${label}: with or without`, "flag");
      else if (feature.type === "text") {
        add(feature, ".contains", `Filter by text contained in ${label}`, "contains");
        add(feature, ".sort", `Sort by ${label}, A to Z or Z to A`, "sort");
      } else {
        add(feature, ".is", `Filter by ${label}`, "is");
        add(feature, ".breakdown", `Count the shown items by ${label}`, "breakdown");
      }
    } else if (feature.kind === "panel") {
      for (const item of feature.improvements) add(feature, `.${item.id}`, item.title, item.id);
    } else {
      const keys = feature.kind === "command" && feature.keys ? ` (${feature.keys})` : "";
      add(feature, "", `${PREFIX[feature.kind]}${feature.label || feature.title}${keys}`);
    }
  }
  return out;
}

export const featureKey = (pack, feature) => `${pack.id}/${feature.id}`;

// ---------- small shared helpers ----------

export const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
export const snapshot = (value) => JSON.stringify(value);

// A typed number: plain decimal or exponent notation only. Blank, hex, "Infinity" and stray text give null.
export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function compareText(a, b) {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

// One CSV cell: quoted, with a leading apostrophe on text a spreadsheet would run as a formula.
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const csvText = (rows) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function formatValue(value, format = "number") {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "—";
  if (typeof value !== "number") return String(value);
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  if (format === "integer") return Math.round(value).toLocaleString("en-US");
  if (format === "usd") return `$${Math.abs(value) >= 0.01 || value === 0 ? value.toFixed(2) : value.toPrecision(2)}`;
  if (format === "ms") return `${Math.round(value)} ms`;
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  const magnitude = Math.abs(value);
  return magnitude >= 1000 ? value.toFixed(1) : magnitude >= 0.001 ? String(Number(value.toPrecision(5))) : value.toExponential(3);
}

// ---------- facts: filters, sorting, summaries, table ----------

// A fact's value for one item, normalized by type: number -> finite number or null (unavailable), flag -> boolean,
// text -> string, category -> nonempty string or null. A fact that throws reads as unavailable.
export function factValue(fact, item, ctx) {
  let value;
  try { value = fact.value(item, ctx); } catch { value = null; }
  if (fact.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (fact.type === "flag") return value === true;
  if (fact.type === "text") return value === null || value === undefined ? "" : String(value);
  return value === null || value === undefined || value === "" ? null : String(value);
}

export const filterActive = (filter) => !!filter && (filter.op === "with" || filter.op === "without" || String(filter.value ?? "").trim() !== "");

// Whether an item passes one filter { key, op, value }. A blank value is no filter. An unavailable number never
// satisfies a bound, and a bound that is not a finite number matches nothing. Text matching is literal and ignores case.
export function filterMatches(fact, filter, item, ctx) {
  if (!filterActive(filter)) return true;
  if (!FACT_OPS[fact.type].includes(filter.op)) return false;
  const value = factValue(fact, item, ctx);
  if (filter.op === "min" || filter.op === "max") {
    const bound = toNumber(filter.value);
    if (bound === null || value === null) return false;
    return filter.op === "min" ? value >= bound : value <= bound;
  }
  if (filter.op === "with") return value === true;
  if (filter.op === "without") return value !== true;
  if (filter.op === "contains") return value.toLowerCase().includes(String(filter.value).trim().toLowerCase());
  return value === String(filter.value);
}

// facts: Map of feature key -> fact. Filters that name an unknown fact are ignored.
export function matchesFilters(item, filters, facts, ctx) {
  for (const filter of filters || []) {
    const fact = facts.get(filter.key);
    if (fact && !filterMatches(fact, filter, item, ctx)) return false;
  }
  return true;
}

function sortValue(fact, item, ctx) {
  const value = factValue(fact, item, ctx);
  if (fact.type === "flag") return value ? 1 : 0;
  if (fact.type === "text") return value.trim() === "" ? null : value;
  return value;
}

// A stable sort by one fact, { key, dir: "asc" | "desc" }. Unavailable values go last in both directions and ties
// keep the incoming order. Returns a new array; with no known fact the order is unchanged.
export function sortByFact(items, sort, facts, ctx) {
  const fact = sort && facts.get(sort.key);
  if (!fact) return items.slice();
  const direction = sort.dir === "desc" ? -1 : 1;
  const keyed = items.map((item, index) => ({ item, index, value: sortValue(fact, item, ctx) }));
  keyed.sort((a, b) => {
    const aMissing = a.value === null, bMissing = b.value === null;
    if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
    const order = typeof a.value === "number" ? a.value - b.value : compareText(a.value, b.value);
    return order ? order * direction : a.index - b.index;
  });
  return keyed.map((entry) => entry.item);
}

export function summarizeFact(fact, items, ctx) {
  const values = items.map((item) => factValue(fact, item, ctx));
  if (fact.type === "number") {
    const known = values.filter((value) => value !== null).sort((a, b) => a - b);
    const sum = known.reduce((total, value) => total + value, 0);
    const middle = known.length >> 1;
    const some = known.length > 0;
    return { type: "number", count: known.length, missing: values.length - known.length, min: some ? known[0] : null,
      max: some ? known[known.length - 1] : null, sum: some ? sum : null, mean: some ? sum / known.length : null,
      median: !some ? null : known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2 };
  }
  if (fact.type === "flag") {
    const yes = values.filter(Boolean).length;
    return { type: "flag", with: yes, without: values.length - yes };
  }
  if (fact.type === "text") {
    const filled = values.filter((value) => value.trim() !== "");
    return { type: "text", filled: filled.length, empty: values.length - filled.length, distinct: new Set(filled).size };
  }
  const groups = new Map();
  let missing = 0;
  for (const value of values) {
    if (value === null) missing++;
    else groups.set(value, (groups.get(value) || 0) + 1);
  }
  return { type: "category", groups: [...groups].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])), missing };
}

// The shown items as a table of fact values: { columns, rows }. entries: [[key, fact], ...] in column order.
export function factsTable(entries, items, ctx, name = (item, index) => String(index + 1)) {
  return { columns: ["item", ...entries.map(([, fact]) => fact.label)],
    rows: items.map((item, index) => [name(item, index), ...entries.map(([, fact]) => {
      const value = factValue(fact, item, ctx);
      return value === null ? "" : fact.type === "flag" ? (value ? "yes" : "no") : value;
    })]) };
}

export function describeFilter(fact, filter) {
  const sign = { min: "≥", max: "≤", contains: "contains", is: "is" }[filter.op];
  return sign ? `${fact.label} ${sign} ${String(filter.value).trim()}` : `${filter.op} ${fact.label}`;
}

// ---------- diagnostics ----------

const messagesOf = (result, fallback) => (result === true ? [fallback] : typeof result === "string" ? (result ? [result] : [])
  : Array.isArray(result) ? result.filter((entry) => typeof entry === "string" && entry) : []);

// entries: [[key, diagnostic], ...]. A check returns nothing, true (its label is the message), a message, or
// several messages. Item checks get (item, ctx, index); list checks get (items, ctx). Findings carry a 0-based
// index, or null for list findings. A check that throws reports nothing.
export function runDiagnostics(entries, items, ctx) {
  const findings = [];
  for (const [key, diagnostic] of entries) {
    const push = (index, result) => {
      for (const message of messagesOf(result, diagnostic.label)) findings.push({ key, label: diagnostic.label, severity: diagnostic.severity || "advice", index, message });
    };
    if ((diagnostic.scope || "item") === "list") {
      try { push(null, diagnostic.check(items, ctx)); } catch { /* reports nothing */ }
    } else {
      items.forEach((item, index) => { try { push(index, diagnostic.check(item, ctx, index)); } catch { /* reports nothing */ } });
    }
  }
  return findings;
}

// ---------- typed inputs (tools and transform parameters) ----------

const optionValues = (input) => input.options.map((option) => (Array.isArray(option) ? String(option[0]) : String(option)));

// Reads raw control values into typed parameters, applying defaults. Throws an Error a person can act on.
export function readInputs(inputs, values = {}) {
  const out = {};
  for (const input of inputs || []) {
    const raw = values[input.name] === undefined ? input.default : values[input.name];
    const blank = raw === undefined || raw === null || String(raw).trim() === "";
    if (input.type === "checkbox") { out[input.name] = raw === true || raw === "true" || raw === "on"; continue; }
    if (input.type === "select") {
      const options = optionValues(input);
      const value = blank ? options[0] : String(raw);
      if (!options.includes(value)) throw new Error(`${input.label}: choose one of the listed options.`);
      out[input.name] = value;
      continue;
    }
    if (input.type === "text" || input.type === "textarea") {
      if (blank && input.required) throw new Error(`${input.label} is required.`);
      out[input.name] = blank ? "" : String(raw);
      continue;
    }
    if (blank) {
      if (input.optional) { out[input.name] = null; continue; }
      throw new Error(`${input.label} is required.`);
    }
    const number = toNumber(raw);
    if (number === null) throw new Error(`${input.label} must be a number.`);
    if (input.type === "integer" && !Number.isInteger(number)) throw new Error(`${input.label} must be a whole number.`);
    if (input.min !== undefined && number < input.min) throw new Error(`${input.label} must be at least ${input.min}.`);
    if (input.max !== undefined && number > input.max) throw new Error(`${input.label} must be at most ${input.max}.`);
    out[input.name] = number;
  }
  return out;
}

// ---------- tools ----------

// A tool's compute(params) returns [[label, value], ...] or { rows?, table?: { columns, rows }, text?, note? }.
// The result is normalized to { rows, table, text, note }.
export function runTool(tool, values = {}) {
  const result = tool.compute(readInputs(tool.inputs, values));
  const shaped = Array.isArray(result) ? { rows: result } : (result && typeof result === "object" ? result : {});
  const rows = Array.isArray(shaped.rows) ? shaped.rows : [];
  if (!rows.length && !shaped.table && typeof shaped.text !== "string") throw new Error(`${tool.title} returned no result.`);
  return { rows, table: shaped.table || null, text: typeof shaped.text === "string" ? shaped.text : null, note: shaped.note || null };
}

// ---------- transforms ----------

// A transform has each(item, params, ctx, index) -> changed item (or null/undefined for unchanged), applied to the
// shown items only, or all(items, params, ctx, shownIndexes) -> the whole next list. Both get copies and must be pure.
// shownIndexes: a Set of positions in items. The preview binds to the list as it is now.
export function previewTransform(key, transform, items, shownIndexes, values, ctx) {
  const params = readInputs(transform.params || [], values);
  let next;
  if (transform.each) {
    if (!shownIndexes.size) throw new Error("Nothing is shown to change.");
    next = items.map((item, index) => {
      if (!shownIndexes.has(index)) return item;
      const changed = transform.each(clone(item), params, ctx, index);
      return changed === null || changed === undefined ? item : changed;
    });
  } else {
    next = transform.all(clone(items), params, ctx, new Set(shownIndexes));
    if (!Array.isArray(next)) throw new Error(`${transform.label} returned no list.`);
  }
  next = clone(next);
  const changed = [];
  for (let index = 0; index < Math.min(items.length, next.length); index++) {
    if (snapshot(items[index]) !== snapshot(next[index])) changed.push(index + 1);
  }
  return { key, label: transform.label, before: snapshot(items), next, changed, was: items.length, now: next.length };
}

export const previewChanges = (preview) => preview.changed.length > 0 || preview.was !== preview.now;

export function describePreview(preview) {
  const parts = [];
  if (preview.changed.length) parts.push(`${preview.changed.length} item${preview.changed.length === 1 ? "" : "s"} would change (positions ${preview.changed.slice(0, 20).join(", ")}${preview.changed.length > 20 ? ", …" : ""})`);
  if (preview.now !== preview.was) parts.push(`the list would go from ${preview.was} to ${preview.now} item${preview.now === 1 ? "" : "s"}`);
  return parts.length ? `${preview.label}: ${parts.join("; ")}.` : `${preview.label}: nothing would change.`;
}

// Apply a preview to the list it was made from. Returns the next items and a one-step undo record.
export function applyTransform(preview, items) {
  if (!preview || preview.before !== snapshot(items)) throw new Error("The list changed after the preview. Preview again.");
  return { items: clone(preview.next), undo: { label: preview.label, before: clone(items), after: snapshot(preview.next) } };
}

export function undoTransform(undo, items) {
  if (!undo || undo.after !== snapshot(items)) throw new Error("The list changed after this edit. Undo would replace newer edits.");
  return clone(undo.before);
}

// ---------- metrics, exporters, importers ----------

// entries: [[key, metric], ...]. compute(ctx) returns a number, text, null (not available) or { value, detail }.
export function runMetrics(entries, ctx) {
  return entries.map(([key, metric]) => {
    try {
      const result = metric.compute(ctx);
      const shaped = result && typeof result === "object" ? result : { value: result };
      const value = shaped.value === undefined ? null : shaped.value;
      return { key, label: metric.label, value, text: formatValue(value, metric.format || "number"), detail: shaped.detail || "", help: metric.help || "" };
    } catch (error) {
      return { key, label: metric.label, value: null, text: "—", detail: `Could not compute: ${error.message}`, help: metric.help || "" };
    }
  });
}

export function runExporter(exporter, ctx) {
  const text = exporter.build(ctx);
  if (typeof text !== "string") throw new Error(`${exporter.label} produced no text.`);
  const filename = isFn(exporter.filename) ? exporter.filename(ctx) : exporter.filename;
  return { filename: String(filename), mime: exporter.mime || "text/plain", text };
}

// parse(text, ctx) returns items or { items, warnings }. Throws an Error for text it cannot read.
export function runImporter(importer, text, ctx) {
  const result = importer.parse(String(text ?? ""), ctx);
  const shaped = Array.isArray(result) ? { items: result } : result;
  if (!shaped || !Array.isArray(shaped.items)) throw new Error(`${importer.label} found nothing to import.`);
  return { items: shaped.items, warnings: Array.isArray(shaped.warnings) ? shaped.warnings : [] };
}

// ---------- commands ----------

// entries: [[key, command, ctx], ...]. Every word of the query must appear in the title or group; commands whose
// when(ctx) is false are left out. Title-prefix matches come first, then word starts, then the rest; ties keep order.
export function searchCommands(entries, query = "") {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = [];
  entries.forEach((entry, index) => {
    const [, command, ctx] = entry;
    let available = true;
    try { available = !command.when || command.when(ctx) !== false; } catch { available = false; }
    if (!available) return;
    const title = command.title.toLowerCase();
    const haystack = `${title} ${String(command.group || "").toLowerCase()}`;
    if (!words.every((word) => haystack.includes(word))) return;
    const rank = !words.length ? 2 : title.startsWith(words[0]) ? 0 : words.every((word) => new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) ? 1 : 2;
    ranked.push({ entry, index, rank });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((item) => item.entry);
}

const MODIFIERS = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

// "Mod+Shift+K" -> { key: "k", mod, ctrl, meta, alt, shift }. Mod is Ctrl or Cmd. One chord, no sequences.
export function parseKeys(keys) {
  const parts = String(keys || "").split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts[parts.length - 1];
  const flags = parts.slice(0, -1);
  if (MODIFIERS.includes(key) || flags.some((flag) => !MODIFIERS.includes(flag))) return null;
  return { key: key.length === 1 ? key.toLowerCase() : key, mod: flags.includes("Mod"), ctrl: flags.includes("Ctrl"), meta: flags.includes("Meta"),
    alt: flags.includes("Alt"), shift: flags.includes("Shift"), bare: !flags.some((flag) => flag !== "Shift") };
}

// Whether a keydown event is exactly this chord. A one-character symbol such as "?" matches whatever Shift state
// the keyboard layout needs to type it.
export function keysMatch(event, keys) {
  const chord = typeof keys === "string" ? parseKeys(keys) : keys;
  if (!chord || !event || typeof event.key !== "string") return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key !== chord.key) return false;
  const ctrl = !!event.ctrlKey, meta = !!event.metaKey;
  if (chord.mod ? !(ctrl || meta) : (ctrl !== chord.ctrl || meta !== chord.meta)) return false;
  if (!!event.altKey !== chord.alt) return false;
  const symbol = chord.key.length === 1 && !/[a-z0-9]/.test(chord.key);
  return symbol || !!event.shiftKey === chord.shift;
}

// Typing targets swallow chords that have no Ctrl, Cmd or Alt, so a shortcut never eats a typed character.
export function typingTarget(target) {
  const tag = String(target?.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable === true;
}
