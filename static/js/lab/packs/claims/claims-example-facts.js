// Facts, checks, metrics, exports and commands for the Claims example chips (surface "claims.examples"). An example's
// expectation is what a person wrote by hand; it is compared only with checks the user ran in this page session.
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const orderOf = (item, ctx) => (Array.isArray(ctx?.data?.orders) ? ctx.data.orders.find((order) => order.id === item?.order) || null : null);
const shownOf = (ctx) => (ctx.shown ? ctx.shown() : ctx.items());
const historyOf = (ctx) => (Array.isArray(ctx?.data?.history) ? ctx.data.history : []);
// Whether a check of this session used exactly this example's inputs: its order, its note (trimmed, as the server
// trims it) and its sample photo. The same identity the surface uses for item.checked, so two examples that share a
// label are never confused.
const usedBy = (entry, item) => !!entry && !!item && entry.order === item.order && typeof entry.note === "string" && typeof item.note === "string"
  && entry.note.trim() === item.note.trim() && entry.photo?.source === "sample" && entry.photo.name === item.sample;
// The latest check of this session made with this example's inputs, or null.
const latestCheck = (item, ctx) => [...historyOf(ctx)].reverse().find((entry) => usedBy(entry, item)) || null;
const knownSample = (item, ctx) => Array.isArray(ctx?.data?.samples) && ctx.data.samples.some((sample) => sample?.name === item?.sample);

function step(ctx, direction) {
  const shown = shownOf(ctx);
  if (!shown.length) throw new Error("No example is shown.");
  const at = shown.findIndex((item) => item.loaded);
  const next = at < 0 ? shown[0] : shown[(at + direction + shown.length) % shown.length];
  return ctx.actions.use(next.index);
}

