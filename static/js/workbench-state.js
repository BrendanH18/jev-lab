// The Workbench page state, shared by every workbench-*.js module, and canon(), the stable JSON key the panels
// use to tell whether a report still matches the rows, questions and labels it was made from. Imports nothing.
export const W = {
  guideOpen: false, tab: "build", stateText: "", questions: [], raw: false, result: null, exported: null, exportTab: "python",
  // Question checks (jev/lint.py): the last report for the Build request, made by code, never by the model.
  lint: null,
  items: [], examples: [], runResults: null, saveOpen: false, expect: {}, saveName: "", saveNotes: "", editingId: null,
  bulk: { rowsText: "", result: null, sortKey: null, sortDir: -1, source: "current", sampleQuestions: null, labels: {},
    // Row pictures (a row's "_image"): their image URLs by name, for thumbnails.
    pictures: {},
    // Saved datasets (data/workbench/datasets/): rows and labels only, never answers. savedText is the rows box as
    // last saved or loaded; runText is the box as last run, so typed labels merge back only into the rows they belong to.
    datasets: [], dataset: { id: null, name: "", notes: "", withQuestions: true, questions: null },
    health: { busy: false, report: null, context: null, field: null },
    prelabel: { busy: false, report: null, context: null, drafts: {}, field: null, value: null, status: "all", nextIndex: null, csvPreview: null },
    bundle: { data: null, report: null, name: "", busy: false },
    savedText: "", runText: null, labelsDirty: false,
    // ranQuestions, runModel: the questions and model the last Bulk run asked, so a check is saved for what it reruns.
    // pin: save the check and export the gate with the version that answered the run, when the run asked an alias.
    // checkForm: Policy's "Save as a check" targets as typed (percent strings; null takes a default from the run).
    // checkRuns: per dataset id, a check run in flight or its report (jev/checks.py), and the model typed to ask instead.
    // runRequest: cloned original inputs, ordered questions and requested model for session-only partial retries.
    ranQuestions: null, runModel: null, runRequest: null, pin: true, checkForm: { accuracy: null, coverage: null }, checkRuns: {},
    checkSlices: { datasetId: null, targets: null },
    // agreeRuns: per dataset id, a blind second-labeling sample, its labels, and the comparison (jev/agreement.py).
    agreeRuns: {},
    // testScore: the last report of a gate scored on the loaded dataset's test rows (jev/testsplit.py); testBusy while it runs.
    testScore: null, testBusy: false,
    // gateExport: Policy's gate or a saved check exported as a module (jev/gate.py), and the language shown.
    gateExport: null,
    // CSV import (jev/csvimport.py): the file or pasted text, the column uses chosen so far, and the server's report.
    // pending: a newer conversion is on its way; qkey: the questions the report was checked against.
    csv: { open: false, text: "", file: "", columns: {}, report: null, error: null, seq: 0, pending: false, qkey: null },
    // Prices as typed (strings), shared by Calibrate, Policy, and Holdout. jev/cost.py does the arithmetic.
    costs: { review: "2", error: "20", mistakes: [] },
    cal: { qid: null, signal: "confidence", bound: "estimate", threshold: 0.5, report: null, cost: null, holdout: null, holdoutSeq: 0 },
    policy: { signal: "confidence", bound: "estimate", gates: {}, report: null, tunes: null, cost: null, cheapest: null, holdout: null, holdoutSeq: 0,
      // prune: "Do the gates earn their place?" (POST /api/workbench/policy/prune): its target, the last report, and
      // the questions checked to leave out of a Compare request. Cleared whenever the gates, signal, bound, rules or labels change.
      prune: { target: 0.95, running: false, report: null, drop: new Set() } },
    review: { report: null, kept: new Set(), all: { suspects: false, next: false } },
    // Consistency rules (jev/rules.py) as typed, the text the last report checked, its report or error, and whether
    // Policy sends rows that break one to review. Saved with a dataset and a check.
    rules: { text: "", applied: "", checked: "", report: null, error: null, hold: true },
    // Accuracy by slice (jev/slices.py), for Calibrate at its threshold and for Policy at its gates. One field for both.
    slice: { field: null, cal: null, pol: null },
    // Answer sets (jev/answersets.py) for Calibrate's question: the coverage asked for and the last report.
    sets: { coverage: 0.9, report: null, attached: {}, context: null, result: null, fitted: null } },
  compare: { variants: [{ text: "", model: "", perturb: "", average: false }, { text: "", model: "", perturb: "", average: false }], terse: null, models: null, modelsLoading: false,
    running: false, result: null, qid: null, signal: "confidence", bound: "estimate", report: null, reportError: null, first: "A", cascadeT: 0.5 },
  loadedExample: null, images: [], samples: [], maxImages: 4,
  // The picture limits the server reported (GET /api/images/samples: min_side, max_side, max_images); null until loaded.
  imageLimits: null,
  // A demo's request opened with Open in Workbench (static/js/handoff.js): the page's name and the model it asked.
  handoff: null,
};
export const canon = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : JSON.stringify(v));
