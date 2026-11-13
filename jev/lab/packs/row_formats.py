"""Row formats: parsers and renderers for Bulk rows, which `lab.py rows convert` (and the other rows commands) use.

A Bulk row is text or a JSON object of input fields; its labels sit under `_expect` ({question id: label}), a held-out
test row carries `"_test": true` and a picture row names its picture under `_image`. The JSON formats (JSON lines, a
JSON array) hold rows exactly. The tabular ones (CSV, TSV, semicolon CSV, pipe-separated, Excel CSV, Markdown and
HTML tables) give each input field a column, then `_image`, one `_expect.<question id>` column per labeled question
(the column name Import CSV reads as a label) and `_test`. Their cells are text: an object or array value travels as
JSON, a number or true/false input value comes back as text, a label of true/false or a whole number comes back as a
Noul or Score label, and a row whose only column is `text` comes back as a text row. Plain text lines hold one text row
per line. The spreadsheet formats (CSV, TSV, semicolon CSV, Excel CSV) put an apostrophe before a cell a spreadsheet
would run as a formula, and their parsers take it off again. Every parser drops a leading byte-order mark.

Each format may list "extensions": the file endings the rows commands read it from by default.
"""

from __future__ import annotations

import csv
import html
import io
import json
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple

from jev import workbench
from jev.lab import kit

LABEL_KEY, TEST_KEY, IMAGE_KEY = workbench.LABEL_KEY, workbench.TEST_KEY, workbench.IMAGE_KEY
LABEL_PREFIX = LABEL_KEY + "."
BOM = "\ufeff"
_FORMULA = re.compile(r"^\s*[=+@-]|^[\t\r\n]")
_INTEGER = re.compile(r"^-?\d+$")
_SEPARATOR = re.compile(r"^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$")
TRUE_WORDS = {"true", "yes", "1", "y"}
FALSE_WORDS = {"false", "no", "0", "n"}


# ---------- rows <-> table ----------


def _object(row: Any, number: int) -> dict:
    if isinstance(row, str):
        return {"text": row}
    if isinstance(row, dict):
        return row
    raise ValueError("row %d is %s; a rows file holds text and JSON objects" % (
        number, "a JSON array" if isinstance(row, list) else "not text or an object"))


def _value_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _label_cell(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return _value_cell(value)


def to_table(rows: List[Any]) -> Tuple[List[str], List[List[str]]]:
    """(column names, cell rows) for Bulk rows: input fields in first-seen order, then _image, _expect.<id>, _test."""
    objects = [_object(row, number) for number, row in enumerate(rows, 1)]
    fields: Dict[str, None] = {}
    labels: Dict[str, None] = {}
    picture = test = False
    for row in objects:
        for key in row:
            if key == LABEL_KEY:
                if not isinstance(row[key], dict):
                    raise ValueError("a row's %s must be an object keyed by question id" % LABEL_KEY)
                labels.update(dict.fromkeys(row[key]))
            elif key == TEST_KEY:
                test = True
            elif key == IMAGE_KEY:
                picture = True
            else:
                fields[key] = None
    columns = list(fields) + ([IMAGE_KEY] if picture else []) + [LABEL_PREFIX + q for q in labels] + ([TEST_KEY] if test else [])
    cells = []
    for row in objects:
        line = [_value_cell(row.get(field)) for field in fields]
        if picture:
            line.append(_value_cell(row.get(IMAGE_KEY)))
        line += [_label_cell((row.get(LABEL_KEY) or {}).get(q)) for q in labels]
        if test:
            line.append("" if TEST_KEY not in row else "true" if row[TEST_KEY] is True else _label_cell(row[TEST_KEY]))
        cells.append(line)
    return columns, cells


def _input_value(cell: str) -> Any:
    text = cell.strip()
    if text[:1] in ("{", "["):
        try:
            value = json.loads(text)
        except ValueError:
            return cell
        if isinstance(value, (dict, list)):
            return value
    return cell


def _label_value(cell: str) -> Any:
    text = cell.strip()
    if text in ("true", "false"):
        return text == "true"
    if _INTEGER.match(text):
        return int(text)
    return text


def from_table(columns: List[str], cells: List[List[str]]) -> List[Any]:
    """Bulk rows from a header and its cell rows; fully blank rows are dropped and short rows padded."""
    names = [name.strip() for name in columns]
    rows: List[Any] = []
    for line in cells:
        line = (list(line) + [""] * len(names))[: len(names)]
        if not any(cell.strip() for cell in line):
            continue
        row: Dict[str, Any] = {}
        expect: Dict[str, Any] = {}
        for name, cell in zip(names, line):
            if not cell.strip():
                continue
            if name.startswith(LABEL_PREFIX) and len(name) > len(LABEL_PREFIX):
                expect[name[len(LABEL_PREFIX):]] = _label_value(cell)
            elif name == TEST_KEY:
                word = cell.strip().lower()
                if word in TRUE_WORDS:
                    row[TEST_KEY] = True
                elif word not in FALSE_WORDS:
                    row[TEST_KEY] = cell.strip()
            elif name == IMAGE_KEY:
                row[IMAGE_KEY] = cell.strip()
            else:
                row[name] = _input_value(cell)
        if expect:
            row[LABEL_KEY] = expect
        if TEST_KEY in row:
            row[TEST_KEY] = row.pop(TEST_KEY)  # last, after the labels, in the order the columns go
        rows.append(row["text"] if list(row) == ["text"] and isinstance(row["text"], str) else row)
    return rows


# ---------- delimited text ----------


def _escaped(cell: str) -> bool:
    """Whether a spreadsheet would run the cell as a formula, or it is such a cell after apostrophes."""
    return bool(_FORMULA.match(cell)) or (cell.startswith("'") and _escaped(cell[1:]))


def _defuse(cell: str) -> str:
    """A cell a spreadsheet would run as a formula, or one already escaped that way, gets one more apostrophe."""
    return "'" + cell if _escaped(cell) else cell


def _restore(cell: str) -> str:
    return cell[1:] if cell.startswith("'") and _escaped(cell[1:]) else cell


def _parse_delimited(text: str, delimiter: str, spreadsheet: bool) -> List[Any]:
    text = text[1:] if text.startswith(BOM) else text
    try:
        lines = [line for line in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter) if any(c.strip() for c in line)]
    except csv.Error as err:
        raise ValueError("cannot read the rows: %s" % err)
    if not lines:
        return []
    if spreadsheet:
        lines = [[_restore(cell) for cell in line] for line in lines]
    return from_table(lines[0], lines[1:])


