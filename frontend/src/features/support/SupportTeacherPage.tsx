"use client";

/**
 * /teacher/support — the support desk, from behind it.
 *
 * Two jobs, and until now the page only did the first one. It shows the week: who is coming,
 * what is still free, which hours to withdraw. Underneath it keeps a diary, in time order,
 * where an hour that has happened can be marked held or not attended.
 *
 * The second job is the one it was silently failing. **An unsettled booking pays nobody.**
 * `rewards/hooks.sync_support_booking` awards on HELD and revokes anything else, so a session
 * the teacher never marks is, to every number on this platform, a session that did not happen
 * — including their own earnings. A diary in time order never says that out loud, and on
 * production the silence has cost 39 sessions across two support teachers, the oldest from
 * 13 August. Three quarters of the outstanding bookings are not upcoming at all: they are work
 * already done that nobody closed.
 *
 * So the page now leads with them. The banner states what they cost, the list opens on them,
 * and each is two presses from done. Nothing here is a telling-off — the platform did not ask
 * for a month, and the copy says so.
 *
 * Everything the old page could do is still here: the week and the withdraw confirmation, the
 * diary and its note, who booked and who invited them, why a seat came back, the student's
 * rating, and an error surface for each request that can fail.
 */

import { useMemo, useState } from "react";
import {
  CalendarClock, CalendarOff, Check, Clock, Info, Moon, Star, UserPlus, UserX,
} from "lucide-react";
import {
  Button, Card, Dialog, Donut, EmptyState, ErrorState, Pill, Skeleton, Stat,
  TeacherPage, TONE_INK, TONE_WASH, type Slice,
} from "@/features/teacher/ui";
import type { SupportBooking, SupportTeacherHour } from "@/lib/api";
import {
  ageInDays, ageLabel, dayLabel, fmtDay, fmtHour, fmtWhen, hasEnded, inBucket, needsSettling,
  oldestWaiting, plural, standOf, STAND, type Bucket,
} from "./teacherDiary";
import {
  useMySupportCalendar,
  useSetSupportHour,
  useSupportDiary,
  useSettleBooking,
} from "./supportHooks";

const INPUT_STYLE = {
  width: "100%", boxSizing: "border-box" as const, padding: "9px 12px", borderRadius: 12,
  fontSize: 14, fontFamily: "inherit", border: "1px solid var(--dz-border)",
  background: "var(--dz-card)", color: "var(--dz-ink)", outline: "none",
};

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: "waiting", label: "Waiting for you" },
  { value: "upcoming", label: "Coming up" },
  { value: "recorded", label: "Recorded" },
  { value: "all", label: "Everything" },
];

const errorDetail = (e: unknown) =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? null;

