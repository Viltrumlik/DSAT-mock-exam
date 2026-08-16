"use client";

import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/useMe";
import {
  LayoutDashboard,
  Users,
  School,
  KeyRound,
  ClipboardList,
  ShoppingBag,
  Building2,
  CalendarClock,
  NotebookText,
  Timer,
  CirclePlay,
  LifeBuoy,
} from "lucide-react";

/**
 * Operational console navigation.
 * Serves admin.mastersat.uz.
 *
 * Admin operations nav is shown to all staff. The teacher workspace lives on its own
 * subdomain (teacher.mastersat.uz) and is reached from there, not from here — this console
 * is governance only.
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
    href: "/ops/journals",
    label: "Journals",
    icon: NotebookText,
    exact: false,
  },
  {
    // Who covers which class, what students say about them, and their working hours. The
    // hours are the reason this is a write surface at all: the API has accepted an admin
    // setting somebody else's since opt-out hours shipped, and there has never been a
    // screen for it. Sits next to Classrooms because that is where support teachers are
    // ASSIGNED — this page is oversight, not staffing, and does not duplicate it.
    //
    // Not superAdminOnly: staffing the desk is a head-of-school job, and the API gate is
    // `_is_admin` — the same one that already guards editing a teacher's hours.
    href: "/ops/support",
    label: "Support desk",
    icon: LifeBuoy,
    exact: false,
  },
  // Reports only — midterm *authoring* still lives in the Builder console. This is the
  // read-only pass/fail record for a classroom.
  {
    href: "/ops/midterms",
    label: "Midterms",
    icon: Timer,
    exact: false,
  },
  // Invigilated full-mock sittings: mint the sitting + its code here, then a teacher runs
  // the room on the day (lets students in, presses Start).
  {
    href: "/ops/mock-sessions",
    label: "Mock sittings",
    icon: CirclePlay,
    exact: false,
  },
  // Operational assignment management + midterm authoring moved out of the admin panel
  // (authoring lives in the Builder console). Admin keeps governance (Classrooms) +
  // Access/Users/Audit.
  // Authoring is super_admin's alone (the API enforces it on every endpoint; this only
  // avoids showing a page the server would refuse).
  {
    href: "/ops/surveys",
    label: "Surveys",
    icon: ClipboardList,
    exact: false,
    superAdminOnly: true,
  },
  {
    // Regions, branches, and which branch each classroom meets at. Without this the branch
    // leaderboard has nothing to group by — a student's branch is derived from their
    // classroom, so an unassigned classroom puts its whole roster on no branch board.
    href: "/ops/branches",
    label: "Branches",
    icon: Building2,
    exact: false,
  },
  {
    // Stock, prices and the collection queue. Not super_admin-only: handing a prize over is
    // a desk job, and the API gate is the same one that guards moving a student's coins.
    href: "/ops/shop",
    label: "Shop",
    icon: ShoppingBag,
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
    href: "/ops/exam-dates",
    label: "Exam dates",
    icon: CalendarClock,
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
  superAdminOnly?: boolean;
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
  const isSuperAdmin = role === "super_admin" || Boolean(me?.is_superuser);
  const navItems = OPS_NAV.filter(
    (item) => !("superAdminOnly" in item && item.superAdminOnly) || isSuperAdmin,
  );

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
                {navItems.map((item) => (
                  <NavItem key={item.href} {...item} pathname={pathname} />
                ))}
              </nav>

            </aside>

            {/* Main content */}
            <main className="min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
