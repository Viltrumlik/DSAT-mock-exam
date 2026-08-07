"use client";

import { useState } from "react";
import { CalendarPlus, CalendarClock, Check, UserX, Trash2, Users } from "lucide-react";
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

const STATUS_STYLE: Record<SupportBooking["status"], { label: string; tone: string }> = {
  BOOKED: { label: "Booked", tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  HELD: { label: "Held", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  NO_SHOW: { label: "Missed", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-2 text-muted-foreground" },
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

      {(publish.isError || settle.isError) && (
        <ErrorPanel message={errorDetail(publish.error ?? settle.error) || "That didn't go through."} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Your availability</CardTitle>
            <CardDescription>Only students from your assigned classes can book these</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-muted-foreground">Starts</span>
                  <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-muted-foreground">Ends</span>
                  <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-muted-foreground">Seats</span>
                  <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-muted-foreground">Note</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional"
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
              </div>
              <button type="button" disabled={!start || !end || publish.isPending} onClick={addSlot}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <CalendarPlus className="h-4 w-4" /> {publish.isPending ? "Publishing…" : "Publish slot"}
              </button>
            </div>

            <div className="mt-3">
              {availability.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              ) : (availability.data?.length ?? 0) === 0 ? (
                <p className="px-1 py-3 text-sm text-muted-foreground">No slots published yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {availability.data?.map((slot) => (
                    <li key={slot.id} className={cn("flex items-center justify-between gap-3 py-2.5", slot.is_cancelled && "opacity-50")}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{fmtWhen(slot.starts_at)}</p>
                        <p className="text-xs text-muted-foreground">
                          {slot.is_cancelled ? "Withdrawn" : `${slot.seats_left} of ${slot.capacity} free`}
                          {slot.note ? ` · ${slot.note}` : ""}
                        </p>
                      </div>
                      {!slot.is_cancelled && (
                        <button type="button" disabled={withdraw.isPending}
                          onClick={() => {
                            if (window.confirm("Withdraw this slot? Anyone who booked it will be cancelled.")) {
                              withdraw.mutate(slot.id);
                            }
                          }}
                          className="shrink-0 rounded-lg p-1.5 text-rose-600 hover:bg-rose-500/10 disabled:opacity-50" aria-label="Withdraw slot">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who booked you</CardTitle>
            <CardDescription>Marking a session held is what awards the student their points</CardDescription>
          </CardHeader>
          <CardContent>
            {diary.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : (diary.data?.length ?? 0) === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing booked yet" description="Publish a slot and bookings will appear here." />
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
                      <span className={cn("shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold", STATUS_STYLE[b.status].tone)}>
                        {STATUS_STYLE[b.status].label}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={settle.isPending || b.status === "HELD"}
                        onClick={() => settle.mutate({ bookingId: b.id, status: "HELD" })}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-surface-2 disabled:opacity-40">
                        <Check className="h-3.5 w-3.5" /> Attended
                      </button>
                      <button type="button" disabled={settle.isPending || b.status === "NO_SHOW"}
                        onClick={() => settle.mutate({ bookingId: b.id, status: "NO_SHOW" })}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-surface-2 disabled:opacity-40">
                        <UserX className="h-3.5 w-3.5" /> Didn&apos;t attend
                      </button>
                      {b.slot.capacity > 1 && (
                        <span className="inline-flex items-center gap-1 self-center text-[11px] text-muted-foreground">
                          <Users className="h-3 w-3" /> group of {b.slot.capacity}
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
    </div>
  );
}
