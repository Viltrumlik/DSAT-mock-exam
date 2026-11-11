"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { isAdminOpsPath, isScopedOpsAdmin } from "@/features/ops/adminScope";
import { isOpsSuperAdmin } from "@/features/ops/shell/opsNav";
import { useMe } from "@/hooks/useMe";
import { attentionCount, useAdminAttention } from "../attention";
import { AttentionList } from "../AttentionList";
import { fetchLessonsToday, lessonsTodayKey } from "../lessonsToday";
import { buttonClass } from "../ui";
import { DebtCard, IncomeCard, LearnersCard, PlatformCard, RecentlyOpened, ShortcutsCard, SmsCard, markAttendanceHref } from "./cards";
import { LessonsTodayCard } from "./LessonsTodayCard";
import { Card } from "./parts";

/** "Good afternoon" and "Wednesday, 11 November", by the learning center's clock. */
export function todayHeading(now = new Date()): { greeting: string; date: string } {
  const tz = "Asia/Tashkent";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(now));
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(now);
  return { greeting: hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening", date: `${weekday}, ${day}` };
}

/**
 * /ops — Today (design handoff v0.3, AdminToday board): it opens on what needs someone now. The day's
 * lessons on a strip; what needs you, the learners and what you opened last; where the debt sits,
 * the SMS balance and the month's income; for a super admin the platform's state; shortcuts with
 * their counts. Each card asks only what its reader's role may read, and says so when it failed.
 */
export function TodayPage() {
  const { me } = useMe();
  const role = String(me?.role ?? "").toLowerCase();
  const superAdmin = isOpsSuperAdmin(me);
  const scoped = isScopedOpsAdmin(me);
  const desk = superAdmin || scoped;
  const may = (path: string) => superAdmin || (scoped && isAdminOpsPath(path));
  const attention = useAdminAttention(desk);
  // The same query as the lessons card (one request): the header counts the lessons, and the one
  // primary button opens the register that needs marking.
  const lessons = useQuery({ queryKey: lessonsTodayKey, queryFn: fetchLessonsToday, enabled: desk, staleTime: 60_000 });
  const lessonCount = lessons.data?.counts.lessons;
  const settled = attention.every((s) => s.status === "done");
  const count = attentionCount(attention);
  const { greeting, date } = todayHeading();
  const first = typeof me?.first_name === "string" && me.first_name.trim() ? me.first_name.trim() : "";

  return (
    <div className="flex flex-col gap-5">
      <header className="animate-ms-fade-in flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-ms-display text-ms-fg">{first ? `${greeting}, ${first}` : greeting}</h1>
          <p className="text-ms-body text-ms-fg-2">
            {date}
            {desk && lessonCount !== undefined ? ` · ${lessonCount} ${lessonCount === 1 ? "lesson" : "lessons"} today` : ""}
            {desk && settled ? (
              count ? (
                <>
                  {" · "}
                  <b className="font-semibold text-ms-fg">
                    {count} {count === 1 ? "thing needs" : "things need"} you
                  </b>
                </>
              ) : (
                " · nothing needs you right now"
              )
            ) : null}
          </p>
        </div>
        {desk ? (
          <Link href={markAttendanceHref(lessons.data)} className={buttonClass({ variant: "primary" })}>
            <Icon name="calcheck" />
            Mark attendance
          </Link>
        ) : null}
      </header>

      {/* The day at a glance, full width, before anything else (AdminToday board). */}
      {desk ? <LessonsTodayCard style={{ animationDelay: "60ms" }} /> : null}

      <div className={`grid items-start gap-5 ${desk ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : ""}`}>
        {desk ? (
          <Card
            title="Needs you"
            delay={140}
            aside={
              count ? (
                <span key={count} className="animate-ms-pop inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-ms-danger-btn px-1.5 text-[12px] font-semibold tabular-nums text-white">
                  {count}
                </span>
              ) : undefined
            }
            action={count ? <span className="text-[13px] text-ms-fg-3">most urgent first</span> : undefined}
          >
            <AttentionList sources={attention} />
          </Card>
        ) : null}
        <div className="flex min-w-0 flex-col gap-5">
          <LearnersCard enabled={desk || role === "teacher"} withLessons={desk} delay={200} />
          <RecentlyOpened delay={260} />
        </div>
      </div>

      {desk ? (
        <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
          <DebtCard enabled={desk} delay={300} />
          <SmsCard enabled={may("/ops/sms")} delay={340} />
          <IncomeCard enabled={may("/ops/finance")} delay={380} />
        </div>
      ) : null}

      <div className={`grid items-start gap-5 ${superAdmin ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" : ""}`}>
        {superAdmin ? <PlatformCard delay={420} /> : null}
        <ShortcutsCard desk={desk} scoped={scoped} delay={460} />
      </div>
    </div>
  );
}
