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
 * Its pages are set in the redesign's UI sans (`.ms`, from OpsShell) and so are their overlays. The
 * full-screen editors show a question exactly as the student reads it, in the body's Georgia, so they
 * — and their dialogs — keep the body face here. The module editor puts `.ms` on its own frame (top
 * bar and outline, PR 14a); the question inside it, and the set editor, are next.
 */
export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return <BuilderConsole>{children}</BuilderConsole>;
}

function BuilderConsole({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useMe();

  // Editor pages keep the whole window; they carry their own top bar and back link.
  if (isBuilderEditorRoute(pathname)) {
    return (
      <AuthGuard adminOnly>
        <OverlayFaceProvider face="body">
          <div className="min-h-screen bg-background text-foreground">{children}</div>
        </OverlayFaceProvider>
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
