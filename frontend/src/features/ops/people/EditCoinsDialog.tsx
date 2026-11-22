"use client";

import { useState } from "react";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { Field, MoneyInput, Segmented, TextInput, signedAmount } from "@/features/console/ui";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The coins well's ✎ (lc-up's "Tanga" edit, StudentProfile board, 22 Nov 2026): the rewards ledger's own admin
 * adjustment (`POST /rewards/wallet/<id>/` with `action=adjust`, `rewards.coins.adjust` — the shop's permission),
 * which records a grant or a revocation with its reason. A revocation never takes the wallet below zero.
 */
export function EditCoinsDialog({
  studentId,
  name,
  coins,
  onClose,
  onDone,
}: {
  studentId: number;
  name: string;
  coins: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [amount, setAmount] = useState<number | null>(null);
  const [direction, setDirection] = useState<"1" | "-1">("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = amount ? amount * Number(direction) : null;
  const ready = Boolean(change) && Boolean(reason.trim());

  const save = async () => {
    if (!ready || change === null) {
      setError(change ? "Say what the coins are for." : "Enter how many coins.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/rewards/wallet/${studentId}/`, { action: "adjust", amount: change, reference: reason.trim() });
      push({ tone: "success", message: change > 0 ? `Gave ${name} ${change} coins.` : `Took ${-change} coins from ${name}.` });
      onDone();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "That did not go through. Try again.");
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title="Edit coins"
      confirmLabel="Save"
      busy={busy}
      onCancel={() => (busy ? undefined : onClose())}
      onConfirm={() => void save()}
      body={
        <div className="flex flex-col gap-4">
          <p>
            {name} has <b className="tabular-nums">{signedAmount(coins)}</b> coins.
          </p>
          <Segmented<"1" | "-1">
            label="Give or take"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "1", label: "Give" },
              { value: "-1", label: "Take" },
            ]}
          />
          <Field label="Coins">
            <MoneyInput value={amount} onChange={setAmount} suffix="coins" />
          </Field>
          <Field label="What for">
            <TextInput maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {change !== null ? (
            <p className="text-ms-fg-2">
              Coins after: <b className="tabular-nums">{signedAmount(Math.max(0, coins + change))}</b>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-ms-critical-fg">
              {error}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
