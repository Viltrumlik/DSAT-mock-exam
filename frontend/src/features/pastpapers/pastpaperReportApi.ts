import api from "@/lib/api";

export interface ErrorReportSkill {
  skill_id: number | null;
  skill: string;
  domain: string;
  wrong: number;
  total: number;
  accuracy: number;
  question_numbers: number[];
}

export interface ErrorReportQuestion {
  number: number;
  module: number;
  skill: string;
  domain: string;
  your_answer: string;
  correct_answer: string;
}

/**
 * The same payload the midterm error report emits — the two sheets are drawn by one renderer,
 * so the keys are deliberately identical (`correct_count`, `total_count`, `skills[]`,
 * `unclassified_*`). `wrong`, `accuracy`, `questions` and `headline` are additive: only this
 * screen reads them.
 */
/** One finished sitting of the same paper by the same student — a row of the report's history. */
export interface ReportHistoryRow {
  attempt_id: number;
  score: number | null;
  completed_at: string | null;
}

export interface AttemptErrorReport {
  attempt_id: number;
  /** The paper this sitting was of; the history lists every sitting of it. */
  practice_test_id?: number;
  score: number | null;
  paper_title: string;
  /** Null until the certificate is minted, and for a sitting that never earns one. */
  certificate_code: string | null;
  /**
   * Whether this sitting earns a certificate at all (a mock section does not). The button
   * follows this, not the code: the code is missing on every sitting the completion signal never
   * reached, and downloading by attempt mints it.
   */
  certificate_available?: boolean;
  /** Every finished sitting of this paper by this student, newest first. */
  history?: ReportHistoryRow[];
  total_count: number;
  correct_count: number;
  wrong: number;
  accuracy: number;
  /** Questions with no skill tag. Disclosed separately, never folded into a skill row —
   *  doing that would inflate that skill's question count. */
  unclassified_total: number;
  unclassified_wrong: number;
  /** Ordered worst-first, and only skills that actually cost marks. */
  skills: ErrorReportSkill[];
  questions: ErrorReportQuestion[];
  headline: string;
}

/**
 * A paper a homework has set this student again since they last finished it. The library card
 * turns it back into "Start again"; the rule lives on the server (`classes.pastpaper_retake`).
 */
export interface ReopenedPastpaper {
  practice_test_id: number;
  assignment_id: number;
  assignment_title: string;
  classroom_id: number;
  classroom_name: string;
  set_at: string;
  due_at: string | null;
}

export const pastpaperReportApi = {
  async report(attemptId: number): Promise<AttemptErrorReport> {
    const { data } = await api.get<AttemptErrorReport>(
      `/classes/pastpapers/attempts/${attemptId}/report/`,
    );
    return data;
  },
  /** The certificate PDF. */
  async downloadCertificate(code: string): Promise<Blob> {
    const { data } = await api.get(`/classes/certificates/pastpaper/${code}/download/`, {
      responseType: "blob",
    });
    return data as Blob;
  },
  /**
   * One sitting's certificate PDF, by attempt. The server mints the certificate on the first
   * download when it was never issued, so this works for every finished sitting.
   */
  async downloadCertificateForAttempt(attemptId: number): Promise<Blob> {
    const { data } = await api.get(
      `/classes/pastpapers/attempts/${attemptId}/certificate/pdf/`,
      { responseType: "blob" },
    );
    return data as Blob;
  },
  /** The error report PDF — a separate sheet, exactly as a midterm has. */
  async downloadReport(attemptId: number): Promise<Blob> {
    const { data } = await api.get(
      `/classes/pastpapers/attempts/${attemptId}/report/pdf/`,
      { responseType: "blob" },
    );
    return data as Blob;
  },
  /** The papers a homework has set again since the student last finished them. */
  async reopened(): Promise<ReopenedPastpaper[]> {
    const { data } = await api.get<{ items?: ReopenedPastpaper[] }>(
      "/classes/pastpapers/reopened/",
    );
    return data?.items ?? [];
  },
};
