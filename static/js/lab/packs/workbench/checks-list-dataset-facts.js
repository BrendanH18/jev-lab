// Dataset and page-state facts for the saved checks in the Datasets panel ("workbench.checks.list"; contract in
// static/js/lab/surfaces/workbench-checks.js): the size and labeling of each check's dataset (tuning and held-out rows,
// labeled share, rows past the 200-row cap, questions the gate does not read), its place in the catalog, its Review
// queue's counts and which of its panels are open. Counts and catalog metadata only: "labeled" means a row carries any
// human label, not that the labels are valid, and nothing here is a row input, a label value, an answer or a result.
import { definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const share = (part, whole) => (count(part) === null || !count(whole) ? null : part / whole);
const queueCount = (item, key) => (isObject(item?.queue) ? count(item.queue[key]) : null);
const PANELS = [
  ["drift", "Compare new rows"],
  ["upgrade", "Try a new version"],
  ["queue", "Review queue"],
];
const CAP = 200;

export default definePack({
  id: "checks-list-dataset-facts",
  surface: "workbench.checks.list",
  title: "Saved check dataset facts",
  about:
    "Facts about each saved check's dataset and page state: tuning and held-out rows and shares, labeled share and unlabeled rows, calls per run and rows past the 200-row cap, questions and ungated questions, catalog position, Review queue counts, whether it is loaded, held out, capped, fully labeled or busy, which panels are open, and size and labeling bands. Counts only; never inputs, label values or answers.",
  features: [
    {
      id: "tuning_rows",
      kind: "fact",
      type: "number",
      label: "tuning rows",
      unit: "rows",
      help: "Rows minus held-out test rows: the rows a run may send.",
      value: (item) => count(item?.tuning_rows),
    },
    {
      id: "held_out_rows",
      kind: "fact",
      type: "number",
      label: "held-out test rows",
      unit: "rows",
      value: (item) => count(item?.held_out_rows),
    },
    {
      id: "held_out_share",
      kind: "fact",
      type: "number",
      label: "held-out share of rows",
      unit: "0 to 1",
      value: (item) => share(item?.held_out_rows, item?.rows),
    },
    {
      id: "labeled_share",
      kind: "fact",
      type: "number",
      label: "share of rows with a label",
      unit: "0 to 1",
      help: "Rows with any human label (catalog metadata), over all saved rows. It does not say the labels are valid.",
      value: (item) => share(item?.labeled, item?.rows),
    },
    {
      id: "unlabeled_rows",
      kind: "fact",
      type: "number",
      label: "rows without a label",
      unit: "rows",
      value: (item) =>
        count(item?.rows) === null || count(item?.labeled) === null ? null : Math.max(0, item.rows - item.labeled),
    },
    {
      id: "calls_per_run",
      kind: "fact",
      type: "number",
      label: "calls per run",
      unit: "calls",
      help: "Tuning rows, at most 200.",
      value: (item) => count(item?.calls),
    },
    {
      id: "rows_past_cap",
      kind: "fact",
      type: "number",
      label: "tuning rows a run leaves out",
      unit: "rows",
      help: "Tuning rows past the 200 a run sends.",
      value: (item) => (count(item?.tuning_rows) === null ? null : Math.max(0, item.tuning_rows - CAP)),
    },
    {
      id: "question_count",
      kind: "fact",
      type: "number",
      label: "questions saved",
      unit: "questions",
      value: (item) => count(item?.question_count),
    },
    {
      id: "ungated_questions",
      kind: "fact",
      type: "number",
      label: "questions the gate does not read",
      unit: "questions",
      help: "Saved questions minus gated ones. Zero when the gate names as many questions as the dataset saves, or more.",
      value: (item) =>
        count(item?.question_count) === null || !Array.isArray(item?.gated)
          ? null
          : Math.max(0, item.question_count - item.gated.length),
    },
    {
      id: "catalog_position",
      kind: "fact",
      type: "number",
      label: "position in the catalog",
      unit: "position",
      help: "Among the checks, in the Datasets catalog's order.",
      value: (item) => count(item?.position),
    },
    {
      id: "review_rows",
      kind: "fact",
      type: "number",
      label: "rows in its Review queue",
      unit: "rows",
      value: (item) => queueCount(item, "rows"),
    },
    {
      id: "review_ready",
      kind: "fact",
      type: "number",
      label: "ready rows in its Review queue",
      unit: "rows",
      value: (item) => queueCount(item, "ready"),
    },
    {
      id: "review_audit",
      kind: "fact",
      type: "number",
      label: "audit rows in its Review queue",
      unit: "rows",
      value: (item) => queueCount(item, "audit"),
    },
    {
      id: "review_edits",
      kind: "fact",
      type: "number",
      label: "Review labels you edited, not added",
      unit: "labels",
      value: (item) => queueCount(item, "edited_labels"),
    },

    {
      id: "loaded",
      kind: "fact",
      type: "flag",
      label: "its dataset loaded in Bulk",
      value: (item) => item?.loaded === true,
    },
    {
      id: "has_held_out",
      kind: "fact",
      type: "flag",
      label: "held-out test rows",
      value: (item) => (count(item?.held_out_rows) || 0) > 0,
    },
    {
      id: "capped",
      kind: "fact",
      type: "flag",
      label: "more tuning rows than one run sends",
      value: (item) => (count(item?.tuning_rows) || 0) > CAP,
    },
    {
      id: "every_row_labeled",
      kind: "fact",
      type: "flag",
      label: "a label on every row",
      value: (item) => count(item?.rows) > 0 && item.labeled === item.rows,
    },
    {
      id: "busy",
      kind: "fact",
      type: "flag",
      label: "an operation running",
      help: "A check run, drift comparison, traffic operation or upgrade.",
      value: (item) => item?.busy === true,
    },
    {
      id: "review_open",
      kind: "fact",
      type: "flag",
      label: "its Review queue open",
      value: (item) => item?.queue?.open === true,
    },

    {
      id: "size_band",
      kind: "fact",
      type: "category",
      label: "tuning size band",
      value: (item) => {
        const rows = count(item?.tuning_rows);
        return rows === null
          ? null
          : rows < 30
            ? "under 30"
            : rows < 100
              ? "30 to 99"
              : rows <= CAP
                ? "100 to 200"
                : "over 200";
      },
    },
    {
      id: "labeling_band",
      kind: "fact",
      type: "category",
      label: "labeling band",
      value: (item) => {
        const part = share(item?.labeled, item?.rows);
        return part === null
          ? null
          : part === 0
            ? "none labeled"
            : part < 0.5
              ? "under half labeled"
              : part < 1
                ? "half or more labeled"
                : "all labeled";
      },
    },
    {
      id: "open_panels",
      kind: "fact",
      type: "category",
      label: "open panels",
      value: (item) => {
        if (!item || typeof item !== "object") return null;
        const open = PANELS.filter(([key]) => item[key]?.open === true).map(([, title]) => title);
        return open.length ? open.join(" + ") : "none open";
      },
    },

    {
      id: "dataset_id",
      kind: "fact",
      type: "text",
      label: "dataset id",
      value: (item) => (typeof item?.id === "string" ? item.id : ""),
    },
  ],
});
