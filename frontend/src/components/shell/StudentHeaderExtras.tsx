"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import RewardCoin from "@/components/RewardCoin";
import { useMyRewards } from "@/features/rewards/rewardsHooks";
import { useOpenSurveys } from "@/features/surveys/surveysHooks";

/**
 * The student's top-bar controls: a running points/coins total, and a call to action that
 * appears only while a survey is waiting.
 *
 * Both were sidebar entries before. Neither belonged there — points are a number you want
 * to see change while you work, not a place you navigate to, and a survey exists only now
 * and then, so a permanent link to it is a dead entry most of the term.
 */
export function StudentHeaderExtras() {
  const rewards = useMyRewards();
  const surveys = useOpenSurveys();

  const points = rewards.data?.points;
  const coins = rewards.data?.coins;
  const open = surveys.data ?? [];
  // One waiting survey goes straight to the form; several go to the list to choose from.
  const surveyHref = open.length === 1 ? `/surveys/${open[0].id}` : "/surveys";

  return (
    <>
      {open.length > 0 ? (
        <Tooltip
          content={open.length === 1 ? open[0].title : `${open.length} surveys waiting`}
          side="bottom"
        >
          <Link
            href={surveyHref}
            aria-label={
              open.length === 1 ? `Survey waiting: ${open[0].title}` : `${open.length} surveys waiting`
            }
            // Desktop only — on a phone the same prompt is a row in the account menu, so
            // the top bar keeps to a hamburger, a title, the points and the avatar.
            className="ds-ring relative hidden h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover md:inline-flex md:px-3"
          >
            <ClipboardList className="h-[18px] w-[18px]" strokeWidth={2.25} />
            <span className="hidden sm:inline">Survey</span>
            {open.length > 1 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary-foreground px-1 text-[11px] font-extrabold text-primary">
                {open.length}
              </span>
            ) : null}
          </Link>
        </Tooltip>
      ) : null}

      <Tooltip content="Your points and coins" side="bottom">
        <Link
          href="/rewards"
          aria-label={
            points == null ? "Points and coins" : `${points} points, ${coins ?? 0} coins`
          }
          className={cn(
            "ds-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 shadow-sm transition-colors hover:border-primary/30 hover:bg-surface-2",
            "tabular-nums text-sm font-bold text-foreground",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <RewardCoin kind="point" size="sm" />
            {/* An em dash while it loads, and if the request fails: the pill stays a way in
                to the Points page either way, which vanishing entirely would not. */}
            <span>{points ?? "—"}</span>
          </span>
          {/* Coins drop off the narrowest screens — points are the number that moves daily,
              and the header still has a menu button, a bell, a theme toggle and an avatar
              to fit beside them. */}
          <span className="hidden items-center gap-1.5 border-l border-border pl-2 sm:inline-flex">
            <RewardCoin kind="coin" size="sm" />
            <span>{coins ?? "—"}</span>
          </span>
        </Link>
      </Tooltip>
    </>
  );
}

/**
 * The same two things as rows in the avatar menu, for the widths where the header cannot
 * carry them. Below `md` the survey prompt and the coin half of the pill are hidden, and
 * without these rows a student who has answered every survey could not reach `/surveys` on
 * a phone at all: the sidebar entry is hidden, the prompt is gone, and the page search does
 * not exist under 768px.
 */
export function StudentAccountMenuRows() {
  const rewards = useMyRewards();
  const surveys = useOpenSurveys();
  const open = surveys.data ?? [];

  return (
    <>
      {open.length > 0 ? (
        <Link
          role="menuitem"
          href={open.length === 1 ? `/surveys/${open[0].id}` : "/surveys"}
          className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 md:hidden"
        >
          <span className="inline-flex items-center gap-2.5">
            <ClipboardList className="h-4 w-4 text-primary" />
            Surveys
          </span>
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-extrabold text-primary">
            {open.length} open
          </span>
        </Link>
      ) : null}
      <Link
        role="menuitem"
        href="/rewards"
        className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 md:hidden"
      >
        <span className="inline-flex items-center gap-2.5">
          <RewardCoin kind="coin" size="sm" />
          Coins
        </span>
        <span className="ds-num text-sm font-bold text-muted-foreground">
          {rewards.data?.coins ?? "—"}
        </span>
      </Link>
    </>
  );
}

export default StudentHeaderExtras;
