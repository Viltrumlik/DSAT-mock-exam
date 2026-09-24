"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherHomework } from "@/features/teacher/TeacherHomework";
import { SAMPLE_TEACHER_ANALYTICS } from "@/features/teacher/sampleAnalytics";
import type { TeacherAnalyticsModel } from "@/features/teacher/useTeacherAnalytics";

/**
 * The shared sample has no "challenging" assignment in it — its only low group mean also sits
 * under 50% turned in, and "low-completion" wins that tie in the hook — so one of the page's
 * three health chips never appeared in a screenshot taken from here. A chip nobody reviews is
 * how a state gets quietly lost. One invented assignment is added locally rather than editing
 * `sampleAnalytics`, which the students and analytics previews also draw from.
 *
 * Invented data only: this repository is public and no real student may appear in it.
 */
const PREVIEW: TeacherAnalyticsModel = {
  ...SAMPLE_TEACHER_ANALYTICS,
  assignments: [
    ...SAMPLE_TEACHER_ANALYTICS.assignments,
    {
      id: 7, title: "Inference drill 4", classId: 2, className: "Reading B",
      completionPct: 81, submitted: 17, total: 21,
      isAssessment: false, isOverdue: false, groupMean: 1240, createdMs: null,
      effectiveness: "challenging",
    },
  ],
};

export default function HomeworkPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname.includes("homework") ? "/teacher/homework" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherHomework previewModel={PREVIEW} />
    </AppShell>
  );
}
