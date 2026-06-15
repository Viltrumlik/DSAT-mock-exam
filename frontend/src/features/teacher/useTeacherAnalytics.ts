"use client";

/**
 * Shared teacher analytics model — the single source consumed by Teacher
 * Analytics (9A), Students (9B), and Homework (9C). Real data only via
 * classesApi.getInterventions + getLeaderboard across the teacher's classes.
 *
 * Honest constraints: per-student SAT score *trend* is not available (no
 * per-student series), so improvement is tracked at class level. Class-level
 * SAT strand data is unavailable (handled with empty states by consumers).
 */

import { useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";

export type RiskLevel = "at-risk" | "watch" | "on-track";

export type StudentRecord = {
  id: number;
  name: string;
  classId: number;
  className: string;
  reviewAvg: number | null; // mean teacher grade (0–100)
  completionPct: number | null; // homework turn-in rate
  practiceAverage: number | null; // SAT practice score average (as-is)
  assessmentLow: number | null; // assessment avg when flagged <60
  inactiveDays: number | null;
  overdueCount: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
};

export type ClassSummary = {
  id: number;
  name: string;
  students: number;
  reviewAvg: number | null;
  completion: number;
  atRisk: number;
};

export type AssignmentRecord = {
  id: number;
  title: string;
  classId: number;
  className: string;
  completionPct: number;
  submitted: number;
  total: number;
  isAssessment: boolean;
  isOverdue: boolean;
  groupMean: number | null;
  createdMs: number | null;
  effectiveness: "healthy" | "low-completion" | "challenging";
};

export type TeacherAnalyticsModel = {
  classCount: number;
  totalStudents: number;
  atRiskCount: number;
  watchCount: number;
  classes: ClassSummary[];
  students: StudentRecord[];
  assignments: AssignmentRecord[];
  classAvgTrend: { label: string; score: number }[];
  recommendations: { id: string; title: string; detail: string; href: string }[];
};

type AnyRow = Record<string, unknown>;
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const sid = (r: AnyRow): number | null => num(r.user_id ?? r.id ?? r.student_id);
function nameOf(r: AnyRow): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || (r.email as string) || "Student";
}
function shortDate(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; }

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function computeRisk(s: Omit<StudentRecord, "riskLevel" | "riskReasons">): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let atRisk = false, watch = false;
  if (s.assessmentLow != null) { reasons.push(`Average ${s.assessmentLow}%`); atRisk = true; }
  if (s.inactiveDays != null && s.inactiveDays >= 14) { reasons.push(`Inactive ${s.inactiveDays}d`); atRisk = true; }
  else if (s.inactiveDays != null && s.inactiveDays >= 7) { reasons.push(`Inactive ${s.inactiveDays}d`); watch = true; }
  if (s.overdueCount >= 2) { reasons.push(`${s.overdueCount} missing`); atRisk = true; }
  else if (s.overdueCount === 1) { reasons.push("1 missing"); watch = true; }
  if (s.reviewAvg != null && s.reviewAvg < 60) { reasons.push(`Grade avg ${s.reviewAvg}%`); atRisk = true; }
  else if (s.reviewAvg != null && s.reviewAvg < 70) { reasons.push(`Grade avg ${s.reviewAvg}%`); watch = true; }
  if (s.completionPct != null && s.completionPct < 40) { reasons.push(`${s.completionPct}% turned in`); watch = true; }
  return { level: atRisk ? "at-risk" : watch ? "watch" : "on-track", reasons };
}

export type TeacherAnalyticsData = { status: "booting" | "unauthenticated" | "empty" | "ready"; model: TeacherAnalyticsModel | null };

