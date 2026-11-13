// JSON helpers for Lab packs: stable text, shape measures, paths, flattening, diffs and duplicate-key detection.
// Pure code: it imports nothing and touches no DOM, storage or network.
//
// The domain is JSON values, what JSON.parse returns: null, booleans, numbers, strings, arrays and plain objects.
// A "container" is an array or a plain object; every other value (a Date, a Map, undefined) is a leaf. A "leaf" of a
// document is a value that is not a container, or a container that is empty, so {} and [] survive flatten/unflatten.
//
// Paths name a node the way JavaScript would: a dot for an object key that is an identifier (a letter or underscore,
// then letters, digits and underscores), ["key"] with JSON string quoting for any other key, and [n] for an array
// index. The root is "". Examples: a.b[0], ["my key"].x, [2].name, [""]. Functions that take a path accept that text
// or an array of segments (strings for keys, whole numbers for indexes). A number segment only addresses an array
// and a string segment only addresses an object, so {"0": 1} is reached with ["0"], not [0].
//
// Nothing here mutates its arguments. An argument outside a function's domain gives null (getPath gives undefined for
// a missing node); nothing throws on bad input. Cyclic structures are outside the domain: they never loop forever,
// but the cyclic part is skipped or kept by reference.

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_AT = /[A-Za-z_][A-Za-z0-9_]*/y;

// Any value as text: null and undefined are "", and a value that cannot be converted is "".
function str(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try { return String(value); } catch { return ""; }
}

// Sets an own property, even for the key "__proto__", which plain assignment would treat as the prototype.
function setOwn(object, key, value) {
  if (key === "__proto__") Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
  else object[key] = value;
}

const keyPath = (parent, key) => (IDENTIFIER.test(key) ? (parent === "" ? key : `${parent}.${key}`) : `${parent}[${JSON.stringify(key)}]`);
const indexPath = (parent, index) => `${parent}[${index}]`;
const isSegment = (segment) => typeof segment === "string" || (Number.isSafeInteger(segment) && segment >= 0);

// ---------- kinds of value ----------

// True for an object whose prototype is Object.prototype or null: {} and Object.create(null), and what JSON.parse
// returns for {...}. False for arrays, null, Dates, Maps, class instances and everything that is not an object.
export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const isContainer = (value) => Array.isArray(value) || isPlainObject(value);
const isEmpty = (container) => (Array.isArray(container) ? container.length === 0 : Object.keys(container).length === 0);
const isLeaf = (value) => !isContainer(value) || isEmpty(value);

// The JSON type of a value: "null", "array", "object", "string", "number" or "boolean". Every object that is not an
// array is "object", and NaN and Infinity are "number". null for values JSON has no type for: undefined, functions,
// symbols and bigints.
export function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "object" || type === "string" || type === "number" || type === "boolean" ? type : null;
}

// ---------- paths ----------

// The path text for an array of segments: formatPath(["a", "b", 0]) is "a.b[0]", formatPath([]) is "". null when
// segments is not an array or holds anything but strings and whole numbers >= 0.
export function formatPath(segments) {
  if (!Array.isArray(segments) || !segments.every(isSegment)) return null;
  return segments.reduce((path, segment) => (typeof segment === "number" ? indexPath(path, segment) : keyPath(path, segment)), "");
}

// The segments of a path: parsePath("a.b[0]") is ["a", "b", 0], parsePath('["my key"].x') is ["my key", "x"],
// parsePath("") is []. An array of segments comes back as a checked copy. null for anything malformed ("a..b",
// "a[", "a[01]", "[-1]", ".a", "a b") or not a string or array.
export function parsePath(path) {
  if (Array.isArray(path)) return path.every(isSegment) ? path.slice() : null;
  if (typeof path !== "string") return null;
  const segments = [];
  let index = 0;
  while (index < path.length) {
    if (path[index] === "[" && path[index + 1] === '"') {
      let end = index + 2;
      while (end < path.length && path[end] !== '"') end += path[end] === "\\" ? 2 : 1;
      if (end >= path.length || path[end + 1] !== "]") return null;
      try { segments.push(JSON.parse(path.slice(index + 1, end + 1))); } catch { return null; }
      index = end + 2;
    } else if (path[index] === "[") {
      const close = path.indexOf("]", index);
      const digits = close === -1 ? "" : path.slice(index + 1, close);
      if (!/^(?:0|[1-9]\d*)$/.test(digits) || !Number.isSafeInteger(Number(digits))) return null;
      segments.push(Number(digits));
      index = close + 1;
    } else {
      if (path[index] === "." ? index === 0 : index !== 0) return null;
      NAME_AT.lastIndex = index === 0 ? 0 : index + 1;
      const match = NAME_AT.exec(path);
      if (!match) return null;
      segments.push(match[0]);
      index = NAME_AT.lastIndex;
    }
  }
  return segments;
}

