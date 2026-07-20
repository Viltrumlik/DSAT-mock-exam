"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { invalidateMe, useMe } from "@/hooks/useMe";
import { usersApi } from "@/lib/api";
import { displayEmail } from "@/lib/email";
import { Alert, Button, Card, CardContent, Field, Input, Spinner } from "@/components/ui";
import { EmailVerificationModal } from "@/components/EmailVerificationModal";

const LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  username: "Username",
};
const TEXT_FIELDS = ["first_name", "last_name", "username"] as const;

/** Site-relative only — this value round-trips through a redirect from the backend. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/**
 * Landing page for a Telegram signup.
 *
 * Telegram gives us a display name at best and never an email, so a new account arrives
 * with no way to reach the person. The OAuth callback sends them here instead of to a
 * dashboard, so supplying that is the first thing they do rather than a banner over a
 * screen they have never seen.
 *
 * Deliberately outside the console route groups: it has no AuthGuard above it, which is
 * what stops the completion banner from also rendering on top of the dedicated page.
 */
function CompleteProfileInner() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { bootState, me } = useMe();

  const next = safeNext(params.get("next"));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const missing = useMemo(() => {
    const raw = me?.missing_fields;
    return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [];
  }, [me]);
  const missingText = useMemo(() => TEXT_FIELDS.filter((f) => missing.includes(f)), [missing]);
  const emailMissing = missing.includes("email");

  useEffect(() => {
    if (bootState === "UNAUTHENTICATED") router.replace("/login");
  }, [bootState, router]);

  // Nothing left to ask for — hand them on to wherever they were going.
  useEffect(() => {
    if (bootState === "AUTHENTICATED" && me && me.profile_complete === true) {
      router.replace(next);
    }
  }, [bootState, me, next, router]);

  const saveText = useCallback(async () => {
    const payload: Record<string, string> = {};
    for (const f of missingText) {
      const v = (draft[f] ?? "").trim();
      if (v.length < 3) {
        setError(`${LABELS[f]} must be at least 3 characters.`);
        return;
      }
      payload[f] = v;
    }
    setBusy(true);
    setError(null);
    try {
      await usersApi.patchMe(payload);
      await invalidateMe(queryClient);
    } catch (err) {
      const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const first = data && Object.values(data)[0];
      setError(
        typeof data?.detail === "string"
          ? data.detail
          : Array.isArray(first)
            ? String(first[0])
            : "Could not save. Check the values and try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [draft, missingText, queryClient]);

  if (bootState === "BOOTING" || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-6">
          <div>
            <h1 className="ds-h1 text-2xl">Finish setting up your account</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Telegram doesn&apos;t share these with us, so we need them from you.
            </p>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          {missingText.length > 0 ? (
            <div className="space-y-4">
              {missingText.map((f) => (
                <Field key={f} label={LABELS[f]} htmlFor={`cp-${f}`}>
                  <Input
                    id={`cp-${f}`}
                    value={draft[f] ?? ""}
                    autoFocus={f === missingText[0]}
                    minLength={3}
                    onChange={(e) => { setError(null); setDraft((d) => ({ ...d, [f]: e.target.value })); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !busy) void saveText(); }}
                  />
                </Field>
              ))}
              <Button onClick={() => void saveText()} disabled={busy} className="w-full">
                {busy ? <Spinner /> : "Continue"}
              </Button>
            </div>
          ) : emailMissing ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Last step — confirm an email address so we can send you results and
                reminders.
              </p>
              <Button onClick={() => setEmailOpen(true)} className="w-full">
                Add your email
              </Button>
            </div>
          ) : null}

          <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            You can change these later from your profile.
          </p>
        </CardContent>
      </Card>

      <EmailVerificationModal
        open={emailOpen}
        currentEmail={displayEmail(typeof me.email === "string" ? me.email : "")}
        onClose={() => setEmailOpen(false)}
        onVerified={() => {
          setEmailOpen(false);
          void invalidateMe(queryClient);
        }}
      />
    </div>
  );
}

/**
 * useSearchParams() forces this route to render on the client, so Next's static
 * prerender demands a Suspense boundary above it or the production build fails. The
 * fallback mirrors the inner BOOTING state so there is no flash between the two.
 */
export default function CompleteProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary/60" aria-label="Loading" />
        </div>
      }
    >
      <CompleteProfileInner />
    </Suspense>
  );
}
