/**
 * mocksAdmin API client — staff authoring surface for the NEW `mocks` backend app.
 *
 * This is DISTINCT from `examsAdminApi` (legacy Simulation `MockExam`s). These
 * methods drive `/mocks/admin/mocks/…`, where a mock auto-provisions two sections
 * (Reading & Writing, then Math), each with exactly two modules. Per-module
 * questions reuse the existing `exams.AdminQuestionSerializer` shape
 * (`AdminModuleQuestion` in `@/features/questionsAdmin/types`).
 */

import api from "@/lib/api";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MockSubject = "READING_WRITING" | "MATH";

/** One module inside a section (each section has exactly 2). */
export type AdminMockModule = {
  id: number;
  module_order: number;
  time_limit_minutes: number;
  question_count: number;
};

/** A section groups the two modules for one subject. */
export type AdminMockSection = {
  subject: MockSubject;
  modules: AdminMockModule[];
};

/** AdminMockSerializer row (list + detail share this shape). */
export type AdminMock = {
  id: number;
  title: string;
  break_minutes: number;
  is_published: boolean;
  published_at: string | null;
  created_by: number | null;
  created_at: string;
  /** Reading & Writing first, then Math. */
  sections: AdminMockSection[];
  question_count: number;
  publish_ready: boolean;
  publish_block_reason: string;
};

/** DRF may return a bare array or a paginated `{ results: [...] }` object. */
function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

function unwrapQuestions(data: unknown): AdminModuleQuestion[] {
  return unwrapList<AdminModuleQuestion>(data);
}

const base = "/mocks/admin/mocks";

// ─── Client ─────────────────────────────────────────────────────────────────

export const mocksAdminApi = {
  // Mocks (top-level)
  listMocks: async (): Promise<AdminMock[]> => {
    const r = await api.get(`${base}/`);
    return unwrapList<AdminMock>(r.data);
  },
  getMock: async (id: number): Promise<AdminMock> => {
    const r = await api.get(`${base}/${id}/`);
    return r.data as AdminMock;
  },
  createMock: async (data: { title: string; break_minutes?: number }): Promise<AdminMock> => {
    const r = await api.post(`${base}/`, data);
    return r.data as AdminMock;
  },
  updateMock: async (
    id: number,
    patch: Partial<{ title: string; break_minutes: number }>,
  ): Promise<AdminMock> => {
    const r = await api.patch(`${base}/${id}/`, patch);
    return r.data as AdminMock;
  },
  deleteMock: async (id: number): Promise<void> => {
    await api.delete(`${base}/${id}/`);
  },
  publishMock: async (id: number): Promise<AdminMock> => {
    const r = await api.post(`${base}/${id}/publish/`);
    return r.data as AdminMock;
  },
  unpublishMock: async (id: number): Promise<AdminMock> => {
    const r = await api.post(`${base}/${id}/unpublish/`);
    return r.data as AdminMock;
  },

  // Per-module questions
  listModuleQuestions: async (mockId: number, moduleId: number): Promise<AdminModuleQuestion[]> => {
    const r = await api.get(`${base}/${mockId}/modules/${moduleId}/questions/`);
    return unwrapQuestions(r.data);
  },
  /** Backend fills sensible defaults (type by subject, correct_answer "a", score 10) — send `{}`. */
  createModuleQuestion: async (
    mockId: number,
    moduleId: number,
    data: FormData | Record<string, unknown> = {},
  ): Promise<AdminModuleQuestion> => {
    const r = await api.post(`${base}/${mockId}/modules/${moduleId}/questions/`, data);
    return r.data as AdminModuleQuestion;
  },
  updateModuleQuestion: async (
    mockId: number,
    moduleId: number,
    qid: number,
    data: FormData | Record<string, unknown>,
    // Axios infers the multipart boundary from FormData; the flag is advisory
    // (mirrors examsAdminApi.updateQuestion) — never force a Content-Type here.
    isFormData = false,
  ): Promise<AdminModuleQuestion> => {
    const r = await api.patch(
      `${base}/${mockId}/modules/${moduleId}/questions/${qid}/`,
      data,
      isFormData ? {} : {},
    );
    return r.data as AdminModuleQuestion;
  },
  deleteModuleQuestion: async (mockId: number, moduleId: number, qid: number): Promise<void> => {
    await api.delete(`${base}/${mockId}/modules/${moduleId}/questions/${qid}/`);
  },
  reorderModuleQuestions: async (
    mockId: number,
    moduleId: number,
    orderedIds: number[],
  ): Promise<AdminModuleQuestion[]> => {
    const r = await api.post(`${base}/${mockId}/modules/${moduleId}/questions/bulk-reorder/`, {
      ordered_ids: orderedIds,
    });
    return unwrapQuestions(r.data);
  },
};

export type MocksAdminApi = typeof mocksAdminApi;
