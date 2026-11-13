// A question library for the Workbench Build editor ("workbench.build.questions"; contract in
// static/js/lab/surfaces/workbench-build.js): generic question skeletons for common needs (routing, sentiment,
// urgency, policy flags, extraction checks) and Choice key templates, previewed before anything changes.
//
// Content boundary: a skeleton is STRUCTURE only: an id, a type, Choice option keys and a number of Score level slots.
// Instructions, option descriptions, level texts and yes/no criteria stay blank for the user to write, because a pack
// ships no model-facing wording of its own. Each skeleton's note is guidance for the person and is never added to a
// question. The panel sends nothing anywhere: questions reach the editor only through the surface's importItems and
// replaceItems (which keep ids unique and refuse while Raw JSON has unapplied edits), when the user presses Add.
import { compareText, definePack } from "../../kit.js";
import { uniqueName } from "../../lib/text.js";

const NEEDS = Object.freeze([["routing", "Routing"], ["sentiment", "Sentiment"], ["urgency", "Urgency"], ["policy", "Policy flags"],
  ["extraction", "Extraction checks"]]);
const NEED_NAMES = Object.fromEntries(NEEDS);
const TYPES = Object.freeze(["noul", "choice", "score", "box"]);
const TYPE_NAMES = Object.freeze({ noul: "Noul (yes/no)", choice: "Choice", score: "Score", box: "Box" });
const MIN_LEVELS = 2, MAX_LEVELS = 25, MAX_QUESTIONS = 100;
const KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;

// Structure only (see the header). Notes are for the person writing the question.
const SKELETONS = Object.freeze([
  { key: "route_team", need: "routing", title: "Route to a team", id: "route_team", type: "choice", keys: ["billing", "shipping", "product", "account", "other"],
    note: "Describe in one line what each team handles; keep “other” for messages no team owns." },
  { key: "intent", need: "routing", title: "Message intent", id: "intent", type: "choice", keys: ["request", "complaint", "question", "feedback", "other"],
    note: "Name the field that holds the message in backticks, such as `ticket.body`." },
  { key: "language", need: "routing", title: "Message language", id: "language", type: "choice", keys: ["en", "es", "fr", "de", "other"],
    note: "Keep only the languages your team answers in, plus “other”." },
  { key: "needs_human", need: "routing", title: "Needs a person", id: "needs_human", type: "noul",
    note: "Say what a yes means for your queue, for example a reply only a person can give." },
  { key: "sentiment", need: "sentiment", title: "Overall sentiment", id: "sentiment", type: "choice", keys: ["positive", "neutral", "negative", "mixed"],
    note: "Decide whether “mixed” is a real option for you or should fold into neutral." },
  { key: "sentiment_scale", need: "sentiment", title: "Sentiment on a scale", id: "sentiment_scale", type: "score", levels: 5,
    note: "Level 0 is the most negative and the last level the most positive; describe every level." },
  { key: "frustrated", need: "sentiment", title: "Customer frustrated", id: "frustrated", type: "noul",
    note: "Describe what counts as frustration, so a polite complaint is not a yes." },
  { key: "urgency", need: "urgency", title: "Urgency level", id: "urgency", type: "score", levels: 4,
    note: "Tie each level to a response time your team can keep." },
  { key: "urgency_tier", need: "urgency", title: "Urgency tier", id: "urgency_tier", type: "choice", keys: ["now", "today", "this_week", "no_rush"],
    note: "A Choice reads better than a Score when each tier maps to one queue." },
  { key: "deadline_mentioned", need: "urgency", title: "Mentions a deadline", id: "deadline_mentioned", type: "noul",
    note: "Keep date arithmetic in code: ask only whether a deadline is mentioned." },
  { key: "personal_data", need: "policy", title: "Shares personal data", id: "personal_data", type: "noul",
    note: "List the kinds of personal data your policy cares about in the yes criterion." },
  { key: "abusive_language", need: "policy", title: "Abusive language", id: "abusive_language", type: "noul",
    note: "Say where strong but non-abusive wording falls." },
  { key: "legal_threat", need: "policy", title: "Threatens legal action", id: "legal_threat", type: "noul",
    note: "Describe what a threat looks like compared with a mention of rights." },
  { key: "refund_request", need: "policy", title: "Asks for a refund", id: "refund_request", type: "noul",
    note: "Keep the refund amount check in code; ask only whether a refund is requested." },
  { key: "policy_flag", need: "policy", title: "Policy flag", id: "policy_flag", type: "choice", keys: ["none", "spam", "abuse", "fraud_risk", "other"],
    note: "Describe each flag so “none” stays the common case." },
  { key: "amount_matches", need: "extraction", title: "Amount matches the record", id: "amount_matches", type: "noul",
    note: "Point at both fields in backticks, such as `invoice.total` and `message.body`." },
  { key: "reference_present", need: "extraction", title: "Reference number present", id: "reference_present", type: "noul",
    note: "Extract the number itself with a regular expression in code; ask only whether one is given." },
  { key: "dates_agree", need: "extraction", title: "Dates agree", id: "dates_agree", type: "noul",
    note: "Compare the dates in code when both are structured fields." },
  { key: "extraction_complete", need: "extraction", title: "Extraction completeness", id: "extraction_complete", type: "choice", keys: ["complete", "partial", "missing"],
    note: "Say which fields must be present for “complete”." },
  { key: "item_location", need: "extraction", title: "Locate an item in a picture", id: "item_location", type: "box",
    note: "Name the picture's state field in the instructions; a Box needs an attached picture." },
].map((skeleton) => Object.freeze(skeleton)));

