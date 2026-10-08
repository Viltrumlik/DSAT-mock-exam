"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Monitor } from "lucide-react";

import api from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { SatColorRule } from "@/features/testing-simulation/components/SatColorRule";

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

function readChallenge(): string | null {
  if (typeof window === "undefined") return null;
  const c = new URLSearchParams(window.location.search).get("challenge");
  return c && CHALLENGE_RE.test(c) ? c : null;
}

/**
 * Opened in the student's OWN browser by the app's "Sign in with your browser". Whatever they
 * use to sign in on the website works here; then one press hands the app a one-time code
 * through `mastersat://`. The press is deliberate — a page that sent the code by itself would
 * sign the app in for anyone who could get this link opened in the student's browser.
 */
export function DesktopLink() {
  const { bootState, me } = useMe();
  const [challenge] = useState(readChallenge);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bootState !== "UNAUTHENTICATED" || !challenge) return;
    const back = `/desktop/link?challenge=${challenge}`;
    window.location.href = `/login?next=${encodeURIComponent(back)}`;
  }, [bootState, challenge]);

  const openApp = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/desktop/auth/code/", { challenge });
      const code = String(r.data?.code ?? "");
      if (!code) throw new Error("no code");
      window.location.href = `mastersat://auth?code=${encodeURIComponent(code)}`;
      setSent(true);
    } catch {
      setError("That didn't work. Go back to the app and press “Sign in with your browser” again.");
    } finally {
      setBusy(false);
    }
  };

  const who = me as { first_name?: string; last_name?: string; email?: string } | undefined;
  const name = [who?.first_name, who?.last_name].filter(Boolean).join(" ").trim() || who?.email || "";

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SatColorRule />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            {sent ? <CheckCircle2 className="h-7 w-7" /> : <Monitor className="h-7 w-7" />}
          </div>
          {!challenge ? (
            <>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">This link is incomplete</h1>
              <p className="mt-2 text-sm font-medium text-slate-500">
                Open the MasterSAT app and press “Sign in with your browser” again.
              </p>
            </>
          ) : sent ? (
            <>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">You&apos;re signed in to the app</h1>
              <p className="mt-2 text-sm font-medium text-slate-500">Go back to the MasterSAT app. You can close this tab.</p>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Sign in to the MasterSAT app</h1>
              <p className="mt-2 text-sm font-medium text-slate-500">
                {name ? `You'll be signed in as ${name}.` : "Checking who you are…"}
              </p>
              <button
                type="button"
                onClick={() => void openApp()}
                disabled={busy || bootState !== "AUTHENTICATED"}
                className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-8 py-3 text-base font-bold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {busy ? "Opening…" : "Open the MasterSAT app"}
              </button>
              {error ? <p className="mt-4 text-sm font-semibold text-red-600">{error}</p> : null}
            </>
          )}
        </div>
      </div>
      <SatColorRule />
    </div>
  );
}
