/**
 * How a past paper is named on a card: its month, region and form, and subject. Shared by the
 * student site's Past Papers page and the Windows app's "Your tests", so a paper reads the same
 * in both. Moved here verbatim from `app/(main)/pastpapers/page.tsx`.
 */
import type { PastpaperSection } from "@/lib/api";

export function fmtMonth(s: string | null | undefined): string {
  if (!s) return "Undated";
  try { return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" }); } catch { return s; }
}
export function fmtDay(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; }
}
export function yearOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}
export function isRW(subject: string): boolean {
  return subject === "READING_WRITING" || subject?.toLowerCase().includes("reading");
}
export function subjectLabel(subject: string): string {
  if (isRW(subject)) return "Reading & Writing";
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) return "Mathematics";
  return subject;
}
export function formLetter(s: PastpaperSection): string {
  const lbl = (s.label || "").trim();
  if (/^[A-Za-z]$/.test(lbl)) return lbl.toUpperCase();
  // Fall back to the last token of collection_name (e.g. "November 2025 Int. B" → "B")
  // for older rows where `label` was left blank.
  const last = (s.collection_name || "").trim().split(/\s+/).pop() || "";
  return /^[A-Za-z]$/.test(last) ? last.toUpperCase() : "";
}
export function variantLabel(s: PastpaperSection): string {
  // Full, readable variant used as the card TITLE, e.g. "International Form A" /
  // "US Form B". Region comes from form_type; the form letter from `label` (or a
  // fallback parse of collection_name). The month is the GROUP HEADER and the
  // subject (R&W / Math) is the badge, so the title carries the variant only.
  const region = s.form_type === "US" ? "US" : "International";
  const letter = formLetter(s);
  return letter ? `${region} Form ${letter}` : region;
}
export function sectionTitle(s: PastpaperSection): string {
  if (s.title && s.title.trim()) return s.title.trim();
  return variantLabel(s);
}
export function collectionLabel(s: PastpaperSection): string {
  // Group header = the sitting month (e.g. "October 2025"); ALL variants
  // (Int. A/B, US A/B) live under one month, distinguished by the card title.
  return fmtMonth(s.practice_date);
}
