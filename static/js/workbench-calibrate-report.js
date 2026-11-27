// Calibrate's analysis reports: probability maps, answer diagnostics and the threshold sweep.
import { $, api, copyText, h, icon, mount, pct, stat } from "./common.js";
import { W } from "./workbench-state.js";
import { tuningResults } from "./workbench-bulk.js";
import { rowText } from "./workbench-bulk-inputs.js";
import { svg, SIGNALS, interval, withCI } from "./workbench-evaluation-ui.js";

// Recalibrate probability values, independently of the routing thresholds above.
export function probabilityMapsPanel(currentRevision) {
  const c = W.bulk.cal;
  const box = h("section", { id: "recalibrate", class: "grid", style: { gap: "10px" } });
  const button = h(
    "button",
    {
      class: "btn sm",
      onclick: async () => {
        button.disabled = true;
        const seq = currentRevision();
        const rows = tuningResults(W.bulk.result)
          .filter((r) => r.answers[c.qid])
          .map((r) => ({
            index: r.index,
            row: r.row,
            key: rowText(r.row),
            answer: r.answers[c.qid],
            label: W.bulk.labels[r.index]?.[c.qid] ?? null,
          }));
        try {
          const rep = await api("/api/workbench/recalibrate", { rows, signal: c.signal });
          if (seq !== currentRevision() || !box.isConnected) return;
          output.replaceChildren(probabilityMapsReport(rep));
        } catch (e) {
          if (seq === currentRevision() && box.isConnected)
            output.replaceChildren(h("p", { class: "muted" }, e.message));
        } finally {
          button.disabled = false;
        }
      },
    },
    "Fit and check probability maps",
  );
  const output = h("div", { class: "grid", style: { gap: "10px" }, "aria-live": "polite" });
  box.append(
    h("h3", {}, "Recalibrate probabilities"),
    h(
      "p",
      { class: "muted" },
      "Map the selected signal to the chance the answer is right, for code that uses that chance itself: the expected cost of acting on an answer, a product of two answers' chances of being right, or a chance shown to a person. It is not P(yes) or a class probability, so do not put it in a weighted sum of P(yes) values such as Shield's. This does not tune routing: thresholds already use measured accuracy. Confidence can be a margin rather than a probability; the selected signal is mapped to the chance the prediction is right. At least 20 labeled rows with both right and wrong answers; no extra model calls.",
    ),
    button,
    output,
  );
  return box;
}
function probabilityMapsReport(rep) {
  const chosen = rep.recommendation;
  const names = { raw: "Raw", platt: "Platt", isotonic: "Isotonic" };
  const table = h(
    "table",
    { class: "table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ["Method", "Fit ECE", "Fit Brier", "Fit log loss", "CV ECE", "CV Brier", "CV log loss"].map((s) =>
          h("th", {}, s),
        ),
      ),
    ),
    h(
      "tbody",
      {},
      Object.entries(rep.methods).map(([name, m]) =>
        h(
          "tr",
          {},
          h("td", {}, names[name]),
          ...[m.fit.ece, m.fit.brier, m.fit.log_loss, m.cv.ece, m.cv.brier, m.cv.log_loss].map((v) =>
            h("td", { class: "mono" }, v.toFixed(4)),
          ),
        ),
      ),
    ),
  );
  const chart = svg(
    "svg",
    {
      viewBox: "0 0 340 260",
      role: "img",
      "aria-label": "Cross-validated reliability: stated probability versus observed correctness",
      style: "width:100%;max-width:440px",
    },
    svg("line", { x1: 40, y1: 220, x2: 300, y2: 20, stroke: "currentColor", "stroke-dasharray": "4 4" }),
    svg("path", { d: "M40 20V220H300", fill: "none", stroke: "currentColor" }),
    svg("text", { x: 90, y: 250, fill: "currentColor", "font-size": 11 }, "Stated probability (0–1)"),
    svg("text", { x: 45, y: 12, fill: "currentColor", "font-size": 11 }, "Observed correctness (0–1)"),
  );
  for (const [name, color] of [
    ["raw", "#df9550"],
    [chosen, "#63b6cd"],
  ]) {
    const bins = rep.methods[name].cv.reliability;
    chart.append(
      svg("polyline", {
        points: bins.map((b) => `${40 + b.stated * 260},${220 - b.observed * 200}`).join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": 2,
      }),
    );
    for (const b of bins)
      chart.append(svg("circle", { cx: 40 + b.stated * 260, cy: 220 - b.observed * 200, r: 3, fill: color }));
  }
  const code = rep.methods[chosen].source;
  return h(
    "div",
    { class: "grid", style: { gap: "10px" } },
    h(
      "p",
      {},
      `${chosen === "raw" ? "Keep raw" : `Recommend ${names[chosen]}`}: lowest five-fold cross-validated log loss, requiring an improvement of at least ${rep.margin.toFixed(3)} over raw. ${rep.labeled} labeled rows. Fitting numbers never select the map.`,
    ),
    h("div", { class: "scroll" }, table),
    chart,
    h(
      "p",
      { class: "muted" },
      `Cross-validated reliability: raw (orange), ${names[chosen]} (blue), ideal (dashed). These are predictions from maps fitted without each row. The copied map is refitted on all tuning rows. A flat part can merge distinct signals; keep routing on raw signals and existing thresholds.`,
    ),
    h(
      "details",
      {},
      h("summary", {}, "Reliability tables (fit and cross-validated)"),
      Object.entries(rep.methods).map(([name, m]) =>
        h(
          "div",
          {},
          h("h4", {}, names[name]),
          ["fit", "cv"].map((part) =>
            h(
              "div",
              {},
              h("p", {}, part === "fit" ? "Fitting rows" : "Cross-validated rows"),
              reliabilityTable({ ...m[part], probabilityMap: true }),
            ),
          ),
        ),
      ),
    ),
    ["python", "javascript"].map((lang) =>
      h(
        "div",
        { class: "code" },
        h("pre", {}, code[lang]),
        h(
          "button",
          { class: "btn sm copy", onclick: () => copyText(code[lang]) },
          icon("copy"),
          lang === "python" ? "Copy Python" : "Copy JavaScript",
        ),
      ),
    ),
  );
}