export function SupportTeacherPage() {
  const calendar = useMySupportCalendar();
  const diary = useSupportDiary();
  const setHour = useSetSupportHour();
  const settle = useSettleBooking();

  const [dayIndex, setDayIndex] = useState(0);
  /** The hour whose withdraw confirmation is open. */
  const [withdrawing, setWithdrawing] = useState<SupportTeacherHour | null>(null);
  /** Null until the teacher picks a filter, so the default below can follow the data. */
  const [bucket, setBucket] = useState<Bucket | null>(null);

  /**
   * One clock for the whole render, passed down rather than read again inside each row. Read
   * per row it would drift mid-list, and the same session could be "coming up" in the banner's
   * count and "waiting" three lines below it. Deliberately not memoised: it has to move.
   */
  const now = Date.now();
  // Memoised only so the empty fallback is the SAME array between renders — every derived
  // list below depends on `now`, which changes each render, so nothing else here can be.
  const rows = useMemo(() => diary.data ?? [], [diary.data]);
  const waiting = rows.filter((b) => needsSettling(b, now));

  /**
   * The list opens on the backlog whenever there is one. That is the whole intervention: the
   * old page sorted these into the middle of a diary in date order, where the oldest — the
   * ones that have paid nobody the longest — sat furthest from the eye.
   */
  const activeBucket: Bucket = bucket ?? (waiting.length > 0 ? "waiting" : "all");

  /**
   * The count the page states everywhere.
   *
   * `awaiting_settle` from the calendar means the same thing and is computed the same way, but
   * it is a number with no list behind it. This one is the rows the teacher can actually press,
   * so a banner saying "14" is always a list of fourteen. The server's figure stands in only
   * while the diary has not arrived — better a number than a dash.
   */
  const waitingCount = diary.isSuccess ? waiting.length : calendar.data?.awaiting_settle;

  const shown = rows.filter((b) => inBucket(standOf(b, now), activeBucket));

  const tally = { waiting: 0, upcoming: 0, held: 0, missed: 0, cancelled: 0 };
  for (const b of rows) tally[standOf(b, now)] += 1;
  /** Every stand gets a slice, and a slice worth 0 is dropped below rather than here — the
   *  legend would otherwise print four zeroes beside the one figure that matters. */
  const slices: Slice[] = [
    { label: STAND.waiting.label, value: tally.waiting, tone: STAND.waiting.tone },
    { label: STAND.upcoming.label, value: tally.upcoming, tone: STAND.upcoming.tone },
    { label: STAND.held.label, value: tally.held, tone: STAND.held.tone },
    { label: STAND.missed.label, value: tally.missed, tone: STAND.missed.tone },
    { label: STAND.cancelled.label, value: tally.cancelled, tone: STAND.cancelled.tone },
  ];

  const day = calendar.data?.days_out[dayIndex] ?? calendar.data?.days_out[0];
  /** Which row's settle request is in flight, so only that row spins. */
  const settlingId = settle.isPending ? settle.variables?.bookingId : undefined;

  return (
    <TeacherPage
      title="Support sessions"
      subtitle="Your week at the desk — who's coming, what's free, and what happened in the hours that have been."
    >
      {/* Scoped to the mutation that actually failed, so a stale error cannot mislabel a later
          one. Both are shown: they are different actions and either can fail on its own. */}
      {settle.isError && (
        <ErrorState
          title="That session wasn't recorded"
          detail={
            errorDetail(settle.error) ??
            "The outcome did not reach the server. Nothing has changed — press it again."
          }
        />
      )}
      {setHour.isError && (
        <ErrorState
          title="That hour didn't change"
          detail={
            errorDetail(setHour.error) ??
            "The request did not reach the server. Your week is exactly as it was."
          }
        />
      )}

      {/* Derived from the diary, so it appears only once the diary has genuinely answered —
          a failed load must never be able to say "nothing is waiting". */}
      {diary.isSuccess && waiting.length > 0 && (
        <OwedBanner
          count={waiting.length}
          oldest={oldestWaiting(waiting)}
          now={now}
          showing={activeBucket === "waiting"}
          onShow={() => setBucket("waiting")}
        />
      )}

      <Card title="Your desk" subtitle="The four days ahead, and how the hours behind you stand">
        {calendar.isError ? (
          <ErrorState
            title="Your week didn't load"
            detail={
              errorDetail(calendar.error) ??
              "Your hours and your bookings are unchanged — only this view failed to read them."
            }
            onRetry={() => void calendar.refetch()}
          />
        ) : calendar.isPending ? (
          <Skeleton height={54} count={2} />
        ) : (
          <div
            style={{
              display: "grid", gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            }}
          >
            <Stat label="Free hours" value={calendar.data.free_hours} hint="still bookable" />
            <Stat
              label="Booked"
              value={calendar.data.booked_sessions}
              tone="info"
              hint="seats taken this week"
            />
            <Stat
              label="Waiting for you"
              value={waitingCount}
              tone={waitingCount ? "warning" : "neutral"}
              hint={waitingCount ? "taught, not yet recorded" : "nothing outstanding"}
            />
            <Stat
              label="Session rating"
              value={calendar.data.ratings.average ?? null}
              unit="/ 5"
              hint={
                calendar.data.ratings.count
                  ? `${plural(calendar.data.ratings.count, "student")} rated the session`
                  : "no ratings yet"
              }
            />
          </div>
        )}
      </Card>

      <Card
        title="Your week"
        subtitle="Every hour is open to your classes by default — pick one to withdraw it"
        icon={<CalendarClock size={19} aria-hidden />}
      >
        {calendar.isError ? (
          // Deliberately not a second alert: the desk card above carries the reason and the
          // retry. Saying it twice makes one failure look like two.
          <EmptyState
            title="Your week isn't on screen"
            hint="The retry above brings it back. Your hours and bookings are unchanged."
          />
        ) : calendar.isPending ? (
          <Skeleton height={64} count={3} />
        ) : calendar.data.days_out.length === 0 ? (
          <EmptyState
            title="No days to show"
            hint="The desk's calendar window is empty. Nothing is wrong with your hours."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Scrolls rather than wraps, so the row stays one line on a phone. */}
            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 2px 6px", margin: "0 -2px" }}>
              {calendar.data.days_out.map((d, i) => (
                <DayTab
                  key={d.date}
                  date={d.date}
                  hours={d.hours}
                  now={now}
                  active={i === dayIndex}
                  onPick={() => setDayIndex(i)}
                />
              ))}
            </div>

            <div
              style={{
                display: "grid", gap: 9,
                gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))",
              }}
            >
              {day?.hours.map((h) => (
                <HourChip
                  key={h.starts_at}
                  hour={h}
                  now={now}
                  busy={setHour.isPending}
                  onWithdraw={() => setWithdrawing(h)}
                  onReopen={() => setHour.mutate({ action: "open", startsAt: h.starts_at })}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Your sessions"
        subtitle="Marking an hour held is what awards the student their points — and books yours"
        spine={waiting.length > 0 ? "warning" : undefined}
      >
        {/* ERROR BEFORE EMPTY, always. "You have no bookings" when the server merely said no
            is a lie about the teacher's own week, and the students who booked still turn up. */}
        {diary.isError ? (
          <ErrorState
            title="Your bookings didn't load"
            detail={
              errorDetail(diary.error) ??
              "Students who booked you are still expected — only this list failed to read them."
            }
            onRetry={() => void diary.refetch()}
          />
        ) : diary.isPending ? (
          <Skeleton height={72} count={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing booked yet"
            hint="Your hours are open above. Bookings appear here as students take them, and this is where you record how each one went."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap",
                justifyContent: "space-between",
              }}
            >
              <BucketPicker
                value={activeBucket}
                onChange={setBucket}
                counts={{
                  waiting: tally.waiting,
                  upcoming: tally.upcoming,
                  recorded: tally.held + tally.missed,
                  all: rows.length,
                }}
              />
              <Donut
                slices={slices.filter((s) => s.value > 0)}
                centerValue={rows.length}
                centerLabel="sessions"
              />
            </div>

            {shown.length === 0 ? (
              // Only a filter can empty this list — `rows.length === 0` is caught above — so
              // it says which filter, and never that the teacher's diary is empty.
              <EmptyState
                title={
                  activeBucket === "waiting"
                    ? "Nothing is waiting on you"
                    : activeBucket === "upcoming"
                      ? "No sessions coming up"
                      : "Nothing recorded yet"
                }
                hint="Your other sessions are still here — switch to Everything to see them."
              />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {shown.map((b) => (
                  <DiaryRow
                    key={b.id}
                    booking={b}
                    now={now}
                    disabled={settle.isPending}
                    settling={settlingId === b.id}
                    onSettle={(status, note) =>
                      settle.mutate({ bookingId: b.id, status, teacherNote: note })
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/*
        Withdrawing cancels every booking on the hour, so it stays a deliberate act.

        NO REASON FIELD, and it is not an oversight — there is nowhere on this request for one
        to go. `SupportHourView.post` cancels each booking with a fixed sentence of its own
        ("Your teacher withdrew this hour."), so anything typed here would never reach the
        student it was written for, and the `note` the endpoint does accept is the hour's
        PUBLIC invitation note — the line the booking screen shows a student about to take
        that hour. Re-opening sends no note, so a withdrawal reason written there survives and
        comes back as advice on a bookable hour: "I'm covering a midterm that morning", on an
        hour now open for booking. Passing the note through as the cancel reason is a backend
        change and out of scope here; until then, promising the student reads this is worse
        than not asking, because the teacher believes they have explained themselves.
      */}
      <Dialog
        open={withdrawing !== null}
        title="Withdraw this hour?"
        description={
          withdrawing && withdrawing.bookings.length > 0
            ? `${plural(withdrawing.bookings.length, "student")} booked ${fmtHour(withdrawing.starts_at)} and will be told you withdrew it.`
            : "Students won't be able to book it. You can re-open it whenever you like."
        }
        tone="danger"
        confirmLabel="Withdraw the hour"
        cancelLabel="Keep it open"
        busy={setHour.isPending}
        onClose={() => setWithdrawing(null)}
        onConfirm={() => {
          if (withdrawing) setHour.mutate({ action: "close", startsAt: withdrawing.starts_at });
          setWithdrawing(null);
        }}
      />
    </TeacherPage>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────────────────────── */

/**
 * The backlog, above everything else.
 *
 * Written for a teacher who is owed something, because they are: these hours were taught, the
 * platform never asked anyone to close them, and every one of them has been paying nobody
 * since. The count on its own is a number; what it costs is the finding, so that is the
 * sentence — and the age, because "since 13 August" is a different fact from "since Tuesday".
 */
function OwedBanner({ count, oldest, now, showing, onShow }: {
  count: number;
  oldest: string | null;
  now: number;
  showing: boolean;
  onShow: () => void;
}) {
  const days = ageInDays(oldest, now);
  const one = count === 1;
  return (
    <div
      role="alert"
      style={{
        display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
        padding: "18px 20px", borderRadius: 20,
        background: TONE_WASH.warning,
        // The token named outright rather than the kit's `${TONE_INK.x}33` idiom. A tone is a
        // `var()`, and custom-property substitution replaces it with a TOKEN, so the `33` that
        // follows never merges into an 8-digit hex — it lands as a second token and the whole
        // declaration is dropped. `ErrorState` has been shipping a border nobody can see.
        // Both washes behind this are declared twice in globals.css, once per theme, so a
        // single alpha never has to serve a white card and a dark panel at once.
        border: `1px solid ${TONE_INK.warning}`,
      }}
    >
      <CalendarOff size={20} style={{ color: TONE_INK.warning, flexShrink: 0, marginTop: 2 }} aria-hidden />
      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--dz-ink)" }}>
          {plural(count, "session")} you&apos;ve already taught {one ? "is" : "are"} still waiting
          to be recorded
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 500, color: "var(--dz-ink)", lineHeight: 1.55 }}>
          {one ? "This hour has" : "These hours have"} finished and nothing has said who came, so{" "}
          {one ? "it has" : "they have"} paid nobody — not the student, and not you.{" "}
          {one ? "It counts" : "They count"} in none of the figures on this page: not as held,
          not as missed. Nothing asked you for {one ? "it" : "them"} until now.
        </p>
        {oldest && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--dz-mute)" }}>
            The oldest has been waiting since {fmtDay(oldest)}
            {days != null ? ` — ${ageLabel(days)}` : ""}.
          </p>
        )}
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--dz-mute)" }}>
          One press each, below, and {one ? "it's" : "they're"} done.
        </p>
      </div>
      {!showing && (
        <Button variant="ghost" onClick={onShow}>
          Show me {one ? "it" : `all ${count}`}
        </Button>
      )}
    </div>
  );
}

/** One day in the strip. Says what is on it, so the teacher picks a day rather than a date. */
function DayTab({ date, hours, now, active, onPick }: {
  date: string;
  hours: SupportTeacherHour[];
  now: number;
  active: boolean;
  onPick: () => void;
}) {
  const label = dayLabel(date, now);
  const booked = hours.filter((h) => h.state === "booked").length;
  const free = hours.filter((h) => h.state === "open").length;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      aria-label={`${label.title}, ${label.sub}, ${booked} booked, ${free} free`}
      style={{
        minWidth: 108, flexShrink: 0, textAlign: "left", cursor: "pointer",
        padding: "9px 12px", borderRadius: 14, fontFamily: "inherit",
        border: `1px solid ${active ? TONE_INK.info : "var(--dz-border)"}`,
        background: active ? TONE_WASH.info : "var(--dz-card)",
        color: active ? TONE_INK.info : "var(--dz-ink)",
      }}
    >
      <span style={{ display: "block", fontSize: 14, fontWeight: 800 }}>{label.title}</span>
      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--dz-mute)" }}>
        {label.sub}
      </span>
      <span
        style={{
          display: "block", marginTop: 3, fontSize: 11, fontWeight: 700,
          color: booked > 0 ? TONE_INK.info : "var(--dz-faint)",
        }}
      >
        {booked > 0 ? `${booked} booked` : `${free} free`}
      </span>
    </button>
  );
}

const CHIP_BASE = {
  padding: "9px 11px", borderRadius: 14, textAlign: "left" as const,
  border: "1px solid var(--dz-border)", fontFamily: "inherit", minWidth: 0,
};

/**
 * One hour of the teacher's own grid.
 *
 * Five states, and all five are drawn. `off` used to fall through to the last branch and
 * render as a free hour with a Withdraw button — an hour outside the teacher's working
 * schedule, offered for withdrawal, on a POST the server refuses. It says what it is now.
 *
 * A booked hour names who is coming: a seat count gives a teacher a number where they need a
 * person. It also marks the hour when a booking on it has finished unrecorded, so the backlog
 * is visible in the week and not only in the list.
 */
function HourChip({ hour, now, busy, onWithdraw, onReopen }: {
  hour: SupportTeacherHour;
  now: number;
  busy: boolean;
  onWithdraw: () => void;
  onReopen: () => void;
}) {
  const time = fmtHour(hour.starts_at);

  if (hour.state === "booked") {
    const owed = hasEnded(hour.ends_at, now) && hour.bookings.some((b) => b.status === "BOOKED");
    return (
      <div
        style={{
          ...CHIP_BASE,
          border: `1px solid ${owed ? TONE_INK.warning : TONE_INK.info}`,
          background: owed ? TONE_WASH.warning : TONE_WASH.info,
        }}
      >
        <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: owed ? TONE_INK.warning : TONE_INK.info }}>
          {time}
        </span>
        {hour.bookings.map((b) => (
          <span
            key={b.id}
            title={b.topic || undefined}
            style={{
              display: "block", marginTop: 2, fontSize: 11, fontWeight: 700,
              color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {b.student}
          </span>
        ))}
        {/* The cue that there is something to hover for. Each name carries what the student
            booked the hour for in its `title`, and a tooltip nobody knows is there is a
            tooltip nobody opens — a teacher scanning the week would read the chip as a name
            and a time and never learn the topic is one hover away. */}
        {hour.bookings.some((b) => b.topic) && (
          <Info size={12} aria-hidden style={{ display: "block", marginTop: 4, color: "var(--dz-mute)" }} />
        )}
        {owed && (
          <span style={{ display: "block", marginTop: 4, fontSize: 11, fontWeight: 700, color: TONE_INK.warning }}>
            Needs recording
          </span>
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
        style={{
          ...CHIP_BASE, textAlign: "center", width: "100%",
          border: "1px dashed var(--dz-border)", background: "var(--dz-neutral-soft)",
          color: "var(--dz-mute)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
        }}
      >
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, textDecoration: "line-through" }}>
          {time}
        </span>
        <span style={{ display: "block", fontSize: 11, fontWeight: 700 }}>Re-open</span>
      </button>
    );
  }

  if (hour.state === "off") {
    return (
      <div
        aria-disabled
        style={{ ...CHIP_BASE, textAlign: "center", background: "var(--dz-neutral-soft)", color: "var(--dz-faint)" }}
      >
        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{time}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}>
          <Moon size={11} aria-hidden /> Off shift
        </span>
      </div>
    );
  }

  if (hour.state === "past") {
    return (
      <div
        aria-disabled
        style={{ ...CHIP_BASE, textAlign: "center", background: "var(--dz-neutral-soft)", color: "var(--dz-faint)" }}
      >
        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{time}</span>
        <span style={{ display: "block", fontSize: 11, fontWeight: 700 }}>Gone</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onWithdraw}
      aria-label={`Withdraw ${time}`}
      style={{
        ...CHIP_BASE, textAlign: "center", width: "100%", background: "var(--dz-card)",
        color: "var(--dz-ink)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
      }}
    >
      <span style={{ display: "block", fontSize: 14, fontWeight: 800 }}>{time}</span>
      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: TONE_INK.success }}>Free</span>
    </button>
  );
}

