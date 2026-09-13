"use client";

/**
 * One classroom, the student beside their group.
 *
 * Top to bottom: the sentences the page writes on its own (see `peerInsights`), each measure on a
 * scale with the group's average marked on it, the student's last lessons, and attendance month
 * by month for them and the group. Every group figure is an aggregate the server computed; a
 * missing one says why instead of standing in as a zero.
 */

import Link from "next/link";
import {
  ArrowRight,
  BookA,
  BookOpen,
  Calculator,
  CalendarCheck,
  Check,
  ClipboardCheck,
  Clock,
  Lock,
  Minus,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

import { gapToGroup, peerInsights, type InsightIcon, type InsightTone } from "./peerInsights";
import type { LessonStatus, PeerGroup, PeerMetric, PeerStanding } from "./progressApi";

type Tone = "emerald" | "amber" | "primary" | "violet";

/** Tokens only, so the palette follows the light/dark toggle. */
const TONE: Record<Tone, { icon: string; bar: string; track: string; soft: string }> = {
  emerald: { icon: "bg-success/15 text-success-foreground", bar: "bg-success", track: "bg-success/15", soft: "bg-success/35" },
  amber: { icon: "bg-warning/15 text-warning-foreground", bar: "bg-warning", track: "bg-warning/15", soft: "bg-warning/35" },
  primary: {
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    bar: "bg-primary",
    track: "bg-primary/15",
    soft: "bg-primary/35",
  },
  violet: {
    icon: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    bar: "bg-[var(--chart-6)]",
    track: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)]",
    soft: "bg-[color-mix(in_oklab,var(--chart-6)_35%,transparent)]",
  },
};

const INSIGHT_ICON: Record<InsightIcon, LucideIcon> = {
  trophy: Trophy,
  sparkles: Sparkles,
  target: Target,
  calendar: CalendarCheck,
  lock: Lock,
  users: Users,
};

const INSIGHT_TONE: Record<InsightTone, { well: string; icon: string }> = {
  success: { well: "bg-success/[0.09]", icon: "text-success-foreground" },
  warning: { well: "bg-warning/[0.10]", icon: "text-warning-foreground" },
  info: { well: "bg-primary/[0.07]", icon: "text-primary dark:text-primary-hover" },
  muted: { well: "bg-foreground/[0.04]", icon: "text-muted-foreground" },
};

const STANDING_TEXT: Record<Exclude<PeerStanding, "lower_half">, string> = {
  top_quarter: "Top quarter of your group",
  upper_half: "Upper half of your group",
};

const LESSON: Record<LessonStatus, { label: string; dot: string; icon: LucideIcon }> = {
  PRESENT: { label: "Present", dot: "bg-success text-white", icon: Check },
  LATE: { label: "Late", dot: "bg-warning text-white", icon: Clock },
  // "Missed", as the ladder says it — the fact, not a charge.
  ABSENT: { label: "Missed", dot: "bg-rose-500/15 text-rose-600 dark:text-rose-300", icon: X },
  EXCUSED: { label: "Excused", dot: "bg-foreground/[0.07] text-muted-foreground", icon: Minus },
};

type Unit = "percent" | "words";

function fmt(value: number | null, unit: Unit): string {
  if (value == null) return "—";
  return unit === "percent" ? `${Math.round(value)}%` : `${Math.round(value)}`;
}

