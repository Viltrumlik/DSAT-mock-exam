"use client";

import Link from "next/link";
import { CalendarClock, Coins, Flame, GraduationCap, Target, Trophy } from "lucide-react";
import { useRoadmap } from "@/features/roadmap/hooks";
import { useMyRewards } from "@/features/rewards/rewardsHooks";
import { cn } from "@/lib/cn";

/**
 * The top of the dashboard, in one band instead of three.
 *
 * What it replaces: a level card, a rewards strip and a score/countdown pair — three
 * full-width slabs, one under another, before a student reached anything they could act on.
 * Two of the three were mostly empty for most students (a level card reading "Not set yet",
 * a target card showing three dashes), and all three were the same shade, so the row that
 * mattered was not findable. The owner's note was to move them, recolour them and put them
 * somewhere else entirely.
 *
 * So: one row of chips, each in its own colour, each a single fact. The exam countdown is
 * the widest and the only filled one, because it is the only number on the dashboard that
 * changes by itself and the only one with a deadline attached.
 *
 * The editable cards those bands carried — the target-score sliders and the exam-date picker
 * — are not deleted. They moved BELOW the calendar, which is where a control you touch twice
 * a term belongs; this band links to them.
 */

type ChipTone = "primary" | "violet" | "amber" | "emerald" | "sky";

const TONE: Record<ChipTone, { wrap: string; icon: string; value: string }> = {
  primary: {
    wrap: "border-primary/25 bg-primary-soft",
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    value: "text-primary dark:text-primary-hover",
  },
  violet: {
    wrap: "border-[color-mix(in_oklab,var(--chart-6)_26%,transparent)] bg-[color-mix(in_oklab,var(--chart-6)_10%,transparent)]",
    icon: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    value: "text-[var(--chart-6)]",
  },
  amber: {
    wrap: "border-warning/25 bg-warning-soft",
    icon: "bg-warning/15 text-warning-foreground",
    value: "text-warning-foreground",
  },
  emerald: {
    wrap: "border-success/25 bg-success-soft",
    icon: "bg-success/15 text-success-foreground",
    value: "text-success-foreground",
  },
  sky: {
    wrap: "border-info/25 bg-info-soft",
    icon: "bg-info/15 text-info-foreground",
    value: "text-info-foreground",
  },
};

function Chip({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  index,
  href,
}: {
  icon: typeof Trophy;
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone: ChipTone;
  index: number;
  href?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <span className={cn("cr-iconpop grid h-9 w-9 shrink-0 place-items-center rounded-xl", t.icon)}>
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={cn("ds-num block truncate text-[19px] font-extrabold leading-tight", t.value)}>
          {value}
        </span>
        {detail ? (
          <span className="block truncate text-[11.5px] text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </>
  );
  const className = cn(
    "cr-card flex min-w-[190px] flex-1 items-center gap-3 rounded-2xl border p-3.5 text-left",
    t.wrap,
  );
  const style = { animationDelay: `${index * 60}ms` } as React.CSSProperties;
  return href ? (
    <Link href={href} className={cn(className, "ds-ring")} style={style}>
      {body}
    </Link>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

/** Whole days from today to `iso`, in the reader's own day — negative once it has passed. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function DashboardPulse({
  examDate,
  target,
}: {
  examDate: string | null;
  target: number | null;
}) {
  const roadmap = useRoadmap();
  const rewards = useMyRewards();

  const left = daysUntil(examDate);
  const tracks = roadmap.data?.tracks ?? [];
  // One chip per subject a student actually studies, never a placeholder for one they do not.
  const levelled = tracks.filter((t) => t.own_level_label);

  const chips: React.ReactNode[] = [];
  let i = 0;

  chips.push(
    <Chip
      key="exam"
      index={i++}
      tone="primary"
      icon={CalendarClock}
      label="SAT exam"
      value={left == null ? "Pick a date" : left < 0 ? "Done" : `${left} ${left === 1 ? "day" : "days"}`}
      detail={left == null ? "Set it below to start the countdown" : undefined}
      href={left == null ? undefined : "/profile"}
    />,
  );

  if (target != null) {
    chips.push(
      <Chip key="target" index={i++} tone="violet" icon={Target} label="Target" value={target} detail="out of 1600" />,
    );
  }

  for (const track of levelled) {
    chips.push(
      <Chip
        key={`level-${track.subject}`}
        index={i++}
        tone="sky"
        icon={GraduationCap}
        label={track.subject_label}
        value={track.own_level_label as string}
        detail={track.next_level_label ? `Next: ${track.next_level_label}` : "Top level"}
        href="/roadmap"
      />,
    );
  }

  // The rewards chips are drawn only once their figures are in. A chip that says "—" and
  // then changes is worse than a chip that arrives a beat late.
  if (rewards.data) {
    chips.push(
      <Chip key="xp" index={i++} tone="emerald" icon={Trophy} label="XP" value={rewards.data.xp.toLocaleString("en-US")} href="/leaderboard" />,
      <Chip
        key="points"
        index={i++}
        tone="violet"
        icon={Coins}
        label="Points"
        value={rewards.data.points.toLocaleString("en-US")}
        detail={`${rewards.data.coins} ${rewards.data.coins === 1 ? "coin" : "coins"}`}
        href="/shop"
      />,
      <Chip
        key="streak"
        index={i++}
        tone="amber"
        icon={Flame}
        label="Streak"
        value={rewards.data.current_streak}
        detail={rewards.data.current_streak > 0 ? `best ${rewards.data.best_streak}` : "start one"}
      />,
    );
  }

  return (
    // Flowed rather than gridded: the number of chips depends on how many subjects a student
    // studies and whether their rewards have loaded, so a fixed column count leaves a hole in
    // the row for everybody whose count is not a multiple of it.
    <div className="mb-[22px] flex flex-wrap gap-3">{chips}</div>
  );
}
