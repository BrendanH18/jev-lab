// Lab UI: the generic controls for what packs declare. Nodes are built only through the injected env
// ({ h, mount, toast, copy, download }), so the same code renders in a browser and in Node tests with a stand-in h.
// Every control here is local: it filters, sorts, computes or copies what is already on the page. Typing never
// re-renders the control being typed in; only the parts that depend on it are mounted again.
import { FACT_OPS, applyTransform, csvText, describeFilter, describePreview, factsTable, filterActive, formatValue, previewChanges,
  previewTransform, runDiagnostics, runExporter, runImporter, runMetrics, runTool, searchCommands, summarizeFact, toNumber,
  undoTransform } from "./kit.js";

const OP_LABELS = { min: "at least", max: "at most", with: "with", without: "without", contains: "contains", is: "is" };
const SEVERITY_LABELS = { problem: "Problem", advice: "Advice", info: "Note" };
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function attempt(s, action) {
  try { return action(); } catch (error) { s.env.toast?.(error.message, "error"); return undefined; }
}

async function attemptAsync(env, action) {
  try { await action(); } catch (error) { env.toast?.(error.message, "error"); }
}

// Options grouped under their pack's title.
function groupedOptions(h, entries, selected, labelOf = (feature) => feature.label || feature.title) {
  const groups = new Map();
  for (const [key, feature, pack] of entries) {
    if (!groups.has(pack.title)) groups.set(pack.title, []);
    groups.get(pack.title).push(h("option", { value: key, selected: key === selected }, labelOf(feature)));
  }
  return [...groups].map(([title, options]) => h("optgroup", { label: title }, options));
}

const lookup = (entries, key) => entries.find(([entryKey]) => entryKey === key) || null;
const shownOf = (s) => (s.ctx.shown ? s.ctx.shown() : s.ctx.items ? s.ctx.items() : []);
const itemsOf = (s) => (s.ctx.items ? s.ctx.items() : shownOf(s));
const nameOf = (s) => (item, index) => (s.ctx.itemName ? String(s.ctx.itemName(item, index)) : String(index + 1));

// A collapsible block whose content is built only while it is open.
function block(s, name, title, count, content) {
  const { h } = s.env;
  const open = !!s.view.open[name];
  return h("details", { class: "lab-block", open, "data-lab-block": name,
    ontoggle: (event) => {
      const now = !!event.target.open;
      if (!!s.view.open[name] === now) return;
      s.view.open[name] = now;
      if (now) s.redraw();
    } },
  h("summary", {}, `${title} · ${count}`), open ? h("div", { class: "lab-block-body" }, content()) : null);
}

// ---------- Refine: filters, sort, summary and the facts table ----------

function summaryNode(h, fact, summary) {
  if (summary.type === "number") {
    if (!summary.count) return h("p", { class: "faint" }, `${fact.label}: not available for the shown items.`);
    const parts = [["items", summary.count], ["minimum", summary.min], ["median", summary.median], ["mean", summary.mean], ["maximum", summary.max], ["sum", summary.sum]];
    return h("div", { class: "stat-row" }, parts.map(([label, value]) => h("span", { class: "stat" }, label, h("b", {}, formatValue(value)))),
      summary.missing ? h("span", { class: "stat" }, "unavailable", h("b", {}, String(summary.missing))) : null);
  }
  if (summary.type === "flag") {
    return h("div", { class: "stat-row" }, h("span", { class: "stat" }, "with", h("b", {}, String(summary.with))), h("span", { class: "stat" }, "without", h("b", {}, String(summary.without))));
  }
  if (summary.type === "text") {
    return h("div", { class: "stat-row" }, h("span", { class: "stat" }, "filled", h("b", {}, String(summary.filled))),
      h("span", { class: "stat" }, "empty", h("b", {}, String(summary.empty))), h("span", { class: "stat" }, "distinct", h("b", {}, String(summary.distinct))));
  }
  return h("table", { class: "table lab-table" },
    h("thead", {}, h("tr", {}, h("th", {}, fact.label), h("th", { class: "num" }, "Shown items"))),
    h("tbody", {}, summary.groups.map(([value, count]) => h("tr", {}, h("td", {}, value), h("td", { class: "num" }, String(count)))),
      summary.missing ? h("tr", {}, h("td", { class: "faint" }, "Not available"), h("td", { class: "num" }, String(summary.missing))) : null));
}

