"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { UseQueryResult } from "@tanstack/react-query";

import { Icon, type IconName } from "@/components/ui/Icon";
import type { Debtor } from "@/features/finance/financeApi";
import type { Population } from "@/lib/usersAdminApi";
import { Burst } from "../Burst";
import { hhmm, isNotMarked, type LessonRow, type LessonsToday } from "../lessonsToday";
import { RollNumber } from "../RollNumber";
import { Badge, buttonClass, signedAmount } from "../ui";
import { nowState, roomLabel, roomsIn, roomsPhrase, timeSpan } from "../timetable/timetable";
import { cameToday, markAttendanceHref, type ClassCounts } from "./cards";
import { Card, Failed, Skeleton, sectionMark } from "./parts";

// ─── pure helpers (tested) ───────────────────────────────────────────────────

/** Students whose lesson today is still to come: the "later today" half of Came today. */
export function laterToday(d: LessonsToday | undefined): number {
  return (d?.lessons ?? []).filter((l) => l.phase === "upcoming").reduce((s, l) => s + l.register.roster, 0);
}

/** "from the 14:00 lessons" / "from the 14:00 and 16:00 lessons": when the registers still waiting began. */
export function notMarkedFrom(d: LessonsToday | undefined): string {
  const open = (d?.lessons ?? []).filter(isNotMarked);
  const starts = [...new Set(open.map((l) => hhmm(l.starts_at)).filter(Boolean))].sort();
  if (!starts.length) return "";
  const list = starts.length === 1 ? starts[0] : `${starts.slice(0, -1).join(", ")} and ${starts[starts.length - 1]}`;
  return `from the ${list} ${open.length === 1 ? "lesson" : "lessons"}`;
}

/** Every lesson that ended today had its register taken (none is open, none closed unmarked). */
export function allMarked(d: LessonsToday | undefined): boolean {
  const ended = (d?.lessons ?? []).filter((l) => l.phase === "ended");
  return ended.length > 0 && ended.every((l) => l.register.taken);
}

/** Registers that closed with nothing on them today: nobody can fix these on the desk any more. */
export function closedUnmarked(d: LessonsToday | undefined): number {
  return (d?.lessons ?? []).filter((l) => l.phase === "ended" && !l.register.taken && !isNotMarked(l)).length;
}

/** Debtors counted by STUDENT (one lc-up student, one row): how many, what they owe, frozen, outside any group. */
export function debtTotals(rows: readonly Pick<Debtor, "debt" | "frozen" | "in_group">[]): { students: number; total: number; frozen: number; noGroup: number } {
  return {
    students: rows.length,
    total: rows.reduce((s, r) => s + r.debt, 0),
    frozen: rows.filter((r) => r.frozen).length,
    noGroup: rows.filter((r) => !r.in_group).length,
  };
}

const n = (v: number) => v.toLocaleString("en-US").replace(/,/g, " ");

// ─── Stat tile (board: `.card.stat`, the verdict as a soft tint) ─────────────

type StatTone = "critical" | "attention";
const TINT: Record<StatTone, CSSProperties> = {
  critical: {
    backgroundColor: "color-mix(in srgb, var(--ms-critical) 6%, var(--ms-card))",
    borderColor: "color-mix(in srgb, var(--ms-critical) 22%, var(--ms-card))",
  },
  attention: {
    backgroundColor: "color-mix(in srgb, var(--ms-attention) 7%, var(--ms-card))",
    borderColor: "color-mix(in srgb, var(--ms-attention) 24%, var(--ms-card))",
  },
};
const VALUE_TONE: Record<StatTone, string> = { critical: "text-ms-critical-fg", attention: "text-ms-attention-fg" };

