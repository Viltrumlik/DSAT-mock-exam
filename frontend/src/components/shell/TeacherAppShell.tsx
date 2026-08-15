"use client";

import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { authApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { AppShell } from "./AppShell";
import { teacherNav, supportTeacherNavSection } from "./navConfig";

/**
 * Teacher shell: AppShell wired with the teacher IA.
 * Access is gated by AuthGuard's teacher-console rule (teacher + super_admin only),
 * which fires on teacher.mastersat.uz. We intentionally do NOT pass `adminOnly` here:
 * that gate is permission-based and would block teachers who lack staff perms.
 */
export default function TeacherAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isAuthenticated, me } = useMe();
  const m = me as { first_name?: string; last_name?: string; profile_image_url?: string | null; role?: string } | undefined;
  const name = [m?.first_name, m?.last_name].filter(Boolean).join(" ").trim() || undefined;

  // Support teachers share this portal with teachers but get one extra section. Composed by
  // role rather than shown to everyone: the availability endpoints 403 a plain teacher.
  const isSupportTeacher = String(m?.role ?? "").toLowerCase() === "support_teacher";
  const nav = isSupportTeacher ? [...teacherNav, supportTeacherNavSection] : teacherNav;

  // Full-window, sidebar-less takeovers:
  //  - the assignment creator/editor (instructions + content library);
  //  - the teacher assessment practice runner (student-style solve view).
  const p = pathname || "";
  const isAssignmentEditor =
    /^\/teacher\/classrooms\/[^/]+\/assignments\/(new|[^/]+\/edit)(\/|$)/.test(p) ||
    /^\/teacher\/assessments\/[^/]+\/practice(\/|$)/.test(p);
  if (isAssignmentEditor) {
    return (
      <AuthGuard>
        <div className="min-h-dvh bg-background">{children}</div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell
        brand={{ name: "MasterSAT", tagline: "Teacher", logoSrc: "/images/logo.png" }}
        nav={nav}
        pathname={pathname}
        user={isAuthenticated ? { name, avatarUrl: m?.profile_image_url ?? null } : null}
        profileHref="/profile"
        onSignOut={() => authApi.logout(queryClient)}
        notifications={isAuthenticated}
      >
        {children}
      </AppShell>
    </AuthGuard>
  );
}