function refineBlock(s) {
  const facts = s.lab.entries(s.id, "fact");
  if (!facts.length) return null;
  return block(s, "refine", "Refine", facts.length, () => {
    const { h, mount } = s.env;
    const view = s.view;
    const byKey = s.surface.facts;
    const factSelect = h("select", { class: "input sm", "aria-label": "Fact to filter by",
      onchange: (event) => { view.draft = { key: event.target.value, op: "", value: "" }; fillDraft(); } });
    const draftBox = h("span", { class: "chips" });
    const chipsBox = h("div", { class: "chips", "data-lab": "filters" });
    const countBox = h("span", { class: "faint", role: "status", "data-lab": "count" });
    const summaryBox = h("div", { "data-lab": "summary" });

    const fillFacts = () => {
      const words = view.factQuery.trim().toLowerCase();
      const list = facts.filter(([, fact, pack]) => !words || `${fact.label} ${pack.title}`.toLowerCase().includes(words));
      mount(factSelect, h("option", { value: "" }, list.length ? `Choose a fact (${list.length})…` : "No fact matches"), groupedOptions(h, list, view.draft.key));
    };
    const fillCount = () => {
      const shown = shownOf(s).length, total = itemsOf(s).length, active = s.lab.active(s.id);
      mount(countBox, `${shown} of ${total} shown${active ? ` · ${plural(active, "Lab setting")} active` : ""}`);
    };
    const fillSummary = () => {
      const fact = byKey.get(view.summaryKey);
      mount(summaryBox, fact ? summaryNode(h, fact, summarizeFact(fact, shownOf(s), s.ctx)) : null);
    };
    const fillChips = () => {
      const active = view.filters.filter((filter) => byKey.has(filter.key) && filterActive(filter));
      mount(chipsBox, active.map((filter) => h("button", { class: "chip", title: "Remove this filter",
        "aria-label": `Remove filter: ${describeFilter(byKey.get(filter.key), filter)}`,
        onclick: () => { view.filters = view.filters.filter((entry) => entry !== filter); listChanged(); } }, describeFilter(byKey.get(filter.key), filter), " ×")),
      active.length || view.sort ? h("button", { class: "btn sm ghost", onclick: () => { s.lab.reset(s.id); listChanged(true); } }, "Clear Lab filters and sort") : null);
    };
    // The list itself changed: let the surface re-render, then refresh this block's dependent parts.
    function listChanged(rebuild = false) {
      s.ctx.refresh?.();
      if (rebuild) { view.findings = null; return s.redraw(); }
      s.listChanged();
    }
    s.onList.set("refine", () => { fillChips(); fillCount(); fillSummary(); });
    const addFilter = () => {
      const fact = byKey.get(view.draft.key);
      if (!fact) return s.env.toast?.("Choose a fact first.", "error");
      const op = FACT_OPS[fact.type].includes(view.draft.op) ? view.draft.op : FACT_OPS[fact.type][0];
      const filter = { key: view.draft.key, op, value: String(view.draft.value ?? "") };
      if (!filterActive(filter)) return s.env.toast?.("Type a value for the filter first.", "error");
      if ((op === "min" || op === "max") && toNumber(filter.value) === null) return s.env.toast?.(`${fact.label}: the bound must be a number.`, "error");
      view.filters = [...view.filters.filter((entry) => !(entry.key === filter.key && entry.op === filter.op)), filter];
      view.draft = { key: view.draft.key, op, value: "" };
      fillDraft();
      listChanged();
    };
    function fillDraft() {
      const fact = byKey.get(view.draft.key);
      if (!fact) return mount(draftBox);
      const ops = FACT_OPS[fact.type];
      const op = ops.includes(view.draft.op) ? view.draft.op : ops[0];
      const opSelect = ops.length > 1 ? h("select", { class: "input sm", "aria-label": "Comparison", onchange: (event) => { view.draft.op = event.target.value; } },
        ops.map((value) => h("option", { value, selected: value === op }, OP_LABELS[value]))) : h("span", { class: "faint" }, OP_LABELS[op]);
      let valueControl = null;
      if (fact.type === "number") {
        valueControl = h("input", { class: "input sm", type: "number", step: "any", "aria-label": `${fact.label} bound`, placeholder: fact.unit || "number", value: view.draft.value,
          oninput: (event) => { view.draft.value = event.target.value; }, onkeydown: (event) => { if (event.key === "Enter") addFilter(); } });
      } else if (fact.type === "text") {
        valueControl = h("input", { class: "input sm", type: "search", "aria-label": `Text contained in ${fact.label}`, placeholder: "text", value: view.draft.value,
          oninput: (event) => { view.draft.value = event.target.value; }, onkeydown: (event) => { if (event.key === "Enter") addFilter(); } });
      } else if (fact.type === "category") {
        const groups = summarizeFact(fact, itemsOf(s), s.ctx).groups;
        if (!view.draft.value && groups.length) view.draft.value = groups[0][0];
        valueControl = h("select", { class: "input sm", "aria-label": `${fact.label} value`, onchange: (event) => { view.draft.value = event.target.value; } },
          groups.length ? groups.map(([value, count]) => h("option", { value, selected: value === view.draft.value }, `${value} (${count})`)) : h("option", { value: "" }, "No values"));
      }
      mount(draftBox, opSelect, valueControl, h("button", { class: "btn sm", onclick: addFilter }, "Add filter"),
        fact.help ? h("span", { class: "faint" }, fact.help) : null);
    }
    const table = () => factsTable(facts.map(([key, fact]) => [key, fact]), shownOf(s), s.ctx, nameOf(s));

    fillFacts(); fillDraft(); fillChips(); fillCount(); fillSummary();
    return [
      h("p", { class: "faint" }, "Filter and sort this list by derived facts. Filters change what is shown, never the data. Unavailable values never satisfy a bound and sort last."),
      h("div", { class: "chips lab-row" },
        h("input", { class: "input sm", type: "search", "aria-label": "Search facts", placeholder: `Search ${plural(facts.length, "fact")}`, value: view.factQuery,
          oninput: (event) => { view.factQuery = event.target.value; fillFacts(); } }),
        factSelect, draftBox),
      chipsBox,
      h("div", { class: "chips lab-row" },
        h("label", { class: "faint" }, "Sort by ",
          h("select", { class: "input sm", "aria-label": "Sort by fact",
            onchange: (event) => { view.sort = event.target.value ? { key: event.target.value, dir: view.sort?.dir || view.sortDir } : null; listChanged(); } },
          h("option", { value: "" }, "Page order"), groupedOptions(h, facts, view.sort?.key))),
        h("select", { class: "input sm", "aria-label": "Sort direction",
          onchange: (event) => { view.sortDir = event.target.value; if (view.sort) { view.sort = { ...view.sort, dir: view.sortDir }; listChanged(); } } },
        [["asc", "Ascending"], ["desc", "Descending"]].map(([value, label]) => h("option", { value, selected: (view.sort?.dir || view.sortDir) === value }, label))),
        countBox),
      h("div", { class: "chips lab-row" },
        h("label", { class: "faint" }, "Summarize ",
          h("select", { class: "input sm", "aria-label": "Summarize a fact over the shown items", onchange: (event) => { view.summaryKey = event.target.value; fillSummary(); } },
            h("option", { value: "" }, "Nothing"), groupedOptions(h, facts, view.summaryKey))),
        h("button", { class: "btn sm ghost", onclick: () => attempt(s, () => s.env.copy?.(csvText([table().columns, ...table().rows]))) }, "Copy facts CSV"),
        h("button", { class: "btn sm ghost", onclick: () => attempt(s, () => s.env.download?.("lab-facts.csv", csvText([table().columns, ...table().rows]), "text/csv")) }, "Download facts CSV")),
      summaryBox,
    ];
  });
}

