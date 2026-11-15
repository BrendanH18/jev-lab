// More for the priced mistakes in Costs (surface "workbench.costs"; contract in
// static/js/lab/surfaces/workbench-analysis.js): each price measured in reviews and against the default, its gap to
// the reverse mistake, price bands, checks for a default below a review and for Score prices that fall as mistakes grow,
// price-list edits (preview, Apply, Undo through the page's own edit path), imports of the JSON, tab-separated and
// Markdown price lists, and a default-price command. Prices are the user's own session configuration: never saved,
// never sent to the model. No answers or rows are read here.
import { definePack, toNumber } from "../../kit.js";
import { round } from "../../lib/math.js";
import { parseDelimited, parseMarkdownTable } from "../../lib/tables.js";

const MAX_PRICE = 1e6;
const EPS = 1e-9;
const LOPSIDED = 10;   // a mistake priced this many times its reverse, or more, is lopsided

const list = (value) => (Array.isArray(value) ? value : []);
const price = (item) => {
  const value = toNumber(item?.cost);
  return value !== null && value >= 0 && value <= MAX_PRICE ? value : null;
};
const reviewPrice = (ctx) => toNumber(ctx?.data?.review);
const defaultPrice = (ctx) => toNumber(ctx?.data?.error);
const money = (value) => `$${value.toFixed(2)}`;
// A price as written into a Costs input: every digit it has (Costs takes sub-cent prices), rounded only to clear float
// noise such as 0.1 + 0.2. Displays round separately, through money().
const priceText = (value) => String(round(value, 9));
const keyOf = (item) => JSON.stringify([item.question, item.label, item.answer]);
const reverseKey = (item) => JSON.stringify([item.question, item.answer, item.label]);
const questionOf = (ctx, qid) => list(ctx?.data?.questions).find((q) => q.qid === qid) || null;
const reverseOf = (item, items) => items.find((other) => keyOf(other) === reverseKey(item)) || null;

// For a Score question: which side of the label the answer falls on, and how far.
function scoreStep(item, ctx) {
  if (questionOf(ctx, item.question)?.type !== "score") return null;
  const label = toNumber(item.label), answer = toNumber(item.answer);
  return label === null || answer === null || label === answer ? null : { side: answer > label ? "higher" : "lower", distance: Math.abs(answer - label) };
}

// Score mistakes grouped by question, label and side, each sorted nearest first: [{ item, index, step, p }].
function scoreRuns(items, ctx) {
  const groups = new Map();
  items.forEach((item, index) => {
    const step = scoreStep(item, ctx), p = price(item);
    if (!step || p === null) return;
    const key = JSON.stringify([item.question, item.label, step.side]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, index, step, p });
  });
  return [...groups.values()].map((group) => group.sort((a, b) => a.step.distance - b.step.distance));
}

