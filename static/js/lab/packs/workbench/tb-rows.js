// Toolbox converters and inspectors for Bulk rows and delimited tables ("workbench.toolbox", group "Rows and tables").
// Bulk rows are read the way the Workbench reads its rows box: one row per nonempty line, a line that is a JSON object
// is that object, and any other line is text. Labels sit under "_expect", held-out rows carry "_test": true and
// pictures "_image". Every tool reads only the text pasted into its form, runs locally and returns text to copy or a
// table; nothing reads page data, sends anything or calls the model. Tools that move or drop labels say so, rows a
// tool did not change are copied as they were, and no tool invents a label or chooses between conflicting ones.
import { compareText, definePack } from "../../kit.js";
import { duplicateKeys, omit, stableStringify } from "../../lib/json.js";
import { cellText, formatDelimited, formatMarkdownTable, parseDelimited, parseMarkdownTable, sniffDelimiter, transpose } from "../../lib/tables.js";
import { truncate } from "../../lib/text.js";

const GROUP = "Rows and tables";
const LABELS = "_expect";
const TEST = "_test";
const IMAGE = "_image";
const META = new Set([LABELS, TEST]);
const RESERVED = new Set([LABELS, TEST, IMAGE]);
const SAMPLES = ["torn-bag", "intact-bag", "crushed-box", "grinder-ok"];
const SAVED_PICTURE = /^[0-9a-f]{16}\.(?:png|jpg)$/;
const YES = new Set(["yes", "true", "y", "1"]);
const NO = new Set(["no", "false", "n", "0"]);
const LABEL_PREFIXES = ["label:", "expect:", "_expect."];
const DELIMS = { comma: ",", tab: "\t", semicolon: ";", pipe: "|" };
const DELIM_NAMES = { ",": "comma", "\t": "tab", ";": "semicolon", "|": "pipe" };

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

function setOwn(object, key, value) {
  if (key === "__proto__") Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
  else object[key] = value;
}

function tryJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, value: undefined }; }
}

// ---------- inputs ----------

const ROWS = (name = "rows", label = "Rows (one per line: a JSON object or text)") => ({ name, label, type: "textarea", required: true,
  placeholder: '{"text": "My order never arrived.", "_expect": {"department": "shipping"}}' });
const TABLE = { name: "table", label: "Table (first line is the header)", type: "textarea", required: true, placeholder: "text,label:department\nWhere is my parcel?,shipping" };
const MARKDOWN = { name: "markdown", label: "Markdown table", type: "textarea", required: true, placeholder: "| text | label:department |\n| --- | --- |\n| Where is my parcel? | shipping |" };
const READ_DELIM = { name: "delimiter", label: "Delimiter", type: "select", default: "auto",
  options: [["auto", "Detect"], ["comma", "Comma"], ["tab", "Tab"], ["semicolon", "Semicolon"], ["pipe", "Pipe"]] };
const WRITE_DELIM = (name = "output", label = "Write with") => ({ name, label, type: "select", default: "comma",
  options: [["comma", "Comma (CSV)"], ["tab", "Tab (TSV)"], ["semicolon", "Semicolon"], ["pipe", "Pipe"]] });
const FIELD = (name = "field", label = "Field", extra = {}) => ({ name, label, type: "text", required: true, ...extra });

// ---------- Bulk rows ----------

// The rows of Bulk's rows box: { line (1-based, counting blank lines), text (the trimmed line), row (object or text) }.
function parseRows(text) {
  const out = [];
  String(text ?? "").split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    let row = line;
    if (line.startsWith("{")) {
      const parsed = tryJson(line);
      if (parsed.ok && isRecord(parsed.value)) row = parsed.value;
    }
    out.push({ line: index + 1, text: line, row });
  });
  if (!out.length) throw new Error("Paste at least one row.");
  return out;
}

const inputOf = (row) => (isRecord(row) ? omit(row, [LABELS, TEST]) : row);
const labelsOf = (row) => (isRecord(row) && isRecord(row[LABELS]) ? row[LABELS] : null);
const heldOut = (row) => isRecord(row) && row[TEST] === true;
// The identity dataset health and Review use: labels and test markers ignored, field order ignored, pictures kept, and
// a text row the same input as an object row whose only field is "text" (Bulk sends it that way).
const identity = (row) => stableStringify(isRecord(row) ? inputOf(row) : { text: row });
const preview = (row) => truncate(isRecord(row) ? JSON.stringify(inputOf(row)) : row, 60);
const shown = (value) => (typeof value === "string" ? value : stableStringify(value));

// An object row from its input fields, its labels (left out when empty) and the row's own _test value (kept as it was).
function assemble(row, input, labels) {
  const out = {};
  for (const key of Object.keys(input)) setOwn(out, key, input[key]);
  if (labels && Object.keys(labels).length) out[LABELS] = labels;
  if (isRecord(row) && hasOwn(row, TEST)) out[TEST] = row[TEST];
  return out;
}

const jsonl = (lines) => lines.map((line) => `${line}\n`).join("");
const oneLine = (text) => String(text).replace(/\s*(?:\r\n|\r|\n)\s*/g, " ").trim();
const readsAsObject = (text) => text.startsWith("{") && isRecord(tryJson(text).value);
const objectWarning = (count) => (count ? ` ${plural(count, "row starts", "rows start")} with { and would be read as a JSON object.` : "");

function fieldName(value, what = "Field") {
  const name = String(value).trim();
  if (!name) throw new Error(`${what} is required.`);
  if (RESERVED.has(name)) throw new Error(`${what} cannot be ${name}: it is not an input field.`);
  return name;
}

// A field's value on a row; "_expect.<question>" reads a label and "_test" the held-out marker. undefined when missing.
function valueAt(row, field) {
  if (!isRecord(row)) return undefined;
  if (field.startsWith(`${LABELS}.`)) {
    const labels = labelsOf(row), question = field.slice(LABELS.length + 1);
    return labels && hasOwn(labels, question) ? labels[question] : undefined;
  }
  return hasOwn(row, field) ? row[field] : undefined;
}

// ---------- tables ----------

