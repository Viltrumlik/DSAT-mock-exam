"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherStudents } from "@/features/teacher/TeacherStudents";
import { SAMPLE_TEACHER_ANALYTICS } from "@/features/teacher/sampleAnalytics";

export default function StudentsPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname.includes("students") ? "/teacher/students" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherStudents previewModel={SAMPLE_TEACHER_ANALYTICS} />
    </AppShell>
  );
}