// A Score's levels are ordered, so say how far off its answers are, and which cut on the expected score
// (the weighted .score) best decides "at least level k" on these rows (jev/calibrate.py ordinal()).
export function ordinalBlock(o, qid) {
  const key = JSON.stringify(qid);
  return h(
    "div",
    { class: "grid", style: { gap: "10px" } },
    h("h3", { class: "cal-h" }, "How far off: Score levels are ordered"),
    h(
      "div",
      { class: "stat-row" },
      stat("within one level", withCI(pct(o.within_one_accuracy, 1), o.within_one_low, o.within_one_high)),
      stat("mean error, most likely level", `${o.mean_error.toFixed(2)} levels`),
      stat("mean error, expected score", o.expected_error === null ? "—" : `${o.expected_error.toFixed(2)} levels`),
    ),
    o.cuts.length
      ? h(
          "div",
          { class: "scroll" },
          h(
            "table",
            { class: "table" },
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                h("th", {}, "to flag a label of"),
                h("th", {}, "act when the expected score is"),
                h("th", {}, "accuracy, every row"),
                h("th", {}, "flagged"),
                h("th", {}, "labeled at that level or above"),
              ),
            ),
            h(
              "tbody",
              {},
              o.cuts.map((c) =>
                h(
                  "tr",
                  {},
                  h("td", {}, `${c.level} or above`),
                  h("td", { class: "mono" }, `≥ ${c.cut.toFixed(2)}`),
                  h("td", {}, withCI(`${pct(c.accuracy, 1)} (${c.correct}/${c.rows})`, c.low, c.high)),
                  h("td", {}, String(c.flagged)),
                  h("td", {}, String(c.actual)),
                ),
              ),
            ),
          ),
        )
      : null,
    o.cuts.length
      ? h(
          "p",
          { class: "faint", style: { fontSize: "12.5px" } },
          "An application often acts on the expected score rather than one level, for example ",
          h("code", {}, `result.scores[${key}].score >= ${o.cuts[o.cuts.length - 1].cut.toFixed(2)}`),
          ". Each cut is the one on a 0.05 grid that agrees best with the labels on these rows, so its accuracy is optimistic until you check it on rows it was not chosen on. The coarse grid keeps a cut from fitting the gap between two rows.",
        )
      : null,
  );
}

