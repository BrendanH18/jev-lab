// Starter pack for the Compare disagreement table (surface "workbench.compare.rows"; contract in
// static/js/lab/surfaces/workbench-compare.js). Everything reads the user's own Compare run through ctx and runs
// locally: no model call, no storage, nothing kept after the page session.
import { csvText, definePack } from "../../kit.js";
import { codePoints } from "../../lib/text.js";

const VERDICTS = { both_right: "both right", a_only: "only A right", b_only: "only B right", both_wrong: "both wrong" };
const SURE = 0.8;
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const pair = (item, field) => (item && Array.isArray(item[field]) ? item[field] : []);
const signalOf = (item, v) => num(pair(item, "signals")[v]);
const gap = (item) => {
  const a = signalOf(item, 0), b = signalOf(item, 1);
  return a === null || b === null ? null : Math.abs(a - b);
};
const fixed = (value) => (num(value) === null ? "" : value.toFixed(2));
// A call that answered: not failed, not skipped, with measurements.
const answeredCall = (item, v) => pair(item, "errors")[v] == null && pair(item, "skipped")[v] !== true;
// The table's result for a differing row: the verdict, or why there is none.
const resultOf = (item) => (!item?.differs ? null : VERDICTS[item.verdict] || (item.label !== null && item.label !== undefined ? "label not scored" : "no label"));

