"use client";

import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { authApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { AppShell } from "./AppShell";
import { teacherNav } from "./navConfig";

/** Teacher shell: AppShell wired with the teacher IA + staff gate. */
export default function TeacherAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isAuthenticated, me } = useMe();
  const m = me as { first_name?: string; last_name?: string; profile_image_url?: string | null } | undefined;
  const name = [m?.first_name, m?.last_name].filter(Boolean).join(" ").trim() || undefined;

  return (
    <AuthGuard adminOnly>
      <AppShell
        brand={{ name: "MasterSAT", tagline: "Teacher" }}
        nav={teacherNav}
        pathname={pathname}
        user={isAuthenticated ? { name, avatarUrl: m?.profile_image_url ?? null } : null}
        profileHref="/profile"
        onSignOut={() => authApi.logout(queryClient)}
      >
        {children}
      </AppShell>
    </AuthGuard>
  );
}
