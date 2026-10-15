import {
  Archive,
  BookMarked,
  Database,
  FileText,
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  Library,
  ListChecks,
  Tag,
  Timer,
  Upload,
} from "lucide-react";
import { visibleByRole, type ConsoleConfig, type OpsNavGroup } from "@/features/ops/shell/opsNav";

/**
 * The builder's sidebar (questions.mastersat.uz), in the ops console's frame since 2026-10-15
 * (owner: "question builderni opsga styledan ko'chirib builderni ham o'zgartiring").
 *
 * The same items, names and order the builder's own sidebar had — only the frame changed:
 *   - Learning: the pedagogical / classroom content;
 *   - Simulation: SAT simulation — past papers, practice tests, full mocks;
 *   - Archived, on its own under a hairline as before.
 *
 * The sidebar marks the longest match, so the Question Bank's own pages (a question, "new")
 * light Question Bank, and Triage Queue and Imports light only themselves.
 */
export const BUILDER_NAV_GROUPS: readonly OpsNavGroup[] = [
  {
    id: "home",
    caption: null,
    items: [{ href: "/builder", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    id: "learning",
    caption: "Learning",
    items: [
      { href: "/builder/question-bank", label: "Question Bank", icon: Database },
      { href: "/builder/question-bank/triage", label: "Triage Queue", icon: ListChecks },
      { href: "/builder/question-bank/imports", label: "Imports", icon: Upload },
      { href: "/builder/bank", label: "Sets bank (legacy)", icon: Library },
      { href: "/builder/sets", label: "Assessments", icon: LayoutGrid },
      { href: "/builder/midterms", label: "Midterms", icon: GraduationCap },
      { href: "/builder/vocabulary", label: "Vocabulary", icon: BookMarked },
      { href: "/builder/categories", label: "Categories", icon: Tag },
    ],
  },
  {
    id: "simulation",
    caption: "Simulation",
    items: [
      { href: "/builder/pastpapers", label: "Past papers", icon: FileText },
      { href: "/builder/practice-tests", label: "Practice tests", icon: FlaskConical },
      { href: "/builder/full-mocks", label: "Full mocks", icon: Timer },
    ],
  },
  {
    id: "archive",
    caption: null,
    items: [{ href: "/builder/archived", label: "Archived", icon: Archive }],
  },
];

export const BUILDER_CONSOLE: ConsoleConfig = {
  root: "/builder",
  brand: "builder",
  crumb: "Builder",
  collapseKey: "mastersat.builder.sidebar.collapsed",
  groups: BUILDER_NAV_GROUPS,
  // The builder has no admin scoping: AuthGuard `adminOnly` decides who is here at all.
  visible: visibleByRole,
  // Rounded and roomy, not the dense Django-admin frame (owner 2026-10-15: "avvalgidek chiroyli").
  soft: true,
};

/**
 * Editor pages get the whole window — no sidebar competing for space: the assessment set editor,
 * the past paper / practice test / midterm module editors and the full-mock module editor.
 */
export function isBuilderEditorRoute(pathname: string): boolean {
  return (
    /^\/builder\/sets\/\d+/.test(pathname) ||
    /^\/builder\/pastpapers\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/practice-tests\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/midterms\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/full-mocks\/\d+\/\d+/.test(pathname)
  );
}
