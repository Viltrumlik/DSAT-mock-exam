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

export function useSupportCalendar() {
  return useQuery({ queryKey: keys.calendar, queryFn: () => classesApi.supportCalendar() });
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
    // Both lists move together: taking a seat changes what is still bookable.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.slots });
      qc.invalidateQueries({ queryKey: keys.myBookings });
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
    mutationFn: (vars: {
      action: "close" | "open";
      startsAt: string;
      note?: string;
      capacity?: number;
    }) =>
      classesApi.supportSetHour(vars.action, vars.startsAt, {
        note: vars.note,
        capacity: vars.capacity,
      }),
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
