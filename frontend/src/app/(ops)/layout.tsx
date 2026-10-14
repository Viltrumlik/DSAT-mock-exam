"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { OverlayFaceProvider } from "@/components/ui/OverlayFace";
import { useMe } from "@/hooks/useMe";
import { isAdminOpsPath, isScopedOpsAdmin } from "@/features/ops/adminScope";
import { OpsShell } from "@/features/ops/shell/OpsShell";

/**
 * The operational console (admin.mastersat.uz), framed like Django admin — see
 * features/ops/shell for the sidebar, the top bar and who sees which section.
 *
 * The console is set in the body's Georgia — it never took the app shell's `ds-app` — so its
 * dialogs and toasts are too, rather than being the one sans thing in it. See OverlayFace.
 */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OverlayFaceProvider face="body">
      <OpsConsole>{children}</OpsConsole>
    </OverlayFaceProvider>
  );
}

function OpsConsole({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();

  // An admin sees the school's sections and nothing else — see features/ops/adminScope.
  // Hiding the link alone would leave the page one typed address away, and every ops page
  // renders inside this layout — so this is the one place that can close them all. The
  // page is never mounted, so none of its requests go out either. AuthGuard renders nothing
  // until `me` has loaded, so there is no first paint before the role is known.
  const blocked = isScopedOpsAdmin(me) && !isAdminOpsPath(pathname);
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
