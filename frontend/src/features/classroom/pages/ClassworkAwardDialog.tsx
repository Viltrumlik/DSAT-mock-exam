"use client";

/**
 * Give XP for ONE classwork, to the students in this class.
 *
 * Opened from the classwork's own row, because that is where the teacher already is: the
 * lesson panel could only ever pay classwork that came out of the journal, and half the
 * classwork on the platform is written by hand in the Classwork tab and has no lesson
 * behind it.
 *
 * Manager-gated (OWNER + TEACHER), never `isStaff`. Classwork XP is MINTED rather than
 * derived from work a student did, so a TA holding the grading brief must not create it —
 * the server refuses on `can_manage_class` for the same reason. `can_award` comes back on
 * the payload so a TA gets the panel read-only rather than buttons that always 403.
 *
 * One row, one mutation: a failure on one student never greys out the rest of the class,
 * and the failure is rendered inline with its own retry rather than as a toast that fades
 * before a teacher standing in front of a class can act on it.
 */

import { useEffect, useState } from "react";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Button, Dialog, EmptyState, ErrorState, Input, LoadingState, Pill } from "../ui";
import { useClassworkAwards, useGiveClassworkXp, useWithdrawClassworkXp } from "../classworkHooks";
import type { ClassworkAwardStudent } from "../classworkAwardsApi";

/** One student, what they already have, and the two things a teacher can do about it. */
function StudentRow({
  classId,
  assignmentId,
  student,
  maxPoints,
  canAward,
}: {
  classId: number;
  assignmentId: number;
  student: ClassworkAwardStudent;
  maxPoints: number;
  canAward: boolean;
}) {
  const give = useGiveClassworkXp(classId, assignmentId);
  const withdraw = useWithdrawClassworkXp(classId, assignmentId);
  const [xp, setXp] = useState(student.awarded ? String(student.points) : "");

  // Follow the server after a write — the mutation writes the refreshed panel straight into
  // the cache, and a field still holding the old keystrokes would quietly re-send them on
  // the next press. Keyed on what actually changed, so it never fights a teacher mid-type.
  useEffect(() => {
    setXp(student.awarded ? String(student.points) : "");
  }, [student.awarded, student.points]);

  const value = Number(xp.trim());
  const valid = xp.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= maxPoints;
  const busy = give.isPending || withdraw.isPending;
  const submit = () => {
    if (valid && canAward) give.mutate({ student_id: student.student_id, points: value });
  };

  // Is there anything left to take back? Points and XP move apart the moment a teacher
  // corrects an award DOWNWARDS: the engine never lowers XP for doing worse, so 15 revised
  // to 0 leaves 0 points and 15 XP standing. Both have to be tested, or the offer to undo
  // disappears exactly when the leftover XP most needs clearing.
  const holdsSomething = student.points > 0 || student.xp > 0;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{student.name}</p>
        {student.awarded && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {student.points > 0
              ? `${student.points} XP given`
              : student.xp > 0
                // The trap this line exists to expose. Typing 0 over a mis-award looks like
                // an undo and is not one — the XP stays on the leaderboard until somebody
                // takes the award back. Nothing else on the platform says so.
                ? `0 XP — but ${student.xp} XP is still counted. Take it back to clear it.`
                // A recorded 0 is a teacher who looked and decided — never "nothing yet",
                // and never dressed up as XP the student lost.
                : "Marked — no XP this time"}
          </p>
        )}
      </div>

      {!canAward ? (
        student.awarded ? (
          <Pill tone={holdsSomething ? "success" : "neutral"}>
            <Check className="mr-1 h-3 w-3" aria-hidden />
            {student.points > 0 ? `${student.points} XP` : "Marked"}
          </Pill>
        ) : (
          <span className="text-xs text-muted-foreground">Not marked</span>
        )
      ) : (
        // A fixed three-slot strip — field · button · undo — so every row's columns line
        // up down the list. Reserving the undo slot even when there is nothing to take
        // back is the point: without it, rows shift sideways by 32px depending on whether
        // a student has been marked, and a teacher scanning twenty names reads that as
        // noise.
        <div className="flex shrink-0 items-center gap-2">
          {/* The width lives on a WRAPPER, not on the Input.
              `cn` in this codebase is a plain string join, not tailwind-merge, and the
              Input's own base class list starts with `w-full` — so a `w-[68px]` passed
              through `className` loses to it and the field silently goes full-width,
              wrapping every row onto three lines. Sizing the parent makes `w-full` mean
              68px. */}
          <span className="w-[68px] shrink-0">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={maxPoints}
              value={xp}
              onChange={(e) => setXp(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              aria-label={`XP for ${student.name}`}
              placeholder="0"
              className="h-9 px-2 text-center"
            />
          </span>
          <span className="w-[86px] shrink-0">
            <Button
              size="sm"
              className="w-full justify-center"
              variant={student.awarded ? "secondary" : "primary"}
              disabled={!valid || busy}
              onClick={submit}
            >
              {give.isPending ? "Saving…" : student.awarded ? "Update" : "Give"}
            </Button>
          </span>
          {holdsSomething ? (
            // Its own action, not "type 0". The reward engine never lowers XP for doing
            // worse, so correcting 20 down to 0 leaves 20 XP on the board for ever; this is
            // the only thing that clears it.
            <button
              type="button"
              disabled={busy}
              onClick={() => withdraw.mutate(student.student_id)}
              aria-label={`Take back ${student.name}'s XP`}
              title="Take this XP back"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden />
          )}
        </div>
      )}

      {(give.isError || withdraw.isError) && (
        <p className="w-full text-xs font-medium text-rose-500">
          {normalizeApiError(give.error ?? withdraw.error).message}{" "}
          <button type="button" onClick={submit} className="font-semibold underline">
            Try again
          </button>
        </p>
      )}
    </li>
  );
}

