"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Target,
  Flame,
  Trophy,
  CalendarDays,
  ArrowRight,
  PlayCircle,
  BookOpen,
  Calculator,
  GraduationCap,
  Sparkles,
  Clock,
  CheckCircle2,
  Circle,
  ChevronRight,
  TrendingUp,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
  CardContent,
  Badge,
  ProgressRing,
  Progress,
  EmptyState,
  Modal,
  Field,
  Input,
  Skeleton,
} from "@/components/ui";
import {
  ChartCard,
  LineChart,
  BarChart,
  DonutChart,
  RadarChart,
  type ChartSeries,
} from "@/components/ui/charts";
import { useDashboardData, type DashboardModel } from "./useDashboardData";

const scoreSeries: ChartSeries[] = [{ key: "score", label: "Score" }];
const weeklySeries: ChartSeries[] = [{ key: "sessions", label: "Sessions" }];

export function StudentDashboard({ previewModel }: { previewModel?: DashboardModel }) {
  const live = useDashboardData();
  const router = useRouter();
  const [goalOpen, setGoalOpen] = useState(false);

  const status = previewModel ? "ready" : live.status;
  const model = previewModel ?? live.model;

  if (status === "booting") return <DashboardSkeleton />;

  if (status === "unauthenticated" || !model) {
    return (
      <div className="mx-auto max-w-md py-16">
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <GraduationCap className="h-8 w-8" />
            </div>
            <h1 className="ds-h2">Welcome to MasterSAT</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to track your progress, resume tests, and see your analytics.
            </p>
            <Button className="mt-6" fullWidth onClick={() => router.push("/login")}>
              Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ds-overline text-primary">Dashboard</p>
          <h1 className="ds-h1 mt-1">Welcome back, {model.firstName}</h1>
          <p className="ds-small mt-1">Your prep, progress, and next steps at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" leftIcon={<Target />} onClick={() => setGoalOpen(true)}>
            {model.target != null ? "Update goal" : "Set goal"}
          </Button>
          <Link href="/analytics">
            <Button variant="ghost" rightIcon={<ArrowRight />}>Analytics</Button>
          </Link>
        </div>
      </div>

      {/* Hero — readiness + scores + prominent SAT countdown */}
      <HeroPanel model={model} />

      {/* Primary: what to do next (actions lead the page) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <NextActionsCard model={model} className="lg:col-span-2" />
        <UpcomingCard model={model} />
      </div>
      <FocusAreasCard model={model} />

      {/* Engagement */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MotivationStat icon={Flame} label="Day streak" value={model.streak} hint={model.streak > 0 ? "Keep it going" : "Practice today to start one"} />
        <WeeklyGoalCard sessions={model.weeklySessions} goal={model.weeklyGoal} />
        <MilestonesCard model={model} />
      </div>

      {/* Secondary: progress analytics (a look back, below the actions) */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="ds-h3">Your progress</h2>
            <p className="ds-small">A look back — your next steps are above.</p>
          </div>
          <Link href="/analytics">
            <Button variant="ghost" size="sm" rightIcon={<ArrowRight />}>Full analytics</Button>
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Score progression" description="Your recent scored sets">
            <LineChart
              data={model.scoreSeries}
              xKey="label"
              series={scoreSeries}
              height={220}
              emptyMessage={{ title: "No scores yet", description: "Complete a scored set to start your trend." }}
            />
          </ChartCard>
          <ChartCard title="Weekly activity" description="Sessions over the last 7 days">
            <BarChart data={model.weekly} xKey="label" series={weeklySeries} height={220} />
          </ChartCard>
          <ChartCard title="Practice focus" description="Where your sessions go">
            <DonutChart
              data={model.sectionMix}
              height={220}
              centerValue={model.totalCompleted}
              centerLabel="Sets"
              emptyMessage={{ title: "No practice yet", description: "Your section balance appears here." }}
            />
          </ChartCard>
          <ChartCard
            title="Skill analysis"
            description="Domain-level strengths"
            actions={
              <Link href="/analytics" className="ds-ring inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-primary">
                Full breakdown <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <RadarChart
              data={[]}
              axisKey="axis"
              series={[]}
              height={220}
              emptyMessage={{
                title: "Skill radar in Analytics",
                description: "Per-domain accuracy across SAT skills opens on the Analytics page.",
              }}
            />
          </ChartCard>
        </div>
        <div className="mt-4">
          <RecentCard model={model} />
        </div>
      </section>

      <GoalModal
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        initial={model.target ?? 1400}
        saving={live.savingGoal}
        onSave={async (total) => {
          if (!previewModel) await live.saveGoal(total);
          setGoalOpen(false);
        }}
      />
    </div>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────────── */
function HeroPanel({ model }: { model: DashboardModel }) {
  const ringTone = model.goalReached ? "text-success" : "text-primary";
  return (
    <Card>
      <CardContent className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
        {/* Readiness ring */}
        <div className="flex items-center gap-5">
          <ProgressRing value={model.readiness ?? 0} size={108} strokeWidth={9} color={ringTone} showLabel={false}>
            <div className="text-center">
              <span className="ds-num block text-2xl font-extrabold leading-none text-foreground">
                {model.readiness != null ? `${model.readiness}%` : "—"}
              </span>
              <span className="ds-overline mt-1 block">Ready</span>
            </div>
          </ProgressRing>
          <div className="md:hidden">
            <HeroNumbers model={model} />
          </div>
        </div>

        {/* Numbers (desktop) */}
        <div className="hidden md:block">
          <HeroNumbers model={model} />
        </div>

        {/* Exam countdown */}
        <div className="rounded-2xl bg-primary p-5 text-primary-foreground md:w-48">
          <div className="flex items-center gap-2 opacity-90">
            <CalendarDays className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider">SAT countdown</span>
          </div>
          <p className="ds-num mt-2 text-4xl font-extrabold leading-none">
            {model.examDaysLeft == null ? "—" : Math.max(0, model.examDaysLeft)}
          </p>
          <p className="mt-1 text-xs font-semibold opacity-90">
            {model.examDaysLeft == null ? "Set your exam date" : "days to go"}
          </p>
          {model.examDate ? (
            <p className="mt-2 text-[11px] opacity-75">
              {new Date(model.examDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function HeroNumbers({ model }: { model: DashboardModel }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Metric label="Current" value={model.current ?? "—"} big />
        <Metric label="Projected" value={model.predicted ?? "—"} icon={<TrendingUp className="h-4 w-4 text-success" />} />
        <Metric label="Goal" value={model.target ?? "—"} />
      </div>
      {model.goalReached ? (
        <Badge variant="success" dot>Goal reached — outstanding work</Badge>
      ) : model.gap != null ? (
        <Badge variant="primary">{model.gap} points to your goal</Badge>
      ) : (
        <Badge variant="neutral">Set a goal to track your gap</Badge>
      )}
    </div>
  );
}

function Metric({ label, value, big, icon }: { label: string; value: React.ReactNode; big?: boolean; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="ds-overline">{label}</p>
      <p className={cn("ds-num flex items-center gap-1.5 font-extrabold tracking-tight text-foreground", big ? "text-4xl" : "text-2xl")}>
        {value}
        {icon}
      </p>
    </div>
  );
}

/* ── Motivation ─────────────────────────────────────────────────────────── */
function MotivationStat({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: React.ReactNode; hint: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-soft text-warning-foreground">
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <p className="ds-num text-2xl font-extrabold leading-none text-foreground">{value}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{label}</p>
          <p className="text-[12px] text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function WeeklyGoalCard({ sessions, goal }: { sessions: number; goal: number }) {
  const pct = Math.min(100, Math.round((sessions / goal) * 100));
  const done = sessions >= goal;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Weekly goal</p>
          <Badge variant={done ? "success" : "primary"}>{done ? "Goal reached" : "In progress"}</Badge>
        </div>
        <p className="ds-num text-2xl font-extrabold text-foreground">
          {sessions}<span className="text-base font-bold text-muted-foreground"> / {goal} sessions</span>
        </p>
        <Progress value={pct} tone={done ? "success" : "primary"} />
      </CardContent>
    </Card>
  );
}

function MilestonesCard({ model }: { model: DashboardModel }) {
  const earned = model.milestones.filter((m) => m.done).length;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Milestones</p>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
            <Trophy className="h-4 w-4 text-warning" /> {earned}/{model.milestones.length}
          </span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {model.milestones.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-[13px]">
              {m.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-label-foreground" />
              )}
              <span className={cn(m.done ? "font-semibold text-foreground" : "text-muted-foreground")}>{m.label}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ── Insights ───────────────────────────────────────────────────────────── */
function FocusAreasCard({ model }: { model: DashboardModel }) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="ds-h4">Focus areas</p>
        </div>
        {model.focusAreas.length === 0 ? (
          <p className="text-sm text-muted-foreground">You&apos;re well-rounded right now — keep up the steady practice.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {model.focusAreas.map((f) => (
              <Link
                key={f.id}
                href={f.href}
                className="ds-ring group flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Target className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{f.title}</p>
                  <p className="text-[12px] text-muted-foreground">{f.detail}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-label-foreground transition-colors group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NextActionsCard({ model, className }: { model: DashboardModel; className?: string }) {
  return (
    <Card className={className}>
      <CardContent>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Rocket className="h-4 w-4" />
          </span>
          <div>
            <p className="ds-h4 leading-tight">Recommended next</p>
            <p className="text-[12px] text-muted-foreground">Your highest-impact steps right now</p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          {model.nextActions.map((a, i) => (
            <Link
              key={a.id}
              href={a.href}
              className={cn(
                "ds-ring group flex items-center gap-3 rounded-xl p-4 transition-colors",
                i === 0
                  ? "border border-primary/20 bg-primary-soft hover:bg-primary/15"
                  : "bg-surface-2 hover:bg-surface-3",
              )}
            >
              <PlayCircle className={cn("h-6 w-6 shrink-0", i === 0 ? "text-primary" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-bold", i === 0 ? "text-primary" : "text-foreground")}>{a.title}</p>
                <p className="text-[12px] text-muted-foreground">{a.detail}</p>
              </div>
              {i === 0 ? <Badge variant="primary">Start here</Badge> : null}
              <ArrowRight className="h-4 w-4 shrink-0 text-label-foreground transition-colors group-hover:text-foreground" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UpcomingCard({ model }: { model: DashboardModel }) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <p className="ds-h4">Upcoming</p>
        </div>
        {model.upcoming.length === 0 ? (
          <EmptyState compact icon={CalendarDays} title="Nothing due" description="Assigned work will show up here." />
        ) : (
          <div className="flex flex-col gap-2">
            {model.upcoming.map((u) => (
              <Link
                key={u.id}
                href={u.href}
                className="ds-ring flex items-center justify-between gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">{u.title}</span>
                <Badge variant={u.soon ? "warning" : "neutral"}>{u.dueLabel}</Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentCard({ model }: { model: DashboardModel }) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <p className="ds-h4">Recent activity</p>
        </div>
        {model.recent.length === 0 ? (
          <EmptyState compact icon={BookOpen} title="No activity yet" description="Your completed sets appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {model.recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", r.isMath ? "bg-success-soft text-success-foreground" : "bg-info-soft text-info-foreground")}>
                  {r.isMath ? <Calculator className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{r.title}</p>
                  <p className="text-[12px] text-muted-foreground">{r.meta}</p>
                </div>
                <span className="shrink-0 text-[12px] text-label-foreground">{r.time}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Goal modal ─────────────────────────────────────────────────────────── */
function GoalModal({
  open,
  onClose,
  initial,
  saving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: number;
  saving: boolean;
  onSave: (total: number) => void | Promise<void>;
}) {
  const [value, setValue] = useState(String(initial));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your goal score"
      description="We tailor recommendations and your readiness to it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={() => onSave(Math.max(400, Math.min(1600, Number(value) || 0)))}>
            Save goal
          </Button>
        </>
      }
    >
      <Field label="Target total (400–1600)" htmlFor="goal-input" hint="The digital SAT is scored 400–1600.">
        <Input
          id="goal-input"
          type="number"
          min={400}
          max={1600}
          step={10}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */
function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
      </div>
    </div>
  );
}
