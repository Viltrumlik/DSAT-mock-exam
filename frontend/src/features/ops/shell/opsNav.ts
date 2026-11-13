import type { IconName } from "@/components/ui/Icon";
import { FINANCE_TAB_IDS, FINANCE_TAB_LABEL, FINANCE_TAB_NEEDS } from "@/features/finance/financeTabs";
import { LCUP_TAB_IDS, LCUP_TAB_LABEL, TRIALS_TAB_IDS, TRIALS_TAB_LABEL } from "@/features/lcup/lcupTabs";
import { P, holds, isDeskViewer, type MeLike } from "@/features/ops/permissions";
import { SMS_TAB_IDS, SMS_TAB_LABEL, SMS_TAB_NEEDS } from "@/features/ops/sms/smsTabs";

export type { MeLike };

/** The sections that can carry a waiting-work count beside their label. */
export type OpsNavCountKey = "trials";

/** One of a page's own tabs, drawn as a tree under it in the panel (synced with `?tab=`). */
export type OpsNavTab = {
  id: string;
  label: string;
  /** Shown only to a viewer holding one of these — the same rule the page applies to its own tab bar. */
  requires?: readonly string[];
};

/**
 * The ops console's navigation (design handoff v0.4, Shell board): a dark rail of CATEGORIES, and a panel with the
 * sub-categories (groups) and pages of the one you are in.
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
 * A group whose items are all filtered out is dropped, caption included, and a category left with no group
 * disappears from the rail (the desk has no System).
 */
export type OpsNavItem = {
  href: string;
  label: string;
  /** A design icon (`<Icon name>`), from the redesign's set. */
  icon: IconName;
  /** Match the path exactly rather than as a prefix — only the dashboards, since every page sits under their root. */
  exact?: boolean;
  superAdminOnly?: boolean;
  /** Shown only to a viewer holding one of these permissions: the ones the page's API checks. */
  requires?: readonly string[];
  /** The owner keeps this off the desk's console: hidden from desk viewers (`isDeskViewer`). */
  notForDesk?: boolean;
  /** Work waiting behind this section — the shell fetches it and the panel draws it beside the label. */
  countKey?: OpsNavCountKey;
  /** The page's own tabs, in its own words; the first is the one it opens on. */
  tabs?: readonly OpsNavTab[];
};

export type OpsNavGroup = {
  id: string;
  /** The sub-category's name above its pages; `null` for a category's single uncaptioned group. */
  caption: string | null;
  items: readonly OpsNavItem[];
};

/** One tile of the rail: a big area of the console, its sub-categories inside. */
export type ConsoleCategory = {
  id: string;
  label: string;
  icon: IconName;
  /** `G` then this letter jumps here from anywhere. */
  letter: string;
  /**
   * A category that is one page with sections of its own (Today, Studio home): its panel lists the cards on
   * the page and the recently opened pages instead of groups.
   */
  home?: boolean;
  groups: readonly OpsNavGroup[];
};

const tabsOf = <T extends string>(ids: readonly T[], label: Record<T, string>, needs?: Record<T, readonly string[]>): OpsNavTab[] =>
  ids.map((id) => (needs ? { id, label: label[id], requires: needs[id] } : { id, label: label[id] }));

