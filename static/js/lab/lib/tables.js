// Table helpers for Lab packs: delimited text (CSV, TSV), JSON Lines, Markdown, plain-text and HTML tables, and a few
// operations on rows. Pure code: it imports nothing and touches no DOM, storage or network.
//
// "rows" is an array of arrays of cells. Parsers return cells as strings. Formatters take any cell value and turn it
// into text with cellText: null and undefined are "", numbers and booleans print as they are, objects and arrays are
// JSON text. Text arguments take any value (null and undefined read as ""). An argument outside a function's domain
// (rows that are not an array, a delimiter that is not one character) gives null; nothing throws on bad input.

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

// Any value as text: null and undefined are "", and a value that cannot be converted is "".
function str(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try { return String(value); } catch { return ""; }
}

// The text without a leading byte order mark.
const withoutBom = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

// Sets an own property, even for the key "__proto__", which plain assignment would treat as the prototype.
function setOwn(object, key, value) {
  if (key === "__proto__") Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
  else object[key] = value;
}

const validDelimiter = (delimiter) => typeof delimiter === "string" && delimiter.length === 1 && !'"\r\n'.includes(delimiter);

// One cell as text: "" for null and undefined, the text itself for a string, the usual digits for numbers and
// booleans, the ISO timestamp for a valid Date, and JSON text for arrays and other objects (String(value) when the
// value cannot be serialized, for example a cycle).
export function cellText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return str(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  try { return JSON.stringify(value) ?? ""; } catch { return str(value); }
}

// ---------- delimited text ----------

// Delimited text as an array of string arrays, by RFC 4180: a field may be wrapped in double quotes, where a doubled
// quote is one quote and delimiters and line breaks are data; rows end at CRLF, LF or CR. A leading byte order mark
// is dropped, a line break at the very end does not add a row, an empty line elsewhere is a row with one empty
// field, and rows may differ in length. Lenient with broken input: a quote in the middle of an unquoted field is
// data, and an unclosed quote runs to the end. [] for "". null when the delimiter is not one character or is a
// quote or line break.
export function parseDelimited(text, delimiter = ",") {
  if (!validDelimiter(delimiter)) return null;
  const value = withoutBom(str(text));
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;
  let started = false;
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (value[index + 1] === '"') { field += '"'; index += 1; }
      else inQuotes = false;
      index += 1;
    } else if (char === '"' && field === "" && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
      started = true;
      index += 1;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      wasQuoted = false;
      started = true;
      index += 1;
    } else if (char === "\r" || char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      wasQuoted = false;
      started = false;
      index += char === "\r" && value[index + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      started = true;
      index += 1;
    }
  }
  if (started) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// One cell of delimited text: quoted only when it holds the delimiter, a quote or a line break.
function delimitedCell(value, delimiter, escapeFormulas) {
  let text = cellText(value);
  if (escapeFormulas && typeof value === "string" && (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Rows as delimited text, every row ended by the newline (so "" for no rows). A cell is quoted only when it holds the
// delimiter, a quote or a line break. With formulas "escape" (the default, and any value other than "keep") a text
// cell that a spreadsheet would run as a formula (it starts with = + - or @, optionally after whitespace, or with a
// tab, CR or LF) gets a leading apostrophe; number and boolean cells are never changed, so -5 stays a number. A row
// that is not an array is one cell. newline is "\r\n" (default), "\n" or "\r". null when rows is not an array or the
// delimiter is not one character.
export function formatDelimited(rows, delimiter = ",", options = {}) {
  if (!Array.isArray(rows) || !validDelimiter(delimiter)) return null;
  const escapeFormulas = !(options && options.formulas === "keep");
  const newline = options && ["\r\n", "\n", "\r"].includes(options.newline) ? options.newline : "\r\n";
  return rows.map((row) => (Array.isArray(row) ? row : [row]).map((cell) => delimitedCell(cell, delimiter, escapeFormulas)).join(delimiter) + newline).join("");
}

// The first nonblank lines of delimited text, where a line break inside double quotes does not end a line.
function logicalLines(text, limit) {
  const out = [];
  let line = "";
  let inQuotes = false;
  for (let index = 0; index <= text.length && out.length < limit; index += 1) {
    const char = text[index];
    if (index === text.length || (!inQuotes && (char === "\r" || char === "\n"))) {
      if (line.trim() !== "") out.push(line);
      line = "";
    } else {
      if (char === '"') inQuotes = !inQuotes;
      line += char;
    }
  }
  return out;
}

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

// The likely delimiter of delimited text: "," ";" "\t" or "|". For each candidate it counts the delimiters outside
// quotes on each of the first 20 nonblank lines and takes the count most lines share; the candidate with the most
// lines in agreement wins, then the one with more columns, then the earlier in the order , ; tab |. "," when no
// candidate appears at all.
export function sniffDelimiter(text) {
  const sample = logicalLines(withoutBom(str(text)), 20);
  let best = { delimiter: ",", agree: 0, count: 0 };
  for (const delimiter of [",", ";", "\t", "|"]) {
    const tally = new Map();
    for (const line of sample) {
      const count = countOutsideQuotes(line, delimiter);
      if (count > 0) tally.set(count, (tally.get(count) || 0) + 1);
    }
    let agree = 0;
    let shared = 0;
    for (const [count, times] of tally) if (times > agree || (times === agree && count > shared)) { agree = times; shared = count; }
    if (agree > best.agree || (agree === best.agree && shared > best.count)) best = { delimiter, agree, count: shared };
  }
  return best.delimiter;
}

// ---------- rows and objects ----------

// Rows as objects keyed by the first row. Cells a row lacks are "". A header repeated later becomes name_2, name_3
// (the first free one). A blank header, or a column past the end of the header that some row fills, is named
// column_N by its 1-based position. [] when there is only a header or nothing. null when rows is not an array.
export function rowsToObjects(rows) {
  if (!Array.isArray(rows)) return null;
  const table = rows.map((row) => (Array.isArray(row) ? row : [row]));
  if (!table.length) return [];
  const size = table.reduce((most, row) => Math.max(most, row.length), 0);
  const taken = new Set();
  const header = [];
  for (let index = 0; index < size; index += 1) {
    const raw = cellText(table[0][index]);
    const base = raw.trim() === "" ? `column_${index + 1}` : raw;
    let name = base;
    for (let number = 2; taken.has(name); number += 1) name = `${base}_${number}`;
    taken.add(name);
    header.push(name);
  }
  return table.slice(1).map((row) => {
    const object = {};
    header.forEach((name, index) => setOwn(object, name, index < row.length && row[index] !== null && row[index] !== undefined ? row[index] : ""));
    return object;
  });
}

// Objects as [header, ...rows]: the header is the union of the objects' keys in first-seen order, and every cell is
// text (cellText), so nested values are JSON text and a missing, null or undefined value is "". An entry that is
// not a plain record (a number, a string, an array) goes in a column named "value". [[]] for no objects. null when
// objects is not an array.
export function objectsToRows(objects) {
  if (!Array.isArray(objects)) return null;
  const records = objects.map((entry) => (isRecord(entry) ? entry : { value: entry }));
  const header = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) { seen.add(key); header.push(key); }
    }
  }
  return [header, ...records.map((record) => header.map((key) => (hasOwn(record, key) ? cellText(record[key]) : "")))];
}

