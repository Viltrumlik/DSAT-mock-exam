"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherDashboard } from "@/features/teacher/TeacherDashboard";
import type { TeacherDashboardModel } from "@/features/teacher/useTeacherDashboard";

const SAMPLE: TeacherDashboardModel = {
  classCount: 3,
  totalStudents: 64,
  activeStudents: 51,
  avgScore: 71,
  submissionRate: 82,
  classAvgTrend: [
    { label: "Mar 3", score: 1180 }, { label: "Mar 18", score: 1220 }, { label: "Apr 2", score: 1240 },
    { label: "Apr 20", score: 1290 }, { label: "May 8", score: 1310 }, { label: "May 26", score: 1350 },
  ],
  completionByAssignment: [
    { label: "Linear func", completion: 92 }, { label: "Inferences", completion: 64 },
    { label: "Geometry", completion: 78 }, { label: "Mock 3", completion: 41 }, { label: "Percentages", completion: 88 },
  ],
  needsAttention: [
    { id: "1", name: "Sara Kim", reason: "Average 48% · Math 101", tone: "danger" },
    { id: "2", name: "Diyor A.", reason: "Average 55% · Reading B", tone: "danger" },
    { id: "3", name: "Lola T.", reason: "3 missing · Math 101", tone: "warning" },
    { id: "4", name: "Otabek R.", reason: "2 missing · Mock cohort", tone: "warning" },
  ],
  missing: [
    { id: "m1", title: "Full mock 3", className: "Mock cohort", completion: 41 },
    { id: "m2", title: "Inferences set", className: "Reading B", completion: 64 },
    { id: "m3", title: "Geometry basics", className: "Math 101", completion: 78 },
  ],
  upcoming: [
    { id: "u1", title: "Linear functions HW", className: "Math 101", dueLabel: "Due tomorrow", soon: true },
    { id: "u2", title: "Reading mock", className: "Reading B", dueLabel: "Due in 4d", soon: false },
  ],
  classes: [
    { id: 1, name: "Reading B", students: 19, avgScore: 58, completion: 71 },
    { id: 2, name: "Math 101", students: 24, avgScore: 69, completion: 84 },
    { id: 3, name: "Mock cohort", students: 21, avgScore: 82, completion: 88 },
  ],
  hasStrandData: false,
};

export default function TeacherDashboardPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname === "/ui-catalog/teacher" ? "/teacher" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherDashboard previewModel={SAMPLE} />
    </AppShell>
  );
}
