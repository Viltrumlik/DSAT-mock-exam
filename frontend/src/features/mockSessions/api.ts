/**
 * Staff client for invigilated mock sittings (`/api/mocks/admin/sessions/`).
 *
 * Two audiences, one surface: an ADMIN mints the sitting and owns its code, a TEACHER runs
 * the room on the day (approve, Start, End). The split is enforced server-side — the console
 * simply hides the controls a teacher will be refused.
 */

import api from "@/lib/api";

export type MockSessionStatus = "OPEN" | "STARTED" | "ENDED" | "CANCELLED";
export type PlaceStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface MockSessionCounts {
  pending: number;
  approved: number;
  rejected: number;
  seated: number;
}

export interface MockSession {
  id: number;
  mock: number;
  mock_title: string;
  title: string;
  session_date: string;
  status: MockSessionStatus;
  access_code: string;
  access_code_set_at: string | null;
  classroom: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  created_by: number | null;
  created_by_details: { id?: number; name?: string; username?: string };
  counts: MockSessionCounts;
  accepts_requests: boolean;
}

export interface MockSessionParticipant {
  id: number;
  status: PlaceStatus;
  requested_at: string;
  decided_at: string | null;
  student: number;
  student_details: { id?: number; name?: string; username?: string };
  attempt: number | null;
  /** Live phase of their paper, or "TERMINATED:OFFSCREEN". Empty until the room starts. */
  attempt_state: string;
}

const base = "/mocks/admin/sessions";

function unwrap<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

export const mockSessionsApi = {
  list: async (): Promise<MockSession[]> => unwrap<MockSession>((await api.get(`${base}/`)).data),
  get: async (id: number): Promise<MockSession> => (await api.get(`${base}/${id}/`)).data,

  /** Admin only. The server mints the 6-digit code on create. */
  create: async (data: { mock: number; session_date: string; title?: string }): Promise<MockSession> =>
    (await api.post(`${base}/`, data)).data,
  /** Admin only — the fix for a code that leaked before the sitting. */
  rotateCode: async (id: number): Promise<MockSession> =>
    (await api.post(`${base}/${id}/rotate_code/`, {})).data,
  remove: async (id: number): Promise<void> => {
    await api.delete(`${base}/${id}/`);
  },

  participants: async (id: number): Promise<MockSessionParticipant[]> =>
    unwrap<MockSessionParticipant>((await api.get(`${base}/${id}/participants/`)).data),
  decide: async (id: number, participantIds: number[], approve: boolean) =>
    (await api.post(`${base}/${id}/decide/`, { participant_ids: participantIds, approve })).data,

  /** Opens the paper for the whole approved room, on one clock. */
  start: async (id: number): Promise<MockSession & { seated: number }> =>
    (await api.post(`${base}/${id}/start/`, {})).data,
  end: async (id: number): Promise<MockSession & { drained: number }> =>
    (await api.post(`${base}/${id}/end/`, {})).data,
  cancel: async (id: number): Promise<MockSession> =>
    (await api.post(`${base}/${id}/cancel/`, {})).data,
};
