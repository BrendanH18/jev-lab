// Lab surfaces of the Claims page (static/claims.html, static/js/claims.js): the orders a claim can be filed against,
// the example chips, and the result of the user's own latest check. Pure code: it imports only the kit, touches no DOM,
// storage or network, and is tested in Node (tests/js/lab/surface-demo-claims.test.mjs). Fixtures for pack tests:
// tests/js/lab/fixtures/claims.mjs (sampleClaimsOrdersCtx, sampleClaimsExamplesCtx, sampleClaimsResultCtx; starter
// packs: static/js/lab/packs/claims/). This header is the CONTRACT for packs on these three surfaces.
//
// All three ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) } and are built ONCE
// per page load. items(), shown() and every data field are read at call time, so a ctx never goes stale; read a data
// field when you need it and never keep a copy across renders. Items and data values are deeply frozen plain JSON:
// read them, never write to them. items() and shown() hand out the SAME item objects (compare by identity) until the
// list itself changes. No surface has replaceItems or importItems, so Edits (transform) and Paste to import
// (importer) do not render here: orders come from the shop's records (the shared server world, which Claims never
// writes), the examples are built-in scenarios (jev/claims.py EXAMPLES, which nothing may change), and the answers are
// model output, which no pack may rewrite or invent.
// Kinds all three surfaces host: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
// NO action on any surface calls the model or spends budget. The one paid call, "Check claim", is pressed by the user;
// no action presses it and none may be added by a pack.
//
// Shared shapes (used by several surfaces below):
//   POLICY  { damage_yes, damage_no, shows_order, matches_note, box_confidence, full_refund_at, auto_limit_usd }, all
//           numbers. Jev never sees the policy: it is plain code in jev/claims.py decide()/located().
//   LIMITS  data.limits, always present, in slider order: { key: { min, max, step, label, group } } for the page's
//           seven sliders: damage_yes / damage_no / shows_order / matches_note / box_confidence (0–1, step 0.05, group
//           "photo"), full_refund_at (0–3, step 0.1, "refund"), auto_limit_usd (0–400 USD, step 5, "refund").
//   RULES   data.rules, always present: { window_days: 30, box_pad: 0.05, note_chars: 2000 } — the refund window of
//           jev/world.py, the padding jev/claims.py adds to each side of a low-confidence box, and the server's cut of
//           the customer's note. Mirrors of the Python constants, kept in step by the surface test.
//   HISTORY data.history: this page load's answered checks, oldest first, newest 50 at most, memory only (gone on
//           reload); [] at first. One frozen entry per check:
//             { call         1-based number of the check in this page session
//               at           arrival time, epoch milliseconds
//               order        the order id the check was filed against
//               note         the customer's note exactly as the form held it (the server trims it and keeps 2,000 chars)
//               photo        { source: "sample" | "upload", name, about }: a sample's name ("torn-bag") and description,
//                            or an upload's file name with about "". Never the picture's bytes.
//               example      the label of the built-in example whose order, note and sample equal this check's, or null
//               answers      the raw answers of that call { qid: answer } (shapes under claims.result)
//               evidence     the evidence the server derived from them (shape under claims.result)
//               facts        the order facts the server used at check time (shape under claims.result)
//               decided      { decision, remedy, amount, policy }: the decision the server returned FOR THE POLICY IN
//                            THE SLIDERS WHEN THE CHECK WAS SENT (policy is that full POLICY). Moving a slider later
//                            re-decides only the shown check, never these.
//               meta         { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd, backend }
//                            measured by the server for that call; any field may be null
//               box_supported  boolean: the model answered the Box question }
//           data.calls is the number of answered checks since the page loaded (0 at first; can exceed history.length).
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "claims.orders"  —  builder claimsOrdersCtx(source)  —  the Order picker in the Claim panel
// ---------------------------------------------------------------------------------------------------------------
// The list is the orders of GET /api/claims/setup in page order (A-1041 … A-1045 today), loaded ONCE when the page
// opens: the Dispatch demo shares these orders and can refund one later, so a status here can be stale. A check
// always uses fresh facts (claims.result data.facts). items() is [] until the setup has loaded. The page has no
// filter of its own, so shown() is items() after Lab's filters and Lab's sort. The order <select> lists exactly the
// shown orders in that order, with "x of y orders shown" and a "Clear Lab filters and sort" button while a Lab setting
// is active. The SELECTED order always stays in the picker (a filter never changes the selection or clears a
// result): when Lab hides it, it is listed first, marked "hidden by Lab filters", and it is NOT in shown().
//
// Item (one order):
//   id                   string   the order id ("A-1042"). Unique. itemName() returns it.
//   position             number   1-based position in the setup's order list
//   items                string   what was ordered ("Conical burr grinder"); "" when missing
//   customer             string   the customer's name ("Luis Ortega"); "" when missing
//   total                number | null   the order total in USD
//   status               string   "delivered" | "in transit" | "processing" (as the shop records it; "" when missing)
//   delivered            boolean  status is "delivered"
//   days_since_delivery  number | null   whole days since delivery; null when not delivered
//   within_window        boolean | null  delivered and days_since_delivery <= data.rules.window_days; null when not
//                                 delivered (a claim on it is rejected, not windowed)
//   refunded             boolean  the order was already refunded (a claim on it is rejected)
//   selected             boolean  the picker holds this order now
//   checked              number   how many of THIS page session's answered checks were filed against it (0 at first)
//
// data (live getters):
//   selected   string | null   the id the picker holds now; null before setup
//   running    boolean         a check is on its way; the picker is disabled meanwhile
//   result_order string | null the order of the shown result (claims.result); null while no result is shown
//   settings   POLICY | null   the policy sliders now; null before setup
//   defaults   POLICY | null   the policy's default values; null before setup
//   limits     LIMITS;  rules  RULES;  calls  number;  history  HISTORY (all always present)
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render):
//   select(id)   what choosing that order in the picker does: the form switches to it and the shown result is cleared
//                (the verdict belongs to the order it was checked with). NO model call. Guards: the setup has loaded,
//                id names an item, and no check is running (the picker is disabled then). Choosing the order already
//                selected changes nothing and keeps the result. Returns the id.
//   focusOrder() moves the keyboard focus to the order picker. Guard: refuses while a check is running.
//
// refresh() re-renders the order picker (and Lab's note) from shown(); the note and photo keep their state.
//
// Content boundaries for claims.orders:
//   - Items are the shop's order records as the page loaded them: inputs, not answers. Exports may contain them and
//     say so. A pack must not present a fact derived from them (eligible, inside the window, a 50% credit amount) as
//     the page's decision: label it as plain arithmetic on the order record, advisory only.
//   - No pack refunds, edits or adds an order, and none runs a check.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "claims.examples"  —  builder claimsExamplesCtx(source)  —  the example chips above the Claim form
// ---------------------------------------------------------------------------------------------------------------
// The list is the built-in example claims of GET /api/claims/setup in page order (4 today: Torn bag, Intact bag,
// Crushed box, Grinder). items() is [] until the setup has loaded. The page has no filter of its own, so shown() is
// items() after Lab's filters and Lab's sort, and the page shows exactly those chips in that order (with "x of y
// examples shown" and a "Clear Lab filters and sort" button while a Lab setting is active; "No example matches the
// Lab filters." when none is left). Clicking a chip loads that example and clears the shown result.
//
// Item (one example claim; inputs and a hand-written expectation only, never an answer):
//   index          number   0-based position in the setup's examples: the argument of actions.use(index)
//   position       number   index + 1
//   label          string   the chip's text ("Torn bag"; "Example n" when the setup gives none). itemName() returns it.
//   order          string   the order id it files against ("A-1041"); "" when missing
//   sample         string   the sample picture's name ("torn-bag"); "" when missing
//   sample_about   string   that sample's description from the setup; "" when the sample is unknown
//   note           string   the customer's note exactly as the example holds it
//   chars          number   the note's length in Unicode code points
//   words          number   whitespace-separated words in the note (0 for a blank note)
//   expect         string | null   "approve" | "review" | "retake" | "reject": what a PERSON would decide, written by
//                           hand in jev/claims.py for scripts/validate.py. NOT Jev's answer and NOT the page's
//                           decision: never show it as either. null when the example has none.
//   loaded         boolean  the form holds exactly this example now (same order, note and sample picture)
//   checked        number   how many of THIS page session's answered checks used this example's order, note (after
//                           trimming) and sample. 0 before the first check. Session memory only.
//
// data (live getters):
//   samples   [{ name, about }]   the sample pictures from the setup, in page order; [] before setup
//   orders    the claims.orders items (same shape), so example facts can join an example to its order; [] before setup
//   draft     { order, note, photo } | null   what the form holds now (photo as in HISTORY, or null when none is
//             picked); null before setup. note is untrimmed.
//   loaded    number | null   the index of the first item whose loaded is true, else null
//   running   boolean;  labels { decisions: { approve: "Approve automatically", review: "Send to a person",
//             retake: "Ask for another photo", reject: "Reject claim" } };  calls number;  history HISTORY
//
// actions (each throws an Error with a message for the user when its guard refuses; one call per user press):
//   use(index)   what clicking that example's chip does: loads its order, note and sample photo and clears the shown
//                result. NO model call; the user still presses "Check claim". Guards: the setup has loaded, index is an
//                integer naming an item, and no check is running (the chips are disabled then).
//   focusNote()  moves the keyboard focus to the customer's note. Guard: refuses while a check is running.
//   focusRun()   moves the keyboard focus to the "Check claim" button so Enter runs the user's own check. It never
//                presses it. Guard: refuses while a check is running.
//
// refresh() re-renders the example chips (and Lab's note) from shown(); the form keeps its text and focus.
//
// Content boundaries for claims.examples:
//   - Items are built-in inputs plus hand-written expectations. Exports may contain them and must say so; they hold
//     no answers or decisions. "Matches the expectation" may only compare with a check the user ran (data.history),
//     labeled as this session's check.
//   - checked counts are this session's own checks; never store them or present them as more than that.
//   - No pack changes the examples, the sample pictures, the questions or the request, and none runs a check.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "claims.result"  —  builder claimsResultCtx(source)  —  the "Claim decision" panel
// ---------------------------------------------------------------------------------------------------------------
// The list is the answers of the CURRENT USER'S OWN latest check (the page's own Check claim call, one live call), one row per
// question in the response's order: shows_item, damage_visible (noul), severity (score 0–3), damage_kind (choice of
// 5), matches_note (noul) and damage_box (box; absent on models before Jev 1.14, so 5 rows then). items() is []
// before the first check of this page load and again whenever the page clears the result: choosing another order,
// example or photo, or editing the note (the answers belong to the inputs they were asked about). Moving a policy
// slider keeps the answers and re-decides through POST /api/claims/decide (plain code, no Jev call), which replaces
// data.verdict, data.location, data.evidence and data.policy (and each item's cuts and check).
// The page's "All N answers from the one call" cards are rendered from shown(): with Lab filters they show only the
// matching answers, in Lab's sort order, with "x of y answers shown" and a "Clear Lab filters and sort" button (the
// disclosure opens while a Lab setting is active). The decision, reasons, photo, checks and bars above the cards
// always show the whole result.
//
// Item (one answer row):
//   id             string   "shows_item" | "damage_visible" | "matches_note" | "severity" | "damage_kind" |
//                           "damage_box". Unique. itemName() returns it.
//   position       number   1-based position in the response's answer order
//   type           string   "noul" | "score" | "choice" | "box" as the API returned it ("" when missing)
//   instructions   string   the question text that was sent ("" when the request lacks it). For the Box it names the
//                           target ("the most visibly damaged part of the product or its packaging in `photo`").
//   value          string | number | null   choice: the chosen key; score: the score, a float 0–3; noul: P(yes)
//                           0–1; box and anything missing or odd: null
//   display        string   as the answer card prints it: "torn or open", "1.62 / 3", "97.0%", box "40% × 20%"
//                           (width × height); "" when nothing usable
//   label          string   choice: the page's kind label ("Torn or open"; the key with spaces when unknown);
//                           score: the legend text of the level nearest the score ("Partial: part of the product is
//                           spilled, broken, or unusable"); noul, box and missing: ""
//   scale          number | null   score only: the highest level (3)
//   probabilities  [{ key, p }]   choice: one per kind in response order; score: one per level "0".."3"; noul:
//                           [{ key: "yes", p }, { key: "no", p: 1 - p }] (a plain subtraction: compare with a
//                           tolerance); box: []. Entries whose probability is not a finite number are left out.
//   top            { key, p } | null   the entry with the highest p (the first one on a tie)
//   confidence     number | null   the answer's confidence field (score, choice, box); noul carries none: null
//   box            { left, top, right, bottom } | null   box only: the RAW edges Jev returned, fractions of the
//                           picture's width and height. What the page draws (hidden, padded) is data.location.
//   cuts           [{ key, at }]   the policy settings IN FORCE FOR THE SHOWN DECISION (data.policy) that read this
//                           answer in jev/claims.py: shows_item -> shows_order (passes at value >= at);
//                           damage_visible -> damage_no (retake below) and damage_yes (visible at >=); matches_note ->
//                           matches_note (passes at >=); severity -> full_refund_at (full refund at >=); damage_box ->
//                           box_confidence, which compares with item.CONFIDENCE (padded below), not the value;
//                           damage_kind -> [] (code never gates on it).
//   check          { id, ok, level, label, detail } | null   the plain-code check of data.verdict.checks that reads
//                           this answer: shows_item -> "shows_item", damage_visible -> "damage", matches_note ->
//                           "matches_note"; null for the others (severity moves the amount, which the "auto_limit"
//                           check reads; see data.verdict).
//   answer         object   the raw answer exactly as the server returned it
//
// data (live getters; null while no result is shown unless stated):
//   input      { order, note, photo, example }   what the shown check was made for (photo/example as in HISTORY)
//   facts      { order, items, total, status, refunded, days_since_delivery, customer }: the order facts the server
//              used at check time (days_since_delivery null when not delivered)
//   evidence   { shows_item, damage, severity, kind, kind_prob, kinds: [{ value, prob }] (top 3), matches_note }
//   location   where the page draws the damage box: { shown: false, reason } (model without Box) |
//              { shown: false, box, confidence, reason } (damage below damage_no: hidden) |
//              { shown: true, box (padded edges when padded), confidence, padded, tentative, reason (string|null) }
//   verdict    { decision: "approve"|"review"|"retake"|"reject", remedy: "full_refund"|"replacement_or_credit",
//              amount (USD), checks: [{ id, ok, level, label, detail }], reasons: [string] }: the page's decision
//   policy     POLICY: the full policy the shown decision was made under
//   settings   POLICY | null: the sliders now (null before setup). Briefly differs from data.policy while a
//              re-decide is on its way (120 ms after the last slider move).
//   defaults   POLICY | null (null before setup);  limits LIMITS;  rules RULES (always present)
//   changed    [key]   settings that differ from the defaults, in slider order; [] before setup (always present)
//   labels     { decisions, kinds, remedies }: { key: label } maps the page prints (always present)
//   questions  the questions of the shown check exactly as sent ({ id: { type, instructions, criteria? } })
//   meta       { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd, backend }: MEASURED by the
//              server for the shown call; treat every field as possibly missing
//   trace      what Inspect JSON shows: { request, response, meta }. The picture's bytes are already replaced by a
//              "<JPEG 640x480, 18 KB, omitted from this view>" placeholder; request.state never holds the policy.
//   image      { format, width, height, bytes } of the picture the server sent (fields may be missing)
//   box_supported  boolean | null: the model answered the Box question
//   note       string   the page's re-decide note ("Re-decided in 3 ms · no Jev call"); "" when none (always present)
//   running    boolean;  calls number;  history HISTORY   (always present)
//
// actions (each throws an Error with a message for the user when its guard refuses; one call per user press):
//   setPolicy(changes)  moves policy sliders exactly as dragging them does, then re-decides the shown answers through
//                       POST /api/claims/decide: plain code, NO model call. changes is { key: number }. Guards: the
//                       setup has loaded; every key is one of data.limits; every value is a finite number inside the
//                       slider's range and on its step grid. The sliders have no cross-constraints and neither has
//                       this. Returns the policy now in the sliders (frozen); a change that moves nothing returns it
//                       without re-deciding. Works without a result too (the sliders always move).
//   resetPolicy()       the page's "Reset to defaults" button: same re-decide, no model call. Guard: setup loaded.
//   focusPolicy(key)    moves the keyboard focus to that slider. Guard: key is one of data.limits.
//   inspect()           opens the page's Inspect JSON drawer on the shown check. Guard: refuses with no check shown.
//
// refresh() re-renders the answer cards from shown().
//
// Content boundaries for claims.result:
//   - Everything in items(), verdict, meta, trace and history comes from a check the current user ran in this page
//     load. A pack may show, measure, compare and export it, labeled as the user's own check (and history entries as
//     earlier checks of this session, decided under the policy of their time). It never shows a made-up, sample,
//     remembered or predicted answer, never keeps answers beyond the page session, and never presents an earlier
//     check as the current one.
//   - Exports that hold the note, answers or probabilities say so in their label or help. An export of the policy
//     holds settings only. An export described as a request or a handoff carries state and questions, never answers.
//     Never put picture bytes in an export (the trace already omits them). CSV goes through csvText/csvCell.
//   - Metrics over meta are measurements of this session's calls; a projection (cost per thousand claims) is
//     arithmetic on a measured call and says so, never shown as spend.
//   - A rule a pack applies locally ("close to a cut", "would flip at") is advisory plain code, labeled as such and
//     never worded as Jev's answer or as the page's decision; the decision is data.verdict. A pack does not
//     re-implement decide(); to see a different policy's decision it moves the sliders through setPolicy.
//   - A raw box the policy hid (location.shown false) may be described only with that said ("hidden by the policy").
//   - The Box needs Jev 1.14+: every Box fact, metric and export treats a missing damage_box as unavailable.
//   - No pack changes the questions, the examples or the request. Nothing here holds the API key.
import { clone, toNumber } from "../kit.js";

