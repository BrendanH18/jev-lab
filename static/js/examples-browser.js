// Examples are authored requests. Browsing never runs a model or changes the editor.
import { exampleCounts, matchesExampleRefinements, exampleRequestJson, exampleOutline, exampleTypeSummary, exampleMetadataCsv } from "./examples-refinements.js";

export const exampleBrowserDefaults = () => ({ query: "", type: "all", images: "all", expectations: "all", stateType: "all", sort: "saved", compact: false, searchScope: "all", searchMode: "phrase", exclude: "", minQuestions: "", maxQuestions: "", minCriteria: "", maxCriteria: "", minStateBytes: "", maxStateBytes: "", typeMix: "all", pinned: "all" });
const exampleBrowserView = { ...exampleBrowserDefaults(), expanded: new Set(), pins: new Set() };

export function exampleMetadata(example) {
  const questions = Object.values(example.questions || {});
  return { id: example.id, title: example.title, question_count: questions.length,
    types: [...new Set(questions.map((q) => q.type))].sort(),
    image_count: Object.keys(example.images || {}).length,
    expectation_count: Object.keys(example.expect || {}).length,
    state_type: Array.isArray(example.state) ? "array" : example.state !== null && typeof example.state === "object" ? "object" : "text" };
}

// lab: optional Lab hooks { matches(example) -> boolean, arrange(examples) -> examples } (static/js/lab/surfaces/
// workbench-shell.js). Lab's filter is one more test of "is this example shown"; Lab's sort applies after the page's.
export function visibleExamples(examples, view = {}, lab = null) {
  const shown = examples.filter((example) => {
    const meta = exampleMetadata(example);
    if (!matchesExampleRefinements(example, view)) return false;
    if (view.type && view.type !== "all" && !meta.types.includes(view.type)) return false;
    if (view.images === "with" && !meta.image_count || view.images === "without" && meta.image_count) return false;
    if (view.expectations === "with" && !meta.expectation_count || view.expectations === "without" && meta.expectation_count) return false;
    if (view.stateType && view.stateType !== "all" && meta.state_type !== view.stateType) return false;
    return !lab?.matches || lab.matches(example) !== false;
  });
  const byCount = (example) => exampleMetadata(example).question_count;
  if (view.sort === "title") shown.sort((a, b) => a.title.localeCompare(b.title));
  if (view.sort === "fewest") shown.sort((a, b) => byCount(a) - byCount(b));
  if (view.sort === "most") shown.sort((a, b) => byCount(b) - byCount(a));
  if (["state-smallest", "state-largest", "criteria-fewest", "criteria-most"].includes(view.sort)) {
    const field = view.sort.startsWith("state-") ? "stateBytes" : "criteria";
    const direction = ["state-largest", "criteria-most"].includes(view.sort) ? -1 : 1;
    shown.sort((a, b) => direction * (exampleCounts(a)[field] - exampleCounts(b)[field]));
  }
  return lab?.arrange ? lab.arrange(shown) : shown;
}

export function exampleMetadataJson(examples) {
  return JSON.stringify(examples.map(exampleMetadata), null, 2);
}

// The Lab surface of the gallery (contract: static/js/lab/surfaces/workbench-shell.js, shellExamplesCtx).
const EXAMPLES_LAB = "workbench.examples.gallery";

