import api from "@/lib/api";

export type SurveyQuestionType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "SCALE"
  /** A dragged 0–10 slider with a written sentence at each end. */
  | "RATING"
  | "DATE";

export type SurveyStatus = "DRAFT" | "PUBLISHED" | "CLOSED";

/** Types whose answer is picked from `options`. Mirrors SurveyQuestion.CHOICE_TYPES. */
export const CHOICE_TYPES: SurveyQuestionType[] = ["SINGLE_CHOICE", "MULTI_CHOICE"];
/** Types whose answer is a number inside scale_min..scale_max. Mirrors NUMERIC_TYPES. */
export const NUMERIC_TYPES: SurveyQuestionType[] = ["SCALE", "RATING"];

export const isChoiceType = (t: SurveyQuestionType) => CHOICE_TYPES.includes(t);
export const isNumericType = (t: SurveyQuestionType) => NUMERIC_TYPES.includes(t);

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
  image_url: string | null;
  /** The sentences under each end of a RATING slider. Blank means "no label". */
  scale_low_label: string;
  scale_high_label: string;
  /** Scores strictly BELOW this open the follow-up box. Null = never. */
  follow_up_threshold: number | null;
  /** What the empty follow-up box says. A real placeholder — it clears as they type. */
  follow_up_placeholder: string;
  follow_up_required: boolean;
  /** Which `options` open the follow-up box when picked. */
  follow_up_options: string[];
  /** Show this question only when an EARLIER question was answered a certain way.
   *  Null/blank means always shown. */
  condition_question: number | null;
  condition_operator: SurveyConditionOperator | "";
  /** A number for the score rules, a list of option texts for the choice rules. */
  condition_value: number | string[] | null;
}

export type SurveyConditionOperator =
  | "AT_LEAST"
  | "BELOW"
  | "ANY_OF"
  | "NONE_OF"
  | "ANSWERED";

/** Mirrors SurveyQuestion.NUMERIC_CONDITIONS / CHOICE_CONDITIONS. */
export const NUMERIC_CONDITIONS: SurveyConditionOperator[] = ["AT_LEAST", "BELOW"];
export const CHOICE_CONDITIONS: SurveyConditionOperator[] = ["ANY_OF", "NONE_OF"];

/**
 * Should this question be shown, given the answers so far?
 *
 * The SAME rule as `SurveyQuestion.is_visible_given` on the server, and it has to be: the
 * server drops an answer to a question its own evaluation says was hidden, so a client that
 * showed one the server would not would let a student fill in something silently discarded.
 * Both sides fail OPEN on a half-configured or dangling condition, for the same reason —
 * a question nobody can see collects nothing.
 */
export function isQuestionVisible(
  question: SurveyQuestion,
  answers: Record<string, SurveyAnswerValue>,
): boolean {
  const { condition_question: sourceId, condition_operator: op } = question;
  if (!sourceId || !op) return true;

  const source = answers[String(sourceId)];
  const unanswered = source === undefined || source === null || source === "" ||
    (Array.isArray(source) && source.length === 0);

  if (op === "ANSWERED") return !unanswered;
  // A skipped source satisfies nothing else — "no answer" is not a low score.
  if (unanswered) return false;

  if (NUMERIC_CONDITIONS.includes(op)) {
    const bar = Number(question.condition_value);
    if (typeof source !== "number" || !Number.isFinite(bar)) return true;
    return op === "AT_LEAST" ? source >= bar : source < bar;
  }

  if (CHOICE_CONDITIONS.includes(op)) {
    const wanted = new Set(
      (Array.isArray(question.condition_value) ? question.condition_value : []).map(String),
    );
    const picked = (Array.isArray(source) ? source : [source]).map(String);
    const hit = picked.some((p) => wanted.has(p));
    return op === "ANY_OF" ? hit : !hit;
  }

  return true;
}

export interface Survey {
  id: number;
  title: string;
  description: string;
  status: SurveyStatus;
  opens_at: string | null;
  closes_at: string | null;
  /** Whether a respondent may ask for their name to be kept off the results. */
  allow_anonymous: boolean;
  image_url: string | null;
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
  allow_anonymous: boolean;
  image_url: string | null;
}

export interface SurveyResponseRow {
  id: number;
  survey: number;
  /** Null on an anonymous reply — the server omits it, it is not merely hidden here. */
  student: number | null;
  student_name: string;
  is_anonymous: boolean;
  submitted_at: string | null;
  answers: {
    question: number;
    prompt: string;
    question_type: SurveyQuestionType;
    value: unknown;
    follow_up: string;
  }[];
}

