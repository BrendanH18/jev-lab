// Presentation helpers: filtering never changes the drafts that Apply will submit.
export function labelReady(item, drafts) {
  return item.missing.every((qid) => drafts[item.index]?.[qid] !== undefined && drafts[item.index]?.[qid] !== null);
}

export function labelProgress(items, drafts) {
  const ready = items.filter((item) => labelReady(item, drafts)).length;
  return { ready, incomplete: items.length - ready };
}

export function visibleLabels(items, drafts, status = "all") {
  return items.filter((item) => status === "all" || labelReady(item, drafts) === (status === "ready"));
}

export function nextLabel(items, drafts, after = null) {
  const incomplete = items.filter((item) => !labelReady(item, drafts));
  return incomplete.find((item) => after === null || item.index > after) || incomplete[0] || null;
}
