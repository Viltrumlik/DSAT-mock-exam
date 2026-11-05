"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Field, Input, Modal, Select } from "@/components/ui";
import { ConfirmDialog } from "@/features/ops/people/ConfirmDialog";
import { formatPhone } from "@/features/ops/people/format";
import { serverReason } from "../classroomsApi";
import {
  activeClassrooms,
  addSeat,
  createStudent,
  seatAction,
  todayIso,
  type PhoneHolder,
  type SeatAction,
} from "../seatsApi";

/**
 * The steps before a seat changes: each asks for the date, with today as the default, and keeps the server's
 * reason on screen when it refuses. The server says what fits the seat; these only ask.
 */

const INPUT =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function Reason({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-foreground">
      {text}
    </p>
  ) : null;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

const WORDS: Record<SeatAction, { title: (name: string) => string; confirm: string; date: string; body: string; danger?: boolean }> = {
  activate: {
    title: (name) => `Activate ${name}?`,
    confirm: "Activate",
    date: "Paying from",
    body: "From this date they pay for the lessons left this month, and the whole month after that.",
  },
  freeze: {
    title: (name) => `Freeze ${name}?`,
    confirm: "Freeze",
    date: "Frozen from",
    body: "The lessons up to this date are paid. Nothing is charged after it until they return.",
  },
  return: {
    title: (name) => `${name} returns?`,
    confirm: "Return",
    date: "Back from",
    body: "They pay for the lessons from this date on.",
  },
  move: {
    title: (name) => `Move ${name} to another group?`,
    confirm: "Move",
    date: "Moving on",
    body: "They leave this group and join the other on this date. A trial stays a trial.",
  },
  leave: {
    title: (name) => `${name} leaves this group?`,
    confirm: "Leave",
    date: "Last day",
    body: "The lessons up to this date are paid and the rest goes back to their balance. Leaving their last group makes them a public account, frozen if they owe.",
    danger: true,
  },
  "fix-date": {
    title: (name) => `Fix ${name}'s date`,
    confirm: "Fix date",
    date: "The right date",
    body: "Any money this date moved is voided and written again. The old rows stay visible.",
  },
};

export function SeatActionDialog({
  roomId,
  student,
  action,
  day,
  dateLabel,
  words,
  onClose,
  onDone,
}: {
  roomId: number;
  student: { id: number; name: string };
  action: SeatAction;
  /** Where the date starts: today, unless the date being fixed is known. */
  day?: string | null;
  dateLabel?: string;
  /** The page's own wording of the same action (/ops/trials: "Remove"). */
  words?: { title: string; confirm: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const said = WORDS[action];
  const [date, setDate] = useState(day ?? todayIso());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rooms = useQuery({
    queryKey: ["ops", "classrooms", "active-names"],
    queryFn: activeClassrooms,
    enabled: action === "move",
  });

  const confirm = async () => {
    if (action === "move" && !target) return setError("Choose the group to move them to.");
    setBusy(true);
    setError(null);
    try {
      await seatAction(roomId, student.id, action, action === "move" ? { date, to_classroom: Number(target) } : { date });
      onDone();
    } catch (e: unknown) {
      setError(serverReason(e, "That did not go through. Try again."));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title={words?.title ?? said.title(student.name)}
      confirmLabel={words?.confirm ?? said.confirm}
      danger={said.danger}
      busy={busy}
      onCancel={() => (busy ? undefined : onClose())}
      onConfirm={() => void confirm()}
      body={
        <>
          <p>{said.body}</p>
          <Labelled label={dateLabel ?? said.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </Labelled>
          {action === "move" ? (
            rooms.isError ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-foreground">
                Could not load the groups.{" "}
                <button type="button" className="font-semibold hover:underline" onClick={() => void rooms.refetch()}>
                  Retry
                </button>
              </p>
            ) : rooms.isPending ? (
              <p>Loading the groups…</p>
            ) : (
              <Labelled label="To group">
                <select value={target} onChange={(e) => setTarget(e.target.value)} className={INPUT}>
                  <option value="">— Choose a group —</option>
                  {rooms.data
                    .filter((r) => r.id !== roomId)
                    .map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Labelled>
            )
          ) : null}
          <Reason text={error} />
        </>
      }
    />
  );
}

export function AddSeatDialog({
  roomId,
  student,
  onClose,
  onDone,
}: {
  roomId: number;
  student: { id: number; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<"trial" | "active">("trial");
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await addSeat(roomId, { user_id: student.id, status, date });
      onDone();
    } catch (e: unknown) {
      setError(serverReason(e, "Could not add the student."));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title={`Add ${student.name} to this group?`}
      confirmLabel="Add to group"
      busy={busy}
      onCancel={() => (busy ? undefined : onClose())}
      onConfirm={() => void confirm()}
      body={
        <>
          <Labelled label="Seat">
            <select value={status} onChange={(e) => setStatus(e.target.value as "trial" | "active")} className={INPUT}>
              <option value="trial">Trial: no money yet</option>
              <option value="active">Active: pays from the date</option>
            </select>
          </Labelled>
          <Labelled label="Start date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </Labelled>
          <Reason text={error} />
        </>
      }
    />
  );
}

export function NewStudentDialog({
  roomId,
  onClose,
  onDone,
}: {
  roomId: number;
  onClose: () => void;
  /** The class changed; the dialog stays open to say how they sign in. */
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    full_name: "", phone: "", parent_name: "", parent_phone: "", status: "trial" as "trial" | "active", date: todayIso(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holder, setHolder] = useState<PhoneHolder | null>(null);
  const [login, setLogin] = useState<{ phone: string; code: string } | null>(null);
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });

  const submit = async () => {
    setBusy(true);
    setError(null);
    setHolder(null);
    try {
      const made = await createStudent(roomId, form);
      setLogin(made.login);
      onDone();
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { code?: string; account?: PhoneHolder } } })?.response?.data;
      setError(serverReason(e, "Could not create the student."));
      setHolder(data?.code === "phone_taken" && data.account ? data.account : null);
    } finally {
      setBusy(false);
    }
  };

  const addHolder = async (person: PhoneHolder) => {
    setBusy(true);
    setError(null);
    try {
      await addSeat(roomId, { user_id: person.id, status: form.status, date: form.date });
      onDone();
      onClose();
    } catch (e: unknown) {
      setError(serverReason(e, "Could not add the student."));
      setBusy(false);
    }
  };

  if (login) {
    return (
      <ConfirmDialog
        title="The student is ready"
        confirmLabel="Done"
        cancelLabel={null}
        busy={false}
        onCancel={onClose}
        onConfirm={onClose}
        body={
          <>
            <p>Tell them to sign in with:</p>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 rounded-lg bg-success-soft px-4 py-3 text-success-foreground">
              <dt>Login</dt>
              <dd className="font-semibold tabular-nums">{formatPhone(login.phone)}</dd>
              <dt>Password</dt>
              <dd className="font-semibold tabular-nums">{login.code}</dd>
            </dl>
            <p>They choose their own password right after. It works for 14 days.</p>
          </>
        }
      />
    );
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="New student"
      description="Someone new to the centre: a new account, and their seat in this group."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Create student
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {holder ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <span>
              <Link href={`/ops/${holder.section}/${holder.id}`} prefetch={false} className="font-medium text-primary hover:underline">
                {holder.name}
              </Link>
              <span className="text-muted-foreground"> · {holder.groups.join(", ") || "no class"}</span>
            </span>
            {holder.can_add ? (
              <Button variant="secondary" disabled={busy} onClick={() => void addHolder(holder)}>
                {`Add ${holder.name} to this group`}
              </Button>
            ) : null}
          </div>
        ) : null}
        <Field label="Full name" htmlFor="new-student-name" required>
          <Input id="new-student-name" autoFocus value={form.full_name} onChange={set("full_name")} autoComplete="off" />
        </Field>
        <Field label="Phone" htmlFor="new-student-phone" required hint="Their login. They first sign in with this and its last four digits.">
          <Input id="new-student-phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="90 123 45 67" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Parent's name" htmlFor="new-student-parent">
            <Input id="new-student-parent" value={form.parent_name} onChange={set("parent_name")} placeholder="Optional" autoComplete="off" />
          </Field>
          <Field label="Parent's phone" htmlFor="new-student-parent-phone">
            <Input id="new-student-parent-phone" type="tel" value={form.parent_phone} onChange={set("parent_phone")} placeholder="Optional" autoComplete="off" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seat" htmlFor="new-student-status">
            <Select id="new-student-status" value={form.status} onChange={set("status")}>
              <option value="trial">Trial: no money yet</option>
              <option value="active">Active: pays from the date</option>
            </Select>
          </Field>
          <Field label="Start date" htmlFor="new-student-date">
            <Input id="new-student-date" type="date" value={form.date} onChange={set("date")} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
