import api from "@/lib/api";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export interface AttendanceSessionBrief {
  id: number;
  date: string;
  title: string;
  lesson_index: number | null;
  status: "OPEN" | "FINALIZED";
  counts?: Record<string, number> | null;
}

export interface RosterRow {
  student_id: number;
  name: string;
  status: AttendanceStatus | null;
  note: string;
}

export interface AttendanceSummary {
  overall_rate: number | null;
  students: { student_id: number; name: string; attendance_score: number | null }[];
  sessions: { id: number; date: string; title: string; present_rate: number | null; records: number }[];
}

export interface AttendanceDetail {
  attendance_score: number | null;
  counted_sessions: number;
  counts: Record<string, number>;
  trend: "IMPROVING" | "STABLE" | "DECLINING";
  history: { session_id: number; date: string; title: string; status: AttendanceStatus; note: string; finalized: boolean }[];
}

const base = (classId: number) => `/classes/${classId}/attendance`;

export const attendanceApi = {
  /** Sessions materialise server-side on lesson days, so this GET is also what opens
   *  today's register. ``schedule_is_usable`` false means none ever will — the class has no
   *  readable lesson_days — and the page falls back to letting a teacher add one. */
  listSessions: async (classId: number): Promise<{ sessions: AttendanceSessionBrief[]; schedule_is_usable: boolean }> =>
    (await api.get(`${base(classId)}/sessions/`)).data,
  createSession: async (classId: number, data: { date: string; lesson_index?: number | null }): Promise<AttendanceSessionBrief> =>
    (await api.post(`${base(classId)}/sessions/`, data)).data,
  getSession: async (classId: number, sessionId: number): Promise<AttendanceSessionBrief & { roster: RosterRow[] }> =>
    (await api.get(`${base(classId)}/sessions/${sessionId}/`)).data,
  mark: async (classId: number, sessionId: number, records: { student_id: number; status: AttendanceStatus; note?: string }[]) =>
    (await api.post(`${base(classId)}/sessions/${sessionId}/mark/`, { records })).data,
  markAllPresent: async (classId: number, sessionId: number) =>
    (await api.post(`${base(classId)}/sessions/${sessionId}/mark-all-present/`, {})).data,
  finalize: async (classId: number, sessionId: number) =>
    (await api.post(`${base(classId)}/sessions/${sessionId}/finalize/`, {})).data,
  summary: async (classId: number): Promise<AttendanceSummary> =>
    (await api.get(`${base(classId)}/summary/`)).data,
  me: async (classId: number): Promise<AttendanceDetail> =>
    (await api.get(`${base(classId)}/me/`)).data,
};
