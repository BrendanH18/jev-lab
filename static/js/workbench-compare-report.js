// Compare's scores, disagreements, and labeling handoff from the current run's answers.
import { $, api, h, handleError, icon, mount, ms, num, pct, stat, statusBadge, toast, usd } from "./common.js";
import { compareScorePayload } from "./compare-retry.js";
import { PERTURBS, VARIANTS } from "./variants.js";
import { W, canon } from "./workbench-state.js";
import { applyBuildQuestions, toQuestions } from "./workbench-build.js";
import { render } from "./workbench.js";
import { loadPictureUrls, rowsPayload, rowText } from "./workbench-bulk.js";
import { svg, SIGNALS, boundSelect, interval, withCI, syncAttachedSets } from "./workbench-calibrate.js";
import { cascadeBlock } from "./workbench-compare-cascade.js";

// Question ids both variants asked with the same type, in A's order.
export function cmpQuestions(res) {
  const [qa, qb] = res.variants.map((v) => v.questions);
  return Object.keys(qa).filter((q) => qb[q] && qb[q].type === qa[q].type);
}
function cmpLabeled(res) {
  const qids = new Set();
  for (const r of res.results) for (const q of Object.keys(r.expect || {})) qids.add(q);
  return qids;
}
export function chooseCmpQuestion() {
  const c = W.compare;
  const qids = cmpQuestions(c.result);
  const labeled = cmpLabeled(c.result);
  if (qids.includes(c.qid) && (labeled.has(c.qid) || !labeled.size)) return c.qid;
  return qids.find((q) => labeled.has(q)) || qids[0] || null;
}

let cmpSeq = 0;
export async function rescoreCompare() {
  const c = W.compare;
  const result = c.result;
  const qid = c.qid;
  const seq = ++cmpSeq; // only the latest request may install its report
  c.report = null;
  c.reportError = null;
  c.slices = null;
  c.slicesError = null;
  if (!qid || !result) return;
  const rows = result.results
    .filter((r) => r.runs.some((run) => run.answers?.[qid]))
    .map((r) => ({
      index: r.index,
      row: r.row,
      label: r.expect?.[qid] ?? null,
      answers: r.runs.map((run) => run.answers?.[qid] ?? null),
      meta: r.runs.map((run) => (run.meta ? { cost_usd: run.meta.cost_usd, latency_ms: run.meta.latency_ms } : null)),
    }));
  if (!rows.length) return;
  try {
    const payload = compareScorePayload(rows);
    const report = await api("/api/workbench/compare/score", {
      ...payload,
      rows: payload.rows.map(({ row: _input, ...scoreRow }) => scoreRow),
      signal: c.signal,
      first: c.first,
      bound: c.bound,
    });
    if (seq === cmpSeq && c.result === result) {
      c.report = report;
      // Start where the cascade first matches the second variant. When the first variant matches it
      // alone, or nothing does, start at the most accurate point instead.
      const cas = report.cascade;
      if (cas) c.cascadeT = (cas.match?.escalated ? cas.match : cas.best).threshold;
      try {
        const bySlice = await api("/api/workbench/compare/slices", {
          ...payload,
          field: c.sliceField,
          signal: c.signal,
          first: c.first,
          bound: c.bound,
        });
        if (seq === cmpSeq && c.result === result) c.slices = bySlice;
      } catch (e) {
        if (seq === cmpSeq && c.result === result) c.slicesError = e.message;
      }
    }
  } catch (e) {
    if (seq === cmpSeq && c.result === result) c.reportError = e.message;
  }
}

// Index of the better of two numbers, or -1 for a tie or a missing value.
function better(values, higher = true) {
  const [a, b] = values;
  if (a === null || a === undefined || b === null || b === undefined || Math.abs(a - b) < 1e-9) return -1;
  return a > b === higher ? 0 : 1;
}

function summaryRow(label, cells, values = null, higher = true) {
  const win = values ? better(values, higher) : -1;
  return h(
    "tr",
    {},
    h("th", {}, label),
    cells.map((cell, i) =>
      h("td", {}, i === win ? [h("b", {}, cell), h("span", { class: "faint" }, " · better")] : cell),
    ),
  );
}

