// Label agreement helpers for the Workbench's Datasets panel, free of the DOM so tests/js can import them.
// jev/agreement.py draws the sample, compares the two label sets, and writes the settled labels; these only shape what
// the page sends it.

const has = (value) => value !== null && value !== undefined && value !== "";

// The second labels to compare: one item per sampled row that has at least one label, keyed by its row_id. Only the
// questions the first labels cover are sent, since only those are compared.
export function secondItems(items, labels) {
  const out = [];
  for (const item of items || []) {
    const given = labels?.[item.row_id] || {};
    const kept = Object.fromEntries(item.questions.filter((q) => has(given[q])).map((q) => [q, given[q]]));
    if (Object.keys(kept).length) out.push({ row_id: item.row_id, labels: kept });
  }
  return out;
}

// The key a settled disagreement is stored under: a row and a question.
export const settleKey = (rowId, question) => `${rowId}\u0000${question}`;

// The labels to write back: each disagreement whose settled label differs from the saved (first) one, grouped by row.
// A settled value of null removes the label; a disagreement not settled keeps the first label and is not sent.
export function settledItems(disagreements, choices) {
  const rows = new Map();
  for (const d of disagreements || []) {
    const key = settleKey(d.row_id, d.question);
    if (!choices || !Object.prototype.hasOwnProperty.call(choices, key)) continue;
    const value = choices[key];
    if (value === d.first) continue;
    if (!rows.has(d.row_id)) rows.set(d.row_id, Object.create(null));
    rows.get(d.row_id)[d.question] = has(value) ? value : null;
  }
  return [...rows].map(([row_id, labels]) => ({ row_id, labels: { ...labels } }));
}

// Recovery records explicit edits only, including false, zero, and a human removing a label.
export function sessionSettlements(choices) {
  return Object.entries(choices || {}).map(([key, value]) => {
    const at = key.indexOf("\u0000");
    return { row_id: key.slice(0, at), question: key.slice(at + 1), value };
  });
}

// Do not filter CSV-imported labels through a different random sample. The server
// must reject mismatched membership rather than export a truncated recovery file.
export function sessionItems(labels) {
  return Object.entries(labels || {}).filter(([, given]) => Object.values(given).some(has))
    .map(([row_id, given]) => ({ row_id, labels: Object.fromEntries(Object.entries(given).filter(([, value]) => has(value))) }));
}

export function changeSecondLabel(run, rowId, question, value) {
  const labels = run.labels[rowId] ||= Object.create(null);
  if (labels[question] === value) return;
  labels[question] = value;
  const changed = settleKey(rowId, question);
  const kept = new Map([...(run.pendingSettlements || []), ...sessionSettlements(run.choices)]
    .filter((item) => settleKey(item.row_id, item.question) !== changed)
    .map((item) => [settleKey(item.row_id, item.question), item]));
  run.pendingSettlements = [...kept.values()];
  run.choices = {};
  run.report = run.sessionPreview = null;
}

export function agreementEditsUnsaved(run) {
  return !!run?.sample && (sessionItems(run.labels).length > 0
    || Object.keys(run.choices || {}).length > 0 || (run.pendingSettlements || []).length > 0);
}

export function restoreAgreementEdits(result) {
  return { labels: Object.fromEntries(result.items.map((item) => [item.row_id, { ...item.labels }])),
    pendingSettlements: result.settlements.map((item) => ({ ...item })) };
}

// A restored settlement is shown only after the user explicitly compares again.
export function restoredChoices(disagreements, settlements) {
  const eligible = new Set(disagreements.map((item) => settleKey(item.row_id, item.question)));
  return Object.fromEntries((settlements || []).filter((item) => eligible.has(settleKey(item.row_id, item.question)))
    .map((item) => [settleKey(item.row_id, item.question), item.value]));
}

export function unshownSettlements(disagreements, settlements) {
  const shown = new Set(disagreements.map((item) => settleKey(item.row_id, item.question)));
  return (settlements || []).filter((item) => !shown.has(settleKey(item.row_id, item.question)));
}
