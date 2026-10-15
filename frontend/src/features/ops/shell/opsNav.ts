import {
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  CirclePlay,
  ClipboardList,
  Globe,
  GraduationCap,
  Images,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  NotebookText,
  RefreshCw,
  School,
  ShoppingBag,
  Smartphone,
  Timer,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_OPS_SECTIONS, isScopedOpsAdmin } from "@/features/ops/adminScope";

/**
 * The ops console's sidebar, grouped the way Django admin groups its apps.
 *
 * Serves admin.mastersat.uz. The console is governance only — the teacher workspace lives on its
 * own subdomain (teacher.mastersat.uz) and is reached from there, not from here.
 *
 * Who sees what:
 * - `superAdminOnly` items are the super admin's alone (the API enforces it; this only avoids
 *   showing a page the server would refuse);
 * - an `admin` sees the school's sections and nothing else (features/ops/adminScope);
 * - teachers and test auditors who can open the console see the rest.
 * A group whose items are all filtered out is dropped, caption included.
 */
export type OpsNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly rather than as a prefix — only the dashboard, since every ops page sits under `/ops`. */
  exact?: boolean;
  superAdminOnly?: boolean;
};

export type OpsNavGroup = {
  id: string;
  /** Small uppercase caption above the group; `null` for the uncaptioned top group. */
  caption: string | null;
  items: readonly OpsNavItem[];
};

export const OPS_NAV_GROUPS: readonly OpsNavGroup[] = [
  {
    id: "home",
    caption: null,
    items: [{ href: "/ops", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    // The old single "Users" list, split three ways (2026-10-14). `/ops/users` redirects to
    // Students and is not in the nav.
    id: "people",
    caption: "People",
    items: [
      { href: "/ops/students", label: "Students", icon: GraduationCap },
      { href: "/ops/public", label: "Public users", icon: Globe },
      { href: "/ops/staff", label: "Staff", icon: BadgeCheck },
      { href: "/ops/access", label: "Access", icon: KeyRound },
    ],
  },
  {
    id: "teaching",
    caption: "Teaching",
    items: [
      { href: "/ops/classrooms", label: "Classrooms", icon: School },
      // Regions, branches, and which branch each classroom meets at. Without it the branch
      // leaderboard has nothing to group by.
      { href: "/ops/branches", label: "Branches", icon: Building2 },
      { href: "/ops/journals", label: "Journals", icon: NotebookText },
      // Reports only — midterm authoring still lives in the Builder console.
      { href: "/ops/midterms", label: "Midterms", icon: Timer },
      // Invigilated full-mock sittings: mint the sitting + its code here, then a teacher runs
      // the room on the day.
      { href: "/ops/mock-sessions", label: "Mock sittings", icon: CirclePlay },
      { href: "/ops/exam-dates", label: "Exam dates", icon: CalendarClock },
    ],
  },
  {
    id: "centre",
    caption: "Centre",
    items: [
      // The centre's CRM: pair lc-up groups with our classes, settle unmatched students.
      { href: "/ops/lcup", label: "lc-up", icon: RefreshCw },
      // Money as lc-up keeps it. Its own page, not a tab of lc-up — the owner wanted them apart.
      { href: "/ops/finance", label: "Finance", icon: Wallet },
      // Who teaches support, and which hours they are available.
      { href: "/ops/support", label: "Support", icon: LifeBuoy },
      // Stock, prices and the collection queue — a desk job, not super_admin-only.
      { href: "/ops/shop", label: "Shop", icon: ShoppingBag },
    ],
  },
  {
    id: "content",
    caption: "Content",
    items: [
      // Workshops, talks and open days: the desk publishes them and marks who came.
      { href: "/ops/events", label: "Events", icon: CalendarDays },
      // The ring of circles across the top of every student's dashboard.
      { href: "/ops/stories", label: "Stories", icon: Images },
      { href: "/ops/surveys", label: "Surveys", icon: ClipboardList, superAdminOnly: true },
    ],
  },
  {
    id: "system",
    caption: "System",
    items: [
      // Raising the minimum iOS version stops every older app at an update screen.
      { href: "/ops/mobile", label: "Mobile app", icon: Smartphone, superAdminOnly: true },
      // A broadcast cannot be recalled — super admins only, like the endpoint.
      { href: "/ops/broadcast", label: "Broadcast", icon: Megaphone, superAdminOnly: true },
    ],
  },
];

/** `useMe` types the payload as an open record, so the fields are narrowed here. */
export type MeLike = Record<string, unknown> | null | undefined;

export function isOpsSuperAdmin(me: MeLike): boolean {
  if (!me) return false;
  const role = String(me.role ?? "").trim().toLowerCase();
  return role === "super_admin" || Boolean(me.is_superuser);
}

/** The groups and items this viewer may see, in nav order; empty groups are dropped. */
export function visibleNav(groups: readonly OpsNavGroup[], me: MeLike): OpsNavGroup[] {
  const superAdmin = isOpsSuperAdmin(me);
  const scoped = isScopedOpsAdmin(me);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superAdminOnly && !superAdmin) return false;
        return !scoped || ADMIN_OPS_SECTIONS.includes(item.href);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * The groups a console WITHOUT the admin scoping shows (the builder): only `superAdminOnly` is
 * applied, and a group left empty is dropped.
 */
export function visibleByRole(groups: readonly OpsNavGroup[], me: MeLike): OpsNavGroup[] {
  const superAdmin = isOpsSuperAdmin(me);
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.superAdminOnly || superAdmin) }))
    .filter((group) => group.items.length > 0);
}

