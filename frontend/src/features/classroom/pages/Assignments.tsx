"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Plus, MoreVertical, Archive } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button, Pill, LoadingState, ErrorState, EmptyState } from "../ui";
import { useAssignments } from "../hooks";
import { classroomKeys } from "../queryKeys";
import { capabilitiesFor } from "../capabilities";
import { spawnRipple } from "../ui/ripple";
import { AssignmentRowActions } from "./AssignmentRowActions";
import { SubmissionStatusPill } from "./statusPill";
import type { ClassroomWithRole } from "../types";

interface AsgRow {
  id: number;
  title: string;
  due_at?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  workflow_status?: string | null;
  assessment_homework?: unknown | null;
  /** The class's active students who have turned it in: SUBMITTED or REVIEWED. Sent to staff only. */
  turned_in_count?: number;
  /** The class's active students, the total `turned_in_count` is out of. Taken from the class. */
  student_count?: number;
}

function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Right-aligned status line — 1:1 with the mockup (Posted / Due / Was due-red). */
function statusInfo(a: AsgRow, staff: boolean): { text: string; overdue: boolean } {
  if (a.due_at) {
    const due = new Date(a.due_at).getTime();
    if (!Number.isNaN(due)) {
      const done = !staff && (a.workflow_status === "SUBMITTED" || a.workflow_status === "REVIEWED");
      if (due < Date.now() && !done) return { text: `Was due ${shortDate(a.due_at)}`, overdue: true };
      return { text: `Due ${shortDate(a.due_at)}`, overdue: false };
    }
  }
  const posted = a.published_at || a.created_at;
  return posted ? { text: `Posted ${shortDate(posted)}`, overdue: false } : { text: "No deadline", overdue: false };
}

/**
 * Staff's "N / M submitted" under a homework's title: the class's active students who have turned it
 * in, out of its active students. Null until one has, and when the server sent no count.
 *
 * Never `submissions_count`, which counts every submission row: a draft the student never turned in,
 * work returned for revision, and the work of a student who has since left the class or joined its
 * teaching team. Nor `members_count` as the total, which counts the teacher and any TA.
 */
function submittedLine(a: AsgRow): string | null {
  if (typeof a.turned_in_count !== "number" || a.turned_in_count <= 0) return null;
  return typeof a.student_count === "number"
    ? `${a.turned_in_count} / ${a.student_count} submitted`
    : `${a.turned_in_count} submitted`;
}

function hrefFor(classBase: string, a: AsgRow): string {
  // Open the in-class detail page (it deep-links into every bundled activity).
  return `${classBase}/assignments/${a.id}`;
}

/**
 * Base path for this classroom's routes. The teacher portal (teacher.mastersat.uz)
 * is scoped by middleware to `/teacher/*` only — linking to `/classes/...` there
 * bounces the teacher to the dashboard — so keep every link under `/teacher/classrooms`
 * when we're rendered inside the teacher console.
 */
function useClassBase(classId: number): string {
  const pathname = usePathname() || "";
  return pathname.startsWith("/teacher/")
    ? `/teacher/classrooms/${classId}`
    : `/classes/${classId}`;
}

