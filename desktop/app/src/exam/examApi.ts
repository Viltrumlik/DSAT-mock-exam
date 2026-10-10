/**
 * The exam attempt client. In the real app it talks to the server
 * (`/api/{exams|midterms}/attempts/...`) through the native transport; under `vite dev` it drives
 * the in-memory mock engine so the whole loop is reviewable without a backend.
 *
 * Endpoints (all already on the server, chosen by `base`):
 *   POST {base}/              {practice_test|midterm}                               → { id }
 *   GET  {base}/{id}/status/                                                        → attempt
 *   POST {base}/{id}/start/                         Idempotency-Key                 → attempt
 *   POST {base}/{id}/save_attempt/   { answers, flagged, expected_version_number }  → attempt
 *   POST {base}/{id}/submit_module/  { answers, flagged, expected_version_number, module_id } → attempt
 * Midterm only:
 *   POST midterms/attempts/{id}/verify_code/        { code }                        → { ok, requires_code }
 *   POST midterms/attempts/{id}/offscreen/          Idempotency-Key                 → OffscreenReport
 *   POST midterms/attempts/{id}/desktop_challenge/  {}                              → { nonce, expires_in }
 *   POST midterms/attempts/{id}/desktop_session/    { nonce, key_id, mac, app_version, precheck }
 *                                                                                   → { lockdown_session, required }
 *
 * The lockdown header (X-Lockdown-Session) rides on status/start/save/submit/offscreen through
 * `opts.headers`, looked up per call so a re-bind takes effect at once. As on the site, create,
 * verify_code, desktop_challenge and desktop_session never carry it.
 */
import { DEV_MOCK } from "@/lib/env";
import { apiGet, apiPost } from "@/lib/api";
import type { LockdownProof } from "@/lib/native";
import { createMockEngine } from "./mock";
import type { Attempt, AttemptState, ActiveModule, ExamQuestion, OffscreenReport, PracticeTestDetails } from "./types";

export interface ExamSource {
  /** Which attempt family: pastpapers vs midterms. */
  base: "exams" | "midterms";
  /** The practice-test (pastpaper section) or midterm id to start/resume. */
  id: number;
  kind: "rw" | "math";
}

export interface ExamApiOptions {
  /** Headers for a request about this attempt — the lockdown session, when the app holds one. */
  headers?: (attemptId: number) => Record<string, string>;
}

export interface LockdownSessionGrant {
  lockdown_session: string;
  required: boolean;
}

export interface ExamApi {
  createOrResume(): Promise<number>;
  getStatus(id: number): Promise<Attempt>;
  start(id: number): Promise<Attempt>;
  /** Throws ApiError 403 for a wrong code. `verifyCode(id, "")` is the site's "is a code needed?" probe. */
  verifyCode(id: number, code: string): Promise<{ ok: boolean; requires_code: boolean }>;
  save(id: number, answers: Record<string, string>, flagged: number[], version: number, moduleId: number): Promise<Attempt>;
  submitModule(id: number, answers: Record<string, string>, flagged: number[], version: number, moduleId: number): Promise<Attempt>;
  offscreen(id: number, idempotencyKey: string): Promise<OffscreenReport>;
  challenge(id: number): Promise<{ nonce: string }>;
  openSession(id: number, body: { nonce: string } & LockdownProof): Promise<LockdownSessionGrant>;
}

export function randomSegment(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One start key per attempt for this run of the app (sessionStorage, like the site's
 * `ts.idem.start.{id}`), so a retried start after a lost reply replays instead of re-starting.
 */
function startKey(id: number): string {
  const slot = `ts.idem.start.${id}`;
  try {
    const existing = sessionStorage.getItem(slot);
    if (existing) return existing;
    const k = `start.${id}.${randomSegment()}`;
    sessionStorage.setItem(slot, k);
    return k;
  } catch {
    return `start.${id}.${randomSegment()}`;
  }
}

export function makeExamApi(source: ExamSource, opts: ExamApiOptions = {}): ExamApi {
  const extra = (id: number, idem?: string): Record<string, string> => {
    const h = { ...(opts.headers?.(id) ?? {}) };
    if (idem) h["Idempotency-Key"] = idem;
    return h;
  };

  if (DEV_MOCK) {
    const engine = createMockEngine(source.kind, { midterm: source.base === "midterms" });
    return {
      createOrResume: () => engine.createOrResume(),
      getStatus: (id) => engine.getStatus(extra(id)),
      start: (id) => engine.start(extra(id)),
      verifyCode: (_id, code) => engine.verifyCode(code),
      save: (id, a, f) => engine.save(a, f, extra(id)),
      submitModule: (id, a, f, _v, moduleId) => engine.submitModule(a, f, moduleId, extra(id)),
      offscreen: (id, key) => engine.offscreen(key, extra(id)),
      challenge: () => engine.challenge(),
      openSession: (_id, body) => engine.openSession(body),
    };
  }

  const base = `/${source.base}/attempts`;
  const createField = source.base === "midterms" ? "midterm" : "practice_test";
  return {
    createOrResume: async () => {
      const d = await apiPost(`${base}/`, { [createField]: source.id });
      return Number(d?.id);
    },
    getStatus: async (id) => parseAttempt(await apiGet(`${base}/${id}/status/`, { headers: extra(id) })),
    start: async (id) => parseAttempt(await apiPost(`${base}/${id}/start/`, {}, { headers: extra(id, startKey(id)) })),
    verifyCode: async (id, code) => {
      const d = await apiPost(`${base}/${id}/verify_code/`, { code });
      return { ok: d?.ok === true, requires_code: d?.requires_code === true };
    },
    save: async (id, answers, flagged, version, moduleId) =>
      parseAttempt(
        await apiPost(
          `${base}/${id}/save_attempt/`,
          { answers, flagged, expected_version_number: version },
          { headers: extra(id, `save.${id}.${moduleId}.v${version}`) },
        ),
      ),
    submitModule: async (id, answers, flagged, version, moduleId) =>
      parseAttempt(
        await apiPost(
          `${base}/${id}/submit_module/`,
          // module_id lets the server turn a stale/retried submit into a no-op instead of
          // finalising the NEXT module with this one's answers.
          { answers, flagged, expected_version_number: version, module_id: moduleId },
          { headers: extra(id, `submit.${id}.${moduleId}.v${version}`) },
        ),
      ),
    offscreen: async (id, key) => (await apiPost(`${base}/${id}/offscreen/`, {}, { headers: extra(id, key) })) ?? {},
    challenge: async (id) => {
      const d = await apiPost(`${base}/${id}/desktop_challenge/`, {});
      return { nonce: String(d?.nonce ?? "") };
    },
    openSession: async (id, body) => {
      const d = await apiPost(`${base}/${id}/desktop_session/`, body);
      return { lockdown_session: String(d?.lockdown_session ?? ""), required: d?.required === true };
    },
  };
}

// ─────────────────────── defensive parser ───────────────────────
// Forgiving by design: reads the fields the runner needs with sane defaults, so a new optional
// field on the wire never throws. (The site uses a Zod `.passthrough()` schema for the same shape.)

const r = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : typeof v === "number" ? v : Number(v) || null);
const numOrUndef = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true;

