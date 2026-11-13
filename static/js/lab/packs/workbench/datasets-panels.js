// Catalog panels for the Workbench dataset catalog ("workbench.datasets.catalog"; contract in
// static/js/lab/surfaces/workbench-datasets.js): label coverage by question id, held-out split health, saved checks
// and two datasets side by side. Summary metadata only: ids, names, counts, flags and timestamps, never notes, inputs,
// label values, answers or check configuration. Counts describe saved human work, not label validity. Pins last for
// this page session, nothing here saves or deletes a dataset, and nothing calls the model.
import { compareText, definePack } from "../../kit.js";

const SPLIT_MIN_LABELED = 4;  // "Hold out test rows" needs at least this many labeled rows (contract: split_ready)
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const percent = (share) => (finite(share) === null ? "" : `${Math.round(share * 100)}%`);
// Datasets as the surface gives them; anything without a string id is skipped, never shown as "undefined".
const datasets = (list) => (Array.isArray(list) ? list.filter((item) => item && typeof item === "object" && typeof item.id === "string") : []);
const shownOf = (ctx) => datasets(typeof ctx?.shown === "function" ? ctx.shown() : []);
const itemsOf = (ctx) => datasets(typeof ctx?.items === "function" ? ctx.items() : []);
const dayOf = (stamp) => (typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : "");
const labelEntries = (item) => (Array.isArray(item?.question_labels) ? item.question_labels : [])
  .filter((entry) => entry && typeof entry.id === "string" && Number.isInteger(entry.labeled) && entry.labeled > 0);
// One cell of tab-separated text: numbers as they are; text on one line, with a leading apostrophe where a spreadsheet
// would run it as a formula.
const tsvCell = (value) => {
  if (typeof value === "number") return String(value);
  const text = oneLine(value);
  return /^[=+@-]/.test(text) ? `'${text}` : text;
};
const tsv = (rows) => rows.map((row) => row.map(tsvCell).join("\t")).join("\n");
// A whole number typed in a box: blank -> fallback, digits -> the number, anything else -> NaN.
const wholeNumber = (raw, fallback) => {
  const text = String(raw ?? "").trim();
  if (text === "") return fallback;
  return /^\d+$/.test(text) ? Number(text) : NaN;
};

function pinFromPanel(ctx, api, ids, what) {
  if (!ids.length) { api.toast("No dataset to pin.", "error"); return; }
  try {
    ctx.actions.pin(ids, true);
    api.toast(`Pinned ${plural(ids.length, "dataset")} ${what} for this page session.`);
  } catch (error) {
    api.toast(error.message, "error");
  }
}

const copyButton = (h, api, key, text, label) => h("button", { class: "btn sm ghost", "data-copy": key,
  onclick: () => { api.copy(text); api.toast(`${label} copied.`); } }, `Copy ${label.toLowerCase()}`);
const head = (h, labels) => h("thead", {}, h("tr", {}, labels.map((label) => h("th", {}, label))));
const numCell = (h, value) => h("td", { class: "num" }, String(value));

// ---------- splits ----------

function splitRow(item) {
  const test = item.test;
  const labeled = count(item.labeled);
  const share = finite(test?.share) ?? (labeled ? count(item.held_out_labeled) / labeled : null);
  return { id: item.id, held: count(item.held_out), heldLabeled: count(item.held_out_labeled), tuning: count(item.tuning),
    tuningLabeled: count(item.tuning_labeled), labeled, share, looks: count(test?.looks), drawn: dayOf(test?.locked_at) };
}

function splitFlags(row, minLabeled, manyLooks) {
  const flags = [];
  if (row.heldLabeled < minLabeled) flags.push(`under ${minLabeled} labeled held-out rows`);
  if (row.looks >= manyLooks && manyLooks > 0) flags.push(`scored ${plural(row.looks, "time")}`);
  if (row.held > row.heldLabeled) flags.push(`${plural(row.held - row.heldLabeled, "held-out row")} without a label`);
  return flags;
}

// ---------- side by side ----------

const PAIR_ROWS = [
  ["Name", (item) => oneLine(item.name)],
  ["Rows", (item) => count(item.rows)],
  ["Labeled rows", (item) => count(item.labeled)],
  ["Rows without a label", (item) => count(item.unlabeled)],
  ["Saved questions", (item) => count(item.questions)],
  ["Guidelines", (item) => count(item.guidelines)],
  ["Saved check", (item) => (item.has_check ? "yes" : "no")],
  ["Held-out rows", (item) => count(item.held_out)],
  ["Held-out labeled rows", (item) => count(item.held_out_labeled)],
  ["Test looks", (item) => (item.test ? count(item.test.looks) : "no split")],
  ["Last saved", (item) => item.saved_at || "unknown"],
];

