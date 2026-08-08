"use client";

/**
 * Dashboard data layer — reuses existing student APIs only (no backend work).
 * Sources: useMe, examsStudentApi.getAttempts, classesApi.list + myAssignments,
 * usersApi.listExamDates / patchMe. All derivations are client-side and framed
 * positively (see growth-oriented-language guidance).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  classesApi,
  emptyNormalizedExamList,
  emptyNormalizedList,
  usersApi,
  type UserMe,
} from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { useMe } from "@/hooks/useMe";
import { platformSubjectIsMath, platformSubjectIsReadingWriting } from "@/lib/permissions";

export type Attempt = {
  id: number;
  submitted_at?: string | null;
  is_completed?: boolean;
  score?: number | null;
  practice_test_details?: { subject?: string; title?: string };
};

/**
 * The shape `/classes/my-assignments/` actually returns. Note `classroom_id`, not
 * `classroom`: this endpoint hydrates its own flattened payload rather than serving
 * `AssignmentSerializer` verbatim, and the old `classroom` field here never existed —
 * which is why every "upcoming" row used to fall back to the catalogue instead of
 * deep-linking to the assignment.
 */
type AssignmentLite = {
  id: number;
  title?: string;
  due_at?: string | null;
  practice_scope?: string;
  classroom_id?: number | null;
  classroom_name?: string | null;
  /** How much work it is — "27 questions". Already served; long unused. */
  item_count?: number | null;
  content_type?: string | null;
  /** NOT_STARTED | IN_PROGRESS | RETURNED | SUBMITTED | GRADED, in either case. */
  workflow_status?: string | null;
};

export type DashboardStatus = "booting" | "unauthenticated" | "ready";

/** Admin-defined SAT date a student may select (active + upcoming only). */
export type ExamDateOption = { id: number; exam_date: string; label: string };

export type MilestoneItem = { id: string; label: string; done: boolean };
export type ActionItem = { id: string; title: string; detail: string; href: string };
export type RecentItem = { id: number; title: string; meta: string; time: string; isMath: boolean };
export type UpcomingItem = {
  id: number;
  title: string;
  href: string;
  dueLabel: string;
  soon: boolean;
  /** "27 questions · Math Middle A" — the size and the class, which decide whether a
   *  student starts now or puts it off. Both were already on the wire. */
  meta: string;
  /** True once the due date has passed. Never rendered as "overdue" — see `dueLabel`. */
  behind: boolean;
};

export type DashboardModel = {
  firstName: string;
  /** Most recent full mock score (scaled total). */
  current: number | null;
  /** Forward projection from recent scored attempts (estimate). */
  predicted: number | null;
  target: number | null;
  /** Section targets (200–800). Stored when set; otherwise split from the total. */
  englishTarget: number | null;
  mathTarget: number | null;
  /** Points remaining to target (0 when reached). */
  gap: number | null;
  goalReached: boolean;
  /** 0–100, progress toward target (or toward 1600 if no target). */
  readiness: number | null;
  readinessVsTarget: boolean;
  examDate: string | null;
  examDaysLeft: number | null;
  /** Upcoming admin-defined dates a student can choose from (past ones excluded). */
  examDateOptions: ExamDateOption[];
  totalCompleted: number;
  classCount: number;
  streak: number;
  weeklySessions: number;
  weeklyGoal: number;
  resumeAttemptId: number | null;
  scoreSeries: { label: string; score: number }[];
  weekly: { label: string; sessions: number }[];
  sectionMix: { name: string; value: number; color: string }[];
  milestones: MilestoneItem[];
  focusAreas: ActionItem[];
  nextActions: ActionItem[];
  recent: RecentItem[];
  upcoming: UpcomingItem[];
};

const WEEKLY_GOAL = 5;
const DAY = 86400000;

function startOfDay(d: Date | number) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / DAY);
}
function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function projectScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const last = scores[scores.length - 1];
  if (scores.length < 2) return last;
  const deltas: number[] = [];
  for (let i = Math.max(1, scores.length - 3); i < scores.length; i++) {
    deltas.push(scores[i] - scores[i - 1]);
  }
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return clamp(Math.round(last + avg), Math.min(...scores), 1600);
}

