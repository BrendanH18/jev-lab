// Configuration facts for the saved checks in the Datasets panel ("workbench.checks.list"; contract in
// static/js/lab/surfaces/workbench-checks.js): what each check saves beyond the starter facts (threshold spread and
// mean, the error rate its accuracy target allows, rules, required slices and shortlists and their targets, its model
// and tuned-on version, notes) so checks can be filtered and sorted by how they are set up. Configuration only: no
// measured result, row input, label or model answer.
import { definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const thresholds = (item) =>
  Object.values(isObject(item?.gates) ? item.gates : {})
    .map(finite)
    .filter((value) => value !== null);
const slices = (item) => list(item?.slice_targets).filter(isObject);
const shortlists = (item) => (isObject(item?.answer_sets) ? item.answer_sets : {});
const lowest = (values) => {
  const known = values.map(finite).filter((value) => value !== null);
  return known.length ? Math.min(...known) : null;
};
const fixed2 = (value) => (finite(value) === null ? "?" : value.toFixed(2));
// Rounded to 12 places so 1 - 0.95 reads as 0.05, not 0.050000000000000044.
const tidy = (value) => Math.round(value * 1e12) / 1e12;

export default definePack({
  id: "checks-list-config-facts",
  surface: "workbench.checks.list",
  title: "Saved check configuration facts",
  about:
    "Configuration facts for the saved checks: threshold spread and mean, the error rate the accuracy target allows, counts of rules, required slices and shortlists with their lowest targets, whether the check asks the version it was tuned on, the model box, a perfect-accuracy target, model, tuned-on version, threshold and accuracy bands, what it carries besides gates, and its gates, slices, shortlists, notes and name as text. Configuration only.",
  features: [
    {
      id: "threshold_spread",
      kind: "fact",
      type: "number",
      label: "gate threshold spread",
      unit: "0 to 1",
      help: "Highest minus lowest gate threshold; 0 with one gate.",
      value: (item) => {
        const values = thresholds(item);
        return values.length ? tidy(Math.max(...values) - Math.min(...values)) : null;
      },
    },
    {
      id: "mean_threshold",
      kind: "fact",
      type: "number",
      label: "mean gate threshold",
      unit: "0 to 1",
      value: (item) => {
        const values = thresholds(item);
        return values.length ? tidy(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
      },
    },
    {
      id: "error_allowance",
      kind: "fact",
      type: "number",
      label: "error rate the accuracy target allows",
      unit: "0 to 1",
      help: "1 minus the accuracy target: the share of automated answers that may be wrong.",
      value: (item) => (finite(item?.min_accuracy) === null ? null : tidy(1 - item.min_accuracy)),
    },
    {
      id: "rule_count",
      kind: "fact",
      type: "number",
      label: "consistency rules",
      unit: "rules",
      value: (item) => (Number.isInteger(item?.rules) ? item.rules : null),
    },
    {
      id: "slice_target_count",
      kind: "fact",
      type: "number",
      label: "required slices",
      unit: "slices",
      value: (item) => (Array.isArray(item?.slice_targets) ? slices(item).length : null),
    },
    {
      id: "shortlist_count",
      kind: "fact",
      type: "number",
      label: "attached shortlists",
      unit: "questions",
      value: (item) => (isObject(item?.answer_sets) ? Object.keys(item.answer_sets).length : null),
    },
    {
      id: "slice_accuracy_floor",
      kind: "fact",
      type: "number",
      label: "lowest required-slice accuracy target",
      unit: "0 to 1",
      value: (item) => lowest(slices(item).map((slice) => slice.min_accuracy)),
    },
    {
      id: "slice_automation_floor",
      kind: "fact",
      type: "number",
      label: "lowest required-slice automation target",
      unit: "0 to 1",
      value: (item) => lowest(slices(item).map((slice) => slice.min_coverage)),
    },
    {
      id: "shortlist_coverage_floor",
      kind: "fact",
      type: "number",
      label: "lowest shortlist coverage",
      unit: "0 to 1",
      help: "The smallest share of rows a shortlist is cut to hold the right answer for.",
      value: (item) => lowest(Object.values(shortlists(item))),
    },

    {
      id: "asks_tuned_version",
      kind: "fact",
      type: "flag",
      label: "asks the version it was tuned on",
      value: (item) => !!item?.tuned_on && item.model === item.tuned_on,
    },
    {
      id: "model_box_set",
      kind: "fact",
      type: "flag",
      label: "a model typed in its model box",
      help: "The next run asks that model instead of the saved one.",
      value: (item) => typeof item?.model_override === "string" && item.model_override !== "",
    },
    {
      id: "perfect_accuracy",
      kind: "fact",
      type: "flag",
      label: "an accuracy target of 100%",
      value: (item) => finite(item?.min_accuracy) === 1,
    },

    {
      id: "model",
      kind: "fact",
      type: "category",
      label: "model asked",
      value: (item) => (typeof item?.model === "string" && item.model ? item.model : null),
    },
    {
      id: "tuned_on",
      kind: "fact",
      type: "category",
      label: "tuned-on version",
      value: (item) =>
        !item || typeof item !== "object"
          ? null
          : typeof item.tuned_on === "string" && item.tuned_on
            ? item.tuned_on
            : "not saved",
    },
    {
      id: "threshold_band",
      kind: "fact",
      type: "category",
      label: "lowest threshold band",
      value: (item) => {
        const low = lowest(thresholds(item));
        return low === null
          ? null
          : low < 0.5
            ? "under 0.5"
            : low < 0.7
              ? "0.5 to 0.7"
              : low < 0.9
                ? "0.7 to 0.9"
                : "0.9 or more";
      },
    },
    {
      id: "accuracy_band",
      kind: "fact",
      type: "category",
      label: "accuracy target band",
      value: (item) => {
        const target = finite(item?.min_accuracy);
        return target === null
          ? null
          : target >= 1
            ? "100%"
            : target >= 0.95
              ? "95% to 99.9%"
              : target >= 0.9
                ? "90% to 94.9%"
                : "under 90%";
      },
    },
    {
      id: "extras",
      kind: "fact",
      type: "category",
      label: "saved besides gates",
      value: (item) => {
        if (!item || typeof item !== "object") return null;
        const parts = [
          (item.rules || 0) > 0 && "rules",
          slices(item).length > 0 && "slices",
          Object.keys(shortlists(item)).length > 0 && "shortlists",
        ].filter(Boolean);
        return parts.length ? parts.join(" + ") : "gates only";
      },
    },

    {
      id: "gate_list",
      kind: "fact",
      type: "text",
      label: "gates",
      value: (item) =>
        Object.entries(isObject(item?.gates) ? item.gates : {})
          .map(([qid, threshold]) => `${qid} ≥ ${fixed2(threshold)}`)
          .join(", "),
    },
    {
      id: "slice_list",
      kind: "fact",
      type: "text",
      label: "required slices",
      help: "field = value for each required slice.",
      value: (item) =>
        slices(item)
          .map((slice) => `${slice.field} = ${slice.value}`)
          .join(", "),
    },
    {
      id: "shortlist_list",
      kind: "fact",
      type: "text",
      label: "shortlisted questions",
      value: (item) =>
        Object.entries(shortlists(item))
          .map(([qid, coverage]) => `${qid} ${fixed2(coverage)}`)
          .join(", "),
    },
    {
      id: "notes",
      kind: "fact",
      type: "text",
      label: "the page's notes",
      value: (item) =>
        list(item?.notes)
          .filter((note) => typeof note === "string")
          .join(" "),
    },
    {
      id: "name",
      kind: "fact",
      type: "text",
      label: "dataset name",
      value: (item) => (typeof item?.name === "string" ? item.name : ""),
    },
  ],
});
