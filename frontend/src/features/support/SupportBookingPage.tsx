"use client";

/**
 * /support — a student books an hour with a support teacher from one of their classes.
 *
 * Dressed in the house's white quartz (the owner, 2026-09-13: "endi support pagega navbat"), and
 * in Support's own colour: the emerald its card wears on /services, so the card and the page it
 * opens read as one place. The blue banner is a quartz hero with its three facts as tiles; each
 * teacher's week is a block of quartz; the day strip picks the way the house tabs do, solid when
 * chosen; an hour is a small quartz chip, and one that cannot be taken fades instead of sitting in
 * a grey box. What the page says and does — the limits, the reasons, the confirm panel, the
 * rating — is exactly as it was.
 */

import { useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarRange,
  Check,
  Clock,
  Info,
  LifeBuoy,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, Field, HeroPage, Input, Skeleton } from "@/components/ui";
// The house state devices. The classroom folder is the kit these live in; importing them
// here is what makes this page read as part of the same product rather than a cousin of it.
import { Button, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import type { PillTone } from "@/features/classroom/ui";
import type { SupportBooking, SupportCalendarTeacher, SupportHour } from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import {
  useSupportCalendar,
  useMySupportBookings,
  useBookSupportHour,
  useCancelSupportBooking,
  useRateSupportSession,
} from "./supportHooks";
import { CancelBookingDialog } from "./CancelBookingDialog";
import { AddMemberDialog } from "./AddMemberDialog";
import { SessionRating } from "./SessionRating";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtHour(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Today" and "Tomorrow" earn their names; after that the weekday is what a student uses. */
function dayLabel(iso: string): { title: string; sub: string } {
  // Accepts a date ("2026-08-08") or a full instant; both must name the same day. The
  // instant has to be flattened to midnight first, or its time-of-day rounds the day
  // difference up and a 15:00 pick made today reads as "Tomorrow".
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { title: iso, sub: "" };
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const sub = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (diff === 0) return { title: "Today", sub };
  if (diff === 1) return { title: "Tomorrow", sub };
  return { title: d.toLocaleDateString(undefined, { weekday: "short" }), sub };
}

const STATUS_STYLE: Record<SupportBooking["status"], { label: string; tone: PillTone }> = {
  BOOKED: { label: "Booked", tone: "info" },
  HELD: { label: "Attended", tone: "success" },
  // Growth-oriented: the fact is recorded without naming the student a failure.
  NO_SHOW: { label: "Missed", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Why an hour cannot be taken, in the student's words. Silence would read as a broken button. */
const UNAVAILABLE_REASON: Record<Exclude<SupportHour["state"], "open" | "mine">, string> = {
  full: "Fully booked",
  closed: "Not available",
  past: "Already gone",
  // Its own wording, not folded into "Not available": a student deciding when to come in is
  // better served by "he isn't in then" than by a flat refusal that gives them nothing to
  // plan around.
  off: "Not working",
  // The only reason on this list that is about the student rather than the teacher, and the
  // only one they can do something about — so it says what they already have rather than
  // what the desk lacks.
  day_taken: "You have a session today",
};

/** A small pill action on a session row — the shape the house tabs and chips already use. */
function rowAction(kind: "primary" | "quiet") {
  return cn(
    "ds-ring cr-press inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-[inherit] text-[12.5px] font-bold transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    kind === "primary"
      ? "bg-primary/10 text-primary hover:bg-primary/15 dark:text-primary-hover"
      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
  );
}

export function SupportBookingPage() {
  const calendar = useSupportCalendar();
  const bookings = useMySupportBookings();
  const book = useBookSupportHour();
  const cancel = useCancelSupportBooking();
  const rate = useRateSupportSession();
  const [picked, setPicked] = useState<{ teacherId: number; startsAt: string } | null>(null);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The booking a student is part-way through calling off, or null when the dialog is shut. */
  const [cancelling, setCancelling] = useState<SupportBooking | null>(null);
  const [inviting, setInviting] = useState<SupportBooking | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const upcoming = useMemo(
    () => (bookings.data ?? []).filter((b) => b.status === "BOOKED").length,
    [bookings.data],
  );
  const allowance = calendar.data?.allowance ?? null;

  async function confirmCancel(reason: string) {
    if (!cancelling) return;
    setCancelError(null);
    try {
      await cancel.mutateAsync({ bookingId: cancelling.id, reason });
      setCancelling(null);
    } catch (e) {
      setCancelError(normalizeApiError(e).message);
    }
  }

  async function confirm() {
    if (!picked) return;
    setError(null);
    try {
      await book.mutateAsync({
        teacherId: picked.teacherId,
        startsAt: picked.startsAt,
        topic: topic.trim() || undefined,
      });
      setPicked(null);
      setTopic("");
    } catch (e) {
      setError(normalizeApiError(e).message);
    }
  }

  const openHour = calendar.data?.open_hour ?? 8;
  const closeHour = calendar.data?.close_hour ?? 18;
  const pad = (n: number) => String(n).padStart(2, "0");

  const tiles: { label: string; value: string; icon: LucideIcon; accent?: boolean }[] = [
    { label: "Open hours", value: `${pad(openHour)}:00–${pad(closeHour)}:00`, icon: Clock },
    { label: "You can book", value: `${calendar.data?.days ?? 4} days ahead`, icon: CalendarRange },
    {
      // The limit is shown here, before an hour is picked, rather than surfacing as
      // a refusal after one is. "1 of 2 booked" is a plan; "you can't book that" is
      // a wall.
      label: "Your sessions",
      value: allowance
        ? `${allowance.upcoming} of ${allowance.max_upcoming} booked`
        : `${upcoming} upcoming`,
      icon: CalendarClock,
      accent: true,
    },
  ];

  return (
    <HeroPage className="flex flex-col gap-6">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {/* cr-cardrise, not a float: nothing on the hero is clickable, so it must not lift. */}
      <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
        {/* Support's emerald as a thin edge, the mark its card carries on /services. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-success via-success/40 to-transparent"
        />
        <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8">
          <div className="flex items-start gap-4">
            <span className="squircle flex h-14 w-14 shrink-0 items-center justify-center bg-success/15 text-success-foreground [--sq:8.5px]">
              <LifeBuoy className="h-7 w-7" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center rounded-full bg-success/10 px-3 py-1 text-xs font-extrabold text-success-foreground">
                Support
              </span>
              <h1 className="mt-2.5 text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
                Book a support session
              </h1>
              <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
                Pick an hour with a support teacher from one of your classes — one session a day.
                Attending one earns you points.
              </p>
            </div>
          </div>

          {/* Three blocks of quartz on the hero's own white, as on the vocabulary set page. */}
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map((t, i) => (
              <div
                key={t.label}
                className="quartz squircle cr-cardrise relative overflow-hidden px-4 py-3.5 [--sq:10px]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <t.icon
                  aria-hidden
                  strokeWidth={1.25}
                  className="pointer-events-none absolute -bottom-3 -right-2 h-16 w-16 text-foreground/[0.05]"
                />
                <p className="relative text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                  {t.label}
                </p>
                <p
                  className={cn(
                    "ds-num relative mt-1.5 text-[22px] font-extrabold leading-none tracking-tight",
                    t.accent ? "text-success-foreground" : "text-foreground",
                  )}
                >
                  {t.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Said once, up front. The alternative is a student picking an hour, typing a topic,
          pressing Confirm and only then being told they are at their limit. */}
      {allowance && !allowance.can_book ? (
        <div className="squircle cr-rowin flex items-start gap-3 bg-warning/10 px-5 py-4 [--sq:11px]">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" aria-hidden />
          <div>
            <p className="text-sm font-bold text-foreground">
              You have {allowance.upcoming} session{allowance.upcoming === 1 ? "" : "s"} booked already
            </p>
            <p className="mt-1 text-[13px] font-medium text-muted-foreground">
              Attend one — or cancel it if you can&apos;t make it — and you can book another.
            </p>
          </div>
        </div>
      ) : null}

      {/* `isPending`, not `isLoading`: between retries `isLoading` drops to false while the
          data is still undefined, and the branch below it would flash "no support teacher" at
          a student whose request is merely being retried. */}
      {calendar.isPending ? (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="squircle h-64 [--sq:13px]" />
          <Skeleton className="squircle h-44 [--sq:13px]" />
        </div>
      ) : calendar.isError ? (
        <section className="quartz squircle [--sq:13px]">
          <ErrorState
            title="The calendar isn't loading right now."
            message="Nothing is lost — your teacher's free hours will be here once it loads."
            onRetry={() => void calendar.refetch()}
          />
        </section>
      ) : (calendar.data?.teachers.length ?? 0) === 0 ? (
        <section className="quartz squircle [--sq:13px]">
          <EmptyState
            icon={LifeBuoy}
            title="No support teacher on your classes yet"
            description="Once your class has a support teacher, their free hours appear here for you to book."
          />
        </section>
      ) : (
        calendar.data?.teachers.map((teacher) => (
          <TeacherCalendar
            key={teacher.id}
            teacher={teacher}
            picked={picked?.teacherId === teacher.id ? picked.startsAt : null}
            onPick={(startsAt) => {
              setError(null);
              setTopic("");
              setPicked(
                picked?.teacherId === teacher.id && picked.startsAt === startsAt
                  ? null
                  : { teacherId: teacher.id, startsAt },
              );
            }}
            topic={topic}
            onTopic={setTopic}
            onConfirm={confirm}
            onDismiss={() => { setPicked(null); setError(null); }}
            confirming={book.isPending}
            error={picked?.teacherId === teacher.id ? error : null}
          />
        ))
      )}

      {/* ── YOUR SESSIONS ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-[20px] font-extrabold tracking-[-0.015em] text-foreground">Your sessions</h2>
          <p className="ds-small mt-1">Points arrive once your teacher confirms you attended</p>
        </div>

        {bookings.isPending ? (
          <div className="quartz squircle space-y-2 p-4 [--sq:13px]" aria-hidden>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : bookings.isError ? (
          // Not an empty state: "no sessions yet" would be a lie, and the calendar above
          // would offer hours this student has already taken.
          <div className="quartz squircle [--sq:13px]">
            <ErrorState
              title="Couldn't load your sessions."
              message="Your bookings are safe — they'll appear once the list loads."
              onRetry={() => void bookings.refetch()}
            />
          </div>
        ) : (bookings.data?.length ?? 0) === 0 ? (
          <div className="quartz squircle [--sq:13px]">
            <EmptyState
              icon={LifeBuoy}
              title="No sessions yet"
              description="Pick an hour above and it will appear here."
            />
          </div>
        ) : (
          <ul className="quartz squircle cr-cardrise divide-y divide-border overflow-hidden [--sq:13px]">
            {bookings.data?.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-extrabold text-foreground">
                    {b.slot.support_teacher}
                  </p>
                  <p className="text-[12.5px] font-semibold text-muted-foreground">
                    {fmtWhen(b.slot.starts_at)}
                    {b.classroom_name ? ` · ${b.classroom_name}` : ""}
                  </p>
                  {b.topic && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.topic}</p>
                  )}
                  {/* What the teacher says the hour covered. Worth more to a student than
                      the green tick beside it — so it sits in a well of its own. */}
                  {b.teacher_note && (
                    <p className="squircle mt-2 flex items-start gap-1.5 bg-success/[0.08] px-3 py-2 text-xs font-semibold text-foreground [--sq:7px]">
                      <Info className="mt-0.5 h-3 w-3 shrink-0 text-success-foreground" aria-hidden />
                      <span>{b.teacher_note}</span>
                    </p>
                  )}
                  {b.invited_by && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {b.invited_by} added you to this one
                    </p>
                  )}
                  {b.status === "CANCELLED" && b.cancel_reason && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Cancelled — {b.cancel_reason}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={STATUS_STYLE[b.status].tone}>
                    {STATUS_STYLE[b.status].label}
                  </Pill>
                  {b.status === "BOOKED" && (
                    <button type="button" className={rowAction("primary")} onClick={() => setInviting(b)}>
                      <UserPlus className="h-3.5 w-3.5" aria-hidden />
                      Add a member
                    </button>
                  )}
                  {b.status === "BOOKED" && (
                    <button
                      type="button"
                      className={rowAction("quiet")}
                      disabled={cancel.isPending}
                      onClick={() => { setCancelError(null); setCancelling(b); }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      Cancel
                    </button>
                  )}
                  {b.status === "HELD" && (
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                  )}
                </div>
                {/* Only a session that happened can be rated — there is nothing to judge
                    about one that was cancelled, missed, or is still to come. */}
                {b.status === "HELD" && (
                  <div className="w-full">
                    <SessionRating
                      rating={b.rating}
                      comment={b.rating_comment}
                      pending={rate.isPending}
                      onRate={(rating, comment) =>
                        rate.mutate({ bookingId: b.id, rating, comment })
                      }
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddMemberDialog
        open={inviting !== null}
        bookingId={inviting?.id ?? null}
        teacherName={inviting?.slot.support_teacher ?? ""}
        when={inviting ? fmtWhen(inviting.slot.starts_at) : ""}
        onClose={() => setInviting(null)}
      />

      <CancelBookingDialog
        open={cancelling !== null}
        teacherName={cancelling?.slot.support_teacher ?? ""}
        when={cancelling ? fmtWhen(cancelling.slot.starts_at) : ""}
        pending={cancel.isPending}
        error={cancelError}
        onClose={() => { setCancelling(null); setCancelError(null); }}
        onConfirm={confirmCancel}
      />
    </HeroPage>
  );
}

function TeacherCalendar({
  teacher, picked, onPick, topic, onTopic, onConfirm, onDismiss, confirming, error,
}: {
  teacher: SupportCalendarTeacher;
  picked: string | null;
  onPick: (startsAt: string) => void;
  topic: string;
  onTopic: (v: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  confirming: boolean;
  error: string | null;
}) {
  // Open on the first day that still has an hour left, so a student arriving at 17:30 is not
  // shown a page of greyed-out cells and left to work out that tomorrow exists.
  const firstLive = Math.max(
    0,
    teacher.days.findIndex((d) => d.hours.some((h) => h.state === "open" || h.state === "mine")),
  );
  /** A day the student has already spent. Every hour on it carries the same state, so one
   *  hour is enough to know — and the day strip says so once instead of ten times. */
  const dayIsTaken = (d: { hours: SupportHour[] }) =>
    d.hours.some((h) => h.state === "day_taken" || h.state === "mine");
  const [dayIndex, setDayIndex] = useState(firstLive);
  const day = teacher.days[dayIndex] ?? teacher.days[0];
  const openCount = day?.hours.filter((h) => h.state === "open").length ?? 0;
  /** The hours worth showing: everything inside the weekly schedule. See the grid below.
   *  A spent day keeps its hours on screen — greyed, with the reason — because hiding them
   *  would leave the student looking at a blank day with no idea why. */
  const bookableHours = (day?.hours ?? []).filter((h) => h.state !== "off");
  const pickedNote = picked
    ? day?.hours.find((h) => h.starts_at === picked)?.note || ""
    : "";

  return (
    <section className="quartz squircle cr-cardrise space-y-4 p-5 [--sq:13px] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={teacher.photo_url} name={teacher.name} size={44} />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-extrabold tracking-[-0.01em] text-foreground">{teacher.name}</p>
            <p className="truncate text-xs font-medium text-muted-foreground">
              Support teacher
              {teacher.classrooms.length
                ? ` · ${teacher.classrooms.map((c) => c.name).join(", ")}`
                : ""}
            </p>
          </div>
        </div>
        <Pill tone={openCount > 0 ? "success" : "neutral"}>
          {openCount > 0 ? `${openCount} free` : "Nothing free"}
        </Pill>
      </div>

      {/* Day strip — scrolls rather than wraps, so the row stays one line on a phone. The
          vertical padding is the headroom the chosen day's shadow and the press lift need:
          `overflow-x-auto` clips the other axis too. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1.5">
        {teacher.days.map((d, i) => {
          const label = dayLabel(d.date);
          const free = d.hours.filter((h) => h.state === "open").length;
          // A day with nothing left is usually today, running out hour by hour — calling that
          // "Full" would blame the other students for what is just the clock.
          const gone = free === 0 && d.hours.every((h) => h.state === "past" || h.state === "mine");
          // A day the teacher does not work is not "Full" either. Three different reasons for
          // an empty day, three different words — a student who reads "Full" on a Sunday will
          // keep checking back for a cancellation that is never coming.
          const notWorking = d.hours.every((h) => h.state === "off");
          // Ahead of the other three: a student who has booked Wednesday needs the strip to
          // say so on Wednesday, not "Full" — which would send them looking for a
          // cancellation that would not help them anyway.
          const emptyLabel = dayIsTaken(d)
            ? "Booked"
            : notWorking
              ? "Not working"
              : gone
                ? "Day over"
                : "Full";
          const active = i === dayIndex;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => {
                // Drop the pick when the day changes. Without this the confirm panel stayed
                // open over a grid it no longer belonged to, with no chip highlighted —
                // and Confirm still booked the hour from the day the student had left.
                if (i !== dayIndex) onDismiss();
                setDayIndex(i);
              }}
              aria-pressed={active}
              // The visible text is three stacked fragments; without this a screen reader
              // reads "Today Aug 7 10 free" as one run-on and the button has no name.
              aria-label={`${label.title}, ${label.sub}, ${free > 0 ? `${free} hours free` : emptyLabel}`}
              className={cn(
                "ds-ring cr-press squircle min-w-[92px] shrink-0 px-3 py-2 text-left font-[inherit] transition-colors [--sq:9px]",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_6px_14px_-6px_var(--primary)]"
                  : "bg-surface-2 text-foreground hover:bg-surface-3",
              )}
            >
              <span className="block text-sm font-extrabold">{label.title}</span>
              <span className="block text-[11px] font-semibold opacity-70">{label.sub}</span>
              <span
                className={cn(
                  "mt-1 block text-[11px] font-bold",
                  free > 0
                    ? active
                      ? "text-primary-foreground"
                      : "text-emerald-600 dark:text-emerald-400"
                    : active
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                )}
              >
                {free > 0 ? `${free} free` : emptyLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hours outside the teacher's weekly schedule are DROPPED, not struck through.
          Everything else the student cannot take is still shown — "fully booked" and
          "withdrawn" are facts about this week that they need in order to plan. "He doesn't
          work Sunday mornings" is not: it is the shape of the timetable, and rendering it as
          eight struck-out chips a day buries the two hours that are actually bookable. */}
      {bookableHours.length === 0 ? (
        <div className="squircle border border-dashed border-border px-4 py-8 text-center [--sq:11px]">
          <p className="text-sm font-bold text-foreground">
            {teacher.name} isn&apos;t working on this day.
          </p>
          <p className="mt-1 text-[13px] font-semibold text-muted-foreground">
            Try another day above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {bookableHours.map((h) => (
            <HourChip
              key={h.starts_at}
              hour={h}
              selected={picked === h.starts_at}
              onPick={() => onPick(h.starts_at)}
            />
          ))}
        </div>
      )}

      {picked ? (
        <div className="squircle cr-rowin border border-primary/25 bg-primary/[0.06] p-4 [--sq:11px]">
          {/* Named off the pick itself, never off whichever day is on screen. */}
          <p className="text-sm font-extrabold text-foreground">
            {dayLabel(picked).title} · {fmtHour(picked)} with {teacher.name}
          </p>
          {/* The teacher's note for this hour. It is addressed to the student — "bring your
              Module 2 answer sheet" is no use only to the person who wrote it. */}
          {pickedNote ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] font-semibold text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{pickedNote}</span>
            </p>
          ) : null}
          <Field
            className="mt-3"
            label="What do you need help with?"
            htmlFor={`support-topic-${teacher.id}`}
            hint="Optional — it helps your teacher prepare."
          >
            <Input
              id={`support-topic-${teacher.id}`}
              autoFocus
              inputSize="sm"
              value={topic}
              onChange={(e) => onTopic(e.target.value)}
              placeholder="e.g. Reading inference questions"
            />
          </Field>
          {error ? <p className="mt-2 text-sm font-semibold text-rose-500">{error}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button loading={confirming} onClick={onConfirm}>Confirm booking</Button>
            <Button variant="ghost" onClick={onDismiss}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HourChip({
  hour, selected, onPick,
}: {
  hour: SupportHour;
  selected: boolean;
  onPick: () => void;
}) {
  const time = fmtHour(hour.starts_at);

  if (hour.state === "mine") {
    return (
      <div className="squircle bg-primary px-3 py-2.5 text-center text-primary-foreground shadow-[0_6px_14px_-8px_var(--primary)] [--sq:8px]">
        <span className="ds-num block text-sm font-extrabold">{time}</span>
        <span className="block text-[11px] font-bold opacity-90">Booked</span>
      </div>
    );
  }

  if (hour.state !== "open") {
    // Faded into the card rather than boxed in grey: it is still a fact about the week, but
    // it shouldn't compete with the hours that can actually be taken.
    return (
      <div
        aria-disabled
        className="squircle bg-foreground/[0.035] px-3 py-2.5 text-center text-muted-foreground [--sq:8px]"
      >
        <span className="ds-num block text-sm font-bold line-through decoration-1 opacity-70">{time}</span>
        <span className="block text-[11px] font-semibold">{UNAVAILABLE_REASON[hour.state]}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={`Book ${time}${hour.capacity > 1 ? `, ${hour.seats_left} seats left` : ""}`}
      className={cn(
        // A 2px border on every open chip, transparent until it means something, so picking
        // one doesn't nudge the grid. `.quartz` owns background and shadow, so the pick is
        // drawn with the border and a chip that isn't quartz any more.
        "ds-ring cr-press squircle border-2 px-3 py-2 text-center font-[inherit] transition-colors [--sq:8px]",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "quartz border-transparent text-foreground hover:border-primary/40",
      )}
    >
      <span className="ds-num block text-sm font-extrabold">{time}</span>
      <span
        className={cn(
          "flex items-center justify-center gap-1 text-[11px] font-bold",
          selected ? "text-primary" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {hour.capacity > 1 ? (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            {hour.seats_left} left
          </span>
        ) : (
          "Free"
        )}
        {/* Marks that the teacher left a note; the note itself shows once the hour is picked. */}
        {hour.note ? <Info className="h-3 w-3 shrink-0" aria-hidden /> : null}
      </span>
    </button>
  );
}
