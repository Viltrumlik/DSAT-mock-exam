import api, { classesApi } from "@/lib/api";

export type GradebookStatus = "MISSING" | "SUBMITTED" | "NEEDS_REVISION" | "GRADED";
export type GradeSource = "AUTO" | "TEACHER" | null;

export interface AssignmentMeta {
  id: number;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  category: string;
  due_at: string | null;
  is_auto_graded: boolean;
  source_label: string;
  max_score: string | null;
}

export interface GradebookCounts {
  graded: number;
  needs_grading: number;
  submitted: number;
  needs_revision: number;
  missing: number;
  total: number;
}

export interface Performance {
  completion_rate: number | null;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  completed: number;
}

export interface GradebookOverview {
  assignments: (AssignmentMeta & { counts: GradebookCounts; performance: Performance | null })[];
  needs_grading_total: number;
  students: number;
}

export interface RosterRow {
  student_id: number;
  name: string;
  /** Absolute URL of the profile photo; null when the student has not uploaded one. */
  profile_image_url?: string | null;
  email: string;
  status: GradebookStatus;
  grade: string | null;
  max_score: string | null;
  source: GradeSource;
  submission_id: number | null;
}

export interface GradebookAssignment {
  assignment: AssignmentMeta;
  roster: RosterRow[];
  counts: GradebookCounts;
  performance: Performance | null;
}

export const gradebookApi = {
  overview: async (classId: number): Promise<GradebookOverview> =>
    (await api.get(`/classes/${classId}/gradebook/`)).data,
  assignment: async (classId: number, assignmentId: number): Promise<GradebookAssignment> =>
    (await api.get(`/classes/${classId}/gradebook/assignments/${assignmentId}/`)).data,
  grade: (submissionId: number, payload: { grade?: string | number | null; feedback?: string }) =>
    classesApi.gradeSubmission(submissionId, payload),
  returnForRevision: (submissionId: number, payload?: { note?: string }) =>
    classesApi.returnSubmission(submissionId, payload),
};
