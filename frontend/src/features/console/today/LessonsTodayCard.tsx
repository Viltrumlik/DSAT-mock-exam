"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { fetchLessonsToday, hhmm, isNotMarked, lessonsTodayKey, type LessonRow } from "../lessonsToday";

const BADGE = {
  info: "bg-ms-info-soft text-ms-info-fg",
  critical: "bg-ms-critical-soft text-ms-critical-fg",
  positive: "bg-ms-positive-soft text-ms-positive-fg",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
  neutral: "bg-ms-neutral-soft text-ms-neutral-fg",
} as const;

/** The one verdict a lesson row carries, always as a word. */
export function lessonVerdict(l: LessonRow): { tone: keyof typeof BADGE; text: string; live?: boolean } {
  if (l.phase === "now") return { tone: "info", text: l.register.marked ? `Now · ${l.register.present + l.register.late} / ${l.register.roster} came` : "Now", live: true };
  if (isNotMarked(l)) return { tone: "critical", text: "Not marked" };
  if (!l.teacher) return { tone: "attention", text: "No teacher" };
  if (l.phase === "ended" && l.register.taken) return { tone: "positive", text: `${l.register.marked} / ${l.register.roster} marked` };
  if (l.phase === "ended") return { tone: "attention", text: "Closed unmarked" };
  if (l.phase === "upcoming" && l.starts_at) return { tone: "neutral", text: `Starts ${hhmm(l.starts_at)}` };
  return { tone: "neutral", text: "Time not set" };
}

/**
 * Today's "Lessons today" (design handoff v0.3, AdminToday board): every active class meeting
 * today, in time order, with its teacher and one verdict. A register someone can still fix gets
 * "Mark now". Loading, failed (never shown as "no lessons") and empty each say so.
 */
export function LessonsTodayCard() {
  const q = useQuery({ queryKey: lessonsTodayKey, queryFn: fetchLessonsToday, staleTime: 60_000, refetchInterval: 120_000 });
  const lessons = [...(q.data?.lessons ?? [])].sort((a, b) => (a.starts_at ?? "~").localeCompare(b.starts_at ?? "~"));
  const c = q.data?.counts;

  return (
    <section className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-5 shadow-ms-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ms-h text-ms-fg">Lessons today</h2>
        {c ? (
          <span className="text-[13px] text-ms-fg-3">
            {[`${c.lessons} ${c.lessons === 1 ? "lesson" : "lessons"}`, c.now ? `${c.now} now` : "", c.not_marked ? `${c.not_marked} not marked` : "", c.no_teacher ? `${c.no_teacher} without teacher` : ""]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </div>
      {q.isPending ? (
        <div aria-hidden="true" className="flex flex-col gap-3 py-1">
          {[80, 65, 72].map((w) => (
            <span key={w} className="animate-ms-shimmer h-4 rounded-[6px]" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : q.isError ? (
        <div className="flex items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
          <Icon name="alert" className="text-ms-critical-fg" />
          <span className="flex-1 text-ms-fg">Couldn’t load today’s lessons. This is not zero.</span>
          <button type="button" onClick={() => void q.refetch()} className="ms-transition min-h-9 rounded-[8px] px-2.5 font-semibold text-ms-primary-text hover:bg-ms-card">
            Retry
          </button>
        </div>
      ) : lessons.length === 0 ? (
        <p className="text-[15px] text-ms-fg-2">No lessons today.</p>
      ) : (
        <div className="flex flex-col">
          {lessons.map((l) => {
            const v = lessonVerdict(l);
            return (
              <div key={l.classroom.id} className="flex items-center gap-3 border-b border-ms-line py-2.5 last:border-b-0">
                <span className="w-12 shrink-0 font-ms-mono text-[13px] tabular-nums text-ms-fg-3">{l.starts_at ? hhmm(l.starts_at) : "—"}</span>
                <Link href={`/ops/classrooms/${l.classroom.id}`} className="flex min-w-0 flex-1 flex-col hover:underline">
                  <span className="truncate text-[15px] font-semibold text-ms-fg">{l.classroom.name}</span>
                  <span className="truncate text-[13px] text-ms-fg-3">
                    {[l.teacher?.name ?? "No teacher", l.classroom.room ? `room ${l.classroom.room}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </Link>
                <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold ${BADGE[v.tone]}`}>
                  {v.live ? (
                    <span className="relative size-2">
                      <span className="absolute inset-0 rounded-full bg-current" />
                      <span className="animate-ms-pulse absolute inset-0 rounded-full bg-current" />
                    </span>
                  ) : null}
                  {v.text}
                </span>
                {isNotMarked(l) ? (
                  <Link
                    href={`/ops/classrooms/${l.classroom.id}?tab=attendance`}
                    className="ms-transition ms-press inline-flex min-h-9 shrink-0 items-center rounded-ms-btn bg-ms-surface-2 px-3 text-[13px] font-semibold text-ms-fg hover:bg-ms-surface-3"
                  >
                    Mark now
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
