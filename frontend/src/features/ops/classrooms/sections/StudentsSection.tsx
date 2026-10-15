"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import api, { classesApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { formatUzs } from "@/features/finance/financeApi";
import type { PeoplePage, StudentRow } from "@/features/ops/changelist/peopleApi";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { Fieldset, LINK_CLASS, PartBody, Table, Td, WIDE_ONLY, type Column } from "@/features/ops/people/Fieldset";
import { serverReason, useClassroomPart, type ClassroomCore, type ClassroomRoster } from "../classroomsApi";

/**
 * The class's students: what each owes, their attendance and homework here. A class that follows
 * an lc-up group takes its students from lc-up, so it offers no add or remove (the server refuses
 * both); any other class adds students by search and removes them here.
 */

export const SMALL_BUTTON =
  "h-7 rounded-md border border-border bg-card px-2 text-[13px] text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

function AddStudent({ room, onAdded }: { room: ClassroomCore; onAdded: () => void }) {
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const term = q.trim();
  const search = useQuery({
    queryKey: ["ops", "classrooms", room.id, "add-student", term],
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<PeoplePage<StudentRow>>("/users/admin/people/", { params: { section: "students", q: term, page_size: 25 } }))
        .data,
  });
  // The roster endpoint enrols student accounts only; a public learner joins the centre through lc-up.
  const rows = (search.data?.results ?? []).filter((r) => !r.groups.some((g) => g.id === room.id)).slice(0, 8);

  const add = async (row: StudentRow) => {
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
    <div className="mb-3 space-y-1.5">
      <label htmlFor={`add-student-${room.id}`} className="block text-xs text-muted-foreground">
        Add student
      </label>
      <input
        id={`add-student-${room.id}`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, username or phone"
        autoComplete="off"
        className="h-8 w-full max-w-sm rounded-md border border-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      {term.length < 2 ? null : search.isError ? (
        <p className="text-muted-foreground">Could not search. Try again.</p>
      ) : search.isPending ? (
        <p className="text-muted-foreground">Searching…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">No student matches “{term}”.</p>
      ) : (
        <ul className="max-w-sm divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="min-w-0 truncate">
                {r.name || r.username}
                <span className="text-muted-foreground"> · {r.groups.map((g) => g.name).join(", ") || "no class"}</span>
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

export function StudentsSection({ room, onChanged }: { room: ClassroomCore; onChanged: () => void }) {
  const managed = room.lcup?.managed ?? false;
  const query = useClassroomPart<ClassroomRoster>(room.id, "roster");
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

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

  const head: Column[] = [
    "Name",
    { label: "Joined", className: WIDE_ONLY },
    "Owes",
    "Attendance",
    { label: "Homework", className: WIDE_ONLY },
    ...(managed ? [] : [""]),
  ];

  return (
    <Fieldset title="Students">
      {managed ? (
        <p className="mb-2 text-muted-foreground">Students come from lc-up. Add or remove them there.</p>
      ) : (
        <AddStudent room={room} onAdded={onChanged} />
      )}
      <PartBody
        query={query}
        isEmpty={(d) => d.students.length === 0}
        render={(d) => (
          <Table head={head}>
            {d.students.map((s) => (
              <tr key={s.id}>
                <Td className="max-w-[9rem] truncate sm:max-w-[16rem]">
                  <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} className={LINK_CLASS}>
                    {s.name || s.username}
                  </Link>
                </Td>
                <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>{formatDate(s.joined_at)}</Td>
                <Td className="tabular-nums">
                  {s.owes ? <span className="text-danger">{formatUzs(s.owes)}</span> : <span className="text-muted-foreground">—</span>}
                </Td>
                <Td className="tabular-nums">{pct(s.attendance_rate)}</Td>
                <Td className={`${WIDE_ONLY} tabular-nums`}>{pct(s.homework_rate)}</Td>
                {managed ? null : (
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
        )}
      />
    </Fieldset>
  );
}
