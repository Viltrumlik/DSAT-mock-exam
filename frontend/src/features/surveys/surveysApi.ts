import api from "@/lib/api";

export type SurveyQuestionType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "SCALE"
  | "DATE";

export type SurveyStatus = "DRAFT" | "PUBLISHED" | "CLOSED";

export interface SurveyQuestion {
  id: number;
  order: number;
  prompt: string;
  help_text: string;
  question_type: SurveyQuestionType;
  is_required: boolean;
  options: string[];
  scale_min: number;
  scale_max: number;
}

export interface Survey {
  id: number;
  title: string;
  description: string;
  status: SurveyStatus;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
  questions: SurveyQuestion[];
  question_count: number;
  response_count: number;
  is_open: boolean;
  already_completed?: boolean;
}

export interface SurveyBrief {
  id: number;
  title: string;
  description: string;
  closes_at: string | null;
  question_count: number;
}

export interface SurveyResponseRow {
  id: number;
  survey: number;
  student: number;
  student_name: string;
  status: string;
  submitted_at: string | null;
  answers: {
    question: number;
    prompt: string;
    question_type: SurveyQuestionType;
    value: unknown;
  }[];
}

/** An answer is a string, a list of strings (checkboxes), or a number (scale). */
export type SurveyAnswerValue = string | string[] | number | null;

export const surveysApi = {
  // ── student ──────────────────────────────────────────────────────────────
  open: async (): Promise<SurveyBrief[]> => {
    const r = await api.get<{ surveys: SurveyBrief[] }>("/surveys/open/");
    return r.data?.surveys ?? [];
  },
  detail: async (id: number): Promise<Survey> => {
    const r = await api.get<Survey>(`/surveys/${id}/`);
    return r.data;
  },
  respond: async (id: number, answers: Record<string, SurveyAnswerValue>) => {
    const r = await api.post(`/surveys/${id}/respond/`, { answers });
    return r.data as { detail: string; response_id: number };
  },

  // ── authoring (super_admin only; the API enforces it) ─────────────────────
  adminList: async (): Promise<Survey[]> => {
    const r = await api.get<{ surveys: Survey[] }>("/surveys/admin/");
    return r.data?.surveys ?? [];
  },
  adminDetail: async (id: number): Promise<Survey> => {
    const r = await api.get<Survey>(`/surveys/admin/${id}/`);
    return r.data;
  },
  adminCreate: async (body: { title: string; description?: string }) => {
    const r = await api.post<Survey>("/surveys/admin/", body);
    return r.data;
  },
  adminUpdate: async (id: number, patch: Partial<Pick<Survey, "title" | "description" | "status" | "closes_at">>) => {
    const r = await api.patch<Survey>(`/surveys/admin/${id}/`, patch);
    return r.data;
  },
  adminDelete: async (id: number) => {
    await api.delete(`/surveys/admin/${id}/`);
  },
  addQuestion: async (surveyId: number, body: Partial<SurveyQuestion>) => {
    const r = await api.post<SurveyQuestion>(`/surveys/admin/${surveyId}/questions/`, body);
    return r.data;
  },
  updateQuestion: async (surveyId: number, questionId: number, patch: Partial<SurveyQuestion>) => {
    const r = await api.patch<SurveyQuestion>(`/surveys/admin/${surveyId}/questions/${questionId}/`, patch);
    return r.data;
  },
  deleteQuestion: async (surveyId: number, questionId: number) => {
    await api.delete(`/surveys/admin/${surveyId}/questions/${questionId}/`);
  },
  responses: async (surveyId: number) => {
    const r = await api.get<{ responses: SurveyResponseRow[] }>(`/surveys/admin/${surveyId}/responses/`);
    return r.data?.responses ?? [];
  },
};
