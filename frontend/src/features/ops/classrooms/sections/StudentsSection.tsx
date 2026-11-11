"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, MoreHorizontal, UserPlus, Users } from "lucide-react";
import api, { classesApi } from "@/lib/api";
// The row menu stays the portalled DropdownMenu: the roster table scrolls sideways, and the console Menu
// (absolute, not portalled yet) would be cut off inside it.
import { DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Avatar, TextInput, buttonClass } from "@/features/console/ui";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { formatUzs } from "@/features/finance/financeApi";
import type { PeoplePage, PublicRow, StudentRow } from "@/features/ops/changelist/peopleApi";
import { formatDate } from "@/features/ops/users/peopleColumns";
import {
  Fieldset,
  LINK_CLASS,
  PartBody,
  Pill,
  Table,
  Td,
  TONE_TEXT,
  WIDE_ONLY,
  type Column,
} from "@/features/ops/people/Fieldset";
import { formatDay } from "@/features/ops/people/format";
import { rateTone } from "@/features/ops/people/PersonHeader";
import { serverReason, useClassroomPart, type ClassroomCore, type ClassroomRoster } from "../classroomsApi";
import type { SeatAction, SeatStatus } from "../seatsApi";
import { AddSeatDialog, NewStudentDialog, SeatActionDialog } from "./SeatDialogs";

/**
 * The class's students, each with their seat, photo, what they owe and how they are doing here — a
 * debt in red, a rate in the colour of its verdict. While lc-up runs a class that follows it offers
 * no add or remove (the server refuses both), and any other class adds by search and removes here,
 * with no money. Once lc-up is off (`room.seats_open`) a seat is the admin's: add, new student, and
 * per row the actions that fit it, each writing the seat and the ledger together.
 */

/** The console's 36 px secondary button, for rows and pickers. */
export const SMALL_BUTTON = buttonClass({ size: "sm" });

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

/** What fits each seat, in the order they read; the server refuses anything else anyway. */
const SEAT_ACTIONS: Record<SeatStatus, { action: SeatAction; label: string }[]> = {
  trial: [
    { action: "activate", label: "Activate" },
    { action: "move", label: "Move" },
    { action: "leave", label: "Leave" },
    { action: "fix-date", label: "Fix date" },
  ],
  active: [
    { action: "freeze", label: "Freeze" },
    { action: "move", label: "Move" },
    { action: "leave", label: "Leave" },
    { action: "fix-date", label: "Fix date" },
  ],
  frozen: [
    { action: "return", label: "Return" },
    { action: "leave", label: "Leave" },
    { action: "fix-date", label: "Fix date" },
  ],
};

/** Which date Fix date is about: the one the seat is standing on. */
const FIXED_DATE: Record<SeatStatus, string> = { trial: "Start date", active: "Start date", frozen: "Frozen from" };

type Found = (StudentRow | PublicRow) & { groups?: StudentRow["groups"] };

