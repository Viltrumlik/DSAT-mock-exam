"use client";

import { useParams } from "next/navigation";
import { TeacherPaper } from "@/features/teacher/pastpapers/TeacherPaper";

/** `/teacher/pastpapers/[paperId]` — read one paper's questions. Nothing here starts a sitting. */
export default function TeacherPastpaperPage() {
  const params = useParams();
  return <TeacherPaper paperId={Number(params?.paperId)} />;
}
