"use client";

import { useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { Fieldset, LINK_CLASS, SubHeading, Table, Td, WIDE_ONLY } from "../Fieldset";
import type { PersonCore } from "../personApi";

/**
 * The classes a learner sits in. A class paired with lc-up is read-only here — its students
 * come and go in lc-up, and the server refuses (409) a change the sync would undo. Any other
 * class can be left or joined from this page.
 */

const BUTTON =
  "h-7 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

function serverDetail(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : null;
}

export function GroupsSection({ person, onChanged }: { person: PersonCore; onChanged: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");

  const run = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await call();
      push({ tone: "success", message: done });
      setPick("");
      onChanged();
    } catch (err) {
      push({ tone: "error", message: serverDetail(err) ?? "That did not go through. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const remove = (classId: number, name: string) =>
    void run(() => api.patch(`/classes/${classId}/members/${person.id}/`, { status: "REMOVED" }), `Removed from ${name}.`);

  const add = () => {
    const room = person.open_classes.find((c) => String(c.id) === pick);
    if (!room) return;
    void run(() => api.post(`/classes/${room.id}/members/`, { user_id: person.id }), `Added to ${room.name}.`);
  };

  return (
    <Fieldset title="Groups">
      {person.groups.length === 0 ? (
        <p className="text-muted-foreground">Not in any class.</p>
      ) : (
        <Table head={["Class", { label: "Teacher", className: WIDE_ONLY }, { label: "Joined", className: WIDE_ONLY }, ""]}>
          {person.groups.map((g) => (
            <tr key={g.id}>
              <Td className="max-w-[12rem] truncate sm:max-w-[14rem]">
                <Link href={`/ops/classrooms/${g.id}`} prefetch={false} className={LINK_CLASS}>
                  {g.name}
                </Link>
              </Td>
              <Td className={`${WIDE_ONLY} text-muted-foreground`}>{g.teacher || "—"}</Td>
              <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>{formatDate(g.joined_at)}</Td>
              <Td className="text-right">
                {g.lcup_managed ? (
                  <span className="text-muted-foreground">Change in lc-up</span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => remove(g.id, g.name)} className={BUTTON}>
                    Remove
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {/* Students only. The roster endpoint enrols student accounts alone, and the owner's rule is that a
          public learner who joins the centre gets a NEW account from lc-up, not a seat for the old one. */}
      {person.section === "students" && person.open_classes.length > 0 ? (
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`add-class-${person.id}`} className="text-muted-foreground">
              Add to class
            </label>
            <select
              id={`add-class-${person.id}`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-7 min-w-0 max-w-full rounded-md border border-border bg-card px-1.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">---------</option>
              {person.open_classes.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !pick} onClick={add} className={BUTTON}>
              Add
            </button>
          </div>
        </div>
      ) : null}

      {person.past_groups.length > 0 ? (
        <div className="mt-4">
          <SubHeading>Earlier groups</SubHeading>
          <ul className="space-y-0.5">
            {person.past_groups.map((g) => (
              <li key={g.id}>
                <Link href={`/ops/classrooms/${g.id}`} prefetch={false} className={LINK_CLASS}>
                  {g.name}
                </Link>
                <span className="text-muted-foreground"> · left {g.left_at ? formatDate(g.left_at) : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Fieldset>
  );
}
