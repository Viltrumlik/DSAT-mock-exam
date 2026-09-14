"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, Mail, MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

import { fieldErrors, profileApi, type FieldErrors } from "../profileApi";
import { IconTile, Panel, PanelHeader, pill, TONE, type Tone } from "../profileUi";
import type { ProfileMe, TelegramConfig } from "../types";

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold", TONE[tone].tile)}>
      {children}
    </span>
  );
}

function MethodRow({
  icon,
  tone,
  title,
  detail,
  status,
  action,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail: React.ReactNode;
  status?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="quartz squircle px-4 py-3.5 [--sq:11px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <IconTile icon={icon} tone={tone} size="sm" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[14px] font-extrabold text-foreground">
              {title}
              {status}
            </p>
            <p className="mt-0.5 truncate text-[12.5px] font-medium text-muted-foreground">{detail}</p>
          </div>
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </li>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  shown,
  onToggle,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  shown: boolean;
  onToggle: () => void;
  invalid: boolean;
}) {
  return (
    <Input
      id={id}
      type={shown ? "text" : "password"}
      autoComplete={autoComplete}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      invalid={invalid}
      rightSlot={
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? "Hide passwords" : "Show passwords"}
          className="ds-ring grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-primary/[0.08] hover:text-foreground"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
}

function PasswordForm({ onDone, onCancel }: { onDone: (signedOut: number, changedAt: string | null) => void; onCancel: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    // What can be told before asking the server, so a typo costs nothing.
    const local: FieldErrors = {};
    if (!current) local.current_password = ["Enter your current password."];
    if (next.length < 8) local.new_password = ["Use at least 8 characters."];
    else if (next === current) local.new_password = ["Choose a password that is different from your current one."];
    if (!local.new_password && confirm !== next) local.confirm = ["The two new passwords don't match."];
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    try {
      const result = await profileApi.changePassword(current, next);
      onDone(result.signedOutDevices, result.changedAt);
    } catch (err) {
      const fields = fieldErrors(err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      setErrors(
        fields ??
          (status === 429
            ? { detail: ["Too many tries for now. Wait a while, then try again."] }
            : { detail: ["That didn't go through. Your password hasn't changed — try again."] }),
      );
    } finally {
      setSaving(false);
    }
  };

  const error = (key: string) => errors[key]?.[0];

  return (
    <form onSubmit={submit} noValidate className={cn("squircle mt-3.5 grid gap-4 p-4 [--sq:11px]", TONE.primary.well)}>
      <Field label="Current password" htmlFor="pw-current" error={error("current_password")}>
        <PasswordInput
          id="pw-current"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
          shown={shown}
          onToggle={() => setShown((s) => !s)}
          invalid={!!error("current_password")}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="New password"
          htmlFor="pw-new"
          error={error("new_password")}
          hint="At least 8 characters — not only numbers, and nothing common."
        >
          <PasswordInput
            id="pw-new"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            invalid={!!error("new_password")}
          />
        </Field>
        <Field label="Repeat the new password" htmlFor="pw-confirm" error={error("confirm")}>
          <PasswordInput
            id="pw-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            invalid={!!error("confirm")}
          />
        </Field>
      </div>
      {error("detail") ? <p className="text-[13px] font-semibold text-danger">{error("detail")}</p> : null}
      <p className="text-[12.5px] font-medium text-muted-foreground">
        Changing it signs you out on your other devices. You stay signed in here.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving} className={pill("solid")}>
          {saving ? "Updating…" : "Update password"}
        </button>
        <button type="button" onClick={onCancel} className={pill("quiet")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The ways into the account: the email that receives codes and results, Telegram for one-tap
 * sign-in, and the password — which, until now, no student could change themselves. All 480
 * active students on production have one.
 */
export function SignInSection({
  me,
  realEmail,
  telegram,
  onOpenEmail,
  onPasswordChanged,
}: {
  me: ProfileMe;
  realEmail: string;
  telegram: TelegramConfig | null;
  onOpenEmail: () => void;
  onPasswordChanged: (changedAt: string | null) => void;
}) {
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const changed = me.last_password_change ? new Date(me.last_password_change) : null;
  const telegramStart = telegram?.enabled && telegram.start_url ? `${telegram.start_url}?next=${encodeURIComponent("/profile")}` : null;

  return (
    <Panel>
      <PanelHeader
        icon={KeyRound}
        tone="emerald"
        title="Sign-in & password"
        description="The ways into your account, and keeping it yours."
      />

      <ul className="mt-5 space-y-2.5">
        <MethodRow
          icon={Mail}
          tone="primary"
          title="Email"
          detail={realEmail || "No email on your account yet"}
          status={
            realEmail ? (
              me.email_verified ? <StatusPill tone="emerald">Confirmed</StatusPill> : <StatusPill tone="amber">Not confirmed</StatusPill>
            ) : null
          }
          action={
            <button type="button" onClick={onOpenEmail} className={pill(me.email_verified && realEmail ? "quiet" : "soft", "primary", "sm")}>
              {!realEmail ? "Add email" : me.email_verified ? "Change" : "Confirm"}
            </button>
          }
        />

        <MethodRow
          icon={MessageCircle}
          tone="sky"
          title="Telegram"
          detail={
            me.telegram_linked
              ? "Sign in with one tap from Telegram."
              : telegramStart
                ? "Connect it to sign in with one tap."
                : "Telegram sign-in isn't available here yet."
          }
          status={me.telegram_linked ? <StatusPill tone="emerald">Connected</StatusPill> : null}
          action={
            !me.telegram_linked && telegramStart ? (
              <a href={telegramStart} className={pill("soft", "sky", "sm")}>
                Connect Telegram
              </a>
            ) : null
          }
        />

        <MethodRow
          icon={Lock}
          tone="emerald"
          title="Password"
          detail={
            changed && !Number.isNaN(changed.getTime())
              ? `Last changed ${changed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : "You haven't changed it here yet."
          }
          action={
            changing ? null : (
              <button type="button" onClick={() => setChanging(true)} className={pill("soft", "emerald", "sm")}>
                Change password
              </button>
            )
          }
        >
          {changing ? (
            <PasswordForm
              onCancel={() => setChanging(false)}
              onDone={(signedOut, changedAt) => {
                setChanging(false);
                onPasswordChanged(changedAt);
                toast.push({
                  tone: "success",
                  message:
                    signedOut > 0
                      ? `Password changed. ${signedOut} other ${signedOut === 1 ? "device was" : "devices were"} signed out.`
                      : "Password changed.",
                });
              }}
            />
          ) : null}
        </MethodRow>
      </ul>

      <p className="mt-4 text-[12.5px] font-medium text-muted-foreground">
        Forgot your password? Your learning center can set a new one for you.
      </p>
    </Panel>
  );
}
