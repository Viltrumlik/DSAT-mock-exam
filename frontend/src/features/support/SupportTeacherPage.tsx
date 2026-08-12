"use client";

import { useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  Info,
  LockOpen,
  RefreshCw,
  Star,
  UserX,
  Users,
} from "lucide-react";
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
  Input,
  Modal,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SupportBooking, SupportTeacherHour } from "@/lib/api";
import {
  useMySupportCalendar,
  useSetSupportHour,
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

function fmtHour(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Today" and "Tomorrow" earn their names; after that the weekday is what anyone uses. */
function dayLabel(iso: string): { title: string; sub: string } {
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

const STATUS_STYLE: Record<SupportBooking["status"], { label: string; variant: BadgeVariant }> = {
  BOOKED: { label: "Booked", variant: "info" },
  HELD: { label: "Held", variant: "success" },
  // Growth-oriented: the fact is recorded without naming the student a failure.
  NO_SHOW: { label: "Missed", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * The support desk, from behind it.
 *
 * The old page asked the teacher to publish slots one datetime-local at a time. That stopped
 * matching the product when hours went opt-out: every hour 08:00–18:00 is already bookable,
 * so publishing is not the job. The job is *seeing the week* — who is coming, what is still
 * free — and withdrawing the hours you cannot do. So the page leads with the same grid the
 * students see, and the list underneath is for recording what happened.
 */
export function SupportTeacherPage() {
  const calendar = useMySupportCalendar();
  const diary = useSupportDiary();
  const setHour = useSetSupportHour();
  const settle = useSettleBooking();

  const [dayIndex, setDayIndex] = useState(0);
  /** The hour whose withdraw confirmation is open, or null. Withdrawing cancels the
   *  bookings on it, so it never happens on a single click. */
  const [withdrawing, setWithdrawing] = useState<SupportTeacherHour | null>(null);

  const errorDetail = (e: unknown) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  const day = calendar.data?.days_out[dayIndex] ?? calendar.data?.days_out[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support sessions"
        description="Your week at the desk — who's coming, what's free, and what happened."
      />

      {/* Scoped to the mutation that actually failed, so a stale error cannot mislabel a
          later one. */}
      {(setHour.isError || settle.isError) && (
        <Alert
          tone="danger"
          title={errorDetail(settle.isError ? settle.error : setHour.error) || "That didn't go through."}
        >
          Nothing has changed — you can try again.
        </Alert>
      )}

      {calendar.isPending ? (
        <div className="space-y-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
      ) : calendar.isError ? (
        // Not an empty week: a teacher told "nothing booked" does not turn up, and the
        // students who did book lose their session and their points.
        <Card>
          <CardContent className="space-y-3">
            <Alert tone="danger" title="Couldn't load your week">
              Your hours and bookings are unchanged — only this view failed to load.
            </Alert>
            <Button variant="secondary" size="sm" leftIcon={<RefreshCw aria-hidden />} onClick={() => void calendar.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Free hours" value={calendar.data.free_hours} icon={Clock} />
            <Stat label="Booked" value={calendar.data.booked_sessions} icon={CalendarClock} accent />
            <Stat
              label="To record"
              value={calendar.data.awaiting_settle}
              icon={Check}
              // The one number that is a to-do rather than a fact: these sessions have
              // happened and nobody has said whether the student turned up, so nobody has
              // been paid.
              warn={calendar.data.awaiting_settle > 0}
            />
            <Stat
              label="Session rating"
              value={calendar.data.ratings.average != null ? calendar.data.ratings.average.toFixed(1) : "—"}
              sub={calendar.data.ratings.count ? `${calendar.data.ratings.count} rated` : "none yet"}
              icon={Star}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Your week</CardTitle>
                <CardDescription>
                  Every hour is open to your classes by default — tap one to withdraw it
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Day strip — scrolls rather than wraps, so the row stays one line on a phone. */}
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {calendar.data.days_out.map((d, i) => {
                  const label = dayLabel(d.date);
                  const booked = d.hours.filter((h) => h.state === "booked").length;
                  const free = d.hours.filter((h) => h.state === "open").length;
                  const active = i === dayIndex;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => setDayIndex(i)}
                      aria-pressed={active}
                      aria-label={`${label.title}, ${label.sub}, ${booked} booked, ${free} free`}
                      className={cn(
                        "ds-ring min-w-[104px] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-foreground hover:bg-surface-2",
                      )}
                    >
                      <span className="block text-sm font-extrabold">{label.title}</span>
                      <span className="block text-[11px] font-semibold opacity-70">{label.sub}</span>
                      <span className="mt-1 block text-[11px] font-bold">
                        {booked > 0 ? (
                          <span className="text-primary">{booked} booked</span>
                        ) : (
                          <span className="text-muted-foreground">{free} free</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {day?.hours.map((h) => (
                  <TeacherHourChip
                    key={h.starts_at}
                    hour={h}
                    busy={setHour.isPending}
                    onWithdraw={() => setWithdrawing(h)}
                    onReopen={() => setHour.mutate({ action: "open", startsAt: h.starts_at })}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Sessions</CardTitle>
                <CardDescription>Marking one held is what awards the student their points</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {diary.isPending ? (
                <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
              ) : diary.isError ? (
                <div className="space-y-3">
                  <Alert tone="danger" title="Couldn't load your bookings">
                    Students who booked you are still expected — only this list failed to load.
                  </Alert>
                  <Button variant="secondary" size="sm" leftIcon={<RefreshCw aria-hidden />} onClick={() => void diary.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : (diary.data?.length ?? 0) === 0 ? (
                <EmptyState
                  compact
                  icon={CalendarClock}
                  title="Nothing booked yet"
                  description="Your hours are open above — bookings appear here as students take them."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {diary.data?.map((b) => (
                    <DiaryRow
                      key={b.id}
                      booking={b}
                      pending={settle.isPending}
                      onSettle={(status, note) =>
                        settle.mutate({ bookingId: b.id, status, teacherNote: note })
                      }
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Withdrawing cancels every booking on the hour, so it stays behind a confirmation. */}
      <Modal
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        size="sm"
        title="Withdraw this hour?"
        description={
          withdrawing && withdrawing.bookings.length
            ? `${withdrawing.bookings.length} student${withdrawing.bookings.length === 1 ? "" : "s"} booked this hour and will be told you withdrew it.`
            : "Students won't be able to book it. You can re-open it whenever you like."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawing(null)}>Keep it open</Button>
            <Button
              variant="danger"
              disabled={setHour.isPending}
              onClick={() => {
                if (withdrawing) setHour.mutate({ action: "close", startsAt: withdrawing.starts_at });
                setWithdrawing(null);
              }}
            >
              Withdraw
            </Button>
          </>
        }
      />
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Stat({
  label, value, sub, icon: Icon, accent, warn,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        warn ? "border-amber-400/60 bg-amber-500/[0.07]" : accent ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="ds-num mt-1 text-2xl font-extrabold text-foreground">{value}</p>
      {sub ? <p className="text-[11px] font-semibold text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** One hour of the teacher's own grid. A booked hour names who is coming — a seat count
 *  tells the teacher a number when what they need is a person. */
function TeacherHourChip({
  hour, busy, onWithdraw, onReopen,
}: {
  hour: SupportTeacherHour;
  busy: boolean;
  onWithdraw: () => void;
  onReopen: () => void;
}) {
  const time = fmtHour(hour.starts_at);

  if (hour.state === "booked") {
    return (
      <div className="rounded-xl border border-primary bg-primary/10 px-3 py-2.5 text-left">
        <span className="ds-num block text-sm font-extrabold text-primary">{time}</span>
        {hour.bookings.map((b) => (
          <span key={b.id} className="mt-0.5 block truncate text-[11px] font-bold text-foreground" title={b.topic || undefined}>
            {b.student}
          </span>
        ))}
        {hour.bookings.some((b) => b.topic) && (
          <Info className="mt-1 h-3 w-3 text-muted-foreground" aria-hidden />
        )}
      </div>
    );
  }

  if (hour.state === "closed") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onReopen}
        aria-label={`Re-open ${time}`}
        className="ds-ring rounded-xl border border-dashed border-border bg-surface-2 px-3 py-2.5 text-center text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <span className="ds-num block text-sm font-bold line-through decoration-1">{time}</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
          <LockOpen className="h-3 w-3" aria-hidden /> Re-open
        </span>
      </button>
    );
  }

  if (hour.state === "past") {
    return (
      <div aria-disabled className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-center text-muted-foreground">
        <span className="ds-num block text-sm font-bold">{time}</span>
        <span className="block text-[11px] font-semibold">Gone</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onWithdraw}
      aria-label={`Withdraw ${time}`}
      className="ds-ring rounded-xl border border-border bg-card px-3 py-2.5 text-center text-foreground transition-colors hover:border-danger/50 hover:bg-danger-soft"
    >
      <span className="ds-num block text-sm font-extrabold">{time}</span>
      <span className="block text-[11px] font-semibold text-emerald-600">Free</span>
    </button>
  );
}

/** One booking in the diary. Settling opens a note field rather than firing immediately:
 *  "we went through inference questions" is worth more to the student than a green tick,
 *  and the moment the teacher is recording the outcome is the only moment they will write it. */
function DiaryRow({
  booking: b, pending, onSettle,
}: {
  booking: SupportBooking;
  pending: boolean;
  onSettle: (status: "HELD" | "NO_SHOW", note: string) => void;
}) {
  const [note, setNote] = useState(b.teacher_note);
  const settled = b.status === "HELD" || b.status === "NO_SHOW";

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{b.student}</p>
          <p className="text-xs text-muted-foreground">
            {fmtWhen(b.slot.starts_at)}
            {b.classroom_name ? ` · ${b.classroom_name}` : ""}
          </p>
          {b.topic && <p className="mt-0.5 text-xs text-muted-foreground">{b.topic}</p>}
          {/* Why the seat came back. The hour was held open for it, so the teacher is told. */}
          {b.status === "CANCELLED" && b.cancel_reason && (
            <p className="mt-1 text-xs font-semibold text-foreground">
              Cancelled — <span className="font-medium text-muted-foreground">{b.cancel_reason}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {b.rating != null && (
            <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-600" title={b.rating_comment || undefined}>
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
              {b.rating}
            </span>
          )}
          <Badge variant={STATUS_STYLE[b.status].variant}>{STATUS_STYLE[b.status].label}</Badge>
        </div>
      </div>

      {b.rating_comment && (
        <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted-foreground">
          &ldquo;{b.rating_comment}&rdquo;
        </p>
      )}

      {b.status !== "CANCELLED" && (
        <div className="mt-2 space-y-2">
          <Input
            inputSize="sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you cover? (the student sees this)"
            maxLength={500}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Check aria-hidden />}
              disabled={pending || b.status === "HELD"}
              onClick={() => onSettle("HELD", note)}
            >
              Attended
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<UserX aria-hidden />}
              disabled={pending || b.status === "NO_SHOW"}
              onClick={() => onSettle("NO_SHOW", note)}
            >
              Didn&apos;t attend
            </Button>
            {b.slot.capacity > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users className="h-3 w-3" aria-hidden /> group of <span className="ds-num">{b.slot.capacity}</span>
              </span>
            )}
            {settled && b.teacher_note !== note && (
              <span className="text-[11px] font-semibold text-muted-foreground">
                Press a button again to save the note
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
