"use client";

import { useMemo, useState } from "react";
import { CalendarClock, LifeBuoy, Check, X, Users, RefreshCw } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Field,
  IconButton,
  Input,
  Skeleton,
  WorkspaceFrame,
  WorkspaceHeader,
} from "@/components/ui";
// The house state devices. The classroom folder is the kit these live in; importing them
// here is what makes this page read as part of the same product rather than a cousin of it.
import { EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import type { PillTone } from "@/features/classroom/ui";
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

const STATUS_STYLE: Record<SupportBooking["status"], { label: string; tone: PillTone }> = {
  BOOKED: { label: "Booked", tone: "info" },
  HELD: { label: "Attended", tone: "success" },
  // Growth-oriented: the fact is recorded without naming the student a failure.
  NO_SHOW: { label: "Missed", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
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

  async function confirm(availability_id: number) {
    await book.mutateAsync({ availability_id, topic: topic.trim() || undefined });
    setTopicFor(null);
    setTopic("");
  }

  return (
    <WorkspaceFrame className="space-y-6 pt-0">
      <WorkspaceHeader
        icon={LifeBuoy}
        title="Support sessions"
        description="Book time with a support teacher from one of your classes. Attending one earns you points."
      />

      {(book.isError || cancel.isError) && (
        <Alert
          tone="danger"
          title={
            ((book.error ?? cancel.error) as { response?: { data?: { detail?: string } } })
              ?.response?.data?.detail ||
            (book.isError ? "That booking didn't go through." : "That cancellation didn't go through.")
          }
        >
          Nothing has changed — you can try again.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Available times</CardTitle>
              <CardDescription>Only support teachers from your own classes appear here</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {slots.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : slots.isError ? (
              <ErrorState
                title="Support times aren't loading right now."
                message="Nothing is lost — the times will be here once the list loads."
                onRetry={() => void slots.refetch()}
              />
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
                              <Users className="h-3 w-3" aria-hidden />
                              <span className="ds-num">{slot.seats_left} of {slot.capacity}</span> seats left
                            </p>
                          )}
                        </div>
                        {mine ? (
                          <Pill tone="info" className="shrink-0">Booked</Pill>
                        ) : (
                          <Button
                            size="sm"
                            className="shrink-0"
                            disabled={full || book.isPending}
                            onClick={() => { setTopicFor(slot.id); setTopic(""); }}
                          >
                            {full ? "Full" : "Book"}
                          </Button>
                        )}
                      </div>
                      {topicFor === slot.id && (
                        <Field
                          className="mt-3"
                          label="What do you need help with?"
                          htmlFor={`support-topic-${slot.id}`}
                          hint="Optional — it helps your teacher prepare."
                        >
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <Input
                                id={`support-topic-${slot.id}`}
                                autoFocus
                                inputSize="sm"
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                placeholder="e.g. Reading inference questions"
                              />
                            </div>
                            <Button
                              size="sm"
                              className="shrink-0"
                              loading={book.isPending}
                              onClick={() => confirm(slot.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="shrink-0"
                              onClick={() => setTopicFor(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </Field>
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
            <div className="min-w-0">
              <CardTitle>Your sessions</CardTitle>
              <CardDescription>Points arrive once your teacher confirms you attended</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {bookings.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            ) : bookings.isError ? (
              // Not an empty state: "no sessions yet" would be a lie, and the Book buttons
              // opposite would offer slots this student has already taken.
              <div className="space-y-3">
                <Alert tone="danger" title="Couldn't load your sessions.">
                  Your bookings are safe — they'll appear once the list loads.
                </Alert>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw />}
                  onClick={() => void bookings.refetch()}
                >
                  Try again
                </Button>
              </div>
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
                      <Pill tone={STATUS_STYLE[b.status].tone}>{STATUS_STYLE[b.status].label}</Pill>
                      {b.status === "BOOKED" && (
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="Cancel booking"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(b.id)}
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </IconButton>
                      )}
                      {b.status === "HELD" && <Check className="h-4 w-4 text-success" aria-hidden />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </WorkspaceFrame>
  );
}
