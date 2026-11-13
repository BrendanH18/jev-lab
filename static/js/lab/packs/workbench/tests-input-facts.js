// State, picture and bookkeeping facts for the saved tests on the Workbench Tests tab ("workbench.tests.items"; contract
// in static/js/lab/surfaces/workbench-tests.js). Everything is read from the saved file and the page's clock-free fields:
// no run is needed and no answer is read. Server rules are ported, not guessed: picture uses follow jev/images.py
// _uses (longest reference first, no overlaps, every string of the state and the questions), loadable pictures follow
// jev/workbench.py item_image (a stored name <16 hex>.png|jpg, or one of the bundled samples), the ID slug follows
// jev/workbench.py slugify, and "Key: value" lines follow jev/lint.py _KEY_VALUE.
// Facts return counts, flags and fixed-vocabulary categories (plus the ID's first word and the UTC save month), never
// state text, field names, notes or picture names, so the Lab facts CSV carries no authored content.
import { definePack } from "../../kit.js";
import { depth } from "../../lib/json.js";
import { codePoints, findEmails, findUrls, lineCount, wordCount } from "../../lib/text.js";

// jev/images.py SAMPLES: the bundled sample pictures a saved test may name.
const SAMPLES = new Set(["torn-bag", "intact-bag", "crushed-box", "grinder-ok"]);
const STORED = /^[0-9a-f]{16}\.(?:png|jpg)$/;
const KEY_VALUE = /^\s*[A-Z][\p{L}\p{N}_ ./-]{0,30}:[ \t]+\S/gmu;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const textOf = (value) => (typeof value === "string" ? value : "");
const isContainer = (value) => Array.isArray(value) || isObject(value);
const imagesOf = (item) => (Array.isArray(item?.images) ? item.images.filter(isObject) : []);
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter(isObject) : []);
const savedDate = (item) => (typeof item?.saved_ms === "number" && Number.isFinite(item.saved_ms) ? new Date(item.saved_ms) : null);

// Every string value in a state (object keys are not values), the state itself when it is text.
function stateStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const child of value) stateStrings(child, out);
  else if (isObject(value)) for (const child of Object.values(value)) stateStrings(child, out);
  return out;
}

// Whether a container holds null, a blank string, [] or {} anywhere below its root.
function holdsEmpty(value) {
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (child === null || (typeof child === "string" && child.trim() === "")) return true;
    if (isContainer(child) && (Object.keys(child).length === 0 || holdsEmpty(child))) return true;
  }
  return false;
}

// The page gives structured instructions and descriptions as JSON text; the server reads only the strings inside them
// (field names are not request text), so a JSON object or list is read back into its string values.
function valueStrings(text) {
  const value = textOf(text);
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isContainer(parsed)) return stateStrings(parsed);
    } catch { /* plain text */ }
  }
  return [value];
}

// The texts a picture reference can appear in, as jev/images.py _strings reads the request: string values of the
// state, and every string value of each question (its type, instructions and criteria descriptions).
function requestTexts(item) {
  return [...stateStrings(item?.state ?? null), ...questionsOf(item).flatMap((question) => [textOf(question.type),
    ...valueStrings(question.instructions),
    ...(Array.isArray(question.criteria) ? question.criteria.flatMap((criterion) => valueStrings(criterion?.text)) : [])])];
}

