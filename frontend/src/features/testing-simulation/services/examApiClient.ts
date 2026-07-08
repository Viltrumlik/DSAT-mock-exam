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
import { type Attempt, parseAttempt } from "../types";

interface MutationOptions {
  idempotencyKey?: string;
  expectedVersionNumber?: number;
}

function idemHeaders(key?: string): Record<string, string> | undefined {
  return key ? { "Idempotency-Key": key } : undefined;
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
      try {
        const r = await api.get(`${base}/${attemptId}/status/`);
        return parseAttempt(r.data, "GET status");
      } catch {
        const r = await api.get(`${base}/${attemptId}/`);
        return parseAttempt(r.data, "GET attempt");
      }
    },

    /** Transition NOT_STARTED → active. Idempotent via key. */
    async start(attemptId: number, idempotencyKey?: string): Promise<Attempt> {
      const r = await api.post(`${base}/${attemptId}/start/`, {}, { headers: idemHeaders(idempotencyKey) });
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
          headers: { "Content-Type": "application/json", ...(token ? { "X-CSRFToken": token } : {}) },
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
      const r = await api.post(
        `${base}/${attemptId}/submit_module/`,
        withVersion({ answers, flagged }, opts.expectedVersionNumber),
        { headers: idemHeaders(opts.idempotencyKey) },
      );
      return parseAttempt(r.data, "POST submit_module");
    },

    /** Persist in-progress answers without advancing state (autosave). */
    async saveAttempt(
      attemptId: number,
      answers: Record<string, string>,
      flagged: number[],
      opts: MutationOptions = {},
    ): Promise<Attempt> {
      const r = await api.post(
        `${base}/${attemptId}/save_attempt/`,
        withVersion({ answers, flagged }, opts.expectedVersionNumber),
        { headers: idemHeaders(opts.idempotencyKey) },
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