export function useTeacherAnalytics(previewModel?: TeacherAnalyticsModel): TeacherAnalyticsData {
  const { bootState } = useMe();
  const [model, setModel] = useState<TeacherAnalyticsModel | null>(previewModel ?? null);
  const [loading, setLoading] = useState(!previewModel);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (previewModel) return;
    if (bootState !== "AUTHENTICATED") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const classesRes = await classesApi.list().catch(() => ({ items: [] as Array<{ id: number; name?: string; my_role?: string }> }));
      const managed = (classesRes.items as Array<{ id: number; name?: string; my_role?: string }>).filter((c) => c.my_role && c.my_role !== "student");
      if (cancelled) return;
      if (managed.length === 0) { setEmpty(true); setLoading(false); return; }

      const perClass = await mapWithConcurrency(managed, 4, async (c) => {
        const [iv, lb] = await Promise.all([
          classesApi.getInterventions(c.id).catch(() => null) as Promise<AnyRow | null>,
          classesApi.getLeaderboard(c.id).catch(() => null) as Promise<AnyRow | null>,
        ]);
        return { c, iv, lb };
      });
      if (cancelled) return;

      const students: StudentRecord[] = [];
      const classes: ClassSummary[] = [];
      const assignments: AssignmentRecord[] = [];
      const trendPts: { ms: number; label: string; score: number }[] = [];

      for (const { c, iv, lb } of perClass) {
        const cname = c.name || "Class";
        const lowMap = new Map<number, number>();
        const inactiveMap = new Map<number, number>();
        const overdueMap = new Map<number, number>();
        (iv?.low_score_students as AnyRow[] | undefined)?.forEach((r) => { const id = sid(r); if (id != null) lowMap.set(id, num(r.avg_score_pct) ?? 0); });
        (iv?.inactive_students as AnyRow[] | undefined)?.forEach((r) => { const id = sid(r); if (id != null) inactiveMap.set(id, num(r.days_inactive) ?? 0); });
        (iv?.overdue_students as AnyRow[] | undefined)?.forEach((r) => { const id = sid(r); if (id != null) overdueMap.set(id, num(r.overdue_count) ?? 0); });

        const hwLb = lb?.homework_grade_leaderboard as AnyRow | undefined;
        const hwRows = (hwLb?.students as AnyRow[] | undefined) ?? [];
        const hwById = new Map<number, AnyRow>();
        hwRows.forEach((r) => { const id = sid(r); if (id != null) hwById.set(id, r); });

        const practiceRows = (lb?.students as AnyRow[] | undefined) ?? [];
        // Roster: prefer leaderboard practice rows (enumerate all students); fall back to homework rows.
        const roster = practiceRows.length ? practiceRows : hwRows;
        let classAtRisk = 0;
        roster.forEach((r) => {
          const id = sid(r);
          if (id == null) return;
          const hw = hwById.get(id) ?? {};
          const base = {
            id, name: nameOf(r), classId: c.id, className: cname,
            reviewAvg: num(hw.average_review_grade),
            completionPct: num(hw.homework_completion_rate_pct),
            practiceAverage: num(r.practice_average),
            assessmentLow: lowMap.has(id) ? lowMap.get(id)! : null,
            inactiveDays: inactiveMap.has(id) ? inactiveMap.get(id)! : null,
            overdueCount: overdueMap.get(id) ?? 0,
          };
          const { level, reasons } = computeRisk(base);
          if (level === "at-risk") classAtRisk += 1;
          students.push({ ...base, riskLevel: level, riskReasons: reasons });
        });

        classes.push({
          id: c.id, name: cname,
          students: num((iv?.class_stats as AnyRow | undefined)?.student_count) ?? roster.length,
          reviewAvg: num(hwLb?.class_average_review_grade) ?? num((iv?.class_stats as AnyRow | undefined)?.avg_assessment_score_pct),
          completion: num((iv?.class_stats as AnyRow | undefined)?.overall_completion_pct) ?? 0,
          atRisk: classAtRisk,
        });

        const summary = (lb?.assignments_summary as AnyRow[] | undefined) ?? [];
        const summaryByTitle = new Map<string, AnyRow>();
        summary.forEach((a) => { summaryByTitle.set(String(a.title), a); if (num(a.group_mean_score) != null && a.created_at) trendPts.push({ ms: new Date(String(a.created_at)).getTime(), label: shortDate(String(a.created_at)), score: num(a.group_mean_score)! }); });

        (iv?.completion_summary as AnyRow[] | undefined)?.forEach((a) => {
          const completion = num(a.completion_pct) ?? 0;
          const groupMean = num(summaryByTitle.get(String(a.title))?.group_mean_score);
          const challenging = groupMean != null && groupMean < (num(lb?.class_practice_average) ?? Infinity);
          assignments.push({
            id: num(a.assignment_id) ?? 0,
            title: String(a.title ?? "Assignment"),
            classId: c.id, className: cname,
            completionPct: completion,
            submitted: num(a.submitted_count) ?? 0,
            total: num(a.student_count) ?? 0,
            isAssessment: !!a.is_assessment,
            isOverdue: !!a.is_overdue,
            groupMean,
            createdMs: a.due_at ? new Date(String(a.due_at)).getTime() : null,
            effectiveness: completion < 50 ? "low-completion" : challenging ? "challenging" : "healthy",
          });
        });
      }

      const atRiskCount = students.filter((s) => s.riskLevel === "at-risk").length;
      const watchCount = students.filter((s) => s.riskLevel === "watch").length;

      const recommendations: { id: string; title: string; detail: string; href: string }[] = [];
      if (atRiskCount > 0) recommendations.push({ id: "atrisk", title: `Check in with ${atRiskCount} at-risk ${atRiskCount === 1 ? "student" : "students"}`, detail: "Low averages, missing work, or inactivity.", href: "/teacher/students" });
      const worstAssignment = [...assignments].sort((a, b) => a.completionPct - b.completionPct)[0];
      if (worstAssignment && worstAssignment.completionPct < 60) recommendations.push({ id: "completion", title: `Boost completion on “${worstAssignment.title}”`, detail: `${worstAssignment.completionPct}% turned in · ${worstAssignment.className}`, href: "/teacher/homework" });
      const challenging = assignments.find((a) => a.effectiveness === "challenging");
      if (challenging) recommendations.push({ id: "review", title: `Review “${challenging.title}” as a class`, detail: "Group mean below the class average.", href: "/teacher/gradebook" });
      const inactiveCount = students.filter((s) => s.inactiveDays != null && s.inactiveDays >= 7).length;
      if (inactiveCount > 0) recommendations.push({ id: "inactive", title: `Re-engage ${inactiveCount} inactive ${inactiveCount === 1 ? "student" : "students"}`, detail: "No activity in 7+ days.", href: "/teacher/students" });

      setModel({
        classCount: managed.length,
        totalStudents: classes.reduce((s, c) => s + c.students, 0),
        atRiskCount, watchCount,
        classes,
        students: students.sort((a, b) => (a.riskLevel === b.riskLevel ? 0 : a.riskLevel === "at-risk" ? -1 : b.riskLevel === "at-risk" ? 1 : a.riskLevel === "watch" ? -1 : 1)),
        assignments,
        classAvgTrend: trendPts.sort((a, b) => a.ms - b.ms).slice(-10).map((p) => ({ label: p.label, score: p.score })),
        recommendations: recommendations.slice(0, 4),
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bootState, previewModel]);

  const status = useMemo<TeacherAnalyticsData["status"]>(() => {
    if (previewModel) return "ready";
    if (bootState === "BOOTING" || (bootState === "AUTHENTICATED" && loading)) return "booting";
    if (bootState !== "AUTHENTICATED") return "unauthenticated";
    if (empty) return "empty";
    return "ready";
  }, [bootState, loading, empty, previewModel]);

  return { status, model };
}