export function StatCard({
  label,
  icon,
  iconClass,
  value,
  unit,
  sub,
  tone,
  href,
  state = "ready",
  what,
  onRetry,
  children,
}: {
  label: string;
  icon: IconName;
  iconClass: string;
  value?: string | number;
  unit?: string;
  sub?: ReactNode;
  tone?: StatTone;
  href?: string;
  state?: "ready" | "loading" | "error";
  /** What failed: "Couldn’t load <what>". */
  what?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[14px] font-medium leading-5 text-ms-fg-2">
        <Icon name={icon} size="sm" className={iconClass} />
        {label}
      </span>
      {state === "loading" ? (
        <span aria-hidden="true" className="flex flex-col gap-2 py-0.5">
          <span className="animate-ms-shimmer h-7 w-20 rounded-[6px]" />
          <span className="animate-ms-shimmer h-3.5 w-32 rounded-[6px]" />
        </span>
      ) : state === "error" ? (
        <span role="alert" className="flex flex-col items-start gap-1 text-[13.5px] text-ms-critical-fg">
          <span className="flex items-center gap-1.5 font-medium">
            <Icon name="alert" size="sm" />
            Couldn’t load {what ?? "it"}. This is not zero.
          </span>
          {onRetry ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onRetry();
              }}
              className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2 text-ms-primary-text" })}
            >
              Retry
            </button>
          ) : null}
        </span>
      ) : (
        <>
          <span className="flex flex-wrap items-baseline gap-1">
            <RollNumber value={value ?? "—"} className={`text-[24px] font-semibold leading-[30px] tracking-[-0.01em] tabular-nums ${tone ? VALUE_TONE[tone] : "text-ms-fg"}`} />
            {unit ? <small className="ml-1 text-[15px] font-medium text-ms-fg-2">{unit}</small> : null}
          </span>
          {sub ? <span className="relative text-[13px] leading-[18px] text-ms-fg-3">{sub}</span> : null}
          {children}
        </>
      )}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-2 rounded-ms-card border border-ms-border bg-ms-card px-5 py-[18px] shadow-ms-1";
  const style = state === "ready" && tone ? TINT[tone] : undefined;
  return href && state === "ready" ? (
    <Link href={href} data-stat={label} className={`${cls} ms-transition hover:border-ms-border-strong`} style={style}>
      {body}
    </Link>
  ) : (
    <div data-stat={label} className={cls} style={style}>
      {body}
    </div>
  );
}

type Q<T> = Pick<UseQueryResult<T>, "data" | "isPending" | "isError" | "refetch">;
const stateOf = <T,>(q: Q<T>) => (q.isPending ? "loading" : q.isError ? "error" : "ready") as "loading" | "error" | "ready";

/**
 * The four tiles under the title (Today board): Came today, Owe money, Lessons now, Registers not marked. Each
 * is drawn only for a viewer who may read its source — the day's registers for `view_people`, the debtors for
 * `view_money` — and a failed source says so, never zero.
 */
export function TodayStats({ desk, money, lessons, debtors }: { desk: boolean; money: boolean; lessons: Q<LessonsToday>; debtors: Q<Debtor[]> }) {
  if (!desk && !money) return null;
  const d = lessons.data;
  const came = cameToday(d);
  const later = laterToday(d);
  const now = (d?.lessons ?? []).filter((l) => l.phase === "now");
  const next = (d?.lessons ?? []).find((l) => l.phase === "upcoming" && l.starts_at);
  const debt = debtors.data ? debtTotals(debtors.data) : null;
  const notMarked = d?.counts.not_marked ?? 0;
  const closed = closedUnmarked(d);
  const retryLessons = () => void lessons.refetch();
  return (
    <section aria-label="Today in numbers" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 sm:gap-4">
      {desk ? (
        <StatCard
          label="Came today"
          icon="ms-present"
          iconClass="text-ms-positive"
          state={stateOf(lessons)}
          what="the registers"
          onRetry={retryLessons}
          href="/ops/classrooms"
          value={came ? n(came.came) : "—"}
          unit={came ? `of ${n(came.of)}` : undefined}
          sub={
            came
              ? [`${came.absent} absent`, came.late ? `${came.late} late` : "", later ? `${n(later)} have lessons later today` : ""].filter(Boolean).join(" · ")
              : later
                ? `No register marked yet · ${n(later)} have lessons later today`
                : "No register marked yet"
          }
        />
      ) : null}
      {money ? (
        <StatCard
          label="Owe money"
          icon="wallet"
          iconClass="text-ms-critical"
          state={stateOf(debtors)}
          what="the debtors"
          onRetry={() => void debtors.refetch()}
          href="/ops/finance?tab=debtors"
          value={debt ? n(debt.students) : undefined}
          unit={debt ? (debt.students === 1 ? "student" : "students") : undefined}
          tone={debt?.students ? "critical" : undefined}
          sub={debt ? (debt.students ? `${signedAmount(debt.total)} so'm in total` : "No one owes") : undefined}
        />
      ) : null}
      {desk ? (
        <StatCard
          label="Lessons now"
          icon="ms-room"
          iconClass="text-ms-info"
          state={stateOf(lessons)}
          what="the lessons"
          onRetry={retryLessons}
          href="/ops/timetable"
          value={d ? n(d.counts.now) : undefined}
          sub={
            now.length
              ? [timeSpan(now), roomsPhrase(roomsIn(now))].filter(Boolean).join(" · ")
              : next
                ? `Next at ${hhmm(next.starts_at)}`
                : d?.lessons.length
                  ? "No more lessons today"
                  : "No lessons today"
          }
        />
      ) : null}
      {desk ? (
        <StatCard
          label="Registers not marked"
          icon="clipboard"
          iconClass="text-ms-attention"
          state={stateOf(lessons)}
          what="the registers"
          onRetry={retryLessons}
          href={d ? markAttendanceHref(d) : undefined}
          value={d ? n(notMarked) : undefined}
          tone={notMarked ? "attention" : undefined}
          sub={
            notMarked
              ? notMarkedFrom(d)
              : allMarked(d)
                ? (
                    <>
                      All registers marked
                      {/* A whole job done: the Motion board's small celebration, once a day. */}
                      <Burst id="registers-marked" />
                    </>
                  )
                : closed
                  ? `${closed} closed unmarked`
                  : "Nothing to mark yet"
          }
        />
      ) : null}
    </section>
  );
}