const HISTORY_SHOWN = 50;
const EMPTY = Object.freeze([]);
const NONE = Object.freeze({});

// The page's seven policy sliders (static/js/claims.js renderPolicy), in slider order. The surface test keeps them in
// step with the page source and with DEFAULT_POLICY in jev/claims.py.
const LIMITS = deepFreeze({
  damage_yes: { min: 0, max: 1, step: 0.05, label: "Damage visible at P ≥", group: "photo" },
  damage_no: { min: 0, max: 1, step: 0.05, label: "Ask for another photo below P", group: "photo" },
  shows_order: { min: 0, max: 1, step: 0.05, label: "Photo shows the order at P ≥", group: "photo" },
  matches_note: { min: 0, max: 1, step: 0.05, label: "Matches the note at P ≥", group: "photo" },
  box_confidence: { min: 0, max: 1, step: 0.05, label: "Pad the box below confidence", group: "photo" },
  full_refund_at: { min: 0, max: 3, step: 0.1, label: "Full refund at severity ≥", group: "refund" },
  auto_limit_usd: { min: 0, max: 400, step: 5, label: "Automatic approval up to", group: "refund" },
});
// Mirrors of jev/world.py REFUND_WINDOW_DAYS, jev/claims.py BOX_PAD and the note cut in claims.check().
const RULES = deepFreeze({ window_days: 30, box_pad: 0.05, note_chars: 2000 });
// Which policy settings read each answer in jev/claims.py, and which verdict check reads it.
const CUTS = deepFreeze({ shows_item: ["shows_order"], damage_visible: ["damage_no", "damage_yes"], matches_note: ["matches_note"],
  severity: ["full_refund_at"], damage_kind: [], damage_box: ["box_confidence"] });
