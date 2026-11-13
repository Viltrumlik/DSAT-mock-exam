"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { recordRecent } from "@/features/console/recent";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookCheck,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  Clock,
  History,
  Info,
  KeyRound,
  LayoutGrid,
  Link2,
  Send,
  UserCog,
  Users,
} from "lucide-react";
import { classesApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { listHrefFrom } from "@/features/ops/changelist/backLink";
import { peopleKeys } from "@/features/ops/changelist/peopleApi";
import { activeTab, panelId, tabHref, tabId, type Tab } from "@/features/ops/detail/tabs";
import { Tabs } from "@/features/console/ui";
import { P, holds } from "@/features/ops/permissions";
import { useMe } from "@/hooks/useMe";
import { ConfirmDialog } from "@/features/ops/people/ConfirmDialog";
import { Fieldset, LINK_CLASS, Pill, Row } from "@/features/ops/people/Fieldset";
import { formatDay } from "@/features/ops/people/format";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { ClassHeader } from "./ClassHeader";
import { ClassroomForm } from "./ClassroomForm";
import { classroomKeys, isNotFound, serverReason, useClassroom, type ClassroomCore } from "./classroomsApi";
import { ClassAttendanceSection, ClassHistorySection, ClassHomeworkSection } from "./sections/ClassParts";
import { StaffSection } from "./sections/StaffSection";
import { StudentsSection } from "./sections/StudentsSection";
import { TelegramSection } from "./sections/TelegramSection";

/**
 * One class's change form, in the same tabs and with the same header as a person's: the Overview
 * (its details beside a read-only Summary, the class's figures above), then Students, Staff,
 * Attendance, Homework, History and Telegram, each fetched when its tab opens. A class that follows an lc-up
 * group shows lc-up's fields locked, offers no student add or remove, no teacher change, no archive
 * and no delete — lc-up owns those.
 */

type ClassTab = "overview" | "students" | "staff" | "attendance" | "homework" | "history" | "telegram";

const TABS: Tab<ClassTab>[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "students", label: "Students", icon: Users },
  { key: "staff", label: "Staff", icon: UserCog },
  { key: "attendance", label: "Attendance", icon: CalendarCheck },
  { key: "homework", label: "Homework", icon: BookCheck },
  { key: "history", label: "History", icon: History },
  { key: "telegram", label: "Telegram", icon: Send },
];

/** What a tab holds, said on the tab when worth knowing before opening (Controls board · Tabs). */
export function classTabCounts(room: ClassroomCore): Partial<Record<ClassTab, { count: number | string; tone?: "critical" | "attention" }>> {
  const out: Partial<Record<ClassTab, { count: number | string; tone?: "critical" | "attention" }>> = {};
  if (room.students) out.students = { count: room.students };
  const rate = room.glance.attendance_rate;
  if (rate != null) out.attendance = { count: `${Math.round(rate)}%`, tone: rate < 60 ? "critical" : rate < 85 ? "attention" : undefined };
  if (room.glance.homework.assignments) out.homework = { count: room.glance.homework.assignments };
  return out;
}

/**
 * The Overview's read-only side: what the form does not edit and the header does not already say —
 * the lc-up pairing, the join code, Telegram, the lessons' length and dates (the header names the teachers).
 */
