"use client";

import { usePathname } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { OverlayFaceProvider } from "@/components/ui/OverlayFace";
import { useMe } from "@/hooks/useMe";
import { OpsShell } from "@/features/ops/shell/OpsShell";
import { BUILDER_CONSOLE, isBuilderEditorRoute } from "@/features/builderShell/builderNav";

/**
 * The questions console (questions.mastersat.uz), in the ops console's Django-admin frame since
 * 2026-10-15: a sidebar stuck to the left edge, a thin top bar with "Builder › <section>", and the
 * page across the rest of the window. See features/builderShell/builderNav for the nav.
 *
 * The console is set in the body's Georgia — it never took the app shell's `ds-app` — so its dialogs
 * and toasts are too, rather than being the one sans thing in it. See OverlayFace.
 */
export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <OverlayFaceProvider face="body">
      <BuilderConsole>{children}</BuilderConsole>
    </OverlayFaceProvider>
  );
}

function BuilderConsole({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useMe();

  // Editor pages keep the whole window; they carry their own top bar and back link.
  if (isBuilderEditorRoute(pathname)) {
    return (
      <AuthGuard adminOnly>
        <div className="min-h-screen bg-background text-foreground">{children}</div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard adminOnly>
      <OpsShell pathname={pathname} me={me} config={BUILDER_CONSOLE}>
        {children}
      </OpsShell>
    </AuthGuard>
  );
}