export default definePack({
  id: "claims-example-facts",
  surface: "claims.examples",
  title: "Example facts",
  about: "Filters, checks, exports and commands for the Claims example chips: note length, the sample and the order behind each example, and how this session's own checks compare with the hand-written expectations. Exports hold the examples' inputs and written expectations (and, where they say so, your own checks' decisions), never answers.",
  features: [
    { id: "label", kind: "fact", type: "text", label: "example name", value: (item) => item.label },
    { id: "order", kind: "fact", type: "category", label: "order", value: (item) => item.order || null },
    { id: "sample", kind: "fact", type: "category", label: "sample picture", value: (item) => item.sample || null },
    { id: "sample_about", kind: "fact", type: "text", label: "sample picture description", help: "The setup's description of the example's sample picture; empty when the sample is unknown.",
      value: (item) => item.sample_about },
    { id: "expectation", kind: "fact", type: "category", label: "written expectation", help: "What a person decided by hand, not Jev's answer.",
      value: (item) => item.expect || null },
    { id: "chars", kind: "fact", type: "number", label: "note length in characters", value: (item) => num(item.chars) },
    { id: "words", kind: "fact", type: "number", label: "note words", value: (item) => num(item.words) },
    { id: "loaded", kind: "fact", type: "flag", label: "loaded in the form", value: (item) => item.loaded === true },
    { id: "checks", kind: "fact", type: "number", label: "checks this session", value: (item) => num(item.checked) },
    { id: "order_total", kind: "fact", type: "number", label: "order total", unit: "USD", value: (item, ctx) => num(orderOf(item, ctx)?.total) },
    { id: "order_open", kind: "fact", type: "flag", label: "an order open to a claim (delivered, not refunded)",
      value: (item, ctx) => { const order = orderOf(item, ctx); return !!order && order.delivered === true && order.refunded !== true; } },

    { id: "expectation_differs", kind: "diagnostic", label: "Your latest check differs from the written expectation", severity: "advice",
      check: (item, ctx) => {
        const entry = latestCheck(item, ctx), decided = entry?.decided?.decision;
        return item.expect && decided && decided !== item.expect
          ? `check ${entry.call} of this session decided ${decided} when sent; the written expectation is ${item.expect}.` : null;
      } },
    { id: "unknown_sample", kind: "diagnostic", label: "Its sample picture is not in the setup", severity: "problem",
      check: (item, ctx) => (Array.isArray(ctx?.data?.samples) && ctx.data.samples.length && !knownSample(item, ctx)
        ? `${item.sample ? `sample ${item.sample} is not among the setup's sample pictures` : "the example names no sample picture"}: loading it picks no photo.` : null) },
    { id: "blank_note", kind: "diagnostic", label: "Blank customer note", severity: "advice",
      check: (item) => (typeof item?.note === "string" && item.note.trim() === ""
        ? "the note is blank, so the matches_note question would compare the photo with no description." : null) },
    { id: "order_missing", kind: "diagnostic", label: "Its order is not in the picker", severity: "problem",
      check: (item, ctx) => (Array.isArray(ctx?.data?.orders) && ctx.data.orders.length && !orderOf(item, ctx) ? `order ${item.order || "(none)"} is not among the loaded orders.` : null) },

    { id: "examples_checked", kind: "metric", label: "shown examples checked this session", format: "integer",
      compute: (ctx) => (historyOf(ctx).length && shownOf(ctx).length ? shownOf(ctx).filter((item) => item.checked > 0).length : null) },
    { id: "expectation_agreement", kind: "metric", label: "example checks matching the written expectation", format: "percent",
      help: "This session's checks made with an example's exact inputs, each as decided when sent, against that example's written expectation.",
      compute: (ctx) => {
        const examples = ctx.items().filter((item) => item?.expect);
        const pairs = historyOf(ctx).flatMap((entry) => {
          const example = examples.find((item) => usedBy(entry, item));
          return example && entry.decided?.decision ? [[entry, example]] : [];
        });
        if (!pairs.length) return null;
        const agree = pairs.filter(([entry, example]) => entry.decided.decision === example.expect).length;
        return { value: agree / pairs.length, detail: `${agree} of ${pairs.length}` };
      } },

    { id: "examples_csv", kind: "exporter", label: "Shown examples as CSV", help: "inputs and written expectations; no answers",
      filename: "claims-examples.csv", mime: "text/csv",
      build: (ctx) => csvText([["label", "order", "sample", "note", "written_expectation"],
        ...shownOf(ctx).map((item) => [item.label, item.order, item.sample, item.note, item.expect || ""])]) },
    { id: "expectations_markdown", kind: "exporter", label: "Written expectations next to your latest checks", help: "decisions of this session's checks, as made when sent",
      filename: "claims-expectations.md", mime: "text/markdown",
      build: (ctx) => `${formatMarkdownTable(["example", "written expectation", "your latest check (decision when sent)"], shownOf(ctx).map((item) => {
        const entry = latestCheck(item, ctx);
        return [item.label, item.expect || "none", entry?.decided?.decision ? `${entry.decided.decision} (check ${entry.call})` : "not checked this session"];
      }))}\n` },

    { id: "next_example", kind: "command", title: "Load the next shown example", group: "Claims examples",
      when: (ctx) => !ctx.data?.running && shownOf(ctx).length > 0, run: (ctx) => step(ctx, 1) },
    { id: "previous_example", kind: "command", title: "Load the previous shown example", group: "Claims examples",
      when: (ctx) => !ctx.data?.running && shownOf(ctx).length > 0, run: (ctx) => step(ctx, -1) },
    { id: "first_unchecked", kind: "command", title: "Load the first shown example not checked this session", group: "Claims examples",
      when: (ctx) => !ctx.data?.running && shownOf(ctx).some((item) => !item.checked),
      run: (ctx) => {
        const target = shownOf(ctx).find((item) => !item.checked);
        if (!target) throw new Error("Every shown example was checked this session.");
        return ctx.actions.use(target.index);
      } },
    { id: "focus_run", kind: "command", title: "Focus the Check claim button", group: "Claims examples",
      when: (ctx) => !ctx.data?.running, run: (ctx) => ctx.actions.focusRun() },
  ],
});
