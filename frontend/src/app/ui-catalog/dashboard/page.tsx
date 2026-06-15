"use client";

/**
 * /ui-catalog/dashboard — design review of the real StudentDashboard with a
 * representative model (no auth/backend needed). Not part of the student IA.
 */

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { studentNav } from "@/components/shell/navConfig";
import { StudentDashboard } from "@/features/dashboard/StudentDashboard";
import type { DashboardModel } from "@/features/dashboard/useDashboardData";

const SAMPLE: DashboardModel = {
  firstName: "Ada",
  current: 1480,
  predicted: 1520,
  target: 1500,
  gap: 20,
  goalReached: false,
  readiness: 99,
  readinessVsTarget: true,
  examDate: "2026-07-17",
  examDaysLeft: 34,
  totalCompleted: 18,
  classCount: 2,
  streak: 12,
  weeklySessions: 6,
  weeklyGoal: 5,
  resumeAttemptId: 42,
  scoreSeries: [
    { label: "Mar 3", score: 1280 },
    { label: "Mar 20", score: 1320 },
    { label: "Apr 8", score: 1360 },
    { label: "Apr 26", score: 1390 },
    { label: "May 15", score: 1430 },
    { label: "Jun 2", score: 1480 },
  ],
  weekly: [
    { label: "Mon", sessions: 1 },
    { label: "Tue", sessions: 2 },
    { label: "Wed", sessions: 0 },
    { label: "Thu", sessions: 1 },
    { label: "Fri", sessions: 2 },
    { label: "Sat", sessions: 0 },
    { label: "Sun", sessions: 0 },
  ],
  sectionMix: [
    { name: "Reading & Writing", value: 9, color: "var(--chart-2)" },
    { name: "Math", value: 7, color: "var(--chart-3)" },
    { name: "Mixed", value: 2, color: "var(--chart-1)" },
  ],
  milestones: [
    { id: "first-mock", label: "First timed mock", done: true },
    { id: "five", label: "5 sets completed", done: true },
    { id: "streak", label: "7-day streak", done: true },
    { id: "goal", label: "Reached your goal", done: false },
  ],
  focusAreas: [
    { id: "math", title: "Math", detail: "Room to build momentum — try a focused set.", href: "/practice-tests" },
    { id: "mock", title: "Refresh your projection", detail: "A timed mock keeps your prediction sharp.", href: "/mock-exam" },
  ],
  nextActions: [
    { id: "resume", title: "Resume test", detail: "Reading & Writing · Module 2", href: "/exam/42" },
    { id: "mock", title: "Take a timed mock", detail: "Full-length, test-day conditions", href: "/mock-exam" },
    { id: "practice", title: "Practice a section", detail: "Untimed, build accuracy", href: "/practice-tests" },
  ],
  recent: [
    { id: 1, title: "Algebra — Linear functions", meta: "Score 1480", time: "2h ago", isMath: true },
    { id: 2, title: "Craft & Structure set", meta: "Score 1450", time: "1d ago", isMath: false },
    { id: 3, title: "Problem-solving & Data", meta: "Completed", time: "3d ago", isMath: true },
  ],
  upcoming: [
    { id: 1, title: "Reading & Writing — Homework 4", href: "/assessments", dueLabel: "Due tomorrow", soon: true },
    { id: 2, title: "Math practice set 7", href: "/assessments", dueLabel: "Due in 5 days", soon: false },
  ],
};

export default function DashboardPreviewPage() {
  const pathname = usePathname();
  return (
    <AppShell
      brand={{ name: "MasterSAT", tagline: "Learning OS" }}
      nav={studentNav}
      pathname={pathname === "/ui-catalog/dashboard" ? "/" : pathname}
      user={{ name: "Ada Lovelace" }}
      onSignOut={() => {}}
    >
      <StudentDashboard previewModel={SAMPLE} />
    </AppShell>
  );
}
