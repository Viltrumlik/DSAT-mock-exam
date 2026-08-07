"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Check, Clock, LifeBuoy, Users, X } from "lucide-react";
import {
  Avatar,
  Field,
  HeroPage,
  Input,
  PageHero,
  Skeleton,
} from "@/components/ui";
// The house state devices. The classroom folder is the kit these live in; importing them
// here is what makes this page read as part of the same product rather than a cousin of it.
import { Button, Card, CardHeader, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import type { PillTone } from "@/features/classroom/ui";
import type { SupportBooking, SupportCalendarTeacher, SupportHour } from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import {
  useSupportCalendar,
  useMySupportBookings,
  useBookSupportHour,
  useCancelSupportBooking,
} from "./supportHooks";

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
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { title: iso, sub: "" };
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
};

export function SupportBookingPage() {
  const calendar = useSupportCalendar();
  const bookings = useMySupportBookings();
  const book = useBookSupportHour();
  const cancel = useCancelSupportBooking();
  const [picked, setPicked] = useState<{ teacherId: number; startsAt: string } | null>(null);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upcoming = useMemo(
    () => (bookings.data ?? []).filter((b) => b.status === "BOOKED").length,
    [bookings.data],
  );

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

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Support"
          title="Book a support session"
          description="Pick an hour with a support teacher from one of your classes. Attending one earns you points."
          tiles={[
            { label: "Open hours", value: `${pad(openHour)}:00–${pad(closeHour)}:00`, icon: Clock },
            { label: "You can book", value: `${calendar.data?.days ?? 4} days ahead` },
            {
              label: "Your sessions",
              value: `${upcoming} upcoming`,
              accent: true,
              icon: CalendarClock,
            },
          ]}
        />
      </Card>

      {calendar.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : calendar.isError ? (
        <Card className="cr-card">
          <ErrorState
            title="The calendar isn't loading right now."
            message="Nothing is lost — your teacher's free hours will be here once it loads."
            onRetry={() => void calendar.refetch()}
          />
        </Card>
      ) : (calendar.data?.teachers.length ?? 0) === 0 ? (
        <Card className="cr-card">
          <EmptyState
            icon={LifeBuoy}
            title="No support teacher on your classes yet"
            description="Once your class has a support teacher, their free hours appear here for you to book."
          />
        </Card>
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

      <Card className="cr-card">
        <CardHeader
          title="Your sessions"
          description="Points arrive once your teacher confirms you attended"
        />
        <div className="mt-3">
          {bookings.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          ) : bookings.isError ? (
            // Not an empty state: "no sessions yet" would be a lie, and the calendar above
            // would offer hours this student has already taken.
            <ErrorState
              title="Couldn't load your sessions."
              message="Your bookings are safe — they'll appear once the list loads."
              onRetry={() => void bookings.refetch()}
            />
          ) : (bookings.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={LifeBuoy}
              title="No sessions yet"
              description="Pick an hour above and it will appear here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {bookings.data?.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">
                      {b.slot.support_teacher}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtWhen(b.slot.starts_at)}
                      {b.classroom_name ? ` · ${b.classroom_name}` : ""}
                    </p>
                    {b.topic && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.topic}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Pill tone={STATUS_STYLE[b.status].tone}>{STATUS_STYLE[b.status].label}</Pill>
                    {b.status === "BOOKED" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={X}
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(b.id)}
                      >
                        Cancel
                      </Button>
                    )}
                    {b.status === "HELD" && (
                      <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
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
  const [dayIndex, setDayIndex] = useState(firstLive);
  const day = teacher.days[dayIndex] ?? teacher.days[0];
  const openCount = day?.hours.filter((h) => h.state === "open").length ?? 0;

  return (
    <Card className="cr-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={teacher.photo_url} name={teacher.name} size={44} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold text-foreground">{teacher.name}</p>
            <p className="truncate text-xs text-muted-foreground">
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

      {/* Day strip — scrolls rather than wraps, so the row stays one line on a phone. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {teacher.days.map((d, i) => {
          const label = dayLabel(d.date);
          const free = d.hours.filter((h) => h.state === "open").length;
          const active = i === dayIndex;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setDayIndex(i)}
              aria-pressed={active}
              className={cn(
                "ds-ring cr-press min-w-[92px] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-surface-2",
              )}
            >
              <span className="block text-sm font-extrabold">{label.title}</span>
              <span className="block text-[11px] font-semibold opacity-70">{label.sub}</span>
              <span
                className={cn(
                  "mt-1 block text-[11px] font-bold",
                  free > 0 ? "text-emerald-600" : "text-muted-foreground",
                )}
              >
                {free > 0 ? `${free} free` : "Full"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {day?.hours.map((h) => (
          <HourChip
            key={h.starts_at}
            hour={h}
            selected={picked === h.starts_at}
            onPick={() => onPick(h.starts_at)}
          />
        ))}
      </div>

      {picked ? (
        <div className="cr-rowin rounded-2xl border border-primary/30 bg-primary/[0.06] p-4">
          <p className="text-sm font-extrabold text-foreground">
            {dayLabel(day.date).title} · {fmtHour(picked)} with {teacher.name}
          </p>
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
    </Card>
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
      <div className="rounded-xl border border-primary bg-primary px-3 py-2.5 text-center text-primary-foreground">
        <span className="ds-num block text-sm font-extrabold">{time}</span>
        <span className="block text-[11px] font-bold opacity-90">Booked</span>
      </div>
    );
  }

  if (hour.state !== "open") {
    return (
      <div
        aria-disabled
        className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-center text-muted-foreground"
      >
        <span className="ds-num block text-sm font-bold line-through decoration-1">{time}</span>
        <span className="block text-[11px] font-semibold">{UNAVAILABLE_REASON[hour.state]}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "ds-ring cr-press rounded-xl border px-3 py-2.5 text-center transition-colors",
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
      )}
    >
      <span className="ds-num block text-sm font-extrabold">{time}</span>
      <span className="block text-[11px] font-semibold opacity-70">
        {hour.capacity > 1 ? (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            {hour.seats_left} left
          </span>
        ) : (
          "Free"
        )}
      </span>
    </button>
  );
}
