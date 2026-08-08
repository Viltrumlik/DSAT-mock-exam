/**
 * Annotation persistence — per (attempt, question, container).
 *
 * A "container" is a highlightable region (passage / question / choices), each with its own
 * character-offset space, so the same question can carry separate annotations on its passage,
 * prompt and answer choices.
 *
 * **Reads and writes are synchronous, deliberately.** The annotator paints inside a layout
 * effect on every commit, and a promise there would mean a frame of un-highlighted text on
 * every re-render. So the truth the UI reads is an in-memory cache, backed by localStorage,
 * and the server is reconciled around it:
 *
 *   - `primeAnnotations` fills the cache from the server when a page opens
 *   - `writeAnnotations` updates cache + localStorage now, and pushes to the server debounced
 *
 * localStorage stays as the offline cache rather than being replaced. It is what makes a
 * highlight survive a refresh on a dropped connection, and it is what the store did before
 * the server existed, so nothing regresses if the API is unreachable.
 *
 * Stored under `ts.annot.<attempt>.<question>.<container>`. On read, the passage container
 * migrates forward any legacy single-region data (`ts.annot.<attempt>.<question>` and the
 * older `ts.hl.<...>` shape).
 */
import { annotationsApi, type AnnotationRow, type AnnotationScope } from "@/features/annotations/api";
import { type Annotation, mergeAnnotations } from "./annotations";

function key(attemptId: number | string, questionId: number, container: string): string {
  return `ts.annot.${attemptId}.${questionId}.${container}`;
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
    if (o.kind === "highlight" || o.kind === "underline") {
      out.push(o as unknown as Annotation);
    } else if (o.style === "blue" || o.style === "pink" || o.style === "yellow") {
      out.push({ start: o.start, end: o.end, kind: "highlight", color: o.style });
    } else if (o.style === "underline") {
      out.push({ start: o.start, end: o.end, kind: "underline", underline: "solid" });
    } else {
      out.push({ start: o.start, end: o.end, kind: "highlight", color: "yellow" });
    }
  }
  return out;
}

function readKey(k: string): Annotation[] | null {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? mergeAnnotations(parsed.filter(isAnnotation)) : [];
  } catch {
    return null;
  }
}

// ── server reconciliation ─────────────────────────────────────────────────────

/**
 * One surface is annotatable at a time — a runner or a review page, never both — so the
 * scope/ref the writes belong to is ambient rather than threaded through every call site.
 * `useAnnotationSync` owns setting and clearing it; leaving it unset simply means
 * localStorage-only, which is exactly the old behaviour.
 */
let syncScope: AnnotationScope | null = null;
let syncRef: string | null = null;

const cache = new Map<string, Annotation[]>();
/** Debounced writes, each keeping the request that would fire, so a flush can send it now
 *  rather than merely cancelling the timer — a dropped debounce is a lost highlight. */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>();

/** How long to sit on a write. Long enough to collapse a drag-recolour-recolour flurry into
 *  one request, short enough that closing the tab a second later has already saved. */
const PUSH_DELAY_MS = 600;

export function setAnnotationSync(scope: AnnotationScope, ref: string | number): void {
  syncScope = scope;
  syncRef = String(ref);
}

export function clearAnnotationSync(): void {
  flushAnnotations();
  syncScope = null;
  syncRef = null;
  cache.clear();
}

/** Seed the cache (and localStorage) from what the server holds, before the first paint. */
export function primeAnnotations(
  attemptId: number | string,
  rows: AnnotationRow[],
): void {
  for (const row of rows) {
    const anns = mergeAnnotations((row.data ?? []).filter(isAnnotation));
    const k = key(attemptId, row.target_id, row.container);
    cache.set(k, anns);
    if (typeof window !== "undefined") {
      try {
        if (anns.length) localStorage.setItem(k, JSON.stringify(anns));
        else localStorage.removeItem(k);
      } catch {
        /* ignore quota / unavailable */
      }
    }
  }
}

