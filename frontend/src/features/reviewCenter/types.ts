/**
 * Review Center — a read-only, no-attempt QA surface for the `test_auditor` role.
 *
 * The auditor browses every test (assessment set, pastpaper, full mock, midterm) on the
 * main site and opens any one to review its questions + answer key WITHOUT a timer,
 * fullscreen, proctoring, or a graded attempt. It reads the same staff/admin content
 * endpoints the builder uses; the backend enforces the role via DRF permissions.
 */

export type ReviewContentType = "assessment" | "pastpaper" | "mock" | "midterm";

export const REVIEW_TYPE_LABELS: Record<ReviewContentType, string> = {
  assessment: "Assessment",
  pastpaper: "Past Paper",
  mock: "Full Mock",
  midterm: "Midterm",
};

export function isReviewContentType(v: string): v is ReviewContentType {
  return v === "assessment" || v === "pastpaper" || v === "mock" || v === "midterm";
}

/** One row in a review catalog tab. */
export type ReviewCatalogItem = {
  id: number;
  title: string;
  /** Platform ("MATH"/"READING_WRITING") or domain ("math"/"english"); rendered leniently. */
  subject?: string | null;
  level?: string | null;
  /** Secondary line (category, collection, form type, scale…). */
  meta?: string;
  questionCount?: number | null;
  /** Pastpaper/mock/midterm live state. */
  isPublished?: boolean | null;
  /** Assessment set review lifecycle (draft/needs_review/approved). */
  reviewStatus?: string | null;
};

export type ReviewChoice = { id: string; text: string; image?: string | null };

/** Normalized, source-agnostic question shape rendered read-only in the viewer. */
export type ReviewQuestion = {
  /** Stable React key. */
  key: string;
  order: number;
  /** Main content shown first (Reading: passage · Math: the question). */
  prompt: string;
  /** Secondary prompt shown right above the choices. */
  questionPrompt?: string;
  image?: string | null;
  /** True for multiple-choice; false for grid-in / numeric / short / boolean. */
  isChoice: boolean;
  choices: ReviewChoice[];
  /** Choice ids that are correct (drives the green highlight). */
  correctIds: string[];
  /** Human-readable correct answer (letter + text, or the raw value). */
  correctText: string;
  explanation?: string;
  points?: number | null;
};

export type ReviewBundle = {
  title: string;
  questions: ReviewQuestion[];
};
