"use client";

/**
 * Teacher dashboard data — aggregates real data across the teacher's classes
 * via classesApi.getInterventions + getLeaderboard. No fabricated metrics;
 * class-level SAT strand performance is not available (honest empty state).
 */

import { useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";

type InterventionStudent = { student_id: number; first_name?: string; last_name?: string; email?: string };
type Interventions = {
  overdue_students: (InterventionStudent & { overdue_count: number; oldest_overdue_due_at?: string | null })[];
  inactive_students: (InterventionStudent & { days_inactive?: number | null })[];
  low_score_students: (InterventionStudent & { avg_score_pct: number })[];
  completion_summary: { assignment_id: number; title: string; due_at?: string | null; is_overdue?: boolean; submitted_count: number; student_count: number; completion_pct: number }[];
  class_stats: { student_count: number; assignment_count: number; overall_completion_pct: number; avg_assessment_score_pct: number | null };
};
type LeaderboardSummary = { assignment_id: number; title: string; created_at?: string | null; group_mean_score: number | null }[];

export type AttentionItem = { id: string; name: string; reason: string; tone: "warning" | "danger" };
export type MissingItem = { id: string; title: string; className: string; completion: number };
export type UpcomingItem = { id: string; title: string; className: string; dueLabel: string; soon: boolean };
export type ClassHealth = { id: number; name: string; students: number; avgScore: number | null; completion: number };

export type TeacherDashboardModel = {
  classCount: number;
  totalStudents: number;
  activeStudents: number;
  avgScore: number | null;
  submissionRate: number | null;
  classAvgTrend: { label: string; score: number }[];
  completionByAssignment: { label: string; completion: number }[];
  needsAttention: AttentionItem[];
  missing: MissingItem[];
  upcoming: UpcomingItem[];
  classes: ClassHealth[];
  hasStrandData: boolean;
};

const DAY = 86400000;
function shortDate(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; }
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null; const t = new Date(iso).getTime(); return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / DAY);
}
function fullName(s: InterventionStudent) { return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email || "Student"; }

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type TeacherDashboardData = { status: "booting" | "unauthenticated" | "empty" | "ready"; model: TeacherDashboardModel | null };

export function useTeacherDashboard(previewModel?: TeacherDashboardModel): TeacherDashboardData {
  const { bootState } = useMe();
  const [model, setModel] = useState<TeacherDashboardModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (previewModel) { setModel(previewModel); setLoading(false); return; }
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
          classesApi.getInterventions(c.id).catch(() => null) as Promise<Interventions | null>,
          classesApi.getLeaderboard(c.id).catch(() => null) as Promise<{ assignments_summary?: LeaderboardSummary } | null>,
        ]);
        return { c, iv, lb };
      });
      if (cancelled) return;

      let totalStudents = 0, inactiveTotal = 0;
      const avgList: number[] = [], compList: number[] = [];
      const needsAttention: AttentionItem[] = [];
      const seenAttention = new Set<string>();
      const missing: MissingItem[] = [];
      const upcoming: UpcomingItem[] = [];
      const trendPts: { ms: number; label: string; score: number }[] = [];
      const completionPts: { label: string; completion: number }[] = [];
      const classes: ClassHealth[] = [];

      for (const { c, iv, lb } of perClass) {
        const cname = c.name || "Class";
        if (iv?.class_stats) {
          totalStudents += iv.class_stats.student_count || 0;
          if (typeof iv.class_stats.avg_assessment_score_pct === "number") avgList.push(iv.class_stats.avg_assessment_score_pct);
          compList.push(iv.class_stats.overall_completion_pct ?? 0);
          classes.push({ id: c.id, name: cname, students: iv.class_stats.student_count || 0, avgScore: iv.class_stats.avg_assessment_score_pct, completion: iv.class_stats.overall_completion_pct ?? 0 });
        }
        inactiveTotal += iv?.inactive_students?.length ?? 0;

        (iv?.low_score_students ?? []).forEach((s) => {
          const key = `${c.id}-${s.student_id}`;
          if (seenAttention.has(key)) return; seenAttention.add(key);
          needsAttention.push({ id: key, name: fullName(s), reason: `Average ${s.avg_score_pct}% · ${cname}`, tone: "danger" });
        });
        (iv?.overdue_students ?? []).forEach((s) => {
          const key = `${c.id}-${s.student_id}`;
          if (seenAttention.has(key)) return; seenAttention.add(key);
          needsAttention.push({ id: key, name: fullName(s), reason: `${s.overdue_count} missing · ${cname}`, tone: "warning" });
        });

        (iv?.completion_summary ?? []).forEach((a) => {
          if (a.completion_pct < 70) missing.push({ id: `${c.id}-${a.assignment_id}`, title: a.title, className: cname, completion: a.completion_pct });
          const d = daysUntil(a.due_at);
          if (d != null && d >= 0) upcoming.push({ id: `u-${c.id}-${a.assignment_id}`, title: a.title, className: cname, dueLabel: d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d}d`, soon: d <= 3 });
          completionPts.push({ label: a.title.slice(0, 12), completion: a.completion_pct });
        });

        (lb?.assignments_summary ?? []).forEach((a) => {
          if (typeof a.group_mean_score === "number" && a.created_at) trendPts.push({ ms: new Date(a.created_at).getTime(), label: shortDate(a.created_at), score: a.group_mean_score });
        });
      }

      const built: TeacherDashboardModel = {
        classCount: managed.length,
        totalStudents,
        activeStudents: Math.max(0, totalStudents - inactiveTotal),
        avgScore: avgList.length ? Math.round(avgList.reduce((a, b) => a + b, 0) / avgList.length) : null,
        submissionRate: compList.length ? Math.round(compList.reduce((a, b) => a + b, 0) / compList.length) : null,
        classAvgTrend: trendPts.sort((a, b) => a.ms - b.ms).slice(-10).map((p) => ({ label: p.label, score: p.score })),
        completionByAssignment: completionPts.slice(0, 8),
        needsAttention: needsAttention.sort((a) => (a.tone === "danger" ? -1 : 1)).slice(0, 8),
        missing: missing.sort((a, b) => a.completion - b.completion).slice(0, 6),
        upcoming: upcoming.sort((a, b) => (a.soon === b.soon ? 0 : a.soon ? -1 : 1)).slice(0, 5),
        classes: classes.sort((a, b) => (a.avgScore ?? 999) - (b.avgScore ?? 999)),
        hasStrandData: false,
      };
      setModel(built);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bootState, previewModel]);

  const status = useMemo<TeacherDashboardData["status"]>(() => {
    if (previewModel) return "ready";
    if (bootState === "BOOTING" || (bootState === "AUTHENTICATED" && loading)) return "booting";
    if (bootState !== "AUTHENTICATED") return "unauthenticated";
    if (empty) return "empty";
    return "ready";
  }, [bootState, loading, empty, previewModel]);

  return { status, model };
}
