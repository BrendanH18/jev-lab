// Lab surfaces of the Reviews page (static/reviews.html, static/js/reviews.js): the example reviews and the result of
// the user's own latest check. Pure code: it imports only the kit, touches no DOM, storage or network, and is tested
// in Node (tests/js/lab/surface-demo-reviews.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/reviews.mjs
// (sampleReviewsExamplesCtx, sampleReviewsResultCtx). This header is the CONTRACT for packs on these two surfaces.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) } and are built ONCE per
// page load. items(), shown() and every data field are read at call time, so a ctx never goes stale; read a data
// field when you need it and never keep a copy across renders. Items and data values are deeply frozen plain JSON:
// read them, never write to them. items() and shown() hand out the SAME item objects (compare by identity) until the
// list itself changes. Neither surface has replaceItems or importItems, so Edits (transform) and Paste to import
// (importer) do not render here: the examples are built-in scenarios (jev/reviews.py EXAMPLES, which nothing may
// change) and the answers are model output, which no pack may rewrite or invent.
// Kinds both surfaces host: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "reviews.examples"  —  builder reviewsExamplesCtx(source)  —  the example chips above the review form
// ---------------------------------------------------------------------------------------------------------------
// The list is the built-in example reviews from GET /api/reviews/setup, in page order (8 today: Glowing praise,
// Stale beans, Burned hand, 5 stars furious, 1 star loves it, Spam, Late delivery, Double charge). items() is []
// until the setup has loaded. The page has no filter of its own, so shown() is items() after Lab's filters and
// Lab's sort, and the page shows exactly those chips in that order (with "x of y examples shown" and a "Clear Lab
// filters and sort" button while a Lab setting is active; "No example matches the Lab filters." when none is left).
// Clicking a chip loads that example into the form, which clears the shown result (the page has always done so).
//
// Item (one example review; inputs and a hand-written expectation only, never an answer):
//   index          number    0-based position in the setup's examples: the argument of actions.use(index)
//   position       number    index + 1
//   label          string    the chip's text, for example "Stale beans" ("Example n" when the setup gives none).
//                            itemName() returns it.
//   stars          number | null   the star rating 1–5 (null when the example's value is not a whole number 1–5).
//                            The stars never reach Jev: code compares them with the words' tone.
//   channel        string    the channel key: "website" | "app" | "maps" ("" when missing)
//   channel_label  string    its label from the setup: "Website review", "App store review", "Map listing" ("" when
//                            the key is unknown)
//   about          string    what the review is about ("Pier Street café"); "" when the example has none
//   text           string    the review's words exactly as the example holds them
//   chars          number    the text's length in Unicode code points
//   words          number    whitespace-separated words in the text (0 for blank text)
//   expect         { action, team, flags } | null   what a PERSON would decide for this example, written by hand in
//                            jev/reviews.py for scripts/validate.py: action "escalate" | "moderate" | "reply" |
//                            "thank" | "log", team a key of data.teams, flags a list of "safety" | "not_about_us" |
//                            "rating_mismatch". action/team are null and flags [] when a part is missing; the whole
//                            field is null when the example has no expectation. It is a human label, NOT Jev's answer
//                            and NOT the triage: never show it as either.
//   loaded         boolean   the review form holds exactly this example now (same stars, channel, about and text)
//   triaged        number    how many of THIS page session's answered checks were for this example's words (same
//                            text, channel and about after trimming; the stars are ignored because they never reach
//                            Jev). 0 before the first check. Session memory only: gone on reload.
//
// data (live getters):
//   channels   { key: label }   the setup's channels; {} before the setup loads
//   actions    { key: label }   the five actions ("escalate": "Escalate to quality & safety", …); {} before setup
//   teams      { key: label }   the eight teams ("roasting": "Roasting", …); {} before setup
//   topic_teams { topic: team } the routing table in code ("freshness": "roasting", …); {} before setup
//   draft      { stars, channel, about, text } | null   what the review form holds now (null before setup). stars is
//              a whole number 1–5 or null; text is untrimmed.
//   loaded     number | null    data.draft's example: the index of the first item whose loaded is true, else null
//   running    boolean          a check (one live model call) is on its way; the chips are disabled meanwhile
//   calls      number           answered checks since the page loaded (0 at first)
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render):
//   use(index)   what clicking that example's chip does: puts the example in the form and clears the shown result.
//                NO model call; the user still presses "Triage review". Guards: the setup has loaded, index is an
//                integer naming an item, and no check is running (the chips are disabled then).
//   focusText()  moves the keyboard focus to the review textarea. No guard.
//   focusRun()   moves the keyboard focus to the "Triage review" button, so Enter runs the user's own check. It never
//                presses it. Guard: refuses while a check is running.
// There is no action that runs a check, edits an example or adds one, and none may be added by a pack.
//
// refresh() re-renders the example chips (and Lab's "x of y" note) from shown(); the form keeps its text and focus.
//
// Content boundaries for reviews.examples:
//   - Items are built-in inputs plus hand-written expectations. Exports may contain them and must say so; they hold
//     no answers, probabilities or triage, and a pack must never show an expectation as what Jev or the policy
//     decided. "Matches the expectation" may only compare with a check the user ran (reviews.result).
//   - triaged counts are this session's own checks; never store them or present them as more than that.
//   - No pack changes the examples, the questions or the request, and none runs a check.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "reviews.result"  —  builder reviewsResultCtx(source)  —  the "Review decision" panel
// ---------------------------------------------------------------------------------------------------------------
// The list is the answers of the CURRENT USER'S OWN latest check (the page's own Triage call, one live call), one row
// per question in the response's order: topic (choice), severity (score 0–3), tone (score 0–4), safety, wants_reply
// and about_us (noul). items() is [] before the first check of this page load and again whenever the page clears the
// result: picking an example, or editing the text, channel or subject (the answers belong to the words they were
// asked about). Changing the stars or a policy slider keeps the answers and re-decides through POST
// /api/reviews/decide (plain code, no Jev call), which changes data.triage and data.policy (and each item's cuts).
// The page's "All 6 answers from the one call" cards are rendered from shown(): with Lab filters they show only the
// matching answers, in Lab's sort order, with "x of y answers shown" and a "Clear Lab filters and sort" button. The
// decision, reasons, checks and bars above the cards always show the whole result.
//
// Item (one answer row):
//   id             string   the question id: "topic" | "severity" | "tone" | "safety" | "wants_reply" | "about_us".
//                           Unique. itemName() returns it.
//   position       number   1-based position in the response's answer order
//   type           string   "choice" | "score" | "noul" as the API returned it ("" when missing; other types pass
//                           through with value null)
//   instructions   string   the question text that was sent ("" when the request lacks it)
//   value          string | number | null   choice: the chosen topic key; score: the score, a float from 0 to scale;
//                           noul: P(yes) from 0 to 1; null when missing or odd
//   display        string   as the answer card prints it: "cafe service", "1.62 / 3", "97.0%"; "" when value is null
//   label          string   choice: the topic's page label ("Café service"; the key with spaces when unknown);
//                           score: the legend text of the level nearest the score ("Real problem: it cost the
//                           customer money, …"); noul and missing: ""
//   scale          number | null   score only: the highest level (3 for severity, 4 for tone)
//   probabilities  [{ key, p }]   choice: one per topic in response order; score: one per level "0", "1", …;
//                           noul: [{ key: "yes", p }, { key: "no", p: 1 - p }]; [] when nothing usable. Entries whose
//                           probability is not a finite number are left out.
//   top            { key, p } | null   the entry with the highest p (the first one on a tie)
//   confidence     number | null   the answer's confidence field; noul answers carry none (null)
//   cuts           [{ key, at }]   the policy settings IN FORCE FOR THE SHOWN TRIAGE (data.policy) that read this
//                           answer in jev/reviews.py triage(): safety -> safety_at (escalate at value >= at),
//                           about_us -> about_us_min (moderate when value < at), wants_reply -> wants_reply_at (reply
//                           at value >= at), severity -> p1_at and p2_at (P1 / P2 at value >= at), tone ->
//                           thank_tone_at (thank-you at value >= at); topic -> []. mismatch_gap reads the tone's
//                           distance from the stars, not the tone itself, so it is not a cut of any item: use
//                           data.triage.evidence.rating_gap. A rule never reached (for example after an escalation)
//                           still lists its cut; data.triage.checks says which rules ran.
//   answer         object   the raw answer exactly as the server returned it
//
// data (live getters; null before the first check unless stated):
//   review     { stars, channel, channel_label, about, text }   the review the shown answers were made for. stars
//              follow the form's star picker (they re-decide without a call).
//   draft      { stars, channel, about, text } | null   what the form holds now (null before setup only)
//   triage     the decision for the shown answers exactly as the server returned it: { action, action_label, team,
//              team_label, priority "P1"|"P2"|"P3", flags [..], checks [{ id, ok, level, label, detail }],
//              reasons [string], auto_reply_allowed, evidence { topic, topic_prob, topics [{ value, prob }], severity,
//              tone, safety, wants_reply, about_us, stars, rating_gap } }. Checks run in order and stop at the
//              deciding rule, so an escalated review has one check.
//   policy     { safety_at, about_us_min, wants_reply_at, p1_at, p2_at, mismatch_gap, thank_tone_at }: the full
//              policy the shown triage was decided under
//   settings   the policy sliders now (same keys); null before setup. Briefly differs from data.policy while a
//              re-decide is on its way (120 ms after the last slider move).
//   defaults   the policy's default values (same keys); null before setup
//   limits     { key: { min, max, step, label } } for the seven sliders, as the page draws them. Always present.
//   changed    [key]  the settings that differ from the defaults, in limits order; [] before setup
//   labels     { topics, teams, actions, channels, flags }: { key: label } maps the page prints. Present always;
//              teams/actions/channels are {} before setup.
//   topic_teams { topic: team } the routing table in code; {} before setup
//   questions  the questions of the shown check exactly as sent ({ id: { type, instructions, criteria } })
//   meta       the server's measurements of the shown check: { model, latency_ms, question_count, input_tokens,
//              output_tokens, cost_usd, backend }. Treat every field as possibly missing. cost_usd is MEASURED.
//   trace      what Inspect JSON shows: { request, response, meta }. request.state never holds the stars.
//   note       string   the page's re-decide note ("Re-decided in 3 ms · no Jev call"); "" when none
//   running    boolean  a check is on its way (always present)
//   calls      number   answered checks since the page loaded (always present, 0 at first)
//   history    [{ call, at, review, answers, meta }]   this page load's answered checks, oldest first, newest 50 at
//              most: call is its 1-based number in the session, at its arrival time in epoch ms, review the
//              words and stars as sent ({ stars, channel, channel_label, about, text }), answers the raw answers,
//              meta as above. NO triage: a decision depends on the policy, and only the latest is decided now. []
//              at first; memory only, gone on reload. The last entry is the shown check while items() is nonempty.
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press):
//   setPolicy(changes)  moves policy sliders exactly as dragging them does, then re-decides the shown answers
//                       through POST /api/reviews/decide: plain code, NO model call. changes is { key: number }.
//                       Guards: the setup has loaded; every key is one of data.limits; every value is a finite number
//                       inside the slider's range and on its step grid (0.05 for the three probability cuts, 0.1 for
//                       the severity and tone cuts, 0.25 for the gap). P1 never sits below P2, as on the sliders: moving p1_at
//                       below p2_at moves p2_at too, moving p2_at above p1_at moves p1_at too, and setting both with
//                       p1_at < p2_at is refused. Returns the policy now in the sliders (frozen); a change that moves
//                       nothing returns it without re-deciding.
//   resetPolicy()       the page's "Reset to defaults" button: same re-decide, no model call. Guard: setup loaded.
//   setStars(stars)     the form's star picker: re-decides the shown answers when there are any (no model call; the
//                       stars never reach Jev). Guards: setup loaded; a whole number 1–5; refused while a check is
//                       running (the picker is disabled then).
//   focusPolicy(key)    moves the keyboard focus to that slider. Guard: key is one of data.limits.
//   inspect()           opens the page's Inspect JSON drawer on the shown check. Guard: refuses with no check shown.
// There is no action that runs a check or edits, replays or invents answers, and none may be added by a pack.
//
// refresh() re-renders the answer cards from shown(); the open "All 6 answers" disclosure stays open.
//
// Content boundaries for reviews.result:
//   - Everything in items(), triage, meta, trace and history comes from a check the current user ran in this page
//     load. A pack may show, measure, compare and export it, labeled as the user's own check (and history entries as
//     earlier checks of this session). It never shows a made-up, sample, remembered or predicted answer, never keeps
//     answers beyond the page session, and never presents an earlier check as the current one.
//   - Exports that hold the review's words, answers or probabilities say so in their label or help. An export of
//     the policy holds settings only. CSV goes through csvText/csvCell (formula escaping).
//   - Metrics over meta are measurements of this session's checks; a projection (cost per thousand reviews) is
//     arithmetic on a measured call and says so, never shown as spend.
//   - A rule a pack applies locally ("close to a cut", "would flip at") is advisory plain code, labeled as such and
//     never worded as Jev's answer or as the page's decision; the decision is data.triage. A pack does not
//     re-implement triage(); to see a different policy's decision it moves the sliders through setPolicy.
//   - No pack changes the questions, the examples or the request. Nothing here holds the API key.
import { clone, toNumber } from "../kit.js";

