"use client";

/**
 * The teacher's first screen.
 *
 * What the owner asked for on 2026-09-20, in order: the classes with their lesson time and
 * room, the one whose lesson is coming standing first and each row opening its classroom;
 * the day and time of every class so the week is readable here; the manual grading queue
 * nested class → homework → student; then the figures worth a picture.
 *
 * It is ONE request. The screen this replaces spent two per class to draw less.
 *
 * Every block loads, fails and empties on its own, so one failed request costs the reader
 * that block and never the page, and a failure never renders as "there is nothing here".
 */

import Link from "next/link";
import { ClipboardPen, Table2 } from "lucide-react";
import { Button, Card, EmptyState, TeacherPage } from "./ui";
import { useTeacherToday, type TeacherToday } from "./useTeacherToday";
import { ClassesCard } from "./dashboard/ClassesCard";
import { GradingCard } from "./dashboard/GradingCard";
import { MidtermsCard } from "./dashboard/MidtermsCard";
import { StatsCards } from "./dashboard/StatsCards";

export type TeacherDashboardPreview = { today: TeacherToday };

function dayLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function TeacherDashboard({ preview }: { preview?: TeacherDashboardPreview }) {
  const query = useTeacherToday(!preview);
  const data = preview?.today ?? query.data;
  const loading = !preview && query.isPending;
  const failed = !preview && query.isError;
  const retry = () => void query.refetch();

  // A teacher with no classes at all is not a teacher with five empty blocks. Say the one true
  // thing once — and only from an answer that actually came back, never from one that failed.
  if (!loading && !failed && data && data.classes.length === 0) {
    return (
      <TeacherPage title="Today" subtitle={data.date ? dayLabel(data.date) : undefined}>
        <Card>
          <EmptyState
            title="No classes yet"
            hint="When a class is assigned to you, its lessons, the homework due at them and the work waiting to be checked appear here."
          />
        </Card>
      </TeacherPage>
    );
  }

  return (
    <TeacherPage
      title="Today"
      subtitle={data?.date ? dayLabel(data.date) : undefined}
      actions={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/teacher/grading"><Button variant="ghost"><ClipboardPen size={15} aria-hidden />Grade</Button></Link>
          <Link href="/teacher/gradebook"><Button variant="ghost"><Table2 size={15} aria-hidden />Gradebook</Button></Link>
        </div>
      }
    >
      <ClassesCard
        classes={data?.classes ?? []}
        todayIso={data?.date ?? ""}
        nextLessonDate={data?.nextLessonDate ?? null}
        loading={loading}
        failed={failed}
        onRetry={retry}
      />

      <GradingCard queue={data?.gradingQueue ?? []} loading={loading} failed={failed} onRetry={retry} />

      <MidtermsCard midterms={data?.upcomingMidterms ?? []} loading={loading} failed={failed} onRetry={retry} />

      <StatsCards
        queue={data?.gradingQueue ?? []}
        attendanceWeek={data?.stats.attendanceWeek ?? []}
        homework30d={data?.stats.homework30d ?? []}
        attendanceTrend={data?.stats.attendanceTrend ?? []}
        loading={loading}
        failed={failed}
        onRetry={retry}
      />
    </TeacherPage>
  );
}
