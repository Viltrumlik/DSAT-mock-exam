export const classroomKeys = {
  all: ["classroom"] as const,
  list: () => [...classroomKeys.all, "list"] as const,
  detail: (id: number) => [...classroomKeys.all, "detail", id] as const,
  members: (id: number) => [...classroomKeys.all, "members", id] as const,
  workspace: (id: number) => [...classroomKeys.all, "workspace", id] as const,
  interventions: (id: number) => [...classroomKeys.all, "interventions", id] as const,
  assignments: (id: number) => [...classroomKeys.all, "assignments", id] as const,
  stream: (id: number) => [...classroomKeys.all, "stream", id] as const,
  materials: (id: number) => [...classroomKeys.all, "materials", id] as const,
  assignmentOptions: (id: number) => [...classroomKeys.all, "assignment-options", id] as const,
  midtermResults: (id: number) => [...classroomKeys.all, "midterm-results", id] as const,
  results: (id: number, filters: Record<string, unknown>) => [...classroomKeys.all, "results", id, filters] as const,
};
