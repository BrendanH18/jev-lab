// Bulk and Review share the label picker and rescore the same results when a label changes.
import { h } from "./common.js";
import { W } from "./workbench-state.js";
import { answerClasses, labelText, labelValue, recalibrate } from "./workbench-calibrate.js";
import { repolicy } from "./workbench-policy.js";
import { render } from "./workbench.js";

// A label picker for one row and question. Changing it rescores everything that reads labels.
export function labelSelect(r, qid) {
  const b = W.bulk;
  const answer = r.answers?.[qid];
  if (!answer) return null;
  if (answer.type === "box") {
    // a Box label is four edges, written in the row's "_expect"
    const label = b.labels[r.index]?.[qid];
    return label && typeof label === "object"
      ? h(
          "span",
          { class: "mono faint", style: { fontSize: "11.5px" } },
          ["left", "top", "right", "bottom"].map((k) => Number(label[k]).toFixed(2)).join(" "),
        )
      : null;
  }
  const current = labelText(b.labels[r.index]?.[qid], answer.type);
  const classes = answerClasses(answer);
  const extra =
    current && !classes.includes(current)
      ? [h("option", { value: current, selected: true }, `${current} (invalid)`)]
      : [];
  const sel = h(
    "select",
    { class: "input label-sel", "aria-label": `Label for row ${r.index + 1}` },
    h("option", { value: "", selected: !current }, "—"),
    classes.map((c) =>
      h(
        "option",
        { value: c, selected: c === current },
        answer.type === "score" ? `${c} · ${String(answer.legend?.[c] ?? "").slice(0, 32)}` : c,
      ),
    ),
    extra,
  );
  sel.addEventListener("change", async () => {
    const value = labelValue(sel.value, answer.type);
    const labels = { ...(b.labels[r.index] || {}) };
    if (value === null) delete labels[qid];
    else labels[qid] = value;
    b.labels[r.index] = labels;
    b.review.kept.delete(`${r.index}:${qid}`); // a changed label is checked afresh
    b.labelsDirty = true;
    await Promise.all([recalibrate(), repolicy()]);
    render();
  });
  return sel;
}
