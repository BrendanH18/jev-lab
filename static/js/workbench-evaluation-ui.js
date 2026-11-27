// Chart and interval controls shared by Calibrate, Policy, and Compare.
import { h, pct } from "./common.js";
import { render } from "./workbench.js";

const SVGNS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  for (const c of children.flat(Infinity))
    if (c !== null && c !== undefined && c !== false)
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
export const SIGNALS = { confidence: "confidence", top_probability: "top probability" };
// What must reach a target accuracy: the accuracy measured on these rows, or its 95% lower bound (jev/calibrate.py).
const BOUNDS = { estimate: "targets on these rows", lower: "targets at 95% confidence" };

export function boundSelect(state, onChange) {
  const sel = h(
    "select",
    { class: "input", "aria-label": "What must reach a target accuracy" },
    Object.entries(BOUNDS).map(([k, label]) => h("option", { value: k, selected: k === state.bound }, label)),
  );
  sel.addEventListener("change", async () => {
    state.bound = sel.value;
    await onChange();
    render();
  });
  return sel;
}
// A 95% interval as "81–97%", or "" when there is nothing to measure.
export const interval = (lo, hi) => (lo === null || lo === undefined ? "" : `${pct(lo)}–${pct(hi)}`);
export const withCI = (value, lo, hi) =>
  lo === null || lo === undefined
    ? value
    : [value, h("span", { class: "ci", title: "95% interval" }, ` ${interval(lo, hi)}`)];
