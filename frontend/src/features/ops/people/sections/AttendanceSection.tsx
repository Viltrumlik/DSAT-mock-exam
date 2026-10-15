"use client";

import { Fieldset, PartBody, SubHeading, Table, Td, WIDE_ONLY } from "../Fieldset";
import { formatDay } from "../format";
import { usePersonPart, type PersonAttendance } from "../personApi";

/** Each class's attendance rate, and the last 30 days' marks with what lc-up was sent. */

const MARK: Record<string, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", EXCUSED: "Excused" };
const PUSH: Record<string, string> = { sent: "Sent", failed: "Failed", refused: "Refused" };

function markText(status: string, reason: string): string {
  const mark = MARK[status] ?? status;
  return reason ? `${mark} — ${reason}` : mark;
}

function classLine(c: PersonAttendance["classes"][number]): string {
  const rate = c.rate == null ? "—%" : `${c.rate}%`;
  return (
    `${c.name}${c.active ? "" : " (left)"} — ${rate} of ${c.counted}` +
    ` · present ${c.present} · late ${c.late} · absent ${c.absent} · excused ${c.excused}`
  );
}

export function AttendanceSection({ id }: { id: number }) {
  const query = usePersonPart<PersonAttendance>(id, "attendance");
  return (
    <Fieldset title="Attendance (last 30 days)">
      <PartBody
        query={query}
        isEmpty={(d) => d.classes.length === 0 && d.recent.length === 0}
        render={(d) => (
          <>
            {d.classes.length > 0 ? (
              <ul className="space-y-0.5 tabular-nums">
                {d.classes.map((c) => (
                  <li key={c.id} className={c.active ? "text-foreground" : "text-muted-foreground"}>
                    {classLine(c)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={d.classes.length > 0 ? "mt-4" : undefined}>
              <SubHeading>Recent marks</SubHeading>
              {d.recent.length === 0 ? (
                <p className="text-muted-foreground">No marks in the last 30 days.</p>
              ) : (
                <Table head={["Date", "Class", "Mark", { label: "Note", className: WIDE_ONLY }, { label: "lc-up", className: WIDE_ONLY }]}>
                  {d.recent.map((r, i) => (
                    <tr key={`${r.date}-${r.class_id}-${i}`}>
                      <Td className="tabular-nums text-muted-foreground">{formatDay(r.date)}</Td>
                      {/* On a phone these wrap rather than cut: the reason is the point of an excused mark. */}
                      <Td wrap className="sm:max-w-[14rem] sm:truncate">
                        {r.class_name}
                      </Td>
                      <Td wrap>{markText(r.status, r.reason)}</Td>
                      <Td className={`${WIDE_ONLY} max-w-[16rem] truncate text-muted-foreground`}>{r.note || "—"}</Td>
                      <Td className={`${WIDE_ONLY} text-muted-foreground`}>
                        {r.lcup_push ? (PUSH[r.lcup_push] ?? r.lcup_push) : "—"}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </>
        )}
      />
    </Fieldset>
  );
}
