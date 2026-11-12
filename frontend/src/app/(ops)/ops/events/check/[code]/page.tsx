"use client";

/**
 * /ops/events/check/<code> — what a phone camera opens when it scans a ticket.
 *
 * Written for one specific moment: somebody is standing at a door, in a queue, and the person
 * holding the phone has about two seconds. So it is a name, an event, one button — and, when
 * the button is not there, a sentence saying exactly why.
 *
 * One button, Attended, not two: a Missed ticket keeps it, so late arrivals still get marked
 * at the door, but an Attended ticket shows none — there is no "undo" here, only the ops
 * console's own list, which already has both.
 *
 * There is no scanner of our own here. The camera app does the scanning and opens this URL;
 * shipping a QR-reading library would add a dependency and a camera permission to do what the
 * phone already does.
 *
 * In the console's look (design handoff v0.3): one card, the code in the ticket's mono face, the
 * name large. The words and the call are the page's own.
 */

import { use } from "react";

import { Button } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { BOX, Notice } from "@/features/ops/telegram-posts/telegramLook";
import { useMarkAttendance, useTicket } from "@/features/events/eventsHooks";

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function TicketCheckPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const ticket = useTicket(code);
  const mark = useMarkAttendance(ticket.data?.event.id ?? 0);
  const row = ticket.data;

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader section="Events" title="Ticket" description="Scanned at the door." />

      {ticket.isPending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <p className="text-[14px] text-ms-fg-3">Reading the ticket…</p>
          <div className="h-40 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
        </div>
      ) : ticket.isError || !row ? (
        <Notice tone="danger">
          No ticket with that code. Find the student by name in the list instead.
        </Notice>
      ) : (
        <section className={`animate-ms-card-in flex flex-col gap-4 p-5 sm:p-6 ${BOX}`}>
          <div className="min-w-0">
            <p className="font-ms-mono text-[14px] font-semibold tracking-[.08em] text-ms-primary-text">
              {row.ticket_code}
            </p>
            <h2 className="mt-1 break-words font-ms-display text-[28px] font-bold leading-9 tracking-[-0.02em] text-ms-fg">
              {row.student_name}
            </h2>
            <p className="mt-1 text-[15px] text-ms-fg-2">
              {row.event.title}
              {row.event.location ? ` · ${row.event.location}` : ""}
            </p>
          </div>

          {row.attendance ? (
            <Notice tone={row.attendance === "ATTENDED" ? "success" : "info"}>
              {row.attendance === "ATTENDED" ? "Attended" : "Missed"}
              {row.marked_at ? ` · marked ${fmtTime(row.marked_at)}` : ""}
              {row.marked_by_name ? ` by ${row.marked_by_name}` : ""}
            </Notice>
          ) : null}

          {row.can_mark && row.attendance !== "ATTENDED" ? (
            <div>
              <Button
                variant="primary"
                icon="check"
                state={mark.isPending ? "busy" : "idle"}
                disabled={mark.isPending}
                onClick={() =>
                  mark.mutate(
                    { id: row.registration_id, attendance: "ATTENDED" },
                    { onSuccess: () => void ticket.refetch() },
                  )
                }
                className="w-full sm:w-auto"
              >
                Attended
              </Button>
            </div>
          ) : row.can_mark ? null : row.reason === "too_early" ? (
            <Notice tone="info">You can mark from {fmtTime(row.marking_opens_at)}.</Notice>
          ) : row.reason === "cancelled" ? (
            <Notice tone="warning">
              This student gave this seat back, so there is nothing to mark.
            </Notice>
          ) : (
            <Notice tone="warning">This event was called off.</Notice>
          )}
        </section>
      )}
    </div>
  );
}
