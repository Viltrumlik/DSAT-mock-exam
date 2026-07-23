"use client";

import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { authApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { cn } from "@/lib/cn";
import { AppShell } from "./AppShell";
import { studentNav, reviewNavSection } from "./navConfig";
import { isReviewerRole } from "@/features/reviewCenter/ui";

/** Wires the generic AppShell with student auth, identity, and IA. */
export default function StudentAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isAuthenticated, me, globalInteractionBlockedHard } = useMe();

  const m = me as {
    first_name?: string;
    last_name?: string;
    profile_image_url?: string | null;
    role?: string;
  } | undefined;
  const name = [m?.first_name, m?.last_name].filter(Boolean).join(" ").trim() || undefined;

  // Content reviewers (test_auditor + admins) get a Review Center entry at the top of the
  // student sidebar. Everyone else sees the standard student IA.
  const nav = isReviewerRole(m?.role) ? [reviewNavSection, ...studentNav] : studentNav;

  // Immersive, sidebar-less takeovers (like the pastpaper /exam & /review routes):
  //  - the assessment runner (/assessments/attempt/<id>) — its `fixed inset-0 z-50`
  //    exam view must not be trapped inside the shell <main>'s stacking context;
  //  - the assessment result & review pages (/assessments/result|review/<id>) —
  //    full-screen, past-paper-style review with no sidebar;
  //  - the assignment creator/editor (/classes/<id>/assignments/new|.../edit) —
  //    full-window so the instructions + content library get the whole screen.
  const p = pathname || "";
  const isImmersiveRunner =
    /^\/assessments\/(attempt|result|review)\/[^/]+/.test(p) ||
    /^\/classes\/[^/]+\/assignments\/(new|[^/]+\/edit)(\/|$)/.test(p);
  if (isImmersiveRunner) {
    return (
      <AuthGuard>
        <div
          className={cn(
            "min-h-dvh bg-background",
            globalInteractionBlockedHard && "pointer-events-none select-none",
          )}
          aria-busy={globalInteractionBlockedHard || undefined}
        >
          {children}
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell
        brand={{ name: "MasterSAT", logoSrc: "/images/logo.png" }}
        nav={nav}
        pathname={pathname}
        user={isAuthenticated ? { name, avatarUrl: m?.profile_image_url ?? null } : null}
        onSignOut={() => authApi.logout(queryClient)}
      >
        <div className={cn(globalInteractionBlockedHard && "pointer-events-none select-none")} aria-busy={globalInteractionBlockedHard || undefined}>
          {children}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