const HISTORY_SHOWN = 50;
const EMPTY = Object.freeze([]);
const NONE = Object.freeze({});

// The page's seven policy sliders (static/js/reviews.js renderPolicy); tests/js/lab/surface-demo-reviews.test.mjs keeps
// them in step with the page source and with DEFAULT_POLICY in jev/reviews.py.
const LIMITS = deepFreeze({
  safety_at: { min: 0, max: 1, step: 0.05, label: "Escalate a safety risk at P ≥" },
  about_us_min: { min: 0, max: 1, step: 0.05, label: "Moderate when about us is below P" },
  wants_reply_at: { min: 0, max: 1, step: 0.05, label: "Reviewer wants a reply at P ≥" },
  p1_at: { min: 0, max: 3, step: 0.1, label: "P1 at severity ≥" },
  p2_at: { min: 0, max: 3, step: 0.1, label: "P2 and a reply at severity ≥" },
  mismatch_gap: { min: 0.5, max: 4, step: 0.25, label: "Stars and words disagree at a gap ≥" },
  thank_tone_at: { min: 0, max: 4, step: 0.1, label: "Thank-you template at tone ≥" },
});
// Which policy settings read each answer in jev/reviews.py triage().
const CUTS = Object.freeze({ safety: ["safety_at"], about_us: ["about_us_min"], wants_reply: ["wants_reply_at"], severity: ["p1_at", "p2_at"],
  tone: ["thank_tone_at"], topic: [] });

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plain = (value) => (typeof value === "string" ? value : "");
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value) ?? "");
const percent = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const labelMap = (value) => (isObject(value) ? Object.fromEntries(Object.entries(value).filter(([, label]) => typeof label === "string")) : {});

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

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