function summaryTable(res, rep) {
  const vs = res.variants;
  const rows = [
    summaryRow(
      "model",
      vs.map((v) => h("span", { class: "mono" }, v.model)),
    ),
    summaryRow(
      "questions",
      vs.map((v) => String(Object.keys(v.questions).length)),
    ),
    vs.some((v) => v.perturb)
      ? summaryRow(
          "rows sent",
          vs.map((v) =>
            v.perturb
              ? `${PERTURBS[v.perturb] || v.perturb} · ${v.perturbed_rows} of ${res.rows} rewritten`
              : "as written",
          ),
        )
      : null,
    vs.some((v) => v.average_orders)
      ? summaryRow(
          "asked",
          vs.map((v) => (v.average_orders ? "twice, options in both orders, averaged" : "once")),
        )
      : null,
    summaryRow(
      "rows answered",
      vs.map((v) => `${v.completed} of ${res.rows}${v.errors ? ` · ${v.errors} failed` : ""}`),
    ),
    summaryRow(
      vs.some((v) => v.average_orders) ? "median latency, slower of two calls when asked twice" : "median latency",
      vs.map((v) => (v.latency_ms_median === null ? "—" : ms(v.latency_ms_median))),
      vs.map((v) => v.latency_ms_median),
      false,
    ),
    summaryRow(
      "input tokens",
      vs.map((v) => num(v.input_tokens)),
      vs.map((v) => (v.completed ? v.input_tokens / v.completed : null)),
      false,
    ),
    summaryRow(
      "cost",
      vs.map((v) => usd(v.cost_usd)),
      vs.map((v) => (v.completed ? v.cost_usd / v.completed : null)),
      false,
    ),
  ];
  const sv = rep?.variants;
  if (sv && sv.some((v) => v.labeled)) {
    rows.push(
      summaryRow(
        `accuracy · ${W.compare.qid}`,
        sv.map((v) =>
          v.accuracy === null
            ? "—"
            : withCI(`${pct(v.accuracy, 1)} (${v.correct}/${v.labeled})`, v.accuracy_low, v.accuracy_high),
        ),
        sv.map((v) => v.accuracy),
      ),
      summaryRow(
        "calibration gap (ECE)",
        sv.map((v) => (v.ece === null ? "—" : `${(v.ece * 100).toFixed(1)} pts`)),
        sv.map((v) => v.ece),
        false,
      ),
    );
    (sv[0].targets.length ? sv[0] : sv[1]).targets.forEach((t, k) => {
      const hits = sv.map((v) => v.targets[k]);
      const lower = rep.bound === "lower";
      rows.push(
        summaryRow(
          `automates at ${pct(t.target)} accuracy${lower ? ", 95% confidence" : ""}`,
          hits.map((x, i) =>
            x?.threshold === null || !x
              ? lower && sv[i].labeled < t.needed
                ? `not shown: needs ${t.needed}+ rows`
                : "not reached"
              : `${pct(x.coverage)} (≥ ${x.threshold.toFixed(2)})`,
          ),
          hits.map((x) => (x ? x.coverage : null)),
        ),
      );
    });
  }
  return h(
    "div",
    { class: "scroll" },
    h(
      "table",
      { class: "table cmp-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}),
          VARIANTS.map((name) => h("th", {}, h("i", { class: `cmp-key ${name.toLowerCase()}` }), `Variant ${name}`)),
        ),
      ),
      h("tbody", {}, rows),
    ),
  );
}

function pairedBlock(rep) {
  const p = rep.paired;
  const split = p.a_only + p.b_only;
  let verdict;
  if (!split) {
    verdict = `A and B were right on exactly the same rows, so these labels cannot tell them apart.`;
  } else {
    const lead = p.a_only > p.b_only ? "A" : p.b_only > p.a_only ? "B" : null;
    const chance = p.p_value < 0.001 ? "less than 0.1%" : pct(p.p_value, 1);
    verdict =
      `On ${split} row${split === 1 ? "" : "s"} exactly one variant was right: A on ${p.a_only}, B on ${p.b_only}. ` +
      `If neither were better, a split at least this uneven would happen ${chance} of the time (exact McNemar test). ` +
      (!lead
        ? "Neither is ahead on these rows."
        : p.p_value < 0.05
          ? `${lead} is ahead, and chance is an unlikely explanation.`
          : `${lead} is ahead, but that could be chance. Label more rows before you switch.`);
  }
  return h(
    "div",
    { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, `Row by row: ${p.rows} labeled rows that both variants answered`),
    h(
      "div",
      { class: "stat-row" },
      stat("both right", String(p.both_right)),
      stat("only A right", String(p.a_only), true),
      stat("only B right", String(p.b_only), true),
      stat("both wrong", String(p.both_wrong)),
    ),
    h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px" } }, verdict),
  );
}

