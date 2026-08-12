"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attendanceApi, type AttendanceStatus } from "./attendanceApi";

const enabledId = (id: number) => Number.isFinite(id) && id > 0;
const keys = {
  sessions: (c: number) => ["classroom", "attendance", "sessions", c] as const,
  session: (c: number, s: number) => ["classroom", "attendance", "session", c, s] as const,
  summary: (c: number) => ["classroom", "attendance", "summary", c] as const,
  me: (c: number) => ["classroom", "attendance", "me", c] as const,
};

export function useAttendanceSessions(classId: number, enabled = true) {
  return useQuery({
    queryKey: keys.sessions(classId),
    queryFn: () => attendanceApi.listSessions(classId),
    enabled: enabled && enabledId(classId),
  });
}

export function useAttendanceSession(classId: number, sessionId: number | null) {
  return useQuery({
    queryKey: keys.session(classId, sessionId ?? 0),
    queryFn: () => attendanceApi.getSession(classId, sessionId as number),
    enabled: enabledId(classId) && !!sessionId,
  });
}

export function useAttendanceSummary(classId: number, enabled = true) {
  return useQuery({
    queryKey: keys.summary(classId),
    queryFn: () => attendanceApi.summary(classId),
    enabled: enabled && enabledId(classId),
  });
}

export function useMyAttendance(classId: number, enabled = true) {
  return useQuery({
    queryKey: keys.me(classId),
    queryFn: () => attendanceApi.me(classId),
    enabled: enabled && enabledId(classId),
  });
}

export function useCreateSession(classId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { date: string }) => attendanceApi.createSession(classId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sessions(classId) }),
  });
}

function invalidateSession(qc: ReturnType<typeof useQueryClient>, classId: number, sessionId: number) {
  qc.invalidateQueries({ queryKey: keys.session(classId, sessionId) });
  qc.invalidateQueries({ queryKey: keys.summary(classId) });
  qc.invalidateQueries({ queryKey: keys.sessions(classId) });
}

export function useMarkAttendance(classId: number, sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (records: { student_id: number; status: AttendanceStatus; note?: string }[]) =>
      attendanceApi.mark(classId, sessionId, records),
    onSuccess: () => invalidateSession(qc, classId, sessionId),
  });
}

export function useMarkAllPresent(classId: number, sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => attendanceApi.markAllPresent(classId, sessionId),
    onSuccess: () => invalidateSession(qc, classId, sessionId),
  });
}

export function useFinalizeSession(classId: number, sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => attendanceApi.finalize(classId, sessionId),
    onSuccess: () => invalidateSession(qc, classId, sessionId),
  });
}
