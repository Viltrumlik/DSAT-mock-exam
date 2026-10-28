/**
 * Assessment "source" taxonomy — mirrors backend AssessmentSet.SOURCE_CHOICES and
 * ALLOWED_SOURCES_BY_SUBJECT. English and Math share SQB + External; the rest are
 * subject-specific. Keyed by the *domain* subject ("math" | "english").
 */

/** Foundation Math homework topics — Math-only, and only for Foundation-level sets. */
const FOUNDATION_SOURCE_LABELS = {
  FOUNDATION_S01: "S01 Positive and Negative Numbers",
  FOUNDATION_S02: "S02 Order of Operations and the Number Line",
  FOUNDATION_S03: "S03 Common Fractions",
  FOUNDATION_S04: "S04 Decimals",
  FOUNDATION_S06: "S06 Ratio and Proportion",
  FOUNDATION_S07: "S07 Percent",
  FOUNDATION_S08: "S08 Linear Equations in One Variable",
  FOUNDATION_S09: "S09 Equations with Absolute Value",
  FOUNDATION_S13: "S13 Powers and Their Properties",
  FOUNDATION_S14: "S14 Monomials Sum and Difference of Polynomials",
  FOUNDATION_S15: "S15 Multiplying Monomials and Polynomials",
  FOUNDATION_S16: "S16 Special Products",
  FOUNDATION_S18: "S18 The Coordinate Plane and Distance",
  FOUNDATION_S19: "S19 Triangles",
  FOUNDATION_S20: "S20 Squares and Rectangles",
  FOUNDATION_S21: "S21 Circles",
} as const;

type FoundationSourceKey = keyof typeof FOUNDATION_SOURCE_LABELS;

export type AssessmentSourceKey =
  | "SQB"
  | "SATOPLAM"
  | "MATHBOOK"
  | "PREP_PROS"
  | "HARD_QUESTIONS"
  | "EXTERNAL"
  | FoundationSourceKey;

export const ASSESSMENT_SOURCE_LABELS: Record<AssessmentSourceKey, string> = {
  SQB: "SQB",
  SATOPLAM: "SAToplam",
  MATHBOOK: "Mathbook",
  PREP_PROS: "Prep Pros",
  HARD_QUESTIONS: "Hard questions",
  EXTERNAL: "External source",
  ...FOUNDATION_SOURCE_LABELS,
};

const FOUNDATION_SOURCES = Object.keys(FOUNDATION_SOURCE_LABELS) as FoundationSourceKey[];
const ENGLISH_SOURCES: AssessmentSourceKey[] = ["SQB", "SATOPLAM", "EXTERNAL"];
const MATH_SOURCES: AssessmentSourceKey[] = [
  "SQB",
  "MATHBOOK",
  "PREP_PROS",
  "HARD_QUESTIONS",
  "EXTERNAL",
];

/**
 * Domain subject ("math" | "english") → the sources valid for it. Pass `levels` (the
 * set's or classroom's levels) to drop the Foundation homework topics where no level is
 * Foundation; omit it where the level isn't known and every Math source should show.
 */
export function allowedSourcesForSubject(
  subject: string | null | undefined,
  levels?: ReadonlyArray<string | null | undefined>,
): AssessmentSourceKey[] {
  const s = (subject || "").toLowerCase();
  if (s === "english") return ENGLISH_SOURCES;
  if (s !== "math") return [];
  const withFoundation = levels === undefined || levels.includes("foundation");
  return withFoundation ? [...MATH_SOURCES, ...FOUNDATION_SOURCES] : MATH_SOURCES;
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return ASSESSMENT_SOURCE_LABELS[source as AssessmentSourceKey] ?? source;
}

/** `source` if it still fits the subject + levels, else "" — use when a level changes. */
export function reconcileSource(
  subject: string | null | undefined,
  source: string | null | undefined,
  levels: ReadonlyArray<string | null | undefined>,
): string {
  if (!source) return "";
  return allowedSourcesForSubject(subject, levels).includes(source as AssessmentSourceKey) ? source : "";
}
