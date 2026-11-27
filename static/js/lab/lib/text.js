// Text helpers for Lab packs: slugify and fingerprint, which the Build diff pack
// (static/js/lab/packs/workbench/build-diff.js) imports. Pure code: it imports nothing and touches no DOM, storage or
// network, so it runs in a browser and in Node.
//
// Every text argument takes any value: null and undefined read as "", everything else is converted with String().
// Nothing here throws on bad input.

// Any value as text: null and undefined are "", and a value that cannot be converted is "".
function str(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

// Calls visit(byte) for every UTF-8 byte of the text. A lone surrogate is encoded as U+FFFD, as TextEncoder does.
function eachUtf8Byte(text, visit) {
  for (const char of str(text)) {
    let code = char.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) visit(code);
    else if (code < 0x800) {
      visit(0xc0 | (code >> 6));
      visit(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      visit(0xe0 | (code >> 12));
      visit(0x80 | ((code >> 6) & 0x3f));
      visit(0x80 | (code & 0x3f));
    } else {
      visit(0xf0 | (code >> 18));
      visit(0x80 | ((code >> 12) & 0x3f));
      visit(0x80 | ((code >> 6) & 0x3f));
      visit(0x80 | (code & 0x3f));
    }
  }
}

// ---------- identifiers ----------

const LATIN_FALLBACK = {
  "\u00DF": "ss",
  "\u00E6": "ae",
  "\u0153": "oe",
  "\u00F8": "o",
  "\u0111": "d",
  "\u0142": "l",
  "\u00FE": "th",
  "\u00F0": "d",
};

// A lower-case ASCII slug: accents are removed ("Crème Brûlée" is "creme-brulee"), apostrophes are dropped
// ("Don't" is "dont"), and every other run of characters that are not a-z or 0-9 becomes one separator, with none
// at the ends. Letters with no ASCII form are dropped, so the result can be "". A separator that is not text is "-".
export function slugify(text, separator = "-") {
  const joiner = typeof separator === "string" ? separator : "-";
  return str(text)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .replace(/[\u00DF\u00E6\u0153\u00F8\u0111\u0142\u00FE\u00F0]/g, (char) => LATIN_FALLBACK[char])
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(joiner);
}

// ---------- change detection ----------

// The FNV-1a 32-bit hash of the text's UTF-8 bytes as 8 lower-case hex digits ("811c9dc5" for ""). It is a quick
// change detector for equal-or-not checks, not a cryptographic hash.
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  eachUtf8Byte(text, (byte) => {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  });
  return hash.toString(16).padStart(8, "0");
}