// ─── Daily lists ─────────────────────────────────────────────────────────────

type ListTile = { href: string; label: string; icon: IconName; count?: string; sub: string; state: "loading" | "error" | "ready" };

function ListTileLink({ t }: { t: ListTile }) {
  return (
    <Link
      href={t.href}
      data-list={t.label}
      className="ms-transition flex min-h-[118px] min-w-0 flex-col gap-2.5 rounded-ms-card border border-ms-border bg-ms-card p-4 text-ms-fg hover:border-ms-border-strong hover:bg-ms-row-hover"
    >
      <span className="flex items-center gap-2.5">
        <Icon name={t.icon} className="text-ms-fg-2" />
        <span className="text-[15px] font-semibold leading-5">{t.label}</span>
      </span>
      {t.state === "loading" ? (
        <span aria-hidden="true" className="animate-ms-shimmer h-7 w-16 rounded-[6px]" />
      ) : t.count !== undefined ? (
        <RollNumber value={t.count} className="text-[24px] font-semibold leading-7 tracking-[-0.01em] tabular-nums" />
      ) : null}
      <span className={`text-[13px] leading-[18px] ${t.state === "error" ? "text-ms-critical-fg" : "text-ms-fg-3"}`}>{t.sub}</span>
    </Link>
  );
}

/**
 * "Daily lists" (Today board): the places lc-up's desk opens every day — Students, Groups, Debtors, Archive — each
 * with its real count and a line under it. A tile is drawn only for a viewer who may open it; the archive has no
 * cheap count, so it has none.
 */
