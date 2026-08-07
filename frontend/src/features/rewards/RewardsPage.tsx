"use client";

import { useMemo } from "react";
import {
  Coins,
  Sparkles,
  CalendarCheck,
  ClipboardList,
  FileText,
  LifeBuoy,
  MessageSquare,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
} from "@/components/ui";
import ErrorPanel from "@/components/ErrorPanel";
import { useMyRewards, useRewardRules } from "./rewardsHooks";
import type { RewardEvent } from "./rewardsApi";

/** One icon per family of earning, so the history reads at a glance. */
const EVENT_ICON: Record<RewardEvent, LucideIcon> = {
  ATTENDANCE_PRESENT: CalendarCheck,
  ATTENDANCE_LATE: CalendarCheck,
  SUPPORT_SESSION: LifeBuoy,
  SURVEY: MessageSquare,
  MIDTERM_PASS: FileText,
  MIDTERM_RETAKE_PASS: FileText,
  HOMEWORK_FULL: ClipboardList,
  HOMEWORK_HIGH: ClipboardList,
  HOMEWORK_MID: ClipboardList,
  MANUAL: Sparkles,
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RewardsPage() {
  const rewards = useMyRewards();
  const rules = useRewardRules();

  const points = rewards.data?.points ?? 0;
  const perCoin = rewards.data?.points_per_coin ?? 10;

  const coins = useMemo(() => Math.floor(points / perCoin), [points, perCoin]);
  const toNextCoin = useMemo(
    () => (perCoin > 0 ? perCoin - (points % perCoin) : 0),
    [points, perCoin],
  );

  if (rewards.isError) {
    return (
      <ErrorPanel
        message="Points aren't loading right now."
        actionLabel="Try again"
        onAction={() => rewards.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Points"
        description="What you've earned for showing up and doing the work."
      />

      {rewards.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Points"
            value={points}
            icon={Trophy}
            accent="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40"
          />
          <StatCard
            label="Coins"
            value={coins}
            icon={Coins}
            sub={`${perCoin} points = 1 coin`}
            accent="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
          />
          <StatCard
            label="To your next coin"
            value={toNextCoin}
            icon={Sparkles}
            sub={rewards.data?.season?.name}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Your earnings</CardTitle>
            <CardDescription>Every point you&apos;ve picked up this season</CardDescription>
          </CardHeader>
          <CardContent>
            {rewards.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : (rewards.data?.history.length ?? 0) === 0 ? (
              <EmptyState
                icon={Trophy}
                title="Nothing yet — but everything counts"
                description="Attend a lesson, finish your homework or sit a midterm, and your points will show up here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {rewards.data?.history.map((row) => {
                  const Icon = EVENT_ICON[row.event] ?? Sparkles;
                  return (
                    <li key={row.id} className="flex items-center gap-3 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{row.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.classroom_name ? `${row.classroom_name} · ` : ""}
                          {fmtDate(row.awarded_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        +{row.points}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to earn</CardTitle>
            <CardDescription>Served from the school&apos;s live rules</CardDescription>
          </CardHeader>
          <CardContent>
            {rules.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : rules.isError || !rules.data?.length ? (
              // A blank card reads as "there is nothing to earn", which is the opposite of true.
              <p className="px-2 py-3 text-sm text-muted-foreground">
                The rules aren&apos;t loading right now.{" "}
                <button type="button" onClick={() => rules.refetch()} className="font-semibold text-primary underline">
                  Try again
                </button>
              </p>
            ) : (
              <ul className="space-y-1.5">
                {rules.data?.map((rule) => (
                  <li
                    key={rule.event}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">{rule.label}</span>
                    <span className="shrink-0 font-semibold text-foreground">+{rule.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