// ---------- Checks ----------

function checksBlock(s) {
  const checks = s.lab.entries(s.id, "diagnostic");
  if (!checks.length) return null;
  return block(s, "checks", "Checks", checks.length, () => {
    const { h, mount } = s.env;
    const view = s.view;
    const box = h("div", { "data-lab": "findings" });
    const text = () => (view.findings?.list || []).map((finding) => `${SEVERITY_LABELS[finding.severity]}\t${finding.where}\t${finding.label}\t${finding.message}`).join("\n");
    const fill = () => {
      const found = view.findings;
      if (!found) return mount(box, h("p", { class: "faint" }, "Not run yet."));
      mount(box, h("p", { role: "status" }, `${plural(found.list.length, "finding")} in ${plural(found.checked, "shown item")}. Run again after editing or filtering.`),
        found.list.length ? h("ul", { class: "lab-findings" }, found.list.map((finding) => h("li", { class: `lab-finding ${finding.severity}` },
          h("span", { class: `badge ${finding.severity === "problem" ? "critical" : finding.severity === "advice" ? "warning" : "info"}` }, SEVERITY_LABELS[finding.severity]),
          " ", h("b", {}, finding.where), " ", finding.message === finding.label ? finding.label : `${finding.label}: ${finding.message}`))) : null,
        found.list.length ? h("button", { class: "btn sm ghost", onclick: () => attempt(s, () => s.env.copy?.(text())) }, "Copy findings") : null);
    };
    const run = () => attempt(s, () => {
      const shown = shownOf(s), all = itemsOf(s), name = nameOf(s);
      const list = runDiagnostics(checks.map(([key, check]) => [key, check]), shown, s.ctx).map((finding) => ({ ...finding,
        where: finding.index === null ? "List" : `Item ${name(shown[finding.index], Math.max(0, all.indexOf(shown[finding.index])))}` }));
      const order = { problem: 0, advice: 1, info: 2 };
      list.sort((a, b) => order[a.severity] - order[b.severity]);
      view.findings = { list, checked: shown.length };
      fill();
    });
    s.onList.set("checks", fill);
    fill();
    return [h("p", { class: "faint" }, `${plural(checks.length, "advisory check")} run by plain code on the shown items. Findings are hints, not verdicts.`),
      h("div", { class: "chips lab-row" }, h("button", { class: "btn sm", onclick: run }, "Run checks on shown items")), box];
  });
}