export function renderCompareReport(compareRetryControls) {
  const c = W.compare;
  const res = c.result;
  const qids = cmpQuestions(res);
  const labeled = cmpLabeled(res);
  const qSel = h(
    "select",
    { class: "input", "aria-label": "Question to compare" },
    qids.map((q) => h("option", { value: q, selected: q === c.qid }, labeled.has(q) ? q : `${q} (no labels)`)),
  );
  qSel.addEventListener("change", async () => {
    c.qid = qSel.value;
    await rescoreCompare();
    render();
  });
  const sigSel = h(
    "select",
    { class: "input", "aria-label": "Signal to gate on" },
    Object.entries(SIGNALS).map(([k, label]) =>
      h("option", { value: k, selected: k === c.signal }, `gate on ${label}`),
    ),
  );
  sigSel.addEventListener("change", async () => {
    c.signal = sigSel.value;
    await rescoreCompare();
    render();
  });
  const rep = c.report;
  const hasLabels = rep && rep.variants.some((v) => v.labeled);
  const use = (i) => h("button", { class: "btn sm", onclick: () => cmpUseInBuild(i) }, `Use ${VARIANTS[i]} in Build`);
  const notes = [
    res.retry_error ? h("p", { style: { color: "var(--critical-text)" } }, res.retry_error) : null,
    rep
      ? rep.variants.map((v, i) =>
          v.invalid.length
            ? h(
                "p",
                { style: { color: "var(--critical-text)" } },
                `${v.invalid.length} labels ignored for ${VARIANTS[i]}: `,
                v.invalid
                  .slice(0, 3)
                  .map((x) => `row ${x.index + 1}: ${x.reason}`)
                  .join("; "),
              )
            : null,
        )
      : null,
    rep && (rep.only_a || rep.only_b)
      ? h(
          "p",
          { class: "faint" },
          `${rep.only_a + rep.only_b} rows answered by only one variant (A ${rep.only_a}, B ${rep.only_b}) are left out, so both sides are scored on the same rows.`,
        )
      : null,
    rep?.excluded
      ? h("p", { class: "faint" }, `${rep.excluded} labels that one variant cannot score are left out of both.`)
      : null,
    hasLabels && rep.paired.rows < 100 && rep.paired.rows
      ? h(
          "p",
          { class: "faint" },
          `With ${rep.paired.rows} paired rows, one row moves accuracy by ${(100 / rep.paired.rows).toFixed(1)} points. Pin model versions (for example jev-1.14.0) when you compare wording, so a model update does not change the result.`,
        )
      : null,
  ];
  let body;
  if (!qids.length) {
    body = h(
      "p",
      { class: "muted" },
      "The variants share no question id with the same type, so there is nothing to compare. Use the same ids in both.",
    );
  } else if (c.reportError) {
    body = h("p", { style: { color: "var(--critical-text)" } }, c.reportError);
  } else {
    body = [
      summaryTable(res, rep),
      compareSlices(),
      !hasLabels
        ? h(
            "p",
            { class: "muted" },
            `No labels for “${c.qid}”. Add `,
            h("code", {}, '"_expect"'),
            " to the rows to score accuracy; the disagreements below still show where the variants differ.",
          )
        : null,
      hasLabels ? pairedBlock(rep) : null,
      hasLabels
        ? h(
            "div",
            { class: "cal-chart-wrap" },
            h("h3", { class: "cal-h" }, "Accuracy against the share automated, as the threshold moves"),
            h(
              "div",
              { class: "cal-legend" },
              res.variants.map((v, i) =>
                h(
                  "span",
                  {},
                  h("i", { class: `cmp-key ${VARIANTS[i].toLowerCase()}` }),
                  `Variant ${VARIANTS[i]} · ${v.model}`,
                ),
              ),
            ),
            h("div", { id: "cmp-chart" }),
            h("div", { class: "cal-tip", id: "cmp-tip", hidden: true }),
            h(
              "p",
              { class: "faint", style: { fontSize: "12px" } },
              "Each line starts at the strictest threshold (few rows automated, usually the most accurate) and ends with every row automated. A line that stays higher automates the same share more accurately.",
            ),
            cmpSweepTable(rep),
          )
        : null,
      hasLabels && rep.cascade ? cascadeBlock(rep, rescoreCompare) : null,
    ];
  }
  return h(
    "div",
    { class: "panel", id: "compare-report" },
    h(
      "div",
      { class: "panel-head" },
      icon("layers"),
      h("h2", {}, "Compare"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "scored from these answers, no extra calls"),
      h("div", { class: "spacer" }),
      qids.length
        ? h(
            "div",
            { class: "cal-controls" },
            qSel,
            sigSel,
            boundSelect(c, async () => {
              const keep = c.cascadeT; // the basis changes only the targets, so the cascade keeps its threshold
              await rescoreCompare();
              c.cascadeT = keep;
            }),
          )
        : null,
    ),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "14px" } },
      h(
        "div",
        { class: "stat-row" },
        stat("rows", String(res.rows)),
        stat("labeled", String(res.labeled)),
        res.held_out ? stat("test rows left out", String(res.held_out)) : null,
        stat("wall", ms(res.wall_ms), true),
        stat("cost, both variants", usd(res.cost_usd)),
      ),
      compareRetryControls(),
      agreementBlock(res),
      ordersBlock(res),
      body,
      h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, notes),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, use(0), use(1)),
    ),
  );
}

