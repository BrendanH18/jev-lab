// Reports for saved checks, including the slice targets shared with model upgrades.
import { h, icon, ms, pct, stat, usd } from "./common.js";
import { withCI } from "./workbench-calibrate.js";

export const CHECK_BADGE = {
  pass: ["good", "check", "Passed"],
  fail: ["critical", "stop", "Failed"],
  error: ["warning", "eye", "Not judged"],
};

export function sliceCheckReport(rep) {
  if (!rep.slice_targets?.length) return null;
  return h(
    "div",
    { class: "scroll" },
    h(
      "table",
      { class: "table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ["required slice", "result", "accuracy / target", "automated / minimum"].map((text) => h("th", {}, text)),
        ),
      ),
      h(
        "tbody",
        {},
        rep.slice_targets.map((s) => {
          const [tone, , label] = CHECK_BADGE[s.status];
          return h(
            "tr",
            {},
            h(
              "td",
              {},
              h("span", { class: "mono" }, `${s.field} = ${s.value}`),
              h("div", { class: "faint" }, `${s.rows} rows · ${s.labeled || 0} labeled`),
            ),
            h(
              "td",
              {},
              h("span", { class: `badge ${tone}` }, label),
              (s.reasons || []).map((reason) => h("div", { class: "faint" }, reason)),
            ),
            h(
              "td",
              {},
              s.targets?.accuracy
                ? `${s.targets.accuracy.value === null ? "—" : pct(s.targets.accuracy.value, 1)} / ${pct(s.targets.accuracy.target, 1)}${s.targets.accuracy.bound === "lower" ? " (95% lower bound)" : ""}`
                : "—",
            ),
            h("td", {}, s.targets?.coverage ? `${pct(s.coverage)} / ${pct(s.targets.coverage.target)}` : "—"),
          );
        }),
      ),
    ),
  );
}

export function checkReport(rep) {
  const [tone, ic, label] = CHECK_BADGE[rep.status];
  const t = rep.targets;
  const mark = (ok) => h("span", { class: `badge ${ok ? "good" : "critical"}` }, ok ? "meets" : "misses");
  const lower = rep.check.bound === "lower";
  return h(
    "div",
    { class: "check-report grid", style: { gap: "8px" } },
    h(
      "div",
      { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${tone}` }, icon(ic), label),
      h(
        "span",
        { class: "faint", style: { fontSize: "12px" } },
        `${rep.rows} rows · asked ${rep.model}${rep.answered_by?.length ? `, answered by ${rep.answered_by.join(", ")}` : ""}`,
      ),
    ),
    t.accuracy
      ? h(
          "div",
          { class: "stat-row" },
          stat("accuracy when automated", [
            rep.accuracy === null ? "—" : withCI(pct(rep.accuracy, 1), rep.accuracy_low, rep.accuracy_high),
            " ",
            mark(t.accuracy.ok),
          ]),
          stat(lower ? "target, 95% lower bound" : "target", pct(t.accuracy.target, 1)),
          stat("automated", [`${rep.automated} of ${rep.labeled} · ${pct(rep.coverage)}`, " ", mark(t.coverage.ok)]),
          stat("minimum", pct(t.coverage.target)),
          stat("cost", usd(rep.cost_usd)),
          rep.latency_ms_median === null ? null : stat("median latency", ms(rep.latency_ms_median)),
        )
      : null,
    sliceCheckReport(rep),
    rep.reasons.length
      ? h(
          "ul",
          { class: "muted", style: { fontSize: "12.5px", margin: 0, paddingLeft: "18px" } },
          rep.reasons.map((r) => h("li", {}, r)),
        )
      : null,
    (rep.notes || []).map((note) =>
      h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } }, icon("eye"), " ", note),
    ),
    rep.mistakes.length
      ? h(
          "div",
          { class: "grid", style: { gap: "4px" } },
          h("span", { class: "faint", style: { fontSize: "12px" } }, `Automated but wrong · ${rep.mistakes_total}`),
          h(
            "div",
            { class: "scroll" },
            h(
              "table",
              { class: "table" },
              h(
                "tbody",
                {},
                rep.mistakes.slice(0, 5).map((m) =>
                  h(
                    "tr",
                    {},
                    h("td", { class: "num" }, String(m.index + 1)),
                    h("td", { class: "row", style: { maxWidth: "260px" } }, m.row),
                    h(
                      "td",
                      {},
                      Object.entries(m.wrong).map(([q, a]) =>
                        h(
                          "div",
                          { style: { fontSize: "12px" } },
                          h("span", { class: "mono" }, q),
                          `: ${a.answer}, label ${a.label} `,
                          h("span", { class: "faint mono" }, `(${a.signal.toFixed(2)})`),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          rep.mistakes_total > 5
            ? h(
                "span",
                { class: "faint", style: { fontSize: "12px" } },
                `…and ${rep.mistakes_total - 5} more. Load the dataset and run it in Bulk to see every row.`,
              )
            : null,
        )
      : null,
  );
}
