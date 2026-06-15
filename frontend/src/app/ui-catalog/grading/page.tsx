"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherGrading } from "@/features/teacher/TeacherGrading";
import type { QueueItem } from "@/features/teacher/useGradingQueue";

const now = Date.now();
const mk = (id: number, first: string, last: string, title: string, cls: string, ago: number, files: { url: string; file_name: string }[] = [], attempt?: { practice_test_title: string; score: number }): QueueItem => ({
  key: `${title}-${id}`,
  classId: 1, className: cls, assignmentId: id, assignmentTitle: title,
  submission: {
    id, status: "SUBMITTED", revision: 1, workflow_status: "SUBMITTED",
    submitted_at: new Date(now - ago * 3600000).toISOString(),
    student: { id, first_name: first, last_name: last }, review: null,
    files, attempt: attempt ?? null,
  },
});

const SAMPLE: QueueItem[] = [
  mk(1, "Sara", "Kim", "Essay — Rhetorical analysis", "Reading B", 2, [{ url: "#", file_name: "sara-essay.pdf" }]),
  mk(2, "Diyor", "Aliyev", "Essay — Rhetorical analysis", "Reading B", 5, [{ url: "#", file_name: "diyor-essay.docx" }]),
  mk(3, "Lola", "Tashkenova", "Math problem set 4", "Math 101", 9, [{ url: "#", file_name: "lola-pset4.pdf" }]),
  mk(4, "Otabek", "Rashidov", "Practice test 3", "Mock cohort", 26, [], { practice_test_title: "Practice test 3 · Math", score: 1420 }),
];

export default function GradingPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname === "/ui-catalog/grading" ? "/teacher/grading" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherGrading previewItems={SAMPLE} />
    </AppShell>
  );
}
