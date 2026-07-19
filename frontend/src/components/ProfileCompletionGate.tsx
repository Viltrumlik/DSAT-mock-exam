"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { invalidateMe } from "@/hooks/useMe";
import { usersApi } from "@/lib/api";
import { displayEmail } from "@/lib/email";
import { Alert, Button, Field, Input, Modal, Spinner } from "@/components/ui";
import { EmailVerificationModal } from "@/components/EmailVerificationModal";

/** Server-side field name → what to call it on screen. */
const LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  username: "username",
  email: "email address",
};

const TEXT_FIELDS = ["first_name", "last_name", "username"] as const;

function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Persistent prompt for an incomplete profile.
 *
 * Warns, never blocks: the product decision is that nobody is locked out, so this is a
 * banner rather than an interaction-blocking overlay like the frozen-account one. It
 * cannot be dismissed, which is what makes it mandatory.
 *
 * The fields are collected inside the modal rather than by sending the user to
 * /profile, because /profile does not exist on the teacher and admin consoles — a
 * navigation-based prompt would be a dead end for exactly the staff it fires on.
 */
export function ProfileCompletionGate({
  missingFields,
  currentEmail,
}: {
  missingFields: string[];
  currentEmail: string;
}) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingText = useMemo(
    () => TEXT_FIELDS.filter((f) => missingFields.includes(f)),
    [missingFields],
  );
  const emailMissing = missingFields.includes("email");

  const openNext = useCallback(() => {
    setError(null);
    // One thing at a time: the text fields first, then the email round-trip. The
    // banner re-reads the server's answer after each, so it shrinks as they go.
    if (missingText.length > 0) {
      setDraft(Object.fromEntries(missingText.map((f) => [f, ""])));
      setFormOpen(true);
    } else {
      setEmailOpen(true);
    }
  }, [missingText]);

  const saveText = useCallback(async () => {
    const payload: Record<string, string> = {};
    for (const f of missingText) {
      const v = (draft[f] ?? "").trim();
      if (v.length < 3) {
        setError(`Your ${LABELS[f]} must be at least 3 characters.`);
        return;
      }
      payload[f] = v;
    }
    setBusy(true);
    setError(null);
    try {
      await usersApi.patchMe(payload);
      await invalidateMe(queryClient);
      setFormOpen(false);
    } catch (err) {
      const detail = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const first = detail && Object.values(detail)[0];
      setError(
        typeof detail?.detail === "string"
          ? detail.detail
          : Array.isArray(first)
            ? String(first[0])
            : "Could not save. Check the values and try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [draft, missingText, queryClient]);

  if (missingFields.length === 0) return null;

  const labels = missingFields.map((f) => LABELS[f] ?? f);

  return (
    <>
      <div className="sticky top-0 z-40 border-b border-warning/40 bg-warning-soft px-4 py-2.5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Your profile is missing your {humanList(labels)}.
          </p>
          <Button size="sm" onClick={openNext}>
            {missingText.length > 0 ? "Complete profile" : "Confirm email"}
          </Button>
        </div>
      </div>

      <Modal
        open={formOpen}
        onClose={busy ? () => undefined : () => setFormOpen(false)}
        size="sm"
        title="Complete your profile"
        description="We need these to identify you correctly on results and certificates."
      >
        <div className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {missingText.map((f) => (
            <Field key={f} label={LABELS[f].replace(/^./, (c) => c.toUpperCase())} htmlFor={`pc-${f}`}>
              <Input
                id={`pc-${f}`}
                value={draft[f] ?? ""}
                autoFocus={f === missingText[0]}
                minLength={3}
                onChange={(e) => { setError(null); setDraft((d) => ({ ...d, [f]: e.target.value })); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !busy) void saveText(); }}
              />
            </Field>
          ))}
          <Button onClick={() => void saveText()} disabled={busy} className="w-full">
            {busy ? <Spinner /> : "Save"}
          </Button>
          {emailMissing ? (
            <p className="text-[13px] text-muted-foreground">
              We&apos;ll ask you to confirm your email address next.
            </p>
          ) : null}
        </div>
      </Modal>

      <EmailVerificationModal
        open={emailOpen}
        currentEmail={displayEmail(currentEmail)}
        onClose={() => setEmailOpen(false)}
        onVerified={() => {
          setEmailOpen(false);
          void invalidateMe(queryClient);
        }}
      />
    </>
  );
}