// ---------- typed input controls (transform parameters and tools) ----------

function inputControl(h, input, values, onchange = () => {}) {
  const current = values[input.name] === undefined ? input.default : values[input.name];
  const set = (value) => { values[input.name] = value; onchange(); };
  if (input.type === "checkbox") {
    return h("label", { class: "lab-input" }, h("input", { type: "checkbox", checked: current === true, onchange: (event) => set(!!event.target.checked) }), " ", input.label);
  }
  let control;
  if (input.type === "select") {
    control = h("select", { class: "input sm", onchange: (event) => set(event.target.value) }, input.options.map((option) => {
      const [value, label] = Array.isArray(option) ? option : [option, option];
      return h("option", { value: String(value), selected: String(value) === String(current ?? "") }, String(label));
    }));
  } else if (input.type === "textarea") {
    control = h("textarea", { class: "input", rows: input.rows || 4, placeholder: input.placeholder || "", spellcheck: "false", oninput: (event) => set(event.target.value) }, String(current ?? ""));
  } else {
    const numeric = input.type === "number" || input.type === "integer";
    control = h("input", { class: "input sm", type: numeric ? "number" : "text", step: input.type === "integer" ? "1" : numeric ? (input.step || "any") : null,
      min: numeric ? input.min : null, max: numeric ? input.max : null, placeholder: input.placeholder || "", value: current ?? "", oninput: (event) => set(event.target.value) });
  }
  return h("label", { class: "lab-input" }, h("span", { class: "faint" }, input.label), control);
}

// ---------- Transforms ----------

