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

type AssignmentLite = {
  id: number;
  title?: string;
  due_at?: string | null;
  practice_scope?: string;
  classroom?: number | null;
};

export type DashboardStatus = "booting" | "unauthenticated" | "ready";

export type MilestoneItem = { id: string; label: string; done: boolean };
export type ActionItem = { id: string; title: string; detail: string; href: string };
export type RecentItem = { id: number; title: string; meta: string; time: string; isMath: boolean };
export type UpcomingItem = { id: number; title: string; href: string; dueLabel: string; soon: boolean };

export type DashboardModel = {
  firstName: string;
  /** Most recent full mock score (scaled total). */
  current: number | null;
  /** Forward projection from recent scored attempts (estimate). */
  predicted: number | null;
  target: number | null;
  /** Points remaining to target (0 when reached). */
  gap: number | null;
  goalReached: boolean;
  /** 0–100, progress toward target (or toward 1600 if no target). */
  readiness: number | null;
  readinessVsTarget: boolean;
  examDate: string | null;
  examDaysLeft: number | null;
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

function buildModel(
  me: UserMe,
  attempts: Attempt[],
  classCount: number,
  assignments: AssignmentLite[],
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
    .filter((a) => a.due_at)
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())
    .slice(0, 4)
    .map((a) => {
      const d = daysUntil(a.due_at);
      const soon = d != null && d <= 3;
      const dueLabel =
        d == null
          ? ""
          : d < 0
            ? "Needs attention"
            : d === 0
              ? "Due today"
              : d === 1
                ? "Due tomorrow"
                : `Due in ${d} days`;
      return {
        id: a.id,
        title: a.title || "Assignment",
        href: a.classroom ? `/classes/${a.classroom}/assignments/${a.id}` : "/assessments",
        dueLabel,
        soon: soon || (d != null && d < 0),
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
    gap,
    goalReached,
    readiness,
    readinessVsTarget,
    examDate: me.sat_exam_date ?? null,
    examDaysLeft: daysUntil(me.sat_exam_date),
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
  saveGoal: (total: number) => Promise<void>;
  savingGoal: boolean;
  refresh: () => void;
};

export function useDashboardData(): DashboardData {
  const { bootState, me: sessionMe } = useMe();
  const [me, setMe] = useState<UserMe | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [classCount, setClassCount] = useState(0);
  const [assignments, setAssignments] = useState<AssignmentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
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
      const [attemptsRes, classesRes, assignmentsRes] = await Promise.all([
        examsStudentApi.getAttempts().catch(() => emptyNormalizedExamList<Attempt>()),
        classesApi.list().catch(() => emptyNormalizedList()),
        classesApi.myAssignments().catch(() => ({ count: 0, items: [] as AssignmentLite[] })),
      ]);
      if (cancelled) return;
      setAttempts((attemptsRes.items ?? []) as Attempt[]);
      setClassCount(classesRes.items.length);
      setAssignments((assignmentsRes.items ?? []) as AssignmentLite[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootState, sessionMe, nonce]);

  const saveGoal = useCallback(
    async (total: number) => {
      if (me?.id == null) return;
      setSavingGoal(true);
      try {
        const updated = await usersApi.patchMe({ target_score: total });
        setMe((prev) => (prev ? { ...prev, ...updated } : prev));
      } finally {
        setSavingGoal(false);
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
    () => (status === "ready" && me ? buildModel(me, attempts, classCount, assignments) : null),
    [status, me, attempts, classCount, assignments],
  );

  return {
    status,
    model,
    me,
    saveGoal,
    savingGoal,
    refresh: () => setNonce((n) => n + 1),
  };
}
