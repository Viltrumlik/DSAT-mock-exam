"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MailCheck, ShieldCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { Alert, Button, Field, Input, Modal, Spinner } from "@/components/ui";

type Step = "address" | "code";

const RESEND_COOLDOWN_SECONDS = 60;

function errorMessage(err: unknown, fallback: string): string {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  const detail = res?.data?.detail;
  if (typeof detail === "string") return detail;
  if (res?.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return fallback;
}

export function EmailVerificationModal({
  open,
  currentEmail,
  onClose,
  onVerified,
}: {
  open: boolean;
  /** Prefilled only when it is a real address — never a synthetic placeholder. */
  currentEmail: string;
  onClose: () => void;
  onVerified: (email: string) => void;
}) {
  const [step, setStep] = useState<Step>("address");
  const [email, setEmail] = useState(currentEmail);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Reset every time the modal is reopened, so a previous failure is not still on
  // screen and a half-typed code cannot be submitted against a new address.
  useEffect(() => {
    if (!open) return;
    setStep("address");
    setEmail(currentEmail);
    setCode("");
    setError(null);
    setBusy(false);
    setCooldown(0);
  }, [open, currentEmail]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    const target = email.trim();
    if (!target) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.requestEmailCode(target);
      setStep("code");
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      window.setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(errorMessage(err, "Could not send the code. Check the address and try again."));
    } finally {
      setBusy(false);
    }
  }, [email]);

  const submitCode = useCallback(async () => {
    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.confirmEmailCode(email.trim(), code);
      onVerified(res.email);
    } catch (err) {
      setError(errorMessage(err, "That code is not correct."));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }, [code, email, onVerified]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="sm"
      title={step === "address" ? "Confirm your email" : "Enter the code"}
      description={
        step === "address"
          ? "We'll send a 6-digit code to make sure this address reaches you."
          : `We sent a code to ${email.trim()}. It expires in 15 minutes.`
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {step === "address" ? (
          <>
            <Field label="Email address" htmlFor="verify-email">
              <Input
                id="verify-email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => { setError(null); setEmail(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !busy) void sendCode(); }}
                placeholder="name@example.com"
                leftIcon={<MailCheck />}
              />
            </Field>
            <Button onClick={() => void sendCode()} disabled={busy} className="w-full">
              {busy ? <Spinner /> : "Send code"}
            </Button>
          </>
        ) : (
          <>
            <input
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Verification code"
              value={code}
              onChange={(e) => {
                setError(null);
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) void submitCode(); }}
              placeholder="••••••"
              className="w-full rounded-2xl border-2 border-border bg-surface-2 py-4 text-center text-3xl font-bold tracking-[0.5em] text-foreground tabular-nums focus:border-primary focus:outline-none"
            />
            <Button onClick={() => void submitCode()} disabled={busy || code.length !== 6} className="w-full">
              {busy ? <Spinner /> : "Confirm"}
            </Button>
            <div className="flex items-center justify-between text-[13px]">
              <button
                type="button"
                onClick={() => { setStep("address"); setError(null); }}
                className="font-semibold text-muted-foreground underline underline-offset-2"
              >
                Use a different address
              </button>
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={busy || cooldown > 0}
                className="font-semibold text-primary underline underline-offset-2 disabled:text-muted-foreground disabled:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </>
        )}

        <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Confirming sets this as the address for your account.
        </p>
      </div>
    </Modal>
  );
}

export default EmailVerificationModal;
