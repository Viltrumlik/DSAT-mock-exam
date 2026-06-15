"use client";

/**
 * Student Analytics data layer — real backend data only (see docs/ANALYTICS_DATA.md).
 * Two phases: (1) base metrics from getAttempts + me (instant); (2) deep analysis
 * fanned out over getReview (subject accuracy/time, weakness) and my-result
 * (SAT strand radar). Nothing is fabricated; sections guard on real data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { classesApi, emptyNormalizedExamList, usersApi, type UserMe } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import { useMe } from "@/hooks/useMe";
import { platformSubjectIsMath, platformSubjectIsReadingWriting } from "@/lib/permissions";

type Attempt = {
  id: number;
  submitted_at?: string | null;
  is_completed?: boolean;
  score?: number | null;
  practice_test_details?: { subject?: string; title?: string };
};

export type SubjectKey = "math" | "rw";
export type SubjectStat = {
  key: SubjectKey;
  label: string;
  attempts: number;
  scoreDelta: number | null;
  accuracy: number | null;
  timeMinutes: number | null;
};
export type StrandStat = { strand: string; subject: string | null; accuracy: number; total: number };
export type ToughQuestion = { id: string; label: string; subject: string; seconds: number };
export type Recommendation = { id: string; title: string; detail: string; href: string };

export type AnalyticsModel = {
  // Performance overview
  current: number | null;
  best: number | null;
  average: number | null;
  predicted: number | null;
  target: number | null;
  gap: number | null;
  goalReached: boolean;
  readiness: number | null;
  readinessVsTarget: boolean;
  totalAttempts: number;
  // Score history
  scoreSeries: { label: string; score: number }[];
  attemptRows: { id: number; title: string; subject: string; score: number | null; dateLabel: string }[];
  trendDelta: number | null;
  // Subject analysis
  subjects: SubjectStat[];
  // Skills
  strands: StrandStat[];
  weakestStrands: StrandStat[];
  // Weakness
  toughestQuestions: ToughQuestion[];
  missedBySubject: { label: string; missed: number; total: number }[];
  // Recommendations
  recommendations: Recommendation[];
  // Goal tracking
  weeklyImprovement: number | null;
  estWeeksToGoal: number | null;
  weeklySessions: number;
  weeklyGoal: number;
  examDaysLeft: number | null;
};

const WEEKLY_GOAL = 5;
const DAY = 86400000;
const REVIEW_FANOUT_CAP = 15;
const CONCURRENCY = 4;

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function shortDate(iso: string) { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / DAY);
}
function subjectLabel(raw?: string): string {
  if (platformSubjectIsMath(raw)) return "Math";
  if (platformSubjectIsReadingWriting(raw)) return "Reading & Writing";
  return "Mixed";
}
function subjectKey(raw?: string): SubjectKey | null {
  if (platformSubjectIsMath(raw)) return "math";
  if (platformSubjectIsReadingWriting(raw)) return "rw";
  return null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function projectScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const last = scores[scores.length - 1];
  if (scores.length < 2) return last;
  const deltas: number[] = [];
  for (let i = Math.max(1, scores.length - 3); i < scores.length; i++) deltas.push(scores[i] - scores[i - 1]);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return clamp(Math.round(last + avg), Math.min(...scores), 1600);
}

/** Linear slope of scores over time, in points per week. */
function weeklyImprovement(points: { score: number; ms: number }[]): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const weeks = (last.ms - first.ms) / (DAY * 7);
  if (weeks <= 0) return null;
  return (last.score - first.score) / weeks;
}

export type AnalyticsData = {
  status: "booting" | "unauthenticated" | "ready";
  analysisReady: boolean;
  model: AnalyticsModel | null;
};

