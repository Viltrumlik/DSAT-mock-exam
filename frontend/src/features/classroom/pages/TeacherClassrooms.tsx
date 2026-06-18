"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, Plus, GraduationCap, Calculator, BookOpen, Archive } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { formatLessonDaysMeta } from "@/lib/classroomSchedule";
import { PageHeader, Card, Button, Dialog, Field, Select, TextField, EmptyState, LoadingState, ErrorState, Pill } from "../ui";
import { useClassrooms, useCreateClass, type CreateClassInput } from "../hooks";
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

/** Teacher's classroom hub: create + open. Edit/archive happen in the classroom Settings tab. */
export function TeacherClassrooms() {
  const { data, isLoading, isError, refetch } = useClassrooms();
  const create = useCreateClass();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateClassInput>({ name: "", subject: "ENGLISH", lesson_days: "ODD" });
  const [createErr, setCreateErr] = useState<string | null>(null);

  const classes = (data?.items ?? []) as ClassroomWithRole[];

  async function submitCreate() {
    setCreateErr(null);
    if (!form.name.trim()) return setCreateErr("Give the class a name.");
    try {
      await create.mutateAsync(form);
      setCreateOpen(false);
      setForm({ name: "", subject: "ENGLISH", lesson_days: "ODD" });
    } catch (e) {
      setCreateErr(normalizeApiError(e).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Classrooms"
        description="Create and manage your classes, students, assignments, materials, and midterms."
        actions={
          <Button icon={Plus} onClick={() => setCreateOpen(true)}>Create classroom</Button>
        }
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
              description="Create your first classroom to start assigning work."
              action={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Create classroom</Button>}
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
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a classroom"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={submitCreate}>Create classroom</Button>
          </>
        }
      >
        <div className="space-y-4">
          {createErr && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{createErr}</p>}
          <TextField label="Class name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SAT Math — Evening Group" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject" htmlFor="cls-subject">
              <Select id="cls-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value as CreateClassInput["subject"] })}>
                <option value="ENGLISH">English</option>
                <option value="MATH">Math</option>
              </Select>
            </Field>
            <Field label="Lesson days" htmlFor="cls-days">
              <Select id="cls-days" value={form.lesson_days} onChange={(e) => setForm({ ...form, lesson_days: e.target.value as CreateClassInput["lesson_days"] })}>
                <option value="ODD">Odd days</option>
                <option value="EVEN">Even days</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Lesson time" value={form.lesson_time ?? ""} onChange={(e) => setForm({ ...form, lesson_time: e.target.value })} placeholder="18:00" />
            <TextField label="Room" value={form.room_number ?? ""} onChange={(e) => setForm({ ...form, room_number: e.target.value })} placeholder="Optional" />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