// "Use A in Build" / "Use B in Build": Build gets that variant's questions as the latest run asked them.
function cmpUseInBuild(i) {
  if (!applyBuildQuestions(W.compare.result.variants[i].questions)) return false;
  location.hash = "build";
  toast(`Build now has variant ${VARIANTS[i]}'s questions`);
  return true;
}

// How often A and B answer each shared question differently, read from the answers, so it needs no labels.
// When B lists a Choice question's options in another order and changes nothing else (jev/compare.py
// reordered), every changed answer comes from the order alone.
function agreementBlock(res) {
  const c = W.compare;
  const perturbed = (res.agreement || []).some((a) => a.perturbed);
  const kind = res.variants.find((v) => v.perturb);
  const how = kind ? PERTURBS[kind.perturb] || kind.perturb : "";
  const rows = (res.agreement || []).filter((a) => a.answered);
  if (!rows.length && perturbed && !kind.perturbed_rows) {
    return h(
      "div",
      { class: "grid", style: { gap: "8px" } },
      h("h3", { class: "cal-h" }, `Input check: the rows ${how}`),
      h(
        "p",
        { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px", margin: 0 } },
        `The rewrite left every row as it was (say, text rows have one field to shuffle), so B repeated A's request and there is nothing to check. Try another rewrite.`,
      ),
    );
  }
  if (!rows.length) return null;
  const moved = rows.filter((a) => a.reordered);
  const show = (qid) => async () => {
    c.qid = qid;
    await rescoreCompare();
    render();
    $("#compare-rows")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const notes = moved.map((a) =>
    a.changed
      ? `“${a.qid}”: ${a.changed} of ${a.answered} answers changed when only the order of its options changed` +
        (a.options === 2
          ? ". With two options, a changed answer always picks the same place in the list, so the place cannot tell position from option."
          : a.same_position
            ? `, and ${a.same_position} of those picked the option in the same place in both lists, as an answer that follows the position would.`
            : ".")
      : `“${a.qid}”: no answer changed on ${a.answered} rows when only the order of its options changed.`,
  );
  if (perturbed) {
    const changed = rows.filter((a) => a.changed);
    notes.push(
      changed.length
        ? `Answers that changed when only the rows were rewritten ${how}: ${changed.map((a) => `“${a.qid}” ${a.changed} of ${a.answered}`).join(", ")}.`
        : `No answer changed on any question when the rows were rewritten ${how}.`,
    );
    const same = kind.unperturbed_rows;
    if (same)
      notes.push(
        `${same} of ${res.rows} rows came out of the rewrite unchanged (say, a row with one field to shuffle or no long words). B repeated A's request on them, so they are left out of the input check.`,
      );
  }
  return h(
    "div",
    { class: "grid", style: { gap: "8px" } },
    h(
      "h3",
      { class: "cal-h" },
      moved.length
        ? "Order check: how often an answer changes when only the order of the options changes"
        : perturbed
          ? `Input check: how often an answer changes when only the rows are rewritten ${how}`
          : "Agreement: how often A and B answer each question differently",
    ),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        { class: "table cmp-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "question"),
            h("th", {}, "rows both answered"),
            h("th", {}, moved.length || perturbed ? "answers changed" : "answers differ"),
            moved.length
              ? h(
                  "th",
                  { title: "Changed answers that picked the option in the same place in each variant's list" },
                  "same place in the list",
                )
              : null,
            h("th", {}),
          ),
        ),
        h(
          "tbody",
          {},
          rows.map((a) =>
            h(
              "tr",
              {},
              h(
                "th",
                {},
                a.qid,
                a.reordered
                  ? h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, "options reordered")
                  : null,
              ),
              h("td", {}, String(a.answered)),
              h("td", {}, withCI(`${a.changed} · ${pct(a.rate, 1)}`, a.low, a.high)),
              moved.length ? h("td", {}, a.reordered && a.changed ? `${a.same_position} of ${a.changed}` : "—") : null,
              h(
                "td",
                {},
                a.changed && a.qid !== c.qid
                  ? h("button", { class: "btn sm ghost", onclick: show(a.qid) }, "Show rows")
                  : a.changed
                    ? h("span", { class: "faint" }, "shown below")
                    : null,
              ),
            ),
          ),
        ),
      ),
    ),
    notes.length
      ? h(
          "div",
          { class: "grid", style: { gap: "4px" } },
          notes.map((n) => h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px", margin: 0 } }, n)),
        )
      : null,
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", maxWidth: "820px", margin: 0 } },
      moved.length
        ? "Each answer is A's and B's top pick on the same row. The interval is 95%. A small share can still matter: those rows get a different answer depending on how the options happen to be listed."
        : perturbed
          ? "Each answer is A's top pick on the row as written and B's on the rewritten row. The interval is 95%. A changed answer can also come from a row the model finds close either way, so compare with a run of B as a plain copy of A."
          : "Each answer is the top pick on the same row, labeled or not. The interval is 95%.",
    ),
  );
}

