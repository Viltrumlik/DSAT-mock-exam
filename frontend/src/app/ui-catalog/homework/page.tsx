"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherHomework } from "@/features/teacher/TeacherHomework";
import { SAMPLE_TEACHER_ANALYTICS } from "@/features/teacher/sampleAnalytics";

export default function HomeworkPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname.includes("homework") ? "/teacher/homework" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherHomework previewModel={SAMPLE_TEACHER_ANALYTICS} />
    </AppShell>
  );
}
