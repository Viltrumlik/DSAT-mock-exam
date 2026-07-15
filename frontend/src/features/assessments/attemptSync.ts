/**
 * Deterministic fingerprint of persisted answers (server truth for conflict detection).
 */
export function fingerprintAnswersFromAttempt(attempt: { answers?: unknown[] } | null | undefined): string {
  const answers = Array.isArray(attempt?.answers) ? attempt!.answers! : [];
  const parts = answers
    .map((a: any) => {
      const qid = Number(a?.question_id);
      if (!Number.isFinite(qid)) return null;
      return `${qid}:${stableStringify(a?.answer ?? null)}:${String(a?.answered_at ?? "")}`;
    })
    .filter(Boolean) as string[];
  parts.sort();
  return parts.join("|");
}

function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return JSON.stringify(v);
}

export type AnswerConflict = {
  questionId: number;
  local: unknown;
  remote: unknown;
};

export function detectAnswerConflicts(
  draftById: Record<number, unknown>,
  serverAnswersByQid: Record<number, unknown>,
): AnswerConflict[] {
  const out: AnswerConflict[] = [];
  for (const [k, local] of Object.entries(draftById)) {
    const qid = Number(k);
    if (!Number.isFinite(qid)) continue;
    if (!(qid in serverAnswersByQid)) continue;
    const remote = serverAnswersByQid[qid];
    if (stableStringify(local) !== stableStringify(remote)) {
      out.push({ questionId: qid, local, remote });
    }
  }
  return out;
}

export function answersMapFromAttempt(attempt: { answers?: unknown[] } | null | undefined): Record<number, unknown> {
  const map: Record<number, unknown> = {};
  const answers = Array.isArray(attempt?.answers) ? attempt!.answers! : [];
  for (const a of answers) {
    const qid = Number((a as any)?.question_id);
    if (Number.isFinite(qid)) map[qid] = (a as any)?.answer ?? null;
  }
  return map;
}

/**
 * Highest `client_seq` the server has persisted for this attempt (0 if none).
 *
 * The runner seeds its monotonic save counter from this so a save is always
 * ordered ABOVE the server's current state — even after a save-and-exit/resume
 * (fresh mount) or a resume on a second device. Seeding from the server (not the
 * client wall clock) is what makes out-of-order rejection safe: a 409 then always
 * means a genuine stale straggler, never the student's real latest pick.
 */
export function maxClientSeqFromAttempt(attempt: { answers?: unknown[] } | null | undefined): number {
  const answers = Array.isArray(attempt?.answers) ? attempt!.answers! : [];
  let max = 0;
  for (const a of answers) {
    const seq = Number((a as any)?.client_seq);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max;
}
