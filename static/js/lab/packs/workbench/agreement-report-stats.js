// Comparison statistics and a settlement desk for the blind second-labeling sample ("workbench.datasets.agreement";
// contract in static/js/lab/surfaces/workbench-datasets.js), from your latest Compare: the chance agreement each kappa
// implies, how wide the row-agreement interval is and how many more compared rows a ±10-point interval needs, how much
// of the dataset the sample has not drawn, which questions were compared or agree fully, what is left to settle; checks
// for high agreement with low kappa, wide per-question intervals, settlement choices that write nothing, second labels
// the comparison left out and rows compared before they were fully labeled; a kappa table and a per-row progress CSV
// (question ids, row numbers and counts only); and a settlement desk listing every shown difference with the saved and
// second label (revealed by your Compare, as the page's comparison shows them) and buttons that settle it as the second
// label, the saved label or no label, exactly as the comparison's "settle as" select does. Nothing shows before Compare,
// nothing suggests a settlement or a label, and nothing writes: "Save settled labels" stays the page's own button.
// Agreement and kappa describe two people's labels, never the model.
import { csvText, definePack } from "../../kit.js";

const list = (value) => (Array.isArray(value) ? value : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? list(ctx.items()) : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? list(ctx.shown()) : []);
const reportOf = (ctx) => ctx?.data?.report || null;
const compared = (ctx) => list(reportOf(ctx)?.questions).filter((q) => q && q.rows > 0);
const diffsOf = (item) => (Array.isArray(item?.differences) ? item.differences : []);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The chance agreement p_e a kappa implies from the observed agreement p_o: kappa = (p_o - p_e) / (1 - p_e), so
// p_e = (p_o - kappa) / (1 - kappa). Undefined when kappa is unknown or 1.
const chanceOf = (q) =>
  finite(q?.kappa) !== null && finite(q?.agreement) !== null && q.kappa !== 1
    ? (q.agreement - q.kappa) / (1 - q.kappa)
    : null;
// Worst-case (50%) half-width of a 95% normal-approximation interval: 0.98 / √n. ±10 points needs ⌈(0.98 / 0.1)²⌉ = 97 rows.
const ROWS_FOR_TEN = Math.ceil((0.98 / 0.1) ** 2);
const WIDE = 0.3;

// ---------- panels ----------

const shownLabel = (value) =>
  value === null || value === undefined ? "no label" : value === true ? "yes" : value === false ? "no" : String(value);

function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function")
      result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) {
    api.toast(error?.message || String(error), "error");
  }
}

const CHOICES = [
  ["second", "Take second", (d) => d.second],
  ["saved", "Keep saved", (d) => d.saved],
  ["none", "Leave unlabeled", () => null],
];

function settledAs(d) {
  if (d.settle?.set !== true) return "not settled";
  if (d.settle.value === null || d.settle.value === undefined) return "settled: no label";
  if (same(d.settle.value, d.second)) return "settled: second label";
  if (same(d.settle.value, d.saved)) return "settled: saved label";
  return `settled: ${shownLabel(d.settle.value)}`;
}