/** One question's results, shaped for the way that question is read. */
export interface SurveySummary {
  question_id: number;
  prompt: string;
  question_type: SurveyQuestionType;
  answered: number;
  /** Was asked and chose not to answer. */
  skipped: number;
  /** Was never SHOWN this question — a branch they did not reach. Not the same as skipped. */
  not_asked: number;
  is_conditional: boolean;
  comments: { value: unknown; text: string }[];
  /** Choice questions. */
  options?: { text: string; count: number; percent: number | null }[];
  /** Scale and slider questions. */
  average?: number | null;
  scale_min?: number;
  scale_max?: number;
  scale_low_label?: string;
  scale_high_label?: string;
  distribution?: { score: number; count: number }[];
  below_threshold?: number | null;
  threshold?: number | null;
  /** Free-text questions. */
  texts?: string[];
}

/** An answer is a string, a list of strings (checkboxes), or a number (scale/slider). */
export type SurveyAnswerValue = string | string[] | number | null;

/** The fields an author may write on a survey. */
export type SurveyPatch = Partial<
  Pick<Survey, "title" | "description" | "status" | "opens_at" | "closes_at" | "allow_anonymous">
>;

/** The fields an author may write on a question. `image` is a File, so it rides multipart. */
export type QuestionPatch = Partial<Omit<SurveyQuestion, "id" | "image_url">>;

/**
 * A JSON body, or the same body as FormData when a picture is attached.
 *
 * Built here rather than at each call site because the rule is easy to get wrong in two
 * directions: FormData has no types, so every scalar has to be stringified by hand (a raw
 * `false` arrives as the string "false", which is truthy — hence the explicit booleans), and
 * arrays have to be JSON-encoded because DRF reads repeated keys as a list of strings.
 * Never set a Content-Type: axios must choose the multipart boundary itself.
 */
function bodyFor(patch: Record<string, unknown>, image?: File | null): FormData | Record<string, unknown> {
  if (!image) return patch;
  const form = new FormData();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) form.append(key, "");
    else if (Array.isArray(value)) form.append(key, JSON.stringify(value));
    else if (typeof value === "boolean") form.append(key, value ? "true" : "false");
    else form.append(key, String(value));
  }
  form.append("image", image);
  return form;
}

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
  respond: async (
    id: number,
    body: {
      answers: Record<string, SurveyAnswerValue>;
      follow_ups?: Record<string, string>;
      anonymous?: boolean;
    },
  ) => {
    const r = await api.post(`/surveys/${id}/respond/`, body);
    return r.data as { detail: string; response_id: number; is_anonymous: boolean };
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
  adminUpdate: async (id: number, patch: SurveyPatch, image?: File | null) => {
    const r = await api.patch<Survey>(`/surveys/admin/${id}/`, bodyFor(patch, image));
    return r.data;
  },
  adminDelete: async (id: number) => {
    await api.delete(`/surveys/admin/${id}/`);
  },
  addQuestion: async (surveyId: number, body: QuestionPatch, image?: File | null) => {
    const r = await api.post<SurveyQuestion>(
      `/surveys/admin/${surveyId}/questions/`,
      bodyFor(body, image),
    );
    return r.data;
  },
  updateQuestion: async (
    surveyId: number,
    questionId: number,
    patch: QuestionPatch,
    image?: File | null,
  ) => {
    const r = await api.patch<SurveyQuestion>(
      `/surveys/admin/${surveyId}/questions/${questionId}/`,
      bodyFor(patch, image),
    );
    return r.data;
  },
  deleteQuestion: async (surveyId: number, questionId: number) => {
    await api.delete(`/surveys/admin/${surveyId}/questions/${questionId}/`);
  },
  reorderQuestions: async (surveyId: number, order: number[]) => {
    const r = await api.post<{ questions: SurveyQuestion[] }>(
      `/surveys/admin/${surveyId}/questions/reorder/`,
      { order },
    );
    return r.data.questions;
  },
  results: async (surveyId: number) => {
    const r = await api.get<{
      summaries: SurveySummary[];
      responses: SurveyResponseRow[];
    }>(`/surveys/admin/${surveyId}/responses/`);
    // Spread-with-defaults, never a field-by-field rebuild: a hand-written whitelist here is
    // what dropped `months_to_sat` from the roadmap payload and took the dashboard down.
    return {
      summaries: r.data?.summaries ?? [],
      responses: r.data?.responses ?? [],
    };
  },
  /**
   * Fetch the CSV and hand it to the browser as a download.
   *
   * Through axios rather than a plain `<a href>`: the instance owns the base URL, the CSRF
   * header and the refresh-on-401 retry, and a bare link has none of them — an admin whose
   * access token had just expired would get the login page saved as a .csv file.
   */
  downloadResults: async (surveyId: number, filename: string) => {
    const r = await api.get(`/surveys/admin/${surveyId}/responses.csv`, {
      responseType: "blob",
    });
    const href = URL.createObjectURL(r.data as Blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick, not immediately: Safari reads the blob asynchronously after
    // the click and gets an empty file if the URL is already gone.
    setTimeout(() => URL.revokeObjectURL(href), 0);
  },
};
