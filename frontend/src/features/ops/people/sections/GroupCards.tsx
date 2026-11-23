"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { Badge, Button, CourseTag, Menu, Select, courseLevelOf, courseName, signedAmount, type MenuItem } from "@/features/console/ui";
import { AddSeatDialog, SeatActionDialog } from "@/features/ops/classrooms/sections/SeatDialogs";
import type { SeatAction } from "@/features/ops/classrooms/seatsApi";
import { dayText, daysText, groupTitle } from "@/features/ops/detail/groupFacts";
import { LINK_CLASS } from "../Fieldset";
import type { PersonCore, PersonGroup } from "../personApi";

/**
 * The profile's Groups tab, lc-up's "Guruhlar" (StudentProfile board, 22 Nov 2026): one card per group — its name as
 * a course tag, the seat's state, "Attendance & marks", and a ⋮ with take payment / freeze / remove — over a grid of
 * the group's facts. Every action is one the console already had: the seat tools (`classes/views_seats`, open once
 * lc-up is off), the old remove of a seat not run by lc-up, the ledger's payment. A group lc-up runs says so.
 */

const SEAT: Record<string, { label: string; tone: "positive" | "info" | "frozen" }> = {
  active: { label: "Active", tone: "positive" },
  trial: { label: "Trial", tone: "info" },
  frozen: { label: "Frozen", tone: "frozen" },
};

function serverDetail(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : null;
}

function Fact({ label, children, edit }: { label: string; children: ReactNode; edit?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ms-fg-3">{label}</dt>
      <dd className="m-0 mt-0.5 flex min-h-7 items-center gap-1 font-medium text-ms-fg">
        <span className="min-w-0 break-words">{children}</span>
        {edit}
      </dd>
    </div>
  );
}

type SeatStep = { action: SeatAction; group: PersonGroup; day?: string | null; dateLabel?: string };

