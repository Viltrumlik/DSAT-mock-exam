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
  /**
   * This tab owns the attempt and is on a settled module. False suspends
   * EVERYTHING, including the submit hand-off — it means the local `answers`
   * cannot be trusted to be the newest copy (a blocked duplicate tab) or cannot
   * be attributed to the live module (mid module-transition), and `save_attempt`
   * REPLACES the module map, so writing from here would destroy real work.
   */
  enabled: boolean;
  /**
   * A module submit is in flight. Scheduling stops (submit owns the answers from
   * here), but any change the debounce hasn't sent yet is handed to the server
   * first — see the hand-off below. Deliberately NOT folded into `enabled`:
   * those two states need opposite treatment.
   */
  submitting?: boolean;
  /** Browser connectivity. When false, work is kept locally and the save is deferred. */
  online?: boolean;
  /** Attempt-engine client. Defaults to the pastpaper/mock client; midterm passes its own. */
  api?: ExamApi;
  /**
   * Debounce for changes that are NOT a single deliberate answer: flag toggles,
   * and the bulk answer set that appears on rehydration. Answer changes have
   * their own, much shorter policy (see the delay table below) — this value is
   * only a ceiling for them, never a floor.
   */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 1500;
/** A choice was selected/cleared: one discrete, final act — send it now. */
const DISCRETE_ANSWER_DELAY_MS = 0;
/** Grid-in typing: coalesce a burst of keystrokes into one request. */
const TEXT_ANSWER_DEBOUNCE_MS = 400;
/** ...but never hold a typed answer longer than this, however fast they type. */
const TEXT_ANSWER_MAX_WAIT_MS = 1200;
/** Floor between two save requests, so rapid clicking can't become a request storm. */
const MIN_SAVE_INTERVAL_MS = 300;
const MAX_RETRIES = 3;
/** How soon to re-arm when the debounce elapses while an earlier save is open. */
const IN_FLIGHT_RETRY_MS = 250;

/** Question ids answered by free TEXT (grid-in / SPR) rather than a discrete choice. */
function textInputIds(attempt: Attempt | null): Set<string> {
  const out = new Set<string>();
  for (const q of attempt?.current_module_details?.questions ?? []) {
    if (q?.is_math_input) out.add(String(q.id));
  }
  return out;
}

/** Question ids whose answer differs between two maps (added, removed or changed). */
function changedAnswerIds(prev: Record<string, string>, next: Record<string, string>): string[] {
  const out: string[] = [];
  for (const qid of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (prev[qid] !== next[qid]) out.push(qid);
  }
  return out;
}

/**
 * Order-independent identity of a save payload, so "already sent" is exact.
 *
 * JSON, not hand-rolled joining. An earlier version separated fields with literal 0x01/0x02
 * control BYTES, invisible in an editor, in `git diff` and in review — and load-bearing:
 * without a separator that cannot occur in the data, `{"3":"12"} + flagged[5]` and
 * `{"3":"125"} + flagged[]` sign identically, so a changed answer reads as "already sent"
 * and is dropped silently. That is the exact failure mode this hook exists to prevent.
 */
function payloadSignature(answers: Record<string, string>, flagged: number[]): string {
  const sortedAnswers = Object.keys(answers)
    .sort()
    .map((k) => [k, answers[k]] as const);
  return JSON.stringify([sortedAnswers, [...flagged].sort((x, y) => x - y)]);
}

