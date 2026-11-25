"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { useToast } from "@/components/ToastProvider";
import { useMe } from "@/hooks/useMe";
import api from "@/lib/api";
import { cn } from "@/lib/cn";
import { toast } from "@/features/console/toast";
import { Badge, Button, CourseTag, Menu, buttonClass, type MenuItem } from "@/features/console/ui";
import { FacetSelect, FilterText, QuickChips, facetCount, type QuickChip } from "@/features/ops/changelist/BoardFields";
import { ChangeList, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams, type ChangeListParams, type ChangeListPatch } from "@/features/ops/changelist/useChangeListParams";
import { withListFilters } from "@/features/ops/changelist/backLink";
import { P, holds } from "@/features/ops/permissions";
import {
  courseOf,
  daysText,
  groupLabel,
  groupLevel,
  lessonsProgress,
  percentText,
  priceText,
  shortDay,
  timeRange,
  type LessonsTone,
} from "@/features/ops/students/format";
import { CLASSROOM_FILTER_KEYS, classroomKeys, type ClassroomPage, type ClassroomRow } from "./classroomsApi";
import { CreateClassroomModal } from "./CreateClassroomModal";

/**
 * /ops/classrooms — lc-up calls them groups — in lc-up's list shape (canvas board "Groups", owner 22 Nov 2026): the
 * title with the count; Timetable and New group; the chips All / Math / English / Ends this week / Has demo
 * students; a filter card; the ruled table — #, the group with its size, demo seats and price, the time, the course
 * and room, the days, lessons done against the course's length, the start, a ⋮ menu. A row opens the group's page.
 * `?new=1` opens New group (the top bar's quick action). Data: `GET /classes/admin/classrooms/`
 * (classes/views_ops_classrooms.py, classes/ops_groups_list.py).
 */

export const SUBJECT_LABEL: Record<string, string> = { MATH: "Math", ENGLISH: "English" };
export const DAYS_LABEL: Record<string, string> = { ODD: "Odd days", EVEN: "Even days" };

/** "Odd days 14:00", whichever half is known. */
export function scheduleText(days: string, time: string): string {
  return [DAYS_LABEL[days] ?? days, time].filter(Boolean).join(" ") || "—";
}

/** A row of the Groups list: the changelist's class row and what the board adds (absent on an older server). */
export type GroupRow = ClassroomRow & {
  teacher_first_name?: string;
  teacher_last_name?: string;
  lesson_hours?: number | null;
  /** Whole so'm a month; null until someone states it. */
  monthly_price?: number | null;
  /** "YYYY-MM-DD": the course's first day (lc-up's `course_start_date`). */
  start_date?: string | null;
  /** Active seats marked "trial" (shown as demo): not in `students`. */
  trial?: number;
  /** Registers marked since the start against the course's lessons; null when the course's length is unknown. */
  lessons?: { done: number; total: number } | null;
};

type GroupPage = Omit<ClassroomPage, "results"> & { results: GroupRow[] };

/** The class filters plus the board's: course, room, the chips and the price typed. */
export const GROUP_FILTER_KEYS = [...CLASSROOM_FILTER_KEYS, "course", "room", "show", "price"] as const;

export function groupsQuery(params: ChangeListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of GROUP_FILTER_KEYS) {
    const value = params.filters[key];
    if (value) out[key] = value;
  }
  if (params.q) out.q = params.q;
  if (params.o) out.o = params.o;
  if (params.page > 1) out.page = params.page;
  out.page_size = params.pageSize;
  return out;
}

function useGroups(params: ChangeListParams) {
  const query = groupsQuery(params);
  return useQuery({
    queryKey: classroomKeys.list(query),
    queryFn: async () => (await api.get<GroupPage>("/classes/admin/classrooms/", { params: query })).data,
    placeholderData: keepPreviousData,
  });
}

/** lc-up's progress colours: blue, amber from half, red from three quarters, near-black past the plan. */
const TONE: Record<LessonsTone, { bar: string; text: string }> = {
  early: { bar: "bg-ms-info", text: "text-ms-info-fg" },
  half: { bar: "bg-ms-attention", text: "text-ms-attention-fg" },
  late: { bar: "bg-ms-critical", text: "text-ms-critical-fg" },
  past: { bar: "bg-ms-fg", text: "text-ms-fg" },
};

function LessonsDone({ done, total }: { done: number; total: number }) {
  const { percent, tone, flag } = lessonsProgress(done, total);
  const look = TONE[tone];
  return (
    <span className="flex items-center gap-2.5" data-lessons-tone={tone}>
      <span role="img" aria-label={`${done} of ${total} lessons`} className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-ms-surface-2">
        <span className={cn("block h-full", look.bar)} style={{ width: `${Math.min(100, percent)}%` }} />
      </span>
      <span className={cn("min-w-16 font-bold tabular-nums", look.text)}>
        {done} · {percentText(percent)}
      </span>
      {flag ? <Badge tone="attention">{flag}</Badge> : null}
    </span>
  );
}

