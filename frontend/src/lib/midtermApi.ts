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
  is_before_start: boolean; // scheduled window hasn't opened yet (countdown)
  awaiting_code: boolean; // classroom window is open but teacher hasn't started it (no access code yet)
  available_at: string | null;
  deadline: string | null; // classroom deadline; past it + not started = missed
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
  /** Difficulty tier ("foundation"/"junior"/"middle"/"senior"); "" = untagged. */
  level: string;
  scoring_scale: string;
  score_ceiling: number;
  duration_minutes: number;
  question_count: number;
  is_published: boolean;
}

/** What one reported off-screen offence cost the student (see midterms/views.offscreen). */
export interface OffscreenReport {
  /** Offences recorded for this attempt so far, server-side. */
  violations: number;
  /** Seconds to return before the paper is taken in; 0 once the allowance is spent. */
  grace_seconds: number;
  /** True when this offence ended the sitting — the SERVER has already submitted it. */
  terminated: boolean;
  limit: number;
  /**
   * Fresh attempt snapshot. Absent on the post-completion no-op path (a closing tab firing
   * one last event), so callers must treat it as optional. Untyped here because the runner
   * owns the attempt contract and validates it with `parseAttempt`.
   */
  attempt?: unknown;
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
  /**
   * Check the classroom access code before starting. Pass "" to probe whether a
   * code is required (returns {ok:true, requires_code:false} when none is set).
   * A wrong code rejects with HTTP 403.
   */
  async verifyCode(attemptId: number, code: string): Promise<{ ok: boolean; requires_code: boolean }> {
    const r = await api.post(`/midterms/attempts/${attemptId}/verify_code/`, { code });
    return r.data as { ok: boolean; requires_code: boolean };
  },
  /**
   * Report that the student left the exam window, and learn what it cost them.
   *
   * The tally lives on the server; this only says "it happened". `idempotencyKey` must be
   * stable for ONE absence — a retried report may not burn two of the three chances — and
   * must be fresh for a new one, or the server dedupes a real offence away.
   */
  async reportOffscreen(attemptId: number, idempotencyKey: string): Promise<OffscreenReport> {
    const r = await api.post(
      `/midterms/attempts/${attemptId}/offscreen/`,
      {},
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
    return r.data as OffscreenReport;
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
  async classroomMidterms(
    classroomId: number,
  ): Promise<{ midterm_id: number; title: string; subject: string; assigned: number; completed: number }[]> {
    const r = await api.get(`/classes/${classroomId}/midterms-v2/`);
    return r.data?.midterms ?? [];
  },
  async downloadClassroomCertificates(classroomId: number, midtermId: number): Promise<Blob> {
    const r = await api.get(`/classes/${classroomId}/midterms-v2/${midtermId}/certificates/download-all/`, {
      responseType: "blob",
    });
    return r.data as Blob;
  },
  async assignToClassroom(classroomId: number, midtermId: number, schedule?: { starts_at?: string | null; deadline?: string | null }) {
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
  /** Generate/rotate the 6-digit access code students must enter ("Start midterm"). */
  async generateStartCode(classroomId: number, midtermId: number): Promise<{ access_code: string; schedule: Record<string, unknown> }> {
    const r = await api.post(`/classes/${classroomId}/midterms-v2/${midtermId}/start-code/`, {});
    return r.data as { access_code: string; schedule: Record<string, unknown> };
  },
  // ── version assignment (classroom flavor) ──────────────────────────────────
  async getVersions(classroomId: number, midtermId: number): Promise<VersionAssignData> {
    const r = await api.get(`/classes/${classroomId}/midterms-v2/${midtermId}/versions/`);
    return r.data as VersionAssignData;
  },
  /** A fresh random even distribution across versions (NOT saved). */
  async previewVersions(classroomId: number, midtermId: number): Promise<{ assignments: VersionAssignRow[]; versions: MidtermVersionBrief[] }> {
    const r = await api.post(`/classes/${classroomId}/midterms-v2/${midtermId}/versions/`, { action: "preview" });
    return r.data;
  },
  /** Persist a { student_id: version_id } mapping. */
  async commitVersions(classroomId: number, midtermId: number, assignments: Record<number, number>): Promise<{ detail: string; assignments: VersionAssignRow[] }> {
    const r = await api.post(`/classes/${classroomId}/midterms-v2/${midtermId}/versions/`, { action: "commit", assignments });
    return r.data;
  },
};

export interface MidtermVersionBrief { id: number; version_number: number; label: string }
export interface VersionAssignRow { student_id: number; student_name: string; version_id: number; version_number: number; version_label: string }
export interface VersionAssignData {
  has_versions: boolean;
  versions: MidtermVersionBrief[];
  assignments: VersionAssignRow[];
  unassigned_count: number;
}

export const scaleMax = (scale: string, ceiling?: number) => ceiling ?? (scale === "SCALE_800" ? 800 : 100);
export const subjectLabel = (subject: string) => (subject === "MATH" ? "Mathematics" : "Reading & Writing");