// Parsed rows [question, label, answer, cost] checked against the run's questions; bad lines become warnings.
function accept(rows, ctx) {
  const known = Array.isArray(ctx?.data?.questions) ? new Map(ctx.data.questions.map((q) => [q.qid, q])) : null;
  const items = [], warnings = [];
  rows.forEach(({ where, question, label, answer, cost }) => {
    const q = known ? known.get(question) : null;
    if (known && !q) return warnings.push(`${where}: ${question || "(blank)"} is not a Choice, Noul or Score question of this run; left out.`);
    const classes = q ? list(q.classes) : null;
    if (classes && (!classes.includes(label) || !classes.includes(answer))) {
      return warnings.push(`${where}: ${!classes.includes(label) ? label : answer} is not an option of ${question}; left out.`);
    }
    if (label === answer) return warnings.push(`${where}: label and answer are both ${label}, which is not a mistake; left out.`);
    if (price({ cost }) === null) return warnings.push(`${where}: the price ${cost || "(blank)"} is not a number from 0 to 1,000,000; left out.`);
    items.push({ question, label, answer, cost });
    return undefined;
  });
  if (!items.length) throw new Error(`No mistake could be read. ${warnings.join(" ")}`.trim());
  return { items, warnings };
}
const tsvCell = (value) => {
  const plain = String(value ?? "").replace(/[\t\r\n]+/g, " ");
  return /^\s*[=+@-]/.test(plain) ? `'${plain}` : plain;
};
const unescapeCell = (value) => value.replace(/^'(?=\s*[=+@-])/, "");
const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const moneyText = (value) => {
  const plain = text(value).replace(/^\$/, "").replaceAll(",", "");
  const number = toNumber(plain);
  return number === null ? plain : String(number);
};

export default definePack({
  id: "costs-price-facts",
  surface: "workbench.costs",
  title: "Costs: price facts, checks and imports",
  about: "Each priced mistake measured in reviews and against the default, its gap to the reverse mistake and its price band; checks for a default below a review and for Score prices that fall as mistakes grow; price-list edits with preview and Undo; and imports of the JSON, tab-separated and Markdown price lists. Your price configuration only; nothing is saved.",
  features: [
    // ---------- facts ----------
    { id: "reviews_per_mistake", kind: "fact", type: "number", label: "reviews this mistake costs as much as",
      help: "The price ÷ the review price: one automated mistake pays for this many reviews.",
      value: (item, ctx) => {
        const p = price(item), review = reviewPrice(ctx);
        return p === null || review === null || review <= 0 ? null : p / review;
      } },
    { id: "times_default", kind: "fact", type: "number", label: "price as a multiple of the default",
      value: (item, ctx) => {
        const p = price(item), fallback = defaultPrice(ctx);
        return p === null || fallback === null || fallback <= 0 ? null : p / fallback;
      } },
    { id: "reverse_gap", kind: "fact", type: "number", label: "price minus its reverse's price", unit: "$",
      help: "The same question with label and answer swapped; unavailable when that reverse is not priced.",
      value: (item, ctx) => {
        const reverse = reverseOf(item, ctx.items());
        const p = price(item), q = reverse ? price(reverse) : null;
        return p === null || q === null ? null : p - q;
      } },
    { id: "price_band", kind: "fact", type: "category", label: "price band",
      help: "Free, below a review, between a review and the default, the default, above the default, or over 10× the default.",
      value: (item, ctx) => {
        const p = price(item), review = reviewPrice(ctx), fallback = defaultPrice(ctx);
        if (p === null || review === null || fallback === null) return null;
        if (p <= EPS) return "free";
        if (p < review - EPS) return "below a review";
        if (Math.abs(p - fallback) <= EPS) return "the default";
        if (p < fallback) return "between a review and the default";
        return p > LOPSIDED * fallback + EPS ? "over 10× the default" : "above the default";
      } },
    { id: "share_of_listed", kind: "fact", type: "number", label: "share of the price list's total",
      help: "This price over the sum of every valid price in the list.",
      value: (item, ctx) => {
        const p = price(item);
        const total = ctx.items().map(price).filter((value) => value !== null).reduce((a, b) => a + b, 0);
        return p === null || !(total > 0) ? null : p / total;
      } },

    // ---------- checks ----------
    { id: "default_at_or_below_review", kind: "diagnostic", severity: "advice", scope: "list", label: "Default mistake price no more than a review",
      check: (_rows, ctx) => {
        const review = reviewPrice(ctx), fallback = defaultPrice(ctx);
        if (review === null || fallback === null || fallback > review + EPS) return null;
        return `The default mistake price ${money(fallback)} is no more than a review (${money(review)}): automating a row that risks an unpriced mistake always pays, so the cheapest thresholds lean to automating.`;
      } },
    { id: "score_not_monotone", kind: "diagnostic", severity: "advice", scope: "list", label: "A further-off Score mistake priced lower",
      help: "For one Score question and label, an answer further off on the same side should not cost less than a nearer one.",
      check: (rows, ctx) => scoreRuns(rows, ctx).flatMap((run) => run.flatMap((far, i) => {
        const nearer = run.slice(0, i).filter((near) => near.step.distance < far.step.distance && near.p > far.p + EPS);
        if (!nearer.length) return [];
        const worst = nearer.reduce((a, b) => (b.p > a.p ? b : a));
        return [`${far.item.question}: labeled ${far.item.label}, answered ${far.item.answer} (${money(far.p)}) is priced below answered ${worst.item.answer} (${money(worst.p)}), though it is further off.`];
      })) },
    { id: "lopsided_reverse", kind: "diagnostic", severity: "info", label: `Priced ${LOPSIDED}× its reverse or more`,
      help: "Either direction: worth a look when the two mistakes should cost about the same.",
      check: (item, ctx) => {
        const reverse = reverseOf(item, ctx.items());
        const p = price(item), q = reverse ? price(reverse) : null;
        if (p === null || q === null || p <= q) return null;
        if (q <= EPS) return `priced ${money(p)} while its reverse (${item.answer} answered ${item.label}) is free`;
        return p / q >= LOPSIDED - EPS ? `priced ${money(p)}, ${round(p / q, 1)}× its reverse (${item.answer} answered ${item.label}, ${money(q)})` : null;
      } },

    // ---------- edits ----------
    { id: "symmetrize", kind: "transform", label: "Price each shown mistake and its reverse at the higher of the two",
      help: "Only pairs where both directions are priced change.",
      all: (items, _params, _ctx, shown) => {
        const next = items.map((item) => ({ ...item }));
        for (const i of shown) {
          const j = next.findIndex((other) => keyOf(other) === reverseKey(next[i]));
          const p = price(next[i]), q = j < 0 ? null : price(next[j]);
          if (p === null || q === null || Math.abs(p - q) <= EPS) continue;
          next[i].cost = next[j].cost = priceText(Math.max(p, q));
        }
        return next;
      } },
    { id: "cap_prices", kind: "transform", label: "Cap the shown prices",
      params: [{ name: "cap", label: "Highest price", type: "number", min: 0, max: MAX_PRICE, default: 1000 }],
      each: (item, { cap }) => {
        const p = price(item);
        return p === null || p <= cap + EPS ? null : { ...item, cost: priceText(cap) };
      } },
    { id: "score_monotone", kind: "transform", label: "Raise shown Score prices to at least their nearer mistakes'",
      help: "For each Score question and label, an answer further off on the same side is raised to the highest price of the nearer ones.",
      all: (items, _params, ctx, shown) => {
        const next = items.map((item) => ({ ...item }));
        for (const run of scoreRuns(items, ctx)) {
          let nearer = -Infinity;   // the highest price, after raising, of the mistakes nearer the label
          for (let i = 0; i < run.length;) {
            const distance = run[i].step.distance;
            let here = -Infinity;
            for (; i < run.length && run[i].step.distance === distance; i++) {
              const entry = run[i];
              let p = entry.p;
              if (shown.has(entry.index) && p < nearer - EPS) {
                p = nearer;
                next[entry.index].cost = priceText(nearer);
              }
              here = Math.max(here, p);
            }
            nearer = Math.max(nearer, here);
          }
        }
        return next;
      } },
    { id: "review_multiple", kind: "transform", label: "Price the shown mistakes at a multiple of the review price",
      params: [{ name: "multiple", label: "Reviews per mistake", type: "number", min: 0, max: MAX_PRICE, default: 10 }],
      each: (item, { multiple }, ctx) => {
        const review = reviewPrice(ctx);
        if (review === null || review < 0) throw new Error("Set a valid review price first: this edit uses it.");
        const value = round(review * multiple, 9);
        if (value > MAX_PRICE) throw new Error(`${item.question}: ${item.label} → ${item.answer} would cost more than $1,000,000.`);
        return { ...item, cost: String(value) };
      } },

    { id: "prices_tsv", kind: "exporter", label: "Shown priced mistakes as tab-separated text", mime: "text/tab-separated-values", filename: "priced-mistakes.tsv",
      help: "Your price configuration only (question, label, answer, price as typed), to paste into a spreadsheet; it pastes back into the tab-separated import. Text a spreadsheet would run as a formula gets a leading apostrophe.",
      build: (ctx) => [["question", "label", "answer", "price"], ...ctx.shown().map((item) => [item.question, item.label, item.answer, item.cost])]
        .map((row) => row.map(tsvCell).join("\t")).join("\n") + "\n" },

    // ---------- imports ----------
    { id: "json_price_list", kind: "importer", label: "JSON price list (as the Price list export writes it)",
      help: "An object with a mistakes list, or the list itself, of { question, label, answer, cost }. The review and default prices in it are not changed; mistakes this run cannot use are left out with a warning.",
      parse: (raw, ctx) => {
        let value;
        try { value = JSON.parse(raw); } catch { throw new Error("That is not JSON."); }
        const mistakes = Array.isArray(value) ? value : value && Array.isArray(value.mistakes) ? value.mistakes : null;
        if (!mistakes || !mistakes.length) throw new Error("Paste a JSON list of mistakes, or an object with one under \"mistakes\".");
        return accept(mistakes.map((m, i) => ({ where: `Mistake ${i + 1}`, question: text(m?.question), label: text(m?.label), answer: text(m?.answer), cost: text(m?.cost) })), ctx);
      } },
    { id: "tsv", kind: "importer", label: "Tab-separated: question, label, answer, price (pasted from a spreadsheet)",
      help: "One mistake per line; a header line naming question is skipped. Lines this run cannot use are left out with a warning.",
      parse: (raw, ctx) => {
        const rows = (parseDelimited(raw, "\t") || []).filter((row) => row.some((cell) => cell.trim() !== ""));
        if (!rows.length) throw new Error("Paste at least one line: question, label, answer and price separated by tabs.");
        const parsed = [], early = [];
        rows.forEach((row, i) => {
          const cells = row.map((cell) => unescapeCell(cell.trim()));
          if (i === 0 && cells[0].toLowerCase() === "question") return;
          if (cells.length !== 4) { early.push(`Line ${i + 1}: expected 4 values, found ${cells.length}; left out.`); return; }
          parsed.push({ where: `Line ${i + 1}`, question: cells[0], label: cells[1], answer: cells[2], cost: moneyText(cells[3]) });
        });
        if (!parsed.length) throw new Error(`No mistake could be read. ${early.join(" ")}`.trim());
        const out = accept(parsed, ctx);
        return { items: out.items, warnings: [...early, ...out.warnings] };
      } },
    { id: "markdown_table", kind: "importer", label: "Markdown table with question, label, answer and price columns",
      help: "Such as the priced-mistakes Markdown export; prices may carry a $ sign, and other columns are ignored.",
      parse: (raw, ctx) => {
        const table = parseMarkdownTable(raw);
        if (!table) throw new Error("That is not a Markdown table.");
        const at = (name) => table.columns.findIndex((column) => column.toLowerCase() === name);
        const [q, l, a, p] = ["question", "label", "answer", "price"].map(at);
        if ([q, l, a, p].some((index) => index < 0)) throw new Error("The table needs question, label, answer and price columns.");
        if (!table.rows.length) throw new Error("The table has no rows.");
        return accept(table.rows.map((row, i) => ({ where: `Row ${i + 1}`, question: row[q], label: row[l], answer: row[a], cost: moneyText(row[p]) })), ctx);
      } },

    // ---------- command ----------
    { id: "default_to_highest", kind: "command", title: "Set the default mistake price to the highest shown price", group: "Costs",
      help: "A cautious default: every mistake you have not priced then costs as much as the dearest one you have.",
      when: (ctx) => {
        const prices = ctx.shown().map(price).filter((value) => value !== null);
        return prices.length > 0 && Math.abs(Math.max(...prices) - (defaultPrice(ctx) ?? -1)) > EPS;
      },
      run: (ctx) => {
        const highest = Math.max(...ctx.shown().map(price).filter((value) => value !== null));
        ctx.actions.setPrices(null, priceText(highest));
        ctx.env?.toast?.(`Default mistake price set to ${money(highest)}.`);
      } },
  ],
});
