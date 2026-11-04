"use client";

import { useState, type FormEvent } from "react";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { formatUzs } from "./financeApi";
import { Btn, CONTROL, BOX } from "./FinancePanels";
import type { EnterableKind } from "./billingApi";
import { useEnterMoney, useVoidEntry } from "./billingHooks";

/**
 * Entering money on a person's page in the Ledger tab, and taking it back. Shown only once the server says
 * the form is open, which is never while lc-up is still where money is entered.
 *
 * A form keeps one request id for as long as it is open, so a double click, or a retry after a lost answer,
 * is one row on the server. The balance it will leave is shown before saving: a slipped digit is the mistake
 * this page exists to catch.
 */

const METHODS = [
  { value: "Naqd pul", label: "Cash" },
  { value: "Plastik karta", label: "Card" },
  { value: "Bank hisobi", label: "Bank transfer" },
];

const SAVE_LABEL: Record<EnterableKind, string> = {
  payment: "Save payment",
  refund: "Save refund",
  adjust: "Save adjustment",
};

export const ENTER_LABEL: Record<EnterableKind, string> = {
  payment: "Enter a payment",
  refund: "Enter a refund",
  adjust: "Enter an adjustment",
};

const LABEL = "flex flex-col gap-1 text-[12px] text-muted-foreground";

/** Whole so'm above zero, however it was grouped; null for anything else. */
export function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const amount = Number(digits);
  return amount > 0 && Number.isSafeInteger(amount) ? amount : null;
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${date}`;
}

function Refusal({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-danger">
      {formatApiErrorForToast(error)}
    </p>
  );
}

export function EntryForm({
  accountId,
  balance,
  kind,
  onClose,
}: {
  accountId: number;
  balance: number;
  kind: EnterableKind;
  onClose: () => void;
}) {
  const enter = useEnterMoney(accountId);
  const [requestId] = useState(() => crypto.randomUUID());
  const [today] = useState(localToday);
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState(METHODS[0].value);
  const [direction, setDirection] = useState("1");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");

  const amount = parseAmount(raw);
  const adjusting = kind === "adjust";
  const change =
    amount === null ? null : kind === "payment" ? amount : kind === "refund" ? -amount : amount * Number(direction);
  const canSave = change !== null && Boolean(day) && !(adjusting && !note.trim()) && !enter.isPending;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || amount === null || change === null) return;
    enter.mutate(
      {
        kind,
        amount: adjusting ? change : amount,
        day,
        method: adjusting ? "" : method,
        note: note.trim(),
        request_id: requestId,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <form onSubmit={save} aria-label={ENTER_LABEL[kind]} className={cn(BOX, "space-y-2 px-3 py-3")}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          Amount, UZS
          <input
            aria-label="Amount"
            inputMode="numeric"
            autoComplete="off"
            className={cn(CONTROL, "w-40 tabular-nums")}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>
        {adjusting ? (
          <label className={LABEL}>
            Direction
            <select aria-label="Direction" className={CONTROL} value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="1">Raises the balance</option>
              <option value="-1">Lowers the balance</option>
            </select>
          </label>
        ) : (
          <label className={LABEL}>
            Method
            <select aria-label="Method" className={CONTROL} value={method} onChange={(event) => setMethod(event.target.value)}>
              {METHODS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className={LABEL}>
          Date
          <input aria-label="Date" type="date" max={today} className={CONTROL} value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <label className={cn(LABEL, "min-w-[14rem] flex-1")}>
          {adjusting ? "Reason (required)" : "Note"}
          <input
            aria-label={adjusting ? "Reason" : "Note"}
            maxLength={300}
            className={CONTROL}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      {change === null ? null : (
        <p className="text-[13px] text-foreground">Balance after: {formatUzs(balance + change)}</p>
      )}
      <Refusal error={enter.error} />
      <div className="flex flex-wrap gap-1">
        <Btn primary type="submit" disabled={!canSave}>
          {enter.isPending ? "Saving…" : SAVE_LABEL[kind]}
        </Btn>
        <Btn onClick={onClose} disabled={enter.isPending}>Cancel</Btn>
      </div>
    </form>
  );
}

export function VoidForm({ entryId, onClose }: { entryId: number; onClose: () => void }) {
  const voidEntry = useVoidEntry();
  const [reason, setReason] = useState("");
  const canSave = Boolean(reason.trim()) && !voidEntry.isPending;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    voidEntry.mutate({ id: entryId, reason: reason.trim() }, { onSuccess: onClose });
  }

  return (
    <form onSubmit={save} className="space-y-2 whitespace-normal py-1">
      <input
        aria-label="Why is this row being voided?"
        placeholder="Why is this row being voided?"
        maxLength={300}
        className={cn(CONTROL, "w-full max-w-md")}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Refusal error={voidEntry.error} />
      <div className="flex flex-wrap gap-1">
        <Btn primary type="submit" disabled={!canSave}>
          {voidEntry.isPending ? "Voiding…" : "Void this row"}
        </Btn>
        <Btn onClick={onClose} disabled={voidEntry.isPending}>Keep this row</Btn>
      </div>
    </form>
  );
}
