/**
 * Annotation persistence — per (attempt, question), in localStorage. Purely a
 * study annotation; independent of the exam engine and never synced to backend.
 *
 * Stored under `ts.annot.<attempt>.<question>`. On read, legacy data from the
 * old `ts.hl.<attempt>.<question>` key (pre-rebuild `{start,end,style}` shape)
 * is migrated forward so existing highlights survive.
 */
import { type Annotation, mergeAnnotations } from "./annotations";

function key(attemptId: number | string, questionId: number): string {
  return `ts.annot.${attemptId}.${questionId}`;
}
function legacyKey(attemptId: number | string, questionId: number): string {
  return `ts.hl.${attemptId}.${questionId}`;
}

function isAnnotation(v: unknown): v is Annotation {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.start === "number" &&
    typeof a.end === "number" &&
    a.end > a.start &&
    (a.kind === "highlight" || a.kind === "underline")
  );
}

/** Convert legacy `{start,end,style}` ranges to the new Annotation shape. */
function migrateLegacy(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  const out: Annotation[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.start !== "number" || typeof o.end !== "number" || o.end <= o.start) continue;
    const style = o.style;
    if (style === "blue" || style === "pink" || style === "yellow") {
      out.push({ start: o.start, end: o.end, kind: "highlight", color: style });
    } else if (style === "underline") {
      out.push({ start: o.start, end: o.end, kind: "underline", underline: "solid" });
    } else {
      out.push({ start: o.start, end: o.end, kind: "highlight", color: "yellow" });
    }
  }
  return out;
}

export function readAnnotations(attemptId: number | string, questionId: number): Annotation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(attemptId, questionId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return mergeAnnotations(parsed.filter(isAnnotation));
      return [];
    }
    // No new-format entry → migrate any legacy highlights once.
    const legacy = localStorage.getItem(legacyKey(attemptId, questionId));
    if (legacy) {
      const migrated = mergeAnnotations(migrateLegacy(JSON.parse(legacy)));
      if (migrated.length) writeAnnotations(attemptId, questionId, migrated);
      return migrated;
    }
    return [];
  } catch {
    return [];
  }
}

export function writeAnnotations(attemptId: number | string, questionId: number, anns: Annotation[]): Annotation[] {
  const merged = mergeAnnotations(anns);
  if (typeof window !== "undefined") {
    try {
      if (merged.length === 0) localStorage.removeItem(key(attemptId, questionId));
      else localStorage.setItem(key(attemptId, questionId), JSON.stringify(merged));
    } catch {
      /* ignore quota / unavailable */
    }
  }
  return merged;
}
