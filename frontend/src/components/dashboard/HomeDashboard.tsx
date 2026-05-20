"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { classesApi, emptyNormalizedExamList, emptyNormalizedList, type UserMe, usersApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { examsStudentApi } from "@/features/examsStudent/api";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  ChevronRight,
  Clock,
  Flame,
  GraduationCap,
  Loader2,
  Pencil,
  PlayCircle,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { platformSubjectIsMath, platformSubjectIsReadingWriting } from "@/lib/permissions";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { MiniBarChart } from "@/components/ui/MiniBarChart";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActivityItem } from "@/components/ui/ActivityItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoalScoreModal, initialSectionsFromTarget } from "./GoalScoreModal";
import { LearningRoadmap, type RoadmapStep } from "./LearningRoadmap";
import { StudentTaskPrioritySection } from "./StudentTaskPrioritySection";

type Attempt = {
  id: number;
  submitted_at?: string | null;
  is_completed?: boolean;
  score?: number | null;
  practice_test_details?: { subject?: string; title?: string };
};

const examsPublicApi = examsStudentApi;

type ExamDateOptionRow = {
  id: number;
  exam_date: string;
  label: string;
};

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return Math.ceil((t.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

const SECTION_GOALS_KEY = (userId: number) => `mastersat.sectionGoals.${userId}`;

function formatExamDateLabel(d: string) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function readStoredSectionGoals(
  userId: number | undefined,
  target: number | null,
): { math: number; english: number } | null {
  if (userId == null || target == null || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SECTION_GOALS_KEY(userId));
    if (!raw) return null;
    const p = JSON.parse(raw) as { math?: unknown; english?: unknown; total?: unknown };
    if (typeof p.math !== "number" || typeof p.english !== "number" || typeof p.total !== "number") return null;
    if (p.total !== target) return null;
    return { math: p.math, english: p.english };
  } catch {
    return null;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const DASHBOARD_AGGREGATE_TIMEOUT_MS = 45_000;

/* ─────────────────────────────── Skeleton ────────────────────────────── */
function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6">
      <div className="mb-8 h-10 max-w-xs ds-skeleton rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-2xl ds-skeleton" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-48 rounded-2xl ds-skeleton" />
        <div className="h-48 rounded-2xl ds-skeleton" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════ MAIN ═══════════════════════════════════ */
export function HomeDashboard() {
  const router = useRouter();
  const { bootState, me: sessionMe } = useMe();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<UserMe | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [classCount, setClassCount] = useState(0);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [examDateOptions, setExamDateOptions] = useState<ExamDateOptionRow[]>([]);
  const [savingExamDate, setSavingExamDate] = useState(false);
  const [examDateError, setExamDateError] = useState<string | null>(null);

  /* ── Data loading ───────────────────────────────────────────────────── */
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
      try {
        const bundle = await Promise.race([
          Promise.all([
            examsPublicApi.getAttempts().catch(() => emptyNormalizedExamList<Attempt>()),
            classesApi.list().catch(() => emptyNormalizedList()),
            usersApi.listExamDates().catch(() => []),
          ]),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("dashboard_aggregate_timeout")), DASHBOARD_AGGREGATE_TIMEOUT_MS);
          }),
        ]);
        if (cancelled) return;
        const [attemptsBundle, classes, examDatesRaw] = bundle;
        setExamDateOptions(Array.isArray(examDatesRaw) ? (examDatesRaw as ExamDateOptionRow[]) : []);
        setAttempts((attemptsBundle.items ?? []) as Attempt[]);
        setClassCount(classes.items.length);
      } catch {
        if (!cancelled) {
          setExamDateOptions([]);
          setAttempts([]);
          setClassCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootState, sessionMe]);

  /* ── Derived data ───────────────────────────────────────────────────── */
  const incomplete = useMemo(
    () => attempts.find((a) => !a.is_completed) || null,
    [attempts],
  );

  const completedAttempts = useMemo(
    () => attempts.filter((a) => a.is_completed),
    [attempts],
  );

  const totalCompleted = completedAttempts.length;

  const weeklyData = useMemo(() => {
    const days = [0, 0, 0, 0, 0, 0, 0];
    const now = startOfDay(new Date());
    const dayMs = 86400000;
    for (const a of attempts) {
      if (!a.is_completed || !a.submitted_at) continue;
      const t = startOfDay(new Date(a.submitted_at));
      const diff = Math.round((now - t) / dayMs);
      if (diff >= 0 && diff < 7) days[6 - diff] += 1;
    }
    return days;
  }, [attempts]);

  const weeklyTotal = weeklyData.reduce((s, n) => s + n, 0);
  const weekLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const recentActivity = useMemo(() => {
    return completedAttempts
      .filter((a) => a.submitted_at)
      .sort((a, b) => new Date(b.submitted_at!).getTime() - new Date(a.submitted_at!).getTime())
      .slice(0, 5);
  }, [completedAttempts]);

  const firstName = me?.first_name?.trim() || "there";
  const examDays = daysUntil(me?.sat_exam_date ?? null);
  const target = me?.target_score ?? null;
  const mockScore = me?.last_mock_result?.score ?? null;
  const sectionGoals = useMemo(
    () => readStoredSectionGoals(me?.id, target),
    [me?.id, target],
  );
  const goalModalInitial = useMemo(() => {
    const fromStore = readStoredSectionGoals(me?.id, target);
    if (fromStore) return fromStore;
    return initialSectionsFromTarget(target);
  }, [me?.id, target]);

  const scoreProgress = target && mockScore ? Math.min(100, Math.round((mockScore / target) * 100)) : 0;

  const profileFieldsFilled = useMemo(() => {
    if (!me) return 0;
    let n = 0;
    if (me.first_name) n++;
    if (me.last_name) n++;
    if (me.sat_exam_date) n++;
    if (me.target_score != null) n++;
    return Math.round((n / 4) * 100);
  }, [me]);

  /* ── Handlers ───────────────────────────────────────────────────────── */
  async function handleExamDateChange(value: string) {
    if (me?.id == null) return;
    setSavingExamDate(true);
    setExamDateError(null);
    try {
      const updated = await usersApi.patchMe({ sat_exam_date: value.trim() ? value : null });
      setMe((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err: unknown) {
      const d = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const text =
        typeof d === "object" && d
          ? Object.entries(d)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
              .join(" ")
          : "Could not save exam date.";
      setExamDateError(text);
    } finally {
      setSavingExamDate(false);
    }
  }

  async function handleGoalSubmit(math: number, english: number) {
    if (me?.id == null) return;
    const total = math + english;
    setSavingGoal(true);
    try {
      const updated = await usersApi.patchMe({ target_score: total });
      try {
        localStorage.setItem(SECTION_GOALS_KEY(me.id), JSON.stringify({ math, english, total }));
      } catch {
        /* ignore quota */
      }
      setMe((prev) => (prev ? { ...prev, ...updated } : prev));
      setGoalModalOpen(false);
    } finally {
      setSavingGoal(false);
    }
  }

  const roadmapSteps: RoadmapStep[] = useMemo(
    () => [
      { id: "profile", label: "Profile & goals", description: "Exam date and target score", href: "/profile", done: profileFieldsFilled >= 75 },
      { id: "practice", label: "Pastpaper practice", description: "Untimed sections from your library", href: "/practice-tests", done: attempts.some((a) => a.is_completed) },
      { id: "mock", label: "Timed mock", description: "Full diagnostic under test rules", href: "/mock-exam", done: !!me?.last_mock_result },
      { id: "classes", label: "Classes", description: "Homework and cohort progress", href: "/classes", done: classCount > 0 },
    ],
    [attempts, classCount, me?.last_mock_result, profileFieldsFilled],
  );

  /* ── Guard states ───────────────────────────────────────────────────── */
  if (bootState === "BOOTING" || (bootState === "AUTHENTICATED" && loading)) {
    return <DashboardSkeleton />;
  }

  if (bootState !== "AUTHENTICATED") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="rounded-2xl border border-border bg-card p-10 shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <GraduationCap className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-black text-foreground">Welcome to MasterSAT</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to track your progress, resume tests, and see weekly analytics.
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="mt-6 w-full rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6 space-y-6">

      {/* ═══ Header ══════════════════════════════════════════════════════ */}
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName}`}
        description="Your SAT prep analytics and progress at a glance."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGoalModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Target className="h-3.5 w-3.5" />
              {target != null ? "Update goal" : "Set goal"}
            </button>
            <Link
              href="/profile"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Profile
            </Link>
          </div>
        }
      />

      {/* ═══ Top Metric Row (4 stat cards) ═══════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* SAT Countdown — hero accent card */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-white">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
          <div className="absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="h-4 w-4 opacity-80" />
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">SAT Countdown</span>
            </div>
            <p className="text-4xl font-black tabular-nums leading-none">
              {examDays == null ? "--" : examDays < 0 ? "0" : examDays}
            </p>
            <p className="text-xs font-bold uppercase tracking-wider opacity-90 mt-1">days remaining</p>
            {me?.sat_exam_date && (
              <p className="text-[10px] font-medium opacity-70 mt-2">{formatExamDateLabel(me.sat_exam_date)}</p>
            )}
          </div>
        </div>

        {/* Target Score with progress ring */}
        <StatCard
          label="Target Score"
          value={target != null ? target : "--"}
          sub={sectionGoals ? `M: ${sectionGoals.math} | E: ${sectionGoals.english}` : "/ 1600"}
          icon={Target}
          accent="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40"
          onClick={() => setGoalModalOpen(true)}
        />

        {/* Last Mock with trend */}
        <StatCard
          label="Last Mock"
          value={mockScore != null ? mockScore : "--"}
          icon={BarChart3}
          accent="text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40"
          sub={
            target != null && mockScore != null
              ? mockScore >= target
                ? "On or above target"
                : `${target - mockScore} pts to goal`
              : "Take a mock to see score"
          }
          trend={
            target != null && mockScore != null
              ? mockScore >= target
                ? "up"
                : "down"
              : undefined
          }
          change={
            target != null && mockScore != null
              ? Math.round(Math.abs(((mockScore - target) / target) * 100))
              : undefined
          }
        />

        {/* Tests Completed */}
        <StatCard
          label="Tests Done"
          value={totalCompleted}
          icon={Trophy}
          accent="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
          sub={classCount > 0 ? `${classCount} class${classCount !== 1 ? "es" : ""} enrolled` : "Keep practicing!"}
        />
      </div>

      {/* ═══ Exam Date Picker (inline) ═══════════════════════════════════ */}
      {(() => {
        const allowed = new Set(examDateOptions.map((o) => o.exam_date));
        const sat = me?.sat_exam_date?.trim() || "";
        const orphan = !!sat && !allowed.has(sat);
        if (examDateOptions.length === 0 && sat) return null;
        return (
          <div className="rounded-2xl border border-border bg-card px-5 py-3 flex flex-wrap items-center gap-3">
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-bold text-foreground">SAT Exam Date:</span>
            <select
              disabled={savingExamDate}
              value={sat}
              onChange={(e) => void handleExamDateChange(e.target.value)}
              className={cn(
                "rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-foreground",
                "outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20",
                "disabled:cursor-wait disabled:opacity-70",
              )}
            >
              <option value="">Not set</option>
              {orphan && <option value={sat}>{formatExamDateLabel(sat)} (old)</option>}
              {examDateOptions.map((o) => (
                <option key={o.id} value={o.exam_date}>
                  {o.label ? `${o.label} · ${formatExamDateLabel(o.exam_date)}` : formatExamDateLabel(o.exam_date)}
                </option>
              ))}
            </select>
            {savingExamDate && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            {examDateError && <span className="text-xs text-red-600 font-semibold">{examDateError}</span>}
          </div>
        );
      })()}

      {/* ═══ Pending Tasks (priority zone) ═══════════════════════════════ */}
      <StudentTaskPrioritySection dashboardLoaded={!loading} />

      {/* ═══ Main Analytics Grid ═════════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* ── Left column: Score Progress + Resume ────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Score Progress Panel */}
          {target != null && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Score Progress</h2>
                </div>
                <span className="text-xs font-bold text-muted-foreground tabular-nums">
                  {mockScore ?? 0} / {target}
                </span>
              </div>
              <div className="flex items-center gap-8">
                <ProgressRing
                  value={scoreProgress}
                  size={96}
                  strokeWidth={8}
                  color={scoreProgress >= 100 ? "text-emerald-500" : "text-primary"}
                >
                  <div className="text-center">
                    <span className="text-lg font-black tabular-nums text-foreground">{scoreProgress}%</span>
                  </div>
                </ProgressRing>
                <div className="flex-1 space-y-3">
                  {sectionGoals && (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-muted-foreground">Math</span>
                          <span className="text-xs font-bold tabular-nums text-foreground">{sectionGoals.math}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-700"
                            style={{ width: `${Math.min(100, (sectionGoals.math / 800) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-muted-foreground">Reading & Writing</span>
                          <span className="text-xs font-bold tabular-nums text-foreground">{sectionGoals.english}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500 transition-all duration-700"
                            style={{ width: `${Math.min(100, (sectionGoals.english / 800) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                  {!sectionGoals && (
                    <p className="text-sm text-muted-foreground">
                      Set section goals to see per-subject progress bars.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Continue Learning / Resume Card */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <PlayCircle className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Continue Learning</h2>
            </div>
            {incomplete ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-foreground truncate text-lg">
                    {incomplete.practice_test_details?.title || "Practice test"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {platformSubjectIsMath(incomplete.practice_test_details?.subject)
                      ? "Math"
                      : platformSubjectIsReadingWriting(incomplete.practice_test_details?.subject)
                        ? "Reading & Writing"
                        : "In progress"}
                    {" · Pick up where you stopped"}
                  </p>
                </div>
                <Link
                  href={`/exam/${incomplete.id}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 shadow-sm"
                >
                  <PlayCircle className="h-4 w-4" />
                  Resume Test
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">No active attempts right now.</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Start a practice test or mock exam to see it here.</p>
                </div>
                <Link
                  href="/practice-tests"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors shrink-0"
                >
                  Browse Tests
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Weekly Activity + Recent ──────────────────── */}
        <div className="space-y-4">

          {/* Weekly Activity Chart */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500" />
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">This Week</h2>
              </div>
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs font-bold tabular-nums text-foreground">
                <Zap className="h-3 w-3 text-primary" />
                {weeklyTotal} tests
              </span>
            </div>
            <MiniBarChart
              data={weeklyData}
              labels={weekLabels}
              height={80}
              barClass={cn("bg-primary rounded-t-md")}
            />
          </div>

          {/* Recent Activity Feed */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Recent</h2>
              </div>
              {recentActivity.length > 0 && (
                <Link href="/practice-tests" className="text-[11px] font-bold text-primary hover:underline">
                  View all
                </Link>
              )}
            </div>
            {recentActivity.length > 0 ? (
              <div className="divide-y divide-border">
                {recentActivity.map((a) => (
                  <ActivityItem
                    key={a.id}
                    icon={
                      platformSubjectIsMath(a.practice_test_details?.subject)
                        ? BarChart3
                        : BookOpen
                    }
                    iconColor={
                      platformSubjectIsMath(a.practice_test_details?.subject)
                        ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40"
                        : "text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/40"
                    }
                    title={a.practice_test_details?.title || "Practice test"}
                    meta={a.score != null ? `Score: ${a.score}` : "Completed"}
                    time={a.submitted_at ? timeAgo(a.submitted_at) : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <BookOpen className="mx-auto h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No recent activity yet.</p>
              </div>
            )}
          </div>

          {/* Profile Completion */}
          {profileFieldsFilled < 100 && (
            <Link
              href="/profile"
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/25"
            >
              <ProgressRing value={profileFieldsFilled} size={48} strokeWidth={4} color="text-amber-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Complete your profile</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Add exam date and goals for better analytics</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </Link>
          )}
        </div>
      </div>

      {/* ═══ Quick Actions Grid ══════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/practice-tests", icon: PlayCircle, label: "Practice Tests", desc: "Untimed sections", accent: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
          { href: "/mock-exam", icon: Target, label: "Mock Exam", desc: "Full timed test", accent: "text-red-600 bg-red-50 dark:bg-red-950/40" },
          { href: "/assessments", icon: BarChart3, label: "Assessments", desc: "Class homework", accent: "text-violet-600 bg-violet-50 dark:bg-violet-950/40" },
          { href: "/classes", icon: GraduationCap, label: "My Classes", desc: `${classCount} enrolled`, accent: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/25 hover:shadow-sm"
          >
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl transition-colors", action.accent)}>
              <action.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-foreground">{action.label}</p>
              <p className="text-[10px] font-semibold text-muted-foreground">{action.desc}</p>
            </div>
            <span className="text-[11px] font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              Open <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        ))}
      </div>

      {/* ═══ Learning Roadmap ════════════════════════════════════════════ */}
      <LearningRoadmap steps={roadmapSteps} />

      {/* ═══ Goal Modal ══════════════════════════════════════════════════ */}
      <GoalScoreModal
        open={goalModalOpen}
        onOpenChange={setGoalModalOpen}
        initialMath={goalModalInitial.math}
        initialEnglish={goalModalInitial.english}
        saving={savingGoal}
        onSubmit={handleGoalSubmit}
      />
    </div>
  );
}
