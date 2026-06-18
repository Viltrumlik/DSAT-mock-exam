"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, LogIn, BookOpen, Calculator, GraduationCap } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { formatLessonDaysMeta } from "@/lib/classroomSchedule";
import { PageHeader, Card, Button, Dialog, Field, Input, EmptyState, LoadingState, ErrorState, Pill } from "../ui";
import { useClassrooms, useJoinClass } from "../hooks";
import { normalizeRole, ROLE_LABEL } from "../capabilities";
import type { ClassroomWithRole } from "../types";

// Student portal is consumer-only: students JOIN and VIEW classes. Classroom creation/
// editing/administration lives exclusively in the Teacher Portal (teacher.mastersat.uz).

function ClassCard({ c }: { c: ClassroomWithRole }) {
  const subject = String((c as { subject?: string }).subject ?? "").toUpperCase();
  const isMath = subject === "MATH";
  const Icon = isMath ? Calculator : BookOpen;
  const schedule = formatLessonDaysMeta((c as { lesson_days?: string }).lesson_days);
  const count = (c as { members_count?: number; student_count?: number }).members_count ?? (c as { student_count?: number }).student_count;
  const role = normalizeRole(c.my_role);

  return (
    <Link href={`/classes/${c.id}`} className="block">
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
          {role && <Pill tone={role === "STUDENT" ? "neutral" : "primary"}>{ROLE_LABEL[role]}</Pill>}
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

export function ClassesHome() {
  const { data, isLoading, isError, refetch } = useClassrooms();
  const join = useJoinClass();

  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);

  const classes = (data?.items ?? []) as ClassroomWithRole[];

  async function submitJoin() {
    setJoinErr(null);
    try {
      await join.mutateAsync(code);
      setJoinOpen(false);
      setCode("");
    } catch (e) {
      setJoinErr(normalizeApiError(e).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Classes"
        description="Your classrooms, assignments, and progress in one place."
        actions={
          <Button variant="secondary" icon={LogIn} onClick={() => setJoinOpen(true)}>
            Join
          </Button>
        }
      />

      <div className="mt-6">
        {isLoading ? (
          <LoadingState label="Loading your classes…" />
        ) : isError ? (
          <ErrorState message="We couldn't load your classes." onRetry={() => refetch()} />
        ) : classes.length === 0 ? (
          <Card>
            <EmptyState
              icon={GraduationCap}
              title="No classes yet"
              description="Join a class with the code your teacher shared."
              action={
                <Button variant="secondary" icon={LogIn} onClick={() => setJoinOpen(true)}>
                  Join with code
                </Button>
              }
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

      <Dialog
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        title="Join a class"
        description="Enter the code your teacher gave you."
        footer={
          <>
            <Button variant="ghost" onClick={() => setJoinOpen(false)}>
              Cancel
            </Button>
            <Button loading={join.isPending} onClick={submitJoin} disabled={!code.trim()}>
              Join class
            </Button>
          </>
        }
      >
        <Field label="Class code" error={joinErr}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 7QX2KP"
            className="font-mono uppercase tracking-widest"
            onKeyDown={(e) => e.key === "Enter" && submitJoin()}
            autoFocus
          />
        </Field>
      </Dialog>
    </div>
  );
}
