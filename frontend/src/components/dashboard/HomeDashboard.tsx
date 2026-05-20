"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { classesApi, emptyNormalizedExamList, emptyNormalizedList, type UserMe, usersApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { examsStudentApi } from "@/features/examsStudent/api";
import { ArrowRight, BarChart3, Calendar, Loader2, Pencil, PlayCircle, Target, TrendingUp } from "lucide-react";
import { ClassroomButton } from "@/components/classroom";
import { DashboardCard, DashboardEyebrow, DashboardTitle } from "./DashboardCard";
import { GoalScoreModal, initialSectionsFromTarget } from "./GoalScoreModal";
import { LearningRoadmap, type RoadmapStep } from "./LearningRoadmap";
import { cn } from "@/lib/cn";
import { platformSubjectIsMath, platformSubjectIsReadingWriting } from "@/lib/permissions";
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
    return new Date(d).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
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

/** Avoid hanging forever if a non-critical API stalls (``useMe`` already loaded ``/users/me/``). */
const DASHBOARD_AGGREGATE_TIMEOUT_MS = 45_000;

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

  const incomplete = useMemo(
    () => attempts.find((a) => !a.is_completed) || null,
    [attempts],
  );

  const weeklyBuckets = useMemo(() => {
    const days = [0, 0, 0, 0, 0, 0, 0];
    const now = startOfDay(new Date());
    const dayMs = 86400000;
    for (const a of attempts) {
      if (!a.is_completed || !a.submitted_at) continue;
      const t = startOfDay(new Date(a.submitted_at));
      const diff = Math.round((now - t) / dayMs);
      if (diff >= 0 && diff < 7) days[6 - diff] += 1;
    }
    const max = Math.max(1, ...days);
    return days.map((n) => ({ n, h: Math.round((n / max) * 100) }));
  }, [attempts]);

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
  const trend =
    target != null && mockScore != null
      ? mockScore >= target
        ? { label: "On or above target", up: true }
        : { label: `${target - mockScore} pts to goal`, up: false }
      : { label: "Set target in Profile", up: null as boolean | null };

  const profileFieldsFilled = useMemo(() => {
    if (!me) return 0;
    let n = 0;
    const t = 4;
    if (me.first_name) n++;
    if (me.last_name) n++;
    if (me.sat_exam_date) n++;
    if (me.target_score != null) n++;
    return Math.round((n / t) * 100);
  }, [me]);

  async function handleExamDateChange(value: string) {
    if (me?.id == null) return;
    setSavingExamDate(true);
    setExamDateError(null);
    try {
      const updated = await usersApi.patchMe({
        sat_exam_date: value.trim() ? value : null,
      });
      setMe((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err: unknown) {
      const d = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const text =
        typeof d === "object" && d && d !== null
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
      {
        id: "profile",
        label: "Profile & goals",
        description: "Exam date and target score",
        href: "/profile",
        done: profileFieldsFilled >= 75,
      },
      {
        id: "practice",
        label: "Pastpaper practice",
        description: "Untimed sections from your library",
        href: "/practice-tests",
        done: attempts.some((a) => a.is_completed),
      },
      {
        id: "mock",
        label: "Timed mock",
        description: "Full diagnostic under test rules",
        href: "/mock-exam",
        done: !!me?.last_mock_result,
      },
      {
        id: "classes",
        label: "Classes",
        description: "Homework and cohort progress",
        href: "/classes",
        done: classCount > 0,
      },
    ],
    [attempts, classCount, me?.last_mock_result, profileFieldsFilled],
  );

  if (bootState === "BOOTING") {
    return (
      <div className="mx-auto max-w-6xl px-3 py-6 md:px-4 lg:px-6">
        <div className="mb-8 h-10 max-w-md ds-skeleton rounded-xl" />
        <div className="mb-4 h-28 rounded-2xl ds-skeleton" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-44 rounded-2xl ds-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (bootState !== "AUTHENTICATED") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <DashboardCard accent="gold" padding="lg">
          <DashboardEyebrow>MasterSAT</DashboardEyebrow>
          <DashboardTitle className="mt-2">Sign in for your dashboard</DashboardTitle>
          <p className="mt-3 text-sm text-muted-foreground">
            Track countdown, resume tests, and see weekly activity in one place.
          </p>
          <ClassroomButton variant="primary" size="md" className="mt-6 w-full" onClick={() => router.push("/login")}>
            Sign in
          </ClassroomButton>
        </DashboardCard>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-3 py-6 md:px-4 lg:px-6">
        <div className="mb-8 h-10 max-w-md ds-skeleton rounded-xl" />
        <div className="mb-4 h-28 rounded-2xl ds-skeleton" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-44 rounded-2xl ds-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  const totalCompleted = attempts.filter((a) => a.is_completed).length;

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-4 lg:px-6 space-y-6">

      {/* ── Hero greeting ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">
            Welcome back, {firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s your SAT prep at a glance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGoalModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Target className="h-3.5 w-3.5" />
            {target != null ? "Update goal" : "Set goal"}
          </button>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Profile
          </Link>
        </div>
      </header>

      {/* ── Metric cards row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Countdown */}
        <div className="relative overflow-hidden rounded-2xl bg-primary p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 opacity-80" />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">SAT Exam</span>
          </div>
          <p className="text-3xl font-black tabular-nums md:text-4xl">
            {examDays == null ? "—" : examDays < 0 ? "0" : examDays}
          </p>
          <p className="text-xs font-bold uppercase tracking-wider opacity-90 mt-0.5">days left</p>
          {me?.sat_exam_date && (
            <p className="text-[10px] font-medium opacity-75 mt-1">{formatExamDateLabel(me.sat_exam_date)}</p>
          )}
        </div>

        {/* Target score */}
        <button
          type="button"
          onClick={() => setGoalModalOpen(true)}
          className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/30 group"
        >
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Target</span>
          </div>
          <p className="text-3xl font-black tabular-nums text-foreground md:text-4xl">
            {target != null ? target : "—"}
          </p>
          <p className="text-xs font-bold text-muted-foreground mt-0.5">/ 1600</p>
          {sectionGoals && (
            <p className="text-[10px] font-semibold text-muted-foreground mt-1">
              M:{sectionGoals.math} · E:{sectionGoals.english}
            </p>
          )}
        </button>

        {/* Last mock */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last Mock</span>
          </div>
          <p className="text-3xl font-black tabular-nums text-foreground md:text-4xl">
            {mockScore != null ? mockScore : "—"}
          </p>
          <div className={cn(
            "inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-bold mt-1",
            trend.up === true && "bg-emerald-100 text-emerald-700",
            trend.up === false && "bg-amber-100 text-amber-700",
            trend.up === null && "bg-surface-2 text-muted-foreground",
          )}>
            {trend.up === true ? <TrendingUp className="h-3 w-3" /> : <Target className="h-3 w-3" />}
            {trend.label}
          </div>
        </div>

        {/* Completed tests */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <PlayCircle className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Completed</span>
          </div>
          <p className="text-3xl font-black tabular-nums text-foreground md:text-4xl">
            {totalCompleted}
          </p>
          <p className="text-xs font-bold text-muted-foreground mt-0.5">tests done</p>
          {classCount > 0 && (
            <p className="text-[10px] font-semibold text-muted-foreground mt-1">
              {classCount} class{classCount !== 1 ? "es" : ""} enrolled
            </p>
          )}
        </div>
      </div>

      {/* ── Exam date picker (compact) ─────────────────────────────────────── */}
      {(() => {
        const allowed = new Set(examDateOptions.map((o) => o.exam_date));
        const sat = me?.sat_exam_date?.trim() || "";
        const orphan = !!sat && !allowed.has(sat);
        if (examDateOptions.length === 0 && sat) return null;
        return (
          <div className="rounded-2xl border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-3">
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-bold text-foreground">SAT Date:</span>
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

      {/* ── Task-first: pending assignments ─────────────────────────────────── */}
      <StudentTaskPrioritySection dashboardLoaded={!loading} />

      {/* ── Two-column grid: Resume + Activity ─────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-5">

        {/* Continue learning — prominent resume card */}
        <div className="md:col-span-3 rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-primary" />
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-foreground">Continue learning</h2>
          </div>
          {incomplete ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-foreground truncate">
                  {incomplete.practice_test_details?.title || "Practice test"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
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
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
              >
                <PlayCircle className="h-4 w-4" />
                Resume
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                No active attempt. Start a pastpaper or mock exam when you&apos;re ready.
              </p>
              <Link
                href="/practice-tests"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors shrink-0"
              >
                Browse tests
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>

        {/* Weekly activity chart */}
        <div className="md:col-span-2 rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h2 className="text-xs font-extrabold uppercase tracking-wide text-foreground">This week</h2>
            </div>
            <span className="text-xs font-bold text-muted-foreground tabular-nums">
              {weeklyBuckets.reduce((s, d) => s + d.n, 0)} tests
            </span>
          </div>
          <div className="flex h-24 items-end justify-between gap-1.5">
            {weeklyBuckets.map((d, i) => {
              const labels = ["M", "T", "W", "T", "F", "S", "S"];
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-20 w-full items-end justify-center">
                    <div
                      className={cn(
                        "w-full max-w-[1.5rem] rounded-t-md transition-all duration-300",
                        d.n > 0 ? "bg-primary" : "bg-surface-2",
                      )}
                      style={{ height: `${Math.max(8, d.h)}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground">{labels[i]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Quick actions ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/practice-tests", icon: PlayCircle, label: "Practice Tests", desc: "Untimed sections" },
          { href: "/mock-exam", icon: Target, label: "Mock Exam", desc: "Full timed test" },
          { href: "/assessments", icon: BarChart3, label: "Assessments", desc: "Class homework" },
          { href: "/classes", icon: Calendar, label: "My Classes", desc: `${classCount} enrolled` },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <action.icon className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-foreground">{action.label}</p>
              <p className="text-[10px] font-semibold text-muted-foreground">{action.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Roadmap ────────────────────────────────────────────────────────── */}
      <LearningRoadmap steps={roadmapSteps} />

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
