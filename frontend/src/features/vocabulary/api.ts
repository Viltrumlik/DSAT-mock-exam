import api, { getCachedCsrfToken } from "@/lib/api";

import type {
  CustomSetSummary,
  SessionFinishPayload,
  SessionSummary,
  StudyMode,
  StudySession,
  VocabHomeworkGroup,
  VocabSectionDetail,
  VocabSectionSummary,
  VocabSetDetail,
  VocabWordSearchResult,
} from "./types";

const BASE = "/vocabulary";

export const vocabularyApi = {
  listSections: async (): Promise<VocabSectionSummary[]> => {
    const r = await api.get(`${BASE}/sections/`);
    return r.data as VocabSectionSummary[];
  },

  getSection: async (sectionId: number): Promise<VocabSectionDetail> => {
    const r = await api.get(`${BASE}/sections/${sectionId}/`);
    return r.data as VocabSectionDetail;
  },

  getSet: async (setId: number): Promise<VocabSetDetail> => {
    const r = await api.get(`${BASE}/sets/${setId}/`);
    return r.data as VocabSetDetail;
  },

  /** Bank-wide word search that feeds the custom-set builder. */
  searchWords: async (params: { q?: string; section?: number; limit?: number }): Promise<VocabWordSearchResult[]> => {
    const r = await api.get(`${BASE}/words/`, { params });
    return r.data as VocabWordSearchResult[];
  },

  listMySets: async (): Promise<CustomSetSummary[]> => {
    const r = await api.get(`${BASE}/my-sets/`);
    return r.data as CustomSetSummary[];
  },

  createMySet: async (body: { title: string; word_ids: number[] }): Promise<VocabSetDetail> => {
    const r = await api.post(`${BASE}/my-sets/`, body);
    return r.data as VocabSetDetail;
  },

  updateMySet: async (
    setId: number,
    body: { title?: string; word_ids?: number[] },
  ): Promise<VocabSetDetail> => {
    const r = await api.patch(`${BASE}/my-sets/${setId}/`, body);
    return r.data as VocabSetDetail;
  },

  deleteMySet: async (setId: number): Promise<void> => {
    await api.delete(`${BASE}/my-sets/${setId}/`);
  },

  listHomework: async (): Promise<VocabHomeworkGroup[]> => {
    const r = await api.get(`${BASE}/homework/`);
    return r.data as VocabHomeworkGroup[];
  },

  startSession: async (body: { set_id: number; mode: StudyMode }): Promise<StudySession> => {
    const r = await api.post(`${BASE}/sessions/`, body);
    return r.data as StudySession;
  },

  finishSession: async (
    sessionId: number,
    body: SessionFinishPayload,
  ): Promise<SessionSummary> => {
    const r = await api.post(`${BASE}/sessions/${sessionId}/finish/`, body);
    return r.data as SessionSummary;
  },

  /**
   * Fire-and-forget partial flush that survives a tab close (`keepalive`), so a
   * round the student walks out of still records the answers they gave. Mirrors
   * the exam runner's `saveAttemptKeepalive`; axios cannot set `keepalive`, so
   * this one path goes through `fetch` and carries the CSRF token itself.
   *
   * `partial` is forced on: this call may never complete the session.
   */
  flushSessionPartial: (
    sessionId: number,
    body: Omit<SessionFinishPayload, "partial">,
  ): void => {
    try {
      const token = getCachedCsrfToken();
      void fetch(`/api${BASE}/sessions/${sessionId}/finish/`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(token ? { "X-CSRFToken": token } : {}) },
        body: JSON.stringify({ ...body, partial: true }),
      });
    } catch {
      /* best-effort: the completing finish re-sends anything still unsent */
    }
  },
};
