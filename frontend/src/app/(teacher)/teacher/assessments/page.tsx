import { TeacherAssessments } from "@/features/teacher/assessments/TeacherAssessments";

/**
 * `/teacher/assessments` — the assessment library.
 *
 * The screen moved out of this file and into the feature folder, where the rest of the panel
 * keeps its pages: 178 lines of list, filters and fetching lived in the route, which is why no
 * test could mount it and why its four states were never checked against each other.
 *
 * No `AuthGuard` here: TeacherAppShell wraps this whole route group in one already, and a second
 * copy inside it gates nothing the first did not.
 */
export default function TeacherAssessmentsPage() {
  return <TeacherAssessments />;
}
