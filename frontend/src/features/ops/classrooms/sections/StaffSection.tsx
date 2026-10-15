"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import api, { classesApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import type { PeoplePage, StaffRow } from "@/features/ops/changelist/peopleApi";
import { Fieldset, LINK_CLASS, Row, SubHeading } from "@/features/ops/people/Fieldset";
import { classDomainOf, coversSubject } from "../CreateClassroomModal";
import { serverReason, type ClassroomCore } from "../classroomsApi";
import { SMALL_BUTTON } from "./StudentsSection";

/**
 * Who teaches the class. The teacher of a class that follows lc-up is lc-up's (the sync sets it and
 * the server refuses a change here); support teachers (TA seats) are always ours.
 */

const SELECT =
  "h-7 min-w-0 max-w-full rounded-md border border-border bg-card px-1.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function StaffSection({ room, onChanged }: { room: ClassroomCore; onChanged: () => void }) {
  const managed = room.lcup?.managed ?? false;
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [teacherPick, setTeacherPick] = useState("");
  const [supportPick, setSupportPick] = useState("");
  const domain = classDomainOf(room.subject);

  const staff = useQuery({
    queryKey: ["ops", "classrooms", "staff-options"],
    queryFn: async () =>
      (await api.get<PeoplePage<StaffRow>>("/users/admin/people/", { params: { section: "staff", page_size: 100 } })).data
        .results,
  });
  const teachers = (staff.data ?? []).filter(
    (s) => s.role === "teacher" && coversSubject(s.subject, domain) && s.id !== room.teacher?.id,
  );
  const supports = (staff.data ?? []).filter(
    (s) => s.role === "support_teacher" && coversSubject(s.subject, domain) && !room.tas.some((t) => t.id === s.id),
  );

  const act = async (run: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try {
      await run();
      push({ tone: "success", message: done });
      setTeacherPick("");
      setSupportPick("");
      onChanged();
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, failed) });
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => (staff.data ?? []).find((s) => String(s.id) === id)?.name ?? "them";

  return (
    <Fieldset title="Staff">
      <Row label="Teacher">
        {room.teacher ? (
          <Link href={`/ops/staff/${room.teacher.id}`} prefetch={false} className={LINK_CLASS}>
            {room.teacher.name}
          </Link>
        ) : (
          "No teacher"
        )}
        {managed ? <span className="text-xs text-muted-foreground"> · set in lc-up</span> : null}
      </Row>
      {managed ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`teacher-${room.id}`} className="text-muted-foreground">
            Change teacher
          </label>
          <select
            id={`teacher-${room.id}`}
            value={teacherPick}
            onChange={(e) => setTeacherPick(e.target.value)}
            className={SELECT}
          >
            <option value="">---------</option>
            {teachers.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name || t.username}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !teacherPick}
            onClick={() =>
              void act(
                () => classesApi.assignTeacher(room.id, Number(teacherPick)),
                `${nameOf(teacherPick)} now teaches ${room.name}.`,
                "Could not assign the teacher.",
              )
            }
            className={SMALL_BUTTON}
          >
            Make teacher
          </button>
          <button
            type="button"
            disabled={busy || !teacherPick}
            onClick={() =>
              void act(
                () => classesApi.transferOwnership(room.id, Number(teacherPick)),
                `${room.name} now belongs to ${nameOf(teacherPick)}.`,
                "Could not transfer the class.",
              )
            }
            className={SMALL_BUTTON}
          >
            Transfer ownership
          </button>
        </div>
      )}

      <SubHeading>Support teachers</SubHeading>
      {room.tas.length === 0 ? (
        <p className="text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {room.tas.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-1">
              <Link href={`/ops/staff/${t.id}`} prefetch={false} className={`${LINK_CLASS} min-w-0 truncate`}>
                {t.name}
              </Link>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => classesApi.removeSupportTeacher(room.id, t.id),
                    `Removed ${t.name} from ${room.name}.`,
                    "Could not remove the support teacher.",
                  )
                }
                className={SMALL_BUTTON}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {supports.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`support-${room.id}`} className="text-muted-foreground">
            Add support teacher
          </label>
          <select
            id={`support-${room.id}`}
            value={supportPick}
            onChange={(e) => setSupportPick(e.target.value)}
            className={SELECT}
          >
            <option value="">---------</option>
            {supports.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name || s.username}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !supportPick}
            onClick={() =>
              void act(
                () => classesApi.assignSupportTeacher(room.id, Number(supportPick)),
                `${nameOf(supportPick)} supports ${room.name} now.`,
                "Could not assign the support teacher.",
              )
            }
            className={SMALL_BUTTON}
          >
            Add
          </button>
        </div>
      ) : null}
    </Fieldset>
  );
}
