// Input-shape facts for drift's "Label new traffic" queue ("workbench.drift.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): the size and makeup of each queued new row's input text, its fields and
// its picture, so a person can sort and filter the rows they are about to label. Facts read the row's input only:
// never a label, an answer or a comparison statistic (this queue is a targeted sample, not a random audit).
import { definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { codePoints, findEmails, findUrls, hasEdgeWhitespace, isAscii, lineCount, utf8Bytes, wordCount } from "../../lib/text.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const textOf = (item) => (isObject(item?.row) && typeof item.row.text === "string" ? item.row.text : null);
// Top-level field names of the input, without the picture name.
const fieldsOf = (item) => (isObject(item?.row) ? Object.keys(item.row).filter((key) => key !== "_image") : null);
const onText = (item, measure) => { const text = textOf(item); return text === null ? null : measure(text); };
const itemsOf = (ctx) => { try { return Array.isArray(ctx?.items?.()) ? ctx.items() : []; } catch { return []; } };

export default definePack({
  id: "drift-queue-input-facts",
  surface: "workbench.drift.queue",
  title: "New traffic input facts",
  about: "Facts about each queued new row's input in drift's Label new traffic queue: words, lines, digits, size, nested fields, queue position, rows sharing its text, web or email addresses, edge spaces, non-ASCII text, a length band, its set of fields, its other field values and its picture. Inputs only: never labels, answers or comparison statistics.",
  features: [
    { id: "word_count", kind: "fact", type: "number", label: "input text words", unit: "words", help: "Whitespace-separated words of the text field; unknown without one.",
      value: (item) => onText(item, wordCount) },
    { id: "line_count", kind: "fact", type: "number", label: "input text lines", unit: "lines", value: (item) => onText(item, lineCount) },
    { id: "digit_count", kind: "fact", type: "number", label: "digits in input text", unit: "digits", help: "Order numbers, prices and dates show up as digits.",
      value: (item) => onText(item, (text) => (text.match(/[0-9]/g) || []).length) },
    { id: "input_bytes", kind: "fact", type: "number", label: "input size", unit: "bytes",
      help: "UTF-8 bytes of the whole input as compact JSON with sorted keys (the identity Review and dataset health use), picture name included.",
      value: (item) => (typeof item?.identity === "string" && item.identity ? utf8Bytes(item.identity) : null) },
    { id: "nested_fields", kind: "fact", type: "number", label: "fields holding an object or a list", unit: "fields",
      value: (item) => { const fields = fieldsOf(item); return fields === null ? null : fields.filter((key) => item.row[key] !== null && typeof item.row[key] === "object").length; } },
    { id: "queue_position", kind: "fact", type: "number", label: "position in the queue", unit: "position", help: "1 is the row the comparison listed first; Add takes ready rows in this order.",
      value: (item) => (Number.isInteger(item?.position) ? item.position : null) },
    { id: "same_text_rows", kind: "fact", type: "number", label: "other queued rows with the same text", unit: "rows",
      help: "Queued rows whose text field matches this one exactly while another field differs (identical inputs never enter the queue).",
      value: (item, ctx) => {
        const text = textOf(item);
        return text === null ? null : itemsOf(ctx).filter((other) => other !== item && other?.line !== item.line && textOf(other) === text).length;
      } },

    { id: "has_text_field", kind: "fact", type: "flag", label: "a text field", value: (item) => textOf(item) !== null },
    { id: "has_web_address", kind: "fact", type: "flag", label: "a web address in the text", value: (item) => (onText(item, (text) => findUrls(text).length) || 0) > 0 },
    { id: "has_email", kind: "fact", type: "flag", label: "an email address in the text", value: (item) => (onText(item, (text) => findEmails(text).length) || 0) > 0 },
    { id: "edge_spaces", kind: "fact", type: "flag", label: "spaces or line breaks at the start or end of the text", value: (item) => onText(item, hasEdgeWhitespace) === true },
    { id: "non_ascii", kind: "fact", type: "flag", label: "non-ASCII characters in the text", help: "Accents, curly quotes, emoji and other scripts.",
      value: (item) => onText(item, (text) => !isAscii(text)) === true },

    { id: "length_band", kind: "fact", type: "category", label: "text length band", help: "By characters: short is under 40, medium under 200, long 200 or more.",
      value: (item) => {
        if (!isObject(item?.row)) return null;
        const text = textOf(item);
        if (text === null) return "no text field";
        if (!text.trim()) return "blank";
        const length = codePoints(text);
        return length < 40 ? "short" : length < 200 ? "medium" : "long";
      } },
    { id: "field_set", kind: "fact", type: "category", label: "input fields", help: "The input's field names, sorted, without the picture name.",
      value: (item) => { const fields = fieldsOf(item); return fields === null ? null : fields.length ? [...fields].sort().join(", ") : "no fields"; } },
    { id: "picture_state", kind: "fact", type: "category", label: "picture",
      value: (item) => (!isObject(item?.row) ? null : typeof item.image !== "string" ? "no picture" : item.picture_loaded === true ? "loaded" : "not loaded") },

    { id: "other_fields", kind: "fact", type: "text", label: "other input fields",
      help: "Every field but the text and the picture as field=value, sorted by field; objects and lists as JSON with sorted keys. Filter with, for example, channel=email.",
      value: (item) => {
        const fields = fieldsOf(item);
        if (fields === null) return "";
        return fields.filter((key) => key !== "text").sort().map((key) => {
          const value = item.row[key];
          return `${key}=${typeof value === "string" ? value : stableStringify(value) ?? String(value)}`;
        }).join("; ");
      } },
    { id: "picture_name", kind: "fact", type: "text", label: "picture name", value: (item) => (typeof item?.image === "string" ? item.image : "") },
  ],
});
