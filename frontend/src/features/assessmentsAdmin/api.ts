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
  createQuestion: async (
    setId: number,
    payload: Partial<AssessmentQuestion> & { prompt: string; question_type: string },
  ) => {
    return (await assessmentsAdminClient.adminCreateQuestion(setId, payload as any)) as AssessmentQuestion;
  },
  updateQuestion: async (id: number, payload: Partial<AssessmentQuestion> | FormData) => {
    return (await assessmentsAdminClient.adminUpdateQuestion(id, payload as any)) as AssessmentQuestion;
  },
  deleteQuestion: async (id: number) => {
    await assessmentsAdminClient.adminDeleteQuestion(id);
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

  // Homework assign (teacher/staff)
  assign: async (payload: HomeworkAssignmentCreateRequest, idempotencyKey?: string) => {
    const r = await api.post("/assessments/homework/assign/", payload, {
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
    return r.data;
  },
};

