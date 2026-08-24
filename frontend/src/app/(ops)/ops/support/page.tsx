"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";

import { useSupportTeachers } from "@/features/opsSupport/opsSupportHooks";
import { WeeklyHoursEditor } from "@/features/opsSupport/WeeklyHoursEditor";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";

/**
 * Support teaching, from the school's side: who does it, and when they work.
 *
 * **The four-day grid is gone.** It was here because hours used to be dated — you withdrew a
 * specific Tuesday afternoon by clicking its cell — and once the weekly schedule landed it was
 * a second, contradictory place to answer the same question. Two controls for one fact is how
 * an admin ends up setting hours in one and wondering why the other disagrees. Withdrawing a
 * single hour is now the support teacher's own job from the teacher portal, where they can see
 * who is booked into it; this console sets the standing rule.
 *
 * Styled as flat bordered panels with an uppercase header strip, matching Users, Classrooms
 * and Exam dates. It used to use the shadowed `Card` component, which is what made this page
 * read as belonging to a different product than the rest of the console.
 */

const SUBJECT_LABEL: Record<string, string> = {
  math: "Maths",
  english: "English",
  both: "Both",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function OpsSupportPage() {
  const teachers = useSupportTeachers();
  const [selected, setSelected] = useState<number | null>(null);

  const selectedTeacher = teachers.data?.find((t) => t.id === selected);

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Support"
        title="Support teaching"
        description="Who teaches support, and the weekly hours students can book them for. Set once — they keep applying every week."
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        {/* Who */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
            <LifeBuoy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Support teachers
            </p>
            {teachers.data ? (
              <span className="ml-auto text-[10px] font-bold text-muted-foreground">
                {teachers.data.length}
              </span>
            ) : null}
          </div>

          {teachers.isPending ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 rounded bg-muted" />
                    <div className="h-2.5 w-16 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : teachers.isError ? (
            // A failed fetch is not an empty school. Saying "no support teachers yet" here
            // would send an admin off to create an account that already exists.
            <div className="px-5 py-8 text-center">
              <p className="text-sm font-semibold text-foreground">The list didn&apos;t load.</p>
              <button
                type="button"
                onClick={() => void teachers.refetch()}
                className="mt-1 text-sm font-bold text-primary underline"
              >
                Try again
              </button>
            </div>
          ) : teachers.data.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <LifeBuoy className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-semibold text-foreground">No support teachers yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one in Users with the support teacher role.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {teachers.data.map((t) => {
                const active = selected === t.id;
                const name = t.name || t.email;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t.id)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors ${
                      active ? "bg-primary-soft" : "hover:bg-surface-2"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface-2 text-muted-foreground"
                      }`}
                      aria-hidden
                    >
                      {initials(name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* Wraps rather than truncates. Uzbek names run long — "Dilafruz
                          Ibrokhimjonova" lost its surname to an ellipsis in this column, and
                          a list of support teachers whose surnames are cut off is useless
                          precisely when two of them share a first name. */}
                      <span className="block font-semibold leading-snug text-foreground">
                        {name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {SUBJECT_LABEL[t.subject] ?? t.subject}
                      </span>
                    </span>
                    {!t.is_active ? (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                        Off
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* When */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-surface-2 px-5 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {selectedTeacher ? `Weekly hours · ${selectedTeacher.name || selectedTeacher.email}` : "Weekly hours"}
            </p>
          </div>

          {selected == null ? (
            <div className="px-5 py-14 text-center">
              <LifeBuoy className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-semibold text-foreground">Pick a support teacher</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose someone on the left to set the hours students can book them for.
              </p>
            </div>
          ) : (
            <div className="p-5">
              <WeeklyHoursEditor
                // Remount on teacher change. Without the key the editor keeps the previous
                // teacher's draft in state while the new one's schedule loads, and a fast
                // admin could save one person's hours onto another.
                key={selected}
                supportTeacherId={selected}
                teacherName={selectedTeacher?.name?.split(/\s+/)[0] || "This teacher"}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
