"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLessonChanges, lessonChangesKey, type LessonChange } from "@/features/ops/classrooms/lessonChangesApi";
import { HolidayDialog, UndoChangeDialog } from "@/features/ops/classrooms/sections/LessonChangeDialogs";
import { P, holds } from "@/features/ops/permissions";
import { useMe } from "@/hooks/useMe";
import { Button, ErrorState } from "../ui";
import { LessonChangesTable } from "./LessonChangesTable";
import { dayCountLine } from "./timetable";
import { TimetableView, useTimetable } from "./TimetableView";

/**
 * /ops/timetable (Timetable board; lc-up's "Dars jadvali"): a plain title and the timetable in a card — rooms as
 * rows, 13:00–20:00 across, Today and the coming Mon … Sun. Asked only of whoever holds `view_people`, the
 * permission the endpoint and the nav item both require.
 *
 * Under it, every live lesson change from a month back to two months ahead (owner, 2026-11-25). Whoever holds
 * `manage_lessons` sets a centre holiday here ("Holiday…") and undoes any change from that list.
 */
export function TimetablePage() {
  const { me } = useMe();
  const allowed = Boolean(me) && holds(me, P.viewPeople);
  const canChange = Boolean(me) && holds(me, P.manageLessons);
  const t = useTimetable(allowed);
  const data = t.query.data;
  const changes = useQuery({ queryKey: lessonChangesKey, queryFn: fetchLessonChanges, enabled: allowed });
  const [holiday, setHoliday] = useState(false);
  const [undo, setUndo] = useState<LessonChange | null>(null);
  const queryClient = useQueryClient();
  const changed = () => {
    setHoliday(false);
    setUndo(null);
    // Every day's lessons, today's and the tabs', the list of changes, and the classes' registers.
    void queryClient.invalidateQueries({ queryKey: ["classes", "admin", "lessons"] });
    void queryClient.invalidateQueries({ queryKey: lessonChangesKey });
    void queryClient.invalidateQueries({ queryKey: ["ops", "classrooms"] });
  };
  return (
    <div className="flex flex-col gap-4">
      <header className="animate-ms-fade-in flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-ms-title text-ms-fg">Timetable</h1>
        {allowed ? (
          <span className="text-[14px] text-ms-fg-2">
            {t.current.long}
            {data ? ` · ${dayCountLine(data)}` : ""}
          </span>
        ) : null}
        {allowed && canChange ? (
          <Button size="sm" icon="cal" className="ml-auto self-center" onClick={() => setHoliday(true)}>
            Holiday…
          </Button>
        ) : null}
      </header>
      {allowed ? (
        <section aria-label="Lessons by room and hour" className="min-w-0 rounded-ms-card border border-ms-border bg-ms-card px-4 pb-5 pt-4 shadow-ms-1 sm:px-5">
          <TimetableView t={t} idPrefix="timetable" />
        </section>
      ) : me ? (
        <p className="text-[15px] text-ms-fg-2">The timetable is for staff who can see students and groups.</p>
      ) : null}
      {allowed && changes.data ? (
        <LessonChangesTable list={changes.data} canUndo={canChange} onUndo={setUndo} />
      ) : allowed && changes.isError ? (
        <ErrorState what="the lesson changes" onRetry={() => void changes.refetch()} />
      ) : null}
      {holiday ? <HolidayDialog day={t.current.date} onClose={() => setHoliday(false)} onDone={changed} /> : null}
      {undo ? (
        <UndoChangeDialog
          change={{ id: undo.id, kind: undo.kind, day: undo.day, new_day: undo.new_day, holiday: undo.classroom_id === null }}
          onClose={() => setUndo(null)}
          onDone={changed}
        />
      ) : null}
    </div>
  );
}
