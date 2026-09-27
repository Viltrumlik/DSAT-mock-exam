import { TeacherPastpapers } from "@/features/teacher/pastpapers/TeacherPastpapers";

/**
 * `/teacher/pastpapers` — the past-paper library, reachable on the teacher host at last. The
 * student route `/pastpapers` is bounced to `/teacher` here (see middleware.ts), so without
 * this page a teacher had no way in at all.
 */
export default function TeacherPastpapersPage() {
  return <TeacherPastpapers />;
}
