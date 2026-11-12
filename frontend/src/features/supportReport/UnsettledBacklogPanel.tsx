"use client";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/features/console/ui";
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
 *
 * Drawn as the console's attention notice (amber, the warning triangle and the words), with each
 * owner as a chip that filters the history below.
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
      className="animate-ms-fade-in rounded-ms-card border border-ms-attention-line bg-ms-attention-soft px-4 py-4 text-[14px] leading-5 text-ms-attention-fg"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Icon name="warn" className="mt-0.5" />
        <div className="min-w-0 flex-1 basis-[18rem]">
          <p className="text-ms-h">
            {plural(backlog.unsettled, "support session")} {one ? "has" : "have"} never been
            settled
          </p>

          <p className="mt-1 font-medium">
            {one ? "This hour" : "These hours"} already happened and nobody marked who came, so{" "}
            {one ? "it paid" : "they paid"} nobody — not the student, not anyone. Points are
            awarded only when a session is marked as held, and{" "}
            {one ? "an unsettled session is" : "unsettled sessions are"} counted nowhere in the
            figures below: not as attended, not as missed.{" "}
            {one ? "It stays" : "They stay"} that way until the support teacher marks who
            turned up.
          </p>

          {backlog.oldest ? (
            <p className="mt-1.5 text-[13px] leading-[18px] text-ms-fg-2">
              The oldest has been waiting since {formatDay(backlog.oldest)}
              {days != null ? ` — ${ageLabel(days)}` : ""}.
            </p>
          ) : null}

          {owners.length > 0 ? (
            <div className="mt-3">
              <p className="text-ms-over">Whose they are</p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {owners.map((row) => {
                  const name = personName(row.support_teacher);
                  const body = (
                    <>
                      <span className="font-semibold">{name}</span>
                      <span className="tabular-nums font-semibold text-ms-attention-fg">{row.unsettled}</span>
                      {row.oldest ? (
                        <span className="text-[12px] text-ms-fg-3">since {formatDay(row.oldest)}</span>
                      ) : null}
                    </>
                  );
                  const className =
                    "inline-flex items-baseline gap-1.5 rounded-full border border-ms-attention-line bg-ms-card px-3 py-1 text-[14px] text-ms-fg";
                  return (
                    <li key={row.support_teacher_id}>
                      {onShowUnsettled ? (
                        <button
                          type="button"
                          onClick={() => onShowUnsettled(row.support_teacher_id)}
                          className={`ms-press ${className} text-left hover:bg-ms-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring`}
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

          <p className="mt-3 text-[13px] leading-[18px] text-ms-fg-2">
            A support teacher settles these from their own diary, on the session itself — this
            console reports them, it does not close them.
          </p>
        </div>

        {onShowUnsettled ? (
          <Button variant="secondary" size="sm" icon="down" onClick={() => onShowUnsettled(null)}>
            Show me which
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default UnsettledBacklogPanel;
