export const questionsModuleKeys = {
  root: ["questions", "module"] as const,
  // `source` namespaces the cache per backend (e.g. "exams" vs "mock") so a mock
  // module and a pastpaper module that happen to share an id don't collide.
  list: (source: string, testId: number, moduleId: number) =>
    [...questionsModuleKeys.root, "list", source, testId, moduleId] as const,
};
