"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { levelLabel } from "@/lib/levels";
import { Badge, Button, HeaderCard, Menu, buttonClass, type GlanceFact } from "@/features/console/ui";
import { LINK_CLASS } from "@/features/ops/people/Fieldset";
import { formatDay } from "@/features/ops/people/format";
import { rateVerdict } from "@/features/ops/people/PersonHeader";
import { NEW_CAMPAIGN_PATH } from "@/features/ops/sms/smsTabs";
import { scheduleText, SUBJECT_LABEL } from "./ClassroomList";
import type { ClassroomCore } from "./classroomsApi";

/**
 * Which class this is, at the top of every tab (design handoff v0.3, DataDisplay · Header card; PR 11a): its
 * subject as the mark, when and where it meets and who teaches it, its state — then the facts, which answer the
 * desk's first question about a class ("Is there a lesson today, and is the register done?", scenario 5), and
 * the tab row at the card's foot. "Message class" opens the SMS composer with this class as the audience; a
 * class lc-up manages offers no archive and no delete and says so instead.
 */

/** Each subject in its own colour and mark. */
const SUBJECT_MARK: Record<string, { icon: "sigma" | "book"; square: string }> = {
  MATH: { icon: "sigma", square: "bg-ms-math-soft text-ms-math-fg" },
  ENGLISH: { icon: "book", square: "bg-ms-rw-soft text-ms-rw-fg" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "Is there a lesson today, and is the register done?" */
export function todayFact(room: ClassroomCore): GlanceFact {
  const today = room.glance.today;
  if (!today) return { label: "Today", value: "No lesson", sub: room.is_active ? "it does not meet today" : "the class is archived" };
  const when = today.lesson_time ? `lesson ${today.lesson_time}` : "lesson today";
  const m = today.marked;
  if (!m) return { label: "Today", value: "Not marked yet", sub: `${when} · ${plural(today.students, "student")}` };
  const marked = m.present + m.late + m.absent + m.excused;
  const parts = [m.present ? `${m.present} came` : "", m.late ? `${m.late} late` : "", m.absent ? `${m.absent} absent` : "", m.excused ? `${m.excused} excused` : ""];
  return {
    label: "Today",
    value: `${marked} of ${today.students}`,
    unit: "marked",
    tone: marked >= today.students ? "positive" : "attention",
    sub: [when, ...parts].filter(Boolean).join(" · "),
  };
}

function facts(room: ClassroomCore): GlanceFact[] {
  const g = room.glance;
  const full = room.max_students != null && room.students >= room.max_students;
  const hwRate = g.homework.expected > 0 ? Math.round((100 * g.homework.handed_in) / g.homework.expected) : null;
  return [
    todayFact(room),
    {
      label: "Students",
      value: room.students,
      unit: room.max_students ? `of ${room.max_students}` : undefined,
      tone: full ? "attention" : undefined,
      sub: room.max_students == null ? "no size limit" : full ? "the class is full" : `${plural(room.max_students - room.students, "seat")} left`,
    },
    {
      label: "Attendance",
      value: g.attendance_rate == null ? "—" : `${Math.round(g.attendance_rate)}%`,
      tone: rateVerdict(g.attendance_rate),
      sub: g.last_lesson ? `last lesson ${formatDay(g.last_lesson)}` : "no lesson marked yet",
    },
    room.lcup
      ? {
          label: "Owe lc-up",
          value: g.owing,
          tone: g.owing > 0 ? "critical" : "positive",
          sub: g.owing > 0 ? `${g.owing === 1 ? "student owes" : "students owe"} money` : "everyone paid up",
        }
      : {
          label: "Homework",
          value: hwRate == null ? "—" : `${hwRate}%`,
          tone: rateVerdict(hwRate),
          sub: g.homework.assignments > 0 ? `handed in · ${plural(g.homework.assignments, "assignment")}` : "none set yet",
        },
  ];
}

function badges(room: ClassroomCore): ReactNode {
  const full = room.max_students != null && room.students >= room.max_students;
  const mark = SUBJECT_MARK[room.subject] ?? SUBJECT_MARK.MATH;
  return (
    <>
      <Badge tone="line" icon={mark.icon}>
        {SUBJECT_LABEL[room.subject] ?? room.subject}
      </Badge>
      {room.level ? <Badge tone="neutral">{levelLabel(room.level as never)}</Badge> : null}
      {room.is_active ? (
        <Badge tone="positive" dot>
          Active
        </Badge>
      ) : (
        <Badge tone="neutral" icon="archive">
          Archived
        </Badge>
      )}
      {room.lcup ? (
        room.lcup.managed ? (
          <Badge tone="line" icon="ms-sync">
            Synced from lc-up
          </Badge>
        ) : (
          <Badge tone="attention" icon="warn">
            lc-up group not followed
          </Badge>
        )
      ) : null}
      {full ? (
        <Badge tone="attention" dot>
          Full
        </Badge>
      ) : null}
    </>
  );
}

function meta(room: ClassroomCore): ReactNode[] {
  const out: ReactNode[] = [scheduleText(room.lesson_days, room.lesson_time)];
  if (room.room_number) out.push(`Room ${room.room_number}`);
  if (room.branch) out.push(room.branch.name);
  out.push(
    room.teacher ? (
      <Link href={`/ops/staff/${room.teacher.id}`} prefetch={false} className={LINK_CLASS}>
        {room.teacher.name}
      </Link>
    ) : (
      <span className="font-medium text-ms-attention-fg">No teacher</span>
    ),
  );
  if (room.tas.length) {
    out.push(
      <span>
        Support:{" "}
        {room.tas.map((t, i) => (
          <Fragment key={t.id}>
            {i ? ", " : ""}
            <Link href={`/ops/staff/${t.id}`} prefetch={false} className={LINK_CLASS}>
              {t.name}
            </Link>
          </Fragment>
        ))}
      </span>,
    );
  }
  return out;
}

export function ClassHeader({
  room,
  busy,
  canMessage,
  onToggleActive,
  onDelete,
  children,
}: {
  room: ClassroomCore;
  busy: boolean;
  /** Admins and super admins: the SMS panel is theirs alone. */
  canMessage: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
  /** The tab row, at the card's foot. */
  children?: ReactNode;
}) {
  const managed = room.lcup?.managed ?? false;
  const mark = SUBJECT_MARK[room.subject] ?? SUBJECT_MARK.MATH;
  return (
    <HeaderCard
      avatar={
        <span aria-hidden className={cn("grid size-16 shrink-0 place-items-center rounded-[18px]", mark.square)}>
          <Icon name={mark.icon} size="xl" className="size-8" />
        </span>
      }
      title={room.name}
      badges={badges(room)}
      meta={meta(room)}
      actions={
        <>
          {canMessage ? (
            <Link href={`${NEW_CAMPAIGN_PATH}?classroom=${room.id}`} className={buttonClass()}>
              <Icon name="msg" />
              Message class
            </Link>
          ) : null}
          {managed ? null : (
            <>
              <Button icon={room.is_active ? "archive" : "undo"} disabled={busy} onClick={onToggleActive}>
                {room.is_active ? "Archive" : "Restore"}
              </Button>
              <Menu label="More actions" disabled={busy} items={[{ label: "Delete class", icon: "trash", danger: true, onSelect: onDelete }]} />
            </>
          )}
        </>
      }
      facts={facts(room)}
      notice={
        managed
          ? { tone: "info", icon: "lock", title: "Managed in lc-up.", body: "Its details, teacher and students come from lc-up: change them there. Archive and delete are lc-up's too." }
          : undefined
      }
    >
      {children}
    </HeaderCard>
  );
}
