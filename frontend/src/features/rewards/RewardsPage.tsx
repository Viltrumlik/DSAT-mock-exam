"use client";

import {
  Sparkles,
  CalendarCheck,
  ClipboardList,
  FileText,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Alert,
  Button,
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
import RewardCoin from "@/components/RewardCoin";
import { useMyRewards, useMyWallet, useRewardRules } from "./rewardsHooks";
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

const PAGE_DESCRIPTION = "What you've earned for showing up and doing the work.";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RewardsPage() {
  const rewards = useMyRewards();
  const rules = useRewardRules();
  const wallet = useMyWallet();

  const points = rewards.data?.points ?? 0;
  const perCoin = rewards.data?.points_per_coin ?? 10;
  // Both figures come from the wallet. Deriving coins as `points / rate` here would keep
  // showing a student coins they have already spent — points are a score, coins are a
  // balance, and once coins are spendable the two stop agreeing.
  const coins = rewards.data?.coins ?? 0;
  const toNextCoin = rewards.data?.points_to_next_coin ?? perCoin;

  if (rewards.isError) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Rewards" title="Points" description={PAGE_DESCRIPTION} />
        {/* Alert + retry sit in one group, the same shape every other error surface uses. */}
        <div className="space-y-3">
          <Alert tone="danger" title="Points aren't loading right now.">
            Nothing has been lost — the page just couldn&apos;t fetch your total.
          </Alert>
          <Button
            variant="secondary"
            leftIcon={<RefreshCw />}
            onClick={() => void rewards.refetch()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rewards" title="Points" description={PAGE_DESCRIPTION} />

      {rewards.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Points" value={points} media={<RewardCoin kind="point" size="md" />} />
          <StatCard
            label="Coins"
            value={coins}
            media={<RewardCoin kind="coin" size="md" />}
            sub={`${perCoin} points = 1 coin`}
          />
          <StatCard
            label="To your next coin"
            value={toNextCoin}
            icon={Sparkles}
            sub={rewards.data?.season?.name}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Your earnings</CardTitle>
              <CardDescription>Every point you&apos;ve picked up this season</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {rewards.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 rounded-xl" />
                <Skeleton className="h-14 rounded-xl" />
                <Skeleton className="h-14 rounded-xl" />
              </div>
            ) : (rewards.data?.history.length ?? 0) === 0 ? (
              <EmptyState
                media={<RewardCoin kind="point" size="xl" />}
                title="Nothing yet — but everything counts"
                description="Attend a lesson, finish your homework or sit a midterm, and your points will show up here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {rewards.data?.history.map((row) => {
                  const Icon = EVENT_ICON[row.event] ?? Sparkles;
                  return (
                    <li key={row.id} className="flex items-center gap-3 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{row.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.classroom_name ? `${row.classroom_name} · ` : ""}
                          {fmtDate(row.awarded_at)}
                        </p>
                      </div>
                      <span className="ds-num shrink-0 text-sm font-semibold text-success-foreground">
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
            <div className="min-w-0">
              <CardTitle>How to earn</CardTitle>
              <CardDescription>Served from the school&apos;s live rules</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {rules.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 rounded-lg" />
                <Skeleton className="h-8 rounded-lg" />
                <Skeleton className="h-8 rounded-lg" />
              </div>
            ) : rules.isError ? (
              <div className="space-y-3">
                <Alert tone="danger" title="The rules aren't loading right now.">
                  Your points are unaffected — only this list failed to load.
                </Alert>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<RefreshCw />}
                  onClick={() => void rules.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : !rules.data?.length ? (
              // A blank card reads as "there is nothing to earn", which is the opposite of true.
              <EmptyState
                compact
                icon={Sparkles}
                title="No earning rules yet"
                description="Your school is still tuning how points are awarded — they'll show up here."
              />
            ) : (
              <ul className="space-y-1.5">
                {rules.data?.map((rule) => (
                  <li
                    key={rule.event}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">{rule.label}</span>
                    <span className="ds-num shrink-0 font-semibold text-foreground">+{rule.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {(wallet.data?.transactions.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Coin history</CardTitle>
              <CardDescription>Coins you&apos;ve earned and spent</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {wallet.data?.transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {t.reference || t.label}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{fmtDate(t.created_at)}</p>
                  </div>
                  <span
                    className={
                      t.amount >= 0
                        ? "ds-num shrink-0 text-sm font-semibold text-success-foreground"
                        : "ds-num shrink-0 text-sm font-semibold text-muted-foreground"
                    }
                  >
                    {t.amount >= 0 ? `+${t.amount}` : t.amount}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
