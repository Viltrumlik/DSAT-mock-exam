"use client";

import { useMemo, useState } from "react";
import { CalendarClock, LifeBuoy, Check, X, Users } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import ErrorPanel from "@/components/ErrorPanel";
import { cn } from "@/lib/cn";
import type { SupportBooking } from "@/lib/api";
import {
  useSupportSlots,
  useMySupportBookings,
  useBookSupport,
  useCancelSupportBooking,
} from "./supportHooks";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_STYLE: Record<SupportBooking["status"], { label: string; tone: string }> = {
  BOOKED: { label: "Booked", tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  HELD: { label: "Attended", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  // Growth-oriented: the fact is recorded without naming the student a failure.
  NO_SHOW: { label: "Missed", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-2 text-muted-foreground" },
};

export function SupportBookingPage() {
  const slots = useSupportSlots();
  const bookings = useMySupportBookings();
  const book = useBookSupport();
  const cancel = useCancelSupportBooking();
  const [topicFor, setTopicFor] = useState<number | null>(null);
  const [topic, setTopic] = useState("");

  const bookedSlotIds = useMemo(
    () => new Set((bookings.data ?? []).filter((b) => b.status === "BOOKED").map((b) => b.slot.id)),
    [bookings.data],
  );

  if (slots.isError) {
    return <ErrorPanel message="Support sessions aren't loading right now." actionLabel="Try again" onAction={() => slots.refetch()} />;
  }

  async function confirm(availability_id: number) {
    await book.mutateAsync({ availability_id, topic: topic.trim() || undefined });
    setTopicFor(null);
    setTopic("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support sessions"
        description="Book time with a support teacher from one of your classes. Attending one earns you points."
      />

      {book.isError && (
        <ErrorPanel
          message={
            (book.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            "That booking didn't go through."
          }
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Available times</CardTitle>
            <CardDescription>Only support teachers from your own classes appear here</CardDescription>
          </CardHeader>
          <CardContent>
            {slots.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : (slots.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No times published yet"
                description="When a support teacher from one of your classes opens a slot, it will show up here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {slots.data?.map((slot) => {
                  const full = (slot.seats_left ?? 0) <= 0;
                  const mine = bookedSlotIds.has(slot.id);
                  return (
                    <li key={slot.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{slot.support_teacher}</p>
                          <p className="text-xs text-muted-foreground">{fmtWhen(slot.starts_at)}</p>
                          {slot.note && <p className="mt-0.5 text-xs text-muted-foreground">{slot.note}</p>}
                          {slot.capacity > 1 && (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Users className="h-3 w-3" /> {slot.seats_left} of {slot.capacity} seats left
                            </p>
                          )}
                        </div>
                        {mine ? (
                          <span className="shrink-0 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">Booked</span>
                        ) : (
                          <button
                            type="button"
                            disabled={full || book.isPending}
                            onClick={() => { setTopicFor(slot.id); setTopic(""); }}
                            className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {full ? "Full" : "Book"}
                          </button>
                        )}
                      </div>
                      {topicFor === slot.id && (
                        <div className="mt-2 flex gap-2">
                          <input
                            autoFocus
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder="What do you need help with? (optional)"
                            className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <button type="button" disabled={book.isPending} onClick={() => confirm(slot.id)}
                            className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                            Confirm
                          </button>
                          <button type="button" onClick={() => setTopicFor(null)}
                            className="shrink-0 rounded-xl px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2">
                            Cancel
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your sessions</CardTitle>
            <CardDescription>Points arrive once your teacher confirms you attended</CardDescription>
          </CardHeader>
          <CardContent>
            {bookings.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            ) : (bookings.data?.length ?? 0) === 0 ? (
              <EmptyState icon={LifeBuoy} title="No sessions yet" description="Book a time and it will appear here." />
            ) : (
              <ul className="divide-y divide-border">
                {bookings.data?.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{b.slot.support_teacher}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtWhen(b.slot.starts_at)}
                        {b.classroom_name ? ` · ${b.classroom_name}` : ""}
                      </p>
                      {b.topic && <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.topic}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={cn("rounded-lg px-2.5 py-1 text-xs font-bold", STATUS_STYLE[b.status].tone)}>
                        {STATUS_STYLE[b.status].label}
                      </span>
                      {b.status === "BOOKED" && (
                        <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(b.id)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 disabled:opacity-50" aria-label="Cancel booking">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      {b.status === "HELD" && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                    </div>
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
