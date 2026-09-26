"use client";

/**
 * /teacher/classrooms — every class the teacher belongs to, and the door into each one.
 *
 * This page is the panel's crossroads. Nobody comes here to read it; they come here to GET
 * somewhere, so the row IS the design: the class name is a real link, for the reason the past
 * papers table spells out at length — it takes focus in tab order, a screen reader announces
 * it, the destination shows on hover, and it opens in a second tab. The row click sits on top
 * of that as a convenience for a mouse, never as the only way in.
 *
 * It is deliberately not a second copy of the dashboard's "Your classes" card. That card
 * answers "what is happening now" — it ranks by the clock and shows only what the server
 * considers current. This one is the whole shelf in one order, archived classes included,
 * because the class a teacher needs at three on a Tuesday is usually the one with no lesson
 * today.
 *
 * Every column here is a field `GET /api/classes/` already sends (see classes.serializers
 * .ClassroomSerializer): the two head-counts are queryset annotations, and the day, time and
 * room are what the teachers asked to stop looking up elsewhere. What is NOT on this row is a
 * homework count — the list endpoint knows nothing about homework, and the dashboard's
 * "not turned in" comes from a different endpoint entirely. Inventing one here would have been
 * a number with nothing behind it.
 *
 * Classrooms are created by administrators in the ops console, who assign the teacher —
 * teachers never create their own, which is why this page has no button to do it and never
 * had one. Editing and archiving live in the classroom's own Settings tab.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, BookOpen, Calculator } from "lucide-react";
import { formatLessonDaysShort } from "@/lib/classroomSchedule";
import { levelLabel } from "@/lib/levels";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Pill,
  Skeleton,
  TeacherPage,
  type Column,
} from "@/features/teacher/ui";
import { useClassrooms } from "../hooks";
import type { ClassroomWithRole } from "../types";

/**
 * A field nobody has filled in yet, said in words.
 *
 * A blank cell and a dash both read as "this table is broken"; "Not set" reads as a thing the
 * teacher can go and ask the office about, which is exactly what it is. The day is in practice
 * always there — the contract refuses a row whose `lesson_days` is not ODD or EVEN — but the
 * time and the room are free text on the model and are routinely left empty.
 */
function NotSet() {
  return <span style={{ color: "var(--dz-faint)" }}>Not set</span>;
}

const COLUMNS: Column<ClassroomWithRole>[] = [
  {
    key: "name",
    header: "Class",
    render: (c) => {
      const level = levelLabel(c.level);
      return (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* stopPropagation, or the row's own click fires a second navigation behind this
                one — same destination, but two history entries for one click. */}
            <Link
              href={`/teacher/classrooms/${c.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none" }}
            >
              {c.name}
            </Link>
            {/* Archiving is a soft close: the class keeps its students and its history and can
                be restored from Settings. It rides beside the name rather than in a column of
                its own, which would be empty on every row of a healthy list. */}
            {c.is_active === false && (
              <Pill tone="neutral">
                <Archive size={12} aria-hidden />
                Archived
              </Pill>
            )}
          </span>
          {level && <span style={{ fontSize: 12, color: "var(--dz-mute)" }}>{level}</span>}
        </span>
      );
    },
  },
  {
    key: "subject",
    header: "Subject",
    // The same glyph and the same tone the past-paper library gives each subject. A teacher
    // crosses between the two screens all day, and two colour schemes for one pair of subjects
    // is how the old panel taught people that nothing on it meant anything.
    render: (c) => {
      const isMath = String(c.subject ?? "").toUpperCase() === "MATH";
      return (
        <Pill tone={isMath ? "success" : "info"}>
          {isMath ? <Calculator size={13} aria-hidden /> : <BookOpen size={13} aria-hidden />}
          {isMath ? "Math" : "English"}
        </Pill>
      );
    },
  },
  {
    key: "days",
    header: "Lesson days",
    render: (c) => formatLessonDaysShort(c.lesson_days) || <NotSet />,
  },
  {
    key: "time",
    header: "Time",
    // Free text on the model ("18:00", sometimes "08:00-10:00"), so it is printed, never
    // parsed: the one thing worse than an unformatted time is a formatted wrong one.
    render: (c) => c.lesson_time?.trim() || <NotSet />,
  },
  { key: "room", header: "Room", render: (c) => c.room_number?.trim() || <NotSet /> },
  {
    key: "students",
    header: "Students",
    align: "right",
    // `student_count` counts enrolled students, which is what this label promises;
    // `members_count` counts the whole teaching-and-learning group and stands in only when the
    // first is absent. Both are queryset annotations, so a caller that skipped them sends
    // neither — and an em dash is the honest answer there, never a zero that would read as
    // "nobody has joined this class".
    render: (c) => {
      const count = c.student_count ?? c.members_count;
      return typeof count === "number" ? count : "—";
    },
  },
];

export function TeacherClassrooms() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useClassrooms();

  const classes = (data?.items ?? []) as ClassroomWithRole[];

  return (
    <TeacherPage
      title="Classrooms"
      subtitle="Open a class for its people, lessons, assignments and midterms."
    >
      <Card
        title="Your classes"
        subtitle={
          isLoading || isError
            ? undefined
            : `${classes.length} ${classes.length === 1 ? "class" : "classes"}`
        }
      >
        {/* The failure is tested first on purpose. A list that did not arrive has repeatedly
            been drawn in this product as a list with nothing in it, which tells a teacher their
            classes are gone when all that happened is that one request did not come back. */}
        {isError ? (
          <ErrorState
            title="Your classes didn't load"
            detail="Nothing has changed in any of them — this is only the page failing to read the list."
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
          <Skeleton height={40} count={5} />
        ) : classes.length === 0 ? (
          <EmptyState
            title="No classes yet"
            hint="An administrator sets up a class and assigns you to it. It appears here as soon as they do."
          />
        ) : (
          <DataTable
            label="Your classes"
            columns={COLUMNS}
            rows={classes}
            rowKey={(c) => c.id}
            onRowClick={(c) => router.push(`/teacher/classrooms/${c.id}`)}
            // The whole row, not just the name, answers cmd-click and middle-click. This page
            // exists to get a teacher into a class, and the card it replaced was one big link:
            // opening three classes in three tabs was something they could already do.
            rowHref={(c) => `/teacher/classrooms/${c.id}`}
          />
        )}
      </Card>
    </TeacherPage>
  );
}
