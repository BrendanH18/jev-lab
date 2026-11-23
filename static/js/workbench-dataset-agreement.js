// jev/agreement.py draws a random sample of a dataset's labeled rows and returns them without their labels, so a second
// person can label them blind, here or in a downloaded CSV. Comparing the two label sets shows, per question, how often
// two people agree and Cohen's kappa; the rows where they differ can be settled and written back to the dataset, rows
// and labels only. Nothing here calls the model.
import { $, api, h, handleError, icon, pct, stat, toast } from "./common.js";
import {
  secondItems,
  settleKey,
  settledItems,
  sessionItems,
  sessionSettlements,
  changeSecondLabel,
  agreementEditsUnsaved,
  restoreAgreementEdits,
  restoredChoices,
  unshownSettlements,
} from "./agreement.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { rowsText, bulkUnsaved, loadPictureUrls, rowText } from "./workbench-bulk.js";
import { queueClasses, shownAnswer } from "./workbench-review.js";
import { withCI, labelText, labelValue } from "./workbench-calibrate.js";

function agreeRun(id) {
  return (
    W.bulk.agreeRuns[id] ||
    (W.bulk.agreeRuns[id] = {
      open: false,
      rows: "30",
      busy: false,
      sample: null,
      labels: {},
      report: null,
      choices: {},
      pendingSettlements: [],
      sessionPreview: null,
      problem: null,
    })
  );
}

export function openDatasetAgreement(id) {
  agreeRun(id).open = true;
  render();
}

export function agreementSessionsUnsaved(id = null) {
  return Object.entries(W.bulk.agreeRuns || {}).some(
    ([key, run]) => (id === null || key === id) && agreementEditsUnsaved(run),
  );
}

export function confirmAgreementDiscard(id) {
  return (
    !agreementSessionsUnsaved(id) ||
    window.confirm(
      "This changes the saved dataset used by unfinished Label agreement edits. Download the agreement session first to keep a copy. Continue?",
    )
  );
}

const agreementEditContext = (run) =>
  JSON.stringify([run.sample?.session_context, run.labels, run.choices, run.pendingSettlements]);

