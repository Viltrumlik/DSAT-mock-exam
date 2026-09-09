"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { classroomKeys } from "./queryKeys";
import { useAssignments } from "./hooks";
import { classworkFromAssignments, type StudentClasswork } from "./classworkApi";
import { classworkAwardsApi, type ClassworkAwardsPanel } from "./classworkAwardsApi";
import { lessonsApi, type LessonClasswork } from "./lessonsApi";

const enabledId = (id: number) => Number.isFinite(id) && id > 0;

/**
 * Hung off the existing lesson key rather than given a key of its own, so the invalidation
 * the grant/release hooks already fire (`classroomKeys.lesson`) reaches it — react-query
 * matches by prefix. A sibling key would have gone stale every time a teacher opened an
 * item to the class.
 */
const classworkKey = (classId: number, lessonId: number) =>
  [...classroomKeys.lesson(classId, lessonId), "classwork"] as const;

/** The teacher's view of one lesson's classwork carrier + every award recorded on it. */
export function useLessonClasswork(classId: number, lessonId: number) {
  return useQuery<LessonClasswork>({
    queryKey: classworkKey(classId, lessonId),
    queryFn: () => lessonsApi.classwork(classId, lessonId),
    enabled: enabledId(classId) && enabledId(lessonId),
  });
}

/** Refresh everything a classwork write moves: the panel, the lesson row, the class's list. */
function useClassworkInvalidator(classId: number, lessonId: number) {
  const qc = useQueryClient();
  return () => {
    // Covers classworkKey too — it is a suffix of this one.
    qc.invalidateQueries({ queryKey: classroomKeys.lesson(classId, lessonId) });
    qc.invalidateQueries({ queryKey: classroomKeys.lessons(classId) });
    // The carrier IS an Assignment, and the students' Classwork tab reads the assignment
    // list — without this the class would not see the lesson until a full reload.
    qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
  };
}

export function useAssignClasswork(classId: number, lessonId: number) {
  const invalidate = useClassworkInvalidator(classId, lessonId);
  return useMutation({
    mutationFn: () => lessonsApi.assignClasswork(classId, lessonId),
    onSuccess: (data) => {
      invalidate();
      pushGlobalToast({
        tone: data?.created ? "success" : "neutral",
        message: data?.detail || "Classwork given to the class.",
      });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });
}

/**
 * Record one student's classwork points.
 *
 * Deliberately no error toast: the awarding row renders the failure inline with its own
 * retry, and a toast that disappears is not an error state a teacher can act on. Success
 * still toasts — the row's own confirmation is easy to miss mid-lesson.
 */
export function useAwardClasswork(classId: number, lessonId: number) {
  const invalidate = useClassworkInvalidator(classId, lessonId);
  return useMutation({
    mutationFn: (vars: { student_id: number; points: number; note?: string }) =>
      lessonsApi.awardClasswork(classId, lessonId, vars),
    onSuccess: (data) => {
      invalidate();
      pushGlobalToast({ tone: "success", message: data?.detail || "Points recorded." });
    },
  });
}

/**
 * Every classwork the requesting member can see in this class, newest first.
 *
 * Reads the classroom's assignment list — the same query the Assignments tab already
 * holds, so opening Classwork costs no extra request when that cache is warm.
 */
export function useStudentClasswork(classId: number): {
  rows: StudentClasswork[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useAssignments(classId);
  const rows = useMemo(() => classworkFromAssignments(query.data?.items ?? []), [query.data]);
  return {
    rows,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

// ── classwork XP, addressed by the classwork itself ───────────────────────────
//
// The hooks above reach an award THROUGH a journal lesson. These reach the same award by
// naming its carrier, which is the only way to pay classwork a teacher wrote by hand in
// the Classwork tab — that classwork has no lesson behind it. One row per (classwork,
// student) either way; see classworkAwardsApi.ts.

/** Hung off the classroom's assignment key so an assignment-list refresh reaches it too. */
const awardsKey = (classId: number, assignmentId: number) =>
  [...classroomKeys.assignments(classId), "awards", assignmentId] as const;

/** The roster + every XP already recorded for one classwork. Staff-readable. */
export function useClassworkAwards(classId: number, assignmentId: number, enabled = true) {
  return useQuery<ClassworkAwardsPanel>({
    queryKey: awardsKey(classId, assignmentId),
    queryFn: () => classworkAwardsApi.panel(classId, assignmentId),
    enabled: enabled && enabledId(classId) && enabledId(assignmentId),
  });
}

/**
 * Everything one XP write moves.
 *
 * The server hands back the refreshed panel, so that goes straight into the cache rather
 * than being invalidated — a teacher marking a class of twenty should see each name settle
 * immediately, not watch the whole list refetch twenty times. The assignment LIST is
 * invalidated separately: it carries each student's own `classwork_award`, which is what
 * they read on their own Classwork tab.
 */
function useAwardsWriteback(classId: number, assignmentId: number) {
  const qc = useQueryClient();
  return (panel: ClassworkAwardsPanel | undefined) => {
    if (panel?.students) qc.setQueryData(awardsKey(classId, assignmentId), panel);
    qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
    // The Lessons panel reads the same award through its own key; without this a teacher
    // who pays here and then opens the lesson would be shown the pre-payment figure.
    qc.invalidateQueries({ queryKey: classroomKeys.lessons(classId) });
  };
}

/**
 * Give (or revise) one student's XP for this classwork.
 *
 * No error toast, deliberately: the row renders its failure inline with its own retry, and
 * a toast that fades is not something a teacher mid-lesson can act on. Success toasts —
 * the row's own confirmation is easy to miss.
 */
export function useGiveClassworkXp(classId: number, assignmentId: number) {
  const writeback = useAwardsWriteback(classId, assignmentId);
  return useMutation({
    mutationFn: (vars: { student_id: number; points: number; note?: string }) =>
      classworkAwardsApi.give(classId, assignmentId, vars),
    onSuccess: (panel) => {
      writeback(panel);
      pushGlobalToast({ tone: "success", message: panel?.detail || "XP recorded." });
    },
  });
}

/** Take one student's award back entirely — points AND XP. Not the same as giving 0. */
export function useWithdrawClassworkXp(classId: number, assignmentId: number) {
  const writeback = useAwardsWriteback(classId, assignmentId);
  return useMutation({
    mutationFn: (studentId: number) =>
      classworkAwardsApi.withdraw(classId, assignmentId, studentId),
    onSuccess: (panel) => {
      writeback(panel);
      pushGlobalToast({ tone: "neutral", message: panel?.detail || "XP taken back." });
    },
  });
}