// ---------- JSON Lines ----------

// JSON Lines as { rows, errors }: rows holds the parsed value of every line that is valid JSON, in order, and errors
// holds { line, message } for every line that is not, with 1-based line numbers that count blank lines. Blank lines
// are skipped and a leading byte order mark is dropped. Never throws.
export function parseJsonl(text) {
  const rows = [];
  const errors = [];
  withoutBom(str(text)).split(/\r\n|\r|\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    try { rows.push(JSON.parse(line)); } catch (error) { errors.push({ line: index + 1, message: str(error && error.message) || "Invalid JSON" }); }
  });
  return { rows, errors };
}

// Values as JSON Lines: one compact JSON value per line, each line ended by "\n" ("" for no values). A value JSON
// cannot represent (undefined, a function, a cycle) is written as null. null when values is not an array.
export function formatJsonl(values) {
  if (!Array.isArray(values)) return null;
  return values.map((value) => {
    let line;
    try { line = JSON.stringify(value); } catch { line = undefined; }
    return `${line === undefined ? "null" : line}\n`;
  }).join("");
}

// ---------- Markdown ----------

// The cells of one Markdown table line, trimmed, or null when the line has no unescaped pipe. \| is a literal pipe,
// and one empty cell at each end (the outer pipes) is dropped.
function markdownCells(line) {
  const cells = [];
  let cell = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "|") { cell += "|"; index += 1; }
    else if (char === "|") { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  if (cells.length < 2) return null;
  if (cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((entry) => entry.trim());
}

// A Markdown pipe table as { columns, rows }, all cells trimmed strings. The first line is the header; an alignment
// row (--- | :---: | ---:) right after it is skipped and is optional; outer pipes are optional; \| is a literal
// pipe. Every row has exactly one cell per column: short rows are padded with "" and extra cells are dropped. Blank
// lines around the table are ignored. null when the text is not a table: fewer than two lines, or a line that is
// blank or has no pipe.
export function parseMarkdownTable(text) {
  const all = str(text).split(/\r\n|\r|\n/).map((line) => line.trim());
  while (all.length && all[0] === "") all.shift();
  while (all.length && all[all.length - 1] === "") all.pop();
  if (all.length < 2) return null;
  const parsed = all.map(markdownCells);
  if (parsed.some((cells) => cells === null)) return null;
  const [columns, ...body] = parsed;
  if (body[0].every((cell) => /^:?-+:?$/.test(cell))) body.shift();
  return { columns, rows: body.map((cells) => columns.map((_name, index) => (index < cells.length ? cells[index] : ""))) };
}

const markdownCell = (value) => cellText(value).trim().replaceAll("|", "\\|").replace(/\r\n|\r|\n/g, "<br>");

// A Markdown pipe table: a header line, a --- alignment row, then one line per row, joined by "\n" with no final
// line break. Cells are trimmed, pipes are escaped as \| and line breaks become <br>. Each row gets one cell per
// column: missing cells are empty and extra cells are dropped. null when columns is not a nonempty array or rows is
// not an array.
export function formatMarkdownTable(columns, rows) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows)) return null;
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [
    line(columns.map(markdownCell)),
    line(columns.map(() => "---")),
    ...rows.map((row) => line(columns.map((_name, index) => markdownCell(Array.isArray(row) ? row[index] : index === 0 ? row : "")))),
  ].join("\n");
}

