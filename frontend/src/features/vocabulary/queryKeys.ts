export const vocabularyKeys = {
  all: ["vocabulary"] as const,
  sections: () => [...vocabularyKeys.all, "sections"] as const,
  section: (sectionId: number) => [...vocabularyKeys.all, "section", sectionId] as const,
  set: (setId: number) => [...vocabularyKeys.all, "set", setId] as const,
  wordSearch: (q: string, section?: number) =>
    [...vocabularyKeys.all, "word-search", q, section ?? null] as const,
  mySets: () => [...vocabularyKeys.all, "my-sets"] as const,
  homework: () => [...vocabularyKeys.all, "homework"] as const,
};
