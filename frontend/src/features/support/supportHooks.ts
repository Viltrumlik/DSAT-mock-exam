"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";

const keys = {
  slots: ["support", "slots"] as const,
  calendar: ["support", "calendar"] as const,
  myBookings: ["support", "my-bookings"] as const,
  availability: ["support", "availability"] as const,
  diary: ["support", "diary"] as const,
  myCalendar: ["support", "my-calendar"] as const,
};

/** Student side. */
export function useSupportSlots() {
  return useQuery({ queryKey: keys.slots, queryFn: () => classesApi.supportSlots() });
}

/**
 * The bookable week. **Kept fresh on purpose, unlike every other query in this app.**
 *
 * This is the one screen where a stale cache tells a student something that is not merely old
 * but wrong: the seat count is contended, and the school reported exactly the failure that
 * follows from never refetching it — "one student books and it still shows free for the other
 * one". The second student sat looking at a grid rendered before the first one clicked, chose
 * the hour it still showed as open, and got refused.
 *
 * The global QueryClient sets `refetchOnWindowFocus: false` and a 15s `staleTime`, which is
 * right for a dashboard and wrong here: neither ever fires while a student is sitting on the
 * page deciding, so nothing at all re-read the calendar between mount and click. Both are
 * overridden per-query rather than globally — the fix belongs to the contended screen, not to
 * every screen.
 *
 * 30s is chosen against the booking rate, not the render cost: the desk takes on the order of
 * ten bookings a day across the school, so a half-minute window makes a collision rare, and
 * `book` still refuses authoritatively on the server when one happens anyway. Polling faster
 * would buy very little and put a recurring query on three sync gunicorn workers, which this
 * codebase has already been burned by once.
 */
export function useSupportCalendar() {
  return useQuery({
    queryKey: keys.calendar,
    queryFn: () => classesApi.supportCalendar(),
    refetchInterval: 30_000,
    // Coming back to the tab is the strongest signal there is that the student is about to
    // act on what it says.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useBookSupportHour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { teacherId: number; startsAt: string; topic?: string }) =>
      classesApi.supportBookHour(vars.teacherId, vars.startsAt, { topic: vars.topic }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.calendar });
      qc.invalidateQueries({ queryKey: keys.myBookings });
    },
    // A REFUSED booking is the one moment we know for certain the grid is out of date —
    // "that slot is full" is the server telling us so. Refetching here is what turns a
    // confusing error into a calendar that visibly corrects itself under the student.
    onError: () => {
      qc.invalidateQueries({ queryKey: keys.calendar });
      qc.invalidateQueries({ queryKey: keys.myBookings });
    },
  });
}

export function useMySupportBookings() {
  return useQuery({ queryKey: keys.myBookings, queryFn: () => classesApi.supportMyBookings() });
}

export function useBookSupport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { availability_id: number; topic?: string }) =>
      classesApi.supportBook(vars.availability_id, { topic: vars.topic }),
    // Both lists move together: taking a seat changes what is still bookable. The calendar
    // is in that set too — it was missing here while the sibling hook above had it, so
    // booking by slot id left the grid showing the seat it had just consumed.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.slots });
      qc.invalidateQueries({ queryKey: keys.calendar });
      qc.invalidateQueries({ queryKey: keys.myBookings });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: keys.slots });
      qc.invalidateQueries({ queryKey: keys.calendar });
    },
  });
}

export function useCancelSupportBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { bookingId: number; reason: string }) =>
      classesApi.supportCancelBooking(vars.bookingId, vars.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.slots });
      // The calendar carries the allowance, and giving a seat back returns one to it.
      qc.invalidateQueries({ queryKey: keys.calendar });
      qc.invalidateQueries({ queryKey: keys.myBookings });
    },
  });
}

/** Who this student may add to a booking they hold. Only fetched when the dialog opens —
 *  `enabled` keeps a picker's query off every booking row on the page. */
export function useInvitableClassmates(bookingId: number | null) {
  return useQuery({
    queryKey: ["support", "invitable", bookingId] as const,
    queryFn: () => classesApi.supportInvitable(bookingId as number),
    enabled: bookingId !== null,
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { bookingId: number; studentId: number }) =>
      classesApi.supportInviteMember(vars.bookingId, vars.studentId),
    onSuccess: () => {
      // An invitation can widen the slot, so what is bookable moves too.
      qc.invalidateQueries({ queryKey: ["support"] });
    },
  });
}

export function useRateSupportSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { bookingId: number; rating: number; comment?: string }) =>
      classesApi.supportRateBooking(vars.bookingId, vars.rating, vars.comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.myBookings }),
  });
}

/** Support-teacher side. */
export function useMyAvailability() {
  return useQuery({ queryKey: keys.availability, queryFn: () => classesApi.supportMyAvailability() });
}

export function usePublishSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { starts_at: string; ends_at: string; capacity?: number; note?: string }) =>
      classesApi.supportPublishSlot(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.availability }),
  });
}

export function useWithdrawSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slotId: number) => classesApi.supportWithdrawSlot(slotId),
    // Withdrawing cancels the bookings on the slot, so the diary changes too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.availability });
      qc.invalidateQueries({ queryKey: keys.diary });
    },
  });
}

export function useSupportDiary() {
  return useQuery({ queryKey: keys.diary, queryFn: () => classesApi.supportDiary() });
}

export function useMySupportCalendar() {
  return useQuery({ queryKey: keys.myCalendar, queryFn: () => classesApi.supportMyCalendar() });
}

export function useSetSupportHour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { action: "close" | "open"; startsAt: string; note?: string }) =>
      classesApi.supportSetHour(vars.action, vars.startsAt, { note: vars.note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.myCalendar });
      // Withdrawing an hour cancels the bookings on it, so the diary changes too.
      qc.invalidateQueries({ queryKey: keys.diary });
      qc.invalidateQueries({ queryKey: keys.availability });
    },
  });
}

export function useSettleBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { bookingId: number; status: "HELD" | "NO_SHOW"; teacherNote?: string }) =>
      classesApi.supportSettle(vars.bookingId, vars.status, vars.teacherNote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.diary });
      // Settling changes which bookings still occupy a seat, so the slot list's
      // "n of m free" is stale the moment a session is settled.
      qc.invalidateQueries({ queryKey: keys.availability });
      qc.invalidateQueries({ queryKey: keys.myCalendar });
    },
  });
}
