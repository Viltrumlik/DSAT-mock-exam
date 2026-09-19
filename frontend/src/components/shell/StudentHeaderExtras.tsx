"use client";

import Link from "next/link";
import { CalendarDays, ClipboardList } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { RewardCoin } from "@/components/RewardCoin";
import { useUpcomingEvents } from "@/features/events/eventsHooks";
import { useMyRewards } from "@/features/rewards/rewardsHooks";
import { useOpenSurveys } from "@/features/surveys/surveysHooks";

/**
 * The student's top-bar controls: a call to action that appears only while a survey is
 * waiting, a permanent way into Events, and a running points/coins total.
 *
 * Points and the survey prompt were sidebar entries before. Neither belonged there — points
 * are a number you want to see change while you work, not a place you navigate to, and a
 * survey exists only now and then, so a permanent link to it is a dead entry most of the
 * term.
 *
 * Events is the opposite case, and the owner said so: it is the student's standing way to
 * the events list and to the ticket for the seat they hold, so it stays put whatever the
 * list says. It is also the ONLY place it is offered now — the dashboard card that used to
 * carry the nearest event was removed with this change.
 */
export function StudentHeaderExtras() {
  const rewards = useMyRewards();
  const surveys = useOpenSurveys();
  const events = useUpcomingEvents();
  const upcoming = events.data ?? [];
  const openEvents = upcoming.filter((row) => row.can_sign_up);
  // The seat the student is already holding. `can_sign_up` turns false the moment they take
  // one, so an Events button gated on it vanished at exactly the wrong moment: the student
  // who HAD signed up lost their only desktop route to their own ticket, the joining details
  // and the cancel button. The owner reported it as "signup qilgandan keyin navbardagi
  // events yo'qolib qolyapti". The button is permanent now — Events is a place the student
  // goes, like Points, not a notice that is spent once it has been read.
  const mySeat = upcoming.find((row) => row.my_registration?.status === "REGISTERED") ?? null;
  // A FAILED request is not "no events", and must not read as "nothing on": the button is
  // there either way, and the label is what tells the two apart.
  const eventsFailed = events.isError;
  const eventsLabel = eventsFailed
    ? "Events — couldn’t check for new ones"
    : openEvents.length === 1
      ? `Events — sign-up open: ${openEvents[0].title}`
      : openEvents.length > 1
        ? `Events — ${openEvents.length} open for sign-up`
        : mySeat
          ? `Events — you’re signed up for ${mySeat.title}`
          : upcoming.length > 0
            ? `Events — next: ${upcoming[0].title}`
            : "Events — nothing coming up yet";

  const points = rewards.data?.points;
  const coins = rewards.data?.coins;
  const open = surveys.data ?? [];
  // One waiting survey goes straight to the form; several go to the list to choose from.
  const surveyHref = open.length === 1 ? `/surveys/${open[0].id}` : "/surveys";
  // A FAILED request is not "no surveys". `data ?? []` collapses the two into an identical
  // empty array, and this prompt is the student's only way onto /surveys on desktop — so a
  // dropped connection used to remove the entry point AND the retry button behind it, and
  // quietly cost them the points. On an error the prompt stays, without a count it cannot
  // honestly claim, and /surveys shows the failure and offers the retry.
  const failed = surveys.isError;
  const showPrompt = open.length > 0 || failed;

  return (
    <>
      {showPrompt ? (
        <Tooltip
          content={
            failed
              ? "Surveys — couldn’t check for new ones"
              : open.length === 1
                ? open[0].title
                : `${open.length} surveys waiting`
          }
          side="bottom"
        >
          <Link
            href={failed ? "/surveys" : surveyHref}
            aria-label={
              failed
                ? "Surveys"
                : open.length === 1
                  ? `Survey waiting: ${open[0].title}`
                  : `${open.length} surveys waiting`
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

      <Tooltip content={eventsLabel} side="bottom">
        <Link
          href="/events"
          aria-label={eventsLabel}
          // Desktop only, like the survey prompt: on a phone the same thing is a row in
          // the account menu, and the top bar has a hamburger, a title, the points pill,
          // a bell, a theme toggle and an avatar to fit already.
          className="ds-ring relative hidden h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary/30 hover:bg-surface-2 md:inline-flex md:px-3"
        >
          <CalendarDays className="h-[18px] w-[18px] text-primary" strokeWidth={2.25} />
          <span className="hidden sm:inline">Events</span>
          {/* The count is on from ONE open event now. While the button came and went, its
              mere presence said "something is open"; a permanent button says nothing by
              being there, so the number has to. */}
          {openEvents.length > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary-soft px-1 text-[11px] font-extrabold text-primary">
              {openEvents.length}
            </span>
          ) : null}
        </Link>
      </Tooltip>

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
  const events = useUpcomingEvents();
  const openEvents = (events.data ?? []).filter((row) => row.can_sign_up);

  return (
    <>
      {/* Always here, never gated on the count — which is what the note above this component
          promised and the `open.length > 0` guard quietly took back. On a phone this row is
          the ONLY route to /surveys: the sidebar entry is hidden and the header prompt is
          desktop-only, so a student who had answered everything (or whose request failed)
          could not reach the page at all. */}
      <Link
        role="menuitem"
        href={open.length === 1 ? `/surveys/${open[0].id}` : "/surveys"}
        className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 md:hidden"
      >
        <span className="inline-flex items-center gap-2.5">
          <ClipboardList className="h-4 w-4 text-primary" />
          Surveys
        </span>
        {open.length > 0 ? (
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-extrabold text-primary">
            {open.length} open
          </span>
        ) : null}
      </Link>
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
      <Link
        role="menuitem"
        href="/events"
        className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 md:hidden"
      >
        <span className="inline-flex items-center gap-2.5">
          <CalendarDays className="h-4 w-4 text-primary" />
          Events
        </span>
        {openEvents.length > 0 ? (
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-extrabold text-primary">
            {openEvents.length} open
          </span>
        ) : null}
      </Link>
    </>
  );
}

