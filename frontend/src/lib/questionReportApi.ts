/**
 * Client for the question error-report feature (/api/question-reports/*).
 *
 * The platform has two independent question-id namespaces, so every report carries a
 * `system` discriminator: "exam" for the shared runner (pastpaper / practice / mock /
 * midterm -> exams.Question) and "assessment" (assessments.AssessmentQuestion). The
 * backend derives the precise resource (title, number, qb id) from the id itself.
 */
import api from "@/lib/api";

export type ReportSystem = "exam" | "assessment";

export type ReportCategory =
  | "wrong_answer"
  | "answer_key"
  | "typo_unclear"
  | "image_figure"
  | "other";

export interface QuestionReportPayload {
  system: ReportSystem;
  question_id: number;
  category: ReportCategory;
  message?: string;
  attempt_id?: number | null;
}

export interface QuestionReportResult {
  id: number;
  status?: string;
  deduped?: boolean;
}

export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "wrong_answer", label: "Wrong / no correct answer" },
  { value: "answer_key", label: "Answer key looks wrong" },
  { value: "typo_unclear", label: "Typo / unclear wording" },
  { value: "image_figure", label: "Image / figure problem" },
  { value: "other", label: "Something else" },
];

export const questionReportApi = {
  async submit(payload: QuestionReportPayload): Promise<QuestionReportResult> {
    const r = await api.post("/question-reports/reports/", payload);
    return r.data as QuestionReportResult;
  },
};
