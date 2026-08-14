import api from "@/lib/api";

export interface ErrorReportSkill {
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

export interface AttemptErrorReport {
  attempt_id: number;
  score: number | null;
  paper_title: string;
  /** Null when the attempt never earned one — a mock section, say. */
  certificate_code: string | null;
  total: number;
  correct: number;
  wrong: number;
  accuracy: number;
  /** Ordered worst-first: the thing to work on is the first thing read. */
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
  /** The PDF: certificate on page 1, error report on page 2. */
  async downloadCertificate(code: string): Promise<Blob> {
    const { data } = await api.get(`/classes/certificates/pastpaper/${code}/download/`, {
      responseType: "blob",
    });
    return data as Blob;
  },
};
