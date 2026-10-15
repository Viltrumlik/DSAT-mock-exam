"use client";

import { BookCheck, CalendarCheck, CalendarDays, History, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody, StatTile, Table, Td, TONE_TEXT, WIDE_ONLY } from "@/features/ops/people/Fieldset";
import { formatDateTime, formatDay } from "@/features/ops/people/format";
import { rateTone } from "@/features/ops/people/PersonHeader";
import { PUSH } from "@/features/ops/people/sections/AttendanceSection";
import {
  useClassroomPart,
  type ClassroomAttendance,
  type ClassroomHistory,
  type ClassroomHomework,
} from "../classroomsApi";

/**
 * The class's read-only tabs — attendance, homework, history — each its own request, read the way
 * the person page reads them: a count in the colour of what it means (present green, absent red),
 * what lc-up was sent as a badge, a share handed in in the colour of its verdict, and the history
 * as a timeline.
 */

/** A count that is not zero, in its mark's colour; a zero stays quiet. */
function Count({ n, tone }: { n: number; tone: "success" | "warning" | "danger" | "info" }) {
  return <span className={cn("tabular-nums", n > 0 ? cn("font-semibold", TONE_TEXT[tone]) : "text-muted-foreground")}>{n}</span>;
}

export function ClassAttendanceSection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomAttendance>(id, "attendance");
  return (
    <Fieldset title="Attendance" icon={CalendarCheck} description="Every marked lesson, newest first, and what lc-up was sent">
      <PartBody
        query={query}
        isEmpty={(d) => d.sessions.length === 0}
        render={(d) => (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile
                label="Overall"
                value={d.rate == null ? "—" : `${Math.round(d.rate)}%`}
                icon={CalendarCheck}
                tone={rateTone(d.rate)}
                sub="present or late, over every marked lesson"
              />
              <StatTile
                label="Last lesson"
                value={formatDay(d.sessions[0]?.date)}
                icon={CalendarDays}
                tone="primary"
                sub={`the last ${d.sessions.length} lesson${d.sessions.length === 1 ? "" : "s"} below`}
              />
            </div>
            <Table
              head={[
                "Date",
                "Present",
                { label: "Late", className: WIDE_ONLY },
                "Absent",
                { label: "Excused", className: WIDE_ONLY },
                { label: "lc-up", className: WIDE_ONLY },
              ]}
            >
              {d.sessions.map((s) => (
                <tr key={s.date}>
                  <Td className="tabular-nums text-muted-foreground">{formatDay(s.date)}</Td>
                  <Td>
                    <Count n={s.present} tone="success" />
                  </Td>
                  <Td className={WIDE_ONLY}>
                    <Count n={s.late} tone="warning" />
                  </Td>
                  <Td>
                    <Count n={s.absent} tone="danger" />
                  </Td>
                  <Td className={WIDE_ONLY}>
                    <Count n={s.excused} tone="info" />
                  </Td>
                  <Td className={WIDE_ONLY}>
                    {s.lcup_push ? (
                      <Badge variant={PUSH[s.lcup_push]?.variant ?? "neutral"}>{PUSH[s.lcup_push]?.label ?? s.lcup_push}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      />
    </Fieldset>
  );
}

export function ClassHomeworkSection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomHomework>(id, "homework");
  return (
    <Fieldset title="Homework" icon={BookCheck} description="Published homework, by due date, and who turned it in">
      <PartBody
        query={query}
        isEmpty={(d) => d.assignments.length === 0}
        render={(d) => (
          <Table head={["Title", { label: "Due", className: WIDE_ONLY }, "Turned in"]}>
            {d.assignments.map((a) => {
              const rate = a.students > 0 ? (100 * a.turned_in) / a.students : null;
              return (
                <tr key={a.id}>
                  <Td wrap className="font-medium sm:max-w-[24rem] sm:truncate">
                    {a.title}
                  </Td>
                  <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>
                    {a.due_at ? formatDateTime(a.due_at) : "No due date"}
                  </Td>
                  <Td className={cn("font-semibold tabular-nums", TONE_TEXT[rateTone(rate)])}>
                    {a.turned_in} / {a.students}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      />
    </Fieldset>
  );
}

export function ClassHistorySection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomHistory>(id, "history");
  return (
    <Fieldset title="History" icon={History} tone="neutral" description="Who joined, left or changed role, newest first">
      <PartBody
        query={query}
        isEmpty={(d) => d.items.length === 0}
        render={(d) => (
          <>
            <ol className="ml-1.5 border-l border-border">
              {d.items.map((item, i) => (
                <li key={`${item.at}-${i}`} className="relative break-words py-2 pl-6">
                  <span
                    aria-hidden
                    className="absolute -left-[5px] top-[15px] h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card"
                  />
                  <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(item.at)}</span>
                  {" · "}
                  <span className="font-medium text-foreground">{item.title}</span>
                  {item.by ? <span className="text-muted-foreground"> · by {item.by}</span> : null}
                </li>
              ))}
            </ol>
            {d.truncated ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <ListChecks aria-hidden className="h-3.5 w-3.5" />
                Showing the latest 200.
              </p>
            ) : null}
          </>
        )}
      />
    </Fieldset>
  );
}