def _render_delimited(rows: List[Any], delimiter: str, spreadsheet: bool, ending: str = "\n") -> str:
    columns, cells = to_table(rows)
    if not columns:
        return ""
    out = io.StringIO()
    writer = csv.writer(out, delimiter=delimiter, lineterminator=ending)
    for line in [columns] + cells:
        writer.writerow([_defuse(cell) for cell in line] if spreadsheet else line)
    return out.getvalue()


# ---------- Markdown and HTML tables ----------


def _markdown_cell(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\r\n", "<br>").replace("\n", "<br>").replace("\r", "<br>")


def render_markdown(rows: List[Any]) -> str:
    columns, cells = to_table(rows)
    if not columns:
        return ""
    lines = ["| %s |" % " | ".join(_markdown_cell(c) for c in columns), "| %s |" % " | ".join("---" for _ in columns)]
    lines += ["| %s |" % " | ".join(_markdown_cell(c) for c in line) for line in cells]
    return "\n".join(lines) + "\n"


def _markdown_cells(line: str) -> List[str]:
    cells, current, index = [], [], 0
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    while index < len(line):
        ch = line[index]
        if ch == "\\" and index + 1 < len(line) and line[index + 1] in "\\|":
            current.append(line[index + 1])
            index += 2
            continue
        if ch == "|":
            cells.append("".join(current))
            current = []
        else:
            current.append(ch)
        index += 1
    if current and "".join(current).strip():
        cells.append("".join(current))
    return [cell.strip().replace("<br>", "\n") for cell in cells]


def parse_markdown(text: str) -> List[Any]:
    lines = [line for line in text.lstrip(BOM).split("\n") if line.strip()]
    if not lines:
        return []
    if len(lines) < 2 or not _SEPARATOR.match(lines[1].strip()):
        raise ValueError("a Markdown table needs a header line and a --- separator line under it")
    return from_table(_markdown_cells(lines[0]), [_markdown_cells(line) for line in lines[2:]])


def _html_cell(value: str) -> str:
    return "<br>".join(html.escape(part) for part in value.replace("\r\n", "\n").split("\n"))


def render_html(rows: List[Any]) -> str:
    columns, cells = to_table(rows)
    if not columns:
        return ""
    lines = ["<table>", "<thead>", "<tr>%s</tr>" % "".join("<th>%s</th>" % _html_cell(c) for c in columns), "</thead>", "<tbody>"]
    lines += ["<tr>%s</tr>" % "".join("<td>%s</td>" % _html_cell(c) for c in line) for line in cells]
    return "\n".join(lines + ["</tbody>", "</table>"]) + "\n"


class _Cells(HTMLParser):
    """Collects the text of every th/td, row by row; <br> inside a cell is a line break."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: List[List[str]] = []
        self.cell: Optional[List[str]] = None

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "tr":
            self.rows.append([])
        elif tag in ("td", "th"):
            if not self.rows:
                self.rows.append([])
            self.cell = []
        elif tag == "br" and self.cell is not None:
            self.cell.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self.cell is not None:
            self.rows[-1].append("".join(self.cell))
            self.cell = None

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)


def parse_html(text: str) -> List[Any]:
    reader = _Cells()
    reader.feed(text.lstrip(BOM))
    reader.close()
    rows = [row for row in reader.rows if row]
    return from_table(rows[0], rows[1:]) if rows else []


# ---------- JSON lines, JSON array, plain lines ----------


def parse_jsonl(text: str) -> List[Any]:
    return workbench.parse_rows(text.lstrip(BOM))


def _text_line(row: str) -> str:
    """A text row as a JSON-lines line: as it is, unless reading it back would change it."""
    if row != row.strip() or "\n" in row or "\r" in row or row.startswith("{") or not row:
        return json.dumps({"text": row}, ensure_ascii=False)
    return row


def render_jsonl(rows: List[Any]) -> str:
    lines = []
    for number, row in enumerate(rows, 1):
        if isinstance(row, str):
            lines.append(_text_line(row))
        elif isinstance(row, dict):
            lines.append(json.dumps(row, ensure_ascii=False))
        else:
            _object(row, number)
    return "".join(line + "\n" for line in lines)


def parse_json(text: str) -> List[Any]:
    if not text.lstrip(BOM).strip():
        return []
    try:
        value = json.loads(text.lstrip(BOM))
    except ValueError as err:
        raise ValueError("not JSON: %s" % err)
    if not isinstance(value, list):
        raise ValueError("a JSON rows file is an array of rows")
    for number, row in enumerate(value, 1):
        if not (isinstance(row, dict) or (isinstance(row, str) and row.strip())):
            raise ValueError("item %d is not text or a JSON object" % number)
    return value


def render_json(rows: List[Any]) -> str:
    for number, row in enumerate(rows, 1):
        _object(row, number)
    return json.dumps(list(rows), indent=1, ensure_ascii=False) + "\n"


def parse_lines(text: str) -> List[Any]:
    return [line.strip() for line in text.lstrip(BOM).split("\n") if line.strip()]


def render_lines(rows: List[Any]) -> str:
    out = []
    for number, row in enumerate(rows, 1):
        value = row if isinstance(row, str) else row.get("text") if isinstance(row, dict) else None
        if not isinstance(value, str) or not value.strip():
            raise ValueError("row %d has no text to write as a line" % number)
        out.append(" ".join(value.split()))
    return "".join(line + "\n" for line in out)


# ---------- the pack ----------


def _delimited(delimiter: str, spreadsheet: bool, ending: str = "\n", bom: bool = False) -> dict:
    def parse(text: str) -> List[Any]:
        return _parse_delimited(text, delimiter, spreadsheet)

    def render(rows: List[Any]) -> str:
        text = _render_delimited(rows, delimiter, spreadsheet, ending)
        return BOM + text if bom and text else text

    return {"parse": parse, "render": render}


PACK = kit.define_pack({
    "id": "row-formats",
    "surface": "python.formats",
    "title": "Row formats for Bulk rows files",
    "about": "Parsers and renderers that read and write Bulk rows (text or objects, labels under _expect, held-out "
             "rows marked _test, pictures under _image) as JSON lines, a JSON array, CSV, TSV, semicolon CSV, "
             "pipe-separated text, Excel CSV with a byte-order mark, Markdown and HTML tables, and plain text lines. "
             "`lab.py rows convert` and the other rows commands use them.",
    "features": [
        dict({"id": "jsonl", "kind": "format", "name": "jsonl", "extensions": [".jsonl", ".ndjson"],
              "title": "JSON lines as Bulk reads them: one text row or JSON object per line"},
             parse=parse_jsonl, render=render_jsonl),
        dict({"id": "json_array", "kind": "format", "name": "json", "extensions": [".json"],
              "title": "a JSON array of text rows and objects"}, parse=parse_json, render=render_json),
        dict({"id": "csv", "kind": "format", "name": "csv", "extensions": [".csv"],
              "title": "CSV with a header line, labels in _expect.<question> columns and formula cells defused"},
             **_delimited(",", True)),
        dict({"id": "tsv", "kind": "format", "name": "tsv", "extensions": [".tsv", ".tab"],
              "title": "tab-separated values with a header line and formula cells defused"}, **_delimited("\t", True)),
        dict({"id": "semicolon", "kind": "format", "name": "semicolon", "extensions": [".ssv"],
              "title": "semicolon-separated CSV, as spreadsheets in comma-decimal locales write it"},
             **_delimited(";", True)),
        dict({"id": "pipe", "kind": "format", "name": "pipe", "extensions": [".psv"],
              "title": "pipe-separated text with a header line"}, **_delimited("|", False)),
        dict({"id": "excel", "kind": "format", "name": "excel", "extensions": [],
              "title": "Excel-style CSV: a UTF-8 byte-order mark, CRLF line ends and formula cells defused"},
             **_delimited(",", True, "\r\n", True)),
        dict({"id": "markdown", "kind": "format", "name": "markdown", "extensions": [".md", ".markdown"],
              "title": "a Markdown table, pipes escaped and line breaks as <br>"}, parse=parse_markdown, render=render_markdown),
        dict({"id": "html", "kind": "format", "name": "html", "extensions": [".html", ".htm"],
              "title": "an HTML table with a header row, text escaped and line breaks as <br>"}, parse=parse_html, render=render_html),
        dict({"id": "lines", "kind": "format", "name": "lines", "extensions": [".txt"],
              "title": "plain text, one text row per line (only each row's text is written)"}, parse=parse_lines, render=render_lines),
    ],
})
