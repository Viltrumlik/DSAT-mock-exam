"use client";

import { CalendarCheck } from "lucide-react";
import type { BadgeTone } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody, Pill, SubHeading, Table, Td, TONE_TEXT, WIDE_ONLY } from "../Fieldset";
import { formatDay } from "../format";
import { rateTone } from "../PersonHeader";
import { AttendancePatterns } from "../graphics";
import { usePersonPart, type PersonAttendance } from "../personApi";

/** Each class's attendance, one card each, and the last 30 days' marks — each mark in its colour, with what lc-up was sent. */

export const MARK: Record<string, { label: string; tone: BadgeTone }> = {
  PRESENT: { label: "Present", tone: "positive" },
  LATE: { label: "Late", tone: "attention" },
  ABSENT: { label: "Absent", tone: "critical" },
  EXCUSED: { label: "Excused", tone: "neutral" },
};
export const PUSH: Record<string, { label: string; tone: BadgeTone }> = {
  sent: { label: "Sent", tone: "positive" },
  failed: { label: "Failed", tone: "critical" },
  refused: { label: "Refused", tone: "attention" },
};

const CHIP: Record<string, string> = {
  present: "bg-ms-positive-soft text-ms-positive-fg",
  late: "bg-ms-attention-soft text-ms-attention-fg",
  absent: "bg-ms-critical-soft text-ms-critical-fg",
  excused: "bg-ms-info-soft text-ms-info-fg",
};

function ClassCard({ c }: { c: PersonAttendance["classes"][number] }) {
  const tone = rateTone(c.rate);
  return (
    <li data-testid="attendance-class" className="rounded-[16px] border border-ms-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate font-semibold text-ms-fg">{c.name}</p>
        {c.active ? null : <Pill tone="line">Left</Pill>}
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold tabular-nums", TONE_TEXT[tone])}>
          {c.rate == null ? "—" : `${c.rate}%`}
        </span>
        <span className="text-xs text-ms-fg-3">
          of {c.counted} lesson{c.counted === 1 ? "" : "s"}
        </span>
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
        {(["present", "late", "absent", "excused"] as const).map((k) => (
          <li key={k} className={cn("rounded-md px-2 py-1 tabular-nums", CHIP[k])}>
            {k[0].toUpperCase() + k.slice(1)} {c[k]}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function AttendanceSection({ id }: { id: number }) {
  const query = usePersonPart<PersonAttendance>(id, "attendance");
  return (
    <Fieldset
      title="Attendance"
      icon={CalendarCheck}
      tone="success"
      description="Each class over all its lessons · marks from the last 9 weeks"
    >
      <PartBody
        query={query}
        isEmpty={(d) => d.classes.length === 0 && d.recent.length === 0}
        render={(d) => (
          <>
            <AttendancePatterns data={d} />
            {d.classes.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.classes.map((c) => (
                  <ClassCard key={c.id} c={c} />
                ))}
              </ul>
            ) : null}
            <div className={d.classes.length > 0 ? "mt-6" : undefined}>
              <SubHeading>Recent marks</SubHeading>
              {d.recent.length === 0 ? (
                <p className="rounded-ms-ctl bg-ms-surface px-4 py-3 text-ms-fg-2">No marks in the last 30 days.</p>
              ) : (
                <Table head={["Date", "Class", "Mark", { label: "Note", className: WIDE_ONLY }, { label: "lc-up", className: WIDE_ONLY }]}>
                  {d.recent.map((r, i) => {
                    const mark = MARK[r.status] ?? { label: r.status, tone: "neutral" as BadgeTone };
                    const push = r.lcup_push ? PUSH[r.lcup_push] : null;
                    return (
                      <tr key={`${r.date}-${r.class_id}-${i}`}>
                        <Td className="tabular-nums text-ms-fg-3">{formatDay(r.date)}</Td>
                        {/* On a phone these wrap rather than cut: the reason is the point of an excused mark. */}
                        <Td wrap className="sm:max-w-[14rem] sm:truncate">
                          {r.class_name}
                        </Td>
                        <Td wrap>
                          <Pill tone={mark.tone}>{mark.label}</Pill>
                          {r.reason ? <span className="text-ms-fg-3"> — {r.reason}</span> : null}
                        </Td>
                        <Td className={`${WIDE_ONLY} max-w-[16rem] truncate text-ms-fg-3`}>{r.note || "—"}</Td>
                        <Td className={WIDE_ONLY}>
                          {push ? <Pill tone={push.tone}>{push.label}</Pill> : <span className="text-ms-fg-3">—</span>}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </div>
          </>
        )}
      />
    </Fieldset>
  );
}