// For a variant that averages over both orders (jev/orders.py): how often its two calls picked different options.
// Those are the rows where averaging decides the answer, and the share is an order check from the same calls.
function ordersBlock(res) {
  const vs = res.variants
    .map((v, i) => ({ ...v, name: VARIANTS[i] }))
    .filter((v) => v.average_orders && v.orders?.some((o) => o.answered));
  if (!vs.length) return null;
  return h(
    "div",
    { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, "Order averaging: how often the two orders disagree"),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        { class: "table cmp-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "variant"),
            h("th", {}, "question"),
            h("th", {}, "rows both orders answered"),
            h("th", {}, "orders picked differently"),
          ),
        ),
        h(
          "tbody",
          {},
          vs.flatMap((v) =>
            v.orders
              .filter((o) => o.answered)
              .map((o) =>
                h(
                  "tr",
                  {},
                  h("th", {}, h("i", { class: `cmp-key ${v.name.toLowerCase()}` }), v.name),
                  h("td", {}, o.qid),
                  h("td", { class: "num" }, String(o.answered)),
                  h("td", {}, withCI(`${o.changed} (${pct(o.rate, 1)})`, o.low, o.high)),
                ),
              ),
          ),
        ),
      ),
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", maxWidth: "820px", margin: 0 } },
      "Each row was asked with the options as listed and in reverse order. Where the two picks differ, the averaged probabilities decide, and the confidence usually falls, so a threshold may send those rows to review. ",
      "Only Choice questions with two or more options are averaged; every other question keeps the answer from the call with the options as listed. Compare the variants above to see whether the second call is worth its cost.",
    ),
  );
}

function cmpSweepTable(rep) {
  const [a, b] = rep.variants;
  const cell = (p) => [
    h("td", {}, `${p.automated} · ${pct(p.coverage)}`),
    h("td", {}, p.accuracy === null ? "—" : withCI(pct(p.accuracy, 1), p.low, p.high)),
  ];
  return h(
    "details",
    {},
    h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } }, "Curves as a table"),
    h(
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
            h("th", {}, "threshold"),
            h("th", {}, "A automated"),
            h("th", {}, "A accuracy"),
            h("th", {}, "B automated"),
            h("th", {}, "B accuracy"),
          ),
        ),
        h(
          "tbody",
          {},
          a.sweep
            .filter((p) => Math.round(p.threshold * 100) % 5 === 0)
            .map((p) =>
              h(
                "tr",
                {},
                h("td", { class: "mono" }, p.threshold.toFixed(2)),
                cell(p),
                cell(b.sweep[Math.round(p.threshold * 100)]),
              ),
            ),
        ),
      ),
    ),
  );
}

