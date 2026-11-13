// Compare result tools (surface "workbench.compare.rows"; contract in static/js/lab/surfaces/workbench-compare.js):
// advisory checks on the rows where A and B answer the scored question differently, exports of the user's own
// Compare run with their content stated, and commands for the report's controls. Pure: it reads the run through ctx,
// acts only through ctx.actions (local rescoring, the cascade slider, the page's handoffs), stores nothing and calls
// no model. Row numbers are the table's #: tuning rows the run sent, counted from 1; test rows never appear.
import { csvText, definePack, formatValue } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const NAMES = ["A", "B"];
const PERTURBS = { typos: "with typos", lowercase: "in lowercase", distractor: "with an unrelated sentence added", shuffle: "with JSON fields shuffled" };
const LOW = 0.4;          // "neither sure": both signals at most this
const REPEAT = 3;         // a transition repeated on at least this many rows and half the shown ones is systematic
const LABELABLE = ["choice", "noul", "score"];

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const fixed = (value, digits = 2) => (num(value) === null ? "—" : value.toFixed(digits));
const dec = (value, digits = 4) => (num(value) === null ? "" : String(Number(value.toFixed(digits))));
const pct = (value) => (num(value) === null ? "—" : `${(value * 100).toFixed(1)}%`);
const rowList = (items, max = 12) => {
  const shown = items.slice(0, max).map((item) => `#${item.number}`).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
};
const slug = (text) => String(text || "question").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "question";
const variantIndex = (name) => (name === "B" ? 1 : 0);
const NUMBERING = "Row numbers are the table's # (tuning rows the run sent, from 1), not lines of the rows box.";
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

// A row as one line of the rows box: text as written, everything else as compact JSON. A text row that would not
// survive as one line (a line break, or a leading "{") is written as the object it is sent as, { "text": … }.
function rowLine(row) {
  if (typeof row === "string") return /[\r\n]/.test(row) || row.trimStart().startsWith("{") ? JSON.stringify({ text: row }) : row;
  return JSON.stringify(row);
}

const cascadeOf = (ctx) => (isObject(ctx.data.cascade) ? ctx.data.cascade : null);
const idle = (ctx) => ctx.data.qid !== null && !ctx.data.running;
const usd = (value) => (num(value) === null ? "—" : formatValue(value, "usd"));

