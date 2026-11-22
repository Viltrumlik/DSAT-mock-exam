"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { NotKept } from "@/features/ops/detail/NotKept";
import { dayText } from "@/features/ops/detail/groupFacts";
import { Fieldset, PartBody } from "@/features/ops/people/Fieldset";
import { rateVerdict } from "@/features/ops/people/PersonHeader";
import { useClassroomPart, type ClassroomRoster } from "../classroomsApi";

/**
 * The group page's Rating tab (lc-up's "Reyting", 22 Nov 2026). lc-up ranks a group by its marks; this system keeps
 * no marks, so the tab ranks the students by what it does keep — attendance in this group, then homework handed in
 * — and says the marks rating is not kept. The same rates the old Students table showed, per student.
 */

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);
const verdictCell = (n: number | null) => rateVerdict(n);

/** Attendance first, then homework; a student with nothing yet goes last. */
function rank(rows: ClassroomRoster["students"]) {
  const key = (n: number | null) => (n == null ? -1 : n);
  return [...rows].sort((a, b) => key(b.attendance_rate) - key(a.attendance_rate) || key(b.homework_rate) - key(a.homework_rate));
}

export function RatingSection({ roomId }: { roomId: number }) {
  const query = useClassroomPart<ClassroomRoster>(roomId, "roster");
  return (
    <Fieldset title="Rating" description="Ranked by attendance in this group, then homework handed in">
      <div className="flex flex-col gap-3">
        <NotKept>Marks are not kept in this system yet, so lc-up&apos;s average-mark rating is not shown.</NotKept>
        <PartBody
          query={query}
          isEmpty={(d) => d.students.length === 0}
          render={(d) => (
            <div className="overflow-x-auto rounded-ms-ctl border border-ms-grid">
              <table className="w-full min-w-[480px] text-[14px]">
                <thead>
                  <tr>
                    <th scope="col" className="w-0 px-3 text-right">#</th>
                    <th scope="col" className="px-3 text-left">Student</th>
                    <th scope="col" className="px-3 text-right">Attendance</th>
                    <th scope="col" className="px-3 text-right">Homework</th>
                    <th scope="col" className="px-3 text-left">In the group since</th>
                  </tr>
                </thead>
                <tbody>
                  {rank(d.students).map((s, i) => (
                    <tr key={s.id}>
                      <td className="w-0 px-3 text-right tabular-nums text-ms-fg-3">{i + 1}</td>
                      <td className="px-3">
                        <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} className="font-medium hover:underline">
                          {s.name || s.username}
                        </Link>
                      </td>
                      <td
                        className={cn("px-3 text-right font-semibold tabular-nums")}
                        data-verdict={s.attendance_rate == null ? undefined : verdictCell(s.attendance_rate) === "critical" ? "critical" : undefined}
                      >
                        {pct(s.attendance_rate)}
                      </td>
                      <td
                        className="px-3 text-right font-semibold tabular-nums"
                        data-verdict={s.homework_rate == null ? undefined : verdictCell(s.homework_rate) === "critical" ? "critical" : undefined}
                      >
                        {pct(s.homework_rate)}
                      </td>
                      <td className="whitespace-nowrap px-3 tabular-nums text-ms-fg-2">{dayText(s.seat_start_date ?? s.joined_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    </Fieldset>
  );
}
