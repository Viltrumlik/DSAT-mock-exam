"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Plus, UserRound, Users } from "lucide-react";
import api from "@/lib/api";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { Fieldset, LINK_CLASS, SubHeading } from "../Fieldset";
import type { PersonCore } from "../personApi";

/**
 * The classes a learner sits in, one card each. A class paired with lc-up is read-only here — its
 * students come and go in lc-up, and the server refuses (409) a change the sync would undo. Any
 * other class can be left or joined from this page.
 */

const SUBJECT: Record<string, { label: string; variant: "primary" | "accent" }> = {
  MATH: { label: "Math", variant: "primary" },
  ENGLISH: { label: "English", variant: "accent" },
};

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

  const n = person.groups.length;

  return (
    <Fieldset
      title="Groups"
      icon={Users}
      description={n === 0 ? "Not in any class" : `In ${n} class${n === 1 ? "" : "es"}`}
    >
      {n === 0 ? (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-muted-foreground">Not in any class.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {person.groups.map((g) => {
            const subject = SUBJECT[g.subject];
            return (
              <li key={g.id} data-testid="group-card" className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/ops/classrooms/${g.id}`} prefetch={false} className={`${LINK_CLASS} min-w-0 text-base`}>
                    {g.name}
                  </Link>
                  {subject ? <Badge variant={subject.variant}>{subject.label}</Badge> : null}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UserRound aria-hidden className="h-3.5 w-3.5" />
                      Teacher
                    </dt>
                    <dd className="mt-0.5 truncate font-medium">{g.teacher || "—"}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                      Joined
                    </dt>
                    <dd className="mt-0.5 font-medium tabular-nums">{formatDate(g.joined_at)}</dd>
                  </div>
                </dl>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  {g.lcup_managed ? (
                    <>
                      <Badge variant="info">Synced from lc-up</Badge>
                      <span className="text-xs text-muted-foreground">Change in lc-up</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">Managed here</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(g.id, g.name)}
                        className="h-8 rounded-lg border border-danger/30 px-3 text-sm font-medium text-danger hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Students only. The roster endpoint enrols student accounts alone, and the owner's rule is that a
          public learner who joins the centre gets a NEW account from lc-up, not a seat for the old one. */}
      {person.section === "students" && person.open_classes.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-border p-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor={`add-class-${person.id}`} className="block text-sm font-medium text-foreground">
              Add to class
            </label>
            <select
              id={`add-class-${person.id}`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Choose a class not run by lc-up</option>
              {person.open_classes.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy || !pick}
            onClick={add}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Add
          </button>
        </div>
      ) : null}

      {person.past_groups.length > 0 ? (
        <div className="mt-6">
          <SubHeading>Earlier groups</SubHeading>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {person.past_groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link href={`/ops/classrooms/${g.id}`} prefetch={false} className={`${LINK_CLASS} min-w-0 truncate`}>
                  {g.name}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  left {g.left_at ? formatDate(g.left_at) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Fieldset>
  );
}
