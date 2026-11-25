"use client";

import Link from "next/link";
import { shortDay } from "@/features/ops/detail/groupFacts";
import type { LessonChange } from "@/features/ops/classrooms/lessonChangesApi";
import { Button } from "../ui";

/** What happened to a lesson on the shown day: "Cancelled", "Moved to 9 Dec", "Moved from 8 Dec". */
export function changeOnDay(change: LessonChange, date: string): string {
  if (change.kind === "move" && change.new_day) {
    return change.new_day === date ? `Moved from ${shortDay(change.day)}` : `Moved to ${shortDay(change.new_day)}`;
  }
  return "Cancelled";
}

/**
 * "Lesson changes" under the timetable (owner, 2026-11-25): the shown day's lessons called off or moved and a centre
 * holiday, ruled like every admin table, each with Undo for whoever holds `manage_lessons`.
 */
export function LessonChangesTable({
  date,
  changes,
  canUndo,
  onUndo,
}: {
  /** "YYYY-MM-DD": the day the timetable shows. */
  date: string;
  changes: LessonChange[];
  canUndo: boolean;
  onUndo: (change: LessonChange) => void;
}) {
  return (
    <section aria-label="Lesson changes" className="flex flex-col gap-2">
      <h2 className="text-ms-h text-ms-fg">Lesson changes</h2>
      <div className="overflow-x-auto rounded-[10px] border border-ms-grid">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr>
              <th className="px-3.5">Group</th>
              <th className="px-3.5">Change</th>
              <th className="px-3.5">Reason</th>
              {canUndo ? (
                <th className="px-3.5">
                  <span className="sr-only">Undo</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.id}>
                <td className="px-3.5 font-semibold">
                  {change.classroom_id ? (
                    <Link href={`/ops/classrooms/${change.classroom_id}`} className="hover:underline">
                      {change.classroom}
                    </Link>
                  ) : (
                    "Centre holiday"
                  )}
                </td>
                <td className="px-3.5">{changeOnDay(change, date)}</td>
                <td className="px-3.5">{change.reason}</td>
                {canUndo ? (
                  <td className="px-3.5 text-right">
                    <Button size="sm" variant="ghost" icon="undo" onClick={() => onUndo(change)}>
                      Undo
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
