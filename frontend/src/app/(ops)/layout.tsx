"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useMe } from "@/hooks/useMe";
import { OpsShell } from "@/features/ops/shell/OpsShell";
import { opsPathAllowed } from "@/features/ops/shell/opsNav";

/**
 * The operational console (admin.mastersat.uz) — see features/ops/shell for the sidebar, the top
 * bar and who sees which section.
 *
 * Since the redesign's shell the console is set in the UI sans (`.ms`), so its dialogs and toasts
 * take OverlayFace's default UI face too — it no longer wraps its pages in the body face.
 */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsConsole>{children}</OpsConsole>;
}

function OpsConsole({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();

  // A page is open to whoever may see its sidebar item (features/ops/shell/opsNav: its permissions, and the
  // owner's list of what stays off the desk). Hiding the link alone would leave the page one typed address
  // away, and every ops page renders inside this layout — so this is the one place that can close them all.
  // The page is never mounted, so none of its requests go out either. AuthGuard renders nothing until `me`
  // has loaded, so there is no first paint before the permissions are known.
  const blocked = Boolean(me) && !opsPathAllowed(pathname, me);
  useEffect(() => {
    if (blocked) router.replace("/ops");
  }, [blocked, router]);

  return (
    <AuthGuard adminOnly>
      <OpsShell pathname={pathname} me={me}>
        {blocked ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary/60" aria-label="Redirecting" />
          </div>
        ) : (
          children
        )}
      </OpsShell>
    </AuthGuard>
  );
}
