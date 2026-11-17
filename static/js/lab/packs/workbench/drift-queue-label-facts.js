// Labeling-progress facts for drift's "Label new traffic" queue ("workbench.drift.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): how far each queued new row is from being added, which questions you
// labeled and which still need you, and where it stands for the next Add. Every label here is one you chose; there are
// no model answers on this queue and nothing here measures accuracy (it is a targeted sample, not a random audit).
import { definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const questionsOf = (ctx) =>
  list(ctx?.data?.questions).filter((question) => isObject(question) && typeof question.id === "string");
const itemsOf = (ctx) => {
  try {
    return list(ctx?.items?.());
  } catch {
    return [];
  }
};
const labeledOf = (item, qid) => isObject(item?.labels) && has(item.labels[qid]);

// A label as the queue's select shows it: the option text ("yes", "1", "billing").
function labelText(question, value) {
  const option = list(question?.options).find((entry) => entry?.value === value);
  return option ? String(option.text) : typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

export default definePack({
  id: "drift-queue-label-facts",
  surface: "workbench.drift.queue",
  title: "New traffic labeling progress",
  about:
    "Facts about your progress on each queued new row in drift's Label new traffic queue: the share of questions labeled, optional and required questions done or blank, ready rows ahead of it, a progress stage, its place in the next Add, and which questions you labeled or still need to. Your own labels only; no answers and no accuracy.",
  features: [
    {
      id: "labeled_share",
      kind: "fact",
      type: "number",
      label: "share of queue questions labeled",
      unit: "0 to 1",
      value: (item, ctx) => {
        const total = questionsOf(ctx).length;
        return total && Array.isArray(item?.labeled) ? item.labeled.length / total : null;
      },
    },
    {
      id: "required_labeled",
      kind: "fact",
      type: "number",
      label: "required labels chosen",
      unit: "labels",
      help: "Gated questions with a label; Add needs all of them.",
      value: (item, ctx) =>
        isObject(item?.labels)
          ? questionsOf(ctx).filter((question) => question.gated && labeledOf(item, question.id)).length
          : null,
    },
    {
      id: "optional_blank",
      kind: "fact",
      type: "number",
      label: "optional questions left blank",
      unit: "questions",
      help: "Questions the gate does not read and that have no label. Add saves the row without them.",
      value: (item, ctx) =>
        isObject(item?.labels)
          ? questionsOf(ctx).filter((question) => !question.gated && !labeledOf(item, question.id)).length
          : null,
    },
    {
      id: "ready_ahead",
      kind: "fact",
      type: "number",
      label: "ready rows ahead in the queue",
      unit: "rows",
      help: "Ready rows earlier in queue order. Add takes ready rows in that order until the dataset's room runs out.",
      value: (item, ctx) =>
        Number.isInteger(item?.position)
          ? itemsOf(ctx).filter((other) => other?.ready === true && other.position < item.position).length
          : null,
    },

    {
      id: "fully_labeled",
      kind: "fact",
      type: "flag",
      label: "every queue question labeled",
      value: (item, ctx) => {
        const questions = questionsOf(ctx);
        return questions.length > 0 && questions.every((question) => labeledOf(item, question.id));
      },
    },
    {
      id: "untouched",
      kind: "fact",
      type: "flag",
      label: "no label yet",
      value: (item) => Array.isArray(item?.labeled) && item.labeled.length === 0,
    },
    {
      id: "ready_waiting",
      kind: "fact",
      type: "flag",
      label: "ready but waiting for room",
      help: "Every required label is set, but the next Add has no room left for it.",
      value: (item) => item?.ready === true && item.will_add !== true,
    },

    {
      id: "progress",
      kind: "fact",
      type: "category",
      label: "labeling stage",
      help: "No labels; started (a required label still missing); required done (optional ones blank); all labeled.",
      value: (item, ctx) => {
        if (!Array.isArray(item?.labeled)) return null;
        if (!item.labeled.length) return "no labels";
        if (item.ready !== true) return "started";
        const questions = questionsOf(ctx);
        return questions.length && questions.every((question) => labeledOf(item, question.id))
          ? "all labeled"
          : "required done";
      },
    },
    {
      id: "add_place",
      kind: "fact",
      type: "category",
      label: "next Add",
      value: (item) =>
        typeof item?.ready !== "boolean"
          ? null
          : !item.ready
            ? "needs labels"
            : item.will_add === true
              ? "in the next Add"
              : "waits for room",
    },

    {
      id: "labeled_questions",
      kind: "fact",
      type: "text",
      label: "questions you labeled",
      value: (item) => list(item?.labeled).join(", "),
    },
    {
      id: "missing_questions",
      kind: "fact",
      type: "text",
      label: "required questions still missing",
      value: (item) => list(item?.missing).join(", "),
    },
    {
      id: "your_labels",
      kind: "fact",
      type: "text",
      label: "your labels",
      help: "question: label for every question you labeled, in the queue's question order, as the selects show them. Filter with, for example, urgent: yes.",
      value: (item, ctx) =>
        questionsOf(ctx)
          .filter((question) => labeledOf(item, question.id))
          .map((question) => `${question.id}: ${labelText(question, item.labels[question.id])}`)
          .join("; "),
    },
  ],
});
