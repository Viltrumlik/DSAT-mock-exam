"use client";

import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/useMe";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  School,
  AlertOctagon,
  ScrollText,
  ClipboardCheck,
  BookOpen,
  GraduationCap,
  KeyRound,
} from "lucide-react";

/**
 * Operational console navigation.
 * Serves admin.mastersat.uz.
 *
 * Nav is split into two sections:
 *   - Admin operations: always shown to all staff
 *   - Teacher workspace: shown to teacher-role users and admins; links into /teacher/* routes
 */
const OPS_NAV = [
  {
    href: "/ops",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/ops/classrooms",
    label: "Classrooms",
    icon: School,
    exact: false,
  },
  {
    href: "/ops/assignments",
    label: "Assignments",
    icon: ClipboardList,
    exact: false,
  },
  {
    href: "/ops/access",
    label: "Access",
    icon: KeyRound,
    exact: false,
  },
  {
    href: "/ops/users",
    label: "Users",
    icon: Users,
    exact: false,
  },
  {
    href: "/ops/midterms",
    label: "Midterms",
    icon: GraduationCap,
    exact: false,
  },
  {
    href: "/ops/scoring-issues",
    label: "Scoring issues",
    icon: AlertOctagon,
    exact: false,
  },
  {
    href: "/ops/audit",
    label: "Audit log",
    icon: ScrollText,
    exact: false,
  },
] as const;

const TEACHER_NAV = [
  {
    href: "/teacher",
    label: "My Classes",
    icon: BookOpen,
    exact: true,
  },
  {
    href: "/teacher/homework",
    label: "Homework",
    icon: ClipboardCheck,
    exact: false,
  },
  {
    href: "/teacher/students",
    label: "Students",
    icon: Users,
    exact: false,
  },
] as const;

function isNavActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function NavItem({
  href,
  label,
  icon: Icon,
  exact,
  pathname,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  exact: boolean;
  pathname: string;
}) {
  const active = isNavActive(pathname, href, exact);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useMe();

  const role = String(me?.role ?? "").trim().toLowerCase();
  // Show teacher section for teacher-role users and full admins.
  const showTeacherSection =
    role === "teacher" || role === "admin" || role === "super_admin";

  return (
    <AuthGuard adminOnly>
      <div className="app-bg min-h-screen text-foreground">
        <div className="mx-auto w-full max-w-7xl px-3 py-4 md:px-6">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            {/* Sidebar */}
            <aside className="rounded-2xl border border-border bg-card p-3 shadow-sm lg:self-start lg:sticky lg:top-4">
              {/* Console identity — compact */}
              <div className="mb-3 border-b border-border px-2 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
                  Admin console
                </p>
                <p className="mt-0.5 text-sm font-extrabold text-foreground">MasterSAT</p>
              </div>

              {/* Operations nav */}
              <nav className="flex flex-col gap-0.5" aria-label="Operations">
                {OPS_NAV.map((item) => (
                  <NavItem key={item.href} {...item} pathname={pathname} />
                ))}
              </nav>

              {/* Teacher workspace section */}
              {showTeacherSection && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1.5 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Teacher
                  </p>
                  <nav className="flex flex-col gap-0.5" aria-label="Teacher workspace">
                    {TEACHER_NAV.map((item) => (
                      <NavItem key={item.href} {...item} pathname={pathname} />
                    ))}
                  </nav>
                </div>
              )}
            </aside>

            {/* Main content */}
            <main className="min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
