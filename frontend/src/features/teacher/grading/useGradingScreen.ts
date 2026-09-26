"use client";

/**
 * One grading screen's data: the queue on the left, one homework's submissions on the right,
 * and the walk from one student to the next.
 *
 * Two requests, both of which already existed:
 *
 * * `GET /api/classes/teacher/today/` — the dashboard's queue, class → homework → students,
 *   already ordered "what should I open first". Nothing new was added to the backend for this
 *   screen; the same payload the dashboard's card draws is the navigation here.
 * * `GET /api/classes/<class>/assignments/<homework>/submissions/` — the open homework, which
 *   is the ONLY place the work itself lives: the uploaded pdf or jpg, the revision the grade
 *   endpoint checks, and the review already written. The queue caps its student list at twelve
 *   per homework; this read is uncapped, so a class with 134 waiting is workable to the end.
 *
 * Grading and returning go through `POST /classes/submissions/<id>/grade/` and `.../return/`
 * unchanged, carrying `expected_revision` so two teachers cannot overwrite each other in
 * silence. A 409 from either is surfaced, never swallowed, and never advances the teacher past
 * the work they did not save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
import { teacherTodayKey, useTeacherToday, type QueueClass } from "../useTeacherToday";
import {
  findStop,
  flattenQueue,
  nextStopAfter,
  parseSubmissions,
  submissionOfStudent,
  waitingSubmissions,
  type GradingSubmission,
  type QueueStop,
  type Selection,
} from "./gradingQueueModel";

export type { Selection };

/** What the teacher is told after an action, and in which voice. */
export type ActionNote = { tone: "success" | "danger" | "warning"; text: string } | null;

const EMPTY: readonly GradingSubmission[] = [];

/**
 * How long the dashboard's queue waits after a grade before it is rebuilt. Long enough that a
 * teacher working down a class rebuilds it once at the end of a run rather than once per piece
 * of work — `GET teacher/today/` is a three-level aggregate over every class they teach.
 */
const QUEUE_REFRESH_DELAY_MS = 4_000;

export function submissionsKey(classId: number | null, assignmentId: number | null) {
  return ["teacher", "grading", "submissions", classId, assignmentId] as const;
}

/** The server's own reason for refusing, when it gave one. */
function detailOf(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  return typeof d === "string" ? d : null;
}

function statusOf(e: unknown): number | null {
  const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof s === "number" ? s : null;
}

