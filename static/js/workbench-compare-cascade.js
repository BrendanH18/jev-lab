// Compare's cascade controls, chart, and code preview.
import { $, copyText, h, icon, mount, ms, pct, usd } from "./common.js";
import { VARIANTS } from "./variants.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { SIGNALS, svg } from "./workbench-calibrate.js";

// Ask one variant first and the other only when the first is unsure. Both variants already answered every
// scored row, so jev/compare.py reads each threshold's accuracy, cost, and latency from those answers.
function cascadeSummary(cas, signal) {
  const [f, s] = [cas.first, cas.second];
  const fa = cas.first_alone,
    sa = cas.second_alone,
    m = cas.match,
    b = cas.best;
  const asks = (p) => `${p.escalated} of ${cas.rows} rows (${pct(p.share)})`;
  const parts = [];
  if (m && !m.escalated) {
    parts.push(
      `${f} alone is already at least as accurate as ${s} on these rows (${pct(fa.accuracy, 1)} against ${pct(sa.accuracy, 1)}).`,
    );
  } else if (m) {
    const cost =
      m.cost_usd !== null && sa.cost_usd > 0 ? `, for ${pct(m.cost_usd / sa.cost_usd)} of what ${s} alone costs` : "";
    parts.push(
      `Asking ${s} on the ${asks(m)} where ${f} is least sure matches ${s}'s accuracy, ${pct(sa.accuracy, 1)}${cost}.`,
    );
  } else {
    parts.push(
      `No threshold reaches ${s}'s accuracy (${pct(sa.accuracy, 1)}): ${f} answers some rows with a ${SIGNALS[signal]} of 1.00, and a cascade always keeps those.`,
    );
  }
  if (b.accuracy > Math.max(fa.accuracy, sa.accuracy) + 1e-9) {
    parts.push(
      `At ≥ ${b.threshold.toFixed(2)} the cascade is right more often than either variant alone: ${pct(b.accuracy, 1)}, asking ${s} on ${asks(b)}.`,
    );
  }
  return parts.join(" ");
}