function transformBlock(s) {
  const transforms = s.lab.entries(s.id, "transform");
  if (!transforms.length || !s.ctx.actions?.replaceItems) return null;
  return block(s, "transforms", "Edits", transforms.length, () => {
    const { h, mount } = s.env;
    const state = s.view.transform;
    const paramsBox = h("div", { class: "chips lab-row" });
    const statusBox = h("div", { "data-lab": "transform-status" });
    const current = () => lookup(transforms, state.key);
    const fillParams = () => {
      const entry = current();
      state.values[state.key] ||= {};
      mount(paramsBox, entry ? [(entry[1].params || []).map((input) => inputControl(h, input, state.values[state.key], () => { state.preview = null; fillStatus(); })),
        entry[1].help ? h("span", { class: "faint" }, entry[1].help) : null] : null);
    };
    function fillStatus() {
      const preview = state.preview;
      mount(statusBox,
        state.error ? h("p", { class: "lab-error", role: "alert" }, state.error) : null,
        preview ? h("div", { class: "callout", role: "status" }, h("div", {}, h("p", {}, describePreview(preview), " Nothing has changed yet."),
          h("div", { class: "chips" }, h("button", { class: "btn sm primary", disabled: !previewChanges(preview), onclick: apply }, "Apply previewed edit"),
            h("button", { class: "btn sm ghost", onclick: () => { state.preview = null; fillStatus(); } }, "Cancel preview")))) : null,
        state.undo ? h("button", { class: "btn sm ghost", onclick: undo }, `Undo: ${state.undo.label}`) : null);
    }
    const fail = (error) => { state.error = error.message; fillStatus(); };
    const makePreview = () => {
      const entry = current();
      state.error = "";
      if (!entry) return fail(new Error("Choose an edit first."));
      try {
        const all = itemsOf(s), shown = new Set(shownOf(s));
        const indexes = new Set(all.flatMap((item, index) => (shown.has(item) ? [index] : [])));
        state.preview = previewTransform(entry[0], entry[1], all, indexes, state.values[state.key] || {}, s.ctx);
        fillStatus();
      } catch (error) { state.preview = null; fail(error); }
    };
    function apply() {
      state.error = "";
      try {
        const result = applyTransform(state.preview, itemsOf(s));
        s.ctx.actions.replaceItems(result.items, { label: state.preview.label });
        state.undo = result.undo;
        state.preview = null;
        s.ctx.refresh?.();
        s.listChanged();
        fillStatus();
      } catch (error) { fail(error); }
    }
    function undo() {
      state.error = "";
      try {
        const before = undoTransform(state.undo, itemsOf(s));
        s.ctx.actions.replaceItems(before, { label: `Undo ${state.undo.label}` });
        state.undo = null;
        s.ctx.refresh?.();
        s.listChanged();
        fillStatus();
      } catch (error) { fail(error); }
    }
    fillParams(); fillStatus();
    return [h("p", { class: "faint" }, "Each edit is previewed first and applies only when you choose Apply. Per-item edits change the shown items; one Undo step is kept while nothing newer would be replaced."),
      h("div", { class: "chips lab-row" },
        h("select", { class: "input sm", "aria-label": "Edit to preview", onchange: (event) => { state.key = event.target.value; state.preview = null; state.error = ""; fillParams(); fillStatus(); } },
          h("option", { value: "" }, `Choose an edit (${transforms.length})…`), groupedOptions(h, transforms, state.key)),
        h("button", { class: "btn sm", onclick: makePreview }, "Preview edit")),
      paramsBox, statusBox];
  });
}

// ---------- Metrics ----------

function metricsBlock(s) {
  const metrics = s.lab.entries(s.id, "metric");
  if (!metrics.length) return null;
  return block(s, "metrics", "Metrics", metrics.length, () => {
    const { h, mount } = s.env;
    let rows = [];
    const tbody = h("tbody", {});
    // Recomputed whenever the list or its filters change, so the values and Copy always describe what is shown.
    const fill = () => {
      rows = runMetrics(metrics.map(([key, metric]) => [key, metric]), s.ctx);
      mount(tbody, rows.map((row) => h("tr", { "data-lab-metric": row.key }, h("td", {}, row.label), h("td", { class: "num" }, row.text),
        h("td", { class: "faint" }, [row.detail, row.help].filter(Boolean).join(" · ")))));
    };
    s.onList.set("metrics", fill);
    fill();
    return [h("p", { class: "faint" }, "Computed here from what this page already holds. Nothing is fetched and no model is called."),
      h("div", { class: "scroll" }, h("table", { class: "table lab-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Metric"), h("th", { class: "num" }, "Value"), h("th", {}, "Notes"))), tbody)),
      h("button", { class: "btn sm ghost", onclick: () => attempt(s, () => s.env.copy?.(rows.map((row) => `${row.label}\t${row.text}`).join("\n"))) }, "Copy metrics")];
  });
}

// ---------- Exports and imports ----------

