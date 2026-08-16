"use client";

import { useMemo, useState } from "react";
import { Clock, LifeBuoy, LockOpen, Star, Users } from "lucide-react";
import { Alert, Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SupportTeacherHour } from "@/lib/api";
import type { SupportDeskRow } from "@/features/supportAdmin/supportAdminApi";
import {
  useSetDeskHour,
  useSupportDeskOverview,
  useSupportDeskRatings,
  useSupportDeskWeek,
} from "@/features/supportAdmin/supportAdminHooks";

function fmtHour(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The support desk, for whoever runs the school.
 *
 * Support teachers have been bookable since the desk shipped and nothing in the admin
 * console could answer the two questions a head of school actually has: **who is covering
 * what**, and **how is it going**. The write path for somebody else's hours already
 * existed and was tested; it simply had no screen, and no way to read the grid it edited.
 *
 * Deliberately not an assignment page. Putting a support teacher on a classroom lives in
 * /ops/classrooms next to everything else about that classroom, and duplicating it here
 * would make two places to look for one fact.
 */
export default function OpsSupportPage() {
  const overview = useSupportDeskOverview();
  const [selected, setSelected] = useState<number | null>(null);

  // Memoised because the `?? []` would otherwise mint a new array every render and make
  // the two useMemos below recompute on each one.
  const teachers = useMemo(() => overview.data?.teachers ?? [], [overview.data]);
  const selectedRow = teachers.find((t) => t.id === selected) ?? null;

  /** Two conditions worth interrupting for, both of which mean a student is not being
   *  helped right now. Computed rather than fetched — the table already has the numbers. */
  const unsettled = useMemo(
    () => teachers.reduce((n, t) => n + t.awaiting_settle, 0),
    [teachers],
  );
  const uncovered = useMemo(
    () => teachers.filter((t) => t.classrooms.length === 0),
    [teachers],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Support desk</h1>
        <p className="text-sm font-medium text-muted-foreground">
          Every support teacher, the classes they cover, and what students say about them.
          Open a desk to set its working hours.
        </p>
      </div>

      {overview.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : overview.isError ? (
        // Not an empty state. "No support teachers" would read as a staffing fact and send
        // somebody to create accounts that already exist.
        <Card className="space-y-3">
          <Alert tone="danger" title="Couldn't load the support desks">
            Nothing has changed — only this view failed to load.
          </Alert>
          <Button variant="secondary" size="sm" onClick={() => void overview.refetch()}>
            Try again
          </Button>
        </Card>
      ) : teachers.length === 0 ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">No support teachers yet</h2>
          <p className="text-sm text-muted-foreground">
            Create an account with the support-teacher role in Users, then assign it to a
            classroom from Classrooms. Its hours appear here.
          </p>
        </Card>
      ) : (
        <>
          {unsettled > 0 ? (
            <Alert tone="warning">
              {unsettled} session{unsettled === 1 ? " has" : "s have"} finished with no
              outcome recorded. Until a teacher marks one attended, the student earns nothing
              for it.
            </Alert>
          ) : null}
          {uncovered.length > 0 ? (
            <Alert tone="warning">
              {uncovered.length} support teacher{uncovered.length === 1 ? "" : "s"} cover no
              classroom — {uncovered.map((t) => t.name).join(", ")}. No student can book them
              until they are assigned to a class.
            </Alert>
          ) : null}

          <Card className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <LifeBuoy className="h-4 w-4" aria-hidden /> Desks
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Teacher</th>
                    <th className="py-2 pr-3">Covers</th>
                    <th className="py-2 pr-3 text-right">Students</th>
                    <th className="py-2 pr-3 text-right">Held</th>
                    <th className="py-2 pr-3 text-right">Missed</th>
                    <th className="py-2 pr-3 text-right">Upcoming</th>
                    <th className="py-2 pr-3 text-right">To record</th>
                    <th className="py-2 pr-3 text-right">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t) => (
                    <DeskRow
                      key={t.id}
                      row={t}
                      active={t.id === selected}
                      onSelect={() => setSelected(t.id === selected ? null : t.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Select a teacher to open their working hours and their ratings.
            </p>
          </Card>

          {selectedRow ? (
            <>
              <DeskWeek teacher={selectedRow} />
              <DeskRatings teacher={selectedRow} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function DeskRow({
  row, active, onSelect,
}: {
  row: SupportDeskRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      aria-selected={active}
      className={cn(
        "cursor-pointer border-b border-border transition-colors last:border-0",
        active ? "bg-primary/[0.06]" : "hover:bg-surface-2",
      )}
    >
      <td className="py-2.5 pr-3">
        <span className="block font-bold text-foreground">{row.name}</span>
        <span className="block text-xs text-muted-foreground">
          {row.subject ?? "no subject"} · {row.email}
        </span>
      </td>
      <td className="py-2.5 pr-3">
        {row.classrooms.length === 0 ? (
          <Badge variant="warning">No class</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {row.classrooms.map((c) => c.name).join(", ")}
          </span>
        )}
      </td>
      <td className="ds-num py-2.5 pr-3 text-right">{row.students}</td>
      <td className="ds-num py-2.5 pr-3 text-right font-bold">{row.held}</td>
      <td className="ds-num py-2.5 pr-3 text-right">{row.missed}</td>
      <td className="ds-num py-2.5 pr-3 text-right">{row.upcoming}</td>
      <td className="ds-num py-2.5 pr-3 text-right">
        {row.awaiting_settle > 0 ? (
          <span className="font-bold text-amber-600">{row.awaiting_settle}</span>
        ) : (
          row.awaiting_settle
        )}
      </td>
      <td className="py-2.5 pr-3 text-right">
        {row.ratings.average != null ? (
          <span className="inline-flex items-center gap-1 font-bold text-amber-600">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
            {row.ratings.average.toFixed(1)}
            <span className="text-xs font-semibold text-muted-foreground">
              ({row.ratings.count})
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">none yet</span>
        )}
      </td>
    </tr>
  );
}

/**
 * One teacher's week, editable.
 *
 * Reads the very endpoint the teacher's own page reads, with `?support_teacher=`. An admin
 * setting hours on a screen fed by a second, admin-only query is how the two views drift
 * until one of them is quietly wrong about which hours are open.
 */
function DeskWeek({ teacher }: { teacher: SupportDeskRow }) {
  const week = useSupportDeskWeek(teacher.id);
  const setHour = useSetDeskHour(teacher.id);
  const [confirming, setConfirming] = useState<SupportTeacherHour | null>(null);
  const [note, setNote] = useState("");

  const detail = (e: unknown) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Clock className="h-4 w-4" aria-hidden /> {teacher.name}&apos;s hours
        </h2>
        <p className="text-xs text-muted-foreground">
          {teacher.free_hours} free · {teacher.closed_hours} withdrawn this week
        </p>
      </div>

      {setHour.isError ? (
        <Alert tone="danger" title={detail(setHour.error) || "That didn't go through."}>
          The hour is unchanged — you can try again.
        </Alert>
      ) : null}

      {week.isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : week.isError ? (
        <div className="space-y-2">
          <Alert tone="danger" title="Couldn't load this teacher's week">
            Their hours are unchanged — only this view failed to load.
          </Alert>
          <Button variant="secondary" size="sm" onClick={() => void week.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Every hour from {String(week.data.open_hour).padStart(2, "0")}:00 to{" "}
            {String(week.data.close_hour).padStart(2, "0")}:00 is open by default. Withdraw
            the ones this teacher does not work.
          </p>
          {week.data.days_out.map((day) => (
            <div key={day.date}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {fmtDate(day.date)}
              </p>
              <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-10">
                {day.hours.map((h) => (
                  <AdminHourChip
                    key={h.starts_at}
                    hour={h}
                    busy={setHour.isPending}
                    onClose={() => { setNote(h.note); setConfirming(h); }}
                    onOpen={() =>
                      setHour.mutate({ action: "open", startsAt: h.starts_at })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Withdrawing cancels every booking on the hour, so it never happens on one click —
          and the students affected are named before it does. */}
      {confirming ? (
        <Alert
          tone="danger"
          title={`Withdraw ${fmtHour(confirming.starts_at)} from ${teacher.name}?`}
        >
          {confirming.bookings.filter((b) => b.status === "BOOKED").length > 0 ? (
            <>
              {confirming.bookings
                .filter((b) => b.status === "BOOKED")
                .map((b) => b.student)
                .join(", ")}{" "}
              booked this hour and will be told it was withdrawn.
            </>
          ) : (
            <>Students won&apos;t be able to book it. You can re-open it at any time.</>
          )}
          <div className="mt-2 space-y-2">
            <Input
              inputSize="sm"
              value={note}
              maxLength={240}
              placeholder="Why? (students see this on the hour)"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={setHour.isPending}
                onClick={() => {
                  setHour.mutate({ action: "close", startsAt: confirming.starts_at, note });
                  setConfirming(null);
                }}
              >
                Withdraw it
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Keep it open
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}
    </Card>
  );
}

function AdminHourChip({
  hour, busy, onClose, onOpen,
}: {
  hour: SupportTeacherHour;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const time = fmtHour(hour.starts_at);

  if (hour.state === "past") {
    return (
      <div
        aria-disabled
        className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-center text-[11px] font-semibold text-muted-foreground"
      >
        {time}
      </div>
    );
  }

  if (hour.state === "closed") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        title={hour.note || "Withdrawn"}
        aria-label={`Re-open ${time}`}
        className="ds-ring rounded-lg border border-dashed border-border bg-surface-2 px-2 py-1.5 text-center text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <span className="ds-num block line-through decoration-1">{time}</span>
        <LockOpen className="mx-auto mt-0.5 h-3 w-3" aria-hidden />
      </button>
    );
  }

  if (hour.state === "booked") {
    const names = hour.bookings.map((b) => b.student).join(", ");
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        title={names}
        aria-label={`Withdraw ${time}, booked by ${names}`}
        className="ds-ring rounded-lg border border-primary bg-primary/10 px-2 py-1.5 text-center text-[11px] font-bold text-primary transition-colors hover:bg-primary/15"
      >
        <span className="ds-num block">{time}</span>
        <span className="mt-0.5 inline-flex items-center gap-0.5">
          <Users className="h-3 w-3" aria-hidden />
          {hour.bookings.length}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClose}
      title={hour.note || undefined}
      aria-label={`Withdraw ${time}`}
      className="ds-ring rounded-lg border border-border bg-card px-2 py-1.5 text-center text-[11px] font-semibold transition-colors hover:border-danger/50 hover:bg-danger-soft"
    >
      <span className="ds-num block font-bold">{time}</span>
      <span className="text-emerald-600">
        {hour.capacity > 1 ? `×${hour.capacity}` : "free"}
      </span>
    </button>
  );
}

/**
 * The comments, not just the average.
 *
 * A 3.4 cannot tell anyone whether one week went badly or every week does. Shown with the
 * student's name: a rating nobody can follow up is a number rather than feedback, and
 * students are never told a rating is anonymous — so no promise is being broken. That it
 * is a choice, rather than an accident of what the API happened to return, is the reason
 * this paragraph exists.
 */
function DeskRatings({ teacher }: { teacher: SupportDeskRow }) {
  const feed = useSupportDeskRatings(teacher.id);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Star className="h-4 w-4" aria-hidden /> What students said
        </h2>
        {teacher.ratings.average != null ? (
          <p className="text-xs font-semibold text-muted-foreground">
            {teacher.ratings.average.toFixed(1)} from {teacher.ratings.count} rated session
            {teacher.ratings.count === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      {feed.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : feed.isError ? (
        <div className="space-y-2">
          <Alert tone="danger" title="Couldn't load the ratings">
            They are unchanged — only this view failed to load.
          </Alert>
          <Button variant="secondary" size="sm" onClick={() => void feed.refetch()}>
            Try again
          </Button>
        </div>
      ) : feed.data.ratings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sessions rated yet. A student can rate a session once this teacher marks it
          attended.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {feed.data.ratings.map((r) => (
            <li key={r.booking_id} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-foreground">{r.student}</span>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-600">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                  {r.rating}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtDate(r.starts_at)} {fmtHour(r.starts_at)}
                {r.classroom_name ? ` · ${r.classroom_name}` : ""}
                {r.topic ? ` · ${r.topic}` : ""}
              </p>
              {r.comment ? (
                <p className="mt-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm">
                  &ldquo;{r.comment}&rdquo;
                </p>
              ) : null}
              {/* The teacher's own account of the hour, beside the student's. A low rating
                  next to "we only got through one question" is a different conversation
                  from a low rating next to a full lesson. */}
              {r.teacher_note ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Teacher&apos;s note: {r.teacher_note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
