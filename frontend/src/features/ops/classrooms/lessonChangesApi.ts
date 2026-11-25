"use client";

import api from "@/lib/api";

/**
 * A lesson day called off or moved, and a centre holiday (owner, 2026-11-25; `backend/classes/views_lesson_changes.py`).
 * Changing one needs `manage_lessons`. The server says what fits and refuses in words (400 `detail`), which the dialogs
 * show; these only ask.
 */

export type LessonChangeKind = "cancel" | "move";

/** One change as the API returns it. A centre holiday has no class. */
export type LessonChange = {
  id: number;
  classroom_id: number | null;
  /** The class's name; null for a centre holiday. */
  classroom: string | null;
  kind: LessonChangeKind;
  reason: string;
  /** "YYYY-MM-DD": the day the timetable said. */
  day: string;
  /** "YYYY-MM-DD": where a moved lesson went; null for a cancel. */
  new_day: string | null;
};

/**
 * What the change did to the money (`billing.lesson_money`): lessons voided (for how many students, so'm given back),
 * lessons charged now (`charged`, `charged_amount`) and the debt freezes it lifted. A change never freezes anyone: the
 * 15-minute tick does.
 */
export type LessonMoney = {
  voided: number;
  students: number;
  amount: number;
  charged: number;
  charged_amount: number;
  unfrozen: number;
};

export type LessonChangeResult = { change: LessonChange; money: LessonMoney };

/** How a date column of the register grid changed (`ops_classrooms._changed_days`), null when it did not. */
export type DayChange = {
  id: number;
  kind: LessonChangeKind;
  reason: string;
  /** A centre holiday: undoing it undoes it for every group. */
  holiday: boolean;
  /** The day it moved to (the moved-away column). */
  new_day?: string;
  /** The day it came from (the moved-in column). */
  from_day?: string;
};

export async function cancelLesson(roomId: number, body: { day: string; reason: string }): Promise<LessonChangeResult> {
  return (await api.post<LessonChangeResult>(`/classes/admin/classrooms/${roomId}/lessons/cancel/`, body)).data;
}

export async function moveLesson(
  roomId: number,
  body: { day: string; new_day: string; reason: string },
): Promise<LessonChangeResult> {
  return (await api.post<LessonChangeResult>(`/classes/admin/classrooms/${roomId}/lessons/move/`, body)).data;
}

export async function setHoliday(body: { day: string; reason: string }): Promise<LessonChangeResult> {
  return (await api.post<LessonChangeResult>("/classes/admin/lessons/holiday/", body)).data;
}

export async function undoLessonChange(id: number): Promise<LessonChangeResult> {
  return (await api.post<LessonChangeResult>(`/classes/admin/lesson-changes/${id}/undo/`, {})).data;
}

export const lessonChangesKey = ["classes", "admin", "lesson-changes"] as const;

/** Every live change of the days that can be changed (a month back to two months ahead): centre holidays first, then
 * the class changes, each by day. */
export type LessonChangeList = { from: string; to: string; changes: LessonChange[] };

export async function fetchLessonChanges(): Promise<LessonChangeList> {
  return (await api.get<LessonChangeList>("/classes/admin/lesson-changes/")).data;
}

/** "1 250 000" — whole so'm grouped by spaces, as the console writes money. */
function grouped(amount: number): string {
  return Math.round(amount).toLocaleString("en-US").replace(/,/g, " ");
}

/** The money line after a cancel or a holiday: "Given back to 3 students: 115 500 so'm". */
export function givenBackLine(money: LessonMoney): string {
  if (!money.voided) return "Nothing had been charged for it, so nothing is given back.";
  const who = money.students === 1 ? "1 student" : `${money.students} students`;
  return `Given back to ${who}: ${grouped(money.amount)} so'm`;
}

/** What a change or an undo did to the balances in all: "Given back in all: 38 500 so'm", "Balances unchanged." */
export function netLine(money: LessonMoney): string {
  if (!money.voided && !money.charged) return "No money moved.";
  const net = money.amount - money.charged_amount;
  if (net > 0) return `Given back in all: ${grouped(net)} so'm.`;
  if (net < 0) return `Charged in all: ${grouped(-net)} so'm.`;
  return "Balances unchanged.";
}
