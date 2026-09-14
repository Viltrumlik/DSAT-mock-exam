"use client";

import Link from "next/link";
import { Coins, Flame, GraduationCap, Trophy } from "lucide-react";
import { ExplainButton } from "@/components/ui";
import { useRoadmap } from "@/features/roadmap/hooks";
import { useMyRewards } from "@/features/rewards/rewardsHooks";
import {
  POINTS_EXPLAINER,
  STRIKE_EXPLAINER,
  XP_EXPLAINER,
  type Explainer,
} from "@/features/rewards/explainers";
import { cn } from "@/lib/cn";

/**
 * The row of single facts near the top of the dashboard: level per subject, XP, points and
 * strikes.
 *
 * It began as the replacement for three full-width bands — a level card, a rewards strip and
 * a score/countdown pair — and at first it carried the exam countdown and the target score as
 * chips too, with the full cards for both moved below the calendar. The owner asked for the
 * reverse on those two: the chips removed, and the countdown and goal cards back at the top
 * where they were. So this row now holds only what has no card of its own, and nothing on
 * the dashboard is said twice.
 *
 * It can legitimately be empty — a student with no level set yet, before their rewards have
 * loaded — and then it renders nothing rather than a margin with no chips in it. The exam
 * chip used to guarantee at least one entry; without it that guarantee is gone.
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
  explain,
}: {
  icon: typeof Trophy;
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone: ChipTone;
  index: number;
  href?: string;
  /** Puts a ! in the chip's corner. For a number whose rule is not on its face. */
  explain?: Explainer;
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
    "cr-card flex h-full w-full items-center gap-3 rounded-2xl border p-3.5 text-left",
    t.wrap,
  );
  const style = { animationDelay: `${index * 60}ms` } as React.CSSProperties;
  // The ! is a sibling of the chip, never a child: half of these chips are links, and a
  // <button> inside an <a> is invalid markup that would also swallow the navigation.
  return (
    <div className="relative flex min-w-[190px] flex-1">
      {href ? (
        <Link href={href} className={cn(className, "ds-ring")} style={style}>
          {body}
        </Link>
      ) : (
        <div className={className} style={style}>
          {body}
        </div>
      )}
      {explain ? (
        <ExplainButton title={explain.title} side="left" className="absolute right-2 top-2">
          {explain.body}
        </ExplainButton>
      ) : null}
    </div>
  );
}

export function DashboardPulse() {
  const roadmap = useRoadmap();
  const rewards = useMyRewards();

  const tracks = roadmap.data?.tracks ?? [];
  // One chip per subject a student actually studies, never a placeholder for one they do not.
  const levelled = tracks.filter((t) => t.own_level_label);

  const chips: React.ReactNode[] = [];
  let i = 0;

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
      <Chip
        key="xp"
        index={i++}
        tone="emerald"
        icon={Trophy}
        label="XP"
        value={rewards.data.xp.toLocaleString("en-US")}
        href="/leaderboard"
        explain={XP_EXPLAINER}
      />,
      <Chip
        key="points"
        index={i++}
        tone="violet"
        icon={Coins}
        label="Points"
        value={rewards.data.points.toLocaleString("en-US")}
        detail={`${rewards.data.coins} ${rewards.data.coins === 1 ? "coin" : "coins"}`}
        href="/shop"
        explain={POINTS_EXPLAINER}
      />,
      // `strikes`, not `current_streak`: the spendable balance is what the Strike shop
      // charges against, and the two part company the moment a student buys anything. The
      // run itself is the detail line, where it reads as context rather than as the total.
      <Chip
        key="strikes"
        index={i++}
        tone="amber"
        icon={Flame}
        label="Strikes"
        value={rewards.data.strikes}
        detail={
          rewards.data.current_streak > 0
            ? `${rewards.data.current_streak} ${rewards.data.current_streak === 1 ? "lesson" : "lessons"} in a row`
            : "attend a lesson to start"
        }
        explain={STRIKE_EXPLAINER}
      />,
    );
  }

  if (chips.length === 0) return null;

  return (
    // Flowed rather than gridded: the number of chips depends on how many subjects a student
    // studies and whether their rewards have loaded, so a fixed column count leaves a hole in
    // the row for everybody whose count is not a multiple of it.
    <div className="mb-[22px] flex flex-wrap gap-3">{chips}</div>
  );
}
