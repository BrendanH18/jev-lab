// Identical inputs in a check's Review queue ("workbench.review.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): how often an input is queued, which kinds of row its copies are, whether
// copies carry different HUMAN labels, and which blind audit rows have a copy that already shows the gate's answers.
// Copies are matched by the row's identity (labels and test markers ignored, picture name kept), as dataset health and
// Review match them. Only human labels are compared: the gate's untouched suggestions on review rows are left out, and
// nothing here reads, hints at or sorts by the answers or shortlists of a blind audit row. No label is ever set.
import { csvText, definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? list(ctx.items()) : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? list(ctx.shown()) : []);
const blind = (item) => item?.kind === "audit" && item.revealed !== true;
const labelText = (value) => (value === true ? "yes" : value === false ? "no" : String(value));

// The labels a person set on a row: every label on an audit row, and on a review row the ones that are not the gate's
// untouched starting suggestion.
const humanLabels = (item) =>
  isObject(item?.labels)
    ? Object.entries(item.labels).filter(([qid, value]) => has(value) && !list(item.suggested).includes(qid))
    : [];

// Rows by identity, cached per items() array (the surface returns the same array while the queue is unchanged).
const groupCache = new WeakMap();
function groupsOf(ctx) {
  const all = itemsOf(ctx);
  let groups = groupCache.get(all);
  if (!groups) {
    groups = new Map();
    for (const item of all) {
      if (typeof item?.identity !== "string") continue;
      if (!groups.has(item.identity)) groups.set(item.identity, []);
      groups.get(item.identity).push(item);
    }
    groupCache.set(all, groups);
  }
  return groups;
}
const copiesOf = (item, ctx) => list(groupsOf(ctx).get(item?.identity)).filter((other) => other.line !== item.line);

// [{ question, line, mine, theirs }] for every question this row and one of its copies both labeled by hand, differently.
// A blind audit row takes no part on either side until it is revealed: even "differs" would tell its labeler the copy's
// label on a yes/no question, and a value shown on a revealed copy invites changing the audit row after the fact.
function conflictsOf(item, ctx) {
  if (blind(item)) return [];
  const mine = humanLabels(item);
  const out = [];
  for (const other of copiesOf(item, ctx)) {
    if (blind(other)) continue;
    const theirs = new Map(humanLabels(other));
    for (const [qid, value] of mine) {
      if (theirs.has(qid) && JSON.stringify(theirs.get(qid)) !== JSON.stringify(value))
        out.push({ question: qid, line: other.line, mine: value, theirs: theirs.get(qid) });
    }
  }
  return out;
}
// The copies of a blind audit row that show the gate's answers now (review rows always, audit rows once ready).
const exposingCopies = (item, ctx) =>
  blind(item) ? copiesOf(item, ctx).filter((other) => other.revealed === true) : [];

function kindsOf(group) {
  const review = group.some((item) => item.kind === "review"),
    audit = group.some((item) => item.kind === "audit");
  return review && audit ? "review and audit" : review ? "review" : "audit";
}
const repeated = (ctx) => [...groupsOf(ctx).values()].filter((group) => group.length > 1);
const conflictQuestions = (group, ctx) => [
  ...new Set(group.flatMap((item) => conflictsOf(item, ctx).map((entry) => entry.question))),
];
const workable = (ctx) => ctx?.data?.read === true && ctx.data.busy !== true;

function goFirst(ctx, test, none) {
  const item = shownOf(ctx).find((entry) => test(entry));
  if (!item) throw new Error(none);
  return ctx.actions.goTo(item.line);
}