export default definePack({
  id: "datasets-panels",
  surface: "workbench.datasets.catalog",
  title: "Dataset catalog panels",
  about: "Overview panels for the saved datasets: label coverage by question id, held-out split health, saved checks and two datasets side by side. Summary metadata only (ids, names, counts, flags, timestamps), never notes, inputs, label values, answers or check configuration.",
  features: [
    { id: "coverage", kind: "panel", title: "Label coverage by question",
      improvements: [
        { id: "matrix", title: "Table labeled rows for each question ID in each shown dataset, naming the datasets without labels" },
        { id: "shares", title: "Show each coverage cell as a share of the dataset's rows" },
        { id: "threshold", title: "Mark coverage cells under a labeled-row count you choose" },
        { id: "include_hidden", title: "Include the datasets the catalog filters hide in the coverage table" },
        { id: "sort_columns", title: "Order the question columns A to Z or by most labeled rows" },
        { id: "copy", title: "Copy the coverage table as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const state = api.state;
        const list = state.hidden === true ? itemsOf(ctx) : shownOf(ctx);
        const controls = h("div", { class: "lab-row" },
          h("label", {}, h("input", { type: "checkbox", checked: state.shares === true, "data-toggle": "shares",
            onchange: (event) => { state.shares = !!event.target.checked; api.redraw(); } }), " Shares of rows"),
          h("label", {}, h("input", { type: "checkbox", checked: state.hidden === true, "data-toggle": "hidden",
            onchange: (event) => { state.hidden = !!event.target.checked; api.redraw(); } }), " Include hidden datasets"),
          h("label", {}, "Columns ", h("select", { class: "input sm", "aria-label": "Order question columns", "data-pick": "columns",
            onchange: (event) => { state.columns = event.target.value; api.redraw(); } },
          h("option", { value: "az", selected: state.columns !== "rows" }, "A to Z"), h("option", { value: "rows", selected: state.columns === "rows" }, "Most labeled rows first"))),
          h("label", {}, "Mark under ", h("input", { class: "input sm", type: "number", min: "1", step: "1", value: state.threshold ?? "", "aria-label": "Mark cells under this many labeled rows",
            "data-input": "threshold", oninput: (event) => { state.threshold = event.target.value; api.redraw(); } }), " labeled rows"));
        const labeled = list.filter((item) => labelEntries(item).length);
        const without = list.filter((item) => !labelEntries(item).length).map((item) => item.id);
        const empty = without.length ? h("p", { class: "faint", "data-without": without.join(",") }, `No saved label yet: ${without.join(", ")}.`) : null;
        if (!labeled.length) return h("div", {}, controls, h("p", { class: "faint" }, list.length ? "No listed dataset has a saved label." : "No dataset is shown."), empty);
        const totals = new Map();
        for (const item of labeled) for (const entry of labelEntries(item)) totals.set(entry.id, (totals.get(entry.id) || 0) + entry.labeled);
        const qids = [...totals.keys()].sort((x, y) => (state.columns === "rows" ? totals.get(y) - totals.get(x) : 0) || compareText(x, y));
        const threshold = wholeNumber(state.threshold, null);
        const badThreshold = Number.isNaN(threshold) || threshold === 0;
        let low = 0;
        const grid = labeled.map((item) => {
          const byId = new Map(labelEntries(item).map((entry) => [entry.id, entry.labeled]));
          return { id: item.id, cells: qids.map((qid) => {
            const n = byId.get(qid);
            if (n === undefined) return { text: "", low: false };
            const isLow = !badThreshold && threshold !== null && n < threshold;
            if (isLow) low += 1;
            return { text: state.shares === true ? percent(count(item.rows) ? n / item.rows : null) : n, low: isLow };
          }) };
        });
        return h("div", {}, controls,
          h("table", { class: "table lab-table", "data-table": "coverage" }, head(h, ["Dataset", ...qids]),
            h("tbody", {}, grid.map((row) => h("tr", { "data-dataset": row.id }, h("td", {}, row.id),
              row.cells.map((cell) => h("td", { class: cell.low ? "num warn" : "num", "data-low": cell.low ? "true" : null }, String(cell.text))))))),
          badThreshold ? h("p", { class: "warn", "data-threshold-error": "true" }, "Enter a whole number of labeled rows, 1 or more.")
            : threshold !== null ? h("p", { "data-low-count": String(low) }, `${plural(low, "cell")} under ${threshold} labeled rows.`) : null,
          empty,
          copyButton(h, api, "coverage", tsv([["Dataset", ...qids], ...grid.map((row) => [row.id, ...row.cells.map((cell) => cell.text)])]), "Coverage table"),
          h("p", { class: "faint" }, "Rows with any saved label for that question id, held-out rows included; ids may name questions a dataset no longer saves. Counts are not label validity."));
      } },

    { id: "splits", kind: "panel", title: "Held-out split health",
      improvements: [
        { id: "table", title: "Table each shown split's held-out and tuning rows, labeled rows, held-out share, test looks and draw date" },
        { id: "thresholds", title: "Flag splits under a number of labeled held-out rows and at a number of test looks you choose, and splits with unlabeled held-out rows" },
        { id: "no_split", title: "List the shown datasets without a split and how many more labeled rows each needs before one can be drawn" },
        { id: "pin_flagged", title: "Pin the shown datasets whose split is flagged" },
      ],
      render: (h, ctx, api) => {
        const state = api.state;
        const shown = shownOf(ctx);
        const minLabeled = wholeNumber(state.minLabeled, 10), manyLooks = wholeNumber(state.manyLooks, 3);
        const input = (key, label, value) => h("label", {}, `${label} `, h("input", { class: "input sm", type: "number", min: "0", step: "1", value: state[key] ?? String(value),
          "aria-label": label, "data-input": key, oninput: (event) => { state[key] = event.target.value; api.redraw(); } }));
        const controls = h("div", { class: "lab-row" }, input("minLabeled", "Flag under this many labeled held-out rows", 10), input("manyLooks", "Flag this many test looks or more", 3));
        if (Number.isNaN(minLabeled) || Number.isNaN(manyLooks)) {
          return h("div", {}, controls, h("p", { class: "warn", "data-threshold-error": "true" }, "Enter whole numbers, 0 or more."));
        }
        const rows = shown.filter((item) => item.test).map(splitRow).map((row) => ({ ...row, flags: splitFlags(row, minLabeled, manyLooks) }));
        const noSplit = shown.filter((item) => !item.test);
        const columns = ["Dataset", "Held out", "Held-out labeled", "Tuning", "Tuning labeled", "Held-out share of labeled", "Test looks", "Drawn", "Flags"];
        const cells = (row) => [row.id, row.held, row.heldLabeled, row.tuning, row.tuningLabeled, percent(row.share), row.looks, row.drawn, row.flags.join("; ")];
        const flagged = rows.filter((row) => row.flags.length).map((row) => row.id);
        return h("div", {}, controls,
          rows.length ? h("table", { class: "table lab-table", "data-table": "splits" }, head(h, columns),
            h("tbody", {}, rows.map((row) => h("tr", { "data-dataset": row.id, "data-flags": String(row.flags.length) },
              cells(row).map((value, index) => (index > 0 && index < 7 && index !== 5 ? numCell(h, value) : h("td", { class: index === 8 && row.flags.length ? "warn" : null }, String(value))))))))
            : h("p", { class: "faint" }, "No shown dataset has a held-out split."),
          rows.length ? h("button", { class: "btn sm ghost", "data-pin": "flagged", disabled: !flagged.length, onclick: () => pinFromPanel(ctx, api, flagged, "with a flagged split") },
            `Pin flagged (${flagged.length})`) : null,
          noSplit.length ? h("div", {}, h("p", {}, h("strong", {}, "Without a split")),
            h("ul", {}, noSplit.map((item) => h("li", { "data-no-split": item.id },
              `${item.id}: ${plural(count(item.labeled), "labeled row")}, ${SPLIT_MIN_LABELED - count(item.labeled) <= 0 ? "ready to hold out test rows"
                : `needs ${plural(SPLIT_MIN_LABELED - count(item.labeled), "more labeled row")} first`}`)))) : null,
          h("p", { class: "faint" }, "Counts of saved rows and recorded test looks only: they describe the split, not the quality of an evaluation."));
      } },

    { id: "checks", kind: "panel", title: "Saved checks overview",
      improvements: [
        { id: "table", title: "Table the shown datasets with a saved check: advisory notes, held-out rows, test looks, labeled tuning rows and last save" },
        { id: "copy", title: "Copy the saved checks table as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const shown = shownOf(ctx);
        if (!shown.length) return h("p", { class: "faint" }, "No dataset is shown.");
        const checked = shown.filter((item) => item.has_check);
        const columns = ["Dataset", "Name", "Advisory notes", "Held-out rows", "Test looks", "Labeled tuning rows", "Saved"];
        const cells = (item) => [item.id, oneLine(item.name), count(item.check_notes), item.test ? count(item.held_out) : "none",
          item.test ? count(item.test.looks) : "", count(item.tuning_labeled), dayOf(item.saved_at)];
        return h("div", {},
          checked.length ? h("table", { class: "table lab-table", "data-table": "checks" }, head(h, columns),
            h("tbody", {}, checked.map((item) => h("tr", { "data-dataset": item.id }, cells(item).map((value) => h("td", {}, String(value)))))))
            : h("p", { class: "faint" }, "No shown dataset has a saved check."),
          checked.length ? copyButton(h, api, "checks", tsv([columns, ...checked.map(cells)]), "Checks table") : null,
          h("p", { class: "faint" }, "Counts only: each check's configuration stays in its dataset file."));
      } },

    { id: "pair", kind: "panel", title: "Two datasets side by side",
      improvements: [
        { id: "table", title: "Choose two saved datasets and set their counts, split, check and last save side by side" },
        { id: "differences", title: "Mark the values that differ between the two datasets and count them" },
        { id: "questions", title: "List the question IDs each of the two datasets labels, those labeled in both first" },
      ],
      render: (h, ctx, api) => {
        const state = api.state;
        const all = itemsOf(ctx);
        if (all.length < 2) return h("p", { class: "faint" }, "Two saved datasets are needed to set them side by side.");
        const shown = shownOf(ctx);
        const defaults = [...shown, ...all.filter((item) => !shown.includes(item))];
        const byId = (id) => all.find((item) => item.id === id);
        const a = byId(state.a) || defaults[0];
        const b = byId(state.b) || defaults.find((item) => item !== a);
        const picker = (key, current) => h("select", { class: "input sm", "aria-label": `Dataset ${key.toUpperCase()}`, "data-pick": key,
          onchange: (event) => { state[key] = event.target.value; api.redraw(); } },
        all.map((item) => h("option", { value: item.id, selected: item.id === current.id }, item.id)));
        const rows = PAIR_ROWS.map(([label, read]) => ({ label, va: read(a), vb: read(b) })).map((row) => ({ ...row, differs: row.va !== row.vb }));
        const differ = rows.filter((row) => row.differs).length;
        const la = new Map(labelEntries(a).map((entry) => [entry.id, entry.labeled])), lb = new Map(labelEntries(b).map((entry) => [entry.id, entry.labeled]));
        const qids = [...[...la.keys()].filter((qid) => lb.has(qid)), ...[...la.keys()].filter((qid) => !lb.has(qid)), ...[...lb.keys()].filter((qid) => !la.has(qid))];
        const sharedCount = qids.filter((qid) => la.has(qid) && lb.has(qid)).length;
        return h("div", {},
          h("div", { class: "lab-row" }, h("label", {}, "A ", picker("a", a)), h("label", {}, "B ", picker("b", b))),
          a === b ? h("p", { class: "warn" }, "Pick two different datasets.") : null,
          h("table", { class: "table lab-table", "data-table": "pair" }, head(h, ["", a.id, b.id]),
            h("tbody", {}, rows.map((row) => h("tr", { "data-row": row.label, "data-differs": row.differs ? "true" : null, class: row.differs ? "warn" : null },
              h("th", {}, row.label), h("td", {}, String(row.va)), h("td", {}, String(row.vb)))))),
          h("p", { "data-differ-count": String(differ) }, `${differ} of ${rows.length} values differ.`),
          qids.length ? h("table", { class: "table lab-table", "data-table": "pair-questions" }, head(h, ["Question ID", `${a.id} labeled`, `${b.id} labeled`]),
            h("tbody", {}, qids.map((qid) => h("tr", { "data-question": qid }, h("td", {}, qid), numCell(h, la.get(qid) ?? ""), numCell(h, lb.get(qid) ?? "")))))
            : null,
          h("p", { "data-shared": String(sharedCount) }, sharedCount ? `${plural(sharedCount, "question ID")} labeled in both.` : "No question ID is labeled in both."));
      } },
  ],
});
