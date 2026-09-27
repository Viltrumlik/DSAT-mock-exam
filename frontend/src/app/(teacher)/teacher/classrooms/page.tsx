import { TeacherClassrooms } from "@/features/classroom/pages/TeacherClassrooms";

/**
 * `/teacher/classrooms` — the class list, and the way into every classroom.
 *
 * The component still lives under `features/classroom` because that is where the classroom
 * workspace it leads to lives; this route is its only consumer, and it is teacher-only. The
 * students' version of this screen is a different file (`features/classroom/pages/ClassesHome`).
 */
export default function TeacherClassroomsPage() {
  return <TeacherClassrooms />;
}
