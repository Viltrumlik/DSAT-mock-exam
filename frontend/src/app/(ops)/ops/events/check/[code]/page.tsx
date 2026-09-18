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
 */

import { use } from "react";
import { Check } from "lucide-react";

import { Alert, Button } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
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
    <div className="space-y-5">
      <OpsPageHeader section="Events" title="Ticket" description="Scanned at the door." />

      {ticket.isPending ? (
        <p className="text-sm text-muted-foreground">Reading the ticket…</p>
      ) : ticket.isError || !row ? (
        <Alert tone="danger">
          No ticket with that code. Find the student by name in the list instead.
        </Alert>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {row.ticket_code}
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
              {row.student_name}
            </h2>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              {row.event.title}
              {row.event.location ? ` · ${row.event.location}` : ""}
            </p>
          </div>

          {row.attendance ? (
            <Alert tone={row.attendance === "ATTENDED" ? "success" : "info"}>
              {row.attendance === "ATTENDED" ? "Attended" : "Missed"}
              {row.marked_at ? ` · marked ${fmtTime(row.marked_at)}` : ""}
              {row.marked_by_name ? ` by ${row.marked_by_name}` : ""}
            </Alert>
          ) : null}

          {row.can_mark && row.attendance !== "ATTENDED" ? (
            <Button
              onClick={() =>
                mark.mutate(
                  { id: row.registration_id, attendance: "ATTENDED" },
                  { onSuccess: () => void ticket.refetch() },
                )
              }
              loading={mark.isPending}
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden />
              Attended
            </Button>
          ) : row.can_mark ? null : row.reason === "too_early" ? (
            <Alert tone="info">You can mark from {fmtTime(row.marking_opens_at)}.</Alert>
          ) : row.reason === "cancelled" ? (
            <Alert tone="warning">
              This student gave this seat back, so there is nothing to mark.
            </Alert>
          ) : (
            <Alert tone="warning">This event was called off.</Alert>
          )}
        </div>
      )}
    </div>
  );
}
