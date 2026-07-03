/**
 * Assessment "source" taxonomy — mirrors backend AssessmentSet.SOURCE_CHOICES and
 * ALLOWED_SOURCES_BY_SUBJECT. English and Math share SQB + External; the rest are
 * subject-specific. Keyed by the *domain* subject ("math" | "english").
 */

export type AssessmentSourceKey =
  | "SQB"
  | "SATOPLAM"
  | "MATHBOOK"
  | "PREP_PROS"
  | "HARD_QUESTIONS"
  | "EXTERNAL";

export const ASSESSMENT_SOURCE_LABELS: Record<AssessmentSourceKey, string> = {
  SQB: "SQB",
  SATOPLAM: "SAToplam",
  MATHBOOK: "Mathbook",
  PREP_PROS: "Prep Pros",
  HARD_QUESTIONS: "Hard questions",
  EXTERNAL: "External source",
};

const ENGLISH_SOURCES: AssessmentSourceKey[] = ["SQB", "SATOPLAM", "EXTERNAL"];
const MATH_SOURCES: AssessmentSourceKey[] = [
  "SQB",
  "MATHBOOK",
  "PREP_PROS",
  "HARD_QUESTIONS",
  "EXTERNAL",
];

/** Domain subject ("math" | "english") → the sources valid for it. */
export function allowedSourcesForSubject(subject: string | null | undefined): AssessmentSourceKey[] {
  const s = (subject || "").toLowerCase();
  if (s === "english") return ENGLISH_SOURCES;
  if (s === "math") return MATH_SOURCES;
  return [];
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return ASSESSMENT_SOURCE_LABELS[source as AssessmentSourceKey] ?? source;
}