export function isOpsNavActive(pathname: string, item: Pick<OpsNavItem, "href" | "exact">): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The nav item a path sits under — the LONGEST matching href, so `/builder/question-bank/triage`
 * is Triage Queue and not also Question Bank, and `/ops/classrooms/12/roster` is Classrooms.
 * The sidebar marks only this item; `null` when no item matches.
 */
export function activeNavItem(pathname: string, groups: readonly OpsNavGroup[]): OpsNavItem | null {
  let best: OpsNavItem | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (isOpsNavActive(pathname, item) && (!best || item.href.length > best.href.length)) {
        best = item;
      }
    }
  }
  return best;
}

/**
 * The section a path belongs to — the nav item whose href it sits under (longest match), so a
 * deeper page such as `/ops/classrooms/12/roster` resolves to Classrooms. A console path the nav
 * does not list (`/ops/users`, `/ops/assignments`) is named after its first segment.
 *
 * Defaults to the ops console; the builder passes its own groups and root.
 */
export function sectionFor(
  pathname: string,
  groups: readonly OpsNavGroup[] = OPS_NAV_GROUPS,
  root = "/ops",
): { href: string; label: string } | null {
  const best = activeNavItem(pathname, groups);
  if (best) return { href: best.href, label: best.label };

  if (!pathname.startsWith(`${root}/`)) return null;
  const segment = pathname.slice(root.length + 1).split(/[/?#]/)[0];
  const words = segment.replace(/[-_]+/g, " ").trim();
  if (!words) return null;
  return { href: `${root}/${segment}`, label: words.charAt(0).toUpperCase() + words.slice(1) };
}

/** The breadcrumb's label for a path, or `null` outside the console. */
export function sectionLabel(pathname: string): string | null {
  return sectionFor(pathname)?.label ?? null;
}

/**
 * What one console's frame needs to know: where it lives, what it is called, and its nav. The ops
 * console and the builder (questions.mastersat.uz, owner 2026-10-15: "opsga styledan ko'chirib")
 * wear the same frame; only this differs.
 */
export type ConsoleConfig = {
  /** The console's home: the brand link, the breadcrumb's first crumb, the root of unlisted paths. */
  root: string;
  /** The word after "MasterSAT" in the sidebar: "admin", "builder". */
  brand: string;
  /** The breadcrumb's first crumb, and the name in the nav's accessible labels: "Admin", "Builder". */
  crumb: string;
  /** Where the collapsed-rail preference is remembered. */
  collapseKey: string;
  groups: readonly OpsNavGroup[];
  /** The groups and items this viewer may see, in nav order. */
  visible: (groups: readonly OpsNavGroup[], me: MeLike) => OpsNavGroup[];
  /**
   * A softer, roomier frame: taller rounded nav rows, a washed background, and the page in a
   * centred column with generous padding. The builder wears it (owner 2026-10-15: "django paneldek
   * zerikarli oddiy bo'lib qolmasligi kerak"); /ops keeps the dense Django-admin frame.
   */
  soft?: boolean;
};

export const OPS_CONSOLE: ConsoleConfig = {
  root: "/ops",
  brand: "admin",
  crumb: "Admin",
  collapseKey: "mastersat.ops.sidebar.collapsed",
  groups: OPS_NAV_GROUPS,
  visible: visibleNav,
};
