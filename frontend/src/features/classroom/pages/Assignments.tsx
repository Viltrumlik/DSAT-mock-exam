"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardList, Plus, CalendarClock, Eye, Archive, RotateCcw } from "lucide-react";
import CreateAssignmentModal from "@/components/CreateAssignmentModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Card, CardHeader, Button, Pill, LoadingState, ErrorState, EmptyState, ConfirmDialog } from "../ui";
import { useAssignments } from "../hooks";
import { useAssignmentLifecycle } from "../homeworkHooks";
import { classroomKeys } from "../queryKeys";
import { capabilitiesFor } from "../capabilities";
import { SubmissionStatusPill } from "./statusPill";
import type { ClassroomWithRole } from "../types";

interface AsgRow {
  id: number;
  title: string;
  due_at?: string | null;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  workflow_status?: string | null;
  assessment_homework?: unknown | null;
  submissions_count?: number;
}

function dueLabel(due?: string | null): string {
  if (!due) return "No deadline";
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? "No deadline" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function hrefFor(classId: number, a: AsgRow): string {
  // Always open the in-class assignment detail page so the student sees instructions and every
  // attached activity (a homework may bundle a past paper, an assessment and a file). The detail
  // page deep-links into each one (incl. "Start assessment"). Do NOT jump straight into the
  // assessment runner, which would hide the other contents.
  return `/classes/${classId}/assignments/${a.id}`;
}

export function Assignments({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useAssignments(classId);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const archived = useQuery({
    queryKey: [...classroomKeys.assignments(classId), "archived"],
    queryFn: async () => (await api.get(`/classes/${classId}/assignments/?include_archived=1`)).data,
    enabled: showArchived && caps.canManageAssignments,
  });

  const rows = (data?.items ?? []) as AsgRow[];
  const archivedRows = ((Array.isArray(archived.data) ? archived.data : archived.data?.items ?? []) as AsgRow[])
    .filter((a) => a.status === "ARCHIVED");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Assignments"
          description={caps.isStaff ? "Homework, practice tests, and classwork" : "Your work for this class"}
          actions={
            caps.canManageAssignments && (
              <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>New</Button>
            )
          }
        />
        <div className="mt-4 space-y-2">
          {isLoading ? (
            <LoadingState label="Loading assignments…" />
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No assignments yet"
              description={caps.canManageAssignments ? "Create the first assignment for this class." : "New assignments will appear here."}
              action={caps.canManageAssignments && <Button icon={Plus} onClick={() => setCreateOpen(true)}>New assignment</Button>}
            />
          ) : caps.canManageAssignments ? (
            rows.map((a) => <StaffRow key={a.id} classId={classId} a={a} />)
          ) : (
            rows.map((a) => (
              <Link key={a.id} href={hrefFor(classId, a)}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-surface-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> {dueLabel(a.due_at)}
                  </p>
                </div>
                <SubmissionStatusPill status={a.workflow_status} />
              </Link>
            ))
          )}
        </div>

        {caps.canManageAssignments && (
          <button onClick={() => setShowArchived((v) => !v)} className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground">
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        )}
      </Card>

      {showArchived && caps.canManageAssignments && (
        <Card>
          <CardHeader title="Archived" description="Retired assignments — grades kept, hidden from students" />
          <div className="mt-4 space-y-2">
            {archived.isLoading ? <LoadingState label="Loading…" />
              : archivedRows.length === 0 ? <EmptyState icon={Archive} title="Nothing archived" />
              : archivedRows.map((a) => <StaffRow key={a.id} classId={classId} a={a} archived />)}
          </div>
        </Card>
      )}

      {caps.canManageAssignments && (
        <CreateAssignmentModal
          open={createOpen}
          classId={classId}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
          }}
        />
      )}
    </div>
  );
}

function StaffRow({ classId, a, archived }: { classId: number; a: AsgRow; archived?: boolean }) {
  const lc = useAssignmentLifecycle(classId, a.id);
  const [confirmArchive, setConfirmArchive] = useState(false);

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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
      <Link href={hrefFor(classId, a)} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground hover:underline">{a.title}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" /> {dueLabel(a.due_at)}
          {typeof a.submissions_count === "number" && <span>· {a.submissions_count} submitted</span>}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {a.status === "DRAFT" && <Pill tone="neutral">Draft</Pill>}
        {a.status === "ARCHIVED" && <Pill tone="neutral">Archived</Pill>}
        {a.status === "DRAFT" && (
          <Button size="sm" variant="secondary" icon={Eye} loading={lc.publish.isPending} onClick={() => run(lc.publish, `“${a.title}” published.`)}>Publish</Button>
        )}
        {a.status === "PUBLISHED" && (
          <Button size="sm" variant="ghost" icon={Archive} loading={lc.archive.isPending} onClick={() => setConfirmArchive(true)}>Archive</Button>
        )}
        {(a.status === "ARCHIVED" || archived) && (
          <Button size="sm" variant="secondary" icon={RotateCcw} loading={lc.unarchive.isPending} onClick={() => run(lc.unarchive, `“${a.title}” unarchived.`)}>Unarchive</Button>
        )}
      </div>

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
    </div>
  );
}
