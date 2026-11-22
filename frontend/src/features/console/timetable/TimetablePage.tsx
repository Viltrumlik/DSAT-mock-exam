"use client";

import { P, holds } from "@/features/ops/permissions";
import { useMe } from "@/hooks/useMe";
import { dayCountLine } from "./timetable";
import { TimetableView, useTimetable } from "./TimetableView";

/**
 * /ops/timetable (Timetable board; lc-up's "Dars jadvali"): a plain title and the timetable in a card — rooms as
 * rows, 13:00–20:00 across, Today and the coming Mon … Sun. Asked only of whoever holds `view_people`, the
 * permission the endpoint and the nav item both require.
 */
export function TimetablePage() {
  const { me } = useMe();
  const allowed = Boolean(me) && holds(me, P.viewPeople);
  const t = useTimetable(allowed);
  const data = t.query.data;
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
      </header>
      {allowed ? (
        <section aria-label="Lessons by room and hour" className="min-w-0 rounded-ms-card border border-ms-border bg-ms-card px-4 pb-5 pt-4 shadow-ms-1 sm:px-5">
          <TimetableView t={t} idPrefix="timetable" />
        </section>
      ) : me ? (
        <p className="text-[15px] text-ms-fg-2">The timetable is for staff who can see students and groups.</p>
      ) : null}
    </div>
  );
}
