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

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-4 lg:px-6">
      <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Overview</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">
            Hi, {firstName}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Resume where you left off, watch the countdown, and follow the roadmap—no clutter, just signal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            type="button"
            onClick={() => setGoalModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition-all hover:border-primary/30"
          >
            <Target className="h-3.5 w-3.5" />
            My goal score
          </button>
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition-all hover:border-primary/30"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit goals
          </Link>
        </div>
      </header>

      {/* Task-first: show pending assignments before everything else */}
      <StudentTaskPrioritySection dashboardLoaded={!loading} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {/* Target goal — dedicated row for quick score setup */}
        <div className="col-span-full">
          <DashboardCard
            accent="blue"
            padding="md"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Target className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <DashboardEyebrow>Goal</DashboardEyebrow>
                  <DashboardTitle className="mt-1">Your target score</DashboardTitle>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-4xl font-black tabular-nums tracking-tight text-foreground">
                      {target != null ? target : "—"}
                    </span>
                    <span className="text-sm font-bold text-muted-foreground">/ 1600 total</span>
                  </div>
                  {sectionGoals && target != null ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Math <span className="font-bold tabular-nums text-foreground">{sectionGoals.math}</span>
                      <span className="mx-1.5 text-border">·</span>
                      English{" "}
                      <span className="font-bold tabular-nums text-foreground">{sectionGoals.english}</span>
                    </p>
                  ) : (
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">
                      Set Math and English targets — your overall goal updates automatically.
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGoalModalOpen(true)}
                className="ms-btn-primary ms-cta-fill inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold  sm:w-auto sm:min-w-[10.5rem]"
              >
                <Target className="h-4 w-4" />
                {target != null ? "Update score" : "Set score"}
              </button>
            </div>
          </DashboardCard>
        </div>

        {/* Continue learning */}
        <DashboardCard accent="blue" padding="md" className="lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <DashboardEyebrow>Resume</DashboardEyebrow>
              <DashboardTitle className="mt-1">Continue learning</DashboardTitle>
              {incomplete ? (
                <>
                  <p className="mt-2 truncate text-sm font-medium text-foreground">
                    {incomplete.practice_test_details?.title || "Practice test"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {platformSubjectIsMath(incomplete.practice_test_details?.subject)
                      ? "Math"
                      : platformSubjectIsReadingWriting(incomplete.practice_test_details?.subject)
                        ? "Reading & Writing"
                        : "In progress"}
                    {" · "}
                    Pick up where you stopped
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No active attempt. Start a pastpaper or mock when you&apos;re ready.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              {incomplete ? (
                <Link
                  href={`/exam/${incomplete.id}`}
                  className="ms-btn-primary ms-cta-fill inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold "
                >
                  <PlayCircle className="h-4 w-4" />
                  Resume
                </Link>
              ) : (
                <Link
                  href="/practice-tests"
                  className="ms-btn-secondary inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:border-primary/30"
                >
                  Browse tests
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </DashboardCard>

        {/* Exam countdown — highlight */}
        <div
          className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary p-5 md:p-6 text-white shadow-sm"
        >
          <DashboardEyebrow className="text-white/80">Exam countdown</DashboardEyebrow>
          <div className="relative mt-2 flex items-baseline gap-2">
            <Calendar className="h-5 w-5 shrink-0 opacity-90" />
            <span className="text-4xl font-black tabular-nums tracking-tight md:text-5xl">
              {examDays == null ? "—" : examDays < 0 ? "0" : examDays}
            </span>
            <span className="text-sm font-bold uppercase tracking-wider text-white/90">days</span>
          </div>
          {(() => {
            const allowed = new Set(examDateOptions.map((o) => o.exam_date));
            const sat = me?.sat_exam_date?.trim() || "";
            const orphan = !!sat && !allowed.has(sat);
            return (
              <div className="relative mt-2 w-full min-w-0">
                <p className="text-sm font-medium text-white/85">
                  {sat
                    ? `Until ${formatExamDateLabel(sat)}`
                    : "Select the SAT date you registered for (same list as Profile)."}
                </p>
                <label htmlFor="dash-exam-date" className="sr-only">
                  SAT exam date
                </label>
                <select
                  id="dash-exam-date"
                  disabled={savingExamDate}
                  value={sat}
                  onChange={(e) => void handleExamDateChange(e.target.value)}
                  className={cn(
                    "relative mt-3 w-full min-w-0 rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-sm font-semibold text-white shadow-inner",
                    "outline-none focus:border-white/45 focus:ring-2 focus:ring-white/20",
                    "disabled:cursor-wait disabled:opacity-70",
                    "[&>option]:bg-[#0f172a] [&>option]:text-white",
                  )}
                >
                  <option value="">Not set</option>
                  {orphan ? (
                    <option value={sat}>
                      {formatExamDateLabel(sat)} (no longer on list — pick another)
                    </option>
                  ) : null}
                  {examDateOptions.map((o) => (
                    <option key={o.id} value={o.exam_date}>
                      {o.label
                        ? `${o.label} · ${formatExamDateLabel(o.exam_date)}`
                        : formatExamDateLabel(o.exam_date)}
                    </option>
                  ))}
                </select>
                {savingExamDate ? (
                  <p className="mt-2 flex items-center gap-2 text-xs font-bold text-white/80">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    Saving…
                  </p>
                ) : null}
                {examDateError ? (
                  <p className="mt-2 text-xs font-semibold text-amber-200">{examDateError}</p>
                ) : null}
                {examDateOptions.length === 0 ? (
                  <p className="mt-2 text-xs leading-snug text-white/75">
                    No exam dates yet. An admin adds them in{" "}
                    <span className="font-bold text-white/90">Admin → Exam dates</span>.
                  </p>
                ) : null}
                {orphan ? (
                  <p className="mt-2 text-xs text-amber-100/95">
                    Your saved date is not on the current list. Choose a new date or clear.
                  </p>
                ) : null}
                <Link
                  href="/profile"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white/80 underline-offset-4 hover:text-white hover:underline"
                >
                  Other profile settings
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            );
          })()}
        </div>

        {/* Performance */}
        <DashboardCard accent="blue" padding="md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DashboardEyebrow>Performance</DashboardEyebrow>
              <DashboardTitle className="mt-1">Last mock vs goal</DashboardTitle>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <span className="text-3xl font-black tabular-nums text-foreground">
              {mockScore != null ? mockScore : "—"}
            </span>
            <span className="pb-1 text-sm font-semibold text-label-foreground">/ {target ?? "—"}</span>
            <span className="text-xs font-bold text-muted-foreground">target</span>
          </div>
          {sectionGoals && target != null ? (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              Goal: Math {sectionGoals.math} · English {sectionGoals.english} · Overall{" "}
              <span className="tabular-nums font-bold text-foreground">{target}</span>
            </p>
          ) : null}
          <div
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold",
              trend.up === true && "bg-primary/12 text-primary ring-1 ring-primary/20",
              trend.up === false && "bg-surface-2 text-muted-foreground",
              trend.up === null && "bg-surface-2 text-muted-foreground",
            )}
          >
            {trend.up === true ? <TrendingUp className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
            {trend.label}
          </div>
        </DashboardCard>

        {/* Weekly activity */}
        <DashboardCard accent="blue" padding="md" className="md:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DashboardEyebrow>Activity</DashboardEyebrow>
              <DashboardTitle className="mt-1">Weekly completions</DashboardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Finished practice attempts submitted in the last 7 days
              </p>
            </div>
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-6 flex h-28 items-end justify-between gap-2 border-t border-border pt-4">
            {weeklyBuckets.map((d, i) => {
              const labels = ["-6d", "-5d", "-4d", "-3d", "-2d", "-1d", "Today"];
              return (
                <div key={labels[i]} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-24 w-full max-w-[2.5rem] items-end justify-center">
                    <div
                      className={cn(
                        "w-full max-w-[2rem] rounded-t-md transition-all duration-300",
                        d.n > 0
                          ? "bg-primary"
                          : "bg-surface-2",
                      )}
                      style={{ height: `${Math.max(8, d.h)}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-label-foreground">
                    {labels[i]}
                  </span>
                </div>
              );
            })}
          </div>
        </DashboardCard>

        {/* Roadmap */}
        <LearningRoadmap steps={roadmapSteps} />
      </div>

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
