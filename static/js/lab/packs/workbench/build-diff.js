// Request diffs and session checkpoints for the Workbench Build editor ("workbench.build.questions"; contract in
// static/js/lab/surfaces/workbench-build.js). A checkpoint is a named copy of the editor's questions (ids, types,
// instructions and criteria as typed, plus each card's session reference) kept in this panel's page memory only:
// never in storage, never sent anywhere, gone when the page is closed. The diff compares instructions exactly as typed
// and the ACTIVE criteria (keys and texts with edge spaces trimmed; blank placeholder rows and levels are ignored).
// Questions are matched by their editor card first, so a rename is a rename, then by id (after Raw JSON replaced the
// cards). Restoring goes through the surface's replaceItems, which keeps expectations with their cards and refuses
// while Raw JSON has unapplied edits. Nothing here reads state, pictures, expectations' values or answers.
import { definePack } from "../../kit.js";
import { fingerprint, slugify } from "../../lib/text.js";

const MAX_CHECKPOINTS = 20;
const BASELINE = "When this panel opened";
const RAW_PENDING = "Apply the Raw JSON edits before sharing editor questions.";

// Change kinds in report order, with their summary words and the group the kind filter uses.
const KINDS = Object.freeze([
  ["added", "added", "questions"], ["removed", "removed", "questions"], ["renamed", "renamed", "questions"], ["moved", "moved", "questions"],
  ["type", "type changed", "types"], ["reworded", "reworded", "wording"], ["spacing", "whitespace only", "wording"],
  ["keys_added", "option keys added", "criteria"], ["keys_removed", "option keys removed", "criteria"], ["descriptions", "descriptions changed", "criteria"],
  ["options_order", "options reordered", "criteria"], ["levels", "levels changed", "criteria"], ["level_count", "level count changed", "criteria"],
  ["noul", "yes/no criteria changed", "criteria"],
]);
const KIND_WORDS = Object.fromEntries(KINDS.map(([kind, words]) => [kind, words]));
const KIND_GROUP = Object.fromEntries(KINDS.map(([kind, , group]) => [kind, group]));
const GROUPS = Object.freeze([["", "Every change"], ["questions", "Added, removed, renamed or moved"], ["types", "Type changes"], ["wording", "Instruction changes"],
  ["criteria", "Criteria changes"]]);
