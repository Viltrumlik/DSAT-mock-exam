"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  UsersRound,
} from "lucide-react";
import { classesApi } from "@/lib/api";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { listHrefFrom } from "@/features/ops/changelist/backLink";
import { peopleKeys } from "@/features/ops/changelist/peopleApi";
import { activeTab, panelId, TabBar, tabHref, tabId, type Tab } from "@/features/ops/detail/tabs";
import { ConfirmDialog } from "@/features/ops/people/ConfirmDialog";
import { Fieldset, LINK_CLASS, Row } from "@/features/ops/people/Fieldset";
import { formatDay } from "@/features/ops/people/format";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { ClassHeader } from "./ClassHeader";
import { ClassroomForm } from "./ClassroomForm";
import { classroomKeys, isNotFound, serverReason, useClassroom, type ClassroomCore } from "./classroomsApi";
import { ClassAttendanceSection, ClassHistorySection, ClassHomeworkSection } from "./sections/ClassParts";
import { StaffSection } from "./sections/StaffSection";
import { StudentsSection } from "./sections/StudentsSection";

/**
 * One class's change form, in the same tabs and with the same header as a person's: the Overview
 * (its details beside a read-only Summary, the class's figures above), then Students, Staff,
 * Attendance, Homework and History, each fetched when its tab opens. A class that follows an lc-up
 * group shows lc-up's fields locked, offers no student add or remove, no teacher change, no archive
 * and no delete — lc-up owns those.
 */

type ClassTab = "overview" | "students" | "staff" | "attendance" | "homework" | "history";

const TABS: Tab<ClassTab>[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "students", label: "Students", icon: Users },
  { key: "staff", label: "Staff", icon: UserCog },
  { key: "attendance", label: "Attendance", icon: CalendarCheck },
  { key: "homework", label: "Homework", icon: BookCheck },
  { key: "history", label: "History", icon: History },
];

/**
 * The Overview's read-only side: what the form does not edit and the header does not already say —
 * the lc-up pairing, the support teachers, the join code, Telegram, the lessons' length and dates.
 */
function ClassSummary({ room }: { room: ClassroomCore }) {
  return (
    <Fieldset title="Summary" icon={Info} tone="accent" description="The class at a glance">
      <Row label="lc-up group" icon={Link2}>
        {/* Plain text, not a pill: lc-up's group names run to two lines. */}
        {!room.lcup ? (
          <Badge variant="outline">Not paired</Badge>
        ) : room.lcup.managed ? (
          room.lcup.group_name
        ) : (
          <>
            {room.lcup.group_name}
            <span className="mt-1 block">
              <Badge variant="warning">Not followed</Badge>
            </span>
          </>
        )}
      </Row>
      {/* An unpaired class's header already counts its support teachers in the fourth figure. */}
      {room.lcup ? (
        <Row label="Support teachers" icon={UsersRound}>
          {room.tas.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <span className="inline-flex flex-wrap justify-end gap-x-2 gap-y-1">
              {room.tas.map((t) => (
                <Link key={t.id} href={`/ops/staff/${t.id}`} prefetch={false} className={LINK_CLASS}>
                  {t.name}
                </Link>
              ))}
            </span>
          )}
        </Row>
      ) : null}
      <Row label="Lesson length" icon={Clock}>
        {room.lesson_hours == null ? "—" : `${room.lesson_hours} h`}
      </Row>
      <Row label="Started" icon={CalendarDays}>
        {formatDay(room.start_date)}
      </Row>
      <Row label="Join code" icon={KeyRound}>
        {room.join_code ? (
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-sm tracking-wider">{room.join_code}</span>
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
          <Badge variant="success">Group attached</Badge>
        ) : (
          <Badge variant="outline">Not linked</Badge>
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
  }, [room]);

  if (query.isPending) return <p className="p-4 text-sm text-muted-foreground md:p-6">Loading…</p>;
  if (query.isError || !room) {
    const missing = isNotFound(query.error);
    return (
      <div className="space-y-2 p-4 text-sm md:p-6">
        <p className="text-muted-foreground">{missing ? "This class does not exist." : "Could not load this class."}</p>
        <p className="flex gap-3">
          {missing ? null : (
            <button
              type="button"
              className="font-medium text-primary hover:underline dark:text-primary-hover"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          )}
          <Link href={backHref} className="text-primary hover:underline dark:text-primary-hover">
            Back to Classrooms
          </Link>
        </p>
      </div>
    );
  }

  const tab = activeTab(search, TABS);
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
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Classrooms
      </Link>

      <ClassHeader
        room={room}
        glance={tab === "overview"}
        busy={busy}
        onToggleActive={() => void setActive(!room.is_active)}
        onDelete={() => setConfirmDelete(true)}
      />

      <TabBar scope="class" label="Class sections" tabs={TABS} active={tab} onSelect={openTab} />

      {/* Only the open tab is rendered, so only its part is fetched. */}
      <div role="tabpanel" id={panelId("class", tab)} aria-labelledby={tabId("class", tab)} className="min-w-0">
        {tab === "overview" ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <ClassroomForm key={room.id} room={room} onSaved={refresh} />
            <ClassSummary room={room} />
          </div>
        ) : null}
        {tab === "students" ? <StudentsSection room={room} onChanged={refresh} /> : null}
        {tab === "staff" ? <StaffSection room={room} onChanged={refresh} /> : null}
        {tab === "attendance" ? <ClassAttendanceSection id={id} /> : null}
        {tab === "homework" ? <ClassHomeworkSection id={id} /> : null}
        {tab === "history" ? <ClassHistorySection id={id} /> : null}
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