// A frozen copy per source object, so repeated reads hand out the same value until the page replaces the object.
const COPIES = new WeakMap();
function frozenCopy(value) {
  if (!value || typeof value !== "object") return null;
  if (!COPIES.has(value)) COPIES.set(value, deepFreeze(clone(value)));
  return COPIES.get(value);
}

const starsOf = (value) => (Number.isInteger(value) && value >= 1 && value <= 5 ? value : null);

function draftOf(raw) {
  if (!isObject(raw)) return null;
  return { stars: starsOf(raw.stars), channel: plain(raw.channel), about: plain(raw.about), text: plain(raw.text) };
}

function reviewOf(raw, channels) {
  const draft = draftOf(raw);
  return draft ? { stars: draft.stars, channel: draft.channel, channel_label: plain(channels[draft.channel]), about: draft.about, text: draft.text } : null;
}

// The same words as far as Jev is concerned: the stars never reach it, and the server trims text and subject.
const sameWords = (a, b) => !!a && !!b && a.channel === b.channel && a.text.trim() === b.text.trim() && a.about.trim() === b.about.trim();

function setupOf(source) {
  const setup = read(source, "setup", null);
  return isObject(setup) ? setup : null;
}

// ---------- session history (shared by both surfaces) ----------

const ENTRIES = new WeakMap();
function historyEntry(raw, channels) {
  if (ENTRIES.has(raw)) return ENTRIES.get(raw);
  const entry = deepFreeze({ call: Number.isInteger(raw.call) ? raw.call : null, at: finite(raw.at),
    review: reviewOf(raw.review, channels) || { stars: null, channel: "", channel_label: "", about: "", text: "" },
    answers: isObject(raw.answers) ? clone(raw.answers) : {}, meta: isObject(raw.meta) ? clone(raw.meta) : null });
  ENTRIES.set(raw, entry);
  return entry;
}