export function useAnalyticsData(previewModel?: AnalyticsModel): AnalyticsData {
  const { bootState, me: sessionMe } = useMe();
  const [base, setBase] = useState<AnalyticsModel | null>(null);
  const [enriched, setEnriched] = useState<AnalyticsModel | null>(null);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const buildBase = useCallback((me: UserMe, attempts: Attempt[]): AnalyticsModel => {
    const completed = attempts.filter((a) => a.is_completed);
    const scoredSorted = completed
      .filter((a) => typeof a.score === "number" && a.submitted_at)
      .sort((a, b) => new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime());
    const scores = scoredSorted.map((a) => a.score as number);

    const current = me.last_mock_result?.score ?? (scores.length ? scores[scores.length - 1] : null);
    const best = scores.length ? Math.max(...scores) : null;
    const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const predicted = projectScore(scores);
    const target = me.target_score ?? null;
    const gap = target != null && current != null ? Math.max(0, target - current) : null;
    const goalReached = target != null && current != null && current >= target;
    const readinessVsTarget = target != null;
    const readiness = current == null ? null
      : readinessVsTarget ? clamp(Math.round((current / (target as number)) * 100), 0, 100)
      : clamp(Math.round((current / 1600) * 100), 0, 100);

    const scoreSeries = scoredSorted.slice(-12).map((a) => ({ label: shortDate(a.submitted_at!), score: a.score as number }));
    const trendDelta = scores.length >= 2 ? scores[scores.length - 1] - scores[0] : null;
    const attemptRows = [...scoredSorted].reverse().slice(0, 10).map((a) => ({
      id: a.id,
      title: a.practice_test_details?.title || "Practice set",
      subject: subjectLabel(a.practice_test_details?.subject),
      score: a.score ?? null,
      dateLabel: a.submitted_at ? shortDate(a.submitted_at) : "—",
    }));

    // Subject base (attempts + score delta); accuracy/time filled in phase 2.
    const subjects: SubjectStat[] = (["math", "rw"] as SubjectKey[]).map((key) => {
      const subjAttempts = scoredSorted.filter((a) => subjectKey(a.practice_test_details?.subject) === key);
      const s = subjAttempts.map((a) => a.score as number);
      return {
        key,
        label: key === "math" ? "Math" : "Reading & Writing",
        attempts: subjAttempts.length,
        scoreDelta: s.length >= 2 ? s[s.length - 1] - s[0] : null,
        accuracy: null,
        timeMinutes: null,
      };
    });

    // Goal / weekly
    const now = Date.now();
    const weeklySessions = completed.filter((a) => a.submitted_at && now - new Date(a.submitted_at).getTime() < 7 * DAY).length;
    const wImp = weeklyImprovement(scoredSorted.map((a) => ({ score: a.score as number, ms: new Date(a.submitted_at!).getTime() })));
    const estWeeksToGoal = gap != null && gap > 0 && wImp != null && wImp > 0 ? Math.ceil(gap / wImp) : null;

    return {
      current, best, average, predicted, target, gap, goalReached, readiness, readinessVsTarget,
      totalAttempts: completed.length,
      scoreSeries, attemptRows, trendDelta,
      subjects,
      strands: [], weakestStrands: [],
      toughestQuestions: [], missedBySubject: [],
      recommendations: [],
      weeklyImprovement: wImp != null ? Math.round(wImp) : null,
      estWeeksToGoal,
      weeklySessions, weeklyGoal: WEEKLY_GOAL,
      examDaysLeft: daysUntil(me.sat_exam_date),
    };
  }, []);

  // Phase 1 — base
  useEffect(() => {
    if (previewModel) { setBase(previewModel); setEnriched(previewModel); setAnalysisReady(true); setLoading(false); return; }
    if (bootState !== "AUTHENTICATED" || !sessionMe) { setLoading(false); setBase(null); return; }
    let cancelled = false;
    setLoading(true);
    setAnalysisReady(false);
    (async () => {
      const attemptsRes = await examsStudentApi.getAttempts().catch(() => emptyNormalizedExamList<Attempt>());
      if (cancelled) return;
      const attempts = (attemptsRes.items ?? []) as Attempt[];
      const me = sessionMe as UserMe;
      const baseModel = buildBase(me, attempts);
      setBase(baseModel);
      setEnriched(baseModel);
      setLoading(false);
      void runDeepAnalysis(me, attempts, baseModel, () => cancelled, setEnriched, setAnalysisReady);
    })();
    return () => { cancelled = true; };
  }, [bootState, sessionMe, previewModel, buildBase]);

  const status = useMemo<AnalyticsData["status"]>(() => {
    if (previewModel) return "ready";
    if (bootState === "BOOTING" || (bootState === "AUTHENTICATED" && loading)) return "booting";
    if (bootState !== "AUTHENTICATED") return "unauthenticated";
    return "ready";
  }, [bootState, loading, previewModel]);

  return { status, analysisReady, model: enriched ?? base };
}

