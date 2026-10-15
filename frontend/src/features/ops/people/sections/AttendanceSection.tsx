"use client";

import { CalendarCheck } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody, SubHeading, Table, Td, TONE_TEXT, WIDE_ONLY } from "../Fieldset";
import { formatDay } from "../format";
import { rateTone } from "../PersonHeader";
import { usePersonPart, type PersonAttendance } from "../personApi";

/** Each class's attendance, one card each, and the last 30 days' marks — each mark in its colour, with what lc-up was sent. */

export const MARK: Record<string, { label: string; variant: BadgeVariant }> = {
  PRESENT: { label: "Present", variant: "success" },
  LATE: { label: "Late", variant: "warning" },
  ABSENT: { label: "Absent", variant: "danger" },
  EXCUSED: { label: "Excused", variant: "info" },
};
export const PUSH: Record<string, { label: string; variant: BadgeVariant }> = {
  sent: { label: "Sent", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  refused: { label: "Refused", variant: "warning" },
};

const CHIP: Record<string, string> = {
  present: "bg-success-soft text-success-foreground",
  late: "bg-warning-soft text-warning-foreground",
  absent: "bg-danger-soft text-danger-foreground",
  excused: "bg-info-soft text-info-foreground",
};

function ClassCard({ c }: { c: PersonAttendance["classes"][number] }) {
  const tone = rateTone(c.rate);
  return (
    <li data-testid="attendance-class" className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate font-semibold text-foreground">{c.name}</p>
        {c.active ? null : <Badge variant="outline">Left</Badge>}
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold tabular-nums", TONE_TEXT[tone])}>
          {c.rate == null ? "—" : `${c.rate}%`}
        </span>
        <span className="text-xs text-muted-foreground">
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
      description="Each class over all its lessons · marks from the last 30 days"
    >
      <PartBody
        query={query}
        isEmpty={(d) => d.classes.length === 0 && d.recent.length === 0}
        render={(d) => (
          <>
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
                <p className="rounded-lg bg-surface-2 px-4 py-3 text-muted-foreground">No marks in the last 30 days.</p>
              ) : (
                <Table head={["Date", "Class", "Mark", { label: "Note", className: WIDE_ONLY }, { label: "lc-up", className: WIDE_ONLY }]}>
                  {d.recent.map((r, i) => {
                    const mark = MARK[r.status] ?? { label: r.status, variant: "neutral" as BadgeVariant };
                    const push = r.lcup_push ? PUSH[r.lcup_push] : null;
                    return (
                      <tr key={`${r.date}-${r.class_id}-${i}`}>
                        <Td className="tabular-nums text-muted-foreground">{formatDay(r.date)}</Td>
                        {/* On a phone these wrap rather than cut: the reason is the point of an excused mark. */}
                        <Td wrap className="sm:max-w-[14rem] sm:truncate">
                          {r.class_name}
                        </Td>
                        <Td wrap>
                          <Badge variant={mark.variant}>{mark.label}</Badge>
                          {r.reason ? <span className="text-muted-foreground"> — {r.reason}</span> : null}
                        </Td>
                        <Td className={`${WIDE_ONLY} max-w-[16rem] truncate text-muted-foreground`}>{r.note || "—"}</Td>
                        <Td className={WIDE_ONLY}>
                          {push ? <Badge variant={push.variant}>{push.label}</Badge> : <span className="text-muted-foreground">—</span>}
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
