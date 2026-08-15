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
export interface AttemptErrorReport {
  attempt_id: number;
  score: number | null;
  paper_title: string;
  /** Null when the attempt never earned one — a mock section, say. */
  certificate_code: string | null;
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
  /** The error report PDF — a separate sheet, exactly as a midterm has. */
  async downloadReport(attemptId: number): Promise<Blob> {
    const { data } = await api.get(
      `/classes/pastpapers/attempts/${attemptId}/report/pdf/`,
      { responseType: "blob" },
    );
    return data as Blob;
  },
};
