"use client";

import { useState } from "react";
import { CalendarPlus, CalendarClock, Check, UserX, Trash2, Users, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SupportBooking } from "@/lib/api";
import {
  useMyAvailability,
  usePublishSlot,
  useWithdrawSlot,
  useSupportDiary,
  useSettleBooking,
} from "./supportHooks";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** `datetime-local` gives a naive string; the API takes ISO and the server localises it. */
function toIso(local: string) {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const STATUS_STYLE: Record<SupportBooking["status"], { label: string; variant: BadgeVariant }> = {
  BOOKED: { label: "Booked", variant: "info" },
  HELD: { label: "Held", variant: "success" },
  // Growth-oriented: the fact is recorded without naming the student a failure.
  NO_SHOW: { label: "Missed", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

export function SupportTeacherPage() {
  const availability = useMyAvailability();
  const diary = useSupportDiary();
  const publish = usePublishSlot();
  const withdraw = useWithdrawSlot();
  const settle = useSettleBooking();

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [note, setNote] = useState("");
  /** Slot awaiting a withdraw confirmation, or null when the dialog is closed. */
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);

  const errorDetail = (e: unknown) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  async function addSlot() {
    if (!start || !end) return;
    await publish.mutateAsync({
      starts_at: toIso(start),
      ends_at: toIso(end),
      capacity: Math.max(1, Number(capacity) || 1),
      note: note.trim() || undefined,
    });
    setStart(""); setEnd(""); setCapacity("1"); setNote("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support sessions"
        description="Publish times students can book, and record who actually attended."
      />

      {/* Scoped to the mutation that actually failed. `publish.error ?? settle.error`
          preferred the older failure, so a stale publish error mislabelled a later settle. */}
      {(publish.isError || settle.isError || withdraw.isError) && (
        <Alert
          tone="danger"
          title={
            errorDetail(
              settle.isError ? settle.error : withdraw.isError ? withdraw.error : publish.error,
            ) || "That didn't go through."
          }
        >
          Nothing has changed — you can try again.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            {/* CardHeader is a justify-between flex row, so the title block needs its own column. */}
            <div className="min-w-0">
              <CardTitle>Your availability</CardTitle>
              <CardDescription>Only students from your assigned classes can book these</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
              <p className="ds-overline">New slot</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Starts" htmlFor="support-slot-start">
                  <Input
                    id="support-slot-start"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </Field>
                <Field label="Ends" htmlFor="support-slot-end">
                  <Input
                    id="support-slot-end"
                    type="datetime-local"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Seats" htmlFor="support-slot-seats">
                  <Input
                    id="support-slot-seats"
                    type="number"
                    min={1}
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                  />
                </Field>
                <Field label="Note" htmlFor="support-slot-note">
                  <Input
                    id="support-slot-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </div>
              <Button
                fullWidth
                leftIcon={<CalendarPlus aria-hidden />}
                loading={publish.isPending}
                disabled={!start || !end || publish.isPending}
                onClick={addSlot}
              >
                {publish.isPending ? "Publishing…" : "Publish slot"}
              </Button>
            </div>

            {availability.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : availability.isError ? (
              // "No slots published yet" on a failed load would invite the teacher to
              // publish a duplicate of a slot that already exists.
              <div className="space-y-3">
                <Alert tone="danger" title="Couldn't load your slots">
                  Your published times are unchanged — only this list failed to load.
                </Alert>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw aria-hidden />}
                  onClick={() => void availability.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (availability.data?.length ?? 0) === 0 ? (
              <EmptyState
                compact
                icon={CalendarPlus}
                title="No slots published yet"
                description="Publish a time above and students from your classes can book it."
              />
            ) : (
              <ul className="divide-y divide-border">
                {availability.data?.map((slot) => (
                  <li key={slot.id} className={cn("flex items-center justify-between gap-3 py-2.5", slot.is_cancelled && "opacity-50")}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{fmtWhen(slot.starts_at)}</p>
                      <p className="text-xs text-muted-foreground">
                        {slot.is_cancelled ? "Withdrawn" : <span className="ds-num">{slot.seats_left} of {slot.capacity} free</span>}
                        {slot.note ? ` · ${slot.note}` : ""}
                      </p>
                    </div>
                    {!slot.is_cancelled && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        disabled={withdraw.isPending}
                        onClick={() => setWithdrawingId(slot.id)}
                        className="shrink-0 text-danger hover:bg-danger-soft hover:text-danger-foreground"
                        aria-label="Withdraw slot"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Who booked you</CardTitle>
              <CardDescription>Marking a session held is what awards the student their points</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {diary.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : diary.isError ? (
              // "Nothing booked yet" would tell a teacher no one is coming. They would then
              // not turn up, and the students who did book lose their session and their points.
              <div className="space-y-3">
                <Alert tone="danger" title="Couldn't load your bookings">
                  Students who booked you are still expected — only this list failed to load.
                </Alert>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw aria-hidden />}
                  onClick={() => void diary.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (diary.data?.length ?? 0) === 0 ? (
              <EmptyState
                compact
                icon={CalendarClock}
                title="Nothing booked yet"
                description="Publish a slot and bookings will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {diary.data?.map((b) => (
                  <li key={b.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{b.student}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtWhen(b.slot.starts_at)}
                          {b.classroom_name ? ` · ${b.classroom_name}` : ""}
                        </p>
                        {b.topic && <p className="mt-0.5 text-xs text-muted-foreground">{b.topic}</p>}
                      </div>
                      <Badge variant={STATUS_STYLE[b.status].variant} className="shrink-0">
                        {STATUS_STYLE[b.status].label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<Check aria-hidden />}
                        disabled={settle.isPending || b.status === "HELD"}
                        onClick={() => settle.mutate({ bookingId: b.id, status: "HELD" })}
                      >
                        Attended
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<UserX aria-hidden />}
                        disabled={settle.isPending || b.status === "NO_SHOW"}
                        onClick={() => settle.mutate({ bookingId: b.id, status: "NO_SHOW" })}
                      >
                        Didn&apos;t attend
                      </Button>
                      {b.slot.capacity > 1 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Users className="h-3 w-3" aria-hidden /> group of <span className="ds-num">{b.slot.capacity}</span>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Withdrawing cancels every booking on the slot, so it stays behind a confirmation. */}
      <Modal
        open={withdrawingId !== null}
        onClose={() => setWithdrawingId(null)}
        size="sm"
        title="Withdraw this slot?"
        description="Anyone who booked it will be cancelled. You can publish a new time whenever you like."
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawingId(null)}>Keep it</Button>
            <Button
              variant="danger"
              disabled={withdraw.isPending}
              onClick={() => {
                if (withdrawingId !== null) withdraw.mutate(withdrawingId);
                setWithdrawingId(null);
              }}
            >
              Withdraw slot
            </Button>
          </>
        }
      />
    </div>
  );
}