const CHECK_OF = Object.freeze({ shows_item: "shows_item", damage_visible: "damage", matches_note: "matches_note" });
const DECISIONS = deepFreeze({ approve: "Approve automatically", review: "Send to a person", retake: "Ask for another photo", reject: "Reject claim" });
const REMEDIES = deepFreeze({ full_refund: "Full refund", replacement_or_credit: "50% credit or a replacement" });

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plain = (value) => (typeof value === "string" ? value : "");
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value) ?? "");
const percent = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const labelMap = (value) => (isObject(value) ? Object.fromEntries(Object.entries(value).filter(([, label]) => typeof label === "string")) : {});
const wordsOf = (text) => text.split(/\s+/).filter(Boolean).length;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A frozen deep copy of plain JSON data (null for anything that is not an object or array).
const frozenCopy = (value) => (value && typeof value === "object" ? deepFreeze(clone(value)) : null);

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This page cannot do that here.");
  return source[name](...args);
}

const setupOf = (source) => {
  const setup = read(source, "setup", null);
  return isObject(setup) ? setup : null;
};
const running = (source) => read(source, "running", false) === true;

function shownOf(source, ctx, items) {
  const list = items.filter((item) => !source.matches || source.matches(item, ctx) !== false);
  const arranged = source.arrange ? source.arrange(list, ctx) : list;
  return Array.isArray(arranged) ? arranged : list;
}

