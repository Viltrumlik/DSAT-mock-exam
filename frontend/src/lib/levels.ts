/**
 * Difficulty "level" taxonomy — mirrors backend AssessmentSet.LEVEL_CHOICES /
 * ALLOWED_LEVELS_BY_SUBJECT and Classroom.LEVEL_CHOICES / LEVELS_BY_SUBJECT.
 * Level codes are lowercase and shared verbatim between assessment sets and
 * classrooms so a classroom's level filters assessments directly.
 *
 * Subject-dependent: English has no Foundation. `levelsForSubject` normalizes the
 * subject casing, so it works for both the assessment domain subject
 * ("math" | "english") and the classroom subject ("MATH" | "ENGLISH").
 */

export type LevelKey = "foundation" | "junior" | "middle" | "senior";

export const LEVEL_LABELS: Record<LevelKey, string> = {
  foundation: "Foundation",
  junior: "Junior",
  middle: "Middle",
  senior: "Senior",
};

const ENGLISH_LEVELS: LevelKey[] = ["junior", "middle", "senior"];
const MATH_LEVELS: LevelKey[] = ["foundation", "junior", "middle", "senior"];

/** Subject (any casing of math/english) → the levels valid for it. */
export function levelsForSubject(subject: string | null | undefined): LevelKey[] {
  const s = (subject || "").toLowerCase();
  if (s === "math") return MATH_LEVELS;
  if (s === "english") return ENGLISH_LEVELS;
  return [];
}

export function levelLabel(level: string | null | undefined): string {
  if (!level) return "";
  return LEVEL_LABELS[level as LevelKey] ?? level;
}