/**
 * Still to do. `RETURNED` counts as outstanding — it means "revise and resubmit" — but
 * submitted and graded work does not: telling a student to do something they have already
 * turned in is the bug this list exists to end.
 */
function isOutstanding(status?: string | null): boolean {
  return !["submitted", "graded"].includes((status || "").trim().toLowerCase());
}

/**
 * "27 questions" — how much work a row is, which is what decides whether a student starts
 * now or puts it off.
 *
 * Only the kinds whose `item_count` really is a question count get a label. For
 * `content_type: "file"` the server counts *attachments*, and a vocabulary-only assignment
 * also falls through to "file" (there is no "vocabulary" content type — vocab travels in a
 * separate `vocab_homeworks` array), so a number there would be describing the wrong thing.
 * Saying nothing beats saying "1 attachment" about a set of ten words.
 */
function sizeLabel(a: { item_count?: number | null; content_type?: string | null }): string {
  const n = a.item_count ?? 0;
  if (n <= 0) return "";
  if (!["assessment", "pastpaper", "practice", "mock"].includes(a.content_type ?? "")) return "";
  return `${n} question${n === 1 ? "" : "s"}`;
}

/** Local-midnight timestamp for a date-only ("YYYY-MM-DD") exam date. */
function examDayStart(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return d.getTime();
}

