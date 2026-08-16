"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  Info,
  LockOpen,
  RefreshCw,
  Settings2,
  Sparkles,
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
  Field,
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

/**
 * The diary, in the order a teacher actually works through it.
 *
 * It used to be one all-time list, oldest first, so the session needing a decision *today*
 * sat at the bottom under every hour ever taught — and the number in the "To record" tile
 * pointed at rows the teacher had to scroll to find.
 *
 * Three groups, each with its own natural direction: what is owed (soonest overdue first),
 * what is coming (soonest first), what is done (newest first).
 */
export function groupDiary(bookings: SupportBooking[]) {
  const now = Date.now();
  const started = (b: SupportBooking) => new Date(b.slot.starts_at).getTime();
  const ended = (b: SupportBooking) => new Date(b.slot.ends_at).getTime();

  const toRecord = bookings
    .filter((b) => b.status === "BOOKED" && ended(b) <= now)
    .sort((a, b) => started(a) - started(b));
  const coming = bookings
    .filter((b) => b.status === "BOOKED" && ended(b) > now)
    .sort((a, b) => started(a) - started(b));
  const done = bookings
    .filter((b) => b.status !== "BOOKED")
    .sort((a, b) => started(b) - started(a));
  return { toRecord, coming, done };
}

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
  /** The hour whose management sheet is open, or null. Withdrawing cancels the bookings on
   *  it, so it never happens on a single click. */
  const [managing, setManaging] = useState<SupportTeacherHour | null>(null);

  const errorDetail = (e: unknown) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  const day = calendar.data?.days_out[dayIndex] ?? calendar.data?.days_out[0];
  const bookings = diary.data?.bookings;
  const groups = useMemo(() => groupDiary(bookings ?? []), [bookings]);

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
            <RatingStat
              average={calendar.data.ratings.average}
              count={calendar.data.ratings.count}
              bookings={bookings}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Your week</CardTitle>
                <CardDescription>
                  Every hour is open to your classes by default — tap one to manage it
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
                    onManage={() => setManaging(h)}
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
              ) : (bookings?.length ?? 0) === 0 ? (
                <EmptyState
                  compact
                  icon={CalendarClock}
                  title="Nothing booked yet"
                  description="Your hours are open above — bookings appear here as students take them."
                />
              ) : (
                <div className="space-y-5">
                  {/* Ordered by what is owed, not by when it happened. The sessions with no
                      outcome recorded are the only rows that need the teacher to do
                      anything, so they are the only rows worth putting first. */}
                  <DiarySection
                    title="Waiting on you"
                    hint="These hours have passed. Nobody is paid until you say what happened."
                    tone="warn"
                    bookings={groups.toRecord}
                    settle={settle}
                  />
                  <DiarySection
                    title="Coming up"
                    bookings={groups.coming}
                    settle={settle}
                  />
                  <DiarySection
                    title="Done"
                    bookings={groups.done}
                    settle={settle}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ManageHourModal
        hour={managing}
        busy={setHour.isPending}
        onClose={() => setManaging(null)}
        onSave={(vars) => {
          if (managing) setHour.mutate({ ...vars, startsAt: managing.starts_at });
          setManaging(null);
        }}
      />
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Stat({
  label, value, sub, icon: Icon, accent, warn, children,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  accent?: boolean;
  warn?: boolean;
  children?: React.ReactNode;
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
      {children}
    </div>
  );
}

/**
 * The rating tile, with the shape of the ratings under it.
 *
 * An average on its own cannot tell a teacher whether a 3.8 is a steady middle or a
 * handful of fives and one one — and those two call for completely different responses.
 * The bars come from the diary this page has already fetched, so knowing costs no request.
 */
function RatingStat({
  average, count, bookings,
}: {
  average: number | null;
  count: number;
  bookings: SupportBooking[] | undefined;
}) {
  const spread = useMemo(() => {
    const tally = [0, 0, 0, 0, 0];
    for (const b of bookings ?? []) {
      if (b.rating != null && b.rating >= 1 && b.rating <= 5) tally[b.rating - 1] += 1;
    }
    return tally;
  }, [bookings]);
  const most = Math.max(1, ...spread);

  return (
    <Stat
      label="Session rating"
      value={average != null ? average.toFixed(1) : "—"}
      sub={count ? `${count} rated` : "none yet"}
      icon={Star}
    >
      {count > 0 && (
        <div className="mt-2 flex items-end gap-1" aria-hidden>
          {spread.map((n, i) => (
            <div key={i} className="flex-1" title={`${n} × ${i + 1}★`}>
              <div
                className={cn(
                  "rounded-sm",
                  n === 0 ? "bg-border" : i >= 3 ? "bg-amber-400" : i === 2 ? "bg-amber-300" : "bg-border",
                )}
                style={{ height: `${Math.max(3, Math.round((n / most) * 20))}px` }}
              />
            </div>
          ))}
        </div>
      )}
    </Stat>
  );
}

/** One hour of the teacher's own grid. A booked hour names who is coming — a seat count
 *  tells the teacher a number when what they need is a person. */
function TeacherHourChip({
  hour, busy, onManage, onReopen,
}: {
  hour: SupportTeacherHour;
  busy: boolean;
  onManage: () => void;
  onReopen: () => void;
}) {
  const time = fmtHour(hour.starts_at);

  if (hour.state === "booked") {
    // Was an inert <div>. A booked hour is the one a teacher most needs to act on — to see
    // the topic, to open it wider for a second student, or to withdraw it — and it was the
    // only state on the grid that could not be touched.
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onManage}
        aria-label={`Manage ${time}, ${hour.bookings.length} booked`}
        className="ds-ring rounded-xl border border-primary bg-primary/10 px-3 py-2.5 text-left transition-colors hover:bg-primary/15"
      >
        <span className="ds-num flex items-center justify-between text-sm font-extrabold text-primary">
          {time}
          <Settings2 className="h-3 w-3 opacity-60" aria-hidden />
        </span>
        {hour.bookings.map((b) => (
          <span key={b.id} className="mt-0.5 block truncate text-[11px] font-bold text-foreground" title={b.topic || undefined}>
            {b.student}
          </span>
        ))}
        {hour.bookings.some((b) => b.topic) && (
          <Info className="mt-1 h-3 w-3 text-muted-foreground" aria-hidden />
        )}
      </button>
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
      onClick={onManage}
      aria-label={`Manage ${time}`}
      className="ds-ring rounded-xl border border-border bg-card px-3 py-2.5 text-center text-foreground transition-colors hover:border-primary/50 hover:bg-surface-2"
    >
      <span className="ds-num block text-sm font-extrabold">{time}</span>
      <span className="block text-[11px] font-semibold text-emerald-600">
        {hour.capacity > 1 ? `Group of ${hour.capacity}` : "Free"}
      </span>
    </button>
  );
}