function ClassSummary({ room }: { room: ClassroomCore }) {
  return (
    <Fieldset title="Summary" icon={Info} tone="accent" description="The class at a glance">
      <Row label="lc-up group" icon={Link2}>
        {/* Plain text, not a pill: lc-up's group names run to two lines. */}
        {!room.lcup ? (
          <Pill tone="line">Not paired</Pill>
        ) : room.lcup.managed ? (
          room.lcup.group_name
        ) : (
          <>
            {room.lcup.group_name}
            <span className="mt-1 block">
              <Pill tone="attention">Not followed</Pill>
            </span>
          </>
        )}
      </Row>
      <Row label="Lesson length" icon={Clock}>
        {room.lesson_hours == null ? "—" : `${room.lesson_hours} h`}
      </Row>
      <Row label="Started" icon={CalendarDays}>
        {formatDay(room.start_date)}
      </Row>
      <Row label="Join code" icon={KeyRound}>
        {room.join_code ? (
          <span className="rounded-[8px] bg-ms-surface-2 px-2 py-0.5 font-ms-mono text-[14px] tracking-wider">{room.join_code}</span>
        ) : (
          "—"
        )}
      </Row>
      <Row label="Telegram" icon={Send}>
        {room.telegram_group_url ? (
          <a href={room.telegram_group_url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Group link
          </a>
        ) : room.telegram_chat_id ? (
          <Pill tone="positive">Group attached</Pill>
        ) : (
          <Pill tone="line">Not linked</Pill>
        )}
      </Row>
      <Row label="Created" icon={CalendarPlus}>
        {formatDate(room.created_at)}
      </Row>
    </Fieldset>
  );
}

export function ClassroomPage({ id }: { id: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { me } = useMe();
  const canMessage = holds(me, P.sendSms);
  const canManage = holds(me, P.manageGroups);
  const query = useClassroom(id);
  const room = query.data;
  const backHref = listHrefFrom(search, "/ops/classrooms");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: classroomKeys.all });
    // Seats move people between sections and change their groups.
    void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
  };

  useEffect(() => {
    if (room) document.title = `${room.name} · Classrooms`;
    // Today's "Recently opened" (this browser only).
    if (room) recordRecent({ kind: "class", id: room.id, name: room.name, href: `/ops/classrooms/${room.id}` });
  }, [room]);

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6" aria-busy>
        <span className="sr-only">Loading…</span>
        <div className="h-44 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
        <div className="h-64 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
      </div>
    );
  }
  if (query.isError || !room) {
    const missing = isNotFound(query.error);
    return (
      <div className="mx-auto w-full max-w-6xl space-y-2 p-4 text-sm md:p-6">
        <p className="text-ms-fg-3">{missing ? "This class does not exist." : "Could not load this class."}</p>
        <p className="flex gap-3">
          {missing ? null : (
            <button type="button" className={LINK_CLASS} onClick={() => void query.refetch()}>
              Retry
            </button>
          )}
          <Link href={backHref} className={LINK_CLASS}>
            Back to Classrooms
          </Link>
        </p>
      </div>
    );
  }

  const tab = activeTab(search, TABS);
  const counts = classTabCounts(room);
  const openTab = (key: ClassTab) =>
    router.replace(tabHref(`/ops/classrooms/${id}`, new URLSearchParams(search.toString()), key, "overview"), {
      scroll: false,
    });

  const setActive = async (isActive: boolean) => {
    setBusy(true);
    try {
      await classesApi.governanceUpdate(id, { is_active: isActive });
      push({ tone: "success", message: isActive ? `${room.name} is active again.` : `${room.name} archived.` });
      refresh();
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "That did not go through. Try again.") });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await classesApi.governanceDelete(id);
      push({ tone: "success", message: `Deleted ${room.name}.` });
      void queryClient.invalidateQueries({ queryKey: classroomKeys.all });
      router.push(backHref);
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "Could not delete the class.") });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-ms-fg-3 hover:text-ms-fg"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Classrooms
      </Link>

      <ClassHeader
        room={room}
        busy={busy}
        canMessage={canMessage}
        canManage={canManage}
        onToggleActive={() => void setActive(!room.is_active)}
        onDelete={() => setConfirmDelete(true)}
      >
        <Tabs<ClassTab>
          label="Class sections"
          value={tab}
          onChange={openTab}
          ids={{ tab: (key) => tabId("class", key), panel: (key) => panelId("class", key) }}
          tabs={TABS.map((t) => ({ id: t.key, label: t.label, count: counts[t.key]?.count, tone: counts[t.key]?.tone }))}
        />
      </ClassHeader>

      {/* Only the open tab is rendered, so only its part is fetched. */}
      <div role="tabpanel" id={panelId("class", tab)} aria-labelledby={tabId("class", tab)} className="min-w-0">
        {tab === "overview" ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <ClassroomForm key={room.id} room={room} onSaved={refresh} />
            <ClassSummary room={room} />
          </div>
        ) : null}
        {tab === "students" ? <StudentsSection room={room} onChanged={refresh} /> : null}
        {tab === "staff" ? <StaffSection room={room} onChanged={refresh} canManage={canManage} /> : null}
        {tab === "attendance" ? <ClassAttendanceSection id={id} /> : null}
        {tab === "homework" ? <ClassHomeworkSection id={id} /> : null}
        {tab === "history" ? <ClassHistorySection id={id} /> : null}
        {tab === "telegram" ? <TelegramSection id={id} /> : null}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete ${room.name}?`}
          body="The class and its seats are deleted. This cannot be undone — archive it instead to keep its history."
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => (busy ? undefined : setConfirmDelete(false))}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}