export default definePack({
  id: "wb-compare-rows",
  surface: "workbench.compare.rows",
  title: "Compare rows",
  about: "Filters, sorts, checks and exports for the rows where variants A and B answer differently. Exports hold your own Compare run's picks, signals and labels, numbered as the table's # (tuning rows sent); test rows never appear.",
  features: [
    { id: "signal_a", kind: "fact", type: "number", label: "variant A signal", help: "A's gating signal on this row under the selected signal (0 to 1).",
      value: (item) => signalOf(item, 0) },
    { id: "signal_b", kind: "fact", type: "number", label: "variant B signal", help: "B's gating signal on this row under the selected signal (0 to 1).",
      value: (item) => signalOf(item, 1) },
    { id: "signal_gap", kind: "fact", type: "number", label: "signal gap between A and B", help: "How far apart the two signals are, whichever is higher.",
      value: gap },
    { id: "row_chars", kind: "fact", type: "number", label: "row length in characters", unit: "characters", help: "Characters of the row as the table prints it.",
      value: (item) => (typeof item?.text === "string" ? codePoints(item.text) : null) },
    { id: "latency_gap", kind: "fact", type: "number", label: "latency of B minus A", unit: "ms",
      help: "Measured milliseconds of the two calls on this row; negative when B answered faster. Unavailable when either call failed or was skipped.",
      value: (item) => {
        if (!answeredCall(item, 0) || !answeredCall(item, 1)) return null;
        const meta = pair(item, "meta");
        const a = num(meta[0]?.latency_ms), b = num(meta[1]?.latency_ms);
        return a === null || b === null ? null : b - a;
      } },
    { id: "labeled", kind: "fact", type: "flag", label: "a human label", value: (item) => item?.label !== null && item?.label !== undefined },
    { id: "rewritten", kind: "fact", type: "flag", label: "a rewritten row sent to B", help: "B was sent the row with typos, lowercase, an extra sentence or shuffled fields.",
      value: (item) => pair(item, "sent")[1] != null },
    { id: "confident_split", kind: "fact", type: "flag", label: "a confident disagreement", help: `Both signals are at least ${SURE} and the picks still differ (an advisory cut, not the model's answer).`,
      value: (item) => item?.differs === true && [0, 1].every((v) => signalOf(item, v) !== null && signalOf(item, v) >= SURE) },
    { id: "orders_split", kind: "fact", type: "flag", label: "an option-order split", help: "A variant asked in both option orders picked differently in each.",
      value: (item) => pair(item, "orders").some((picks) => Array.isArray(picks) && picks[0] != null && picks[1] != null && picks[0] !== picks[1]) },
    { id: "verdict", kind: "fact", type: "category", label: "result",
      help: "The table's result badge: who matched the label, no label, or a label the report could not score.",
      value: resultOf },
    { id: "transition", kind: "fact", type: "category", label: "A pick to B pick", help: "A's pick, then B's, such as billing → shipping.",
      value: (item) => {
        const [a, b] = pair(item, "picks");
        return typeof a === "string" && typeof b === "string" ? `${a} → ${b}` : null;
      } },
    { id: "row_text", kind: "fact", type: "text", label: "row text", value: (item) => (typeof item?.text === "string" ? item.text : "") },

    { id: "b_net_wins", kind: "metric", format: "integer", label: "rows only B got right, minus rows only A got right",
      help: "Over the shown labeled disagreements. A small difference is rarely conclusive; the report's exact McNemar test says how often chance gives one.",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.some((item) => VERDICTS[item?.verdict])) return null;
        const b = shown.filter((item) => item.verdict === "b_only").length, a = shown.filter((item) => item.verdict === "a_only").length;
        return { value: b - a, detail: `B ${b}, A ${a}` };
      } },
    { id: "mean_signal_gap", kind: "metric", format: "number", label: "mean signal gap on shown rows",
      help: "The average distance between A's and B's signals on the shown rows that both answered.",
      compute: (ctx) => {
        const gaps = ctx.shown().map(gap).filter((value) => value !== null);
        return gaps.length ? { value: gaps.reduce((total, value) => total + value, 0) / gaps.length, detail: `${gaps.length} rows` } : null;
      } },

    { id: "shown_csv", kind: "exporter", label: "Shown disagreements with both answers as CSV", mime: "text/csv",
      help: "Your Compare run's picks, signals and labels for the rows shown. Row numbers are the table's # (tuning rows the run sent), not lines of the rows box.",
      filename: (ctx) => `compare-${String(ctx.data.qid || "question").replace(/[^\w-]+/g, "-")}-rows.csv`,
      build: (ctx) => csvText([["row", "input", "label", "A pick", "A signal", "B pick", "B signal", "result"],
        ...ctx.shown().map((item) => [item.number, item.text, item.label === null ? "" : typeof item.label === "object" ? JSON.stringify(item.label) : String(item.label),
          item.picks[0] ?? "", fixed(item.signals[0]), item.picks[1] ?? "", fixed(item.signals[1]), resultOf(item) ?? ""])]) },
    { id: "row_numbers", kind: "exporter", label: "Shown row numbers", filename: "compare-row-numbers.txt",
      help: "The table's # numbers (tuning rows the run sent) of the shown rows, comma separated. No inputs or answers.",
      build: (ctx) => `${ctx.shown().map((item) => `#${item.number}`).join(", ")}\n` },

    { id: "sure_but_wrong", kind: "diagnostic", severity: "advice", label: "Sure but wrong",
      help: `A variant missed the label with a signal of at least ${SURE}: an advisory cut, not Policy's gate.`,
      check: (item) => pair(item, "correct").flatMap((right, v) => (right === false && signalOf(item, v) !== null && signalOf(item, v) >= SURE
        ? [`${v ? "B" : "A"} was wrong with a signal of ${signalOf(item, v).toFixed(2)}, so a gate at ${SURE} would have automated this mistake.`] : [])) },
    { id: "small_sample", kind: "diagnostic", severity: "info", scope: "list", label: "Few labeled disagreements",
      check: (items) => {
        if (!items.length) return null;
        const labeled = items.filter((item) => VERDICTS[item?.verdict]).length;
        return labeled < 10 ? `Only ${labeled} labeled disagreement${labeled === 1 ? " is" : "s are"} shown. With fewer than 10, which variant is ahead is rarely conclusive.` : null;
      } },

    { id: "switch_signal", kind: "command", title: "Gate on the other signal", group: "Compare",
      when: (ctx) => ctx.data.qid !== null && !ctx.data.running,
      run: (ctx) => ctx.actions.setSignal(ctx.data.signal === "confidence" ? "top_probability" : "confidence") },
    { id: "next_question", kind: "command", title: "Score the next shared question", group: "Compare",
      when: (ctx) => ctx.data.qid !== null && ctx.data.shared.length > 1 && !ctx.data.running,
      run: (ctx) => {
        const shared = ctx.data.shared;
        return ctx.actions.selectQuestion(shared[(shared.indexOf(ctx.data.qid) + 1) % shared.length]);
      } },
  ],
});
