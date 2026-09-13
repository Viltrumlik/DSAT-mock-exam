"use client";

/**
 * /progress — how each level has gone, and how the class you're in now compares.
 *
 * Dressed in the house's white quartz (the owner, 2026-09-13: "endigi navbat My progressga"), and
 * given the thing it was missing: "student progressi o'zini classroomdagi guruhdoshlarini
 * attendance bilan solishtirilsin va h/k". So under the hero, before the level ladder, each
 * current class gets a card that puts the student's attendance, homework, overall and (English)
 * vocabulary beside their group's — with the sentences written automatically from those figures
 * (see `PeerGroupCard` and `peerInsights`). The ladder below is the page it always was.
 *
 * Two requests, deliberately: the ladder answers on its own, and the comparison — which reads the
 * whole roster — arrives when it arrives. A failed comparison says so in its own place and never
 * takes the ladder down with it.
 */

import { BookOpen, Calculator, CalendarCheck, ClipboardCheck, TrendingUp } from "lucide-react";
import { HeroPage, Skeleton } from "@/components/ui";
// The house devices, so this reads as part of the same product as the classroom.
import { EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";
import { PeerGroupCard } from "./PeerGroupCard";
import { useMyPeerProgress, useMyProgress } from "./progressHooks";
import type { ProgressLevel, ProgressTrack } from "./progressApi";

/** A percentage, or an em dash. NEVER "0%" for a number we do not have. */
function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

const METER: Record<"primary" | "emerald" | "amber", { bar: string; track: string }> = {
  primary: { bar: "bg-primary", track: "bg-primary/15" },
  emerald: { bar: "bg-success", track: "bg-success/15" },
  amber: { bar: "bg-warning", track: "bg-warning/15" },
};

/** The proportion bar under a level. Unknown renders as an empty track, not a zero-width
 *  fill on a full track — the two look identical and mean opposite things. The track is a
 *  tint of its own colour, never the kit grey. */
function Meter({ value, tone }: { value: number | null; tone: keyof typeof METER }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full", METER[tone].track)}>
      {value != null && (
        <div
          className={cn("h-full rounded-full transition-[width]", METER[tone].bar)}
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
  tone: "emerald" | "amber";
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
        "squircle space-y-3 p-4 [--sq:11px]",
        level.state === "current"
          ? "border border-primary/35 bg-primary/[0.04]"
          : measured
            ? "border border-border"
            : // Dashed is the house's material for "nothing here yet".
              "border border-dashed border-border",
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
          <span className="ds-num text-2xl font-extrabold tabular-nums text-foreground">
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
                // NOT "present + late of counted" — that read as a perfect record sitting
                // next to a percentage saying otherwise, because a late is worth half a
                // lesson and the fraction hid it. Say what was actually marked instead.
                level.attendance
                  ? [
                      `${level.attendance.present} present`,
                      level.attendance.late ? `${level.attendance.late} late` : null,
                      level.attendance.absent ? `${level.attendance.absent} missed` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "not marked"
              }
              tone="emerald"
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

function TrackCard({ track, index }: { track: ProgressTrack; index: number }) {
  const Icon = track.subject === "math" ? Calculator : BookOpen;
  return (
    <section
      className="quartz squircle cr-cardrise space-y-4 p-5 [--sq:13px] sm:p-6"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <span className="squircle grid h-11 w-11 shrink-0 place-items-center bg-primary/10 text-primary [--sq:7px] dark:text-primary-hover">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[18px] font-extrabold tracking-[-0.01em] text-foreground">{track.subject_label}</h3>
          <p className="text-[13px] font-medium text-muted-foreground">
            {track.current_level_label
              ? `You are on ${track.current_level_label}.`
              : "No level set on your class yet."}
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {track.levels.map((level) => (
          <LevelCard key={level.level} level={level} />
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-[20px] font-extrabold tracking-[-0.015em] text-foreground">{title}</h2>
      <p className="ds-small mt-1">{description}</p>
    </div>
  );
}

/** You and your group — one card per class the student is in now. */
function PeersSection() {
  const peers = useMyPeerProgress();
  const heading = (
    <SectionHeading
      title="You and your group"
      description="Your numbers beside your classmates'. Group figures are averages — nobody else's own numbers are shown."
    />
  );

  if (peers.isPending) {
    return (
      <section className="flex flex-col gap-4" aria-busy>
        {heading}
        <Skeleton className="squircle h-80 [--sq:15px]" />
      </section>
    );
  }

  if (peers.isError) {
    return (
      <section className="flex flex-col gap-4">
        {heading}
        <div className="quartz squircle [--sq:13px]">
          {/* Not an empty state: "no comparison" would read as "your class has no one in it". */}
          <ErrorState
            title="The comparison with your group didn’t load."
            message="Your own progress below is unaffected — try again in a moment."
            onRetry={() => void peers.refetch()}
          />
        </div>
      </section>
    );
  }

  const groups = peers.data?.groups ?? [];
  // No current class to compare in: the ladder's own empty state already says why.
  if (groups.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      {heading}
      {groups.map((group, i) => (
        <PeerGroupCard key={group.classroom_id} group={group} minPeers={peers.data.min_peers} index={i} />
      ))}
    </section>
  );
}

export function MyProgressPage() {
  const progress = useMyProgress();
  const tracks = progress.data?.tracks ?? [];

  return (
    <HeroPage className="flex flex-col gap-7">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {/* cr-cardrise, not a float: nothing on the hero is clickable, so it must not lift. */}
      <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
        {/* The page's three colours as one thin edge: overall, attendance, homework. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-success to-warning"
        />
        <div className="relative flex flex-col gap-6 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex min-w-0 items-start gap-4">
            <span className="squircle flex h-14 w-14 shrink-0 items-center justify-center bg-primary/10 text-primary [--sq:8.5px] dark:text-primary-hover">
              <TrendingUp className="h-7 w-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary dark:text-primary-hover">
                My progress
              </span>
              <h1 className="mt-2.5 text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
                My progress
              </h1>
              <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-muted-foreground">
                How each level has gone — turning up and doing the work, counted together.
              </p>
            </div>
          </div>

          {progress.data?.overall != null ? (
            <div className="quartz squircle cr-cardrise relative shrink-0 overflow-hidden px-5 py-4 [--sq:11px] sm:min-w-[170px]">
              <TrendingUp
                aria-hidden
                strokeWidth={1.25}
                className="pointer-events-none absolute -bottom-3 -right-2 h-16 w-16 text-foreground/[0.05]"
              />
              <p className="relative text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">Overall</p>
              <p className="ds-num relative mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-primary dark:text-primary-hover">
                {pct(progress.data.overall)}
              </p>
            </div>
          ) : progress.isPending ? (
            <Skeleton className="squircle h-[88px] w-[170px] shrink-0 [--sq:11px]" />
          ) : null}
        </div>
      </section>

      <PeersSection />

      {/* The four branches, in order: loading → error → empty → content. */}
      {progress.isPending ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="squircle h-64 [--sq:13px]" />
          ))}
        </div>
      ) : progress.isError ? (
        <div className="quartz squircle [--sq:13px]">
          {/* Not an empty state. "No progress yet" would tell a student their term did not
              happen, when all that failed was a request. */}
          <ErrorState
            title="Your progress didn’t load."
            message="Nothing has been lost — it will be here once the connection comes back."
            onRetry={() => void progress.refetch()}
          />
        </div>
      ) : tracks.length === 0 ? (
        <div className="quartz squircle [--sq:13px]">
          <EmptyState
            icon={TrendingUp}
            title="Nothing to show yet"
            description="Once you are enrolled in a class with a level, your attendance and homework for it appear here."
          />
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          <SectionHeading title="Level by level" description="Every level you have studied, and the ones still ahead." />
          {tracks.map((track, i) => (
            <TrackCard key={track.subject} track={track} index={i} />
          ))}
          <p className="squircle bg-primary/[0.04] p-4 text-[13px] font-medium text-muted-foreground [--sq:11px]">
            Each level’s percentage is your attendance and your homework counted equally.
            Attendance counts a late as half a lesson, and an excused absence is left out
            altogether. A level with nothing recorded shows a dash rather than a zero. Your
            group’s figures are averages over the students in your class now, and appear once
            enough classmates have marks.
          </p>
        </section>
      )}
    </HeroPage>
  );
}
