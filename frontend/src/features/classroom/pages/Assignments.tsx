"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Plus, MoreVertical, Eye, Archive, RotateCcw, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { classesApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Button, Pill, LoadingState, ErrorState, EmptyState, ConfirmDialog } from "../ui";
import { useAssignments } from "../hooks";
import { useAssignmentLifecycle } from "../homeworkHooks";
import { classroomKeys } from "../queryKeys";
import { capabilitiesFor } from "../capabilities";
import { spawnRipple } from "../ui/ripple";
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
  submissions_count?: number;
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

  const rows = (data?.items ?? []) as AsgRow[];
  const archivedRows = ((Array.isArray(archived.data) ? archived.data : archived.data?.items ?? []) as AsgRow[])
    .filter((a) => a.status === "ARCHIVED");

  return (
    <div className="cr-section space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Assignments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {staff ? "Homework, practice tests, and classwork" : "Your work for this class"}
          </p>
        </div>
        {staff && (
          <Link href={newHref}>
            <Button className="cr-ripple" onPointerDown={spawnRipple} icon={Plus}>New</Button>
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
  return (
    <div className="cr-rowin group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2" style={{ animationDelay: `${Math.min(index, 14) * 40}ms` }}>
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ClipboardList className="h-5 w-5" aria-hidden />
      </span>
      <Link href={hrefFor(classBase, a)} className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-foreground transition-colors group-hover:text-primary">{a.title}</p>
        {staff && typeof a.submissions_count === "number" && a.submissions_count > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">{a.submissions_count} submitted</p>
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
  const qc = useQueryClient();
  const lc = useAssignmentLifecycle(classId, a.id);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const del = useMutation({
    mutationFn: () => classesApi.deleteAssignment(classId, a.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
      pushGlobalToast({ tone: "success", message: `“${a.title}” deleted.` });
      setConfirmDelete(false);
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  async function run(m: { mutateAsync: () => Promise<unknown> }, ok: string) {
    try {
      await m.mutateAsync();
      pushGlobalToast({ tone: "success", message: ok });
      setConfirmArchive(false);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
  }

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
      actions={
        <>
          <KebabMenu>
            <MenuItem icon={ExternalLink} href={hrefFor(classBase, a)}>Open</MenuItem>
            <MenuItem icon={Pencil} href={`${classBase}/assignments/${a.id}/edit`}>Edit</MenuItem>
            {a.status === "DRAFT" && (
              <MenuItem icon={Eye} onClick={() => run(lc.publish, `“${a.title}” published.`)}>Publish</MenuItem>
            )}
            {a.status === "PUBLISHED" && (
              <MenuItem icon={Archive} onClick={() => setConfirmArchive(true)}>Archive</MenuItem>
            )}
            {(a.status === "ARCHIVED" || archived) && (
              <MenuItem icon={RotateCcw} onClick={() => run(lc.unarchive, `“${a.title}” unarchived.`)}>Unarchive</MenuItem>
            )}
            <MenuItem icon={Trash2} destructive onClick={() => setConfirmDelete(true)}>Delete</MenuItem>
          </KebabMenu>

          <ConfirmDialog
            open={confirmArchive}
            title="Archive assignment?"
            description={`“${a.title}” will be hidden from students. Existing grades are kept and you can unarchive it later.`}
            confirmLabel="Archive"
            tone="danger"
            loading={lc.archive.isPending}
            onConfirm={() => run(lc.archive, `“${a.title}” archived.`)}
            onCancel={() => setConfirmArchive(false)}
          />

          <ConfirmDialog
            open={confirmDelete}
            title="Delete assignment?"
            description={`“${a.title}” will be permanently deleted, along with any student submissions and grades. This cannot be undone.`}
            confirmLabel="Delete"
            tone="danger"
            loading={del.isPending}
            onConfirm={() => del.mutate()}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      }
    />
  );
}

/** Minimal kebab dropdown (click-away via a transparent overlay). */
function KebabMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Actions"
        aria-expanded={open}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <MoreVertical className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-[var(--ds-shadow-lg)]"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, onClick, href, destructive, children }: { icon: React.ElementType; onClick?: () => void; href?: string; destructive?: boolean; children: React.ReactNode }) {
  const cls = destructive
    ? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
    : "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-surface-2";
  const iconCls = destructive ? "h-4 w-4 text-red-500" : "h-4 w-4 text-muted-foreground";
  const body = (<><Icon className={iconCls} aria-hidden />{children}</>);
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}
