import api, { assessmentsAdminApi as assessmentsAdminClient } from "@/lib/api";

import type {
  AssessmentQuestion,
  AssessmentSet,
  HomeworkAssignmentCreateRequest,
  Subject,
} from "@/features/assessments/types";

export type PaginatedSets = {
  count: number;
  next: string | null;
  previous: string | null;
  results: AssessmentSet[];
};

// ─── Publish validation types ─────────────────────────────────────────────────

export type ValidationSeverity = "blocking" | "warning";

export type ValidationFinding = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  question_id?: number;
  context?: Record<string, unknown>;
};

export type PublishValidationReport = {
  is_publishable: boolean;
  blocking_count: number;
  warning_count: number;
  findings: ValidationFinding[];
};

// ─── Question Bank picker types (M4) ──────────────────────────────────────────

export type BankPickerRow = {
  id: number;
  qb_id: string;
  subject: string;
  domain: string | null;
  skill: string | null;
  difficulty: string;
  question_type: string;
  question_text: string;
  current_version: number | null;
};

export type BankPickerDomain = { id: number; subject: string; name: string; code: string };
export type BankPickerSkill = { id: number; domain: number; subject: string; name: string; code: string };
export type BankPickerTaxonomy = { domains: BankPickerDomain[]; skills: BankPickerSkill[] };

/**
 * Staff assessments surface: authoring + homework assignment.
 */
export const assessmentsAdminApi = {
  // Authoring CRUD
  listSets: async (params?: { subject?: Subject; category?: string; limit?: number; offset?: number }): Promise<PaginatedSets> => {
    const data = await assessmentsAdminClient.adminListSets(params);
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
      return data as PaginatedSets;
    }
    // Fallback for legacy flat-array response
    const arr = Array.isArray(data) ? (data as AssessmentSet[]) : [];
    return { count: arr.length, next: null, previous: null, results: arr };
  },
  getSet: async (id: number): Promise<AssessmentSet> => {
    return (await assessmentsAdminClient.adminGetSet(id)) as AssessmentSet;
  },
  createSet: async (payload: {
    subject: Subject;
    source?: string;
    level?: string;
    category?: string;
    title: string;
    description?: string;
    is_active?: boolean;
  }): Promise<AssessmentSet> => {
    return (await assessmentsAdminClient.adminCreateSet(payload)) as AssessmentSet;
  },
  updateSet: async (id: number, payload: Partial<Omit<AssessmentSet, "id">>): Promise<AssessmentSet> => {
    return (await assessmentsAdminClient.adminUpdateSet(id, payload as any)) as AssessmentSet;
  },
  deleteSet: async (id: number, force = false) => {
    await assessmentsAdminClient.adminDeleteSet(id, force);
  },
  createQuestion: async (
    setId: number,
    payload: (Partial<AssessmentQuestion> & { prompt: string; question_type: string }) | FormData,
  ) => {
    return (await assessmentsAdminClient.adminCreateQuestion(setId, payload as any)) as AssessmentQuestion;
  },
  updateQuestion: async (id: number, payload: Partial<AssessmentQuestion> | FormData) => {
    return (await assessmentsAdminClient.adminUpdateQuestion(id, payload as any)) as AssessmentQuestion;
  },
  deleteQuestion: async (id: number, force = false) => {
    await assessmentsAdminClient.adminDeleteQuestion(id, force);
  },
  /**
   * Atomically persist a full question ordering for a set. The backend reindexes
   * every question to a dense, unique 0..n-1 under a set row-lock — replacing the
   * old per-question PATCH loop that could leave duplicate/gapped orders if a
   * request failed midway. Returns the server's canonical ordered id list.
   */
  reorderQuestions: async (setId: number, orderedIds: number[]): Promise<number[]> => {
    const r = await api.post(`/assessments/admin/sets/${setId}/questions/reorder/`, {
      ordered_ids: orderedIds,
    });
    return (r.data as { ordered_ids?: number[] })?.ordered_ids ?? orderedIds;
  },
  /**
   * Dry-run publish validation.
   * Calls GET /assessments/admin/sets/{id}/validate-publish/ and returns the
   * full PublishValidationReport (blocking + warning findings).
   * Does NOT create a version or emit governance events.
   */
  validatePublish: async (id: number): Promise<PublishValidationReport> => {
    const r = await api.get(`/assessments/admin/sets/${id}/validate-publish/`);
    return r.data as PublishValidationReport;
  },

  telemetry: async (key: string) => {
    await api.post("/assessments/admin/builder/telemetry/", { key });
  },

  // ── Question Bank picker (M4) — APPROVED-only ──────────────────────────────
  qbSelect: async (params?: {
    subject?: string;
    domain_id?: number;
    skill_id?: number;
    difficulty?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ count: number; results: BankPickerRow[] }> => {
    const r = await api.get("/assessments/admin/question-bank/select/", { params });
    const data = r.data as { count?: number; results?: BankPickerRow[] };
    return { count: data.count ?? 0, results: data.results ?? [] };
  },
  qbTaxonomy: async (subject?: string): Promise<BankPickerTaxonomy> => {
    const r = await api.get("/assessments/admin/question-bank/taxonomy/", {
      params: subject ? { subject } : undefined,
    });
    return r.data as BankPickerTaxonomy;
  },
  addQuestionFromBank: async (
    setId: number,
    bankQuestionId: number,
    order?: number,
  ): Promise<AssessmentQuestion> => {
    const r = await api.post(`/assessments/admin/sets/${setId}/questions/from-bank/`, {
      bank_question_id: bankQuestionId,
      order,
    });
    return r.data as AssessmentQuestion;
  },

  // Homework assign (teacher/staff)
  assign: async (payload: HomeworkAssignmentCreateRequest, idempotencyKey?: string) => {
    const r = await api.post("/assessments/homework/assign/", payload, {
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
    return r.data;
  },
};

