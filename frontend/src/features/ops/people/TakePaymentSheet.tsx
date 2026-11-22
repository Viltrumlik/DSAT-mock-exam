"use client";

import { useState, type FormEvent } from "react";
import { useToast } from "@/components/ToastProvider";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import type { EnterableKind, LedgerSeat } from "@/features/finance/billingApi";
import { useEnterMoney, useLedgerAccount } from "@/features/finance/billingHooks";
import { Button, Field, MoneyInput, Segmented, Select, Sheet, TextInput, balanceVerdict, chipClass, signedAmount, verdictText } from "@/features/console/ui";
import { todayIso } from "@/features/ops/classrooms/seatsApi";

/**
 * Take payment from the student's profile (StudentProfile board, state "Sheet open", 22 Nov 2026): the ledger's
 * own entry form (`POST /billing/accounts/<id>/entries/`, the Ledger tab's `EntryForm`) as a side sheet. The same
 * sheet takes a refund or an adjustment from the profile's ⋮, each behind the permission the server asks for.
 *
 * A student in two groups is asked which one (lc-up asks too). The ledger keeps no group on a payment, so the
 * chosen group is written at the start of the payment's note, where the ledger's rows show it. The amount chips
 * are the account's own numbers — its debt, the chosen group's month — and the balance it will leave is said before
 * saving. One request id per open sheet: a double click or a retry is one row.
 */

const TITLE: Record<EnterableKind, string> = { payment: "Take payment", refund: "Refund", adjust: "Edit balance" };

const METHODS = [
  { value: "Naqd pul", label: "Cash" },
  { value: "Plastik karta", label: "Card" },
  { value: "Bank hisobi", label: "Transfer" },
] as const;

type Method = (typeof METHODS)[number]["value"];

/** The seats a payment can be for: every group the student has not left. */
const live = (seats: LedgerSeat[]) => seats.filter((s) => s.state !== "left");

const monthPrice = (seat: LedgerSeat | undefined) =>
  seat ? (seat.personal_price === null || seat.personal_price === undefined ? seat.price : seat.personal_price) : 0;

export function TakePaymentSheet({
  open,
  onClose,
  accountId,
  name,
  kind = "payment",
  groupName,
}: {
  open: boolean;
  onClose: () => void;
  accountId: number;
  name: string;
  kind?: EnterableKind;
  /** Opened from a group card: that group is chosen already. */
  groupName?: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={TITLE[kind]}>
      {open ? <PaymentForm accountId={accountId} name={name} kind={kind} groupName={groupName} onClose={onClose} /> : null}
    </Sheet>
  );
}

function PaymentForm({
  accountId,
  name,
  kind,
  groupName,
  onClose,
}: {
  accountId: number;
  name: string;
  kind: EnterableKind;
  groupName?: string;
  onClose: () => void;
}) {
  const { push } = useToast();
  const account = useLedgerAccount(accountId);
  const enter = useEnterMoney(accountId);
  const [requestId] = useState(() => crypto.randomUUID());
  const [today] = useState(todayIso);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>(METHODS[0].value);
  const [direction, setDirection] = useState<"1" | "-1">("1");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string | null>(groupName ?? null);

  if (account.isPending) return <p className="text-[14px] text-ms-fg-3">Loading the account…</p>;
  if (account.isError || !account.data) {
    return (
      <p role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2.5 text-[14px] text-ms-critical-fg">
        Could not load the account.{" "}
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void account.refetch()}>
          Retry
        </button>
      </p>
    );
  }

  const ledger = account.data;
  const seats = live(ledger.seats);
  const asks = seats.length > 1 && kind !== "adjust";
  // A group card's name is the class's; the ledger's seat may carry lc-up's name for it. No match: ask.
  const chosen = seats.some((s) => s.group_name === picked) ? picked : null;
  const group = asks ? chosen : seats.length === 1 ? seats[0].group_name : null;
  const seat = seats.find((s) => s.group_name === group);
  const adjusting = kind === "adjust";
  const change = amount === null ? null : kind === "payment" ? amount : kind === "refund" ? -amount : amount * Number(direction);
  const after = change === null ? null : ledger.balance + change;
  const debt = ledger.balance < 0 ? -ledger.balance : 0;
  const month = monthPrice(seat);
  const chips = kind === "payment"
    ? [
        debt > 0 ? { label: "Debt", value: debt } : null,
        month > 0 ? { label: "1 month", value: month } : null,
        debt > 0 && month > 0 ? { label: "Debt + 1 month", value: debt + month } : null,
      ].filter((c): c is { label: string; value: number } => c !== null)
    : [];
  const missingGroup = asks && !group;
  const missingReason = adjusting && !note.trim();
  const canSave = change !== null && Boolean(day) && !missingGroup && !missingReason && !enter.isPending;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || amount === null || change === null) return;
    const written = [asks && group ? group : "", note.trim()].filter(Boolean).join(" · ").slice(0, 300);
    enter.mutate(
      { kind, amount: adjusting ? change : amount, day, method: adjusting ? "" : method, note: written, request_id: requestId },
      {
        onSuccess: () => {
          push({ tone: "success", message: kind === "payment" ? `Payment saved for ${name}.` : kind === "refund" ? "Refund saved." : "Balance changed." });
          onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={save} aria-label={TITLE[kind]} className="flex flex-col gap-5">
      <p className="-mt-1 text-[13px] text-ms-fg-3">
        {name}
        {group ? ` · ${group}` : ""}
      </p>
      {asks ? (
        <Field label="Group" error={missingGroup && amount !== null ? "Choose the group this payment is for." : null}>
          <Select<string>
            value={chosen}
            onChange={setPicked}
            placeholder="Choose a group"
            options={seats.map((s) => ({ value: s.group_name, label: s.group_name }))}
          />
        </Field>
      ) : null}
      <Field label="Amount">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      {chips.length ? (
        <div className="-mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Amounts">
          {chips.map((c) => (
            <button key={c.label} type="button" className={chipClass(amount === c.value)} onClick={() => setAmount(c.value)}>
              {c.label} {signedAmount(c.value)}
            </button>
          ))}
        </div>
      ) : null}
      {adjusting ? (
        <Field label="Direction">
          <Segmented<"1" | "-1">
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "1", label: "Raises the balance" },
              { value: "-1", label: "Lowers the balance" },
            ]}
          />
        </Field>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] font-medium leading-5 text-ms-fg">How</span>
          <Segmented<Method> label="How" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
        </div>
      )}
      <Field label="Date">
        <TextInput type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      <Field label={adjusting ? "Reason" : "Note"} optional={!adjusting}>
        <TextInput maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {after === null ? null : (
        <p className="rounded-ms-ctl bg-ms-surface px-3.5 py-3 text-[14px] text-ms-fg">
          Balance after, so&apos;m: <b className={cn("tabular-nums", verdictText(balanceVerdict(after)))}>{signedAmount(after)}</b>
        </p>
      )}
      {enter.error ? (
        <p role="alert" className="text-[14px] text-ms-critical-fg">
          {formatApiErrorForToast(enter.error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-ms-border pt-4">
        <Button variant="ghost" onClick={onClose} disabled={enter.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave} state={enter.isPending ? "busy" : "idle"} busyLabel="Saving…">
          {kind === "payment" && amount ? `Take ${signedAmount(amount)} so'm` : kind === "refund" ? "Save refund" : kind === "adjust" ? "Save adjustment" : "Take payment"}
        </Button>
      </div>
    </form>
  );
}