export function confusionTable(rep) {
  const max = Math.max(1, ...rep.confusion.flat());
  return h(
    "div",
    { class: "scroll" },
    h("h3", { class: "cal-h" }, "Confusion: label ↓, Jev's answer →"),
    h(
      "table",
      { class: "table confusion" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}),
          rep.classes.map((k) => h("th", {}, k)),
        ),
      ),
      h(
        "tbody",
        {},
        rep.classes.map((k, i) =>
          h(
            "tr",
            {},
            h("th", {}, k),
            rep.confusion[i].map((count, j) =>
              h(
                "td",
                {
                  class: i === j ? "diag" : "",
                  title: `label ${k}, answered ${rep.classes[j]}: ${count}`,
                  style: count
                    ? {
                        background: `color-mix(in srgb, var(--series) ${Math.round(12 + (count / max) * 40)}%, transparent)`,
                      }
                    : {},
                },
                count ? String(count) : "·",
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export function reliabilityTable(rep) {
  const noul = rep.type === "noul";
  return h(
    "div",
    { class: "scroll" },
    h(
      "h3",
      { class: "cal-h" },
      rep.probabilityMap
        ? "When the mapped signal states…, the prediction is right…"
        : noul
          ? "When Jev says P(yes) is…, the label is yes…"
          : rep.type === "box"
            ? "When Jev's confidence is…, the box is right…"
            : "When Jev's top probability is…, it is right…",
    ),
    h(
      "table",
      { class: "table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h(
            "th",
            {},
            rep.probabilityMap ? "signal" : noul ? "P(yes)" : rep.type === "box" ? "confidence" : "top probability",
          ),
          h("th", {}, "rows"),
          h("th", {}, "average stated"),
          h("th", {}, noul ? "label yes" : "right"),
        ),
      ),
      h(
        "tbody",
        {},
        rep.reliability.map((bin) =>
          h(
            "tr",
            {},
            h("td", { class: "mono" }, `${pct(bin.lo)}–${pct(bin.hi)}`),
            h("td", {}, String(bin.count)),
            h("td", {}, pct(bin.stated)),
            h("td", {}, `${pct(bin.observed)} (${bin.hits}/${bin.count})`),
          ),
        ),
      ),
    ),
  );
}

export function calCode(rep, qid, signal, t) {
  // Fixed local names: a question id such as "level" must not shadow the answer.
  const key = JSON.stringify(qid);
  if (rep.type === "box")
    return `answer = result.boxes[${key}]\nif answer.confidence >= ${t.toFixed(2)}:\n    act_on(answer.box)  # left, top, right, bottom as fractions\nelse:\n    send_to_review()\n`;
  if (rep.type === "noul") {
    const hi = Math.max(0.5, signal === "confidence" ? (1 + t) / 2 : t);
    return `p = result.nouls[${key}].noul\nif p >= ${hi.toFixed(3)}:\n    act_on_yes()\nelif p <= ${(1 - hi).toFixed(3)}:\n    act_on_no()\nelse:\n    send_to_review()\n`;
  }
  const field = rep.type === "choice" ? "choices" : "scores";
  const gate =
    signal === "confidence"
      ? "answer.confidence"
      : rep.type === "choice"
        ? "answer.probabilities[answer.choice]"
        : "max(answer.probabilities.values())";
  if (rep.type === "choice")
    return `answer = result.${field}[${key}]\nif ${gate} >= ${t.toFixed(2)}:\n    act_on(answer.choice)\nelse:\n    send_to_review()\n`;
  // Calibrate scored the most likely level, so the gate acts on that level, not the weighted .score.
  return `answer = result.${field}[${key}]\nlevel = int(max(answer.probabilities, key=answer.probabilities.get))\nif ${gate} >= ${t.toFixed(2)}:\n    act_on(level)\nelse:\n    send_to_review()\n`;
}

export function calChart(rep, t, signal, setThreshold) {
  // Drawn at the container's pixel width so text and strokes stay their real size.
  const W_ = Math.max(320, Math.round($("#cal-chart")?.clientWidth || 640)),
    H_ = 250,
    m = { l: 42, r: 14, t: 12, b: 40 };
  const iw = W_ - m.l - m.r,
    ih = H_ - m.t - m.b;
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - v) * ih;
  const line = (key) => {
    let d = "",
      pen = false;
    for (const p of rep.sweep) {
      if (p[key] === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.threshold).toFixed(1)},${y(p[key]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  // The interval as one closed shape per run of thresholds that automate at least one row.
  const band = () => {
    let d = "";
    let run = [];
    const flush = () => {
      if (run.length) {
        d += run.map((q, i) => `${i ? "L" : "M"}${x(q.threshold).toFixed(1)},${y(q.high).toFixed(1)}`).join("");
        d +=
          run
            .slice()
            .reverse()
            .map((q) => `L${x(q.threshold).toFixed(1)},${y(q.low).toFixed(1)}`)
            .join("") + "Z";
      }
      run = [];
    };
    for (const q of rep.sweep) {
      if (q.low === null) flush();
      else run.push(q);
    }
    flush();
    return d;
  };
  const p = rep.sweep[Math.round(t * 100)];
  const grid = [0, 0.5, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v)),
  ]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, v.toFixed(2)),
  );
  const marks = [];
  const labels = [];
  const right = t > 0.62;
  const anchor = right ? "end" : "start";
  const lx = x(t) + (right ? -10 : 10);
  const yc = y(p.coverage);
  const ya = p.accuracy === null ? null : y(p.accuracy);
  let lyc = yc,
    lya = ya;
  if (ya !== null && Math.abs(ya - yc) < 15) {
    const mid = (ya + yc) / 2;
    const up = ya <= yc;
    lya = mid + (up ? -8 : 8);
    lyc = mid + (up ? 8 : -8);
  }
  marks.push(svg("circle", { cx: x(t), cy: yc, r: 4, class: "cal-dot cov" }));
  labels.push(
    svg("text", { x: lx, y: lyc + 4, "text-anchor": anchor, class: "cal-label" }, `${pct(p.coverage)} automated`),
  );
  if (ya !== null) {
    marks.push(svg("circle", { cx: x(t), cy: ya, r: 4, class: "cal-dot acc" }));
    labels.push(
      svg("text", { x: lx, y: lya + 4, "text-anchor": anchor, class: "cal-label" }, `${pct(p.accuracy)} accurate`),
    );
  }
  const hair = svg("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: "cal-hair", visibility: "hidden" });
  const hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "cal-hit" });
  const root = svg(
    "svg",
    {
      viewBox: `0 0 ${W_} ${H_}`,
      width: W_,
      height: H_,
      class: "cal-chart",
      role: "img",
      "aria-label": `Automated share and accuracy by threshold. At ${t.toFixed(2)}: ${pct(p.coverage)} automated, ${p.accuracy === null ? "none" : `${pct(p.accuracy)} accurate, 95% interval ${interval(p.low, p.high)}`}.`,
    },
    grid,
    ticks,
    svg(
      "text",
      { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" },
      `${SIGNALS[signal]} threshold`,
    ),
    svg("path", { d: band(), class: "cal-band" }),
    svg("line", { x1: x(t), x2: x(t), y1: m.t, y2: m.t + ih, class: "cal-marker" }),
    svg("path", { d: line("coverage"), class: "cal-line cov" }),
    svg("path", { d: line("accuracy"), class: "cal-line acc" }),
    hair,
    marks,
    labels,
    hit,
  );
  const at = (e) => {
    const box = root.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W_;
    return Math.min(1, Math.max(0, Math.round(((px - m.l) / iw) * 100) / 100));
  };
  hit.addEventListener("pointermove", (e) => {
    const v = at(e);
    const q = rep.sweep[Math.round(v * 100)];
    hair.setAttribute("x1", x(v));
    hair.setAttribute("x2", x(v));
    hair.setAttribute("visibility", "visible");
    const tip = $("#cal-tip");
    const wrap = tip.parentElement.getBoundingClientRect();
    mount(
      tip,
      h("div", { class: "faint mono" }, `threshold ${v.toFixed(2)}`),
      h("div", {}, h("i", { class: "cal-key cov" }), h("b", {}, pct(q.coverage)), ` automated (${q.automated})`),
      h(
        "div",
        {},
        h("i", { class: "cal-key acc" }),
        h("b", {}, q.accuracy === null ? "—" : pct(q.accuracy)),
        " accurate",
      ),
      q.low === null
        ? null
        : h("div", {}, h("i", { class: "cal-key band" }), `95% interval ${interval(q.low, q.high)}`),
      h("div", { class: "faint" }, "click to set"),
    );
    tip.hidden = false;
    const left = e.clientX - wrap.left + 14;
    tip.style.left = `${Math.min(left, wrap.width - 190)}px`;
    tip.style.top = `${e.clientY - wrap.top + 10}px`;
  });
  hit.addEventListener("pointerleave", () => {
    hair.setAttribute("visibility", "hidden");
    $("#cal-tip").hidden = true;
  });
  hit.addEventListener("click", (e) => setThreshold(at(e)));
  return root;
}