export default definePack({
  id: "review-queue-copies",
  surface: "workbench.review.queue",
  title: "Review queue: identical inputs",
  about:
    "Facts, checks, counts, a CSV and navigation for inputs queued more than once in a check's Review queue: how many copies, which kinds of row they are, whether your own labels on them differ, and which blind audit rows have a copy that already shows the gate's answers. Only human labels are compared, nothing reveals a blind audit row, and the CSV holds line numbers and question ids only.",
  features: [
    {
      id: "input_copies",
      kind: "fact",
      type: "number",
      label: "rows with this input",
      unit: "rows",
      help: "Queue rows with the identical input, this one included (labels ignored, picture name kept).",
      value: (item, ctx) =>
        typeof item?.identity === "string" ? list(groupsOf(ctx).get(item.identity)).length || null : null,
    },
    {
      id: "copy_lines",
      kind: "fact",
      type: "text",
      label: "lines of identical inputs",
      help: "The other decisions-file lines queued with the same input.",
      value: (item, ctx) =>
        copiesOf(item, ctx)
          .map((other) => other.line)
          .join(", "),
    },
    {
      id: "copy_kinds",
      kind: "fact",
      type: "category",
      label: "kinds among identical inputs",
      help: "no copy, or whether the input's copies (this row included) are review rows, audit rows or both.",
      value: (item, ctx) => {
        if (typeof item?.identity !== "string") return null;
        const group = list(groupsOf(ctx).get(item.identity));
        return group.length > 1 ? kindsOf(group) : "no copy";
      },
    },
    {
      id: "copy_conflict",
      kind: "fact",
      type: "flag",
      label: "a copy with a different label of yours",
      help: "An identical input elsewhere in the queue carries a different human label for a question both rows labeled. The gate's untouched suggestions do not count, and blind audit rows are left out until they are revealed.",
      value: (item, ctx) => conflictsOf(item, ctx).length > 0,
    },
    {
      id: "blind_exposed",
      kind: "fact",
      type: "flag",
      label: "a blind audit row with a revealed copy",
      help: "A blind audit row whose identical input is shown with the gate's answers on another row. Says nothing about those answers.",
      value: (item, ctx) => exposingCopies(item, ctx).length > 0,
    },

    {
      id: "copy_conflict_check",
      kind: "diagnostic",
      severity: "problem",
      label: "Identical inputs with different labels of yours",
      help: "Two rows with the same input should get the same human label. Only labels you set are compared; a blind audit row is compared only once it is revealed, so it stays independent.",
      check: (item, ctx) =>
        conflictsOf(item, ctx).map(
          (entry) =>
            `Line ${item.line} has ${entry.question} = ${labelText(entry.mine)}, but line ${entry.line} has the same input with ${entry.question} = ${labelText(entry.theirs)}.`,
        ),
    },
    {
      id: "blind_copy_exposed",
      kind: "diagnostic",
      severity: "advice",
      label: "Blind audit row with a revealed copy",
      help: "The audit stays independent only if you label the audit row before reading the gate's answers on its copy.",
      check: (item, ctx) => {
        const lines = exposingCopies(item, ctx).map((other) => other.line);
        return lines.length
          ? `Line ${item.line} is a blind audit row, but line${lines.length === 1 ? "" : "s"} ${lines.join(", ")} show${lines.length === 1 ? "s" : ""} the gate's answers for the identical input. Label line ${item.line} first, without looking there.`
          : null;
      },
    },
    {
      id: "copy_label_gap",
      kind: "diagnostic",
      severity: "info",
      label: "Labeled here but blank on a copy",
      help: "Names the copy and the question only, never the label, so a blind copy stays independent.",
      check: (item, ctx) => {
        const out = [];
        for (const [qid] of humanLabels(item)) {
          for (const other of copiesOf(item, ctx)) {
            if (isObject(other.labels) && !has(other.labels[qid]))
              out.push(`Line ${other.line} has the same input with no label for ${qid} yet.`);
          }
        }
        return out;
      },
    },

    {
      id: "copy_groups",
      kind: "metric",
      format: "integer",
      label: "Inputs queued more than once",
      compute: (ctx) => {
        if (!itemsOf(ctx).length) return null;
        const groups = repeated(ctx);
        return {
          value: groups.length,
          detail: `${plural(
            groups.reduce((sum, group) => sum + group.length, 0),
            "row",
          )} in them`,
        };
      },
    },
    {
      id: "conflicting_groups",
      kind: "metric",
      format: "integer",
      label: "Repeated inputs with different labels of yours",
      help: "Inputs queued more than once whose copies carry different human labels for some question.",
      compute: (ctx) => {
        if (!itemsOf(ctx).length) return null;
        const groups = repeated(ctx);
        const conflicting = groups.filter((group) => conflictQuestions(group, ctx).length > 0).length;
        return { value: conflicting, detail: `of ${plural(groups.length, "repeated input")}` };
      },
    },
    {
      id: "exposed_rows",
      kind: "metric",
      format: "integer",
      label: "Blind audit rows with a revealed copy",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        if (!all.length) return null;
        const blindRows = all.filter(blind);
        return {
          value: blindRows.filter((item) => exposingCopies(item, ctx).length > 0).length,
          detail: `of ${plural(blindRows.length, "blind audit row")}`,
        };
      },
    },

    {
      id: "copy_groups_csv",
      kind: "exporter",
      label: "Repeated inputs as CSV (line numbers and question ids only)",
      filename: "jev-review-copies.csv",
      mime: "text/csv",
      help: "One line per input queued more than once, in queue order: its lines, the kinds of row, blind audit rows among them and the questions whose human labels differ. No inputs, labels or answers.",
      build: (ctx) =>
        csvText([
          ["group", "rows", "lines", "kinds", "blind_audit_rows", "differing_questions"],
          ...repeated(ctx).map((group, index) => [
            index + 1,
            group.length,
            group.map((item) => item.line).join(" "),
            kindsOf(group),
            group.filter(blind).length,
            conflictQuestions(group, ctx).join(" "),
          ]),
        ]),
    },

    {
      id: "go_first_conflict",
      kind: "command",
      title: "Go to the first shown row whose copy has a different label of yours",
      group: "Review queue",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => conflictsOf(item, ctx).length > 0),
      run: (ctx) =>
        goFirst(
          ctx,
          (item) => conflictsOf(item, ctx).length > 0,
          "No shown row has a copy with a different label of yours.",
        ),
    },
    {
      id: "go_next_copy",
      kind: "command",
      title: "Go to the next shown copy of the current row's input",
      group: "Review queue",
      help: "In queue order after the current row, starting over at the top.",
      when: (ctx) => {
        if (!workable(ctx)) return false;
        const current = itemsOf(ctx).find((item) => item.current);
        return !!current && copiesOf(current, ctx).some((other) => shownOf(ctx).includes(other));
      },
      run: (ctx) => {
        const current = itemsOf(ctx).find((item) => item.current);
        if (!current) throw new Error("No row is current. Use Next incomplete row first.");
        const shown = shownOf(ctx);
        const copies = copiesOf(current, ctx).filter((other) => shown.includes(other));
        const next = copies.find((other) => other.position > current.position) || copies[0];
        if (!next) throw new Error(`No shown row repeats the input of line ${current.line}.`);
        return ctx.actions.goTo(next.line);
      },
    },
    {
      id: "go_first_exposed",
      kind: "command",
      title: "Go to the first shown blind audit row with a revealed copy",
      group: "Review queue",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => exposingCopies(item, ctx).length > 0),
      run: (ctx) =>
        goFirst(ctx, (item) => exposingCopies(item, ctx).length > 0, "No shown blind audit row has a revealed copy."),
    },
  ],
});
