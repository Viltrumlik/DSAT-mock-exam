"use client";

import { useState } from "react";
import { Alert, Button, Modal, Skeleton } from "@/components/ui";
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
    <Modal open={open} onClose={close} title="Add someone to this session">
      <div className="space-y-3">
        <p className="text-sm font-semibold text-muted-foreground">
          {when} with {teacherName}. Whoever you pick gets their own seat, and we&apos;ll tell
          them — in the app and by email.
        </p>
        <p className="text-sm font-semibold text-muted-foreground">
          You&apos;ll both earn more points for the session than either of you would sitting it
          alone.
        </p>

        {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

        {/* Four branches. An error here must not render as "you have no classmates" — that
            would send a student off to ask a teacher about a problem that does not exist. */}
        {classmates.isPending ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : classmates.isError ? (
          <Alert tone="danger">
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
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {classmates.data.map((student) => (
              <li key={student.id}>
                <button
                  type="button"
                  onClick={() => setPicked(student.id)}
                  className={
                    "w-full rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition " +
                    (picked === student.id
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border hover:bg-surface-2")
                  }
                >
                  {student.name}
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
