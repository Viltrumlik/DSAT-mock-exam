"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, CourseTag, Menu, buttonClass, courseLevelOf, courseName, signedAmount, type MenuItem } from "@/features/console/ui";
import { dayText, groupTitle, scheduleLine, weekdayOf } from "@/features/ops/detail/groupFacts";
import { NEW_CAMPAIGN_PATH } from "@/features/ops/sms/smsTabs";
import { SUBJECT_LABEL } from "./ClassroomList";
import type { ClassroomCore } from "./classroomsApi";

/**
 * The group page's header card (Group board, lc-up structure, 22 Nov 2026): the group's name and its teacher's
 * surname as the title, then one line of facts as badges — the course as its tag, the room, the days and time, the
 * teacher, the price a month, the start, today's lesson — only those the class has. Actions on the right: SMS all
 * (the composer with this class as the audience), ⋮ (details, archive, delete — lc-up's own while it runs the class)
 * and the primary "Mark …'s lesson", which opens the register.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "2 students · +1 demo": the demo seats are no students, so they are said apart. */
export function studentsText(room: Pick<ClassroomCore, "students" | "demo">): string {
  const demo = room.demo ?? 0;
  return `${plural(room.students, "student")}${demo ? ` · +${demo} demo` : ""}`;
}

/** Today's register in words: "Today 15:00 · 3 of 18 students marked", in the colour of how far it is. */
export function todayBadge(room: ClassroomCore): { text: string; tone: "positive" | "attention" } | null {
  const today = room.glance.today;
  if (!today) return null;
  if (today.change) return { text: today.change.text, tone: "attention" };
  const when = today.lesson_time ? `Today ${today.lesson_time}` : "Today";
  const m = today.marked;
  if (!m) return { text: `${when} · not marked yet`, tone: "attention" };
  const marked = m.present + m.late + m.absent + m.excused;
  return { text: `${when} · ${marked} of ${plural(today.students, "student")} marked`, tone: marked >= today.students ? "positive" : "attention" };
}

/**
 * The lesson "Mark …'s lesson" opens: today's when the class meets today, else the last one held. A lesson called off
 * or moved away today is none to mark (the header says why): it offers the last one held before today instead, and
 * nothing when the only register is today's (opened before the change; Undo brings the lesson back).
 */
export function lessonToMark(room: ClassroomCore, todayIso: string): { date: string; today: boolean } | null {
  const today = room.glance.today;
  if (today && !today.change) return { date: todayIso, today: true };
  const last = room.glance.last_lesson;
  if (!last || (today?.change && last === todayIso)) return null;
  return { date: last, today: last === todayIso };
}

function facts(room: ClassroomCore, canMoney: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  const level = courseLevelOf(room.level, room.name);
  const course = courseName(room.level, room.subject) || SUBJECT_LABEL[room.subject] || room.subject;
  if (course) {
    out.push(
      <CourseTag level={level} title="Course">
        {course}
      </CourseTag>,
    );
  }
  if (room.room_number) out.push(<Badge tone="line" icon="ms-room">Room {room.room_number}</Badge>);
  out.push(<Badge tone="line" icon="users">{studentsText(room)}</Badge>);
  const schedule = scheduleLine(room.lesson_days, room.lesson_time);
  if (schedule) out.push(<Badge tone="line" icon="clock">{schedule}</Badge>);
  out.push(
    room.teacher ? (
      <Link href={`/ops/staff/${room.teacher.id}`} prefetch={false} className="rounded-ms-badge">
        <Badge tone="line" icon="user">{room.teacher.name}</Badge>
      </Link>
    ) : (
      <Badge tone="attention" icon="user">No teacher</Badge>
    ),
  );
  if (room.tas.length) {
    out.push(
      <Badge tone="line" icon="users">
        Support:{" "}
        {room.tas.map((t, i) => (
          <Fragment key={t.id}>
            {i ? ", " : ""}
            <Link href={`/ops/staff/${t.id}`} prefetch={false} className="hover:underline">
              {t.name}
            </Link>
          </Fragment>
        ))}
      </Badge>,
    );
  }
  if (canMoney && room.monthly_price != null) out.push(<Badge tone="line" icon="wallet">{signedAmount(room.monthly_price)} so&apos;m a month</Badge>);
  if (room.start_date) out.push(<Badge tone="line" icon="cal">Started {dayText(room.start_date)}</Badge>);
  if (room.branch) out.push(<Badge tone="line" icon="building">{room.branch.name}</Badge>);
  if (room.lcup) {
    out.push(
      room.lcup.managed ? (
        <Badge tone="line" icon="ms-sync">Synced from lc-up</Badge>
      ) : (
        <Badge tone="attention" icon="warn">lc-up group not followed</Badge>
      ),
    );
  }
  return out;
}

