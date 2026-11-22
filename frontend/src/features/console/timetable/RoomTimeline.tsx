"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";

import { hhmm, type LessonRow } from "../lessonsToday";
import { Badge, courseColor } from "../ui";
import { axisOf, clock, lessonHref, lessonState, minutesOfDay, roomRows, type Axis, type PlacedLesson } from "./timetable";

/** The Room column, and how wide an hour is before the grid scrolls sideways instead of squeezing. */
const ROOM_COL = 112;
const HOUR_PX = 136;
/** The board's 13:00–20:00 at 136 px an hour; a day widened by an early or late lesson narrows its hours (to 88 px)
 * so the whole day still fits a desktop card instead of hiding the afternoon behind a sideways scroll. */
const hourPx = (hours: number) => Math.max(88, Math.min(HOUR_PX, Math.floor((7 * HOUR_PX) / hours)));
/** One lane of a room's row: a card and the gap above it. */
const LANE = 96;
const GAP = 8;

function LessonCard({ p, delay }: { p: PlacedLesson; delay: number }) {
  const l = p.lesson;
  const st = lessonState(l);
  const c = courseColor(p.level);
  const time = `${hhmm(l.starts_at)}–${hhmm(l.ends_at)}`;
  const students = `${l.register.roster} st.`;
  const teacher = l.teacher?.name ?? "";
  const style: CSSProperties = {
    left: `calc(${p.left}% + 3px)`,
    width: `calc(${p.width}% - 6px)`,
    top: GAP + p.lane * LANE,
    height: LANE - GAP,
    backgroundColor: `color-mix(in srgb, ${c} 11%, var(--ms-card))`,
    boxShadow: `inset 3px 0 0 ${c}`,
    animationDelay: `${delay}ms`,
  };
  return (
    <li className="contents">
      <Link
        href={lessonHref(l)}
        data-lesson={l.classroom.id}
        data-state={st.key}
        title={[l.classroom.name, teacher || "No teacher", time, students, st.label].join(" · ")}
        aria-label={[l.classroom.name, teacher || "No teacher", time, `${l.register.roster} students`, st.label].join(", ")}
        style={style}
        className="animate-ms-fade-in absolute flex min-w-0 flex-col gap-[3px] overflow-hidden rounded-[8px] py-2 pl-3 pr-2.5 text-ms-fg hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ms-ring"
      >
        <span className="truncate text-[13.5px] font-semibold leading-[18px]">{l.classroom.name}</span>
        {teacher ? (
          <span className="truncate text-[12.5px] leading-[17px] text-ms-fg-2">{teacher}</span>
        ) : (
          <span className="truncate text-[12.5px] font-semibold leading-[17px] text-ms-attention-fg">No teacher</span>
        )}
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-medium leading-4 text-ms-fg-2 tabular-nums">
          <span>{time}</span>
          <span aria-hidden="true">·</span>
          <span>{students}</span>
          <Badge tone={st.tone} className="ml-auto">
            {st.label}
          </Badge>
        </span>
      </Link>
    </li>
  );
}

function pct(minutes: number, axis: Axis): number {
  return ((minutes - axis.start) / (axis.end - axis.start)) * 100;
}

/**
 * A day's lessons as lc-up's "Dars jadvali" draws them (LessonsTimeline board): rooms are rows ("No room" last),
 * time runs across 13:00–20:00 (wider when a real lesson falls outside), with a line per hour. Each lesson is a
 * card across its own hours, tinted by its course (11 % and a 3 px edge), saying its group, teacher, time,
 * students and register state; it opens its group. On today a red line marks the minute, labelled in the header.
 * Narrower than the grid, it scrolls sideways inside its card, the Room column stays put, and it opens on now.
 */