// ---------- shared: the picture, examples, history ----------

// What the page records about a picked picture: never its bytes. image is the page's S.image (a sample
// { sample, url, about } or an upload { format, data_base64, width, height, url, name }); null when none.
export function claimsPhotoOf(image) {
  if (!isObject(image)) return null;
  if (typeof image.sample === "string" && image.sample) return { source: "sample", name: image.sample, about: plain(image.about) };
  return { source: "upload", name: plain(image.name), about: "" };
}

// The label of the built-in example whose order, note and sample equal these inputs, or null.
export function claimsExampleOf(input, examples) {
  if (!isObject(input) || !Array.isArray(examples)) return null;
  const photo = isObject(input.photo) ? input.photo : null;
  if (!photo || photo.source !== "sample") return null;
  const index = examples.findIndex((example) => isObject(example) && example.order === input.order && plain(example.note).trim() === plain(input.note).trim()
    && example.sample === photo.name);
  return index < 0 ? null : (plain(examples[index].label) || `Example ${index + 1}`);
}

const policyCopy = (value) => (isObject(value)
  ? Object.freeze(Object.fromEntries(Object.keys(LIMITS).filter((key) => finite(value[key]) !== null).map((key) => [key, value[key]]))) : null);

function metaOf(meta) {
  const value = isObject(meta) ? meta : {};
  const num = (key) => finite(value[key]);
  return { model: typeof value.model === "string" ? value.model : null, latency_ms: num("latency_ms"), question_count: num("question_count"),
    input_tokens: num("input_tokens"), output_tokens: num("output_tokens"), cost_usd: num("cost_usd"), backend: typeof value.backend === "string" ? value.backend : null };
}