/** Phase 2 — fan out reviews + my-result, enrich the model in place. */
async function runDeepAnalysis(
  me: UserMe,
  attempts: Attempt[],
  baseModel: AnalyticsModel,
  cancelled: () => boolean,
  setEnriched: (m: AnalyticsModel) => void,
  setReady: (b: boolean) => void,
) {
  const completed = attempts
    .filter((a) => a.is_completed && a.submitted_at)
    .sort((a, b) => new Date(b.submitted_at!).getTime() - new Date(a.submitted_at!).getTime())
    .slice(0, REVIEW_FANOUT_CAP);

  // Subject accuracy/time + weakness from exam reviews.
  const subjectAgg: Record<SubjectKey, { correct: number; total: number; seconds: number }> = {
    math: { correct: 0, total: 0, seconds: 0 },
    rw: { correct: 0, total: 0, seconds: 0 },
  };
  const tough: ToughQuestion[] = [];

  await mapWithConcurrency(completed, CONCURRENCY, async (a) => {
    const review = await examsStudentApi.getReview(a.id).catch(() => null);
    if (!review || cancelled()) return;
    const key = subjectKey(a.practice_test_details?.subject);
    const qs: Array<{ is_correct?: boolean; duration?: number; index_in_module?: number }> = Array.isArray(review.questions) ? review.questions : [];
    const subjName = subjectLabel(a.practice_test_details?.subject);
    qs.forEach((q, i) => {
      const dur = typeof q.duration === "number" ? q.duration : 0;
      if (key) {
        subjectAgg[key].total += 1;
        if (q.is_correct) subjectAgg[key].correct += 1;
        subjectAgg[key].seconds += dur;
      }
      if (dur > 0) tough.push({ id: `${a.id}-${i}`, label: `${subjName} · Q${q.index_in_module ?? i + 1}`, subject: subjName, seconds: dur });
    });
  });

  const subjects: SubjectStat[] = baseModel.subjects.map((s) => {
    const agg = subjectAgg[s.key];
    return {
      ...s,
      accuracy: agg.total > 0 ? Math.round((agg.correct / agg.total) * 100) : null,
      timeMinutes: agg.seconds > 0 ? Math.round(agg.seconds / 60) : null,
    };
  });
  const missedBySubject = baseModel.subjects.map((s) => {
    const agg = subjectAgg[s.key];
    return { label: s.label, missed: agg.total - agg.correct, total: agg.total };
  }).filter((m) => m.total > 0);
  const toughestQuestions = tough.sort((a, b) => b.seconds - a.seconds).slice(0, 6);

  // SAT strand radar from assessment my-result (set category = strand).
  const strandBuckets = new Map<string, { correct: number; total: number; subject: string | null }>();
  let assignments: { id: number }[] = [];
  try {
    const r = await classesApi.myAssignments();
    assignments = (r.items ?? []) as { id: number }[];
  } catch { /* none */ }

  await mapWithConcurrency(assignments, CONCURRENCY, async (asg) => {
    const res = await assessmentsStudentApi.myResult(asg.id).catch(() => null);
    if (!res || cancelled()) return;
    const meta = (res as { meta?: { set_category?: string | null; set_subject?: string | null } }).meta;
    const result = (res as { result?: { correct_count?: number; total_questions?: number } | null }).result;
    const strand = meta?.set_category?.trim();
    if (!strand || !result || typeof result.correct_count !== "number" || typeof result.total_questions !== "number" || result.total_questions <= 0) return;
    const cur = strandBuckets.get(strand) ?? { correct: 0, total: 0, subject: meta?.set_subject ?? null };
    cur.correct += result.correct_count;
    cur.total += result.total_questions;
    strandBuckets.set(strand, cur);
  });

  const strands: StrandStat[] = [...strandBuckets.entries()]
    .map(([strand, v]) => ({ strand, subject: v.subject, accuracy: Math.round((v.correct / v.total) * 100), total: v.total }))
    .sort((a, b) => a.strand.localeCompare(b.strand));
  const weakestStrands = [...strands].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);

  // Recommendations from real signals.
  const recommendations: Recommendation[] = [];
  if (weakestStrands[0]) recommendations.push({ id: "strand", title: `Review ${weakestStrands[0].strand.split("›").pop()?.trim() || weakestStrands[0].strand}`, detail: `Your lowest strand at ${weakestStrands[0].accuracy}% accuracy.`, href: "/assessments" });
  const lowestSubject = [...subjects].filter((s) => s.accuracy != null).sort((a, b) => (a.accuracy as number) - (b.accuracy as number))[0];
  if (lowestSubject) recommendations.push({ id: "subject", title: `Strengthen ${lowestSubject.label}`, detail: `${lowestSubject.accuracy}% accuracy across recent sets.`, href: "/practice-tests" });
  const lastMockAt = me.last_mock_result?.completed_at;
  const mockStale = !lastMockAt || (daysUntil(lastMockAt) ?? -999) < -14;
  if (mockStale) recommendations.push({ id: "mock", title: "Take a timed mock", detail: "Refresh your predicted score under test conditions.", href: "/mock-exam" });
  if (toughestQuestions[0]) recommendations.push({ id: "pace", title: "Work on pacing", detail: `Some ${toughestQuestions[0].subject} questions are taking a while — practice timed sets.`, href: "/practice-tests" });

  if (cancelled()) return;
  setEnriched({ ...baseModel, subjects, missedBySubject, toughestQuestions, strands, weakestStrands, recommendations: recommendations.slice(0, 4) });
  setReady(true);
}
