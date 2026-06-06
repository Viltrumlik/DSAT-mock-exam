/**
 * Highlight persistence — per (attempt, question), in localStorage. Purely a
 * study annotation; independent of the exam engine and never synced to backend.
 */
import { type HighlightRange, mergeRanges } from "./offsets";

function key(attemptId: number | string, questionId: number): string {
  return `ts.hl.${attemptId}.${questionId}`;
}

export function readRanges(attemptId: number | string, questionId: number): HighlightRange[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(attemptId, questionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.start === "number" && typeof r.end === "number" && r.end > r.start);
  } catch {
    return [];
  }
}

export function writeRanges(attemptId: number | string, questionId: number, ranges: HighlightRange[]): HighlightRange[] {
  const merged = mergeRanges(ranges);
  if (typeof window !== "undefined") {
    try {
      if (merged.length === 0) localStorage.removeItem(key(attemptId, questionId));
      else localStorage.setItem(key(attemptId, questionId), JSON.stringify(merged));
    } catch {
      /* ignore */
    }
  }
  return merged;
}
