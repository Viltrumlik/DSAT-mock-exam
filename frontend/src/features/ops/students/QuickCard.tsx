"use client";

import { useId, useState } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/Icon";
import {
  Avatar,
  Badge,
  Button,
  CourseTag,
  Dialog,
  balanceVerdict,
  buttonClass,
  signedAmount,
  tashkentToday,
  type BadgeTone,
} from "@/features/console/ui";
import type { StudentGroupCell, StudentRow } from "@/features/ops/changelist/peopleApi";
import { formatPhone } from "@/features/ops/people/format";
import { usePerson, usePersonPart, type PersonAttendance } from "@/features/ops/people/personApi";
import { cn } from "@/lib/cn";
import { groupLabel, groupLevel, shortDay, timeRange } from "./format";

/**
 * The student's quick card (canvas board "Students", state "Quick card"), opened from a group chip on the list: who
 * they are and how to reach them, what they owe, that group's seat and this month's marks — without leaving the
 * list. Everything is the person page's own data (`GET /users/admin/people/<id>/` and its attendance part, which
 * holds the last nine weeks); "Open student page" goes on from there.
 */

const SEAT: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  trial: { label: "DEMO", tone: "demo" },
  frozen: { label: "Frozen", tone: "frozen" },
};

const MARK: Record<string, { label: string; icon: IconName; className: string }> = {
  PRESENT: { label: "Present", icon: "check", className: "bg-ms-positive-soft text-ms-positive-fg" },
  LATE: { label: "Late", icon: "clock", className: "bg-ms-attention-soft text-ms-attention-fg" },
  ABSENT: { label: "Absent", icon: "x", className: "bg-ms-critical-soft text-ms-critical-fg" },
  EXCUSED: { label: "Excused", icon: "minus", className: "bg-ms-surface-2 text-ms-fg-3" },
};

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The attendance part reaches back this far (`users/people_parts.attendance_part`). */
const WINDOW_DAYS = 62;

/** "2026-11" for the months the attendance part covers, oldest first, ending with this one. */
export function coveredMonths(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - WINDOW_DAYS * 86_400_000);
  const out: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  while (year < y || (year === y && month <= m)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function monthTitle(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function QuickCard({
  student,
  group,
  showMoney,
  onClose,
}: {
  student: StudentRow;
  group: StudentGroupCell;
  /** `view_money`: the balance badge. */
  showMoney: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const core = usePerson(student.id);
  const attendance = usePersonPart<PersonAttendance>(student.id, "attendance");
  const months = coveredMonths(tashkentToday());
  const [monthIndex, setMonthIndex] = useState(months.length - 1);
  const month = months[monthIndex];

  const name = student.name || student.username;
  const parentPhone = core.data?.parent?.phone ? formatPhone(core.data.parent.phone) : "";
  const balance = showMoney ? student.lcup.balance : null;
  const verdict = balanceVerdict(balance);
  const seat = SEAT[String(group.seat_status ?? "")];
  const klass = attendance.data?.classes.find((c) => c.id === group.id);
  const days = (klass?.weekdays ?? []).map((d) => WEEKDAY[d]).filter(Boolean).join(" ");
  const time = timeRange(klass?.lesson_time, null);
  const marks = (attendance.data?.recent ?? [])
    .filter((r) => r.class_id === group.id && r.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));
  const facts = [
    group.joined ? `Joined ${shortDay(group.joined)}` : "",
    [days, time].filter(Boolean).join(" "),
    group.room ? `Room ${group.room}` : "",
    group.teacher?.name ?? "",
  ].filter(Boolean);

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} width={720}>
      <div className="flex items-center gap-3 border-b border-ms-border px-5 py-4">
        <Avatar name={name} src={student.avatar_url ?? null} size="md" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-[17px] font-semibold text-ms-fg">
            {name}
          </h2>
          <p className="truncate text-[13px] tabular-nums text-ms-fg-2">
            {[formatPhone(student.phone) || "No phone", parentPhone ? `parent ${parentPhone}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        {balance !== null && balance !== undefined ? (
          <Badge
            size="lg"
            tone={verdict === "critical" ? "critical" : verdict === "positive" ? "positive" : "neutral"}
            className="tabular-nums"
          >
            <span data-balance>{signedAmount(balance)}</span>
          </Badge>
        ) : null}
        <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon="left"
            aria-label="Previous month"
            disabled={monthIndex === 0}
            onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
          />
          <b className="flex-1 text-center text-[15px] text-ms-fg" aria-live="polite">
            {monthTitle(month)}
          </b>
          <Button
            variant="ghost"
            size="sm"
            icon="right"
            aria-label="Next month"
            disabled={monthIndex === months.length - 1}
            onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
          />
        </div>

        <section className="flex flex-col gap-2 rounded-ms-card border border-ms-border bg-ms-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <CourseTag level={groupLevel(group.level, group.name)}>
              {groupLabel(group.name, group.subject, group.teacher?.name.split(" ").slice(-1)[0])}
            </CourseTag>
            {seat ? <Badge tone={seat.tone}>{seat.label}</Badge> : null}
          </div>
          {facts.length ? <p className="text-[13px] text-ms-fg-2">{facts.join(" · ")}</p> : null}

          {attendance.isPending ? (
            <p className="text-[13px] text-ms-fg-3">Loading marks…</p>
          ) : attendance.isError ? (
            <p role="alert" className="flex items-center gap-2 text-[13px] text-ms-critical-fg">
              Could not load the marks.
              <Button variant="ghost" size="sm" icon="refresh" onClick={() => void attendance.refetch()}>
                Retry
              </Button>
            </p>
          ) : marks.length ? (
            <ul aria-label={`Marks in ${monthTitle(month)}`} className="flex flex-wrap gap-1">
              {marks.map((r) => {
                const look = MARK[r.status] ?? MARK.EXCUSED;
                const day = shortDay(r.date).replace(/ \d{4}$/, "");
                return (
                  <li
                    key={`${r.date}-${r.class_id}`}
                    title={`${day} · ${look.label}`}
                    aria-label={`${day}: ${look.label}`}
                    data-mark={r.status}
                    className={cn("grid h-6 w-[26px] place-items-center rounded-[6px]", look.className)}
                  >
                    <Icon name={look.icon} size="sm" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ms-fg-3">No marks in {monthTitle(month)}.</p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-ms-border px-5 py-3">
        <Link href={`/ops/students/${student.id}`} prefetch={false} data-autofocus className={buttonClass({ variant: "primary" })}>
          Open student page
        </Link>
      </div>
    </Dialog>
  );
}
