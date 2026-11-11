"use client";

import { AttendancePattern, ScoreTrend, type Mark, type WeekdayRow } from "@/features/console/graphics";
import { Timeline, addDaysIso, tashkentToday, type TimelineEvent } from "@/features/console/ui";
import type { IconName } from "@/components/ui/Icon";
import { formatDateTime, formatDay } from "./format";
import type { PersonAttendance, PersonHistory, PersonResults } from "./personApi";

/**
 * The student page's graphics (design handoff v0.3, Graphics board · 2; PR 10a): the attendance pattern per
 * class, the mock scores towards the student's own target, and the history as a timeline.
 */
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MARK: Record<string, Mark> = { PRESENT: "present", LATE: "late", ABSENT: "absent", EXCUSED: "excused" };

const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Nine weeks × the days a class meets, ending this week: each cell its mark, a day still to come "coming", a
 * day that passed with no mark "none". Weeks are labelled by their Monday.
 */
export function attendanceGrid(
  marks: readonly { date: string; class_id: number; status: string }[],
  cls: { id: number; weekdays?: number[] },
  today: string,
  weeks = 9,
): { weeks: string[]; rows: WeekdayRow[] } {
  const thisMonday = addDaysIso(today, -weekdayOf(today));
  const mondays = Array.from({ length: weeks }, (_, i) => addDaysIso(thisMonday, -7 * (weeks - 1 - i)));
  const own = marks.filter((m) => m.class_id === cls.id && m.date >= mondays[0]);
  const schedule = new Set(cls.weekdays ?? []);
  // The class's days now, and every day it holds a mark on in the window: a class that moved days keeps
  // its earlier marks (they would vanish if only today's schedule drew the rows).
  const days = [...new Set([...schedule, ...own.map((m) => weekdayOf(m.date))])].sort((a, b) => a - b);
  const byDate = new Map(own.map((m) => [m.date, m.status]));
  return {
    weeks: mondays.map(short),
    rows: days.map((d) => ({
      day: DAY[d],
      marks: mondays.map((mon) => {
        const date = addDaysIso(mon, d);
        const status = byDate.get(date);
        if (status) return MARK[status] ?? "excused";
        // Still to come only on a day it meets now; a day it no longer meets is just empty.
        return date > today && schedule.has(d) ? "coming" : "none";
      }),
    })),
  };
}

export function AttendancePatterns({ data, today = tashkentToday() }: { data: PersonAttendance; today?: string }) {
  const live = data.classes.filter((c) => c.active);
  if (!live.length) return null;
  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      {live.map((c) => {
        const grid = attendanceGrid(data.recent, c, today);
        if (!grid.rows.length) return null;
        // The days it meets now (rows may add days it held marks on before a move).
        const days = (c.weekdays?.length ? c.weekdays.map((d) => DAY[d]) : grid.rows.map((r) => r.day)).join(" ");
        return (
          <AttendancePattern
            key={c.id}
            title={c.name}
            sub={`Last 9 weeks · ${days}${c.lesson_time ? ` · ${c.lesson_time}` : ""}`}
            weeks={grid.weeks}
            rows={grid.rows}
          />
        );
      })}
    </div>
  );
}

/** Mock totals, oldest first, towards the student's own target — drawn from two mocks on. */
export function MockScores({ mocks, target }: { mocks: PersonResults["mocks"]; target: number | null }) {
  const points = [...mocks]
    .filter((m): m is typeof m & { total: number } => m.total != null)
    .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")))
    .map((m) => ({ label: m.at ? short(m.at.slice(0, 10)) : m.title, total: m.total }));
  if (points.length < 2) return null;
  return (
    <div className="rounded-[16px] bg-ms-surface p-4">
      <ScoreTrend
        title="Mock scores"
        sub={target ? `Target ${target} · set by the student` : "No target set by the student"}
        points={points}
        target={target}
      />
    </div>
  );
}

const KIND: Record<PersonHistory["items"][number]["kind"], { icon: IconName; tone: TimelineEvent["tone"]; filter: string }> = {
  payment: { icon: "ms-paid", tone: "positive", filter: "money" },
  group: { icon: "users", tone: "info", filter: "seat" },
  security: { icon: "shield", tone: "neutral", filter: "security" },
  role: { icon: "user", tone: "neutral", filter: "admin" },
  admin: { icon: "pencil", tone: "attention", filter: "admin" },
};

export function historyEvents(items: PersonHistory["items"]): TimelineEvent[] {
  return [...items]
    .sort((a, b) => (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0))
    .map((item, i) => {
      const k = KIND[item.kind] ?? KIND.security;
      const when = item.all_day ? formatDay(item.at.slice(0, 10)) : formatDateTime(item.at);
      return { id: `${item.at}-${i}`, kind: k.filter, icon: k.icon, tone: k.tone, title: item.title, meta: item.by ? `by ${item.by} · ${when}` : when };
    });
}

export function HistoryTimeline({ items }: { items: PersonHistory["items"] }) {
  return (
    <Timeline
      label="History"
      events={historyEvents(items)}
      filters={[
        { id: "money", label: "Money" },
        { id: "seat", label: "Seat" },
        { id: "security", label: "Security" },
        { id: "admin", label: "Admin" },
      ]}
    />
  );
}
