"use client";

import Link from "next/link";
import { ChevronRight, Calculator, BookOpen, GraduationCap } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageHeader, Card, EmptyState, LoadingState, ErrorState } from "../ui";
import { useClassrooms } from "../hooks";
import type { ClassroomWithRole } from "../types";

/**
 * Top-level picker for per-classroom surfaces (Midterms, Materials). Lists the
 * teacher's classrooms; each links into the classroom workspace on the given tab.
 */
export function ClassroomPickerList({
  tab,
  title,
  description,
}: {
  tab: "midterms" | "materials";
  title: string;
  description: string;
}) {
  const { data, isLoading, isError, refetch } = useClassrooms();
  const classes = (data?.items ?? []) as ClassroomWithRole[];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader title={title} description={description} />
      <div className="mt-6">
        {isLoading ? (
          <LoadingState label="Loading your classrooms…" />
        ) : isError ? (
          <ErrorState message="We couldn't load your classrooms." onRetry={() => refetch()} />
        ) : classes.length === 0 ? (
          <Card>
            <EmptyState icon={GraduationCap} title="No classrooms yet" description="You haven't been assigned to a classroom yet. Once an administrator assigns you as a teacher, your classrooms will appear here." />
          </Card>
        ) : (
          <div className="space-y-3">
            {classes.map((c) => {
              const isMath = String((c as { subject?: string }).subject ?? "").toUpperCase() === "MATH";
              const Icon = isMath ? Calculator : BookOpen;
              return (
                <Link key={c.id} href={`/teacher/classrooms/${c.id}?tab=${tab}`} className="block">
                  <Card pad="none" interactive>
                    <div className="flex items-center gap-3 p-4">
                      <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", isMath ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-violet-500/10 text-violet-600 dark:text-violet-400")}>
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{isMath ? "Math" : "English"}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