function exportBlock(s) {
  const exporters = s.lab.entries(s.id, "exporter");
  if (!exporters.length) return null;
  return block(s, "exports", "Copy and download", exporters.length, () => {
    const { h } = s.env;
    return [h("p", { class: "faint" }, "Each entry says what it contains. Files are made in this browser."),
      h("ul", { class: "lab-list" }, exporters.map(([key, exporter]) => h("li", { "data-lab-export": key },
        h("span", {}, exporter.label, exporter.help ? h("span", { class: "faint" }, ` — ${exporter.help}`) : null),
        h("span", { class: "chips" },
          h("button", { class: "btn sm ghost", "aria-label": `Copy: ${exporter.label}`, onclick: () => attempt(s, () => s.env.copy?.(runExporter(exporter, s.ctx).text)) }, "Copy"),
          h("button", { class: "btn sm ghost", "aria-label": `Download: ${exporter.label}`, onclick: () => attempt(s, () => {
            const out = runExporter(exporter, s.ctx);
            s.env.download?.(out.filename, out.text, out.mime);
          }) }, "Download")))))];
  });
}

function importBlock(s) {
  const importers = s.lab.entries(s.id, "importer");
  if (!importers.length || !s.ctx.actions?.importItems) return null;
  return block(s, "imports", "Paste to import", importers.length, () => {
    const { h, mount } = s.env;
    const state = s.view.importer;
    const statusBox = h("div", { "data-lab": "import-status" });
    const fill = () => mount(statusBox,
      state.error ? h("p", { class: "lab-error", role: "alert" }, state.error) : null,
      state.preview ? h("div", { class: "callout", role: "status" }, h("div", {},
        h("p", {}, `${plural(state.preview.items.length, "item")} read. Nothing has been added yet.`),
        state.preview.warnings.length ? h("ul", {}, state.preview.warnings.map((warning) => h("li", { class: "faint" }, warning))) : null,
        h("div", { class: "chips" }, h("button", { class: "btn sm primary", disabled: !state.preview.items.length, onclick: add }, "Add previewed items"),
          h("button", { class: "btn sm ghost", onclick: () => { state.preview = null; fill(); } }, "Cancel preview")))) : null);
    const preview = () => {
      state.error = ""; state.preview = null;
      const entry = lookup(importers, state.key);
      try {
        if (!entry) throw new Error("Choose a format first.");
        state.preview = runImporter(entry[1], state.text, s.ctx);
      } catch (error) { state.error = error.message; }
      fill();
    };
    function add() {
      try {
        s.ctx.actions.importItems(state.preview.items, { label: lookup(importers, state.key)?.[1].label || "Import" });
        state.preview = null; state.text = ""; state.error = "";
        s.ctx.refresh?.();
        s.redraw();
      } catch (error) { state.error = error.message; fill(); }
    }
    fill();
    return [h("div", { class: "chips lab-row" },
      h("select", { class: "input sm", "aria-label": "Format to import", onchange: (event) => { state.key = event.target.value; state.preview = null; fill(); } },
        h("option", { value: "" }, `Choose a format (${importers.length})…`), groupedOptions(h, importers, state.key)),
      h("button", { class: "btn sm", onclick: preview }, "Preview import")),
    h("textarea", { class: "input", rows: 5, "aria-label": "Text to import", placeholder: "Paste text here", spellcheck: "false",
      oninput: (event) => { state.text = event.target.value; state.preview = null; } }, state.text),
    statusBox];
  });
}

// ---------- Commands ----------

function commandBlock(s) {
  const commands = s.lab.entries(s.id, "command");
  if (!commands.length) return null;
  return block(s, "commands", "Commands", commands.length, () => {
    const { h } = s.env;
    const shown = searchCommands(commands.map(([key, command]) => [key, command, s.ctx]));
    return [h("p", { class: "faint" }, "Also in the command palette (Ctrl or Cmd + K). Shortcuts without Ctrl, Cmd or Alt are ignored while typing."),
      h("div", { class: "chips" }, shown.map(([key, command]) => h("button", { class: "btn sm ghost", "data-lab-command": key,
        onclick: () => attemptAsync(s.env, () => command.run(s.ctx)) }, command.title, command.keys ? h("kbd", {}, command.keys) : null)))];
  });
}

// ---------- Tools ----------

