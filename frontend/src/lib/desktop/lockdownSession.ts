/**
 * The token that ties a midterm sitting to the app's locked-down window (server half:
 * `backend/desktop/lockdown.py`).
 *
 * Held in memory only — never in storage. A reload or a restarted app simply asks for a new
 * one (which also retires the old one on the server), and a token that never touches disk
 * cannot be copied out to another browser.
 */
import api from "@/lib/api";

import { desktop } from "./bridge";

export const LOCKDOWN_HEADER = "X-Lockdown-Session";

const tokens = new Map<number, string>();

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

/** The app-binding reason inside an axios error, or null for any other failure. */
export function desktopBlockReason(e: unknown): DesktopBlockReason | null {
  const response = (e as { response?: { status?: number; data?: { reason?: unknown; desktop_required?: unknown } } })
    ?.response;
  if (!response || (response.status !== 403 && response.status !== 409 && response.status !== 426)) return null;
  const reason = response.data?.reason;
  if (response.data?.desktop_required !== true || typeof reason !== "string" || !reason.startsWith("desktop_")) {
    return null;
  }
  return reason as DesktopBlockReason;
}

/** `e` as a `DesktopBlockedError` when it is the server's app-binding refusal; else `e` itself. */
export function asDesktopBlocked(e: unknown): unknown {
  const reason = desktopBlockReason(e);
  if (!reason) return e;
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return new DesktopBlockedError(reason, typeof detail === "string" ? detail : undefined);
}

/**
 * Bind this sitting to this window: fetch a challenge, have the (already locked-down) shell
 * sign it, trade the signature for the session token. Three requests rather than one, so a
 * retried step never replays a stale token.
 */
export async function bindAttemptToApp(attemptId: number): Promise<void> {
  try {
    const challenge = await api.post(`/midterms/attempts/${attemptId}/desktop_challenge/`, {});
    const nonce = String(challenge.data?.nonce ?? "");
    const proof = await desktop.prove(attemptId, nonce);
    const session = await api.post(`/midterms/attempts/${attemptId}/desktop_session/`, { nonce, ...proof });
    const token = String(session.data?.lockdown_session ?? "");
    if (!token) throw new DesktopBlockedError("desktop_proof_invalid");
    tokens.set(attemptId, token);
  } catch (e) {
    throw asDesktopBlocked(e);
  }
}