function readTable(text, choice) {
  const delimiter = choice === "auto" ? sniffDelimiter(text) : DELIMS[choice];
  const rows = parseDelimited(text, delimiter).filter((row) => !(row.length === 1 && row[0].trim() === ""));
  if (!rows.length) throw new Error("Paste a table with a header line.");
  return { delimiter, header: rows[0], body: rows.slice(1), all: rows };
}

// A label cell: true and false (any case) become booleans and everything else stays text, so a Choice option key such
// as "2" stays a valid key; the Workbench reads a Score level from text ("2") as well as from a number.
function labelFromCell(cell) {
  const text = cell.trim();
  if (!text) return undefined;
  if (text.toLowerCase() === "true") return true;
  if (text.toLowerCase() === "false") return false;
  return text;
}

// A column's use from its trimmed header: a label (label:<id>, expect:<id>, _expect.<id>), the _test marker, or a field.
function roleOf(name) {
  const low = name.toLowerCase();
  for (const prefix of LABEL_PREFIXES) {
    const question = name.slice(prefix.length).trim();
    if (low.startsWith(prefix) && question) return { label: question };
  }
  if (name === TEST) return { test: true };
  if (name === LABELS) throw new Error("A column named _expect is not supported: name each label column label:<question id>.");
  return { field: name };
}

// Column names as the Workbench's CSV import gives them: trimmed, column_N (1-based) for a blank one, and name_2,
// name_3 for a repeated one.
function columnNames(header) {
  const taken = new Set();
  return header.map((raw, index) => {
    const base = String(raw).trim() || `column_${index + 1}`;
    let name = base;
    for (let number = 2; taken.has(name); number += 1) name = `${base}_${number}`;
    taken.add(name);
    return name;
  });
}

// Table rows as Bulk object rows: label:<id>, expect:<id> and _expect.<id> columns become labels (true/false typed,
// other values text), a _test column of yes/true/y/1 marks a held-out row, every other column is an input field, and
// empty input cells are left out. A row with no input field is left out, and cells past the header are dropped (and
// counted), as the Workbench's CSV import does.
function tableToRows(header, body, breaks = false) {
  if (!body.length) throw new Error("The table has a header but no rows.");
  const names = columnNames(header);
  const roles = header.map((cell) => roleOf(String(cell).trim()));
  const targets = roles.filter((role) => role.label).map((role) => role.label);
  const twice = targets.find((target, index) => targets.indexOf(target) !== index);
  if (twice !== undefined) throw new Error(`Two columns label ${JSON.stringify(twice)}; keep one.`);
  if (roles.filter((role) => role.test).length > 1) throw new Error("Two columns are named _test; keep one.");
  const rows = [];
  let skipped = 0, badTest = 0, overflow = 0;
  for (const cells of body) {
    if (cells.slice(header.length).some((cell) => String(cell).trim() !== "")) overflow += 1;
    const input = {}, labels = {};
    let test = false;
    names.forEach((name, index) => {
      const raw = String(cells[index] ?? "");
      const cell = breaks ? raw.replace(/<br\s*\/?>/gi, "\n") : raw;
      const role = roles[index];
      if (role.field !== undefined) { if (cell.trim() !== "") setOwn(input, name, cell); }
      else if (role.label !== undefined) {
        const value = labelFromCell(cell);
        if (value !== undefined) setOwn(labels, role.label, value);
      } else {
        const low = cell.trim().toLowerCase();
        if (YES.has(low)) test = true;
        else if (low && !NO.has(low)) badTest += 1;
      }
    });
    if (!Object.keys(input).length) { skipped += 1; continue; }
    const row = assemble(null, input, labels);
    if (test) row[TEST] = true;
    rows.push(row);
  }
  if (!rows.length) throw new Error("No row has anything for the model to read.");
  const labeled = rows.filter((row) => hasOwn(row, LABELS)).length, held = rows.filter((row) => row[TEST] === true).length;
  const note = `${plural(rows.length, "row")}: ${labeled} labeled, ${held} held out.`
    + (skipped ? ` ${plural(skipped, "row")} with nothing for the model to read left out.` : "")
    + (overflow ? ` ${plural(overflow, "row")} had cells past the header, which were left out.` : "")
    + (badTest ? ` ${plural(badTest, "_test cell")} that ${badTest === 1 ? "was" : "were"} not yes or no ignored.` : "");
  return { text: jsonl(rows.map((row) => JSON.stringify(row))), note };
}

// Bulk rows as table columns: input fields (text rows in a "text" column), label:<id> per question, then _test.
function rowsToTable(entries) {
  const fields = [], questions = [];
  const seenField = new Set(), seenQuestion = new Set();
  let anyTest = false, badLabels = 0;
  const addField = (name) => { if (!seenField.has(name)) { seenField.add(name); fields.push(name); } };
  for (const { row } of entries) {
    if (!isRecord(row)) { addField("text"); continue; }
    for (const key of Object.keys(row)) if (!META.has(key)) addField(key);
    const labels = labelsOf(row);
    if (hasOwn(row, LABELS) && !labels) badLabels += 1;
    for (const question of Object.keys(labels || {})) if (!seenQuestion.has(question)) { seenQuestion.add(question); questions.push(question); }
    if (heldOut(row)) anyTest = true;
  }
  const columns = [...fields, ...questions.map((question) => `label:${question}`), ...(anyTest ? [TEST] : [])];
  const cells = entries.map(({ row }) => {
    if (!isRecord(row)) return columns.map((column) => (column === "text" ? row : ""));
    const labels = labelsOf(row) || {};
    return [...fields.map((field) => (hasOwn(row, field) ? cellText(row[field]) : "")),
      ...questions.map((question) => (hasOwn(labels, question) ? cellText(labels[question]) : "")),
      ...(anyTest ? [heldOut(row) ? "true" : ""] : [])];
  });
  const note = `${plural(entries.length, "row")}, ${plural(columns.length, "column")}.`
    + (badLabels ? ` ${plural(badLabels, "row")} whose _expect is not an object ${badLabels === 1 ? "was" : "were"} written without labels.` : "");
  return { columns, cells, note };
}