function teacherSurname(r: GroupRow): string {
  return r.teacher_last_name || r.teacher?.name.split(" ").slice(-1)[0] || "";
}

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
  const { me } = useMe();
  const canCreate = Boolean(me) && holds(me, P.manageGroups);
  const sms = Boolean(me) && holds(me, P.sendSms);
  const search = useSearchParams();
  const { params, queryString, hrefFor, update } = useChangeListParams(GROUP_FILTER_KEYS);
  const query = useGroups(params);
  const filters = query.data?.filters;
  const facet = (key: string) => filters?.find((f) => f.key === key);
  const [creating, setCreating] = useState(false);

  // `?new=1` (the top bar's "New group"): opens the form for whoever may create a group, once `me` is known; the
  // address forgets it when the form closes. Anyone else simply lands on the list.
  const asksNew = search.get("new") === "1";
  useEffect(() => {
    if (!asksNew || !me) return;
    if (holds(me, P.manageGroups)) setCreating(true);
    else update({ new: null }, true);
    // `update` changes with the address; this answers the parameter once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asksNew, me]);
  const closeCreate = () => {
    setCreating(false);
    if (asksNew) update({ new: null }, true);
  };

  const active = params.filters;
  const show = active.show && active.show !== "all" ? active.show : null;
  const subject = active.subject ?? null;
  const narrowed = Boolean(params.q) || Object.keys(active).some((k) => !(k === "show" && active[k] === "all"));
  const pick = (key: string) => (value: string | null) => update({ [key]: value });
  const clear = () => {
    const before: ChangeListPatch = { q: params.q || null, ...active };
    update(Object.fromEntries([...GROUP_FILTER_KEYS, "q"].map((k) => [k, null])));
    toast.show({ icon: "filter", message: "Cleared the filters", undo: () => update(before) });
  };

  // Math / English is the subject; the last two are the board's own; All clears both.
  const chips: QuickChip[] = [
    {
      key: "all",
      label: "All",
      count: facetCount(filters, "show", "all"),
      on: !subject && !show,
      href: hrefFor({ subject: null, show: null }),
      onPick: () => update({ subject: null, show: null }),
    },
    ...(["MATH", "ENGLISH"] as const).map((s) => ({
      key: s,
      label: SUBJECT_LABEL[s],
      count: filters ? (facetCount(filters, "subject", s) ?? 0) : undefined,
      on: subject === s,
      href: hrefFor({ subject: subject === s ? null : s }),
      onPick: () => update({ subject: subject === s ? null : s }),
    })),
    ...(
      [
        ["ends", "Ends this week", "var(--ms-attention)"],
        ["trial", "Has demo students", "var(--ms-attention)"],
      ] as const
    ).map(([value, label, dot]) => ({
      key: value,
      label,
      count: facetCount(filters, "show", value),
      on: show === value,
      href: hrefFor({ show: show === value ? null : value }),
      onPick: () => update({ show: show === value ? null : value }),
      dot,
    })),
  ];

  const fields = (
    <>
      <FilterText value={params.q} placeholder="Group name" icon="search" onCommit={(q) => update({ q })} />
      <FacetSelect filter={facet("course")} label="Course" selected={active.course ?? null} onPick={pick("course")} />
      <FacetSelect filter={facet("teacher")} label="Teacher" selected={active.teacher ?? null} onPick={pick("teacher")} />
      <FacetSelect filter={facet("room")} label="Room" selected={active.room ?? null} onPick={pick("room")} />
      <FilterText value={active.price ?? ""} placeholder="Price, so’m" inputMode="numeric" onCommit={pick("price")} />
      <FacetSelect
        filter={facet("days")}
        label="Day"
        anyLabel="Any day"
        selected={active.days ?? null}
        onPick={pick("days")}
        optionLabel={(v, l) => daysText(v) || l}
      />
    </>
  );

  // The list's other filters (before the board): kept, after the board's own.
  const moreKeys = ["status", "branch", "lcup"];
  const moreFields = (
    <>
      <FacetSelect filter={facet("status")} label="Status" anyLabel="Active or archived" selected={active.status ?? null} onPick={pick("status")} />
      <FacetSelect filter={facet("branch")} label="Branch" selected={active.branch ?? null} onPick={pick("branch")} />
      <FacetSelect filter={facet("lcup")} label="lc-up" anyLabel="Paired or not" selected={active.lcup ?? null} onPick={pick("lcup")} />
    </>
  );

  const columns: ChangeListColumn<GroupRow>[] = [
    {
      key: "name",
      label: "Group",
      sortKey: "name",
      render: (r) => groupLabel(r.name, r.subject, teacherSurname(r)),
      renderLinked: (r, link) => (
        <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
          <span className="flex flex-wrap items-center gap-1.5">
            {link(groupLabel(r.name, r.subject, teacherSurname(r)))}
            <span title="Students in the group">
              <Badge tone="line" className="tabular-nums">
                {r.students}
              </Badge>
            </span>
            {r.trial ? (
              <span title="On a demo lesson, not counted as students">
                <Badge tone="attention" className="tabular-nums">
                  +{r.trial} demo
                </Badge>
              </span>
            ) : null}
            {r.is_active ? null : <Badge tone="neutral">Archived</Badge>}
          </span>
          {r.monthly_price !== null && r.monthly_price !== undefined ? (
            <span className="text-[13px] text-ms-fg-3">{priceText(r.monthly_price)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "time",
      label: "Time",
      render: (r) => {
        const t = timeRange(r.lesson_time, r.lesson_hours);
        return t ? <span className="tabular-nums">{t}</span> : <span className="text-ms-fg-3">—</span>;
      },
    },
    {
      key: "course",
      label: "Course · room",
      render: (r) => {
        const course = courseOf(r.level, r.name, r.subject);
        return (
          <span className="inline-flex items-center gap-1.5">
            {course ? <CourseTag level={groupLevel(r.level, r.name)}>{course}</CourseTag> : <span className="text-ms-fg-3">—</span>}
            {r.room_number ? <span className="text-[13px] text-ms-fg-3">Room {r.room_number}</span> : null}
          </span>
        );
      },
    },
    {
      key: "days",
      label: "Days",
      render: (r) => {
        const days = daysText(r.lesson_days).split(" ").filter(Boolean);
        return days.length ? (
          <span className="flex gap-1">
            {days.map((d) => (
              <Badge key={d} tone="line" className="h-[22px] px-[7px] text-[12px]">
                {d}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-ms-fg-3">—</span>
        );
      },
    },
    {
      key: "lessons",
      label: "Lessons done",
      render: (r) => (r.lessons ? <LessonsDone done={r.lessons.done} total={r.lessons.total} /> : <span className="text-ms-fg-3">—</span>),
    },
    {
      key: "started",
      label: "Started",
      render: (r) =>
        r.start_date ? <span className="tabular-nums text-ms-fg-2">{shortDay(r.start_date)}</span> : <span className="text-ms-fg-3">—</span>,
    },
    {
      key: "actions",
      label: "Actions",
      hideLabel: true,
      interactive: true,
      className: "w-px",
      render: (r) => {
        const items: MenuItem[] = [
          { label: "Open group", icon: "layers", href: withListFilters(`/ops/classrooms/${r.id}`, queryString) },
          ...(sms ? [{ label: "Message the group", icon: "msg" as const, href: `/ops/sms/campaigns/new?classroom=${r.id}` }] : []),
          { label: "Timetable", icon: "cal", href: "/ops/timetable" },
        ];
        return <Menu label={`Actions for ${r.name}`} items={items} />;
      },
    },
  ];

  return (
    <>
      <ChangeList<GroupRow>
        title="Groups"
        noun={{ singular: "group", plural: "groups" }}
        columns={columns}
        data={query.data}
        loading={query.isPending}
        error={query.isError}
        fetching={query.isFetching && query.isPlaceholderData}
        onRetry={() => void query.refetch()}
        filterKeys={GROUP_FILTER_KEYS}
        rowHref={(row) => withListFilters(`/ops/classrooms/${row.id}`, queryString)}
        rowLabel={(row) => row.name}
        headerAction={
          <>
            <Link href="/ops/timetable" className={buttonClass({ variant: "secondary", size: "sm" })}>
              Timetable
            </Link>
            {canCreate ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New group
              </Button>
            ) : null}
          </>
        }
        board={{
          chips: <QuickChips label="Show" chips={chips} />,
          filters: fields,
          moreFilters: moreFields,
          moreActive: moreKeys.filter((k) => active[k]).length,
          narrowed,
          onClear: clear,
          numbered: true,
          minWidthClass: "min-w-[1080px]",
          errorTitle: "Could not load groups.",
          emptyTitle: narrowed ? "No group matches these filters" : "No groups yet",
          emptyDetail: narrowed ? "Remove a filter, or clear them all." : undefined,
        }}
      />

      {creating ? (
        <CreateClassroomModal
          onClose={closeCreate}
          onCreated={(id, notice) => {
            closeCreate();
            push({ tone: "success", message: notice });
            void queryClient.invalidateQueries({ queryKey: classroomKeys.all });
            if (id !== null) router.push(`/ops/classrooms/${id}`);
          }}
        />
      ) : null}
    </>
  );
}
