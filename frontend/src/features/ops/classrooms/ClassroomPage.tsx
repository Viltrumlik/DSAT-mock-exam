"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { levelLabel } from "@/lib/levels";
import { listHrefFrom } from "@/features/ops/changelist/backLink";
import { peopleKeys } from "@/features/ops/changelist/peopleApi";
import { activeTab, panelId, TabBar, tabHref, tabId, type Tab } from "@/features/ops/detail/tabs";
import { ConfirmDialog } from "@/features/ops/people/ConfirmDialog";
import { Fieldset, LINK_CLASS, Row } from "@/features/ops/people/Fieldset";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { ClassroomForm } from "./ClassroomForm";
import { scheduleText, SUBJECT_LABEL } from "./ClassroomList";
import { classroomKeys, isNotFound, serverReason, useClassroom, type ClassroomCore } from "./classroomsApi";
import { ClassAttendanceSection, ClassHistorySection, ClassHomeworkSection } from "./sections/ClassParts";
import { StaffSection } from "./sections/StaffSection";
import { StudentsSection } from "./sections/StudentsSection";

/**
 * One class's change form, in the same tabs as a person's: the Overview (its details beside a
 * read-only Summary), then Students, Staff, Attendance, Homework and History, each fetched when its
 * tab opens. A class that follows an lc-up group shows lc-up's fields locked, offers no student add
 * or remove, no teacher change, no archive and no delete — lc-up owns those.
 */

type ClassTab = "overview" | "students" | "staff" | "attendance" | "homework" | "history";

const TABS: Tab<ClassTab>[] = [
  { key: "overview", label: "Overview" },
  { key: "students", label: "Students" },
  { key: "staff", label: "Staff" },
  { key: "attendance", label: "Attendance" },
  { key: "homework", label: "Homework" },
  { key: "history", label: "History" },
];

function ActionButton({ children, ...rest }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="h-8 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function lcupText(room: ClassroomCore): string {
  if (!room.lcup) return "Not paired";
  return room.lcup.managed ? `lc-up group “${room.lcup.group_name}”` : `lc-up group “${room.lcup.group_name}” (not followed)`;
}

function ClassSummary({ room }: { room: ClassroomCore }) {
  return (
    <Fieldset title="Summary">
      <Row label="Status">{room.is_active ? "Active" : "Archived"}</Row>
      <Row label="Subject">{SUBJECT_LABEL[room.subject] ?? room.subject}</Row>
      <Row label="Level">{room.level ? levelLabel(room.level as never) : "—"}</Row>
      <Row label="Schedule">{scheduleText(room.lesson_days, room.lesson_time)}</Row>
      <Row label="lc-up">{lcupText(room)}</Row>
      <Row label="Teacher">
        {room.teacher ? (
          <Link href={`/ops/staff/${room.teacher.id}`} prefetch={false} className={LINK_CLASS}>
            {room.teacher.name}
          </Link>
        ) : (
          "No teacher"
        )}
      </Row>
      <Row label="Support teachers">{room.tas.map((t) => t.name).join(", ") || "—"}</Row>
      <Row label="Students">
        {room.students}
        {room.max_students ? <span className="text-muted-foreground"> of {room.max_students}</span> : null}
      </Row>
      <Row label="Join code">
        <span className="font-mono">{room.join_code || "—"}</span>
      </Row>
      <Row label="Telegram">
        {room.telegram_group_url ? (
          <a href={room.telegram_group_url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Group link
          </a>
        ) : room.telegram_chat_id ? (
          "Group attached"
        ) : (
          "—"
        )}
      </Row>
      <Row label="Created">{formatDate(room.created_at)}</Row>
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

  const managed = room.lcup?.managed ?? false;
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

  const meta = [
    SUBJECT_LABEL[room.subject] ?? room.subject,
    room.level ? levelLabel(room.level as never) : null,
    `${room.students} student${room.students === 1 ? "" : "s"}`,
    lcupText(room),
    room.is_active ? null : "Archived",
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
            <Link href={backHref} className="text-primary hover:underline dark:text-primary-hover">
              Classrooms
            </Link>{" "}
            › {room.name}
          </nav>
          <h1 className="mt-1 truncate text-xl font-semibold text-foreground">{room.name}</h1>
          <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {managed ? (
            <span className="text-sm text-muted-foreground">Managed in lc-up</span>
          ) : (
            <>
              <ActionButton disabled={busy} onClick={() => void setActive(!room.is_active)}>
                {room.is_active ? "Archive" : "Restore"}
              </ActionButton>
              <ActionButton disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete
              </ActionButton>
            </>
          )}
        </div>
      </div>

      <TabBar scope="class" label="Class sections" tabs={TABS} active={tab} onSelect={openTab} />

      {/* Only the open tab is rendered, so only its part is fetched. */}
      <div role="tabpanel" id={panelId("class", tab)} aria-labelledby={tabId("class", tab)} className="min-w-0">
        {tab === "overview" ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
          busy={busy}
          onCancel={() => (busy ? undefined : setConfirmDelete(false))}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}
