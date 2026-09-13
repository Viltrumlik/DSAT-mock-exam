/**
 * How a student finds one assessment among a hundred.
 *
 * The owner, 2026-09-13: a student with ~150 assessments cannot locate anything on one long
 * board. So the page opens on the two subjects, English and Math — or, when a student only has
 * one of them, goes straight into it — then the subject's SAT domains, and only inside a domain
 * the assessments themselves. A To-do strip on the landing view keeps the homework that is still
 * open one glance away. (Prod on that date: the busiest student had 118, p90 was 64, and 102 of
 * 134 students with any assessment had only one subject.)
 *
 * The pure parts live here so the rules can be tested without a page.
 */

import { assessmentCategoryGroups, type AssessmentSubjectKey } from "@/lib/assessmentSatTaxonomy";

export type SubjectKey = AssessmentSubjectKey;

/** The label for work whose set carries no category at all. */
export const OTHER_DOMAIN = "Other";

/**
 * `"english" | "math"`, or null. Sets say `math` / `english`; platform-shaped payloads say
 * `MATH` / `READING_WRITING` — both reach this page.
 */
export function subjectKeyOf(subject?: string | null): SubjectKey | null {
  const s = String(subject ?? "").trim().toUpperCase();
  if (s === "MATH") return "math";
  if (s === "ENGLISH" || s === "READING_WRITING" || s === "READING" || s === "RW") return "english";
  return null;
}

/**
 * The SAT domain a set belongs to. A category is stored as `"Domain › Subdomain"`
 * (see `assessmentSatTaxonomy`), so the domain is everything before the `›`. Every set on prod
 * follows that shape; the two with no category at all land in "Other" rather than vanishing.
 */
export function domainOf(category?: string | null): string {
  const domain = String(category ?? "").split("›")[0].trim();
  return domain || OTHER_DOMAIN;
}

/**
 * The domains a student actually has, in the order the SAT lists them. A name the taxonomy does
 * not know follows alphabetically, and "Other" always comes last.
 */
export function orderedDomains(subject: SubjectKey, present: Iterable<string>): string[] {
  const have = new Set(present);
  const known = assessmentCategoryGroups(subject).map((g) => g.domain);
  const unknown = [...have]
    .filter((d) => d !== OTHER_DOMAIN && !known.includes(d))
    .sort((a, b) => a.localeCompare(b));
  return [...known.filter((d) => have.has(d)), ...unknown, ...(have.has(OTHER_DOMAIN) ? [OTHER_DOMAIN] : [])];
}

/**
 * Belongs in To-do: homework not yet handed in whose deadline has not passed. Work with no
 * deadline has not passed one either, so it stays until it is done.
 */
export function isOpenTodo(dueAt: string | null | undefined, done: boolean, now: number): boolean {
  if (done) return false;
  if (!dueAt) return true;
  const due = new Date(dueAt).getTime();
  return Number.isNaN(due) || due >= now;
}

/** Nearest deadline first; work with no deadline after all of it. Stable otherwise. */
export function compareTodo(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? new Date(a).getTime() : Number.NaN;
  const tb = b ? new Date(b).getTime() : Number.NaN;
  const ka = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
  const kb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}
