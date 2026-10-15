"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, Search, UserPlus, Users } from "lucide-react";
import api, { classesApi } from "@/lib/api";
import { Avatar } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { formatUzs } from "@/features/finance/financeApi";
import type { PeoplePage, StudentRow } from "@/features/ops/changelist/peopleApi";
import { formatDate } from "@/features/ops/users/peopleColumns";
import {
  Fieldset,
  LINK_CLASS,
  PartBody,
  Table,
  Td,
  TONE_TEXT,
  WIDE_ONLY,
  type Column,
} from "@/features/ops/people/Fieldset";
import { rateTone } from "@/features/ops/people/PersonHeader";
import { serverReason, useClassroomPart, type ClassroomCore, type ClassroomRoster } from "../classroomsApi";

/**
 * The class's students, each with their photo, what they owe and how they are doing here — a debt
 * in red, a rate in the colour of its verdict. A class that follows an lc-up group takes its
 * students from lc-up, so it offers no add or remove (the server refuses both); any other class
 * adds students by search and removes them here.
 */

export const SMALL_BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

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
    <div className="mb-5 rounded-xl border border-dashed border-border p-4">
      <label htmlFor={`add-student-${room.id}`} className="flex items-center gap-2 text-sm font-medium text-foreground">
        <UserPlus aria-hidden className="h-4 w-4 text-primary" />
        Add student
      </label>
      <div className="relative mt-2 max-w-md">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`add-student-${room.id}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, username or phone"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </div>
      {term.length < 2 ? null : search.isError ? (
        <p className="mt-2 text-sm text-muted-foreground">Could not search. Try again.</p>
      ) : search.isPending ? (
        <p className="mt-2 text-sm text-muted-foreground">Searching…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No student matches “{term}”.</p>
      ) : (
        <ul className="mt-2 max-w-md divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar src={r.avatar_url ?? null} name={r.name || r.username || ""} size={28} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-medium text-foreground">{r.name || r.username}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.groups.map((g) => g.name).join(", ") || "no class"}
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

  // A phone keeps the name (its debt under it), attendance and the Remove button; the table fits.
  const head: Column[] = [
    "Name",
    { label: "Joined", className: WIDE_ONLY },
    { label: "Owes", className: WIDE_ONLY },
    "Attendance",
    { label: "Homework", className: WIDE_ONLY },
    ...(managed ? [] : [""]),
  ];

  return (
    <Fieldset title="Students" icon={Users} description="Who sits in this class, what they owe and how they are doing">
      {managed ? (
        <p className="mb-5 flex items-start gap-2.5 rounded-lg border border-info/20 bg-info-soft px-3.5 py-3 text-sm text-info-foreground">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          Students come from lc-up. Add or remove them there.
        </p>
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
                <Td wrap className="sm:max-w-[18rem]">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar src={s.avatar_url ?? null} name={s.name || s.username} size={28} />
                    <span className="min-w-0">
                      {/* Wrapped on a phone ("Muhammadali …" lost half the name), one line from sm up. */}
                      <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} className={cn(LINK_CLASS, "break-words sm:truncate")}>
                        {s.name || s.username}
                      </Link>
                      {s.owes ? (
                        <span className="block text-xs font-semibold text-danger sm:hidden">owes {formatUzs(s.owes)}</span>
                      ) : null}
                    </span>
                  </span>
                </Td>
                <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>{formatDate(s.joined_at)}</Td>
                <Td className={`${WIDE_ONLY} tabular-nums`}>
                  {s.owes ? (
                    <span className="font-semibold text-danger">{formatUzs(s.owes)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td className={cn("font-semibold tabular-nums", TONE_TEXT[rateTone(s.attendance_rate)])}>
                  {pct(s.attendance_rate)}
                </Td>
                <Td className={cn(WIDE_ONLY, "font-semibold tabular-nums", TONE_TEXT[rateTone(s.homework_rate)])}>
                  {pct(s.homework_rate)}
                </Td>
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
