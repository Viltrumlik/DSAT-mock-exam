"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { authApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { desktop, isDesktopShell } from "@/lib/desktop/bridge";
import { DESKTOP_LOGIN } from "@/lib/desktop/routes";
import { SatColorRule } from "@/features/testing-simulation/components/SatColorRule";

/**
 * Signed in, or on the way to the app's own sign-in page. The site's AuthGuard sends people to
 * /login — the website's page, with Google buttons that cannot work inside the app — so the
 * app's pages make this one decision themselves.
 */
export function useDesktopSession() {
  const router = useRouter();
  const { bootState, me } = useMe();
  useEffect(() => {
    if (bootState === "UNAUTHENTICATED") router.replace(DESKTOP_LOGIN);
  }, [bootState, router]);
  return { ready: bootState === "AUTHENTICATED", me: me as { first_name?: string; last_name?: string } | undefined };
}

/** Bluebook's frame: a plain white bar with the name on the left and the student on the right. */
export function DesktopChrome({ children }: { children: React.ReactNode }) {
  const { me } = useDesktopSession();
  const qc = useQueryClient();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktopShell()) return;
    desktop
      .appInfo()
      .then((info) => setVersion(info.version))
      .catch(() => {});
  }, []);
  const name = [me?.first_name, me?.last_name].filter(Boolean).join(" ").trim();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between bg-white px-8 py-4">
        <span className="text-xl font-extrabold tracking-tight">MasterSAT</span>
        <div className="flex items-center gap-5 text-sm font-semibold">
          {name ? <span className="text-slate-700">{name}</span> : null}
          <button
            type="button"
            onClick={() => void authApi.logout(qc)}
            className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </header>
      <SatColorRule />
      <main className="flex-1">{children}</main>
      {version ? (
        <footer className="px-8 py-3 text-xs font-medium text-slate-400">MasterSAT for Windows {version}</footer>
      ) : null}
    </div>
  );
}