function historyOf(source, channels) {
  const list = read(source, "history", EMPTY);
  if (!Array.isArray(list)) return EMPTY;
  return Object.freeze(list.filter(isObject).slice(-HISTORY_SHOWN).map((raw) => historyEntry(raw, channels)));
}

function callsOf(source, history) {
  const count = read(source, "calls", null);
  return Number.isInteger(count) && count >= 0 ? count : history.length;
}

// ---------- reviews.examples ----------

function exampleItem(raw, index, draft, history, channels) {
  const review = reviewOf(raw, channels);
  const expect = isObject(raw.expect) ? { action: typeof raw.expect.action === "string" ? raw.expect.action : null,
    team: typeof raw.expect.team === "string" ? raw.expect.team : null,
    flags: Array.isArray(raw.expect.flags) ? raw.expect.flags.filter((flag) => typeof flag === "string") : [] } : null;
  const trimmed = review.text.trim();
  return { index, position: index + 1, label: plain(raw.label).trim() || `Example ${index + 1}`, stars: review.stars, channel: review.channel,
    channel_label: review.channel_label, about: review.about, text: review.text, chars: Array.from(review.text).length,
    words: trimmed ? trimmed.split(/\s+/).length : 0, expect,
    loaded: !!draft && draft.stars === review.stars && draft.channel === review.channel && draft.about === review.about && draft.text === review.text,
    triaged: history.filter((entry) => sameWords(entry.review, review)).length };
}

