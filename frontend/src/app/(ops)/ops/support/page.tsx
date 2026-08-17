"use client";

import { useState } from "react";
import { CalendarClock, LifeBuoy } from "lucide-react";

import { Alert, Badge, Card, Skeleton } from "@/components/ui";
import {
  useSetSupportHour,
  useSupportTeachers,
  useSupportWeek,
} from "@/features/opsSupport/opsSupportHooks";

/**
 * Support teaching, from the school's side: who does it, and which hours they are available.
 *
 * This console had no support section at all, so the only way to set a teacher's hours was to
 * be that teacher. The endpoints for an admin to act on somebody else's calendar already
 * existed — what was missing was any surface that used them.
 */

const SUBJECT_LABEL: Record<string, string> = {
  math: "Maths",
  english: "English",
  both: "Both subjects",
};

function hourLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "--"
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function OpsSupportPage() {
  const teachers = useSupportTeachers();
  const [selected, setSelected] = useState<number | null>(null);
  const week = useSupportWeek(selected);
  const setHour = useSetSupportHour(selected);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Support teaching</h1>
        <p className="text-sm font-medium text-muted-foreground">
          Every hour is open by default. Closing one withdraws it from the students&apos;
          booking calendar.
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        {/* Who */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <LifeBuoy className="h-4 w-4" aria-hidden /> Support teachers
          </h2>

          {teachers.isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : teachers.isError ? (
            <Alert tone="danger">
              The list didn&apos;t load.{" "}
              <button className="underline" onClick={() => void teachers.refetch()}>
                Try again
              </button>
            </Alert>
          ) : teachers.data.length === 0 ? (
            <p className="text-sm font-semibold text-muted-foreground">
              No support teachers yet. Create one from Users, choosing the support teacher role.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {teachers.data.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSelected(t.id);
                    }}
                    className={`ds-ring flex w-full items-center gap-3 py-2.5 text-left ${
                      selected === t.id ? "font-extrabold text-primary" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{t.name || t.email}</span>
                      <span className="block truncate text-xs font-semibold text-muted-foreground">
                        {SUBJECT_LABEL[t.subject] ?? t.subject}
                      </span>
                    </span>
                    {!t.is_active ? <Badge variant="neutral">Inactive</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* When */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <CalendarClock className="h-4 w-4" aria-hidden /> Working hours
          </h2>

          {selected == null ? (
            <p className="text-sm font-semibold text-muted-foreground">
              Pick a support teacher to see and change their hours.
            </p>
          ) : week.isPending ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : week.isError ? (
            <Alert tone="danger">
              That calendar didn&apos;t load.{" "}
              <button className="underline" onClick={() => void week.refetch()}>
                Try again
              </button>
            </Alert>
          ) : (
            <>
              <p className="text-sm font-semibold text-muted-foreground">
                {week.data.support_teacher.name} · {week.data.free_hours} free ·{" "}
                {week.data.booked_sessions} booked
              </p>

              <div className="space-y-3">
                {week.data.days_out.map((day) => (
                  <div key={day.date}>
                    <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                      {dayLabel(day.date)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {day.hours.map((h) => {
                        const booked = h.state === "booked";
                        const closed = h.state === "closed";
                        return (
                          <button
                            key={h.starts_at}
                            type="button"
                            // A booked hour is somebody's appointment. Withdrawing it here
                            // would strand a student who is expecting to be seen, so the
                            // control is disabled and the settle/cancel flow owns that case.
                            disabled={booked || setHour.isPending}
                            title={
                              booked
                                ? `Booked: ${(h.bookings ?? []).map((b) => b.student).join(", ")}`
                                : closed
                                  ? "Closed — click to re-open"
                                  : "Open — click to withdraw"
                            }
                            onClick={() => {
                              setError(null);
                              setHour.mutate(
                                { startsAt: h.starts_at, action: closed ? "open" : "close" },
                                {
                                  onError: (e) => {
                                    const detail = (
                                      e as { response?: { data?: { detail?: string } } }
                                    )?.response?.data?.detail;
                                    setError(detail ?? "That hour couldn't be changed.");
                                  },
                                },
                              );
                            }}
                            className={`ds-ring rounded-lg border px-2.5 py-1 text-xs font-bold disabled:opacity-60 ${
                              booked
                                ? "border-primary/30 bg-primary-soft text-primary"
                                : closed
                                  ? "border-border bg-surface-3 text-muted-foreground line-through"
                                  : "border-success/30 bg-success-soft text-success-foreground"
                            }`}
                          >
                            {hourLabel(h.starts_at)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

