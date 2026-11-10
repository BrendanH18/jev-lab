// Partial Bulk runs live only in the current page. Retrying replaces unanswered positions;
// successful calls and human labels are never sent back as cached model answers.

export function bulkRetryContext(request) {
  // Preserve ordered question/Choice keys. Sorting them would hide a changed request.
  return JSON.stringify([request.rowsText, request.questions, request.model, request.source, request.datasetId]);
}

export function unansweredBulkIndices(result) {
  return (result?.results || []).filter((row) => !row.answers).map((row) => row.index);
}

export function bulkRetryPlan(result, request, current) {
  const indices = unansweredBulkIndices(result);
  const refuse = (reason) => ({ indices, reason, body: null });
  if (!indices.length) return refuse("");
  if (!request || !request.model) return refuse("Run the full batch again to record its request and model.");
  if (current.error || bulkRetryContext(request) !== bulkRetryContext(current)) {
    return refuse("Rows, questions, or model configuration changed. Restore the original request or run the full batch again.");
  }
  const answered = result.results.filter((row) => row.answers);
  const models = new Set(answered.map((row) => row.meta?.model));
  let model = request.model;
  if (answered.length) {
    if (models.size !== 1 || !/^jev-\d+\.\d+(\.\d+)?$/.test([...models][0] || "")) {
      return refuse("The answered rows do not identify one model version. Run the full batch again before combining answers.");
    }
    model = [...models][0];
  }
  return { indices, reason: "", body: { rows: request.rows, questions: request.questions, indices, model } };
}

export function mergeBulkRetry(previous, attempt, indices, model) {
  const selected = new Set(indices);
  const pending = new Set(unansweredBulkIndices(previous));
  if (selected.size !== indices.length || indices.some((index) => !pending.has(index))) {
    throw new Error("Retry no longer matches the unanswered rows. Run the full batch again.");
  }
  const updates = new Map();
  for (const row of attempt.results) {
    if (!selected.has(row.index) || updates.has(row.index)) throw new Error("Retry returned unexpected row positions.");
    updates.set(row.index, row);
  }
  if (updates.size !== selected.size) throw new Error("Retry did not return every requested row position.");
  const answered = [...previous.results, ...attempt.results].filter((row) => row.answers);
  const models = new Set(answered.map((row) => row.meta?.model));
  const pinned = /^jev-\d+\.\d+(\.\d+)?$/.test(model);
  const compatible = !attempt.results.some((row) => row.answers) || (models.size === 1
    && /^jev-\d+\.\d+(\.\d+)?$/.test([...models][0] || "") && (!pinned || models.has(model)));
  const retryError = compatible ? null : "Retry did not identify the same model version. Its spend is counted; incompatible answers were left unanswered. Run the full batch again.";
  const results = previous.results.map((row) => {
    if (!updates.has(row.index)) return row;
    // Keep the original inputs and saved labels; table edits live separately in bulk.labels.
    const update = updates.get(row.index);
    const outcome = !compatible && update.answers ? { index: row.index, error: retryError } : update;
    return { ...outcome, row: row.row, expect: row.expect };
  });
  return { ...previous, results, completed: results.filter((row) => row.answers).length,
    stopped: attempt.stopped || null, retry_error: retryError,
    cost_usd: previous.cost_usd + attempt.cost_usd,
    input_tokens: previous.input_tokens + attempt.input_tokens,
    wall_ms: previous.wall_ms + attempt.wall_ms };
}

export function clearBulkRetryReports(bulk) {
  bulk.testScore = null;
  bulk.gateExport = null;
  bulk.cal.report = bulk.cal.cost = bulk.cal.holdout = null;
  bulk.cal.holdoutSeq += 1;
  bulk.policy.report = bulk.policy.tunes = bulk.policy.cost = bulk.policy.cheapest = bulk.policy.holdout = null;
  bulk.policy.holdoutSeq += 1;
  bulk.policy.prune.report = null;
  bulk.policy.prune.drop = new Set();
  bulk.slice.cal = bulk.slice.pol = null;
  bulk.rules.report = null;
  bulk.review.report = null;
  bulk.sets.report = null;
  bulk.sets.attached = {};
  bulk.sets.context = bulk.sets.result = bulk.sets.fitted = null;
}
