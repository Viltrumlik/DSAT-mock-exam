import type { ActiveFilter, LifecycleStatusFilter, SubjectFilter } from "./types";

export const questionBankKeys = {
  all: ["questionBank"] as const,
  list: (args: {
    q: string;
    categoryId: number | "all";
    subject: SubjectFilter;
    isActive: ActiveFilter;
    lifecycleStatus: LifecycleStatusFilter;
  }) => [...questionBankKeys.all, "list", args] as const,
  categories: () => [...questionBankKeys.all, "categories"] as const,
  tests: () => [...questionBankKeys.all, "tests"] as const,
  modules: (testId: number) => [...questionBankKeys.all, "modules", testId] as const,
  detail: (questionId: number) => [...questionBankKeys.all, "detail", questionId] as const,
  moduleLinks: (questionId: number) => [...questionBankKeys.all, "moduleLinks", questionId] as const,
};

