// Variant helpers for Workbench Compare, free of the DOM so tests/js can import them.
import { parseUniqueJson } from "./build-request.js";

// A variant's questions from the JSON typed in its editor: an object keyed by question id, with repeated keys refused.
// Throws an Error with the message the Compare tab shows under the editor. name is "A" or "B".
export function parseVariantText(text, name) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error(`Variant ${name} has no questions`);
  let questions;
  try { questions = parseUniqueJson(trimmed); } catch (e) { throw new Error(`Variant ${name}: invalid JSON (${e.message})`); }
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) throw new Error(`Variant ${name}: questions must be an object keyed by question id`);
  return questions;
}

// The questions with each Choice question's options listed in reverse order, for an order check in
// Compare: instructions, option descriptions, and every other question stay as they are. A Score scale
// keeps its order, since its levels mean low to high. Returns null when no Choice question's order can
// change: none has two or more options, or every option name is a whole number, which JavaScript
// objects always list in ascending order.
export function reverseOptions(questions) {
  let moved = false;
  const out = Object.create(null);  // a question id such as "__proto__" stays an ordinary key
  for (const [qid, q] of Object.entries(questions || {})) {
    const criteria = q && q.type === "choice" && q.criteria && typeof q.criteria === "object" && !Array.isArray(q.criteria) ? q.criteria : null;
    const reversed = criteria ? Object.fromEntries(Object.entries(criteria).reverse()) : null;
    if (reversed && Object.keys(reversed).join("\u0000") !== Object.keys(criteria).join("\u0000")) {
      out[qid] = { ...q, criteria: reversed };
      moved = true;
    } else {
      out[qid] = q;
    }
  }
  return moved ? out : null;
}
