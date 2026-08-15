"use client";

import {
  Sparkles,
  CalendarCheck,
  ClipboardList,
  FileText,
  LifeBuoy,
  MessageSquare,
  ArrowRightLeft,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so the wallet reads as part of the same product as the classroom.
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";
import { RewardCoin } from "@/components/RewardCoin";
import { useConvertPoints, useMyRewards, useMyWallet, useRewardRules } from "./rewardsHooks";
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

/**
 * A figure inside the blue. The coins are the school's own minted art, so they get the room
 * a plain icon would not earn — this is the one place on the platform a student sees them
 * full size.
 */
function WalletTile({
  media, label, value, sub,
}: {
  media?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  // A DARK scrim, not a lighter one. Measured: an 11px label at 72% white on a white/14 panel
  // over the hero gradient is 2.95:1 in light and 2.09:1 in dark — well under the 4.5:1 body
  // text needs, and these labels are the only thing naming which figure is which. Darkening
  // the panel and taking the text to full white gives 7.8:1 and 5.0:1.
  return (
    <div className="flex min-w-[150px] flex-1 items-center gap-3 rounded-2xl bg-black/[0.22] px-4 py-3.5">
      {media ? <span className="shrink-0">{media}</span> : null}
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.06em]">{label}</p>
        <p className="ds-num text-[28px] font-extrabold leading-none">{value}</p>
        {sub ? <p className="mt-1 truncate text-[11px] font-bold">{sub}</p> : null}
      </div>
    </div>
  );
}

export function RewardsPage() {
  const rewards = useMyRewards();
  const rules = useRewardRules();
  const wallet = useMyWallet();
  const convert = useConvertPoints();

  const points = rewards.data?.points ?? 0;
  const perCoin = rewards.data?.points_per_coin ?? 10;
  // Both figures come from the wallet. Deriving coins as `points / rate` here would keep
  // showing a student coins they have already spent — points are a score, coins are a
  // balance, and once coins are spendable the two stop agreeing.
  const coins = rewards.data?.coins ?? 0;
  const xp = rewards.data?.xp ?? 0;
  const toNextCoin = rewards.data?.points_to_next_coin ?? perCoin;
  const convertible = rewards.data?.convertible_coins ?? 0;

  if (rewards.isError) {
    return (
      <HeroPage>
        <Card className="cr-card">
          <ErrorState
            title="Points aren't loading right now."
            message="Nothing has been lost — the page just couldn't fetch your total."
            onRetry={() => void rewards.refetch()}
          />
        </Card>
      </HeroPage>
    );
  }

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero badge="Rewards" title="Points" description={PAGE_DESCRIPTION}>
          {rewards.isPending ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-white/[0.14]" />
              ))}
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <div className="flex flex-wrap gap-3">
                <WalletTile
                  media={<RewardCoin kind="point" size="lg" />}
                  label="Points"
                  value={points}
                />
                <WalletTile
                  media={<RewardCoin kind="coin" size="lg" />}
                  label="Coins"
                  value={coins}
                  sub={`${perCoin} points = 1 coin`}
                />
                {/* XP sits beside points rather than replacing them, because they answer
                    different questions and a student will notice the two disagree. The `sub`
                    says why before they have to ask. */}
                <WalletTile
                  media={
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20">
                      <Zap className="h-5 w-5" aria-hidden />
                    </span>
                  }
                  label="XP"
                  value={xp}
                  sub="Learning only — never goes down"
                />
              </div>

              {/* The conversion strip. Points no longer become coins on their own, so this is
                  the only thing standing between a student and their coins — it has to be
                  visible, and it has to say what it will do. When there is nothing to convert
                  it keeps its place and reports the distance instead of vanishing, so the
                  student learns where the button lives before they need it. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-black/[0.22] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.06em]">
                    {convertible > 0 ? "Ready to convert" : "To your next coin"}
                  </p>
                  <p className="mt-0.5 text-sm font-bold">
                    {convertible > 0
                      ? `Your points are worth ${convertible} coin${convertible === 1 ? "" : "s"}.`
                      : `${toNextCoin} more point${toNextCoin === 1 ? "" : "s"} and you can convert.`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => convert.mutate()}
                  disabled={convertible === 0 || convert.isPending}
                >
                  <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden />
                  {convert.isPending ? "Converting…" : "Convert to coins"}
                </Button>
              </div>

              {convert.isError ? (
                <p className="text-sm font-bold">
                  That didn&apos;t go through — your points are untouched. Try again.
                </p>
              ) : convert.data && convert.data.minted > 0 ? (
                <p className="text-sm font-bold">{convert.data.detail}</p>
              ) : null}
            </div>
          )}
        </PageHero>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="cr-card space-y-3 lg:col-span-2">
          <CardHeader title="Your earnings" description="Every point you've picked up so far" />
          {rewards.isPending ? (
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
              {rewards.data?.history.map((row, i) => {
                const Icon = EVENT_ICON[row.event] ?? Sparkles;
                return (
                  <li
                    key={row.id}
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    className="cr-rowin flex items-center gap-3 py-3"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{row.label}</p>
                      <p className="truncate text-xs font-semibold text-muted-foreground">
                        {row.classroom_name ? `${row.classroom_name} · ` : ""}
                        {fmtDate(row.awarded_at)}
                      </p>
                    </div>
                    <span className="ds-num shrink-0 text-sm font-extrabold text-emerald-600">
                      +{row.points}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="cr-card space-y-3">
          <CardHeader title="How to earn" description="Served from the school's live rules" />
          {rules.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
            </div>
          ) : rules.isError ? (
            <ErrorState
              title="The rules aren't loading right now."
              message="Your points are unaffected — only this list failed to load."
              onRetry={() => void rules.refetch()}
            />
          ) : !rules.data?.length ? (
            // A blank card reads as "there is nothing to earn", which is the opposite of true.
            <EmptyState
              icon={Sparkles}
              title="No earning rules yet"
              description="Your school is still tuning how points are awarded — they'll show up here."
            />
          ) : (
            <ul className="space-y-1">
              {rules.data?.map((rule) => (
                <li
                  key={rule.event}
                  className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate font-semibold text-muted-foreground">
                    {rule.label}
                  </span>
                  <span className="ds-num shrink-0 font-extrabold text-foreground">
                    +{rule.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(wallet.data?.transactions.length ?? 0) > 0 && (
        <Card className="cr-card space-y-3">
          <CardHeader title="Coin history" description="Coins you've earned and spent" />
          <ul className="divide-y divide-border">
            {wallet.data?.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">
                    {t.reference || t.label}
                  </p>
                  <p className="truncate text-xs font-semibold text-muted-foreground">
                    {fmtDate(t.created_at)}
                  </p>
                </div>
                <span
                  className={
                    t.amount >= 0
                      ? "ds-num shrink-0 text-sm font-extrabold text-emerald-600"
                      : "ds-num shrink-0 text-sm font-extrabold text-muted-foreground"
                  }
                >
                  {t.amount >= 0 ? `+${t.amount}` : t.amount}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </HeroPage>
  );
}
