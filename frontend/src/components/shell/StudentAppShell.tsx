"use client";

import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { authApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { cn } from "@/lib/cn";
import { AppShell } from "./AppShell";
import { studentNav, reviewNavSection } from "./navConfig";
import { StudentHeaderExtras, StudentAccountMenuRows } from "./StudentHeaderExtras";
import { isReviewerRole } from "@/features/reviewCenter/ui";
import { PushOptInDialog } from "@/features/notifications/PushOptInDialog";

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
  const isReviewer = isReviewerRole(m?.role);
  const nav = isReviewer ? [reviewNavSection, ...studentNav] : studentNav;

  // Immersive, sidebar-less takeovers (like the pastpaper /exam & /review routes):
  //  - the assessment runner (/assessments/attempt/<id>) — its `fixed inset-0 z-50`
  //    exam view must not be trapped inside the shell <main>'s stacking context;
  //  - the assessment result & review pages (/assessments/result|review/<id>) —
  //    full-screen, past-paper-style review with no sidebar;
  //  - the assignment creator/editor (/classes/<id>/assignments/new|.../edit) —
  //    full-window so the instructions + content library get the whole screen;
  //  - the vocabulary study modes (/vocabulary/sets/<id>/flashcards|matching|speed|test)
  //    — timed, full-screen layers that must escape the shell's scroll container.
  const p = pathname || "";
  const isImmersiveRunner =
    /^\/assessments\/(attempt|result|review)\/[^/]+/.test(p) ||
    /^\/classes\/[^/]+\/assignments\/(new|[^/]+\/edit)(\/|$)/.test(p) ||
    /^\/vocabulary\/sets\/\d+\/(flashcards|matching|speed|test)$/.test(p);
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
        // Reviewers and staff browse the student shell but earn nothing, so a points pill
        // reading zero on every page would be noise rather than information.
        headerSlot={isAuthenticated && !isReviewer ? <StudentHeaderExtras /> : undefined}
        accountMenu={isAuthenticated && !isReviewer ? <StudentAccountMenuRows /> : undefined}
        // Gated on being signed in: the summary endpoint 401s for an anonymous visitor, and
        // a bell nobody can fill is the decoration this was rebuilt to remove.
        notifications={isAuthenticated}
      >
        <div className={cn(globalInteractionBlockedHard && "pointer-events-none select-none")} aria-busy={globalInteractionBlockedHard || undefined}>
          {/* The notification ask lives here rather than only inside the bell drawer, where a
              student who never opens the bell never met it. Deliberately NOT in the immersive
              branch above: interrupting a timed assessment to ask for permission is the worst
              possible moment, and a refusal is permanent. Reviewers and staff browsing the
              student shell are excluded for the same reason the points pill is.

              A DIALOG, not the card this used to be. The card was itself the second attempt
              and the school reported the same failure as the first — students do not see it.
              Production put a number on it: twelve push subscriptions in the whole school.
              A modal interrupts once and is then remembered; see PushOptInDialog. */}
          {isAuthenticated && !isReviewer ? <PushOptInDialog /> : null}
          {children}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
