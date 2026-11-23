import { $, api, debounce, h, handleError, mount, pct } from "./common.js";
import { W } from "./workbench-state.js";
import { withCI, refreshSets } from "./workbench-calibrate.js";

// Accuracy for each value of one row field (jev/slices.py), so a part of the data where answers are worse stands out.
// Calibrate slices its scored rows at the slider's threshold; Policy slices its scored rows at the current gates.
// No model calls. The section keeps its last table while a newer one is on its way.
const sliceSeq = { cal: 0, pol: 0 };
function sliceRows(kind) {
  const b = W.bulk;
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r.row]));
  if (kind === "cal") {
    const rep = b.cal.report;
    if (!rep?.labeled) return null;
    return rep.rows.map((r) => ({
      row: rowsBy.get(r.index),
      correct: r.correct,
      automated: r.signal + 1e-9 >= b.cal.threshold,
    }));
  }
  const rep = b.policy.report;
  if (!rep?.labeled) return null;
  return rep.rows.map((r) => ({ row: rowsBy.get(r.index), correct: r.correct, automated: r.automated }));
}
export async function reslice(kind) {
  const b = W.bulk;
  const seq = ++sliceSeq[kind];
  const rows = sliceRows(kind);
  let report = null;
  if (rows) {
    try {
      report = await api("/api/workbench/slices", { rows, field: b.slice.field });
    } catch (e) {
      if (seq === sliceSeq[kind]) handleError(e);
    }
  }
  if (seq !== sliceSeq[kind]) return;
  b.slice[kind] = report;
  const el = $(`#${kind}-slices`);
  if (el) mount(el, sliceBody(kind));
}
export const sliceSoon = { cal: debounce(() => reslice("cal"), 150), pol: debounce(() => reslice("pol"), 150) };

export function sliceBody(kind) {
  const b = W.bulk;
  const rep = b.slice[kind];
  if (!rep) return null;
  const title = h(
    "h3",
    { class: "cal-h" },
    kind === "cal" ? "By slice, at this threshold" : "By slice, at these gates",
  );
  if (!rep.field) {
    return [
      title,
      h(
        "p",
        { class: "faint", style: { fontSize: "12.5px" } },
        "No field of these rows has 2 to 20 values to compare. Give JSON rows a field such as ",
        h("code", {}, '"channel"'),
        " or ",
        h("code", {}, '"language"'),
        ", for example a column kept by Import CSV, to see accuracy for each value.",
      ),
    ];
  }
  const sel = h(
    "select",
    { class: "input", "aria-label": "Field to slice by", style: { width: "auto" } },
    rep.fields.map((f) =>
      h("option", { value: f.name, selected: f.name === rep.field }, `${f.name} (${f.values} values)`),
    ),
  );
  sel.addEventListener("change", () => {
    b.slice.field = sel.value;
    reslice("cal");
    reslice("pol");
    refreshSets();
  });
  const o = rep.overall;
  const acc = (v, lo, hi) => (v === null ? "—" : withCI(pct(v, 1), lo, hi));
  const mark = (s) => {
    const both = s.below && s.below_all;
    if (!s.below && !s.below_all) return null;
    const what = both ? "Worse than the rest" : s.below ? "Worse when automated" : "Worse over every row";
    const ps = [
      s.below ? `automated rows p = ${s.p.toFixed(3)}` : null,
      s.below_all ? `every row p = ${s.p_all.toFixed(3)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return h(
      "span",
      { class: "badge warning", title: `One-sided Fisher exact test against every other slice together: ${ps}` },
      what,
    );
  };
  const marked = rep.slices.filter((s) => s.below || s.below_all).length;
  return [
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, title, sel),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        { class: "table slices" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, rep.field),
            h("th", {}, "rows"),
            h("th", {}, "accuracy, every row"),
            h("th", {}, "automated"),
            h("th", {}, "accuracy when automated"),
            h("th", {}, "wrong but automated"),
            h("th", {}),
          ),
        ),
        h(
          "tbody",
          {},
          rep.slices.map((s) =>
            h(
              "tr",
              { class: s.below || s.below_all ? "slice-below" : "" },
              h("td", {}, h("code", {}, s.value)),
              h("td", { class: "num" }, String(s.rows)),
              h("td", {}, acc(s.accuracy, s.accuracy_low, s.accuracy_high)),
              h("td", {}, `${s.automated} · ${pct(s.coverage)}`),
              h("td", {}, acc(s.automated_accuracy, s.automated_low, s.automated_high)),
              h("td", { class: "num" }, String(s.wrong_automated)),
              h("td", {}, mark(s)),
            ),
          ),
          h(
            "tr",
            { class: "slice-all" },
            h("td", {}, h("b", {}, "all")),
            h("td", { class: "num" }, String(o.rows)),
            h("td", {}, acc(o.accuracy, o.accuracy_low, o.accuracy_high)),
            h("td", {}, `${o.automated} · ${pct(o.coverage)}`),
            h("td", {}, acc(o.automated_accuracy, o.automated_low, o.automated_high)),
            h("td", { class: "num" }, String(o.wrong_automated)),
            h("td", {}),
          ),
        ),
      ),
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12px" } },
      marked
        ? "A marked slice is right less often than every other slice together, by more than chance explains (one-sided Fisher exact test, p < 0.05). Even a slice that is no worse is marked about one time in twenty, so with several slices, label more rows of a marked one before acting on it."
        : "No slice is worse than the rest by more than chance explains (one-sided Fisher exact test, p < 0.05). Small slices rarely show a difference, so this does not show every slice is as accurate.",
    ),
  ];
}
