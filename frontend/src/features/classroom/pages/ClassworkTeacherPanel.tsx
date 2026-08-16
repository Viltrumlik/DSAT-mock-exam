"use client";

/**
 * The teacher's classwork controls for one lesson: hand it to the class, and record what
 * each student earned in the room.
 *
 * Manager-gated (OWNER + TEACHER), never `isStaff`. Classwork points are MINTED rather
 * than derived from work a student did, so a TA holding the grading brief must not be able
 * to create them — the server refuses on `can_manage_class` for the same reason, and a
 * control that always 403s is worse than no control at all.
 *
 * The gate is a capability rather than the route because the student site renders this
 * very same ClassroomWorkspace with `consumer` forcing my_role="STUDENT": anything gated
 * on the URL instead of capabilities leaks straight onto mastersat.uz.
 */

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, LoadingState, Pill } from "../ui";
import { normalizeRole } from "../capabilities";
import { useClassMembers } from "../hooks";
import { useAssignClasswork, useAwardClasswork, useLessonClasswork } from "../classworkHooks";
import type { ClassworkAward } from "../lessonsApi";
import type { Member } from "../types";

function fullName(u: Member["user"]): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username || u.email;
}

/** One student, what they already have, and the control to record or revise it. */
function AwardRow({
  classId,
  lessonId,
  student,
  existing,
  maxPoints,
}: {
  classId: number;
  lessonId: number;
  student: Member;
  /** Undefined until a teacher records something; `points: 0` is a real recorded award. */
  existing?: ClassworkAward;
  maxPoints: number;
}) {
  // One mutation per row, so a failure on one student never greys out the rest of the class.
  const award = useAwardClasswork(classId, lessonId);
  const [points, setPoints] = useState(existing ? String(existing.points) : "");
  const [note, setNote] = useState(existing?.note ?? "");

  const name = fullName(student.user);
  const value = Number(points.trim());
  const valid =
    points.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= maxPoints;
  const submit = () => {
    if (!valid) return;
    award.mutate({ student_id: student.user.id, points: value, note: note.trim() });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
      {existing && (
        // Zero is a recorded decision, not "nothing yet" — say so rather than showing "+0".
        <Pill tone="success">
          <Check className="mr-1 h-3 w-3" aria-hidden />
          {existing.points > 0 ? `${existing.points} recorded` : "Recorded"}
        </Pill>
      )}
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={maxPoints}
        value={points}
        onChange={(e) => setPoints(e.target.value)}
        aria-label={`Points for ${name}`}
        placeholder="0"
        className="h-9 w-20 shrink-0"
      />
      <Button
        size="sm"
        variant={existing ? "secondary" : "primary"}
        disabled={!valid || award.isPending}
        onClick={submit}
      >
        {award.isPending ? "Saving…" : existing ? "Update" : "Give points"}
      </Button>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label={`Note for ${name}`}
        placeholder="Optional — what they did well"
        maxLength={240}
        className="h-9 w-full text-xs"
      />
      {award.isError && (
        // Inline and persistent, with its own retry: a toast that fades is not something a
        // teacher mid-lesson can act on, and a row that silently reverts reads as "saved".
        <p className="w-full text-xs font-medium text-rose-500">
          {normalizeApiError(award.error).message}{" "}
          <button type="button" onClick={submit} className="font-semibold underline">
            Try again
          </button>
        </p>
      )}
    </li>
  );
}

export function ClassworkTeacherPanel({
  classId,
  lessonId,
  canManage,
}: {
  classId: number;
  lessonId: number;
  /** `capabilities.canManageClass` — OWNER + TEACHER. Never `isStaff`; see the file header. */
  canManage: boolean;
}) {
  const { data, isLoading, isError, refetch } = useLessonClasswork(classId, lessonId);
  const members = useClassMembers(classId);
  const give = useAssignClasswork(classId, lessonId);

  const students = useMemo(() => {
    const list: Member[] = Array.isArray(members.data) ? members.data : members.data?.members ?? [];
    return list.filter(
      (m) =>
        normalizeRole(m.role) === "STUDENT" &&
        String((m as { status?: string }).status ?? "ACTIVE") !== "REMOVED",
    );
  }, [members.data]);

  const awardFor = useMemo(
    () => new Map((data?.awards ?? []).map((a) => [a.student_id, a])),
    [data],
  );

  const given = data?.given ?? false;

  return (
    <Card>
      <CardHeader
        title="Classwork points"
        description={
          given
            ? "The class can see this lesson. Points are yours to give — classwork has no deadline and is never scored automatically."
            : "Give this to the class so they can see it, then record what each student earned in the room."
        }
        actions={
          given ? (
            <Pill tone="success">
              <Check className="mr-1 h-3 w-3" aria-hidden />
              Given
            </Pill>
          ) : (
            <Button
              size="sm"
              disabled={!canManage || isLoading || isError || give.isPending}
              onClick={() => give.mutate()}
            >
              {give.isPending ? "Giving…" : "Give to class"}
            </Button>
          )
        }
      />

      {/* Failures are tested BEFORE the loading branch. A failed query has no `data`, so a
          `!data` test first would leave the panel spinning forever on an error nobody could
          see or retry. `!data` then rides with loading rather than being defaulted away
          below, where a missing payload would cap every row at 0 and refuse every award. */}
      {isError ? (
        <ErrorState
          title="Classwork not available"
          message="This lesson's points couldn't be loaded."
          onRetry={() => refetch()}
        />
      ) : members.isError ? (
        <ErrorState
          title="Class list not available"
          message="The roster couldn't be loaded, so there is nobody to record points against yet."
          onRetry={() => members.refetch()}
        />
      ) : isLoading || members.isLoading || !data ? (
        <LoadingState label="Loading classwork…" />
      ) : !canManage ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The class teacher records classwork points.
        </p>
      ) : students.length === 0 ? (
        <EmptyState
          title="No students in this class yet"
          description="Students appear here as soon as they join."
        />
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border">
            {students.map((m) => (
              <AwardRow
                key={m.user.id}
                classId={classId}
                lessonId={lessonId}
                student={m}
                existing={awardFor.get(m.user.id)}
                maxPoints={data.max_points}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Up to {data.max_points} points per student. Recording again replaces the
            number — a student is paid once for a lesson, not once per press.
          </p>
        </>
      )}
    </Card>
  );
}
