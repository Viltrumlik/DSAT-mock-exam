"use client";

import { BookOpen, Calculator, CalendarCheck, ClipboardCheck, TrendingUp } from "lucide-react";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so this reads as part of the same product as the classroom.
import { Card, CardHeader, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";
import { useMyProgress } from "./progressHooks";
import type { ProgressLevel, ProgressTrack } from "./progressApi";

/** A percentage, or an em dash. NEVER "0%" for a number we do not have. */
function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

/** The proportion bar under a level. Unknown renders as an empty track, not a zero-width
 *  fill on a full track — the two look identical and mean opposite things. */
function Meter({ value, tone }: { value: number | null; tone: "primary" | "teal" | "amber" }) {
  const bar =
    tone === "primary" ? "bg-primary" : tone === "teal" ? "bg-teal-500" : "bg-amber-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      {value != null && (
        <div
          className={cn("h-full rounded-full transition-[width]", bar)}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}

function HalfRow({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number | null;
  detail: string;
  tone: "teal" | "amber";
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {label}
        </span>
        <span className="shrink-0 text-sm font-extrabold tabular-nums text-foreground">
          {pct(value)}
          <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">{detail}</span>
        </span>
      </div>
      <Meter value={value} tone={tone} />
    </div>
  );
}

const STATE_PILL: Record<ProgressLevel["state"], { label: string; tone: "primary" | "success" | "muted" }> = {
  current: { label: "Studying now", tone: "primary" },
  done: { label: "Finished", tone: "success" },
  "not-recorded": { label: "No record", tone: "muted" },
  upcoming: { label: "Ahead of you", tone: "muted" },
};

function LevelCard({ level }: { level: ProgressLevel }) {
  const pill = STATE_PILL[level.state];
  const measured = level.overall != null;
  // The honest sentence for a rung with no numbers, which is a different thing per state.
  const emptyNote =
    level.state === "upcoming"
      ? "You haven’t started this level yet."
      : level.state === "not-recorded"
        ? "You joined the course after this level, so there is nothing recorded here."
        : "Nothing has been marked or set for this level yet.";

  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border p-4",
        level.state === "current" ? "border-primary/50 bg-primary/[0.03]" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-foreground">{level.level_label}</p>
          {level.classroom_name && (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {level.classroom_name}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={pill.tone === "muted" ? undefined : pill.tone}>{pill.label}</Pill>
          <span className="text-2xl font-extrabold tabular-nums text-foreground">
            {pct(level.overall)}
          </span>
        </div>
      </div>

      {measured ? (
        <>
          <Meter value={level.overall} tone="primary" />
          <div className="space-y-2.5 pt-1">
            <HalfRow
              icon={CalendarCheck}
              label="Attendance"
              value={level.attendance?.rate ?? null}
              detail={
                level.attendance
                  ? `${level.attendance.present + level.attendance.late} of ${level.attendance.counted}`
                  : "not marked"
              }
              tone="teal"
            />
            <HalfRow
              icon={ClipboardCheck}
              label="Homework"
              value={level.homework?.rate ?? null}
              detail={
                level.homework
                  ? `${level.homework.completed} of ${level.homework.total}`
                  : "none set"
              }
              tone="amber"
            />
          </div>
          {/* Said out loud when only one half exists. The alternative is a number that looks
              like it covers both and quietly does not. */}
          {level.basis.length === 1 && (
            <p className="text-[12px] font-medium text-muted-foreground">
              Counted from {level.basis[0]} only — there is nothing recorded for the other half yet.
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] font-medium text-muted-foreground">{emptyNote}</p>
      )}
    </div>
  );
}

function TrackCard({ track }: { track: ProgressTrack }) {
  const Icon = track.subject === "math" ? Calculator : BookOpen;
  return (
    <Card className="cr-card space-y-3">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Icon className="h-[18px] w-[18px] text-primary" aria-hidden />
            {track.subject_label}
          </span>
        }
        description={
          track.current_level_label
            ? `You are on ${track.current_level_label}.`
            : "No level set on your class yet."
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {track.levels.map((level) => (
          <LevelCard key={level.level} level={level} />
        ))}
      </div>
    </Card>
  );
}

export function MyProgressPage() {
  const progress = useMyProgress();
  const tracks = progress.data?.tracks ?? [];

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="My progress"
          icon={TrendingUp}
          title="My progress"
          description="How each level has gone — turning up and doing the work, counted together."
          tiles={
            progress.data?.overall != null
              ? [{ label: "Overall", value: pct(progress.data.overall), accent: true }]
              : []
          }
        />
      </Card>

      {/* The four branches, in order: loading → error → empty → content. */}
      {progress.isPending ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : progress.isError ? (
        <Card className="cr-card">
          {/* Not an empty state. "No progress yet" would tell a student their term did not
              happen, when all that failed was a request. */}
          <ErrorState
            title="Your progress didn’t load."
            message="Nothing has been lost — it will be here once the connection comes back."
            onRetry={() => void progress.refetch()}
          />
        </Card>
      ) : tracks.length === 0 ? (
        <Card className="cr-card">
          <EmptyState
            icon={TrendingUp}
            title="Nothing to show yet"
            description="Once you are enrolled in a class with a level, your attendance and homework for it appear here."
          />
        </Card>
      ) : (
        <>
          {tracks.map((track) => (
            <TrackCard key={track.subject} track={track} />
          ))}
          <Card className="cr-card">
            <p className="text-[13px] font-medium text-muted-foreground">
              Each level’s percentage is your attendance and your homework counted equally.
              Attendance counts a late as half a lesson, and an excused absence is left out
              altogether. A level with nothing recorded shows a dash rather than a zero.
            </p>
          </Card>
        </>
      )}
    </HeroPage>
  );
}
