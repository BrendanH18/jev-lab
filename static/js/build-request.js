// Build editor validation and portable request drafts. No DOM, persistence or model calls.

export function editorQuestionError(rows) {
  const ids = new Set();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    if (ids.has(id)) return `Question id “${id}” is repeated. Give every question a unique id.`;
    ids.add(id);
    if (row.type === "choice") {
      const keys = new Set();
      for (const [raw] of row.choice) {
        const key = raw.trim();
        if (!key) continue;
        if (keys.has(key)) return `Question “${id}” repeats option key “${key}”. Give every option a unique key.`;
        keys.add(key);
      }
    }
  }
  return null;
}

export function parseUniqueJson(text) {
  const parsed = JSON.parse(text);
  // JSON.parse validates the grammar but keeps the last repeated key. Walk each
  // character once, skipping escaped string contents, to detect keys without a
  // backtracking regex or a token array containing large image strings.
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const token = text[i];
    const top = stack[stack.length - 1];
    if (token === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      if (top?.object && top.key) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (top.keys.has(key)) throw new Error(`JSON repeats key “${key}”. Keep each question and option key unique.`);
        top.keys.add(key);
        top.key = false;
      }
    } else if (token === "{") stack.push({ object: true, key: true, keys: new Set() });
    else if (token === "[") stack.push({ object: false });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && top?.object) top.key = true;
  }
  return parsed;
}

export function requestDraft(state, questions, images = {}) {
  // Explicit fields prevent a caller's result, credentials or editor metadata entering the file.
  return { format: "jev-build-draft", version: 1, state, questions, images };
}

export function parseRequestDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.format !== "jev-build-draft" || value.version !== 1) throw new Error("Choose a Jev Build draft (version 1).");
  const expected = new Set(["format", "version", "state", "questions", "images"]);
  if (Object.keys(value).some((key) => !expected.has(key))) throw new Error("Build drafts contain only state, questions and images.");
  if (value.state === undefined || !value.questions || typeof value.questions !== "object" || Array.isArray(value.questions)
      || !Object.keys(value.questions).length || !value.images || typeof value.images !== "object" || Array.isArray(value.images)) {
    throw new Error("The draft needs state, a question map and an image map.");
  }
  return requestDraft(value.state, value.questions, value.images);
}

export function buildEditorContext(stateText, rows, images) {
  // Preserve Choice order and image bytes; changing either changes the request.
  return JSON.stringify([stateText, rows, images]);
}

export function buildContextChanged(current, original) {
  return original !== null && original !== undefined && current !== original;
}