export function RoomTimeline({ lessons, isToday }: { lessons: readonly LessonRow[]; isToday: boolean }) {
  const axis = axisOf(lessons);
  const rows = roomRows(lessons, axis);
  const hours = (axis.end - axis.start) / 60;
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isToday) return;
    const t = window.setInterval(() => setNow(minutesOfDay(new Date())), 30_000);
    return () => window.clearInterval(t);
  }, [isToday]);

  // A phone opens on the current hour, not on 13:00.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !isToday || el.scrollWidth <= el.clientWidth) return;
    const minute = minutesOfDay(new Date());
    if (minute < axis.start || minute > axis.end) return;
    const x = ROOM_COL + ((minute - axis.start) / (axis.end - axis.start)) * (el.scrollWidth - ROOM_COL);
    el.scrollLeft = Math.max(0, x - (el.clientWidth + ROOM_COL) / 2);
    // Not on every refetch: only a new day or a new axis moves the grid while someone scrolls it.
  }, [isToday, axis.start, axis.end]);

  const showNow = isToday && now >= axis.start && now <= axis.end;
  const nowLeft = pct(now, axis);
  const ticks = Array.from({ length: hours + 1 }, (_, i) => axis.start + i * 60);
  let order = 0;

  return (
    <div ref={scroller} className="overflow-x-auto rounded-[10px] border border-ms-grid">
      <div className="grid" style={{ gridTemplateColumns: `${ROOM_COL}px minmax(0, 1fr)`, minWidth: ROOM_COL + hours * hourPx(hours) }}>
        <div className="sticky left-0 z-[3] flex items-center border-b-2 border-r border-b-ms-border-strong border-r-ms-grid bg-ms-head px-3.5 text-[13px] font-bold text-ms-fg">
          Room
        </div>
        <div aria-hidden="true" className="relative h-10 border-b-2 border-ms-border-strong bg-ms-head">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={`absolute top-[11px] text-[12.5px] font-semibold leading-[18px] text-ms-fg-2 tabular-nums ${
                i === 0 ? "pl-1.5" : i === ticks.length - 1 ? "-translate-x-full pr-1.5" : "-translate-x-1/2"
              }`}
              style={{ left: `${pct(t, axis)}%` }}
            >
              {clock(t)}
            </span>
          ))}
          {showNow ? (
            <span
              data-now-label
              className="absolute top-1 z-[2] -translate-x-1/2 rounded-[5px] bg-ms-critical px-1.5 text-[11px] font-bold leading-4 text-white tabular-nums"
              style={{ left: `${nowLeft}%` }}
            >
              {clock(now)}
            </span>
          ) : null}
        </div>

        {rows.map((r, ri) => {
          const last = ri === rows.length - 1;
          return (
            <Fragment key={r.key || "none"}>
              <div
                className={`sticky left-0 z-[3] flex items-center border-r border-ms-grid bg-ms-card px-3.5 text-[14px] font-semibold ${last ? "" : "border-b"} ${r.key ? "text-ms-fg" : "text-ms-fg-3"}`}
              >
                {r.label}
              </div>
              <div className={`relative border-ms-grid ${last ? "" : "border-b"}`} style={{ height: r.lanes * LANE + GAP }}>
                {ticks.slice(1, -1).map((t) => (
                  <span key={t} aria-hidden="true" className="absolute inset-y-0 w-px bg-ms-line" style={{ left: `${pct(t, axis)}%` }} />
                ))}
                <ul aria-label={r.label} className="absolute inset-0">
                  {r.lessons.map((p) => (
                    <LessonCard key={p.lesson.classroom.id} p={p} delay={Math.min(order++ * 30, 300)} />
                  ))}
                </ul>
                {showNow ? (
                  <span aria-hidden="true" data-now-line className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 -translate-x-1/2 bg-ms-critical" style={{ left: `${nowLeft}%` }} />
                ) : null}
              </div>
            </Fragment>
          );
        })}
      </div>
      {showNow ? <span className="sr-only">{`Now, ${clock(now)}`}</span> : null}
    </div>
  );
}
