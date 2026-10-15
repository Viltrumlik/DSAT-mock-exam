"use client";

import { Fieldset, PartBody, Table, Td, WIDE_ONLY } from "@/features/ops/people/Fieldset";
import { formatDateTime, formatDay } from "@/features/ops/people/format";
import {
  useClassroomPart,
  type ClassroomAttendance,
  type ClassroomHistory,
  type ClassroomHomework,
} from "../classroomsApi";

/** The class's read-only tabs — attendance, homework, history — each its own request. */

const PUSH: Record<string, string> = { sent: "Sent", failed: "Failed", refused: "Refused" };

export function ClassAttendanceSection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomAttendance>(id, "attendance");
  return (
    <Fieldset title="Attendance">
      <PartBody
        query={query}
        isEmpty={(d) => d.sessions.length === 0}
        render={(d) => (
          <>
            <p className="mb-2">
              Overall {d.rate == null ? "—" : `${Math.round(d.rate)}%`}
              <span className="text-muted-foreground"> · the last {d.sessions.length} lessons</span>
            </p>
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
                  <Td className="tabular-nums">{s.present}</Td>
                  <Td className={`${WIDE_ONLY} tabular-nums`}>{s.late}</Td>
                  <Td className="tabular-nums">{s.absent}</Td>
                  <Td className={`${WIDE_ONLY} tabular-nums`}>{s.excused}</Td>
                  <Td className={`${WIDE_ONLY} text-muted-foreground`}>
                    {s.lcup_push ? (PUSH[s.lcup_push] ?? s.lcup_push) : "—"}
                  </Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      />
    </Fieldset>
  );
}

export function ClassHomeworkSection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomHomework>(id, "homework");
  return (
    <Fieldset title="Homework">
      <PartBody
        query={query}
        isEmpty={(d) => d.assignments.length === 0}
        render={(d) => (
          <Table head={["Title", { label: "Due", className: WIDE_ONLY }, "Turned in"]}>
            {d.assignments.map((a) => (
              <tr key={a.id}>
                <Td wrap className="sm:max-w-[24rem] sm:truncate">
                  {a.title}
                </Td>
                <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>
                  {a.due_at ? formatDateTime(a.due_at) : "No due date"}
                </Td>
                <Td className="tabular-nums">
                  {a.turned_in} / {a.students}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      />
    </Fieldset>
  );
}

export function ClassHistorySection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomHistory>(id, "history");
  return (
    <Fieldset title="History">
      <PartBody
        query={query}
        isEmpty={(d) => d.items.length === 0}
        render={(d) => (
          <>
            <ol className="space-y-0.5">
              {d.items.map((item, i) => (
                <li key={`${item.at}-${i}`} className="break-words">
                  <span className="tabular-nums text-muted-foreground">{formatDateTime(item.at)}</span>
                  {" · "}
                  {item.title}
                  {item.by ? <span className="text-muted-foreground"> · by {item.by}</span> : null}
                </li>
              ))}
            </ol>
            {d.truncated ? <p className="mt-3 text-xs text-muted-foreground">Showing the latest 200.</p> : null}
          </>
        )}
      />
    </Fieldset>
  );
}