const CONTENT_KINDS = new Set(["renamed", "type", "reworded", "spacing", "keys_added", "keys_removed", "descriptions", "options_order", "levels", "level_count", "noul"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const squeeze = (text) => str(text).replace(/\s+/g, " ").trim();
const quote = (text) => `“${text}”`;

// ---------- snapshots ----------

const snapOf = (item) => ({ ref: str(item.ref), id: str(item.id), type: str(item.type), instructions: str(item.instructions),
  choice: Array.isArray(item.choice) ? item.choice.map((pair) => [str(pair?.[0]), str(pair?.[1])]) : [],
  score: Array.isArray(item.score) ? item.score.map(str) : [], noulYes: str(item.noulYes), noulNo: str(item.noulNo) });

function nowOf(ctx) {
  try {
    const list = ctx?.items?.();
    return Array.isArray(list) ? list.filter(isObject).map(snapOf) : [];
  } catch { return []; }
}

const qidOf = (question) => question.id.trim();
const nameAt = (question, index) => qidOf(question) || `question ${index + 1}`;
const tokenOf = (questions) => fingerprint(JSON.stringify(questions.map(({ ref, ...rest }) => [ref, rest])));

// The criteria the request sends, keyed: Choice rows with a key, Score levels that are not blank, Noul sides that are set.
function criteriaOf(question) {
  if (question.type === "choice") return question.choice.filter(([key]) => key.trim()).map(([key, text]) => ({ key: key.trim(), text: text.trim() }));
  if (question.type === "score") return question.score.filter((level) => level.trim()).map((level, index) => ({ key: String(index), text: level.trim() }));
  return [];
}

// ---------- the diff ----------

// Pairs the questions of two snapshots: by card reference first, then by id among the rest. Returns, for each
// question of `after`, the index of its partner in `before` (or -1).
function pairUp(before, after) {
  const used = new Set();
  const partner = after.map(() => -1);
  const byRef = new Map();
  before.forEach((question, index) => { if (question.ref && !byRef.has(question.ref)) byRef.set(question.ref, index); });
  after.forEach((question, index) => {
    const at = question.ref ? byRef.get(question.ref) : undefined;
    if (at !== undefined && !used.has(at)) { used.add(at); partner[index] = at; }
  });
  after.forEach((question, index) => {
    if (partner[index] >= 0 || !qidOf(question)) return;
    const at = before.findIndex((other, k) => !used.has(k) && qidOf(other) === qidOf(question));
    if (at >= 0) { used.add(at); partner[index] = at; }
  });
  return partner;
}

// Positions (in `after` order) of the paired questions that keep their relative order: one longest increasing run of
// their `before` indexes. The others are the fewest questions whose moves explain the new order.
function steady(sequence) {
  const tails = [], tailAt = [], previous = sequence.map(() => -1);
  sequence.forEach((value, index) => {
    let low = 0, high = tails.length;
    while (low < high) { const mid = (low + high) >> 1; if (tails[mid] < value) low = mid + 1; else high = mid; }
    tails[low] = value; tailAt[low] = index;
    previous[index] = low ? tailAt[low - 1] : -1;
  });
  const keep = new Set();
  for (let index = tails.length ? tailAt[tails.length - 1] : -1; index >= 0; index = previous[index]) keep.add(index);
  return keep;
}

function criteriaChanges(b, a, name, ignoreSpace, push) {
  const same = (x, y) => (ignoreSpace ? squeeze(x) === squeeze(y) : x === y);
  if (a.type === "choice") {
    const before = criteriaOf(b), after = criteriaOf(a);
    const beforeKeys = before.map((entry) => entry.key), afterKeys = after.map((entry) => entry.key);
    const gained = afterKeys.filter((key) => !beforeKeys.includes(key));
    const lost = beforeKeys.filter((key) => !afterKeys.includes(key));
    if (gained.length) push("keys_added", `${name}: option keys added: ${gained.join(", ")}.`);
    if (lost.length) push("keys_removed", `${name}: option keys removed: ${lost.join(", ")}.`);
    const changed = after.filter((entry) => { const old = before.find((other) => other.key === entry.key); return old && !same(old.text, entry.text); });
    if (changed.length) {
      push("descriptions", `${name}: descriptions changed for ${changed.map((entry) => entry.key).join(", ")}.`,
        changed.map((entry) => ({ label: entry.key, before: before.find((other) => other.key === entry.key).text, after: entry.text })));
    }
    const commonBefore = beforeKeys.filter((key) => afterKeys.includes(key)), commonAfter = afterKeys.filter((key) => beforeKeys.includes(key));
    if (commonBefore.join("\u0000") !== commonAfter.join("\u0000")) push("options_order", `${name}: options reordered: ${commonBefore.join(", ")} → ${commonAfter.join(", ")}.`);
  } else if (a.type === "score") {
    const before = criteriaOf(b).map((entry) => entry.text), after = criteriaOf(a).map((entry) => entry.text);
    const changed = [];
    for (let level = 0; level < Math.min(before.length, after.length); level++) if (!same(before[level], after[level])) changed.push(level);
    if (changed.length) {
      push("levels", `${name}: text of level ${changed.join(", ")} changed. A level's number is its meaning, so answers before and after are not comparable there.`,
        changed.map((level) => ({ label: `level ${level}`, before: before[level], after: after[level] })));
    }
    if (before.length !== after.length) push("level_count", `${name}: ${plural(before.length, "level")} → ${plural(after.length, "level")}; the score's scale changed.`);
  } else if (a.type === "noul") {
    const sides = [["yes", b.noulYes, a.noulYes], ["no", b.noulNo, a.noulNo]].filter(([, x, y]) => !same(x.trim(), y.trim()));
    if (sides.length) {
      push("noul", `${name}: ${sides.length === 2 ? "what a yes and a no mean" : `what a ${sides[0][0]} means`} changed.`,
        sides.map(([side, x, y]) => ({ label: side, before: x.trim(), after: y.trim() })));
    }
  }
}

// Every change from `before` to `after`, in the order of `after` (removed questions last).
function diff(before, after, { ignoreSpace = false } = {}) {
  const partner = pairUp(before, after);
  const pairedAt = [];
  partner.forEach((at, index) => { if (at >= 0) pairedAt.push(index); });
  const keep = steady(pairedAt.map((index) => partner[index]));
  const moved = new Set(pairedAt.filter((_, k) => !keep.has(k)));
  const changes = [];
  after.forEach((a, j) => {
    const i = partner[j];
    const name = nameAt(a, j);
    const push = (kind, text, details = []) => changes.push({ kind, qid: qidOf(a), ref: a.ref, at: j, from: i < 0 ? null : i, text, details });
    if (i < 0) { push("added", `Added ${name} (${a.type}) at position ${j + 1}.`); return; }
    const b = before[i];
    if (qidOf(b) !== qidOf(a)) push("renamed", `Renamed ${quote(qidOf(b) || "(no id)")} to ${quote(qidOf(a) || "(no id)")}.`);
    if (moved.has(j)) push("moved", `Moved ${name} from position ${i + 1} to ${j + 1}.`);
    if (b.type !== a.type) push("type", `${name}: type ${b.type} → ${a.type}.`);
    if (b.instructions !== a.instructions) {
      if (squeeze(b.instructions) !== squeeze(a.instructions)) {
        push("reworded", `${name}: instructions reworded (${b.instructions.length} → ${a.instructions.length} characters).`,
          [{ label: "instructions", before: b.instructions, after: a.instructions }]);
      } else if (!ignoreSpace) push("spacing", `${name}: instructions changed in whitespace only.`);
    }
    if (b.type === a.type) criteriaChanges(b, a, name, ignoreSpace, push);
  });
  const matched = new Set(partner.filter((at) => at >= 0));
  before.forEach((b, i) => {
    if (matched.has(i)) return;
    changes.push({ kind: "removed", qid: qidOf(b), ref: b.ref, at: null, from: i, text: `Removed ${nameAt(b, i)} (${b.type}) from position ${i + 1}.`, details: [] });
  });
  return { changes, partner };
}

function summaryOf(changes) {
  if (!changes.length) return "No changes.";
  const counts = KINDS.map(([kind, words]) => [words, changes.filter((change) => change.kind === kind).length]).filter(([, count]) => count);
  return `${plural(changes.length, "change")}: ${counts.map(([words, count]) => `${count} ${words}`).join(", ")}.`;
}

// ---------- handoffs ----------

function fence(text) {
  const longest = Math.max(2, ...(str(text).match(/`+/g) || []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}\n${text}\n${ticks}`;
}

function diffMarkdown(title, changes) {
  const lines = [`# ${title}`, "", "Authored questions only: ids, change kinds, instructions and criteria. No state, pictures, expectations or answers.", "",
    summaryOf(changes), ""];
  for (const change of changes) {
    lines.push(`- **${KIND_WORDS[change.kind]}**: ${change.text}`);
    for (const detail of change.details) lines.push("", `  ${detail.label} before:`, "", fence(detail.before), "", `  ${detail.label} after:`, "", fence(detail.after), "");
  }
  return `${lines.join("\n")}\n`;
}

const parseMaybeJson = (text) => {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) { try { return JSON.parse(trimmed); } catch { /* sent as text */ } }
  return text;
};

// The checkpoint as the request's questions map (the shape Raw JSON takes), built the way the editor builds the request.
function questionsMap(questions) {
  const out = {};
  const seen = new Set();
  for (const question of questions) {
    const qid = qidOf(question);
    if (!qid) continue;
    if (seen.has(qid)) throw new Error(`This checkpoint repeats the id ${quote(qid)}, so it is not a valid questions map.`);
    seen.add(qid);
    const entry = { type: question.type, instructions: parseMaybeJson(question.instructions) };
    if (question.type === "choice") {
      const keys = question.choice.map(([key]) => key.trim()).filter(Boolean);
      const repeated = keys.find((key, index) => keys.indexOf(key) !== index);
      if (repeated !== undefined) throw new Error(`In this checkpoint, ${quote(qid)} repeats the option key ${quote(repeated)}, so it is not a valid questions map.`);
      entry.criteria = Object.fromEntries(question.choice.filter(([key]) => key.trim()).map(([key, text]) => [key.trim(), text.trim() ? parseMaybeJson(text) : null]));
    } else if (question.type === "score") entry.criteria = question.score.filter((level) => level.trim()).map(parseMaybeJson);
    else if (question.type === "noul" && (question.noulYes.trim() || question.noulNo.trim())) {
      entry.criteria = { true: question.noulYes.trim() ? parseMaybeJson(question.noulYes) : null, false: question.noulNo.trim() ? parseMaybeJson(question.noulNo) : null };
    }
    Object.defineProperty(out, qid, { value: entry, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// ---------- checkpoints in page memory ----------

function ensure(state, ctx) {
  if (!Array.isArray(state.checkpoints)) {
    state.checkpoints = [{ seq: 1, name: BASELINE, questions: nowOf(ctx) }];
    state.seq = 1;
  }
}

// Adds a checkpoint, keeping the newest MAX_CHECKPOINTS. Returns the dropped one, if any.
function remember(state, name, questions) {
  state.seq += 1;
  state.checkpoints.push({ seq: state.seq, name, questions });
  return state.checkpoints.length > MAX_CHECKPOINTS ? state.checkpoints.shift() : null;
}

function uniqueCheckpointName(state, base) {
  const names = new Set(state.checkpoints.map((checkpoint) => checkpoint.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} (${n})`)) return `${base} (${n})`;
}

// The editor list a restore of `target` sends to replaceItems: each question keeps the card it is paired with now.
function restoreList(now, target) {
  const partner = pairUp(now, target);
  return target.map((question, index) => ({ ...question, ref: partner[index] >= 0 ? now[partner[index]].ref : "" }));
}

const attempt = (api, run) => { try { run(); return true; } catch (error) { api.toast(error?.message || String(error), "error"); return false; } };

// ---------- the panel ----------

function render(h, ctx, api) {
  const state = api.state;
  ensure(state, ctx);
  const now = nowOf(ctx);
  const ignoreSpace = !!state.ignoreSpace;
  const checkpoints = state.checkpoints;
  const find = (seq) => checkpoints.find((checkpoint) => String(checkpoint.seq) === String(seq)) || null;
  const redraw = () => api.redraw();
  const rawPending = ctx?.data?.rawPending === true;

  if (!find(state.base)) state.base = String(checkpoints.at(-1)?.seq ?? "");
  if (state.target !== "now" && !find(state.target)) state.target = "now";
  const base = find(state.base);
  const target = state.target === "now" ? null : find(state.target);
  const right = target ? target.questions : now;
  const rightName = target ? quote(target.name) : "the questions now";

  // --- checkpoints ---
  const saveRow = h("div", { class: "chips lab-row" },
    h("input", { class: "input sm", "data-role": "cp-name", "aria-label": "Checkpoint name", placeholder: `Checkpoint ${state.seq + 1}`, value: state.draftName || "",
      oninput: (event) => { state.draftName = event.target.value; } }),
    h("button", { class: "btn sm", "data-act": "save", onclick: () => {
      const typed = str(state.draftName).trim();
      if (typed && checkpoints.some((checkpoint) => checkpoint.name === typed)) { api.toast(`A checkpoint is already named ${quote(typed)}.`, "error"); return; }
      const name = typed || uniqueCheckpointName(state, `Checkpoint ${state.seq + 1}`);
      const dropped = remember(state, name, nowOf(ctx));
      state.draftName = "";
      state.base = String(state.seq);
      api.toast(`Saved ${quote(name)} (${plural(nowOf(ctx).length, "question")}) in this page's memory.${dropped ? ` Dropped the oldest checkpoint, ${quote(dropped.name)}: Lab keeps ${MAX_CHECKPOINTS}.` : ""}`, "success");
      redraw();
    } }, "Save checkpoint"));
  const cpList = h("ul", { "data-role": "checkpoints" }, checkpoints.slice().reverse().map((checkpoint) => {
    const count = diff(checkpoint.questions, now, { ignoreSpace }).changes.length;
    return h("li", { "data-cp": String(checkpoint.seq) },
      h("input", { class: "input sm", "data-rename": String(checkpoint.seq), "aria-label": `Rename ${checkpoint.name}`, value: checkpoint.name,
        onchange: (event) => {
          const name = str(event.target.value).trim();
          if (!name) { api.toast("A checkpoint needs a name.", "error"); redraw(); return; }
          if (checkpoints.some((other) => other !== checkpoint && other.name === name)) { api.toast(`A checkpoint is already named ${quote(name)}.`, "error"); redraw(); return; }
          checkpoint.name = name; redraw();
        } }),
      h("span", { class: "faint", "data-role": "cp-facts" }, ` ${plural(checkpoint.questions.length, "question")} · ${count ? `${plural(count, "change")} from now` : "same as now"} `),
      h("button", { class: "btn sm ghost", "data-act": "compare", "data-cp": String(checkpoint.seq), onclick: () => { state.base = String(checkpoint.seq); state.target = "now"; redraw(); } }, "Compare with now"),
      h("button", { class: "btn sm ghost", "data-act": "restore-preview", "data-cp": String(checkpoint.seq), onclick: () => {
        state.restore = { seq: checkpoint.seq, token: tokenOf(nowOf(ctx)) }; redraw();
      } }, "Restore…"),
      h("button", { class: "btn sm ghost", "data-act": "download", "data-cp": String(checkpoint.seq), onclick: () => {
        if (ctx?.data?.rawPending === true) { api.toast(RAW_PENDING, "error"); return; }
        let map;
        try { map = questionsMap(checkpoint.questions); } catch (error) { api.toast(error.message, "error"); return; }
        api.download(`jev-checkpoint-${slugify(checkpoint.name) || "questions"}.json`, `${JSON.stringify(map, null, 2)}\n`, "application/json");
        api.toast(`Downloaded ${quote(checkpoint.name)} as a questions map (ids, types, instructions and criteria only).`, "success");
      } }, "Download"),
      h("button", { class: "btn sm ghost", "data-act": "delete", "data-cp": String(checkpoint.seq), onclick: () => {
        state.checkpoints = state.checkpoints.filter((other) => other !== checkpoint);
        if (state.restore?.seq === checkpoint.seq) state.restore = null;
        api.toast(`Deleted ${quote(checkpoint.name)}.`, "success");
        redraw();
      } }, "Delete"));
  }));

  // --- compare ---
  const options = (withNow) => [...(withNow ? [["now", "The questions now"]] : []), ...checkpoints.map((checkpoint) => [String(checkpoint.seq), checkpoint.name])];
  const picker = (role, value, list, onPick) => h("select", { "data-role": role, value, onchange: (event) => { onPick(event.target.value); redraw(); } },
    list.map(([key, text]) => h("option", { value: key, selected: key === value }, text)));
  let compareBox;
  if (!base) compareBox = h("p", { class: "faint", "data-role": "no-checkpoint" }, "Save a checkpoint to compare with.");
  else {
    const { changes } = diff(base.questions, right, { ignoreSpace });
    const visible = state.group ? changes.filter((change) => KIND_GROUP[change.kind] === state.group) : changes;
    const live = !target;
    const lookup = (change) => base.questions[change.from];
    const row = (change) => h("li", { "data-change": change.kind, "data-qid": change.qid },
      change.text,
      change.details.map((detail) => h("div", { class: "lab-diff-detail", "data-detail": detail.label },
        h("div", { class: "faint" }, `${detail.label} before`), h("pre", { "data-side": "before" }, detail.before),
        h("div", { class: "faint" }, `${detail.label} after`), h("pre", { "data-side": "after" }, detail.after))),
      live && change.kind !== "removed" && change.qid ? h("button", { class: "btn sm ghost", "data-act": "goto", "data-qid": change.qid,
        onclick: () => attempt(api, () => ctx.actions.focus(change.qid)) }, "Go to") : null,
      live && CONTENT_KINDS.has(change.kind) ? h("button", { class: "btn sm ghost", "data-act": "revert", "data-ref": change.ref, "data-kind": change.kind,
        onclick: () => {
          const list = nowOf(ctx);
          const at = list.findIndex((question) => question.ref === change.ref);
          const old = lookup(change);
          if (at < 0 || !old) { api.toast("That question changed again. Compare again first.", "error"); redraw(); return; }
          const next = list.map((question, index) => (index === at ? { ...old, ref: question.ref } : question));
          if (attempt(api, () => ctx.actions.replaceItems(next, { label: `Revert ${nameAt(list[at], at)} to ${base.name}` }))) {
            // The reverted wording would otherwise be lost: keep the questions as they were, as a restore does.
            const safety = uniqueCheckpointName(state, `Before reverting ${nameAt(list[at], at)}`);
            const dropped = remember(state, safety, list);
            api.toast(`Reverted ${quote(nameAt(old, change.from))} to ${quote(base.name)}. ${quote(safety)} holds the questions as they were.${dropped ? ` Dropped the oldest checkpoint, ${quote(dropped.name)}.` : ""}`, "success");
          }
          redraw();
        } }, "Revert this question") : null,
      live && change.kind === "removed" ? h("button", { class: "btn sm ghost", "data-act": "bring-back", "data-ref": change.ref, onclick: () => {
        const list = nowOf(ctx);
        const old = lookup(change);
        if (!old || diff(base.questions, list).changes.every((other) => !(other.kind === "removed" && other.from === change.from))) {
          api.toast("That question is back already. Compare again first.", "error"); redraw(); return;
        }
        const next = list.slice();
        next.splice(Math.min(change.from, next.length), 0, { ...old, ref: list.some((question) => question.ref === old.ref) ? "" : old.ref });
        if (attempt(api, () => ctx.actions.replaceItems(next, { label: `Bring back ${nameAt(old, change.from)}` }))) {
          api.toast(`Brought back ${quote(nameAt(old, change.from))} at position ${Math.min(change.from, list.length) + 1}.`, "success");
        }
        redraw();
      } }, "Bring back") : null);
    compareBox = h("div", { "data-role": "compare" },
      h("div", { class: "chips lab-row" },
        h("label", {}, "Compare ", picker("base", String(base.seq), options(false), (value) => { state.base = value; })),
        h("label", {}, " with ", picker("target", state.target, options(true), (value) => { state.target = value; })),
        h("label", {}, h("input", { type: "checkbox", "data-role": "ignore-space", checked: ignoreSpace,
          onchange: (event) => { state.ignoreSpace = event.target.checked === true; redraw(); } }), " Ignore whitespace-only changes"),
        h("label", {}, " Show ", picker("group", state.group || "", GROUPS, (value) => { state.group = value; }))),
      h("p", { "data-role": "heading", class: "faint" }, `From ${quote(base.name)} (${plural(base.questions.length, "question")}) to ${rightName} (${plural(right.length, "question")}).`),
      h("p", { "data-role": "summary" }, changes.length ? summaryOf(changes) : `No changes: ${rightName} match ${quote(base.name)}.`),
      changes.length && !visible.length ? h("p", { class: "faint", "data-role": "none-shown" }, "No change of this kind.") : null,
      h("ul", { "data-role": "changes" }, visible.map(row)),
      changes.length ? h("div", { class: "chips lab-row" }, h("button", { class: "btn sm ghost", "data-act": "copy-md", onclick: () => {
        if (ctx?.data?.rawPending === true) { api.toast(RAW_PENDING, "error"); return; }
        api.copy(diffMarkdown(`Question changes from ${quote(base.name)} to ${rightName}`, visible));
        api.toast(`Copied ${plural(visible.length, "change")} as Markdown (authored questions only).`, "success");
      } }, "Copy changes as Markdown")) : null);
  }

  // --- restore preview ---
  let restoreBox = null;
  const pending = state.restore && find(state.restore.seq);
  if (pending) {
    const { changes } = diff(now, pending.questions);
    const stale = state.restore.token !== tokenOf(now);
    restoreBox = h("div", { "data-role": "restore" },
      h("h4", {}, `Restore ${quote(pending.name)}`),
      stale ? h("p", { class: "lab-error", "data-role": "restore-stale" }, "The questions changed after this preview. Preview again.") : null,
      h("p", { "data-role": "restore-summary" }, changes.length ? `Restoring would make ${summaryOf(changes).replace(/\.$/, "")}. The questions now are saved as a checkpoint first.`
        : "Nothing to restore: the questions already match."),
      h("ul", {}, changes.map((change) => h("li", { "data-restore-change": change.kind }, change.text))),
      h("div", { class: "chips lab-row" },
        h("button", { class: "btn sm primary", "data-act": "apply-restore", disabled: !changes.length || stale || rawPending, onclick: () => {
          const current = nowOf(ctx);
          if (state.restore?.token !== tokenOf(current)) { api.toast("The questions changed after this preview. Preview again.", "error"); redraw(); return; }
          if (!diff(current, pending.questions).changes.length) { api.toast("Nothing to restore: the questions already match.", "error"); return; }
          if (attempt(api, () => ctx.actions.replaceItems(restoreList(current, pending.questions), { label: `Restore ${pending.name}` }))) {
            const safety = uniqueCheckpointName(state, `Before restoring ${pending.name}`);
            const dropped = remember(state, safety, current);
            state.restore = null;
            api.toast(`Restored ${quote(pending.name)}. ${quote(safety)} holds the questions as they were.${dropped ? ` Dropped the oldest checkpoint, ${quote(dropped.name)}.` : ""}`, "success");
          }
          redraw();
        } }, "Apply restore"),
        h("button", { class: "btn sm ghost", "data-act": "cancel-restore", onclick: () => { state.restore = null; redraw(); } }, "Cancel")));
  }

  return h("div", { class: "lab-diff" },
    h("p", { class: "faint" }, `Checkpoints live in this page's memory only (at most ${MAX_CHECKPOINTS}) and hold authored questions, never state, pictures or answers. Restoring goes through the editor's own edit path.`),
    h("h4", {}, `Checkpoints · ${checkpoints.length}`), saveRow, cpList, restoreBox,
    h("h4", {}, "Changes"), compareBox);
}

export default definePack({
  id: "build-diff",
  surface: "workbench.build.questions",
  title: "Question diff and checkpoints",
  about: "Named checkpoints of the Build questions kept in page memory, a diff of the questions against a checkpoint or between two (added, removed, renamed, moved, reworded, type and criteria changes), and restores through the editor's own edit path with a safety checkpoint first. Checkpoints and diffs hold authored questions only, never state, pictures, expectations or answers, and nothing is stored or sent.",
  features: [
    { id: "diff", kind: "panel", title: "Question diff and checkpoints", render, improvements: [
      { id: "baseline", title: "Keep the questions as they were when the panel opened as a first checkpoint" },
      { id: "save", title: "Save a named checkpoint of the questions in page memory" },
      { id: "list", title: "List checkpoints with their question counts and how far each is from now" },
      { id: "rename", title: "Rename a checkpoint, keeping names unique" },
      { id: "delete", title: "Delete a checkpoint" },
      { id: "cap", title: "Keep the newest 20 checkpoints and say which one was dropped" },
      { id: "compare_now", title: "Compare the questions now with any checkpoint" },
      { id: "compare_two", title: "Compare two checkpoints with each other" },
      { id: "summary", title: "Summarize a comparison by kind of change in one line" },
      { id: "added", title: "List questions added since a checkpoint, with their positions" },
      { id: "removed", title: "List questions removed since a checkpoint" },
      { id: "renamed", title: "Follow a renamed card and show its old and new id" },
      { id: "id_match", title: "Match questions by id when their cards were replaced (after Raw JSON)" },
      { id: "type", title: "Show questions whose type changed" },
      { id: "reworded", title: "Show reworded instructions before and after" },
      { id: "whitespace", title: "Tell whitespace-only instruction changes apart, or ignore them" },
      { id: "moved", title: "Show only the questions whose moves explain the new order" },
      { id: "keys", title: "Show Choice option keys added and removed" },
      { id: "descriptions", title: "Show changed Choice option descriptions before and after" },
      { id: "option_order", title: "Show Choice options that were reordered" },
      { id: "levels", title: "Show Score level text and count changes, warning that level numbers carry meaning" },
      { id: "noul", title: "Show changes to what a Noul yes or no means" },
      { id: "no_change", title: "Say plainly when nothing changed" },
      { id: "group_filter", title: "Show one kind of change: questions, types, instructions or criteria" },
      { id: "go_to", title: "Go to a changed question's card" },
      { id: "copy_md", title: "Copy the shown changes as Markdown (authored questions only)" },
      { id: "download", title: "Download a checkpoint as a questions map" },
      { id: "restore_preview", title: "Preview what restoring a checkpoint would change" },
      { id: "restore", title: "Restore a checkpoint through the editor's edit path, keeping cards and expectations" },
      { id: "restore_safety", title: "Save the current questions as a checkpoint before every restore, so a restore can be undone" },
      { id: "revert_one", title: "Revert one changed question to its checkpoint version, keeping a checkpoint of the questions first" },
      { id: "bring_back", title: "Bring back one removed question at its old position" },
    ] },
  ],
});