export function Assignments({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const classBase = useClassBase(classId);
  const caps = capabilitiesFor(classroom.my_role);
  const staff = caps.canManageAssignments;
  const { data, isLoading, isError, refetch } = useAssignments(classId);
  const [showArchived, setShowArchived] = useState(false);
  const newHref = `${classBase}/assignments/new`;

  const archived = useQuery({
    queryKey: [...classroomKeys.assignments(classId), "archived"],
    queryFn: async () => (await api.get(`/classes/${classId}/assignments/?include_archived=1`)).data,
    enabled: showArchived && staff,
  });

  // Every row carries the class's student count, the total its "N / M submitted" line is out of.
  const withStudentCount = (a: AsgRow): AsgRow => ({ ...a, student_count: classroom.student_count });
  const rows = ((data?.items ?? []) as AsgRow[]).map(withStudentCount);
  const archivedRows = ((Array.isArray(archived.data) ? archived.data : archived.data?.items ?? []) as AsgRow[])
    .filter((a) => a.status === "ARCHIVED")
    .map(withStudentCount);

  return (
    <div className="cr-section space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Assignments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* Not classwork: the server leaves it out of this list, and it has its own tab. */}
            {staff ? "Homework and practice tests" : "Your work for this class"}
          </p>
        </div>
        {/* Homework only. Classwork is authored from its own tab — the two are different
            kinds of work with different rules (classwork never has a deadline and is paid
            only when the teacher awards it), so each is added from the section it belongs to. */}
        {staff && (
          <Link href={newHref}>
            <Button className="cr-ripple" onPointerDown={spawnRipple} icon={Plus}>New homework</Button>
          </Link>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingState label="Loading assignments…" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          description={staff ? "Create the first assignment for this class." : "New assignments will appear here."}
          action={staff && <Link href={newHref}><Button icon={Plus}>New assignment</Button></Link>}
        />
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {rows.map((a, i) =>
            staff ? (
              <StaffRow key={a.id} classId={classId} classBase={classBase} a={a} index={i} />
            ) : (
              <StudentRow key={a.id} classBase={classBase} a={a} index={i} />
            ),
          )}
        </div>
      )}

      {staff && (
        <button onClick={() => setShowArchived((v) => !v)} className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      )}

      {showArchived && staff && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-foreground">Archived</p>
          {archived.isLoading ? (
            <LoadingState label="Loading…" />
          ) : archivedRows.length === 0 ? (
            <EmptyState icon={Archive} title="Nothing archived" />
          ) : (
            <div className="divide-y divide-border border-y border-border">
              {archivedRows.map((a, i) => <StaffRow key={a.id} classId={classId} classBase={classBase} a={a} index={i} archived />)}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/** Shared row chrome: indigo-circle icon tile + title + status date (mockup order:
 *  icon · title · badge · date · actions). */
function RowShell({ classBase, a, index, staff, badge, actions }: { classBase: string; a: AsgRow; index: number; staff: boolean; badge?: React.ReactNode; actions?: React.ReactNode }) {
  const s = statusInfo(a, staff);
  const submitted = staff ? submittedLine(a) : null;
  return (
    <div className="cr-rowin group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2" style={{ animationDelay: `${Math.min(index, 14) * 40}ms` }}>
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ClipboardList className="h-5 w-5" aria-hidden />
      </span>
      <Link href={hrefFor(classBase, a)} className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-foreground transition-colors group-hover:text-primary">{a.title}</p>
        {submitted && (
          <p className="mt-0.5 text-xs text-muted-foreground">{submitted}</p>
        )}
      </Link>
      {badge}
      <span className={cn("shrink-0 whitespace-nowrap text-[13px] font-semibold", s.overdue ? "text-[#c0392b] dark:text-rose-400" : "text-muted-foreground")}>
        {s.text}
      </span>
      {actions}
    </div>
  );
}

function StudentRow({ classBase, a, index }: { classBase: string; a: AsgRow; index: number }) {
  return (
    <RowShell
      classBase={classBase}
      a={a}
      index={index}
      staff={false}
      badge={a.workflow_status ? <SubmissionStatusPill status={a.workflow_status} /> : null}
      actions={
        <Link
          href={hrefFor(classBase, a)}
          aria-label={`Open ${a.title}`}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <MoreVertical className="h-[18px] w-[18px]" />
        </Link>
      }
    />
  );
}

function StaffRow({ classId, classBase, a, index, archived }: { classId: number; classBase: string; a: AsgRow; index: number; archived?: boolean }) {
  return (
    <RowShell
      classBase={classBase}
      a={a}
      index={index}
      staff
      badge={
        a.status === "DRAFT" ? <Pill tone="neutral">Draft</Pill>
          : a.status === "ARCHIVED" ? <Pill tone="neutral">Archived</Pill>
          : null
      }
      actions={<AssignmentRowActions classId={classId} classBase={classBase} row={a} archived={archived} />}
    />
  );
}
