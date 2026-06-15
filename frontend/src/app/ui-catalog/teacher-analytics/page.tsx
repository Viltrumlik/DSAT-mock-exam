"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherAnalytics } from "@/features/teacher/TeacherAnalytics";
import { SAMPLE_TEACHER_ANALYTICS } from "@/features/teacher/sampleAnalytics";

export default function TeacherAnalyticsPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname.includes("analytics") ? "/teacher/analytics" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherAnalytics previewModel={SAMPLE_TEACHER_ANALYTICS} />
    </AppShell>
  );
}