function agreementSessionPanel(id, run) {
  const file = h("input", {
    type: "file",
    accept: ".json,application/json",
    hidden: true,
    "aria-label": `Restore agreement session for ${id}`,
    onchange: async () => {
      const selected = file.files[0];
      if (!selected) return;
      try {
        if (selected.size > 1024 * 1024) throw new Error("Agreement session must be at most 1 MiB.");
        await previewAgreementSession(id, JSON.parse(await selected.text()));
      } catch (e) {
        handleError(e);
      }
      file.value = "";
    },
  });
  const preview = run.sessionPreview;
  return h(
    "div",
    { class: "grid", style: { gap: "6px" } },
    h(
      "div",
      { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      h(
        "button",
        {
          class: "btn sm",
          disabled: run.busy || !run.sample?.session_context,
          onclick: () => downloadAgreementSession(id),
        },
        "Download agreement session",
      ),
      h("button", { class: "btn sm", disabled: run.busy, onclick: () => file.click() }, "Restore agreement session"),
      file,
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Recovery keeps your second labels, explicit settlement choices, and original sample. Restore needs the unchanged saved dataset and questions; saved labels stay hidden until you press Compare. Pictures travel separately.",
    ),
    run.sample && !run.sample.session_context
      ? h(
          "p",
          { class: "faint" },
          "Saving settlements changed this dataset. Remaining labels stay on this page, but the original session can no longer be downloaded. Download before saving settlements when you need recovery.",
        )
      : null,
    run.pendingSettlements?.length
      ? h(
          "p",
          { class: "faint" },
          `${run.pendingSettlements.length} restored settlement choices will appear after Compare.`,
        )
      : null,
    preview
      ? h(
          "div",
          { class: "callout" },
          h(
            "div",
            {},
            h("b", {}, "Agreement session preview"),
            h(
              "p",
              { class: "muted" },
              `${preview.result.counts.rows} sampled rows · ${preview.result.counts.labels} second labels · ${preview.result.counts.settlements} settlement choices. No saved changes or model calls.`,
            ),
            h(
              "button",
              { class: "btn sm primary", disabled: run.busy, onclick: () => acceptAgreementSession(id) },
              "Accept restored agreement session",
            ),
            h(
              "button",
              {
                class: "btn sm ghost",
                disabled: run.busy,
                onclick: () => {
                  run.sessionPreview = null;
                  render();
                },
              },
              "Cancel restore",
            ),
          ),
        )
      : null,
  );
}

async function downloadAgreementSession(id) {
  const run = agreeRun(id),
    sample = run.sample;
  if (run.busy || !sample?.session_context) return;
  run.busy = true;
  render();
  try {
    const session = await api("/api/workbench/datasets/agreement/session/export", {
      id,
      context: sample.session_context,
      rows: sample.sample_size,
      seed: sample.seed,
      items: sessionItems(run.labels),
      settlements: [...(run.pendingSettlements || []), ...sessionSettlements(run.choices)],
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: `${id}-agreement-session.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Downloaded agreement session. Keep the unchanged saved dataset to restore it.");
  } catch (e) {
    handleError(e);
  } finally {
    run.busy = false;
    render();
  }
}

async function previewAgreementSession(id, session) {
  const run = agreeRun(id);
  if (run.busy) return;
  const context = agreementEditContext(run);
  run.busy = true;
  run.sessionPreview = null;
  render();
  try {
    const result = await api("/api/workbench/datasets/agreement/session/import", { id, session });
    if (W.bulk.agreeRuns[id] === run && agreementEditContext(run) === context)
      run.sessionPreview = { session, result, context };
  } catch (e) {
    handleError(e);
  } finally {
    run.busy = false;
    render();
  }
}

async function acceptAgreementSession(id) {
  const run = agreeRun(id),
    preview = run.sessionPreview;
  if (run.busy || !preview || agreementEditContext(run) !== preview.context) return;
  if (
    agreementEditsUnsaved(run) &&
    !window.confirm("Replace the current agreement labels and settlement choices with this session?")
  )
    return;
  run.busy = true;
  render();
  try {
    const result = await api("/api/workbench/datasets/agreement/session/import", { id, session: preview.session });
    if (W.bulk.agreeRuns[id] !== run || run.sessionPreview !== preview || agreementEditContext(run) !== preview.context)
      return;
    run.sample = result.sample;
    Object.assign(run, restoreAgreementEdits(result));
    run.rows = String(result.sample.sample_size);
    run.report = null;
    run.choices = {};
    run.sessionPreview = null;
    await loadPictureUrls(result.sample.items);
    toast(
      "Restored human agreement edits. Compare explicitly to see saved labels; Save settled labels remains separate.",
    );
  } catch (e) {
    handleError(e);
  } finally {
    run.busy = false;
    render();
  }
}

export function agreeButton(x) {
  const a = agreeRun(x.id);
  return h(
    "button",
    {
      class: `btn sm${a.open ? " active" : ""}`,
      "aria-expanded": String(a.open),
      title: "Have a second person label a sample of these rows blind, and measure how often the two agree",
      onclick: () => {
        a.open = !a.open;
        render();
      },
    },
    icon("eye"),
    "Label agreement",
  );
}

export function agreePanel(x) {
  const a = agreeRun(x.id);
  const rows = h("input", {
    class: "input sm",
    type: "number",
    min: "1",
    max: "200",
    step: "1",
    value: a.rows,
    style: { width: "70px" },
    "aria-label": `Rows to sample from ${x.id}`,
  });
  rows.addEventListener("input", () => {
    a.rows = rows.value;
  });
  return h(
    "div",
    { class: "check-item agree" },
    h(
      "p",
      { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
      "Every accuracy here compares answers with these labels, so it is only as good as they are. Draw a random sample of the labeled rows, and have someone who did not label them label it again, without looking at the saved labels: here, or in the CSV. ",
      "The comparison shows, for each question, how often the two agree and Cohen's kappa, the agreement beyond chance. Nothing here calls the model.",
    ),
    h(
      "div",
      { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h(
        "label",
        { class: "faint", style: { fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" } },
        "Sample",
        rows,
        "labeled rows",
      ),
      h(
        "button",
        { class: "btn sm", disabled: a.busy, onclick: () => drawAgreeSample(x.id) },
        a.busy && !a.sample
          ? [h("span", { class: "spin" }), " Drawing…"]
          : [icon("layers"), a.sample ? "Draw a new sample" : "Draw sample"],
      ),
    ),
    agreementSessionPanel(x.id, a),
    a.sample ? agreeSampleView(x, a) : null,
    a.report ? agreeReport(x, a) : null,
  );
}

async function drawAgreeSample(id) {
  const a = agreeRun(id);
  const n = Number(a.rows || 0);
  if (!Number.isInteger(n) || n < 1 || n > 200) return toast("Sample a whole number of rows, from 1 to 200", "error");
  if (
    agreementEditsUnsaved(a) &&
    !confirm("Draw a new sample? Download the agreement session first to keep the labels given on this one.")
  )
    return;
  a.busy = true;
  render();
  try {
    // A fresh seed each time: a second draw from the same dataset is a different sample.
    a.sample = await api("/api/workbench/datasets/agreement/sample", {
      id,
      rows: n,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
    a.labels = {};
    a.report = null;
    a.choices = {};
    a.pendingSettlements = [];
    a.sessionPreview = null;
    await loadPictureUrls(a.sample.items);
  } catch (e) {
    handleError(e);
  }
  a.busy = false;
  render();
}

function agreeSampleView(x, a) {
  const s = a.sample;
  const given = secondItems(s.items, a.labels).length;
  // Lab (contract: static/js/lab/surfaces/workbench-datasets.js) hides cards and sorts them; every label stays in a.labels
  // and Compare still sends every labeled row.
  const lab = W.lab?.builders?.datasetsAgreementCtx ? datasetsAgreementLab(x) : null;
  const cards = lab ? lab.page.arrange(s.items.filter((item) => lab.page.matches(item))) : s.items;
  const labActive = lab ? W.lab.active("workbench.datasets.agreement") : 0;
  const card = (item) => {
    const labels = a.labels[item.row_id] || (a.labels[item.row_id] = Object.create(null)); // a question id may be __proto__
    const done = item.questions.every((q) => labels[q] !== null && labels[q] !== undefined);
    const picture = W.bulk.pictures[item.row?._image];
    return h(
      "div",
      { class: `queue-item${done ? " done" : ""}` },
      h(
        "div",
        { style: { display: "flex", gap: "6px", alignItems: "center" } },
        h("span", { class: "faint mono", style: { fontSize: "11.5px" } }, `row ${item.number}`),
        done ? h("span", { class: "badge good" }, icon("check"), "labeled") : null,
      ),
      picture ? h("img", { src: picture, alt: item.row._image, class: "row-thumb" }) : null,
      h("div", { class: "row-text" }, rowText(item.row)),
      h(
        "div",
        { class: "queue-labels" },
        item.questions.map((qid) => {
          const question = s.questions[qid];
          const current = labelText(labels[qid], question.type);
          const sel = h(
            "select",
            {
              class: "input label-sel",
              disabled: a.busy,
              "aria-label": `Second label for ${qid} on row ${item.number}`,
            },
            h("option", { value: "", selected: !current }, "—"),
            queueClasses(question).map((c) =>
              h(
                "option",
                { value: c, selected: c === current },
                question.type === "score" ? `${c} · ${String(question.criteria[Number(c)] ?? "").slice(0, 32)}` : c,
              ),
            ),
          );
          sel.addEventListener("change", () => {
            changeSecondLabel(a, item.row_id, qid, labelValue(sel.value, question.type));
            render();
          });
          return h(
            "label",
            { class: "queue-label" },
            h("span", { class: "mono" }, qid),
            sel,
            W.guides?.hint(x.id, qid, question, { row: item.row, blind: true }),
          );
        }),
      ),
    );
  };
  const file = h("input", { type: "file", accept: ".csv,.tsv,.txt", style: { display: "none" } });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (f) await compareAgreement(x.id, await f.text());
  });
  const download = () => {
    const url = URL.createObjectURL(new Blob([s.csv], { type: "text/csv" }));
    const link = h("a", { href: url, download: `${x.id}-second-labels.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
  };
  return h(
    "div",
    { class: "grid", style: { gap: "8px" } },
    h(
      "div",
      { class: "faint", style: { fontSize: "12px" } },
      `${s.items.length} of ${s.eligible} labeled rows, drawn at random. Each row asks only the questions its saved labels cover, since only those are compared. `,
      "The saved labels stay hidden until you compare; the rows box shows them if this dataset is loaded there, so label from this list.",
    ),
    agreeQuestions(s.questions),
    lab
      ? W.lab.section(W.labEnv, "workbench.datasets.agreement", lab, { title: "Lab tools for the agreement sample" })
      : null,
    labActive
      ? h(
          "p",
          { class: "faint", style: { fontSize: "12px", margin: 0 } },
          `Showing ${cards.length} of ${s.items.length} sampled rows · ${labActive} Lab setting${labActive === 1 ? "" : "s"} active. Labels on hidden rows stay, and Compare sends every labeled row. `,
          h(
            "button",
            {
              class: "btn sm ghost",
              onclick: () => {
                W.lab.reset("workbench.datasets.agreement");
                render();
              },
            },
            "Clear Lab filters and sort",
          ),
        )
      : null,
    h("div", { class: "queue-list" }, cards.map(card)),
    h(
      "div",
      { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h(
        "button",
        { class: "btn sm primary", disabled: a.busy || !given, onclick: () => compareAgreement(x.id) },
        a.busy
          ? [h("span", { class: "spin" }), " Comparing…"]
          : [icon("check"), `Compare ${given} labeled row${given === 1 ? "" : "s"}`],
      ),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "or"),
      h("button", { class: "btn sm ghost", onclick: download }, icon("save"), "Download CSV"),
      h("button", { class: "btn sm ghost", disabled: a.busy, onclick: () => file.click() }, "Compare a filled-in CSV"),
      file,
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "The CSV has the rows without their labels and an empty ",
      h("code", {}, "label:<question>"),
      ' column for each question; a "-" marks a label the saved labels do not have. Keep its ',
      h("code", {}, "row_id"),
      " column. Share the questions' instructions with the person labeling, as the model reads them.",
    ),
  );
}

// The questions as the model reads them, so the second person labels by the same instructions and options.
export function agreeQuestions(questions) {
  const text = (v) => (v === null || v === undefined || typeof v === "string" ? v || "" : JSON.stringify(v)); // instructions may be JSON
  const options = (q) =>
    q.type === "noul"
      ? [
          ["yes", q.criteria?.true],
          ["no", q.criteria?.false],
        ].filter(([, d]) => d)
      : q.type === "score"
        ? q.criteria.map((d, i) => [String(i), d])
        : Object.entries(q.criteria || {});
  return h(
    "details",
    { open: true },
    h("summary", { class: "muted", style: { fontSize: "12.5px" } }, "The questions, as the model reads them"),
    h(
      "dl",
      { style: { fontSize: "12.5px", margin: "6px 0 0" } },
      Object.entries(questions).map(([qid, q]) => [
        h(
          "dt",
          { class: "mono" },
          qid,
          h("span", { class: "faint" }, ` · ${q.type === "noul" ? "yes or no" : q.type}`),
        ),
        h(
          "dd",
          { style: { margin: "2px 0 8px 14px" } },
          text(q.instructions),
          options(q).length
            ? h(
                "ul",
                { class: "faint", style: { margin: "2px 0 0", paddingLeft: "18px" } },
                options(q).map(([name, d]) => h("li", {}, h("b", {}, name), d && d !== name ? ` · ${text(d)}` : "")),
              )
            : null,
        ),
      ]),
    ),
  );
}

async function compareAgreement(id, text = null) {
  const a = agreeRun(id);
  if (a.busy) return;
  if (
    Object.keys(a.choices).length &&
    !confirm(
      "Compare again and clear the current settlement choices? Download an agreement session first to keep them.",
    )
  )
    return;
  a.busy = true;
  render();
  try {
    const body = text === null ? { id, items: secondItems(a.sample.items, a.labels) } : { id, text };
    a.report = await api("/api/workbench/datasets/agreement", body);
    if (text !== null) {
      a.labels = Object.fromEntries((a.report.second_items || []).map((item) => [item.row_id, { ...item.labels }]));
    }
    a.choices = restoredChoices(a.report.disagreements, a.pendingSettlements);
    a.pendingSettlements = unshownSettlements(a.report.disagreements, a.pendingSettlements);
    a.sessionPreview = null;
  } catch (e) {
    handleError(e);
  }
  a.busy = false;
  render();
  $(`#agree-${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const kappaText = (k) => (k === null || k === undefined ? "—" : k.toFixed(2));

function agreeReport(x, a) {
  const rep = a.report;
  const o = rep.overall;
  const c = rep.counts;
  const questions = a.sample?.questions || {};
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const notes = [
    c.not_found ? `${plural(c.not_found, "row")} not in the dataset any more, or changed since the sample` : null,
    c.repeated ? `${plural(c.repeated, "row")} given twice, read once` : null,
    c.unlabeled ? `${plural(c.unlabeled, "row")} with no label to compare` : null,
    c.only_second ? `${plural(c.only_second, "label")} for questions the saved labels leave empty, not compared` : null,
  ].filter(Boolean);
  const settled = settledItems(rep.disagreements, a.choices);
  const settleSelect = (d) => {
    const question = questions[d.question] || {
      type: typeof d.first === "boolean" ? "noul" : typeof d.first === "number" ? "score" : "choice",
      criteria: {},
    };
    const key = settleKey(d.row_id, d.question);
    const value = Object.hasOwn(a.choices, key) ? a.choices[key] : d.first;
    const current = labelText(value, question.type);
    const options = [
      ...new Set([...queueClasses(question), labelText(d.first, question.type), labelText(d.second, question.type)]),
    ];
    const sel = h(
      "select",
      { class: "input label-sel", disabled: a.busy, "aria-label": `Settle ${d.question} on row ${d.number}` },
      h("option", { value: "", selected: !current }, "no label"),
      options.map((v) => h("option", { value: v, selected: v === current }, v)),
    );
    sel.addEventListener("change", () => {
      a.choices[key] = labelValue(sel.value, question.type);
      a.sessionPreview = null;
      render();
    });
    return sel;
  };
  return h(
    "div",
    { class: "check-report grid", id: `agree-${x.id}`, style: { gap: "8px" } },
    h(
      "div",
      { class: "stat-row" },
      stat("labels that agree", o.labels ? `${o.agree} of ${o.labels} · ${pct(o.agreement, 1)}` : "—"),
      stat(
        "rows that agree on every question",
        o.rows ? withCI(`${o.rows_agree} of ${o.rows} · ${pct(o.rows_agreement, 1)}`, o.rows_low, o.rows_high) : "—",
      ),
    ),
    notes.length ? h("div", { class: "faint", style: { fontSize: "12px" } }, notes.join(" · ")) : null,
    rep.problems_total
      ? h(
          "details",
          {},
          h(
            "summary",
            { class: "muted", style: { fontSize: "12.5px" } },
            `${plural(rep.problems_total, "label")} that fit no answer, skipped`,
          ),
          h(
            "ul",
            { class: "faint", style: { fontSize: "12px", margin: "4px 0 0", paddingLeft: "18px" } },
            rep.problems.map((p) => h("li", {}, p)),
            rep.problems_total > rep.problems.length
              ? h("li", {}, `…and ${rep.problems_total - rep.problems.length} more`)
              : null,
          ),
        )
      : null,
    Object.keys(rep.questions).length
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
                ["question", "rows", "agree", "Cohen's kappa", "most common difference"].map((t) => h("th", {}, t)),
              ),
            ),
            h(
              "tbody",
              {},
              Object.entries(rep.questions).map(([qid, q]) =>
                h(
                  "tr",
                  {},
                  h("td", { class: "mono" }, qid),
                  h("td", {}, String(q.rows)),
                  h("td", {}, withCI(`${q.agree} · ${pct(q.agreement, 1)}`, q.low, q.high)),
                  h(
                    "td",
                    {
                      title:
                        q.kappa === null
                          ? "Both gave every row the same label, so agreement beyond chance cannot be measured"
                          : "",
                    },
                    kappaText(q.kappa),
                  ),
                  h(
                    "td",
                    { style: { fontSize: "12px" } },
                    q.mixups.length
                      ? `saved ${shownAnswer(q.mixups[0].first)}, second ${shownAnswer(q.mixups[0].second)} · ${plural(q.mixups[0].rows, "row")}`
                      : "none",
                  ),
                ),
              ),
            ),
          ),
        )
      : h(
          "div",
          { class: "empty" },
          "No label was given by both. Label the sample's questions, or check the CSV's label columns.",
        ),
    rep.disagreements.length
      ? [
          h("h3", { class: "cal-h" }, `Where they differ · ${rep.disagreements_total}`),
          h(
            "p",
            { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
            "Settle each one: keep the saved label, take the second, choose another, or leave the row unlabeled for that question. A difference often means the question can be read two ways; sharpen its instructions or option descriptions too.",
          ),
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
                  ["row", "question", "saved", "second", "settle as"].map((t) => h("th", {}, t)),
                ),
              ),
              h(
                "tbody",
                {},
                rep.disagreements.map((d) =>
                  h(
                    "tr",
                    {},
                    h(
                      "td",
                      { class: "row", style: { maxWidth: "320px" } },
                      h("span", { class: "faint mono" }, `${d.number} `),
                      rowText(d.row),
                    ),
                    h("td", { class: "mono" }, d.question),
                    h("td", {}, shownAnswer(d.first)),
                    h("td", {}, shownAnswer(d.second)),
                    h("td", {}, settleSelect(d)),
                  ),
                ),
              ),
            ),
          ),
          rep.disagreements_total > rep.disagreements.length
            ? h(
                "p",
                { class: "faint", style: { fontSize: "12px", margin: 0 } },
                `Showing the first ${rep.disagreements.length}; settle these and compare again for the rest.`,
              )
            : null,
          h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            h(
              "button",
              { class: "btn sm primary", disabled: a.busy || !settled.length, onclick: () => saveSettled(x.id) },
              icon("save"),
              settled.length
                ? `Save settled labels on ${settled.length} row${settled.length === 1 ? "" : "s"} to “${x.name || x.id}”`
                : "Save settled labels",
            ),
            h(
              "span",
              { class: "faint", style: { fontSize: "12px" } },
              "Only labels that change the saved one are written. Rows and labels are saved, never answers.",
            ),
          ),
        ]
      : null,
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Kappa is 1 when the two always agree and 0 when they agree only as often as two people labeling at random with the same label mix would. ",
      "When two people agree on fewer labels than a target accuracy, an accuracy measured near that target depends on who labeled the rows as much as on the model: settle the differences, or sharpen the question, before you tune to it. ",
      o.rows && o.rows < 50 ? `${plural(o.rows, "row")} give a wide interval; sample more to rely on it.` : "",
    ),
  );
}

async function saveSettled(id) {
  const b = W.bulk;
  const a = agreeRun(id);
  const items = settledItems(a.report.disagreements, a.choices);
  if (!items.length) return;
  const remaining =
    !!a.pendingSettlements?.length ||
    a.report.disagreements_total > a.report.disagreements.length ||
    a.report.disagreements.some((item) => !Object.hasOwn(a.choices, settleKey(item.row_id, item.question)));
  if (
    remaining &&
    !window.confirm(
      "Saving these settlements changes the dataset and prevents downloading the remaining agreement edits as a session. Those edits stay on this page. Download the agreement session first if you need recovery. Save these settled labels anyway?",
    )
  )
    return;
  a.busy = true;
  render();
  try {
    const out = await api("/api/workbench/datasets/agreement/settle", { id, items });
    a.sample.session_context = null;
    a.sessionPreview = null;
    // The rows box holds the labels as they were, and saving it replaces the file: unlink it until fresh rows are in,
    // so a failed refresh below cannot leave a save that undoes the settled labels.
    const loaded = b.dataset.id === id;
    if (loaded) b.dataset.id = null;
    a.report.disagreements = a.report.disagreements.filter(
      (d) => !Object.hasOwn(a.choices, settleKey(d.row_id, d.question)),
    );
    a.choices = {};
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    if (loaded) {
      // Refresh the box when it has no unsaved edits; otherwise it stays unlinked, so a save under this name asks first.
      if (!bulkUnsaved()) {
        b.rowsText = b.savedText = rowsText((await api("/api/workbench/datasets/load", { id })).dataset.rows);
        b.dataset.id = id;
      } else {
        toast(
          "The rows box has unsaved edits, so it still shows this dataset with its old labels. Saving it under the same name asks before it replaces the file.",
          "error",
        );
      }
    }
    toast(
      `Changed ${out.changed} label${out.changed === 1 ? "" : "s"} on ${out.rows} row${out.rows === 1 ? "" : "s"} of data/workbench/datasets/${id}.json. Run the dataset again to score against them.`,
    );
  } catch (e) {
    handleError(e);
  }
  a.busy = false;
  render();
}

// "workbench.datasets.agreement": one ctx per dataset with an agreement sample on screen.
function datasetsAgreementLab(dataset) {
  const id = "workbench.datasets.agreement";
  const labs = W.datasetsAgreementLabs || (W.datasetsAgreementLabs = {});
  const datasetId = dataset.id;
  if (!labs[datasetId])
    labs[datasetId] = W.lab.builders.datasetsAgreementCtx({
      datasetId,
      datasetName: () => W.bulk.datasets.find((entry) => entry.id === datasetId)?.name || datasetId,
      run: () => W.bulk.agreeRuns[datasetId] || null,
      matches: (item, ctx) => W.lab.matches(id, item, ctx),
      arrange: (list, ctx) => W.lab.arrange(id, list, ctx),
      setLabel: (rowId, question, value) => {
        changeSecondLabel(agreeRun(datasetId), rowId, question, value);
        render();
      },
      compare: () => compareAgreement(datasetId),
      settle: (rowId, question, value) => {
        const a = agreeRun(datasetId);
        a.choices[settleKey(rowId, question)] = value;
        a.sessionPreview = null;
        render();
      },
      refresh: () => render(),
      now: () => Date.now(),
    });
  return labs[datasetId];
}
