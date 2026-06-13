"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { studentNav } from "@/components/shell/navConfig";
import { StudentAnalytics } from "@/features/analytics/StudentAnalytics";
import type { AnalyticsModel } from "@/features/analytics/useAnalyticsData";

const SAMPLE: AnalyticsModel = {
  current: 1480, best: 1500, average: 1410, predicted: 1520, target: 1500,
  gap: 20, goalReached: false, readiness: 99, readinessVsTarget: true, totalAttempts: 18,
  scoreSeries: [
    { label: "Mar 3", score: 1280 }, { label: "Mar 20", score: 1320 }, { label: "Apr 8", score: 1360 },
    { label: "Apr 26", score: 1390 }, { label: "May 15", score: 1440 }, { label: "Jun 2", score: 1480 },
  ],
  attemptRows: [
    { id: 1, title: "Algebra — Linear functions", subject: "Math", score: 1480, dateLabel: "Jun 2" },
    { id: 2, title: "Craft & Structure set", subject: "Reading & Writing", score: 1450, dateLabel: "May 28" },
    { id: 3, title: "Problem-solving & Data", subject: "Math", score: 1430, dateLabel: "May 15" },
    { id: 4, title: "Full mock 3", subject: "Mixed", score: 1440, dateLabel: "May 2" },
  ],
  trendDelta: 200,
  subjects: [
    { key: "math", label: "Math", attempts: 11, scoreDelta: 120, accuracy: 84, timeMinutes: 142 },
    { key: "rw", label: "Reading & Writing", attempts: 7, scoreDelta: 80, accuracy: 78, timeMinutes: 96 },
  ],
  strands: [
    { strand: "Algebra › Linear functions", subject: "math", accuracy: 88, total: 40 },
    { strand: "Advanced Math › Nonlinear functions", subject: "math", accuracy: 67, total: 24 },
    { strand: "Problem-Solving › Percentages", subject: "math", accuracy: 74, total: 19 },
    { strand: "Geometry › Right triangles", subject: "math", accuracy: 79, total: 14 },
    { strand: "Craft and Structure › Words in Context", subject: "english", accuracy: 86, total: 22 },
    { strand: "Information and Ideas › Inferences", subject: "english", accuracy: 71, total: 18 },
  ],
  weakestStrands: [
    { strand: "Advanced Math › Nonlinear functions", subject: "math", accuracy: 67, total: 24 },
    { strand: "Information and Ideas › Inferences", subject: "english", accuracy: 71, total: 18 },
    { strand: "Problem-Solving › Percentages", subject: "math", accuracy: 74, total: 19 },
  ],
  toughestQuestions: [
    { id: "a", label: "Math · Q14", subject: "Math", seconds: 142 },
    { id: "b", label: "Reading & Writing · Q9", subject: "Reading & Writing", seconds: 118 },
    { id: "c", label: "Math · Q21", subject: "Math", seconds: 104 },
    { id: "d", label: "Math · Q7", subject: "Math", seconds: 96 },
    { id: "e", label: "Reading & Writing · Q18", subject: "Reading & Writing", seconds: 88 },
  ],
  missedBySubject: [
    { label: "Math", missed: 31, total: 198 },
    { label: "Reading & Writing", missed: 28, total: 128 },
  ],
  recommendations: [
    { id: "strand", title: "Review Nonlinear functions", detail: "Your lowest strand at 67% accuracy.", href: "/assessments" },
    { id: "subject", title: "Strengthen Reading & Writing", detail: "78% accuracy across recent sets.", href: "/practice-tests" },
    { id: "mock", title: "Take a timed mock", detail: "Refresh your predicted score under test conditions.", href: "/mock-exam" },
  ],
  weeklyImprovement: 18, estWeeksToGoal: 2, weeklySessions: 6, weeklyGoal: 5, examDaysLeft: 34,
};

export default function AnalyticsPreviewPage() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Learning OS" }} nav={studentNav} pathname={pathname === "/ui-catalog/analytics" ? "/analytics" : pathname} user={{ name: "Ada Lovelace" }} onSignOut={() => {}}>
      <StudentAnalytics previewModel={SAMPLE} />
    </AppShell>
  );
}
