import pack from "../../../static/js/lab/packs/workbench/tests-input-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsItemsCtx } from "./fixtures/workbench-tests.mjs";

const ctx = (overrides) => sampleTestsItemsCtx(overrides);
const T = Object.fromEntries(ctx({ filters: {} }).items().map((item) => [item.id, item]));
const R = T["refund-routing"], B = T["bean-quality"], D = T["damaged-bag-photo"], W = T["wholesale-inquiry"], L = T["latte-art-feedback"], U = T["unnamed-draft"];
// Items made by the real builder from hand-written raw saved tests (nothing run).
const made = (...raws) => ctx({ items: raws, results: null, filters: {} }).items();
const ASK = { late: { type: "noul", instructions: "Is the order late?" } };
const BOX = { tear: { type: "box", instructions: "Where is the tear in `photo-front`?" } };
const saved = (id, extra = {}) => ({ id, name: id, state: "Order HC-1042 from the Portside cafe", questions: ASK, ...extra });

const [KV, ONE_KV, NESTED, EMPTY_LIST, NULL_STATE] = made(
  // Lines "Order: HC-1042", "Customer: Dana", "notes: lower", "", "Thanks": two lines start with a capital key.
  saved("kv", { state: "Order: HC-1042\nCustomer: Dana\nnotes: lower\n\nThanks" }),
  saved("one-kv", { state: "Order: HC-1042 arrived late" }),
  // object > order object > items list > item object: depth 4; the blank note is an empty value.
  saved("nested", { state: { order: { items: [{ sku: "B-1", qty: 2 }] }, note: "" } }),
  saved("empty-list", { state: { tags: [], meta: { ref: null } } }),
  saved("null-state", { state: null }),
);
// .test is a reserved top-level domain like .example, so these addresses are fictional but outside .example.
const [LEAK_EMAIL, LEAK_URL, LEAK_NOTES, PORT_URL] = made(
  saved("leak-email", { state: { email: "dana@mail.test" } }),
  saved("leak-url", { state: "See https://harbor.example/menu and www.real-shop.test today" }),
  saved("leak-notes", { notes: "Ask ops@harbor-coffee.test about it" }),
  saved("port-url", { state: "Order at https://shop.harbor.example:8080/a or mail team@HARBOR.EXAMPLE" }),
);
const [BOX_NO_PICTURE, UNUSED, LONG_REF, BAD_FILE, UNKNOWN_SAMPLE, NEITHER, GOOD_FILE, MIXED_PICTURES] = made(
  saved("box-no-picture", { questions: BOX }),
  // photo-front: once in the state, once in the Box instructions; photo-back is never mentioned.
  saved("unused", { state: "See photo-front", questions: BOX, images: { "photo-front": { sample: "torn-bag" }, "photo-back": { sample: "intact-bag" } } }),
  // "photo12" is matched whole, so photo1 has no use of its own.
  saved("long-ref", { state: { picture: "photo12" }, images: { photo1: { sample: "torn-bag" }, photo12: { sample: "intact-bag" } } }),
  saved("bad-file", { images: { photo: { file: "../secret.png" } } }),
  saved("unknown-sample", { images: { photo: { sample: "latte-cup" } } }),
  saved("neither", { images: { photo: {} } }),
  saved("good-file", { images: { photo: { file: "0123456789abcdef.png" } } }),
  saved("mixed-pictures", { images: { front: { sample: "torn-bag" }, back: { file: "fedcba9876543210.jpg" } } }),
);
// Reference values from jev/images.py count_uses run on the same requests: the server reads each question's type
// ("choice" counts once) and only the string values of structured instructions (a field name does not count).
const [TYPE_REF, KEY_REF] = made(
  saved("type-ref", { state: "see choice", questions: { q: { type: "choice", instructions: "Which?", criteria: { x: "X" } } },
    images: { choice: { sample: "torn-bag" } } }),
  saved("key-ref", { state: "see choice-a", questions: { q: { type: "choice", instructions: { "choice-a": "Which?" }, criteria: { x: "X" } } },
    images: { "choice-a": { sample: "torn-bag" } } }),
);
const [SELF_NAMED, BLANK_NAME, ACCENT_SERVER, ACCENT_NFKD, BAD_DATE, NO_ID] = made(
  saved("self-named"),
  saved("blank-name", { name: "   " }),
  // The server lowercases and replaces every run outside a-z0-9 with "-": "Crème brûlée notes" -> cr-me-br-l-e-notes.
  saved("cr-me-br-l-e-notes", { name: "Crème brûlée notes" }),
  saved("creme-brulee-notes", { name: "Crème brûlée notes" }),
  saved("bad-date", { saved_at: "2026-02-30T10:00:00Z" }),
  { name: "No id", state: "Draft", questions: ASK },
);