/**
 * Autosaves in-progress work. Writes a local draft synchronously on every
 * change (instant crash safety) and sends a `save_attempt` to the server.
 * The module-id guard prevents saving stale answers across a module transition.
 *
 * DELAY POLICY — "har bir savol save bo'lsin". An answer that exists only in
 * this tab is an answer that grades Omitted, so how long we sit on one is the
 * whole safety story. What changed decides the delay:
 *
 *   one question, discrete choice   → 0ms   (send it now; it is a final act)
 *   one question, grid-in text      → 400ms, capped at 1200ms from the first
 *                                     unsent keystroke (coalesce typing, but
 *                                     never hoard it)
 *   flags only                      → debounceMs (not graded)
 *   many questions at once          → debounceMs (that is rehydration, not a
 *                                     student action)
 *
 * A flat 1500ms debounce used to cover every case, which meant an answer chosen
 * in the last 1.5s of a module existed ONLY in the submit payload.
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
  submitting = false,
  online = true,
  api = examApi,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseAutosaveArgs): void {
  const inFlightRef = useRef(false);
  const applyRef = useRef(applyAttempt);
  useEffect(() => {
    applyRef.current = applyAttempt;
  });

  /** Answers as of the previous pass, so we can tell WHAT the student changed. */
  const lastSeenRef = useRef<{ moduleId: number; answers: Record<string, string> } | null>(null);
  /** Signature the server has actually accepted, per module. Anything else is unsent. */
  const sentRef = useRef<{ moduleId: number; signature: string } | null>(null);
  /** The answer MAP the server has accepted, per module — the baseline for "what is unsent". */
  const sentAnswersRef = useRef<{ moduleId: number; answers: Record<string, string> } | null>(null);
  /** When the oldest still-unsent answer change happened (the typing max-wait cap). */
  const dirtySinceRef = useRef<number | null>(null);
  /** When the last save request was ISSUED (the rate floor). */
  const lastIssuedAtRef = useRef<number>(Number.NEGATIVE_INFINITY);

  const liveModuleId = attempt?.current_module_details?.id ?? null;
  const version = attempt?.version_number;

  useEffect(() => {
    if (!enabled || !isActive(attempt) || liveModuleId == null) return;
    // Only persist answers that belong to the currently-active module.
    if (answersModuleId !== liveModuleId) return;

    // Local draft: immediate, synchronous backup. Written even while offline, and
    // even while submitting, so a crash or reload never loses work the server
    // hasn't accepted yet.
    writeDraft(attemptId, { answers, flagged, version: version ?? null, moduleId: liveModuleId });

    // ── What did the student actually change? ────────────────────────────────
    // First pass on a module has no baseline, so it counts as "no answer change"
    // and takes the long debounce: `answers` is still {} for the frame before
    // useAnswers rehydrates, and blasting that empty map at the server instantly
    // would blank the module's saved work.
    const previous = lastSeenRef.current?.moduleId === liveModuleId ? lastSeenRef.current.answers : null;
    // Diff against what the SERVER has (the last accepted payload), falling back to the
    // previous render pass until anything has been sent. Diffing only against the previous
    // pass made the fast path collapse exactly when it mattered: while a save is in flight
    // the effect re-runs on every version bump, by which point the previous pass already
    // contains the still-unsent answer, so `changed` came back empty and the answer fell to
    // the 1500ms debounce — on slow connections, the very students this exists to protect.
    const sentAnswers =
      sentAnswersRef.current?.moduleId === liveModuleId ? sentAnswersRef.current.answers : null;
    const baseline = sentAnswers ?? previous;
    const changed = baseline ? changedAnswerIds(baseline, answers) : [];
    lastSeenRef.current = { moduleId: liveModuleId, answers };

    const now = Date.now();
    if (changed.length > 0 && dirtySinceRef.current == null) dirtySinceRef.current = now;

    const signature = payloadSignature(answers, flagged);
    const alreadySent = sentRef.current?.moduleId === liveModuleId && sentRef.current.signature === signature;

    // ── Submit owns the answers from here ────────────────────────────────────
    // Stand down completely. There was briefly a "hand-off" here that fired one last
    // `saveAttemptKeepalive` before yielding, and it was wrong twice over:
    //   * on MIDTERMS it was inert — the keepalive body sets `background: true`, and the
    //     server deliberately banks nothing from a background flush past the deadline
    //     (that flag is client-assertable, so honouring it would be an unlimited-time
    //     cheat). A midterm only ever submits at/after expiry, so the hand-off never
    //     landed on the one exam type it was written for;
    //   * on PASTPAPERS/MOCKS it was worse than useless — an unversioned, un-module-
    //     targeted write racing the real submit, which is precisely the shape of the
    //     "Module 2 skip" incident this codebase has already lived through.
    // Three things already carry the work: every answer is saved the moment it is given
    // (delay table below), the submit payload itself carries the map, and the local
    // draft survives a crash.
    if (submitting) return;

    // Offline: don't hammer the network; the draft holds the work and the save
    // is retried automatically when connectivity returns (`online` re-runs this).
    if (!online) return;

    // Nothing to say. The effect re-runs on every version bump (each save bumps
    // it), and re-sending a payload the server has already accepted only churns
    // version_number — which is exactly what turns a concurrent keepalive or a
    // pause into a 409 burst.
    if (alreadySent) return;

    // ── How long may we sit on this? ─────────────────────────────────────────
    const textIds = textInputIds(attempt);
    let delay: number;
    if (changed.length !== 1) {
      // Flags only (changed.length === 0) or a bulk rehydrate — neither is a
      // student answering a question, and a student can only answer one at a time.
      delay = debounceMs;
    } else if (textIds.has(changed[0])) {
      // Grid-in typing: coalesce the burst, but never past the max wait measured
      // from the first keystroke we haven't sent.
      const waited = now - (dirtySinceRef.current ?? now);
      delay = Math.max(0, Math.min(Math.min(TEXT_ANSWER_DEBOUNCE_MS, debounceMs), TEXT_ANSWER_MAX_WAIT_MS - waited));
    } else {
      delay = DISCRETE_ANSWER_DELAY_MS;
    }
    // Rate floor: rapid clicking (or a held key) must not become one request per
    // event. The FIRST change is still immediate — this only spaces out the next.
    delay = Math.max(delay, MIN_SAVE_INTERVAL_MS - (now - lastIssuedAtRef.current));

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
      // This is also what coalesces a burst: whichever payload wins the re-arm is
      // the newest one, and it is a superset of the ones behind it.
      if (inFlightRef.current) {
        timer = setTimeout(flush, IN_FLIGHT_RETRY_MS);
        return;
      }
      inFlightRef.current = true;
      lastIssuedAtRef.current = Date.now();
      dirtySinceRef.current = null;
      try {
        const snap = await api.saveAttempt(attemptId, answers, flagged, {
          idempotencyKey: saveKey(attemptId, liveModuleId, version ?? 0),
          expectedVersionNumber: version,
        });
        // Record acceptance BEFORE applying: applyAttempt re-renders synchronously.
        sentRef.current = { moduleId: liveModuleId, signature };
        sentAnswersRef.current = { moduleId: liveModuleId, answers };
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
        // Keep the local draft regardless — it is what recovers this work. The
        // payload also stays "unsent", so any later effect run re-sends it.
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
        // version bump re-arms the effect (the payload is still unsent).
      } finally {
        inFlightRef.current = false;
      }
    };

    timer = setTimeout(flush, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, flagged, enabled, submitting, online, liveModuleId, answersModuleId, version, attemptId, debounceMs]);

  // A finished (or failed and retried) submit re-opens the hand-off for the next one.
  useEffect(() => {
  }, [submitting]);
}
