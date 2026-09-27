/**
 * How a past paper names itself. The library and the reader must agree word for word, or the
 * row a teacher clicked and the page that opens read as two different papers.
 */

import type { TeacherPaper } from "./api";

export function isReadingWriting(subject: string): boolean {
  return subject === "READING_WRITING" || (subject || "").toLowerCase().includes("reading");
}

export function subjectLabel(subject: string): string {
  if (isReadingWriting(subject)) return "Reading & Writing";
  if (subject === "MATH" || (subject || "").toLowerCase().includes("math")) return "Mathematics";
  return subject || "—";
}

export function regionLabel(paper: TeacherPaper): string {
  return paper.isUS ? "US" : "International";
}

/** "October 2025" — the sitting, which is how the papers are spoken about here. */
export function sittingLabel(date: string | null): string {
  if (!date) return "Undated";
  const t = new Date(date);
  return Number.isNaN(t.getTime()) ? date : t.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function yearOf(date: string | null): string | null {
  if (!date) return null;
  const t = new Date(date);
  return Number.isNaN(t.getTime()) ? null : String(t.getFullYear());
}

/**
 * The form letter, from `label` where it was recorded and from the last word of the collection
 * name where it was not — the older imports left `label` blank and put the letter in the title.
 */
export function formLetter(paper: TeacherPaper): string {
  if (/^[A-Za-z]$/.test(paper.label)) return paper.label.toUpperCase();
  const last = paper.collection.split(/\s+/).pop() || "";
  return /^[A-Za-z]$/.test(last) ? last.toUpperCase() : "";
}

/** "International Form A", or just the region when no letter was ever recorded. */
export function variantLabel(paper: TeacherPaper): string {
  const letter = formLetter(paper);
  return letter ? `${regionLabel(paper)} Form ${letter}` : regionLabel(paper);
}

export function paperTitle(paper: TeacherPaper): string {
  return paper.title || variantLabel(paper);
}

/** The line under the title: everything that tells two papers of one sitting apart. */
export function paperSubtitle(paper: TeacherPaper): string {
  return [subjectLabel(paper.subject), variantLabel(paper), sittingLabel(paper.sittingDate)]
    .filter(Boolean)
    .join(" · ");
}

/** Everything a search box may match on, lowercased once per row. */
export function searchBlob(paper: TeacherPaper): string {
  return [
    paperTitle(paper),
    paper.collection,
    paper.label,
    regionLabel(paper),
    subjectLabel(paper.subject),
    sittingLabel(paper.sittingDate),
  ]
    .join(" ")
    .toLowerCase();
}