function buildModel(
  me: UserMe,
  attempts: Attempt[],
  classCount: number,
  assignments: AssignmentLite[],
  examDateOptions: ExamDateOption[],
): DashboardModel {
  const firstName = me.first_name?.trim() || "there";
  const completed = attempts.filter((a) => a.is_completed);
  const resume = attempts.find((a) => !a.is_completed) ?? null;

  // Score progression — completed attempts that carry a numeric score.
  const scored = completed
    .filter((a) => typeof a.score === "number" && a.submitted_at)
    .sort((a, b) => new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime());
  const scoreSeries = scored.slice(-8).map((a) => ({ label: shortDate(a.submitted_at!), score: a.score as number }));

  const lastMock = me.last_mock_result?.score ?? null;
  const current = lastMock ?? (scored.length ? (scored[scored.length - 1].score as number) : null);
  const predicted = projectScore(scored.map((a) => a.score as number));
  const target = me.target_score ?? null;
  // Section targets: prefer the stored values; otherwise split the total evenly
  // (English rounded to the nearest 10, Math takes the remainder).
  const englishTarget =
    me.target_english ?? (target != null ? Math.round(target / 20) * 10 : null);
  const mathTarget =
    me.target_math ?? (target != null && englishTarget != null ? target - englishTarget : null);
  const gap = target != null && current != null ? Math.max(0, target - current) : null;
  const goalReached = target != null && current != null && current >= target;
  const readinessVsTarget = target != null;
  const readiness =
    current == null
      ? null
      : readinessVsTarget
        ? clamp(Math.round((current / (target as number)) * 100), 0, 100)
        : clamp(Math.round((current / 1600) * 100), 0, 100);

  // Weekly activity — last 7 calendar days.
  const today = startOfDay(new Date());
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY;
    return {
      label: new Date(day).toLocaleDateString("en-US", { weekday: "short" }),
      sessions: 0,
    };
  });
  const dayKeys = new Set<number>();
  for (const a of completed) {
    if (!a.submitted_at) continue;
    const d = startOfDay(new Date(a.submitted_at));
    dayKeys.add(d);
    const idx = 6 - Math.round((today - d) / DAY);
    if (idx >= 0 && idx < 7) weekly[idx].sessions += 1;
  }
  const weeklySessions = weekly.reduce((s, w) => s + w.sessions, 0);

  // Streak — consecutive active days ending today or yesterday.
  let streak = 0;
  let cursor = dayKeys.has(today) ? today : dayKeys.has(today - DAY) ? today - DAY : null;
  while (cursor != null && dayKeys.has(cursor)) {
    streak += 1;
    cursor -= DAY;
  }

  // Practice distribution by section (real signal; no fabricated section scores).
  let math = 0;
  let rw = 0;
  let other = 0;
  for (const a of completed) {
    const subj = a.practice_test_details?.subject;
    if (platformSubjectIsMath(subj)) math += 1;
    else if (platformSubjectIsReadingWriting(subj)) rw += 1;
    else other += 1;
  }
  const sectionMix = [
    { name: "Reading & Writing", value: rw, color: "var(--chart-2)" },
    { name: "Math", value: math, color: "var(--chart-3)" },
    ...(other > 0 ? [{ name: "Mixed", value: other, color: "var(--chart-1)" }] : []),
  ];

  // Recent activity.
  const recent: RecentItem[] = completed
    .filter((a) => a.submitted_at)
    .sort((a, b) => new Date(b.submitted_at!).getTime() - new Date(a.submitted_at!).getTime())
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      title: a.practice_test_details?.title || "Practice test",
      meta: a.score != null ? `Score ${a.score}` : "Completed",
      time: timeAgo(a.submitted_at!),
      isMath: platformSubjectIsMath(a.practice_test_details?.subject),
    }));

  // Upcoming assignments (real; growth-framed — no "overdue").
  const upcoming: UpcomingItem[] = assignments
    .filter((a) => a.due_at && isOutstanding(a.workflow_status))
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())
    .slice(0, 5)
    .map((a) => {
      const d = daysUntil(a.due_at);
      const soon = d != null && d <= 3;
      const behind = d != null && d < 0;
      const dueLabel =
        d == null
          ? ""
          : behind
            ? "Catch up"
            : d === 0
              ? "Due today"
              : d === 1
                ? "Due tomorrow"
                : `Due in ${d} days`;
      return {
        id: a.id,
        title: a.title || "Assignment",
        href: a.classroom_id
          ? `/classes/${a.classroom_id}/assignments/${a.id}`
          : "/assessments",
        dueLabel,
        soon: soon || behind,
        meta: [sizeLabel(a), (a.classroom_name || "").trim()].filter(Boolean).join(" · "),
        behind,
      };
    });

  // Milestones.
  const milestones: MilestoneItem[] = [
    { id: "first-mock", label: "First timed mock", done: !!me.last_mock_result },
    { id: "five", label: "5 sets completed", done: completed.length >= 5 },
    { id: "streak", label: "7-day streak", done: streak >= 7 },
    { id: "goal", label: "Reached your goal", done: goalReached },
  ];

  // Focus areas — derived from real signals, encouraging tone.
  const focusAreas: ActionItem[] = [];
  if (resume) {
    focusAreas.push({ id: "resume", title: "Finish your in-progress set", detail: "Pick up right where you left off.", href: `/exam/${resume.id}` });
  }
  if (rw < math) {
    focusAreas.push({ id: "rw", title: "Reading & Writing", detail: "A little less time here lately — a good place to grow.", href: "/practice-tests" });
  } else if (math < rw) {
    focusAreas.push({ id: "math", title: "Math", detail: "Room to build momentum — try a focused set.", href: "/practice-tests" });
  }
  const lastMockAt = me.last_mock_result?.completed_at;
  const mockStale = !lastMockAt || (daysUntil(lastMockAt) ?? -999) < -14;
  if (mockStale) {
    focusAreas.push({ id: "mock", title: "Refresh your projection", detail: "A timed mock keeps your prediction sharp.", href: "/mock-exam" });
  }
  if (focusAreas.length < 3 && target == null) {
    focusAreas.push({ id: "goal", title: "Set a goal score", detail: "Unlock tailored recommendations.", href: "/profile" });
  }

  // Next best actions.
  const nextActions: ActionItem[] = [];
  if (resume) nextActions.push({ id: "resume", title: "Resume test", detail: resume.practice_test_details?.title || "In progress", href: `/exam/${resume.id}` });
  nextActions.push({ id: "mock", title: "Take a timed mock", detail: "Full-length, test-day conditions", href: "/mock-exam" });
  nextActions.push({ id: "practice", title: "Practice a section", detail: "Untimed, build accuracy", href: "/practice-tests" });

  return {
    firstName,
    current,
    predicted,
    target,
    englishTarget,
    mathTarget,
    gap,
    goalReached,
    readiness,
    readinessVsTarget,
    examDate: me.sat_exam_date ?? null,
    examDaysLeft: daysUntil(me.sat_exam_date),
    // Defensive client-side guard so past dates never reach the picker even if
    // the API returns them; the backend already filters to upcoming dates.
    examDateOptions: examDateOptions
      .filter((o) => examDayStart(o.exam_date) >= startOfDay(new Date()))
      .sort((a, b) => examDayStart(a.exam_date) - examDayStart(b.exam_date)),
    totalCompleted: completed.length,
    classCount,
    streak,
    weeklySessions,
    weeklyGoal: WEEKLY_GOAL,
    resumeAttemptId: resume?.id ?? null,
    scoreSeries,
    weekly,
    sectionMix,
    milestones,
    focusAreas: focusAreas.slice(0, 3),
    nextActions: nextActions.slice(0, 3),
    recent,
    upcoming,
  };
}

