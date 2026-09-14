"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Calculator, CalendarClock, Clock, MapPin, MessageCircle, School, Users } from "lucide-react";

import { Avatar, Skeleton } from "@/components/ui";
import { EmptyState, ErrorState } from "@/features/classroom/ui";
import { formatLessonDaysShort } from "@/lib/classroomSchedule";
import { cn } from "@/lib/cn";

import { lessonLabel, nextLesson, type ScheduleEvent } from "./profileModel";
import { Eyebrow, IconTile, Panel, PanelHeader, pill, TONE } from "./profileUi";
import type { Load, ProfileClass } from "./types";

/** A classmate as `GET /classes/{id}/people/` serves one. */
export interface ClassPerson {
  id: number;
  role: string;
  user: { id: number; username?: string; first_name?: string; last_name?: string; profile_image_url?: string | null };
}

const LEVEL_LABEL: Record<string, string> = {
  foundation: "Foundation",
  junior: "Junior",
  middle: "Middle",
  senior: "Senior",
};

function personName(user: ClassPerson["user"]): string {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.username || "Student";
}

function teacherName(c: ProfileClass): string | null {
  const t = c.teacher_details;
  if (!t) return null;
  return `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim() || t.username || null;
}

/**
 * One class, with what a student comes to their classes list to find out: when the next lesson
 * is, who teaches it, where, and a way in. `student_count`, not `members_count` — the members
 * include the teaching team, and the card this replaces called fifteen members fifteen students.
 */
function ClassCard({
  index,
  cls,
  schedule,
  selected,
  onSelect,
}: {
  index: number;
  cls: ProfileClass;
  schedule: Load<ScheduleEvent[]>;
  selected: boolean;
  onSelect: () => void;
}) {
  const math = cls.subject === "MATH";
  const teacher = teacherName(cls);
  const days = formatLessonDaysShort(cls.lesson_days);
  const lesson = schedule.status === "ready" ? nextLesson(schedule.data, cls.id, cls.lesson_hours) : null;
  const where = [cls.room_number ? `Room ${cls.room_number}` : null, cls.branch_name || null].filter(Boolean).join(" · ");
  const level = cls.level ? LEVEL_LABEL[String(cls.level)] ?? String(cls.level) : null;
  const students = cls.student_count ?? 0;

  return (
    <article
      aria-label={cls.name}
      className={cn(
        "quartz squircle cr-cardrise flex flex-col gap-4 border-2 p-5 [--sq:13px]",
        selected ? "border-primary/45" : "border-transparent",
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start gap-3">
        <IconTile icon={math ? Calculator : BookOpen} tone={math ? "sky" : "emerald"} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-foreground">{cls.name}</h3>
          <p className="mt-0.5 text-[13px] font-medium text-muted-foreground">
            {[math ? "Math" : "English", level].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {/* When — the one thing on the card that changes by itself, so it gets the colour. */}
      <div className={cn("squircle flex items-center gap-3 px-3.5 py-2.5 [--sq:9px]", lesson?.live ? TONE.emerald.well : TONE.primary.well)}>
        <CalendarClock className={cn("h-[18px] w-[18px] shrink-0", lesson?.live ? TONE.emerald.text : TONE.primary.text)} aria-hidden />
        <div className="min-w-0">
          <Eyebrow className={lesson?.live ? TONE.emerald.text : TONE.primary.text}>Next lesson</Eyebrow>
          <p className="mt-0.5 text-[13.5px] font-bold text-foreground">
            {schedule.status === "loading"
              ? "Checking the timetable…"
              : schedule.status === "error"
                ? "The timetable didn't load"
                : lesson
                  ? lessonLabel(lesson)
                  : "None scheduled yet"}
          </p>
        </div>
      </div>

      <dl className="grid gap-2.5 text-[13px] sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar src={cls.teacher_details?.profile_image_url} name={teacher ?? "?"} size={26} />
          <div className="min-w-0">
            <dt className="sr-only">Teacher</dt>
            <dd className="truncate font-semibold text-foreground">{teacher ? `Teacher: ${teacher}` : "Teacher to be confirmed"}</dd>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Schedule</dt>
          <dd className="truncate font-medium text-muted-foreground">
            {[days, cls.lesson_time].filter(Boolean).join(" · ") || "Schedule to be set"}
          </dd>
        </div>
        {where ? (
          <div className="flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <dt className="sr-only">Where</dt>
            <dd className="truncate font-medium text-muted-foreground">{where}</dd>
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Students</dt>
          <dd className="truncate font-medium text-muted-foreground">
            {students} {students === 1 ? "student" : "students"}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Link href={`/classes/${cls.id}`} className={pill("solid", "primary", "sm")}>
          Open class
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={pill("soft", selected ? "primary" : "sky", "sm")}
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          Classmates
        </button>
        {cls.telegram_group_url ? (
          <a href={cls.telegram_group_url} target="_blank" rel="noopener noreferrer" className={pill("quiet", "primary", "sm")}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            Telegram group
          </a>
        ) : null}
      </div>
    </article>
  );
}

function ClassmatesPanel({
  cls,
  people,
  onRetry,
}: {
  cls: ProfileClass | null;
  people: Load<ClassPerson[]>;
  onRetry: () => void;
}) {
  const students = people.status === "ready" ? people.data.filter((p) => String(p.role).toUpperCase() === "STUDENT") : [];
  const shown = students.slice(0, 18);

  return (
    <Panel index={1} className="xl:sticky xl:top-4">
      <PanelHeader
        icon={Users}
        tone="sky"
        title="Classmates"
        description={cls ? cls.name : "Choose a class to see who's in it."}
      />
      <div className="mt-4">
        {!cls ? null : people.status === "loading" ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="squircle h-12 [--sq:9px]" />
            ))}
          </div>
        ) : people.status === "error" ? (
          <ErrorState title="The class list didn't load." message="Try again in a moment." onRetry={onRetry} />
        ) : shown.length === 0 ? (
          <p className="text-[13px] font-medium text-muted-foreground">No classmates in this class yet.</p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {shown.map((p) => (
                <li key={p.id} className={cn("squircle flex min-w-0 items-center gap-2.5 px-2.5 py-2 [--sq:9px]", TONE.sky.well)}>
                  <Avatar src={p.user.profile_image_url} name={personName(p.user)} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-foreground">{personName(p.user)}</p>
                    {p.user.username ? <p className="truncate text-[11.5px] text-muted-foreground">@{p.user.username}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
            {students.length > shown.length ? (
              <Link
                href={`/classes/${cls.id}`}
                className="mt-3 inline-flex text-[12.5px] font-bold text-primary no-underline hover:underline dark:text-primary-hover"
              >
                +{students.length - shown.length} more in the class
              </Link>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}

export function ClassesTab({
  classes,
  schedule,
  selectedId,
  onSelect,
  people,
  onRetryPeople,
}: {
  classes: ProfileClass[];
  schedule: Load<ScheduleEvent[]>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  people: Load<ClassPerson[]>;
  onRetryPeople: () => void;
}) {
  if (classes.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={School}
          title="No classes yet"
          description="When your learning center adds you to a class, it appears here with its timetable and teacher."
        />
      </Panel>
    );
  }

  const selected = classes.find((c) => c.id === selectedId) ?? null;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-3">
      <div className="grid gap-4 md:grid-cols-2 xl:col-span-2">
        {classes.map((cls, i) => (
          <ClassCard
            key={cls.id}
            index={i}
            cls={cls}
            schedule={schedule}
            selected={cls.id === selectedId}
            onSelect={() => onSelect(cls.id)}
          />
        ))}
      </div>
      <ClassmatesPanel cls={selected} people={people} onRetry={onRetryPeople} />
    </div>
  );
}
