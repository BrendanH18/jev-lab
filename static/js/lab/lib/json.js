// JSON helpers for Lab: stableStringify, JSON text with sorted keys, which the Review queue surface
// (static/js/lab/surfaces/workbench-checks.js) uses as a row's exact-input identity. Pure code: it imports nothing and
// touches no DOM, storage or network. Nothing here mutates its arguments or throws on bad input.

function serialize(input, indent, level, open) {
  let value = input;
  if (value !== null && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON();
  if (value instanceof Number || value instanceof String || value instanceof Boolean) value = value.valueOf();
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined;
  if (open.includes(value)) throw new TypeError("cyclic value");
  open.push(value);
  const inner = indent ? `\n${indent.repeat(level + 1)}` : "";
  const outer = indent ? `\n${indent.repeat(level)}` : "";
  let parts;
  let brackets;
  if (Array.isArray(value)) {
    brackets = "[]";
    parts = Array.from(value, (item) => serialize(item, indent, level + 1, open) ?? "null");
  } else {
    brackets = "{}";
    parts = [];
    for (const key of Object.keys(value).sort()) {
      const text = serialize(value[key], indent, level + 1, open);
      if (text !== undefined) parts.push(`${JSON.stringify(key)}:${indent ? " " : ""}${text}`);
    }
  }
  open.pop();
  return parts.length ? `${brackets[0]}${inner}${parts.join(`,${inner}`)}${outer}${brackets[1]}` : brackets;
}

// JSON text with the keys of every object sorted (UTF-16 code unit order) at every level, so two values that differ
// only in key order give the same text. Otherwise it follows JSON.stringify: indent is a number of spaces (0 to 10,
// 0 for compact text) or a string of up to 10 characters; undefined and functions are left out of objects and are
// null in arrays; NaN and Infinity are null; toJSON is honored. A bigint is written as its digits. null when the
// value has no JSON text: undefined, a function, a symbol, or a cycle.
export function stableStringify(value, indent = 0) {
  let gap = "";
  if (typeof indent === "number" && indent >= 1) gap = " ".repeat(Math.min(10, Math.floor(indent)));
  else if (typeof indent === "string") gap = indent.slice(0, 10);
  try {
    return serialize(value, gap, 0, []) ?? null;
  } catch {
    return null;
  }
}
