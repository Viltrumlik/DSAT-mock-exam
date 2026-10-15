"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ToastProvider";
import { levelLabel } from "@/lib/levels";
import { ChangeList, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { withListFilters } from "@/features/ops/changelist/backLink";
import { Truncated } from "@/features/ops/users/peopleColumns";
import { CLASSROOM_FILTER_KEYS, classroomKeys, useClassrooms, type ClassroomRow } from "./classroomsApi";
import { CreateClassroomModal } from "./CreateClassroomModal";

/**
 * /ops Classrooms as a Django-admin changelist, like the people lists: search, filters with a count
 * beside every choice, sortable columns, pages. A row opens the class's change form, which is where
 * its details, staff and students are edited now.
 */

export const SUBJECT_LABEL: Record<string, string> = { MATH: "Math", ENGLISH: "English" };
export const DAYS_LABEL: Record<string, string> = { ODD: "Odd days", EVEN: "Even days" };

/** "Odd days 14:00", whichever half is known. */
export function scheduleText(days: string, time: string): string {
  return [DAYS_LABEL[days] ?? days, time].filter(Boolean).join(" ") || "—";
}

const COLUMNS: ChangeListColumn<ClassroomRow>[] = [
  {
    key: "name",
    label: "Name",
    sortKey: "name",
    render: (r) => <span className="block max-w-[16rem] truncate">{r.name}</span>,
  },
  { key: "subject", label: "Subject", render: (r) => SUBJECT_LABEL[r.subject] ?? r.subject },
  {
    key: "level",
    label: "Level",
    render: (r) => (r.level ? levelLabel(r.level as never) : <span className="text-muted-foreground">—</span>),
  },
  { key: "teacher", label: "Teacher", render: (r) => <Truncated text={r.teacher?.name ?? ""} /> },
  {
    key: "students",
    label: "Students",
    sortKey: "students",
    className: "text-right",
    render: (r) => <span className="tabular-nums">{r.students}</span>,
  },
  {
    key: "schedule",
    label: "Schedule",
    render: (r) => <span className="text-muted-foreground">{scheduleText(r.lesson_days, r.lesson_time)}</span>,
  },
  { key: "room", label: "Room", render: (r) => r.room_number || <span className="text-muted-foreground">—</span> },
  {
    key: "lcup",
    label: "lc-up",
    render: (r) =>
      r.lcup ? (
        <span title="Paired with an lc-up group">Yes</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "status",
    label: "Status",
    render: (r) => (
      <span className={r.is_active ? "text-muted-foreground" : "text-foreground"}>
        {r.is_active ? "Active" : "Archived"}
      </span>
    ),
  },
];

export function ClassroomList() {
  // useSearchParams needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <ClassroomListInner />
    </Suspense>
  );
}

function ClassroomListInner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { params, queryString } = useChangeListParams(CLASSROOM_FILTER_KEYS);
  const query = useClassrooms(params);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <ChangeList<ClassroomRow>
        title="Classrooms"
        noun={{ singular: "class", plural: "classes" }}
        columns={COLUMNS}
        data={query.data}
        loading={query.isPending}
        error={query.isError}
        fetching={query.isFetching && query.isPlaceholderData}
        onRetry={() => void query.refetch()}
        filterKeys={CLASSROOM_FILTER_KEYS}
        rowHref={(row) => withListFilters(`/ops/classrooms/${row.id}`, queryString)}
        searchPlaceholder="Search class, room or teacher"
        rowLabel={(row) => row.name}
        headerAction={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Add classroom
          </button>
        }
      />

      {creating ? (
        <CreateClassroomModal
          onClose={() => setCreating(false)}
          onCreated={(id, notice) => {
            setCreating(false);
            push({ tone: "success", message: notice });
            void queryClient.invalidateQueries({ queryKey: classroomKeys.all });
            if (id !== null) router.push(`/ops/classrooms/${id}`);
          }}
        />
      ) : null}
    </>
  );
}