// The value at a path, or undefined when the path is malformed or any step is missing: a key the object does not
// own, an index past the end, a key on an array, an index on an object, or a step into a leaf. getPath(value, "")
// is the value itself. Inherited properties such as "constructor" and "length" are never read.
export function getPath(value, path) {
  const segments = parsePath(path);
  if (!segments) return undefined;
  let node = value;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(node) || segment >= node.length) return undefined;
    } else if (node === null || typeof node !== "object" || Array.isArray(node) || !hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

function setAt(node, segments, depth, next) {
  if (depth === segments.length) return next;
  const segment = segments[depth];
  if (typeof segment === "number") {
    const copy = Array.isArray(node) ? node.slice() : [];
    while (copy.length < segment) copy.push(null);
    copy[segment] = setAt(copy[segment], segments, depth + 1, next);
    return copy;
  }
  const copy = isPlainObject(node) ? { ...node } : {};
  setOwn(copy, segment, setAt(hasOwn(copy, segment) ? copy[segment] : undefined, segments, depth + 1, next));
  return copy;
}

// A copy of the value with the node at the path set to next. Only the containers along the path are copied; the
// rest is shared with the original, which is never changed. Missing steps are created (an object for a key, an array
// for an index), a value in the way that is not the right kind of container is replaced by one, and an index past
// the end fills the gap with null. setPath(value, "", next) is next. null when the path is malformed.
export function setPath(value, path, next) {
  const segments = parsePath(path);
  return segments ? setAt(value, segments, 0, next) : null;
}

function deleteAt(node, segments, depth) {
  const segment = segments[depth];
  const last = depth === segments.length - 1;
  if (typeof segment === "number") {
    if (!Array.isArray(node) || segment >= node.length) return node;
    if (last) return node.filter((_item, index) => index !== segment);
    const child = deleteAt(node[segment], segments, depth + 1);
    if (child === node[segment]) return node;
    const copy = node.slice();
    copy[segment] = child;
    return copy;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node) || !hasOwn(node, segment)) return node;
  const copy = { ...node };
  if (last) delete copy[segment];
  else {
    const child = deleteAt(node[segment], segments, depth + 1);
    if (child === node[segment]) return node;
    setOwn(copy, segment, child);
  }
  return copy;
}

// A copy of the value without the node at the path: an object key is removed, an array element is removed and the
// later elements move down. The original is never changed, and when the path names nothing the same value comes
// back. deletePath(value, "") is undefined (the whole document is gone). null when the path is malformed.
export function deletePath(value, path) {
  const segments = parsePath(path);
  if (!segments) return null;
  return segments.length ? deleteAt(value, segments, 0) : undefined;
}

// ---------- shape ----------

// Calls visit(path, value) for every node, the root first (path ""), then depth-first in document order: object keys
// in their own order, array elements by index. When visit returns false the children of that node are skipped.
// Returns the number of nodes visited, or null when visit is not a function. A container met again inside itself (a
// cycle) is visited but not entered.
export function walk(value, visit) {
  if (typeof visit !== "function") return null;
  const open = [];
  let count = 0;
  const step = (node, path) => {
    count += 1;
    if (visit(path, node) === false || !isContainer(node) || open.includes(node)) return;
    open.push(node);
    if (Array.isArray(node)) for (let index = 0; index < node.length; index += 1) step(node[index], indexPath(path, index));
    else for (const key of Object.keys(node)) step(node[key], keyPath(path, key));
    open.pop();
  };
  step(value, "");
  return count;
}

// How deeply containers nest: 0 for a value that is not a container, 1 for [] and {} and for a container of plain
// values, 2 for { a: [1] }, and so on.
export function depth(value) {
  const open = [];
  const step = (node) => {
    if (!isContainer(node) || open.includes(node)) return 0;
    open.push(node);
    let deepest = 0;
    for (const child of Array.isArray(node) ? node : Object.values(node)) deepest = Math.max(deepest, step(child));
    open.pop();
    return deepest + 1;
  };
  return step(value);
}

// The number of leaves: values that are not containers, plus empty containers. 1 for a lone value such as 5, null,
// {} or []; 3 for { a: 1, b: [2, {}] }. Always the length of listPaths(value).
export function countLeaves(value) {
  let count = 0;
  walk(value, (_path, node) => { if (isLeaf(node)) count += 1; });
  return count;
}

