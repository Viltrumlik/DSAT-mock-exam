import {
  LayoutDashboard,
  LineChart,
  GraduationCap,
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
  BookA,
  CircleHelp,
  ShieldCheck,
  Coins,
  LifeBuoy,
  Route,
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
  /** When present, this item is a collapsible category whose children are the routes. */
  children?: NavItem[];
};
/**
 * An empty `section` string renders the items as top-level (no header), so the
 * heading is not unique — `id` is, and it is what the sidebar keys its sections
 * on (two headerless sections can be composed together, e.g. the reviewer's
 * Review Center on top of the student IA).
 */
export type NavSection = { id: string; section: string; items: NavItem[] };

/**
 * Student information architecture.
 * Dashboard, Midterm, Question Bank and Profile are top-level links; "Learn"
 * and "Simulation" are collapsible categories that expand to reveal their
 * routes on click. Notifications live in the top-bar bell, not the sidebar.
 */
export const studentNav: NavSection[] = [
  {
    id: "student-main",
    section: "",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      {
        label: "Learn",
        icon: GraduationCap,
        children: [
          { href: "/roadmap", label: "Roadmap", icon: Route, isNew: true },
          { href: "/classes", label: "Classroom", icon: Users },
          { href: "/assessments", label: "Assessment", icon: ClipboardCheck },
          { href: "/vocabulary", label: "Vocabulary", icon: BookA },
        ],
      },
      {
        label: "Simulation",
        icon: Timer,
        children: [
          { href: "/pastpapers", label: "Past Paper", icon: BookOpen },
          { href: "/mock-exam", label: "Mock Exam", icon: ClipboardList },
          { href: "/practice-tests", label: "Practice test", icon: BookOpenCheck },
        ],
      },
      { href: "/midterm", label: "Midterm", icon: FileText },
      { href: "/support", label: "Support", icon: LifeBuoy, isNew: true },
      // Surveys and Points are reached from the header, not the sidebar: a survey only
      // exists now and then, and points are a running total worth seeing on every page
      // rather than a destination to remember.
      { href: "/surveys", label: "Surveys", icon: ClipboardListIcon, hiddenInSidebar: true },
      { href: "/rewards", label: "Points", icon: Coins, hiddenInSidebar: true },
      { href: "/question-bank", label: "Question Bank", icon: CircleHelp },
      { href: "/profile", label: "Profile", icon: UserCircle },
    ],
  },
];

/**
 * Content-QA reviewer entry (test_auditor and other content staff). Composed into the
 * top of the student sidebar only for reviewers — see StudentAppShell.
 */
export const reviewNavSection: NavSection = {
  id: "review-center",
  section: "",
  items: [{ href: "/review-center", label: "Review Center", icon: ShieldCheck }],
};

/**
 * Support-teacher entry, composed into the teacher sidebar only for that role — see
 * TeacherAppShell. A plain teacher would get a 403 from the availability endpoints, so
 * showing them the page would be a broken link rather than a permission lesson.
 */
export const supportTeacherNavSection: NavSection = {
  id: "teacher-support",
  section: "Support",
  items: [{ href: "/teacher/support", label: "Support sessions", icon: LifeBuoy, isNew: true }],
};

/** Teacher information architecture (see docs/UI_REBUILD_IA.md §5). */
export const teacherNav: NavSection[] = [
  {
    id: "teacher-main",
    section: "",
    items: [
      { href: "/teacher", label: "Dashboard", icon: LayoutDashboard },
      { href: "/teacher/analytics", label: "Analytics", icon: LineChart, isNew: true },
    ],
  },
  {
    id: "teacher-classroom",
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
    id: "teacher-grading",
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
