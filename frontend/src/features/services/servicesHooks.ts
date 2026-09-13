"use client";

import { useQuery } from "@tanstack/react-query";
import { usersApi, type SupportBooking } from "@/lib/api";
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

/**
 * The soonest sitting on offer. The endpoint sorts by the admin's `sort_order`, which is a
 * display order and not a promise about time, so the earliest is picked here. `exam_date` is a
 * plain YYYY-MM-DD, which compares correctly as a string.
 */
export function earliestExamDate(options: ExamDateOption[] | undefined): ExamDateOption | null {
  let earliest: ExamDateOption | null = null;
  for (const option of options ?? []) {
    if (!earliest || option.exam_date < earliest.exam_date) earliest = option;
  }
  return earliest;
}

/**
 * The student's next support hour: booked, not withdrawn by the teacher, and not over yet — an
 * hour in progress still counts, since the student may be on their way to it. Earliest first.
 */
export function nextSupportHour(
  bookings: SupportBooking[] | undefined,
  now: number = Date.now(),
): SupportBooking | null {
  let next: SupportBooking | null = null;
  for (const booking of bookings ?? []) {
    if (booking.status !== "BOOKED" || booking.slot.is_cancelled) continue;
    if (!(Date.parse(booking.slot.ends_at) > now)) continue;
    if (!next || Date.parse(booking.slot.starts_at) < Date.parse(next.slot.starts_at)) next = booking;
  }
  return next;
}

/** "Today, 15:00" and "Tomorrow, 15:00" earn their names; after that, "Tue, Sep 15, 15:00". */
export function supportHourLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}
