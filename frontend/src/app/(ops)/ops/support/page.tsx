"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, EmptyState, TabPanel, Tabs, buttonClass } from "@/features/console/ui";
import { useSupportTeachers } from "@/features/opsSupport/opsSupportHooks";
import { WeeklyHoursEditor } from "@/features/opsSupport/WeeklyHoursEditor";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { SupportReportPage } from "@/features/supportReport/SupportReportPage";
import { cn } from "@/lib/cn";

/**
 * Support teaching, from the school's side: who does it, when they work, and what came of it.
 *
 * Two tabs, because the page answers two different questions and they have different
 * lifetimes. **Hours** is a setting — you come here to change something, once, and leave.
 * **Sessions** is a report — you come here to read what happened. Stacking the report under
 * the weekly grid would have buried it below a control most readers scroll straight past, and
 * the finding it carries (hours nobody ever settled, going back to August) is the whole reason
 * the school asked for it.
 *
 * **The four-day grid is gone.** It was here because hours used to be dated — you withdrew a
 * specific Tuesday afternoon by clicking its cell — and once the weekly schedule landed it was
 * a second, contradictory place to answer the same question. Two controls for one fact is how
 * an admin ends up setting hours in one and wondering why the other disagrees. Withdrawing a
 * single hour is now the support teacher's own job from the teacher portal, where they can see
 * who is booked into it; this console sets the standing rule.
 *
 * Drawn in the console's look (design handoff v0.3): two cards with a caption strip, the
 * teacher list on the left and the week on the right.
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

type TabKey = "hours" | "sessions";

const TABS: { id: TabKey; label: string }[] = [
  { id: "hours", label: "Weekly hours" },
  { id: "sessions", label: "Session report" },
];

/** A card with its caption strip, as the console's panels have it. */
const CARD = "animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1";
const CAPTION = "flex items-center gap-2 border-b border-ms-line px-5 py-3 text-ms-over text-ms-fg-3";

export default function OpsSupportPage() {
  const [tab, setTab] = useState<TabKey>("hours");
  const teachers = useSupportTeachers();
  const [selected, setSelected] = useState<number | null>(null);

  const selectedTeacher = teachers.data?.find((t) => t.id === selected);

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Support"
        title="Support hours"
        description={
          tab === "hours"
            ? "Who teaches support, and the weekly hours students can book them for. Set once — they keep applying every week."
            : "Every support session the desk has run: who was helped, when, on what, and how it ended."
        }
      />

      <Tabs label="Support views" tabs={TABS} value={tab} onChange={setTab} idPrefix="support" />

      <TabPanel idPrefix="support" id={tab}>
        {tab === "sessions" ? (
          <SupportReportPage />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
            {/* Who */}
            <div className={CARD}>
              <div className={CAPTION}>
                <Icon name="ms-support" size="sm" className="size-3.5" />
                <p>Support teachers</p>
                {teachers.data ? <span className="ml-auto tabular-nums">{teachers.data.length}</span> : null}
              </div>

              {teachers.isPending ? (
                <div className="divide-y divide-ms-line" aria-busy>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                      <div className="animate-ms-shimmer size-9 shrink-0 rounded-full" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="animate-ms-shimmer h-3.5 w-32 rounded-[6px]" />
                        <div className="animate-ms-shimmer h-2.5 w-16 rounded-[6px]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : teachers.isError ? (
                // A failed fetch is not an empty school. Saying "no support teachers yet" here
                // would send an admin off to create an account that already exists.
                <div role="alert" className="flex flex-col items-center gap-2 px-5 py-8 text-center">
                  <span className="grid size-10 place-items-center rounded-full bg-ms-critical-soft text-ms-critical-fg">
                    <Icon name="alert" />
                  </span>
                  <p className="text-[14px] font-semibold text-ms-fg">The list didn&apos;t load.</p>
                  <button
                    type="button"
                    onClick={() => void teachers.refetch()}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    Try again
                  </button>
                </div>
              ) : teachers.data.length === 0 ? (
                <EmptyState
                  icon="ms-support"
                  title="No support teachers yet"
                  detail="Create one in Users with the support teacher role."
                />
              ) : (
                <div className="divide-y divide-ms-line">
                  {teachers.data.map((t) => {
                    const active = selected === t.id;
                    const name = t.name || t.email;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelected(t.id)}
                        aria-pressed={active}
                        className={cn(
                          "ms-transition flex w-full items-center gap-3 px-5 py-3.5 text-left",
                          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ms-ring",
                          active ? "bg-ms-primary-soft" : "hover:bg-ms-surface",
                        )}
                      >
                        <span
                          className={cn(
                            "ms-transition grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                            active ? "bg-ms-primary text-white" : "bg-ms-surface-2 text-ms-fg-2",
                          )}
                          aria-hidden
                        >
                          {initials(name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          {/* Wraps rather than truncates. Uzbek names run long — "Dilafruz
                              Ibrokhimjonova" lost its surname to an ellipsis in this column, and
                              a list of support teachers whose surnames are cut off is useless
                              precisely when two of them share a first name. */}
                          {/* An email (a teacher with no name) has no spaces to wrap at: break it anywhere. */}
                          <span className={cn("block break-words text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]", active ? "text-ms-primary-text" : "text-ms-fg")}>
                            {name}
                          </span>
                          <span className="block truncate text-[13px] text-ms-fg-3">
                            {SUBJECT_LABEL[t.subject] ?? t.subject}
                          </span>
                        </span>
                        {!t.is_active ? (
                          <Badge tone="neutral" dot>
                            Off
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* When */}
            <div className={CARD} style={{ animationDelay: "40ms" }}>
              <div className={CAPTION}>
                <Icon name="cal" size="sm" className="size-3.5" />
                <p className="min-w-0">
                  {selectedTeacher ? `Weekly hours · ${selectedTeacher.name || selectedTeacher.email}` : "Weekly hours"}
                </p>
              </div>

              {selected == null ? (
                <EmptyState
                  icon="ms-support"
                  title="Pick a support teacher"
                  detail="Choose someone on the left to set the hours students can book them for."
                />
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
        )}
      </TabPanel>
    </div>
  );
}
