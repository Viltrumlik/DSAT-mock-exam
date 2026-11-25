"use client";

import { useState, type ReactNode } from "react";
import { inputShell } from "@/features/console/ui";
import { shortDay } from "@/features/ops/detail/groupFacts";
import { ConfirmDialog } from "@/features/ops/people/ConfirmDialog";
import { serverReason } from "../classroomsApi";
import {
  cancelLesson,
  givenBackLine,
  moveLesson,
  netLine,
  setHoliday,
  undoLessonChange,
  type LessonChangeResult,
} from "../lessonChangesApi";
import { todayIso } from "../seatsApi";

/**
 * Cancel a lesson, move it, set a centre holiday, undo one (owner, 2026-11-25). Each asks for a reason, keeps the
 * server's refusal on screen, and once it went through says what it did to the money.
 */

const INPUT = inputShell({ className: "w-full outline-none placeholder:text-ms-fg-3" });
const REASON_MAX = 300;

function Refusal({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="animate-ms-fade-in rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2 text-[14px] text-ms-critical-fg">
      {text}
    </p>
  ) : null;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-[14px] font-medium text-ms-fg">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Labelled label="Reason">
      <textarea
        rows={2}
        maxLength={REASON_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Why, for the history and the ledger"
        className={INPUT}
      />
    </Labelled>
  );
}

/** One change's form: a reason (and a day where asked), then the money line it ends with. */
function useChange(send: () => Promise<LessonChangeResult>, ready: () => string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LessonChangeResult | null>(null);
  const submit = async () => {
    const missing = ready();
    if (missing) return setError(missing);
    setBusy(true);
    setError(null);
    try {
      setDone(await send());
    } catch (e: unknown) {
      setError(serverReason(e, "That did not go through. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, submit };
}

/** What a change did, once it went through: its lines, then Done. */
function Done({ title, lines, onDone }: { title: string; lines: string[]; onDone: () => void }) {
  const body = (
    <div role="status" className="space-y-1">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
  return <ConfirmDialog title={title} body={body} confirmLabel="Done" cancelLabel={null} busy={false} onCancel={onDone} onConfirm={onDone} />;
}

const needReason = (reason: string) => (reason.trim() ? null : "A lesson change needs a reason.");

export function CancelLessonDialog({
  roomId,
  day,
  onClose,
  onDone,
}: {
  roomId: number;
  /** "YYYY-MM-DD": the lesson called off. */
  day: string;
  onClose: () => void;
  /** It went through: the page reloads what it shows. */
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const change = useChange(() => cancelLesson(roomId, { day, reason: reason.trim() }), () => needReason(reason));
  if (change.done) return <Done title={`Lesson of ${shortDay(day)} cancelled`} lines={[givenBackLine(change.done.money)]} onDone={onDone} />;
  return (
    <ConfirmDialog
      title={`Cancel the lesson of ${shortDay(day)}?`}
      confirmLabel="Cancel lesson"
      cancelLabel="Back"
      danger
      busy={change.busy}
      onCancel={() => (change.busy ? undefined : onClose())}
      onConfirm={() => void change.submit()}
      body={
        <>
          <p>That day is not charged. A lesson already charged for it is given back, and the reason stays on the row.</p>
          <ReasonField value={reason} onChange={setReason} />
          <Refusal text={change.error} />
        </>
      }
    />
  );
}

export function MoveLessonDialog({
  roomId,
  day,
  onClose,
  onDone,
}: {
  roomId: number;
  /** "YYYY-MM-DD": the lesson moved. */
  day: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newDay, setNewDay] = useState("");
  const [reason, setReason] = useState("");
  const change = useChange(
    () => moveLesson(roomId, { day, new_day: newDay, reason: reason.trim() }),
    () => (newDay ? needReason(reason) : "Choose the day it moves to."),
  );
  if (change.done) {
    const to = change.done.change.new_day ?? newDay;
    // Charged only when the money says so: a month-paid class, a new student's first month or a day still ahead is
    // only held there (charged on the day, if at all).
    const when = change.done.money.charged ? `Charged on ${shortDay(to)}` : `Held on ${shortDay(to)}`;
    return <Done title={`Lesson moved to ${shortDay(to)}`} lines={[when, netLine(change.done.money)]} onDone={onDone} />;
  }
  return (
    <ConfirmDialog
      title={`Move the lesson of ${shortDay(day)}?`}
      confirmLabel="Move lesson"
      cancelLabel="Back"
      busy={change.busy}
      onCancel={() => (change.busy ? undefined : onClose())}
      onConfirm={() => void change.submit()}
      body={
        <>
          <p>It is charged once, on the new day. {shortDay(day)} is not charged, and a lesson already charged for it is given back.</p>
          <Labelled label="New day">
            <input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} className={INPUT} />
          </Labelled>
          <ReasonField value={reason} onChange={setReason} />
          <Refusal text={change.error} />
        </>
      }
    />
  );
}

export function HolidayDialog({
  day,
  onClose,
  onDone,
}: {
  /** Where the date starts: the day on screen, else today. */
  day?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(day ?? todayIso());
  const [reason, setReason] = useState("");
  const change = useChange(
    () => setHoliday({ day: date, reason: reason.trim() }),
    () => (date ? needReason(reason) : "Choose the day."),
  );
  if (change.done) return <Done title={`${shortDay(date)} is a centre holiday`} lines={[givenBackLine(change.done.money)]} onDone={onDone} />;
  return (
    <ConfirmDialog
      title="Set a centre holiday"
      confirmLabel="Set holiday"
      cancelLabel="Back"
      busy={change.busy}
      onCancel={() => (change.busy ? undefined : onClose())}
      onConfirm={() => void change.submit()}
      body={
        <>
          <p>Every group with a lesson that day has it cancelled. Lessons already charged for it are given back.</p>
          <Labelled label="Day">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </Labelled>
          <ReasonField value={reason} onChange={setReason} />
          <Refusal text={change.error} />
        </>
      }
    />
  );
}

/** What an undo will do, in words: the day is held and charged again. */
function undoWords(change: { kind: string; day: string; new_day?: string | null; holiday?: boolean }): string {
  if (change.kind === "move" && change.new_day) {
    return `The lesson goes back to ${shortDay(change.day)} and is charged then, not on ${shortDay(change.new_day)}.`;
  }
  if (change.holiday) return `Every group's lesson on ${shortDay(change.day)} is held and charged again.`;
  return `The lesson of ${shortDay(change.day)} is held and charged again.`;
}

export function UndoChangeDialog({
  change,
  onClose,
  onDone,
}: {
  change: { id: number; kind: string; day: string; new_day?: string | null; holiday?: boolean };
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LessonChangeResult | null>(null);
  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await undoLessonChange(change.id));
    } catch (e: unknown) {
      setError(serverReason(e, "That did not go through. Try again."));
    } finally {
      setBusy(false);
    }
  };
  if (done) return <Done title="Change undone" lines={[netLine(done.money)]} onDone={onDone} />;
  return (
    <ConfirmDialog
      title="Undo this change?"
      confirmLabel="Undo"
      cancelLabel="Back"
      busy={busy}
      onCancel={() => (busy ? undefined : onClose())}
      onConfirm={() => void undo()}
      body={
        <>
          <p>{undoWords(change)} Nothing is deleted: the change and its reason stay in the history.</p>
          <Refusal text={error} />
        </>
      }
    />
  );
}