const ENTRIES = new WeakMap();
function historyEntry(raw, examples) {
  const known = ENTRIES.get(raw);
  if (known && known.examples === examples) return known.entry;
  const input = isObject(raw.input) ? raw.input : {};
  const photo = isObject(input.photo) ? { source: input.photo.source === "sample" ? "sample" : "upload", name: plain(input.photo.name), about: plain(input.photo.about) } : null;
  const verdict = isObject(raw.verdict) ? raw.verdict : {};
  const entry = deepFreeze({
    call: finite(raw.call),
    at: finite(raw.at),
    order: plain(input.order),
    note: plain(input.note),
    photo,
    example: claimsExampleOf({ order: input.order, note: input.note, photo }, examples),
    answers: isObject(raw.answers) ? clone(raw.answers) : {},
    evidence: isObject(raw.evidence) ? clone(raw.evidence) : null,
    facts: isObject(raw.facts) ? clone(raw.facts) : null,
    decided: { decision: typeof verdict.decision === "string" ? verdict.decision : null, remedy: typeof verdict.remedy === "string" ? verdict.remedy : null,
      amount: finite(verdict.amount), policy: policyCopy(raw.policy) ? { ...policyCopy(raw.policy) } : null },
    meta: metaOf(raw.meta),
    box_supported: raw.box_supported === true,
  });
  ENTRIES.set(raw, { examples, entry });
  return entry;
}

function historyOf(source) {
  const list = read(source, "history", EMPTY);
  if (!Array.isArray(list)) return EMPTY;
  const examples = Array.isArray(setupOf(source)?.examples) ? setupOf(source).examples : EMPTY;
  return Object.freeze(list.filter(isObject).slice(-HISTORY_SHOWN).map((raw) => historyEntry(raw, examples)));
}

function callsOf(source, history) {
  const count = read(source, "calls", null);
  return Number.isInteger(count) && count >= 0 ? count : history.length;
}

// ---------- claims.orders ----------

function orderItem(raw, index, selected, history) {
  const status = plain(raw.status);
  const delivered = status === "delivered";
  const days = delivered ? finite(raw.days_since_delivery) : null;
  const id = plain(raw.id) || plain(raw.order) || `order-${index + 1}`;
  return { id, position: index + 1, items: plain(raw.items), customer: plain(raw.customer), total: finite(raw.total), status, delivered,
    days_since_delivery: days, within_window: delivered && days !== null ? days <= RULES.window_days : null, refunded: raw.refunded === true,
    selected: id === selected, checked: history.filter((entry) => entry.order === id).length };
}

