// Helpers for Policy's "Do the gates earn their place?" check, free of the DOM so tests/js can import them.
// The server (POST /api/workbench/policy/prune) does the searches; these only read its report.

// The questions without the ids in drop (a Set or an array), in their original order. Returns a new object;
// the input is not changed.
export function withoutQuestions(questions, drop) {
  const gone = drop instanceof Set ? drop : new Set(drop || []);
  const out = Object.create(null);  // a question id such as "__proto__" stays an ordinary key
  for (const [qid, q] of Object.entries(questions || {})) if (!gone.has(qid)) out[qid] = q;
  return out;
}

// An outcome's automated rows against the baseline's: "−12 rows", "+3 rows", or "no loss". When the two score
// different labeled rows (a question dropped from the gate is no longer scored), the change is in percentage
// points of rows automated instead. null when either outcome reaches no thresholds.
export function automatedDelta(outcome, baseline) {
  if (!outcome || !baseline || !outcome.gates || !baseline.gates) return null;
  if (outcome.labeled !== baseline.labeled) {
    const pts = Math.round((outcome.coverage - baseline.coverage) * 1000) / 10;
    if (pts === 0) return "no loss";
    return `${pts > 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)} pts automated`;
  }
  const diff = outcome.automated - baseline.automated;
  if (diff === 0) return "no loss";
  const n = Math.abs(diff);
  return `${diff > 0 ? "+" : "−"}${n} row${n === 1 ? "" : "s"}`;
}

// True when turning a gated question's threshold off automates at least as many rows at the target as the full
// gate does: its threshold holds back nothing, so it is a candidate to stop gating.
export function holdsBackNothing(entry, baseline) {
  return Boolean(entry && entry.off && entry.off.gates && baseline && baseline.gates && entry.off.automated >= baseline.automated);
}

// The share of the question text that a list of { share } entries makes up together, at most 1.
export function totalShare(entries) {
  return Math.min(1, (entries || []).reduce((sum, e) => sum + (Number(e.share) || 0), 0));
}
