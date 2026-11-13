// A small pack with one feature of every kind, used by the Lab framework's own tests. Not a real pack: it is not
// under static/js/lab/packs, so no page loads it and it is not counted in the inventory.
import { csvText, definePack } from "../../../static/js/lab/kit.js";

export const fixtureItems = () => [
  { id: "a", text: "Refund the order", words: 3, tag: "billing", urgent: true },
  { id: "b", text: "Where is my parcel today", words: 5, tag: "shipping", urgent: false },
  { id: "c", text: "", words: null, tag: null, urgent: false },
  { id: "d", text: "Refund and cancel", words: 3, tag: "billing", urgent: false },
];

export default definePack({
  id: "fixture-pack",
  surface: "test.list",
  title: "Fixture pack",
  features: [
    { id: "words", kind: "fact", type: "number", label: "word count", unit: "words", value: (item) => item.words },
    { id: "urgent", kind: "fact", type: "flag", label: "urgent marker", value: (item) => item.urgent },
    { id: "text", kind: "fact", type: "text", label: "text", value: (item) => item.text },
    { id: "tag", kind: "fact", type: "category", label: "tag", value: (item) => item.tag },
    { id: "empty_text", kind: "diagnostic", severity: "problem", label: "Empty text", check: (item) => !item.text },
    { id: "one_tag", kind: "diagnostic", severity: "advice", scope: "list", label: "Only one tag in use",
      check: (items) => (new Set(items.map((item) => item.tag).filter(Boolean)).size === 1 ? "Every tagged item has the same tag." : null) },
    { id: "upper", kind: "transform", label: "Uppercase text", each: (item) => (item.text ? { ...item, text: item.text.toUpperCase() } : null) },
    { id: "keep_first", kind: "transform", label: "Keep the first items", params: [{ name: "count", label: "How many", type: "integer", min: 1, default: 2 }],
      all: (items, { count }) => items.slice(0, count) },
    { id: "urgent_share", kind: "metric", format: "percent", label: "Share of urgent items",
      compute: (ctx) => (ctx.shown().length ? ctx.shown().filter((item) => item.urgent).length / ctx.shown().length : null) },
    { id: "ids_csv", kind: "exporter", label: "Shown item IDs as CSV", help: "IDs only", filename: "ids.csv", mime: "text/csv",
      build: (ctx) => csvText([["id"], ...ctx.shown().map((item) => [item.id])]) },
    { id: "lines", kind: "importer", label: "One item per line",
      parse: (text) => {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) throw new Error("Paste at least one line.");
        return { items: lines.map((line, index) => ({ id: `new-${index + 1}`, text: line, words: line.split(/\s+/).length, tag: null, urgent: false })),
          warnings: lines.length > 3 ? ["More than three lines."] : [] };
      } },
    { id: "clear", kind: "command", title: "Clear the list", keys: "Alt+Shift+X", group: "Fixture", when: (ctx) => ctx.items().length > 0,
      run: (ctx) => ctx.actions.replaceItems([], { label: "Clear" }) },
    { id: "double", kind: "tool", group: "Arithmetic", title: "Double a number", help: "Multiplies a number by two.",
      inputs: [{ name: "x", label: "Number", type: "number", min: 0 }], compute: ({ x }) => [["Double", x * 2]] },
    { id: "counter", kind: "panel", title: "Counter", improvements: [{ id: "count", title: "Count clicks in a panel" }, { id: "reset", title: "Reset the panel count" }],
      render: (h, ctx, api) => h("div", {}, h("span", { class: "count" }, String(api.state.count || 0)),
        h("button", { class: "more", onclick: () => { api.state.count = (api.state.count || 0) + 1; api.redraw(); } }, "More"),
        h("button", { class: "reset", onclick: () => { api.state.count = 0; api.redraw(); } }, "Reset")) },
    { id: "skip_link", kind: "behavior", title: "Skip to content link", where: "static/js/common.js" },
  ],
});