// The size in bytes of the value as compact JSON text encoded as UTF-8 (what JSON.stringify(value) would take to
// store or send). null for a value JSON cannot serialize: undefined, a function, a bigint or a cycle.
export function byteSize(value) {
  let text;
  try { text = JSON.stringify(value); } catch { return null; }
  if (typeof text !== "string") return null;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && text.charCodeAt(index + 1) >= 0xDC00 && text.charCodeAt(index + 1) <= 0xDFFF) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

// The paths of the leaves in document order. [""] for a lone value or an empty container;
// ["a", "b[0]", "b[1].c"] for { a: 1, b: [2, { c: 3 }] }.
export function listPaths(value) {
  const out = [];
  walk(value, (path, node) => { if (isLeaf(node)) out.push(path); });
  return out;
}

// The value as one flat object from leaf path to leaf, in document order: { a: { b: [1, {}] } } is
// { "a.b[0]": 1, "a.b[1]": {} }. A lone value or empty container is { "": value }. unflatten reverses it.
export function flatten(value) {
  const out = {};
  walk(value, (path, node) => { if (isLeaf(node)) setOwn(out, path, node); });
  return out;
}

function copyDeep(value, sort, open) {
  if (!isContainer(value) || open.includes(value)) return value;
  open.push(value);
  let out;
  if (Array.isArray(value)) out = Array.from(value, (item) => copyDeep(item, sort, open));
  else {
    out = {};
    const keys = Object.keys(value);
    for (const key of sort ? keys.sort() : keys) setOwn(out, key, copyDeep(value[key], sort, open));
  }
  open.pop();
  return out;
}

// The value rebuilt from a flat { path: leaf } object, the reverse of flatten. A key step makes an object and an
// index step makes an array; an index past the end fills the gap with null; a later entry replaces an earlier one
// that is in its way; leaves are copied, so the result shares nothing with flat. {} for an empty flat object. null
// when flat is not a plain object or a path is malformed.
export function unflatten(flat) {
  if (!isPlainObject(flat)) return null;
  const paths = Object.keys(flat);
  if (!paths.length) return {};
  let root;
  const place = (node, segment, value) => {
    if (typeof segment === "number") {
      while (node.length < segment) node.push(null);
      node[segment] = value;
    } else setOwn(node, segment, value);
  };
  const fits = (node, segment) => (typeof segment === "number" ? Array.isArray(node) : isPlainObject(node));
  for (const path of paths) {
    const segments = parsePath(path);
    if (!segments) return null;
    const leaf = copyDeep(flat[path], false, []);
    if (!segments.length) { root = leaf; continue; }
    if (!fits(root, segments[0])) root = typeof segments[0] === "number" ? [] : {};
    let node = root;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) { place(node, segment, leaf); return; }
      const following = segments[index + 1];
      let child = typeof segment === "number" || hasOwn(node, segment) ? node[segment] : undefined;
      if (!fits(child, following)) {
        child = typeof following === "number" ? [] : {};
        place(node, segment, child);
      }
      node = child;
    });
  }
  return root;
}

// ---------- copies ----------

// A deep copy with the keys of every plain object in sorted order (UTF-16 code unit order, as Array.prototype.sort
// gives); arrays keep their order. Values that are not containers are shared, not copied. JavaScript always lists
// keys that look like array indexes ("0", "10") first and in numeric order, whatever order they are added in.
export function sortKeys(value) {
  return copyDeep(value, true, []);
}

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
  try { return serialize(value, gap, 0, []) ?? null; } catch { return null; }
}

// A new object with only the listed keys that the object owns, in the order listed (a key listed twice appears
// once). null when object is not a plain object or keys is not an array.
export function pick(object, keys) {
  if (!isPlainObject(object) || !Array.isArray(keys)) return null;
  const out = {};
  for (const key of keys.map(str)) if (hasOwn(object, key)) setOwn(out, key, object[key]);
  return out;
}

// A new object with every own key except the listed ones, in the object's own order. null when object is not a
// plain object or keys is not an array.
export function omit(object, keys) {
  if (!isPlainObject(object) || !Array.isArray(keys)) return null;
  const drop = new Set(keys.map(str));
  const out = {};
  for (const key of Object.keys(object)) if (!drop.has(key)) setOwn(out, key, object[key]);
  return out;
}

// ---------- comparison ----------

function equal(a, b, open) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime() || (Number.isNaN(a.getTime()) && Number.isNaN(b.getTime()));
  const list = Array.isArray(a);
  if (list !== Array.isArray(b) || (!list && !(isPlainObject(a) && isPlainObject(b))) || open.includes(a)) return false;
  open.push(a);
  let same;
  if (list) same = a.length === b.length && a.every((item, index) => equal(item, b[index], open));
  else {
    const keys = Object.keys(a);
    same = keys.length === Object.keys(b).length && keys.every((key) => hasOwn(b, key) && equal(a[key], b[key], open));
  }
  open.pop();
  return same;
}