export function cascadeBlock(rep, rescoreCompare) {
  const c = W.compare;
  const cas = rep.cascade;
  const [f, s] = [cas.first, cas.second];
  const order = h(
    "select",
    { class: "input", "aria-label": "Variant the cascade asks first" },
    VARIANTS.map((name, i) =>
      h("option", { value: name, selected: name === cas.first }, `${name} first, then ${VARIANTS[1 - i]}`),
    ),
  );
  order.addEventListener("change", async () => {
    c.first = order.value;
    await rescoreCompare();
    render();
  });
  const slider = h("input", {
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    value: c.cascadeT,
    id: "cas-slider",
    class: "cal-slider",
    "aria-label": `Minimum ${SIGNALS[c.signal]} for ${f} to answer alone`,
  });
  slider.addEventListener("input", () => {
    c.cascadeT = Number(slider.value);
    updateCascade();
  });
  const set = (t) => {
    c.cascadeT = t;
    updateCascade();
  };
  const m = cas.match,
    b = cas.best;
  const chips = [
    m?.escalated
      ? h(
          "button",
          { class: "chip", onclick: () => set(m.threshold) },
          `Match ${s} → ≥ ${m.threshold.toFixed(2)}, asks ${s} on ${pct(m.share)}`,
        )
      : h(
          "button",
          { class: "chip", disabled: true },
          m ? `${f} alone already matches ${s}` : `${s}'s accuracy: not reached on these rows`,
        ),
    !m || b.threshold !== m.threshold
      ? h(
          "button",
          { class: "chip", onclick: () => set(b.threshold) },
          `Most accurate, ${pct(b.accuracy, 1)} → ≥ ${b.threshold.toFixed(2)}, asks ${s} on ${pct(b.share)}`,
        )
      : null,
  ];
  const known = cas.second_alone.cost_usd !== null;
  return h(
    "div",
    { class: "grid", id: "cascade", style: { gap: "10px" } },
    h(
      "div",
      { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
      h(
        "h3",
        { class: "cal-h", style: { margin: 0 } },
        `Cascade: ask one variant first, and the other only when it is unsure · ${cas.rows} labeled rows`,
      ),
      h("div", { class: "spacer" }),
      h("div", { class: "cal-controls" }, order),
    ),
    h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px" } }, cascadeSummary(cas, c.signal)),
    h(
      "div",
      { class: "cal-gate" },
      h(
        "label",
        { for: "cas-slider" },
        `Keep ${f}'s answer when its ${SIGNALS[c.signal]} ≥ `,
        h("b", { id: "cas-value", class: "mono" }),
      ),
      slider,
    ),
    h("div", { class: "chips" }, chips),
    h("div", { id: "cas-table", class: "scroll" }),
    h(
      "div",
      { class: "cal-chart-wrap" },
      h(
        "div",
        { class: "cal-legend" },
        h("span", {}, h("i", { class: "cal-key cas" }), `Cascade accuracy as more rows go to ${s}`),
        h("span", {}, h("i", { class: `cmp-key ${f.toLowerCase()}` }), `${f} alone`),
        h("span", {}, h("i", { class: `cmp-key ${s.toLowerCase()}` }), `${s} alone`),
      ),
      h("div", { id: "cas-chart" }),
    ),
    h(
      "div",
      { class: "code" },
      h("pre", { id: "cas-code" }),
      h("button", { class: "btn sm copy", onclick: () => copyText($("#cas-code").textContent) }, icon("copy"), "Copy"),
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", maxWidth: "820px" } },
      `Moving the threshold makes no calls. ${
        known
          ? `Cost counts ${f}'s call on every row and ${s}'s call on each escalated row, and each call asks all of its variant's questions. Latency adds both calls, because the second waits for the first.`
          : "Cost and latency are not shown, because some rows have no usage."
      }`,
    ),
  );
}

function cascadeTable(cas, p) {
  const [f, s] = [cas.first, cas.second];
  const n = cas.rows;
  const row = (label, x, escalated) =>
    h(
      "tr",
      {},
      h("th", {}, label),
      h("td", {}, `${pct(x.accuracy, 1)} (${x.correct}/${n})`),
      h("td", {}, escalated),
      h("td", {}, x.cost_usd === null ? "—" : usd((x.cost_usd / n) * 1000)),
      h("td", {}, x.latency_ms === null ? "—" : ms(x.latency_ms)),
    );
  return h(
    "table",
    { class: "table cmp-table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", {}),
        h("th", {}, "accuracy"),
        h("th", {}, `rows sent to ${s}`),
        h("th", {}, "cost per 1,000 rows"),
        h("th", {}, "mean latency"),
      ),
    ),
    h(
      "tbody",
      {},
      row(`${f} alone`, cas.first_alone, "none"),
      row(h("b", {}, `Cascade at ≥ ${p.threshold.toFixed(2)}`), p, `${p.escalated} · ${pct(p.share)}`),
      row(`${s} alone`, cas.second_alone, "all"),
    ),
  );
}

function cascadeCode(rep, res, t) {
  const cas = rep.cascade;
  const [fi, si] = [VARIANTS.indexOf(cas.first), VARIANTS.indexOf(cas.second)];
  const key = JSON.stringify(W.compare.qid);
  const qs = (i) => `questions_${VARIANTS[i].toLowerCase()}`;
  const call = (i) => `client.system_one(state, ${qs(i)}, model=${JSON.stringify(res.variants[i].model)})`;
  let read, gate;
  if (rep.type === "noul") {
    read = `p = first.nouls[${key}].noul`;
    gate = rep.signal === "confidence" ? "abs(2 * p - 1)" : "max(p, 1 - p)";
  } else {
    read = `answer = first.${rep.type === "choice" ? "choices" : "scores"}[${key}]`;
    gate =
      rep.signal === "confidence"
        ? "answer.confidence"
        : rep.type === "choice"
          ? "answer.probabilities[answer.choice]"
          : "max(answer.probabilities.values())";
  }
  return (
    `# ${qs(fi)} and ${qs(si)} are variant ${cas.first}'s and ${cas.second}'s questions; Build's Export writes them as Python.\n` +
    `first = ${call(fi)}\n${read}\nif ${gate} + 1e-9 >= ${t.toFixed(2)}:  # the report's tolerance for float rounding\n    result = first\nelse:\n    result = ${call(si)}\n`
  );
}

// Refresh the parts that follow the cascade threshold without rebuilding the slider under the pointer.
export function updateCascade() {
  const c = W.compare;
  const rep = c.report;
  if (!rep?.cascade || !$("#cas-table")) return;
  const t = c.cascadeT;
  const p = rep.cascade.sweep[Math.round(t * 100)];
  const slider = $("#cas-slider");
  if (slider && Number(slider.value) !== t) slider.value = t;
  mount("#cas-value", t.toFixed(2));
  mount("#cas-table", cascadeTable(rep.cascade, p));
  mount("#cas-chart", cascadeChart(rep.cascade, p));
  $("#cas-code").textContent = cascadeCode(rep, c.result, t);
}

// Accuracy against the share of rows sent to the second variant. The line runs from the first variant
// alone (nothing escalated) to the second alone (everything escalated); the dot is the chosen threshold.
function cascadeChart(cas, p) {
  const seen = new Map();
  for (const q of cas.sweep) if (!seen.has(q.escalated)) seen.set(q.escalated, q); // lowest threshold first
  const pts = [...seen.values()].sort((x, y) => x.share - y.share);
  const W_ = Math.max(320, Math.round($("#cas-chart")?.clientWidth || 640)),
    H_ = 240,
    m = { l: 46, r: 18, t: 22, b: 40 };
  const iw = W_ - m.l - m.r,
    ih = H_ - m.t - m.b;
  const ends = [cas.first_alone.accuracy, cas.second_alone.accuracy];
  const lowest = Math.min(1, ...pts.map((q) => q.accuracy), ...ends);
  const y0 = Math.max(0, Math.min(0.5, Math.floor(lowest * 10) / 10));
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - (v - y0) / (1 - y0)) * ih;
  const grid = [y0, (y0 + 1) / 2, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v)),
  ]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, pct(v)),
  );
  const d = pts.map((q, i) => `${i ? "L" : "M"}${x(q.share).toFixed(1)},${y(q.accuracy).toFixed(1)}`).join("");
  const [f, s] = [cas.first.toLowerCase(), cas.second.toLowerCase()];
  const right = p.share > 0.6;
  const root = svg(
    "svg",
    {
      viewBox: `0 0 ${W_} ${H_}`,
      width: W_,
      height: H_,
      class: "cal-chart",
      role: "img",
      "aria-label": `Cascade accuracy against the share of rows sent to ${cas.second}. ${cas.first} alone ${pct(ends[0])}, ${cas.second} alone ${pct(ends[1])}. At ≥ ${p.threshold.toFixed(2)}: ${pct(p.share)} sent, ${pct(p.accuracy)} accurate.`,
    },
    grid,
    ticks,
    svg(
      "text",
      { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" },
      `share of labeled rows sent to ${cas.second}`,
    ),
    svg("line", { x1: x(p.share), x2: x(p.share), y1: m.t, y2: m.t + ih, class: "cal-marker" }),
    svg("path", { d, class: "cal-line cas" }),
    svg("circle", { cx: x(0), cy: y(ends[0]), r: 4, class: `cal-dot ${f}` }),
    svg("circle", { cx: x(1), cy: y(ends[1]), r: 4, class: `cal-dot ${s}` }),
    svg("circle", { cx: x(p.share), cy: y(p.accuracy), r: 5, class: "cal-dot cas" }),
    // Accuracy usually sits near the top, where the line runs flat: label below the dot there, above it lower down.
    svg(
      "text",
      {
        x: x(p.share) + (right ? -10 : 10),
        y: y(p.accuracy) + (y(p.accuracy) < m.t + ih / 2 ? 20 : -9),
        "text-anchor": right ? "end" : "start",
        class: "cal-label",
      },
      `${pct(p.accuracy, 1)} accurate · ${pct(p.share)} sent`,
    ),
  );
  return root;
}