export default definePack({
  id: "compare-result-tools",
  surface: "workbench.compare.rows",
  title: "Compare result checks and exports",
  about: "Advisory checks on the rows where A and B answer differently, exports of your own Compare run with what each holds stated (inputs only, inputs with human labels, or answers and measured figures, numbered as the table's # among the tuning rows sent), and commands for the report's controls. Test rows never appear, nothing is stored, and no command calls the model.",
  features: [
    // ---------- result checks ----------
    { id: "pick_not_offered", kind: "diagnostic", severity: "advice", label: "Pick the other variant does not offer",
      help: "A Choice pick that is not among the other variant's options, so the disagreement comes from the option lists.",
      check: (item, ctx) => {
        if (ctx.data.type !== "choice") return null;
        const criteria = ctx.data.questions.map((question) => (isObject(question?.criteria) ? question.criteria : null));
        return [0, 1].flatMap((v) => {
          const pick = item.picks[v], other = criteria[1 - v];
          return pick !== null && other && !hasOwn(other, pick)
            ? [`${NAMES[v]} picked “${pick}”, which ${NAMES[1 - v]} does not offer, so this disagreement comes from the option lists, not from a judgment.`] : [];
        });
      } },
    { id: "label_unscored", kind: "diagnostic", severity: "info", label: "Label left out of the scores",
      help: "The row's label is one a variant cannot score, so the report leaves it out of both sides.",
      check: (item, ctx) => {
        if (item.label === null) return null;
        return [0, 1].flatMap((v) => (ctx.data.scores?.[v]?.invalid || []).filter((entry) => entry?.index === item.index)
          .map((entry) => `${NAMES[v]} cannot score this row's label (${entry.reason || "unreadable"}), so it is left out of both sides.`));
      } },
    { id: "neither_sure", kind: "diagnostic", severity: "info", label: "Neither variant sure",
      help: `Both signals are at most ${LOW}. An advisory rule in plain code, not the model's answer.`,
      check: (item) => {
        const [a, b] = item.signals.map(num);
        return a !== null && b !== null && a <= LOW && b <= LOW
          ? `Neither variant is sure (A ${fixed(a)}, B ${fixed(b)}, both at most ${LOW.toFixed(2)}): a gate at ${LOW.toFixed(2)} or above sends this row to review whichever variant you pick.` : null;
      } },
    { id: "pick_outside_orders", kind: "diagnostic", severity: "info", label: "Averaged pick neither order chose",
      help: "A variant asked in both option orders gave an averaged answer that neither order picked.",
      check: (item) => [0, 1].flatMap((v) => {
        const pair = item.orders[v], pick = item.picks[v];
        return Array.isArray(pair) && pair[0] !== null && pair[1] !== null && pick !== null && !pair.includes(pick)
          ? [`${NAMES[v]}'s averaged answer “${pick}” is neither order's pick (“${pair[0]}” as listed, “${pair[1]}” reversed): averaging the two probability lists moved it to a third option.`] : [];
      }) },
    { id: "repeated_transition", kind: "diagnostic", severity: "advice", scope: "list", label: "One disagreement repeats",
      help: `The same A pick → B pick on at least ${REPEAT} rows and half the shown disagreements.`,
      check: (items) => {
        const paired = items.filter((item) => item.picks[0] !== null && item.picks[1] !== null);
        const groups = new Map();
        for (const item of paired) {
          const key = `${item.picks[0]} → ${item.picks[1]}`;
          groups.set(key, [...(groups.get(key) || []), item]);
        }
        const [key, rows] = [...groups].sort((x, y) => y[1].length - x[1].length)[0] || [];
        return rows && rows.length >= REPEAT && rows.length * 2 >= paired.length
          ? `${rows.length} of ${paired.length} shown disagreements go ${key} (${rowList(rows)}): a systematic shift rather than noise. Compare how the two variants describe these options.` : null;
      } },
    { id: "mostly_unlabeled", kind: "diagnostic", severity: "advice", scope: "list", label: "Most disagreements unlabeled",
      check: (items, ctx) => {
        const bare = items.filter((item) => item.label === null);
        return items.length && bare.length * 2 > items.length
          ? `${bare.length} of ${items.length} shown disagreements have no label for “${ctx.data.qid}” (${rowList(bare)}). Label them (“Label missing disagreement inputs”) before reading which variant is ahead.` : null;
      } },
    { id: "mostly_both_wrong", kind: "diagnostic", severity: "advice", scope: "list", label: "Both wrong on most labeled disagreements",
      check: (items) => {
        const scored = items.filter((item) => item.verdict !== null);
        const wrong = scored.filter((item) => item.verdict === "both_wrong");
        return scored.length >= 2 && wrong.length * 2 >= scored.length
          ? `${wrong.length} of ${scored.length} labeled shown disagreements are wrong in both variants (${rowList(wrong)}): neither handles these rows, so look at the question's wording rather than choosing between A and B.` : null;
      } },
    { id: "signal_inverted", kind: "diagnostic", severity: "advice", scope: "list", label: "Signal does not separate right from wrong",
      help: "Needs two right and two wrong scored picks of a variant among the shown rows.",
      check: (items) => [0, 1].flatMap((v) => {
        const of = (right) => items.filter((item) => item.correct[v] === right && num(item.signals[v]) !== null).map((item) => item.signals[v]);
        const right = of(true), wrong = of(false);
        if (right.length < 2 || wrong.length < 2 || mean(wrong) < mean(right)) return [];
        return [`On the shown labeled rows, ${NAMES[v]}'s wrong answers carry a signal as high as its right ones (mean ${fixed(mean(wrong))} on ${wrong.length} wrong against ${fixed(mean(right))} on ${right.length} right), so a threshold would not sort them here. Small samples are rarely conclusive.`];
      }) },
    { id: "order_sensitive", kind: "diagnostic", severity: "advice", scope: "list", label: "Answer depends on option order",
      help: "A variant asked in both option orders picked differently in each on at least two rows and half the shown rows it answered both ways.",
      check: (items, ctx) => [0, 1].flatMap((v) => {
        const asked = items.filter((item) => Array.isArray(item.orders[v]) && item.orders[v][0] !== null && item.orders[v][1] !== null);
        const split = asked.filter((item) => item.orders[v][0] !== item.orders[v][1]);
        return split.length >= 2 && split.length * 2 >= asked.length
          ? [`${NAMES[v]} picked differently in its two option orders on ${split.length} of ${asked.length} shown rows (${rowList(split)}): its answer to “${ctx.data.qid}” depends on the order of the options.`] : [];
      }) },

    // ---------- exports ----------
    { id: "inputs_only", kind: "exporter", label: "Shown rows' inputs, one per line", filename: (ctx) => `compare-${slug(ctx.data.qid)}-inputs.txt`,
      help: "Inputs only, as rows-box lines in the table's order: no labels, picks or answers. Pictures are named, not included.",
      build: (ctx) => ctx.shown().map((item) => `${rowLine(item.row)}\n`).join("") },
    { id: "missed_rows", kind: "exporter", label: "Shown rows a variant got wrong, with labels, as JSON lines", mime: "application/x-ndjson",
      filename: (ctx) => `compare-${slug(ctx.data.qid)}-missed-rows.jsonl`,
      help: "Each labeled shown row where A or B was wrong, as a dataset row: its input and its human label for this question under “_expect”. No picks or answers.",
      build: (ctx) => ctx.shown().filter((item) => ["a_only", "b_only", "both_wrong"].includes(item.verdict) && !Array.isArray(item.row))
        .map((item) => `${JSON.stringify({ ...(isObject(item.row) ? item.row : { text: item.row }), _expect: { [ctx.data.qid]: item.label } })}\n`).join("") },
    { id: "agreement_csv", kind: "exporter", label: "Agreement by question as CSV", mime: "text/csv", filename: "compare-agreement.csv",
      help: "Counts from your Compare run for every shared question: rows both answered, changed answers, rate and 95% Wilson interval, and the order or input check markers. No rows or answers.",
      build: (ctx) => csvText([["question", "type", "rows both answered", "answers changed", "rate", "95% low", "95% high", "options reordered", "input check", "changed answers in the same place"],
        ...(ctx.data.agreement || []).map((entry) => [entry.qid, entry.type, entry.answered, entry.changed, dec(entry.rate), dec(entry.low), dec(entry.high),
          entry.reordered ? "yes" : "no", entry.perturbed ? "yes" : "no", entry.same_position ?? ""])]) },
    { id: "summary_markdown", kind: "exporter", label: "A against B summary as Markdown", mime: "text/markdown", filename: (ctx) => `compare-${slug(ctx.data.qid)}-summary.md`,
      help: "Your Compare run's per-variant figures for the scored question: setup, measured usage, accuracy with 95% Wilson interval and calibration gap. No rows, labels or answers.",
      build: (ctx) => {
        const variants = ctx.data.variants, scores = ctx.data.scores;
        const cell = (fn) => [0, 1].map((v) => (variants[v] ? fn(variants[v], scores?.[v] || null) : "—"));
        const rows = [
          ["model", ...cell((variant) => variant.model || "—")],
          ["rows sent", ...cell((variant) => (variant.perturb ? PERTURBS[variant.perturb] || variant.perturb : "as written"))],
          ["asked", ...cell((variant) => (variant.average_orders ? "in both option orders" : "once"))],
          ["calls answered", ...cell((variant) => variant.completed)],
          ["calls failed", ...cell((variant) => variant.errors)],
          ["cost (measured)", ...cell((variant) => usd(variant.cost_usd))],
          ["input tokens", ...cell((variant) => (num(variant.input_tokens) === null ? "—" : formatValue(variant.input_tokens, "integer")))],
          ["median latency", ...cell((variant) => (num(variant.latency_ms_median) === null ? "—" : formatValue(variant.latency_ms_median, "ms")))],
          ["labeled rows scored", ...cell((_variant, score) => (score ? score.labeled : "—"))],
          ["accuracy (95% Wilson)", ...cell((_variant, score) => (score && num(score.accuracy) !== null ? `${pct(score.accuracy)} (${pct(score.accuracy_low)}–${pct(score.accuracy_high)})` : "—"))],
          ["calibration gap (ECE)", ...cell((_variant, score) => fixed(score?.ece))],
        ];
        return `## Compare summary: “${ctx.data.qid || "no question"}”${ctx.data.type ? ` (${ctx.data.type})` : ""}\n\n${formatMarkdownTable(["", "A", "B"], rows)}\n\n`
          + `From your Compare run of this page session, gated on ${ctx.data.signal}. Both variants are scored on the same labeled rows both answered. Small samples are rarely conclusive.\n`;
      } },
    { id: "paired_markdown", kind: "exporter", label: "Row-by-row result as Markdown", mime: "text/markdown", filename: (ctx) => `compare-${slug(ctx.data.qid)}-paired.md`,
      help: "The 2 × 2 count of labeled rows by who was right, with the exact McNemar p-value. Counts only.",
      build: (ctx) => {
        const paired = ctx.data.paired;
        if (!paired) return `No labeled rows both variants answered for “${ctx.data.qid || "no question"}”, so there is no row-by-row result.\n`;
        return `## Row by row: “${ctx.data.qid}”\n\n${formatMarkdownTable(["", "B right", "B wrong"], [["A right", paired.both_right, paired.a_only], ["A wrong", paired.b_only, paired.both_wrong]])}\n\n`
          + `${paired.rows} labeled rows both variants answered. Exact McNemar test, two-sided: p = ${fixed(paired.p_value, 3)} from the ${paired.a_only + paired.b_only} rows where exactly one variant was right. Small samples are rarely conclusive.\n`;
      } },
    { id: "curves_csv", kind: "exporter", label: "Accuracy and automation at every threshold as CSV", mime: "text/csv", filename: (ctx) => `compare-${slug(ctx.data.qid)}-curves.csv`,
      help: "All 101 thresholds of the report's curves for both variants: rows automated, share automated, accuracy and its 95% interval. Counts and rates only.",
      build: (ctx) => {
        const [a, b] = (ctx.data.scores || []).map((score) => (Array.isArray(score?.sweep) ? score.sweep : []));
        const side = (point) => (point ? [point.automated, dec(point.coverage), dec(point.accuracy), dec(point.low), dec(point.high)] : ["", "", "", "", ""]);
        return csvText([["threshold", "A automated", "A share automated", "A accuracy", "A 95% low", "A 95% high", "B automated", "B share automated", "B accuracy", "B 95% low", "B 95% high"],
          ...Array.from({ length: Math.max(a?.length || 0, b?.length || 0) }, (_, k) => [dec((a?.[k] || b?.[k]).threshold, 2), ...side(a?.[k]), ...side(b?.[k])])]);
      } },
    { id: "cascade_csv", kind: "exporter", label: "Cascade at every threshold as CSV", mime: "text/csv", filename: (ctx) => `compare-${slug(ctx.data.qid)}-cascade.csv`,
      help: "For each threshold: rows escalated to the second variant, accuracy, and what the cascade would have cost and taken per row on the scored rows, added up from the measured usage of calls already made. A what-if on these rows, not spend.",
      build: (ctx) => {
        const cascade = cascadeOf(ctx);
        return csvText([["threshold", "first", "second", "rows escalated", "share escalated", "correct", "accuracy", "cascade cost on scored rows (USD, from measured calls)", "cascade mean latency (ms, from measured calls)"],
          ...(cascade?.sweep || []).map((point) => [dec(point.threshold, 2), cascade.first, cascade.second, point.escalated, dec(point.share), point.correct, dec(point.accuracy),
            dec(point.cost_usd, 8), dec(point.latency_ms, 1)])]);
      } },
    { id: "slices_csv", kind: "exporter", label: "Compare by slice as CSV", mime: "text/csv", filename: (ctx) => `compare-${slug(ctx.data.qid)}-slices.csv`,
      help: "Each value of the slice field with full value text: paired inputs, each variant's accuracy and 95% interval, the paired counts and McNemar p. Exploratory and unadjusted for the number of slices.",
      build: (ctx) => {
        const slices = ctx.data.slices;
        const side = (variant) => [variant?.labeled ?? "", variant?.correct ?? "", dec(variant?.accuracy), dec(variant?.accuracy_low), dec(variant?.accuracy_high)];
        return csvText([["field", "value", "rows", "A labeled", "A correct", "A accuracy", "A 95% low", "A 95% high", "B labeled", "B correct", "B accuracy", "B 95% low", "B 95% high",
          "only A right", "only B right", "McNemar p", "error"],
        ...(slices?.slices || []).map((group) => [slices.field, group.value, group.rows ?? "", ...side(group.variants?.[0]), ...side(group.variants?.[1]),
          group.paired?.a_only ?? "", group.paired?.b_only ?? "", dec(group.paired?.p_value), group.error || ""])]);
      } },
    { id: "failed_calls_csv", kind: "exporter", label: "Failed and skipped calls as CSV", mime: "text/csv", filename: "compare-failed-calls.csv",
      help: `Among the rows answered for this question: the row number, the variant, and the error message or the stop that skipped it. No inputs or answers. ${NUMBERING}`,
      build: (ctx) => csvText([["row", "variant", "outcome", "message"], ...ctx.items().flatMap((item) => [0, 1].flatMap((v) => (item.errors[v]
        ? [[item.number, NAMES[v], "failed", item.errors[v]]] : item.skipped[v] ? [[item.number, NAMES[v], "skipped", ctx.data.run?.stopped || "the run stopped"]] : [])))]) },
    { id: "orders_csv", kind: "exporter", label: "Order averaging splits as CSV", mime: "text/csv", filename: "compare-order-splits.csv",
      help: "For a variant asked in both option orders: per question, rows both orders answered and how often they picked differently, with a 95% interval. Counts only.",
      build: (ctx) => csvText([["variant", "question", "rows both orders answered", "picked differently", "rate", "95% low", "95% high"],
        ...(ctx.data.orders || []).flatMap((list, v) => (Array.isArray(list) ? list : []).map((entry) => [NAMES[v], entry.qid, entry.answered, entry.changed, dec(entry.rate), dec(entry.low), dec(entry.high)]))]) },
    { id: "targets_csv", kind: "exporter", label: "Automation targets as CSV", mime: "text/csv", filename: (ctx) => `compare-${slug(ctx.data.qid)}-targets.csv`,
      help: "Each variant's 90%, 95% and 99% targets: the threshold, share and rows automated, accuracy with 95% interval, and labeled rows needed. Basis as the targets select sets it.",
      build: (ctx) => csvText([["variant", "basis", "target", "threshold", "share automated", "rows automated", "accuracy", "95% low", "95% high", "labeled rows needed"],
        ...(ctx.data.scores || []).flatMap((score, v) => (score?.targets || []).map((target) => [NAMES[v], ctx.data.bound === "lower" ? "95% lower bound" : "these rows",
          dec(target.target, 2), dec(target.threshold, 2), dec(target.coverage), target.automated ?? "", dec(target.accuracy), dec(target.low), dec(target.high), target.needed ?? ""]))]) },
    { id: "rewritten_inputs", kind: "exporter", label: "Rewritten rows as sent, as JSON lines", mime: "application/x-ndjson", filename: "compare-rewritten-inputs.jsonl",
      help: `For each row of this question that a variant was sent rewritten: the row number, the variant and the input as sent. Inputs only: no labels or answers. ${NUMBERING}`,
      build: (ctx) => ctx.items().flatMap((item) => [0, 1].flatMap((v) => (item.sent[v] !== null ? [`${JSON.stringify({ row: item.number, variant: NAMES[v], sent: item.sent[v] })}\n`] : []))).join("") },
    { id: "experiment_note", kind: "exporter", label: "Experiment note as Markdown", mime: "text/markdown", filename: (ctx) => `compare-${slug(ctx.data.qid)}-note.md`,
      help: "What was compared, the headline figures for the scored question and the caveats, for a write-up. Figures from your Compare run; no rows, labels or answers.",
      build: (ctx) => {
        const variants = ctx.data.variants, scores = ctx.data.scores, paired = ctx.data.paired, run = ctx.data.run, counts = ctx.data.counts;
        if (!variants.length) throw new Error("Run both variants first: there is no Compare report yet.");
        const setup = (variant) => `${variant.name}: ${variant.model || "unknown model"}, ${variant.question_count} questions, rows ${variant.perturb ? PERTURBS[variant.perturb] || variant.perturb : "as written"}, asked ${variant.average_orders ? "in both option orders" : "once"}`;
        const lines = [`# Compare note: “${ctx.data.qid}”`, "", "## Setup", "", `- ${setup(variants[0])}`, `- ${setup(variants[1])}`];
        if (run) lines.push(`- ${run.rows} tuning rows sent${run.held_out ? `, ${run.held_out} test ${run.held_out === 1 ? "row" : "rows"} left out` : ""}${run.stopped ? `; the run stopped: ${run.stopped}` : ""}`);
        lines.push("", "## Result", "");
        if (scores) for (const [v, score] of scores.entries()) lines.push(`- ${NAMES[v]}: accuracy ${pct(score.accuracy)} (95% Wilson ${pct(score.accuracy_low)}–${pct(score.accuracy_high)}) on ${score.labeled} labeled rows, calibration gap ${fixed(score.ece)}`);
        if (paired) lines.push(`- Rows only A got right: ${paired.a_only}; rows only B got right: ${paired.b_only}; exact McNemar p = ${fixed(paired.p_value, 3)}`);
        if (counts) lines.push(`- A and B answered differently on ${counts.disagree} of ${counts.answered_both} rows both answered`);
        lines.push("", "## Caveats", "", "- Small samples are rarely conclusive; intervals are 95% Wilson intervals.",
          "- One question at a time: comparisons across several questions or slices are exploratory and unadjusted.", "");
        return lines.join("\n");
      } },
    { id: "ignored_labels_csv", kind: "exporter", label: "Labels left out of the scores as CSV", mime: "text/csv", filename: (ctx) => `compare-${slug(ctx.data.qid)}-ignored-labels.csv`,
      help: `Row number, variant and the scorer's reason a label could not be scored (a reason can quote the label). No inputs or answers. ${NUMBERING}`,
      build: (ctx) => csvText([["row", "variant", "reason"], ...(ctx.data.scores || []).flatMap((score, v) => (score?.invalid || []).map((entry) => [Number.isInteger(entry?.index) ? entry.index + 1 : "", NAMES[v], entry?.reason || ""]))]) },
    { id: "usage_csv", kind: "exporter", label: "Measured usage per row as CSV", mime: "text/csv", filename: "compare-usage.csv",
      help: `For each row answered for this question: each variant's measured latency, tokens, cost and number of calls in your Compare run. Measured values of calls already made, never estimates; no inputs or answers. ${NUMBERING}`,
      build: (ctx) => csvText([["row", ...NAMES.flatMap((name) => [`${name} latency (ms)`, `${name} input tokens`, `${name} output tokens`, `${name} cost (USD)`, `${name} calls`])],
        ...ctx.items().map((item) => [item.number, ...[0, 1].flatMap((v) => {
          const meta = item.meta[v] || {};
          return [meta.latency_ms ?? "", meta.input_tokens ?? "", meta.output_tokens ?? "", dec(meta.cost_usd, 8), meta.calls ?? (item.meta[v] ? 1 : "")];
        })])]) },

    // ---------- commands ----------
    { id: "toggle_bound", kind: "command", title: "Switch targets between these rows and the 95% lower bound", group: "Compare",
      when: idle, run: (ctx) => ctx.actions.setBound(ctx.data.bound === "lower" ? "estimate" : "lower") },
    { id: "swap_first", kind: "command", title: "Ask the other variant first in the cascade", group: "Compare",
      when: (ctx) => idle(ctx) && !!cascadeOf(ctx), run: (ctx) => ctx.actions.setFirst(ctx.data.first === "A" ? "B" : "A") },
    { id: "cascade_match", kind: "command", title: "Cascade: match the second variant's accuracy", group: "Compare",
      when: (ctx) => num(cascadeOf(ctx)?.match?.threshold) !== null, run: (ctx) => ctx.actions.setCascadeThreshold(cascadeOf(ctx).match.threshold) },
    { id: "cascade_best", kind: "command", title: "Cascade: go to the most accurate threshold", group: "Compare",
      when: (ctx) => num(cascadeOf(ctx)?.best?.threshold) !== null, run: (ctx) => ctx.actions.setCascadeThreshold(cascadeOf(ctx).best.threshold) },
    { id: "cascade_target", kind: "command", title: "Cascade: escalate below the first variant's 95% threshold", group: "Compare",
      help: "Keeps the first variant's answer where its signal reaches its own 95% automation threshold and escalates the rest.",
      when: (ctx) => !!cascadeOf(ctx) && num(ctx.data.scores?.[variantIndex(ctx.data.first)]?.targets?.find((target) => target.target === 0.95)?.threshold) !== null,
      run: (ctx) => ctx.actions.setCascadeThreshold(ctx.data.scores[variantIndex(ctx.data.first)].targets.find((target) => target.target === 0.95).threshold) },
    { id: "previous_question", kind: "command", title: "Score the previous shared question", group: "Compare",
      when: (ctx) => idle(ctx) && ctx.data.shared.length > 1,
      run: (ctx) => {
        const shared = ctx.data.shared;
        return ctx.actions.selectQuestion(shared[(shared.indexOf(ctx.data.qid) - 1 + shared.length) % shared.length]);
      } },
    { id: "next_labeled_question", kind: "command", title: "Score the next shared question with labels", group: "Compare", keys: "Alt+Shift+L",
      when: (ctx) => idle(ctx) && ctx.data.shared.some((qid) => qid !== ctx.data.qid && ctx.data.labeled.includes(qid)),
      run: (ctx) => {
        const shared = ctx.data.shared, at = shared.indexOf(ctx.data.qid);
        const next = [...shared.slice(at + 1), ...shared.slice(0, Math.max(at, 0))].find((qid) => qid !== ctx.data.qid && ctx.data.labeled.includes(qid));
        return ctx.actions.selectQuestion(next);
      } },
    { id: "most_changed_question", kind: "command", title: "Score the question A and B disagree on most", group: "Compare",
      help: "The shared question with the highest share of changed answers in the agreement table.",
      when: (ctx) => {
        const top = (ctx.data.agreement || []).filter((entry) => ctx.data.shared.includes(entry.qid) && num(entry.rate) !== null).sort((x, y) => y.rate - x.rate)[0];
        return idle(ctx) && !!top && top.qid !== ctx.data.qid;
      },
      run: (ctx) => ctx.actions.selectQuestion((ctx.data.agreement || []).filter((entry) => ctx.data.shared.includes(entry.qid) && num(entry.rate) !== null)
        .sort((x, y) => y.rate - x.rate)[0].qid) },
    { id: "use_a_in_build", kind: "command", title: "Use A's questions in Build", group: "Compare",
      when: (ctx) => ctx.data.variants.length > 0 && !ctx.data.running, run: (ctx) => ctx.actions.useInBuild("A") },
    { id: "use_b_in_build", kind: "command", title: "Use B's questions in Build", group: "Compare",
      when: (ctx) => ctx.data.variants.length > 0 && !ctx.data.running, run: (ctx) => ctx.actions.useInBuild("B") },
    { id: "label_disagreements", kind: "command", title: "Label missing disagreement inputs", group: "Compare",
      help: "Opens blank human-label controls in Bulk for every disagreement of this question, shown or not, after the page's confirm. Inputs only, never answers.",
      when: (ctx) => idle(ctx) && LABELABLE.includes(ctx.data.type) && !ctx.data.labeling && ctx.items().some((item) => item.differs),
      run: (ctx) => ctx.actions.labelDisagreements() },
  ],
});