const TEMPLATES = Object.freeze([
  { key: "yes_no_unsure", title: "Yes, no or unsure", keys: ["yes", "no", "unsure"] },
  { key: "low_medium_high", title: "Low, medium or high", keys: ["low", "medium", "high"] },
  { key: "positive_neutral_negative", title: "Positive, neutral or negative", keys: ["positive", "neutral", "negative"] },
  { key: "complete_partial_missing", title: "Complete, partial or missing", keys: ["complete", "partial", "missing"] },
  { key: "none_minor_major", title: "None, minor or major", keys: ["none", "minor", "major"] },
  { key: "approve_review_reject", title: "Approve, review or reject", keys: ["approve", "review", "reject"] },
].map((template) => Object.freeze(template)));

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const itemsOf = (ctx) => { try { const list = ctx?.items?.(); return Array.isArray(list) ? list.filter(isObject) : []; } catch { return []; } };
const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const limitOf = (ctx) => (Number.isInteger(dataOf(ctx).limits?.questions) ? dataOf(ctx).limits.questions : MAX_QUESTIONS);
const qidOf = (item) => str(item.id).trim();
const nameOf = (item, index) => qidOf(item) || `question ${index + 1}`;
const currentIds = (ctx) => new Set(itemsOf(ctx).map(qidOf).filter(Boolean));
const expectIds = (ctx) => (isObject(dataOf(ctx).expect) ? Object.keys(dataOf(ctx).expect) : []);
const takenIds = (ctx) => new Set([...currentIds(ctx), ...expectIds(ctx)]);
const activeKeys = (item) => (Array.isArray(item.choice) ? item.choice.map((pair) => str(pair?.[0]).trim()).filter(Boolean) : []);

// An item of the editor as replaceItems reads it: the card's ref and the editor's own fields only.
const editable = (item) => ({ ref: str(item.ref), id: str(item.id), type: str(item.type), instructions: str(item.instructions),
  choice: Array.isArray(item.choice) ? item.choice.map((pair) => [str(pair?.[0]), str(pair?.[1])]) : [["", ""], ["", ""]],
  score: Array.isArray(item.score) ? item.score.map(str) : ["", "", ""], noulYes: str(item.noulYes), noulNo: str(item.noulNo) });

// Reports a refused page action as an error toast; true when the action went through.
function attempt(api, run) {
  try { run(); return true; } catch (error) { api.toast(error?.message || String(error), "error"); return false; }
}

// ---------- the catalog ----------