/** The board's "Full map": the groups stay the ones the staff know; only their form changed. */
export const OPS_CATEGORIES: readonly ConsoleCategory[] = [
  {
    id: "today",
    label: "Today",
    icon: "ms-today",
    letter: "T",
    home: true,
    groups: [{ id: "home", caption: null, items: [{ href: "/ops", label: "Today", icon: "ms-today", exact: true }] }],
  },
  {
    // The old single "Users" list, split three ways (2026-10-14). `/ops/users` redirects to Students and is not listed.
    id: "people",
    label: "People",
    icon: "users",
    letter: "P",
    groups: [
      {
        id: "learners",
        caption: "Learners",
        items: [
          { href: "/ops/students", label: "Students", icon: "users", requires: [P.manageUsers, P.assignAccess] },
          { href: "/ops/public", label: "Public users", icon: "user", requires: [P.manageUsers, P.assignAccess] },
        ],
      },
      {
        id: "team",
        caption: "Team",
        items: [
          { href: "/ops/staff", label: "Staff", icon: "shield", requires: [P.manageUsers, P.assignAccess] },
          { href: "/ops/access", label: "Access", icon: "key", requires: [P.manageUsers, P.assignAccess] },
        ],
      },
    ],
  },
  {
    id: "teaching",
    label: "Teaching",
    icon: "cap",
    letter: "E",
    groups: [
      {
        id: "classes",
        caption: "Classes",
        items: [
          { href: "/ops/classrooms", label: "Classrooms", icon: "cap", requires: [P.viewPeople] },
          // Regions, branches, and which branch each classroom meets at. Without it the branch
          // leaderboard has nothing to group by.
          { href: "/ops/branches", label: "Branches", icon: "ms-branch", requires: [P.manageGroups] },
        ],
      },
      {
        id: "course",
        caption: "Course",
        items: [
          { href: "/ops/journals", label: "Journals", icon: "ms-journal", notForDesk: true },
          // Reports only — midterm authoring still lives in the Builder console.
          { href: "/ops/midterms", label: "Midterm results", icon: "ms-midterm", notForDesk: true },
        ],
      },
      {
        id: "exams",
        caption: "Exams",
        items: [
          // Invigilated full-mock sittings: mint the sitting + its code here, then a teacher runs the room on the day.
          { href: "/ops/mock-sessions", label: "Mock sittings", icon: "ms-room", notForDesk: true },
          { href: "/ops/exam-dates", label: "Exam dates", icon: "ms-examdate", notForDesk: true },
        ],
      },
    ],
  },
  {
    id: "centre",
    label: "Centre",
    icon: "wallet",
    letter: "C",
    groups: [
      {
        id: "enrolment",
        caption: "Enrolment",
        items: [
          // Trial students and lc-up members missing from a class list (owner, 2026-10-20); the count is what
          // waits on the desk.
          {
            href: "/ops/trials",
            label: "Trials",
            icon: "ms-trial",
            countKey: "trials",
            requires: [P.enroll],
            tabs: tabsOf(TRIALS_TAB_IDS, TRIALS_TAB_LABEL),
          },
          // The centre's CRM: pair lc-up groups with our classes, settle unmatched students. The name the
          // staff know, plus what it is.
          { href: "/ops/lcup", label: "lc-up (CRM link)", icon: "ms-sync", requires: [P.lcupTools], tabs: tabsOf(LCUP_TAB_IDS, LCUP_TAB_LABEL) },
        ],
      },
      {
        id: "money",
        caption: "Money",
        items: [
          // Money as lc-up keeps it. Its own page, not a tab of lc-up — the owner wanted them apart.
          {
            href: "/ops/finance",
            label: "Finance",
            icon: "wallet",
            requires: [P.viewMoney, P.viewReports],
            tabs: tabsOf(FINANCE_TAB_IDS, FINANCE_TAB_LABEL, FINANCE_TAB_NEEDS),
          },
          // Stock, prices and the collection queue — a desk job, not super_admin-only.
          { href: "/ops/shop", label: "Reward shop", icon: "ms-coins", requires: [P.eventsShop] },
        ],
      },
      {
        id: "messages",
        caption: "Messages",
        // The eskiz SMS account: balance, the journal of every SMS, campaigns, the debt warning, templates.
        items: [
          {
            href: "/ops/sms",
            label: "SMS",
            icon: "msg",
            requires: [P.sendSms, P.sendDebtSms],
            tabs: tabsOf(SMS_TAB_IDS, SMS_TAB_LABEL, SMS_TAB_NEEDS),
          },
        ],
      },
      {
        id: "help",
        caption: "Help",
        // Who teaches support, and which hours they are available.
        items: [{ href: "/ops/support", label: "Support hours", icon: "ms-support", requires: [P.manageGroups] }],
      },
    ],
  },
  {
    id: "content",
    label: "Content",
    icon: "ms-classpost",
    letter: "O",
    groups: [
      {
        id: "engage",
        caption: "Engage",
        items: [
          // Workshops, talks and open days: the desk publishes them and marks who came.
          { href: "/ops/events", label: "Events", icon: "cal", requires: [P.eventsShop] },
          { href: "/ops/surveys", label: "Surveys", icon: "clipboard", superAdminOnly: true },
        ],
      },
      {
        id: "publish",
        caption: "Publish",
        items: [
          // What the class bot posts into the class Telegram groups: event posts and written ones.
          { href: "/ops/telegram-posts", label: "Telegram posts", icon: "ms-classpost", requires: [P.eventsShop] },
          // The ring of circles across the top of every student's dashboard.
          { href: "/ops/stories", label: "Stories", icon: "ms-story", requires: [P.eventsShop], notForDesk: true },
        ],
      },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "sliders",
    letter: "S",
    groups: [
      // Raising the minimum iOS version stops every older app at an update screen.
      { id: "app", caption: "App", items: [{ href: "/ops/mobile", label: "Mobile app", icon: "ms-appversion", superAdminOnly: true }] },
      // A broadcast cannot be recalled — super admins only, like the endpoint.
      { id: "reach", caption: "Reach", items: [{ href: "/ops/broadcast", label: "Broadcast", icon: "ms-broadcast", superAdminOnly: true }] },
    ],
  },
];

/** Every group of every category, in rail order — what ⌘K, the breadcrumb and the scope tests read. */
export function flattenCategories(categories: readonly ConsoleCategory[]): OpsNavGroup[] {
  return categories.flatMap((c) => c.groups);
}

export const OPS_NAV_GROUPS: readonly OpsNavGroup[] = flattenCategories(OPS_CATEGORIES);

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

/** The item as this viewer sees it: its tabs cut to the ones they may open, as its own tab bar does. */
function withVisibleTabs(item: OpsNavItem, me: MeLike): OpsNavItem {
  if (!item.tabs?.some((t) => t.requires)) return item;
  return { ...item, tabs: item.tabs.filter((t) => holds(me, ...(t.requires ?? []))) };
}

/** The groups and items this viewer may see, in nav order; empty groups are dropped. */
export function visibleNav(groups: readonly OpsNavGroup[], me: MeLike): OpsNavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSeeItem(item, me)).map((item) => withVisibleTabs(item, me)) }))
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

