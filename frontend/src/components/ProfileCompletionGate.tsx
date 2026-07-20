"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, MailCheck, ShieldCheck } from "lucide-react";
import { invalidateMe } from "@/hooks/useMe";
import { authApi, usersApi } from "@/lib/api";
import { displayEmail } from "@/lib/email";
import { Alert, Button, Field, Input, Modal, Spinner } from "@/components/ui";

/** All three are always shown, pre-filled, so a wrong value (e.g. a name Telegram
 *  guessed) can be corrected here — not only the ones the server flagged as missing. */
const NAME_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "username", label: "Username" },
] as const;

const MIN_LEN = 3;
const RESEND_COOLDOWN_SECONDS = 60;

export type GateCurrent = {
  first_name: string;
  last_name: string;
  username: string;
  email: string;
};

function apiError(err: unknown, fallback: string): string {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  const data = res?.data;
  if (typeof data?.detail === "string") return data.detail;
  const first = data && Object.values(data)[0];
  if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  if (res?.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return fallback;
}

/**
 * Mandatory, non-dismissible completion gate.
 *
 * Unlike the earlier banner, this BLOCKS: `AuthGuard` renders the app `inert` behind it,
 * so nothing else on the site is reachable until the required fields are filled and the
 * email address is confirmed. It disappears on its own — every save re-reads
 * `missing_fields` from the server, and once that list is empty `AuthGuard` stops
 * mounting the gate.
 *
 * A "Log out" escape is deliberate: there is no password-reset flow anywhere in the app,
 * so a person whose emailed code never arrives must still be able to leave rather than be
 * trapped on a screen they cannot clear. Logging out is not "getting past" the gate.
 *
 * Fields are collected inline rather than by sending the user to /profile, which does not
 * exist on the teacher and admin consoles — a navigation-based prompt would dead-end
 * exactly the staff it also fires on.
 */
export function ProfileCompletionGate({
  missingFields,
  current,
}: {
  missingFields: string[];
  current: GateCurrent;
}) {
  const queryClient = useQueryClient();
  const nameIncomplete = NAME_FIELDS.some((f) => missingFields.includes(f.key));
  const emailMissing = missingFields.includes("email");

  // Start on the name step when anything there is missing; otherwise go straight to the
  // email round-trip. The name step stays reachable from the email step regardless.
  const [step, setStep] = useState<"profile" | "email">(nameIncomplete ? "profile" : "email");
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    first_name: current.first_name,
    last_name: current.last_name,
    username: current.username,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email round-trip state (inlined rather than nesting a second modal).
  const [emailStep, setEmailStep] = useState<"address" | "code">("address");
  const [email, setEmail] = useState(displayEmail(current.email));
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const saveNames = useCallback(async () => {
    const payload: Record<string, string> = {};
    for (const f of NAME_FIELDS) {
      const v = (draft[f.key] ?? "").trim();
      if (v.length < MIN_LEN) {
        setError(`${f.label} must be at least ${MIN_LEN} characters.`);
        return;
      }
      payload[f.key] = v;
    }
    setBusy(true);
    setError(null);
    try {
      await usersApi.patchMe(payload);
      await invalidateMe(queryClient);
      // If the email is also outstanding, move on to it; otherwise the refreshed
      // `missing_fields` is now empty and AuthGuard unmounts this gate.
      if (emailMissing) {
        setError(null);
        setStep("email");
      }
    } catch (err) {
      setError(apiError(err, "Could not save. Check the values and try again."));
    } finally {
      setBusy(false);
    }
  }, [draft, emailMissing, queryClient]);

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
      setEmailStep("code");
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      window.setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(apiError(err, "Could not send the code. Check the address and try again."));
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
      await authApi.confirmEmailCode(email.trim(), code);
      // Success: refreshing `me` empties `missing_fields`, so AuthGuard removes the gate.
      await invalidateMe(queryClient);
    } catch (err) {
      setError(apiError(err, "That code is not correct."));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }, [code, email, queryClient]);

  const logout = useCallback(() => {
    void authApi.logout(queryClient);
  }, [queryClient]);

  return (
    <Modal
      open
      // Non-dismissible: Escape and backdrop clicks both route here, and there is no ×.
      onClose={() => undefined}
      hideClose
      size="sm"
      title={step === "profile" ? "Complete your profile" : "Confirm your email"}
      description={
        step === "profile"
          ? "Check these are right — they name you on results and certificates. You can change them."
          : emailStep === "address"
            ? "We'll send a 6-digit code to make sure this address reaches you."
            : `We sent a code to ${email.trim()}. It expires in 15 minutes.`
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {step === "profile" ? (
          <>
            {NAME_FIELDS.map((f, i) => (
              <Field key={f.key} label={f.label} htmlFor={`pc-${f.key}`}>
                <Input
                  id={`pc-${f.key}`}
                  value={draft[f.key] ?? ""}
                  autoFocus={i === 0}
                  minLength={MIN_LEN}
                  onChange={(e) => { setError(null); setDraft((d) => ({ ...d, [f.key]: e.target.value })); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !busy) void saveNames(); }}
                />
              </Field>
            ))}
            <Button onClick={() => void saveNames()} disabled={busy} className="w-full">
              {busy ? <Spinner /> : emailMissing ? "Save and continue" : "Save"}
            </Button>
            {emailMissing ? (
              <p className="text-[13px] text-muted-foreground">
                Next, confirm your email address with a code.
              </p>
            ) : null}
          </>
        ) : (
          <>
            {emailStep === "address" ? (
              <>
                <Field label="Email address" htmlFor="pc-email">
                  <Input
                    id="pc-email"
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
                  onChange={(e) => { setError(null); setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); }}
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
                    onClick={() => { setEmailStep("address"); setError(null); }}
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

            <button
              type="button"
              onClick={() => { setStep("profile"); setError(null); }}
              className="text-[13px] font-semibold text-muted-foreground underline underline-offset-2"
            >
              ← Edit your name
            </button>
          </>
        )}

        <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          You can&apos;t use the rest of the site until this is done.
        </p>

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Not now — log out
          </button>
        </div>
      </div>
    </Modal>
  );
}