function ordersOf(source, cache) {
  const orders = setupOf(source)?.orders;
  const selected = plain(read(source, "selected", ""));
  const history = historyOf(source);
  const parts = [orders, selected, history.length, history[history.length - 1]];
  if (!cache.key || cache.key.some((part, index) => part !== parts[index])) {
    cache.key = parts;
    cache.items = Array.isArray(orders) ? deepFreeze(orders.filter(isObject).map((raw, index) => orderItem(raw, index, selected, history))) : EMPTY;
  }
  return cache.items;
}

// source: {
//   setup: () => the GET /api/claims/setup response ({ orders, policy, samples, examples }) or null,
//   selected: () => the order id the picker holds,     running: () => boolean,     settings: () => the sliders' policy,
//   result: () => the shown result or null (only its facts.order is read),
//   history: () => [{ call, at, input, answers, evidence, facts, verdict, policy, meta, box_supported }],  calls: () => n,
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   select(id), focusOrder(), refresh()   the page's own operations
// }
export function claimsOrdersCtx(source = {}) {
  const cache = { key: null, items: EMPTY };
  const items = () => ordersOf(source, cache);
  const ctx = {
    items,
    shown: () => shownOf(source, ctx, items()),
    data: {
      get selected() { return setupOf(source) ? plain(read(source, "selected", "")) || null : null; },
      get running() { return running(source); },
      get result_order() {
        const result = read(source, "result", null);
        return isObject(result) && isObject(result.facts) && typeof result.facts.order === "string" ? result.facts.order : null;
      },
      get settings() { return setupOf(source) ? policyCopy(read(source, "settings", null)) : null; },
      get defaults() { return policyCopy(setupOf(source)?.policy); },
      get limits() { return LIMITS; },
      get rules() { return RULES; },
      get calls() { return callsOf(source, historyOf(source)); },
      get history() { return historyOf(source); },
    },
    actions: {
      select(id) {
        if (!setupOf(source)) throw new Error("The orders have not loaded yet.");
        const item = items().find((entry) => entry.id === id);
        if (!item) throw new Error(`There is no order "${asText(id)}" in the picker.`);
        if (running(source)) throw new Error("Wait for the check to finish before choosing another order.");
        if (item.selected) return item.id;
        call(source, "select", item.id);
        return item.id;
      },
      focusOrder() {
        if (running(source)) throw new Error("The order picker is disabled while a check runs.");
        return call(source, "focusOrder");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}

// ---------- claims.examples ----------

function draftOf(source) {
  const draft = read(source, "draft", null);
  if (!isObject(draft)) return null;
  return { order: plain(draft.order), note: plain(draft.note), photo: claimsPhotoOf(draft.image) };
}

function exampleItem(raw, index, samples, draft, history) {
  const note = plain(raw.note);
  const order = plain(raw.order);
  const sample = plain(raw.sample);
  const about = samples.find((entry) => isObject(entry) && entry.name === sample);
  const expect = ["approve", "review", "retake", "reject"].includes(raw.expect) ? raw.expect : null;
  const loaded = !!draft && draft.order === order && draft.note === note && draft.photo?.source === "sample" && draft.photo.name === sample;
  const checked = history.filter((entry) => entry.order === order && entry.note.trim() === note.trim() && entry.photo?.source === "sample" && entry.photo.name === sample).length;
  return { index, position: index + 1, label: plain(raw.label) || `Example ${index + 1}`, order, sample, sample_about: about ? plain(about.about) : "",
    note, chars: [...note].length, words: wordsOf(note), expect, loaded, checked };
}

// source: {
//   setup: () => the setup response or null,     draft: () => { order, note, image } (the page's S.order, S.note, S.image),
//   selected: () => the order id the picker holds (for data.orders),     running: () => boolean,
//   history: () => [...] as for claimsOrdersCtx,     calls: () => n,
//   matches, arrange   the Lab hooks for "claims.examples",
//   use(index), focusNote(), focusRun(), refresh()   the page's own operations
// }
export function claimsExamplesCtx(source = {}) {
  const cache = { key: null, items: EMPTY };
  const orderCache = { key: null, items: EMPTY };
  const items = () => {
    const setup = setupOf(source);
    const examples = setup?.examples;
    const samples = Array.isArray(setup?.samples) ? setup.samples : EMPTY;
    const draft = draftOf(source);
    const history = historyOf(source);
    const parts = [examples, samples, draft?.order, draft?.note, draft?.photo?.source, draft?.photo?.name, history.length, history[history.length - 1]];
    if (!cache.key || cache.key.some((part, index) => part !== parts[index])) {
      cache.key = parts;
      cache.items = Array.isArray(examples) ? deepFreeze(examples.filter(isObject).map((raw, index) => exampleItem(raw, index, samples, draft, history))) : EMPTY;
    }
    return cache.items;
  };
  const ctx = {
    items,
    shown: () => shownOf(source, ctx, items()),
    data: {
      get samples() {
        const samples = setupOf(source)?.samples;
        return deepFreeze(Array.isArray(samples) ? samples.filter(isObject).map((entry) => ({ name: plain(entry.name), about: plain(entry.about) })) : []);
      },
      get orders() { return ordersOf(source, orderCache); },
      get draft() { return setupOf(source) ? deepFreeze(draftOf(source)) : null; },
      get loaded() {
        const index = items().findIndex((item) => item.loaded);
        return index < 0 ? null : items()[index].index;
      },
      get running() { return running(source); },
      get labels() { return deepFreeze({ decisions: { ...DECISIONS } }); },
      get calls() { return callsOf(source, historyOf(source)); },
      get history() { return historyOf(source); },
    },
    actions: {
      use(index) {
        if (!setupOf(source)) throw new Error("The examples have not loaded yet.");
        if (!Number.isInteger(index) || !items().some((item) => item.index === index)) throw new Error(`There is no example number ${asText(index)}.`);
        if (running(source)) throw new Error("Wait for the check to finish before loading an example.");
        return call(source, "use", index);
      },
      focusNote() {
        if (running(source)) throw new Error("The note is disabled while a check runs.");
        return call(source, "focusNote");
      },
      focusRun() {
        if (running(source)) throw new Error("A check is already running.");
        return call(source, "focusRun");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.label === "string" && item.label ? item.label : String(index + 1)),
  };
  return ctx;
}

// ---------- claims.result ----------

function answerItem(id, answer, question, position, policy, verdict, kinds) {
  const type = typeof answer.type === "string" ? answer.type : "";
  let value = null, display = "", label = "", scale = null, box = null;
  let probabilities = [];
  if (type === "choice") {
    value = answer.choice === null || answer.choice === undefined ? null : String(answer.choice);
    if (value !== null) { display = value.replace(/_/g, " "); label = kinds[value] || display; }
    probabilities = Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
  } else if (type === "score") {
    value = finite(answer.score);
    const legend = isObject(answer.legend) ? answer.legend : {};
    const levels = Object.keys(legend).length;
    scale = levels ? levels - 1 : null;
    if (value !== null) {
      display = scale === null ? value.toFixed(2) : `${value.toFixed(2)} / ${scale}`;
      label = asText(legend[String(Math.round(value))]);
    }
    probabilities = Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
  } else if (type === "noul") {
    value = finite(answer.noul);
    if (value !== null) {
      display = percent(value, 1);
      probabilities = [{ key: "yes", p: value }, { key: "no", p: 1 - value }];
    }
  } else if (type === "box" && isObject(answer.box)) {
    const edges = ["left", "top", "right", "bottom"].map((edge) => finite(answer.box[edge]));
    if (!edges.includes(null)) {
      box = { left: edges[0], top: edges[1], right: edges[2], bottom: edges[3] };
      display = `${percent(box.right - box.left)} × ${percent(box.bottom - box.top)}`;
    }
  }
  let top = null;
  for (const entry of probabilities) if (!top || entry.p > top.p) top = entry;
  const cuts = (CUTS[id] || []).flatMap((key) => (finite(policy?.[key]) === null ? [] : [{ key, at: policy[key] }]));
  const checks = Array.isArray(verdict?.checks) ? verdict.checks : [];
  const found = CHECK_OF[id] ? checks.find((entry) => isObject(entry) && entry.id === CHECK_OF[id]) : null;
  return { id, position, type, instructions: isObject(question) ? asText(question.instructions) : "", value, display, label, scale, probabilities,
    top: top ? { ...top } : null, confidence: type === "noul" ? null : finite(answer.confidence), box, cuts,
    check: found ? { id: plain(found.id), ok: found.ok === true, level: plain(found.level), label: plain(found.label), detail: plain(found.detail) } : null,
    answer: clone(answer) };
}

function snapPolicy(settings, changes) {
  if (!isObject(changes) || !Object.keys(changes).length) throw new Error("Name at least one policy setting to change.");
  const next = { ...settings };
  for (const [key, raw] of Object.entries(changes)) {
    const limit = LIMITS[key];
    if (!limit) throw new Error(`There is no policy setting "${key}".`);
    const value = typeof raw === "string" ? toNumber(raw) : finite(raw);
    if (value === null) throw new Error(`${limit.label} must be a number.`);
    if (value < limit.min - 1e-9 || value > limit.max + 1e-9) throw new Error(`${limit.label} must be from ${limit.min} to ${limit.max}.`);
    const steps = (value - limit.min) / limit.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) throw new Error(`${limit.label} moves in steps of ${limit.step}.`);
    next[key] = Number((limit.min + Math.round(steps) * limit.step).toFixed(2));
  }
  return next;
}

// source: {
//   setup: () => the setup response or null,
//   result: () => the shown result ({ answers, evidence, facts, location, verdict, policy, box_supported, image, meta,
//            trace }) or null,
//   input: () => { order, note, photo } the shown result was made for (photo from claimsPhotoOf), or null,
//   settings: () => the policy sliders' values,     running: () => boolean,     note: () => the re-decide note,
//   history: () => [...] as for claimsOrdersCtx,     calls: () => n,     kindLabels: { key: label } the page prints,
//   matches, arrange   the Lab hooks for "claims.result",
//   setPolicy(next), resetPolicy(), focusPolicy(key), inspect(), refresh()   the page's own operations
//   (setPolicy receives the whole next policy, already checked)
// }
export function claimsResultCtx(source = {}) {
  let built = { key: null, items: EMPTY };
  const result = () => {
    const raw = read(source, "result", null);
    return isObject(raw) && isObject(raw.answers) ? raw : null;
  };
  const kinds = () => labelMap(read(source, "kindLabels", NONE));
  const items = () => {
    const r = result();
    if (!r) return EMPTY;
    const parts = [r, r.answers, r.policy, r.verdict, r.trace];
    if (!built.key || built.key.some((part, index) => part !== parts[index])) {
      const questions = isObject(r.trace?.request?.questions) ? r.trace.request.questions : {};
      const policy = isObject(r.policy) ? r.policy : null;
      const verdict = isObject(r.verdict) ? r.verdict : null;
      const names = kinds();
      built = { key: parts, items: deepFreeze(Object.entries(r.answers).filter(([, answer]) => isObject(answer))
        .map(([id, answer], index) => answerItem(id, answer, questions[id], index + 1, policy, verdict, names))) };
    }
    return built.items;
  };
  const settings = () => {
    const value = read(source, "settings", null);
    return setupOf(source) && isObject(value) ? value : null;
  };
  const needSetup = () => { if (!setupOf(source) || !settings()) throw new Error("The policy has not loaded yet."); };
  const fromResult = (name) => {
    const r = result();
    return r && isObject(r[name]) ? frozenCopy(r[name]) : null;
  };
  const ctx = {
    items,
    shown: () => shownOf(source, ctx, items()),
    data: {
      get input() {
        if (!result()) return null;
        const input = read(source, "input", null);
        if (!isObject(input)) return null;
        const photo = isObject(input.photo) ? { source: input.photo.source === "sample" ? "sample" : "upload", name: plain(input.photo.name), about: plain(input.photo.about) } : null;
        const examples = Array.isArray(setupOf(source)?.examples) ? setupOf(source).examples : EMPTY;
        return deepFreeze({ order: plain(input.order), note: plain(input.note), photo, example: claimsExampleOf({ order: input.order, note: input.note, photo }, examples) });
      },
      get facts() { return fromResult("facts"); },
      get evidence() { return fromResult("evidence"); },
      get location() { return fromResult("location"); },
      get verdict() { return fromResult("verdict"); },
      get policy() { return policyCopy(result()?.policy); },
      get settings() { return policyCopy(settings()); },
      get defaults() { return policyCopy(setupOf(source)?.policy); },
      get limits() { return LIMITS; },
      get rules() { return RULES; },
      get changed() {
        const now = settings(), defaults = setupOf(source)?.policy;
        if (!now || !isObject(defaults)) return EMPTY;
        return Object.freeze(Object.keys(LIMITS).filter((key) => finite(now[key]) !== null && finite(defaults[key]) !== null && Math.abs(now[key] - defaults[key]) > 1e-9));
      },
      get labels() { return deepFreeze({ decisions: { ...DECISIONS }, kinds: kinds(), remedies: { ...REMEDIES } }); },
      get questions() { const q = result()?.trace?.request?.questions; return isObject(q) ? frozenCopy(q) : null; },
      get meta() { return result() && isObject(result().meta) ? deepFreeze(metaOf(result().meta)) : null; },
      get trace() { return fromResult("trace"); },
      get image() { return fromResult("image"); },
      get box_supported() { const r = result(); return r ? r.box_supported === true : null; },
      get note() { return plain(read(source, "note", "")); },
      get running() { return running(source); },
      get calls() { return callsOf(source, historyOf(source)); },
      get history() { return historyOf(source); },
    },
    actions: {
      setPolicy(changes) {
        needSetup();
        const now = settings();
        const next = snapPolicy(now, changes);
        if (Object.keys(LIMITS).every((key) => next[key] === now[key])) return policyCopy(now);
        call(source, "setPolicy", next);
        return policyCopy(next);
      },
      resetPolicy() {
        needSetup();
        return call(source, "resetPolicy");
      },
      focusPolicy(key) {
        if (!LIMITS[key]) throw new Error(`There is no policy setting "${asText(key)}".`);
        return call(source, "focusPolicy", key);
      },
      inspect() {
        if (!result()) throw new Error("Check a claim first: there is no request to inspect yet.");
        return call(source, "inspect");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}

// ---------- page helpers (pure; static/js/claims.js renders with them) ----------

// The order picker's options: the shown orders, and the selected order first (marked hidden) when Lab hides it.
// orders: the setup's raw orders; shown: claims.orders shown(); selected: the picker's id.
// Returns [{ order (the raw order), selected, hidden }].
export function claimsOrderOptions(orders, shown, selected) {
  const list = Array.isArray(orders) ? orders.filter(isObject) : [];
  const current = list.find((order) => order.id === selected) || list[0] || null;
  const byId = new Map(list.map((order) => [order.id, order]));
  const options = (Array.isArray(shown) ? shown : []).map((item) => byId.get(item?.id)).filter(Boolean)
    .map((order) => ({ order, selected: order === current, hidden: false }));
  if (current && !options.some((option) => option.order === current)) options.unshift({ order: current, selected: true, hidden: true });
  return options;
}

// The "x of y <noun>s shown · n Lab settings active" line, or null while no Lab setting is active.
export function claimsLabNote(shown, total, active, noun) {
  if (!active) return null;
  if (total && !shown) return `No ${noun} matches the Lab filters.`;
  return `${shown} of ${total} ${noun}${total === 1 ? "" : "s"} shown · ${active} Lab setting${active === 1 ? "" : "s"} active`;
}