export function ClassHeader({
  room,
  busy,
  canMessage,
  canManage,
  canMoney,
  mark,
  onMark,
  onDetails,
  onToggleActive,
  onDelete,
}: {
  room: ClassroomCore;
  busy: boolean;
  /** Whoever holds `send_sms`: the SMS panel's campaigns are theirs alone. */
  canMessage: boolean;
  /** Whoever holds `manage_groups`: archiving and deleting a class go through its governance endpoints. */
  canManage: boolean;
  /** `view_money`: the group's price. */
  canMoney: boolean;
  /** The lesson the primary button marks; null hides it (no lesson yet, or the viewer cannot mark). */
  mark: { date: string; today: boolean } | null;
  onMark: () => void;
  /** ⋮ "Group details": the Details tab (the class's form). */
  onDetails: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const managed = room.lcup?.managed ?? false;
  // A demo seat still takes a chair: a class is full by everyone sitting in it.
  const full = room.max_students != null && room.students + (room.demo ?? 0) >= room.max_students;
  const today = todayBadge(room);
  const items: MenuItem[] = [{ label: "Group details", icon: "pencil", onSelect: onDetails }];
  if (!managed && canManage) {
    items.push({ label: room.is_active ? "Archive" : "Restore", icon: room.is_active ? "archive" : "undo", onSelect: onToggleActive });
    items.push("separator", { label: "Delete class", icon: "trash", danger: true, onSelect: onDelete });
  }
  return (
    <section aria-label="Group" className="flex flex-col gap-3 rounded-ms-card border border-ms-border bg-ms-card px-5 py-5 md:px-[22px]">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-ms-title min-w-0 break-words text-ms-fg">{groupTitle(room.name, room.teacher?.name)}</h1>
            {room.is_active ? null : <Badge tone="neutral" icon="archive">Archived</Badge>}
            {full ? <Badge tone="attention" dot>Full</Badge> : null}
            {today ? <Badge tone={today.tone} icon="ms-today">{today.text}</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {facts(room, canMoney).map((f, i) => (
              <Fragment key={i}>{f}</Fragment>
            ))}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          {canMessage ? (
            <Link href={`${NEW_CAMPAIGN_PATH}?classroom=${room.id}`} className={buttonClass({ className: "max-md:flex-1" })}>
              <Icon name="msg" />
              SMS all
            </Link>
          ) : null}
          <Menu label="More actions" variant="secondary" items={items} disabled={busy} />
          {mark ? (
            <Button variant="primary" icon="ms-present" className="max-md:w-full" onClick={onMark}>
              Mark {weekdayOf(mark.date)}’s lesson
            </Button>
          ) : null}
        </div>
      </div>
      {managed ? (
        <p className="flex items-start gap-2 rounded-ms-ctl bg-ms-info-soft px-3.5 py-2.5 text-[14px] text-ms-info-fg">
          <Icon name="lock" size="sm" className="mt-0.5" />
          <span>
            <b>Managed in lc-up.</b> Its details, teacher and students come from lc-up: change them there. Archive and delete are lc-up&apos;s too.
          </span>
        </p>
      ) : null}
    </section>
  );
}
