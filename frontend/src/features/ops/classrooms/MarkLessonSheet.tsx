"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAttendanceSessions, useCreateSession } from "@/features/classroom/attendanceHooks";
import { RosterMarker } from "@/features/classroom/pages/Attendance";
import { Button, Sheet } from "@/features/console/ui";
import { formatApiErrorForToast } from "@/lib/apiError";
import { weekdayOf } from "@/features/ops/detail/groupFacts";
import { classroomKeys } from "./classroomsApi";

/**
 * "Mark …'s lesson" on the group page (Group board's primary action, 22 Nov 2026): the classroom register itself —
 * `RosterMarker`, the same marking, lc-up excuse reasons, window and finalize a teacher uses — in a side sheet.
 * The server decides who may mark and until when (`classes/attendance_window`; an admin may correct a closed
 * register); this only opens the register of `date`, today's opened here if the class meets today and none is yet.
 */
export function MarkLessonSheet({
  open,
  onClose,
  roomId,
  date,
  today,
}: {
  open: boolean;
  onClose: () => void;
  roomId: number;
  /** "YYYY-MM-DD": the lesson to mark. */
  date: string;
  /** Whether `date` is today: only today's register may be opened from here. */
  today: boolean;
}) {
  const client = useQueryClient();
  const close = () => {
    // The page's register grid, counts and header read the marks again.
    void client.invalidateQueries({ queryKey: classroomKeys.core(roomId) });
    void client.invalidateQueries({ queryKey: classroomKeys.part(roomId, "register") });
    void client.invalidateQueries({ queryKey: classroomKeys.part(roomId, "attendance") });
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={`Mark ${weekdayOf(date)}’s lesson`} wide>
      {open ? <Register roomId={roomId} date={date} today={today} /> : null}
    </Sheet>
  );
}

function Register({ roomId, date, today }: { roomId: number; date: string; today: boolean }) {
  const sessions = useAttendanceSessions(roomId);
  const create = useCreateSession(roomId);
  if (sessions.isPending) return <p className="text-[14px] text-ms-fg-3">Opening the register…</p>;
  if (sessions.isError || !sessions.data) {
    return (
      <p role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2.5 text-[14px] text-ms-critical-fg">
        {formatApiErrorForToast(sessions.error)}{" "}
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void sessions.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  const session = sessions.data.sessions.find((s) => s.date === date);
  if (session) return <RosterMarker classId={roomId} sessionId={session.id} />;
  if (!today) return <p className="text-[14px] text-ms-fg-2">There is no register for this day.</p>;
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[14px] text-ms-fg-2">Today&apos;s register is not open yet.</p>
      <Button variant="primary" icon="calcheck" state={create.isPending ? "busy" : "idle"} onClick={() => create.mutate({ date })}>
        Open today&apos;s register
      </Button>
      {create.error ? <p role="alert" className="text-[14px] text-ms-critical-fg">{formatApiErrorForToast(create.error)}</p> : null}
    </div>
  );
}
