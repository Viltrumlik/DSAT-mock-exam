import {
  LayoutDashboard,
  LineChart,
  Users,
  ClipboardCheck,
  BookOpen,
  BookOpenCheck,
  ClipboardList,
  FileText,
  Languages,
  UserCircle,
  ClipboardPen,
  Table2,
  School,
  Timer,
  FolderOpen,
  Database,
  GraduationCap,
  MonitorPlay,
  ShieldCheck,
} from "lucide-react";

export type NavItem = {
  /** Present on leaf items (real routes). Omitted on collapsible group parents. */
  href?: string;
  label: string;
  icon: React.ElementType;
  /** Marks a page introduced by the rebuild's gap analysis. */
  isNew?: boolean;
  /** When present, this item is a collapsible category whose children are the routes. */
  children?: NavItem[];
};
/** An empty `section` string renders the items as top-level (no header). */
export type NavSection = { section: string; items: NavItem[] };

/**
 * Student information architecture.
 * Dashboard, Midterm, Question Bank and Profile are top-level links; "Learn"
 * and "Simulation" are collapsible categories that expand to reveal their
 * routes on click. Notifications live in the top-bar bell, not the sidebar.
 */
export const studentNav: NavSection[] = [
  {
    section: "",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      {
        label: "Learn",
        icon: GraduationCap,
        children: [
          { href: "/classes", label: "Classroom", icon: Users },
          { href: "/assessments", label: "Assessment", icon: ClipboardCheck },
          { href: "/vocabulary", label: "Vocabulary", icon: Languages },
        ],
      },
      {
        label: "Simulation",
        icon: MonitorPlay,
        children: [
          { href: "/pastpapers", label: "Past Paper", icon: BookOpen },
          { href: "/mock-exam", label: "Mock Exam", icon: ClipboardList },
          { href: "/practice-tests", label: "Practice test", icon: BookOpenCheck },
        ],
      },
      { href: "/midterm", label: "Midterm", icon: FileText },
      { href: "/question-bank", label: "Question Bank", icon: Database },
      { href: "/profile", label: "Profile", icon: UserCircle },
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
