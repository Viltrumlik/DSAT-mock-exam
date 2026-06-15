"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherGradebook } from "@/features/teacher/TeacherGradebook";
import type { Cell, GradebookModel, ClassOption } from "@/features/teacher/useGradebook";

const A = [
  { id: 1, title: "HW 1" }, { id: 2, title: "HW 2" }, { id: 3, title: "Quiz 1" }, { id: 4, title: "Mock 1" }, { id: 5, title: "HW 3" },
];
const cell = (assignmentId: number, status: Cell["status"], grade: number | null): Cell => ({ assignmentId, status, grade });
function row(id: number, name: string, grades: (number | null | "miss" | "sub")[]) {
  const cells: Cell[] = grades.map((g, i) => g === "miss" ? cell(A[i].id, "missing", null) : g === "sub" ? cell(A[i].id, "submitted", null) : cell(A[i].id, "graded", g));
  const graded = cells.filter((c) => c.grade != null).map((c) => c.grade as number);
  const average = graded.length ? Math.round(graded.reduce((a, b) => a + b, 0) / graded.length) : null;
  const trendDelta = graded.length >= 2 ? graded[graded.length - 1] - graded[0] : null;
  return { id, name, cells, average, trendDelta, missing: cells.filter((c) => c.status === "missing").length };
}

const MODEL: GradebookModel = {
  assignments: A,
  students: [
    row(1, "Sara Kim", [42, 51, 48, "miss", 55]),
    row(2, "Diyor Aliyev", [88, 91, 84, 90, 93]),
    row(3, "Lola Tashkenova", [72, 68, "sub", 75, 70]),
    row(4, "Otabek Rashidov", [95, 92, 98, 90, "miss"]),
    row(5, "Nodira S.", [63, 70, 66, 72, 78]),
  ],
  classAverage: 74,
  distribution: [{ band: "0–49", count: 1 }, { band: "50–69", count: 1 }, { band: "70–84", count: 2 }, { band: "85–100", count: 1 }],
  missingCount: 2,
};
const CLASSES: ClassOption[] = [{ id: 1, name: "Math 101" }, { id: 2, name: "Reading B" }];

export default function GradebookPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname === "/ui-catalog/gradebook" ? "/teacher/gradebook" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherGradebook preview={{ classes: CLASSES, model: MODEL }} />
    </AppShell>
  );
}
