import {
  LayoutDashboard,
  LineChart,
  Users,
  ClipboardCheck,
  BookOpen,
  BookOpenCheck,
  ClipboardList,
  FileText,
  UserCircle,
  ClipboardPen,
  Table2,
  School,
  Timer,
  CirclePlay,
  FolderOpen,
  House,
  ListTodo,
  BookA,
  CircleHelp,
  ShieldCheck,
  Coins,
  LifeBuoy,
  ClipboardList as ClipboardListIcon,
} from "lucide-react";

export type NavItem = {
  /** Present on leaf items (real routes). Omitted on collapsible group parents. */
  href?: string;
  label: string;
  icon: React.ElementType;
  /** Marks a page introduced by the rebuild's gap analysis. */
  isNew?: boolean;
  /**
   * Kept out of the sidebar but still a real route: reached from the header instead.
   * It stays in the config so the command palette can find it and so the mobile top bar
   * still knows the page's name — dropping the entry entirely would cost both.
   */
  hiddenInSidebar?: boolean;
  /**
   * A count rendered on the right of the row — "My work · 3". Only a flat row has space
   * for one, which is half the reason the groups came out.
   */
  badge?: number;
  /** When present, this item is a collapsible category whose children are the routes. */
  children?: NavItem[];
};
/** An empty `section` string renders the items as top-level (no header). */
export type NavSection = { section: string; items: NavItem[] };

/**
 * Student information architecture.
 *
 * The old shape grouped by the codebase's taxonomy rather than a student's: "Learn" bundled
 * a place (Classroom), a task type (Assessment) and a subject (Vocabulary), while
 * "Simulation" held three near-identical timed papers and Midterm — the same database model
 * — sat outside as its own peer. Those three daily destinations are now top-level.
 *
 * "Practice" stays a group for the moment. Past Paper and Practice test serve the same rows
 * through two endpoints and offer opposite affordances; merging them into one library is
 * real work with its own route, so this only renames the drawer rather than pretending the
 * merged page exists.
 */
export const studentNav: NavSection[] = [
  {
    section: "",
    items: [
      { href: "/", label: "Today", icon: House },
      { href: "/assessments", label: "My work", icon: ListTodo },
      { href: "/classes", label: "Classes", icon: Users },
      { href: "/vocabulary", label: "Vocabulary", icon: BookA },
      {
        label: "Practice",
        icon: Timer,
        children: [
          { href: "/pastpapers", label: "Past Paper", icon: BookOpen },
          { href: "/mock-exam", label: "Mock Exam", icon: ClipboardList },
          { href: "/practice-tests", label: "Practice test", icon: BookOpenCheck },
        ],
      },
      { href: "/midterm", label: "Midterm", icon: FileText },
      { href: "/question-bank", label: "Question Bank", icon: CircleHelp },
      { href: "/support", label: "Support", icon: LifeBuoy },
      // Reached from the header instead. A survey only exists now and then, points are a
      // running total worth seeing on every page, and Profile already has the avatar.
      { href: "/surveys", label: "Surveys", icon: ClipboardListIcon, hiddenInSidebar: true },
      { href: "/rewards", label: "Points", icon: Coins, hiddenInSidebar: true },
      { href: "/profile", label: "Profile", icon: UserCircle, hiddenInSidebar: true },
    ],
  },
];

/**
 * Content-QA reviewer entry (test_auditor and other content staff). Composed into the
 * top of the student sidebar only for reviewers — see StudentAppShell.
 */
export const reviewNavSection: NavSection = {
  section: "",
  items: [{ href: "/review-center", label: "Review Center", icon: ShieldCheck }],
};

/**
 * Support-teacher entry, composed into the teacher sidebar only for that role — see
 * TeacherAppShell. A plain teacher would get a 403 from the availability endpoints, so
 * showing them the page would be a broken link rather than a permission lesson.
 */
export const supportTeacherNavSection: NavSection = {
  section: "Support",
  items: [{ href: "/teacher/support", label: "Support sessions", icon: LifeBuoy, isNew: true }],
};

/** Teacher information architecture (see docs/UI_REBUILD_IA.md §5). */
export const teacherNav: NavSection[] = [
  {
    section: "",
    items: [
      { href: "/teacher", label: "Dashboard", icon: LayoutDashboard },
      { href: "/teacher/analytics", label: "Analytics", icon: LineChart, isNew: true },
    ],
  },
  {
    section: "Classroom",
    items: [
      { href: "/teacher/classrooms", label: "Classrooms", icon: School },
      { href: "/teacher/assessments", label: "Assessments", icon: ClipboardCheck },
      { href: "/teacher/midterms", label: "Midterms", icon: Timer },
      // Run an invigilated full mock: let students in with the admin's code, press Start.
      { href: "/teacher/mock-sessions", label: "Mock sittings", icon: CirclePlay, isNew: true },
      { href: "/teacher/materials", label: "Materials", icon: FolderOpen },
      { href: "/teacher/students", label: "Students", icon: Users },
    ],
  },
  {
    section: "Grading",
    items: [
      { href: "/teacher/homework", label: "Homework", icon: ClipboardList },
      { href: "/teacher/grading", label: "Grading", icon: ClipboardPen, isNew: true },
      { href: "/teacher/gradebook", label: "Gradebook", icon: Table2, isNew: true },
    ],
  },
];

/** Returns only the leaf items (those with an href), recursing into collapsible groups. */
export function flattenNav(nav: NavSection[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      if (item.children && item.children.length) walk(item.children);
      else if (item.href) out.push(item);
    }
  };
  nav.forEach((s) => walk(s.items));
  return out;
}

/** True when a collapsible group contains the currently-active route. */
export function navGroupHasActiveChild(item: NavItem, pathname: string): boolean {
  return (item.children ?? []).some((c) => c.href != null && isNavItemActive(c.href, pathname));
}

export function isNavItemActive(href: string | undefined, pathname: string): boolean {
  if (!href) return false;
  if (href === "/" || href === "/teacher") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function pageTitleFor(nav: NavSection[], pathname: string, fallback = "MasterSAT"): string {
  const flat = flattenNav(nav);
  const exact = flat.find((n) => n.href === pathname);
  if (exact) return exact.label;
  const match = flat
    .filter((n) => n.href !== "/" && n.href !== "/teacher")
    .find((n) => isNavItemActive(n.href, pathname));
  return match?.label ?? fallback;
}
