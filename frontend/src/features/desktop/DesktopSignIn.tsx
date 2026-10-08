"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, LogIn } from "lucide-react";

import api, { authApi, clearAuthCookiesEverywhere } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { desktop, isDesktopShell } from "@/lib/desktop/bridge";
import { DESKTOP_HOME } from "@/lib/desktop/routes";
import { SatColorRule } from "@/features/testing-simulation/components/SatColorRule";

/** After a sign-in the whole page reloads, so every query starts from the new session. */
function enterApp() {
  window.location.replace(DESKTOP_HOME);
}

/**
 * The app's sign-in. "Sign in with your browser" is the main way in: Google refuses embedded
 * windows, so the student signs in on the website in their own browser and the app is handed a
 * one-time code (see backend/desktop/views.py). Email and password work here directly too.
 *
 * The code comes back as `?code=` — the app opens this page with it when the browser hands
 * `mastersat://auth?code=…` over.
 */
export function DesktopSignIn() {
  const router = useRouter();
  const { bootState } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchangedRef = useRef(false);

  // Coming back from the browser with a code: redeem it once.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code || exchangedRef.current) return;
    exchangedRef.current = true;
    setBusy(true);
    (async () => {
      try {
        const verifier = isDesktopShell() ? await desktop.takeVerifier() : null;
        if (!verifier) throw new Error("no verifier");
        clearAuthCookiesEverywhere();
        await authApi.csrf();
        await api.post("/desktop/auth/exchange/", { code, verifier });
        enterApp();
      } catch {
        setError("That sign-in didn't go through. Try again.");
        setBusy(false);
        router.replace("/desktop/login");
      }
    })();
  }, [router]);

  // Already signed in (the app remembers the session) — straight to "Your tests".
  useEffect(() => {
    const hasCode = new URLSearchParams(window.location.search).has("code");
    if (bootState === "AUTHENTICATED" && !hasCode) router.replace(DESKTOP_HOME);
  }, [bootState, router]);

  const signInWithBrowser = async () => {
    setError(null);
    try {
      await desktop.beginBrowserSignIn();
      setWaiting(true);
    } catch {
      setError("Your browser could not be opened. Sign in with your email below.");
    }
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.login(email.trim(), password, true);
      enterApp();
    } catch {
      setError("The email or password you entered is incorrect.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SatColorRule />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-center text-3xl font-extrabold tracking-tight text-slate-900">MasterSAT</h1>
          <p className="mt-2 text-center text-sm font-medium text-slate-500">Sign in to see your tests.</p>

          <button
            type="button"
            onClick={() => void signInWithBrowser()}
            disabled={busy}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-8 py-3 text-base font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            <Globe className="h-5 w-5" aria-hidden /> Sign in with your browser
          </button>
          <p className="mt-2 text-center text-xs font-medium text-slate-500">
            {waiting
              ? "Finish signing in in your browser, then press “Open the MasterSAT app”."
              : "Use Google, Telegram or your email — whatever you use on the website."}
          </p>

          <div className="my-7 flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={(e) => void signInWithPassword(e)} className="space-y-3">
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              aria-label="Email"
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !email.trim() || !password}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-8 py-3 text-base font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <LogIn className="h-5 w-5" aria-hidden /> {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {error ? <p className="mt-4 text-center text-sm font-semibold text-red-600">{error}</p> : null}
        </div>
      </div>
      <SatColorRule />
    </div>
  );
}
