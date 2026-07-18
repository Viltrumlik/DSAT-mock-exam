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
  FlaskConical,
  GraduationCap,
  Database,
  ListChecks,
  Upload,
  Timer,
} from "lucide-react";

/**
 * Questions console navigation.
 *
 * Sections:
 *   - Core: dashboard and shared infrastructure
 *   - Learning system: assessments, vocabulary, categories (pedagogical)
 *   - Simulation system: pastpapers, mock exams (SAT simulation)
 *   - Operations: publish queue, archive
 *
 * Active-state rules:
 *   - Dashboard: exact match only
 *   - All others: prefix match (covers nested sub-pages)
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact: boolean;
};

// Learning system (pedagogical / classroom)
const LEARNING_NAV: NavItem[] = [
  { href: "/builder/question-bank",         label: "Question Bank", icon: Database,       exact: true  },
  { href: "/builder/question-bank/triage",  label: "Triage Queue",  icon: ListChecks,     exact: false },
  { href: "/builder/question-bank/imports", label: "Imports",       icon: Upload,         exact: false },
  { href: "/builder/bank",       label: "Sets bank (legacy)", icon: Library,   exact: false },
  { href: "/builder/sets",       label: "Assessments",   icon: LayoutGrid,     exact: false },
  { href: "/builder/midterms",   label: "Midterms",      icon: GraduationCap,  exact: false },
  { href: "/builder/vocabulary", label: "Vocabulary",    icon: BookMarked,     exact: false },
  { href: "/builder/categories", label: "Categories",    icon: Tag,            exact: false },
];

// Simulation system (SAT preparation)
const SIMULATION_NAV: NavItem[] = [
  { href: "/builder/pastpapers",      label: "Past papers",    icon: FileText,        exact: false },
  { href: "/builder/practice-tests",  label: "Practice tests", icon: FlaskConical,    exact: false },
  { href: "/builder/full-mocks",      label: "Full mocks",     icon: Timer,           exact: false },
];

// Operations (publishing, archive)
const OPS_NAV: NavItem[] = [
  { href: "/builder/publish-queue", label: "Publish queue", icon: SendHorizonal, exact: false },
  { href: "/builder/archived",      label: "Archived",      icon: Archive,       exact: false },
];

// Flat list for the editor-route check (same items, different structure)
const ALL_NAV: NavItem[] = [
  { href: "/builder", label: "Dashboard", icon: LayoutDashboard, exact: true },
  ...LEARNING_NAV,
  ...SIMULATION_NAV,
  ...OPS_NAV,
];

function isNavActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Editor pages get a full-screen layout — no sidebar competing for space.
  // Covers: assessment set editor, pastpaper / practice-test / midterm module editors,
  // and the full-mock module editor (/builder/full-mocks/<mockId>/<moduleId>).
  const isEditorRoute =
    /^\/builder\/sets\/\d+/.test(pathname) ||
    /^\/builder\/pastpapers\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/practice-tests\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/midterms\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/full-mocks\/\d+\/\d+/.test(pathname);

  if (isEditorRoute) {
    return (
      <AuthGuard adminOnly>
        <div className="min-h-screen bg-background text-foreground">{children}</div>
      </AuthGuard>
    );
  }

  function NavLink({ item }: { item: NavItem }) {
    const active = isNavActive(pathname, item.href, item.exact);
    return (
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" aria-hidden />
        {item.label}
      </Link>
    );
  }

  const dashboardActive = isNavActive(pathname, "/builder", true);

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

              {/* Dashboard */}
              <nav className="flex flex-col gap-0.5 mb-3">
                <Link
                  href="/builder"
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
                    dashboardActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
                  Dashboard
                </Link>
              </nav>

              {/* Learning system */}
              <div className="mb-3">
                <p className="mb-1 px-3 text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground/60">
                  Learning
                </p>
                <nav className="flex flex-col gap-0.5">
                  {LEARNING_NAV.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </nav>
              </div>

              {/* Simulation system */}
              <div className="mb-3">
                <p className="mb-1 px-3 text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground/60">
                  Simulation
                </p>
                <nav className="flex flex-col gap-0.5">
                  {SIMULATION_NAV.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </nav>
              </div>

              {/* Operations */}
              <div className="border-t border-border pt-3">
                <nav className="flex flex-col gap-0.5">
                  {OPS_NAV.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </nav>
              </div>
            </aside>

            {/* Main content area */}
            <main className="min-w-0 min-h-[600px]">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
