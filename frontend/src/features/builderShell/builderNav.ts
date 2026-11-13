import { flattenCategories, visibleByRole, type ConsoleCategory, type ConsoleConfig, type OpsNavGroup } from "@/features/ops/shell/opsNav";

/**
 * The builder's navigation (questions.mastersat.uz), in the ops console's frame since 2026-10-15
 * (owner: "question builderni opsga styledan ko'chirib builderni ham o'zgartiring") and in the v0.4 rail + panel
 * since PR 25 (design handoff, Shell board · Full map):
 *   - Home: Studio home;
 *   - Learning: the pedagogical / classroom content (Questions, Sets, Words);
 *   - Simulation: SAT simulation — past papers, practice tests, full mocks;
 *   - Archive: Archived and the old sets bank (Legacy), out of the daily path but fully usable.
 * The Review queue and Imports left on 2026-11-12 (owner: "shu ikkisi umuman kerak emas … pdfdan import qilmayapmiz").
 *
 * The panel marks the longest match, so the Question Bank's own pages (a question, "new")
 * light Question Bank.
 */
export const BUILDER_CATEGORIES: readonly ConsoleCategory[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    letter: "H",
    home: true,
    groups: [{ id: "home", caption: null, items: [{ href: "/builder", label: "Studio home", icon: "home", exact: true }] }],
  },
  {
    id: "learning",
    label: "Learning",
    icon: "ms-question",
    letter: "L",
    groups: [
      { id: "questions", caption: "Questions", items: [{ href: "/builder/question-bank", label: "Question bank", icon: "ms-question" }] },
      {
        id: "sets",
        caption: "Sets",
        items: [
          { href: "/builder/sets", label: "Assessments", icon: "layers" },
          { href: "/builder/midterms", label: "Midterms", icon: "ms-midterm" },
          { href: "/builder/categories", label: "Categories", icon: "tag" },
        ],
      },
      { id: "words", caption: "Words", items: [{ href: "/builder/vocabulary", label: "Vocabulary", icon: "ms-vocab" }] },
    ],
  },
  {
    id: "simulation",
    label: "Simulation",
    icon: "ms-fullmock",
    letter: "S",
    groups: [
      { id: "real", caption: "Real papers", items: [{ href: "/builder/pastpapers", label: "Past papers", icon: "ms-pastpaper" }] },
      { id: "practice", caption: "Practice", items: [{ href: "/builder/practice-tests", label: "Practice tests", icon: "pencil" }] },
      { id: "timed", caption: "Timed exams", items: [{ href: "/builder/full-mocks", label: "Full mocks", icon: "ms-fullmock" }] },
    ],
  },
  {
    id: "archive",
    label: "Archive",
    icon: "archive",
    letter: "A",
    groups: [
      { id: "retired", caption: "Retired", items: [{ href: "/builder/archived", label: "Archived", icon: "archive" }] },
      { id: "legacy", caption: "Legacy", items: [{ href: "/builder/bank", label: "Old sets bank", icon: "library" }] },
    ],
  },
];

export const BUILDER_NAV_GROUPS: readonly OpsNavGroup[] = flattenCategories(BUILDER_CATEGORIES);

export const BUILDER_CONSOLE: ConsoleConfig = {
  root: "/builder",
  brand: "builder",
  crumb: "Builder",
  collapseKey: "mastersat.builder.sidebar.collapsed",
  categories: BUILDER_CATEGORIES,
  groups: BUILDER_NAV_GROUPS,
  // The builder has no admin scoping: AuthGuard `adminOnly` decides who is here at all.
  visible: visibleByRole,
  // Rounded and roomy, not the dense Django-admin frame (owner 2026-10-15: "avvalgidek chiroyli").
  temp: "builder",
};

/**
 * Editor pages get the whole window — no rail or panel competing for space (Shell board, "Editors hide the shell
 * entirely"): the assessment set editor, the past paper / practice test / midterm module editors and the full-mock
 * module editor.
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