export function useGradingScreen(initial: Selection) {
  const queryClient = useQueryClient();
  const today = useTeacherToday();
  // Memoized so the flattened walk, and the effects that read it, change when the payload does
  // and not once per keystroke in the feedback box.
  const queue: QueueClass[] = useMemo(() => today.data?.gradingQueue ?? [], [today.data]);
  const stops = useMemo(() => flattenQueue(queue), [queue]);

  const [sel, setSel] = useState<Selection>(initial);
  /** Settled in this session. The refetch that removes them may not have landed yet. */
  const [graded, setGraded] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<ActionNote>(null);
  /**
   * A write is on the wire. A ref and not `saving`, because the callbacks that read it are the
   * keyboard's — they close over the render they were bound in, and two keypresses in the same
   * frame would both read `saving === false`. The ref is written before the await, so the
   * second one sees it.
   */
  const inFlight = useRef(false);

  /**
   * Titles seen in the queue, kept by homework id. Grading the last piece of a homework takes
   * it out of the queue on the next refetch — and the teacher is still looking at it, so the
   * heading must not turn into "Homework #88" the moment the work is done.
   */
  const labels = useRef(new Map<number, { className: string; title: string }>());
  useEffect(() => {
    for (const s of stops) labels.current.set(s.assignmentId, { className: s.className, title: s.title });
  }, [stops]);

  const detail = useQuery({
    queryKey: submissionsKey(sel.classId, sel.assignmentId),
    queryFn: async () =>
      parseSubmissions(await classesApi.listSubmissions(Number(sel.classId), Number(sel.assignmentId))),
    enabled: sel.classId != null && sel.assignmentId != null,
    // A failed read must reach the ErrorState with its retry, not spin forever behind a silent
    // retry the teacher cannot see.
    retry: false,
    staleTime: 10_000,
  });

  const submissions = detail.data ?? (EMPTY as GradingSubmission[]);
  const waiting = useMemo(() => waitingSubmissions(submissions, graded), [submissions, graded]);
  const current = submissionOfStudent(submissions, sel.studentId);

  const stop: QueueStop | null = findStop(stops, sel.classId, sel.assignmentId);
  const remembered = sel.assignmentId != null ? labels.current.get(sel.assignmentId) : undefined;
  const className = stop?.className ?? remembered?.className ?? "";
  const homeworkTitle = stop?.title ?? remembered?.title ?? "";

  // Open a homework when the address named none. Keyed on the HOMEWORK, not the class: a link
  // that carries only `?class=<id>` — which is what the dashboard's card sends when it points at
  // a whole class — names a class and no homework, and keying this on the class would leave the
  // right-hand side sitting on "Pick a student from the queue" forever.
  // Only ever from an answer that came back: a failed load leaves the selection empty so the
  // screen can say it failed.
  useEffect(() => {
    if (sel.assignmentId != null || stops.length === 0) return;
    // The named class's first homework when it is in the queue; the top of the queue when the
    // address named a class with nothing waiting in it, so the screen still opens something.
    const first = (sel.classId != null ? stops.find((s) => s.classId === sel.classId) : undefined) ?? stops[0];
    setSel({ classId: first.classId, assignmentId: first.assignmentId, studentId: null });
  }, [stops, sel.assignmentId, sel.classId]);

  /**
   * Where the open homework sits in the flattened walk. Kept because grading its last waiting
   * piece takes it OUT of the queue on the next refetch, and "what comes next" must still be the
   * next homework rather than the top of the list. See `nextStopAfter`.
   */
  const stopIndex = useRef(0);
  useEffect(() => {
    const i = stops.findIndex((s) => s.classId === sel.classId && s.assignmentId === sel.assignmentId);
    if (i >= 0) stopIndex.current = i;
  }, [stops, sel.classId, sel.assignmentId]);

  // Inside an open homework, land on the student who has waited longest.
  useEffect(() => {
    if (sel.studentId != null || waiting.length === 0) return;
    const id = waiting[0].student?.id;
    if (typeof id === "number") setSel((s) => ({ ...s, studentId: id }));
  }, [waiting, sel.studentId]);

  // The address always names what is on screen, so the teacher can send a colleague straight to
  // this piece of work. Replaced rather than pushed: Back belongs to the page they came from,
  // not to every student they have stepped through.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const next = new URLSearchParams();
    if (sel.classId != null) next.set("class", String(sel.classId));
    if (sel.assignmentId != null) next.set("homework", String(sel.assignmentId));
    if (sel.studentId != null) next.set("student", String(sel.studentId));
    const search = next.toString();
    if (search === url.searchParams.toString()) return;
    window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}`);
  }, [sel]);

  const openHomework = useCallback((classId: number, assignmentId: number, studentId: number | null = null) => {
    setNote(null);
    setSel({ classId, assignmentId, studentId });
  }, []);

  const openStudent = useCallback((studentId: number) => {
    setNote(null);
    setSel((s) => ({ ...s, studentId }));
  }, []);

  /** The next student waiting in this homework, then the next homework. Never a list in between. */
  const advance = useCallback(
    (settledSubmissionId: number) => {
      // Recomputed here rather than read from `waiting`, which still carries the student whose
      // grade has only just been accepted: setState has not re-rendered yet.
      const remaining = waitingSubmissions(submissions, new Set([...graded, settledSubmissionId]));
      const nextStudent = remaining[0]?.student?.id;
      if (typeof nextStudent === "number") {
        setSel((s) => ({ ...s, studentId: nextStudent }));
        return;
      }
      const next = nextStopAfter(stops, sel.classId, sel.assignmentId, stopIndex.current);
      if (next) {
        setSel({ classId: next.classId, assignmentId: next.assignmentId, studentId: null });
        return;
      }
      setSel((s) => ({ ...s, studentId: null }));
    },
    [graded, submissions, sel.classId, sel.assignmentId, stops],
  );

  /**
   * Move on without grading. The work stays waiting — skipping settles nothing.
   *
   * Refused while a save is in flight: that save will advance the screen when it resolves, and a
   * skip in between would be overwritten by it — the teacher would end up on a student they did
   * not choose, reading someone else's work.
   */
  const skip = useCallback(() => {
    if (inFlight.current) return;
    setNote(null);
    const i = waiting.findIndex((s) => s.student?.id === sel.studentId);
    const next = i >= 0 ? waiting[i + 1] : waiting[0];
    const id = next?.student?.id;
    if (typeof id === "number") {
      setSel((s) => ({ ...s, studentId: id }));
      return;
    }
    const nextStop = nextStopAfter(stops, sel.classId, sel.assignmentId, stopIndex.current);
    if (nextStop) setSel({ classId: nextStop.classId, assignmentId: nextStop.assignmentId, studentId: null });
  }, [waiting, sel.studentId, sel.classId, sel.assignmentId, stops]);

  /**
   * After a write that SUCCEEDED, nothing is refetched straight away.
   *
   * Re-reading the submissions list is not free here: that GET runs a lazy whole-class sync on
   * the way past, so in the class this screen exists for — 134 waiting — every single grade
   * would cost one whole-class sync plus an uncapped list read plus a teacher/today rebuild.
   * The row we just settled is written into the cache instead, which is all the screen needed
   * from that round trip, and the dashboard's queue is invalidated on a trailing timer so a run
   * of twenty grades rebuilds it once and not twenty times.
   */
  const settleLocally = useCallback(
    (submissionId: number, patch: Partial<GradingSubmission>) => {
      queryClient.setQueryData<GradingSubmission[]>(submissionsKey(sel.classId, sel.assignmentId), (prev) =>
        Array.isArray(prev) ? prev.map((s) => (s.id === submissionId ? { ...s, ...patch } : s)) : prev,
      );
    },
    [queryClient, sel.classId, sel.assignmentId],
  );

  const todayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleQueueRefresh = useCallback(() => {
    if (todayTimer.current) clearTimeout(todayTimer.current);
    todayTimer.current = setTimeout(() => {
      todayTimer.current = null;
      void queryClient.invalidateQueries({ queryKey: teacherTodayKey });
    }, QUEUE_REFRESH_DELAY_MS);
  }, [queryClient]);
  useEffect(
    () => () => {
      // Dropped rather than flushed: a refetch fired after the screen is gone helps nobody, and
      // `teacher/today` is 30s-stale anyway, so the next page to ask re-reads it.
      if (todayTimer.current) clearTimeout(todayTimer.current);
    },
    [],
  );

  /**
   * After a write that was REFUSED on a revision clash. Here the refetch is the point: the
   * colleague's review has to come back so the teacher can read it before deciding again.
   */
  const refetchAfterConflict = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: submissionsKey(sel.classId, sel.assignmentId) });
    void queryClient.invalidateQueries({ queryKey: teacherTodayKey });
  }, [queryClient, sel.classId, sel.assignmentId]);

  /**
   * Save the grade, then move on. Returns false when nothing was saved, so the caller can keep
   * the teacher's words on screen — a rejected save must never look like a saved one.
   *
   * The first line is the guard the Save BUTTON gets for free from `busy` and the keyboard does
   * not: two quick ⌘↵ send the same `expected_revision` twice, the first commits and advances,
   * and the second comes back 409 — which would then paint "another teacher saved this one"
   * over the NEXT student's work. That warning would be a lie about work in front of the
   * teacher, so the second press is refused before it leaves.
   */
  const saveAndNext = useCallback(
    async (input: { grade: string; feedback: string }, options?: { advance?: boolean }): Promise<boolean> => {
      if (!current || inFlight.current) return false;
      inFlight.current = true;
      setSaving(true);
      setNote(null);
      try {
        await classesApi.gradeSubmission(current.id, {
          grade: input.grade.trim() === "" ? null : input.grade.trim(),
          feedback: input.feedback ?? "",
          ...(typeof current.revision === "number" ? { expected_revision: current.revision } : {}),
        });
        setGraded((prev) => new Set([...prev, current.id]));
        setNote({ tone: "success", text: "Saved." });
        settleLocally(current.id, {
          status: "REVIEWED",
          workflow_status: "REVIEWED",
          review: { grade: input.grade.trim() === "" ? null : input.grade.trim(), feedback: input.feedback ?? "" },
        });
        scheduleQueueRefresh();
        if (options?.advance !== false) advance(current.id);
        return true;
      } catch (e: unknown) {
        if (statusOf(e) === 409) {
          // Someone else graded this while it was open. Their work stands; this teacher reads it
          // and decides again — the screen does not move on, and nothing was overwritten.
          setNote({
            tone: "warning",
            text: "Another teacher saved this one while you had it open. Their review is now on screen — check it before you save again.",
          });
          refetchAfterConflict();
          return false;
        }
        setNote({ tone: "danger", text: detailOf(e) ?? "The grade didn't save. Nothing was changed — try again." });
        return false;
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [current, advance, settleLocally, scheduleQueueRefresh, refetchAfterConflict],
  );

  /** Send the work back for another go. Same guards, same handling of a 409. */
  const returnForRevision = useCallback(
    async (noteToStudent: string): Promise<boolean> => {
      if (!current || inFlight.current) return false;
      inFlight.current = true;
      setSaving(true);
      setNote(null);
      try {
        await classesApi.returnSubmission(current.id, {
          ...(noteToStudent.trim() ? { note: noteToStudent.trim() } : {}),
          ...(typeof current.revision === "number" ? { expected_revision: current.revision } : {}),
        });
        setGraded((prev) => new Set([...prev, current.id]));
        setNote({ tone: "success", text: "Sent back for another go." });
        settleLocally(current.id, {
          status: "RETURNED",
          workflow_status: "RETURNED",
          ...(noteToStudent.trim() ? { return_note: noteToStudent.trim() } : {}),
        });
        scheduleQueueRefresh();
        advance(current.id);
        return true;
      } catch (e: unknown) {
        if (statusOf(e) === 409) {
          setNote({
            tone: "warning",
            text: "Another teacher saved this one while you had it open. Their review is now on screen — check it before you send it back.",
          });
          refetchAfterConflict();
          return false;
        }
        setNote({ tone: "danger", text: detailOf(e) ?? "It didn't go back. Nothing was changed — try again." });
        return false;
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [current, advance, settleLocally, scheduleQueueRefresh, refetchAfterConflict],
  );

  const totalWaiting = queue.reduce((sum, k) => sum + k.waiting, 0);

  return {
    // the queue
    queue,
    stops,
    totalWaiting,
    queueLoading: today.isPending,
    queueFailed: today.isError,
    // The server's own words when it gave any — a 403 says WHICH class the teacher may not
    // grade in, and "this is only the page failing to read what is waiting" replaces that with
    // a reassurance about the wrong thing. Null when the failure had no reason to give (a
    // dropped connection, an HTML error page), and the generic line stands.
    queueReason: detailOf(today.error),
    retryQueue: () => void today.refetch(),
    // the open homework
    selection: sel,
    className,
    homeworkTitle,
    submissions,
    waiting,
    current,
    workLoading: detail.isPending && sel.assignmentId != null,
    workFailed: detail.isError,
    workReason: detailOf(detail.error),
    retryWork: () => void detail.refetch(),
    // acting on it
    saving,
    note,
    clearNote: () => setNote(null),
    openHomework,
    openStudent,
    skip,
    saveAndNext,
    returnForRevision,
  };
}
