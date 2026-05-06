import type { SubjectFilter } from "@/features/questionBank/types";

export const moduleComposerKeys = {
  all: ["moduleComposer"] as const,
  bank: (args: {
    excludeModuleId: number;
    subject: SubjectFilter;
    categoryId: number | "all";
    q: string;
    offset: number;
    pageSize: number;
  }) => [...moduleComposerKeys.all, "bank", args] as const,
};
