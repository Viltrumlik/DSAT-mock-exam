import api from "@/lib/api";

import type {
  CustomSetSummary,
  SessionResult,
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
    body: { duration_ms: number; results: SessionResult[] },
  ): Promise<SessionSummary> => {
    const r = await api.post(`${BASE}/sessions/${sessionId}/finish/`, body);
    return r.data as SessionSummary;
  },
};

export default vocabularyApi;
