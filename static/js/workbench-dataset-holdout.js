// jev/testsplit.py marks a random share of a dataset's labeled rows "_test": true. The marker never reaches the model,
// no tuning panel or Compare reads those rows, and their answers stay hidden in the results table. Scoring Policy's gate
// on them is a deliberate step the dataset file counts, since every look at a test result can steer the next choice.
import { api, h, handleError, icon, pct, stat, toast } from "./common.js";
import { W, canon } from "./workbench-state.js";
import { render } from "./workbench.js";
import { bulkUnsaved } from "./workbench-bulk-inputs.js";
import { isTest } from "./workbench-bulk.js";
import { withCI } from "./workbench-evaluation-ui.js";
import { loadDataset } from "./workbench-datasets.js";
import { activeGates, policyRules, policyRows, updatePolicy } from "./workbench-policy.js";
import { confirmReviewDiscard } from "./workbench-review.js";

export function testControl(x) {
  if (x.test) {
    const looks = x.test.looks;
    return [
      h(
        "span",
        {
          class: "badge",
          style: { whiteSpace: "normal", maxWidth: "100%", overflowWrap: "anywhere" },
          title: "Rows held out of every tuning panel and Compare. Score a gate on them from Policy.",
        },
        `test: ${x.test.rows} rows · ${x.test.labeled} labeled (${pct(x.test.share, 1)} of labeled rows) · ${looks} look${looks === 1 ? "" : "s"}`,
      ),
      h("button", { class: "btn sm ghost", onclick: () => removeTest(x.id) }, "Remove test split"),
    ];
  }
  // The server finds the closest feasible share; whole groups must leave two labeled rows on each side.
  const shares = x.labeled >= 4 ? [0.2, 0.25, 0.33] : [];
  if (!shares.length) return null;
  const sel = h(
    "select",
    { class: "input sm", "aria-label": `Hold out test rows from ${x.id}`, style: { width: "auto" } },
    h("option", { value: "" }, "Hold out test rows…"),
    shares.map((share) =>
      h("option", { value: String(share) }, `About ${Math.round(share * 100)}% of ${x.labeled} labeled rows`),
    ),
  );
  sel.addEventListener("change", () => {
    if (sel.value) lockTest(x.id, Number(sel.value));
    sel.value = "";
  });
  return sel;
}

// The dataset file changed under the rows box: reload it, and drop a run whose rows no longer match the file.
async function reloadAfterSplit(id) {
  const b = W.bulk;
  b.datasets = (await api("/api/workbench/datasets")).datasets;
  if (b.dataset.id === id) {
    b.savedText = b.rowsText; // nothing unsaved here: the caller checked, so the reload need not ask
    b.labelsDirty = false;
    await loadDataset(id);
    b.result = null;
    b.testScore = null;
  }
  render();
}

async function lockTest(id, share) {
  if (!confirmReviewDiscard(id)) return;
  const b = W.bulk;
  if (b.dataset.id === id && bulkUnsaved())
    return toast("Save the rows and labels first: the split is drawn from the saved file.", "error");
  if (
    !confirm(
      `Hold out about ${Math.round(share * 100)}% of the labeled rows in “${id}” as test rows?\n\n` +
        "Exact duplicate inputs stay together, including unlabeled copies. Groups are drawn at random to get as close as possible to that share, with at least two labeled rows on each side. The actual share can differ. Picture names count as part of the input; similar wording is not grouped.\n\n" +
        "No tuning panel or Compare will read test rows, and their answers stay hidden. Score a gate on them from Policy when you have chosen it; each score is counted.",
    )
  )
    return;
  try {
    const { dataset } = await api("/api/workbench/datasets/test/lock", { id, share });
    await reloadAfterSplit(id);
    toast(
      `${dataset.test.rows} test rows · ${dataset.test.labeled} labeled (${pct(dataset.test.share, 1)} of labeled rows).${b.dataset.id === id ? " Run the rows again to get answers." : ""}`,
    );
  } catch (e) {
    handleError(e);
  }
}

async function removeTest(id) {
  if (!confirmReviewDiscard(id)) return;
  const b = W.bulk;
  if (b.dataset.id === id && bulkUnsaved())
    return toast("Save the rows and labels first: removing the split rewrites the saved file.", "error");
  if (
    !confirm(
      `Put the test rows of “${id}” back among the rest, and forget how often they were scored? Tuning will then read them, so they can no longer give an unbiased number.`,
    )
  )
    return;
  try {
    await api("/api/workbench/datasets/test/remove", { id });
    await reloadAfterSplit(id);
  } catch (e) {
    handleError(e);
  }
}

// The policy a test score measured: a score shows only while Policy still has these gates, signal, and rules.
const testPolicyKey = () => canon({ gates: activeGates(), signal: W.bulk.policy.signal, rules: policyRules() });

function testBlocker(tests) {
  const b = W.bulk;
  const d = b.dataset;
  if (!d.id || !b.datasets.find((x) => x.id === d.id)?.test)
    return "These rows carry test markers, but no saved dataset with a test split is loaded. Load the dataset to score its test rows.";
  if (bulkUnsaved() || b.runText !== b.savedText)
    return `Run the rows saved in “${d.name}” unchanged: the score is recorded in that file.`;
  if (tests.some((r) => !r.answers))
    return "Some test rows got no answer. Run the rows again: a gate is scored on every test row or not at all.";
  return null;
}

