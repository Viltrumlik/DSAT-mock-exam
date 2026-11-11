"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { hhmm, isNotMarked, type LessonRow } from "../lessonsToday";

/** The strip runs 08:00–20:00 (design handoff v0.3, AdminToday board). */
export const DAY_START = 8 * 60;
export const DAY_END = 20 * 60;
const SPAN = DAY_END - DAY_START;
const ROW = 62;
const ROW_GAP = 8;

/** Minutes after midnight, by the learning center's clock. */
export function minutesOfDay(at: string | Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(typeof at === "string" ? new Date(at) : at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type Placed = { lesson: LessonRow; left: number; width: number; lane: number };

/**
 * Where each timed lesson sits on the strip: `left`/`width` in % of 08:00–20:00 (clamped to it),
 * and a lane — the first row whose last lesson has ended — so two classes at the same hour never
 * cover each other. Lessons with no readable time are left out (the card names them under it).
 */
export function layoutLessons(lessons: readonly LessonRow[]): Placed[] {
  const timed = lessons
    .filter((l) => l.starts_at && l.ends_at)
    .map((l) => ({ l, s: minutesOfDay(l.starts_at!), e: minutesOfDay(l.ends_at!) }))
    .sort((a, b) => a.s - b.s || a.l.classroom.name.localeCompare(b.l.classroom.name));
  const laneEnds: number[] = [];
  return timed.map(({ l, s, e }) => {
    const start = Math.min(Math.max(s, DAY_START), DAY_END - 30);
    const end = Math.min(Math.max(e, start + 30), DAY_END);
    let lane = laneEnds.findIndex((until) => until <= s);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = Math.max(e, s + 30);
    return { lesson: l, left: ((start - DAY_START) / SPAN) * 100, width: ((end - start) / SPAN) * 100, lane };
  });
}

export type Look = "done" | "now" | "next" | "warn";

/** The block's colour: ended (grey), now (filled), still to come (outlined), or no teacher (amber). */
export function lessonLook(l: LessonRow): Look {
  if (l.phase === "now") return "now";
  if (!l.teacher && l.phase !== "ended") return "warn";
  if (l.phase === "ended") return "done";
  return "next";
}

const LOOK: Record<Look, string> = {
  done: "bg-ms-surface-2 text-ms-fg-2",
  now: "bg-ms-primary text-white",
  next: "bg-ms-card text-ms-fg shadow-[inset_0_0_0_1.5px_var(--ms-primary)]",
  warn: "bg-ms-attention-soft text-ms-fg shadow-[inset_0_0_0_1.5px_var(--ms-attention-line)]",
};

/** The block's second line — always a word, never a colour alone. */
export function lessonLine(l: LessonRow): { icon?: "check" | "warn"; text: string; alert?: boolean } {
  const who = l.teacher?.name ?? "";
  if (l.phase === "now") {
    return { text: l.register.marked ? `Now · ${l.register.present + l.register.late} / ${l.register.roster} came` : ["Now", who].filter(Boolean).join(" · ") };
  }
  if (isNotMarked(l)) return { icon: "warn", text: ["Not marked", who].filter(Boolean).join(" · "), alert: true };
  if (!l.teacher) return { icon: "warn", text: `No teacher · ${hhmm(l.starts_at)}`, alert: true };
  if (l.phase === "ended" && l.register.taken) return { icon: "check", text: `${l.register.marked} / ${l.register.roster} marked · ${who}` };
  if (l.phase === "ended") return { icon: "warn", text: `Closed unmarked · ${who}`, alert: true };
  return { text: [hhmm(l.starts_at), who, l.classroom.room ? `room ${l.classroom.room}` : ""].filter(Boolean).join(" · ") };
}

export function LiveDot() {
  return (
    <span aria-hidden="true" className="relative size-2 shrink-0">
      <span className="absolute inset-0 rounded-full bg-current" />
      <span className="animate-ms-pulse absolute inset-0 rounded-full bg-current" />
    </span>
  );
}

/**
 * Today's lessons on an 08:00–20:00 strip (design handoff v0.3, AdminToday board): each class is a
 * block across its own hours — ended (grey), now (filled, live), still to come (outlined), no
 * teacher (amber) — with a red line at the current minute. A block opens its class; an unmarked one
 * opens its attendance. Blocks grow in from the left in time order. On a narrow screen the strip
 * keeps its width and scrolls sideways instead of squeezing an hour into 30 px, opening on the
 * current hour rather than on 08:00.
 */
export function LessonsTimeline({ lessons }: { lessons: readonly LessonRow[] }) {
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(minutesOfDay(new Date())), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const at = (Math.min(Math.max(minutesOfDay(new Date()), DAY_START), DAY_END) - DAY_START) / SPAN;
    el.scrollLeft = Math.max(0, at * el.scrollWidth - el.clientWidth / 2);
  }, []);
  const placed = layoutLessons(lessons);
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
  const showNow = now >= DAY_START && now <= DAY_END;

  return (
    // Its own top room: a scroller clips both ways, and the now bubble sits above the strip.
    <div ref={scroller} className="-mx-1 -mt-3 overflow-x-auto px-1 pb-1 pt-3">
      <div className="flex min-w-[720px] flex-col gap-2.5">
        <div className="relative pt-[18px]">
          <ol aria-label="Lessons by time" className="relative" style={{ height: lanes * ROW + (lanes - 1) * ROW_GAP }}>
            {placed.map(({ lesson: l, left, width, lane }, i) => {
              const k = lessonLook(l);
              const ln = lessonLine(l);
              const href = isNotMarked(l) ? `/ops/classrooms/${l.classroom.id}?tab=attendance` : `/ops/classrooms/${l.classroom.id}`;
              return (
                <li
                  key={l.classroom.id}
                  data-look={k}
                  className="absolute"
                  style={{ left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`, top: lane * (ROW + ROW_GAP), height: ROW }}
                >
                  <Link
                    href={href}
                    title={`${l.classroom.name} · ${hhmm(l.starts_at)}–${hhmm(l.ends_at)}`}
                    className={`animate-ms-wipe-in ms-hover-lift flex h-full min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-[12px] px-2.5 py-2 text-[13px] leading-[17px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring ${LOOK[k]}`}
                    style={{ animationDelay: `${120 + i * 70}ms` }}
                  >
                    <b className="truncate text-[13.5px] font-semibold leading-[18px]">{l.classroom.name}</b>
                    <span className={`flex min-w-0 items-center gap-[5px] ${ln.alert ? "font-semibold text-ms-attention-fg" : ""}`}>
                      {k === "now" ? <LiveDot /> : ln.icon ? <Icon name={ln.icon} size="sm" className="shrink-0" /> : null}
                      <span className="truncate">{ln.text}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {showNow ? (
            <div
              role="img"
              aria-label={`Now, ${clock(now)}`}
              className="animate-ms-fade-in ms-transition pointer-events-none absolute -bottom-1 top-[10px] z-10 w-0.5 rounded-full bg-ms-critical"
              style={{ left: `calc(${((now - DAY_START) / SPAN) * 100}% - 1px)`, animationDelay: `${120 + placed.length * 70}ms` }}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ms-danger-btn px-1.5 py-[3px] text-[11.5px] font-bold leading-none text-white tabular-nums">
                {clock(now)}
              </span>
            </div>
          ) : null}
        </div>
        <div aria-hidden="true" className="grid grid-cols-12 text-[12px] font-medium leading-none tabular-nums text-ms-fg-3">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={i === 11 ? "text-right" : ""}>
              {i === 11 ? "20:00" : i % 2 === 0 ? clock(DAY_START + i * 60) : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