/** The kit has no segmented control yet; this one is local until a second page needs it. */
function BucketPicker({ value, onChange, counts }: {
  value: Bucket;
  onChange: (b: Bucket) => void;
  counts: Record<Bucket, number>;
}) {
  return (
    <div
      role="group"
      aria-label="Which sessions to show"
      style={{ display: "flex", gap: 4, background: "var(--dz-neutral-soft)", borderRadius: 14, padding: 4, flexWrap: "wrap" }}
    >
      {BUCKETS.map((b) => {
        const active = b.value === value;
        const owed = b.value === "waiting" && counts.waiting > 0;
        return (
          <button
            key={b.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(b.value)}
            style={{
              padding: "7px 13px", borderRadius: 10, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 700,
              // The selected tab is indigo in every bucket, the backlog's included. It was
              // white on `TONE_INK.warning`, which is 2.3:1 in light and 1.7:1 in dark for
              // 13px bold — and this is the tab the page SELECTS BY DEFAULT whenever there is
              // a backlog, so the worst contrast on the page sat on the screen the rebuild
              // exists for. The kit's white-on-solid is indigo (`Button variant="primary"`)
              // and nothing else. Amber-on-amber is not the alternative it looks like: the
              // wash is a 13% tint of the ink, which measures ~1.9:1 against it — worse than
              // what it would replace. Amber still marks the tab when it is NOT selected, and
              // the banner, the card's spine and the rows carry the tone regardless.
              background: active ? "var(--dz-indigo)" : "transparent",
              color: active ? "#fff" : owed ? TONE_INK.warning : "var(--dz-mute)",
            }}
          >
            {b.label} <span style={{ opacity: 0.8 }}>{counts[b.value]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One booking in the diary.
 *
 * Settling opens a note rather than firing blind: "we went through inference questions" is
 * worth more to the student than a green tick, and the moment the teacher records the outcome
 * is the only moment they will write it. The note is optional, so a session owed from August
 * is still one press away from paying.
 *
 * A settled row keeps both buttons live. A teacher who pressed the wrong one, or who wants to
 * add the note afterwards, has no other way back — and the mutation takes the same payload
 * either way.
 */
function DiaryRow({ booking: b, now, disabled, settling, onSettle }: {
  booking: SupportBooking;
  now: number;
  disabled: boolean;
  settling: boolean;
  onSettle: (status: "HELD" | "NO_SHOW", note: string) => void;
}) {
  const [note, setNote] = useState(b.teacher_note);
  const stand = standOf(b, now);
  const owed = stand === "waiting";
  const noteId = `settle-note-${b.id}`;

  return (
    <li
      style={{
        borderTop: "1px solid var(--dz-border)", padding: "14px 0",
        // A solid tint would be invisible on white and washed out on the dark panel; the
        // tone's own wash is declared twice in globals.css, once per theme.
        background: owed ? TONE_WASH.warning : undefined,
        borderRadius: owed ? 14 : undefined,
        paddingLeft: owed ? 14 : undefined,
        paddingRight: owed ? 14 : undefined,
        marginTop: owed ? 8 : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 240px" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--dz-ink)" }}>{b.student}</p>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--dz-mute)" }}>
            {fmtWhen(b.slot.starts_at)}
            {b.classroom_name ? ` · ${b.classroom_name}` : ""}
            {b.slot.capacity > 1 ? ` · group of ${b.slot.capacity}` : ""}
          </p>
          {b.topic && (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--dz-ink)" }}>{b.topic}</p>
          )}
          {/* An invited seat has to explain itself — to the teacher who published the hour as
              a one-to-one, and to anyone wondering why a student they never met is on it. */}
          {b.invited_by && (
            <p style={{ margin: "4px 0 0", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--dz-mute)" }}>
              <UserPlus size={12} aria-hidden /> Invited into this seat by {b.invited_by}
            </p>
          )}
          {/* Why the seat came back. The hour was held open for it, so the teacher is told. */}
          {b.status === "CANCELLED" && b.cancel_reason && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--dz-ink)" }}>
              <strong style={{ fontWeight: 700 }}>Given back:</strong>{" "}
              <span style={{ color: "var(--dz-mute)" }}>{b.cancel_reason}</span>
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* The student's verdict on the session — never a verdict on the student, and it
              changes nothing about their points. */}
          {b.rating != null && (
            <span
              title={`${b.student} rated this session ${b.rating} out of 5`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 800, color: TONE_INK.warning }}
            >
              <Star size={14} aria-hidden /> {b.rating}
              <span style={{ fontWeight: 600, color: "var(--dz-faint)" }}>/ 5</span>
            </span>
          )}
          <span title={STAND[stand].note}>
            <Pill tone={STAND[stand].tone}>{STAND[stand].label}</Pill>
          </span>
        </div>
      </div>

      {b.rating_comment && (
        <p
          style={{
            margin: "8px 0 0", padding: "8px 11px", borderRadius: 12,
            background: "var(--dz-neutral-soft)", fontSize: 12, color: "var(--dz-mute)",
          }}
        >
          &ldquo;{b.rating_comment}&rdquo; — what {b.student} said about the session
        </p>
      )}

      {b.status !== "CANCELLED" && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 9 }}>
          {owed && (
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TONE_INK.warning }}>
              <Clock size={12} style={{ verticalAlign: "-1px", marginRight: 5 }} aria-hidden />
              This hour has finished. Until it&apos;s recorded it pays nobody.
            </p>
          )}
          <input
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you cover? (the student sees this)"
            aria-label={`What the session with ${b.student} covered`}
            maxLength={500}
            style={INPUT_STYLE}
          />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9 }}>
            <Button
              variant={owed ? "primary" : "ghost"}
              disabled={disabled}
              busy={settling}
              onClick={() => onSettle("HELD", note)}
            >
              <Check size={15} aria-hidden />
              They came
            </Button>
            <Button variant="ghost" disabled={disabled} busy={settling} onClick={() => onSettle("NO_SHOW", note)}>
              <UserX size={15} aria-hidden />
              Did not attend
            </Button>
            {b.teacher_note !== note && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>
                Your note saves with whichever you press.
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
