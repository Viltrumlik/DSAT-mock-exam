"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { fetchLessonsToday, lessonsTodayKey } from "../lessonsToday";
import { LessonsTimeline, LiveDot } from "./LessonsTimeline";

const BADGE = "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-[13px] font-semibold leading-none";

/** Where the lesson blocks will be — the skeleton has the strip's shape, so nothing jumps. */
const GHOSTS = [
  { left: 8.6, width: 16, lane: 0 },
  { left: 42, width: 16, lane: 0 },
  { left: 58.6, width: 16, lane: 0 },
  { left: 25.3, width: 16, lane: 1 },
  { left: 67, width: 16, lane: 1 },
];

function StripSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 pt-[18px]">
      <span className="sr-only">Loading today’s lessons…</span>
      <div aria-hidden="true" className="relative h-[132px]">
        {GHOSTS.map((g) => (
          <span
            key={`${g.left}-${g.lane}`}
            className="animate-ms-shimmer absolute h-[62px] rounded-[12px]"
            style={{ left: `${g.left}%`, width: `${g.width}%`, top: g.lane * 70 }}
          />
        ))}
      </div>
      <span aria-hidden="true" className="animate-ms-shimmer h-3 rounded-[6px]" />
    </div>
  );
}

/**
 * Today's "Lessons today" (design handoff v0.3, AdminToday board): every active class meeting today
 * on an 08:00–20:00 strip, with what needs a look counted in the header. A lesson whose time can't
 * be read is named under the strip, never dropped. Loading has the strip's shape; failed is never
 * shown as "no lessons"; empty says so.
 */
export function LessonsTodayCard({ style }: { style?: CSSProperties }) {
  const q = useQuery({ queryKey: lessonsTodayKey, queryFn: fetchLessonsToday, staleTime: 60_000, refetchInterval: 120_000 });
  const lessons = q.data?.lessons ?? [];
  const untimed = lessons.filter((l) => !l.starts_at || !l.ends_at);
  const c = q.data?.counts;
  const ended = lessons.filter((l) => l.phase === "ended");
  const allMarked = Boolean(c) && !c?.not_marked && ended.length > 0 && ended.every((l) => l.register.taken);

  return (
    <section className="animate-ms-card-in flex flex-col gap-3.5 rounded-ms-card bg-ms-card px-5 py-5 shadow-ms-1 sm:px-[22px]" style={style}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-ms-h text-ms-fg">Lessons today</h2>
        {c?.now ? (
          <span key={`now-${c.now}`} className={`animate-ms-pop ${BADGE} bg-ms-positive-soft text-ms-positive-fg`}>
            <LiveDot />
            {c.now} now
          </span>
        ) : null}
        {c?.not_marked ? (
          <span key={`nm-${c.not_marked}`} className={`animate-ms-pop ${BADGE} bg-ms-attention-soft text-ms-attention-fg`}>
            <Icon name="warn" size="sm" />
            {c.not_marked} not marked
          </span>
        ) : null}
        {c?.no_teacher ? (
          <span key={`nt-${c.no_teacher}`} className={`animate-ms-pop ${BADGE} bg-ms-attention-soft text-ms-attention-fg`}>
            <Icon name="warn" size="sm" />
            {c.no_teacher} without teacher
          </span>
        ) : null}
        {allMarked ? (
          <span className={`animate-ms-fade-in ${BADGE} bg-ms-positive-soft text-ms-positive-fg`}>
            <Icon name="check" size="sm" className="animate-ms-check-pop" />
            All registers marked
          </span>
        ) : null}
        <Link
          href="/ops/classrooms"
          className="ms-press ml-auto inline-flex h-9 items-center gap-1.5 rounded-ms-btn px-3 text-[14px] font-semibold text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg"
        >
          All classrooms
          <Icon name="right" size="sm" />
        </Link>
      </div>
      {q.isPending ? (
        <StripSkeleton />
      ) : q.isError ? (
        <div className="animate-ms-fade-in flex items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
          <Icon name="alert" className="text-ms-critical-fg" />
          <span className="flex-1 text-ms-fg">Couldn’t load today’s lessons. This is not zero.</span>
          <button type="button" onClick={() => void q.refetch()} className="ms-press min-h-9 rounded-[8px] px-2.5 font-semibold text-ms-primary-text hover:bg-ms-card">
            Retry
          </button>
        </div>
      ) : lessons.length === 0 ? (
        <p className="animate-ms-fade-in text-[15px] text-ms-fg-2">No lessons today.</p>
      ) : (
        <div className="animate-ms-fade-in flex flex-col gap-3">
          {lessons.length > untimed.length ? <LessonsTimeline lessons={lessons} /> : null}
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
        </div>
      )}
    </section>
  );
}
