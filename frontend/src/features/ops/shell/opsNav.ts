import type { IconName } from "@/components/ui/Icon";
import { P, holds, isDeskViewer, type MeLike } from "@/features/ops/permissions";

export type { MeLike };

/** The sections that can carry a waiting-work count beside their sidebar label. */
export type OpsNavCountKey = "trials";

/**
 * The ops console's sidebar, grouped the way Django admin groups its apps.
 *
 * Serves admin.mastersat.uz. The console is governance only — the teacher workspace lives on its
 * own subdomain (teacher.mastersat.uz) and is reached from there, not from here.
 *
 * Who sees what (plan 2026-11-12-crm-roles, PR 3), each rule only avoiding a page the server would refuse or
 * the owner keeps off the desk:
 * - `requires`: the permissions the page's API checks; the item shows to whoever holds one of them;
 * - `superAdminOnly` items are the super admin's alone;
 * - `notForDesk` items are kept off the desk's console (the owner's list for admins, 2026-10): hidden from
 *   anyone who holds a CRM permission, unless they are the owner.
 * A group whose items are all filtered out is dropped, caption included.
 */
export type OpsNavItem = {
  href: string;
  label: string;
  /** A design icon (`<Icon name>`), from the redesign's set. */
  icon: IconName;
  /** Match the path exactly rather than as a prefix — only the dashboard, since every ops page sits under `/ops`. */
  exact?: boolean;
  superAdminOnly?: boolean;
  /** Shown only to a viewer holding one of these permissions: the ones the page's API checks. */
  requires?: readonly string[];
  /** The owner keeps this off the desk's console: hidden from desk viewers (`isDeskViewer`). */
  notForDesk?: boolean;
  /** Work waiting behind this section — the shell fetches it and the sidebar draws it beside the label. */
  countKey?: OpsNavCountKey;
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
    items: [{ href: "/ops", label: "Today", icon: "ms-today", exact: true }],
  },
  {
    // The old single "Users" list, split three ways (2026-10-14). `/ops/users` redirects to
    // Students and is not in the nav.
    id: "people",
    caption: "People",
    items: [
      { href: "/ops/students", label: "Students", icon: "users", requires: [P.manageUsers, P.assignAccess] },
      { href: "/ops/public", label: "Public users", icon: "user", requires: [P.manageUsers, P.assignAccess] },
      { href: "/ops/staff", label: "Staff", icon: "shield", requires: [P.manageUsers, P.assignAccess] },
      { href: "/ops/access", label: "Access", icon: "key", requires: [P.manageUsers, P.assignAccess] },
    ],
  },
  {
    id: "teaching",
    caption: "Teaching",
    items: [
      { href: "/ops/classrooms", label: "Classrooms", icon: "cap", requires: [P.viewPeople] },
      // Regions, branches, and which branch each classroom meets at. Without it the branch
      // leaderboard has nothing to group by.
      { href: "/ops/branches", label: "Branches", icon: "ms-branch" },
      { href: "/ops/journals", label: "Journals", icon: "ms-journal", notForDesk: true },
      // Reports only — midterm authoring still lives in the Builder console.
      { href: "/ops/midterms", label: "Midterm results", icon: "ms-midterm", notForDesk: true },
      // Invigilated full-mock sittings: mint the sitting + its code here, then a teacher runs
      // the room on the day.
      { href: "/ops/mock-sessions", label: "Mock sittings", icon: "ms-room", notForDesk: true },
      { href: "/ops/exam-dates", label: "Exam dates", icon: "ms-examdate", notForDesk: true },
    ],
  },
  {
    id: "centre",
    caption: "Centre",
    // Ordered by desk use (design handoff v0.3, Main · C): what waits on the desk first.
    items: [
      // Trial students and lc-up members missing from a class list (owner, 2026-10-20); the count is what
      // waits on the desk.
      { href: "/ops/trials", label: "Trials", icon: "ms-trial", countKey: "trials", requires: [P.enroll] },
      // Money as lc-up keeps it. Its own page, not a tab of lc-up — the owner wanted them apart.
      { href: "/ops/finance", label: "Finance", icon: "wallet", requires: [P.viewMoney, P.viewReports] },
      // The eskiz SMS account: balance, the journal of every SMS, campaigns, the debt warning, templates.
      { href: "/ops/sms", label: "SMS", icon: "msg", requires: [P.sendSms, P.sendDebtSms] },
      // The centre's CRM: pair lc-up groups with our classes, settle unmatched students. The name the
      // staff know, plus what it is.
      { href: "/ops/lcup", label: "lc-up (CRM link)", icon: "ms-sync", requires: [P.lcupTools] },
      // Who teaches support, and which hours they are available.
      { href: "/ops/support", label: "Support hours", icon: "ms-support" },
      // Stock, prices and the collection queue — a desk job, not super_admin-only.
      { href: "/ops/shop", label: "Reward shop", icon: "ms-coins", requires: [P.eventsShop] },
    ],
  },
  {
    id: "content",
    caption: "Content",
    items: [
      // Workshops, talks and open days: the desk publishes them and marks who came.
      { href: "/ops/events", label: "Events", icon: "cal", requires: [P.eventsShop] },
      // What the class bot posts into the class Telegram groups: event posts and written ones.
      { href: "/ops/telegram-posts", label: "Telegram posts", icon: "ms-classpost", requires: [P.eventsShop] },
      // The ring of circles across the top of every student's dashboard.
      { href: "/ops/stories", label: "Stories", icon: "ms-story", requires: [P.eventsShop], notForDesk: true },
      { href: "/ops/surveys", label: "Surveys", icon: "clipboard", superAdminOnly: true },
    ],
  },
  {
    id: "system",
    caption: "System",
    items: [
      // Raising the minimum iOS version stops every older app at an update screen.
      { href: "/ops/mobile", label: "Mobile app", icon: "ms-appversion", superAdminOnly: true },
      // A broadcast cannot be recalled — super admins only, like the endpoint.
      { href: "/ops/broadcast", label: "Broadcast", icon: "ms-broadcast", superAdminOnly: true },
    ],
  },
];

