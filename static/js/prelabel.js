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

export function nextLabel(items, drafts, after = null, direction = 1) {
  const incomplete = items.filter((item) => !labelReady(item, drafts));
  if (direction < 0) {
    return incomplete.slice().reverse().find((item) => after === null || item.index < after) || incomplete.at(-1) || null;
  }
  return incomplete.find((item) => after === null || item.index > after) || incomplete[0] || null;
}

// Only explicit modified Enter shortcuts; leave native typing and select keys alone.
export function labelShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey
      || !(event.ctrlKey || event.metaKey) || event.key !== "Enter") return null;
  return event.shiftKey ? -1 : 1;
}
