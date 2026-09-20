"use client";

/**
 * Preview of the rebuilt teacher dashboard, on invented data. `/teacher` itself needs a teacher
 * account and live classes; this route renders the same component from a fixed sample, which is
 * how the page is reviewed without one.
 */

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherDashboard, type TeacherDashboardPreview } from "@/features/teacher/TeacherDashboard";

const SAMPLE: TeacherDashboardPreview = {
  today: {
    date: "2026-09-21",
    nextLessonDate: "2026-09-22",
    lessons: [
      {
        classroomId: 1, name: "Math Junior 3", subject: "MATH", lessonTime: "10:00", studentCount: 14,
        homework: {
          assignmentId: 91, title: "Linear functions, set 4", turnedIn: 11, missing: 3,
          missingStudents: [
            { id: 1, name: "Aziza K." },
            { id: 2, name: "Bekzod T." },
            { id: 3, name: "Malika R." },
          ],
        },
      },
      {
        classroomId: 2, name: "Reading Senior 1", subject: "ENGLISH", lessonTime: "14:30", studentCount: 18,
        homework: { assignmentId: 92, title: "Inference set 7", turnedIn: 18, missing: 0, missingStudents: [] },
      },
      { classroomId: 3, name: "Math Senior 2", subject: "MATH", lessonTime: null, studentCount: 12, homework: null },
    ],
    waitingToCheck: [
      { classroomId: 1, name: "Math Junior 3", count: 7 },
      { classroomId: 2, name: "Reading Senior 1", count: 2 },
    ],
    upcomingMidterms: [
      { midtermId: 5, title: "September midterm", classroomId: 1, className: "Math Junior 3", startsAt: "2026-09-24T10:00:00+05:00", passMark: 60 },
      { midtermId: 6, title: "Diagnostic", classroomId: 3, className: "Math Senior 2", startsAt: "2026-09-29T10:00:00+05:00", passMark: null },
    ],
  },
  attention: [
    { id: "a1", name: "Aziza K.", avatarUrl: null, reason: "Average 48% · Math Junior 3", tone: "danger" },
    { id: "a2", name: "Bekzod T.", avatarUrl: null, reason: "3 not turned in · Math Junior 3", tone: "warning" },
  ],
};

export default function TeacherDashboardPreview() {
  const pathname = usePathname();
  return (
    <AppShell
      brand={{ name: "MasterSAT", tagline: "Teacher" }}
      nav={teacherNav}
      pathname={pathname === "/ui-catalog/teacher" ? "/teacher" : pathname}
      user={{ name: "Preview" }}
      onSignOut={() => {}}
    >
      <TeacherDashboard preview={SAMPLE} />
    </AppShell>
  );
}
