"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Lock, UserCog, UserPlus } from "lucide-react";
import api, { classesApi } from "@/lib/api";
import { Avatar, buttonClass, inputShell } from "@/features/console/ui";
import { useToast } from "@/components/ToastProvider";
import type { PeoplePage, StaffRow } from "@/features/ops/changelist/peopleApi";
import { Fieldset, LINK_CLASS, Pill, SubHeading } from "@/features/ops/people/Fieldset";
import { classDomainOf, coversSubject } from "../CreateClassroomModal";
import { serverReason, type ClassroomCore } from "../classroomsApi";
import { SMALL_BUTTON } from "./StudentsSection";

/**
 * Who teaches the class, each as a card. The teacher of a class that follows lc-up is lc-up's (the
 * sync sets it and the server refuses a change here); support teachers (TA seats) are always ours.
 */

/** The console's field box; the buttons beside it are the same 44 px. */
const SELECT = inputShell({ className: "min-w-0 max-w-full outline-none" });
const PICK_BUTTON = buttonClass();

/** One staff member: their initials, their name linking to their page, what they are here, a control. */
function PersonCard({ id, name, badge, children }: { id: number; name: string; badge: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-[16px] border border-ms-border px-4 py-3">
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={name} size="md" />
        <span className="min-w-0">
          <Link href={`/ops/staff/${id}`} prefetch={false} className={`${LINK_CLASS} block truncate`}>
            {name}
          </Link>
          <span className="mt-1 block">{badge}</span>
        </span>
      </span>
      {children}
    </li>
  );
}

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
    <Fieldset title="Staff" icon={UserCog} description="Who teaches the class, and who helps">
      <SubHeading>Teacher</SubHeading>
      {room.teacher ? (
        // The same grid as the support teachers, so the two kinds of card are one size.
        <ul className="grid gap-3 sm:grid-cols-2">
          <PersonCard id={room.teacher.id} name={room.teacher.name} badge={<Pill tone="info">Teacher</Pill>}>
            {managed ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-ms-fg-3">
                <Lock aria-hidden className="h-3.5 w-3.5" />
                Set in lc-up
              </span>
            ) : null}
          </PersonCard>
        </ul>
      ) : (
        <p className="rounded-ms-ctl border border-ms-attention-line bg-ms-attention-soft px-4 py-3 text-[14px] font-medium text-ms-attention-fg">
          No teacher{managed ? " — Set in lc-up" : ""}
        </p>
      )}
      {managed ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[16px] border border-dashed border-ms-border-strong p-3">
          <label htmlFor={`teacher-${room.id}`} className="text-[14px] text-ms-fg-2">
            Change teacher
          </label>
          <select
            id={`teacher-${room.id}`}
            value={teacherPick}
            onChange={(e) => setTeacherPick(e.target.value)}
            className={SELECT}
          >
            <option value="">— choose —</option>
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
            className={PICK_BUTTON}
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
            className={PICK_BUTTON}
          >
            Transfer ownership
          </button>
        </div>
      )}

      <SubHeading>Support teachers</SubHeading>
      {room.tas.length === 0 ? (
        <p className="rounded-ms-ctl bg-ms-surface px-4 py-3 text-[14px] text-ms-fg-2">None yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {room.tas.map((t) => (
            <PersonCard key={t.id} id={t.id} name={t.name} badge={<Pill>Support teacher</Pill>}>
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
            </PersonCard>
          ))}
        </ul>
      )}
      {supports.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[16px] border border-dashed border-ms-border-strong p-3">
          <label htmlFor={`support-${room.id}`} className="inline-flex items-center gap-2 text-[14px] text-ms-fg-2">
            <UserPlus aria-hidden className="h-4 w-4 text-ms-primary-text" />
            Add support teacher
          </label>
          <select
            id={`support-${room.id}`}
            value={supportPick}
            onChange={(e) => setSupportPick(e.target.value)}
            className={SELECT}
          >
            <option value="">— choose —</option>
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
            className={PICK_BUTTON}
          >
            Add
          </button>
        </div>
      ) : null}
    </Fieldset>
  );
}
