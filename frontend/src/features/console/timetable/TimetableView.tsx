"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { fetchLessonsOn, fetchLessonsToday, lessonsOnKey, lessonsTodayKey, type LessonsToday } from "../lessonsToday";
import { Button, EmptyState, ErrorState, Segmented, Tabs, tashkentToday } from "../ui";
import { RoomTimeline } from "./RoomTimeline";
import {
  axisOf,
  clock,
  dayTabs,
  duration,
  exportRows,
  parityOf,
  roomRows,
  roomUsage,
  soonestOf,
  weekdayOf,
  type DayTab,
  type DayTabId,
  type Parity,
} from "./timetable";
import { downloadXlsx } from "./xlsx";

/**
 * Which day the timetable shows and its lessons: Today, or a weekday's next lesson day; the "Even days / Odd
 * days" switch jumps to the soonest day of that pattern. Today's lessons are the same request the Today page
 * makes; another day asks the endpoint with `?date=`.
 */
export function useTimetable(enabled = true) {
  const today = tashkentToday();
  const tabs = useMemo(() => dayTabs(today), [today]);
  const [tab, setTab] = useState<DayTabId>("today");
  const [parity, setParity] = useState<Parity>(() => parityOf(weekdayOf(today)) ?? "odd");
  const current: DayTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const isToday = current.date === today;
  const query = useQuery<LessonsToday>({
    queryKey: isToday ? lessonsTodayKey : lessonsOnKey(current.date),
    queryFn: isToday ? fetchLessonsToday : () => fetchLessonsOn(current.date),
    enabled,
    staleTime: 60_000,
    refetchInterval: isToday ? 120_000 : false,
  });
  const choose = (id: DayTabId) => {
    setTab(id);
    const p = tabs.find((t) => t.id === id)?.parity;
    if (p) setParity(p);
  };
  const chooseParity = (p: Parity) => {
    setParity(p);
    setTab(soonestOf(tabs, p));
  };
  return { tabs, tab, current, isToday, parity, choose, chooseParity, query };
}

export type Timetable = ReturnType<typeof useTimetable>;

function GridSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 rounded-[10px] border border-ms-grid p-3">
      <span className="animate-ms-shimmer h-6 rounded-[6px]" />
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="animate-ms-shimmer h-[72px] rounded-[8px]" style={{ marginLeft: `${12 + (i % 2) * 20}%`, width: `${36 + (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}

/** "Room usage": each room's lessons and busy hours on the shown day, as a share of the axis. */
function RoomUsageTable({ data }: { data: LessonsToday }) {
  const axis = axisOf(data.lessons);
  const usage = roomUsage(roomRows(data.lessons, axis), axis);
  return (
    <div className="overflow-x-auto rounded-[10px] border border-ms-grid">
      <table className="w-full min-w-[420px] text-left">
        <caption className="sr-only">Room usage</caption>
        <thead>
          <tr>
            <th className="px-3.5">Room</th>
            <th className="px-3.5 text-right">Lessons</th>
            <th className="px-3.5 text-right">Busy</th>
            <th className="px-3.5 text-right">
              Of {clock(axis.start)}–{clock(axis.end)}
            </th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.key || "none"}>
              <td className={`px-3.5 font-semibold ${u.key ? "" : "text-ms-fg-3"}`}>{u.label}</td>
              <td className="px-3.5 text-right tabular-nums">{u.lessons}</td>
              <td className="px-3.5 text-right tabular-nums">{duration(u.minutes)}</td>
              <td className="px-3.5 text-right tabular-nums">{Math.round(u.share * 100)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The timetable (LessonsTimeline board; parity row 23): "Even days / Odd days", the day tabs Today, Mon … Sun,
 * Room usage and Export to Excel, then the rooms × hours grid. A lesson with no readable time is named under it,
 * never dropped; loading has the grid's shape; a failure says so and is never drawn as an empty day.
 */
export function TimetableView({ t, idPrefix = "timetable" }: { t: Timetable; idPrefix?: string }) {
  const [usage, setUsage] = useState(false);
  const data = t.query.data;
  const lessons = data?.lessons ?? [];
  const untimed = lessons.filter((l) => !l.starts_at || !l.ends_at);
  const timed = lessons.length - untimed.length;
  const dayPrefix = `${idPrefix}-day`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Segmented<Parity>
          label="Lesson days"
          size="sm"
          options={[
            { value: "even", label: "Even days" },
            { value: "odd", label: "Odd days" },
          ]}
          value={t.parity}
          onChange={t.chooseParity}
        />
        <Tabs<DayTabId>
          label="Day"
          idPrefix={dayPrefix}
          value={t.tab}
          onChange={t.choose}
          className="max-w-full border-b-0 [&_[role=tab]]:h-10"
          tabs={t.tabs.map((d) => ({ id: d.id, label: <span title={d.long}>{d.short}</span> }))}
        />
        <div className="flex-1" />
        <Button variant={usage ? "secondary" : "ghost"} size="sm" icon="sigma" aria-pressed={usage} disabled={!timed} onClick={() => setUsage((v) => !v)}>
          Room usage
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="download"
          disabled={!data || !lessons.length}
          onClick={() => data && downloadXlsx(`timetable-${data.date}.xlsx`, exportRows(data), "Timetable")}
        >
          Export to Excel
        </Button>
      </div>

      <div role="tabpanel" id={`${dayPrefix}-${t.tab}-panel`} aria-labelledby={`${dayPrefix}-${t.tab}`} className="flex min-w-0 flex-col gap-3">
        {t.query.isPending ? (
          <>
            <span className="sr-only">Loading the lessons…</span>
            <GridSkeleton />
          </>
        ) : t.query.isError ? (
          <ErrorState what={`the lessons of ${t.current.long}`} onRetry={() => void t.query.refetch()} />
        ) : !lessons.length ? (
          <EmptyState
            icon="cal"
            title={t.current.parity ? `No lessons on ${t.current.long}.` : "No lessons on Sundays."}
            detail={t.current.parity ? undefined : "Groups meet on odd days (Mon, Wed, Fri) or even days (Tue, Thu, Sat)."}
          />
        ) : (
          <>
            {timed ? <RoomTimeline key={t.current.date} lessons={lessons} isToday={t.isToday} /> : null}
            {untimed.length ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ms-fg-3">
                <span>No time set:</span>
                {untimed.map((l) => (
                  <Link key={l.classroom.id} href={`/ops/classrooms/${l.classroom.id}`} className="font-semibold text-ms-fg hover:underline">
                    {l.classroom.name}
                  </Link>
                ))}
              </p>
            ) : null}
            {usage && timed ? <RoomUsageTable data={data!} /> : null}
            {timed ? (
              <p className="text-[13px] text-ms-fg-3">
                {t.isToday ? "Red line = now. " : ""}Colour = course. A card opens its group; “Not marked” means the register is still open.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
