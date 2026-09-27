/**
 * How an assessment names itself on this page.
 *
 * Two subject spellings reach here for the same shelf: assessment sets are stored as "math" and
 * "english", while anything imported from the exam side carries the platform's own
 * "reading_writing". Both are English to a teacher, and the filter button that says English has
 * to keep both or it hides work its own label promised.
 */

import type { TeacherAssessment } from "./api";

export type SubjectFilter = "ALL" | "math" | "english";

export function isMath(subject: string): boolean {
  return subject === "math";
}

export function isEnglish(subject: string): boolean {
  return subject === "english" || subject === "reading_writing";
}

/** A set authored outside the two domains keeps its own word rather than being called nothing. */
export function subjectLabel(subject: string): string {
  if (isMath(subject)) return "Math";
  if (isEnglish(subject)) return "English";
  return subject || "General";
}

export function matchesSubject(set: TeacherAssessment, filter: SubjectFilter): boolean {
  if (filter === "math") return isMath(set.subject);
  if (filter === "english") return isEnglish(set.subject);
  return true;
}

/**
 * What the search box reads. The description is in here and nowhere on screen on purpose: it is
 * often the only place the topic of an untitled set is written down, so it is worth searching
 * and too long to put in a row.
 */
export function searchBlob(set: TeacherAssessment): string {
  return [set.title, set.category, set.description, subjectLabel(set.subject), set.level]
    .join(" ")
    .toLowerCase();
}

export function assessmentTitle(set: TeacherAssessment): string {
  return set.title || "Untitled assessment";
}