// The rewritten row a perturbed variant was sent, under the row as written, and what an averaged variant
// picked in each order.
function sentText(res, index) {
  const runs = res.results[index]?.runs || [];
  const qid = W.compare.qid;
  return runs.flatMap((run, v) => [
    run && "input" in run
      ? h(
          "div",
          { class: "faint", style: { marginTop: "4px", fontSize: "12px" } },
          h("b", {}, `${VARIANTS[v]} saw: `),
          rowText(run.input),
        )
      : null,
    run?.orders?.[qid]
      ? h(
          "div",
          { class: "faint", style: { marginTop: "4px", fontSize: "12px" } },
          h("b", {}, `${VARIANTS[v]} in each order: `),
          `${run.orders[qid][0]} as listed, ${run.orders[qid][1]} reversed`,
        )
      : null,
  ]);
}

// The disagreement table of the scored question: the server's list. The labeling handoff sends every disagreement.
export function renderCompareRows() {
  const c = W.compare;
  const rep = c.report;
  return h(
    "div",
    { class: "panel", id: "compare-rows" },
    h(
      "div",
      { class: "panel-head" },
      icon("list"),
      h("h2", {}, `Rows where A and B answer “${c.qid}” differently · ${rep.disagreements.length}`),
      h("div", { class: "spacer" }),
      h("span", { class: "faint", style: { fontSize: "12px" } }, `${rep.agree} of ${rep.answered_both} rows agree`),
      h(
        "button",
        {
          class: "btn sm",
          disabled: c.labelingBusy || !rep.disagreements.length || !["choice", "noul", "score"].includes(rep.type),
          onclick: handoffCompareDisagreements,
        },
        c.labelingBusy ? "Preparing labels…" : "Label missing disagreement inputs",
      ),
    ),
    cmpRowsList(),
  );
}

function cmpRowsList() {
  const res = W.compare.result;
  const rep = W.compare.report;
  const verdicts = { a_only: ["pass", "A right"], b_only: ["pass", "B right"], both_wrong: ["fail", "Both wrong"] };
  const answer = (x) =>
    h(
      "td",
      {},
      h("span", { class: "cell-choice" }, x.predicted),
      h("span", { class: "faint mono", style: { marginLeft: "6px", fontSize: "11px" } }, x.signal.toFixed(2)),
      x.correct === null
        ? null
        : h(
            "span",
            { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } },
            x.correct ? "right" : "wrong",
          ),
    );
  if (!rep.disagreements.length)
    return h("div", { class: "panel-body muted" }, "A and B gave the same answer on every row they both answered.");
  return h(
    "div",
    { class: "scroll" },
    h(
      "table",
      { class: "table bulk-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, "#"),
          h("th", {}, "row"),
          h("th", {}, "label"),
          h("th", {}, "A"),
          h("th", {}, "B"),
          h("th", {}, "result"),
        ),
      ),
      h(
        "tbody",
        {},
        rep.disagreements.map((d) =>
          h(
            "tr",
            {},
            h("td", { class: "num" }, String(d.index + 1)),
            h("td", { class: "row" }, rowText(res.results[d.index]?.row), sentText(res, d.index)),
            h("td", {}, d.label ?? h("span", { class: "faint" }, "—")),
            d.answers.map(answer),
            h(
              "td",
              {},
              d.verdict && verdicts[d.verdict]
                ? statusBadge(...verdicts[d.verdict])
                : h("span", { class: "faint" }, "no label"),
            ),
          ),
        ),
      ),
    ),
  );
}

