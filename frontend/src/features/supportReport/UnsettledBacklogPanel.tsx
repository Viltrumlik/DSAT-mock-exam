"use client";

import { AlertTriangle, ArrowDown } from "lucide-react";
import { ageInDays, ageLabel, formatDay, nameList, personName, plural } from "./format";
import type { UnsettledBacklog } from "./types";

/**
 * The unsettled backlog, above everything else on the page.
 *
 * This is the finding that prompted the report, and it is deliberately not a column somebody
 * has to notice: on production **32 bookings are still `BOOKED` although their hour is in the
 * past**, the oldest since 13 August, and almost all of them belong to one support teacher.
 * Nothing anywhere told anyone.
 *
 * What it costs is the part that has to be said in words rather than implied by a number.
 * `rewards/hooks.py:sync_support_booking` prices a slot on HELD and revokes anything that is
 * not HELD — so a booking left `BOOKED` after its hour has passed pays **nobody**: not the
 * student, not anyone. It is also absent from every figure below, because an unsettled hour is
 * neither attended nor missed, and it is why an attendance rate can be an em dash on a row
 * that clearly ran sessions. It stays that way, indefinitely, until somebody marks who came.
 * "32" on its own says none of that.
 *
 * **All time, never the selected month.** The backend keeps it unbounded by the picker on
 * purpose: a backlog you can page away from is a backlog nobody clears.
 */
export function UnsettledBacklogPanel({
  backlog,
  onShowUnsettled,
}: {
  backlog: UnsettledBacklog;
  /** Filters the history below to exactly these rows. */
  onShowUnsettled?: (teacherId: number | null) => void;
}) {
  if (!backlog || backlog.unsettled <= 0) return null;

  const owners = backlog.teachers.filter((t) => t.unsettled > 0);
  const days = ageInDays(backlog.oldest);
  const one = backlog.unsettled === 1;

  return (
    <div
      role="alert"
      className="rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning-foreground"
    >
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">
            {plural(backlog.unsettled, "support session")} {one ? "has" : "have"} never been
            settled
          </p>

          <p className="mt-1 font-semibold">
            {one ? "This hour" : "These hours"} already happened and nobody marked who came, so{" "}
            {one ? "it paid" : "they paid"} nobody — not the student, not anyone. Points are
            awarded only when a session is marked as held, and{" "}
            {one ? "an unsettled session is" : "unsettled sessions are"} counted nowhere in the
            figures below: not as attended, not as missed.{" "}
            {one ? "It stays" : "They stay"} that way until the support teacher marks who
            turned up.
          </p>

          {backlog.oldest ? (
            <p className="mt-1.5 text-[13px] font-normal opacity-90">
              The oldest has been waiting since {formatDay(backlog.oldest)}
              {days != null ? ` — ${ageLabel(days)}` : ""}.
            </p>
          ) : null}

          {owners.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                Whose they are
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {owners.map((row) => {
                  const name = personName(row.support_teacher);
                  const body = (
                    <>
                      <span className="font-bold">{name}</span>
                      <span className="tabular-nums font-bold">{row.unsettled}</span>
                      {row.oldest ? (
                        <span className="text-[11px] font-normal opacity-80">
                          since {formatDay(row.oldest)}
                        </span>
                      ) : null}
                    </>
                  );
                  const className =
                    "inline-flex items-baseline gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1";
                  return (
                    <li key={row.support_teacher_id}>
                      {onShowUnsettled ? (
                        <button
                          type="button"
                          onClick={() => onShowUnsettled(row.support_teacher_id)}
                          className={`ds-ring ${className} text-left transition-colors hover:bg-warning/20`}
                          title={`Show ${name}'s ${plural(row.unsettled, "unsettled session")} in the history below`}
                        >
                          {body}
                        </button>
                      ) : (
                        <span className={className}>{body}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {/* Named in prose too: the pill row is scannable, but a screen reader and a
                  reader who screenshots the banner both want the sentence. */}
              <p className="sr-only">
                The unsettled sessions belong to{" "}
                {nameList(owners.map((row) => personName(row.support_teacher)))}.
              </p>
            </div>
          ) : null}

          <p className="mt-3 text-[13px] font-normal opacity-90">
            A support teacher settles these from their own diary, on the session itself — this
            console reports them, it does not close them.
          </p>
        </div>

        {onShowUnsettled ? (
          <button
            type="button"
            onClick={() => onShowUnsettled(null)}
            className="ds-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warning/30 px-3 py-1.5 text-[13px] font-bold transition-colors hover:bg-warning/20"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            Show me which
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default UnsettledBacklogPanel;
