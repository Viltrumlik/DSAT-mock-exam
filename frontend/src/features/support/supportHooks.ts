"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";

const keys = {
  slots: ["support", "slots"] as const,
  myBookings: ["support", "my-bookings"] as const,
  availability: ["support", "availability"] as const,
  diary: ["support", "diary"] as const,
};

/** Student side. */
export function useSupportSlots() {
  return useQuery({ queryKey: keys.slots, queryFn: () => classesApi.supportSlots() });
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
    mutationFn: (bookingId: number) => classesApi.supportCancelBooking(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.slots });
      qc.invalidateQueries({ queryKey: keys.myBookings });
    },
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

export function useSettleBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { bookingId: number; status: "HELD" | "NO_SHOW" }) =>
      classesApi.supportSettle(vars.bookingId, vars.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.diary }),
  });
}
