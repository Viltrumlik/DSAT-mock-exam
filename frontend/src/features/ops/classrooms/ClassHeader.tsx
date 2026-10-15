"use client";

import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  BookCheck,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  DoorOpen,
  Lock,
  MapPin,
  MoreHorizontal,
  Sigma,
  Trash2,
  UserRound,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Badge, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import { levelLabel } from "@/lib/levels";
import { LINK_CLASS, StatTile } from "@/features/ops/people/Fieldset";
import { formatDay } from "@/features/ops/people/format";
import { rateTone } from "@/features/ops/people/PersonHeader";
import { scheduleText, SUBJECT_LABEL } from "./ClassroomList";
import type { ClassroomCore } from "./classroomsApi";

/**
 * Which class this is, at the top of every tab — the person page's header for a class: its
 * subject as a coloured mark, when and where it meets and who teaches it, its state in colour.
 * On the Overview it also says the figures its tabs hold (students, attendance, homework, debt),
 * once. A class lc-up manages offers no archive and no delete: it says so instead.
 */

const ACTION =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

/** Each subject in its own colour and mark, as the badges say it. */
const SUBJECT_MARK: Record<string, { icon: typeof Sigma; square: string; badge: "primary" | "info" }> = {
  MATH: { icon: Sigma, square: "bg-primary-soft text-primary", badge: "primary" },
  ENGLISH: { icon: BookOpen, square: "bg-info-soft text-info-foreground", badge: "info" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Glance({ room }: { room: ClassroomCore }) {
  const g = room.glance;
  const hwRate = g.homework.expected > 0 ? Math.round((100 * g.homework.handed_in) / g.homework.expected) : null;
  const full = room.max_students != null && room.students >= room.max_students;
  return (
    <>
      <StatTile
        label="Students"
        value={room.max_students ? `${room.students} / ${room.max_students}` : room.students}
        icon={Users}
        tone={full ? "warning" : "primary"}
        sub={
          room.max_students == null
            ? "no size limit"
            : full
              ? "the class is full"
              : `${plural(room.max_students - room.students, "seat")} left`
        }
      />
      <StatTile
        label="Attendance"
        value={g.attendance_rate == null ? "—" : `${Math.round(g.attendance_rate)}%`}
        icon={CalendarCheck}
        tone={rateTone(g.attendance_rate)}
        sub={g.last_lesson ? `last lesson ${formatDay(g.last_lesson)}` : "no lesson marked yet"}
      />
      <StatTile
        label="Homework"
        value={hwRate == null ? "—" : `${hwRate}%`}
        icon={BookCheck}
        tone={rateTone(hwRate)}
        sub={g.homework.assignments > 0 ? `handed in · ${plural(g.homework.assignments, "assignment")}` : "none set yet"}
      />
      {room.lcup ? (
        <StatTile
          label="Owe lc-up"
          value={g.owing}
          icon={Wallet}
          tone={g.owing > 0 ? "danger" : "success"}
          sub={g.owing > 0 ? `${g.owing === 1 ? "student owes" : "students owe"} money` : "everyone paid up"}
        />
      ) : (
        <StatTile
          label="Support teachers"
          value={room.tas.length}
          icon={UsersRound}
          tone="primary"
          sub={room.tas.map((t) => t.name).join(", ") || "none yet"}
        />
      )}
    </>
  );
}

export function ClassHeader({
  room,
  glance,
  busy,
  onToggleActive,
  onDelete,
}: {
  room: ClassroomCore;
  /** Show the figures (the Overview); the other tabs hold them in full. */
  glance: boolean;
  busy: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const managed = room.lcup?.managed ?? false;
  const mark = SUBJECT_MARK[room.subject] ?? SUBJECT_MARK.MATH;
  const Mark = mark.icon;
  const full = room.max_students != null && room.students >= room.max_students;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4 sm:gap-5">
          <span
            aria-hidden
            className={cn("inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl", mark.square)}
          >
            <Mark className="h-8 w-8" />
          </span>
          <div className="min-w-0 space-y-2.5">
            <div>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{room.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock aria-hidden className="h-3.5 w-3.5" />
                  {scheduleText(room.lesson_days, room.lesson_time)}
                </span>
                {room.room_number ? (
                  <span className="inline-flex items-center gap-1.5">
                    <DoorOpen aria-hidden className="h-3.5 w-3.5" />
                    Room {room.room_number}
                  </span>
                ) : null}
                {room.branch ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin aria-hidden className="h-3.5 w-3.5" />
                    {room.branch.name}
                  </span>
                ) : null}
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <UserRound aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  {room.teacher ? (
                    <Link href={`/ops/staff/${room.teacher.id}`} prefetch={false} className={cn(LINK_CLASS, "truncate")}>
                      {room.teacher.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-warning-foreground">No teacher</span>
                  )}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={mark.badge}>{SUBJECT_LABEL[room.subject] ?? room.subject}</Badge>
              {room.level ? <Badge variant="neutral">{levelLabel(room.level as never)}</Badge> : null}
              {room.is_active ? (
                <Badge variant="success" dot>
                  Active
                </Badge>
              ) : (
                <Badge variant="neutral" dot>
                  Archived
                </Badge>
              )}
              {room.lcup ? (
                managed ? (
                  <Badge variant="neutral">Synced from lc-up</Badge>
                ) : (
                  <Badge variant="warning">lc-up group not followed</Badge>
                )
              ) : null}
              {full ? <Badge variant="warning">Full</Badge> : null}
            </div>
          </div>
        </div>

        {managed ? (
          <p className="inline-flex items-center gap-2 self-start rounded-lg bg-surface-2 px-3.5 py-2 text-sm text-muted-foreground">
            <Lock aria-hidden className="h-4 w-4" />
            Managed in lc-up
          </p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex">
            <button type="button" disabled={busy} onClick={onToggleActive} className={ACTION}>
              {room.is_active ? (
                <Archive aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ArchiveRestore aria-hidden className="h-4 w-4 shrink-0 text-success" />
              )}
              {room.is_active ? "Archive" : "Restore"}
            </button>
            <DropdownMenu
              trigger={
                <button type="button" aria-label="More actions" disabled={busy} className={`${ACTION} px-2.5`}>
                  <MoreHorizontal aria-hidden className="h-4 w-4" />
                </button>
              }
            >
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 aria-hidden className="h-4 w-4" />
                Delete class
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        )}
      </div>

      {glance ? (
        <div className="grid grid-cols-2 gap-3 border-t border-border bg-surface-2/40 p-4 sm:p-5 lg:grid-cols-4">
          <Glance room={room} />
        </div>
      ) : null}
    </div>
  );
}
