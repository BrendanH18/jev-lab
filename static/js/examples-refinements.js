// Gallery tools operate on authored examples and session presentation only.
const bytes = (text) => new TextEncoder().encode(text).length;
export function exampleCounts(example) {
  const questions = Object.values(example.questions || {});
  return { criteria: questions.reduce((sum, q) => sum + (q.type === "choice" && q.criteria && !Array.isArray(q.criteria) ? Object.keys(q.criteria).length : q.type === "score" && Array.isArray(q.criteria) ? q.criteria.length : 0), 0),
    stateBytes: bytes(typeof example.state === "string" ? example.state : JSON.stringify(example.state ?? null)),
    types: new Set(questions.map((q) => q.type)).size };
}

export function exampleSearchText(example, scope = "all") {
  const questions = example.questions || {};
  const fields = { title: [example.title], id: [example.id], pattern: [example.pattern, example.blurb, example.code],
    questions: Object.keys(questions), instructions: Object.values(questions).map((q) => typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions ?? "")) };
  return (fields[scope] || Object.values(fields).flat()).join(" ").toLowerCase();
}

export function matchesExampleRefinements(example, view) {
  const text = exampleSearchText(example, view.searchScope);
  const query = String(view.query || "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  if (query && (view.searchMode === "all" ? !terms.every((term) => text.includes(term)) : view.searchMode === "any" ? !terms.some((term) => text.includes(term)) : !text.includes(query))) return false;
  const excluded = String(view.exclude || "").trim().toLowerCase();
  if (excluded && text.includes(excluded)) return false;
  const counts = exampleCounts(example);
  for (const [field, value] of [["Questions", Object.keys(example.questions || {}).length], ["Criteria", counts.criteria], ["StateBytes", counts.stateBytes]]) {
    for (const [prefix, compare] of [["min", (n) => value >= n], ["max", (n) => value <= n]]) {
      const raw = view[`${prefix}${field}`];
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n < 0 || !compare(n)) return false;
    }
  }
  if (view.typeMix === "mixed" && counts.types < 2 || view.typeMix === "single" && counts.types !== 1) return false;
  if (view.pinned === "with" && !view.pins?.has(example.id) || view.pinned === "without" && view.pins?.has(example.id)) return false;
  return true;
}

export function exampleRequestJson(example) {
  return JSON.stringify({ state: example.state, questions: example.questions,
    ...(Object.keys(example.images || {}).length ? { images: example.images } : {}) }, null, 2);
}

export function exampleOutline(example) {
  return Object.entries(example.questions || {}).map(([id, q], i) => ({ position: i + 1, id, type: q.type,
    criteria: exampleCounts({ questions: { [id]: q } }).criteria }));
}

export function exampleTypeSummary(examples) {
  const counts = { choice: 0, noul: 0, score: 0, box: 0 };
  for (const example of examples) for (const q of Object.values(example.questions || {})) if (Object.hasOwn(counts, q.type)) counts[q.type]++;
  return Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(" · ");
}

export function exampleMetadataCsv(metadata) {
  const fields = ["id", "title", "question_count", "types", "image_count", "expectation_count", "state_type"];
  const cell = (value) => {
    const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
    return `"${(/^[\s]*[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  return [fields.join(","), ...metadata.map((row) => fields.map((key) => cell(row[key])).join(","))].join("\r\n");
}