// ---------- plain text and HTML ----------

const width = (text) => Array.from(text).length;
const isNumeric = (value) => typeof value === "number" || typeof value === "bigint"
  || (typeof value === "string" && /^[-+]?\$?\d[\d,]*(?:\.\d+)?%?$/.test(value.trim()));

// A table for a monospace font: the header, a line of dashes, then the rows, with columns padded to the widest cell
// (in code points) and separated by two spaces, lines joined by "\n" with no trailing spaces or final line break.
// A column is right-aligned, header included, when it has at least one nonblank cell and every nonblank cell is a
// number or numeric text ("12", "-3.5", "1,200", "$4.00", "85%"); other columns are left-aligned. Cells are trimmed
// and each run of tabs and line breaks inside one becomes a space. Each row gets one cell per column: missing cells are blank and
// extra cells are dropped. null when columns is not a nonempty array or rows is not an array.
export function formatTextTable(columns, rows) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows)) return null;
  const flat = (value) => cellText(value).replace(/[\t\r\n]+/g, " ").trim();
  const body = rows.map((row) => columns.map((_name, index) => (Array.isArray(row) ? row[index] : index === 0 ? row : "")));
  const head = columns.map(flat);
  const text = body.map((row) => row.map(flat));
  const right = columns.map((_name, index) => {
    const filled = body.map((row) => row[index]).filter((value) => cellText(value).trim() !== "");
    return filled.length > 0 && filled.every(isNumeric);
  });
  const widths = head.map((name, index) => text.reduce((most, row) => Math.max(most, width(row[index])), width(name)));
  const pad = (value, index) => {
    const space = " ".repeat(widths[index] - width(value));
    return right[index] ? space + value : value + space;
  };
  const line = (cells) => cells.map(pad).join("  ").trimEnd();
  return [line(head), widths.map((size) => "-".repeat(Math.max(size, 1))).join("  "), ...text.map(line)].join("\n");
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => cellText(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// An HTML table with a thead and a tbody, one line per row, joined by "\n". Every cell is escaped text (& < > " '),
// so no cell can add markup; line breaks inside cells stay as they are. Each row gets one cell per column: missing
// cells are empty and extra cells are dropped. null when columns is not a nonempty array or rows is not an array.
export function formatHtmlTable(columns, rows) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows)) return null;
  const cells = (row, tag) => columns.map((_name, index) => `<${tag}>${escapeHtml(Array.isArray(row) ? row[index] : index === 0 ? row : "")}</${tag}>`).join("");
  return [
    "<table>",
    `<thead><tr>${cells(columns, "th")}</tr></thead>`,
    "<tbody>",
    ...rows.map((row) => `<tr>${cells(row, "td")}</tr>`),
    "</tbody>",
    "</table>",
  ].join("\n");
}

// ---------- operations on rows ----------

// The rows turned on their side: row r, column c becomes row c, column r. Short rows are padded with "" so the
// result is rectangular. [] for no rows. null when rows is not an array.
export function transpose(rows) {
  if (!Array.isArray(rows)) return null;
  const table = rows.map((row) => (Array.isArray(row) ? row : [row]));
  const size = table.reduce((most, row) => Math.max(most, row.length), 0);
  return Array.from({ length: size }, (_unused, column) => table.map((row) => (column < row.length ? row[column] : "")));
}

// One column as an array: the cell at the 0-based index from every row, "" where a row is too short. Pass
// rows.slice(1) to leave a header out. null when rows is not an array or index is not a whole number >= 0.
export function columnValues(rows, index) {
  if (!Array.isArray(rows) || !Number.isInteger(index) || index < 0) return null;
  return rows.map((row) => (Array.isArray(row) && index < row.length ? row[index] : ""));
}

// Orders numbers first (ascending), then everything else by its text in code unit order.
function compareValues(a, b) {
  const aNumber = typeof a === "number";
  const bNumber = typeof b === "number";
  if (aNumber && bNumber) return a - b || 0;
  if (aNumber !== bNumber) return aNumber ? -1 : 1;
  const left = cellText(a);
  const right = cellText(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

// How often each distinct value occurs, as [[value, count], ...]: most frequent first, ties by value (numbers
// ascending before everything else, the rest by their text), then first seen. Values are distinct as Map keys are, so
// 1 and "1" are counted apart. [] for no values. null when values is not an array.
export function distinctCounts(values) {
  if (!Array.isArray(values)) return null;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Array.from(counts).sort((a, b) => b[1] - a[1] || compareValues(a[0], b[0]));
}
