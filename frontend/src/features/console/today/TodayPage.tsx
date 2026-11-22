"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { financeApi } from "@/features/finance/financeApi";
import { financeKeys } from "@/features/finance/financeHooks";
import { P, holds } from "@/features/ops/permissions";
import { isOpsSuperAdmin } from "@/features/ops/shell/opsNav";
import { useMe } from "@/hooks/useMe";
import { usersAdminApi } from "@/lib/usersAdminApi";
import { attentionCount, useAdminAttention } from "../attention";
import { AttentionList } from "../AttentionList";
import { fetchLessonsToday, lessonsTodayKey } from "../lessonsToday";
import { Button, buttonClass } from "../ui";
import {
  DebtCard,
  IncomeCard,
  LearnersCard,
  PlatformCard,
  RecentlyOpened,
  ShortcutsCard,
  SmsCard,
  classCountsKey,
  fetchClassCounts,
  markAttendanceHref,
} from "./cards";
import { LessonsDialog } from "./LessonsDialog";
import { DailyLists, LessonsNowCard, TodayStats } from "./overview";
import { Card } from "./parts";

/** "Sunday, 22 November", by the learning center's clock. */
export function todayDate(now = new Date()): string {
  const tz = "Asia/Tashkent";
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(now);
  return `${weekday}, ${day}`;
}

/**
 * /ops — Today (lc-up structure canvas, Shell board): a plain "Today · Sunday, 22 November" — no greeting — with
 * "Lessons today" (the timetable in a dialog), and "Mark attendance"; four tiles (Came today, Owe money, Lessons
 * now, Registers not marked); the daily lists lc-up's desk opens (Students, Groups, Debtors, Archive); "Needs you"
 * beside "Lessons now". Below them every card the page had: the learners and what you opened last; where the debt
 * sits, the SMS balance and the month's income; for a super admin the platform's state; shortcuts with their
 * counts. Each part asks only what its reader's permissions open, and says so when it failed.
 */
export function TodayPage() {
  const { me } = useMe();
  const superAdmin = isOpsSuperAdmin(me);
  // Each part asks only what the viewer's permissions open (the same ones its API checks).
  const may = (...codes: string[]) => Boolean(me) && holds(me, ...codes);
  const desk = may(P.viewPeople); // the day's lessons and their registers, the students and groups
  const owing = may(P.viewMoney); // the debtors, counted by student
  const money = { debt: may(P.viewReports), sms: may(P.sendSms, P.sendDebtSms), income: may(P.viewReports) };
  const attention = useAdminAttention(me ?? null);
  const needsYou = attention.length > 0;
  const count = attentionCount(attention);
  const [lessonsOpen, setLessonsOpen] = useState(false);

  // One request each, shared with the cards below that read the same thing (same query keys).
  const lessons = useQuery({ queryKey: lessonsTodayKey, queryFn: fetchLessonsToday, enabled: desk, staleTime: 60_000, refetchInterval: 120_000 });
  const debtors = useQuery({ queryKey: financeKeys.debtors, queryFn: () => financeApi.debtors(), enabled: owing, staleTime: 60_000 });
  const population = useQuery({ queryKey: ["users", "population"], queryFn: usersAdminApi.population, enabled: desk });
  const classes = useQuery({ queryKey: classCountsKey, queryFn: fetchClassCounts, enabled: desk, staleTime: 5 * 60_000 });
  const lessonCount = lessons.data?.counts.lessons;

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <header className="animate-ms-fade-in flex flex-wrap items-end gap-x-3 gap-y-2.5">
        <h1 className="min-w-0 flex-[1_1_320px] text-ms-title text-ms-fg">
          Today <span className="font-medium text-ms-fg-3">· {todayDate()}</span>
        </h1>
        {desk ? (
          <>
            <Button variant="secondary" icon="cal" aria-haspopup="dialog" onClick={() => setLessonsOpen(true)}>
              Lessons today
              {lessonCount !== undefined ? (
                <span data-lessons-count className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-ms-card px-1.5 text-[12px] font-semibold tabular-nums text-ms-fg-2">
                  {lessonCount}
                </span>
              ) : null}
            </Button>
            <Link href={markAttendanceHref(lessons.data)} className={buttonClass({ variant: "primary" })}>
              <Icon name="ms-present" />
              Mark attendance
            </Link>
          </>
        ) : null}
      </header>

      <TodayStats desk={desk} money={owing} lessons={lessons} debtors={debtors} />

      <DailyLists people={desk} money={owing} population={population} classes={classes} debtors={debtors} lessons={lessons} />

      {needsYou || desk ? (
        <div className={`grid items-start gap-4 ${needsYou && desk ? "lg:grid-cols-2" : ""}`}>
          {needsYou ? (
            <Card
              title="Needs you"
              delay={140}
              aside={
                count ? (
                  <span key={count} data-needs-count className="animate-ms-pop inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-ms-danger-btn px-1.5 text-[12px] font-semibold tabular-nums text-white">
                    {count}
                  </span>
                ) : undefined
              }
              action={count ? <span className="text-[13px] text-ms-fg-3">most urgent first</span> : undefined}
            >
              <AttentionList sources={attention} illustrate />
            </Card>
          ) : null}
          {desk ? <LessonsNowCard lessons={lessons} /> : null}
        </div>
      ) : null}

      <div className={`grid items-start gap-4 ${desk ? "lg:grid-cols-2" : ""}`}>
        <LearnersCard enabled={desk} withLessons={desk} delay={200} />
        <RecentlyOpened delay={260} />
      </div>

      {money.debt || money.sms || money.income ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
          <DebtCard enabled={money.debt} delay={300} />
          <SmsCard enabled={money.sms} delay={340} />
          <IncomeCard enabled={money.income} delay={380} />
        </div>
      ) : null}

      <div className={`grid items-start gap-4 ${superAdmin ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" : ""}`}>
        {superAdmin ? <PlatformCard delay={420} /> : null}
        <ShortcutsCard me={me} delay={460} />
      </div>

      {desk ? <LessonsDialog open={lessonsOpen} onClose={() => setLessonsOpen(false)} /> : null}
    </div>
  );
}
