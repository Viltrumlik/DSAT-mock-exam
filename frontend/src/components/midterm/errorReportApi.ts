/**
 * Client for the student midterm error report (/api/midterms/attempts/<id>/error-report/).
 * It lives beside the components that read it rather than in midtermApi: this shape is
 * consumed by exactly one surface, and the PDF is rendered by the backend from the same
 * payload so the page and the download can never disagree.
 */
import api from "@/lib/api";

export interface ErrorReportSkill {
  /** Null when the taxonomy row is gone and the frozen skill name is all that is left. */
  skill_id: number | null;
  skill: string;
  domain: string;
  total: number;
  wrong: number;
}

export interface ErrorReportMidterm {
  id: number;
  title: string;
  subject: string; // READING_WRITING | MATH
  subject_label: string;
  scoring_scale: string; // SCALE_100 | SCALE_800
  score_ceiling: number;
  level: string;
  midterm_type: string; // PRE_MIDTERM | MIDTERM | RETAKE
}

export interface ErrorReport {
  attempt_id: number;
  student_name: string;
  date: string;
  midterm: ErrorReportMidterm;
  score: number | null;
  correct_count: number;
  total_count: number;
  pass_mark: number | null;
  /** Null on an ungraded (pre-)midterm, where there is no pass mark to judge against. */
  passed: boolean | null;
  is_graded: boolean;
  /** Questions with no skill tag; they can never appear in `skills`, so they are disclosed instead. */
  unclassified_total: number;
  unclassified_wrong: number;
  /** Already filtered to wrong > 0 and already sorted decreasing — render in the order given. */
  skills: ErrorReportSkill[];
}

export const errorReportApi = {
  async get(attemptId: number): Promise<ErrorReport> {
    const r = await api.get(`/midterms/attempts/${attemptId}/error-report/`);
    return r.data as ErrorReport;
  },
  /**
   * Server-rendered twin of this page. It is the sibling of the JSON route so the two can
   * never drift; where a deployment does not serve it yet the caller falls back to print.
   */
  async downloadPdf(attemptId: number): Promise<Blob> {
    const r = await api.get(`/midterms/attempts/${attemptId}/error-report/pdf/`, { responseType: "blob" });
    return r.data as Blob;
  },
};
