/**
 * The exam attempt client. In the real app it talks to the server
 * (`/api/{exams|midterms}/attempts/...`) through the native transport; under `vite dev` it drives
 * the in-memory mock engine so the whole loop is reviewable without a backend.
 *
 * Endpoints (all already on the server, chosen by `base`):
 *   POST {base}/              {practice_test|midterm}             → { id }
 *   GET  {base}/{id}/status/                                      → attempt
 *   POST {base}/{id}/save_attempt/   { answers, flagged, expected_version_number }  → attempt
 *   POST {base}/{id}/submit_module/  { answers, flagged, expected_version_number }  → attempt
 */
import { DEV_MOCK } from "@/lib/env";
import { apiGet, apiPost } from "@/lib/api";
import { createMockEngine } from "./mock";
import type { Attempt, AttemptState, ActiveModule, ExamQuestion, PracticeTestDetails } from "./types";

export interface ExamSource {
  /** Which attempt family: pastpapers vs midterms. */
  base: "exams" | "midterms";
  /** The practice-test (pastpaper section) or midterm id to start/resume. */
  id: number;
  kind: "rw" | "math";
}

export interface ExamApi {
  createOrResume(): Promise<number>;
  getStatus(id: number): Promise<Attempt>;
  save(id: number, answers: Record<string, string>, flagged: number[], version: number): Promise<Attempt>;
  submitModule(id: number, answers: Record<string, string>, flagged: number[], version: number): Promise<Attempt>;
}

export function makeExamApi(source: ExamSource): ExamApi {
  if (DEV_MOCK) {
    const engine = createMockEngine(source.kind);
    return {
      createOrResume: async () => source.id,
      getStatus: async () => engine.getStatus(),
      save: async (_id, a, f) => engine.save(a, f),
      submitModule: async (_id, a, f) => engine.submitModule(a, f),
    };
  }

  const base = `/${source.base}/attempts`;
  const createField = source.base === "midterms" ? "midterm" : "practice_test";
  return {
    createOrResume: async () => {
      const d = await apiPost(`${base}/`, { [createField]: source.id });
      return Number(d?.id);
    },
    getStatus: async (id) => parseAttempt(await apiGet(`${base}/${id}/status/`)),
    save: async (id, answers, flagged, version) =>
      parseAttempt(await apiPost(`${base}/${id}/save_attempt/`, { answers, flagged, expected_version_number: version })),
    submitModule: async (id, answers, flagged, version) =>
      parseAttempt(await apiPost(`${base}/${id}/submit_module/`, { answers, flagged, expected_version_number: version })),
  };
}

// ─────────────────────── defensive parser ───────────────────────
// Forgiving by design: reads the fields the runner needs with sane defaults, so a new optional
// field on the wire never throws. (The site uses a Zod `.passthrough()` schema for the same shape.)

const r = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : typeof v === "number" ? v : Number(v) || null);
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
  };
}