export function DailyLists({
  people,
  money,
  population,
  classes,
  debtors,
  lessons,
}: {
  people: boolean;
  money: boolean;
  population: Q<Population>;
  classes: Q<ClassCounts>;
  debtors: Q<Debtor[]>;
  lessons: Q<LessonsToday>;
}) {
  const tiles: ListTile[] = [];
  if (people) {
    const p = population.data;
    const frozen = p ? p.frozen_debt + p.frozen_admin : 0;
    tiles.push({
      href: "/ops/students",
      label: "Students",
      icon: "users",
      state: stateOf(population),
      count: p ? n(p.centre) : undefined,
      sub: population.isError
        ? "Couldn’t load the count"
        : p
          ? [`${n(frozen)} frozen`, typeof p.joined_30d === "number" ? `${n(p.joined_30d)} joined in 30 days` : ""].filter(Boolean).join(" · ")
          : "",
    });
    const c = classes.data;
    const nowCount = lessons.data?.counts.now;
    tiles.push({
      href: "/ops/classrooms",
      label: "Groups",
      icon: "layers",
      state: stateOf(classes),
      count: c ? n(c.active ?? c.total) : undefined,
      sub: classes.isError
        ? "Couldn’t load the count"
        : nowCount !== undefined
          ? `${n(nowCount)} in a lesson now`
          : c && c.active !== null
            ? "active groups"
            : "",
    });
  }
  if (money) {
    const debt = debtors.data ? debtTotals(debtors.data) : null;
    tiles.push({
      href: "/ops/finance?tab=debtors",
      label: "Debtors",
      icon: "wallet",
      state: stateOf(debtors),
      count: debt ? n(debt.students) : undefined,
      sub: debtors.isError ? "Couldn’t load the count" : debt ? `${n(debt.frozen)} frozen · ${n(debt.noGroup)} not in a group` : "",
    });
  }
  if (people) {
    tiles.push({ href: "/ops/archive", label: "Archive", icon: "archive", state: "ready", sub: "Students who left a group" });
  }
  if (!tiles.length) return null;
  return (
    <section {...sectionMark("Daily lists")} className="flex flex-col gap-3.5 rounded-ms-card border border-ms-border bg-ms-card px-5 pb-5 pt-[18px] shadow-ms-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-ms-h text-ms-fg">Daily lists</h2>
        <span className="text-[13px] text-ms-fg-3">The same places as in lc-up</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-2.5 sm:gap-3">
        {tiles.map((t) => (
          <ListTileLink key={t.href} t={t} />
        ))}
      </div>
    </section>
  );
}

// ─── Lessons now ─────────────────────────────────────────────────────────────

function NowRow({ l }: { l: LessonRow }) {
  const st = nowState(l);
  const href = l.register.marked > 0 ? `/ops/classrooms/${l.classroom.id}` : `/ops/classrooms/${l.classroom.id}?tab=attendance`;
  return (
    <li>
      <Link href={href} className="ms-transition -mx-2 flex min-w-0 items-center gap-3 rounded-[8px] border-b border-ms-line px-2 py-2.5 hover:bg-ms-row-hover">
        <Badge tone="line" className="min-w-[74px] justify-center">
          {roomLabel(l.classroom.room)}
        </Badge>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14.5px] font-semibold text-ms-fg">{l.classroom.name}</span>
          <span className={`truncate text-[13px] ${l.teacher ? "text-ms-fg-3" : "font-semibold text-ms-attention-fg"}`}>{l.teacher?.name ?? "No teacher"}</span>
        </span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </Link>
    </li>
  );
}

/** "Lessons now · 14:00–16:00" (Today board): each class on now — its room, group, teacher and who came — and the timetable. */
export function LessonsNowCard({ lessons }: { lessons: Q<LessonsToday> }) {
  const d = lessons.data;
  const now = (d?.lessons ?? []).filter((l) => l.phase === "now");
  const span = timeSpan(now);
  const upcoming = (d?.lessons ?? []).filter((l) => l.phase === "upcoming" && l.starts_at);
  const nextAt = upcoming.length ? hhmm(upcoming[0].starts_at) : "";
  const nextCount = upcoming.filter((l) => hhmm(l.starts_at) === nextAt).length;
  return (
    <Card
      title={span ? `Lessons now · ${span}` : "Lessons now"}
      action={
        <Link href="/ops/timetable" className={buttonClass({ variant: "subtle", size: "sm" })}>
          <Icon name="cal" size="sm" />
          Open timetable
        </Link>
      }
    >
      {lessons.isPending ? (
        <Skeleton rows={4} />
      ) : lessons.isError ? (
        <Failed what="today’s lessons" retry={() => void lessons.refetch()} />
      ) : now.length ? (
        <ul className="-mt-1 flex flex-col [&>li:last-child>a]:border-b-0">
          {now.map((l) => (
            <NowRow key={l.classroom.id} l={l} />
          ))}
        </ul>
      ) : (
        <p className="text-[15px] text-ms-fg-2">
          No lesson is on right now.
          {nextAt ? ` Next: ${nextAt} · ${nextCount} ${nextCount === 1 ? "lesson" : "lessons"}.` : d?.lessons.length ? " No more lessons today." : ""}
        </p>
      )}
    </Card>
  );
}
