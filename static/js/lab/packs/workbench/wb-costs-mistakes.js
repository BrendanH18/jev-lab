// Starter pack for the priced mistakes in Costs (surface "workbench.costs"; contract in
// static/js/lab/surfaces/workbench-analysis.js). Prices are the user's own session configuration: these tools filter,
// check, edit (preview, Apply, Undo through the page's own edit path), import and export them locally. No model call,
// no storage, nothing kept after the page session.
import { csvText, definePack, toNumber } from "../../kit.js";
import { parseDelimited } from "../../lib/tables.js";

const MAX_PRICE = 1e6;
const price = (item) => {
  const value = toNumber(item?.cost);
  return value !== null && value >= 0 && value <= MAX_PRICE ? value : null;
};
const defaultError = (ctx) => toNumber(ctx?.data?.error);
const reviewPrice = (ctx) => toNumber(ctx?.data?.review);
const keyOf = (item) => JSON.stringify([item.question, item.label, item.answer]);
const cents = (value) => String(Math.round(value * 100) / 100);
const money = (value) => `$${value.toFixed(2)}`;
// csvCell puts an apostrophe before text a spreadsheet would run as a formula; the import takes it off again.
const unescapeCell = (text) => text.replace(/^'(?=\s*[=+@-]|[\t\r\n])/, "");

export default definePack({
  id: "wb-costs-mistakes",
  surface: "workbench.costs",
  title: "Priced mistakes",
  about: "Filters, checks, edits, a CSV import and export, a default-price command and metrics for the specific mistakes you price in Costs. Everything is your own price configuration for this session: no answers, no rows, nothing saved.",
  features: [
    { id: "price", kind: "fact", type: "number", label: "price", unit: "$", help: "The price as typed; unavailable when it is not a number from 0 to 1,000,000.", value: price },
    { id: "below_default", kind: "fact", type: "flag", label: "a price below the default mistake price",
      value: (item, ctx) => price(item) !== null && defaultError(ctx) !== null && price(item) < defaultError(ctx) },
    { id: "invalid_price", kind: "fact", type: "flag", label: "a price the page cannot use", help: "Not a number from 0 to 1,000,000: every cost waits until it is fixed.",
      value: (item) => price(item) === null },
    { id: "question", kind: "fact", type: "category", label: "question", value: (item) => (item.question ? String(item.question) : null) },
    { id: "question_type", kind: "fact", type: "category", label: "question type",
      value: (item, ctx) => (Array.isArray(ctx?.data?.questions) ? ctx.data.questions.find((q) => q.qid === item.question)?.type || null : null) },
    { id: "mistake", kind: "fact", type: "text", label: "mistake", help: "question: label → answer",
      value: (item) => (item.question ? `${item.question}: ${item.label} → ${item.answer}` : "") },

    { id: "cheaper_than_review", kind: "diagnostic", severity: "advice", label: "Mistake cheaper than a review",
      check: (item, ctx) => {
        const p = price(item), review = reviewPrice(ctx);
        return p !== null && review !== null && p < review
          ? `it costs ${money(p)}, less than one ${money(review)} review, so a gate would rather automate rows that may make it` : null;
      } },
    { id: "not_a_mistake", kind: "diagnostic", severity: "problem", label: "Label and answer match",
      check: (item) => (item.label === item.answer ? `labeled ${item.label} and answered ${item.label} is not a mistake; the page refuses every price until it is changed` : null) },
    { id: "priced_twice", kind: "diagnostic", severity: "problem", scope: "list", label: "Same mistake priced twice",
      check: (items) => {
        const seen = new Map();
        const twice = [];
        items.forEach((item, i) => {
          const key = keyOf(item);
          if (seen.has(key)) twice.push(`${item.question}: ${item.label} → ${item.answer} is priced at positions ${seen.get(key) + 1} and ${i + 1} of the shown list`);
          else seen.set(key, i);
        });
        return twice;
      } },

    { id: "dedupe", kind: "transform", label: "Remove repeated mistakes, keeping the first price",
      all: (items) => items.filter((item, i) => items.findIndex((other) => keyOf(other) === keyOf(item)) === i) },
    { id: "scale", kind: "transform", label: "Multiply the shown prices", help: "Prices are rounded to cents; prices that are not numbers stay as they are.",
      params: [{ name: "factor", label: "Multiply by", type: "number", min: 0, default: 2 }],
      each: (item, { factor }) => {
        if (price(item) === null) return null;
        const value = Math.round(price(item) * factor * 100) / 100;
        if (value > MAX_PRICE) throw new Error(`${item.question}: ${item.label} → ${item.answer} would cost more than $1,000,000.`);
        return { ...item, cost: String(value) };
      } },
    { id: "sort_by_price", kind: "transform", label: "Order by price, highest first", help: "Prices that are not numbers go last.",
      all: (items) => items.map((item, i) => ({ item, i, p: price(item) }))
        .sort((a, b) => (a.p === null) - (b.p === null) || (b.p ?? 0) - (a.p ?? 0) || a.i - b.i).map((entry) => entry.item) },
    { id: "drop_not_mistakes", kind: "transform", label: "Remove entries whose label and answer match",
      all: (items) => items.filter((item) => item.label !== item.answer) },
    { id: "remove_shown", kind: "transform", label: "Remove the shown mistakes", help: "Mistakes a Lab filter hides stay priced.",
      all: (items, _params, _ctx, shown) => items.filter((_, i) => !shown.has(i)) },

    { id: "csv", kind: "importer", label: "CSV: question, label, answer, price",
      help: "One mistake per line; a header line naming question is skipped. A line on a question this run did not answer, an option the question lacks, the same label and answer, or a price that is not a number from 0 to 1,000,000 is left out with a warning.",
      parse: (text, ctx) => {
        const rows = (parseDelimited(text) || []).filter((row) => row.some((cell) => cell.trim() !== ""));
        if (!rows.length) throw new Error("Paste at least one line: question, label, answer, price.");
        const known = Array.isArray(ctx?.data?.questions) ? new Map(ctx.data.questions.map((q) => [q.qid, q])) : null;
        const items = [];
        const warnings = [];
        rows.forEach((row, i) => {
          const cells = row.map((cell) => unescapeCell(cell.trim()));
          if (i === 0 && cells[0].toLowerCase() === "question") return;
          if (cells.length !== 4) return warnings.push(`Line ${i + 1}: expected 4 values, found ${cells.length}; left out.`);
          const [question, label, answer, cost] = cells;
          const q = known ? known.get(question) : null;
          if (known && !q) return warnings.push(`Line ${i + 1}: ${question} is not a Choice, Noul or Score question of this run; left out.`);
          const classes = q && Array.isArray(q.classes) ? q.classes : null;
          if (classes && (!classes.includes(label) || !classes.includes(answer))) {
            return warnings.push(`Line ${i + 1}: ${!classes.includes(label) ? label : answer} is not an option of ${question}; left out.`);
          }
          if (label === answer) return warnings.push(`Line ${i + 1}: label and answer are both ${label}, which is not a mistake; left out.`);
          if (price({ cost }) === null) return warnings.push(`Line ${i + 1}: the price ${cost || "(blank)"} is not a number from 0 to 1,000,000; left out.`);
          items.push({ question, label, answer, cost });
          return undefined;
        });
        if (!items.length) throw new Error(`No mistake could be read. ${warnings.join(" ")}`.trim());
        return { items, warnings };
      } },
    { id: "mistakes_csv", kind: "exporter", label: "Shown priced mistakes as CSV", mime: "text/csv", filename: "priced-mistakes.csv",
      help: "Your price configuration only (question, label, answer, price as typed); it pastes back into the CSV import.",
      build: (ctx) => csvText([["question", "label", "answer", "price"], ...ctx.shown().map((item) => [item.question, item.label, item.answer, item.cost])]) },

    { id: "highest_price", kind: "metric", format: "usd", label: "Highest price among the shown mistakes",
      compute: (ctx) => {
        const prices = ctx.shown().map(price).filter((value) => value !== null);
        return prices.length ? Math.max(...prices) : null;
      } },
    { id: "priced_questions", kind: "metric", format: "integer", label: "Questions with a shown priced mistake",
      compute: (ctx) => {
        const rows = ctx.shown();
        return rows.length ? new Set(rows.map((item) => item.question)).size : null;
      } },
    { id: "strictest_break_even", kind: "metric", format: "percent", label: "Break-even accuracy for the most expensive shown mistake",
      help: "1 − review ÷ that price: below it, reviewing beats automating a row that risks this mistake. The page's sentence uses the default price.",
      compute: (ctx) => {
        const prices = ctx.shown().map(price).filter((value) => value !== null && value > 0);
        const review = reviewPrice(ctx);
        if (!prices.length || review === null) return null;
        return Math.max(0, 1 - review / Math.max(...prices));
      } },

    { id: "default_to_median", kind: "command", title: "Set the default mistake price to the median of the shown prices", group: "Costs",
      when: (ctx) => ctx.shown().some((item) => price(item) !== null),
      run: (ctx) => {
        const prices = ctx.shown().map(price).filter((value) => value !== null).sort((a, b) => a - b);
        const middle = prices.length >> 1;
        const median = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
        ctx.actions.setPrices(null, cents(median));
        ctx.env?.toast?.(`Default mistake price set to ${money(median)}.`);
      } },
  ],
});
