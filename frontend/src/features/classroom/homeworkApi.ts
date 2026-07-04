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
  practice_test_pack_ids?: number[] | null;
  assessment_homework?: unknown | null;
  /** Every assessment attached to this homework (a bundle can hold several). */
  assessment_homeworks?: {
    homework_id: number;
    set?: { id: number; subject?: string; title?: string; category?: string } | null;
    progress?: { state?: ContentState; attempt_id?: number | null } | null;
  }[] | null;
  external_url?: string | null;
  attachment_file_url?: string | null;
  attachment_urls?: { url: string; file_name?: string; content_type?: string; size?: number | null }[];
  practice_bundle_tests?: {
    id: number;
    title?: string;
    collection_name?: string;
    name?: string;
    subject?: string;
    state?: ContentState;
    attempt_id?: number | null;
  }[];
  /** Requesting student's assessment attempt state (for the QUIZ launcher card). */
  assessment_progress?: { state: ContentState; attempt_id: number | null };
  // New backend metadata (present on list, detail, and my-assignments payloads).
  content_type?: string;
  contents?: { kind: AssignmentKind; title: string; item_count: number | null }[];
  item_count?: number | null;
  subject?: string | null;
  assigned_at?: string | null;
  created_at?: string | null;
  published_at?: string | null;
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

/** Short subject label for disambiguating the sections of a multi-section past paper. */
function subjectShort(s?: string): string {
  const v = (s || "").toUpperCase();
  if (v.includes("READING") || v === "ENGLISH" || v === "RW") return "Reading & Writing";
  if (v.includes("MATH")) return "Math";
  return s || "";
}

/**
 * A single openable content within an assignment. An assignment can bundle several
 * (a past paper + an assessment + a practice test), each opened independently by the student.
 */
/** A content's attempt state for the requesting student. */
export type ContentState = "not_started" | "in_progress" | "completed";
/** What the launcher button does for a content. */
export type ContentMode = "start" | "resume" | "review";

export interface ContentAction {
  kind: AssignmentKind;
  /** The content's own title (from `a.contents`), shown in the launcher. */
  name: string;
  /** Generic verb label (e.g. "Open Past Paper") — fallback when no title exists. */
  label: string;
  href: string;
  /**
   * Whether the student should Start (new attempt), Resume (existing in-progress), or
   * Review (finished — opens results, never re-starts). Drives the launcher button.
   */
  mode: ContentMode;
  /** The relevant attempt id for resume/review deep-links (null when not_started). */
  attemptId?: number | null;
  /**
   * Past papers have no detail page — the library starts the attempt and jumps
   * straight to the exam welcome. Set ONLY for a not-yet-started section, so the
   * launcher POSTs a new attempt and routes to /exam/{attemptId}?welcome=1.
   */
  startTestId?: number;
}

/**
 * All openable learning contents attached to an assignment, in a stable order. Reuses the
 * same per-kind routes as `startHref`. Files/links stay in the "Details" card (downloads),
 * so this returns only the contents a student "opens" (assessment, mock, past paper, practice,
 * module). Length > 1 → the assignment is a multi-content bundle.
 */
