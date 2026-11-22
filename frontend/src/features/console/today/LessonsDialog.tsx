"use client";

import { useId, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Button, Dialog } from "../ui";
import { dayCountLine } from "../timetable/timetable";
import { TimetableView, useTimetable } from "../timetable/TimetableView";

/**
 * Today's "Lessons today" (Today board, `lessons: Open`): the timetable in a wide dialog, as lc-up's "Dars
 * jadvali" opens it — "Lessons · Sunday, 22 November", "N lessons · M rooms", then rooms × hours. It opens on
 * today every time; the day tabs inside move it to the coming week's other days.
 */
export function LessonsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const t = useTimetable(open);
  const [openedFor, setOpenedFor] = useState(open);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open && t.tab !== "today") t.choose("today");
  }
  const data = t.query.data;
  return (
    <Dialog open={open} onClose={onClose} labelledBy={id} width={1280}>
      <div className="flex shrink-0 items-center gap-3 border-b border-ms-border px-4 py-3.5 sm:px-5">
        <Icon name="cal" className="text-ms-fg-2" />
        <h2 id={id} className="min-w-0 flex-1 truncate text-ms-h text-ms-fg">
          Lessons · {t.current.long}
        </h2>
        {data ? <span className="hidden text-[13px] text-ms-fg-2 sm:inline">{dayCountLine(data)}</span> : null}
        <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} />
      </div>
      <div className="min-h-0 overflow-y-auto px-4 pb-5 pt-4 sm:px-5">
        {data ? <p className="mb-3 text-[13px] text-ms-fg-2 sm:hidden">{dayCountLine(data)}</p> : null}
        <TimetableView t={t} idPrefix="lessons-dialog" />
      </div>
    </Dialog>
  );
}