function findColumn(header, name) {
  const wanted = String(name).trim();
  const exact = header.findIndex((cell) => cell.trim() === wanted);
  if (exact !== -1) return exact;
  const folded = header.flatMap((cell, index) => (cell.trim().toLowerCase() === wanted.toLowerCase() ? [index] : []));
  if (folded.length === 1) return folded[0];
  throw new Error(`No column named ${JSON.stringify(wanted)}. Columns: ${header.join(", ")}.`);
}

function sameLabels(a, b) {
  return stableStringify(a[LABELS] ?? null) === stableStringify(b[LABELS] ?? null) && stableStringify(a[TEST] ?? null) === stableStringify(b[TEST] ?? null);
}

function groupsOf(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = identity(entry.row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

const recordOf = (row) => (isRecord(row) ? row : {});

function compareValues(a, b) {
  const an = typeof a === "number", bn = typeof b === "number";
  if (an && bn) return a - b;
  if (an !== bn) return an ? -1 : 1;
  return compareText(shown(a), shown(b));
}

function listFields(text) {
  const names = String(text).split(/[,\n]/).map((name) => name.trim()).filter(Boolean);
  if (!names.length) throw new Error("Name at least one field.");
  for (const name of names) if (META.has(name)) throw new Error(`${name} holds labels or markers: use "Strip labels and test markers" instead.`);
  return [...new Set(names)];
}

// Why a label does not fit its question, or null when it fits (null is no label). On a held-out row the message
// names the label as "The label" instead of showing its value.
function labelProblem(question, value, hidden = false) {
  if (value === null) return null;
  const { type, criteria } = question;
  const shownValue = hidden ? "The label" : JSON.stringify(value);
  if (type === "choice") {
    const options = isRecord(criteria) ? Object.keys(criteria) : [];
    return typeof value === "string" && options.includes(value) ? null : `${shownValue} is not one of the options: ${options.join(", ")}`;
  }
  if (type === "noul") {
    if (typeof value === "boolean") return null;
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim().toLowerCase() : "";
    return YES.has(text) || NO.has(text) ? null : `${shownValue} is not yes or no`;
  }
  if (type === "score") {
    const levels = Array.isArray(criteria) ? criteria.length : 0;
    const number = typeof value === "number" ? value : typeof value === "string" && /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s*$/i.test(value) ? Number(value) : null;
    return number !== null && Number.isInteger(number) && number >= 0 && number < levels ? null
      : `${shownValue} is not a level number from 0 to ${levels - 1}`;
  }
  if (type === "box") {
    const edges = ["left", "top", "right", "bottom"];
    const fine = isRecord(value) && edges.every((edge) => typeof value[edge] === "number" && value[edge] >= 0 && value[edge] <= 1)
      && value.left < value.right && value.top < value.bottom;
    return fine ? null : "A Box label needs left, top, right and bottom from 0 to 1, with left < right and top < bottom";
  }
  return `the question's type ${JSON.stringify(type)} is not noul, choice, score or box`;
}

export default definePack({
  id: "tb-rows",
  surface: "workbench.toolbox",
  title: "Row and table converters",
  about: "Thirty-two converters and inspectors for Bulk rows and pasted tables: CSV, TSV, Markdown and JSON arrays to rows and back, moving labels in and out, deduplicating by input, splitting and counting. They work on the pasted text only, never invent or choose between labels, never show a held-out row's label values in a report, and send nothing anywhere.",
  features: [
    // ---------- tables to rows ----------
    { id: "table_to_rows", kind: "tool", group: GROUP, title: "Delimited table to object rows",
      help: "CSV, TSV, semicolon or pipe text to Bulk rows: every column becomes a field the model reads, except label:<id> (or expect:<id>, _expect.<id>) columns, which become labels under _expect (true and false as booleans, other values as text), and a _test column, where yes marks a held-out row. Empty cells are left out.",
      inputs: [TABLE, READ_DELIM],
      compute: ({ table, delimiter }) => {
        const read = readTable(table, delimiter);
        const out = tableToRows(read.header, read.body);
        return { text: out.text, note: `Read as ${DELIM_NAMES[read.delimiter]}-separated. ${out.note}` };
      } },
    { id: "column_to_text_rows", kind: "tool", group: GROUP, title: "Table column to text rows",
      help: "One column of a CSV, TSV, semicolon or pipe table as Bulk text rows, one per line. Line breaks inside a cell become spaces and blank cells are skipped. Text rows cannot carry labels.",
      inputs: [TABLE, READ_DELIM, FIELD("column", "Column with the text", { default: "text" })],
      compute: ({ table, delimiter, column }) => {
        const read = readTable(table, delimiter);
        const index = findColumn(read.header, column);
        const lines = [];
        let blank = 0;
        for (const row of read.body) {
          const text = oneLine(row[index] ?? "");
          if (text) lines.push(text); else blank += 1;
        }
        if (!lines.length) throw new Error(`Column ${read.header[index]} has no text.`);
        return { text: jsonl(lines), note: `${plural(lines.length, "text row")}.${blank ? ` ${plural(blank, "blank cell")} skipped.` : ""}${objectWarning(lines.filter(readsAsObject).length)}` };
      } },
    { id: "rows_to_table", kind: "tool", group: GROUP, title: "Rows to CSV with labels as columns",
      help: "Bulk rows as a table: one column per input field (text rows in a text column), one label:<id> column per question, and a _test column when rows are held out. Nested values are JSON text, and text a spreadsheet would run as a formula gets a leading apostrophe.",
      inputs: [ROWS(), WRITE_DELIM()],
      compute: ({ rows, output }) => {
        const table = rowsToTable(parseRows(rows));
        return { text: formatDelimited([table.columns, ...table.cells], DELIMS[output]), note: table.note };
      } },
    { id: "markdown_to_rows", kind: "tool", group: GROUP, title: "Markdown table to object rows",
      help: "A Markdown pipe table to Bulk rows, with the same column rules as the delimited table converter: label:<id> columns become labels, _test marks held-out rows, and <br> becomes a line break.",
      inputs: [MARKDOWN],
      compute: ({ markdown }) => {
        const parsed = parseMarkdownTable(markdown);
        if (!parsed) throw new Error("This is not a Markdown table: every line needs pipes, and a header line comes first.");
        return tableToRows(parsed.columns, parsed.rows, true);
      } },
    { id: "rows_to_markdown", kind: "tool", group: GROUP, title: "Rows to a Markdown table",
      help: "Bulk rows as a Markdown pipe table for a ticket or a doc, with the same columns as the CSV export: input fields, label:<id> per question, and _test.",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const table = rowsToTable(parseRows(rows));
        return { text: formatMarkdownTable(table.columns, table.cells), note: table.note };
      } },

    // ---------- JSON and plain text ----------
    { id: "json_array_to_rows", kind: "tool", group: GROUP, title: "JSON array to rows",
      help: "A JSON array as Bulk rows: objects become object rows, strings become text rows (line breaks become spaces), and numbers and true/false become text. null, nested arrays and blank strings are skipped.",
      inputs: [{ name: "json", label: "JSON array", type: "textarea", required: true, placeholder: '[{"text": "Where is my order?"}, "Refund please"]' }],
      compute: ({ json }) => {
        const parsed = tryJson(json);
        if (!parsed.ok) throw new Error("This is not valid JSON.");
        if (!Array.isArray(parsed.value)) throw new Error("Paste a JSON array: [ ... ].");
        const lines = [], skipped = [];
        let texts = 0, objectLike = 0;
        parsed.value.forEach((item, index) => {
          if (isRecord(item)) lines.push(JSON.stringify(item));
          else if (typeof item === "string" && oneLine(item)) {
            lines.push(oneLine(item));
            texts += 1;
            if (readsAsObject(oneLine(item))) objectLike += 1;
          }
          else if (typeof item === "number" || typeof item === "boolean") { lines.push(String(item)); texts += 1; }
          else skipped.push(index + 1);
        });
        if (!lines.length) throw new Error("The array holds no objects or text.");
        return { text: jsonl(lines), note: `${plural(lines.length, "row")} (${texts} text).${skipped.length ? ` Skipped positions ${skipped.join(", ")}.` : ""}${objectWarning(objectLike)}` };
      } },
    { id: "rows_to_json_array", kind: "tool", group: GROUP, title: "Rows to a JSON array",
      help: "Bulk rows as one indented JSON array: object rows as objects with their labels, text rows as strings.",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const entries = parseRows(rows);
        return { text: JSON.stringify(entries.map((entry) => entry.row), null, 2), note: `${plural(entries.length, "row")}.` };
      } },
    { id: "text_rows_to_objects", kind: "tool", group: GROUP, title: "Text rows to object rows under a field",
      help: "Wraps every text row (a plain line) in an object under the field you name, so it can carry labels. Object rows are kept as they are.",
      inputs: [ROWS("rows", "Rows or plain lines"), FIELD("field", "Field name", { default: "text" })],
      compute: ({ rows, field }) => {
        const name = fieldName(field, "Field name");
        let wrapped = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          if (isRecord(row)) return text;
          wrapped += 1;
          const object = {};
          setOwn(object, name, row);
          return JSON.stringify(object);
        });
        return { text: jsonl(lines), note: `${plural(wrapped, "text row")} wrapped; ${plural(lines.length - wrapped, "object row")} kept.` };
      } },
    { id: "paragraphs_to_rows", kind: "tool", group: GROUP, title: "Paragraphs to text rows",
      help: "Text where blank lines separate the items (emails, notes) as one text row per paragraph, with the paragraph's lines joined by spaces.",
      inputs: [{ name: "text", label: "Paragraphs", type: "textarea", required: true }],
      compute: ({ text }) => {
        const lines = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean).join(" ")).filter(Boolean);
        return { text: jsonl(lines), note: `${plural(lines.length, "text row")}.${objectWarning(lines.filter(readsAsObject).length)}` };
      } },

    // ---------- labels ----------
    { id: "field_to_label", kind: "tool", group: GROUP, title: "Move a field into labels",
      help: "Moves a field of every object row under _expect as a question's label, so the model stops reading it. A blank field is removed without a label, and a row that already has a different label for the question is left as it was.",
      inputs: [ROWS(), FIELD("field", "Field to move"), { name: "question", label: "Question id (blank: the field's name)", type: "text" }],
      compute: ({ rows, field, question }) => {
        const name = fieldName(field);
        const qid = question.trim() || name;
        let moved = 0, conflicts = 0, missing = 0, emptied = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          if (!isRecord(row) || !hasOwn(row, name) || (hasOwn(row, LABELS) && !isRecord(row[LABELS]))) { missing += 1; return text; }
          const value = row[name];
          const labels = { ...(labelsOf(row) || {}) };
          const blank = value === null || (typeof value === "string" && value.trim() === "");
          if (!blank && hasOwn(labels, qid) && stableStringify(labels[qid]) !== stableStringify(value)) { conflicts += 1; return text; }
          if (!blank) { setOwn(labels, qid, value); moved += 1; }
          const input = omit(inputOf(row), [name]);
          if (!Object.keys(input).length) emptied += 1;
          return JSON.stringify(assemble(row, input, labels));
        });
        return { text: jsonl(lines), note: `${plural(moved, "value")} moved to ${LABELS}.${qid}.`
          + (conflicts ? ` ${plural(conflicts, "row")} with a different label left as ${conflicts === 1 ? "it was" : "they were"}.` : "")
          + (missing ? ` ${plural(missing, "row")} without the field.` : "")
          + (emptied ? ` ${plural(emptied, "row")} now ${emptied === 1 ? "has" : "have"} nothing for the model to read.` : "") };
      } },
    { id: "label_to_field", kind: "tool", group: GROUP, title: "Move a label out into a field",
      help: "Moves one question's label from _expect into an input field, for example to share labeled rows as a plain table. A row whose field already holds a different value is left as it was. The model would read the field.",
      inputs: [ROWS(), FIELD("question", "Question id"), { name: "field", label: "Field name (blank: the question id)", type: "text" }],
      compute: ({ rows, question, field }) => {
        const qid = question.trim();
        const name = fieldName(field.trim() || qid);
        let moved = 0, conflicts = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          const labels = labelsOf(row);
          if (!labels || !hasOwn(labels, qid)) return text;
          if (hasOwn(row, name) && stableStringify(row[name]) !== stableStringify(labels[qid])) { conflicts += 1; return text; }
          const input = { ...inputOf(row) };
          setOwn(input, name, labels[qid]);
          moved += 1;
          return JSON.stringify(assemble(row, input, omit(labels, [qid])));
        });
        return { text: jsonl(lines), note: `${plural(moved, "label")} moved to the field ${name}.${conflicts ? ` ${plural(conflicts, "row")} whose field differs left as ${conflicts === 1 ? "it was" : "they were"}.` : ""}` };
      } },
    { id: "rename_label", kind: "tool", group: GROUP, title: "Rename a label's question id in rows",
      help: "Renames one question's labels under _expect, keeping their order, for example after renaming the question in Build. A row that already has a label under the new id is left as it was.",
      inputs: [ROWS(), FIELD("from", "Current question id"), FIELD("to", "New question id")],
      compute: ({ rows, from, to }) => {
        const [old, next] = [from.trim(), to.trim()];
        if (old === next) throw new Error("The new id is the same as the current one.");
        let renamed = 0, conflicts = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          const labels = labelsOf(row);
          if (!labels || !hasOwn(labels, old)) return text;
          if (hasOwn(labels, next)) { conflicts += 1; return text; }
          const out = {};
          for (const key of Object.keys(labels)) setOwn(out, key === old ? next : key, labels[key]);
          const copy = { ...row };
          copy[LABELS] = out;
          renamed += 1;
          return JSON.stringify(copy);
        });
        return { text: jsonl(lines), note: `${plural(renamed, "label")} renamed.${conflicts ? ` ${plural(conflicts, "row")} already labeled under ${next} left as ${conflicts === 1 ? "it was" : "they were"}.` : ""}` };
      } },
    { id: "strip_labels", kind: "tool", group: GROUP, title: "Strip labels and test markers for sharing",
      help: "Removes _expect labels and _test markers from every row, so the inputs can be shared or labeled blind by someone else. Optionally removes picture names too. Text rows are unchanged.",
      inputs: [ROWS(), { name: "pictures", label: "Also remove picture names (_image)", type: "checkbox" }],
      compute: ({ rows, pictures }) => {
        const counts = { [LABELS]: 0, [TEST]: 0, [IMAGE]: 0 };
        const keys = pictures ? [LABELS, TEST, IMAGE] : [LABELS, TEST];
        const lines = parseRows(rows).map(({ row, text }) => {
          if (!isRecord(row) || !keys.some((key) => hasOwn(row, key))) return text;
          for (const key of keys) if (hasOwn(row, key)) counts[key] += 1;
          return JSON.stringify(omit(row, keys));
        });
        return { text: jsonl(lines), note: `Labels removed from ${plural(counts[LABELS], "row")}, test markers from ${counts[TEST]}${pictures ? `, picture names from ${counts[IMAGE]}` : ""}.` };
      } },
    { id: "join_labels", kind: "tool", group: GROUP, title: "Copy labels onto rows with the same input",
      help: "Adds labels from a labeled set to the rows whose input is the same (labels, test markers and field order ignored; a text row matches an object whose only field is text, and gets that form when it receives labels). Existing labels are never replaced, and an input whose labeled copies disagree gives no labels.",
      inputs: [ROWS("rows", "Rows to label"), ROWS("labeled", "Labeled rows to copy from")],
      compute: ({ rows, labeled }) => {
        const source = new Map();
        for (const { row } of parseRows(labeled)) {
          const labels = Object.fromEntries(Object.entries(labelsOf(row) || {}).filter(([, value]) => value !== null));
          if (!Object.keys(labels).length) continue;
          const key = identity(row);
          if (!source.has(key)) source.set(key, labels);
          else if (source.get(key) && stableStringify(source.get(key)) !== stableStringify(labels)) source.set(key, null);
        }
        let given = 0, added = 0, kept = 0, unmatched = 0, conflicting = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          const key = identity(row);
          if (!source.has(key)) { unmatched += 1; return text; }
          const labels = source.get(key);
          if (!labels) { conflicting += 1; return text; }
          if (isRecord(row) && hasOwn(row, LABELS) && !isRecord(row[LABELS])) return text;
          const own = { ...(labelsOf(row) || {}) };
          let count = 0;
          for (const question of Object.keys(labels)) {
            if (!hasOwn(own, question)) { setOwn(own, question, labels[question]); count += 1; }
            else if (stableStringify(own[question]) !== stableStringify(labels[question])) kept += 1;
          }
          if (!count) return text;
          given += 1; added += count;
          return JSON.stringify(assemble(row, isRecord(row) ? inputOf(row) : { text: row }, own));
        });
        return { text: jsonl(lines), note: `${plural(added, "label")} added to ${plural(given, "row")}.`
          + (kept ? ` ${plural(kept, "existing label")} kept where the labeled set differs.` : "") + (unmatched ? ` ${plural(unmatched, "row")} with no match.` : "")
          + (conflicting ? ` ${plural(conflicting, "row")} whose labeled copies disagree left alone.` : "") };
      } },
    { id: "check_labels", kind: "tool", group: GROUP, title: "Check row labels against questions",
      help: "Lists every label that does not fit its question, by the Workbench's label rules: an unknown question id, a Choice label that is not an option key, a Noul label that is not yes or no, a Score label that is not a level number, or a Box label without valid edges. A null label is no label, and problems on held-out rows never show the label's value.",
      inputs: [ROWS(), { name: "questions", label: "Questions (JSON object keyed by question id)", type: "textarea", required: true }],
      compute: ({ rows, questions }) => {
        const parsed = tryJson(questions);
        if (!parsed.ok || !isRecord(parsed.value) || !Object.values(parsed.value).every(isRecord)) throw new Error("Questions must be a JSON object of question objects keyed by id.");
        const problems = [];
        let checked = 0;
        for (const { row, line } of parseRows(rows)) {
          if (!isRecord(row) || !hasOwn(row, LABELS)) continue;
          if (!isRecord(row[LABELS])) { problems.push([line, "", "_expect is not an object keyed by question id"]); continue; }
          for (const [qid, value] of Object.entries(row[LABELS])) {
            if (value === null) continue;
            checked += 1;
            const problem = hasOwn(parsed.value, qid) ? labelProblem(parsed.value[qid], value, heldOut(row)) : "No question has this id";
            if (problem) problems.push([line, qid, problem]);
          }
        }
        return { rows: [["Labels checked", checked], ["Problems", problems.length]], table: { columns: ["line", "question", "problem"], rows: problems } };
      } },

    // ---------- inspecting ----------
    { id: "count_rows", kind: "tool", group: GROUP, title: "Count rows, fields and labels",
      help: "Counts pasted Bulk rows the way the rows box reads them: text and object rows, labeled and held-out rows, pictures, distinct input fields, and lines that start with { but are not valid JSON (read as text).",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const entries = parseRows(rows);
        const objects = entries.filter((entry) => isRecord(entry.row));
        const fields = new Set();
        let labels = 0, labeled = 0;
        for (const { row } of objects) {
          for (const key of Object.keys(row)) if (!RESERVED.has(key)) fields.add(key);
          const filled = Object.values(labelsOf(row) || {}).filter((value) => value !== null).length;
          labels += filled;
          if (filled) labeled += 1;
        }
        return [["Rows", entries.length], ["Text rows", entries.length - objects.length], ["Object rows", objects.length], ["Labeled rows", labeled],
          ["Labels", labels], ["Held-out rows", objects.filter((entry) => heldOut(entry.row)).length],
          ["Rows with a picture", objects.filter((entry) => hasOwn(entry.row, IMAGE)).length], ["Distinct input fields", fields.size],
          ["Lines that start with { but are not JSON", entries.filter((entry) => !isRecord(entry.row) && entry.text.startsWith("{") && !tryJson(entry.text).ok).length]];
      } },
    { id: "field_fill_rates", kind: "tool", group: GROUP, title: "Fields and how often they are filled",
      help: "Every input field of the object rows, in first-seen order, with the rows where it holds a value (not null or blank text), its share of the object rows, and the JSON types it holds.",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const objects = parseRows(rows).filter((entry) => isRecord(entry.row));
        if (!objects.length) throw new Error("No object rows: text rows have no fields.");
        const stats = new Map();
        for (const { row } of objects) {
          for (const key of Object.keys(row)) {
            if (META.has(key)) continue;
            if (!stats.has(key)) stats.set(key, { filled: 0, types: new Set() });
            const value = row[key];
            if (value === null || (typeof value === "string" && value.trim() === "")) continue;
            stats.get(key).filled += 1;
            stats.get(key).types.add(Array.isArray(value) ? "array" : typeof value);
          }
        }
        return { table: { columns: ["field", "rows with a value", "share of object rows", "types"],
          rows: [...stats].map(([key, stat]) => [key, stat.filled, stat.filled / objects.length, [...stat.types].sort().join(", ")]) },
        note: `${plural(objects.length, "object row")}.` };
      } },
    { id: "label_coverage", kind: "tool", group: GROUP, title: "Label coverage per question",
      help: "For each question labeled in the rows: how many rows carry a label, their share of all rows, how many of those are held out, and how often each label value appears on the rows that are not held out (held-out label values are never shown).",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const entries = parseRows(rows);
        const stats = new Map();
        let labeledRows = 0;
        for (const { row } of entries) {
          const labels = labelsOf(row);
          let any = false;
          for (const [qid, value] of Object.entries(labels || {})) {
            if (value === null) continue;
            any = true;
            if (!stats.has(qid)) stats.set(qid, { count: 0, held: 0, values: new Map() });
            const stat = stats.get(qid), key = shown(value);
            stat.count += 1;
            if (heldOut(row)) stat.held += 1;
            else stat.values.set(key, (stat.values.get(key) || 0) + 1);
          }
          if (any) labeledRows += 1;
        }
        const values = (map) => [...map].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])).map(([value, count]) => `${value} × ${count}`).join(", ");
        return { rows: [["Rows", entries.length], ["Labeled rows", labeledRows]],
          table: { columns: ["question", "labeled rows", "share of rows", "held-out labeled", "values on rows not held out"],
            rows: [...stats].map(([qid, stat]) => [qid, stat.count, stat.count / entries.length, stat.held, values(stat.values)]) } };
      } },
    { id: "malformed_lines", kind: "tool", group: GROUP, title: "Find malformed rows",
      help: "Lists lines Bulk would misread or reject: JSON-looking lines that are read as text, quoted strings whose quotes would be kept, fields written twice, _expect that is not an object, _test that is not true, _image that names no sample or saved picture, a photo field beside _image, and rows with nothing to read.",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const entries = parseRows(rows);
        const problems = [];
        for (const { row, text, line } of entries) {
          const add = (problem) => problems.push([line, problem]);
          if (!isRecord(row)) {
            const parsed = tryJson(text);
            if (text.startsWith("{")) add("Starts with { but is not a valid JSON object, so Bulk reads it as text");
            else if (text.startsWith("[") && parsed.ok) add("A JSON array: Bulk reads the line as text");
            else if (text.startsWith('"') && parsed.ok && typeof parsed.value === "string") add("A quoted JSON string: Bulk keeps the quotes as part of the text");
            continue;
          }
          for (const path of duplicateKeys(text) || []) add(`${path} is written twice; JSON keeps only the last value`);
          if (hasOwn(row, LABELS) && !isRecord(row[LABELS])) add("_expect must be an object keyed by question id");
          if (hasOwn(row, TEST) && row[TEST] !== true) add("_test must be true, or left out");
          if (hasOwn(row, IMAGE) && !(typeof row[IMAGE] === "string" && (SAMPLES.includes(row[IMAGE]) || SAVED_PICTURE.test(row[IMAGE])))) add(`_image must name a sample picture (${SAMPLES.join(", ")}) or a saved picture`);
          if (hasOwn(row, IMAGE) && hasOwn(row, "photo")) add("A row with _image cannot also have a photo field");
          if (!Object.keys(inputOf(row)).length) add("Nothing for the model to read");
        }
        return { rows: [["Rows", entries.length], ["Lines with a problem", new Set(problems.map(([line]) => line)).size]], table: { columns: ["line", "problem"], rows: problems } };
      } },
    { id: "duplicate_inputs", kind: "tool", group: GROUP, title: "List duplicate inputs",
      help: "Groups rows whose input is the same once labels, test markers and field order are ignored (picture names count, and a text row matches an object whose only field is text), with the lines of each copy and whether their labels and markers agree.",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const entries = parseRows(rows);
        const groups = [...groupsOf(entries).values()].filter((group) => group.length > 1);
        return { rows: [["Rows", entries.length], ["Inputs with copies", groups.length], ["Extra copies", groups.reduce((sum, group) => sum + group.length - 1, 0)]],
          table: { columns: ["input", "copies", "lines", "labels"], rows: groups.map((group) => [preview(group[0].row), group.length, group.map((entry) => entry.line).join(", "),
            group.every((entry) => sameLabels(recordOf(entry.row), recordOf(group[0].row))) ? "same" : "differ"]) } };
      } },
    { id: "dedupe_rows", kind: "tool", group: GROUP, title: "Remove duplicate rows by input",
      help: "Keeps the first copy of each input (labels, test markers and field order ignored; picture names count). Copies are removed only when their labels are identical too and none is held out; an input whose copies disagree, or that has a held-out copy, keeps every copy, for you to settle.",
      inputs: [ROWS()],
      compute: ({ rows }) => {
        const entries = parseRows(rows);
        const drop = new Set();
        let disagree = 0, held = 0;
        for (const group of groupsOf(entries).values()) {
          if (group.length < 2) continue;
          if (group.some((entry) => heldOut(entry.row))) held += 1;
          else if (group.every((entry) => sameLabels(recordOf(entry.row), recordOf(group[0].row)))) group.slice(1).forEach((entry) => drop.add(entry));
          else disagree += 1;
        }
        return { text: jsonl(entries.filter((entry) => !drop.has(entry)).map((entry) => entry.text)),
          note: `${plural(drop.size, "copy", "copies")} removed.${disagree ? ` ${plural(disagree, "input")} whose copies have different labels or markers kept whole.` : ""}`
            + (held ? ` ${plural(held, "input")} with a held-out copy kept whole.` : "") };
      } },
    { id: "compare_row_sets", kind: "tool", group: GROUP, title: "Compare two row sets by input",
      help: "Which inputs only one of two pasted row sets holds, and which shared inputs carry different labels (labels, test markers and field order ignored for matching, and a text row matches an object whose only field is text; the first copy of each input is compared).",
      inputs: [ROWS("first", "First rows"), ROWS("second", "Second rows")],
      compute: ({ first, second }) => {
        const a = groupsOf(parseRows(first)), b = groupsOf(parseRows(second));
        const table = [];
        let both = 0, differ = 0;
        for (const [key, group] of a) {
          if (!b.has(key)) { table.push(["only in the first", group[0].line, preview(group[0].row)]); continue; }
          both += 1;
          if (stableStringify(labelsOf(group[0].row) || {}) !== stableStringify(labelsOf(b.get(key)[0].row) || {})) {
            differ += 1;
            table.push(["labels differ", group[0].line, preview(group[0].row)]);
          }
        }
        for (const [key, group] of b) if (!a.has(key)) table.push(["only in the second", group[0].line, preview(group[0].row)]);
        return { rows: [["Distinct inputs in the first", a.size], ["Distinct inputs in the second", b.size], ["In both", both],
          ["Only in the first", a.size - both], ["Only in the second", b.size - both], ["In both with different labels", differ]],
        table: { columns: ["where", "line", "input"], rows: table } };
      } },

    // ---------- reshaping rows ----------
    { id: "split_by_value", kind: "tool", group: GROUP, title: "Split rows by a field's value",
      help: "Groups rows into blocks by the value of one field, in first-seen order, each block headed by a # line with the value and its row count. Name a label as _expect.<question id>, or _test for held-out rows.",
      inputs: [ROWS(), FIELD("field", "Field, _expect.<question id> or _test")],
      compute: ({ rows, field }) => {
        const name = field.trim();
        const groups = new Map();
        for (const entry of parseRows(rows)) {
          const value = valueAt(entry.row, name);
          const key = value === undefined ? "\u0000missing" : stableStringify(value);
          if (!groups.has(key)) groups.set(key, { label: value === undefined ? "(missing)" : shown(value), lines: [] });
          groups.get(key).lines.push(entry.text);
        }
        const blocks = [...groups.values()].map((group) => `# ${name} = ${group.label} (${plural(group.lines.length, "row")})\n${jsonl(group.lines)}`);
        return { text: blocks.join("\n"), note: `${plural(groups.size, "group")}.` };
      } },
    { id: "batches", kind: "tool", group: GROUP, title: "Split rows into batches",
      help: "Splits rows into blocks of at most a given size (Bulk runs at most 200 rows at a time), each block headed by a # line naming its rows.",
      inputs: [ROWS(), { name: "size", label: "Rows per batch", type: "integer", min: 1, max: 200, default: 200 }],
      compute: ({ rows, size }) => {
        const entries = parseRows(rows);
        const blocks = [];
        for (let start = 0; start < entries.length; start += size) {
          const part = entries.slice(start, start + size);
          blocks.push(`# Batch ${blocks.length + 1}: rows ${start + 1} to ${start + part.length}\n${jsonl(part.map((entry) => entry.text))}`);
        }
        return { text: blocks.join("\n"), note: `${plural(blocks.length, "batch", "batches")} of up to ${size}.` };
      } },
    { id: "sort_rows", kind: "tool", group: GROUP, title: "Sort rows by a field",
      help: "Sorts rows by one field (or _expect.<question id>, or _test): numbers by value before other values, text in natural order. Rows without the field go last either way, and ties keep their order.",
      inputs: [ROWS(), FIELD("field", "Field, _expect.<question id> or _test"),
        { name: "direction", label: "Order", type: "select", options: [["asc", "Ascending"], ["desc", "Descending"]], default: "asc" }],
      compute: ({ rows, field, direction }) => {
        const name = field.trim(), sign = direction === "desc" ? -1 : 1;
        const keyed = parseRows(rows).map((entry, index) => ({ entry, index, value: valueAt(entry.row, name) }));
        keyed.sort((x, y) => {
          const xm = x.value === undefined, ym = y.value === undefined;
          if (xm || ym) return xm === ym ? x.index - y.index : xm ? 1 : -1;
          return compareValues(x.value, y.value) * sign || x.index - y.index;
        });
        const missing = keyed.filter((item) => item.value === undefined).length;
        return { text: jsonl(keyed.map((item) => item.entry.text)), note: `${plural(keyed.length, "row")} sorted.${missing ? ` ${plural(missing, "row")} without ${name} last.` : ""}` };
      } },
    { id: "rename_field", kind: "tool", group: GROUP, title: "Rename a field in every row",
      help: "Renames an input field in every object row, keeping its place among the fields. A row that already has a field with the new name is left as it was. Labels, markers and pictures are not fields here.",
      inputs: [ROWS(), FIELD("from", "Current field name"), FIELD("to", "New field name")],
      compute: ({ rows, from, to }) => {
        const [old, next] = [fieldName(from, "Current field name"), fieldName(to, "New field name")];
        if (old === next) throw new Error("The new name is the same as the current one.");
        let renamed = 0, conflicts = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          if (!isRecord(row) || !hasOwn(row, old)) return text;
          if (hasOwn(row, next)) { conflicts += 1; return text; }
          const out = {};
          for (const key of Object.keys(row)) setOwn(out, key === old ? next : key, row[key]);
          renamed += 1;
          return JSON.stringify(out);
        });
        return { text: jsonl(lines), note: `${plural(renamed, "row")} renamed.${conflicts ? ` ${plural(conflicts, "row")} that already had ${next} left as ${conflicts === 1 ? "it was" : "they were"}.` : ""}` };
      } },
    { id: "drop_fields", kind: "tool", group: GROUP, title: "Remove fields from every row",
      help: "Removes the named input fields (separated by commas or lines) from every object row, for example an internal id the model should not read. Labels stay; use the strip tool for labels and markers.",
      inputs: [ROWS(), { name: "fields", label: "Fields to remove", type: "textarea", required: true }],
      compute: ({ rows, fields }) => {
        const names = listFields(fields);
        let changed = 0, emptied = 0;
        const lines = parseRows(rows).map(({ row, text }) => {
          if (!isRecord(row) || !names.some((name) => hasOwn(row, name))) return text;
          const out = omit(row, names);
          changed += 1;
          if (!Object.keys(inputOf(out)).length) emptied += 1;
          return JSON.stringify(out);
        });
        return { text: jsonl(lines), note: `${plural(changed, "row")} changed.${emptied ? ` ${plural(emptied, "row")} now ${emptied === 1 ? "has" : "have"} nothing for the model to read.` : ""}` };
      } },

    // ---------- tables ----------
    { id: "sniff_delimiter", kind: "tool", group: GROUP, title: "Detect a table's delimiter",
      help: "Which of comma, semicolon, tab or pipe separates the columns of pasted text (the one most lines agree on), with the header's column count and the rows whose number of cells differs from it.",
      inputs: [TABLE],
      compute: ({ table }) => {
        const read = readTable(table, "auto");
        return [["Delimiter", DELIM_NAMES[read.delimiter]], ["Columns in the header", read.header.length], ["Data rows", read.body.length],
          ["Rows with a different number of cells", read.body.filter((row) => row.length !== read.header.length).length]];
      } },
    { id: "change_delimiter", kind: "tool", group: GROUP, title: "Change a table's delimiter",
      help: "Rewrites a delimited table with another delimiter, for example semicolon-separated text from a spreadsheet as CSV, quoting cells as needed. Text a spreadsheet would run as a formula gets a leading apostrophe.",
      inputs: [TABLE, { ...READ_DELIM, label: "Read with" }, WRITE_DELIM()],
      compute: ({ table, delimiter, output }) => {
        const read = readTable(table, delimiter);
        return { text: formatDelimited(read.all, DELIMS[output]), note: `Read as ${DELIM_NAMES[read.delimiter]}-separated; ${plural(read.all.length, "line")}.` };
      } },
    { id: "transpose_table", kind: "tool", group: GROUP, title: "Transpose a table",
      help: "Turns a delimited table on its side, so columns become rows (short rows are padded), written back with the same delimiter. Text a spreadsheet would run as a formula gets a leading apostrophe.",
      inputs: [TABLE, READ_DELIM],
      compute: ({ table, delimiter }) => {
        const read = readTable(table, delimiter);
        const turned = transpose(read.all);
        return { text: formatDelimited(turned, read.delimiter), note: `${plural(read.all.length, "line")} of up to ${plural(turned.length, "cell")} became ${plural(turned.length, "line")} of ${plural(read.all.length, "cell")}.` };
      } },
    { id: "table_to_markdown", kind: "tool", group: GROUP, title: "Delimited table to Markdown",
      help: "A CSV, TSV, semicolon or pipe table as a Markdown pipe table, with pipes in cells escaped and line breaks as <br>.",
      inputs: [TABLE, READ_DELIM],
      compute: ({ table, delimiter }) => {
        const read = readTable(table, delimiter);
        return { text: formatMarkdownTable(read.header, read.body), note: `${plural(read.body.length, "row")}.` };
      } },
    { id: "markdown_to_table", kind: "tool", group: GROUP, title: "Markdown table to CSV",
      help: "A Markdown pipe table as delimited text, with <br> turned back into line breaks. Text a spreadsheet would run as a formula gets a leading apostrophe.",
      inputs: [MARKDOWN, WRITE_DELIM()],
      compute: ({ markdown, output }) => {
        const parsed = parseMarkdownTable(markdown);
        if (!parsed) throw new Error("This is not a Markdown table: every line needs pipes, and a header line comes first.");
        const cells = parsed.rows.map((row) => row.map((cell) => cell.replace(/<br\s*\/?>/gi, "\n")));
        return { text: formatDelimited([parsed.columns, ...cells], DELIMS[output]), note: `${plural(cells.length, "row")}.` };
      } },
  ],
});