// True when the two values are the same JSON: arrays equal element by element, plain objects equal key by key in any
// key order, everything else by ===, with NaN equal to NaN and 0 equal to -0. Two Dates are equal when their times
// are. A key holding undefined is not the same as a missing key. Other objects (Maps, class instances) are equal
// only to themselves, and a cyclic value is equal only to itself.
export function deepEqual(a, b) {
  return equal(a, b, []);
}

// The differences that turn before into after, as [{ path, kind, before, after }] with kind "added", "removed" or
// "changed". Two plain objects are compared key by key (keys in sorted order) and two arrays index by index (no
// reordering is detected: an insertion at the front shows as changes plus one added element). Any other pair that is
// not deepEqual is one "changed" entry at that path, so a whole added or removed subtree is one entry. before is
// undefined for "added" and after is undefined for "removed". [] when the values are deepEqual. Entries come in path
// order: depth-first, object keys sorted, array indexes ascending.
export function diffValues(before, after) {
  const out = [];
  const open = [];
  const step = (a, b, path) => {
    const lists = Array.isArray(a) && Array.isArray(b);
    if (!lists && !(isPlainObject(a) && isPlainObject(b))) {
      if (!equal(a, b, [])) out.push({ path, kind: "changed", before: a, after: b });
      return;
    }
    if (open.includes(a)) return;
    open.push(a);
    const pair = (inA, inB, key, child) => {
      if (inA && inB) step(a[key], b[key], child);
      else if (inA) out.push({ path: child, kind: "removed", before: a[key], after: undefined });
      else out.push({ path: child, kind: "added", before: undefined, after: b[key] });
    };
    if (lists) for (let index = 0; index < Math.max(a.length, b.length); index += 1) pair(index < a.length, index < b.length, index, indexPath(path, index));
    else for (const key of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) pair(hasOwn(a, key), hasOwn(b, key), key, keyPath(path, key));
    open.pop();
  };
  step(before, after, "");
  return out;
}

function merge(a, b, open) {
  if (b === undefined) return copyDeep(a, false, []);
  if (!isPlainObject(a) || !isPlainObject(b) || open.includes(a)) return copyDeep(b, false, []);
  open.push(a);
  const out = {};
  for (const key of Object.keys(a)) setOwn(out, key, hasOwn(b, key) ? merge(a[key], b[key], open) : copyDeep(a[key], false, []));
  for (const key of Object.keys(b)) if (!hasOwn(a, key) && b[key] !== undefined) setOwn(out, key, copyDeep(b[key], false, []));
  open.pop();
  return out;
}

// b merged over a, as a new deep copy: where both sides are plain objects their keys are merged, recursively (a's
// keys first, then b's new ones); anywhere else b's value replaces a's, so arrays are replaced, not joined, and null
// replaces. An undefined in b means "no change" and keeps a's value. Neither argument is changed.
export function mergeDeep(a, b) {
  return merge(a, b, []);
}

// ---------- JSON text ----------

// The paths of the object keys that are written more than once in JSON text, where JSON.parse silently keeps only
// the last value. Each repeated key is listed once per object, at the path the key has ("a.b" when "b" is repeated
// inside the object at "a", "items[1].id" inside an array), in the order the repeats appear. Keys are compared after
// decoding, so "a" and its escaped spelling are the same key. [] when no key repeats. null when the text is not
// valid JSON.
export function duplicateKeys(text) {
  const source = str(text);
  try { JSON.parse(source); } catch { return null; }
  const out = [];
  const stack = [];
  const childPath = () => {
    const top = stack[stack.length - 1];
    if (!top) return "";
    return top.keys ? keyPath(top.path, top.key) : indexPath(top.path, top.index);
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const top = stack[stack.length - 1];
    if (char === "{") stack.push({ path: childPath(), keys: new Set(), reported: new Set(), key: "", expectKey: true });
    else if (char === "[") stack.push({ path: childPath(), keys: null, index: 0 });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && top) {
      if (top.keys) top.expectKey = true;
      else top.index += 1;
    } else if (char === '"') {
      let end = index + 1;
      while (end < source.length && source[end] !== '"') end += source[end] === "\\" ? 2 : 1;
      if (top && top.keys && top.expectKey) {
        const key = JSON.parse(source.slice(index, end + 1));
        if (!top.keys.has(key)) top.keys.add(key);
        else if (!top.reported.has(key)) {
          top.reported.add(key);
          out.push(keyPath(top.path, key));
        }
        top.key = key;
        top.expectKey = false;
      }
      index = end;
    }
    index += 1;
  }
  return out;
}