// source: {
//   setup: () => the GET /api/reviews/setup response ({ examples, policy, teams, topic_teams, channels, actions }) or null,
//   draft: () => the form's review { stars, channel, about, text },     running: () => boolean,
//   history: () => [{ call, at, review, answers, meta }] oldest first,  calls: () => number of answered checks,
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   use(index), focusText(), focusRun(), refresh()   the page's own operations
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function reviewsExamplesCtx(source = {}) {
  let built = { key: null, examples: null, items: EMPTY };
  const channels = () => labelMap(setupOf(source)?.channels);
  const items = () => {
    const setup = setupOf(source);
    const examples = setup && Array.isArray(setup.examples) ? setup.examples : EMPTY;
    const draft = draftOf(read(source, "draft", null));
    const history = historyOf(source, channels());
    const key = JSON.stringify([draft, history.length, history.map((entry) => entry.call)]);
    if (examples !== built.examples || key !== built.key) {
      const labels = channels();
      // index stays the example's position in the setup's list, so actions.use(index) loads that very example.
      built = { key, examples, items: deepFreeze(examples.flatMap((raw, index) => (isObject(raw) ? [exampleItem(raw, index, draft, history, labels)] : []))) };
    }
    return built.items;
  };
  const running = () => read(source, "running", false) === true;
  const ctx = {
    items,
    shown: () => {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get channels() { return deepFreeze(channels()); },
      get actions() { return deepFreeze(labelMap(setupOf(source)?.actions)); },
      get teams() { return deepFreeze(labelMap(setupOf(source)?.teams)); },
      get topic_teams() { return deepFreeze(labelMap(setupOf(source)?.topic_teams)); },
      get draft() { return deepFreeze(draftOf(read(source, "draft", null))); },
      get loaded() { return items().find((item) => item.loaded)?.index ?? null; },
      get running() { return running(); },
      get calls() { return callsOf(source, historyOf(source, channels())); },
    },
    actions: {
      use(index) {
        if (!setupOf(source)) throw new Error("The examples have not loaded yet.");
        const item = Number.isInteger(index) ? items().find((entry) => entry.index === index) : undefined;
        if (!item) throw new Error(`There is no example ${Number.isInteger(index) ? index + 1 : String(index)}.`);
        if (running()) throw new Error("Wait for the triage to finish before loading another example.");
        return call(source, "use", item.index);
      },
      focusText: () => call(source, "focusText"),
      focusRun() {
        if (running()) throw new Error("The triage is already running.");
        return call(source, "focusRun");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.label === "string" && item.label ? item.label : String(index + 1)),
  };
  return ctx;
}

// ---------- reviews.result ----------

function answerItem(id, answer, question, position, policy, topics) {
  const type = typeof answer.type === "string" ? answer.type : "";
  const legend = isObject(answer.legend) ? answer.legend : {};
  let value = null, display = "", label = "", scale = null, probabilities = [];
  if (type === "choice") {
    value = answer.choice === null || answer.choice === undefined ? null : String(answer.choice);
    if (value !== null) { display = value.replace(/_/g, " "); label = typeof topics[value] === "string" ? topics[value] : display; }
  } else if (type === "score") {
    value = finite(answer.score);
    const levels = Object.keys(legend).length || (isObject(question) && Array.isArray(question.criteria) ? question.criteria.length : 0);
    scale = levels ? levels - 1 : null;
    if (value !== null) {
      display = scale === null ? value.toFixed(2) : `${value.toFixed(2)} / ${scale}`;
      const level = legend[String(Math.round(value))];
      label = typeof level === "string" ? level : "";
    }
  } else if (type === "noul") {
    value = finite(answer.noul);
    if (value !== null) display = percent(value, 1);
  }
  if (type === "noul") probabilities = value === null ? [] : [{ key: "yes", p: value }, { key: "no", p: 1 - value }];
  else if (type === "choice" || type === "score") {
    probabilities = Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
  }
  let top = null;
  for (const entry of probabilities) if (!top || entry.p > top.p) top = entry;
  const cuts = (CUTS[id] || []).flatMap((key) => (finite(policy?.[key]) === null ? [] : [{ key, at: policy[key] }]));
  return { id, position, type, instructions: isObject(question) ? asText(question.instructions) : "", value, display, label, scale, probabilities,
    top: top ? { ...top } : null, confidence: type === "noul" ? null : finite(answer.confidence), cuts, answer: clone(answer) };
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
  const p1 = finite(next.p1_at), p2 = finite(next.p2_at);
  if (p1 !== null && p2 !== null && p1 < p2) {
    if ("p1_at" in changes && "p2_at" in changes) throw new Error("The P1 cut cannot sit below the P2 cut.");
    if ("p1_at" in changes) next.p2_at = p1;
    else next.p1_at = p2;
  }
  return next;
}

// source: {
//   setup: () => the GET /api/reviews/setup response, or null,
//   result: () => the latest check's result ({ review, answers, triage, policy, meta, trace }) or null,
//   draft: () => the form's review,     settings: () => the policy sliders' values,     running: () => boolean,
//   note: () => the re-decide note,     history: () => [{ call, at, review, answers, meta }],     calls: () => number,
//   topicLabels, flagLabels: { key: label } maps the page prints,
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   setPolicy(next), resetPolicy(), setStars(stars), focusPolicy(key), inspect(), refresh()   the page's own operations
//   (setPolicy receives the whole next policy, already checked)
// }
export function reviewsResultCtx(source = {}) {
  let built = { key: null, items: EMPTY };
  const result = () => {
    const raw = read(source, "result", null);
    return isObject(raw) ? raw : null;
  };
  const channels = () => labelMap(setupOf(source)?.channels);
  const topics = () => labelMap(read(source, "topicLabels", NONE));
  const items = () => {
    const r = result();
    if (!r || !isObject(r.answers)) return EMPTY;
    const parts = [r, r.answers, r.policy, r.trace];
    if (!built.key || built.key.some((part, index) => part !== parts[index])) {
      const questions = isObject(r.trace?.request?.questions) ? r.trace.request.questions : {};
      const names = topics();
      const policy = isObject(r.policy) ? r.policy : null;
      built = { key: parts, items: deepFreeze(Object.entries(r.answers).filter(([, answer]) => isObject(answer))
        .map(([id, answer], index) => answerItem(id, answer, questions[id], index + 1, policy, names))) };
    }
    return built.items;
  };
  const settings = () => {
    const value = read(source, "settings", null);
    return setupOf(source) && isObject(value) ? value : null;
  };
  const running = () => read(source, "running", false) === true;
  const needSetup = () => { if (!setupOf(source) || !settings()) throw new Error("The policy has not loaded yet."); };
  const policyCopy = (value) => (isObject(value) ? Object.freeze(Object.fromEntries(Object.keys(LIMITS).filter((key) => key in value).map((key) => [key, value[key]]))) : null);
  const ctx = {
    items,
    shown: () => {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get review() { const r = result(); return r ? deepFreeze(reviewOf(r.review, channels())) : null; },
      get draft() { return deepFreeze(draftOf(read(source, "draft", null))); },
      get triage() { return frozenCopy(result()?.triage); },
      get policy() { return policyCopy(result()?.policy); },
      get settings() { return policyCopy(settings()); },
      get defaults() { return policyCopy(setupOf(source)?.policy); },
      get limits() { return LIMITS; },
      get changed() {
        const now = settings(), defaults = setupOf(source)?.policy;
        if (!now || !isObject(defaults)) return EMPTY;
        return Object.freeze(Object.keys(LIMITS).filter((key) => finite(now[key]) !== null && finite(defaults[key]) !== null && Math.abs(now[key] - defaults[key]) > 1e-9));
      },
      get labels() {
        const setup = setupOf(source);
        return deepFreeze({ topics: topics(), teams: labelMap(setup?.teams), actions: labelMap(setup?.actions), channels: channels(),
          flags: labelMap(read(source, "flagLabels", NONE)) });
      },
      get topic_teams() { return deepFreeze(labelMap(setupOf(source)?.topic_teams)); },
      get questions() { const q = result()?.trace?.request?.questions; return isObject(q) ? frozenCopy(q) : null; },
      get meta() { return frozenCopy(isObject(result()?.meta) ? result().meta : null); },
      get trace() { return frozenCopy(isObject(result()?.trace) ? result().trace : null); },
      get note() { return plain(read(source, "note", "")); },
      get running() { return running(); },
      get calls() { return callsOf(source, historyOf(source, channels())); },
      get history() { return historyOf(source, channels()); },
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
      setStars(stars) {
        needSetup();
        if (starsOf(stars) === null) throw new Error("Stars must be a whole number from 1 to 5.");
        if (running()) throw new Error("Wait for the triage to finish before changing the stars.");
        return call(source, "setStars", stars);
      },
      focusPolicy(key) {
        if (!LIMITS[key]) throw new Error(`There is no policy setting "${asText(key)}".`);
        return call(source, "focusPolicy", key);
      },
      inspect() {
        if (!result()) throw new Error("Triage a review first: there is no request to inspect yet.");
        return call(source, "inspect");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}