// lab: optional { host, env, loaded } — the page's Lab host (W.lab), its env (W.labEnv) and () => the example last
// opened into Build. Without it, or before the host has the gallery's builder, the gallery works exactly as before.
export function renderExamplesBrowser(h, examples, onOpen, lab = null) {
  const view = exampleBrowserView;
  // Update just the cards/count so typing and filter changes keep native focus.
  let cards, count, download, expand, collapse, root, tools, typeSummary, feedback;
  const host = lab?.host || null;
  const resetView = () => { Object.assign(view, exampleBrowserDefaults()); host?.reset?.(EXAMPLES_LAB); root.replaceWith(renderExamplesBrowser(h, examples, onOpen, lab)); };
  const labCtx = typeof host?.builders?.shellExamplesCtx === "function" ? host.builders.shellExamplesCtx({
    examples: () => examples, visible: (hooks) => visibleExamples(examples, view, hooks), view: () => view, pins: () => view.pins,
    expanded: () => view.expanded, loaded: () => lab.loaded?.() ?? null,
    matches: (item, ctx) => host.matches(EXAMPLES_LAB, item, ctx), arrange: (items, ctx) => host.arrange(EXAMPLES_LAB, items, ctx),
    open: (example) => onOpen(example),
    pin: (id) => { view.pins.add(id); refresh(); }, unpin: (id) => { view.pins.delete(id); refresh(); },
    expand: (id) => { view.expanded.add(id); refresh(); }, collapse: (id) => { view.expanded.delete(id); refresh(); },
    resetView, refresh: () => refresh(),
  }) : null;
  const transfer = async (text) => {
    try { await navigator.clipboard.writeText(text); feedback.textContent = "Copied."; }
    catch { feedback.textContent = "Clipboard unavailable. Use the download action instead."; }
  };
  const save = (text, filename, type = "application/json") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: filename }); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Pinned handoffs intentionally include hidden pins in the selected sort order.
  const pinned = () => visibleExamples(examples, { sort: view.sort }).filter((ex) => view.pins.has(ex.id));
  // Lab's items are positions in this gallery, so its shown list maps back to the authored examples.
  const shown = () => (labCtx ? labCtx.shown().map((item) => examples[item.position - 1]) : visibleExamples(examples, view));
  const refresh = () => {
    const visible = shown();
    const totals = visible.reduce((sum, ex) => sum + exampleMetadata(ex).question_count, 0);
    const active = labCtx ? host.active?.(EXAMPLES_LAB) || 0 : 0;
    count.textContent = `${visible.length} of ${examples.length} examples · ${totals} authored questions${active ? ` · ${active} Lab setting${active === 1 ? "" : "s"} active` : ""}`;
    cards.replaceChildren(...(visible.length ? visible.map(card) : [h("p", { class: "muted", role: "status" }, "No examples match. Reset the filters to see every starting point.")]));
    download.disabled = expand.disabled = collapse.disabled = !visible.length;
    if (typeSummary) typeSummary.textContent = exampleTypeSummary(visible);
    if (tools) tools.replaceChildren(
      h("button", { class: "btn sm", disabled: !visible.length, onclick: () => { visible.forEach((ex) => view.pins.add(ex.id)); refresh(); } }, "Pin shown examples"),
      h("button", { class: "btn sm", disabled: !visible.length, onclick: () => { visible.forEach((ex) => view.pins.delete(ex.id)); refresh(); } }, "Unpin shown examples"),
      h("button", { class: "btn sm", disabled: !visible.length, onclick: () => transfer(visible.map((ex) => ex.id).join("\n")) }, "Copy shown example IDs"),
      h("button", { class: "btn sm", disabled: !pinned().length, onclick: () => transfer(pinned().map((ex) => ex.id).join("\n")) }, "Copy pinned example IDs"),
      h("button", { class: "btn sm", disabled: !pinned().length, onclick: () => save(exampleMetadataJson(pinned()), "pinned-example-metadata.json") }, "Download pinned example metadata"),
      h("button", { class: "btn sm", disabled: !visible.length, onclick: () => save(exampleMetadataCsv(visible.map(exampleMetadata)), "example-metadata.csv", "text/csv;charset=utf-8") }, "Download shown example CSV"));
  };
  const select = (label, key, options) => h("label", { class: "faint" }, label, " ",
    h("select", { class: "input sm", "aria-label": label, value: view[key], onchange: (event) => { view[key] = event.target.value; refresh(); } },
      options.map(([value, text]) => h("option", { value, selected: view[key] === value }, text))));
  const controls = h("div", { class: "grid", style: { gap: "10px" } },
    h("input", { class: "input", type: "search", value: view.query, placeholder: "Search examples in the selected scope", "aria-label": "Search examples",
      oninput: (event) => { view.query = event.target.value; refresh(); } }),
    h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } },
      select("Example question type", "type", [["all", "Any type"], ["choice", "Choice"], ["noul", "Yes / no"], ["score", "Score"], ["box", "Box"]]),
      select("Example pictures", "images", [["all", "Any pictures"], ["with", "With pictures"], ["without", "Without pictures"]]),
      select("Example expectations", "expectations", [["all", "Any expectations"], ["with", "With expectations"], ["without", "Without expectations"]]),
      select("Example input shape", "stateType", [["all", "Any input shape"], ["text", "Plain text"], ["object", "JSON object"], ["array", "JSON array"]]),
      select("Sort examples", "sort", [["saved", "Gallery order"], ["title", "Title A–Z"], ["fewest", "Fewest questions"], ["most", "Most questions"], ["state-smallest", "Smallest authored state"], ["state-largest", "Largest authored state"], ["criteria-fewest", "Fewest authored criteria"], ["criteria-most", "Most authored criteria"]]),
      h("label", { class: "faint" }, h("input", { type: "checkbox", checked: view.compact, onchange: (event) => { view.compact = event.target.checked; refresh(); } }), " Compact example cards"),
      h("button", { class: "btn sm ghost", onclick: resetView }, "Reset example view")));
  const bound = (label, key) => h("label", { class: "faint" }, label, " ",
    h("input", { class: "input sm", type: "number", min: "0", step: "1", value: view[key], "aria-label": label,
      oninput: (event) => { view[key] = event.target.value; refresh(); } }));
  const advanced = h("details", {}, h("summary", {}, "Advanced example discovery"),
    h("div", { class: "grid", style: { gap: "10px" } },
      select("Example search scope", "searchScope", [["all", "All authored descriptions"], ["title", "Title"], ["id", "Example ID"], ["pattern", "Pattern, summary and code note"], ["questions", "Question IDs"], ["instructions", "Instructions"]]),
      select("Example search mode", "searchMode", [["phrase", "Exact phrase"], ["all", "Every word"], ["any", "Any word"]]),
      h("input", { class: "input", type: "search", value: view.exclude, "aria-label": "Exclude example text", placeholder: "Exclude phrase in selected scope", oninput: (event) => { view.exclude = event.target.value; refresh(); } }),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } }, bound("Minimum example questions", "minQuestions"), bound("Maximum example questions", "maxQuestions"),
        bound("Minimum example criteria", "minCriteria"), bound("Maximum example criteria", "maxCriteria"),
        bound("Minimum authored state bytes", "minStateBytes"), bound("Maximum authored state bytes", "maxStateBytes")),
      select("Example type mix", "typeMix", [["all", "Any type mix"], ["mixed", "Multiple question types"], ["single", "One question type"]]),
      select("Example pins", "pinned", [["all", "All examples"], ["with", "Pinned only"], ["without", "Unpinned only"]]),
      h("p", { class: "faint" }, "Byte counts describe authored UTF-8 state only, not spend. Pins last for this page session.")));
  const card = (example) => {
    const meta = exampleMetadata(example);
    const details = h("details", { open: view.expanded.has(example.id), ontoggle: (event) => {
      if (!event.target.isConnected) return;
      if (event.target.open) view.expanded.add(example.id); else view.expanded.delete(example.id);
    } }, h("summary", {}, "Preview authored request"),
    h("p", { class: "faint" }, "Authored inputs and questions only. Open in Build to edit or make a live call."),
    h("pre", { style: { maxHeight: "300px", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "12px" } },
      exampleRequestJson(example)));
    const outline = h("details", {}, h("summary", {}, "Question outline"),
      h("ol", {}, exampleOutline(example).map((q) => h("li", {}, `${q.id} · ${q.type} · ${q.criteria} criteria`))));
    return h("div", { class: "panel ex", "data-example-id": example.id },
      h("div", { class: "pat" }, example.pattern), h("h3", {}, example.title),
      !view.compact ? h("p", {}, example.blurb) : null,
      !view.compact ? h("div", { class: "codenote" }, h("b", {}, "In code: "), example.code) : null,
      h("p", { class: "faint" }, `${meta.question_count} questions · ${meta.types.join(", ")} · ${meta.image_count} pictures · ${meta.expectation_count} expectations · ${meta.state_type} input`),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } },
        h("button", { class: "btn sm primary", onclick: () => onOpen(example) }, "Open in Build"),
        h("button", { class: "btn sm ghost", "aria-pressed": String(view.pins.has(example.id)), onclick: () => { if (view.pins.has(example.id)) view.pins.delete(example.id); else view.pins.add(example.id); refresh(); } }, view.pins.has(example.id) ? "Unpin example" : "Pin example"),
        h("button", { class: "btn sm", onclick: () => transfer(exampleRequestJson(example)) }, "Copy authored request"),
        h("button", { class: "btn sm", onclick: () => save(exampleRequestJson(example), "example-request.json") }, "Download authored request")), outline, details);
  };
  cards = h("div", { class: "gallery", id: "example-cards" });
  count = h("p", { class: "faint", role: "status", "aria-live": "polite" });
  download = h("button", { class: "btn sm", onclick: () => {
    const url = URL.createObjectURL(new Blob([exampleMetadataJson(shown())], { type: "application/json" }));
    const a = h("a", { href: url, download: "example-metadata.json" }); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } }, "Download shown example metadata");
  expand = h("button", { class: "btn sm", onclick: () => { shown().forEach((example) => view.expanded.add(example.id)); refresh(); } }, "Expand shown previews");
  collapse = h("button", { class: "btn sm", onclick: () => { shown().forEach((example) => view.expanded.delete(example.id)); refresh(); } }, "Collapse shown previews");
  tools = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } });
  typeSummary = h("p", { class: "faint", "aria-live": "polite" });
  feedback = h("p", { class: "faint", role: "status" });
  refresh();
  const labSection = labCtx ? host.section(lab.env, EXAMPLES_LAB, labCtx) : null;
  root = h("div", { class: "grid", id: "examples-browser", style: { gap: "16px" } },
    h("p", { class: "muted" }, "Starting points for ordinary software. Browse the authored requests, then open one in Build to edit and run it. Browsing makes no model calls."),
    controls, advanced, labSection, count, typeSummary, tools, feedback,
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, expand, collapse, download), cards);
  return root;
}
