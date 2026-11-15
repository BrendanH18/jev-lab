// Row facts for the blind second-labeling sample ("workbench.datasets.agreement"; contract in
// static/js/lab/surfaces/workbench-datasets.js), from your latest Compare: how many compared questions agree on the row
// and its agreement share, how its differences were settled (taking the second label, keeping the saved one, leaving
// it unlabeled), its settlement state and the types of question that differ. Every fact is unknown before Compare (and
// after any edit, which drops the comparison), so nothing hints at a saved label while the sample is blind. Facts carry
// counts, flags, question types and states only, never inputs or label values.
import { definePack } from "../../kit.js";

const list = (value) => (Array.isArray(value) ? value : []);
const diffsOf = (item) => (Array.isArray(item?.differences) ? item.differences : null);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const settled = (item) => list(diffsOf(item)).filter((d) => d.settle?.set === true);
// Agreeing questions are known only when the comparison lists every difference (it is not truncated).
const complete = (ctx) => ctx?.data?.report && ctx.data.report.truncated !== true;
const compared = (item, ctx) => diffsOf(item) !== null && complete(ctx) && Number.isInteger(item?.given) && item.given > 0;
const settledWith = (test) => (item) => settled(item).some((d) => test(d));
const typeOrder = ["choice", "noul", "score", "box"];

export default definePack({
  id: "agreement-sample-rows",
  surface: "workbench.datasets.agreement",
  title: "Label agreement: row comparison facts",
  about: "Per-row facts from your latest Compare: compared questions that agree and the row's agreement share, settlements that change the saved label, which way each difference was settled, the row's settlement state and the types of question that differ. Unknown before Compare; counts, flags, types and states only, never inputs or label values.",
  features: [
    { id: "agreed_questions", kind: "fact", type: "number", label: "compared questions that agree", unit: "questions",
      help: "Second labels on this row that match the saved one, from your latest Compare; unknown before it, for rows without second labels, and when only part of the differences is shown.",
      value: (item, ctx) => (compared(item, ctx) ? item.given - diffsOf(item).length : null) },
    { id: "row_agreement", kind: "fact", type: "number", label: "row agreement share", unit: "0 to 1",
      help: "Compared questions that agree over the second labels given on the row. Two people's labels, never the model's accuracy.",
      value: (item, ctx) => (compared(item, ctx) ? (item.given - diffsOf(item).length) / item.given : null) },
    { id: "given_share", kind: "fact", type: "number", label: "share of asked questions labeled", unit: "0 to 1",
      help: "Second labels given over the questions the row asks. Progress only; known before Compare.",
      value: (item) => (list(item?.questions).length ? (Number.isInteger(item.given) ? item.given : 0) / item.questions.length : null) },
    { id: "settled_count", kind: "fact", type: "number", label: "differences settled", unit: "labels",
      value: (item) => (diffsOf(item) ? settled(item).length : null) },
    { id: "settle_changes", kind: "fact", type: "number", label: "settlements that change the saved label", unit: "labels",
      help: "What Save settled labels would write for this row: settlement choices other than the saved label.",
      value: (item) => (diffsOf(item) ? settled(item).filter((d) => !same(d.settle.value, d.saved)).length : null) },
    { id: "kappa_floor", kind: "fact", type: "number", label: "lowest kappa among the questions asked", unit: "kappa",
      help: "The lowest Cohen's kappa, over the questions this row asks, in your latest Compare; unknown before it and when no asked question has a kappa.",
      value: (item, ctx) => {
        const kappas = list(item?.questions).map((qid) => list(ctx?.data?.report?.questions).find((q) => q.id === qid)?.kappa).filter((k) => typeof k === "number");
        return ctx?.data?.report && kappas.length ? Math.min(...kappas) : null;
      } },
    { id: "took_second", kind: "fact", type: "flag", label: "a difference settled as the second label", value: settledWith((d) => !same(d.settle.value, null) && same(d.settle.value, d.second)) },
    { id: "kept_saved", kind: "fact", type: "flag", label: "a difference settled as the saved label", value: settledWith((d) => same(d.settle.value, d.saved)) },
    { id: "left_unlabeled", kind: "fact", type: "flag", label: "a difference settled as unlabeled", help: "Settling as no label removes the saved label when you save.",
      value: settledWith((d) => same(d.settle.value, null)) },
    { id: "settle_state", kind: "fact", type: "category", label: "settlement state",
      help: "not compared, no difference, unsettled, partly settled or settled, from your latest Compare; unknown before it.",
      value: (item, ctx) => {
        const diffs = diffsOf(item);
        if (!diffs) return null;
        if (!(item.given > 0)) return "not compared";
        if (!diffs.length) return complete(ctx) ? "no difference" : null;
        const done = settled(item).length;
        return done === 0 ? "unsettled" : done < diffs.length ? "partly settled" : "settled";
      } },
    { id: "weakest_question", kind: "fact", type: "category", label: "asked question with the lowest agreement",
      help: "Among the questions this row asks, the one whose agreement rate was lowest in your latest Compare (the earlier one on a tie); unknown before it.",
      value: (item, ctx) => {
        let best = null;
        for (const qid of list(item?.questions)) {
          const q = list(ctx?.data?.report?.questions).find((entry) => entry.id === qid);
          if (typeof q?.agreement === "number" && (!best || q.agreement < best.agreement)) best = q;
        }
        return best ? best.id : null;
      } },
    { id: "differing_types", kind: "fact", type: "category", label: "types of question that differ",
      help: "The question types of this row's differences (choice, noul, score), or none; unknown before Compare.",
      value: (item, ctx) => {
        const diffs = diffsOf(item);
        if (!diffs) return null;
        if (!diffs.length) return item.given > 0 && complete(ctx) ? "none" : null;
        const types = new Map(list(ctx?.data?.questions).map((q) => [q.id, q.type]));
        const found = new Set(diffs.map((d) => types.get(d.question) || "unknown"));
        return [...typeOrder.filter((type) => found.has(type)), ...[...found].filter((type) => !typeOrder.includes(type))].join(" + ");
      } },
  ],
});
