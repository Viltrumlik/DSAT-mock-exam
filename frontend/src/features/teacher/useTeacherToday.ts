"use client";

/**
 * The teacher's day, in one request: `GET /api/classes/teacher/today/`.
 *
 * What both teachers who answered the 2026-09-14 letter asked to see on opening — today's
 * lessons with their times, and who has not turned homework in — plus the work waiting to be
 * checked and the midterms coming. The dashboard this replaces assembled the same screen from
 * two requests PER CLASS, which is why it was the panel's heaviest page.
 *
 * The payload is parsed defensively rather than cast: a field the server stops sending must
 * degrade to "nothing to show" in one block, never throw and take the whole dashboard with it.
 */

import { useQuery } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";

export type TodayStudent = { id: number; name: string };

export type TodayHomework = {
  assignmentId: number;
  title: string;
  turnedIn: number;
  missing: number;
  /** The whole list, not a sample — a class here runs to about twenty students. */
  missingStudents: TodayStudent[];
};

export type TodayLesson = {
  classroomId: number;
  name: string;
  subject: string;
  /** Free text on the classroom, e.g. "18:00". Null when it is blank or unparseable. */
  lessonTime: string | null;
  studentCount: number;
  /** Null when no published homework is due at this lesson. */
  homework: TodayHomework | null;
};

export type WaitingRow = { classroomId: number; name: string; count: number };

export type UpcomingMidterm = {
  midtermId: number;
  title: string;
  classroomId: number;
  className: string;
  startsAt: string;
  /** Null when the midterm is not graded — a pass mark is never guessed. */
  passMark: number | null;
};

export type TeacherToday = {
  date: string;
  lessons: TodayLesson[];
  waitingToCheck: WaitingRow[];
  upcomingMidterms: UpcomingMidterm[];
  /** The nearest future day any of the teacher's classes meets. Null when there is none. */
  nextLessonDate: string | null;
};

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const orNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function parseHomework(v: unknown): TodayHomework | null {
  if (!v || typeof v !== "object") return null;
  const h = obj(v);
  return {
    assignmentId: num(h.assignment_id, -1),
    title: str(h.title, "Homework"),
    turnedIn: num(h.turned_in),
    missing: num(h.missing),
    missingStudents: arr(h.missing_students).map((s) => {
      const row = obj(s);
      return { id: num(row.id, -1), name: str(row.name, "Student") };
    }),
  };
}

/** Exported for its test: the shape the dashboard reads, whatever the server sent. */
export function parseTeacherToday(raw: unknown): TeacherToday {
  const d = obj(raw);
  return {
    date: str(d.date),
    nextLessonDate: orNull(d.next_lesson_date),
    lessons: arr(d.lessons).map((l) => {
      const row = obj(l);
      return {
        classroomId: num(row.classroom_id, -1),
        name: str(row.name, "Class"),
        subject: str(row.subject),
        lessonTime: orNull(row.lesson_time),
        studentCount: num(row.student_count),
        homework: parseHomework(row.homework),
      };
    }),
    waitingToCheck: arr(d.waiting_to_check).map((w) => {
      const row = obj(w);
      return { classroomId: num(row.classroom_id, -1), name: str(row.name, "Class"), count: num(row.count) };
    }),
    upcomingMidterms: arr(d.upcoming_midterms).map((m) => {
      const row = obj(m);
      return {
        midtermId: num(row.midterm_id, -1),
        title: str(row.title, "Midterm"),
        classroomId: num(row.classroom_id, -1),
        className: str(row.name, "Class"),
        startsAt: str(row.starts_at),
        passMark: typeof row.pass_mark === "number" ? row.pass_mark : null,
      };
    }),
  };
}

export const teacherTodayKey = ["teacher", "today"] as const;

export function useTeacherToday(enabled = true) {
  return useQuery({
    queryKey: teacherTodayKey,
    queryFn: async () => parseTeacherToday(await classesApi.teacherToday()),
    // A teacher opens this page repeatedly through the day; half a minute of cache saves the
    // repeat trips without ever showing yesterday's lesson list.
    staleTime: 30_000,
    // No silent retries: a failure must reach the block's ErrorState, with its retry, rather
    // than leave the reader watching a spinner that never resolves.
    retry: false,
    // Off for the preview route, which supplies its own sample instead of a live class list.
    enabled,
  });
}
