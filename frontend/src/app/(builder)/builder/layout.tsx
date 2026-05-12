"use client";

import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  LayoutDashboard,
  Library,
  LayoutGrid,
  Tag,
  SendHorizonal,
  Archive,
  FileText,
  BookMarked,
} from "lucide-react";

/**
 * Questions console navigation.
 *
 * Active-state rules:
 *   - Dashboard: exact match only
 *   - All others: prefix match (covers nested sub-pages)
 */
const NAV = [
  {
    href: "/builder",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/builder/bank",
    label: "Question Bank",
    icon: Library,
    exact: false,
  },
  {
    href: "/builder/sets",
    label: "Assessments",
    icon: LayoutGrid,
    exact: false,
  },
  {
    href: "/builder/categories",
    label: "Categories",
    icon: Tag,
    exact: false,
  },
  {
    href: "/builder/pastpapers",
    label: "Pastpapers",
    icon: FileText,
    exact: false,
  },
  {
    href: "/builder/vocabulary",
    label: "Vocabulary",
    icon: BookMarked,
    exact: false,
  },
  {
    href: "/builder/publish-queue",
    label: "Publish Queue",
    icon: SendHorizonal,
    exact: false,
  },
  {
    href: "/builder/archived",
    label: "Archived",
    icon: Archive,
    exact: false,
  },
] as const;

function isNavActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Editor pages get a full-screen layout — no sidebar competing for space.
  // Covers: assessment set editor + pastpaper module editor.
  const isEditorRoute =
    /^\/builder\/sets\/\d+/.test(pathname) ||
    /^\/builder\/pastpapers\/\d+\/\d+\/\d+/.test(pathname);

  if (isEditorRoute) {
    return (
      <AuthGuard adminOnly>
        <div className="min-h-screen bg-background text-foreground">{children}</div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard adminOnly>
      <div className="app-bg min-h-screen text-foreground">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
          <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
            {/* Sidebar nav */}
            <aside className="rounded-2xl border border-border bg-card p-4 shadow-sm lg:self-start lg:sticky lg:top-6">
              <div className="mb-4 border-b border-border px-1 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
                  Questions console
                </p>
                <p className="mt-0.5 text-base font-extrabold text-foreground">MasterSAT</p>
              </div>

              <nav className="flex flex-col gap-1">
                {NAV.map((item) => {
                  const active = isNavActive(pathname, item.href, item.exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </aside>

            {/* Main content area */}
            <main className="min-w-0 min-h-[600px]">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