/**
 * Everything a teacher can decide about one hour, in one sheet.
 *
 * `capacity` and `note` have been accepted by `POST support/hours/open/` since the opt-out
 * calendar shipped and there has never been a control for either, so a teacher could not
 * run a group clinic or say what an hour was for without asking somebody with database
 * access. Withdrawing stays behind this sheet rather than a single tap because it cancels
 * every booking on the hour.
 */
function ManageHourModal({
  hour, busy, onClose, onSave,
}: {
  hour: SupportTeacherHour | null;
  busy: boolean;
  onClose: () => void;
  onSave: (vars: { action: "close" | "open"; note?: string; capacity?: number }) => void;
}) {
  // Keyed on the hour so the fields reset when a different one is opened — without the key
  // the state would persist and one hour's note would be offered as the next one's.
  return (
    <Modal open={hour !== null} onClose={onClose} size="sm" title={hour ? `${fmtHour(hour.starts_at)} — ${fmtHour(hour.ends_at)}` : ""}>
      {hour && <ManageHourBody key={hour.starts_at} hour={hour} busy={busy} onClose={onClose} onSave={onSave} />}
    </Modal>
  );
}

function ManageHourBody({
  hour, busy, onClose, onSave,
}: {
  hour: SupportTeacherHour;
  busy: boolean;
  onClose: () => void;
  onSave: (vars: { action: "close" | "open"; note?: string; capacity?: number }) => void;
}) {
  const [note, setNote] = useState(hour.note);
  const [capacity, setCapacity] = useState(String(hour.capacity || 1));
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  const booked = hour.bookings.filter((b) => b.status === "BOOKED");
  const parsedCapacity = Math.max(1, Number.parseInt(capacity, 10) || 1);
  // The server refuses a capacity below the number already booked, and says so — but the
  // teacher should not have to press Save to find out.
  const tooSmall = parsedCapacity < booked.length;

  return (
    <div className="space-y-4">
      {booked.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Coming to this hour
          </p>
          <ul className="mt-1.5 space-y-1">
            {booked.map((b) => (
              <li key={b.id} className="text-sm">
                <span className="font-bold text-foreground">{b.student}</span>
                {b.classroom_name && (
                  <span className="text-muted-foreground"> · {b.classroom_name}</span>
                )}
                {b.topic && <p className="text-xs text-muted-foreground">{b.topic}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label="Group size" hint="More than one seat turns the hour into a small group.">
        <Input
          type="number"
          min={Math.max(1, booked.length)}
          max={12}
          inputSize="sm"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </Field>
      {tooSmall && (
        <Alert tone="warning" title={`${booked.length} already booked`}>
          You can&apos;t take the hour below {booked.length}. Withdraw it instead if you need
          to call the session off.
        </Alert>
      )}

      <Field label="Note" hint="Students see this on the hour before they book it.">
        <Input
          inputSize="sm"
          value={note}
          maxLength={240}
          placeholder="e.g. Bring your Module 2 mistakes"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      {confirmingWithdraw ? (
        <Alert tone="danger" title="Withdraw this hour?">
          {booked.length > 0
            ? `${booked.length} student${booked.length === 1 ? "" : "s"} booked this hour and will be told you withdrew it.`
            : "Students won't be able to book it. You can re-open it whenever you like."}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => onSave({ action: "close" })}
            >
              Yes, withdraw it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingWithdraw(false)}>
              Keep it open
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setConfirmingWithdraw(true)}
          >
            Withdraw this hour
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || tooSmall}
              onClick={() => onSave({ action: "open", note, capacity: parsedCapacity })}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type SettleMutation = ReturnType<typeof useSettleBooking>;

function DiarySection({
  title, hint, tone, bookings, settle,
}: {
  title: string;
  hint?: string;
  tone?: "warn";
  bookings: SupportBooking[];
  settle: SettleMutation;
}) {
  if (bookings.length === 0) return null;
  return (
    <section>
      <h3
        className={cn(
          "flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-wide",
          tone === "warn" ? "text-amber-600" : "text-muted-foreground",
        )}
      >
        {title}
        <span className="ds-num font-extrabold">{bookings.length}</span>
      </h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <ul className="mt-1 divide-y divide-border">
        {bookings.map((b) => (
          <DiaryRow
            key={b.id}
            booking={b}
            // Per row, not per page. One shared `isPending` disabled every button in the
            // list on every settle, so a teacher working down a morning's sessions had to
            // wait out each round trip before the next row would respond.
            pending={settle.isPending && settle.variables?.bookingId === b.id}
            onSettle={(status, note) =>
              settle.mutate({ bookingId: b.id, status, teacherNote: note })
            }
          />
        ))}
      </ul>
    </section>
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
  const noteChanged = note.trim() !== b.teacher_note.trim();

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
          {/* Why the seat came back. The hour was held open for it, so the teacher is told —
              and until the diary stopped filtering cancelled rows out, this branch could
              never render at all. */}
          {b.status === "CANCELLED" && b.cancel_reason && (
            <p className="mt-1 text-xs font-semibold text-foreground">
              Cancelled — <span className="font-medium text-muted-foreground">{b.cancel_reason}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* What the student was actually paid. The teacher's action is what triggers it,
              so the teacher is the one person who should be able to see it landed. */}
          {b.award && (
            <span
              className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-600"
              title="What this session earned the student"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              +{b.award.xp > 0 ? `${b.award.xp} XP` : `${b.award.points}`}
            </span>
          )}
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
            {/* Saving the note used to require settling again — so fixing a typo meant
                pressing an outcome button, and the only hint that the note was unsaved was
                a line of grey text. Re-settling at the SAME status is idempotent: the award
                is keyed on the booking and the student is not told a second time. */}
            {settled && noteChanged && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onSettle(b.status as "HELD" | "NO_SHOW", note)}
              >
                Save note
              </Button>
            )}
            {b.slot.capacity > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users className="h-3 w-3" aria-hidden /> group of <span className="ds-num">{b.slot.capacity}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
