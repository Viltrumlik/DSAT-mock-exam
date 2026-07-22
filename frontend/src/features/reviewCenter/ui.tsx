import type { ReviewContentType } from "./types";

/** Lenient subject label — accepts platform ("MATH"/"READING_WRITING") or domain ("math"/"english"). */
export function subjectLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "_");
  if (s === "MATH" || s === "MATHEMATICS") return "Math";
  if (s.includes("READING") || s.includes("WRITING") || s === "ENGLISH" || s === "RW") return "English";
  return String(raw);
}

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  needs_review: "bg-amber-100 text-amber-800",
  draft: "bg-slate-100 text-slate-700",
};
const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  needs_review: "Needs review",
  draft: "Incomplete",
};

export function reviewStatusBadge(status?: string | null): { label: string; className: string } | null {
  if (!status) return null;
  return {
    label: STATUS_LABELS[status] ?? status,
    className: STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700",
  };
}

export function publishBadge(isPublished?: boolean | null): { label: string; className: string } | null {
  if (isPublished == null) return null;
  return isPublished
    ? { label: "Published", className: "bg-emerald-100 text-emerald-800" }
    : { label: "Unpublished", className: "bg-slate-100 text-slate-700" };
}

/** Roles that may use the Review Center (mirrors backend can_view_tests / can_manage_questions). */
export function isReviewerRole(role?: string | null): boolean {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "test_auditor" || r === "test_admin" || r === "admin" || r === "super_admin";
}

export const REVIEW_TABS: { type: ReviewContentType; label: string }[] = [
  { type: "assessment", label: "Assessments" },
  { type: "pastpaper", label: "Past Papers" },
  { type: "mock", label: "Full Mocks" },
  { type: "midterm", label: "Midterms" },
];
