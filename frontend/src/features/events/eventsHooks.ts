"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { eventsApi, type Attendance } from "./eventsApi";

const keys = {
  upcoming: ["events", "upcoming"] as const,
  mine: ["events", "mine"] as const,
  adminList: ["events", "admin", "list"] as const,
  registrations: (id: number) => ["events", "admin", "registrations", id] as const,
};

/**
 * What is coming up. Also drives the top-bar button, the sign-in dialog and the dashboard
 * card, so it runs on every page — hence a staleTime rather than a refetch per mount.
 */
export function useUpcomingEvents() {
  return useQuery({ queryKey: keys.upcoming, queryFn: () => eventsApi.upcoming(), staleTime: 60_000 });
}

export function useMyEvents() {
  return useQuery({ queryKey: keys.mine, queryFn: () => eventsApi.mine(), staleTime: 60_000 });
}

function invalidateSeats(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["events"] });
  // Attending pays, so the points pill and the Points page are stale the moment ops mark it —
  // and a sign-up changes nothing there, which costs one cheap refetch and keeps one rule.
  qc.invalidateQueries({ queryKey: ["rewards"] });
}

export function useSignUpForEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eventsApi.signUp(id),
    onSuccess: () => invalidateSeats(qc),
  });
}

export function useCancelEventSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eventsApi.cancel(id),
    onSuccess: () => invalidateSeats(qc),
  });
}

// ── ops ────────────────────────────────────────────────────────────────────
export function useAdminEvents() {
  return useQuery({ queryKey: keys.adminList, queryFn: () => eventsApi.adminList() });
}

export function useEventRegistrations(id: number) {
  return useQuery({
    queryKey: keys.registrations(id),
    queryFn: () => eventsApi.adminRegistrations(id),
    // /ops/events/0 gives 0 and a disabled react-query v5 query reports "pending" forever,
    // which the page would render as a skeleton that never resolves.
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useSaveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: FormData | Record<string, unknown> }) =>
      id ? eventsApi.adminUpdate(id, body) : eventsApi.adminCreate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eventsApi.adminDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function usePublishEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eventsApi.adminPublish(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eventsApi.adminCancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useMarkAttendance(eventId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, attendance }: { id: number; attendance: Attendance }) =>
      eventsApi.adminMark(id, attendance),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.registrations(eventId) });
      qc.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
}