/** The categories this viewer may open, each with only its visible groups; an emptied category disappears. */
export function visibleCategories(
  categories: readonly ConsoleCategory[],
  me: MeLike,
  visible: (groups: readonly OpsNavGroup[], me: MeLike) => OpsNavGroup[] = visibleNav,
): ConsoleCategory[] {
  return categories.map((c) => ({ ...c, groups: visible(c.groups, me) })).filter((c) => c.groups.length > 0);
}

/** Where clicking a category goes: its first page. */
export function firstHref(category: Pick<ConsoleCategory, "groups">): string {
  return category.groups[0]?.items[0]?.href ?? "";
}

/** A link's path without its query or hash: "/ops/classrooms?status=active" → "/ops/classrooms". */
export function pathOnly(href: string): string {
  return href.split(/[?#]/)[0];
}

export function isOpsNavActive(pathname: string, item: Pick<OpsNavItem, "href" | "exact">): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The nav item a path sits under — the LONGEST matching href, so a nested item lights only itself and
 * not its parent too, and `/ops/classrooms/12/roster` is Classrooms.
 * The panel marks only this item; `null` when no item matches.
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

/** The category a path (or a link with a query) belongs to, and the page in it; `null` outside the map. */
export function categoryOf(
  href: string,
  categories: readonly ConsoleCategory[],
): { category: ConsoleCategory; item: OpsNavItem } | null {
  const item = activeNavItem(pathOnly(href), flattenCategories(categories));
  if (!item) return null;
  const category = categories.find((c) => c.groups.some((g) => g.items.includes(item)));
  return category ? { category, item } : null;
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

/** One step of the top bar's breadcrumb; the last one is where you are and has no link. */
export type Crumb = { label: string; href?: string };

/**
 * The top bar's three levels (Shell board): category › page › the open tab or the open record —
 * "Centre › Finance › Debtors", "Teaching › Classrooms › Middle M5". A dashboard is its own name ("Today").
 * A console path the map does not list keeps the old "Admin › Users".
 *
 * `tabs` are the page's tabs as the page itself publishes them (or the map's), `tab` the open one;
 * `detail` names the record a deeper path shows (from the recently opened list), when known.
 */
export function crumbsFor(
  pathname: string,
  {
    categories,
    root,
    rootLabel,
    tabs,
    tab,
    detail,
  }: {
    categories: readonly ConsoleCategory[];
    root: string;
    rootLabel: string;
    tabs?: readonly OpsNavTab[] | null;
    tab?: string | null;
    detail?: string | null;
  },
): Crumb[] {
  const found = categoryOf(pathname, categories);
  if (!found) {
    const section = sectionFor(pathname, flattenCategories(categories), root);
    return section ? [{ label: rootLabel, href: root }, { label: section.label }] : [{ label: rootLabel }];
  }
  const { category, item } = found;
  if (category.home && pathname === item.href) return [{ label: item.label }];

  const crumbs: Crumb[] = [{ label: category.label, href: firstHref(category) }];
  let third: string | null = null;
  if (pathname !== item.href) {
    third = detail ?? null;
  } else {
    const list = tabs ?? item.tabs ?? null;
    if (list && list.length > 0) third = (list.find((t) => t.id === tab) ?? list[0]).label;
  }
  crumbs.push(third ? { label: item.label, href: item.href } : { label: item.label });
  if (third) crumbs.push({ label: third });
  return crumbs;
}

/**
 * What one console's frame needs to know: where it lives, what it is called, and its map. The ops
 * console and the builder (questions.mastersat.uz, owner 2026-10-15: "opsga styledan ko'chirib")
 * wear the same frame; only this differs.
 */
export type ConsoleConfig = {
  /** The console's home: the logo's link, the root of unlisted paths. */
  root: string;
  /** The word on the rail's console pill: "admin", "builder". */
  brand: string;
  /** The console's name: "Admin", "Builder" — the first crumb of an unlisted path, the nav's accessible labels. */
  crumb: string;
  /** Where the folded-panel preference is remembered. */
  collapseKey: string;
  /** The rail's categories, each with its groups. */
  categories: readonly ConsoleCategory[];
  /** Every group of every category, flat (⌘K, the breadcrumb of unlisted paths). */
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
  categories: OPS_CATEGORIES,
  groups: OPS_NAV_GROUPS,
  visible: visibleNav,
  temp: "admin",
};
