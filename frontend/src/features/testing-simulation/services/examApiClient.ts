/**
 * Typed client for the SAT exam engine. Every method validates its response
 * through `parseAttempt`, so callers always receive a trusted `Attempt`.
 *
 * Transport is the shared, auth-aware axios instance (`@/lib/api`) — it carries
 * the JWT access token and refresh interceptors. Only the exam-specific request
 * shapes are owned here.
 *
 * `createExamApi(base)` lets the SAME runner drive different attempt backends that
 * speak the identical protocol: `/exams/attempts` (pastpaper/mock) and
 * `/midterms/attempts` (the separated midterm). The default export stays pastpaper.
 */
import api, { getCachedCsrfToken } from "@/lib/api";
import { asDesktopBlocked, desktopBlockReason, lockdownHeaders } from "@/lib/desktop/lockdownSession";
import { type Attempt, parseAttempt } from "../types";

interface MutationOptions {
  idempotencyKey?: string;
  expectedVersionNumber?: number;
  /** The module this submit is FOR. The server no-ops if the attempt has already advanced
   *  past it, so a retried/duplicate submit can't finalize the next module by mistake. */
  moduleId?: number;
}

/**
 * Every request about an attempt carries the Windows app's lockdown token when the app has
 * bound the sitting (`lib/desktop/lockdownSession`) — a midterm the server only answers from
 * the locked-down window. Everywhere else the token is absent and this adds nothing.
 */
function headersFor(attemptId: number, idempotencyKey?: string): Record<string, string> {
  return { ...lockdownHeaders(attemptId), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) };
}

/** Rethrow the server's "take this in the app" refusal as a `DesktopBlockedError`. */
async function guarded<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (e) {
    throw asDesktopBlocked(e);
  }
}

function withVersion(body: Record<string, unknown>, version?: number): Record<string, unknown> {
  if (version != null) body.expected_version_number = version;
  return body;
}

