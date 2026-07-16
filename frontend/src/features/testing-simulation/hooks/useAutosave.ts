"use client";
import { useEffect, useRef, useState } from "react";
import type { Attempt } from "../types";
import { type ExamApi, examApi } from "../services/examApiClient";
import { clearDraft, writeDraft } from "../services/draftStore";
import { saveKey } from "../utils/idempotency";
import { isActive } from "../state/attemptMerge";

export type SaveStatus = "idle" | "saving" | "retrying" | "saved" | "offline" | "error";

export interface UseAutosaveResult {
  status: SaveStatus;
  lastSavedAt: number | null;
}

interface UseAutosaveArgs {
  attempt: Attempt | null;
  attemptId: number;
  answers: Record<string, string>;
  flagged: number[];
  /** Module id the answers belong to (from useAnswers) — must match the live module. */
  answersModuleId: number | null;
  /** Apply the server's response so version_number stays current. */
  applyAttempt: (next: Attempt) => void;
  /** Suspend autosave during submit/transition. */
  enabled: boolean;
  /** Browser connectivity. When false, work is kept locally and the save is deferred. */
  online?: boolean;
  /** Attempt-engine client. Defaults to the pastpaper/mock client; midterm passes its own. */
  api?: ExamApi;
  /** Debounce before the server save fires. Pastpapers pass a short value for a
   * near-immediate per-answer save + "Saved" feedback; mocks/midterms keep the
   * default so long proctored exams aren't saved on every keystroke. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 1500;
const MAX_RETRIES = 3;

/**
 * Autosaves in-progress work. Writes a local draft synchronously on every
 * change (instant crash safety) and debounces a `save_attempt` to the server.
 * The module-id guard prevents saving stale answers across a module transition.
 */
export function useAutosave({
  attempt,
  attemptId,
  answers,
  flagged,
  answersModuleId,
  applyAttempt,
  enabled,
  online = true,
  api = examApi,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseAutosaveArgs): UseAutosaveResult {
  const inFlightRef = useRef(false);
  const applyRef = useRef(applyAttempt);
  useEffect(() => {
    applyRef.current = applyAttempt;
  });

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const liveModuleId = attempt?.current_module_details?.id ?? null;
  const version = attempt?.version_number;

  useEffect(() => {
    if (!enabled || !isActive(attempt) || liveModuleId == null) return;
    // Only persist answers that belong to the currently-active module.
    if (answersModuleId !== liveModuleId) return;

    // Local draft: immediate, synchronous backup. Written even while offline so
    // a crash or reload never loses work the server hasn't accepted yet.
    writeDraft(attemptId, { answers, flagged, version: version ?? null, moduleId: liveModuleId });

    // Offline: don't hammer the network; the draft holds the work and the save
    // is retried automatically when connectivity returns (`online` re-runs this).
    if (!online) {
      setStatus("offline");
      return;
    }

    let cancelled = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;

    // One save attempt; on transient failure it reschedules itself with backoff
    // (true auto-retry — so a failed save isn't silently abandoned until the next
    // keystroke) up to MAX_RETRIES, then settles on a terminal "error".
    const flush = async () => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      setStatus(retries === 0 ? "saving" : "retrying");
      try {
        const snap = await api.saveAttempt(attemptId, answers, flagged, {
          idempotencyKey: saveKey(attemptId, liveModuleId, version ?? 0),
          expectedVersionNumber: version,
        });
        applyRef.current(snap);
        // Server now holds the answers — local draft no longer needed.
        clearDraft(attemptId, liveModuleId);
        if (!cancelled) {
          setStatus("saved");
          setLastSavedAt(Date.now());
        }
      } catch {
        // Keep the local draft regardless; reflect the real state to the student.
        if (cancelled) return;
        if (retries < MAX_RETRIES) {
          retries += 1;
          setStatus("retrying");
          timer = setTimeout(flush, 2 ** retries * 1000);
        } else {
          setStatus("error");
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    timer = setTimeout(flush, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, flagged, enabled, online, liveModuleId, answersModuleId, version, attemptId, debounceMs]);

  return { status, lastSavedAt };
}
