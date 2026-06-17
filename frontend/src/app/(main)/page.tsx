import { StudentDashboard } from "@/features/dashboard/StudentDashboard";
import { TeacherPortalDeniedNotice } from "@/features/dashboard/TeacherPortalDeniedNotice";

export default function DashboardPage() {
  return (
    <>
      <TeacherPortalDeniedNotice />
      <StudentDashboard />
    </>
  );
}
