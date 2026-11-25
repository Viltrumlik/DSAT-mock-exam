"use client";

import Link from "next/link";
import { shortDay } from "@/features/ops/detail/groupFacts";
import type { LessonChange, LessonChangeList } from "@/features/ops/classrooms/lessonChangesApi";
import { Button } from "../ui";

/** What happened to the lesson: "Cancelled", or "Moved to 9 Dec". */
export function changeText(change: LessonChange): string {
  return change.kind === "move" && change.new_day ? `Moved to ${shortDay(change.new_day)}` : "Cancelled";
}

/**
 * "Lesson changes" under the timetable (owner, 2026-11-25): every live lesson change of the days that can be changed,
 * a month back to two months ahead — centre holidays first, then the class changes by day, as the server orders them —
 * ruled like every admin table, each with Undo for whoever holds `manage_lessons`. A holiday is undone here, or from
 * its column in any group's register.
 */
export function LessonChangesTable({
  list,
  canUndo,
  onUndo,
}: {
  list: LessonChangeList;
  canUndo: boolean;
  onUndo: (change: LessonChange) => void;
}) {
  return (
    <section aria-label="Lesson changes" className="flex flex-col gap-2">
      <h2 className="text-ms-h text-ms-fg">Lesson changes</h2>
      {list.changes.length ? (
        <div className="overflow-x-auto rounded-[10px] border border-ms-grid">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr>
                <th className="px-3.5">Day</th>
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
              {list.changes.map((change) => (
                <tr key={change.id}>
                  <td className="whitespace-nowrap px-3.5 tabular-nums">{shortDay(change.day)}</td>
                  <td className="px-3.5 font-semibold">
                    {change.classroom_id ? (
                      <Link href={`/ops/classrooms/${change.classroom_id}`} className="hover:underline">
                        {change.classroom}
                      </Link>
                    ) : (
                      "Centre holiday"
                    )}
                  </td>
                  <td className="px-3.5">{changeText(change)}</td>
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
      ) : (
        <p className="text-[14px] text-ms-fg-2">
          No lesson is cancelled or moved from {shortDay(list.from)} to {shortDay(list.to)}.
        </p>
      )}
    </section>
  );
}