export function ClassworkAwardDialog({
  open,
  onClose,
  classId,
  assignmentId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  classId: number;
  assignmentId: number;
  title: string;
}) {
  // Not fetched until the dialog is actually opened: a class list of twenty classworks
  // would otherwise fire twenty roster requests the teacher never asked for.
  const { data, isLoading, isError, refetch } = useClassworkAwards(classId, assignmentId, open);
  const max = data?.max_points ?? 20;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Give XP
        </span>
      }
      description={title}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {/* Failures are tested BEFORE loading. A failed query has no `data`, so testing
          `!data` first would leave the dialog spinning for ever on an error nobody could
          see or retry — and an empty roster is never the honest answer to a broken fetch. */}
      {isError ? (
        <ErrorState
          title="Class list not available"
          message="We couldn't load this class's students just now."
          onRetry={() => refetch()}
        />
      ) : isLoading || !data ? (
        <LoadingState label="Loading students…" />
      ) : data.students.length === 0 ? (
        <EmptyState
          title="No students in this class yet"
          description="Students appear here as soon as they join."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {data.can_award
              ? `Up to ${max} XP for each student. Giving again replaces the number — a student is paid once for a classwork, not once per press.`
              : "The class teacher gives classwork XP. This is what has been given so far."}
          </p>
          {/* The dialog locks body scroll and sets no height of its own, so a class of
              twenty would run off the bottom of the screen with no way to reach it. The
              list carries its own scroll. */}
          <ul className="mt-2 max-h-[min(52vh,26rem)] divide-y divide-border overflow-y-auto">
            {data.students.map((s) => (
              <StudentRow
                key={s.student_id}
                classId={classId}
                assignmentId={assignmentId}
                student={s}
                maxPoints={max}
                canAward={data.can_award}
              />
            ))}
          </ul>
          {data.can_award && (
            <p className="mt-3 text-xs text-muted-foreground">
              XP counts towards the leaderboard, and adds the same number of spendable
              points. Use <RotateCcw className="inline h-3 w-3 align-[-1px]" aria-hidden /> to
              take an award back — lowering the number alone leaves the XP standing.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