export function GroupCards({
  person,
  onChanged,
  onAttendance,
  onPay,
  adding,
  onAdding,
}: {
  person: PersonCore;
  onChanged: () => void;
  /** "Attendance & marks": the profile's Attendance tab. */
  onAttendance: () => void;
  /** Take payment for this group, when the viewer may and the ledger takes money. */
  onPay?: (groupName: string) => void;
  /** The add-to-group picker is open (the left card's ⋮ "Add to group" opens it). */
  adding: boolean;
  onAdding: (open: boolean) => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [step, setStep] = useState<SeatStep | null>(null);
  /** Once lc-up is off: the class whose seat is being given, with its status and start date (AddSeatDialog). */
  const [seatIn, setSeatIn] = useState<{ id: number; name: string } | null>(null);
  const seatsOpen = person.seats_open ?? false;
  const student = { id: person.id, name: person.name || person.username };

  const run = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await call();
      push({ tone: "success", message: done });
      setPick(null);
      onAdding(false);
      onChanged();
    } catch (err) {
      push({ tone: "error", message: serverDetail(err) ?? "That did not go through. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const remove = (g: PersonGroup) =>
    void run(() => api.patch(`/classes/${g.id}/members/${person.id}/`, { status: "REMOVED" }), `Removed from ${g.name}.`);

  const add = () => {
    const room = person.open_classes.find((c) => String(c.id) === pick);
    if (!room) return;
    // After lc-up a seat starts its money on a date, trial or paid: the seat tools, never the bare roster add.
    if (seatsOpen) {
      setSeatIn({ id: room.id, name: room.name });
      return;
    }
    void run(() => api.post(`/classes/${room.id}/members/`, { user_id: person.id }), `Added to ${room.name}.`);
  };

  /** The card's ⋮: take payment, then the seat's own step (freeze / return / activate), then remove. */
  const itemsFor = (g: PersonGroup): MenuItem[] => {
    const items: MenuItem[] = [];
    if (onPay) items.push({ label: "Take payment", icon: "ms-paid", onSelect: () => onPay(g.name) });
    const status = g.seat_status ?? "active";
    if (seatsOpen) {
      if (status === "active") items.push({ label: "Freeze", icon: "snow", onSelect: () => setStep({ action: "freeze", group: g }) });
      if (status === "frozen") items.push({ label: "Return", icon: "undo", onSelect: () => setStep({ action: "return", group: g }) });
      if (status === "trial") items.push({ label: "Activate", icon: "check", onSelect: () => setStep({ action: "activate", group: g }) });
      items.push({ label: "Remove from group", icon: "trash", danger: true, onSelect: () => setStep({ action: "leave", group: g }) });
    } else if (!g.lcup_managed) {
      items.push({ label: "Remove from group", icon: "trash", danger: true, onSelect: () => remove(g) });
    }
    return items;
  };

  const n = person.groups.length;

  return (
    <section aria-label="Groups" className="flex flex-col gap-4">
      {n === 0 ? <p className="rounded-ms-ctl bg-ms-surface px-4 py-3 text-ms-fg-2">Not in any class.</p> : null}
      {person.groups.map((g) => {
        const seat = SEAT[g.seat_status ?? ""];
        const items = itemsFor(g);
        const level = courseLevelOf(g.level, g.name);
        const course = courseName(g.level, g.subject);
        // ✎ on the activation date only where a tool changes it: the seat's Fix date, once lc-up is off.
        const fixable = seatsOpen && (g.seat_status === "active" || g.seat_status === "trial");
        return (
          <article key={g.id} data-testid="group-card" className="flex flex-col gap-3.5 rounded-ms-card border border-ms-border p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href={`/ops/classrooms/${g.id}`} prefetch={false} className="min-w-0 max-w-full">
                <CourseTag level={level} size="lg">
                  {groupTitle(g.name, g.teacher)}
                </CourseTag>
              </Link>
              {seat ? (
                <Badge tone={seat.tone} dot={seat.tone === "positive"}>
                  {seat.label}
                </Badge>
              ) : null}
              {g.lcup_managed ? <Badge tone="line" icon="ms-sync">Synced from lc-up</Badge> : null}
              <span className="flex-1" />
              <Button size="sm" icon="calcheck" onClick={onAttendance}>
                Attendance &amp; marks
              </Button>
              {items.length ? (
                <Menu label={`Group actions for ${g.name}`} items={items} disabled={busy} />
              ) : null}
            </div>
            <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-5 gap-y-3 text-[14px]">
              <Fact label="Teacher">{g.teacher || "—"}</Fact>
              {g.lesson_days ? <Fact label="Days">{daysText(g.lesson_days)}</Fact> : null}
              {g.lesson_time ? <Fact label="Time">{g.lesson_time.replace("-", "–")}</Fact> : null}
              {course ? <Fact label="Course">{course}</Fact> : null}
              {g.monthly_price != null ? <Fact label="Group price">{signedAmount(g.monthly_price)} so&apos;m</Fact> : null}
              {g.start_date ? <Fact label="Group starts">{dayText(g.start_date)}</Fact> : null}
              <Fact label="Joined the group">{dayText(g.joined_at)}</Fact>
              {g.seat_start_date || fixable ? (
                <Fact
                  label="Activated in the group"
                  edit={
                    fixable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="pencil"
                        aria-label="Change Activated in the group"
                        onClick={() => setStep({ action: "fix-date", group: g, day: g.seat_start_date, dateLabel: "Activated in the group" })}
                      />
                    ) : null
                  }
                >
                  {dayText(g.seat_start_date)}
                </Fact>
              ) : null}
            </dl>
            {g.lcup_managed && !seatsOpen ? <p className="text-[13px] text-ms-fg-3">lc-up runs this seat: change it in lc-up.</p> : null}
          </article>
        );
      })}

      {/* Students only: the roster endpoint enrols student accounts alone (a public learner joins through lc-up). */}
      {person.section === "students" && person.open_classes.length > 0 ? (
        adding ? (
          <div className="flex flex-col gap-3 rounded-ms-card border border-dashed border-ms-border-strong p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <span className="block text-[14px] font-medium leading-5 text-ms-fg">Add to another group</span>
              <Select<string>
                aria-label="Add to another group"
                value={pick}
                onChange={setPick}
                placeholder={seatsOpen ? "Choose a class" : "Choose a class not run by lc-up"}
                options={person.open_classes.map((c) => ({ value: String(c.id), label: c.name }))}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onAdding(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" icon="plus" disabled={busy || !pick} onClick={add}>
                Add
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="subtle" size="sm" icon="plus" className="self-start" onClick={() => onAdding(true)}>
            Add to another group
          </Button>
        )
      ) : null}

      {person.past_groups.length > 0 ? (
        <div>
          <h3 className="text-ms-over mb-2 text-ms-fg-3">Earlier groups</h3>
          <ul className="divide-y divide-ms-line rounded-ms-card border border-ms-border">
            {person.past_groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link href={`/ops/classrooms/${g.id}`} prefetch={false} className={`${LINK_CLASS} min-w-0 truncate`}>
                  {g.name}
                </Link>
                <span className="shrink-0 text-[13px] text-ms-fg-3">left {dayText(g.left_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step ? (
        <SeatActionDialog
          roomId={step.group.id}
          student={student}
          action={step.action}
          trial={step.group.seat_status === "trial"}
          day={step.day}
          dateLabel={step.dateLabel}
          onClose={() => setStep(null)}
          onDone={() => {
            setStep(null);
            onChanged();
          }}
        />
      ) : null}
      {seatIn ? (
        <AddSeatDialog
          roomId={seatIn.id}
          student={student}
          onClose={() => setSeatIn(null)}
          onDone={() => {
            push({ tone: "success", message: `Added to ${seatIn.name}.` });
            setSeatIn(null);
            setPick(null);
            onAdding(false);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
