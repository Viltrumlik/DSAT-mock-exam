"use client";

/**
 * What the class did in the room, and the XP a teacher gave for it.
 *
 * A separate surface rather than a student-shaped Lessons tab, deliberately. The lesson
 * plan endpoints are staff-gated server-side (`deny_unless_staff` on both the plan and the
 * detail route), so un-gating that tab would render a 403 for every student; and the plan
 * is the teaching team's working document — timings, validation warnings, which items are
 * still unapproved — none of which a student should read. The carrier Assignment, by
 * contrast, is exactly the authored block the class was given, and every member can
 * already read it.
 *
 * Classwork has no deadline and nothing to hand in, so there is no submission state here
 * and never a "you are late". The teacher's award is the whole of the outcome.
 *
 * **Shaped as rows, not cards, to match the Assignments (homework) list** — same row
 * chrome, same stagger, same right-aligned meta, so a teacher moving between the two tabs
 * is reading one list in two places. The classwork's contents live on the assignment detail
 * page it links to, exactly as a homework's do; this page is the index, not the content.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreVertical, Plus, Presentation, Sparkles } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState, Pill } from "../ui";
import { capabilitiesFor } from "../capabilities";
import { spawnRipple } from "../ui/ripple";
import { useStudentClasswork } from "../classworkHooks";
import { ClassworkAwardDialog } from "./ClassworkAwardDialog";
import type { StudentClasswork } from "../classworkApi";
import type { ClassroomWithRole } from "../types";

/**
 * Base path for this classroom's routes. The teacher portal is scoped by middleware to
 * `/teacher/*`, so a `/classes/...` link there bounces to the dashboard. Same rule the
 * Assignments page follows; it keeps its own copy of this helper, which is where the
 * shared one should eventually live.
 */
function useClassBase(classId: number): string {
  const pathname = usePathname() || "";
  return pathname.startsWith("/teacher/")
    ? `/teacher/classrooms/${classId}`
    : `/classes/${classId}`;
}

/** "Sep 5" — the same short form the Assignments rows use. */
function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** How many openable things the teacher bundled into this classwork. */
function activityCount(row: StudentClasswork): number {
  return row.contents.length + row.vocabulary.length;
}

/**
 * Shared row chrome, 1:1 with the Assignments list: circle icon tile · title · badge ·
 * date · actions.
 */
function RowShell({
  href,
  title,
  subtitle,
  meta,
  index,
  badge,
  actions,
}: {
  href: string;
  title: string;
  subtitle?: string;
  meta: string;
  index: number;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="cr-rowin group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2"
      style={{ animationDelay: `${Math.min(index, 14) * 40}ms` }}
    >
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Presentation className="h-5 w-5" aria-hidden />
      </span>
      <Link href={href} className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-foreground transition-colors group-hover:text-primary">
          {title}
        </p>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </Link>
      {badge}
      {meta && (
        <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-muted-foreground">
          {meta}
        </span>
      )}
      {actions}
    </div>
  );
}

/** The student's outcome for one classwork. Encouraging in every branch, including zero. */
function AwardBadge({ row }: { row: StudentClasswork }) {
  // Null and `{points: 0}` are different answers: null is "no teacher has looked at this
  // yet", zero is "a teacher marked this lesson". Never test `points > 0` to decide whether
  // an award exists.
  if (row.award == null) {
    return <Pill tone="neutral">Not marked yet</Pill>;
  }
  return (
    <Pill tone="success">
      <Sparkles className="mr-1 h-3 w-3" aria-hidden />
      {/* A recorded zero is not "nothing yet" — it is a teacher who looked. Say that, and
          never dress it up as XP the student lost. */}
      {row.award.points > 0 ? `+${row.award.points} XP` : "Reviewed"}
    </Pill>
  );
}