function parseQuestion(v: unknown): ExamQuestion {
  const o = r(v);
  const t = str(o.question_type, "READING").toUpperCase();
  return {
    id: num(o.id),
    question_type: (t === "MATH" || t === "WRITING" ? t : "READING") as ExamQuestion["question_type"],
    question_text: str(o.question_text),
    question_prompt: typeof o.question_prompt === "string" ? o.question_prompt : undefined,
    question_image: typeof o.question_image === "string" ? o.question_image : null,
    is_math_input: bool(o.is_math_input),
    options: o.options,
  };
}

function parseModule(v: unknown): ActiveModule | null {
  if (!v || typeof v !== "object") return null;
  const o = r(v);
  return {
    id: num(o.id),
    module_order: num(o.module_order) || 1,
    time_limit_minutes: num(o.time_limit_minutes),
    questions: Array.isArray(o.questions) ? o.questions.map(parseQuestion) : [],
  };
}

function parseDetails(v: unknown): PracticeTestDetails {
  const o = r(v);
  return {
    id: num(o.id),
    subject: str(o.subject),
    title: str(o.title),
    total_question_count: typeof o.total_question_count === "number" ? o.total_question_count : undefined,
    calculator_enabled: bool(o.calculator_enabled),
    modules: Array.isArray(o.modules)
      ? o.modules.map((m) => {
          const mo = r(m);
          return { id: num(mo.id), module_order: num(mo.module_order) || 1, time_limit_minutes: num(mo.time_limit_minutes) };
        })
      : undefined,
    mock_kind: typeof o.mock_kind === "string" ? o.mock_kind : undefined,
    calculator_mode: strOrNull(o.calculator_mode),
    scoring_scale: strOrNull(o.scoring_scale),
    pass_mark: typeof o.pass_mark === "number" ? o.pass_mark : null,
    midterm_type: strOrNull(o.midterm_type),
  };
}

export function parseAttempt(data: unknown): Attempt {
  const o = r(data);
  return {
    id: num(o.id),
    current_state: str(o.current_state, "NOT_STARTED") as AttemptState,
    version_number: num(o.version_number),
    practice_test_details: parseDetails(o.practice_test_details),
    current_module: numOrNull(o.current_module),
    current_module_details: parseModule(o.current_module_details),
    current_module_start_time: typeof o.current_module_start_time === "string" ? o.current_module_start_time : null,
    server_now: str(o.server_now, new Date().toISOString()),
    remaining_seconds: numOrNull(o.remaining_seconds),
    module_duration_seconds: numOrNull(o.module_duration_seconds),
    current_module_saved_answers:
      o.current_module_saved_answers && typeof o.current_module_saved_answers === "object"
        ? (o.current_module_saved_answers as Record<string, unknown>)
        : null,
    current_module_flagged_questions: Array.isArray(o.current_module_flagged_questions)
      ? (o.current_module_flagged_questions as number[])
      : null,
    is_completed: bool(o.is_completed),
    is_expired: bool(o.is_expired),
    is_paused: bool(o.is_paused),
    can_submit: typeof o.can_submit === "boolean" ? o.can_submit : undefined,
    score: numOrNull(o.score),
    desktop_required: typeof o.desktop_required === "boolean" ? o.desktop_required : undefined,
    offscreen_violations: numOrUndef(o.offscreen_violations),
    offscreen_limit: numOrUndef(o.offscreen_limit),
    offscreen_grace_seconds: numOrUndef(o.offscreen_grace_seconds),
    terminated_reason: typeof o.terminated_reason === "string" ? o.terminated_reason : undefined,
  };
}

/** The paper is in: the server is scoring it or has finished. */
export function isTerminal(a: Attempt | null | undefined): boolean {
  return !!a && (a.is_completed || a.current_state === "SCORING" || a.current_state === "COMPLETED");
}

/** A module is live and the clock is running. */
export function isRunning(a: Attempt | null | undefined): boolean {
  return !!a && !isTerminal(a) && (a.current_state === "MODULE_1_ACTIVE" || a.current_state === "MODULE_2_ACTIVE");
}
