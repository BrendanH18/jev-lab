// Open a demo's request in the Workbench. The Inspect drawer writes the exact request it shows (state,
// questions, and pictures) to localStorage and opens /workbench in a new tab; the Workbench reads it
// once at load, removes it, and puts it in the Build tab. Only the request travels, never the
// answers: the Workbench asks the model again when you press Run. Nothing goes through the server.
// No DOM here, so tests/js/handoff.test.mjs can run it under Node.

export const HANDOFF_KEY = "jev:workbench-handoff";
// Long enough for a slow new tab to load, short enough that a handoff nobody opened is not picked up later.
export const HANDOFF_TTL_MS = 2 * 60 * 1000;
const VERSION = 1;

function bytesOf(base64) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(base64) {
  const digest = await crypto.subtle.digest("SHA-256", bytesOf(base64));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The request in `trace` as a handoff. The trace shows sample pictures by name but leaves out the bytes
// of an uploaded one, so the page passes what it uploaded in `uploads` (base64 strings). The server
// names an uploaded picture `<label>-<first 12 hex digits of its SHA-256>` (jev/images.py new_ref),
// which is how each picture finds its reference here.
export async function handoffFromTrace(trace, source, uploads = [], now = Date.now()) {
  const req = trace?.request || {};
  const questions = req.questions;
  if (!questions || typeof questions !== "object" || Array.isArray(questions) || !Object.keys(questions).length) {
    throw new Error("This request has no questions to open in the Workbench.");
  }
  const hashed = await Promise.all((uploads || []).filter(Boolean).map(async (b64) => [(await sha256Hex(b64)).slice(0, 12), b64]));
  const images = {};
  for (const [ref, asset] of Object.entries(req.assets || {})) {
    if (asset?.sample) {
      images[ref] = { sample: asset.sample };
      continue;
    }
    const hit = hashed.find(([hex]) => ref.endsWith(`-${hex}`));
    if (!hit) throw new Error("This page no longer has the uploaded picture for this request. Run it again, then open it in the Workbench.");
    images[ref] = { format: asset?.format === "png" ? "png" : "jpg", data_base64: hit[1] };
  }
  return { v: VERSION, source: String(source || "a demo"), model: req.model || null, state: req.state, questions, images, at: now };
}

export function writeHandoff(storage, handoff) {
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    throw new Error("The browser would not hold this request, probably because its picture is too large. Open the Workbench and add the picture there.");
  }
}

// The waiting handoff, or null. It is removed as it is read, so a reload or a second tab does not load it again.
export function readHandoff(storage, now = Date.now()) {
  let text;
  try {
    text = storage.getItem(HANDOFF_KEY);
    storage.removeItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  let h;
  try { h = JSON.parse(text); } catch { return null; }
  if (!h || h.v !== VERSION || typeof h.at !== "number" || now - h.at > HANDOFF_TTL_MS || now < h.at - HANDOFF_TTL_MS) return null;
  if (!h.questions || typeof h.questions !== "object" || Array.isArray(h.questions) || h.state === undefined) return null;
  return { source: String(h.source || "a demo"), model: typeof h.model === "string" ? h.model : null, state: h.state,
    questions: h.questions, images: h.images && typeof h.images === "object" && !Array.isArray(h.images) ? h.images : {} };
}