/** `ts.annot.<attempt>.<question>.<container>` → the two ids, or null if it is not one. */
function parseKey(k: string, attemptId: string): { questionId: number; container: string } | null {
  const prefix = `ts.annot.${attemptId}.`;
  if (!k.startsWith(prefix)) return null;
  const rest = k.slice(prefix.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null; // the legacy two-part shape; migrated on read, not here
  const questionId = Number(rest.slice(0, dot));
  const container = rest.slice(dot + 1);
  if (!Number.isFinite(questionId) || !container) return null;
  return { questionId, container };
}

/**
 * Send marks this browser holds that the server has never seen.
 *
 * Everything highlighted before the server existed lives in localStorage alone, so a student
 * opening review on their phone would find a blank paper and reasonably conclude the feature
 * is broken. This uploads it once, the first time they open that attempt in the browser that
 * has it.
 *
 * **The server wins where both have a row.** A local copy could be stale — an older device,
 * or a tab left open across a change made elsewhere — and overwriting the server with it
 * would lose the newer marks. Only regions the server has no row for are sent, which is
 * exactly the pre-server case and nothing else.
 */
export function backfillLocalAnnotations(
  attemptId: number | string,
  serverRows: AnnotationRow[],
): void {
  if (typeof window === "undefined" || !syncScope || syncRef === null) return;
  const id = String(attemptId);
  const known = new Set(serverRows.map((r) => key(attemptId, r.target_id, r.container)));

  let localKeys: string[];
  try {
    localKeys = Object.keys(localStorage);
  } catch {
    return; // storage unavailable (private mode, quota) — nothing to backfill from
  }

  for (const k of localKeys) {
    if (known.has(k)) continue;
    const parsed = parseKey(k, id);
    if (!parsed) continue;
    const anns = readKey(k);
    if (!anns || anns.length === 0) continue;
    push(attemptId, parsed.questionId, parsed.container, anns);
  }
}

function push(attemptId: number | string, questionId: number, container: string, anns: Annotation[]): void {
  if (!syncScope || syncRef === null) return;
  const scope = syncScope;
  const ref = syncRef;
  const k = key(attemptId, questionId, container);
  const existing = pending.get(k);
  if (existing) clearTimeout(existing.timer);

  // A failed save is not worth interrupting a student mid-question over: the annotation is
  // already in localStorage, and the next write to this region retries the whole list anyway
  // because the payload is the region's full state, not a delta.
  const send = () => void annotationsApi.write(scope, ref, questionId, container, anns).catch(() => {});

  pending.set(k, {
    send,
    timer: setTimeout(() => {
      pending.delete(k);
      send();
    }, PUSH_DELAY_MS),
  });
}

/** Send anything still waiting. Call on pagehide — a debounce that never fires is a lost mark. */
export function flushAnnotations(): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.send();
  }
  pending.clear();
}

// ── the API the annotator uses ────────────────────────────────────────────────

export function readAnnotations(attemptId: number | string, questionId: number, container: string): Annotation[] {
  const k = key(attemptId, questionId, container);
  const cached = cache.get(k);
  if (cached) return cached;
  if (typeof window === "undefined") return [];
  const direct = readKey(k);
  if (direct) {
    // Only memoise while a surface is syncing. With no sync context this is the pre-server
    // store exactly as it was — which keeps the existing annotator tests honest, since a
    // module-level cache that outlived a test would leak one case's marks into the next.
    if (syncScope) cache.set(k, direct);
    return direct;
  }
  // Passage migrates legacy single-region data once.
  if (container === "passage") {
    try {
      const legacy =
        localStorage.getItem(`ts.annot.${attemptId}.${questionId}`) ??
        localStorage.getItem(`ts.hl.${attemptId}.${questionId}`);
      if (legacy) {
        const migrated = mergeAnnotations(migrateLegacy(JSON.parse(legacy)));
        if (migrated.length) writeAnnotations(attemptId, questionId, container, migrated);
        return migrated;
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function writeAnnotations(
  attemptId: number | string,
  questionId: number,
  container: string,
  anns: Annotation[],
): Annotation[] {
  const merged = mergeAnnotations(anns);
  const k = key(attemptId, questionId, container);
  if (syncScope) cache.set(k, merged);
  if (typeof window !== "undefined") {
    try {
      if (merged.length === 0) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(merged));
    } catch {
      /* ignore quota / unavailable */
    }
  }
  push(attemptId, questionId, container, merged);
  return merged;
}
