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
