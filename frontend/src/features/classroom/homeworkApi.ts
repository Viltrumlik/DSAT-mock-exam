import api, { classesApi } from "@/lib/api";

export type SubmissionWorkflow = "DRAFT" | "SUBMITTED" | "RETURNED" | "REVIEWED" | null;

export interface AssignmentDetail {
  id: number;
  title: string;
  instructions?: string;
  due_at: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  category: string;
  max_score: string | null;
  mock_exam?: number | null;
  practice_test?: number | null;
  practice_test_pack?: number | null;
  module?: number | null;
  practice_test_ids?: number[] | null;
  assessment_homework?: unknown | null;
  external_url?: string | null;
  attachment_file_url?: string | null;
  attachment_urls?: { url: string; file_name?: string }[];
  practice_bundle_tests?: { id: number; title?: string; subject?: string }[];
}

export interface MySubmission {
  id: number;
  status: Exclude<SubmissionWorkflow, null>;
  workflow_status?: SubmissionWorkflow;
  revision?: number;
  return_note?: string;
  files?: { id: number; url: string; file_name?: string }[];
  attempt?: unknown;
  submitted_at?: string | null;
  review?: {
    grade: string | null;
    max_score?: string | null;
    feedback: string;
    is_auto?: boolean;
    review_context?: string;
  } | null;
}

export const homeworkApi = {
  getAssignment: async (classId: number, assignmentId: number): Promise<AssignmentDetail> =>
    (await api.get(`/classes/${classId}/assignments/${assignmentId}/`)).data,
  getMySubmission: (classId: number, assignmentId: number): Promise<MySubmission> =>
    classesApi.getMySubmission(classId, assignmentId),
  submit: (classId: number, assignmentId: number, formData: FormData) =>
    classesApi.submitAssignment(classId, assignmentId, formData, true),
  publish: (classId: number, assignmentId: number) =>
    api.post(`/classes/${classId}/assignments/${assignmentId}/publish/`).then((r) => r.data),
  archive: (classId: number, assignmentId: number) =>
    api.post(`/classes/${classId}/assignments/${assignmentId}/archive/`).then((r) => r.data),
  unarchive: (classId: number, assignmentId: number) =>
    api.post(`/classes/${classId}/assignments/${assignmentId}/unarchive/`).then((r) => r.data),
};

/** Derive the assignment kind that drives the primary action + "what to submit". */
export type AssignmentKind = "QUIZ" | "MOCK" | "PASTPAPER" | "PRACTICE" | "MODULE" | "FILE";

export function assignmentKind(a: AssignmentDetail): AssignmentKind {
  if (a.assessment_homework != null) return "QUIZ";
  if (a.mock_exam != null) return "MOCK";
  // Custom practice-test pack → Practice; standalone pastpaper sections (the homework
  // "Pastpaper" type stores them as practice_test / practice_test_ids) → Past Paper.
  if (a.practice_test_pack != null) return "PRACTICE";
  if (a.practice_test != null || (a.practice_test_ids && a.practice_test_ids.length)) return "PASTPAPER";
  if (a.module != null) return "MODULE";
  return "FILE";
}

/** Resolve the standalone section id to open directly, or null when several need a chooser. */
function singleSectionId(a: AssignmentDetail): number | null {
  if (a.practice_test != null) return a.practice_test;
  const ids = a.practice_test_ids ?? [];
  return ids.length === 1 ? ids[0] : null;
}

export const KIND_LABEL: Record<AssignmentKind, string> = {
  QUIZ: "Quiz",
  MOCK: "Mock Exam",
  PASTPAPER: "Past Paper",
  PRACTICE: "Practice Test",
  MODULE: "Module Test",
  FILE: "Homework",
};

/**
 * A single openable content within an assignment. An assignment can bundle several
 * (a past paper + an assessment + a practice test), each opened independently by the student.
 */
export interface ContentAction {
  kind: AssignmentKind;
  label: string;
  href: string;
}

/**
 * All openable learning contents attached to an assignment, in a stable order. Reuses the
 * same per-kind routes as `startHref`. Files/links stay in the "Details" card (downloads),
 * so this returns only the contents a student "opens" (assessment, mock, past paper, practice,
 * module). Length > 1 → the assignment is a multi-content bundle.
 */
export function contentActions(a: AssignmentDetail): ContentAction[] {
  const out: ContentAction[] = [];
  if (a.assessment_homework != null) out.push({ kind: "QUIZ", label: "Start assessment", href: `/assessments/${a.id}` });
  if (a.mock_exam != null) out.push({ kind: "MOCK", label: "Open Mock Exam", href: `/mock/${a.mock_exam}` });
  if (a.practice_test_pack != null) {
    out.push({ kind: "PRACTICE", label: "Open Practice Test", href: `/practice-tests/${a.practice_test_pack}` });
  } else if (a.practice_test != null || (a.practice_test_ids && a.practice_test_ids.length)) {
    // Standalone pastpaper section(s): open one directly, or the listing to choose from several.
    const single = singleSectionId(a);
    out.push({ kind: "PASTPAPER", label: "Open Past Paper", href: single != null ? `/practice-test/${single}` : `/pastpapers` });
  }
  if (a.module != null) {
    const tid = a.practice_test ?? a.practice_test_ids?.[0];
    if (tid != null) out.push({ kind: "MODULE", label: "Open Module Test", href: `/practice-test/${tid}` });
  }
  return out;
}

/** Where the "Start …" action routes for auto-graded work. */
export function startHref(classId: number, a: AssignmentDetail): string | null {
  const kind = assignmentKind(a);
  if (kind === "QUIZ") return `/assessments/${a.id}`;
  if (kind === "MOCK") return `/mock/${a.mock_exam}`;
  if (kind === "PASTPAPER") {
    const single = singleSectionId(a);
    return single != null ? `/practice-test/${single}` : `/pastpapers`;
  }
  if (kind === "PRACTICE") {
    if (a.practice_test_pack != null) return `/practice-tests/${a.practice_test_pack}`;
    return null;
  }
  if (kind === "MODULE") {
    const tid = a.practice_test ?? a.practice_test_ids?.[0];
    return tid != null ? `/practice-test/${tid}` : null;
  }
  return null; // FILE has no external start
}
