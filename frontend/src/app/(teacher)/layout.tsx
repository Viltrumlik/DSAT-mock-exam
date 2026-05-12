"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { LayoutDashboard, ClipboardList, Users, BookOpen } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Teacher-console layout.
 *
 * Uses the same compact grid/sidebar shell as the ops console so both
 * surfaces share a unified visual system. Teacher-specific pages live
 * at /teacher/* and are reached from the "Teacher" section in the ops
 * sidebar as well as from this standalone shell.
 */
const NAV = [
  {
    href: "/teacher",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/teacher/homework",
    label: "Homework",
    icon: ClipboardList,
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

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AuthGuard adminOnly>
      <div className="app-bg min-h-screen text-foreground">
        <div className="mx-auto w-full max-w-7xl px-3 py-4 md:px-6">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            {/* Sidebar — sticky on large screens */}
            <aside className="rounded-2xl border border-border bg-card p-3 shadow-sm lg:self-start lg:sticky lg:top-4">
              {/* Console identity — compact, matches ops shell */}
              <div className="mb-3 border-b border-border px-2 pb-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                  Teacher
                </p>
                <p className="mt-0.5 text-sm font-extrabold text-foreground">MasterSAT</p>
              </div>

              <nav className="flex flex-col gap-0.5" aria-label="Teacher">
                {NAV.map((item) => {
                  const active = isNavActive(pathname, item.href, item.exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
                        active
                          ? "bg-surface-2 text-foreground"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              {/* Back link to ops console for admin+ users */}
              <div className="mt-3 border-t border-border pt-3">
                <Link
                  href="/ops"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Admin console
                </Link>
              </div>
            </aside>

            {/* Main content */}
            <main className="min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
