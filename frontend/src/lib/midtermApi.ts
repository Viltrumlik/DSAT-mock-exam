/**
 * Client for the separated midterm system (/api/midterms/*). Kept apart from the legacy
 * classesApi midterm block (which is MockExam/mock_exam_id-based) so the new student,
 * teacher-standalone and result surfaces talk only to the new backend.
 */
import api from "@/lib/api";

export interface MidtermCertificate {
  available: boolean;
  code: string;
  download_url: string;
  rank: number | null;
  cohort_size: number | null;
}

export interface MidtermRow {
  midterm_id: number;
  title: string;
  subject: string; // READING_WRITING | MATH
  scoring_scale: string; // SCALE_100 | SCALE_800
  score_ceiling: number;
  duration_minutes: number;
  question_count: number;
  flavor: "CLASSROOM" | "STANDALONE";
  attempt_id: number | null;
  state: string;
  submitted: boolean;
  is_open: boolean;
  available_at: string | null;
  results_visible: boolean;
  score: number | null;
  certificate: MidtermCertificate | null;
}

export interface MidtermReview {
  score_only: boolean;
  released: boolean;
  mock_kind: string;
  subject: string;
  scoring_scale: string;
  total_score?: number;
  score_ceiling?: number;
  certificate?: MidtermCertificate;
}

export interface MidtermCatalogItem {
  id: number;
  title: string;
  subject: string;
  scoring_scale: string;
  score_ceiling: number;
  duration_minutes: number;
  question_count: number;
  is_published: boolean;
}

export interface StandaloneResultRow {
  student_id: number;
  student_name: string;
  instructor_id: number | null;
  instructor_name: string | null;
  state: string;
  submitted: boolean;
  score: number | null;
  score_ceiling: number;
}

export const midtermApi = {
  // ── student ──────────────────────────────────────────────────────────────
  async myMidterms(): Promise<MidtermRow[]> {
    const r = await api.get("/midterms/mine/");
    return r.data?.results ?? [];
  },
  /** Create-or-resume an attempt; returns the attempt id. */
  async createAttempt(midtermId: number): Promise<number> {
    const r = await api.post("/midterms/attempts/", { midterm: midtermId });
    return r.data.id as number;
  },
  async getReview(attemptId: number): Promise<MidtermReview> {
    const r = await api.get(`/midterms/attempts/${attemptId}/review/`);
    return r.data as MidtermReview;
  },

  // ── teacher: standalone area ───────────────────────────────────────────────
  async catalog(): Promise<MidtermCatalogItem[]> {
    const r = await api.get("/midterms/teacher/midterms/");
    return r.data?.results ?? [];
  },
  async grant(midtermId: number, userIds: number[], expiresAt?: string | null) {
    const r = await api.post(`/midterms/teacher/midterms/${midtermId}/grant/`, {
      user_ids: userIds,
      expires_at: expiresAt ?? null,
    });
    return r.data;
  },
  async revoke(midtermId: number, userIds: number[]) {
    const r = await api.post(`/midterms/teacher/midterms/${midtermId}/revoke/`, { user_ids: userIds });
    return r.data;
  },
  async standaloneResults(midtermId: number): Promise<{ midterm: MidtermCatalogItem; students: StandaloneResultRow[] }> {
    const r = await api.get(`/midterms/teacher/midterms/${midtermId}/results/`);
    return r.data;
  },

  // ── teacher: classroom (v2) flavor ─────────────────────────────────────────
  async assignToClassroom(classroomId: number, midtermId: number, schedule?: { starts_at?: string; deadline?: string }) {
    const r = await api.post(`/classes/${classroomId}/midterms-v2/assign/`, { midterm_id: midtermId, ...schedule });
    return r.data;
  },
  async classroomPanel(classroomId: number, midtermId: number) {
    const r = await api.get(`/classes/${classroomId}/midterms-v2/${midtermId}/panel/`);
    return r.data;
  },
  async updateClassroomSchedule(classroomId: number, midtermId: number, patch: Record<string, unknown>) {
    const r = await api.patch(`/classes/${classroomId}/midterms-v2/${midtermId}/panel/`, patch);
    return r.data;
  },
  async issueClassroomCertificates(classroomId: number, midtermId: number, force = false) {
    const r = await api.post(`/classes/${classroomId}/midterms-v2/${midtermId}/certificates/issue/${force ? "?force=1" : ""}`, {});
    return r.data;
  },
};

export const scaleMax = (scale: string, ceiling?: number) => ceiling ?? (scale === "SCALE_800" ? 800 : 100);
export const subjectLabel = (subject: string) => (subject === "MATH" ? "Mathematics" : "Reading & Writing");