checkPack(pack, {
  top_level_entries: { items: [R, B, D, W, NESTED, LEAK_EMAIL, NULL_STATE], values: [null, 2, 2, 2, 2, 1, null] },
  state_depth: { items: [R, B, W, NESTED, NULL_STATE], values: [0, 1, 1, 4, null] },
  state_lines: { items: [R, KV, B, U], values: [1, 5, null, 1] },
  // Refund: "Hi, order HC-1042 arrived stale. Can I get a refund? Dana (dana@customer.example)" is 12 words. Bean: the
  // review's 8 words (2 is a number). Damaged: 7 + "photo". Wholesale: 6 + 7. Latte: 10. Nested: "B-1" and "" -> 1.
  state_words: { items: [R, B, D, W, L, U, NESTED, NULL_STATE], values: [12, 8, 8, 13, 10, 1, 1, null] },
  // Code points: refund's notes 47, damaged 30, latte "archived: replaced by the cafe survey" 37, none 0.
  notes_characters: { items: [R, B, D, L, U], values: [47, 0, 30, 37, 0] },
  // Damaged: "photo" once in the state and once in each question's instructions.
  picture_uses: { items: [D, R, UNUSED, LONG_REF, TYPE_REF, KEY_REF], values: [3, 0, 2, 1, 2, 1] },

  empty_state_values: { items: [NESTED, EMPTY_LIST, B, R, W, NULL_STATE], values: [true, true, false, false, false, false] },
  key_value_lines: { items: [KV, ONE_KV, R, B], values: [true, false, false, false] },
  contacts_outside_example: { items: [LEAK_EMAIL, LEAK_URL, LEAK_NOTES, R, W, PORT_URL, B], values: [true, true, true, false, false, false, false] },
  box_without_picture: { items: [BOX_NO_PICTURE, D, R, UNUSED], values: [true, false, false, false] },
  unused_picture: { items: [UNUSED, LONG_REF, D, R], values: [true, true, false, false] },
  unloadable_picture: { items: [BAD_FILE, UNKNOWN_SAMPLE, NEITHER, GOOD_FILE, D, R, MIXED_PICTURES], values: [true, true, true, false, false, false, false] },
  name_is_id: { items: [U, SELF_NAMED, BLANK_NAME, R, B], values: [true, true, true, false, false] },
  // Bean quality is named "Bean quality review"; the others match their names' slugs, and unnamed-draft has no name.
  id_not_name_slug: { items: [B, ACCENT_NFKD, R, D, W, L, U, ACCENT_SERVER], values: [true, true, false, false, false, false, false, false] },
  open_in_build: { items: [B, R, D], values: [true, false, false], ctx: ctx({ editingId: "bean-quality", filters: {} }) },
  no_saved_time: { items: [W, U, BAD_DATE, R, L], values: [true, true, true, false, false] },

  picture_source: { items: [D, GOOD_FILE, MIXED_PICTURES, R, NEITHER], values: ["samples", "uploads", "samples + uploads", "none", null] },
  id_family: { items: [R, B, U, SELF_NAMED, NO_ID], values: ["refund", "bean", "unnamed", "self", null] },
  saved_month: { items: [R, B, D, L, W], values: ["2026-10", "2026-10", "2026-11", "2026-09", null] },
  // Weekdays from Python's datetime: 2026-10-01 and 2026-10-15 Thursday, 2026-11-02 Monday, 2026-09-20 Sunday.
  saved_weekday: { items: [R, B, D, L, W], values: ["Thursday", "Thursday", "Monday", "Sunday", null] },
}, { ctx: () => ctx() });