export type DashboardData = {
  status: DashboardStatus;
  model: DashboardModel | null;
  me: UserMe | null;
  /** Persist section targets; the total is stored as their sum. */
  saveGoal: (english: number, math: number) => Promise<void>;
  savingGoal: boolean;
  /** Persist the student's chosen SAT date (or clear it with null). */
  saveExamDate: (date: string | null) => Promise<void>;
  savingExamDate: boolean;
  refresh: () => void;
};

export function useDashboardData(): DashboardData {
  const { bootState, me: sessionMe } = useMe();
  const [me, setMe] = useState<UserMe | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [classCount, setClassCount] = useState(0);
  const [assignments, setAssignments] = useState<AssignmentLite[]>([]);
  const [examDateOptions, setExamDateOptions] = useState<ExamDateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
  const [savingExamDate, setSavingExamDate] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (bootState !== "AUTHENTICATED" || !sessionMe) {
      setLoading(false);
      setMe(null);
      return;
    }
    setMe(sessionMe as UserMe);
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [attemptsRes, classesRes, assignmentsRes, examDatesRes] = await Promise.all([
        examsStudentApi.getAttempts().catch(() => emptyNormalizedExamList<Attempt>()),
        classesApi.list().catch(() => emptyNormalizedList()),
        classesApi.myAssignments().catch(() => ({ count: 0, items: [] as AssignmentLite[] })),
        usersApi.listExamDates().catch(() => [] as ExamDateOption[]),
      ]);
      if (cancelled) return;
      setAttempts((attemptsRes.items ?? []) as Attempt[]);
      setClassCount(classesRes.items.length);
      setAssignments((assignmentsRes.items ?? []) as AssignmentLite[]);
      setExamDateOptions(Array.isArray(examDatesRes) ? (examDatesRes as ExamDateOption[]) : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootState, sessionMe, nonce]);

  const saveGoal = useCallback(
    async (english: number, math: number) => {
      if (me?.id == null) return;
      setSavingGoal(true);
      try {
        const updated = await usersApi.patchMe({
          target_score: english + math,
          target_english: english,
          target_math: math,
        });
        setMe((prev) => (prev ? { ...prev, ...updated } : prev));
      } finally {
        setSavingGoal(false);
      }
    },
    [me?.id],
  );

  const saveExamDate = useCallback(
    async (date: string | null) => {
      if (me?.id == null) return;
      setSavingExamDate(true);
      try {
        const updated = await usersApi.patchMe({ sat_exam_date: date });
        setMe((prev) => (prev ? { ...prev, ...updated } : prev));
      } finally {
        setSavingExamDate(false);
      }
    },
    [me?.id],
  );

  const status: DashboardStatus =
    bootState === "BOOTING" || (bootState === "AUTHENTICATED" && loading)
      ? "booting"
      : bootState !== "AUTHENTICATED"
        ? "unauthenticated"
        : "ready";

  const model = useMemo(
    () =>
      status === "ready" && me
        ? buildModel(me, attempts, classCount, assignments, examDateOptions)
        : null,
    [status, me, attempts, classCount, assignments, examDateOptions],
  );

  return {
    status,
    model,
    me,
    saveGoal,
    savingGoal,
    saveExamDate,
    savingExamDate,
    refresh: () => setNonce((n) => n + 1),
  };
}