function resultNode(h, result) {
  return [
    result.rows.length ? h("table", { class: "table lab-table" }, h("tbody", {}, result.rows.map(([label, value]) => h("tr", {}, h("th", {}, String(label)),
      h("td", { class: "num" }, typeof value === "number" ? formatValue(value) : String(value ?? "—")))))) : null,
    result.table ? h("div", { class: "scroll" }, h("table", { class: "table lab-table" },
      h("thead", {}, h("tr", {}, result.table.columns.map((column) => h("th", {}, String(column))))),
      h("tbody", {}, result.table.rows.map((row) => h("tr", {}, row.map((cell) => h("td", {}, typeof cell === "number" ? formatValue(cell) : String(cell ?? "")))))))) : null,
    result.text !== null ? h("pre", { class: "lab-pre" }, result.text) : null,
    result.note ? h("p", { class: "faint" }, result.note) : null,
  ];
}

export function resultText(result) {
  const lines = result.rows.map(([label, value]) => `${label}\t${typeof value === "number" ? formatValue(value) : String(value ?? "")}`);
  if (result.table) lines.push(result.table.columns.join("\t"), ...result.table.rows.map((row) => row.map((cell) => String(cell ?? "")).join("\t")));
  if (result.text !== null) lines.push(result.text);
  return lines.join("\n");
}

function toolsBlock(s) {
  const tools = s.lab.entries(s.id, "tool");
  if (!tools.length) return null;
  const content = () => {
    const { h, mount } = s.env;
    const state = s.view.tool;
    const listBox = h("div", { class: "lab-tool-list", role: "list" });
    const formBox = h("div", { class: "lab-tool-form" });
    const groups = [...new Set(tools.map(([, tool]) => tool.group))].sort();
    const matching = () => {
      const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return tools.filter(([, tool]) => (!state.group || tool.group === state.group)
        && words.every((word) => `${tool.title} ${tool.group} ${tool.help}`.toLowerCase().includes(word)));
    };
    const fillList = () => {
      const list = matching();
      mount(listBox, list.length ? list.map(([key, tool]) => h("button", { class: `chip${key === state.key ? " active" : ""}`, role: "listitem", title: tool.help,
        "aria-pressed": key === state.key ? "true" : "false", onclick: () => { state.key = key; state.result = null; state.error = ""; fillList(); fillForm(); } }, tool.title))
        : h("p", { class: "faint" }, "No tool matches."));
    };
    function fillForm() {
      const entry = lookup(tools, state.key);
      if (!entry) return mount(formBox, h("p", { class: "faint" }, `Choose one of ${plural(tools.length, "tool")}. Each computes locally from what you type.`));
      const [key, tool] = entry;
      state.values[key] ||= {};
      const resultBox = h("div", { "data-lab": "tool-result", role: "status" });
      const fillResult = () => mount(resultBox, state.error ? h("p", { class: "lab-error", role: "alert" }, state.error) : null,
        state.result ? [resultNode(h, state.result), h("button", { class: "btn sm ghost", onclick: () => attempt(s, () => s.env.copy?.(resultText(state.result))) }, "Copy result")] : null);
      const compute = () => {
        state.error = ""; state.result = null;
        try { state.result = runTool(tool, state.values[key]); } catch (error) { state.error = error.message; }
        fillResult();
      };
      fillResult();
      mount(formBox, h("h4", {}, tool.title), h("p", { class: "faint" }, tool.help),
        h("div", { class: "lab-inputs" }, tool.inputs.map((input) => inputControl(h, input, state.values[key]))),
        h("div", { class: "chips lab-row" }, h("button", { class: "btn sm primary", onclick: compute }, "Calculate"),
          h("button", { class: "btn sm ghost", onclick: () => { state.values[key] = {}; state.result = null; state.error = ""; fillForm(); } }, "Reset inputs")),
        resultBox);
    }
    fillList(); fillForm();
    return [h("div", { class: "chips lab-row" },
      h("input", { class: "input sm", type: "search", "aria-label": "Search tools", placeholder: `Search ${plural(tools.length, "tool")}`, value: state.query,
        oninput: (event) => { state.query = event.target.value; fillList(); } }),
      h("select", { class: "input sm", "aria-label": "Tool group", onchange: (event) => { state.group = event.target.value; fillList(); } },
        h("option", { value: "" }, "All groups"), groups.map((group) => h("option", { value: group, selected: group === state.group }, group)))),
    listBox, formBox];
  };
  return s.options.flat ? s.env.h("div", { class: "lab-block-body", "data-lab-block": "tools" }, content()) : block(s, "tools", "Tools", tools.length, content);
}

