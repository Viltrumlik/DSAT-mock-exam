import api, { getCachedCsrfToken } from "@/lib/api";

import type {
  CustomSetSummary,
  SessionFinishPayload,
  SessionStartPayload,
  SessionSummary,
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

  /**
   * Open a study run. `assignment_id` tells the server WHICH homework this run
   * belongs to; without it the server guesses the newest live assignment
   * carrying the set, which is wrong the moment a set is assigned twice.
   *
   * A supplied id the server cannot resolve against the student's own live
   * memberships is a 400, not a silent fallback — that refusal is deliberate on
   * the server side, so this call only ever carries an id that came from a real
   * homework launcher.
   */
  startSession: async (body: SessionStartPayload): Promise<StudySession> => {
    // Assembled key by key so self-study sends NO `assignment_id` at all rather
    // than an explicit null. The server reads both as "unclaimed", but an absent
    // key is what "the client has nothing to say" means, and it keeps the
    // self-study request byte-identical to the one every earlier client sent.
    const payload: Record<string, unknown> = { set_id: body.set_id, mode: body.mode };
    if (body.assignment_id != null) payload.assignment_id = body.assignment_id;
    const r = await api.post(`${BASE}/sessions/`, payload);
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