export function isOpsSuperAdmin(me: MeLike): boolean {
  if (!me) return false;
  const role = String(me.role ?? "").trim().toLowerCase();
  return role === "super_admin" || Boolean(me.is_superuser);
}

/** Whether this viewer may see one item (see "Who sees what" above). */
export function canSeeItem(item: OpsNavItem, me: MeLike): boolean {
  if (item.superAdminOnly && !isOpsSuperAdmin(me)) return false;
  if (item.notForDesk && isDeskViewer(me)) return false;
  return holds(me, ...(item.requires ?? []));
}

/** The groups and items this viewer may see, in nav order; empty groups are dropped. */
export function visibleNav(groups: readonly OpsNavGroup[], me: MeLike): OpsNavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSeeItem(item, me)) }))
    .filter((group) => group.items.length > 0);
}

/**
 * Whether this viewer may open a console path: the nav item it sits under decides. A path no item lists is
 * kept off the desk like `notForDesk` items (the old Assignments notice, the design page), except
 * `/ops/users`, which only redirects to Students.
 */
export function opsPathAllowed(pathname: string, me: MeLike, groups: readonly OpsNavGroup[] = OPS_NAV_GROUPS): boolean {
  if (pathname === "/ops/users" || pathname.startsWith("/ops/users/")) {
    return holds(me, P.manageUsers, P.assignAccess);
  }
  const item = activeNavItem(pathname, groups);
  if (item) return canSeeItem(item, me);
  return !isDeskViewer(me);
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
 * The nav item a path sits under — the LONGEST matching href, so a nested item lights only itself and
 * not its parent too, and `/ops/classrooms/12/roster` is Classrooms.
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
   * The design's two temperatures: Admin is calm and squarer; the Builder is rounder and roomier
   * (`data-ms-temp="builder"` on the shell, owner 2026-10-15: "django paneldek zerikarli oddiy bo'lib
   * qolmasligi kerak").
   */
  temp: "admin" | "builder";
};

export const OPS_CONSOLE: ConsoleConfig = {
  root: "/ops",
  brand: "admin",
  crumb: "Admin",
  collapseKey: "mastersat.ops.sidebar.collapsed",
  groups: OPS_NAV_GROUPS,
  visible: visibleNav,
  temp: "admin",
};
