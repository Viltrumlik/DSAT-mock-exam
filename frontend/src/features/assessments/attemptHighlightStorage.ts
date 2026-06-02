/**
 * attemptHighlightStorage — Phase 1 (frontend-only) persistence for assessment
 * highlights, so a student's highlights survive refresh, navigation, temporary
 * disconnect, and browser reopen.
 *
 * SCOPE / BOUNDARIES (deliberate):
 *   • Scoped by attemptId (storage key) + questionId (inner map).
 *   • Stores the SAME sanitized highlight HTML the runner already produces
 *     (post-KaTeX innerHTML of the question/passage container, with <mark>).
 *   • This is learning-continuity infrastructure, NOT a backend annotation model,
 *     NOT collaborative annotations, NOT SAT-review coupling, NOT note-taking.
 *
 * Mirrors the conventions of attemptDraftStorage.ts (versioned envelope,
 * quota-eviction of OTHER attempts on QuotaExceededError, total try/catch so a
 * restricted storage context never breaks the runner). Unlike answer drafts,
 * highlights are intentionally NOT cleared on submit — the pedagogical review
 * page reads them back read-only.
 */

const LS_PREFIX = "assessment_highlights_v1:";

export type HighlightField = "question" | "passage";

export type HighlightStore = {
  v: 1;
  /** qid → sanitized highlight HTML for the question stem. */
  question: Record<number, string>;
  /** qid → sanitized highlight HTML for the passage / stimulus. */
  passage: Record<number, string>;
  /** qid → { choiceId → sanitized highlight HTML } for answer choices. */
  options: Record<number, Record<string, string>>;
};

function lsKey(attemptId: number) {
  return `${LS_PREFIX}${attemptId}`;
}

function emptyStore(): HighlightStore {
  return { v: 1, question: {}, passage: {}, options: {} };
}

function normalizeOptions(raw: unknown): Record<number, Record<string, string>> {
  const out: Record<number, Record<string, string>> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const qid = Number(k);
      if (!Number.isFinite(qid)) continue;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner: Record<string, string> = {};
        for (const [cid, html] of Object.entries(v as Record<string, unknown>)) {
          if (typeof html === "string" && html.length > 0) inner[cid] = html;
        }
        if (Object.keys(inner).length) out[qid] = inner;
      }
    }
  }
  return out;
}

function normalizeMap(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const qid = Number(k);
      if (Number.isFinite(qid) && typeof v === "string" && v.length > 0) out[qid] = v;
    }
  }
  return out;
}

export function readHighlightStore(attemptId: number): HighlightStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(lsKey(attemptId));
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return {
      v: 1,
      question: normalizeMap((parsed as Record<string, unknown>).question),
      passage: normalizeMap((parsed as Record<string, unknown>).passage),
      options: normalizeOptions((parsed as Record<string, unknown>).options),
    };
  } catch {
    return emptyStore();
  }
}

export function writeHighlightStore(attemptId: number, store: HighlightStore): void {
  if (typeof window === "undefined") return;
  const key = lsKey(attemptId);
  const payload = JSON.stringify({ v: 1, question: store.question, passage: store.passage, options: store.options });
  try {
    localStorage.setItem(key, payload);
  } catch (e) {
    // QuotaExceededError — evict highlight stores for OTHER attempts, retry once.
    if (e instanceof DOMException) {
      try {
        const staleKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS_PREFIX) && k !== key) staleKeys.push(k);
        }
        staleKeys.forEach((k) => {
          try {
            localStorage.removeItem(k);
          } catch {
            /* ignore */
          }
        });
        localStorage.setItem(key, payload);
      } catch {
        // Still failing (Safari ITP / private). Degrade silently — highlights
        // remain in memory for the current session.
      }
    }
  }
}

/** Convenience: persist a single field's HTML for one question. */
export function saveHighlight(
  attemptId: number,
  field: HighlightField,
  questionId: number,
  html: string,
): void {
  if (!Number.isFinite(questionId) || questionId <= 0) return;
  const store = readHighlightStore(attemptId);
  store[field] = { ...store[field], [questionId]: html };
  writeHighlightStore(attemptId, store);
}

/** Persist a single answer-choice's highlight HTML for one question. */
export function saveOptionHighlight(
  attemptId: number,
  questionId: number,
  choiceId: string,
  html: string,
): void {
  if (!Number.isFinite(questionId) || questionId <= 0 || !choiceId) return;
  const store = readHighlightStore(attemptId);
  const prev = store.options[questionId] ?? {};
  store.options = { ...store.options, [questionId]: { ...prev, [choiceId]: html } };
  writeHighlightStore(attemptId, store);
}

export function clearHighlightStore(attemptId: number): void {
  try {
    localStorage.removeItem(lsKey(attemptId));
  } catch {
    /* ignore */
  }
}
