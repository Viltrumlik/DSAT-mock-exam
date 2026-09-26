"use client";

/**
 * The teacher's day, in one request: `GET /api/classes/teacher/today/`.
 *
 * Every class they teach with its schedule and the next lesson first, the manual grading
 * queue three levels deep, and the aggregates the charts read. The dashboard this replaces
 * assembled a thinner screen from two requests PER CLASS.
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

/** Where a class stands against the clock: in its lesson, before it, after it, or unscheduled. */
export type ClassState = "now" | "upcoming" | "done" | "off";

export type TeacherClass = {
  classroomId: number;
  name: string;
  subject: string;
  /** `Classroom.room_number`. Empty when the class has no room recorded. */
  room: string;
  lessonDays: string;
  /** "Mon, Wed, Fri" / "Tue, Thu, Sat", or empty when the class has no lesson days. */
  lessonDaysLabel: string;
  /** "18:00", or null when the classroom's free-text time cannot be read. */
  lessonTime: string | null;
  studentCount: number;
  nextLessonAt: string | null;
  state: ClassState;
  /** Only for a class meeting today, and only when homework is due at that lesson. */
  homework: TodayHomework | null;
};

export type QueueStudent = { id: number; name: string; submittedAt: string | null };
export type QueueAssignment = { assignmentId: number; title: string; waiting: number; students: QueueStudent[] };
export type QueueClass = { classroomId: number; name: string; waiting: number; assignments: QueueAssignment[] };

export type UpcomingMidterm = {
  midtermId: number;
  title: string;
  classroomId: number;
  className: string;
  startsAt: string;
  /** Null when the midterm is not graded — a pass mark is never guessed. */
  passMark: number | null;
};

export type AttendanceWeekRow = { classroomId: number; name: string; present: number; late: number; missed: number; excused: number };
export type HomeworkRateRow = { classroomId: number; name: string; expected: number; turnedIn: number };
export type AttendanceTrendRow = { date: string; present: number; late: number; missed: number };

export type TeacherToday = {
  date: string;
  now: string;
  nextLessonDate: string | null;
  classes: TeacherClass[];
  gradingQueue: QueueClass[];
  upcomingMidterms: UpcomingMidterm[];
  stats: {
    attendanceWeek: AttendanceWeekRow[];
    homework30d: HomeworkRateRow[];
    attendanceTrend: AttendanceTrendRow[];
  };
};

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const orNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

const STATES: ClassState[] = ["now", "upcoming", "done", "off"];
const state = (v: unknown): ClassState => (STATES as string[]).includes(str(v)) ? (v as ClassState) : "off";

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
  const stats = obj(d.stats);
  return {
    date: str(d.date),
    now: str(d.now),
    nextLessonDate: orNull(d.next_lesson_date),
    classes: arr(d.classes).map((c) => {
      const row = obj(c);
      return {
        classroomId: num(row.classroom_id, -1),
        name: str(row.name, "Class"),
        subject: str(row.subject),
        room: str(row.room),
        lessonDays: str(row.lesson_days),
        lessonDaysLabel: str(row.lesson_days_label),
        lessonTime: orNull(row.lesson_time),
        studentCount: num(row.student_count),
        nextLessonAt: orNull(row.next_lesson_at),
        state: state(row.state),
        homework: parseHomework(row.homework),
      };
    }),
    gradingQueue: arr(d.grading_queue).map((q) => {
      const row = obj(q);
      return {
        classroomId: num(row.classroom_id, -1),
        name: str(row.name, "Class"),
        waiting: num(row.waiting),
        assignments: arr(row.assignments).map((a) => {
          const asg = obj(a);
          return {
            assignmentId: num(asg.assignment_id, -1),
            title: str(asg.title, "Homework"),
            waiting: num(asg.waiting),
            students: arr(asg.students).map((s) => {
              const st = obj(s);
              return { id: num(st.id, -1), name: str(st.name, "Student"), submittedAt: orNull(st.submitted_at) };
            }),
          };
        }),
      };
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
    stats: {
      attendanceWeek: arr(stats.attendance_week).map((r) => {
        const row = obj(r);
        return {
          classroomId: num(row.classroom_id, -1), name: str(row.name, "Class"),
          present: num(row.present), late: num(row.late), missed: num(row.missed), excused: num(row.excused),
        };
      }),
      homework30d: arr(stats.homework_30d).map((r) => {
        const row = obj(r);
        return {
          classroomId: num(row.classroom_id, -1), name: str(row.name, "Class"),
          expected: num(row.expected), turnedIn: num(row.turned_in),
        };
      }),
      attendanceTrend: arr(stats.attendance_trend).map((r) => {
        const row = obj(r);
        return { date: str(row.date), present: num(row.present), late: num(row.late), missed: num(row.missed) };
      }),
    },
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
