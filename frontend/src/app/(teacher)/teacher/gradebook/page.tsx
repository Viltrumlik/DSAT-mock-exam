import { TeacherGradebook } from "@/features/teacher/TeacherGradebook";

/**
 * `/teacher/gradebook` — one class's homework against the students who were given it.
 *
 * The screen carries its own four branches, including the one where a teacher is not signed in,
 * so there is nothing to wrap it in here: it is the whole page.
 */
export default function TeacherGradebookPage() {
  return <TeacherGradebook />;
}