function StudentRow({ row, classBase, index }: { row: StudentClasswork; classBase: string; index: number }) {
  const n = activityCount(row);
  const href = `${classBase}/assignments/${row.id}`;
  return (
    <RowShell
      href={href}
      title={row.title || "Classwork"}
      subtitle={n > 0 ? `${n} ${n === 1 ? "activity" : "activities"}` : undefined}
      meta={row.assigned_at ? `In class ${shortDate(row.assigned_at)}` : "In class"}
      index={index}
      badge={<AwardBadge row={row} />}
      actions={
        <Link
          href={href}
          aria-label={`Open ${row.title || "classwork"}`}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <MoreVertical className="h-[18px] w-[18px]" />
        </Link>
      }
    />
  );
}

function StaffRow({
  row,
  classId,
  classBase,
  index,
  canAward,
}: {
  row: StudentClasswork;
  classId: number;
  classBase: string;
  index: number;
  /** `capabilities.canManageClass` — OWNER + TEACHER. Never `isStaff`; classwork XP is minted. */
  canAward: boolean;
}) {
  const [awarding, setAwarding] = useState(false);
  const n = activityCount(row);
  const href = `${classBase}/assignments/${row.id}`;
  return (
    <>
      <RowShell
        href={href}
        title={row.title || "Classwork"}
        subtitle={n > 0 ? `${n} ${n === 1 ? "activity" : "activities"}` : undefined}
        meta={row.assigned_at ? `In class ${shortDate(row.assigned_at)}` : "In class"}
        index={index}
        // Same badge the homework list shows, for the same reason: XP can be given on a
        // classwork the class cannot see yet, and the teacher should not have to guess.
        badge={row.status === "DRAFT" ? <Pill tone="neutral">Draft</Pill> : null}
        actions={
          <>
            {/* The whole point of the tab for a teacher, so it is a button and not a menu
                item: marking a class is the thing they came here to do. TAs are not offered
                it at all — the server refuses them, and a control that always 403s is worse
                than no control. */}
            {canAward && (
              <Button size="sm" variant="secondary" icon={Sparkles} onClick={() => setAwarding(true)}>
                Give XP
              </Button>
            )}
            <Link
              href={href}
              aria-label={`Open ${row.title || "classwork"}`}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <MoreVertical className="h-[18px] w-[18px]" />
            </Link>
          </>
        }
      />
      {/* Mounted only once opened, so a list of twenty classworks holds no roster queries. */}
      {awarding && (
        <ClassworkAwardDialog
          open
          onClose={() => setAwarding(false)}
          classId={classId}
          assignmentId={row.id}
          title={row.title || "Classwork"}
        />
      )}
    </>
  );
}

export function Classwork({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const classBase = useClassBase(classId);
  const { rows, isLoading, isError, refetch } = useStudentClasswork(classId);
  const newHref = `${classBase}/assignments/new?kind=classwork`;

  return (
    <div className="cr-section space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Classwork</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {caps.isStudent
              ? "What you worked on in class, and the XP your teacher gave you"
              : "In-class work. No deadline — you give the XP yourself."}
          </p>
        </div>
        {/* Authoring lives here rather than beside "New homework" on Assignments: the two
            are different kinds of work with different rules, and the section a teacher is
            standing in is the one that should offer to add to it. */}
        {caps.canManageAssignments && (
          <Link href={newHref}>
            <Button className="cr-ripple" onPointerDown={spawnRipple} icon={Plus}>
              New classwork
            </Button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading classwork…" />
      ) : isError ? (
        // A failed fetch is never "no classwork yet" — that would tell a student their
        // lessons were never given.
        <ErrorState
          title="Classwork not available"
          message="We couldn't load this class's work just now."
          onRetry={refetch}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Presentation}
          title="No classwork yet"
          description={
            caps.isStudent
              ? "Work you do during lessons shows up here, along with the XP your teacher gives you."
              : "Add classwork here, or give a lesson's classwork from the Lessons tab — both appear in this list."
          }
          action={
            caps.canManageAssignments && (
              <Link href={newHref}>
                <Button icon={Plus}>New classwork</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {rows.map((row, i) =>
            caps.isStudent ? (
              <StudentRow key={row.id} row={row} classBase={classBase} index={i} />
            ) : (
              <StaffRow
                key={row.id}
                row={row}
                classId={classId}
                classBase={classBase}
                index={i}
                canAward={caps.canManageClass}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
