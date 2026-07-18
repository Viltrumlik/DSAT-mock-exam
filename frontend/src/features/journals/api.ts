// Journal Management API client. Uses the shared axios instance (default export of
// @/lib/api) so auth cookies, CSRF and error handling are identical to the rest of the app.

import api from "@/lib/api";

import type {
  Classwork,
  ContentOptions,
  JournalDetail,
  JournalListItem,
  LessonDetail,
  LessonSummary,
  LessonType,
  MidtermOption,
} from "./types";

type ListEnvelope<T> = { results: T[]; count: number };

export const journalsApi = {
  list: async (params?: { subject?: string; status?: string }): Promise<ListEnvelope<JournalListItem>> => {
    const r = await api.get("/journals/", { params });
    return r.data;
  },
  create: async (subject: string, level: string): Promise<JournalDetail> => {
    const r = await api.post("/journals/", { subject, level });
    return r.data;
  },
  get: async (id: number): Promise<JournalDetail> => {
    const r = await api.get(`/journals/${id}/`);
    return r.data;
  },
  patch: async (id: number, body: Record<string, unknown>): Promise<JournalDetail> => {
    const r = await api.patch(`/journals/${id}/`, body);
    return r.data;
  },
  publish: async (id: number): Promise<JournalDetail> => {
    const r = await api.post(`/journals/${id}/publish/`);
    return r.data;
  },
  archive: async (id: number): Promise<JournalDetail> => {
    const r = await api.post(`/journals/${id}/archive/`);
    return r.data;
  },
  unarchive: async (id: number): Promise<JournalDetail> => {
    const r = await api.post(`/journals/${id}/unarchive/`);
    return r.data;
  },
  duplicate: async (id: number, targetSubject: string, targetLevel: string): Promise<JournalDetail> => {
    const r = await api.post(`/journals/${id}/duplicate/`, {
      target_subject: targetSubject,
      target_level: targetLevel,
    });
    return r.data;
  },
  exportJournal: async (id: number): Promise<unknown> => {
    const r = await api.get(`/journals/${id}/export/`);
    return r.data;
  },
  importJournal: async (journal: unknown): Promise<JournalDetail> => {
    const r = await api.post(`/journals/import/`, { journal });
    return r.data;
  },
  contentOptions: async (subject: string, level: string, lesson?: number): Promise<ContentOptions> => {
    const r = await api.get(`/journals/content-options/`, { params: { subject, level, lesson } });
    return r.data;
  },
  /** Midterms available for a level (published, subject + exact level match). */
  midtermOptions: async (subject: string, level: string): Promise<{ midterms: MidtermOption[] }> => {
    const r = await api.get(`/journals/midterm-options/`, { params: { subject, level } });
    return r.data;
  },
  /** "New session" — append a session. Nothing is pre-provisioned. */
  addSession: async (
    journalId: number,
    type: LessonType = "HOMEWORK",
    midtermExamId?: number,
  ): Promise<LessonDetail> => {
    const r = await api.post(`/journals/${journalId}/sessions/`, {
      type,
      midterm_exam_id: midtermExamId,
    });
    return r.data;
  },
  deleteSession: async (journalId: number, lessonId: number): Promise<void> => {
    await api.delete(`/journals/${journalId}/lessons/${lessonId}/`);
  },
  classwork: async (journalId: number, lessonId: number): Promise<Classwork> => {
    const r = await api.get(`/journals/${journalId}/lessons/${lessonId}/classwork/`);
    return r.data;
  },
  saveClasswork: async (
    journalId: number,
    lessonId: number,
    data: Record<string, unknown> | FormData,
    options?: { replaceAttachments?: boolean },
  ): Promise<Classwork> => {
    const r = await api.patch(
      `/journals/${journalId}/lessons/${lessonId}/classwork/`,
      data,
      options?.replaceAttachments ? { params: { replace_attachments: "1" } } : {},
    );
    return r.data;
  },
  lessons: async (
    journalId: number,
    params?: Record<string, string>,
  ): Promise<ListEnvelope<LessonSummary>> => {
    const r = await api.get(`/journals/${journalId}/lessons/`, { params });
    return r.data;
  },
  lesson: async (journalId: number, lessonId: number): Promise<LessonDetail> => {
    const r = await api.get(`/journals/${journalId}/lessons/${lessonId}/`);
    return r.data;
  },
  saveLesson: async (
    journalId: number,
    lessonId: number,
    data: Record<string, unknown> | FormData,
    options?: { replaceAttachments?: boolean },
  ): Promise<LessonDetail> => {
    const r = await api.patch(
      `/journals/${journalId}/lessons/${lessonId}/`,
      data,
      options?.replaceAttachments ? { params: { replace_attachments: "1" } } : {},
    );
    return r.data;
  },
  publishLesson: async (journalId: number, lessonId: number): Promise<LessonDetail> => {
    const r = await api.post(`/journals/${journalId}/lessons/${lessonId}/publish/`);
    return r.data;
  },
  resetLesson: async (journalId: number, lessonId: number): Promise<LessonDetail> => {
    const r = await api.post(`/journals/${journalId}/lessons/${lessonId}/reset/`);
    return r.data;
  },
  bulk: async (
    journalId: number,
    action: string,
    ids: number[],
    payload?: Record<string, unknown>,
  ): Promise<{ results: Array<{ id: number; ok: boolean; reason: string }>; affected: number; skipped: number }> => {
    const r = await api.post(`/journals/${journalId}/lessons/bulk/`, { action, ids, payload });
    return r.data;
  },
};