function localDay(iso: string): Date {
  // A plain YYYY-MM-DD read as local midnight, not UTC — or it renders as the day before for
  // anyone west of Greenwich.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function shortDay(iso: string): string {
  return localDay(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

/** "+11 vs group", "−4 vs group", or "Level with group" — tinted, never red. */
function DeltaChip({ gap }: { gap: number | null }) {
  if (gap == null) return null;
  const rounded = Math.round(gap);
  const level = rounded === 0;
  return (
    <span
      className={cn(
        "ds-num inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold",
        level
          ? "bg-foreground/[0.05] text-muted-foreground"
          : rounded > 0
            ? "bg-success/15 text-success-foreground"
            : "bg-warning/15 text-warning-foreground",
      )}
    >
      {level ? "Level with group" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} vs group`}
    </span>
  );
}

/**
 * The student's figure as a fill, the group's average as a mark on the same track. The number
 * beside it says how much; this says which side of the group they are on, at a glance.
 */
function CompareScale({
  metric,
  unit,
  tone,
  label,
}: {
  metric: PeerMetric;
  unit: Unit;
  tone: Tone;
  label: string;
}) {
  const t = TONE[tone];
  const max =
    unit === "percent" ? 100 : Math.max(1, metric.you ?? 0, metric.group_average ?? 0) * 1.25;
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const aria =
    metric.group_average != null
      ? `${label}: you ${fmt(metric.you, unit)}, group average ${fmt(metric.group_average, unit)}`
      : `${label}: you ${fmt(metric.you, unit)}`;

  return (
    <div className="relative h-5" role="img" aria-label={aria}>
      <div className={cn("absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full", t.track)} />
      {metric.you != null ? (
        <div
          className={cn("absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full", t.bar)}
          style={{ width: pos(metric.you) }}
        />
      ) : null}
      {metric.group_average != null ? (
        <span
          aria-hidden
          className="absolute top-0 h-5 w-[3px] -translate-x-1/2 rounded-full bg-foreground/80 ring-2 ring-[var(--card)]"
          style={{ left: pos(metric.group_average) }}
        />
      ) : null}
    </div>
  );
}

function MetricTile({
  label,
  icon: Icon,
  tone,
  unit,
  metric,
  detail,
  lowerNote,
}: {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  unit: Unit;
  metric: PeerMetric;
  detail: string;
  /** What to say instead of a band when the student is in the lower half — the next step. */
  lowerNote: string | null;
}) {
  const t = TONE[tone];
  const band =
    metric.standing && metric.standing !== "lower_half"
      ? STANDING_TEXT[metric.standing]
      : metric.standing === "lower_half"
        ? lowerNote
        : null;

  return (
    <div className="quartz squircle flex flex-col gap-3 p-4 [--sq:11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          <span className={cn("squircle grid h-7 w-7 shrink-0 place-items-center [--sq:5px]", t.icon)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="truncate">{label}</span>
        </span>
        <DeltaChip gap={gapToGroup(metric)} />
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="ds-num text-[30px] font-extrabold leading-none tracking-tight text-foreground">
          {fmt(metric.you, unit)}
        </span>
        {unit === "words" && metric.you != null ? (
          <span className="text-[13px] font-semibold text-muted-foreground">words</span>
        ) : null}
      </div>

      <CompareScale metric={metric} unit={unit} tone={tone} label={label} />

      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
          {metric.group_average != null ? (
            <>
              <span aria-hidden className="inline-block h-3 w-[3px] rounded-full bg-foreground/80" />
              Group average {fmt(metric.group_average, unit)}
              {unit === "words" ? " words" : ""}
            </>
          ) : (
            "No group figure yet"
          )}
        </p>
        <p className="text-[12.5px] font-medium text-muted-foreground">{detail}</p>
        {band ? (
          <p
            className={cn(
              "text-[12.5px] font-bold",
              metric.standing === "lower_half" ? "text-foreground" : "text-success-foreground",
            )}
          >
            {band}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LessonStrip({ lessons }: { lessons: PeerGroup["recent_lessons"] }) {
  if (lessons.length === 0) {
    return <p className="text-[13px] font-medium text-muted-foreground">No lessons marked for you yet.</p>;
  }
  return (
    <ol className="flex items-end gap-1.5">
      {lessons.map((lesson) => {
        const look = LESSON[lesson.status];
        return (
          <li key={lesson.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span
              className={cn("squircle grid h-8 w-8 place-items-center [--sq:6px]", look.dot)}
              role="img"
              aria-label={`${shortDay(lesson.date)}: ${look.label}`}
              title={`${shortDay(lesson.date)} · ${look.label}`}
            >
              <look.icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="truncate text-[10.5px] font-semibold text-muted-foreground">
              {shortDay(lesson.date)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AttendanceTrend({ trend }: { trend: PeerGroup["attendance_trend"] }) {
  if (trend.length === 0) {
    return <p className="text-[13px] font-medium text-muted-foreground">Nothing marked yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-32 items-end gap-3">
        {trend.map((month) => (
          <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end justify-center gap-1.5">
              <TrendBar value={month.you} className={TONE.emerald.bar} who="You" />
              <TrendBar value={month.group} className={TONE.emerald.soft} who="Group" />
            </div>
            <span className="text-[11px] font-bold text-muted-foreground">{monthLabel(month.month)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-[11.5px] font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("squircle h-2.5 w-2.5 [--sq:2px]", TONE.emerald.bar)} /> You
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("squircle h-2.5 w-2.5 [--sq:2px]", TONE.emerald.soft)} /> Group average
        </span>
      </div>
    </div>
  );
}

function TrendBar({ value, className, who }: { value: number | null; className: string; who: string }) {
  return (
    <div className="flex h-full w-5 flex-col items-center justify-end gap-1 sm:w-6">
      {value == null ? (
        <span className="text-[10px] font-bold text-muted-foreground" title={`${who}: not enough marks`}>
          —
        </span>
      ) : (
        <>
          <span className="ds-num text-[10px] font-bold text-muted-foreground">{Math.round(value)}</span>
          <div
            className={cn("squircle w-full [--sq:4px]", className)}
            style={{ height: `${Math.max(4, value)}%` }}
            role="img"
            aria-label={`${who}: ${Math.round(value)}%`}
          />
        </>
      )}
    </div>
  );
}

export function PeerGroupCard({
  group,
  minPeers,
  index = 0,
}: {
  group: PeerGroup;
  minPeers: number;
  index?: number;
}) {
  const insights = peerInsights(group, minPeers);
  const SubjectIcon = group.subject === "math" ? Calculator : BookOpen;
  const { attendance, homework, overall, vocabulary } = group.metrics;
  const attendanceGap = gapToGroup(attendance);
  const overallGap = gapToGroup(overall);
  const vocabularyGap = gapToGroup(vocabulary);

  const attendanceDetail = [
    `${attendance.detail.present} present`,
    attendance.detail.late ? `${attendance.detail.late} late` : null,
    attendance.detail.absent ? `${attendance.detail.absent} missed` : null,
    attendance.detail.excused ? `${attendance.detail.excused} excused` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="quartz squircle cr-cardrise flex flex-col gap-5 p-5 [--sq:15px] sm:p-6"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="squircle grid h-12 w-12 shrink-0 place-items-center bg-primary/10 text-primary [--sq:7.5px] dark:text-primary-hover">
            <SubjectIcon className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              {group.subject_label} · {group.level_label}
            </p>
            <h3 className="truncate text-[18px] font-extrabold tracking-[-0.01em] text-foreground">
              {group.classroom_name}
            </h3>
            <p className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {group.group_size} {group.group_size === 1 ? "student" : "students"}
            </p>
          </div>
        </div>
        <Link
          href={`/classes/${group.classroom_id}`}
          className="ds-ring cr-press inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-[13px] font-bold text-primary no-underline transition-colors hover:bg-primary/15 dark:text-primary-hover"
        >
          Open class
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      {insights.length > 0 ? (
        <ul className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
          {insights.map((insight) => {
            const Icon = INSIGHT_ICON[insight.icon];
            const tone = INSIGHT_TONE[insight.tone];
            return (
              <li
                key={insight.key}
                className={cn(
                  "squircle cr-rowin flex items-start gap-2 px-3.5 py-2.5 text-[13px] font-semibold text-foreground [--sq:8px]",
                  tone.well,
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.icon)} aria-hidden />
                <span>{insight.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className={cn("grid gap-3 sm:grid-cols-2", vocabulary ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
        <MetricTile
          label="Attendance"
          icon={CalendarCheck}
          tone="emerald"
          unit="percent"
          metric={attendance}
          detail={attendance.you != null ? attendanceDetail : "Nothing marked for you yet"}
          lowerNote={
            attendanceGap != null ? `${Math.abs(Math.round(attendanceGap))} points to your group's average` : null
          }
        />
        <MetricTile
          label="Homework"
          icon={ClipboardCheck}
          tone="amber"
          unit="percent"
          metric={homework}
          detail={
            homework.detail.total
              ? `${homework.detail.completed} of ${homework.detail.total} done · ${homework.detail.remaining} left`
              : "No homework set yet"
          }
          lowerNote={
            homework.detail.to_reach_average > 0
              ? `${homework.detail.to_reach_average} more to reach your group's average`
              : null
          }
        />
        <MetricTile
          label="Overall"
          icon={TrendingUp}
          tone="primary"
          unit="percent"
          metric={overall}
          detail="Attendance and homework, counted together"
          lowerNote={overallGap != null ? `${Math.abs(Math.round(overallGap))} points to your group's average` : null}
        />
        {vocabulary ? (
          <MetricTile
            label="Words mastered"
            icon={BookA}
            tone="violet"
            unit="words"
            metric={vocabulary}
            detail="Words proved in all four games"
            lowerNote={
              vocabularyGap != null ? `${Math.abs(Math.round(vocabularyGap))} words to your group's average` : null
            }
          />
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="squircle flex flex-col gap-3 bg-success/[0.05] p-4 [--sq:11px]">
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Your last lessons</p>
          <LessonStrip lessons={group.recent_lessons} />
        </div>
        <div className="squircle flex flex-col gap-3 bg-success/[0.05] p-4 [--sq:11px]">
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Attendance by month</p>
          <AttendanceTrend trend={group.attendance_trend} />
        </div>
      </div>
    </section>
  );
}
