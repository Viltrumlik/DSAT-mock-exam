/**
 * The token that ties a midterm sitting to this app's locked-down window (server half:
 * backend/desktop/lockdown.py). Ported from the site's frontend/src/lib/desktop/lockdownSession.ts.
 *
 * Held in memory only — never in storage. A restarted app simply asks for a new one (which also
 * retires the old one on the server), and a token that never touches disk cannot be copied out.
 *
 * Importers: exam/lockdown/useLockdown.ts, exam/useExamAttempt.ts, exam/midterm/MidtermScreen.tsx.
 */
import { ApiError, isTransient } from "@/lib/api";
import { native } from "@/lib/native";
import type { ExamApi } from "../examApi";

export const LOCKDOWN_HEADER = "X-Lockdown-Session";

const tokens = new Map<number, string>();
// A desktop_session/ whose reply never arrived: the server may have issued (and swapped in) a
// token we never saw, so the next "desktop_session_replaced" may be our own doing, not another
// window's. Lets the runner re-bind once instead of telling the student the paper moved.
const unconfirmed = new Set<number>();
const inflight = new Map<number, Promise<{ required: boolean }>>();

/** The header to send with a request about this sitting — empty unless the app bound it. */
export function lockdownHeaders(attemptId: number): Record<string, string> {
  const token = tokens.get(attemptId);
  return token ? { [LOCKDOWN_HEADER]: token } : {};
}

export function hasLockdownSession(attemptId: number): boolean {
  return tokens.has(attemptId);
}

export function clearLockdownSession(attemptId: number): void {
  tokens.delete(attemptId);
  unconfirmed.delete(attemptId);
}

/** Our own last bind may have succeeded unseen (see `unconfirmed`). Read once: it is spent. */
export function takeUnconfirmedBind(attemptId: number): boolean {
  const had = unconfirmed.has(attemptId);
  unconfirmed.delete(attemptId);
  return had;
}

/** Why the server refused a request about a sitting that belongs to the app. */
export type DesktopBlockReason =
  | "desktop_required"
  | "desktop_session_replaced"
  | "desktop_challenge_invalid"
  | "desktop_proof_invalid"
  | "desktop_update_required"
  | "desktop_not_live";

/** A request the server turned away because the sitting must be (or was) taken in the app. */
export class DesktopBlockedError extends Error {
  constructor(
    readonly reason: DesktopBlockReason,
    message?: string,
  ) {
    super(message || reason);
    this.name = "DesktopBlockedError";
  }
}

/** The shell refused to sign — it is not locked (the watchdog let go) or its key is bad. */
export class ProofRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofRefusedError";
  }
}

/** The app-binding reason inside a server refusal, or null for any other failure. Same predicate as the site. */
export function desktopBlockReason(e: unknown): DesktopBlockReason | null {
  if (e instanceof DesktopBlockedError) return e.reason;
  if (!(e instanceof ApiError)) return null;
  if (e.status !== 403 && e.status !== 409 && e.status !== 426) return null;
  const reason = e.body?.reason;
  if (e.body?.desktop_required !== true || typeof reason !== "string" || !reason.startsWith("desktop_")) return null;
  return reason as DesktopBlockReason;
}

/** `e` as a DesktopBlockedError when it is the server's app-binding refusal; else `e` itself. */
export function asDesktopBlocked(e: unknown): unknown {
  const reason = desktopBlockReason(e);
  if (!reason || e instanceof DesktopBlockedError) return e;
  const detail = e instanceof ApiError ? e.body?.detail : undefined;
  return new DesktopBlockedError(reason, typeof detail === "string" ? detail : undefined);
}

const PROOF_INVALID_DETAIL = "The app could not prove it is locked down. Restart the MasterSAT app and try again.";

async function bindOnce(api: ExamApi, attemptId: number): Promise<{ required: boolean }> {
  const { nonce } = await api.challenge(attemptId);
  let proof;
  try {
    proof = await native.lockdownProve(attemptId, nonce);
  } catch (e) {
    // A local failure, not a network one — never shown as "check your connection".
    throw new ProofRefusedError(e instanceof Error ? e.message : String(e));
  }
  unconfirmed.add(attemptId);
  // The body is `{ nonce, ...proof }`: the shell's proof carries no nonce of its own.
  const grant = await api.openSession(attemptId, { nonce, ...proof });
  unconfirmed.delete(attemptId);
  if (!grant.lockdown_session) throw new DesktopBlockedError("desktop_proof_invalid", PROOF_INVALID_DETAIL);
  tokens.set(attemptId, grant.lockdown_session);
  return { required: grant.required };
}

/**
 * Bind this sitting to this window: fetch a challenge, have the (already locked-down) shell sign
 * it, trade the signature for the session token. A transient failure retries the WHOLE chain with
 * a fresh nonce (any answer from desktop_session/ spends the nonce), up to three times.
 *
 * Single-flight per attempt: React StrictMode double-runs effects in dev, and a second challenge
 * overwrites the first nonce on the server, which would fail the first proof.
 */
export function bindAttemptToApp(api: ExamApi, attemptId: number): Promise<{ required: boolean }> {
  const running = inflight.get(attemptId);
  if (running) return running;
  const p = (async () => {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await bindOnce(api, attemptId);
      } catch (e) {
        last = e;
        if (!isTransient(e)) throw asDesktopBlocked(e);
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
      }
    }
    throw last;
  })().finally(() => inflight.delete(attemptId));
  inflight.set(attemptId, p);
  return p;
}
