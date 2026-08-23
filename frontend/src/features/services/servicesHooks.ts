"use client";

import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/api";
import type { ExamDateOption } from "@/features/dashboard/useDashboardData";

export const servicesKeys = {
  examDates: ["exam-dates"] as const,
};

/**
 * The SAT dates the school is currently offering.
 *
 * The same admin-managed list the profile dropdown and the dashboard countdown read
 * (`/ops/exam-dates` → `GET /users/exam-dates/`), which already filters to `is_active` AND
 * `exam_date >= today` and sorts by `sort_order`. So a date the school retires, or one that
 * has simply passed, disappears from the registration checklist on its own — nobody has to
 * remember to edit a second list.
 *
 * **Deliberately NOT `.catch(() => [])`.** Every other caller of this endpoint swallows a
 * failure into an empty array, which makes "the request failed" indistinguishable from "the
 * school is offering no dates". On a registration checklist those two are very different
 * instructions to a student, so this one lets the error surface and the caller renders it.
 *
 * `staleTime` is long because exam dates are set months ahead and change perhaps twice a
 * year — refetching them on every window focus buys nothing.
 */
export function useExamDates() {
  return useQuery<ExamDateOption[]>({
    queryKey: servicesKeys.examDates,
    queryFn: async () => {
      const data = await usersApi.listExamDates();
      // The endpoint is a plain ListAPIView, so this is an array — but a frozen account gets
      // a 403 body instead, and a paginator added later would hand back an object. Normalise
      // rather than letting `.map` throw inside a render.
      return Array.isArray(data) ? (data as ExamDateOption[]) : [];
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * How a date is written on the checklist: "March 14", or "March 14, 2027" when it is not in
 * the current year.
 *
 * The year is omitted for the common case because the school writes them that way and a
 * bare "March 14" is what a student will say out loud — but omitting it on a date fifteen
 * months out would be actively misleading, which is the one case worth the extra six
 * characters.
 */
export function formatExamDate(option: ExamDateOption, now = new Date()): string {
  const label = (option.label || "").trim();
  if (label) return label;

  // `exam_date` is a plain YYYY-MM-DD. Parsing it with `new Date()` would read it as UTC
  // midnight and render as the previous day for anyone west of Greenwich, so the parts are
  // split by hand and fed to a local-time constructor.
  const [y, m, d] = option.exam_date.split("-").map(Number);
  if (!y || !m || !d) return option.exam_date;

  const date = new Date(y, m - 1, d);
  // en-US for month-first ("March 14"), which is how the school writes SAT dates in its own
  // Telegram message and how College Board prints them. en-GB would render "14 March" and
  // quietly disagree with every other place a student sees the same sitting.
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
