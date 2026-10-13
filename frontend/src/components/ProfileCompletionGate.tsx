"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, MailCheck, ShieldCheck } from "lucide-react";
import { lcupApi } from "@/features/lcup/lcupApi";
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
/** The server's validators decide; this only catches the obvious before a round-trip. */
const MIN_PASSWORD_LEN = 8;
/** An account the lc-up sync created has its phone as username, and signs in with it. */
const PHONE_USERNAME = /^998\d{9}$/;

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
  // An account the lc-up sync created, signed in with its one-time code: its own password comes
  // before anything else (backend/lcup/claims.py lists "password" first).
  const passwordMissing = missingFields.includes("password");

  // Start on the name step when anything there is missing; otherwise go straight to the
  // email round-trip. The name step stays reachable from the email step regardless.
  const [step, setStep] = useState<"password" | "profile" | "email">(
    passwordMissing ? "password" : nameIncomplete ? "profile" : "email",
  );
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
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

  const savePassword = useCallback(async () => {
    if (password.length < MIN_PASSWORD_LEN) {
      setError(`Use at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (password !== passwordAgain) {
      setError("The two passwords are different.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await lcupApi.setInitialPassword(password);
      await invalidateMe(queryClient);
      setPassword("");
      setPasswordAgain("");
      setStep(nameIncomplete ? "profile" : "email");
    } catch (err) {
      setError(apiError(err, "Could not save the password. Try a longer one."));
    } finally {
      setBusy(false);
    }
  }, [password, passwordAgain, nameIncomplete, queryClient]);

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
      title={step === "password" ? "Choose your password" : step === "profile" ? "Complete your profile" : "Confirm your email"}
      description={
        step === "password"
          ? "You signed in with a one-time code. Choose your own password — from now on you sign in with your phone number and this password."
          : step === "profile"
          ? "Check these are right — they name you on results and certificates. You can change them."
          : emailStep === "address"
            ? "We'll send a 6-digit code to make sure this address reaches you."
            : `We sent a code to ${email.trim()}. It expires in 15 minutes.`
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {step === "password" ? (
          <>
            <Field label="New password" htmlFor="pc-password">
              <Input
                id="pc-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => { setError(null); setPassword(e.target.value); }}
                leftIcon={<KeyRound />}
              />
            </Field>
            <Field label="Type it again" htmlFor="pc-password-again">
              <Input
                id="pc-password-again"
                type="password"
                autoComplete="new-password"
                value={passwordAgain}
                onChange={(e) => { setError(null); setPasswordAgain(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !busy) void savePassword(); }}
                leftIcon={<KeyRound />}
              />
            </Field>
            <Button onClick={() => void savePassword()} disabled={busy} className="w-full">
              {busy ? <Spinner /> : "Save password"}
            </Button>
          </>
        ) : step === "profile" ? (
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
                {f.key === "username" && PHONE_USERNAME.test(draft.username ?? "") ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    You sign in with this phone number. If you change it, sign in with your email or Google instead.
                  </p>
                ) : null}
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