// jev/images.py _uses: each occurrence of a reference, scanning left to right without overlaps and trying longer
// references first, so `photo1` is not also counted inside `photo12`.
function pictureUses(item) {
  const refs = [...new Set(imagesOf(item).map((image) => textOf(image.ref)).filter(Boolean))].sort((a, b) => b.length - a.length);
  const uses = new Map(refs.map((ref) => [ref, 0]));
  if (!refs.length) return uses;
  const pattern = new RegExp(refs.map((ref) => ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  for (const text of requestTexts(item)) for (const match of text.matchAll(pattern)) uses.set(match[0], uses.get(match[0]) + 1);
  return uses;
}

// A host or email domain outside the reserved .example top-level domain.
const outside = (host) => { const value = host.toLowerCase().replace(/\.$/, ""); return value !== "example" && !value.endsWith(".example"); };
const urlHost = (url) => url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/^[^@]*@/, "").replace(/:\d*$/, "");

// jev/workbench.py slugify: lower case, every run of characters outside a-z and 0-9 becomes "-", hyphens trimmed,
// then cut to 60 characters.
const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const ownName = (item) => { const name = textOf(item?.name); return name.trim() !== "" && name !== textOf(item?.id); };

export default definePack({
  id: "tests-input-facts",
  surface: "workbench.tests.items",
  title: "Saved test input and bookkeeping facts",
  about: "Per-test facts about the saved input, pictures and file bookkeeping: state structure and size measures, notes length, picture uses, sources and problems, contact details outside .example, name and ID shape, save month and weekday, all from the saved files without a run. Values are counts, flags and fixed categories only, never state text, field names, notes or picture names.",
  features: [
    { id: "top_level_entries", kind: "fact", type: "number", label: "top-level state entries", unit: "entries",
      help: "Fields of a JSON object state or entries of a JSON list state; unknown for a text state.",
      value: (item) => (Array.isArray(item?.state) ? item.state.length : isObject(item?.state) ? Object.keys(item.state).length : null) },
    { id: "state_depth", kind: "fact", type: "number", label: "state nesting depth", unit: "levels",
      help: "How deeply objects and lists nest: 0 for a text state, 1 for a flat object or list. Unknown when the file has no state.",
      value: (item) => (item?.state === null || item?.state === undefined ? null : depth(item.state)) },
    { id: "state_lines", kind: "fact", type: "number", label: "lines of a text state", unit: "lines",
      help: "Line count of a plain-text state; unknown for a JSON state.",
      value: (item) => (typeof item?.state === "string" ? lineCount(item.state) : null) },
    { id: "state_words", kind: "fact", type: "number", label: "words in the state", unit: "words",
      help: "Whitespace-separated words of a text state, or of every string value in a JSON state (field names left out). Unknown when the file has no state.",
      value: (item) => (item?.state === null || item?.state === undefined ? null : stateStrings(item.state).reduce((sum, text) => sum + wordCount(text), 0)) },
    { id: "notes_characters", kind: "fact", type: "number", label: "notes characters", unit: "characters",
      help: "Unicode characters in the saved notes (the server keeps at most 2,000).",
      value: (item) => codePoints(textOf(item?.notes)) },
    { id: "picture_uses", kind: "fact", type: "number", label: "picture uses in the request", unit: "uses",
      help: "How many times the picture references occur in the state and the questions, counted as jev/images.py does. The server attaches a picture once per use.",
      value: (item) => [...pictureUses(item).values()].reduce((sum, count) => sum + count, 0) },

    { id: "empty_state_values", kind: "fact", type: "flag", label: "an empty value in the state",
      help: "A JSON state holds null, a blank string, [] or {} somewhere below its top level.",
      value: (item) => isContainer(item?.state) && holdsEmpty(item.state) },
    { id: "key_value_lines", kind: "fact", type: "flag", label: "Key: value lines in a text state",
      help: "A text state with two or more \"Key: value\" lines, which jev/lint.py suggests turning into JSON fields.",
      value: (item) => typeof item?.state === "string" && [...item.state.matchAll(KEY_VALUE)].length >= 2 },
    { id: "contacts_outside_example", kind: "fact", type: "flag", label: "an email or web address outside .example",
      help: "The state or the notes hold an email address or web address whose domain is not under the reserved .example domain. Fictional test data should use .example.",
      value: (item) => [...stateStrings(item?.state ?? null), textOf(item?.notes)].some((text) =>
        findEmails(text).some((email) => outside(email.slice(email.indexOf("@") + 1))) || findUrls(text).some((url) => outside(urlHost(url)))) },
    { id: "box_without_picture", kind: "fact", type: "flag", label: "a box question without a picture",
      help: "The test asks a Box question but saves no picture, so a Box answer has nothing to point at.",
      value: (item) => questionsOf(item).some((question) => question.type === "box") && imagesOf(item).length === 0 },
    { id: "unused_picture", kind: "fact", type: "flag", label: "a picture the request never mentions",
      help: "A saved picture reference that occurs nowhere in the state or the questions (longer references are matched first).",
      value: (item) => [...pictureUses(item).values()].some((count) => count === 0) },
    { id: "unloadable_picture", kind: "fact", type: "flag", label: "a picture reference the run cannot load",
      help: "A stored file name other than <16 hex>.png or .jpg, a sample name that is not bundled, or neither. Whether a stored file is still on disk is not checked here.",
      value: (item) => imagesOf(item).some((image) => (image.file ? !STORED.test(image.file) : image.sample ? !SAMPLES.has(image.sample) : true)) },
    { id: "name_is_id", kind: "fact", type: "flag", label: "no name of its own",
      help: "The test has no name, a blank one, or one equal to its ID.",
      value: (item) => !ownName(item) },
    { id: "id_not_name_slug", kind: "fact", type: "flag", label: "an id that is not its name's slug",
      help: "The ID differs from the slug the server makes from the current name, as after a rename or a hand-chosen ID. Tests without a name of their own are left out.",
      value: (item) => ownName(item) && slug(item.name) !== textOf(item.id) },
    { id: "open_in_build", kind: "fact", type: "flag", label: "the test open in Build",
      help: "The saved test currently loaded in the Build tab.",
      value: (item, ctx) => typeof ctx?.data?.editing_id === "string" && ctx.data.editing_id === item?.id },
    { id: "no_saved_time", kind: "fact", type: "flag", label: "no readable save time",
      help: "saved_at is missing or not a real UTC time, so age and date facts are unknown; usually a hand-edited or copied file.",
      value: (item) => savedDate(item) === null },

    { id: "picture_source", kind: "fact", type: "category", label: "picture source",
      help: "none, samples (bundled pictures), uploads (stored files) or samples + uploads. Unknown when no reference names either.",
      value: (item) => {
        const images = imagesOf(item);
        if (!images.length) return "none";
        const kinds = new Set(images.map((image) => (image.file ? "uploads" : image.sample ? "samples" : null)).filter(Boolean));
        return kinds.size ? [...kinds].sort().join(" + ") : null;
      } },
    { id: "id_family", kind: "fact", type: "category", label: "id family",
      help: "The ID up to its first hyphen, grouping tests such as refund-routing and refund-photo.",
      value: (item) => textOf(item?.id).split("-")[0] || null },
    { id: "saved_month", kind: "fact", type: "category", label: "month last saved",
      help: "YYYY-MM of saved_at in UTC. saved_at is rewritten on every save.",
      value: (item) => savedDate(item)?.toISOString().slice(0, 7) ?? null },
    { id: "saved_weekday", kind: "fact", type: "category", label: "weekday last saved",
      help: "The UTC weekday of saved_at.",
      value: (item) => { const date = savedDate(item); return date ? WEEKDAYS[date.getUTCDay()] : null; } },
  ],
});