/** Build an exam-engine client bound to a base path, e.g. "/exams/attempts". */
export function createExamApi(base: string) {
  return {
    /** Canonical poll endpoint; falls back to the legacy retrieve route. */
    async getStatus(attemptId: number): Promise<Attempt> {
      const headers = headersFor(attemptId);
      try {
        const r = await api.get(`${base}/${attemptId}/status/`, { headers });
        return parseAttempt(r.data, "GET status");
      } catch (e) {
        // The legacy route would only be refused for the same reason — say it once.
        if (desktopBlockReason(e)) throw asDesktopBlocked(e);
        const r = await guarded(api.get(`${base}/${attemptId}/`, { headers }));
        return parseAttempt(r.data, "GET attempt");
      }
    },

    /** Transition NOT_STARTED → active. Idempotent via key. */
    async start(attemptId: number, idempotencyKey?: string): Promise<Attempt> {
      const r = await guarded(
        api.post(`${base}/${attemptId}/start/`, {}, { headers: headersFor(attemptId, idempotencyKey) }),
      );
      return parseAttempt(r.data, "POST start");
    },

    /** Pause the wall clock (pastpapers only; mocks + midterms disallow pause server-side). */
    async pause(attemptId: number): Promise<Attempt> {
      const r = await api.post(`${base}/${attemptId}/pause/`, {});
      return parseAttempt(r.data, "POST pause");
    },

    async resumePause(attemptId: number): Promise<Attempt> {
      const r = await api.post(`${base}/${attemptId}/resume_pause/`, {});
      return parseAttempt(r.data, "POST resume_pause");
    },

    /** Fire-and-forget pause that survives a tab close (`keepalive`). Pastpaper-only in practice. */
    pauseKeepalive(attemptId: number): void {
      try {
        const token = getCachedCsrfToken();
        void fetch(`/api${base}/${attemptId}/pause/`, {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "X-CSRFToken": token } : {}),
            ...lockdownHeaders(attemptId),
          },
          body: "{}",
        });
      } catch {
        /* best-effort: progress is also continuously autosaved and paused on return */
      }
    },

    /** Submit the active module → advances state. */
    async submitModule(
      attemptId: number,
      answers: Record<string, string>,
      flagged: number[],
      opts: MutationOptions = {},
    ): Promise<Attempt> {
      const body: Record<string, unknown> = { answers, flagged };
      if (opts.moduleId != null) body.module_id = opts.moduleId;
      const r = await guarded(
        api.post(
          `${base}/${attemptId}/submit_module/`,
          withVersion(body, opts.expectedVersionNumber),
          { headers: headersFor(attemptId, opts.idempotencyKey) },
        ),
      );
      return parseAttempt(r.data, "POST submit_module");
    },

    /**
     * Fire-and-forget answer save that survives a tab close (`keepalive`), so the
     * student's LATEST answers reach the server even on an abrupt leave (tab
     * switch/close, navigate) — resumable on any device, not just this browser's
     * local draft. Mirrors the assessment runner's answer keepalive.
     *
     * `expectedVersionNumber` is optional and callers should normally OMIT it: a
     * fire-and-forget request can neither observe a 409 nor retry one, so pinning
     * a version turns any concurrent autosave — which bumps version_number about
     * once a second — into a silently discarded flush. Callers guard staleness
     * structurally instead (don't flush mid module-transition or from a passive tab).
     */
    saveAttemptKeepalive(
      attemptId: number,
      answers: Record<string, string>,
      flagged: number[],
      expectedVersionNumber?: number,
    ): void {
      try {
        const token = getCachedCsrfToken();
        void fetch(`/api${base}/${attemptId}/save_attempt/`, {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "X-CSRFToken": token } : {}),
            ...lockdownHeaders(attemptId),
          },
          // `background: true` tells the server this flush comes from a leaving/hidden tab,
          // so it may persist the answers but must NOT advance a midterm into its next
          // timed module — that clock would start while nobody is watching the screen.
          body: JSON.stringify(withVersion({ answers, flagged, background: true }, expectedVersionNumber)),
        });
      } catch {
        /* best-effort: work is also locally drafted and re-saved on resume */
      }
    },

    /**
     * Report that the student left the exam window. Returns what it cost them.
     *
     * The client never decides the consequence — it says "they left" and the server answers
     * with the tally, the grace and whether the paper has just been taken in. Same contract
     * on both proctored backends (`/midterms/…/offscreen/`, `/mocks/…/offscreen/`), which is
     * why it belongs on the shared factory rather than on one exam's own client.
     */
    async reportOffscreen(
      attemptId: number,
      idempotencyKey: string,
    ): Promise<{ violations?: number; limit?: number; grace_seconds?: number; terminated?: boolean; attempt?: unknown }> {
      const r = await guarded(
        api.post(`${base}/${attemptId}/offscreen/`, {}, { headers: headersFor(attemptId, idempotencyKey) }),
      );
      return r.data ?? {};
    },

    /** Persist in-progress answers without advancing state (autosave). */
    async saveAttempt(
      attemptId: number,
      answers: Record<string, string>,
      flagged: number[],
      opts: MutationOptions = {},
    ): Promise<Attempt> {
      const r = await guarded(
        api.post(
          `${base}/${attemptId}/save_attempt/`,
          withVersion({ answers, flagged }, opts.expectedVersionNumber),
          { headers: headersFor(attemptId, opts.idempotencyKey) },
        ),
      );
      return parseAttempt(r.data, "POST save_attempt");
    },
  };
}

export type ExamApi = ReturnType<typeof createExamApi>;

/** Default pastpaper/mock client (unchanged path). */
export const examApi: ExamApi = createExamApi("/exams/attempts");

/** Separated single-module midterm client (same protocol, different backend). */
export const midtermExamApi: ExamApi = createExamApi("/midterms/attempts");

/** Separated full-mock client (same protocol; break handled via a separate end_break call). */
export const mockExamApi: ExamApi = createExamApi("/mocks/attempts");
