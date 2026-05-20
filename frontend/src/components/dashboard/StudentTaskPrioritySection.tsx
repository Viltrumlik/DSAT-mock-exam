"use client";

/**
 * StudentTaskPrioritySection
 *
 * The "What needs attention now" section for the student dashboard.
 * Renders ABOVE all other dashboard cards, ensuring the most time-sensitive
 * work is always the first thing a student sees on login.
 *
 * Priority order (governance-aligned via assignmentLifecycle utility):
 *   1. Overdue assignments (red urgency)
 *   2. Due soon (within 48h, orange urgency)
 *   3. Active assignments (normal)
 *   4. Nothing pending — renders null
 *
 * Design principle: if a student has work due, they see it instantly.
 * This component does NOT render at all if there's nothing pending.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { classesApi } from "@/lib/api";
import type { Classroom, Assignment, NormalizedList } from "@/lib/criticalApiContract";
import {
  AlertTriangle,
  Clock,
  ClipboardList,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  deriveAssignmentLifecycleState,
  formatAssignmentDue,
  LIFECYCLE_DISPLAY,
  sortByLifecyclePriority,
  type AssignmentLifecycleState,
} from "@/lib/assignmentLifecycle";

type ClassroomWithRole = Classroom & { my_role?: string };

type PendingAssignment = {
  assignment: Assignment & { assessment_homework?: { homework_id?: number } | null };
  classroomId: number;
  classroomName: string;
  state: AssignmentLifecycleState;
};

/** Returns the correct student-facing URL for an assignment. */
function assignmentHref(p: PendingAssignment): string {
  // Assessment-type assignments are handled by the assessment workspace,
  // NOT by the generic classroom assignment view.
  if (p.assignment.assessment_homework) {
    return `/assessments/${p.assignment.id}`;
  }
  return `/classes/${p.classroomId}/assignments/${p.assignment.id}`;
}

// Card-level colour scheme per lifecycle state
const CARD_STYLES: Partial<Record<AssignmentLifecycleState, { border: string; bg: string }>> = {
  OVERDUE:    { border: "border-red-200",    bg: "bg-red-50" },
  DUE_SOON:   { border: "border-orange-200", bg: "bg-orange-50" },
  ACTIVE:     { border: "border-border",     bg: "bg-card" },
  NO_DEADLINE:{ border: "border-border",     bg: "bg-card" },
};

const RELATIVE_COLOR: Partial<Record<AssignmentLifecycleState, string>> = {
  OVERDUE:  "text-red-700",
  DUE_SOON: "text-orange-700",
};

type Props = {
  /** Whether the parent dashboard has already loaded its own data. */
  dashboardLoaded: boolean;
};

export function StudentTaskPrioritySection({ dashboardLoaded }: Props) {
  const [pending, setPending] = useState<PendingAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Wait for the parent dashboard to load first, so we don't double-spin
    if (!dashboardLoaded) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const classroomList = await classesApi.list();
        const enrolled = (classroomList.items as ClassroomWithRole[]).filter(
          (c) => c.my_role === "STUDENT" || c.my_role === undefined,
        );

        const results: PendingAssignment[] = [];

        await Promise.allSettled(
          enrolled.slice(0, 10).map(async (classroom) => {
            try {
              const list: NormalizedList<Assignment> = await classesApi.listAssignments(
                classroom.id,
              );
              for (const a of list.items) {
                // Filter out already-completed attempts
                const status = (a as Assignment & { workflow_status?: string }).workflow_status;
                const isCompleted =
                  status === "completed" ||
                  status === "submitted" ||
                  status === "graded";
                if (isCompleted) continue;

                const state = deriveAssignmentLifecycleState(a);
                // Don't surface completed or open-indefinite in this "needs attention" widget
                if (state === "COMPLETED") continue;

                results.push({
                  assignment: a,
                  classroomId: classroom.id,
                  classroomName: classroom.name ?? `Class #${classroom.id}`,
                  state,
                });
              }
            } catch {
              // individual classroom failures are silent
            }
          }),
        );

        if (!cancelled) {
          // Sort by urgency: OVERDUE → DUE_SOON → ACTIVE → NO_DEADLINE
          const sorted = sortByLifecyclePriority(
            results.map((r) => ({ ...r.assignment, _pending: r })),
          ).map((x) => x._pending as PendingAssignment);

          setPending(sorted);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboardLoaded]);

  // Don't render anything until both the parent and this section have loaded
  if (!loaded && !loading) return null;
  if (loading && !dashboardLoaded) return null;

  // Nothing pending → don't take up space in the layout
  if (loaded && pending.length === 0) return null;

  const overdueCount  = pending.filter((p) => p.state === "OVERDUE").length;
  const dueSoonCount  = pending.filter((p) => p.state === "DUE_SOON").length;

  return (
    <section className="mb-6" aria-label="Pending assignments">
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-extrabold text-foreground uppercase tracking-wide">
            Needs attention
          </h2>
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-800">
              <AlertTriangle className="h-2.5 w-2.5" />
              {overdueCount} overdue
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-800">
              <Clock className="h-2.5 w-2.5" />
              {dueSoonCount} due soon
            </span>
          )}
        </div>
        <Link
          href="/assessments"
          className="text-xs font-bold text-primary hover:underline"
        >
          All assessments &rarr;
        </Link>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      )}

      {/* Assignment cards */}
      {!loading && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pending.slice(0, 6).map((p) => {
            const cardStyle = CARD_STYLES[p.state] ?? CARD_STYLES.ACTIVE!;
            const display   = LIFECYCLE_DISPLAY[p.state];
            const relDue    = formatAssignmentDue(p.assignment.due_at);
            const relColor  = RELATIVE_COLOR[p.state] ?? "text-muted-foreground";

            return (
              <Link
                key={`${p.classroomId}-${p.assignment.id}`}
                href={assignmentHref(p)}
                className={cn(
                  "group flex flex-col gap-2 rounded-2xl border p-4 transition-colors hover:border-primary/30 hover:bg-primary/5",
                  cardStyle.border,
                  cardStyle.bg,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-foreground truncate text-sm">
                      {p.assignment.title ?? "Untitled assignment"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.classroomName}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-lg px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide shrink-0",
                      display.badgeClasses,
                    )}
                  >
                    {display.label}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("text-xs font-bold", relColor)}>
                    {relDue}
                  </p>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            );
          })}

          {/* Show more hint if more than 6 */}
          {pending.length > 6 && (
            <Link
              href="/assessments"
              className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-4 text-sm font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            >
              <span>+{pending.length - 6} more</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