function AddStudent({
  room,
  onAdded,
  onChoose,
}: {
  room: ClassroomCore;
  onAdded: () => void;
  /** Once seats are open: asks trial or active and the date, rather than adding straight away. */
  onChoose?: (row: { id: number; name: string }) => void;
}) {
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const term = q.trim();
  const search = useQuery({
    queryKey: ["ops", "classrooms", room.id, "add-student", term, Boolean(onChoose)],
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Found[]> => {
      const read = async (section: string) =>
        (await api.get<PeoplePage<Found>>("/users/admin/people/", { params: { section, q: term, page_size: 25 } })).data.results;
      // Someone coming back is a public account by now; the server refuses one who was never at the centre.
      const lists = await Promise.all(onChoose ? [read("students"), read("public")] : [read("students")]);
      return lists.flat();
    },
  });
  // While lc-up runs the roster endpoint enrols student accounts only: a public learner joins through lc-up.
  const rows = (search.data ?? []).filter((r) => !(r.groups ?? []).some((g) => g.id === room.id)).slice(0, 8);

  const add = async (row: Found) => {
    if (onChoose) return onChoose({ id: row.id, name: row.name || row.username || "" });
    setBusy(true);
    try {
      await classesApi.addMember(room.id, row.id);
      push({ tone: "success", message: `Added ${row.name || row.username} to ${room.name}.` });
      setQ("");
      onAdded();
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "Could not add the student.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-[16px] border border-dashed border-ms-border-strong p-4">
      <label htmlFor={`add-student-${room.id}`} className="flex items-center gap-2 text-[14px] font-medium text-ms-fg">
        <UserPlus aria-hidden className="h-4 w-4 text-ms-primary-text" />
        Add student
      </label>
      <div className="mt-2 max-w-md">
        <TextInput
          id={`add-student-${room.id}`}
          icon="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, username or phone"
          autoComplete="off"
        />
      </div>
      {term.length < 2 ? null : search.isError ? (
        <p role="alert" className="mt-2 text-sm text-ms-fg-3">
          Could not search.{" "}
          <button type="button" className="font-semibold text-ms-primary-text hover:underline" onClick={() => void search.refetch()}>
            Retry
          </button>
        </p>
      ) : search.isPending ? (
        <p className="mt-2 text-sm text-ms-fg-3">Searching…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-ms-fg-3">No student matches “{term}”.</p>
      ) : (
        <ul className="mt-2 max-w-md divide-y divide-ms-line overflow-hidden rounded-ms-ctl border border-ms-border bg-ms-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar src={r.avatar_url ?? null} name={r.name || r.username || ""} size="sm" />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-medium text-ms-fg">{r.name || r.username}</span>
                  <span className="block truncate text-xs text-ms-fg-3">
                    {r.groups ? r.groups.map((g) => g.name).join(", ") || "no class" : "public account"}
                  </span>
                </span>
              </span>
              <button type="button" disabled={busy} onClick={() => void add(r)} className={SMALL_BUTTON}>
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The step a seat most often needs, and the rest behind a menu: four buttons on a row wrapped and pushed the table sideways. */
function SeatRowActions({
  name,
  status,
  onChoose,
}: {
  name: string;
  status: SeatStatus;
  onChoose: (action: SeatAction) => void;
}) {
  const [first, ...others] = SEAT_ACTIONS[status];
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <button type="button" onClick={() => onChoose(first.action)} className={SMALL_BUTTON}>
        {first.label}
      </button>
      <DropdownMenu
        portal
        trigger={
          <button type="button" aria-label={`More actions for ${name}`} className={buttonClass({ size: "sm", square: true })}>
            <MoreHorizontal aria-hidden className="h-4 w-4" />
          </button>
        }
      >
        {others.map(({ action, label }) => (
          <DropdownMenuItem key={action} destructive={action === "leave"} onClick={() => onChoose(action)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </span>
  );
}

type SeatDialog =
  | { kind: "action"; action: SeatAction; student: { id: number; name: string }; trial?: boolean; day?: string | null; dateLabel?: string }
  | { kind: "add"; student: { id: number; name: string } }
  | { kind: "new" };

export function StudentsSection({ room, onChanged }: { room: ClassroomCore; onChanged: () => void }) {
  const managed = room.lcup?.managed ?? false;
  const seatsOpen = room.seats_open ?? false;
  const query = useClassroomPart<ClassroomRoster>(room.id, "roster");
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<SeatDialog | null>(null);
  const done = () => {
    setDialog(null);
    onChanged();
  };

  const remove = async (id: number, name: string) => {
    setBusy(true);
    try {
      await classesApi.removeMember(room.id, id);
      push({ tone: "success", message: `Removed ${name} from ${room.name}.` });
      onChanged();
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "Could not remove the student.") });
    } finally {
      setBusy(false);
    }
  };

  // A phone keeps the name (its debt under it), attendance and the Remove button; the table fits.
  // Beside the seat actions a narrow screen also gives up what the person's page shows too, or the actions scroll off.
  const spare = seatsOpen ? "hidden xl:table-cell" : WIDE_ONLY;
  const head: Column[] = [
    "Name",
    { label: "Joined", className: spare },
    { label: "Owes", className: WIDE_ONLY },
    "Attendance",
    { label: "Homework", className: spare },
    ...(managed ? [] : [""]),
  ];

  return (
    <Fieldset
      title="Students"
      icon={Users}
      description="Who sits in this class, what they owe and how they are doing"
      right={
        seatsOpen ? (
          <button type="button" className={buttonClass({ size: "sm", variant: "primary" })} onClick={() => setDialog({ kind: "new" })}>
            <UserPlus aria-hidden className="h-4 w-4" />
            New student
          </button>
        ) : null
      }
    >
      {managed ? (
        <p className="mb-5 flex items-start gap-2.5 rounded-ms-ctl border border-ms-info-line bg-ms-info-soft px-3.5 py-3 text-[14px] text-ms-info-fg">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          Students come from lc-up. Add or remove them there.
        </p>
      ) : (
        <AddStudent
          room={room}
          onAdded={onChanged}
          onChoose={seatsOpen ? (student) => setDialog({ kind: "add", student }) : undefined}
        />
      )}
      <PartBody
        query={query}
        isEmpty={(d) => d.students.length === 0 && !(d.left ?? []).length}
        render={(d) => (
          <>
            {d.students.length > 0 ? (
              <Table head={head}>
                {d.students.map((s) => (
                  <tr key={s.id}>
                    <Td wrap className="sm:max-w-[18rem]">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar src={s.avatar_url ?? null} name={s.name || s.username} size="sm" />
                        <span className="min-w-0">
                          {/* Wrapped on a phone ("Muhammadali …" lost half the name), one line from sm up. */}
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:flex-nowrap">
                            <Link
                              href={`/ops/${s.section}/${s.id}`}
                              prefetch={false}
                              title={s.name || s.username}
                              className={cn(LINK_CLASS, "min-w-0 break-words sm:truncate")}
                            >
                              {s.name || s.username}
                            </Link>
                            {s.seat_status === "trial" ? <span className="shrink-0"><Pill tone="info">Trial</Pill></span> : null}
                            {s.seat_status === "frozen" ? <span className="shrink-0"><Pill tone="frozen">Frozen</Pill></span> : null}
                          </span>
                          {s.owes ? (
                            <span className="block text-xs font-semibold text-ms-critical-fg sm:hidden">owes {formatUzs(s.owes)}</span>
                          ) : null}
                        </span>
                      </span>
                    </Td>
                    <Td className={`${spare} tabular-nums text-ms-fg-3`}>
                      {s.seat_start_date ? formatDay(s.seat_start_date) : formatDate(s.joined_at)}
                    </Td>
                    <Td className={`${WIDE_ONLY} tabular-nums`}>
                      {s.owes ? (
                        <span className="font-semibold text-ms-critical-fg">{formatUzs(s.owes)}</span>
                      ) : (
                        <span className="text-ms-fg-3">—</span>
                      )}
                    </Td>
                    <Td className={cn("font-semibold tabular-nums", TONE_TEXT[rateTone(s.attendance_rate)])}>
                      {pct(s.attendance_rate)}
                    </Td>
                    <Td className={cn(spare, "font-semibold tabular-nums", TONE_TEXT[rateTone(s.homework_rate)])}>
                      {pct(s.homework_rate)}
                    </Td>
                    {managed ? null : seatsOpen ? (
                      <Td className="text-right">
                        <SeatRowActions
                          name={s.name || s.username}
                          status={s.seat_status ?? "active"}
                          onChoose={(action) =>
                            setDialog({
                              kind: "action",
                              action,
                              student: { id: s.id, name: s.name || s.username },
                              trial: s.seat_status === "trial",
                              ...(action === "fix-date"
                                ? { day: s.seat_status === "frozen" ? s.seat_frozen_on : s.seat_start_date, dateLabel: FIXED_DATE[s.seat_status ?? "active"] }
                                : {}),
                            })
                          }
                        />
                      </Td>
                    ) : (
                      <Td className="text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(s.id, s.name || s.username)}
                          className={SMALL_BUTTON}
                        >
                          Remove
                        </button>
                      </Td>
                    )}
                  </tr>
                ))}
              </Table>
            ) : null}
            {seatsOpen && (d.left ?? []).length > 0 ? (
              <div className="mt-5">
                <h3 className="text-ms-over mb-2 text-ms-fg-3">Left this group</h3>
                <Table head={["Name", "Last day", ""]}>
                  {d.left.map((s) => (
                    <tr key={s.id}>
                      <Td wrap>
                        <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} className={LINK_CLASS}>
                          {s.name}
                        </Link>
                      </Td>
                      <Td className="tabular-nums text-ms-fg-3">{formatDay(s.seat_left_on)}</Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          onClick={() =>
                            setDialog({
                              kind: "action",
                              action: "fix-date",
                              student: { id: s.id, name: s.name },
                              day: s.seat_left_on,
                              dateLabel: "Last day",
                            })
                          }
                        >
                          Fix date
                        </button>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            ) : null}
          </>
        )}
      />
      {dialog?.kind === "action" ? (
        <SeatActionDialog
          roomId={room.id}
          student={dialog.student}
          action={dialog.action}
          trial={dialog.trial}
          day={dialog.day}
          dateLabel={dialog.dateLabel}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "add" ? (
        <AddSeatDialog roomId={room.id} student={dialog.student} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === "new" ? (
        <NewStudentDialog roomId={room.id} onClose={() => setDialog(null)} onDone={onChanged} />
      ) : null}
    </Fieldset>
  );
}