function compareSlices() {
  const c = W.compare;
  const report = c.slices;
  if (c.slicesError) return h("p", { class: "faint" }, `Slices unavailable: ${c.slicesError}`);
  if (!report) return null;
  const field = h(
    "select",
    { class: "input sm", "aria-label": "Compare slice field" },
    h("option", { value: "", selected: !report.field }, "Choose an input field"),
    report.fields.map((option) =>
      h("option", { value: option.name, selected: option.name === report.field }, option.name),
    ),
  );
  field.addEventListener("change", async () => {
    c.sliceField = field.value || null;
    await rescoreCompare();
    render();
  });
  const accuracy = (variant) =>
    variant.accuracy === null
      ? "No valid paired labels"
      : withCI(
          `${variant.correct} of ${variant.labeled} · ${pct(variant.accuracy, 1)}`,
          variant.accuracy_low,
          variant.accuracy_high,
        );
  const target = (variant) => {
    const at95 = variant.targets.find((entry) => entry.target === 0.95);
    return at95?.threshold === null || !at95 ? "not reached" : pct(at95.coverage);
  };
  return h(
    "div",
    { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, "Compare by slice"),
    h(
      "p",
      { class: "faint" },
      "Compare the same successful pairs within each input value. Accuracy has a 95% interval; automation targets use the selected confidence basis. This reuses this run's answers, makes no model calls, and excludes held-out rows. Small slices may not support a conclusion.",
    ),
    report.fields.length
      ? h("label", {}, "Input field ", field)
      : h("p", { class: "muted" }, "No input field has 2–20 distinct values among the rows both variants answered."),
    report.field
      ? h(
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
                [
                  report.field,
                  "Paired inputs",
                  "A accuracy",
                  "B accuracy",
                  "A automates at 95%",
                  "B automates at 95%",
                  "Paired p",
                ].map((title) => h("th", {}, title)),
              ),
            ),
            h(
              "tbody",
              {},
              report.slices.map((group) =>
                h(
                  "tr",
                  {},
                  h("td", { title: group.value }, group.shown),
                  h("td", {}, String(group.rows)),
                  group.error
                    ? h("td", { colspan: "5" }, group.error)
                    : [
                        ...group.variants.map((variant) => h("td", {}, accuracy(variant))),
                        ...group.variants.map((variant) => h("td", {}, target(variant))),
                        h(
                          "td",
                          {
                            title:
                              "Exact McNemar test on labels both variants can score. Exploratory slice comparisons are not adjusted for multiple testing.",
                          },
                          group.paired.rows
                            ? group.paired.p_value < 0.001
                              ? "< 0.001"
                              : group.paired.p_value.toFixed(3)
                            : "—",
                        ),
                      ],
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

// Only inputs and the chosen question schema go to the blank-label queue. The server maps
// Compare's tuning indices back to positions in the full source, including held-out rows.
async function handoffCompareDisagreements() {
  const c = W.compare;
  const b = W.bulk;
  const result = c.result;
  const report = c.report;
  if (c.labelingBusy || !report?.disagreements.length || typeof c.sourceText !== "string") return;
  const sourceText = c.sourceText;
  const questions = result.variants[0].questions;
  const context = () => canon([b.rowsText, b.labels, W.questions, b.prelabel]);
  const before = context();
  c.labelingBusy = true;
  render();
  try {
    const prepared = await api("/api/workbench/compare/labeling", {
      rows: rowsPayload(sourceText),
      questions,
      qid: c.qid,
      indices: report.disagreements.map((item) => item.index),
    });
    if (c.result !== result || c.report !== report || context() !== before) return;
    if (!prepared.items.length)
      return toast(
        "These disagreement inputs already have labels, or cannot carry labels. Existing labels are preserved.",
      );
    if (
      !confirm(
        `Open ${prepared.items.length} disagreement inputs with blank human-label controls? This replaces the Bulk rows editor with this Compare run's original inputs, sets Build questions to variant A, and replaces any unfinished pre-run labeling or label-repair drafts. Existing source labels and held-out rows are preserved. Apply labels and Save dataset remain explicit.`,
      )
    )
      return;
    if (!applyBuildQuestions(questions)) return;
    b.rowsText = sourceText;
    b.source = "current";
    b.result = null;
    b.runText = null;
    b.labels = {};
    b.labelsDirty = false;
    b.testScore = null;
    b.gateExport = null;
    b.health.report = null;
    b.prelabel = {
      busy: false,
      report: prepared,
      context: JSON.stringify([b.rowsText, toQuestions(W.questions), false]),
      drafts: {},
      field: null,
      value: null,
      status: "all",
      nextIndex: null,
      csvPreview: null,
    };
    await loadPictureUrls(prepared.items);
    W.tab = "bulk";
    location.hash = "bulk";
    syncAttachedSets();
    toast(
      "Opened blank human labels for missing disagreement inputs. No answers were copied. Apply and Save when ready.",
    );
    render();
    $("#prelabel-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    handleError(e);
  } finally {
    c.labelingBusy = false;
    render();
  }
}

// Accuracy of the automated rows against the share automated: one line per variant, one point per
// distinct automated set (thresholds that automate the same rows give the same point).
function cmpCurve(sweep) {
  const seen = new Map();
  for (const p of sweep) if (p.accuracy !== null && !seen.has(p.automated)) seen.set(p.automated, p); // lowest threshold first
  return [...seen.values()].sort((x, y) => x.coverage - y.coverage);
}

export function updateCmpChart() {
  const rep = W.compare.report;
  if (!rep || !$("#cmp-chart")) return;
  mount("#cmp-chart", cmpChart(rep));
}

function cmpChart(rep) {
  const curves = rep.variants.map((v) => cmpCurve(v.sweep));
  const W_ = Math.max(320, Math.round($("#cmp-chart")?.clientWidth || 640)),
    H_ = 260,
    m = { l: 46, r: 30, t: 14, b: 40 };
  const iw = W_ - m.l - m.r,
    ih = H_ - m.t - m.b;
  const lowest = Math.min(1, ...curves.flat().map((p) => p.accuracy));
  const y0 = Math.max(0, Math.min(0.5, Math.floor(lowest * 10) / 10)); // accuracy lives near the top; zoom to where it is
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - (v - y0) / (1 - y0)) * ih;
  const path = (pts) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.coverage).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join("");
  const grid = [y0, (y0 + 1) / 2, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v)),
  ]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, pct(v)),
  );
  // Direct labels just past each line's end (every row automated), nudged apart when they would touch.
  const ends = curves.map((pts) => pts[pts.length - 1]);
  const ly = ends.map((p) => (p ? y(p.accuracy) : null));
  if (ly[0] !== null && ly[1] !== null && Math.abs(ly[0] - ly[1]) < 14) {
    const mid = (ly[0] + ly[1]) / 2,
      up = ly[0] <= ly[1];
    ly[0] = mid + (up ? -7 : 7);
    ly[1] = mid + (up ? 7 : -7);
  }
  const labels = ends.map((p, i) =>
    p ? svg("text", { x: x(p.coverage) + 7, y: ly[i] + 4, class: "cal-label" }, VARIANTS[i]) : null,
  );
  const lines = curves.map((pts, i) => svg("path", { d: path(pts), class: `cal-line ${VARIANTS[i].toLowerCase()}` }));
  const hair = svg("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: "cal-hair", visibility: "hidden" });
  const dots = curves.map((_, i) =>
    svg("circle", { r: 4, class: `cal-dot ${VARIANTS[i].toLowerCase()}`, visibility: "hidden" }),
  );
  const hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "cal-hit" });
  const summary = rep.variants
    .map(
      (v, i) =>
        `${VARIANTS[i]}: ${v.accuracy === null ? "no labeled rows" : `${pct(v.accuracy)} accurate with every row automated`}`,
    )
    .join("; ");
  const root = svg(
    "svg",
    {
      viewBox: `0 0 ${W_} ${H_}`,
      width: W_,
      height: H_,
      class: "cal-chart",
      role: "img",
      "aria-label": `Accuracy of automated rows against the share automated, for each variant. ${summary}.`,
    },
    grid,
    ticks,
    svg(
      "text",
      { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" },
      "share of labeled rows automated",
    ),
    lines,
    hair,
    dots,
    labels,
    hit,
  );
  const nearest = (pts, v) =>
    pts.reduce((best, p) => (!best || Math.abs(p.coverage - v) < Math.abs(best.coverage - v) ? p : best), null);
  hit.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (((e.clientX - box.left) / box.width) * W_ - m.l) / iw));
    hair.setAttribute("x1", x(v));
    hair.setAttribute("x2", x(v));
    hair.setAttribute("visibility", "visible");
    const near = curves.map((pts) => nearest(pts, v));
    near.forEach((p, i) => {
      if (!p) return dots[i].setAttribute("visibility", "hidden");
      dots[i].setAttribute("cx", x(p.coverage));
      dots[i].setAttribute("cy", y(p.accuracy));
      dots[i].setAttribute("visibility", "visible");
    });
    const tip = $("#cmp-tip");
    const wrap = tip.parentElement.getBoundingClientRect();
    mount(
      tip,
      h("div", { class: "faint mono" }, `about ${pct(v)} automated`),
      near.map((p, i) =>
        p
          ? h(
              "div",
              {},
              h("i", { class: `cmp-key ${VARIANTS[i].toLowerCase()}` }),
              h("b", {}, VARIANTS[i]),
              ` ${pct(p.accuracy, 1)} accurate (${interval(p.low, p.high)}) · ${pct(p.coverage)} automated at ≥ ${p.threshold.toFixed(2)}`,
            )
          : null,
      ),
    );
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX - wrap.left + 14, wrap.width - 250)}px`;
    tip.style.top = `${e.clientY - wrap.top + 10}px`;
  });
  hit.addEventListener("pointerleave", () => {
    hair.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    $("#cmp-tip").hidden = true;
  });
  return root;
}