function deskPanel(h, ctx, api) {
  const data = ctx?.data || {};
  if (!data.report)
    return h("p", { class: "faint" }, "Compare first: the desk lists the differences of your latest comparison.");
  const rows = shownOf(ctx).flatMap((item) => list(item.differences).map((d) => ({ item, d })));
  const settled = rows.filter(({ d }) => d.settle?.set === true);
  const changing = settled.filter(({ d }) => !same(d.settle.value, d.saved)).length;
  const listed = api.state.unsettledOnly ? rows.filter(({ d }) => d.settle?.set !== true) : rows;
  return h(
    "div",
    {},
    h(
      "p",
      { "data-part": "summary" },
      `${plural(rows.length, "shown difference")} · ${settled.length} settled · ${changing} would change the saved label · Save settled labels writes ${plural(data.settled_rows || 0, "row")}`,
    ),
    h(
      "div",
      { class: "chips lab-row" },
      h(
        "button",
        {
          class: "btn sm ghost",
          "data-action": "unsettled-only",
          "aria-pressed": api.state.unsettledOnly ? "true" : "false",
          onclick: () => {
            api.state.unsettledOnly = !api.state.unsettledOnly;
            api.redraw();
          },
        },
        "Only unsettled",
      ),
    ),
    listed.length
      ? h(
          "table",
          { class: "table", "data-table": "differences" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              ["Row", "Question", "Saved", "Second", "Now", ""].map((name) => h("th", {}, name)),
            ),
          ),
          h(
            "tbody",
            {},
            listed.map(({ item, d }) =>
              h(
                "tr",
                { "data-difference": `${item.row_id}:${d.question}` },
                h("td", { class: "num" }, String(item.number)),
                h("td", { class: "mono" }, d.question),
                h("td", {}, shownLabel(d.saved)),
                h("td", {}, shownLabel(d.second)),
                h("td", {}, settledAs(d)),
                h(
                  "td",
                  {},
                  CHOICES.map(([key, label, value]) =>
                    h(
                      "button",
                      {
                        class: "btn sm ghost",
                        "data-settle": `${item.row_id}:${d.question}:${key}`,
                        "aria-pressed": d.settle?.set === true && same(d.settle.value, value(d)) ? "true" : "false",
                        disabled: data.busy === true,
                        onclick: () => attempt(api, () => ctx.actions.settle(item.row_id, d.question, value(d))),
                      },
                      label,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : h("p", { class: "faint" }, rows.length ? "Every shown difference is settled." : "No shown difference."),
  );
}

export default definePack({
  id: "agreement-report-stats",
  surface: "workbench.datasets.agreement",
  title: "Label agreement: comparison statistics and settlement desk",
  about:
    "From your latest Compare: implied chance agreement, interval width, rows needed for a ±10-point interval, undrawn rows, compared and fully agreeing questions and what is left to settle; checks for high agreement with low kappa, wide intervals, settlement choices that write nothing, uncompared second labels and partly labeled compared rows; a kappa table, a per-row progress CSV, and a settlement desk that settles each difference the way you click. Two people's labels, never the model.",
  features: [
    {
      id: "chance_agreement",
      kind: "metric",
      format: "percent",
      label: "Chance agreement implied by kappa",
      help: "Averaged over the compared questions with a kappa below 1: p_e = (agreement − kappa) / (1 − kappa). High chance agreement means the labels sit mostly on one option.",
      compute: (ctx) => {
        const known = compared(ctx)
          .map((q) => [q.id, chanceOf(q)])
          .filter(([, value]) => value !== null);
        if (!known.length) return null;
        return {
          value: known.reduce((sum, [, value]) => sum + value, 0) / known.length,
          detail: known.map(([id, value]) => `${id} ${pct(value)}`).join(", "),
        };
      },
    },
    {
      id: "row_interval_width",
      kind: "metric",
      format: "percent",
      label: "Width of the row-agreement interval",
      help: "The 95% interval of the share of compared rows that agree on every question, high minus low.",
      compute: (ctx) => {
        const o = reportOf(ctx)?.overall;
        if (!o || finite(o.rows_low) === null || finite(o.rows_high) === null) return null;
        return {
          value: o.rows_high - o.rows_low,
          detail: `${pct(o.rows_low)} to ${pct(o.rows_high)} over ${plural(o.rows, "row")}`,
        };
      },
    },
    {
      id: "rows_for_ten_points",
      kind: "metric",
      format: "integer",
      label: "More compared rows for a ±10-point interval",
      help: `About ${ROWS_FOR_TEN} compared rows give a worst-case 95% margin of ±10 points (0.98 / √n). Planning only.`,
      compute: (ctx) => {
        const report = reportOf(ctx);
        if (!report) return null;
        const done = report.counts.compared;
        const eligible = ctx.data.sample?.eligible;
        const cap =
          Number.isInteger(eligible) && eligible < ROWS_FOR_TEN
            ? `; the dataset has only ${plural(eligible, "labeled row")}`
            : "";
        return { value: Math.max(0, ROWS_FOR_TEN - done), detail: `${done} of about ${ROWS_FOR_TEN} compared${cap}` };
      },
    },
    {
      id: "undrawn_rows",
      kind: "metric",
      format: "integer",
      label: "Labeled rows not in the sample",
      compute: (ctx) => {
        const sample = ctx?.data?.sample;
        return sample
          ? {
              value: Math.max(0, sample.eligible - sample.drawn),
              detail: `${sample.drawn} of ${plural(sample.eligible, "labeled row")} drawn`,
            }
          : null;
      },
    },
    {
      id: "questions_compared",
      kind: "metric",
      format: "integer",
      label: "Sampled questions compared",
      help: "Questions with at least one row both people labeled.",
      compute: (ctx) =>
        reportOf(ctx)
          ? { value: compared(ctx).length, detail: `of ${plural(list(ctx.data.questions).length, "sampled question")}` }
          : null,
    },
    {
      id: "full_agreement_questions",
      kind: "metric",
      format: "integer",
      label: "Questions where every compared label agrees",
      compute: (ctx) => {
        if (!reportOf(ctx)) return null;
        const full = compared(ctx).filter((q) => q.agree === q.rows);
        return { value: full.length, detail: full.map((q) => q.id).join(", ") || "none" };
      },
    },
    {
      id: "unsettled_differences",
      kind: "metric",
      format: "integer",
      label: "Shown differences not settled",
      compute: (ctx) => {
        const report = reportOf(ctx);
        if (!report) return null;
        const open = itemsOf(ctx).reduce(
          (sum, item) => sum + diffsOf(item).filter((d) => d.settle?.set !== true).length,
          0,
        );
        return { value: open, detail: `of ${plural(report.disagreements_shown, "shown difference")}` };
      },
    },
    {
      id: "rows_with_differences",
      kind: "metric",
      format: "integer",
      label: "Compared rows with a difference",
      compute: (ctx) => {
        const report = reportOf(ctx);
        if (!report) return null;
        return {
          value: report.counts.compared - report.counts.all_agree,
          detail: `of ${plural(report.counts.compared, "compared row")}`,
        };
      },
    },
    {
      id: "labels_compared_share",
      kind: "metric",
      format: "percent",
      label: "Second labels the comparison used",
      help: "Labels compared over second labels given. Labels on rows no longer in the dataset, repeated rows or questions without a saved label are left out.",
      compute: (ctx) => {
        const report = reportOf(ctx);
        const given = ctx?.data?.given_labels;
        if (!report || !(given > 0)) return null;
        return {
          value: report.overall.labels / given,
          detail: `${report.overall.labels} of ${plural(given, "second label")}`,
        };
      },
    },

    {
      id: "kappa_range",
      kind: "metric",
      format: "number",
      label: "Spread of kappa across questions",
      help: "Highest minus lowest kappa among the compared questions where it can be measured. A wide spread points at the questions whose guidelines need work.",
      compute: (ctx) => {
        const known = compared(ctx).filter((q) => finite(q.kappa) !== null);
        if (known.length < 2) return null;
        const low = known.reduce((a, b) => (b.kappa < a.kappa ? b : a)),
          high = known.reduce((a, b) => (b.kappa > a.kappa ? b : a));
        return {
          value: high.kappa - low.kappa,
          detail: `${low.id} ${low.kappa.toFixed(2)} to ${high.id} ${high.kappa.toFixed(2)}`,
        };
      },
    },

    {
      id: "kappa_paradox",
      kind: "diagnostic",
      severity: "advice",
      scope: "list",
      label: "High agreement but low kappa",
      help: "Agreement of 80% or more with kappa below 0.40: the two people agree mostly because nearly every row has the same label.",
      check: (_items, ctx) =>
        compared(ctx)
          .filter(
            (q) => finite(q.agreement) !== null && q.agreement >= 0.8 && finite(q.kappa) !== null && q.kappa < 0.4,
          )
          .map(
            (q) =>
              `${q.id}: ${pct(q.agreement)} agreement but kappa ${q.kappa.toFixed(2)}; chance alone gives about ${pct(chanceOf(q))}. Sample rows where the less common labels are likely.`,
          ),
    },
    {
      id: "wide_question_interval",
      kind: "diagnostic",
      severity: "info",
      scope: "list",
      label: "Wide agreement interval",
      help: `A question whose 95% agreement interval is wider than ${WIDE * 100} points.`,
      check: (_items, ctx) =>
        compared(ctx)
          .filter((q) => finite(q.low) !== null && finite(q.high) !== null && q.high - q.low > WIDE)
          .map(
            (q) =>
              `${q.id}: agreement could be anywhere from ${pct(q.low)} to ${pct(q.high)} over ${plural(q.rows, "compared row")}; label more rows before trusting it.`,
          ),
    },
    {
      id: "choices_keep_saved",
      kind: "diagnostic",
      severity: "info",
      scope: "list",
      label: "Settlement choices that keep the saved label",
      check: (_items, ctx) => {
        if (!reportOf(ctx)) return null;
        const keep = itemsOf(ctx).reduce(
          (sum, item) =>
            sum + diffsOf(item).filter((d) => d.settle?.set === true && same(d.settle.value, d.saved)).length,
          0,
        );
        return keep > 0
          ? `${plural(keep, "settlement choice")} keep${keep === 1 ? "s" : ""} the saved label, so Save settled labels writes nothing for ${keep === 1 ? "it" : "them"}; it writes ${plural(ctx.data.settled_rows, "row")}.`
          : null;
      },
    },
    {
      id: "labels_not_compared",
      kind: "diagnostic",
      severity: "advice",
      scope: "list",
      label: "Second labels the comparison left out",
      check: (_items, ctx) => {
        const report = reportOf(ctx);
        const left = report ? ctx.data.given_labels - report.overall.labels : 0;
        return left > 0
          ? `${plural(left, "second label")} ${left === 1 ? "was" : "were"} not compared (rows no longer in the dataset, repeated rows, or questions without a saved label).`
          : null;
      },
    },
    {
      id: "compared_partly_labeled",
      kind: "diagnostic",
      severity: "advice",
      scope: "list",
      label: "Rows compared before they were fully labeled",
      help: "Only the questions both people labeled are compared; the rest of these rows is not.",
      check: (_items, ctx) => {
        if (!reportOf(ctx)) return null;
        const rows = itemsOf(ctx).filter((item) => item.given > 0 && item.missing > 0);
        return rows.length
          ? `Row${rows.length === 1 ? "" : "s"} ${rows.map((item) => item.number).join(", ")} ${rows.length === 1 ? "was" : "were"} compared with questions still unlabeled; label them and compare again for a full comparison.`
          : null;
      },
    },

    {
      id: "kappa_table_md",
      kind: "exporter",
      label: "Kappa and chance agreement by question (Markdown, counts only)",
      mime: "text/markdown",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-kappa.md`,
      help: "For each compared question: rows, agreeing labels, observed agreement, kappa and the chance agreement it implies. No inputs and no label values.",
      build: (ctx) => {
        const report = reportOf(ctx);
        if (!report) throw new Error("Compare first: the table describes the latest comparison.");
        return (
          [
            `Kappa by question · ${ctx.data.dataset_name || ctx.data.dataset_id} · two people's labels, not the model`,
            "",
            "| Question | Rows | Agree | Observed | Kappa | Chance |",
            "| --- | --- | --- | --- | --- | --- |",
            ...report.questions.map(
              (q) =>
                `| ${q.id} | ${q.rows} | ${q.agree} | ${pct(q.agreement)} | ${q.kappa === null ? "—" : q.kappa.toFixed(2)} | ${pct(chanceOf(q))} |`,
            ),
          ].join("\n") + "\n"
        );
      },
    },
    {
      id: "row_progress_csv",
      kind: "exporter",
      label: "Second-labeling progress by row (CSV, counts only)",
      mime: "text/csv",
      filename: (ctx) => `${ctx.data.dataset_id || "dataset"}-agreement-rows.csv`,
      help: "Row number, row id, questions asked, second labels given and missing, and after Compare the differences and settled ones. No inputs and no label values; not the page's CSV.",
      build: (ctx) =>
        csvText([
          ["row", "row_id", "asked", "given", "missing", "differences", "settled"],
          ...itemsOf(ctx).map((item) => [
            item.number,
            item.row_id,
            list(item.questions).length,
            item.given,
            item.missing,
            Array.isArray(item.differences) ? item.differences.length : "",
            Array.isArray(item.differences) ? item.differences.filter((d) => d.settle?.set === true).length : "",
          ]),
        ]),
    },
    {
      id: "desk",
      kind: "panel",
      title: "Settlement desk",
      improvements: [
        {
          id: "list",
          title:
            "Every shown difference from your latest Compare with its row, question, saved and second label and how it is settled now",
        },
        { id: "settle", title: "Settle a difference as the second label, the saved label or no label with one click" },
        { id: "unsettled_only", title: "List only the differences not settled yet" },
        {
          id: "summary",
          title:
            "Count shown differences, settled ones, ones that change the saved label and the rows Save settled labels writes",
        },
      ],
      render: deskPanel,
    },
  ],
});
