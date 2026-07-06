"use client";

import Link from "next/link";
import { Users, GraduationCap, Calculator, BookOpen, Archive } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatLessonDaysMeta } from "@/lib/classroomSchedule";
import { PageHeader, Card, EmptyState, LoadingState, ErrorState, Pill } from "../ui";
import { useClassrooms } from "../hooks";
import type { ClassroomWithRole } from "../types";

function ClassCard({ c }: { c: ClassroomWithRole }) {
  const subject = String((c as { subject?: string }).subject ?? "").toUpperCase();
  const isMath = subject === "MATH";
  const Icon = isMath ? Calculator : BookOpen;
  const schedule = formatLessonDaysMeta((c as { lesson_days?: string }).lesson_days);
  const count = (c as { members_count?: number; student_count?: number }).members_count ?? (c as { student_count?: number }).student_count;
  const archived = (c as { is_active?: boolean }).is_active === false;

  return (
    <Link href={`/teacher/classrooms/${c.id}`} className="block">
      <Card pad="none" interactive>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                isMath ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            {archived && <Pill tone="neutral"><Archive className="mr-1 h-3 w-3" />Archived</Pill>}
          </div>
          <h3 className="mt-3 truncate text-base font-semibold text-foreground">{c.name}</h3>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{isMath ? "Math" : "English"}</span>
            {schedule && <span>· {schedule}</span>}
            {typeof count === "number" && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {count}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

/**
 * Teacher's classroom hub: open + manage the classes you've been assigned to.
 * Classrooms are created by administrators (in the admin console), who assign the
 * teacher — teachers do not create their own classrooms. Edit/archive happen in the
 * classroom Settings tab.
 */
export function TeacherClassrooms() {
  const { data, isLoading, isError, refetch } = useClassrooms();

  const classes = (data?.items ?? []) as ClassroomWithRole[];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Classrooms"
        description="Manage your classes, students, assignments, materials, and midterms."
      />

      <div className="mt-6">
        {isLoading ? (
          <LoadingState label="Loading your classrooms…" />
        ) : isError ? (
          <ErrorState message="We couldn't load your classrooms." onRetry={() => refetch()} />
        ) : classes.length === 0 ? (
          <Card>
            <EmptyState
              icon={GraduationCap}
              title="No classrooms yet"
              description="You haven't been added to any classrooms yet. Your administrator sets up classrooms and assigns you as the teacher — once that happens, they'll appear here."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <ClassCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
