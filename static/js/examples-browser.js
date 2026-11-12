// Examples are authored requests. Browsing never runs a model or changes the editor.

export const exampleBrowserDefaults = () => ({ query: "", type: "all", images: "all", expectations: "all", stateType: "all", sort: "saved", compact: false });
const exampleBrowserView = { ...exampleBrowserDefaults(), expanded: new Set() };

export function exampleMetadata(example) {
  const questions = Object.values(example.questions || {});
  return { id: example.id, title: example.title, question_count: questions.length,
    types: [...new Set(questions.map((q) => q.type))].sort(),
    image_count: Object.keys(example.images || {}).length,
    expectation_count: Object.keys(example.expect || {}).length,
    state_type: Array.isArray(example.state) ? "array" : example.state !== null && typeof example.state === "object" ? "object" : "text" };
}

export function visibleExamples(examples, view = {}) {
  const query = String(view.query || "").trim().toLowerCase();
  const shown = examples.filter((example) => {
    const meta = exampleMetadata(example);
    const text = [example.id, example.title, example.pattern, example.blurb, example.code,
      ...Object.keys(example.questions || {})].join(" ").toLowerCase();
    if (query && !text.includes(query)) return false;
    if (view.type && view.type !== "all" && !meta.types.includes(view.type)) return false;
    if (view.images === "with" && !meta.image_count || view.images === "without" && meta.image_count) return false;
    if (view.expectations === "with" && !meta.expectation_count || view.expectations === "without" && meta.expectation_count) return false;
    return !view.stateType || view.stateType === "all" || meta.state_type === view.stateType;
  });
  const byCount = (example) => exampleMetadata(example).question_count;
  if (view.sort === "title") shown.sort((a, b) => a.title.localeCompare(b.title));
  if (view.sort === "fewest") shown.sort((a, b) => byCount(a) - byCount(b));
  if (view.sort === "most") shown.sort((a, b) => byCount(b) - byCount(a));
  return shown;
}

export function exampleMetadataJson(examples) {
  return JSON.stringify(examples.map(exampleMetadata), null, 2);
}

export function renderExamplesBrowser(h, examples, onOpen) {
  const view = exampleBrowserView;
  // Update just the cards/count so typing and filter changes keep native focus.
  let cards, count, download, expand, collapse, root;
  const shown = () => visibleExamples(examples, view);
  const refresh = () => {
    const visible = shown();
    const totals = visible.reduce((sum, ex) => sum + exampleMetadata(ex).question_count, 0);
    count.textContent = `${visible.length} of ${examples.length} examples · ${totals} authored questions`;
    cards.replaceChildren(...(visible.length ? visible.map(card) : [h("p", { class: "muted", role: "status" }, "No examples match. Reset the filters to see every starting point.")]));
    download.disabled = expand.disabled = collapse.disabled = !visible.length;
  };
  const select = (label, key, options) => h("label", { class: "faint" }, label, " ",
    h("select", { class: "input sm", "aria-label": label, value: view[key], onchange: (event) => { view[key] = event.target.value; refresh(); } },
      options.map(([value, text]) => h("option", { value, selected: view[key] === value }, text))));
  const controls = h("div", { class: "grid", style: { gap: "10px" } },
    h("input", { class: "input", type: "search", value: view.query, placeholder: "Search example titles, patterns, code and question IDs", "aria-label": "Search examples",
      oninput: (event) => { view.query = event.target.value; refresh(); } }),
    h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } },
      select("Example question type", "type", [["all", "Any type"], ["choice", "Choice"], ["noul", "Yes / no"], ["score", "Score"], ["box", "Box"]]),
      select("Example pictures", "images", [["all", "Any pictures"], ["with", "With pictures"], ["without", "Without pictures"]]),
      select("Example expectations", "expectations", [["all", "Any expectations"], ["with", "With expectations"], ["without", "Without expectations"]]),
      select("Example input shape", "stateType", [["all", "Any input shape"], ["text", "Plain text"], ["object", "JSON object"], ["array", "JSON array"]]),
      select("Sort examples", "sort", [["saved", "Gallery order"], ["title", "Title A–Z"], ["fewest", "Fewest questions"], ["most", "Most questions"]]),
      h("label", { class: "faint" }, h("input", { type: "checkbox", checked: view.compact, onchange: (event) => { view.compact = event.target.checked; refresh(); } }), " Compact example cards"),
      h("button", { class: "btn sm ghost", onclick: () => { Object.assign(view, exampleBrowserDefaults()); root.replaceWith(renderExamplesBrowser(h, examples, onOpen)); } }, "Reset example view")));
  const card = (example) => {
    const meta = exampleMetadata(example);
    const details = h("details", { open: view.expanded.has(example.id), ontoggle: (event) => {
      if (!event.target.isConnected) return;
      if (event.target.open) view.expanded.add(example.id); else view.expanded.delete(example.id);
    } }, h("summary", {}, "Preview authored request"),
    h("p", { class: "faint" }, "Authored inputs and questions only. Open in Build to edit or make a live call."),
    h("pre", { style: { maxHeight: "300px", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "12px" } },
      JSON.stringify({ state: example.state, questions: example.questions, ...(Object.keys(example.images || {}).length ? { images: example.images } : {}) }, null, 2)));
    return h("div", { class: "panel ex", "data-example-id": example.id },
      h("div", { class: "pat" }, example.pattern), h("h3", {}, example.title),
      !view.compact ? h("p", {}, example.blurb) : null,
      !view.compact ? h("div", { class: "codenote" }, h("b", {}, "In code: "), example.code) : null,
      h("p", { class: "faint" }, `${meta.question_count} questions · ${meta.types.join(", ")} · ${meta.image_count} pictures · ${meta.expectation_count} expectations · ${meta.state_type} input`),
      h("button", { class: "btn sm primary", onclick: () => onOpen(example) }, "Open in Build"), details);
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
  refresh();
  root = h("div", { class: "grid", id: "examples-browser", style: { gap: "16px" } },
    h("p", { class: "muted" }, "Starting points for ordinary software. Browse the authored requests, then open one in Build to edit and run it. Browsing makes no model calls."),
    controls, count,
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, expand, collapse, download), cards);
  return root;
}