// ---------- Panels ----------

function panelBlocks(s) {
  return s.lab.entries(s.id, "panel").map(([key, panel]) => block(s, `panel:${key}`, panel.title, panel.improvements.length, () => {
    const state = (s.view.panels[key] ||= {});
    try {
      return s.env.h("div", { "data-lab-panel": key }, panel.render(s.env.h, s.ctx, { state, mount: s.env.mount, redraw: s.redraw, toast: s.env.toast, copy: s.env.copy, download: s.env.download }));
    } catch (error) {
      return s.env.h("p", { class: "lab-error", role: "alert" }, `This panel could not be shown: ${error.message}`);
    }
  }));
}

// ---------- the section ----------

// The Lab tools block for one surface. options: { title, flat } (flat renders the tools without the disclosure).
export function renderSection(env, lab, id, ctx, options = {}) {
  const surface = lab.surface(id);
  if (!surface) return null;
  const view = lab.view(id);
  const body = env.h("div", { class: "lab-body" });
  // onList: refreshers the open blocks register for the parts that depend on the shown list. listChanged() runs them
  // after a filter, sort or edit changes that list, without rebuilding the control being used.
  const s = { env, lab, id, ctx, view, surface, options, redraw: () => {}, onList: new Map() };
  s.listChanged = () => {
    view.findings = null;
    for (const refresh of [...s.onList.values()]) refresh();
  };
  s.redraw = () => (s.onList.clear(), env.mount(body, [refineBlock(s), checksBlock(s), transformBlock(s), metricsBlock(s), exportBlock(s), importBlock(s), commandBlock(s), toolsBlock(s),
    panelBlocks(s)].flat().filter(Boolean)));
  s.redraw();
  if (options.flat) return env.h("div", { class: "lab flat", "data-lab-surface": id }, body);
  const open = !!view.open.section;
  return env.h("details", { class: "lab", open, "data-lab-surface": id, ontoggle: (event) => { view.open.section = !!event.target.open; } },
    env.h("summary", {}, `${options.title || "Lab tools"} · ${lab.count(id)}`),
    env.h("p", { class: "faint" }, "Local tools from Lab packs. They never call the model and never save anything by themselves."), body);
}

// ---------- command palette ----------

// The palette's nodes: { node, input, state }. close() is called before a command runs and on Escape.
export function renderPalette(env, lab, close) {
  const { h, mount } = env;
  const state = { query: "", index: 0, results: [] };
  const list = h("div", { class: "lab-palette-list", role: "listbox", "aria-label": "Commands" });
  const run = (entry) => { close(); attemptAsync(env, () => entry[1].run(entry[2])); };
  const fill = () => {
    state.results = searchCommands(lab.commandEntries(), state.query).slice(0, 80);
    state.index = Math.max(0, Math.min(state.index, state.results.length - 1));
    mount(list, state.results.length ? state.results.map((entry, index) => h("button", { class: `lab-palette-item${index === state.index ? " active" : ""}`, role: "option",
      "aria-selected": index === state.index ? "true" : "false", "data-lab-command": entry[0], onclick: () => run(entry) },
    h("span", {}, entry[1].title), entry[1].group ? h("span", { class: "faint" }, entry[1].group) : null, entry[1].keys ? h("kbd", {}, entry[1].keys) : null))
      : h("div", { class: "empty" }, "No command matches."));
  };
  const input = h("input", { class: "input", type: "search", placeholder: "Type a command…", "aria-label": "Search commands", autocomplete: "off", spellcheck: "false",
    oninput: (event) => { state.query = event.target.value; state.index = 0; fill(); },
    onkeydown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault?.();
        const count = state.results.length;
        if (count) { state.index = (state.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count; fill(); }
      } else if (event.key === "Enter") {
        event.preventDefault?.();
        if (state.results[state.index]) run(state.results[state.index]);
      } else if (event.key === "Escape") close();
    } });
  fill();
  const node = h("div", { class: "modal-wrap lab-palette-wrap", onclick: (event) => { if (event.target === node) close(); } },
    h("div", { class: "panel lab-palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" }, input, list,
      h("p", { class: "faint lab-palette-hint" }, "Enter runs the highlighted command · arrow keys move · Esc closes")));
  return { node, input, state };
}
