"use client";
import { useEffect, useRef } from "react";
import type { Attempt } from "../types";
import { type ExamApi, examApi } from "../services/examApiClient";
import { writeDraft } from "../services/draftStore";
import { saveKey } from "../utils/idempotency";
import { isActive } from "../state/attemptMerge";

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
/** How soon to re-arm when the debounce elapses while an earlier save is open. */
const IN_FLIGHT_RETRY_MS = 250;

/**
 * Autosaves in-progress work. Writes a local draft synchronously on every
 * change (instant crash safety) and debounces a `save_attempt` to the server.
 * The module-id guard prevents saving stale answers across a module transition.
 *
 * Deliberately holds no React state: this runs inside the exam runner, so any
 * setState here re-renders the whole heavy tree on every save. Nothing reads a
 * save status now that the "Saved" indicator is gone, and needless re-renders of
 * this tree are what made controlled inputs drop characters mid-typing.
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
}: UseAutosaveArgs): void {
  const inFlightRef = useRef(false);
  const applyRef = useRef(applyAttempt);
  useEffect(() => {
    applyRef.current = applyAttempt;
  });

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
    if (!online) return;

    let cancelled = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;

    // One save attempt; on transient failure it reschedules itself with backoff
    // (true auto-retry — so a failed save isn't silently abandoned until the next
    // keystroke) up to MAX_RETRIES, then settles on a terminal "error".
    const flush = async () => {
      if (cancelled) return;
      // An earlier save is still open. Re-arm rather than return: returning would
      // abandon this change, and nothing else would carry it — the next effect run
      // only happens on another edit or a version bump, neither of which is
      // guaranteed once the student stops typing or the autosave is disabled.
      if (inFlightRef.current) {
        timer = setTimeout(flush, IN_FLIGHT_RETRY_MS);
        return;
      }
      inFlightRef.current = true;
      try {
        const snap = await api.saveAttempt(attemptId, answers, flagged, {
          idempotencyKey: saveKey(attemptId, liveModuleId, version ?? 0),
          expectedVersionNumber: version,
        });
        applyRef.current(snap);
        // The draft is deliberately NOT cleared here. It is the last line of
        // defence, and this callback cannot know it is still current: the student
        // may have answered again while this request was open, in which case the
        // draft holds work THIS payload never carried. Clearing it then destroys
        // the only copy — mergeServerAndDraft can no longer restore it and the
        // answer grades Omitted. It costs nothing to keep (a stale draft can only
        // fill gaps the server is missing, never override newer server answers),
        // and useModuleSubmit already clears it once the module is submitted.
      } catch (e) {
        // Keep the local draft regardless — it is what recovers this work.
        if (cancelled) return;
        // Version conflict: save_attempt answers a stale expected_version with a
        // HARD 409 that writes nothing, carrying the canonical attempt in the
        // body. Adopt it instead of retrying blind — the fire-and-forget leave
        // flush and pause keepalive both bump the version without this closure
        // ever seeing it, so re-sending the SAME captured version can only 409
        // again (the prod "409 burst": initial + 3 backoff retries, all stale).
        // Applying the snapshot bumps `version`, an effect dep, so the effect
        // re-runs and re-sends these answers against the fresh version.
        const conflict = (e as { response?: { status?: number; data?: { attempt?: Attempt } } })?.response;
        if (conflict?.status === 409 && conflict.data?.attempt) {
          applyRef.current(conflict.data.attempt);
          return;
        }
        if (retries < MAX_RETRIES) {
          retries += 1;
          timer = setTimeout(flush, 2 ** retries * 1000);
        }
        // Out of retries: the draft still holds the work, and the next edit or
        // version bump re-arms the effect.
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
}