export function testBody(rep) {
  const b = W.bulk;
  const tests = b.result.results.filter(isTest);
  if (!tests.length) return [];
  const title = h("h3", { class: "cal-h" }, "Test rows");
  const blocker = testBlocker(tests);
  if (blocker) return [title, h("p", { class: "faint", style: { fontSize: "12.5px" } }, blocker)];
  const looks = b.datasets.find((x) => x.id === b.dataset.id).test.looks;
  const gates = activeGates();
  const s = b.testScore?.key === testPolicyKey() ? b.testScore.report : null; // never beside a gate it did not measure
  return [
    title,
    h(
      "p",
      { class: "faint", style: { fontSize: "12.5px" } },
      `Everything above was measured on the ${rep.labeled} labeled rows that tuning reads, so it favors choices that fit them. The ${tests.length} test rows were held out of all of it. `,
      "Score the gate on them once you have chosen it: the result is what to expect on rows nobody tuned on. Each score is counted in the dataset, and only per-question accuracy is shown, not which rows were wrong, so the test rows cannot be fixed one by one.",
    ),
    h(
      "div",
      { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h(
        "button",
        { class: "btn sm", disabled: b.testBusy || !Object.keys(gates).length, onclick: scoreTest },
        b.testBusy
          ? [h("span", { class: "spin" }), " Scoring…"]
          : [icon("eye"), `Score this gate on ${tests.length} test rows · look ${looks + 1}`],
      ),
      looks
        ? h(
            "span",
            { class: "faint", style: { fontSize: "12px" } },
            `${looks} earlier look${looks === 1 ? "" : "s"} at these rows`,
          )
        : null,
    ),
    s ? testReport(s, rep) : null,
  ];
}

async function scoreTest() {
  const b = W.bulk;
  const tests = b.result.results.filter(isTest);
  const blocker = testBlocker(tests);
  if (blocker) return toast(blocker, "error");
  const looks = b.datasets.find((x) => x.id === b.dataset.id).test.looks;
  if (
    looks &&
    !confirm(
      `These test rows were scored ${looks} time${looks === 1 ? "" : "s"} before. If an earlier score changed the gate, the test rows helped choose it, and this score is optimistic too. Score again?`,
    )
  )
    return;
  const gates = activeGates();
  const key = testPolicyKey();
  b.testBusy = true;
  updatePolicy();
  try {
    const report = await api("/api/workbench/datasets/test/score", {
      id: b.dataset.id,
      rows: policyRows(Object.keys(gates), tests),
      gates,
      signal: b.policy.signal,
      rules: policyRules() || undefined,
      model: b.runModel || undefined,
    });
    b.testScore = { key, report };
    b.datasets = (await api("/api/workbench/datasets")).datasets;
  } catch (e) {
    handleError(e);
  }
  b.testBusy = false;
  render();
}

function testReport(s, rep) {
  const gatesText = Object.entries(s.gates)
    .map(([q, v]) => `${q} ≥ ${v.toFixed(2)}`)
    .join(" · ");
  const vs = (value) => (value === null ? "—" : pct(value, 1));
  return h(
    "div",
    { class: "check-report grid", style: { gap: "8px" } },
    h(
      "div",
      { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${s.look === 1 ? "good" : "warning"}` }, icon("eye"), `look ${s.look}`),
      h("span", { class: "mono faint", style: { fontSize: "12px" } }, gatesText),
    ),
    h(
      "div",
      { class: "stat-row" },
      stat(
        "accuracy when automated, test rows",
        s.accuracy === null ? "nothing automated" : withCI(pct(s.accuracy, 1), s.accuracy_low, s.accuracy_high),
      ),
      stat("on the tuning rows", vs(rep.accuracy)),
      stat("automated, test rows", `${s.automated} of ${s.labeled} · ${pct(s.coverage)}`),
      stat("on the tuning rows", pct(rep.coverage)),
    ),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "gated question"), h("th", {}, "accuracy on every test row"))),
        h(
          "tbody",
          {},
          s.questions.map((q) =>
            h(
              "tr",
              {},
              h("td", { class: "mono" }, q.qid),
              h("td", {}, q.accuracy === null ? "—" : withCI(pct(q.accuracy, 1), q.accuracy_low, q.accuracy_high)),
            ),
          ),
        ),
      ),
    ),
    s.unlabeled || s.invalid.length || s.skipped
      ? h(
          "p",
          { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
          `${s.unlabeled + s.invalid.length + s.skipped} test rows lack a usable label or answer for a gated question and are not scored.`,
        )
      : null,
    s.look > 1
      ? h(
          "p",
          { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
          icon("eye"),
          ` This is look ${s.look} at these rows. A gate or wording changed after an earlier look was chosen partly on them, so this number is optimistic too. For an unbiased one, label new rows and hold them out.`,
        )
      : null,
  );
}