export function contentActions(a: AssignmentDetail): ContentAction[] {
  // Resolve the human title for each action from `a.contents`. Both lists are built
  // in the same kind order (assessment, mock, practice pack, pastpaper), so we walk
  // the contents in order and hand the next matching title to each action.
  const contents = a.contents ?? [];
  const cursor: Record<string, number> = {};
  const titleFor = (kind: AssignmentKind, fallback: string): string => {
    const start = cursor[kind] ?? 0;
    for (let i = start; i < contents.length; i++) {
      if (contents[i].kind === kind) {
        cursor[kind] = i + 1;
        return contents[i].title?.trim() || fallback;
      }
    }
    return fallback;
  };
  const add = (
    out: ContentAction[],
    kind: AssignmentKind,
    label: string,
    href: string,
    extra?: Partial<Pick<ContentAction, "mode" | "attemptId" | "startTestId">>,
  ) =>
    out.push({
      kind,
      name: titleFor(kind, label || KIND_LABEL[kind]),
      label,
      href,
      mode: extra?.mode ?? "start",
      attemptId: extra?.attemptId ?? null,
      startTestId: extra?.startTestId,
    });

  const out: ContentAction[] = [];
  // One QUIZ launcher per attached assessment (a homework can bundle several),
  // each keyed by its homework_id so start/resume/review target the right quiz.
  const hws = a.assessment_homeworks
    ?? (a.assessment_homework != null ? [{ homework_id: 0, progress: a.assessment_progress ?? null }] : []);
  for (const hw of hws) {
    const ap = hw.progress;
    const mode = stateToMode(ap?.state);
    const hwParam = hw.homework_id ? `?homework=${hw.homework_id}` : "";
    const href =
      mode === "review" ? `/assessments/result/${a.id}${hwParam}`
        : mode === "resume" && ap?.attempt_id ? `/assessments/attempt/${ap.attempt_id}`
        : `/assessments/${a.id}${hwParam}`;
    add(out, "QUIZ", "Start assessment", href, { mode, attemptId: ap?.attempt_id ?? null });
  }
  if (a.mock_exam != null) add(out, "MOCK", "Open Mock Exam", `/mock/${a.mock_exam}`);
  if (a.practice_test_pack != null) {
    add(out, "PRACTICE", "Open Practice Test", `/practice-tests/${a.practice_test_pack}`);
  } else if (a.practice_test != null || (a.practice_test_ids && a.practice_test_ids.length)) {
    // Standalone pastpaper section(s). The authoritative, scope-resolved list is
    // `practice_bundle_tests` — expand it into one launcher card per section.
    // Section titles are blank; the real label is collection_name. Per-section state
    // decides Start (POST new) / Resume (open existing) / Review (results — no restart).
    const bundle = a.practice_bundle_tests ?? [];
    const sections = bundle.length
      ? bundle
      : (() => {
          const single = singleSectionId(a);
          return single != null ? [{ id: single } as NonNullable<AssignmentDetail["practice_bundle_tests"]>[number]] : [];
        })();
    const multi = sections.length > 1;
    for (const t of sections) {
      const base = t.name?.trim() || t.collection_name?.trim() || t.title?.trim() || "Past Paper";
      const name = multi ? `${base} · ${subjectShort(t.subject)}` : base;
      const mode = stateToMode(t.state);
      const aid = t.attempt_id ?? null;
      const href =
        mode === "review" && aid != null ? `/review/${aid}`
          : mode === "resume" && aid != null ? `/exam/${aid}?welcome=1`
          : `/practice-test/${t.id}`;
      out.push({
        kind: "PASTPAPER", name, label: "Open Past Paper", href, mode, attemptId: aid,
        // Only a fresh section starts a new attempt; resume/review follow href.
        startTestId: mode === "start" ? t.id : undefined,
      });
    }
  }
  if (a.module != null) {
    const tid = a.practice_test ?? a.practice_test_ids?.[0];
    if (tid != null) add(out, "MODULE", "Open Module Test", `/practice-test/${tid}`);
  }
  return out;
}

/** Map a backend content state to the launcher button mode. */
function stateToMode(state?: ContentState): ContentMode {
  if (state === "completed") return "review";
  if (state === "in_progress") return "resume";
  return "start";
}

/** Where the "Start …" action routes for auto-graded work. */
export function startHref(classId: number, a: AssignmentDetail): string | null {
  const kind = assignmentKind(a);
  if (kind === "QUIZ") return `/assessments/${a.id}`;
  if (kind === "MOCK") return `/mock/${a.mock_exam}`;
  if (kind === "PASTPAPER") {
    // Prefer the scope-resolved sections: one section → straight to its welcome page;
    // several → null so the caller opens the detail (which lists each section's card).
    const bundle = a.practice_bundle_tests ?? [];
    if (bundle.length === 1) return `/practice-test/${bundle[0].id}`;
    if (bundle.length > 1) return null;
    const single = singleSectionId(a);
    return single != null ? `/practice-test/${single}` : null;
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
