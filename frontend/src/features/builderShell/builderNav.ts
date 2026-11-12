import { visibleByRole, type ConsoleConfig, type OpsNavGroup } from "@/features/ops/shell/opsNav";

/**
 * The builder's sidebar (questions.mastersat.uz), in the ops console's frame since 2026-10-15
 * (owner: "question builderni opsga styledan ko'chirib builderni ham o'zgartiring").
 *
 * The builder's groups as its own sidebar had them, with the redesign's clearer names (design handoff
 * v0.3, Main · C): "Triage Queue" is the Review queue, and "Sets bank (legacy)" is the Old sets bank,
 * moved below the line next to Archived.
 *   - Learning: the pedagogical / classroom content;
 *   - Simulation: SAT simulation — past papers, practice tests, full mocks;
 *   - below the line: the old sets bank and Archived.
 *
 * The sidebar marks the longest match, so the Question Bank's own pages (a question, "new")
 * light Question Bank, and the Review queue and Imports light only themselves.
 */
export const BUILDER_NAV_GROUPS: readonly OpsNavGroup[] = [
  {
    id: "home",
    caption: null,
    items: [{ href: "/builder", label: "Studio home", icon: "home", exact: true }],
  },
  {
    id: "learning",
    caption: "Learning",
    items: [
      { href: "/builder/question-bank", label: "Question bank", icon: "ms-question" },
      // "Triage" was the word only the team knew; the page explains it in a helper line.
      { href: "/builder/question-bank/triage", label: "Review queue", icon: "ms-review" },
      { href: "/builder/question-bank/imports", label: "Imports", icon: "ms-import" },
      { href: "/builder/sets", label: "Assessments", icon: "layers" },
      { href: "/builder/midterms", label: "Midterms", icon: "ms-midterm" },
      { href: "/builder/vocabulary", label: "Vocabulary", icon: "ms-vocab" },
      { href: "/builder/categories", label: "Categories", icon: "tag" },
    ],
  },
  {
    id: "simulation",
    caption: "Simulation",
    items: [
      { href: "/builder/pastpapers", label: "Past papers", icon: "ms-pastpaper" },
      { href: "/builder/practice-tests", label: "Practice tests", icon: "pencil" },
      { href: "/builder/full-mocks", label: "Full mocks", icon: "ms-fullmock" },
    ],
  },
  {
    // Below the line, out of the daily path but fully usable: the old sets bank sits next to Archived.
    id: "archive",
    caption: null,
    items: [
      { href: "/builder/bank", label: "Old sets bank", icon: "library" },
      { href: "/builder/archived", label: "Archived", icon: "archive" },
    ],
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
  temp: "builder",
};

/**
 * Editor pages get the whole window — no sidebar competing for space: the assessment set editor,
 * the past paper / practice test / midterm module editors and the full-mock module editor.
 *
 * A past paper or practice test module is `/<library>/<test>/<module>` — two numbers. This asked for
 * three until PR 14a, so those two editors opened inside the sidebar frame; the midterm one has three
 * (`/midterms/<exam>/<test>/<module>`).
 */
export function isBuilderEditorRoute(pathname: string): boolean {
  return (
    /^\/builder\/sets\/\d+/.test(pathname) ||
    /^\/builder\/pastpapers\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/practice-tests\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/midterms\/\d+\/\d+\/\d+/.test(pathname) ||
    /^\/builder\/full-mocks\/\d+\/\d+/.test(pathname)
  );
}
