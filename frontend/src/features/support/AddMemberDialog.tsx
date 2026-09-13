"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Alert, Avatar, Button, Modal, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useInvitableClassmates, useInviteMember } from "./supportHooks";

/**
 * Add a classmate to a support hour you booked.
 *
 * **The list is the guard rail.** The server decides who may be added — a classmate of a
 * class this support teacher actually covers, who is not already in the session — and this
 * picker renders exactly that answer rather than a class roster it filters itself. A picker
 * that can offer a name the invite would then refuse is a picker that lies.
 *
 * **What the student is told before they press it.** Adding somebody takes a seat, and on a
 * one-to-one hour it creates one — the teacher published that hour expecting one student. So
 * the dialog says plainly that the classmate will be told, and it says it before the button,
 * not in a toast afterwards.
 *
 * **And that it pays.** A support hour earns per head and the rate climbs with the group
 * (``rewards.constants.support_session_points``), which is the whole reason inviting exists —
 * but the student pressing this button is the one it was invisible to. Said without the
 * numbers on purpose: the school retunes the bottom rung from the admin, and a figure typed
 * here would go on quoting the old one. The rewards page states the ladder, from the rule.
 */
export function AddMemberDialog({
  open,
  bookingId,
  teacherName,
  when,
  onClose,
}: {
  open: boolean;
  bookingId: number | null;
  teacherName: string;
  when: string;
  onClose: () => void;
}) {
  const classmates = useInvitableClassmates(open ? bookingId : null);
  const invite = useInviteMember();
  const [picked, setPicked] = useState<number | null>(null);

  const close = () => {
    setPicked(null);
    invite.reset();
    onClose();
  };

  const submit = () => {
    if (bookingId === null || picked === null) return;
    invite.mutate({ bookingId, studentId: picked }, { onSuccess: close });
  };

  const errorText =
    (invite.error as { response?: { data?: { detail?: string } } } | null)?.response?.data
      ?.detail ?? (invite.isError ? "That didn't go through. Try again." : null);

  return (
    // `ds-app`: portalled onto <body>, outside the shell's sans, it would read in Georgia.
    <Modal open={open} onClose={close} title="Add someone to this session" className="ds-app">
      <div className="space-y-3">
        <p className="text-sm font-semibold text-muted-foreground">
          {when} with {teacherName}. Whoever you pick gets their own seat, and we&apos;ll tell
          them — in the app and by email.
        </p>
        <p className="text-sm font-semibold text-muted-foreground">
          You&apos;ll both earn more points for the session than either of you would sitting it
          alone.
        </p>

        {errorText ? <Alert tone="danger" className="squircle [--sq:10px]">{errorText}</Alert> : null}

        {/* Four branches. An error here must not render as "you have no classmates" — that
            would send a student off to ask a teacher about a problem that does not exist. */}
        {classmates.isPending ? (
          <Skeleton className="squircle h-24 [--sq:9px]" />
        ) : classmates.isError ? (
          <Alert tone="danger" className="squircle [--sq:10px]">
            Couldn&apos;t load your classmates.{" "}
            <button className="underline" onClick={() => void classmates.refetch()}>
              Try again
            </button>
          </Alert>
        ) : classmates.data.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">
            There&apos;s nobody left to add — everyone in your class who could join this
            session is already in it.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto p-0.5">
            {classmates.data.map((student) => (
              <li key={student.id}>
                <button
                  type="button"
                  onClick={() => setPicked(student.id)}
                  aria-pressed={picked === student.id}
                  className={cn(
                    "ds-ring squircle flex w-full items-center gap-3 border-2 px-3 py-2 text-left font-[inherit] text-sm font-bold transition-colors [--sq:9px]",
                    picked === student.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent bg-surface-2 text-foreground hover:bg-surface-3",
                  )}
                >
                  <Avatar name={student.name} size={28} />
                  <span className="min-w-0 flex-1 truncate">{student.name}</span>
                  {picked === student.id ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={picked === null} loading={invite.isPending}>
            Add them
          </Button>
        </div>
      </div>
    </Modal>
  );
}
