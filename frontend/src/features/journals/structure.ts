// Client-side mirror of backend journals.structure — for displaying expected
// counts on levels that don't have a Journal row yet.

export const COURSE_MONTHS: Record<string, number> = {
  foundation: 1,
  junior: 3,
  middle: 2,
  senior: 2,
};

export type CourseMeta = {
  months: number;
  lessons: number;
  midterms: number;
  homework: number;
};

export function courseMeta(level: string): CourseMeta {
  const months = COURSE_MONTHS[level] ?? 0;
  const lessons = months * 12;
  const midterms = months; // one midterm per 12-lesson month
  return { months, lessons, midterms, homework: lessons - midterms };
}

export function subjectApiCode(subjectLower: string): "MATH" | "ENGLISH" {
  return subjectLower.toLowerCase() === "math" ? "MATH" : "ENGLISH";
}