function matchesQuery(skeleton, query) {
  const words = str(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [skeleton.title, skeleton.id, skeleton.note, NEED_NAMES[skeleton.need], skeleton.type, TYPE_NAMES[skeleton.type], ...(skeleton.keys || [])]
    .join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// The skeletons the controls show, in the chosen order.
function shownSkeletons(state, ctx) {
  const used = currentIds(ctx);
  const list = SKELETONS.filter((skeleton) => (!state.need || skeleton.need === state.need) && (!state.type || skeleton.type === state.type)
    && (!state.hideUsed || !used.has(skeleton.id)) && matchesQuery(skeleton, state.query));
  const needRank = (skeleton) => NEEDS.findIndex(([need]) => need === skeleton.need);
  if (state.sort === "title") return list.slice().sort((a, b) => compareText(a.title, b.title));
  if (state.sort === "type") return list.slice().sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || compareText(a.title, b.title));
  return list.slice().sort((a, b) => needRank(a) - needRank(b));
}

// ---------- one skeleton: draft, validation, question ----------

function newDraft(skeleton, ctx) {
  return { key: skeleton.key, id: uniqueName(skeleton.id, takenIds(ctx)), drop: [], extra: [], extraText: "", levels: String(skeleton.levels ?? ""), position: "end" };
}

function idError(id, ctx) {
  const qid = str(id).trim();
  if (!qid) return "Give the question an id.";
  if (/\s/.test(qid)) return "An id cannot contain spaces.";
  if (currentIds(ctx).has(qid)) return `“${qid}” is already a question id in the editor.`;
  if (expectIds(ctx).includes(qid)) return `Expectations already exist for “${qid}”; choose another id.`;
  return null;
}

const draftKeys = (skeleton, draft) => [...(skeleton.keys || []).filter((key) => !draft.drop.includes(key)), ...draft.extra];

function levelCount(draft) {
  const text = str(draft.levels).trim();
  const count = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isInteger(count) && count >= MIN_LEVELS && count <= MAX_LEVELS ? count : null;
}

// The question the draft would add, or { error }.
function draftQuestion(skeleton, draft, ctx) {
  const error = idError(draft.id, ctx);
  if (error) return { error };
  const question = { id: str(draft.id).trim(), type: skeleton.type, instructions: "", noulYes: "", noulNo: "" };
  if (skeleton.type === "choice") {
    const keys = draftKeys(skeleton, draft);
    if (keys.length < 2) return { error: "Keep at least two option keys." };
    question.choice = keys.map((key) => [key, ""]);
  }
  if (skeleton.type === "score") {
    const count = levelCount(draft);
    if (count === null) return { error: `A Score takes ${MIN_LEVELS} to ${MAX_LEVELS} levels.` };
    question.score = Array.from({ length: count }, () => "");
  }
  return { question };
}

// What the person still writes once the skeleton is in the editor.
function toWrite(question) {
  const out = ["the instructions"];
  if (question.type === "choice") out.push(plural(question.choice.length, "option description"));
  if (question.type === "score") out.push(plural(question.score.length, "level text"));
  if (question.type === "noul") out.push("what a yes means (and, if useful, what a no means)");
  if (question.type === "box") out.push("which picture it looks at (attach one in Pictures)");
  return out;
}

// Plain defaults for a skeleton in a batch: its own keys and levels, a free id.
function defaultQuestion(skeleton, id) {
  const question = { id, type: skeleton.type, instructions: "", noulYes: "", noulNo: "" };
  if (skeleton.type === "choice") question.choice = skeleton.keys.map((key) => [key, ""]);
  if (skeleton.type === "score") question.score = Array.from({ length: skeleton.levels }, () => "");
  return question;
}

function batchPlan(keys, ctx) {
  const taken = takenIds(ctx);
  return SKELETONS.filter((skeleton) => keys.includes(skeleton.key)).map((skeleton) => {
    const id = uniqueName(skeleton.id, taken);
    taken.add(id);
    return { skeleton, question: defaultQuestion(skeleton, id) };
  });
}

// ---------- templates ----------

// The Choice rows after adding a template's missing keys: blank placeholder rows (key and description empty) are
// filled first, in order, and the rest is appended. Descriptions stay blank. Existing rows never change or move.
function templatePlan(item, keys) {
  const have = new Set(activeKeys(item));
  const already = keys.filter((key) => have.has(key));
  const gain = keys.filter((key) => !have.has(key));
  const choice = (Array.isArray(item.choice) ? item.choice : []).map((pair) => [str(pair?.[0]), str(pair?.[1])]);
  const queue = gain.slice();
  for (const row of choice) if (queue.length && !row[0].trim() && !row[1].trim()) row[0] = queue.shift();
  for (const key of queue) choice.push([key, ""]);
  return { already, gain, choice };
}

const allTemplates = (state) => [...TEMPLATES, ...(state.custom || [])];

function catalogMarkdown() {
  const lines = ["# Question library", "", "Generic question skeletons from Jev Lab's Build library. Each holds an id, a type, Choice option keys or a number "
    + "of Score levels only; instructions and criteria are yours to write. Notes are guidance for the person writing the question.", ""];
  for (const [need, title] of NEEDS) {
    lines.push(`## ${title}`, "");
    for (const skeleton of SKELETONS.filter((entry) => entry.need === need)) {
      const shape = skeleton.type === "choice" ? `; keys ${skeleton.keys.map((key) => `\`${key}\``).join(", ")}`
        : skeleton.type === "score" ? `; ${skeleton.levels} levels` : "";
      lines.push(`- **${skeleton.title}**: \`${skeleton.id}\` (${skeleton.type}${shape}). ${skeleton.note}`);
    }
    lines.push("");
  }
  lines.push("## Choice key templates", "");
  for (const template of TEMPLATES) lines.push(`- **${template.title}**: ${template.keys.map((key) => `\`${key}\``).join(", ")}`);
  return `${lines.join("\n")}\n`;
}

// ---------- the panel ----------

function render(h, ctx, api) {
  const state = api.state;
  state.selected ||= [];
  state.added ||= [];
  state.custom ||= [];
  const items = itemsOf(ctx);
  const used = currentIds(ctx);
  const limit = limitOf(ctx);
  const room = Math.max(0, limit - items.length);
  const redraw = () => api.redraw();
  const select = (role, value, options, onPick, label) => h("select", { "data-role": role, "aria-label": label, value,
    onchange: (event) => { onPick(event.target.value); redraw(); } }, options.map(([key, text]) => h("option", { value: key, selected: key === value }, text)));

  // --- catalog list (re-mounted on every search keystroke so typing keeps focus) ---
  const listBox = h("div", { "data-role": "list" });
  const fillList = () => {
    const shown = shownSkeletons(state, ctx);
    const row = (skeleton) => h("li", { "data-skeleton": skeleton.key },
      h("input", { type: "checkbox", "data-select": skeleton.key, "aria-label": `Select ${skeleton.title}`, checked: state.selected.includes(skeleton.key),
        onchange: (event) => {
          state.selected = event.target.checked ? [...new Set([...state.selected, skeleton.key])] : state.selected.filter((key) => key !== skeleton.key);
          state.batch = null;
          redraw();
        } }),
      " ", h("strong", {}, skeleton.title), " ",
      h("span", { class: "faint" }, `${skeleton.id} · ${skeleton.type}${skeleton.keys ? ` · ${skeleton.keys.join(", ")}` : skeleton.levels ? ` · ${skeleton.levels} levels` : ""}`),
      used.has(skeleton.id) ? h("span", { class: "badge", "data-in-editor": skeleton.key }, " in editor") : null, " ",
      h("button", { class: "btn sm ghost", "data-act": "preview", "data-key": skeleton.key,
        onclick: () => { state.preview = skeleton.key; state.draft = newDraft(skeleton, ctx); redraw(); } }, "Preview"));
    const body = [h("p", { class: "faint", "data-role": "count" }, `${shown.length} of ${plural(SKELETONS.length, "skeleton")} shown`)];
    if (!shown.length) {
      body.push(h("p", { "data-role": "no-match" }, "No skeleton matches. ",
        h("button", { class: "btn sm ghost", "data-act": "reset-empty", onclick: () => { Object.assign(state, { query: "", need: "", type: "", hideUsed: false }); redraw(); } }, "Reset the library")));
    } else if (!state.sort || state.sort === "need") {
      for (const [need, title] of NEEDS) {
        const group = shown.filter((skeleton) => skeleton.need === need);
        if (group.length) body.push(h("h4", { "data-need": need }, `${title} · ${group.length}`), h("ul", {}, group.map(row)));
      }
    } else body.push(h("ul", {}, shown.map(row)));
    api.mount(listBox, body);
  };
  fillList();

  const controls = h("div", { class: "chips lab-row" },
    h("input", { class: "input sm", type: "search", "data-role": "search", "aria-label": "Search the question library", placeholder: "Search skeletons",
      value: state.query || "", oninput: (event) => { state.query = event.target.value; fillList(); } }),
    select("need", state.need || "", [["", "Every need"], ...NEEDS], (value) => { state.need = value; }, "Need"),
    select("type", state.type || "", [["", "Every type"], ...TYPES.map((type) => [type, TYPE_NAMES[type]])], (value) => { state.type = value; }, "Question type"),
    select("sort", state.sort || "need", [["need", "Group by need"], ["title", "Sort by title"], ["type", "Sort by type"]], (value) => { state.sort = value; }, "Order"),
    h("label", {}, h("input", { type: "checkbox", "data-role": "hide-used", checked: !!state.hideUsed,
      onchange: (event) => { state.hideUsed = event.target.checked === true; redraw(); } }), " Hide skeletons already in the editor"),
    h("button", { class: "btn sm ghost", "data-act": "reset", onclick: () => { Object.assign(state, { query: "", need: "", type: "", hideUsed: false }); redraw(); } }, "Reset"));

  const roomLine = h("p", { class: "faint", "data-role": "room" },
    `Room for ${plural(room, "more question")} (${items.length} of ${limit} used). Skeletons bring structure only: you write the instructions and criteria.`);

  // --- batch ---
  const batchBox = [];
  const selectedCount = state.selected.length;
  batchBox.push(h("div", { class: "chips lab-row" },
    h("button", { class: "btn sm ghost", "data-act": "select-shown", onclick: () => {
      state.selected = [...new Set([...state.selected, ...shownSkeletons(state, ctx).map((skeleton) => skeleton.key)])];
      state.batch = null; redraw();
    } }, "Select shown"),
    h("button", { class: "btn sm ghost", "data-act": "clear-selection", onclick: () => { state.selected = []; state.batch = null; redraw(); } }, "Clear selection"),
    h("button", { class: "btn sm", "data-act": "batch-preview", disabled: !selectedCount, onclick: () => {
      if (!state.selected.length) { api.toast("Select at least one skeleton.", "error"); return; }
      state.batch = state.selected.slice(); redraw();
    } }, `Preview adding ${plural(selectedCount, "selected skeleton")}`)));
  if (state.batch) {
    const plan = batchPlan(state.batch, ctx);
    const fits = plan.length <= room;
    batchBox.push(h("div", { "data-role": "batch" },
      h("p", {}, `Adding ${plural(plan.length, "question")} at the end, each with blank instructions and criteria:`),
      h("ul", {}, plan.map(({ skeleton, question }) => h("li", { "data-batch-id": question.id }, `${skeleton.title} → ${question.id} (${question.type})`))),
      fits ? null : h("p", { class: "lab-error", "data-role": "batch-room" }, `Only ${plural(room, "more question")} fit${room === 1 ? "s" : ""} in this request.`),
      h("button", { class: "btn sm primary", "data-act": "batch-add", disabled: !fits, onclick: () => {
        const now = batchPlan(state.batch || [], ctx);
        if (now.length > Math.max(0, limitOf(ctx) - itemsOf(ctx).length)) { api.toast(`A request takes at most ${limitOf(ctx)} questions.`, "error"); return; }
        if (attempt(api, () => ctx.actions.importItems(now.map((entry) => entry.question), { label: `Add ${plural(now.length, "question")} from the library` }))) {
          state.added.push(...now.map(({ skeleton, question }) => ({ qid: question.id, title: skeleton.title })));
          state.batch = null; state.selected = [];
          api.toast(`Added ${now.map((entry) => entry.question.id).join(", ")}. Write their instructions and criteria.`, "success");
        }
        redraw();
      } }, `Add ${plural(plan.length, "question")}`),
      h("button", { class: "btn sm ghost", "data-act": "batch-cancel", onclick: () => { state.batch = null; redraw(); } }, "Cancel")));
  }

  // --- preview of one skeleton ---
  let previewBox = null;
  const skeleton = SKELETONS.find((entry) => entry.key === state.preview);
  if (skeleton && state.draft?.key === skeleton.key) {
    const draft = state.draft;
    const made = draftQuestion(skeleton, draft, ctx);
    const takenNote = used.has(skeleton.id) || expectIds(ctx).includes(skeleton.id)
      ? h("p", { class: "faint", "data-role": "free-id" }, `“${skeleton.id}” is taken here, so the suggested id is “${uniqueName(skeleton.id, takenIds(ctx))}”.`) : null;
    const keyControls = skeleton.type !== "choice" ? null : h("div", { "data-role": "keys" },
      h("p", {}, "Option keys to bring (descriptions stay blank):"),
      [...skeleton.keys, ...draft.extra].map((key) => h("label", { class: "chip" },
        h("input", { type: "checkbox", "data-key": key, checked: !draft.drop.includes(key), onchange: (event) => {
          if (draft.extra.includes(key) && event.target.checked !== true) draft.extra = draft.extra.filter((entry) => entry !== key);
          else draft.drop = event.target.checked === true ? draft.drop.filter((entry) => entry !== key) : [...new Set([...draft.drop, key])];
          redraw();
        } }), ` ${key}`)),
      h("div", { class: "chips lab-row" },
        h("input", { class: "input sm", "data-role": "extra-key", "aria-label": "Another option key", placeholder: "Another option key", value: draft.extraText,
          oninput: (event) => { draft.extraText = event.target.value; } }),
        h("button", { class: "btn sm ghost", "data-act": "extra-key", onclick: () => {
          const key = str(draft.extraText).trim();
          if (!key) { api.toast("Type an option key first.", "error"); return; }
          if (!KEY_PATTERN.test(key)) { api.toast("An option key uses letters, digits, _ . and - only.", "error"); return; }
          if ([...skeleton.keys, ...draft.extra].includes(key)) {
            if (draft.drop.includes(key)) draft.drop = draft.drop.filter((entry) => entry !== key);
            else { api.toast(`“${key}” is already an option key here.`, "error"); return; }
          } else draft.extra.push(key);
          draft.extraText = ""; redraw();
        } }, "Add key")));
    const levelControl = skeleton.type !== "score" ? null : h("label", {}, "Score levels ",
      h("input", { class: "input sm", type: "number", min: MIN_LEVELS, max: MAX_LEVELS, "data-role": "levels", value: draft.levels,
        oninput: (event) => { draft.levels = event.target.value; }, onchange: (event) => { draft.levels = event.target.value; redraw(); } }),
      " (level 0 is the lowest; each level's number is its meaning)");
    const positions = [["end", "At the end"], ...items.map((item, index) => [str(item.ref), `After ${nameOf(item, index)}`])];
    previewBox = h("div", { "data-role": "preview", "data-key": skeleton.key },
      h("h4", {}, `${skeleton.title} · ${TYPE_NAMES[skeleton.type]}`),
      h("p", { class: "faint", "data-role": "note" }, `Note for you (never added to the question): ${skeleton.note}`),
      h("label", {}, "Question id ", h("input", { class: "input sm", "data-role": "id", value: draft.id, "aria-label": "Question id",
        oninput: (event) => { draft.id = event.target.value; }, onchange: (event) => { draft.id = event.target.value; redraw(); } })),
      takenNote, keyControls, levelControl,
      made.error ? h("p", { class: "lab-error", role: "alert", "data-role": "draft-error" }, made.error) : [
        h("p", {}, "You write after adding:"),
        h("ul", { "data-role": "to-write" }, toWrite(made.question).map((entry) => h("li", {}, entry))),
        h("pre", { "data-role": "json" }, JSON.stringify(made.question, null, 2)),
      ],
      h("div", { class: "chips lab-row" },
        h("label", {}, "Add ", h("select", { "data-role": "position", value: draft.position,
          onchange: (event) => { draft.position = event.target.value; redraw(); } }, positions.map(([value, text]) => h("option", { value, selected: value === draft.position }, text)))),
        h("button", { class: "btn sm primary", "data-act": "add", onclick: () => {
          const now = draftQuestion(skeleton, draft, ctx);
          if (now.error) { api.toast(now.error, "error"); redraw(); return; }
          const label = `Add ${skeleton.title} from the library`;
          let ok;
          if (draft.position === "end") ok = attempt(api, () => ctx.actions.importItems([now.question], { label }));
          else {
            const list = itemsOf(ctx);
            const at = list.findIndex((item) => str(item.ref) === draft.position);
            if (at < 0) { api.toast("That question is no longer in the editor. Choose where to add again.", "error"); draft.position = "end"; redraw(); return; }
            const next = list.map(editable);
            next.splice(at + 1, 0, now.question);
            ok = attempt(api, () => ctx.actions.replaceItems(next, { label }));
          }
          if (ok) {
            state.added.push({ qid: now.question.id, title: skeleton.title });
            state.preview = null; state.draft = null;
            api.toast(`Added “${now.question.id}”. Write its ${toWrite(now.question).join(", ")}.`, "success");
          }
          redraw();
        } }, "Add to the editor"),
        h("button", { class: "btn sm ghost", "data-act": "copy-json", onclick: () => {
          const now = draftQuestion(skeleton, draft, ctx);
          if (now.error) { api.toast(now.error, "error"); return; }
          api.copy(JSON.stringify(now.question, null, 2));
          api.toast("Copied the skeleton question as JSON (id, type and blank fields only).", "success");
        } }, "Copy JSON"),
        h("button", { class: "btn sm ghost", "data-act": "close-preview", onclick: () => { state.preview = null; state.draft = null; redraw(); } }, "Close")));
  }

  // --- added this session ---
  const addedBox = !state.added.length ? null : h("div", { "data-role": "added" },
    h("h4", {}, `Added from the library this session · ${state.added.length}`),
    h("ul", {}, state.added.map((entry, index) => h("li", { "data-added": entry.qid }, `${entry.qid} (${entry.title})`,
      used.has(entry.qid) ? h("button", { class: "btn sm ghost", "data-act": "goto", "data-qid": entry.qid, "data-index": String(index),
        onclick: () => attempt(api, () => ctx.actions.focus(entry.qid)) }, "Go to") : h("span", { class: "faint" }, " (no longer in the editor)")))));

  // --- templates ---
  const choiceItems = items.filter((item) => item.type === "choice" && qidOf(item));
  if (!choiceItems.some((item) => str(item.ref) === state.target)) state.target = choiceItems.length ? str(choiceItems[0].ref) : "";
  const target = choiceItems.find((item) => str(item.ref) === state.target) || null;
  const templates = allTemplates(state);
  const templatePreview = state.templatePreview && target && templates.find((entry) => entry.key === state.templatePreview);
  const templatesBox = h("div", { "data-role": "templates" },
    h("h4", {}, "Choice key templates"),
    choiceItems.length ? h("label", {}, "Question ", h("select", { "data-role": "template-target", value: state.target,
      onchange: (event) => { state.target = event.target.value; state.templatePreview = null; redraw(); } },
      choiceItems.map((item) => h("option", { value: str(item.ref), selected: str(item.ref) === state.target }, qidOf(item)))))
      : h("p", { class: "faint", "data-role": "no-target" }, "Add a Choice question with an id to use a template."),
    h("ul", {}, templates.map((template) => h("li", { "data-template": template.key }, h("strong", {}, template.title), " ",
      h("span", { class: "faint" }, template.keys.join(", ")), " ",
      target ? h("button", { class: "btn sm ghost", "data-act": "template-preview", "data-template": template.key,
        onclick: () => { state.templatePreview = template.key; redraw(); } }, "Preview") : null))),
    target ? h("button", { class: "btn sm ghost", "data-act": "template-save", onclick: () => {
      const keys = activeKeys(target);
      if (keys.length < 2) { api.toast(`“${qidOf(target)}” needs at least two option keys to make a template.`, "error"); return; }
      if (allTemplates(state).some((entry) => JSON.stringify(entry.keys) === JSON.stringify(keys))) { api.toast("A template with these keys already exists.", "error"); return; }
      state.customSeq = (state.customSeq || 0) + 1;
      state.custom.push({ key: `session_${state.customSeq}`, title: `Keys of “${qidOf(target)}” (this session)`, keys });
      api.toast(`Saved the keys of “${qidOf(target)}” as a template for this page session.`, "success");
      redraw();
    } }, "Save this question's keys as a template") : null,
    templatePreview ? (() => {
      const plan = templatePlan(target, templatePreview.keys);
      return h("div", { "data-role": "template-preview" },
        h("p", { "data-role": "template-has" }, plan.already.length ? `${qidOf(target)} already has: ${plan.already.join(", ")}.` : `${qidOf(target)} has none of these keys yet.`),
        h("p", { "data-role": "template-gain" }, plan.gain.length ? `It would gain: ${plan.gain.join(", ")} (blank descriptions; blank rows are filled first).` : "Nothing to add."),
        plan.gain.length ? h("button", { class: "btn sm primary", "data-act": "template-apply", onclick: () => {
          const list = itemsOf(ctx);
          const now = list.find((item) => str(item.ref) === state.target);
          if (!now || now.type !== "choice") { api.toast("That question is no longer a Choice in the editor.", "error"); state.templatePreview = null; redraw(); return; }
          const fresh = templatePlan(now, templatePreview.keys);
          if (!fresh.gain.length) { api.toast(`“${qidOf(now)}” already has every key of this template.`, "error"); redraw(); return; }
          const next = list.map((item) => (item === now ? { ...editable(item), choice: fresh.choice } : editable(item)));
          if (attempt(api, () => ctx.actions.replaceItems(next, { label: `Add ${templatePreview.title} keys to ${qidOf(now)}` }))) {
            api.toast(`Added ${fresh.gain.join(", ")} to “${qidOf(now)}”. Write their descriptions.`, "success");
            state.templatePreview = null;
          }
          redraw();
        } }, `Add ${plural(plan.gain.length, "key")}`) : null);
    })() : null);

  return h("div", { class: "lab-library" },
    h("p", { class: "faint" }, "Generic question skeletons for common needs. Nothing is added until you press Add, and nothing is sent anywhere."),
    controls, roomLine, listBox, batchBox, previewBox, addedBox, templatesBox,
    h("div", { class: "chips lab-row" }, h("button", { class: "btn sm ghost", "data-act": "catalog", onclick: () => {
      api.download("jev-question-library.md", catalogMarkdown(), "text/markdown");
      api.toast("Downloaded the library catalog (skeletons, keys and notes only).", "success");
    } }, "Download the catalog (Markdown)")));
}

export default definePack({
  id: "build-library",
  surface: "workbench.build.questions",
  title: "Question library",
  about: "A library of generic question skeletons for routing, sentiment, urgency, policy flags and extraction checks, plus Choice key templates, each previewed before it is added through the editor's own import. Skeletons carry ids, types, option keys and level counts only; instructions and criteria stay blank for you to write, notes are never added to a question, and nothing is sent anywhere.",
  features: [
    { id: "library", kind: "panel", title: "Question library", render, improvements: [
      { id: "catalog", title: "Browse generic question skeletons grouped by need" },
      { id: "need", title: "Show the skeletons of one need: routing, sentiment, urgency, policy flags or extraction checks" },
      { id: "type", title: "Show library skeletons of one question type" },
      { id: "search", title: "Search the library by title, id, option key or note as you type" },
      { id: "reset", title: "Say when no skeleton matches and reset the library filters in one press" },
      { id: "sort", title: "Order the library by need, title or type" },
      { id: "in_editor", title: "Mark skeletons whose id is already in the editor" },
      { id: "hide_used", title: "Hide skeletons already in the editor" },
      { id: "preview", title: "Preview a skeleton's exact question before adding it" },
      { id: "to_write", title: "List what you still write after adding: instructions, descriptions or level texts" },
      { id: "note", title: "Show each skeleton's authoring note, which is never added to the question" },
      { id: "custom_id", title: "Choose a skeleton's id before adding, checked against the editor's ids and expectations" },
      { id: "free_id", title: "Suggest a free id when a skeleton's id is taken" },
      { id: "pick_keys", title: "Choose which option keys a Choice skeleton brings" },
      { id: "extra_key", title: "Add your own option key to a Choice skeleton before adding it" },
      { id: "level_count", title: "Choose how many level slots a Score skeleton brings (2 to 25)" },
      { id: "add", title: "Add a previewed skeleton through the editor's own import" },
      { id: "insert_at", title: "Insert a skeleton after a chosen question instead of at the end" },
      { id: "copy_json", title: "Copy a previewed skeleton as question JSON" },
      { id: "select_shown", title: "Select every shown skeleton, keeping hidden selections" },
      { id: "batch_preview", title: "Preview the ids a batch of skeletons would get before adding them" },
      { id: "batch_add", title: "Add every selected skeleton in one edit, each with a free id" },
      { id: "room", title: "Show the request's room for more questions and refuse a batch that does not fit" },
      { id: "added_log", title: "List the questions added from the library this session, with Go to" },
      { id: "templates", title: "Browse Choice key templates" },
      { id: "template_preview", title: "Preview which template keys a Choice question already has and which it would gain" },
      { id: "template_apply", title: "Add a template's missing keys to a Choice question, filling blank rows first" },
      { id: "template_save", title: "Save a question's Choice keys as a template for this page session" },
      { id: "catalog_md", title: "Download the library catalog as Markdown" },
    ] },
  ],
});
