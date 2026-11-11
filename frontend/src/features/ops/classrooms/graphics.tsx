"use client";

import { BarChart, type BarSeries } from "@/features/console/graphics";
import type { ClassroomAttendance, ClassroomHomework } from "./classroomsApi";

/**
 * The class page's two graphics (design handoff v0.3, Graphics board; PR 11a): its lessons as stacked bars
 * (who came, who was late, who missed) and its homework as handed in vs not — each with the one line that says
 * what the shape shows, and a Table view for the numbers.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "4 Nov" from "YYYY-MM-DD". */
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
/** "Tue 4 Nov" from "YYYY-MM-DD". */
export const fullDay = (iso: string) => `${WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${shortDay(iso)}`;
/** The Tashkent day of a moment, "YYYY-MM-DD" — a due time near midnight belongs to the centre's day. */
export const tashkentDay = (moment: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(moment));

type Lesson = ClassroomAttendance["sessions"][number];
const markedIn = (l: Lesson) => l.present + l.late + l.absent + l.excused;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line under "Lessons": the lesson most were missing from, or that attendance held. Oldest first in. */
export function lessonsFinding(lessons: readonly Lesson[]): string {
  if (!lessons.length) return "";
  // A register opened but not marked yet says nothing about who came: it is not a lesson nobody missed.
  const marked = lessons.filter((l) => markedIn(l) > 0);
  if (!marked.length) return "Nothing is marked in these registers yet.";
  // The latest of the worst: a tie goes to the most recent lesson.
  const worst = marked.reduce((w, l) => (l.absent >= w.absent ? l : w));
  if (worst.absent === 0) return `No one was absent in the last ${plural(marked.length, "marked lesson")}.`;
  const total = markedIn(worst);
  if (worst.absent * 4 >= total) return `Most missed: ${fullDay(worst.date)}, ${worst.absent} of ${total} absent.`;
  return `Attendance held: at most ${worst.absent} absent in a lesson.`;
}

type Assignment = ClassroomHomework["assignments"][number];

/** The one line under "Handed in": how many assignments had under half handed in. */
export function homeworkFinding(rows: readonly Pick<Assignment, "turned_in" | "students">[]): string {
  if (!rows.length) return "";
  // With nobody sitting in the class there is no share to judge: an empty class did not "hand it in".
  const judged = rows.filter((r) => r.students > 0);
  if (!judged.length) return "No students in the class to hand these in.";
  const under = judged.filter((r) => r.turned_in * 2 < r.students).length;
  if (under === 0) return judged.length === 1 ? "At least half handed it in." : `All ${judged.length} had at least half handed in.`;
  return `${under} of ${plural(judged.length, "assignment")} had under half handed in.`;
}

const LESSON_SERIES: BarSeries[] = [
  { label: "Present", tone: "positive" },
  { label: "Late", tone: "attention" },
  { label: "Absent", tone: "critical" },
  { label: "Excused", tone: "neutral" },
];

/** The last 12 registers, oldest first (the API gives them newest first). */
export function LessonsChart({ sessions }: { sessions: ClassroomAttendance["sessions"] }) {
  const lessons = sessions.slice(0, 12).reverse();
  if (!lessons.length) return null;
  return (
    <BarChart
      title="Lessons"
      sub={`The last ${plural(lessons.length, "register")}, each bar the whole class`}
      labelHead="Lesson"
      series={LESSON_SERIES}
      bars={lessons.map((l) => ({ label: shortDay(l.date), full: fullDay(l.date), values: [l.present, l.late, l.absent, l.excused] }))}
      insight={lessonsFinding(lessons)}
    />
  );
}

const HOMEWORK_SERIES: BarSeries[] = [
  { label: "Handed in", tone: "positive" },
  { label: "Not handed in", tone: "neutral" },
];

/** Each dated assignment already due, oldest first; one not due yet is progress, not a verdict. */
export function HandedInChart({ assignments, now = Date.now() }: { assignments: ClassroomHomework["assignments"]; now?: number }) {
  const due = assignments
    .filter((a) => a.due_at != null && new Date(a.due_at).getTime() <= now)
    .slice(0, 12)
    .reverse();
  if (!due.length) return null;
  return (
    <BarChart
      title="Handed in"
      sub={`The last ${plural(due.length, "assignment")} that are due, by due date`}
      labelHead="Assignment"
      series={HOMEWORK_SERIES}
      bars={due.map((a) => {
        const day = tashkentDay(a.due_at!);
        return { label: shortDay(day), full: `${a.title} · due ${fullDay(day)}`, values: [a.turned_in, Math.max(0, a.students - a.turned_in)] };
      })}
      insight={homeworkFinding(due)}
    />
  );
}
