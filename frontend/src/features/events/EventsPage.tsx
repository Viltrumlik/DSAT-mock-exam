"use client";

/**
 * The student's events page: what is coming up, and the seats they hold.
 *
 * Built from the same two kits the surveys page uses, so an event reads as part of the same
 * product as a classroom. Every "may I" question is answered by the server (`can_sign_up`,
 * `can_cancel`); this file only renders the answer, because a second copy of the seat rules
 * here is a second place for them to drift.
 */

import { CalendarDays, Clock, MapPin, Ticket } from "lucide-react";

import { HeroPage, PageHero, Skeleton } from "@/components/ui";
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";
import { RewardCoin } from "@/components/RewardCoin";

import { refusalText, type LearningEvent } from "./eventsApi";
import {
  useCancelEventSeat,
  useMyEvents,
  useSignUpForEvent,
  useTicketDownload,
  useUpcomingEvents,
} from "./eventsHooks";

function fmtDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function seatLine(row: LearningEvent): string {
  if (row.seats_left <= 0) return "Full";
  return `${row.seats_left} seats left`;
}

function EventRow({ row, past }: { row: LearningEvent; past?: boolean }) {
  const signUp = useSignUpForEvent();
  const cancel = useCancelEventSeat();
  const ticket = useTicketDownload();
  const seat = row.my_registration;
  const holdsSeat = seat?.status === "REGISTERED";

  return (
    <li className="cr-rowin flex flex-wrap items-center gap-3 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <CalendarDays className="h-[18px] w-[18px]" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-foreground">{row.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {fmtDay(row.starts_at)} · {fmtTime(row.starts_at)}
          </span>
          {row.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden />
              {row.location}
            </span>
          ) : null}
          {!past ? <span>{seatLine(row)}</span> : null}
        </p>
      </div>

      {past ? (
        <span className="text-xs font-extrabold text-muted-foreground">
          {seat?.attendance === "ATTENDED" ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <RewardCoin kind="point" size="xs" />
              {/* The number comes from the award itself — never a figure written in here. */}
              Attended · +<span className="ds-num">{seat.points_awarded}</span> XP
            </span>
          ) : seat?.attendance === "MISSED" ? (
            "Missed"
          ) : (
            "Not marked yet"
          )}
        </span>
      ) : row.can_sign_up ? (
        <button
          type="button"
          onClick={() => signUp.mutate(row.id)}
          disabled={signUp.isPending}
          className="ds-ring rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground"
        >
          Sign up
        </button>
      ) : holdsSeat && row.can_cancel ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-success-foreground">
            <Ticket className="h-3.5 w-3.5" aria-hidden />
            You're signed up
          </span>
          <button
            type="button"
            onClick={() => cancel.mutate(row.id)}
            disabled={cancel.isPending}
            className="ds-ring rounded-xl px-3 py-2 text-sm font-extrabold text-muted-foreground"
          >
            Cancel
          </button>
        </div>
      ) : holdsSeat ? (
        <span className="text-xs font-extrabold text-muted-foreground">
          You're signed up · can't cancel within 2 hours
        </span>
      ) : (
        <span className="text-xs font-extrabold text-muted-foreground">Full</span>
      )}

      {/* Both branches where the student still holds a seat — the cancel window can be open
          or closed, but the seat is the seat, so the ticket is offered either way. */}
      {!past && holdsSeat ? (
        <>
          <button
            type="button"
            onClick={() => ticket.mutate(row.id)}
            disabled={ticket.isPending}
            className="ds-ring inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-extrabold text-foreground"
          >
            <Ticket className="h-4 w-4 text-primary" aria-hidden />
            Download ticket
          </button>
          {seat?.ticket_code ? (
            <span className="text-xs font-bold tracking-widest text-muted-foreground">
              Ticket {seat.ticket_code}
            </span>
          ) : null}
        </>
      ) : null}

      {signUp.isError ? (
        <p role="alert" className="w-full text-xs font-semibold text-danger-foreground">
          {refusalText(signUp.error) ?? "Couldn't do that. Try again."}
        </p>
      ) : cancel.isError ? (
        <p role="alert" className="w-full text-xs font-semibold text-danger-foreground">
          {refusalText(cancel.error) ?? "Couldn't do that. Try again."}
        </p>
      ) : ticket.isError ? (
        <p role="alert" className="w-full text-xs font-semibold text-danger-foreground">
          Couldn't download the ticket. Try again.
        </p>
      ) : null}
    </li>
  );
}

export function EventsPage() {
  const upcoming = useUpcomingEvents();
  const mine = useMyEvents();
  const openCount = upcoming.data?.filter((row) => row.can_sign_up).length ?? 0;
  const past = (mine.data ?? []).filter((row) => new Date(row.ends_at).getTime() < Date.now());

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Events"
          icon={CalendarDays}
          title="Events"
          description="Workshops, talks and open days at the learning center. Take a seat, turn up, earn XP."
          tiles={
            openCount > 0
              ? [{
                  label: "Open for sign-up",
                  value: `${openCount} event${openCount === 1 ? "" : "s"}`,
                  accent: true,
                  icon: CalendarDays,
                }]
              : []
          }
        />
      </Card>

      <Card className="cr-card space-y-3">
        <CardHeader title="Coming up" description="Sign up while there are seats" />
        {upcoming.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : upcoming.isError ? (
          // Not an empty state: "nothing on" would quietly cost the student a seat.
          <ErrorState
            title="Events didn't load."
            message="They'll be here as soon as the connection comes back."
            onRetry={() => void upcoming.refetch()}
          />
        ) : (upcoming.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing coming up"
            description="When the learning center puts an event on, it shows up here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.data?.map((row) => (
              <EventRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="cr-card space-y-3">
        <CardHeader title="My events" description="Ones you've been to" />
        {mine.isPending ? (
          <Skeleton className="h-14 rounded-xl" />
        ) : mine.isError ? (
          <ErrorState
            title="Your events didn't load."
            message="Try again in a moment."
            onRetry={() => void mine.refetch()}
          />
        ) : past.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title="Nothing yet"
            description="Events you've been to will be listed here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {past.map((row) => (
              <EventRow key={row.id} row={row} past />
            ))}
          </ul>
        )}
      </Card>
    </HeroPage>
  );
}
